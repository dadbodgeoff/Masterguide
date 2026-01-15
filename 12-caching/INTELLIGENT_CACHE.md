# Intelligent Caching Pattern

> Multi-layer caching with TTL by type, get-or-generate pattern, and graceful invalidation.

**Time to implement**: 5 hours  
**Complexity**: Medium  
**Dependencies**: Supabase (optional Redis)

## The Problem

AI usually implements caching as simple key-value with fixed TTL. Production needs:
- Different TTLs for different content types
- Memory cache + database fallback
- Get-or-generate pattern (cache-aside with generation)
- Proper invalidation without cache stampede
- Generation time tracking for optimization

## Core Implementation

```typescript
// persistence/cache-store.ts

// In-memory cache layer
const memoryCache = new Map<string, CachedItem>();

// Different content types need different TTLs
const CACHE_DURATIONS: Record<CacheType, number> = {
  daily_briefing: 4 * 60 * 60 * 1000,    // 4 hours - regenerated daily
  weekly_summary: 24 * 60 * 60 * 1000,   // 24 hours - expensive to generate
  country_analysis: 2 * 60 * 60 * 1000,  // 2 hours - changes frequently
  alert_digest: 30 * 60 * 1000,          // 30 minutes - time-sensitive
  pattern_report: 6 * 60 * 60 * 1000,    // 6 hours - moderate freshness
};

type CacheType = keyof typeof CACHE_DURATIONS;

interface CachedItem {
  id: string;
  cache_type: CacheType;
  cache_key: string;
  content_markdown: string;
  content_structured: Record<string, unknown>;
  generated_at: string;
  expires_at: string;
  generation_time_ms?: number;
}

/**
 * Generate composite cache key
 */
function getCacheKey(type: CacheType, key: string): string {
  return `${type}:${key}`;
}
```

## Write Operations

```typescript
/**
 * Cache content with type-specific TTL
 */
export async function cacheContent(
  type: CacheType,
  key: string,
  markdown: string,
  structured: Record<string, unknown>,
  generationTimeMs?: number
): Promise<void> {
  const cacheKey = getCacheKey(type, key);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_DURATIONS[type]);
  
  const cache: CachedItem = {
    id: crypto.randomUUID(),
    cache_type: type,
    cache_key: key,
    content_markdown: markdown,
    content_structured: structured,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    generation_time_ms: generationTimeMs,
  };
  
  // Layer 1: Memory cache (fast)
  memoryCache.set(cacheKey, cache);
  
  // Layer 2: Database cache (persistent)
  if (isPersistenceEnabled()) {
    await supabase
      .from('cache')
      .upsert({
        cache_type: type,
        cache_key: key,
        content_markdown: markdown,
        content_structured: structured,
        generated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        generation_time_ms: generationTimeMs,
      }, { onConflict: 'cache_type,cache_key' });
  }
}
```

## Read Operations with Fallback

```typescript
/**
 * Get cached content with memory -> DB fallback
 */
export async function getCached(
  type: CacheType,
  key: string
): Promise<CachedItem | null> {
  const cacheKey = getCacheKey(type, key);
  const now = new Date();
  
  // Layer 1: Check memory cache
  const memoryCached = memoryCache.get(cacheKey);
  if (memoryCached) {
    if (new Date(memoryCached.expires_at) > now) {
      return memoryCached;
    }
    // Expired - remove from memory
    memoryCache.delete(cacheKey);
  }
  
  // Layer 2: Check database
  if (!isPersistenceEnabled()) return null;
  
  const { data } = await supabase
    .from('cache')
    .select('*')
    .eq('cache_type', type)
    .eq('cache_key', key)
    .gt('expires_at', now.toISOString())
    .single();
  
  if (data) {
    // Promote to memory cache for next access
    memoryCache.set(cacheKey, data as CachedItem);
    return data as CachedItem;
  }
  
  return null;
}
```

## Get-or-Generate Pattern

This is the key pattern AI usually misses - combining cache lookup with generation:

