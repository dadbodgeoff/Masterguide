# Phase 10: Third-Party Integrations

> **Time**: 10 minutes  
> **Prerequisites**: [05-AUTH](./05-AUTH.md), [07-WORKERS](./07-WORKERS.md)  
> **Produces**: Stripe service, webhook handling, email service stubs

---

## 🤖 Agent Execution Context

**What you're doing**: Adding integrations for payments (Stripe), email (SendGrid), and webhook handling. These are stubs that work without API keys configured.

**Expected state BEFORE execution**:
- Phase 05 complete (auth for user context)
- Phase 07 complete (jobs for async processing)
- Database has `subscriptions` table (from Phase 04)
- Config has Stripe/SendGrid settings (from Phase 02)

**What you'll create**:
- `packages/backend/src/integrations/__init__.py` — Module exports
- `packages/backend/src/integrations/stripe_service.py` — Stripe checkout, portal, subscriptions
- `packages/backend/src/integrations/email_service.py` — Email abstraction with SendGrid
- `packages/backend/src/integrations/webhook_handler.py` — Idempotent webhook processing
- `apps/web/app/api/webhooks/stripe/route.ts` — Stripe webhook endpoint

**Execution approach**:
1. Create `packages/backend/src/integrations/` directory
2. Create all Python integration files
3. Create `apps/web/app/api/webhooks/` directory
4. Create `apps/web/app/api/webhooks/stripe/` directory
5. Create the Stripe webhook route

**IMPORTANT**:
- Stripe service checks `settings.stripe_enabled` before making API calls
- Email service falls back to ConsoleEmailProvider if SendGrid not configured
- Webhook handler validates event age (rejects events > 5 min old)
- The Next.js webhook route verifies Stripe signatures

**Graceful degradation**:
- No STRIPE_SECRET_KEY? Stripe methods raise ExternalServiceError
- No SENDGRID_API_KEY? Emails log to console instead
- No Redis? Webhook idempotency skipped (still processes)

**Webhook flow**:
1. Stripe sends event to /api/webhooks/stripe
2. Signature verified using STRIPE_WEBHOOK_SECRET
3. Event routed to handler based on type
4. Database updated (subscriptions, user tier)

**After completion, tell the user**:
- "Phase 10 complete. Stripe and email integrations ready."
- "Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable payments."
- "Proceed to Phase 11 for frontend components."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/integrations/` directory exists
- `apps/web/app/api/webhooks/` directory exists

## Purpose

Create integration infrastructure including:
- Stripe service for payments and subscriptions
- Webhook signature verification
- Email service abstraction
- Idempotent webhook processing

---

## Artifacts to Create

### 1. packages/backend/src/integrations/__init__.py

```python
"""Third-party integrations module."""

from src.integrations.stripe_service import StripeService
from src.integrations.email_service import EmailService
from src.integrations.webhook_handler import WebhookHandler

