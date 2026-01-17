# Phase 14: Caching

> **Time**: 15 minutes  
> **Prerequisites**: [06-RESILIENCE](./06-RESILIENCE.md)  
> **Produces**: Redis client, cache service, session storage, cache patterns

---

## 🤖 Agent Execution Context

**What you're doing**: Setting up Redis caching infrastructure — connection management, cache service with TTL, session storage, and common caching patterns. This improves performance and reduces database load.

**Expected state BEFORE execution**:
- Phase 06 complete (resilience patterns exist)
- Redis available (local or cloud)
- `packages/backend/src/resilience/` exists

**What you'll create**:
- `packages/backend/src/cache/__init__.py` — Cache module
- `packages/backend/src/cache/client.py` — Redis client with connection pooling
- `packages/backend/src/cache/service.py` — High-level cache service
- `packages/backend/src/cache/patterns.py` — Cache-aside, write-through patterns
- `packages/backend/src/cache/session.py` — Session storage
- `apps/web/lib/cache/client.ts` — Frontend cache utilities
- `packages/backend/tests/cache/test_service.py` — Cache service tests
- `packages/backend/tests/cache/test_patterns.py` — Pattern tests

**Execution approach**:
1. Create Redis client with connection pooling
2. Create cache service with TTL management
3. Implement caching patterns
4. Create session storage
5. Create frontend cache utilities
6. Create tests

**IMPORTANT**:
- Always set TTL on cached items
- Handle Redis connection failures gracefully
- Use consistent key naming conventions
- Consider cache invalidation strategies

**After completion, tell the user**:
- "Phase 14 complete. Caching infrastructure ready."
- "Redis client, cache service, and session storage configured."
- "Set REDIS_URL in environment variables."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/cache/` directory exists

## Purpose

Set up caching infrastructure with:
- Redis connection management
- Cache-aside pattern
- Session storage
- Rate limit storage (used by Phase 08)
- Distributed cache invalidation

---

## Artifacts to Create

### 1. packages/backend/src/cache/__init__.py

```python
"""
Cache module.

Provides Redis-based caching with various patterns.
"""

from .client import RedisClient, get_redis
from .service import CacheService, cache_service
from .patterns import cache_aside, write_through, CacheKey
from .session import SessionStore, session_store

