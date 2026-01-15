# Phase 09: Observability

> **Time**: 10 minutes  
> **Prerequisites**: [03-TYPES](./03-TYPES.md)  
> **Produces**: Structured logging, metrics, health checks, request tracing

---

## 🤖 Agent Execution Context

**What you're doing**: Adding observability infrastructure — structured logging, metrics collection, and health check aggregation. Essential for debugging production issues.

**Expected state BEFORE execution**:
- Phase 03 complete (for consistent error handling)
- `packages/backend/src/config.py` exists (for LOG_LEVEL setting)
- `apps/web/lib/` exists

**What you'll create**:
- `packages/backend/src/observability/__init__.py` — Module exports
- `packages/backend/src/observability/logging.py` — Structured logging with structlog
- `packages/backend/src/observability/middleware.py` — Request logging middleware
- `packages/backend/src/observability/metrics.py` — Basic metrics collector
- `packages/backend/src/observability/health.py` — Health check aggregation
- `apps/web/lib/observability/logger.ts` — Frontend logging utility
- UPDATE `packages/backend/src/main.py` — Add logging setup and middleware

**Execution approach**:
1. Create `packages/backend/src/observability/` directory
2. Create all Python observability files
3. Create `apps/web/lib/observability/` directory
4. Create frontend logger
5. Update main.py to call setup_logging() and add RequestLoggingMiddleware

**IMPORTANT**:
- `setup_logging()` MUST be called before app starts (top of main.py)
- Logging outputs JSON in production, pretty-print in development
- Metrics collector is IN-MEMORY (integrate Prometheus for production)
- Request logging adds X-Request-ID header for tracing

**What gets logged**:
- Every request: method, path, duration, status code
- User ID (if authenticated)
- Client IP
- Errors with full context

**After completion, tell the user**:
- "Phase 09 complete. Observability infrastructure ready."
- "Structured logging, metrics, and health checks are configured."
- "Proceed to Phase 10 for third-party integrations."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/observability/` directory exists
- `apps/web/lib/observability/` directory exists

## Purpose

Create observability infrastructure including:
- Structured JSON logging
- Request/response logging middleware
- Basic metrics collection
- Health check aggregation
- Error tracking preparation

---

## Artifacts to Create

### 1. packages/backend/src/observability/__init__.py

```python
"""Observability module."""

from src.observability.logging import setup_logging, get_logger
from src.observability.middleware import RequestLoggingMiddleware
from src.observability.metrics import MetricsCollector

__all__ = [
    "setup_logging",
    "get_logger",
    "RequestLoggingMiddleware",
    "MetricsCollector",
]
```

### 2. packages/backend/src/observability/logging.py

```python
"""Structured logging configuration."""

import logging
import sys
from typing import Any

import structlog

from src.config import settings


def setup_logging() -> None:
    """Configure structured logging for the application."""
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            # Use JSON in production, pretty print in development
            structlog.processors.JSONRenderer()
            if settings.is_production
            else structlog.dev.ConsoleRenderer(colors=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.LOG_LEVEL)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.LOG_LEVEL),
    )
    
    # Reduce noise from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)


def log_context(**kwargs: Any) -> None:
    """Add context to all subsequent log messages in this request."""
    structlog.contextvars.bind_contextvars(**kwargs)


def clear_log_context() -> None:
    """Clear request-scoped log context."""
    structlog.contextvars.clear_contextvars()
```

### 3. packages/backend/src/observability/middleware.py

```python
"""Observability middleware."""

import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.observability.logging import get_logger, log_context, clear_log_context

logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for request/response logging.
    
    Logs:
    - Request method, path, and headers
    - Response status and duration
    - User ID if authenticated
    """
    
    SKIP_PATHS = {"/health", "/metrics", "/favicon.ico"}
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip logging for certain paths
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)
        
        # Generate request ID
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        
        # Set up logging context
        log_context(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client_ip=self._get_client_ip(request),
        )
        
        # Add user ID if available
        if hasattr(request.state, "user_id") and request.state.user_id:
            log_context(user_id=request.state.user_id)
        
        # Log request
        logger.info(
            "request_started",
            query_params=dict(request.query_params),
        )
        
        # Process request
        start_time = time.perf_counter()
        
        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000
            
            # Log response
            logger.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            
            return response
            
        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                "request_failed",
                error=str(e),
                error_type=type(e).__name__,
                duration_ms=round(duration_ms, 2),
            )
            raise
        
        finally:
            clear_log_context()
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request."""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
```

### 4. packages/backend/src/observability/metrics.py

```python
"""Basic metrics collection."""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MetricsCollector:
    """
    Simple in-memory metrics collector.
    
    For production, integrate with Prometheus or similar.
    """
    
    _counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    _gauges: dict[str, float] = field(default_factory=dict)
    _histograms: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    
    def increment(self, name: str, value: int = 1, labels: dict | None = None) -> None:
        """Increment a counter."""
        key = self._make_key(name, labels)
        self._counters[key] += value
    
    def gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        """Set a gauge value."""
        key = self._make_key(name, labels)
        self._gauges[key] = value
    
    def histogram(self, name: str, value: float, labels: dict | None = None) -> None:
        """Record a histogram value."""
        key = self._make_key(name, labels)
        self._histograms[key].append(value)
    
    def timer(self, name: str, labels: dict | None = None):
        """Context manager for timing operations."""
        return Timer(self, name, labels)
    
    def get_metrics(self) -> dict[str, Any]:
        """Get all metrics."""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {
                k: {
                    "count": len(v),
                    "sum": sum(v),
                    "avg": sum(v) / len(v) if v else 0,
                    "min": min(v) if v else 0,
                    "max": max(v) if v else 0,
                }
                for k, v in self._histograms.items()
            },
        }
    
    def _make_key(self, name: str, labels: dict | None) -> str:
        """Create a metric key with labels."""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"


class Timer:
    """Context manager for timing operations."""
    
    def __init__(self, collector: MetricsCollector, name: str, labels: dict | None):
        self.collector = collector
        self.name = name
        self.labels = labels
        self.start_time: float = 0
    
    def __enter__(self):
        self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = (time.perf_counter() - self.start_time) * 1000  # ms
        self.collector.histogram(self.name, duration, self.labels)
        return False


# Global metrics instance
metrics = MetricsCollector()
```


### 5. packages/backend/src/observability/health.py

```python
"""Health check aggregation."""

import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Any

from src.observability.logging import get_logger

logger = get_logger(__name__)


