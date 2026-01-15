# Tier-Based Rate Limiting

Sophisticated rate limiting with subscription tiers, concurrent tracking, and multiple time windows.

## Problem

Simple rate limiting fails for SaaS:
- Free users abuse expensive operations
- Paying customers get blocked unfairly
- No visibility into usage patterns
- Concurrent operations not tracked

## Solution: Multi-Dimensional Rate Limiter

```
Check: Can user perform operation?
    ↓
[1] Get user's subscription tier
    ↓
[2] Check concurrent limit (are they already running N operations?)
    ↓
[3] Check per-hour limit
    ↓
[4] Check per-day limit
    ↓
[5] Check per-week limit (for expensive operations)
    ↓
[6] Record request + increment concurrent counter
    ↓
[7] On completion: decrement concurrent counter
```

---

## Implementation

```python
from collections import defaultdict, deque
from functools import wraps
import time
import inspect

class RateLimiter:
    """In-memory rate limiter with tier-based limits"""
    
    def __init__(self):
        # Store request timestamps per user per operation
        self.requests: Dict[str, Dict[str, deque]] = defaultdict(lambda: defaultdict(deque))
        
        # Track concurrent operations
        self.concurrent: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        
        # Tier-based limits
        self.tier_limits = {
            "free": {
                "invoice_parse": {
                    "max_concurrent": 2,
                    "max_per_hour": 10,
                    "max_per_day": 20
                },
                "menu_parse": {
                    "max_concurrent": 1,
                    "max_per_hour": 2,
                    "max_per_day": 3
                },
                "analysis": {
                    "max_concurrent": 1,
                    "max_per_hour": 2,
                    "max_per_week": 2  # Expensive operation
                },
            },
            "premium": {
                "invoice_parse": {
                    "max_concurrent": 5,
                    "max_per_hour": 50,
                    "max_per_day": 200
                },
                "menu_parse": {
                    "max_concurrent": 3,
                    "max_per_hour": 20,
                    "max_per_day": 50
                },
                "analysis": {
                    "max_concurrent": 3,
                    "max_per_hour": 20,
                    "max_per_week": -1  # Unlimited
                },
            },
            "enterprise": {
                "invoice_parse": {
                    "max_concurrent": 10,
                    "max_per_hour": -1,  # Unlimited
                    "max_per_day": -1
                },
                "menu_parse": {
                    "max_concurrent": 10,
                    "max_per_hour": -1,
                    "max_per_day": -1
                },
                "analysis": {
                    "max_concurrent": 10,
                    "max_per_hour": -1,
                    "max_per_week": -1
                },
            }
        }
    
    def check_rate_limit(self, user_id: str, operation: str, user_tier: str = "free") -> bool:
        """
        Check if user can perform operation
        Returns True if allowed, False if rate limited
        """
        # Default to free tier if unknown
        if user_tier not in self.tier_limits:
            user_tier = "free"
        
        tier_config = self.tier_limits[user_tier]
        if operation not in tier_config:
            return True  # No limits for this operation
        
        limits = tier_config[operation]
        current_time = time.time()
        
        # Check 1: Concurrent limit
        if self.concurrent[user_id][operation] >= limits["max_concurrent"]:
            logger.warning(f"User {user_id} ({user_tier}) hit concurrent limit for {operation}")
            return False
        
        # Clean old requests (older than 7 days)
        user_requests = self.requests[user_id][operation]
        week_ago = current_time - (7 * 24 * 3600)
        while user_requests and user_requests[0] < week_ago:
            user_requests.popleft()
        
        # Check 2: Per-hour limit
        if limits.get("max_per_hour", -1) != -1:
            hour_ago = current_time - 3600
            hour_requests = sum(1 for t in user_requests if t > hour_ago)
            if hour_requests >= limits["max_per_hour"]:
                logger.warning(f"User {user_id} ({user_tier}) hit per-hour limit for {operation}")
                return False
        
        # Check 3: Per-day limit
        if limits.get("max_per_day", -1) != -1:
            day_ago = current_time - (24 * 3600)
            day_requests = sum(1 for t in user_requests if t > day_ago)
            if day_requests >= limits["max_per_day"]:
                logger.warning(f"User {user_id} ({user_tier}) hit per-day limit for {operation}")
                return False
        
        # Check 4: Per-week limit
        if limits.get("max_per_week", -1) != -1:
            week_requests = len(user_requests)
            if week_requests >= limits["max_per_week"]:
                logger.warning(f"User {user_id} ({user_tier}) hit per-week limit for {operation}")
                return False
        
        return True
    
    def record_request(self, user_id: str, operation: str):
        """Record request start"""
        self.requests[user_id][operation].append(time.time())
        self.concurrent[user_id][operation] += 1
    
    def release_request(self, user_id: str, operation: str):
        """Release concurrent slot on completion"""
        if self.concurrent[user_id][operation] > 0:
            self.concurrent[user_id][operation] -= 1
    
    def get_limits_info(self, user_id: str, operation: str, user_tier: str = "free") -> Dict:
        """Get current usage for user (for error responses)"""
        if user_tier not in self.tier_limits:
            user_tier = "free"
        
        tier_config = self.tier_limits[user_tier]
        if operation not in tier_config:
            return {}
        
        limits = tier_config[operation]
        current_time = time.time()
        
        user_requests = self.requests[user_id][operation]
        
        # Clean old requests
        week_ago = current_time - (7 * 24 * 3600)
        while user_requests and user_requests[0] < week_ago:
            user_requests.popleft()
        
        hour_ago = current_time - 3600
        day_ago = current_time - (24 * 3600)
        
        return {
            "operation": operation,
            "tier": user_tier,
            "concurrent_used": self.concurrent[user_id][operation],
            "concurrent_limit": limits["max_concurrent"],
            "hour_used": sum(1 for t in user_requests if t > hour_ago),
            "hour_limit": limits.get("max_per_hour", -1),
            "day_used": sum(1 for t in user_requests if t > day_ago),
            "day_limit": limits.get("max_per_day", -1),
            "week_used": len(user_requests),
            "week_limit": limits.get("max_per_week", -1),
        }


# Global instance
rate_limiter = RateLimiter()
```

