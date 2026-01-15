# Stripe Integration Pattern

> Complete Stripe integration for SaaS subscriptions including checkout, portal, webhooks, and subscription lifecycle management.

## Overview

This pattern covers:
- Checkout session creation with metadata
- Customer portal integration
- Subscription lifecycle state machine
- Webhook signature verification
- Idempotent event processing
- Audit trail for billing events

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Backend   │────▶│   Stripe    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                           │◀───────────────────│
                           │    Webhooks        │
                           ▼                    │
                    ┌─────────────┐             │
                    │  Database   │             │
                    │ (Subs, Audit)│            │
                    └─────────────┘             │
```

## Implementation

### Configuration

```python
import os
from dataclasses import dataclass
from typing import Dict


@dataclass
class StripePriceConfig:
    """Configuration for a Stripe price."""
    price_id: str
    tier: str
    monthly_limit: int
    features: list[str]


class StripeConfig:
    """Stripe configuration with price mappings."""
    
    def __init__(self):
        self.api_key = os.environ["STRIPE_SECRET_KEY"]
        self.webhook_secret = os.environ["STRIPE_WEBHOOK_SECRET"]
        self.publishable_key = os.environ["STRIPE_PUBLISHABLE_KEY"]
        
        # Price ID to tier mapping
        self.prices: Dict[str, StripePriceConfig] = {
            os.environ.get("STRIPE_PRICE_PRO", "price_pro"): StripePriceConfig(
                price_id=os.environ.get("STRIPE_PRICE_PRO", "price_pro"),
                tier="pro",
                monthly_limit=100,
                features=["priority_support", "advanced_analytics"],
            ),
            os.environ.get("STRIPE_PRICE_STUDIO", "price_studio"): StripePriceConfig(
                price_id=os.environ.get("STRIPE_PRICE_STUDIO", "price_studio"),
                tier="studio",
                monthly_limit=500,
                features=["priority_support", "advanced_analytics", "api_access", "white_label"],
            ),
        }
    
    def get_tier_for_price(self, price_id: str) -> str:
        """Get subscription tier for a price ID."""
        config = self.prices.get(price_id)
        return config.tier if config else "free"
    
    def get_price_for_tier(self, tier: str) -> str:
        """Get price ID for a subscription tier."""
        for price_id, config in self.prices.items():
            if config.tier == tier:
                return price_id
        raise ValueError(f"Unknown tier: {tier}")
```

### Stripe Service

```python
import stripe
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class StripeSubscription:
    """Normalized Stripe subscription data."""
    id: str
    customer_id: str
    status: str
    price_id: str
    current_period_start: int
    current_period_end: int
    cancel_at_period_end: bool


class StripeWebhookError(Exception):
    """Raised when webhook signature verification fails."""
    pass


