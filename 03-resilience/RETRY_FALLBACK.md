# Retry & Fallback Patterns

> **Implementation Time**: 3h  
> **Complexity**: Low  
> **Dependencies**: None

## Problem

Network blips. Temporary failures. Services that usually work but occasionally don't. You need resilience without complexity.

## Solution

Exponential backoff with jitter. Fallback to cached/default data. Graceful degradation when dependencies fail.

## Retry Pattern

### Implementation

```typescript
// retry.ts

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: (error: Error) => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: baseDelay * (multiplier ^ attempt)
  let delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);
  
  // Add jitter (±25%) to prevent thundering herd
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    delay = delay + (Math.random() * jitterRange * 2 - jitterRange);
  }
  
  return Math.floor(delay);
}

/**
 * Default check for retryable errors.
 */
function isRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // Network errors
  if (message.includes('network') || message.includes('timeout')) {
    return true;
  }
  
  // Rate limiting
  if (message.includes('rate limit') || message.includes('429')) {
    return true;
  }
  
  // Temporary server errors
  if (message.includes('503') || message.includes('502') || message.includes('504')) {
    return true;
  }
  
  return false;
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const shouldRetry = cfg.retryableErrors || isRetryable;
  
  let lastError: Error;
  
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      if (attempt === cfg.maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      // Calculate and wait for delay
      const delay = calculateDelay(attempt, cfg);
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Retry decorator for class methods.
 */
export function withRetry(config: Partial<RetryConfig> = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: unknown[]) {
      return retry(() => originalMethod.apply(this, args), config);
    };
    
    return descriptor;
  };
}
```

### Usage

```typescript
// Basic retry
const data = await retry(
  () => fetch('https://api.example.com/data').then(r => r.json()),
  { maxRetries: 3 }
);

// Custom retry logic
const result = await retry(
  () => processPayment(order),
  {
    maxRetries: 5,
    baseDelayMs: 2000,
    retryableErrors: (error) => {
      // Only retry on specific errors
      return error.message.includes('temporary');
    },
  }
);

// With decorator
class PaymentService {
  @withRetry({ maxRetries: 3 })
  async charge(amount: number): Promise<Receipt> {
    return await stripeClient.charge(amount);
  }
}
```

## Fallback Pattern

### Implementation

```typescript
// fallback.ts

export interface FallbackConfig<T> {
  timeout?: number;
  fallbackValue?: T;
  fallbackFn?: () => T | Promise<T>;
  onFallback?: (error: Error) => void;
}

/**
 * Execute with fallback on failure.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  config: FallbackConfig<T>
): Promise<T> {
  const { timeout, fallbackValue, fallbackFn, onFallback } = config;
  
  try {
    // Add timeout if specified
    if (timeout) {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeout)
        ),
      ]);
    }
    
    return await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    // Notify about fallback
    if (onFallback) {
      onFallback(err);
    }
    
    // Return fallback
    if (fallbackFn) {
      return await fallbackFn();
    }
    
    if (fallbackValue !== undefined) {
      return fallbackValue;
    }
    
    throw err;
  }
}

/**
 * Try multiple sources in order until one succeeds.
 */
export async function tryMultiple<T>(
  sources: Array<() => Promise<T>>,
  options: { timeout?: number } = {}
): Promise<T> {
  const errors: Error[] = [];
  
  for (const source of sources) {
    try {
      if (options.timeout) {
        return await Promise.race([
          source(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), options.timeout)
          ),
        ]);
      }
      return await source();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  throw new AggregateError(errors, 'All sources failed');
}
```

### Usage

```typescript
// Simple fallback value
const config = await withFallback(
  () => fetchRemoteConfig(),
  { fallbackValue: DEFAULT_CONFIG }
);

// Fallback to cache
const data = await withFallback(
  () => fetchFromAPI(),
  {
    timeout: 5000,
    fallbackFn: () => getFromCache(),
    onFallback: (error) => {
      console.warn('Using cached data:', error.message);
      metrics.increment('api_fallback_to_cache');
    },
  }
);

// Try multiple sources
const user = await tryMultiple([
  () => fetchFromPrimaryDB(userId),
  () => fetchFromReplicaDB(userId),
  () => fetchFromCache(userId),
], { timeout: 3000 });
```

