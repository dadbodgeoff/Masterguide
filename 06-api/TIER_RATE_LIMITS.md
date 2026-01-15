# Tier-Based Rate Limiting Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium  
> **Prerequisites:** Redis (optional, has in-memory fallback)

## The Problem

APIs need protection from abuse, but limits should vary by plan:
- Free users: 60 requests/min
- Pro users: 240 requests/min
- Enterprise: Unlimited

Plus monthly quotas for expensive operations (AI generation, etc.)

## The Solution

Sliding window rate limiting with:
1. Multiple limit types (per-minute, per-hour, monthly, total)
2. Tier-based configuration
3. Redis primary with in-memory fallback
4. Atomic check-and-increment

## Architecture

```
Request → Get User Tier → Check Limit → Allow/Deny
                              ↓
                    Redis (sliding window)
                              ↓
                    Fallback: In-Memory
```

## Core Implementation

### Types

```typescript
// lib/rate-limit/types.ts
export enum LimitType {
  PER_MINUTE = 'per_minute',
  PER_HOUR = 'per_hour',
  PER_DAY = 'per_day',
  MONTHLY = 'monthly',
  TOTAL = 'total',  // Never resets (storage limits)
}

export interface LimitConfig {
  key: string;
  displayName: string;
  description: string;
  limitType: LimitType;
  category: string;
  // Tier limits (null = unlimited)
  freeTier: number | null;
  proTier: number | null;
  enterpriseTier: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  retryAfter: number;  // Seconds until reset
  resetsAt: Date;
  limitKey: string;
  tier: string;
  error?: string;
}
```

### Limit Configurations

```typescript
// lib/rate-limit/configs.ts
export const LIMIT_CONFIGS: Record<string, LimitConfig> = {
  api_requests: {
    key: 'api_requests',
    displayName: 'API Requests',
    description: 'General API requests per minute',
    limitType: LimitType.PER_MINUTE,
    category: 'api',
    freeTier: 60,
    proTier: 240,
    enterpriseTier: null, // Unlimited
  },
  
  login_attempts: {
    key: 'login_attempts',
    displayName: 'Login Attempts',
    description: 'Login attempts per hour',
    limitType: LimitType.PER_HOUR,
    category: 'auth',
    freeTier: 10,
    proTier: 20,
    enterpriseTier: 50,
  },
  
  ai_generations: {
    key: 'ai_generations',
    displayName: 'AI Generations',
    description: 'AI generations per month',
    limitType: LimitType.MONTHLY,
    category: 'generation',
    freeTier: 50,
    proTier: 500,
    enterpriseTier: 5000,
  },
  
  storage_items: {
    key: 'storage_items',
    displayName: 'Storage Items',
    description: 'Maximum stored items',
    limitType: LimitType.TOTAL,
    category: 'storage',
    freeTier: 100,
    proTier: 1000,
    enterpriseTier: 10000,
  },
};

export function getLimitForTier(
  config: LimitConfig,
  tier: string
): number | null {
  switch (tier.toLowerCase()) {
    case 'free': return config.freeTier;
    case 'pro': return config.proTier;
    case 'enterprise': return config.enterpriseTier;
    case 'admin': return null; // Always unlimited
    default: return config.freeTier;
  }
}

export function getWindowSeconds(limitType: LimitType): number {
  switch (limitType) {
    case LimitType.PER_MINUTE: return 60;
    case LimitType.PER_HOUR: return 3600;
    case LimitType.PER_DAY: return 86400;
    case LimitType.MONTHLY: return 30 * 86400;
    case LimitType.TOTAL: return Infinity;
  }
}
```

### Rate Limit Service