class StripeService:
    """
    Service for Stripe API operations.
    
    Handles:
    - Checkout session creation
    - Customer portal sessions
    - Subscription retrieval
    - Webhook signature verification
    """
    
    def __init__(self, config: StripeConfig):
        self.config = config
        stripe.api_key = config.api_key
    
    async def create_checkout_session(
        self,
        user_id: str,
        user_email: str,
        tier: str,
        success_url: str,
        cancel_url: str,
    ) -> str:
        """
        Create a Stripe Checkout session for subscription purchase.
        
        Args:
            user_id: Internal user ID (stored in metadata)
            user_email: User's email for Stripe customer
            tier: Subscription tier (pro, studio)
            success_url: Redirect URL on success
            cancel_url: Redirect URL on cancel
            
        Returns:
            Checkout session URL
        """
        price_id = self.config.get_price_for_tier(tier)
        
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{
                "price": price_id,
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=user_email,
            metadata={
                "user_id": user_id,
                "tier": tier,
            },
            subscription_data={
                "metadata": {
                    "user_id": user_id,
                    "tier": tier,
                },
            },
            # Allow promotion codes
            allow_promotion_codes=True,
            # Collect billing address for tax
            billing_address_collection="required",
        )
        
        logger.info(
            f"Created checkout session: user_id={user_id}, "
            f"tier={tier}, session_id={session.id}"
        )
        
        return session.url
    
    async def create_portal_session(
        self,
        customer_id: str,
        return_url: str,
    ) -> str:
        """
        Create a Stripe Customer Portal session.
        
        Allows customers to manage their subscription, update payment
        methods, and view invoices.
        
        Args:
            customer_id: Stripe customer ID
            return_url: URL to return to after portal
            
        Returns:
            Portal session URL
        """
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        
        return session.url
    
    async def get_subscription(self, subscription_id: str) -> StripeSubscription:
        """Retrieve subscription details from Stripe."""
        sub = stripe.Subscription.retrieve(subscription_id)
        
        # Get price ID from subscription items
        price_id = sub.items.data[0].price.id if sub.items.data else None
        
        return StripeSubscription(
            id=sub.id,
            customer_id=sub.customer,
            status=sub.status,
            price_id=price_id,
            current_period_start=sub.current_period_start,
            current_period_end=sub.current_period_end,
            cancel_at_period_end=sub.cancel_at_period_end,
        )
    
    async def cancel_subscription(
        self,
        subscription_id: str,
        at_period_end: bool = True,
    ) -> StripeSubscription:
        """
        Cancel a subscription.
        
        Args:
            subscription_id: Stripe subscription ID
            at_period_end: If True, cancel at end of billing period
            
        Returns:
            Updated subscription
        """
        if at_period_end:
            sub = stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=True,
            )
        else:
            sub = stripe.Subscription.delete(subscription_id)
        
        return await self.get_subscription(subscription_id)
    
    def verify_webhook_signature(
        self,
        payload: bytes,
        signature: str,
    ) -> stripe.Event:
        """
        Verify webhook signature and parse event.
        
        Args:
            payload: Raw request body
            signature: Stripe-Signature header value
            
        Returns:
            Parsed Stripe event
            
        Raises:
            StripeWebhookError: If signature verification fails
        """
        try:
            event = stripe.Webhook.construct_event(
                payload,
                signature,
                self.config.webhook_secret,
            )
            return event
        except stripe.error.SignatureVerificationError as e:
            raise StripeWebhookError(f"Invalid signature: {e}")
        except ValueError as e:
            raise StripeWebhookError(f"Invalid payload: {e}")
```

### Subscription Service

```python
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class SubscriptionStatus(str, Enum):
    """Subscription status values."""
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    TRIALING = "trialing"
    UNPAID = "unpaid"


@dataclass
class Subscription:
    """Internal subscription record."""
    id: str
    user_id: str
    stripe_subscription_id: str
    stripe_customer_id: str
    tier: str
    status: SubscriptionStatus
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool
    created_at: datetime
    updated_at: datetime