class HealthStatus(str, Enum):
    """Health check status values."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class HealthCheck:
    """Individual health check result."""
    name: str
    status: HealthStatus
    message: str | None = None
    latency_ms: float | None = None


class HealthChecker:
    """
    Aggregates multiple health checks.
    
    Usage:
        checker = HealthChecker()
        checker.add_check("database", check_database)
        checker.add_check("redis", check_redis)
        
        result = await checker.run_all()
    """
    
    def __init__(self):
        self._checks: dict[str, Callable[[], Any]] = {}
    
    def add_check(self, name: str, check_fn: Callable[[], Any]) -> None:
        """Add a health check function."""
        self._checks[name] = check_fn
    
    async def run_all(self, timeout: float = 5.0) -> dict:
        """Run all health checks with timeout."""
        results: dict[str, HealthCheck] = {}
        
        for name, check_fn in self._checks.items():
            try:
                import time
                start = time.perf_counter()
                
                # Run check with timeout
                result = check_fn()
                if asyncio.iscoroutine(result):
                    result = await asyncio.wait_for(result, timeout=timeout)
                
                latency = (time.perf_counter() - start) * 1000
                
                results[name] = HealthCheck(
                    name=name,
                    status=HealthStatus.HEALTHY,
                    latency_ms=round(latency, 2),
                )
                
            except asyncio.TimeoutError:
                results[name] = HealthCheck(
                    name=name,
                    status=HealthStatus.UNHEALTHY,
                    message="Health check timed out",
                )
            except Exception as e:
                logger.warning(f"Health check failed: {name}", error=str(e))
                results[name] = HealthCheck(
                    name=name,
                    status=HealthStatus.UNHEALTHY,
                    message=str(e),
                )
        
        # Determine overall status
        statuses = [r.status for r in results.values()]
        if all(s == HealthStatus.HEALTHY for s in statuses):
            overall = HealthStatus.HEALTHY
        elif any(s == HealthStatus.UNHEALTHY for s in statuses):
            overall = HealthStatus.UNHEALTHY
        else:
            overall = HealthStatus.DEGRADED
        
        return {
            "status": overall.value,
            "checks": {
                name: {
                    "status": check.status.value,
                    "message": check.message,
                    "latency_ms": check.latency_ms,
                }
                for name, check in results.items()
            },
        }


# Default health checker with common checks
def create_default_health_checker() -> HealthChecker:
    """Create health checker with default checks."""
    checker = HealthChecker()
    
    # Database check
    async def check_database():
        from src.database import get_db
        db = get_db()
        db.table("users").select("id").limit(1).execute()
    
    checker.add_check("database", check_database)
    
    return checker
```

### 6. apps/web/lib/observability/logger.ts

```typescript
/**
 * Frontend logging utility.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private context: LogContext = {};
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const fullContext = { ...this.context, ...context };

    if (process.env.NODE_ENV === 'production') {
      // JSON format for production
      console[level](JSON.stringify({
        timestamp,
        level,
        message,
        ...fullContext,
      }));
    } else {
      // Pretty format for development
      const contextStr = Object.keys(fullContext).length
        ? ` ${JSON.stringify(fullContext)}`
        : '';
      console[level](`[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`);
    }
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  debug(message: string, context?: LogContext): void {
    this.formatMessage('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.formatMessage('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.formatMessage('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.formatMessage('error', message, context);
  }
}

export const logger = new Logger(
  process.env.NODE_ENV === 'production' ? 'info' : 'debug'
);
```

### 7. Update packages/backend/src/main.py

```python
"""
FastAPI application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.exception_handlers import register_exception_handlers
from src.auth.middleware import AuthMiddleware
from src.observability import setup_logging, RequestLoggingMiddleware

# Setup logging first
setup_logging()

app = FastAPI(
    title="SaaS Backend",
    description="Enterprise-grade SaaS backend",
    version="0.1.0",
    debug=settings.DEBUG,
)

# Register exception handlers
register_exception_handlers(app)

# Middleware stack (order matters - last added runs first)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {
        "status": "ok",
        "message": "SaaS Backend Running",
        "environment": settings.ENV,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 09
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 10 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Verify Python observability modules
cd packages/backend
source .venv/bin/activate
python -c "
from src.observability import setup_logging, get_logger, MetricsCollector

# Setup logging
setup_logging()
logger = get_logger('test')
logger.info('Test log message', extra_field='value')

# Test metrics
metrics = MetricsCollector()
metrics.increment('requests_total', labels={'method': 'GET'})
metrics.gauge('active_connections', 42)
with metrics.timer('request_duration'):
    pass
print('Metrics:', metrics.get_metrics())
"

# 2. Verify TypeScript logger
cd ../../apps/web
pnpm lint
```

**Success Criteria**:
- [ ] Structured logging outputs JSON in production mode
- [ ] Request logging middleware captures method, path, duration
- [ ] Metrics collector tracks counters, gauges, histograms
- [ ] Health checker aggregates multiple checks
- [ ] Frontend logger works in both dev and prod modes
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [10-INTEGRATIONS.md](./10-INTEGRATIONS.md) for third-party integrations.
