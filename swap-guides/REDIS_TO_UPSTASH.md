# Swap Guide: Redis → Upstash

> Replace self-hosted Redis with Upstash serverless Redis

## Why Swap?

| Self-hosted Redis | Upstash |
|-------------------|---------|
| You manage server | Serverless, managed |
| Pay for server 24/7 | Pay per request |
| Need to scale manually | Auto-scales |
| Any Redis client | REST API + Redis protocol |
| Full Redis features | Most features supported |

**Best for:** Serverless deployments (Vercel, Cloudflare), low-traffic apps, or when you don't want to manage infrastructure.

## Affected Files

### Must Update

```
packages/backend/src/cache/
└── client.py                 # Update connection URL/client

Environment variables          # New Upstash URL and token
```

### No Change Needed

```
packages/backend/src/cache/
├── service.py                # Uses client abstraction
├── patterns.py               # Uses client abstraction
└── session.py                # Uses client abstraction

packages/backend/src/resilience/
└── distributed_lock.py       # Uses Redis client

packages/backend/src/jobs/
└── queue.py                  # Uses Redis client
```

The abstraction layer means only the client needs to change.

---

## Current Pattern (Standard Redis)

```python
# packages/backend/src/cache/client.py
import redis.asyncio as redis

class RedisClient:
    def __init__(self, url: str = "redis://localhost:6379"):
        self.url = url
        self._pool = None
        self._client = None
    
    async def connect(self):
        self._pool = redis.ConnectionPool.from_url(
            self.url,
            max_connections=10,
            decode_responses=True,
        )
        self._client = redis.Redis(connection_pool=self._pool)
        await self._client.ping()
```

---

## Replacement Pattern (Upstash)

### Option 1: Use Upstash Redis SDK (Recommended)

Upstash provides a Redis-compatible client that works over HTTP, which is better for serverless.

```bash
pip install upstash-redis
```

```python
# packages/backend/src/cache/client.py
from upstash_redis import Redis
import structlog

logger = structlog.get_logger(__name__)


class RedisClient:
    """
    Redis client using Upstash.
    
    Upstash uses HTTP under the hood, which works better in serverless
    environments where TCP connections are expensive.
    """
    
    def __init__(
        self,
        url: str | None = None,
        token: str | None = None,
    ):
        self.url = url or os.getenv("UPSTASH_REDIS_REST_URL")
        self.token = token or os.getenv("UPSTASH_REDIS_REST_TOKEN")
        self._client: Redis | None = None
        self._connected = False
    
    async def connect(self) -> None:
        """Initialize Upstash client."""
        if self._connected:
            return
        
        self._client = Redis(url=self.url, token=self.token)
        self._connected = True
        logger.info("upstash_connected")
    
    async def disconnect(self) -> None:
        """Upstash is stateless, nothing to disconnect."""
        self._connected = False
        logger.info("upstash_disconnected")
    
    @property
    def client(self) -> Redis:
        if not self._client:
            raise RuntimeError("Redis not connected")
        return self._client
    
    async def health_check(self) -> bool:
        """Check if Upstash is reachable."""
        try:
            result = self.client.ping()
            return result == "PONG"
        except Exception:
            return False
    
    # Standard Redis operations
    async def get(self, key: str) -> str | None:
        return self.client.get(key)
    
    async def set(
        self,
        key: str,
        value: str,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
        xx: bool = False,
    ) -> bool:
        if ex:
            return self.client.setex(key, ex, value)
        elif nx:
            return self.client.setnx(key, value)
        else:
            return self.client.set(key, value)
    
    async def delete(self, *keys: str) -> int:
        return self.client.delete(*keys)
    
    async def exists(self, *keys: str) -> int:
        return self.client.exists(*keys)
    
    async def expire(self, key: str, seconds: int) -> bool:
        return self.client.expire(key, seconds)
    
    async def ttl(self, key: str) -> int:
        return self.client.ttl(key)
    
    async def incr(self, key: str) -> int:
        return self.client.incr(key)
    
    async def decr(self, key: str) -> int:
        return self.client.decr(key)
    
    # List operations (for job queue)
    async def lpush(self, key: str, *values: str) -> int:
        return self.client.lpush(key, *values)
    
    async def rpop(self, key: str) -> str | None:
        return self.client.rpop(key)
    
    async def llen(self, key: str) -> int:
        return self.client.llen(key)
    
    async def lrange(self, key: str, start: int, stop: int) -> list:
        return self.client.lrange(key, start, stop)


# Global instance
_redis_client: RedisClient | None = None


async def get_redis() -> RedisClient:
    """Get the global Redis client."""
    global _redis_client
    
    if _redis_client is None:
        _redis_client = RedisClient()
        await _redis_client.connect()
    
    return _redis_client
```

### Option 2: Use Standard Redis Client with Upstash URL

Upstash also supports the standard Redis protocol, so you can use the existing client with just a URL change:

```python
# Just change the URL format
# From: redis://localhost:6379
# To:   rediss://default:TOKEN@ENDPOINT:PORT

import os

REDIS_URL = os.getenv(
    "REDIS_URL",
    "rediss://default:xxx@xxx.upstash.io:6379"
)
```

Note the `rediss://` (with double s) for TLS.

---

## Migration Steps

### 1. Create Upstash Database

1. Sign up at [upstash.com](https://upstash.com)
2. Create a new Redis database
3. Choose region closest to your deployment
4. Get REST URL and token (or Redis URL for Option 2)

### 2. Update Environment Variables

```bash
# Option 1: REST API (recommended for serverless)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Option 2: Redis protocol
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
```

### 3. Install SDK (Option 1 only)

```bash
pip install upstash-redis
```

### 4. Update Client

Replace `packages/backend/src/cache/client.py` with the Upstash version.

### 5. Test

```bash
# Test cache
pytest tests/cache/ -v

# Test jobs (uses Redis for queue)
pytest tests/jobs/ -v

# Test resilience (uses Redis for locks)
pytest tests/resilience/ -v
```

---

## Key Differences

| Standard Redis | Upstash |
|----------------|---------|
| TCP connection | HTTP requests |
| Connection pooling | Stateless |
| `redis://` | `rediss://` (TLS) or REST |
| Sync by default | Sync (REST SDK) |
| Full Lua scripting | Limited Lua support |
| Pub/Sub | Pub/Sub supported |

### Limitations

Upstash has some limitations vs full Redis:
- Some commands not supported (check docs)
- Lua scripts have restrictions
- No Redis modules
- Rate limits on free tier

For most SaaS use cases (caching, sessions, rate limiting, job queues), Upstash works fine.

---

## Serverless Considerations

If deploying to Vercel/serverless:

1. **Use REST API** — HTTP works better than TCP in serverless
2. **No connection pooling** — Each request is independent
3. **Watch for cold starts** — First request may be slower
4. **Use regional deployment** — Put Upstash in same region as your functions

```python
# For serverless, initialize client per-request
async def get_redis():
    # Don't cache globally in serverless
    client = RedisClient()
    await client.connect()
    return client
```

---

## Verification Checklist

- [ ] Upstash database created
- [ ] Environment variables set
- [ ] Client updated (Option 1 or 2)
- [ ] Cache operations work (get, set, delete)
- [ ] Rate limiting works
- [ ] Distributed locks work
- [ ] Job queue works
- [ ] Session storage works
- [ ] All tests pass
