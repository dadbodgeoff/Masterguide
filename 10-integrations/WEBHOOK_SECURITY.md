# Webhook Security Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium-High  
> **Prerequisites:** Redis, Basic webhook handling

## The Problem

Webhooks from payment providers (Stripe, PayPal) are vulnerable to:
- **Replay attacks** - Attacker captures and resends valid webhooks
- **Duplicate processing** - Provider retries cause double-charges
- **Race conditions** - Multiple workers process same event

## The Solution

Redis-backed webhook security with:
1. Timestamp validation (reject events > 5 min old)
2. Atomic idempotency (SETNX before processing)
3. Distributed locking (prevent concurrent processing)
4. Audit trail (7-day event retention)

## Architecture

```
Webhook → Validate Age → Persist Event ID → Acquire Lock → Process → Release
              ↓               ↓                  ↓
         Reject if        Reject if          Skip if
         > 5 min old      duplicate          locked
```

## Core Implementation

### Constants

```typescript
const WEBHOOK_CONFIG = {
  MAX_AGE_SECONDS: 300,      // 5 minutes - reject older events
  LOCK_TTL_SECONDS: 60,      // 1 minute - processing timeout
  EVENT_TTL_DAYS: 7,         // 7 days - audit retention
  CLOCK_SKEW_TOLERANCE: 60,  // 1 minute - future event tolerance
} as const;

const REDIS_KEYS = {
  event: (id: string) => `webhook_event:${id}`,
  lock: (id: string) => `webhook_lock:${id}`,
} as const;
```

### Event Data Structure

```typescript
interface WebhookEventData {
  eventType: string;
  eventCreated: string;  // ISO timestamp
  receivedAt: string;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  processedAt?: string;
  error?: string;
}
```

### Custom Errors

```typescript
class WebhookEventTooOldError extends Error {
  constructor(public eventId: string, public ageSeconds: number) {
    super(`Event ${eventId} is ${ageSeconds}s old (max ${WEBHOOK_CONFIG.MAX_AGE_SECONDS}s)`);
    this.name = 'WebhookEventTooOldError';
  }
}

class WebhookEventDuplicateError extends Error {
  constructor(public eventId: string) {
    super(`Event ${eventId} already processed`);
    this.name = 'WebhookEventDuplicateError';
  }
}
```

### Webhook Queue Service

```typescript
import Redis from 'ioredis';

export class WebhookQueueService {
  constructor(private redis: Redis) {}

  /**
   * Step 1: Validate event timestamp (replay attack prevention)
   */
  async validateEventAge(eventId: string, eventTimestamp: Date): Promise<void> {
    const now = Date.now();
    const eventTime = eventTimestamp.getTime();
    const ageSeconds = (now - eventTime) / 1000;

    // Reject old events (replay attack)
    if (ageSeconds > WEBHOOK_CONFIG.MAX_AGE_SECONDS) {
      throw new WebhookEventTooOldError(eventId, ageSeconds);
    }

    // Reject future events beyond tolerance (clock manipulation)
    if (ageSeconds < -WEBHOOK_CONFIG.CLOCK_SKEW_TOLERANCE) {
      throw new WebhookEventTooOldError(eventId, ageSeconds);
    }
  }

  /**
   * Step 2: Persist event ID atomically (idempotency)
   */
  async persistEvent(
    eventId: string,
    eventType: string,
    eventCreated: Date
  ): Promise<void> {
    const key = REDIS_KEYS.event(eventId);
    const ttl = WEBHOOK_CONFIG.EVENT_TTL_DAYS * 86400;

    const eventData: WebhookEventData = {
      eventType,
      eventCreated: eventCreated.toISOString(),
      receivedAt: new Date().toISOString(),
      status: 'pending',
    };

    // SETNX - only succeeds if key doesn't exist
    const result = await this.redis.set(
      key,
      JSON.stringify(eventData),
      'EX', ttl,
      'NX'
    );

    if (!result) {
      throw new WebhookEventDuplicateError(eventId);
    }
  }

  /**
   * Step 3: Acquire processing lock
   */
  async acquireProcessingLock(eventId: string): Promise<boolean> {
    const lockKey = REDIS_KEYS.lock(eventId);
    const lockValue = `worker:${process.pid}:${Date.now()}`;

    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      'EX', WEBHOOK_CONFIG.LOCK_TTL_SECONDS,
      'NX'
    );

    if (acquired) {
      // Update event status to processing
      await this.updateEventStatus(eventId, 'processing');
    }

    return !!acquired;
  }

  /**
   * Step 4: Mark event as processed/failed
   */
  async markEventProcessed(
    eventId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const key = REDIS_KEYS.event(eventId);
    const existing = await this.redis.get(key);
    
    if (!existing) return;

    const eventData: WebhookEventData = JSON.parse(existing);
    eventData.status = success ? 'processed' : 'failed';
    eventData.processedAt = new Date().toISOString();
    if (error) eventData.error = error;

    await this.redis.set(
      key,
      JSON.stringify(eventData),
      'EX', WEBHOOK_CONFIG.EVENT_TTL_DAYS * 86400
    );
  }

  /**
   * Step 5: Release processing lock
   */
  async releaseProcessingLock(eventId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.lock(eventId));
  }

  private async updateEventStatus(
    eventId: string,
    status: WebhookEventData['status']
  ): Promise<void> {
    const key = REDIS_KEYS.event(eventId);
    const existing = await this.redis.get(key);
    
    if (!existing) return;

    const eventData: WebhookEventData = JSON.parse(existing);
    eventData.status = status;

    await this.redis.set(
      key,
      JSON.stringify(eventData),
      'KEEPTTL'
    );
  }
}
```

