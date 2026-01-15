# Distributed Locking with Redis

Async context manager for distributed locks with ownership verification and automatic cleanup.

## Problem

Race conditions in distributed systems:
- Two requests process the same file simultaneously
- Duplicate records created
- Data corruption from concurrent updates
- No coordination between service instances

## Solution: Redis Lock with Ownership

```python
import asyncio
import os
from contextlib import asynccontextmanager

class DistributedLock:
    def __init__(self, redis_client):
        self.redis = redis_client
    
    @asynccontextmanager
    async def acquire(self, lock_key: str, timeout: int = 10):
        """
        Distributed lock using Redis SET NX
        
        Features:
        - Ownership verification (only owner can release)
        - Automatic expiration (prevents deadlocks)
        - Async-friendly with retries
        
        Args:
            lock_key: Unique identifier for the lock
            timeout: Lock timeout in seconds (auto-release)
        
        Usage:
            async with lock.acquire("process:invoice:123"):
                # Critical section
                await process_invoice()
        """
        acquired = False
        # Unique value to verify ownership
        lock_value = f"{os.getpid()}:{asyncio.current_task().get_name()}:{time.time()}"
        
        try:
            # Try to acquire lock with retries
            for attempt in range(timeout * 10):  # Check every 100ms
                # SET NX = Set if Not eXists
                # EX = Expiration in seconds
                if self.redis.set(lock_key, lock_value, nx=True, ex=timeout):
                    acquired = True
                    logger.debug(f"Lock acquired: {lock_key}")
                    break
                await asyncio.sleep(0.1)
            
            if not acquired:
                raise TimeoutError(f"Could not acquire lock: {lock_key} after {timeout}s")
            
            yield acquired
            
        finally:
            # Release lock ONLY if we own it
            if acquired:
                try:
                    current_value = self.redis.get(lock_key)
                    if current_value == lock_value:
                        self.redis.delete(lock_key)
                        logger.debug(f"Lock released: {lock_key}")
                    else:
                        logger.warning(f"Lock {lock_key} owned by another process, not releasing")
                except Exception as e:
                    logger.error(f"Error releasing lock {lock_key}: {e}")
```

---

## Why Ownership Verification Matters

Without ownership check:
```
Process A: acquire lock → start work
Process A: work takes longer than timeout
Lock expires automatically
Process B: acquire lock → start work
Process A: finishes → releases lock (WRONG! Releases B's lock)
Process C: acquire lock → start work
Process B: finishes → releases lock (WRONG! Releases C's lock)
... chaos ensues
```

With ownership check:
```
Process A: acquire lock (value="A:123:timestamp")
Process A: work takes longer than timeout
Lock expires automatically
Process B: acquire lock (value="B:456:timestamp")
Process A: finishes → tries to release → value != "A:123:timestamp" → skip
Process B: finishes → releases lock (value matches)
```

---

## Production Implementation

```python
from services.redis_client import cache

class InvoiceDuplicateDetector:
    def __init__(self):
        try:
            self.redis = cache
            self.redis_enabled = cache.enabled
        except Exception as e:
            logger.warning(f"Redis not available: {e}")
            self.redis = None
            self.redis_enabled = False
    
    @asynccontextmanager
    async def redis_lock(self, lock_key: str, timeout: int = 10):
        """
        Distributed lock for preventing race conditions
        Gracefully degrades if Redis unavailable
        """
        acquired = False
        lock_value = f"{os.getpid()}:{asyncio.current_task().get_name()}"
        
        try:
            if self.redis_enabled:
                for attempt in range(timeout * 10):
                    if self.redis.client.set(lock_key, lock_value, nx=True, ex=timeout):
                        acquired = True
                        break
                    await asyncio.sleep(0.1)
                
                if not acquired:
                    raise TimeoutError(f"Could not acquire lock: {lock_key}")
            
            yield acquired
            
        finally:
            if acquired and self.redis_enabled:
                try:
                    current_value = self.redis.client.get(lock_key)
                    if current_value == lock_value:
                        self.redis.client.delete(lock_key)
                except Exception as e:
                    logger.error(f"Error releasing lock {lock_key}: {e}")
    
    async def check_for_duplicate(
        self,
        user_id: str,
        account_id: str,
        invoice_number: str,
        vendor_name: str,
        ...
    ) -> Optional[Dict]:
        """Check for duplicate with race condition protection"""
        
        # Lock key includes identifying information
        lock_key = f"invoice_check:{account_id}:{invoice_number}:{vendor_name}"
        
        try:
            async with self.redis_lock(lock_key, timeout=5):
                # Critical section - only one process can check at a time
                
                # Check for exact match
                exact_match = self.client.table("invoices").select(...).execute()
                
                if exact_match.data:
                    return {"type": "exact", "message": "Duplicate found"}
                
                # Check for near-duplicate
                near_matches = self.client.table("invoices").select(...).execute()
                
                # ... more checks
                
                return None
                
        except TimeoutError as e:
            # Another process is checking the same invoice
            return {
                "type": "concurrent",
                "message": "Another upload is being processed. Please wait."
            }
```

