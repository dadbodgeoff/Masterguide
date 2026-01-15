# Distributed Locking

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: PostgreSQL or Redis

## Problem

Multiple instances of your app. Both try to process the same job. Data corruption. Duplicate charges. Race conditions everywhere.

## Solution

Distributed lock. Only one instance can hold the lock. Others wait or fail fast. Automatic expiration prevents deadlocks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Distributed Lock Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Instance A                          Instance B                 │
│      │                                   │                      │
│      │  acquire("job:123")               │                      │
│      │─────────────────────▶             │                      │
│      │                      ┌────────────┴────────────┐         │
│      │                      │     Lock Store          │         │
│      │                      │                         │         │
│      │◀─────────────────────│  lock: job:123          │         │
│      │  ✓ acquired          │  holder: instance_a     │         │
│      │                      │  expires: +30s          │         │
│      │                      │                         │         │
│      │  [processing...]     │                         │         │
│      │                      │                         │         │
│      │                      │         acquire("job:123")        │
│      │                      │◀────────────────────────│         │
│      │                      │                         │         │
│      │                      │─────────────────────────▶         │
│      │                      │  ✗ already locked       │         │
│      │                      │                         │         │
│      │  release("job:123")  │                         │         │
│      │─────────────────────▶│                         │         │
│      │                      │  [lock released]        │         │
│      │                      └─────────────────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### Types

```typescript
// types.ts
export interface LockInfo {
  lockName: string;
  holderId: string;
  acquiredAt: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface LockOptions {
  /** Lock TTL in seconds (default: 30) */
  timeoutSeconds?: number;
  /** Wait for lock if held (default: false) */
  blocking?: boolean;
  /** Max time to wait for lock in seconds */
  blockingTimeoutSeconds?: number;
  /** Metadata to store with lock */
  metadata?: Record<string, unknown>;
}

export interface LockResult {
  acquired: boolean;
  lock?: LockInfo;
  error?: string;
}
```

### In-Memory Implementation (Single Instance)

```typescript
// distributed-lock.ts
import { LockInfo, LockOptions, LockResult } from './types';

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_TIMEOUT = 30; // seconds
const DEFAULT_BLOCKING_TIMEOUT = 10; // seconds

// In-memory store (replace with Redis for multi-instance)
const lockStore = new Map<string, LockInfo>();

export class LockAcquisitionError extends Error {
  constructor(public lockName: string, public reason: string) {
    super(`Failed to acquire lock ${lockName}: ${reason}`);
    this.name = 'LockAcquisitionError';
  }
}

export class DistributedLock {
  private holderId: string;
  private heldLocks = new Map<string, LockInfo>();

  constructor() {
    this.holderId = `worker_${generateId()}`;
  }

  /**
   * Attempt to acquire a lock.
   */
  async acquire(lockName: string, options: LockOptions = {}): Promise<LockResult> {
    const {
      timeoutSeconds = DEFAULT_TIMEOUT,
      blocking = false,
      blockingTimeoutSeconds = DEFAULT_BLOCKING_TIMEOUT,
      metadata = {},
    } = options;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000);

    // Clean up expired locks
    this.cleanupExpired();

    // Check if lock exists and is valid
    const existing = lockStore.get(lockName);
    
    if (existing && existing.expiresAt > now) {
      // Lock is held by someone else
      if (existing.holderId === this.holderId) {
        // We already hold it - extend
        existing.expiresAt = expiresAt;
        return { acquired: true, lock: existing };
      }

      if (blocking) {
        // Wait for lock
        return this.waitForLock(lockName, options);
      }

      return {
        acquired: false,
        error: `Lock held by ${existing.holderId}`,
      };
    }

    // Acquire the lock
    const lock: LockInfo = {
      lockName,
      holderId: this.holderId,
      acquiredAt: now,
      expiresAt,
      metadata,
    };

    lockStore.set(lockName, lock);
    this.heldLocks.set(lockName, lock);

    return { acquired: true, lock };
  }

  /**
   * Release a lock.
   */
  async release(lockName: string): Promise<boolean> {
    const lock = lockStore.get(lockName);

    if (!lock) {
      return true; // Already released
    }

    if (lock.holderId !== this.holderId) {
      console.warn(`Cannot release lock ${lockName}: not the holder`);
      return false;
    }

    lockStore.delete(lockName);
    this.heldLocks.delete(lockName);
    return true;
  }

  /**
   * Extend a lock's TTL.
   */
  async extend(lockName: string, additionalSeconds: number): Promise<boolean> {
    const lock = lockStore.get(lockName);

    if (!lock || lock.holderId !== this.holderId) {
      return false;
    }

    lock.expiresAt = new Date(Date.now() + additionalSeconds * 1000);
    return true;
  }

  /**
   * Execute a function while holding a lock.
   */
  async withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const result = await this.acquire(lockName, options);

    if (!result.acquired) {
      throw new LockAcquisitionError(lockName, result.error || 'Unknown error');
    }

    try {
      return await fn();
    } finally {
      await this.release(lockName);
    }
  }

  /**
   * Wait for a lock to become available.
   */
  private async waitForLock(
    lockName: string,
    options: LockOptions
  ): Promise<LockResult> {
    const timeout = (options.blockingTimeoutSeconds || DEFAULT_BLOCKING_TIMEOUT) * 1000;
    const startTime = Date.now();
    const pollInterval = 100; // ms

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const result = await this.acquire(lockName, { ...options, blocking: false });
      if (result.acquired) {
        return result;
      }
    }

    return {
      acquired: false,
      error: 'Timeout waiting for lock',
    };
  }

  /**
   * Clean up expired locks.
   */
  private cleanupExpired(): void {
    const now = new Date();
    for (const [name, lock] of lockStore) {
      if (lock.expiresAt <= now) {
        lockStore.delete(name);
      }
    }
  }

  /**
   * Release all locks held by this instance.
   */
  async releaseAll(): Promise<void> {
    for (const lockName of this.heldLocks.keys()) {
      await this.release(lockName);
    }
  }
}

// Singleton instance
let instance: DistributedLock | null = null;

export function getDistributedLock(): DistributedLock {
  if (!instance) {
    instance = new DistributedLock();
  }
  return instance;
}
```