__all__ = [
    "RedisClient",
    "get_redis",
    "CacheService",
    "cache_service",
    "cache_aside",
    "write_through",
    "CacheKey",
    "SessionStore",
    "session_store",
]
```

### 2. packages/backend/src/cache/client.py

```python
"""
Redis client with connection pooling and health checks.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import redis.asyncio as redis
import structlog

logger = structlog.get_logger(__name__)


class RedisClient:
    """
    Redis client wrapper with connection pooling.
    
    Provides automatic reconnection and health monitoring.
    """
    
    def __init__(
        self,
        url: str = "redis://localhost:6379",
        max_connections: int = 10,
        socket_timeout: float = 5.0,
        retry_on_timeout: bool = True,
    ):
        self.url = url
        self._pool: redis.ConnectionPool | None = None
        self._client: redis.Redis | None = None
        self._max_connections = max_connections
        self._socket_timeout = socket_timeout
        self._retry_on_timeout = retry_on_timeout
        self._connected = False
    
    async def connect(self) -> None:
        """Establish connection to Redis."""
        if self._connected:
            return
        
        try:
            self._pool = redis.ConnectionPool.from_url(
                self.url,
                max_connections=self._max_connections,
                socket_timeout=self._socket_timeout,
                retry_on_timeout=self._retry_on_timeout,
                decode_responses=True,
            )
            self._client = redis.Redis(connection_pool=self._pool)
            
            # Test connection
            await self._client.ping()
            self._connected = True
            logger.info("redis_connected", url=self._mask_url(self.url))
            
        except Exception as e:
            logger.error("redis_connection_failed", error=str(e))
            self._connected = False
            raise
    
    async def disconnect(self) -> None:
        """Close Redis connection."""
        if self._client:
            await self._client.close()
        if self._pool:
            await self._pool.disconnect()
        self._connected = False
        logger.info("redis_disconnected")
    
    @property
    def client(self) -> redis.Redis:
        """Get the Redis client instance."""
        if not self._client or not self._connected:
            raise RuntimeError("Redis not connected. Call connect() first.")
        return self._client
    
    async def health_check(self) -> bool:
        """Check if Redis is healthy."""
        try:
            if not self._client:
                return False
            await self._client.ping()
            return True
        except Exception:
            return False
    
    def _mask_url(self, url: str) -> str:
        """Mask password in URL for logging."""
        if "@" in url:
            parts = url.split("@")
            return f"redis://***@{parts[-1]}"
        return url
    
    # Convenience methods
    async def get(self, key: str) -> str | None:
        """Get a value from cache."""
        return await self.client.get(key)
    
    async def set(
        self,
        key: str,
        value: str,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
        xx: bool = False,
    ) -> bool:
        """Set a value in cache."""
        return await self.client.set(key, value, ex=ex, px=px, nx=nx, xx=xx)
    
    async def delete(self, *keys: str) -> int:
        """Delete keys from cache."""
        return await self.client.delete(*keys)
    
    async def exists(self, *keys: str) -> int:
        """Check if keys exist."""
        return await self.client.exists(*keys)
    
    async def expire(self, key: str, seconds: int) -> bool:
        """Set expiration on a key."""
        return await self.client.expire(key, seconds)
    
    async def ttl(self, key: str) -> int:
        """Get TTL of a key."""
        return await self.client.ttl(key)
    
    async def incr(self, key: str) -> int:
        """Increment a counter."""
        return await self.client.incr(key)
    
    async def decr(self, key: str) -> int:
        """Decrement a counter."""
        return await self.client.decr(key)


# Global Redis client instance
_redis_client: RedisClient | None = None


async def get_redis() -> RedisClient:
    """Get the global Redis client instance."""
    global _redis_client
    
    if _redis_client is None:
        import os
        url = os.getenv("REDIS_URL", "redis://localhost:6379")
        _redis_client = RedisClient(url=url)
        await _redis_client.connect()
    
    return _redis_client


@asynccontextmanager
async def redis_connection(url: str | None = None) -> AsyncGenerator[RedisClient, None]:
    """Context manager for Redis connections."""
    import os
    client = RedisClient(url=url or os.getenv("REDIS_URL", "redis://localhost:6379"))
    await client.connect()
    try:
        yield client
    finally:
        await client.disconnect()
```

### 3. packages/backend/src/cache/service.py

```python
"""
High-level cache service.