## Usage: Stripe Webhook Handler

```typescript
// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookService = new WebhookQueueService(redis);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  // 1. Verify signature (Stripe's built-in security)
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 2. Validate event age (replay attack prevention)
  try {
    await webhookService.validateEventAge(
      event.id,
      new Date(event.created * 1000)
    );
  } catch (err) {
    if (err instanceof WebhookEventTooOldError) {
      // Return 400 for security events - don't acknowledge
      return NextResponse.json({ error: 'Event too old' }, { status: 400 });
    }
    throw err;
  }

  // 3. Persist event ID (idempotency)
  try {
    await webhookService.persistEvent(
      event.id,
      event.type,
      new Date(event.created * 1000)
    );
  } catch (err) {
    if (err instanceof WebhookEventDuplicateError) {
      // Return 200 for duplicates - already processed
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw err;
  }

  // 4. Acquire processing lock
  const lockAcquired = await webhookService.acquireProcessingLock(event.id);
  if (!lockAcquired) {
    // Another worker is processing - return 200
    return NextResponse.json({ received: true, processing: true });
  }

  // 5. Process the event
  try {
    await processStripeEvent(event);
    await webhookService.markEventProcessed(event.id, true);
  } catch (err) {
    await webhookService.markEventProcessed(event.id, false, String(err));
    throw err;
  } finally {
    // 6. Release lock
    await webhookService.releaseProcessingLock(event.id);
  }

  return NextResponse.json({ received: true });
}

async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionChange(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSuccess(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailure(event.data.object);
      break;
  }
}
```

## Redis Key Structure

```
webhook_event:{event_id}
├── eventType: "customer.subscription.updated"
├── eventCreated: "2024-01-15T10:30:00Z"
├── receivedAt: "2024-01-15T10:30:05Z"
├── status: "pending" | "processing" | "processed" | "failed"
├── processedAt: "2024-01-15T10:30:06Z"
└── error: "" | "Error message"
TTL: 7 days

webhook_lock:{event_id}
└── value: "worker:12345:1705312200000"
TTL: 60 seconds
```

## Security Flow Diagram

```
Timeline: ─────────────────────────────────────────────────────▶

    T-10min     T-5min      T-1min       NOW        T+1min
       │           │           │           │           │
       ❌          ❌          ✓           ✓           ❌
    TOO OLD    TOO OLD     VALID       VALID      FUTURE
    
    ACCEPTABLE WINDOW: 5 min past to 1 min future
```

## Testing

```typescript
describe('WebhookQueueService', () => {
  it('rejects events older than 5 minutes', async () => {
    const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000);
    
    await expect(
      webhookService.validateEventAge('evt_123', oldTimestamp)
    ).rejects.toThrow(WebhookEventTooOldError);
  });

  it('rejects duplicate events', async () => {
    const timestamp = new Date();
    
    // First call succeeds
    await webhookService.persistEvent('evt_123', 'test', timestamp);
    
    // Second call fails
    await expect(
      webhookService.persistEvent('evt_123', 'test', timestamp)
    ).rejects.toThrow(WebhookEventDuplicateError);
  });

  it('prevents concurrent processing with locks', async () => {
    await webhookService.persistEvent('evt_123', 'test', new Date());
    
    // First lock succeeds
    const lock1 = await webhookService.acquireProcessingLock('evt_123');
    expect(lock1).toBe(true);
    
    // Second lock fails
    const lock2 = await webhookService.acquireProcessingLock('evt_123');
    expect(lock2).toBe(false);
  });
});
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Checklist

- [ ] Redis connection configured
- [ ] Stripe webhook secret set
- [ ] Webhook endpoint deployed
- [ ] Event age validation (5 min window)
- [ ] Idempotency with SETNX
- [ ] Distributed locking
- [ ] Status tracking (pending → processing → processed/failed)
- [ ] Lock auto-expiry (60s)
- [ ] Event TTL (7 days)
- [ ] Error handling for each failure mode
- [ ] Monitoring/alerting for security events
