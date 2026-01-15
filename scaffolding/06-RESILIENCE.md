# Phase 06: Resilience Patterns

> **Time**: 15 minutes  
> **Prerequisites**: [03-TYPES](./03-TYPES.md)  
> **Produces**: Circuit breaker, retry with backoff, distributed locking, graceful shutdown

---

## 🤖 Agent Execution Context

**What you're doing**: Adding fault tolerance patterns that prevent cascade failures and handle external service outages gracefully. These are critical for production stability.

**Expected state BEFORE execution**:
- Phase 03 complete (exceptions exist)
- `packages/backend/src/` exists
- `apps/web/lib/` exists

**What you'll create**:
- `packages/backend/src/resilience/__init__.py` — Module exports
- `packages/backend/src/resilience/circuit_breaker.py` — Circuit breaker pattern
- `packages/backend/src/resilience/retry.py` — Retry with exponential backoff
- `packages/backend/src/resilience/distributed_lock.py` — Redis-based locking
- `packages/backend/src/resilience/shutdown.py` — Graceful shutdown handler
- `apps/web/lib/resilience/retry.ts` — Frontend retry utility

**Execution approach**:
1. Create `packages/backend/src/resilience/` directory
2. Create __init__.py first (defines what's exported)
3. Create circuit_breaker.py
4. Create retry.py
5. Create distributed_lock.py
6. Create shutdown.py
7. Create `apps/web/lib/resilience/` directory
8. Create frontend retry.ts

**IMPORTANT**:
- Circuit breaker is STATEFUL — it tracks failures per service
- Distributed lock requires Redis (gracefully degrades without it)
- Graceful shutdown tracks active jobs to avoid killing in-progress work
- These patterns are OPTIONAL to use but AVAILABLE when needed

**When to use each pattern**:
- **Circuit breaker**: External API calls (Stripe, AI services, etc.)
- **Retry**: Transient failures (network blips, rate limits)
- **Distributed lock**: Preventing duplicate processing (file uploads, payments)
- **Graceful shutdown**: Long-running workers, background jobs

**After completion, tell the user**:
- "Phase 06 complete. Resilience patterns available."
- "Circuit breaker, retry, distributed locking, and graceful shutdown ready to use."
- "Proceed to Phase 07 for job processing system."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/resilience/` directory exists
- `apps/web/lib/resilience/` directory exists

## Purpose

Create resilience infrastructure including:
- Circuit breaker for external service calls
- Retry with exponential backoff
- Distributed locking with Redis
- Graceful shutdown handling
- Error sanitization for production

---

## Artifacts to Create

### 1. packages/backend/src/resilience/__init__.py

```python
"""Resilience patterns module."""

from src.resilience.circuit_breaker import CircuitBreaker, CircuitBreakerError
from src.resilience.retry import retry_with_backoff, RetryConfig
from src.resilience.distributed_lock import DistributedLock, LockError
from src.resilience.shutdown import GracefulShutdown

__all__ = [
    "CircuitBreaker",
    "CircuitBreakerError",
    "retry_with_backoff",
    "RetryConfig",
    "DistributedLock",
    "LockError",
    "GracefulShutdown",
]
```

### 2. packages/backend/src/resilience/circuit_breaker.py

```python
"""
Circuit breaker pattern implementation.

Prevents cascade failures by failing fast when a service is unhealthy.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(str, Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing fast
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreakerConfig:
    """Circuit breaker configuration."""
    failure_threshold: int = 5      # Failures before opening
    success_threshold: int = 3      # Successes to close from half-open
    timeout_seconds: int = 60       # How long to stay open
    half_open_max_calls: int = 3    # Max test calls in half-open


class CircuitBreakerError(Exception):
    """Raised when circuit is open."""
    
    def __init__(self, service_name: str, retry_after: int):
        self.service_name = service_name
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker open for {service_name}, retry after {retry_after}s"
        )


@dataclass
class CircuitBreaker:
    """
    Circuit breaker for external service calls.
    
    Usage:
        breaker = CircuitBreaker("payment-api")
        
        try:
            result = await breaker.execute(lambda: call_payment_api())
        except CircuitBreakerError as e:
            # Circuit is open, use fallback
            return cached_result
    """
    
    service_name: str
    config: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    
    # Internal state
    _state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    _failures: int = field(default=0, init=False)
    _successes: int = field(default=0, init=False)
    _half_open_calls: int = field(default=0, init=False)
    _last_state_change: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc), init=False
    )
    
    async def execute(self, fn: Callable[[], T]) -> T:
        """Execute a function with circuit breaker protection."""
        if not self._can_execute():
            retry_after = self._get_retry_after()
            raise CircuitBreakerError(self.service_name, retry_after)
        
        try:
            # Handle both sync and async functions
            result = fn()
            if asyncio.iscoroutine(result):
                result = await result
            self._record_success()
            return result
        except Exception:
            self._record_failure()
            raise
    
    def _can_execute(self) -> bool:
        """Check if a call should be allowed."""
        if self._state == CircuitState.CLOSED:
            return True
        
        if self._state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self._transition_to(CircuitState.HALF_OPEN)
                return True
            return False
        
        if self._state == CircuitState.HALF_OPEN:
            if self._half_open_calls < self.config.half_open_max_calls:
                self._half_open_calls += 1
                return True
            return False
        
        return False
    
    def _record_success(self) -> None:
        """Record a successful call."""
        self._failures = 0
        
        if self._state == CircuitState.HALF_OPEN:
            self._successes += 1
            if self._successes >= self.config.success_threshold:
                self._transition_to(CircuitState.CLOSED)
    
    def _record_failure(self) -> None:
        """Record a failed call."""
        self._failures += 1
        
        if self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)
        elif self._state == CircuitState.CLOSED:
            if self._failures >= self.config.failure_threshold:
                self._transition_to(CircuitState.OPEN)
    
    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        old_state = self._state
        self._state = new_state
        self._last_state_change = datetime.now(timezone.utc)
        
        if new_state == CircuitState.CLOSED:
            self._failures = 0
            self._successes = 0
        elif new_state == CircuitState.HALF_OPEN:
            self._successes = 0
            self._half_open_calls = 0
        
        logger.info(
            f"[CircuitBreaker] {self.service_name}: {old_state.value} → {new_state.value}"
        )
    
    def _should_attempt_reset(self) -> bool:
        """Check if we should attempt to reset from OPEN state."""
        elapsed = (datetime.now(timezone.utc) - self._last_state_change).total_seconds()
        return elapsed >= self.config.timeout_seconds
    
    def _get_retry_after(self) -> int:
        """Get seconds until retry is allowed."""
        elapsed = (datetime.now(timezone.utc) - self._last_state_change).total_seconds()
        return max(0, int(self.config.timeout_seconds - elapsed))
    
    @property
    def state(self) -> CircuitState:
        """Get current state."""
        return self._state
    
    @property
    def is_open(self) -> bool:
        """Check if circuit is open."""
        return self._state == CircuitState.OPEN
    
    def reset(self) -> None:
        """Force reset to closed state."""
        self._transition_to(CircuitState.CLOSED)


# Global registry of circuit breakers
_breakers: dict[str, CircuitBreaker] = {}


def get_circuit_breaker(
    service_name: str,
    config: CircuitBreakerConfig | None = None,
) -> CircuitBreaker:
    """Get or create a circuit breaker for a service."""
    if service_name not in _breakers:
        _breakers[service_name] = CircuitBreaker(
            service_name=service_name,
            config=config or CircuitBreakerConfig(),
        )
    return _breakers[service_name]
```


### 3. packages/backend/src/resilience/retry.py

```python
"""
Retry with exponential backoff.

Provides configurable retry logic for transient failures.
"""

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class RetryConfig:
    """Retry configuration."""
    max_attempts: int = 3
    base_delay: float = 1.0      # Base delay in seconds
    max_delay: float = 60.0      # Maximum delay
    exponential_base: float = 2.0
    jitter: bool = True          # Add randomness to prevent thundering herd


class RetryExhaustedError(Exception):
    """Raised when all retry attempts are exhausted."""
    
    def __init__(self, attempts: int, last_error: Exception):
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(f"Retry exhausted after {attempts} attempts: {last_error}")


async def retry_with_backoff(
    fn: Callable[[], T],
    config: RetryConfig | None = None,
    retryable_exceptions: tuple[type[Exception], ...] = (Exception,),
) -> T:
    """
    Execute a function with retry and exponential backoff.
    
    Args:
        fn: Function to execute (can be sync or async)
        config: Retry configuration
        retryable_exceptions: Exceptions that should trigger retry
        
    Returns:
        Result of the function
        
    Raises:
        RetryExhaustedError: If all attempts fail
        
    Usage:
        result = await retry_with_backoff(
            lambda: call_external_api(),
            config=RetryConfig(max_attempts=5),
            retryable_exceptions=(ConnectionError, TimeoutError),
        )
    """
    config = config or RetryConfig()
    last_error: Exception | None = None
    
    for attempt in range(1, config.max_attempts + 1):
        try:
            result = fn()
            if asyncio.iscoroutine(result):
                result = await result
            return result
        except retryable_exceptions as e:
            last_error = e
            
            if attempt == config.max_attempts:
                break
            
            # Calculate delay with exponential backoff
            delay = min(
                config.base_delay * (config.exponential_base ** (attempt - 1)),
                config.max_delay,
            )
            
            # Add jitter
            if config.jitter:
                delay = delay * (0.5 + random.random())
            
            logger.warning(
                f"Attempt {attempt}/{config.max_attempts} failed: {e}. "
                f"Retrying in {delay:.2f}s"
            )
            
            await asyncio.sleep(delay)
    
    raise RetryExhaustedError(config.max_attempts, last_error)


def with_retry(
    config: RetryConfig | None = None,
    retryable_exceptions: tuple[type[Exception], ...] = (Exception,),
):
    """
    Decorator for retry with backoff.
    
    Usage:
        @with_retry(config=RetryConfig(max_attempts=3))
        async def call_api():
            return await http_client.get("/api/data")
    """
    def decorator(fn: Callable[[], T]) -> Callable[[], T]:
        async def wrapper(*args, **kwargs):
            return await retry_with_backoff(
                lambda: fn(*args, **kwargs),
                config=config,
                retryable_exceptions=retryable_exceptions,
            )
        return wrapper
    return decorator
```

### 4. packages/backend/src/resilience/distributed_lock.py

```python
"""
Distributed locking with Redis.

Provides async context manager for distributed locks with ownership verification.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

logger = logging.getLogger(__name__)


class LockError(Exception):
    """Base exception for lock errors."""
    pass


class LockAcquisitionError(LockError):
    """Failed to acquire lock."""
    
    def __init__(self, lock_key: str, timeout: int):
        self.lock_key = lock_key
        self.timeout = timeout
        super().__init__(f"Could not acquire lock '{lock_key}' after {timeout}s")


class DistributedLock:
    """
    Distributed lock using Redis.
    
    Features:
    - Ownership verification (only owner can release)
    - Automatic expiration (prevents deadlocks)
    - Async-friendly with retries
    - Graceful degradation if Redis unavailable
    
    Usage:
        lock = DistributedLock(redis_client)
        
        async with lock.acquire("process:invoice:123"):
            # Critical section
            await process_invoice()
    """
    
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self._enabled = redis_client is not None
    
    @asynccontextmanager
    async def acquire(
        self,
        lock_key: str,
        timeout: int = 10,
        ttl: int = 30,
    ) -> AsyncGenerator[bool, None]:
        """
        Acquire a distributed lock.
        
        Args:
            lock_key: Unique identifier for the lock
            timeout: Seconds to wait for lock acquisition
            ttl: Lock TTL in seconds (auto-release)
            
        Yields:
            True if lock was acquired, False if Redis unavailable
            
        Raises:
            LockAcquisitionError: If lock cannot be acquired within timeout
        """
        acquired = False
        lock_value = self._generate_lock_value()
        
        try:
            if self._enabled:
                acquired = await self._try_acquire(lock_key, lock_value, timeout, ttl)
                if not acquired:
                    raise LockAcquisitionError(lock_key, timeout)
                logger.debug(f"Lock acquired: {lock_key}")
            else:
                logger.warning(f"Redis unavailable, proceeding without lock: {lock_key}")
            
            yield acquired
            
        finally:
            if acquired and self._enabled:
                await self._release(lock_key, lock_value)
    
    async def _try_acquire(
        self,
        lock_key: str,
        lock_value: str,
        timeout: int,
        ttl: int,
    ) -> bool:
        """Try to acquire lock with retries."""
        end_time = time.time() + timeout
        
        while time.time() < end_time:
            # SET NX = Set if Not eXists, EX = Expiration
            if await self.redis.set(lock_key, lock_value, nx=True, ex=ttl):
                return True
            await asyncio.sleep(0.1)
        
        return False
    
    async def _release(self, lock_key: str, lock_value: str) -> None:
        """Release lock only if we own it."""
        try:
            current_value = await self.redis.get(lock_key)
            if current_value == lock_value:
                await self.redis.delete(lock_key)
                logger.debug(f"Lock released: {lock_key}")
            else:
                logger.warning(
                    f"Lock {lock_key} owned by another process, not releasing"
                )
        except Exception as e:
            logger.error(f"Error releasing lock {lock_key}: {e}")
    
    def _generate_lock_value(self) -> str:
        """Generate unique lock value for ownership verification."""
        task_name = "unknown"
        try:
            task = asyncio.current_task()
            if task:
                task_name = task.get_name()
        except RuntimeError:
            pass
        return f"{os.getpid()}:{task_name}:{time.time()}"


class ProcessingMarker:
    """
    Simple processing marker for non-blocking checks.
    
    Use when you don't need to wait for lock, just check if something
    is being processed.
    
    Usage:
        marker = ProcessingMarker(redis_client)
        
        if await marker.is_processing("file:123"):
            raise HTTPException(409, "File is being processed")
        
        await marker.mark_processing("file:123", ttl=300)
        try:
            await process_file()
        finally:
            await marker.clear_processing("file:123")
    """
    
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self._enabled = redis_client is not None
    
    async def mark_processing(self, key: str, ttl: int = 300) -> None:
        """Mark something as being processed."""
        if self._enabled:
            await self.redis.setex(f"processing:{key}", ttl, "1")
    
    async def is_processing(self, key: str) -> bool:
        """Check if something is being processed."""
        if self._enabled:
            return await self.redis.exists(f"processing:{key}") > 0
        return False
    
    async def clear_processing(self, key: str) -> None:
        """Clear processing marker."""
        if self._enabled:
            await self.redis.delete(f"processing:{key}")
```


### 5. packages/backend/src/resilience/shutdown.py

```python
"""
Graceful shutdown handling.

Ensures clean shutdown with job tracking and resource cleanup.
"""

import asyncio
import logging
import signal
from typing import Callable, Set

logger = logging.getLogger(__name__)


class GracefulShutdown:
    """
    Manages graceful shutdown of the application.
    
    Features:
    - Tracks active jobs/tasks
    - Waits for jobs to complete on shutdown
    - Configurable timeout
    - Signal handling (SIGTERM, SIGINT)
    
    Usage:
        shutdown = GracefulShutdown()
        
        # Register with FastAPI
        @app.on_event("startup")
        async def startup():
            shutdown.register_signals()
        
        @app.on_event("shutdown")
        async def shutdown_event():
            await shutdown.shutdown()
        
        # Track jobs
        async def process_job(job_id: str):
            async with shutdown.track_job(job_id):
                await do_work()
    """
    
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self._active_jobs: Set[str] = set()
        self._shutdown_event = asyncio.Event()
        self._cleanup_callbacks: list[Callable] = []
    
    def register_signals(self) -> None:
        """Register signal handlers for graceful shutdown."""
        loop = asyncio.get_event_loop()
        
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(
                sig,
                lambda s=sig: asyncio.create_task(self._handle_signal(s)),
            )
    
    async def _handle_signal(self, sig: signal.Signals) -> None:
        """Handle shutdown signal."""
        logger.info(f"Received signal {sig.name}, initiating graceful shutdown")
        self._shutdown_event.set()
    
    @property
    def is_shutting_down(self) -> bool:
        """Check if shutdown has been initiated."""
        return self._shutdown_event.is_set()
    
    def add_cleanup_callback(self, callback: Callable) -> None:
        """Add a callback to run during shutdown."""
        self._cleanup_callbacks.append(callback)
    
    async def track_job(self, job_id: str):
        """
        Context manager to track an active job.
        
        Usage:
            async with shutdown.track_job("job-123"):
                await process_job()
        """
        class JobTracker:
            def __init__(tracker_self):
                tracker_self.job_id = job_id
            
            async def __aenter__(tracker_self):
                self._active_jobs.add(job_id)
                logger.debug(f"Job started: {job_id} (active: {len(self._active_jobs)})")
                return tracker_self
            
            async def __aexit__(tracker_self, exc_type, exc_val, exc_tb):
                self._active_jobs.discard(job_id)
                logger.debug(f"Job completed: {job_id} (active: {len(self._active_jobs)})")
                return False
        
        return JobTracker()
    
    async def shutdown(self) -> None:
        """
        Perform graceful shutdown.
        
        Waits for active jobs to complete, then runs cleanup callbacks.
        """
        self._shutdown_event.set()
        
        if self._active_jobs:
            logger.info(
                f"Waiting for {len(self._active_jobs)} active jobs to complete "
                f"(timeout: {self.timeout}s)"
            )
            
            # Wait for jobs with timeout
            start_time = asyncio.get_event_loop().time()
            while self._active_jobs:
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed >= self.timeout:
                    logger.warning(
                        f"Shutdown timeout reached, {len(self._active_jobs)} jobs still active"
                    )
                    break
                await asyncio.sleep(0.5)
        
        # Run cleanup callbacks
        for callback in self._cleanup_callbacks:
            try:
                result = callback()
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                logger.error(f"Cleanup callback failed: {e}")
        
        logger.info("Graceful shutdown complete")
    
    @property
    def active_job_count(self) -> int:
        """Get count of active jobs."""
        return len(self._active_jobs)
    
    @property
    def active_jobs(self) -> Set[str]:
        """Get set of active job IDs."""
        return self._active_jobs.copy()
```

### 6. apps/web/lib/resilience/retry.ts

```typescript
/**
 * Retry with exponential backoff for frontend.
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
};

export class RetryExhaustedError extends Error {
  constructor(
    public attempts: number,
    public lastError: Error,
  ) {
    super(`Retry exhausted after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
  }
}

/**
 * Execute a function with retry and exponential backoff.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  shouldRetry: (error: Error) => boolean = () => true,
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === cfg.maxAttempts || !shouldRetry(lastError)) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(
        cfg.baseDelay * Math.pow(2, attempt - 1),
        cfg.maxDelay,
      );

      // Add jitter
      if (cfg.jitter) {
        delay = delay * (0.5 + Math.random());
      }

      console.warn(
        `Attempt ${attempt}/${cfg.maxAttempts} failed: ${lastError.message}. ` +
        `Retrying in ${Math.round(delay)}ms`,
      );

      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(cfg.maxAttempts, lastError!);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (network errors, 5xx, etc.)
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // HTTP errors
  if ('status' in error) {
    const status = (error as any).status;
    // Retry on 5xx and 429 (rate limit)
    return status >= 500 || status === 429;
  }

  return false;
}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 06
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 07 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Verify Python resilience modules
cd packages/backend
source .venv/bin/activate
python -c "
from src.resilience import (
    CircuitBreaker, CircuitBreakerError,
    retry_with_backoff, RetryConfig,
    DistributedLock, LockError,
    GracefulShutdown,
)

# Test circuit breaker
breaker = CircuitBreaker('test-service')
print('Circuit breaker state:', breaker.state)

# Test retry config
config = RetryConfig(max_attempts=5, base_delay=0.5)
print('Retry config:', config)

# Test graceful shutdown
shutdown = GracefulShutdown(timeout=10)
print('Shutdown active jobs:', shutdown.active_job_count)
"

# 2. Verify TypeScript resilience module
cd ../../apps/web
pnpm lint

# 3. Run tests
cd ../../packages/backend
pytest -v
```

**Success Criteria**:
- [ ] Circuit breaker tracks state transitions
- [ ] Retry with backoff calculates delays correctly
- [ ] Distributed lock generates unique values
- [ ] Graceful shutdown tracks active jobs
- [ ] TypeScript retry module compiles
- [ ] All modules import without errors
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [07-WORKERS.md](./07-WORKERS.md) for job processing system.