Provides typed caching with automatic serialization and TTL management.
"""

import json
from datetime import timedelta
from typing import Any, TypeVar, Generic, Callable, Awaitable

import structlog

from .client import RedisClient, get_redis

logger = structlog.get_logger(__name__)

T = TypeVar("T")


class CacheService:
    """
    High-level cache service with typed operations.
    
    Features:
    - Automatic JSON serialization
    - TTL management
    - Namespace prefixing
    - Cache statistics
    """
    
    DEFAULT_TTL = 3600  # 1 hour
    
    def __init__(self, redis: RedisClient, namespace: str = "app"):
        self.redis = redis
        self.namespace = namespace
        self._hits = 0
        self._misses = 0
    
    def _key(self, key: str) -> str:
        """Generate namespaced key."""
        return f"{self.namespace}:{key}"
    
    async def get(self, key: str) -> Any | None:
        """
        Get a value from cache.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found
        """
        try:
            value = await self.redis.get(self._key(key))
            if value is None:
                self._misses += 1
                return None
            
            self._hits += 1
            return json.loads(value)
        except Exception as e:
            logger.warning("cache_get_error", key=key, error=str(e))
            self._misses += 1
            return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: int | timedelta | None = None,
    ) -> bool:
        """
        Set a value in cache.
        
        Args:
            key: Cache key
            value: Value to cache (must be JSON serializable)
            ttl: Time to live in seconds or timedelta
            
        Returns:
            True if successful
        """
        try:
            if isinstance(ttl, timedelta):
                ttl = int(ttl.total_seconds())
            
            serialized = json.dumps(value)
            await self.redis.set(
                self._key(key),
                serialized,
                ex=ttl or self.DEFAULT_TTL,
            )
            return True
        except Exception as e:
            logger.warning("cache_set_error", key=key, error=str(e))
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete a key from cache."""
        try:
            await self.redis.delete(self._key(key))
            return True
        except Exception as e:
            logger.warning("cache_delete_error", key=key, error=str(e))
            return False
    
    async def delete_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching a pattern.
        
        Args:
            pattern: Key pattern (e.g., "user:*")
            
        Returns:
            Number of keys deleted
        """
        try:
            full_pattern = self._key(pattern)
            keys = []
            async for key in self.redis.client.scan_iter(match=full_pattern):
                keys.append(key)
            
            if keys:
                return await self.redis.delete(*keys)
            return 0
        except Exception as e:
            logger.warning("cache_delete_pattern_error", pattern=pattern, error=str(e))
            return 0
    
    async def get_or_set(
        self,
        key: str,
        factory: Callable[[], Awaitable[T]],
        ttl: int | timedelta | None = None,
    ) -> T:
        """
        Get from cache or compute and cache.
        
        Args:
            key: Cache key
            factory: Async function to compute value if not cached
            ttl: Time to live
            
        Returns:
            Cached or computed value
        """
        cached = await self.get(key)
        if cached is not None:
            return cached
        
        value = await factory()
        await self.set(key, value, ttl)
        return value
    
    async def increment(self, key: str, amount: int = 1) -> int:
        """Increment a counter."""
        try:
            full_key = self._key(key)
            if amount == 1:
                return await self.redis.incr(full_key)
            return await self.redis.client.incrby(full_key, amount)
        except Exception as e:
            logger.warning("cache_increment_error", key=key, error=str(e))
            return 0
    
    async def decrement(self, key: str, amount: int = 1) -> int:
        """Decrement a counter."""
        try:
            full_key = self._key(key)
            if amount == 1:
                return await self.redis.decr(full_key)
            return await self.redis.client.decrby(full_key, amount)
        except Exception as e:
            logger.warning("cache_decrement_error", key=key, error=str(e))
            return 0
    
    @property
    def stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        total = self._hits + self._misses
        hit_rate = self._hits / total if total > 0 else 0
        return {
            "hits": self._hits,
            "misses": self._misses,
            "total": total,
            "hit_rate": hit_rate,
        }
    
    def reset_stats(self) -> None:
        """Reset cache statistics."""
        self._hits = 0
        self._misses = 0


# Global cache service instance
_cache_service: CacheService | None = None


async def get_cache_service() -> CacheService:
    """Get the global cache service instance."""
    global _cache_service
    
    if _cache_service is None:
        redis = await get_redis()
        _cache_service = CacheService(redis)
    
    return _cache_service


# Alias for convenience
cache_service = get_cache_service
```

### 4. packages/backend/src/cache/patterns.py

```python
"""
Common caching patterns.

Provides decorators and utilities for cache-aside, write-through, etc.
"""

import functools
import hashlib
import json
from datetime import timedelta
from typing import Any, Callable, TypeVar, ParamSpec

import structlog

from .service import CacheService, get_cache_service

logger = structlog.get_logger(__name__)

P = ParamSpec("P")
T = TypeVar("T")


class CacheKey:
    """
    Cache key builder with consistent formatting.
    
    Usage:
        key = CacheKey("user").add("profile").add(user_id).build()
        # Returns: "user:profile:123"
    """
    
    def __init__(self, *parts: str):
        self._parts = list(parts)
    
    def add(self, part: str | int) -> "CacheKey":
        """Add a part to the key."""
        self._parts.append(str(part))
        return self
    
    def build(self) -> str:
        """Build the final key string."""
        return ":".join(self._parts)
    
    @staticmethod
    def hash_args(*args: Any, **kwargs: Any) -> str:
        """Create a hash from function arguments."""
        data = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
        return hashlib.md5(data.encode()).hexdigest()[:12]


def cache_aside(
    key_prefix: str,
    ttl: int | timedelta = 3600,
    key_builder: Callable[..., str] | None = None,
):
    """
    Cache-aside pattern decorator.
    
    Checks cache before calling function, caches result on miss.
    
    Args:
        key_prefix: Prefix for cache keys
        ttl: Time to live in seconds or timedelta
        key_builder: Optional function to build cache key from args
        
    Usage:
        @cache_aside("user:profile", ttl=300)
        async def get_user_profile(user_id: str) -> dict:
            return await db.get_user(user_id)
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            # Build cache key
            if key_builder:
                key = f"{key_prefix}:{key_builder(*args, **kwargs)}"
            else:
                key = f"{key_prefix}:{CacheKey.hash_args(*args, **kwargs)}"
            
            # Try cache first
            cache = await get_cache_service()
            cached = await cache.get(key)
            if cached is not None:
                logger.debug("cache_hit", key=key)
                return cached
            
            # Cache miss - call function
            logger.debug("cache_miss", key=key)
            result = await func(*args, **kwargs)
            
            # Cache result
            await cache.set(key, result, ttl)
            
            return result
        
        return wrapper
    return decorator