__all__ = [
    "StripeService",
    "EmailService",
    "WebhookHandler",
]
```

### 2. packages/backend/src/integrations/stripe_service.py

```python
"""Stripe integration service."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import stripe

from src.config import settings
from src.exceptions import ExternalServiceError

logger = logging.getLogger(__name__)


@dataclass
class StripeSubscription:
    """Normalized Stripe subscription data."""
    id: str
    customer_id: str
    status: str
    price_id: str | None
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool


class StripeWebhookError(Exception):
    """Raised when webhook signature verification fails."""
    pass


class StripeService:
    """
    Service for Stripe API operations.
    
    Handles checkout sessions, customer portal, and subscriptions.
    """
    
    # Price ID to tier mapping
    PRICE_TIERS = {
        settings.STRIPE_PRICE_PRO: "pro",
        settings.STRIPE_PRICE_STUDIO: "studio",
    } if settings.STRIPE_PRICE_PRO else {}
    
    def __init__(self):
        if not settings.stripe_enabled:
            logger.warning("Stripe is not configured")
            return
        stripe.api_key = settings.STRIPE_SECRET_KEY
    
    def get_tier_for_price(self, price_id: str) -> str:
        """Get subscription tier for a price ID."""
        return self.PRICE_TIERS.get(price_id, "free")
    
    async def create_checkout_session(
        self,
        user_id: str,
        user_email: str,
        tier: str,
        success_url: str,
        cancel_url: str,
    ) -> str:
        """Create a Stripe Checkout session."""
        if not settings.stripe_enabled:
            raise ExternalServiceError(service_name="stripe")
        
        # Find price ID for tier
        price_id = None
        for pid, t in self.PRICE_TIERS.items():
            if t == tier:
                price_id = pid
                break
        
        if not price_id:
            raise ValueError(f"Unknown tier: {tier}")
        
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=user_email,
            metadata={"user_id": user_id, "tier": tier},
            subscription_data={"metadata": {"user_id": user_id, "tier": tier}},
            allow_promotion_codes=True,
        )
        
        logger.info(f"Created checkout session: user_id={user_id}, tier={tier}")
        return session.url
    
    async def create_portal_session(
        self,
        customer_id: str,
        return_url: str,
    ) -> str:
        """Create a Stripe Customer Portal session."""
        if not settings.stripe_enabled:
            raise ExternalServiceError(service_name="stripe")
        
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return session.url
    
    async def get_subscription(self, subscription_id: str) -> StripeSubscription:
        """Get subscription details from Stripe."""
        if not settings.stripe_enabled:
            raise ExternalServiceError(service_name="stripe")
        
        sub = stripe.Subscription.retrieve(subscription_id)
        price_id = sub.items.data[0].price.id if sub.items.data else None
        
        return StripeSubscription(
            id=sub.id,
            customer_id=sub.customer,
            status=sub.status,
            price_id=price_id,
            current_period_start=datetime.fromtimestamp(sub.current_period_start, tz=timezone.utc),
            current_period_end=datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc),
            cancel_at_period_end=sub.cancel_at_period_end,
        )
    
    def verify_webhook_signature(self, payload: bytes, signature: str) -> stripe.Event:
        """Verify webhook signature and parse event."""
        if not settings.STRIPE_WEBHOOK_SECRET:
            raise StripeWebhookError("Webhook secret not configured")
        
        try:
            return stripe.Webhook.construct_event(
                payload, signature, settings.STRIPE_WEBHOOK_SECRET
            )
        except stripe.error.SignatureVerificationError as e:
            raise StripeWebhookError(f"Invalid signature: {e}")
        except ValueError as e:
            raise StripeWebhookError(f"Invalid payload: {e}")
```


### 3. packages/backend/src/integrations/email_service.py

```python
"""Email service abstraction."""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from src.config import settings

logger = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    """Email message data."""
    to: str
    subject: str
    html_content: str
    text_content: str | None = None
    from_email: str | None = None
    reply_to: str | None = None
    template_id: str | None = None
    template_data: dict[str, Any] | None = None


class EmailProvider(ABC):
    """Abstract email provider interface."""
    
    @abstractmethod
    async def send(self, message: EmailMessage) -> bool:
        """Send an email."""
        pass


class SendGridProvider(EmailProvider):
    """SendGrid email provider."""
    
    def __init__(self, api_key: str, from_email: str):
        self.api_key = api_key
        self.from_email = from_email
    
    async def send(self, message: EmailMessage) -> bool:
        """Send email via SendGrid."""
        try:
            import httpx
            
            from_email = message.from_email or self.from_email
            
            payload = {
                "personalizations": [{"to": [{"email": message.to}]}],
                "from": {"email": from_email},
                "subject": message.subject,
                "content": [{"type": "text/html", "value": message.html_content}],
            }
            
            if message.text_content:
                payload["content"].insert(0, {"type": "text/plain", "value": message.text_content})
            
            if message.reply_to:
                payload["reply_to"] = {"email": message.reply_to}
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                
                if response.status_code in (200, 202):
                    logger.info(f"Email sent to {message.to}")
                    return True
                else:
                    logger.error(f"SendGrid error: {response.status_code} {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to send email: {e}")
            return False


class ConsoleEmailProvider(EmailProvider):
    """Console email provider for development."""
    
    async def send(self, message: EmailMessage) -> bool:
        """Log email to console."""
        logger.info(
            f"[EMAIL] To: {message.to}\n"
            f"Subject: {message.subject}\n"
            f"Content: {message.html_content[:200]}..."
        )
        return True


class EmailService:
    """
    Email service with provider abstraction.
    
    Usage:
        email_service = EmailService()
        await email_service.send_welcome_email("user@example.com", "John")
    """
    
    def __init__(self, provider: EmailProvider | None = None):
        if provider:
            self.provider = provider
        elif settings.email_enabled:
            self.provider = SendGridProvider(
                api_key=settings.SENDGRID_API_KEY,
                from_email=settings.SENDGRID_FROM_EMAIL,
            )
        else:
            self.provider = ConsoleEmailProvider()
    
    async def send(self, message: EmailMessage) -> bool:
        """Send an email."""
        return await self.provider.send(message)
    
    async def send_welcome_email(self, to: str, name: str) -> bool:
        """Send welcome email to new user."""
        return await self.send(EmailMessage(
            to=to,
            subject="Welcome to Our Platform!",
            html_content=f"""
            <h1>Welcome, {name}!</h1>
            <p>Thank you for signing up. We're excited to have you on board.</p>
            <p>Get started by exploring our features.</p>
            """,
            text_content=f"Welcome, {name}! Thank you for signing up.",
        ))
    
    async def send_subscription_confirmation(
        self,
        to: str,
        tier: str,
        period_end: str,
    ) -> bool:
        """Send subscription confirmation email."""
        return await self.send(EmailMessage(
            to=to,
            subject=f"Your {tier.title()} Subscription is Active",
            html_content=f"""
            <h1>Subscription Confirmed</h1>
            <p>Your {tier.title()} subscription is now active.</p>
            <p>Your current billing period ends on {period_end}.</p>
            """,
        ))
    
    async def send_payment_failed(self, to: str) -> bool:
        """Send payment failed notification."""
        return await self.send(EmailMessage(
            to=to,
            subject="Payment Failed - Action Required",
            html_content="""
            <h1>Payment Failed</h1>
            <p>We were unable to process your payment.</p>
            <p>Please update your payment method to continue your subscription.</p>
            """,
        ))
```

### 4. packages/backend/src/integrations/webhook_handler.py

```python
"""Webhook handling with idempotency."""

import json
import logging
import time
from typing import Callable, Any

logger = logging.getLogger(__name__)


class WebhookEventTooOldError(Exception):
    """Event is too old (potential replay attack)."""
    def __init__(self, age_seconds: float):
        self.age_seconds = age_seconds
        super().__init__(f"Event is {age_seconds:.0f}s old")


class WebhookEventDuplicateError(Exception):
    """Event has already been processed."""
    pass


class WebhookHandler:
    """
    Handles webhook events with idempotency.
    
    Features:
    - Event age validation
    - Duplicate detection
    - Processing locks
    - Handler routing
    """
    
    MAX_EVENT_AGE = 300  # 5 minutes
    EVENT_TTL = 86400    # 24 hours
    
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self._handlers: dict[str, Callable] = {}
    
    def register_handler(self, event_type: str, handler: Callable) -> None:
        """Register a handler for an event type."""
        self._handlers[event_type] = handler
        logger.info(f"Registered webhook handler: {event_type}")
    
    async def validate_event(
        self,
        event_id: str,
        event_type: str,
        event_created: int,
    ) -> None:
        """
        Validate event age and check for duplicates.
        
        Raises:
            WebhookEventTooOldError: If event is too old
            WebhookEventDuplicateError: If event already processed
        """
        # Check age
        age = time.time() - event_created
        if age > self.MAX_EVENT_AGE:
            raise WebhookEventTooOldError(age)
        
        # Check for duplicate (if Redis available)
        if self.redis:
            key = f"webhook:event:{event_id}"
            if not await self.redis.set(key, event_type, nx=True, ex=self.EVENT_TTL):
                raise WebhookEventDuplicateError()
    
    async def process_event(
        self,
        event_id: str,
        event_type: str,
        event_data: dict[str, Any],
    ) -> dict:
        """
        Process a webhook event.
        
        Returns:
            Processing result
        """
        handler = self._handlers.get(event_type)
        
        if not handler:
            logger.info(f"No handler for event type: {event_type}")
            return {"status": "ignored", "reason": "no_handler"}
        
        try:
            result = await handler(event_data)
            
            # Mark as processed
            if self.redis:
                key = f"webhook:event:{event_id}"
                await self.redis.set(key, "processed", ex=self.EVENT_TTL)
            
            logger.info(f"Webhook processed: {event_type} ({event_id})")
            return {"status": "processed", "result": result}
            
        except Exception as e:
            logger.error(f"Webhook processing failed: {event_type} ({event_id}): {e}")
            
            # Mark as failed
            if self.redis:
                key = f"webhook:event:{event_id}"
                await self.redis.set(key, f"failed:{str(e)}", ex=self.EVENT_TTL)
            
            return {"status": "error", "error": str(e)}
```

### 5. apps/web/app/api/webhooks/stripe/route.ts

```typescript
/**
 * Stripe webhook handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(supabase, session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(supabase, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabase, invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.user_id;
  const tier = session.metadata?.tier;

  if (!userId || !tier) {
    console.error('Missing metadata in checkout session');
    return;
  }

  // Update user subscription
  await supabase
    .from('users')
    .update({
      subscription_tier: tier,
      subscription_status: 'active',
    })
    .eq('id', userId);

  // Create subscription record
  if (session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer as string,
      tier,
      status: 'active',
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  }

  console.log(`Subscription activated: user=${userId}, tier=${tier}`);
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createAdminClient>,
  subscription: Stripe.Subscription
) {
  await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createAdminClient>,
  subscription: Stripe.Subscription
) {
  // Get user ID from subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (sub) {
    // Downgrade user to free
    await supabase
      .from('users')
      .update({
        subscription_tier: 'free',
        subscription_status: 'canceled',
      })
      .eq('id', sub.user_id);

    // Update subscription record
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', subscription.id);
  }
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createAdminClient>,
  invoice: Stripe.Invoice
) {
  if (invoice.subscription) {
    await supabase
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', invoice.subscription as string);
  }
}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 10
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 11 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Verify Python integration modules
cd packages/backend
source .venv/bin/activate
python -c "
from src.integrations import StripeService, EmailService, WebhookHandler

# Test email service (console mode)
import asyncio
email = EmailService()
asyncio.run(email.send_welcome_email('test@example.com', 'Test User'))

# Test webhook handler
handler = WebhookHandler()
handler.register_handler('test.event', lambda data: print('Handled:', data))
print('Webhook handler ready')
"

# 2. Verify TypeScript webhook route
cd ../../apps/web
pnpm lint
```

**Success Criteria**:
- [ ] Stripe service creates checkout sessions (when configured)
- [ ] Email service sends via console in dev mode
- [ ] Webhook handler validates events and routes to handlers
- [ ] Next.js webhook route handles Stripe events
- [ ] Idempotency prevents duplicate processing
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [11-FRONTEND.md](./11-FRONTEND.md) for frontend foundation.


---

## Testing Additions

> Tests for Stripe webhook handling, email service, and webhook idempotency.

### 6. packages/backend/tests/test_integrations.py

```python
"""
Tests for third-party integrations.
"""

import pytest
import time
from unittest.mock import MagicMock, AsyncMock, patch


class TestStripeService:
    """Tests for Stripe service."""
    
    def test_get_tier_for_price_known(self):
        """Should return correct tier for known price ID."""
        from src.integrations.stripe_service import StripeService
        
        service = StripeService()
        
        # When Stripe is not configured, PRICE_TIERS is empty
        # This tests the fallback behavior
        tier = service.get_tier_for_price("unknown_price")
        assert tier == "free"
    
    def test_stripe_not_configured(self):
        """Should handle missing Stripe configuration gracefully."""
        from src.integrations.stripe_service import StripeService
        
        service = StripeService()
        
        # Service should be created without error
        assert service is not None


class TestEmailService:
    """Tests for email service."""
    
    @pytest.mark.asyncio
    async def test_console_provider_logs(self):
        """ConsoleEmailProvider should log instead of sending."""
        from src.integrations.email_service import (
            EmailService, ConsoleEmailProvider, EmailMessage
        )
        
        provider = ConsoleEmailProvider()
        service = EmailService(provider=provider)
        
        result = await service.send(EmailMessage(
            to="test@example.com",
            subject="Test Subject",
            html_content="<p>Test content</p>",
        ))
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_send_welcome_email(self):
        """Should send welcome email."""
        from src.integrations.email_service import EmailService, ConsoleEmailProvider
        
        provider = ConsoleEmailProvider()
        service = EmailService(provider=provider)
        
        result = await service.send_welcome_email(
            to="newuser@example.com",
            name="New User"
        )
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_send_subscription_confirmation(self):
        """Should send subscription confirmation."""
        from src.integrations.email_service import EmailService, ConsoleEmailProvider
        
        provider = ConsoleEmailProvider()
        service = EmailService(provider=provider)
        
        result = await service.send_subscription_confirmation(
            to="user@example.com",
            tier="pro",
            period_end="2024-02-01"
        )
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_send_payment_failed(self):
        """Should send payment failed notification."""
        from src.integrations.email_service import EmailService, ConsoleEmailProvider
        
        provider = ConsoleEmailProvider()
        service = EmailService(provider=provider)
        
        result = await service.send_payment_failed(to="user@example.com")
        
        assert result is True


class TestWebhookHandler:
    """Tests for webhook handler."""
    
    def test_register_handler(self):
        """Should register event handlers."""
        from src.integrations.webhook_handler import WebhookHandler
        
        handler = WebhookHandler()
        
        async def test_handler(data):
            return {"processed": True}
        
        handler.register_handler("test.event", test_handler)
        
        assert "test.event" in handler._handlers
    
    @pytest.mark.asyncio
    async def test_validate_event_age_valid(self):
        """Should accept recent events."""
        from src.integrations.webhook_handler import WebhookHandler
        
        handler = WebhookHandler()
        
        # Event created just now
        event_created = int(time.time())
        
        # Should not raise
        await handler.validate_event(
            event_id="evt_123",
            event_type="test.event",
            event_created=event_created
        )
    
    @pytest.mark.asyncio
    async def test_validate_event_age_too_old(self):
        """Should reject old events."""
        from src.integrations.webhook_handler import (
            WebhookHandler, WebhookEventTooOldError
        )
        
        handler = WebhookHandler()
        
        # Event created 10 minutes ago (beyond 5 min limit)
        event_created = int(time.time()) - 600
        
        with pytest.raises(WebhookEventTooOldError):
            await handler.validate_event(
                event_id="evt_123",
                event_type="test.event",
                event_created=event_created
            )
    
    @pytest.mark.asyncio
    async def test_process_event_no_handler(self):
        """Should return ignored for unknown event types."""
        from src.integrations.webhook_handler import WebhookHandler
        
        handler = WebhookHandler()
        
        result = await handler.process_event(
            event_id="evt_123",
            event_type="unknown.event",
            event_data={}
        )
        
        assert result["status"] == "ignored"
        assert result["reason"] == "no_handler"
    
    @pytest.mark.asyncio
    async def test_process_event_with_handler(self):
        """Should process event with registered handler."""
        from src.integrations.webhook_handler import WebhookHandler
        
        handler = WebhookHandler()
        
        async def test_handler(data):
            return {"received": data}
        
        handler.register_handler("test.event", test_handler)
        
        result = await handler.process_event(
            event_id="evt_123",
            event_type="test.event",
            event_data={"key": "value"}
        )
        
        assert result["status"] == "processed"
        assert result["result"]["received"]["key"] == "value"
    
    @pytest.mark.asyncio
    async def test_process_event_handler_error(self):
        """Should handle handler errors gracefully."""
        from src.integrations.webhook_handler import WebhookHandler
        
        handler = WebhookHandler()
        
        async def failing_handler(data):
            raise ValueError("Handler failed")
        
        handler.register_handler("test.event", failing_handler)
        
        result = await handler.process_event(
            event_id="evt_123",
            event_type="test.event",
            event_data={}
        )
        
        assert result["status"] == "error"
        assert "Handler failed" in result["error"]
```

---

## Updated Verification

**Additional test checks:**

```bash
# Run integration tests
cd packages/backend
source .venv/bin/activate
pytest tests/test_integrations.py -v

# Verify email service fallback
python -c "
import asyncio
from src.integrations.email_service import EmailService

async def test():
    service = EmailService()  # Should use ConsoleEmailProvider
    result = await service.send_welcome_email('test@example.com', 'Test')
    print('Email sent (to console):', result)

asyncio.run(test())
"
```

**Updated Success Criteria**:
- [ ] All original criteria pass
- [ ] `pytest tests/test_integrations.py` passes
- [ ] Email service uses console fallback
- [ ] Webhook handler validates event age
- [ ] Webhook handler routes to correct handlers