```typescript
/**
 * Get from cache or generate and cache
 * Prevents duplicate generation and tracks timing
 */
export async function getOrGenerate<T extends Record<string, unknown>>(
  type: CacheType,
  key: string,
  generator: () => Promise<{ markdown: string; structured: T }>
): Promise<{
  markdown: string;
  structured: T;
  fromCache: boolean;
  generationTimeMs?: number;
}> {
  // Try cache first
  const cached = await getCached(type, key);
  if (cached) {
    return {
      markdown: cached.content_markdown,
      structured: cached.content_structured as T,
      fromCache: true,
      generationTimeMs: cached.generation_time_ms,
    };
  }
  
  // Generate new content with timing
  const startTime = Date.now();
  const { markdown, structured } = await generator();
  const generationTimeMs = Date.now() - startTime;
  
  // Cache the result
  await cacheContent(type, key, markdown, structured, generationTimeMs);
  
  return {
    markdown,
    structured,
    fromCache: false,
    generationTimeMs,
  };
}
```

## Usage Example

```typescript
// In your API route
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || getTodayDate();
  
  const result = await getOrGenerate(
    'daily_briefing',
    date,
    async () => {
      // Expensive generation only runs on cache miss
      const events = await fetchTodayEvents();
      const analysis = await generateAIAnalysis(events);
      
      return {
        markdown: analysis.markdown,
        structured: {
          events: events.length,
          riskScore: analysis.riskScore,
          topCountries: analysis.topCountries,
        },
      };
    }
  );
  
  return Response.json({
    ...result.structured,
    markdown: result.markdown,
    cached: result.fromCache,
    generationMs: result.generationTimeMs,
  });
}
```

## Cache Invalidation

```typescript
/**
 * Invalidate specific cache entry
 */
export async function invalidateCache(type: CacheType, key: string): Promise<void> {
  const cacheKey = getCacheKey(type, key);
  memoryCache.delete(cacheKey);
  
  if (isPersistenceEnabled()) {
    await supabase
      .from('cache')
      .delete()
      .eq('cache_type', type)
      .eq('cache_key', key);
  }
}

/**
 * Invalidate all entries of a type
 */
export async function invalidateCacheType(type: CacheType): Promise<void> {
  // Clear from memory
  for (const key of memoryCache.keys()) {
    if (key.startsWith(`${type}:`)) {
      memoryCache.delete(key);
    }
  }
  
  // Clear from database
  if (isPersistenceEnabled()) {
    await supabase
      .from('cache')
      .delete()
      .eq('cache_type', type);
  }
}

/**
 * Clear expired entries (run periodically)
 */
export async function clearExpiredCache(): Promise<number> {
  const now = new Date();
  let cleared = 0;
  
  // Clear from memory
  for (const [key, cache] of memoryCache) {
    if (new Date(cache.expires_at) <= now) {
      memoryCache.delete(key);
      cleared++;
    }
  }
  
  // Clear from database via RPC
  if (isPersistenceEnabled()) {
    const { data } = await supabase.rpc('cleanup_expired_cache');
    cleared = Math.max(cleared, data || 0);
  }
  
  return cleared;
}
```

## Database Schema

```sql
CREATE TABLE cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_type TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  content_markdown TEXT,
  content_structured JSONB,
  generated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  generation_time_ms INTEGER,
  
  UNIQUE(cache_type, cache_key)
);

-- Index for expiry cleanup
CREATE INDEX idx_cache_expires ON cache(expires_at);

-- Cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM cache WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

## Cache Statistics

```typescript
/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  memoryEntries: number;
  byType: Record<CacheType, number>;
} {
  const byType: Record<string, number> = {};
  
  for (const cache of memoryCache.values()) {
    byType[cache.cache_type] = (byType[cache.cache_type] || 0) + 1;
  }
  
  return {
    memoryEntries: memoryCache.size,
    byType: byType as Record<CacheType, number>,
  };
}
```

## Key Patterns

1. **Type-Specific TTLs** - Different content has different freshness requirements
2. **Two-Layer Cache** - Memory for speed, DB for persistence across restarts
3. **Get-or-Generate** - Single function handles cache check + generation + caching
4. **Generation Timing** - Track how long generation takes for optimization
5. **Cache Promotion** - DB hits get promoted to memory for subsequent requests
6. **Graceful Degradation** - Works without DB, just loses persistence

## Anti-Patterns to Avoid

- ❌ Single TTL for all content types
- ❌ Separate cache check and generation calls (race conditions)
- ❌ No expiry cleanup (memory leaks)
- ❌ Throwing errors when cache is unavailable
- ❌ Not tracking generation time (can't optimize)