class SubscriptionService:
    """
    Manages subscription lifecycle and database records.
    
    Responsibilities:
    - Activate new subscriptions
    - Update subscription status
    - Deactivate canceled subscriptions
    - Maintain audit trail
    """
    
    def __init__(self, db, stripe_config: StripeConfig):
        self.db = db
        self.stripe_config = stripe_config
        self.table = "subscriptions"
        self.audit_table = "subscription_audit"
    
    async def activate_subscription(
        self,
        user_id: str,
        stripe_subscription_id: str,
        stripe_customer_id: str,
        price_id: str,
        current_period_start: datetime,
        current_period_end: datetime,
        stripe_event_id: str,
    ) -> Subscription:
        """
        Activate a new subscription after successful checkout.
        
        This is called from the checkout.session.completed webhook.
        """
        tier = self.stripe_config.get_tier_for_price(price_id)
        now = datetime.now(timezone.utc)
        
        # Check for existing subscription
        existing = await self._get_by_user(user_id)
        
        if existing:
            # Update existing subscription
            subscription = await self._update(
                subscription_id=existing.id,
                stripe_subscription_id=stripe_subscription_id,
                stripe_customer_id=stripe_customer_id,
                tier=tier,
                status=SubscriptionStatus.ACTIVE,
                current_period_start=current_period_start,
                current_period_end=current_period_end,
                cancel_at_period_end=False,
            )
            action = "upgraded"
        else:
            # Create new subscription
            subscription = await self._create(
                user_id=user_id,
                stripe_subscription_id=stripe_subscription_id,
                stripe_customer_id=stripe_customer_id,
                tier=tier,
                status=SubscriptionStatus.ACTIVE,
                current_period_start=current_period_start,
                current_period_end=current_period_end,
            )
            action = "created"
        
        # Update user's subscription tier
        await self._update_user_tier(user_id, tier, SubscriptionStatus.ACTIVE)
        
        # Audit log
        await self._audit_log(
            subscription_id=subscription.id,
            user_id=user_id,
            action=action,
            stripe_event_id=stripe_event_id,
            details={
                "tier": tier,
                "price_id": price_id,
                "period_end": current_period_end.isoformat(),
            },
        )
        
        logger.info(
            f"Subscription {action}: user_id={user_id}, "
            f"tier={tier}, stripe_sub={stripe_subscription_id}"
        )
        
        return subscription
    
    async def update_subscription_status(
        self,
        stripe_subscription_id: str,
        status: str,
        cancel_at_period_end: bool,
        stripe_event_id: str,
        price_id: Optional[str] = None,
        current_period_end: Optional[datetime] = None,
    ) -> Optional[Subscription]:
        """
        Update subscription status from webhook event.
        
        Handles:
        - Status changes (active, past_due, canceled)
        - Plan changes (tier upgrades/downgrades)
        - Cancellation scheduling
        """
        subscription = await self._get_by_stripe_id(stripe_subscription_id)
        if not subscription:
            logger.warning(f"Subscription not found: {stripe_subscription_id}")
            return None
        
        # Determine new tier if price changed
        new_tier = subscription.tier
        if price_id:
            new_tier = self.stripe_config.get_tier_for_price(price_id)
        
        # Update subscription
        updated = await self._update(
            subscription_id=subscription.id,
            status=SubscriptionStatus(status),
            tier=new_tier,
            cancel_at_period_end=cancel_at_period_end,
            current_period_end=current_period_end or subscription.current_period_end,
        )
        
        # Update user tier based on status
        if status == "active":
            await self._update_user_tier(
                subscription.user_id, 
                new_tier, 
                SubscriptionStatus.ACTIVE,
            )
        elif status in ["canceled", "unpaid"]:
            await self._update_user_tier(
                subscription.user_id,
                "free",
                SubscriptionStatus(status),
            )
        
        # Audit log
        await self._audit_log(
            subscription_id=subscription.id,
            user_id=subscription.user_id,
            action="status_updated",
            stripe_event_id=stripe_event_id,
            details={
                "old_status": subscription.status.value,
                "new_status": status,
                "cancel_at_period_end": cancel_at_period_end,
                "tier": new_tier,
            },
        )
        
        return updated
    
    async def deactivate_subscription(
        self,
        stripe_subscription_id: str,
        stripe_event_id: str,
    ) -> Optional[Subscription]:
        """
        Deactivate a canceled subscription.
        
        Called from customer.subscription.deleted webhook.
        """
        subscription = await self._get_by_stripe_id(stripe_subscription_id)
        if not subscription:
            return None
        
        # Update to canceled status
        updated = await self._update(
            subscription_id=subscription.id,
            status=SubscriptionStatus.CANCELED,
        )
        
        # Downgrade user to free tier
        await self._update_user_tier(
            subscription.user_id,
            "free",
            SubscriptionStatus.CANCELED,
        )
        
        # Audit log
        await self._audit_log(
            subscription_id=subscription.id,
            user_id=subscription.user_id,
            action="deactivated",
            stripe_event_id=stripe_event_id,
            details={"previous_tier": subscription.tier},
        )
        
        logger.info(
            f"Subscription deactivated: user_id={subscription.user_id}, "
            f"stripe_sub={stripe_subscription_id}"
        )
        
        return updated
    
    async def get_user_subscription(self, user_id: str) -> Optional[Subscription]:
        """Get active subscription for a user."""
        return await self._get_by_user(user_id)
    
    async def _update_user_tier(
        self,
        user_id: str,
        tier: str,
        status: SubscriptionStatus,
    ) -> None:
        """Update user's subscription tier and status."""
        self.db.table("users").update({
            "subscription_tier": tier,
            "subscription_status": status.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", user_id).execute()
    
    async def _audit_log(
        self,
        subscription_id: str,
        user_id: str,
        action: str,
        stripe_event_id: str,
        details: dict,
    ) -> None:
        """Create audit log entry for subscription change."""
        self.db.table(self.audit_table).insert({
            "subscription_id": subscription_id,
            "user_id": user_id,
            "action": action,
            "stripe_event_id": stripe_event_id,
            "details": details,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
```

### Webhook Handler with Idempotency

```python
from fastapi import APIRouter, Request, HTTPException, Header
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/webhooks/stripe")
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="Stripe-Signature"),
    stripe_service: StripeService = Depends(get_stripe_service),
    subscription_service: SubscriptionService = Depends(get_subscription_service),
    webhook_queue: WebhookQueue = Depends(get_webhook_queue),
):
    """
    Handle incoming Stripe webhook events.
    
    Security Flow:
    1. Verify webhook signature (prevents tampering)
    2. Validate event age (prevents replay attacks)
    3. Check idempotency (prevents duplicate processing)
    4. Acquire processing lock (prevents race conditions)
    5. Process event
    6. Mark as processed
    """
    payload = await request.body()
    
    # 1. Verify signature
    try:
        event = stripe_service.verify_webhook_signature(payload, stripe_signature)
    except StripeWebhookError as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=400, detail="INVALID_SIGNATURE")
    
    event_id = event.id
    event_type = event.type
    event_created = event.created
    
    logger.info(f"Received Stripe webhook: {event_type} (ID: {event_id})")
    
    # 2-3. Validate age and check idempotency
    try:
        await webhook_queue.persist_event(
            event_id=event_id,
            event_type=event_type,
            event_created=event_created,
        )
    except WebhookEventTooOldError as e:
        logger.warning(f"Rejecting old event (replay attack?): {event_id}")
        return {"status": "rejected", "reason": "event_too_old"}
    except WebhookEventDuplicateError:
        logger.info(f"Duplicate event, skipping: {event_id}")
        return {"status": "already_received"}
    
    # 4. Acquire processing lock
    if not await webhook_queue.acquire_processing_lock(event_id):
        return {"status": "processing"}
    
    try:
        # 5. Route to handler
        if event_type == "checkout.session.completed":
            await handle_checkout_completed(event, stripe_service, subscription_service)
        
        elif event_type == "customer.subscription.updated":
            await handle_subscription_updated(event, subscription_service)
        
        elif event_type == "customer.subscription.deleted":
            await handle_subscription_deleted(event, subscription_service)
        
        elif event_type == "invoice.payment_failed":
            await handle_payment_failed(event, subscription_service)
        
        else:
            logger.info(f"Unhandled event type: {event_type}")
        
        # 6. Mark as processed
        await webhook_queue.mark_event_processed(event_id, success=True)
        
        return {"status": "processed"}
    
    except Exception as e:
        logger.error(f"Error processing webhook {event_id}: {e}", exc_info=True)
        await webhook_queue.mark_event_processed(event_id, success=False, error=str(e))
        return {"status": "error"}
    
    finally:
        await webhook_queue.release_processing_lock(event_id)


async def handle_checkout_completed(event, stripe_service, subscription_service):
    """Handle successful checkout - activate subscription."""
    session = event.data.object
    user_id = session.metadata.get("user_id")
    subscription_id = session.subscription
    customer_id = session.customer
    
    if not user_id or not subscription_id:
        logger.error(f"Missing metadata in checkout session: {session.id}")
        return
    
    # Get subscription details
    stripe_sub = await stripe_service.get_subscription(subscription_id)
    
    # Activate subscription
    await subscription_service.activate_subscription(
        user_id=user_id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=customer_id,
        price_id=stripe_sub.price_id,
        current_period_start=datetime.fromtimestamp(
            stripe_sub.current_period_start, tz=timezone.utc
        ),
        current_period_end=datetime.fromtimestamp(
            stripe_sub.current_period_end, tz=timezone.utc
        ),
        stripe_event_id=event.id,
    )


async def handle_subscription_updated(event, subscription_service):
    """Handle subscription updates (status, plan changes)."""
    subscription = event.data.object
    
    price_id = None
    if subscription.items and subscription.items.data:
        price_id = subscription.items.data[0].price.id
    
    await subscription_service.update_subscription_status(
        stripe_subscription_id=subscription.id,
        status=subscription.status,
        cancel_at_period_end=subscription.cancel_at_period_end,
        stripe_event_id=event.id,
        price_id=price_id,
        current_period_end=datetime.fromtimestamp(
            subscription.current_period_end, tz=timezone.utc
        ),
    )


async def handle_subscription_deleted(event, subscription_service):
    """Handle subscription cancellation."""
    subscription = event.data.object
    
    await subscription_service.deactivate_subscription(
        stripe_subscription_id=subscription.id,
        stripe_event_id=event.id,
    )


async def handle_payment_failed(event, subscription_service):
    """Handle failed payment - mark as past_due."""
    invoice = event.data.object
    
    if invoice.subscription:
        await subscription_service.update_subscription_status(
            stripe_subscription_id=invoice.subscription,
            status="past_due",
            cancel_at_period_end=False,
            stripe_event_id=event.id,
        )
```

### Webhook Queue for Idempotency

```python
import time
from typing import Optional
import redis.asyncio as redis


class WebhookEventTooOldError(Exception):
    """Event is too old (potential replay attack)."""
    def __init__(self, age_seconds: float):
        self.age_seconds = age_seconds


class WebhookEventDuplicateError(Exception):
    """Event has already been received."""
    pass


class WebhookQueue:
    """
    Manages webhook event idempotency and processing locks.
    
    Features:
    - Event age validation (reject events >5 min old)
    - Idempotent event persistence
    - Processing locks to prevent concurrent handling
    """
    
    MAX_EVENT_AGE = 300  # 5 minutes
    EVENT_TTL = 86400  # 24 hours
    LOCK_TTL = 300  # 5 minutes
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
    
    async def persist_event(
        self,
        event_id: str,
        event_type: str,
        event_created: int,
    ) -> None:
        """
        Persist event for idempotency checking.
        
        Raises:
            WebhookEventTooOldError: If event is too old
            WebhookEventDuplicateError: If event already exists
        """
        # Check event age
        age = time.time() - event_created
        if age > self.MAX_EVENT_AGE:
            raise WebhookEventTooOldError(age)
        
        # Try to set event (NX = only if not exists)
        key = f"webhook:event:{event_id}"
        result = await self.redis.set(
            key,
            f"{event_type}:{event_created}",
            ex=self.EVENT_TTL,
            nx=True,
        )
        
        if not result:
            raise WebhookEventDuplicateError()
    
    async def acquire_processing_lock(self, event_id: str) -> bool:
        """Acquire lock for processing an event."""
        key = f"webhook:lock:{event_id}"
        return await self.redis.set(key, "1", ex=self.LOCK_TTL, nx=True)
    
    async def release_processing_lock(self, event_id: str) -> None:
        """Release processing lock."""
        key = f"webhook:lock:{event_id}"
        await self.redis.delete(key)
    
    async def mark_event_processed(
        self,
        event_id: str,
        success: bool,
        error: Optional[str] = None,
    ) -> None:
        """Mark event as processed with result."""
        key = f"webhook:event:{event_id}"
        status = "success" if success else f"failed:{error}"
        await self.redis.set(key, status, ex=self.EVENT_TTL)
```

## API Routes

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/subscriptions")


class CheckoutRequest(BaseModel):
    plan: str  # "pro" or "studio"
    success_url: str
    cancel_url: str


class CheckoutResponse(BaseModel):
    checkout_url: str


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    data: CheckoutRequest,
    current_user: User = Depends(get_current_user),
    stripe_service: StripeService = Depends(get_stripe_service),
):
    """Create Stripe checkout session for subscription."""
    checkout_url = await stripe_service.create_checkout_session(
        user_id=current_user.id,
        user_email=current_user.email,
        tier=data.plan,
        success_url=data.success_url,
        cancel_url=data.cancel_url,
    )
    return CheckoutResponse(checkout_url=checkout_url)


@router.post("/portal")
async def create_portal(
    current_user: User = Depends(get_current_user),
    stripe_service: StripeService = Depends(get_stripe_service),
    subscription_service: SubscriptionService = Depends(get_subscription_service),
):
    """Create Stripe customer portal session."""
    subscription = await subscription_service.get_user_subscription(current_user.id)
    if not subscription:
        raise HTTPException(status_code=404, detail="No subscription found")
    
    portal_url = await stripe_service.create_portal_session(
        customer_id=subscription.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/settings/billing",
    )
    return {"portal_url": portal_url}


@router.get("/status")
async def get_status(
    current_user: User = Depends(get_current_user),
    subscription_service: SubscriptionService = Depends(get_subscription_service),
):
    """Get current subscription status."""
    subscription = await subscription_service.get_user_subscription(current_user.id)
    
    return {
        "tier": subscription.tier if subscription else "free",
        "status": subscription.status.value if subscription else "none",
        "current_period_end": subscription.current_period_end if subscription else None,
        "cancel_at_period_end": subscription.cancel_at_period_end if subscription else False,
    }
```

## Best Practices

1. **Always verify webhook signatures** - Never trust unverified webhooks
2. **Use idempotency** - Webhooks can be delivered multiple times
3. **Store Stripe event IDs** - For audit trail and debugging
4. **Handle all subscription states** - active, past_due, canceled, etc.
5. **Use metadata** - Store user_id in checkout session metadata
6. **Implement retry logic** - Return 200 even on errors to prevent Stripe retries
7. **Log everything** - Comprehensive logging for debugging billing issues