---

## Processing Markers (Simpler Alternative)

For cases where you don't need blocking, use processing markers:

```python
async def mark_processing(self, user_id: str, account_id: str, file_hash: str, ttl: int = 300):
    """
    Mark file as being processed
    TTL ensures marker auto-expires if process crashes
    """
    if self.redis_enabled:
        key = f"processing:{account_id}:{file_hash}"
        self.redis.client.setex(key, ttl, "1")

async def is_processing(self, user_id: str, account_id: str, file_hash: str) -> bool:
    """Check if file is currently being processed"""
    if self.redis_enabled:
        key = f"processing:{account_id}:{file_hash}"
        return self.redis.client.exists(key) > 0
    return False

async def clear_processing(self, user_id: str, account_id: str, file_hash: str):
    """Clear processing marker on completion"""
    if self.redis_enabled:
        key = f"processing:{account_id}:{file_hash}"
        self.redis.client.delete(key)
```

Usage:
```python
# Check before starting
if await detector.is_processing(user_id, account_id, file_hash):
    raise HTTPException(409, "File is currently being processed")

# Mark as processing (with TTL failsafe)
await detector.mark_processing(user_id, account_id, file_hash, ttl=300)

try:
    # Do work
    result = await process_file(...)
finally:
    # Always clear marker
    await detector.clear_processing(user_id, account_id, file_hash)
```

---

## Lock vs Marker: When to Use

| Use Case | Lock | Marker |
|----------|------|--------|
| Prevent duplicate DB writes | ✅ | ❌ |
| Show "processing" status to user | ❌ | ✅ |
| Coordinate between services | ✅ | ❌ |
| Simple "is busy" check | ❌ | ✅ |
| Need to wait for completion | ✅ | ❌ |
| Fire-and-forget protection | ❌ | ✅ |

---

## Graceful Degradation

Always handle Redis unavailability:

```python
@asynccontextmanager
async def redis_lock(self, lock_key: str, timeout: int = 10):
    acquired = False
    
    try:
        if self.redis_enabled:
            # Try to acquire lock
            ...
            acquired = True
        else:
            # Redis unavailable - proceed without lock
            # Log warning, but don't block
            logger.warning(f"Redis unavailable, proceeding without lock: {lock_key}")
        
        yield acquired
        
    finally:
        if acquired and self.redis_enabled:
            # Release lock
            ...
```

---

## Key Design Decisions

### 1. Lock Value = Process Identity
```python
lock_value = f"{os.getpid()}:{asyncio.current_task().get_name()}"
```
- PID identifies the process
- Task name identifies the coroutine
- Together they're unique across distributed system

### 2. SET NX + EX (Atomic)
```python
self.redis.set(lock_key, lock_value, nx=True, ex=timeout)
```
- `NX`: Only set if not exists
- `EX`: Set expiration
- Atomic operation prevents race in lock acquisition itself

### 3. Retry with Backoff
```python
for attempt in range(timeout * 10):  # 100ms intervals
    if self.redis.set(...):
        break
    await asyncio.sleep(0.1)
```
- Don't fail immediately
- Give other process time to complete
- Total wait = timeout seconds

### 4. TTL Failsafe
```python
await detector.mark_processing(..., ttl=300)  # 5 minutes
```
- If process crashes, marker auto-expires
- Prevents permanent "stuck" state
- Choose TTL based on max expected processing time

---

## Gotchas

1. **Lock timeout < operation time**: If your operation takes longer than lock timeout, another process can acquire the lock. Set timeout appropriately.

2. **Network partitions**: If Redis becomes unreachable mid-operation, you can't release the lock. TTL handles this.

3. **Clock skew**: Don't use timestamps for lock comparison across machines. Use unique values.

4. **Retry storms**: If many processes retry simultaneously, they can overwhelm Redis. Add jitter to retry intervals.

5. **Lock key granularity**: Too broad = unnecessary blocking. Too narrow = no protection.
   - Good: `invoice_check:{account_id}:{invoice_number}`
   - Bad: `invoice_check` (blocks all invoices)
   - Bad: `invoice_check:{uuid}` (no protection)
