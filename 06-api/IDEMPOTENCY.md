# Idempotency

> Ensure operations execute only once using dedup keys with TTL-based expiration.

## The Problem

Network issues cause duplicate requests:
- Client retries on timeout
- Load balancer retries
- User double-clicks submit
- Webhook delivered multiple times

## The Pattern

```
Request with Idempotency-Key
           │
           ▼
    ┌─────────────┐
    │ Check cache │
    └──────┬──────┘
           │
     ┌─────┴─────┐
     │           │
   Found      Not Found
     │           │
     ▼           ▼
  Return     Execute
  cached     operation
  result         │
                 ▼
            Cache result
```

## Implementation

```typescript
interface IdempotencyRecord {
  key: string;
  result: any;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

interface IdempotencyConfig {
  ttlSeconds: number;
  maxEntries: number;
}


class IdempotencyManager {
  private records = new Map<string, IdempotencyRecord>();
  private config: IdempotencyConfig;

  constructor(config: Partial<IdempotencyConfig> = {}) {
    this.config = { ttlSeconds: 3600, maxEntries: 10000, ...config };
    setInterval(() => this.cleanup(), 60000);
  }

  generateKey(...components: (string | number)[]): string {
    return components.join(':');
  }

  has(key: string): boolean {
    const record = this.records.get(key);
    if (!record) return false;
    
    if (record.expiresAt < new Date()) {
      this.records.delete(key);
      return false;
    }
    return true;
  }

  get(key: string): IdempotencyRecord | null {
    const record = this.records.get(key);
    if (!record || record.expiresAt < new Date()) {
      this.records.delete(key);
      return null;
    }
    return record;
  }

  markPending(key: string): boolean {
    if (this.has(key)) return false;

    const now = new Date();
    this.records.set(key, {
      key,
      result: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.ttlSeconds * 1000),
      status: 'pending',
    });

    this.enforceMaxEntries();
    return true;
  }

  markCompleted(key: string, result: any): void {
    const record = this.records.get(key);
    if (record) {
      record.status = 'completed';
      record.result = result;
    }
  }

  markFailed(key: string, error: string): void {
    const record = this.records.get(key);
    if (record) {
      record.status = 'failed';
      record.error = error;
    }
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<{ result: T; cached: boolean }> {
    const existing = this.get(key);
    
    if (existing) {
      if (existing.status === 'completed') {
        return { result: existing.result as T, cached: true };
      }
      if (existing.status === 'pending') {
        throw new Error(`Operation ${key} already in progress`);
      }
      if (existing.status === 'failed') {
        this.records.delete(key); // Allow retry
      }
    }

    this.markPending(key);

    try {
      const result = await fn();
      this.markCompleted(key, result);
      return { result, cached: false };
    } catch (error) {
      this.markFailed(key, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  cleanup(): number {
    const now = new Date();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt < now) {
        this.records.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private enforceMaxEntries(): void {
    if (this.records.size <= this.config.maxEntries) return;
    
    const sorted = Array.from(this.records.entries())
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());

    while (sorted.length > this.config.maxEntries) {
      const [key] = sorted.shift()!;
      this.records.delete(key);
    }
  }
}

// Singleton
let manager: IdempotencyManager | null = null;
export function getIdempotencyManager(): IdempotencyManager {
  if (!manager) manager = new IdempotencyManager();
  return manager;
}
```

## Usage

```typescript
const idempotency = getIdempotencyManager();

// API route with idempotency
export async function POST(req: Request) {
  const idempotencyKey = req.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return Response.json({ error: 'Idempotency-Key required' }, { status: 400 });
  }

  const body = await req.json();
  
  try {
    const { result, cached } = await idempotency.execute(
      idempotencyKey,
      () => processPayment(body)
    );

    return Response.json(result, {
      headers: { 'X-Idempotent-Replay': cached ? 'true' : 'false' },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Generate key from request data
const key = idempotency.generateKey('payment', userId, amount, timestamp);
```

## Key Points

1. Require idempotency key for mutating operations
2. Return cached result with header indicating replay
3. Allow retry of failed operations
4. TTL prevents unbounded memory growth

## Time Estimate: 3 hours