### PostgreSQL Implementation (Multi-Instance)

```sql
-- migrations/006_distributed_locks.sql

CREATE TABLE distributed_locks (
    lock_name VARCHAR(255) PRIMARY KEY,
    holder_id VARCHAR(255) NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT valid_expiry CHECK (expires_at > acquired_at)
);

CREATE INDEX idx_locks_expires ON distributed_locks(expires_at);
CREATE INDEX idx_locks_holder ON distributed_locks(holder_id);

-- Atomic lock acquisition
CREATE OR REPLACE FUNCTION acquire_lock(
    p_lock_name VARCHAR(255),
    p_holder_id VARCHAR(255),
    p_ttl_seconds INTEGER DEFAULT 30,
    p_metadata JSONB DEFAULT '{}'
) RETURNS BOOLEAN AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
BEGIN
    -- Clean up expired lock
    DELETE FROM distributed_locks 
    WHERE lock_name = p_lock_name 
    AND expires_at < v_now;
    
    -- Try to insert (fails if lock exists)
    INSERT INTO distributed_locks (lock_name, holder_id, acquired_at, expires_at, metadata)
    VALUES (p_lock_name, p_holder_id, v_now, v_expires_at, p_metadata)
    ON CONFLICT (lock_name) DO UPDATE
    SET 
        holder_id = EXCLUDED.holder_id,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata
    WHERE distributed_locks.holder_id = p_holder_id  -- Only if we already hold it
       OR distributed_locks.expires_at < v_now;       -- Or it's expired
    
    -- Check if we got it
    RETURN EXISTS (
        SELECT 1 FROM distributed_locks 
        WHERE lock_name = p_lock_name 
        AND holder_id = p_holder_id
    );
END;
$$ LANGUAGE plpgsql;

-- Release lock
CREATE OR REPLACE FUNCTION release_lock(
    p_lock_name VARCHAR(255),
    p_holder_id VARCHAR(255)
) RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM distributed_locks 
    WHERE lock_name = p_lock_name 
    AND holder_id = p_holder_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Extend lock TTL
CREATE OR REPLACE FUNCTION extend_lock(
    p_lock_name VARCHAR(255),
    p_holder_id VARCHAR(255),
    p_additional_seconds INTEGER
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE distributed_locks 
    SET expires_at = NOW() + (p_additional_seconds || ' seconds')::INTERVAL
    WHERE lock_name = p_lock_name 
    AND holder_id = p_holder_id
    AND expires_at > NOW();
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
```