```typescript
// lib/rate-limit/service.ts
import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';

const REDIS_KEY_PREFIX = 'rate_limit:';

export class RateLimitService {
  private redis: Redis | null;
  private memoryStore: Map<string, number[]> = new Map();
  private memoryCounters: Map<string, number> = new Map();

  constructor(redisUrl?: string) {
    this.redis = redisUrl ? new Redis(redisUrl) : null;
  }

  /**
   * Check if action is allowed (doesn't increment)
   */
  async check(
    userId: string,
    limitKey: string,
    tier: string
  ): Promise<RateLimitResult> {
    const config = LIMIT_CONFIGS[limitKey];
    if (!config) {
      return this.createAllowedResult(limitKey, tier);
    }

    const limit = getLimitForTier(config, tier);
    if (limit === null) {
      return this.createAllowedResult(limitKey, tier);
    }

    const key = `${REDIS_KEY_PREFIX}${userId}:${limitKey}`;
    const windowSeconds = getWindowSeconds(config.limitType);

    if (this.redis) {
      return this.checkRedis(key, limitKey, tier, limit, windowSeconds, config);
    }
    return this.checkMemory(key, limitKey, tier, limit, windowSeconds, config);
  }

  /**
   * Atomically check AND increment (recommended)
   */
  async checkAndIncrement(
    userId: string,
    limitKey: string,
    tier: string
  ): Promise<RateLimitResult> {
    const config = LIMIT_CONFIGS[limitKey];
    if (!config) {
      return this.createAllowedResult(limitKey, tier);
    }

    const limit = getLimitForTier(config, tier);
    if (limit === null) {
      return this.createAllowedResult(limitKey, tier);
    }

    const key = `${REDIS_KEY_PREFIX}${userId}:${limitKey}`;
    const windowSeconds = getWindowSeconds(config.limitType);

    if (this.redis) {
      return this.checkAndIncrementRedis(
        key, limitKey, tier, limit, windowSeconds, config
      );
    }
    return this.checkAndIncrementMemory(
      key, limitKey, tier, limit, windowSeconds, config
    );
  }

  /**
   * Reset a user's limit (admin function)
   */
  async reset(userId: string, limitKey: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIX}${userId}:${limitKey}`;
    
    if (this.redis) {
      await this.redis.del(key);
    } else {
      this.memoryStore.delete(key);
      this.memoryCounters.delete(key);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REDIS IMPLEMENTATION (Sliding Window)
  // ═══════════════════════════════════════════════════════════════

  private async checkRedis(
    key: string,
    limitKey: string,
    tier: string,
    limit: number,
    windowSeconds: number,
    config: LimitConfig
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    // For TOTAL limits, use simple counter
    if (config.limitType === LimitType.TOTAL) {
      const count = parseInt(await this.redis!.get(key) || '0', 10);
      return this.buildResult(count, limit, limitKey, tier, config);
    }

    // Sliding window: remove old entries, count remaining
    await this.redis!.zremrangebyscore(key, 0, windowStart);
    const count = await this.redis!.zcard(key);

    return this.buildResult(count, limit, limitKey, tier, config);
  }

  private async checkAndIncrementRedis(
    key: string,
    limitKey: string,
    tier: string,
    limit: number,
    windowSeconds: number,
    config: LimitConfig
  ): Promise<RateLimitResult> {
    const now = Date.now();

    // For TOTAL limits, use INCR
    if (config.limitType === LimitType.TOTAL) {
      const count = await this.redis!.incr(key);
      if (count > limit) {
        await this.redis!.decr(key); // Rollback
        return this.buildResult(count - 1, limit, limitKey, tier, config, false);
      }
      return this.buildResult(count, limit, limitKey, tier, config, true);
    }

    // Lua script for atomic sliding window check-and-increment
    const script = `
      local key = KEYS[1]
      local window_start = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local request_id = ARGV[4]
      local window_seconds = tonumber(ARGV[5])

      -- Remove expired entries
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

      -- Get current count
      local count = redis.call('ZCARD', key)

      -- Check if under limit
      if count < limit then
        -- Add new entry
        redis.call('ZADD', key, now, request_id)
        redis.call('EXPIRE', key, window_seconds)
        return {1, count + 1}  -- allowed, new count
      else
        return {0, count}  -- denied, current count
      end
    `;

    const windowStart = now - (windowSeconds * 1000);
    const requestId = `${now}:${uuid().slice(0, 8)}`;

    const [allowed, count] = await this.redis!.eval(
      script,
      1,
      key,
      windowStart,
      now,
      limit,
      requestId,
      windowSeconds
    ) as [number, number];

    return this.buildResult(count, limit, limitKey, tier, config, allowed === 1);
  }

  // ═══════════════════════════════════════════════════════════════
  // IN-MEMORY FALLBACK
  // ═══════════════════════════════════════════════════════════════

  private checkMemory(
    key: string,
    limitKey: string,
    tier: string,
    limit: number,
    windowSeconds: number,
    config: LimitConfig
  ): RateLimitResult {
    if (config.limitType === LimitType.TOTAL) {
      const count = this.memoryCounters.get(key) || 0;
      return this.buildResult(count, limit, limitKey, tier, config);
    }

    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    let entries = this.memoryStore.get(key) || [];
    entries = entries.filter(ts => ts > windowStart);
    this.memoryStore.set(key, entries);

    return this.buildResult(entries.length, limit, limitKey, tier, config);
  }

  private checkAndIncrementMemory(
    key: string,
    limitKey: string,
    tier: string,
    limit: number,
    windowSeconds: number,
    config: LimitConfig
  ): RateLimitResult {
    if (config.limitType === LimitType.TOTAL) {
      const count = (this.memoryCounters.get(key) || 0) + 1;
      if (count > limit) {
        return this.buildResult(count - 1, limit, limitKey, tier, config, false);
      }
      this.memoryCounters.set(key, count);
      return this.buildResult(count, limit, limitKey, tier, config, true);
    }

    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    let entries = this.memoryStore.get(key) || [];
    entries = entries.filter(ts => ts > windowStart);

    if (entries.length >= limit) {
      this.memoryStore.set(key, entries);
      return this.buildResult(entries.length, limit, limitKey, tier, config, false);
    }

    entries.push(now);
    this.memoryStore.set(key, entries);
    return this.buildResult(entries.length, limit, limitKey, tier, config, true);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private buildResult(
    used: number,
    limit: number,
    limitKey: string,
    tier: string,
    config: LimitConfig,
    allowed?: boolean
  ): RateLimitResult {
    const isAllowed = allowed ?? used < limit;
    const remaining = Math.max(0, limit - used);
    const windowSeconds = getWindowSeconds(config.limitType);
    const resetsAt = new Date(Date.now() + windowSeconds * 1000);
    const retryAfter = isAllowed ? 0 : windowSeconds;

    return {
      allowed: isAllowed,
      limit,
      used,
      remaining,
      retryAfter,
      resetsAt,
      limitKey,
      tier,
      error: isAllowed ? undefined : `Rate limit exceeded. Retry in ${retryAfter}s`,
    };
  }

  private createAllowedResult(limitKey: string, tier: string): RateLimitResult {
    return {
      allowed: true,
      limit: Infinity,
      used: 0,
      remaining: Infinity,
      retryAfter: 0,
      resetsAt: new Date(Date.now() + 3600000),
      limitKey,
      tier,
    };
  }
}

// Singleton
export const rateLimitService = new RateLimitService(
  process.env.REDIS_URL
);
```

## Middleware Usage

```typescript
// middleware/rate-limit.ts
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitService } from '@/lib/rate-limit/service';

