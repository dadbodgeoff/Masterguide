# Tier-Based Entitlements

> **Implementation Time**: 3h  
> **Complexity**: Medium  
> **Dependencies**: Supabase (or any database)

## Problem

Free users get limited features. Pro users get more. You need to check entitlements everywhere without spaghetti code.

## Solution

Centralized tier configuration. Database tracks usage. Clean API for checking limits.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tier System                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ TIER_LIMITS  │    │ user_profiles│    │ Rate Limit   │      │
│  │ (config)     │    │ (database)   │    │ Functions    │      │
│  │              │    │              │    │              │      │
│  │ free: 3/day  │    │ tier: 'free' │    │ checkLimit() │      │
│  │ pro: ∞       │    │ usage: 2     │    │ increment()  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         └───────────────────┴───────────────────┘               │
│                             │                                   │
│                             ▼                                   │
│                    ┌──────────────┐                             │
│                    │ API Route    │                             │
│                    │ if (!allowed)│                             │
│                    │   return 429 │                             │
│                    └──────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Tier Configuration

```typescript
// lib/tiers.ts

export const TIER_LIMITS = {
  free: {
    predictionsPerDay: 3,
    historyDays: 7,
    exportEnabled: false,
    apiAccess: false,
    description: 'Free tier: 3 predictions per day',
  },
  pro: {
    predictionsPerDay: Infinity,
    historyDays: 365,
    exportEnabled: true,
    apiAccess: true,
    description: 'Pro tier: Unlimited access',
  },
} as const;

export type UserTier = keyof typeof TIER_LIMITS;
export type TierLimits = typeof TIER_LIMITS[UserTier];
```

### 2. Database Schema

```sql
-- migrations/001_user_profiles.sql

CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name VARCHAR(255),
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free',
    
    -- Usage tracking
    predictions_today INTEGER DEFAULT 0,
    predictions_date DATE DEFAULT CURRENT_DATE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic increment function (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_predictions(
    p_user_id UUID, 
    p_today_date DATE
)
RETURNS VOID AS $$
BEGIN
    UPDATE user_profiles
    SET 
        predictions_today = CASE 
            WHEN predictions_date = p_today_date THEN predictions_today + 1
            ELSE 1  -- Reset if new day
        END,
        predictions_date = p_today_date,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

### 3. Rate Limit Functions

```typescript
// lib/rate-limits.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { TIER_LIMITS, type UserTier } from './tiers';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;  // Unix timestamp
  tier: UserTier;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

/**
 * Check if user has remaining quota for today.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string
): Promise<RateLimitResult> {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('subscription_tier, predictions_today, predictions_date')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    // Default to free tier if profile not found
    return {
      allowed: true,
      limit: TIER_LIMITS.free.predictionsPerDay,
      remaining: TIER_LIMITS.free.predictionsPerDay,
      reset: getResetTimestamp(),
      tier: 'free',
    };
  }

  const tier = (profile.subscription_tier as UserTier) || 'free';
  const limit = TIER_LIMITS[tier].predictionsPerDay;

  // Pro users have unlimited access
  if (limit === Infinity) {
    return {
      allowed: true,
      limit: -1,  // -1 indicates unlimited
      remaining: -1,
      reset: getResetTimestamp(),
      tier,
    };
  }

  // Check if usage is from today
  let used = 0;
  if (profile.predictions_date === today) {
    used = profile.predictions_today || 0;
  }

  const remaining = Math.max(0, limit - used);
  
  return {
    allowed: remaining > 0,
    limit,
    remaining,
    reset: getResetTimestamp(),
    tier,
  };
}

/**
 * Increment user's usage count for today.
 */
export async function incrementUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase.rpc('increment_predictions', {
    p_user_id: userId,
    p_today_date: today,
  });

  return !error;
}

/**
 * Get Unix timestamp for midnight UTC (when limits reset).
 */
function getResetTimestamp(): number {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.floor(tomorrow.getTime() / 1000);
}

/**
 * Generate rate limit headers for HTTP response.
 */