def write_through(
    key_prefix: str,
    ttl: int | timedelta = 3600,
    key_builder: Callable[..., str] | None = None,
):
    """
    Write-through pattern decorator.
    
    Writes to cache and database simultaneously.
    
    Args:
        key_prefix: Prefix for cache keys
        ttl: Time to live
        key_builder: Optional function to build cache key
        
    Usage:
        @write_through("user:profile")
        async def update_user_profile(user_id: str, data: dict) -> dict:
            return await db.update_user(user_id, data)
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            # Call function first (write to DB)
            result = await func(*args, **kwargs)
            
            # Build cache key
            if key_builder:
                key = f"{key_prefix}:{key_builder(*args, **kwargs)}"
            else:
                key = f"{key_prefix}:{CacheKey.hash_args(*args, **kwargs)}"
            
            # Update cache
            cache = await get_cache_service()
            await cache.set(key, result, ttl)
            logger.debug("cache_updated", key=key)
            
            return result
        
        return wrapper
    return decorator


def invalidate_cache(key_pattern: str):
    """
    Cache invalidation decorator.
    
    Invalidates cache entries matching pattern after function executes.
    
    Args:
        key_pattern: Pattern to match (e.g., "user:*" or "user:{user_id}")
        
    Usage:
        @invalidate_cache("user:{user_id}:*")
        async def delete_user(user_id: str) -> None:
            await db.delete_user(user_id)
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            result = await func(*args, **kwargs)
            
            # Build pattern from args
            pattern = key_pattern
            
            # Simple substitution for named parameters
            for key, value in kwargs.items():
                pattern = pattern.replace(f"{{{key}}}", str(value))
            
            # Invalidate matching keys
            cache = await get_cache_service()
            deleted = await cache.delete_pattern(pattern)
            logger.debug("cache_invalidated", pattern=pattern, deleted=deleted)
            
            return result
        
        return wrapper
    return decorator


class CacheManager:
    """
    Cache manager for complex caching scenarios.
    
    Provides methods for batch operations and cache warming.
    """
    
    def __init__(self, cache: CacheService):
        self.cache = cache
    
    async def warm_cache(
        self,
        keys: list[str],
        loader: Callable[[str], Any],
        ttl: int = 3600,
    ) -> int:
        """
        Warm cache with multiple keys.
        
        Args:
            keys: List of keys to warm
            loader: Function to load value for each key
            ttl: Time to live
            
        Returns:
            Number of keys warmed
        """
        warmed = 0
        for key in keys:
            try:
                value = await loader(key)
                if value is not None:
                    await self.cache.set(key, value, ttl)
                    warmed += 1
            except Exception as e:
                logger.warning("cache_warm_error", key=key, error=str(e))
        
        logger.info("cache_warmed", count=warmed, total=len(keys))
        return warmed
    
    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        """
        Get multiple values from cache.
        
        Args:
            keys: List of keys to get
            
        Returns:
            Dictionary of key -> value (missing keys not included)
        """
        result = {}
        for key in keys:
            value = await self.cache.get(key)
            if value is not None:
                result[key] = value
        return result
    
    async def set_many(
        self,
        items: dict[str, Any],
        ttl: int = 3600,
    ) -> int:
        """
        Set multiple values in cache.
        
        Args:
            items: Dictionary of key -> value
            ttl: Time to live
            
        Returns:
            Number of items set
        """
        count = 0
        for key, value in items.items():
            if await self.cache.set(key, value, ttl):
                count += 1
        return count
```


### 5. packages/backend/src/cache/session.py

```python
"""
Session storage using Redis.

Provides secure session management with automatic expiration.
"""

import json
import secrets
from datetime import timedelta
from typing import Any

import structlog

from .client import RedisClient, get_redis

logger = structlog.get_logger(__name__)


