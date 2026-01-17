# Swap Guide: Stripe → Paddle/LemonSqueezy

> Replace Stripe with Paddle or LemonSqueezy for payments

## Why Swap?

| Stripe | Paddle/LemonSqueezy |
|--------|---------------------|
| You handle tax compliance | They handle global tax (MoR) |
| You're the merchant | They're the Merchant of Record |
| More control | Less complexity |
| Lower fees (2.9%) | Higher fees (~5%) but includes tax |
| Must handle VAT/GST | VAT/GST handled for you |

**Best for:** Solo founders, small teams who don't want to deal with tax compliance.

## Affected Files

### Must Replace

```
packages/backend/src/integrations/
├── stripe_service.py         → paddle_service.py OR lemonsqueezy_service.py
└── webhook_handler.py        # Update webhook handling

Environment variables          # New API keys
```

### Must Update

```
packages/backend/src/auth/
└── entitlements.py           # Update subscription checking

apps/web/                      # Update checkout flow
├── components/pricing/       # Update pricing UI
└── lib/payments/             # Update payment client

Database:
└── users table               # stripe_customer_id → paddle_customer_id
```

### No Change Needed

```
packages/backend/src/resilience/   # Service-agnostic
packages/backend/src/jobs/         # Unchanged
packages/backend/src/cache/        # Unchanged
packages/backend/src/security/     # Unchanged
packages/types/                    # Subscription types stay same
```

---

## Current Pattern (Stripe)

### Backend Service (`packages/backend/src/integrations/stripe_service.py`)
```python
import stripe

stripe.api_key = settings.STRIPE_SECRET_KEY

async def create_checkout_session(user_id: str, price_id: str):
    return stripe.checkout.Session.create(
        customer_email=user.email,
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{settings.FRONTEND_URL}/success",
        cancel_url=f"{settings.FRONTEND_URL}/pricing",
        metadata={"user_id": user_id},
    )

async def create_portal_session(customer_id: str):
    return stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{settings.FRONTEND_URL}/settings",
    )
```

### Webhook Handler
```python
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    
    event = stripe.Webhook.construct_event(
        payload, sig, settings.STRIPE_WEBHOOK_SECRET
    )
    
    if event.type == "checkout.session.completed":
        # Handle new subscription
        pass
    elif event.type == "customer.subscription.updated":
        # Handle subscription change
        pass
```

---

## Replacement Pattern (Paddle)

### Install SDK
```bash
pip install paddle-python-sdk
```

### Paddle Service (`packages/backend/src/integrations/paddle_service.py`)
```python
from paddle_billing import Client, Environment, Options
from paddle_billing.Entities.Shared import CustomData
from paddle_billing.Resources.Prices import Operations as PriceOperations

class PaddleService:
    def __init__(self):
        self.client = Client(
            settings.PADDLE_API_KEY,
            options=Options(
                environment=Environment.SANDBOX if settings.DEBUG else Environment.PRODUCTION
            ),
        )
    
    async def get_prices(self):
        """Get all prices."""
        return self.client.prices.list()
    
    async def create_checkout_url(
        self,
        user_id: str,
        user_email: str,
        price_id: str,
    ) -> str:
        """
        Generate checkout URL.
        
        Paddle uses client-side checkout (Paddle.js), so we return
        the price_id and let frontend handle it.
        """
        return {
            "price_id": price_id,
            "customer_email": user_email,
            "custom_data": {"user_id": user_id},
            "success_url": f"{settings.FRONTEND_URL}/success",
        }
    
    async def cancel_subscription(self, subscription_id: str):
        """Cancel a subscription."""
        return self.client.subscriptions.cancel(
            subscription_id,
            effective_from="next_billing_period",
        )
    
    async def get_subscription(self, subscription_id: str):
        """Get subscription details."""
        return self.client.subscriptions.get(subscription_id)
    
    async def update_subscription(self, subscription_id: str, price_id: str):
        """Change subscription plan."""
        return self.client.subscriptions.update(
            subscription_id,
            items=[{"price_id": price_id, "quantity": 1}],
        )


paddle_service = PaddleService()
```