export function getRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': result.limit === -1 ? 'unlimited' : String(result.limit),
    'X-RateLimit-Remaining': result.remaining === -1 ? 'unlimited' : String(result.remaining),
    'X-RateLimit-Reset': String(result.reset),
  };

  if (!result.allowed) {
    const retryAfter = result.reset - Math.floor(Date.now() / 1000);
    headers['Retry-After'] = String(Math.max(0, retryAfter));
  }

  return headers;
}

/**
 * Create a 429 response with rate limit headers.
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  const headers = getRateLimitHeaders(result);
  
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      message: `You've used all ${result.limit} predictions for today. Upgrade to Pro for unlimited access.`,
      reset: result.reset,
      upgradeUrl: '/pricing',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }
  );
}
```

### 4. Using in API Routes

```typescript
// app/api/predictions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { 
  checkRateLimit, 
  incrementUsage, 
  createRateLimitResponse,
  getRateLimitHeaders 
} from '@/lib/rate-limits';

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  
  // Check rate limit
  const rateLimit = await checkRateLimit(supabase, userId);
  
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit);
  }

  // Process the request
  const body = await request.json();
  const prediction = await generatePrediction(body);

  // Increment usage AFTER successful operation
  await incrementUsage(supabase, userId);

  // Return with rate limit headers
  return NextResponse.json(
    { prediction },
    { headers: getRateLimitHeaders(rateLimit) }
  );
}
```

### 5. Feature Gating in UI

```typescript
// components/FeatureGate.tsx
'use client';

import { useUser } from '@/hooks/useUser';
import { TIER_LIMITS } from '@/lib/tiers';

interface FeatureGateProps {
  feature: keyof typeof TIER_LIMITS.free;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { tier, isLoading } = useUser();
  
  if (isLoading) return null;
  
  const limits = TIER_LIMITS[tier];
  const hasAccess = limits[feature] === true || limits[feature] === Infinity;
  
  if (!hasAccess) {
    return fallback ?? (
      <div className="p-4 bg-gray-100 rounded text-center">
        <p>This feature requires Pro</p>
        <a href="/pricing" className="text-blue-600">Upgrade</a>
      </div>
    );
  }
  
  return <>{children}</>;
}

// Usage
<FeatureGate feature="exportEnabled">
  <ExportButton />
</FeatureGate>
```

### 6. Usage Display Component

```typescript
// components/UsageDisplay.tsx
'use client';

import { useUser } from '@/hooks/useUser';
import { TIER_LIMITS } from '@/lib/tiers';

export function UsageDisplay() {
  const { tier, profile } = useUser();
  const limits = TIER_LIMITS[tier];
  
  if (limits.predictionsPerDay === Infinity) {
    return <span className="text-green-600">Unlimited</span>;
  }
  
  const used = profile?.predictions_today ?? 0;
  const remaining = Math.max(0, limits.predictionsPerDay - used);
  
  return (
    <div className="flex items-center gap-2">
      <span className={remaining === 0 ? 'text-red-600' : 'text-gray-600'}>
        {remaining} / {limits.predictionsPerDay} remaining today
      </span>
      {remaining === 0 && (
        <a href="/pricing" className="text-blue-600 text-sm">
          Upgrade for unlimited
        </a>
      )}
    </div>
  );
}
```

## Response Headers

Every rate-limited endpoint should return these headers:

```
X-RateLimit-Limit: 3          # Max requests allowed
X-RateLimit-Remaining: 1      # Requests remaining
X-RateLimit-Reset: 1705363200 # Unix timestamp when limit resets
Retry-After: 3600             # Seconds until reset (only on 429)
```

## Production Checklist

- [ ] Tier limits defined in single config file
- [ ] Database tracks usage with atomic increment
- [ ] Rate limit checked BEFORE expensive operations
- [ ] Usage incremented AFTER successful operations
- [ ] 429 responses include upgrade CTA
- [ ] UI shows remaining quota
- [ ] Pro tier has unlimited access

## Related Patterns

- [Supabase Auth](./SUPABASE_AUTH.md)
- [Row Level Security](./ROW_LEVEL_SECURITY.md)