### Supabase Client for PostgreSQL Locks

```typescript
// distributed-lock-pg.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { LockOptions, LockResult } from './types';

export class PostgresDistributedLock {
  private holderId: string;

  constructor(
    private supabase: SupabaseClient,
    holderId?: string
  ) {
    this.holderId = holderId || `worker_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  async acquire(lockName: string, options: LockOptions = {}): Promise<LockResult> {
    const { timeoutSeconds = 30, metadata = {} } = options;

    const { data, error } = await this.supabase.rpc('acquire_lock', {
      p_lock_name: lockName,
      p_holder_id: this.holderId,
      p_ttl_seconds: timeoutSeconds,
      p_metadata: metadata,
    });

    if (error) {
      return { acquired: false, error: error.message };
    }

    return { acquired: data === true };
  }

  async release(lockName: string): Promise<boolean> {
    const { data } = await this.supabase.rpc('release_lock', {
      p_lock_name: lockName,
      p_holder_id: this.holderId,
    });

    return data === true;
  }

  async extend(lockName: string, additionalSeconds: number): Promise<boolean> {
    const { data } = await this.supabase.rpc('extend_lock', {
      p_lock_name: lockName,
      p_holder_id: this.holderId,
      p_additional_seconds: additionalSeconds,
    });

    return data === true;
  }

  async withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const result = await this.acquire(lockName, options);

    if (!result.acquired) {
      throw new Error(`Failed to acquire lock: ${lockName}`);
    }

    try {
      return await fn();
    } finally {
      await this.release(lockName);
    }
  }
}
```

## Usage Examples

### Basic Lock

```typescript
const lock = getDistributedLock();

// Try to acquire
const result = await lock.acquire('process-payment:order-123');

if (result.acquired) {
  try {
    await processPayment('order-123');
  } finally {
    await lock.release('process-payment:order-123');
  }
} else {
  console.log('Another instance is processing this order');
}
```

### With Context Manager

```typescript
const lock = getDistributedLock();

// Automatically acquires and releases
await lock.withLock('daily-report', async () => {
  await generateDailyReport();
}, { timeoutSeconds: 300 }); // 5 minute lock for long operation
```

### Worker Job Processing

```typescript
async function processJob(jobId: string) {
  const lock = getDistributedLock();
  
  const result = await lock.acquire(`job:${jobId}`, {
    timeoutSeconds: 60,
    metadata: { startedAt: new Date().toISOString() },
  });

  if (!result.acquired) {
    console.log(`Job ${jobId} already being processed`);
    return;
  }

  try {
    // Long-running job - extend lock periodically
    const extendInterval = setInterval(async () => {
      await lock.extend(`job:${jobId}`, 60);
    }, 30000); // Extend every 30s

    await doExpensiveWork(jobId);

    clearInterval(extendInterval);
  } finally {
    await lock.release(`job:${jobId}`);
  }
}
```

### Singleton Cron Job

```typescript
// Only one instance runs the cron job
async function runScheduledTask() {
  const lock = getDistributedLock();
  
  const result = await lock.acquire('cron:daily-cleanup', {
    timeoutSeconds: 3600, // 1 hour
  });

  if (!result.acquired) {
    console.log('Another instance is running daily cleanup');
    return;
  }

  try {
    await performDailyCleanup();
  } finally {
    await lock.release('cron:daily-cleanup');
  }
}
```

## Lock Naming Conventions

```typescript
// Resource-based
`lock:user:${userId}:profile-update`
`lock:order:${orderId}:process`

// Job-based
`job:${jobType}:${jobId}`
`cron:${taskName}`

// Singleton operations
`singleton:daily-report`
`singleton:cache-refresh`
```

## Production Checklist

- [ ] Lock TTL appropriate for operation duration
- [ ] Lock extension for long-running operations
- [ ] Cleanup of expired locks (automatic or scheduled)
- [ ] Unique holder IDs per instance
- [ ] Graceful release on shutdown
- [ ] Monitoring of lock contention

## Related Patterns

- [Leader Election](./LEADER_ELECTION.md)
- [Circuit Breaker](./CIRCUIT_BREAKER.md)
- [Worker Orchestration](../04-workers/ORCHESTRATION.md)