### Paddle Webhook Handler
```python
import hmac
import hashlib

def verify_paddle_signature(payload: bytes, signature: str) -> bool:
    """Verify Paddle webhook signature."""
    expected = hmac.new(
        settings.PADDLE_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.post("/webhooks/paddle")
async def paddle_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("Paddle-Signature")
    
    if not verify_paddle_signature(payload, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    event = json.loads(payload)
    event_type = event.get("event_type")
    
    if event_type == "subscription.created":
        data = event["data"]
        user_id = data["custom_data"]["user_id"]
        
        await db.user.update(
            where={"id": user_id},
            data={
                "paddle_subscription_id": data["id"],
                "paddle_customer_id": data["customer_id"],
                "subscription_tier": map_price_to_tier(data["items"][0]["price"]["id"]),
                "subscription_status": "active",
            },
        )
    
    elif event_type == "subscription.updated":
        data = event["data"]
        subscription_id = data["id"]
        
        user = await db.user.find_first(
            where={"paddle_subscription_id": subscription_id}
        )
        if user:
            await db.user.update(
                where={"id": user.id},
                data={
                    "subscription_tier": map_price_to_tier(data["items"][0]["price"]["id"]),
                    "subscription_status": map_paddle_status(data["status"]),
                },
            )
    
    elif event_type == "subscription.canceled":
        data = event["data"]
        subscription_id = data["id"]
        
        await db.user.update_many(
            where={"paddle_subscription_id": subscription_id},
            data={"subscription_status": "cancelled"},
        )
    
    return {"received": True}


def map_price_to_tier(price_id: str) -> str:
    """Map Paddle price ID to tier."""
    mapping = {
        settings.PADDLE_PRICE_PRO: "pro",
        settings.PADDLE_PRICE_STUDIO: "studio",
    }
    return mapping.get(price_id, "free")


def map_paddle_status(status: str) -> str:
    """Map Paddle status to our status."""
    mapping = {
        "active": "active",
        "past_due": "past_due",
        "canceled": "cancelled",
        "paused": "paused",
    }
    return mapping.get(status, "active")
```

### Frontend Checkout (`apps/web/lib/payments/paddle.ts`)
```typescript
// Paddle.js is loaded via script tag
declare global {
  interface Window {
    Paddle: any;
  }
}

export function initPaddle() {
  window.Paddle.Environment.set(
    process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
  );
  window.Paddle.Initialize({
    token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
  });
}

export function openCheckout(options: {
  priceId: string;
  email: string;
  userId: string;
  onSuccess?: () => void;
}) {
  window.Paddle.Checkout.open({
    items: [{ priceId: options.priceId, quantity: 1 }],
    customer: { email: options.email },
    customData: { user_id: options.userId },
    settings: {
      successUrl: `${window.location.origin}/success`,
    },
  });
}
```

### Frontend Script (`apps/web/app/layout.tsx`)
```typescript
import Script from 'next/script';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src="https://cdn.paddle.com/paddle/v2/paddle.js"
          onLoad={() => {
            window.Paddle.Initialize({
              token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
            });
          }}
        />
      </body>
    </html>
  );
}
```

---

## Replacement Pattern (LemonSqueezy)

### LemonSqueezy Service
```python
import httpx

class LemonSqueezyService:
    BASE_URL = "https://api.lemonsqueezy.com/v1"
    
    def __init__(self):
        self.api_key = settings.LEMONSQUEEZY_API_KEY
        self.store_id = settings.LEMONSQUEEZY_STORE_ID
    
    async def _request(self, method: str, path: str, **kwargs):
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.BASE_URL}{path}",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/vnd.api+json",
                    "Accept": "application/vnd.api+json",
                },
                **kwargs,
            )
            response.raise_for_status()
            return response.json()
    
    async def create_checkout(
        self,
        variant_id: str,
        user_id: str,
        user_email: str,
    ) -> str:
        """Create a checkout session."""
        data = {
            "data": {
                "type": "checkouts",
                "attributes": {
                    "checkout_data": {
                        "email": user_email,
                        "custom": {"user_id": user_id},
                    },
                },
                "relationships": {
                    "store": {"data": {"type": "stores", "id": self.store_id}},
                    "variant": {"data": {"type": "variants", "id": variant_id}},
                },
            }
        }
        
        result = await self._request("POST", "/checkouts", json=data)
        return result["data"]["attributes"]["url"]
    
    async def cancel_subscription(self, subscription_id: str):
        """Cancel a subscription."""
        return await self._request("DELETE", f"/subscriptions/{subscription_id}")
    
    async def get_subscription(self, subscription_id: str):
        """Get subscription details."""
        return await self._request("GET", f"/subscriptions/{subscription_id}")


lemonsqueezy_service = LemonSqueezyService()
```