export async function withRateLimit(
  req: NextRequest,
  limitKey: string = 'api_requests'
) {
  // Get user from auth (implement based on your auth)
  const userId = req.headers.get('x-user-id') || 'anonymous';
  const tier = req.headers.get('x-user-tier') || 'free';

  const result = await rateLimitService.checkAndIncrement(
    userId,
    limitKey,
    tier
  );

  // Add rate limit headers
  const headers = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetsAt.getTime() / 1000)),
  };

  if (!result.allowed) {
    return NextResponse.json(
      { error: result.error },
      { 
        status: 429,
        headers: {
          ...headers,
          'Retry-After': String(result.retryAfter),
        },
      }
    );
  }

  return { headers, result };
}
```

```typescript
// app/api/generate/route.ts
import { withRateLimit } from '@/middleware/rate-limit';

export async function POST(req: NextRequest) {
  // Check AI generation limit
  const rateLimit = await withRateLimit(req, 'ai_generations');
  
  if (rateLimit instanceof NextResponse) {
    return rateLimit; // 429 response
  }

  // Proceed with generation...
  const response = NextResponse.json({ success: true });
  
  // Add rate limit headers to response
  Object.entries(rateLimit.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}
```

## Usage Dashboard Endpoint

```typescript
// app/api/usage/route.ts
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')!;
  const tier = req.headers.get('x-user-tier')!;

  const usage: Record<string, RateLimitResult> = {};

  for (const key of Object.keys(LIMIT_CONFIGS)) {
    usage[key] = await rateLimitService.check(userId, key, tier);
  }

  return NextResponse.json({ usage });
}
```

## Response Headers

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705312260
Retry-After: 23  (only on 429)
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379  # Optional, falls back to in-memory
```

## Checklist

- [ ] LimitType enum (per_minute, per_hour, monthly, total)
- [ ] LimitConfig for each limit type
- [ ] Tier-based limit values
- [ ] Redis sliding window implementation
- [ ] In-memory fallback
- [ ] Atomic check-and-increment
- [ ] Rate limit headers on responses
- [ ] 429 response with Retry-After
- [ ] Admin reset functionality
- [ ] Usage dashboard endpoint
- [ ] Lua script for atomic Redis operations