class SessionStore:
    """
    Redis-based session storage.
    
    Features:
    - Secure session ID generation
    - Automatic expiration
    - Session data encryption (optional)
    """
    
    SESSION_PREFIX = "session"
    DEFAULT_TTL = 86400  # 24 hours
    
    def __init__(self, redis: RedisClient, ttl: int = DEFAULT_TTL):
        self.redis = redis
        self.ttl = ttl
    
    def _key(self, session_id: str) -> str:
        """Generate session key."""
        return f"{self.SESSION_PREFIX}:{session_id}"
    
    @staticmethod
    def generate_session_id() -> str:
        """Generate a secure session ID."""
        return secrets.token_urlsafe(32)
    
    async def create(
        self,
        data: dict[str, Any] | None = None,
        ttl: int | None = None,
    ) -> str:
        """
        Create a new session.
        
        Args:
            data: Initial session data
            ttl: Custom TTL in seconds
            
        Returns:
            Session ID
        """
        session_id = self.generate_session_id()
        session_data = {
            "id": session_id,
            "data": data or {},
            "created_at": None,  # Will be set by Redis
        }
        
        await self.redis.set(
            self._key(session_id),
            json.dumps(session_data),
            ex=ttl or self.ttl,
        )
        
        logger.debug("session_created", session_id=session_id[:8] + "...")
        return session_id
    
    async def get(self, session_id: str) -> dict[str, Any] | None:
        """
        Get session data.
        
        Args:
            session_id: Session ID
            
        Returns:
            Session data or None if not found/expired
        """
        value = await self.redis.get(self._key(session_id))
        if value is None:
            return None
        
        try:
            session = json.loads(value)
            return session.get("data", {})
        except json.JSONDecodeError:
            logger.warning("session_decode_error", session_id=session_id[:8] + "...")
            return None
    
    async def set(
        self,
        session_id: str,
        data: dict[str, Any],
        ttl: int | None = None,
    ) -> bool:
        """
        Update session data.
        
        Args:
            session_id: Session ID
            data: New session data
            ttl: Optional new TTL
            
        Returns:
            True if successful
        """
        key = self._key(session_id)
        
        # Check if session exists
        if not await self.redis.exists(key):
            return False
        
        session_data = {
            "id": session_id,
            "data": data,
        }
        
        await self.redis.set(
            key,
            json.dumps(session_data),
            ex=ttl or self.ttl,
        )
        
        return True
    
    async def update(
        self,
        session_id: str,
        updates: dict[str, Any],
    ) -> bool:
        """
        Partially update session data.
        
        Args:
            session_id: Session ID
            updates: Fields to update
            
        Returns:
            True if successful
        """
        current = await self.get(session_id)
        if current is None:
            return False
        
        current.update(updates)
        return await self.set(session_id, current)
    
    async def delete(self, session_id: str) -> bool:
        """
        Delete a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            True if deleted
        """
        result = await self.redis.delete(self._key(session_id))
        if result:
            logger.debug("session_deleted", session_id=session_id[:8] + "...")
        return result > 0
    
    async def refresh(self, session_id: str, ttl: int | None = None) -> bool:
        """
        Refresh session TTL.
        
        Args:
            session_id: Session ID
            ttl: New TTL in seconds
            
        Returns:
            True if refreshed
        """
        return await self.redis.expire(
            self._key(session_id),
            ttl or self.ttl,
        )
    
    async def exists(self, session_id: str) -> bool:
        """Check if session exists."""
        return await self.redis.exists(self._key(session_id)) > 0


# Global session store instance
_session_store: SessionStore | None = None


async def get_session_store() -> SessionStore:
    """Get the global session store instance."""
    global _session_store
    
    if _session_store is None:
        redis = await get_redis()
        _session_store = SessionStore(redis)
    
    return _session_store


# Alias for convenience
session_store = get_session_store
```

### 6. apps/web/lib/cache/client.ts

```typescript
/**
 * Frontend cache utilities.
 * 
 * Provides in-memory caching for API responses and computed values.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Simple in-memory cache with TTL support.
 */
export class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL: number;

  constructor(defaultTTL: number = 300000) { // 5 minutes default
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get a value from cache.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache.
   */
  set<T>(key: string, value: T, ttl?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    });
  }

  /**
   * Delete a key from cache.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get or compute a value.
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Remove expired entries.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics.
   */
  get stats() {
    return {
      size: this.cache.size,
    };
  }
}