### LemonSqueezy Webhook Handler
```python
@router.post("/webhooks/lemonsqueezy")
async def lemonsqueezy_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("X-Signature")
    
    # Verify signature
    expected = hmac.new(
        settings.LEMONSQUEEZY_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400)
    
    event = json.loads(payload)
    event_name = event.get("meta", {}).get("event_name")
    data = event.get("data", {}).get("attributes", {})
    
    if event_name == "subscription_created":
        user_id = event["meta"]["custom_data"]["user_id"]
        await db.user.update(
            where={"id": user_id},
            data={
                "lemonsqueezy_subscription_id": str(event["data"]["id"]),
                "lemonsqueezy_customer_id": str(data["customer_id"]),
                "subscription_tier": map_variant_to_tier(data["variant_id"]),
                "subscription_status": "active",
            },
        )
    
    elif event_name == "subscription_updated":
        subscription_id = str(event["data"]["id"])
        user = await db.user.find_first(
            where={"lemonsqueezy_subscription_id": subscription_id}
        )
        if user:
            await db.user.update(
                where={"id": user.id},
                data={
                    "subscription_status": map_ls_status(data["status"]),
                },
            )
    
    return {"received": True}
```

---

## Migration Steps

### 1. Create Account

**Paddle:**
1. Sign up at [paddle.com](https://paddle.com)
2. Complete verification (takes a few days)
3. Create products and prices
4. Get API key and webhook secret

**LemonSqueezy:**
1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com)
2. Create store
3. Create products and variants
4. Get API key and webhook secret

### 2. Update Environment Variables

```bash
# Paddle
PADDLE_API_KEY=xxx
PADDLE_WEBHOOK_SECRET=xxx
PADDLE_PRICE_PRO=pri_xxx
PADDLE_PRICE_STUDIO=pri_xxx
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=xxx

# OR LemonSqueezy
LEMONSQUEEZY_API_KEY=xxx
LEMONSQUEEZY_WEBHOOK_SECRET=xxx
LEMONSQUEEZY_STORE_ID=xxx
LEMONSQUEEZY_VARIANT_PRO=xxx
LEMONSQUEEZY_VARIANT_STUDIO=xxx
```

### 3. Update Database Schema

```sql
-- Add new columns
ALTER TABLE users ADD COLUMN paddle_customer_id TEXT;
ALTER TABLE users ADD COLUMN paddle_subscription_id TEXT;
-- OR
ALTER TABLE users ADD COLUMN lemonsqueezy_customer_id TEXT;
ALTER TABLE users ADD COLUMN lemonsqueezy_subscription_id TEXT;

-- Can keep stripe columns for migration period
```

### 4. Update Backend Files

1. Create new service file (`paddle_service.py` or `lemonsqueezy_service.py`)
2. Update webhook handler
3. Update entitlements to check new subscription fields

### 5. Update Frontend

1. Add Paddle.js or LemonSqueezy.js script
2. Update checkout flow
3. Update pricing page

### 6. Set Up Webhooks

Configure webhook URL in dashboard:
- Paddle: `https://your-api.com/webhooks/paddle`
- LemonSqueezy: `https://your-api.com/webhooks/lemonsqueezy`

### 7. Migrate Existing Subscriptions

Options:
- Let existing Stripe subscriptions run out, new users use Paddle/LS
- Manually migrate (contact Paddle/LS support)
- Run both in parallel during transition

---

## Verification Checklist

- [ ] Account created and verified
- [ ] Products/prices created
- [ ] Environment variables set
- [ ] Webhook endpoint configured
- [ ] Checkout flow works
- [ ] Subscription created on purchase
- [ ] Subscription status syncs correctly
- [ ] Cancellation works
- [ ] Entitlements check new fields
- [ ] Tests updated