---

## Decorator for Endpoints

```python
async def get_user_tier(user_id: str) -> str:
    """Get user's subscription tier from database"""
    try:
        result = service_client.table("users").select(
            "subscription_tier"
        ).eq("id", user_id).single().execute()
        
        return result.data.get("subscription_tier", "free") if result.data else "free"
    except Exception:
        return "free"  # Default to free on error


def rate_limit(operation: str):
    """
    Decorator for rate limiting endpoints
    
    Usage:
        @router.post("/parse")
        @rate_limit("invoice_parse")
        async def parse_invoice(...):
            pass
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract request from kwargs or args
            request = kwargs.get('request')
            if not request:
                for arg in args:
                    if isinstance(arg, Request) and hasattr(arg, 'state'):
                        request = arg
                        break
            
            if not request:
                return await func(*args, **kwargs)
            
            # Get user ID from auth middleware
            user_id = getattr(request.state, 'user_id', None)
            if not user_id and 'current_user' in kwargs:
                user_id = kwargs['current_user']
            
            if not user_id:
                return await func(*args, **kwargs)
            
            # Get tier and check limit
            user_tier = await get_user_tier(user_id)
            
            if not rate_limiter.check_rate_limit(user_id, operation, user_tier):
                limits_info = rate_limiter.get_limits_info(user_id, operation, user_tier)
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "Rate limit exceeded",
                        "operation": operation,
                        "limits": limits_info,
                        "retry_after": 3600
                    }
                )
            
            # Record and execute
            rate_limiter.record_request(user_id, operation)
            
            try:
                return await func(*args, **kwargs)
            finally:
                # Always release concurrent slot
                rate_limiter.release_request(user_id, operation)
        
        # Preserve function signature for FastAPI
        try:
            wrapper.__signature__ = inspect.signature(func)
        except (ValueError, TypeError):
            pass
        
        return wrapper
    return decorator
```

---

## Usage in Routes

```python
@router.post("/parse")
@rate_limit("invoice_parse")
async def parse_invoice(
    file: UploadFile = File(...),
    auth: AuthenticatedUser = Depends(get_current_membership),
):
    """Parse invoice - rate limited by tier"""
    # ... implementation
```

---

## Error Response Format

```json
{
    "error": "Rate limit exceeded",
    "operation": "invoice_parse",
    "limits": {
        "operation": "invoice_parse",
        "tier": "free",
        "concurrent_used": 2,
        "concurrent_limit": 2,
        "hour_used": 10,
        "hour_limit": 10,
        "day_used": 15,
        "day_limit": 20,
        "week_used": 15,
        "week_limit": -1
    },
    "retry_after": 3600
}
```

---

## Tier Configuration Strategy

### Free Tier
- Low limits to prevent abuse
- Encourage upgrade
- Still usable for evaluation

### Premium Tier
- 10x free tier for most operations
- Unlimited for some (weekly analysis)
- Enough for serious usage

### Enterprise Tier
- Unlimited everything except concurrent
- Concurrent limit prevents runaway costs
- Custom limits negotiable

---

## Scaling Considerations

### In-Memory (Current)
- Fast, no external dependencies
- Lost on restart (acceptable for rate limiting)
- Single-instance only

### Redis (For Multi-Instance)

```python
class RedisRateLimiter:
    def check_rate_limit(self, user_id: str, operation: str, user_tier: str) -> bool:
        key = f"ratelimit:{user_id}:{operation}"
        
        # Use Redis sorted set with timestamps
        current_time = time.time()
        
        # Remove old entries
        self.redis.zremrangebyscore(key, 0, current_time - (7 * 24 * 3600))
        
        # Count requests in each window
        hour_count = self.redis.zcount(key, current_time - 3600, current_time)
        day_count = self.redis.zcount(key, current_time - 86400, current_time)
        
        # Check limits...
        
        # Record request
        self.redis.zadd(key, {str(uuid.uuid4()): current_time})
        self.redis.expire(key, 7 * 24 * 3600)
```

---

## Gotchas

1. **Always release concurrent slots**: Use try/finally to ensure release even on errors
2. **Default to free tier**: Unknown tiers should be restrictive, not permissive
3. **Log rate limit hits**: Helps identify abuse patterns and tune limits
4. **Include limits in error**: Users need to know what they hit and when it resets
5. **Concurrent != total**: A user can hit concurrent limit with low total usage
6. **-1 means unlimited**: Use -1 consistently, not 0 or None