/**
 * SWR-like cache with stale-while-revalidate pattern.
 */
export class SWRCache {
  private cache = new Map<string, {
    value: unknown;
    fetchedAt: number;
    staleAt: number;
    expiresAt: number;
  }>();

  /**
   * Get a value, revalidating if stale.
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: {
      staleTime?: number;  // Time until data is considered stale
      cacheTime?: number;  // Time until data is removed from cache
    } = {}
  ): Promise<T> {
    const { staleTime = 60000, cacheTime = 300000 } = options;
    const now = Date.now();
    const entry = this.cache.get(key);

    // No cache entry - fetch fresh
    if (!entry || now > entry.expiresAt) {
      const value = await fetcher();
      this.cache.set(key, {
        value,
        fetchedAt: now,
        staleAt: now + staleTime,
        expiresAt: now + cacheTime,
      });
      return value;
    }

    // Cache hit - check if stale
    if (now > entry.staleAt) {
      // Return stale data immediately, revalidate in background
      fetcher().then((value) => {
        this.cache.set(key, {
          value,
          fetchedAt: Date.now(),
          staleAt: Date.now() + staleTime,
          expiresAt: Date.now() + cacheTime,
        });
      });
    }

    return entry.value as T;
  }

  /**
   * Invalidate a cache entry.
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate entries matching a pattern.
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
}

// Global cache instances
export const memoryCache = new MemoryCache();
export const swrCache = new SWRCache();

// Cleanup expired entries periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    memoryCache.cleanup();
  }, 60000); // Every minute
}
```

### 7. apps/web/lib/cache/index.ts

```typescript
export * from './client';
```

---

## Cache Testing

### 8. packages/backend/tests/cache/__init__.py

```python
"""Cache tests package."""
```

### 9. packages/backend/tests/cache/test_service.py

```python
"""
Cache service tests.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.cache.service import CacheService


class TestCacheService:
    """Tests for CacheService."""
    
    @pytest.fixture
    def mock_redis(self):
        """Create mock Redis client."""
        mock = AsyncMock()
        mock.get = AsyncMock(return_value=None)
        mock.set = AsyncMock(return_value=True)
        mock.delete = AsyncMock(return_value=1)
        mock.client = MagicMock()
        mock.client.scan_iter = AsyncMock(return_value=iter([]))
        return mock
    
    @pytest.fixture
    def cache(self, mock_redis):
        return CacheService(mock_redis, namespace="test")
    
    @pytest.mark.asyncio
    async def test_get_miss(self, cache, mock_redis):
        """Should return None on cache miss."""
        mock_redis.get.return_value = None
        
        result = await cache.get("key")
        
        assert result is None
        assert cache.stats["misses"] == 1
    
    @pytest.mark.asyncio
    async def test_get_hit(self, cache, mock_redis):
        """Should return cached value on hit."""
        mock_redis.get.return_value = '{"name": "test"}'
        
        result = await cache.get("key")
        
        assert result == {"name": "test"}
        assert cache.stats["hits"] == 1
    
    @pytest.mark.asyncio
    async def test_set(self, cache, mock_redis):
        """Should set value in cache."""
        result = await cache.set("key", {"name": "test"}, ttl=300)
        
        assert result is True
        mock_redis.set.assert_called_once()
        call_args = mock_redis.set.call_args
        assert "test:key" in call_args[0]
        assert call_args[1]["ex"] == 300
    
    @pytest.mark.asyncio
    async def test_set_default_ttl(self, cache, mock_redis):
        """Should use default TTL when not specified."""
        await cache.set("key", "value")
        
        call_args = mock_redis.set.call_args
        assert call_args[1]["ex"] == CacheService.DEFAULT_TTL
    
    @pytest.mark.asyncio
    async def test_delete(self, cache, mock_redis):
        """Should delete key from cache."""
        result = await cache.delete("key")
        
        assert result is True
        mock_redis.delete.assert_called_with("test:key")
    
    @pytest.mark.asyncio
    async def test_get_or_set_cached(self, cache, mock_redis):
        """Should return cached value without calling factory."""
        mock_redis.get.return_value = '"cached"'
        factory = AsyncMock(return_value="computed")
        
        result = await cache.get_or_set("key", factory)
        
        assert result == "cached"
        factory.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_get_or_set_miss(self, cache, mock_redis):
        """Should call factory and cache result on miss."""
        mock_redis.get.return_value = None
        factory = AsyncMock(return_value="computed")
        
        result = await cache.get_or_set("key", factory)
        
        assert result == "computed"
        factory.assert_called_once()
        mock_redis.set.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_increment(self, cache, mock_redis):
        """Should increment counter."""
        mock_redis.incr.return_value = 5
        
        result = await cache.increment("counter")
        
        assert result == 5
        mock_redis.incr.assert_called_with("test:counter")
    
    def test_stats(self, cache):
        """Should track cache statistics."""
        cache._hits = 10
        cache._misses = 5
        
        stats = cache.stats
        
        assert stats["hits"] == 10
        assert stats["misses"] == 5
        assert stats["total"] == 15
        assert stats["hit_rate"] == 10 / 15
    
    def test_reset_stats(self, cache):
        """Should reset statistics."""
        cache._hits = 10
        cache._misses = 5
        
        cache.reset_stats()
        
        assert cache.stats["hits"] == 0
        assert cache.stats["misses"] == 0
```

### 10. packages/backend/tests/cache/test_patterns.py

```python
"""
Cache pattern tests.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.cache.patterns import CacheKey, cache_aside, write_through


class TestCacheKey:
    """Tests for CacheKey."""
    
    def test_build_simple(self):
        key = CacheKey("user").build()
        assert key == "user"
    
    def test_build_multiple_parts(self):
        key = CacheKey("user", "profile").add("123").build()
        assert key == "user:profile:123"
    
    def test_add_chaining(self):
        key = CacheKey("api").add("v1").add("users").add(42).build()
        assert key == "api:v1:users:42"
    
    def test_hash_args(self):
        hash1 = CacheKey.hash_args("arg1", key="value")
        hash2 = CacheKey.hash_args("arg1", key="value")
        hash3 = CacheKey.hash_args("arg2", key="value")
        
        assert hash1 == hash2  # Same args = same hash
        assert hash1 != hash3  # Different args = different hash
        assert len(hash1) == 12  # Truncated hash


class TestCacheAside:
    """Tests for cache_aside decorator."""
    
    @pytest.mark.asyncio
    async def test_returns_cached_value(self):
        """Should return cached value without calling function."""
        mock_cache = AsyncMock()
        mock_cache.get.return_value = {"cached": True}
        
        with patch("src.cache.patterns.get_cache_service", return_value=mock_cache):
            @cache_aside("test")
            async def get_data(id: str):
                return {"fresh": True}
            
            result = await get_data("123")
            
            assert result == {"cached": True}
    
    @pytest.mark.asyncio
    async def test_calls_function_on_miss(self):
        """Should call function and cache result on miss."""
        mock_cache = AsyncMock()
        mock_cache.get.return_value = None
        
        with patch("src.cache.patterns.get_cache_service", return_value=mock_cache):
            @cache_aside("test", ttl=300)
            async def get_data(id: str):
                return {"fresh": True}
            
            result = await get_data("123")
            
            assert result == {"fresh": True}
            mock_cache.set.assert_called_once()


class TestWriteThrough:
    """Tests for write_through decorator."""
    
    @pytest.mark.asyncio
    async def test_updates_cache_after_write(self):
        """Should update cache after function executes."""
        mock_cache = AsyncMock()
        
        with patch("src.cache.patterns.get_cache_service", return_value=mock_cache):
            @write_through("test")
            async def update_data(id: str, data: dict):
                return {"id": id, **data}
            
            result = await update_data("123", {"name": "test"})
            
            assert result == {"id": "123", "name": "test"}
            mock_cache.set.assert_called_once()
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 14
```

**Manual checks:**

```bash
# 1. Start Redis (if not running)
docker run -d -p 6379:6379 redis:alpine

# 2. Run cache tests
cd packages/backend
pytest tests/cache/ -v

# 3. Test Redis connection
python -c "import asyncio; from src.cache import get_redis; asyncio.run(get_redis())"
```

**Success Criteria**:
- [ ] Redis client connects successfully
- [ ] Cache service handles get/set/delete
- [ ] Cache patterns work correctly
- [ ] Session storage creates/retrieves sessions
- [ ] All cache tests pass

---

## Next Phase

Proceed to [15-DEPLOYMENT.md](./15-DEPLOYMENT.md) for deployment configuration.