## Combined Pattern: Retry with Fallback

```typescript
// resilient-fetch.ts

export interface ResilientFetchConfig<T> {
  retry?: Partial<RetryConfig>;
  fallback?: FallbackConfig<T>;
}

/**
 * Fetch with retry and fallback.
 */
export async function resilientFetch<T>(
  fn: () => Promise<T>,
  config: ResilientFetchConfig<T> = {}
): Promise<T> {
  const { retry: retryConfig, fallback: fallbackConfig } = config;
  
  // Wrap with retry
  const withRetryFn = retryConfig
    ? () => retry(fn, retryConfig)
    : fn;
  
  // Wrap with fallback
  if (fallbackConfig) {
    return withFallback(withRetryFn, fallbackConfig);
  }
  
  return withRetryFn();
}
```

### Real-World Example

```typescript
// app/api/dashboard/route.ts

async function fetchDashboardData(): Promise<DashboardData> {
  // Try primary source with retry
  return resilientFetch(
    () => fetchFromMLPipeline(),
    {
      retry: {
        maxRetries: 2,
        baseDelayMs: 500,
      },
      fallback: {
        timeout: 5000,
        fallbackFn: async () => {
          // Try database snapshot
          const snapshot = await fetchLatestSnapshot();
          if (snapshot) return transformSnapshot(snapshot);
          
          // Last resort: return minimal data
          return {
            status: 'degraded',
            message: 'Using cached data',
            data: getCachedDashboard(),
          };
        },
        onFallback: (error) => {
          console.warn('[Dashboard] Fallback activated:', error.message);
        },
      },
    }
  );
}
```

## Graceful Degradation Pattern

```typescript
// degradation.ts

interface FeatureStatus {
  available: boolean;
  degraded: boolean;
  message?: string;
}

interface DegradedResponse<T> {
  data: T;
  status: FeatureStatus;
}

/**
 * Execute with graceful degradation.
 */
export async function withDegradation<T>(
  fullFn: () => Promise<T>,
  degradedFn: () => Promise<T>,
  minimalFn: () => T
): Promise<DegradedResponse<T>> {
  // Try full functionality
  try {
    const data = await fullFn();
    return {
      data,
      status: { available: true, degraded: false },
    };
  } catch (fullError) {
    console.warn('[Degradation] Full mode failed:', fullError);
  }
  
  // Try degraded mode
  try {
    const data = await degradedFn();
    return {
      data,
      status: {
        available: true,
        degraded: true,
        message: 'Some features unavailable',
      },
    };
  } catch (degradedError) {
    console.warn('[Degradation] Degraded mode failed:', degradedError);
  }
  
  // Minimal mode (synchronous, always works)
  return {
    data: minimalFn(),
    status: {
      available: true,
      degraded: true,
      message: 'Limited functionality',
    },
  };
}
```

### Usage

```typescript
const response = await withDegradation(
  // Full: Real-time data from ML pipeline
  () => fetchRealtimeAnalytics(),
  
  // Degraded: Cached data from database
  () => fetchCachedAnalytics(),
  
  // Minimal: Static placeholder
  () => ({
    message: 'Analytics temporarily unavailable',
    data: [],
    lastUpdated: null,
  })
);

// Response includes status
if (response.status.degraded) {
  showBanner(response.status.message);
}
```

## Production Checklist

- [ ] Retry only on transient errors
- [ ] Exponential backoff with jitter
- [ ] Maximum retry limit
- [ ] Fallback values/functions defined
- [ ] Degradation levels planned
- [ ] Metrics on retry/fallback usage

## Related Patterns

- [Circuit Breaker](./CIRCUIT_BREAKER.md)
- [Resilient Storage](./RESILIENT_STORAGE.md)
