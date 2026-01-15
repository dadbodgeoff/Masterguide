# Logging & Observability Pattern

> Structured logging with correlation IDs, request context propagation, and performance metrics.

## Overview

This pattern provides:
- Structured JSON logging for machine parsing
- Correlation IDs for request tracing
- Context propagation across async boundaries
- Performance timing decorators
- Worker-specific metrics collection

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Request   │────▶│  Middleware │────▶│   Handler   │
│             │     │ (Context)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                          │                    │
                          ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Logger    │     │   Logger    │
                    │ (w/ context)│     │ (w/ context)│
                    └─────────────┘     └─────────────┘
                          │                    │
                          ▼                    ▼
                    ┌─────────────────────────────────┐
                    │         Log Aggregator          │
                    │   (CloudWatch, Datadog, etc.)   │
                    └─────────────────────────────────┘
```

## Implementation

### Logging Context

```python
import contextvars
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Dict, Any

# Context variable for request-scoped logging context
_logging_context: contextvars.ContextVar["LoggingContext"] = contextvars.ContextVar(
    "logging_context",
    default=None,
)


@dataclass
class LoggingContext:
    """
    Request-scoped logging context.
    
    Carries correlation ID and metadata through async call chains.
    """
    correlation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    request_path: Optional[str] = None
    request_method: Optional[str] = None
    service_name: str = "api"
    environment: str = "development"
    extra: Dict[str, Any] = field(default_factory=dict)
    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for log record."""
        return {
            "correlation_id": self.correlation_id,
            "user_id": self.user_id,
            "request_path": self.request_path,
            "request_method": self.request_method,
            "service_name": self.service_name,
            "environment": self.environment,
            **self.extra,
        }
    
    def with_extra(self, **kwargs) -> "LoggingContext":
        """Create new context with additional fields."""
        return LoggingContext(
            correlation_id=self.correlation_id,
            user_id=self.user_id,
            request_path=self.request_path,
            request_method=self.request_method,
            service_name=self.service_name,
            environment=self.environment,
            extra={**self.extra, **kwargs},
            start_time=self.start_time,
        )


def get_logging_context() -> Optional[LoggingContext]:
    """Get current logging context."""
    return _logging_context.get()


def set_logging_context(context: LoggingContext) -> contextvars.Token:
    """Set logging context for current async context."""
    return _logging_context.set(context)


def reset_logging_context(token: contextvars.Token) -> None:
    """Reset logging context to previous value."""
    _logging_context.reset(token)
```

### Structured JSON Formatter

```python
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any, Dict


class StructuredJsonFormatter(logging.Formatter):
    """
    JSON log formatter with context injection.
    
    Output format:
    {
        "timestamp": "2024-01-15T10:30:00.000Z",
        "level": "INFO",
        "logger": "app.service",
        "message": "Processing request",
        "correlation_id": "abc-123",
        "user_id": "user-456",
        "duration_ms": 150,
        ...
    }
    """
    
    def format(self, record: logging.LogRecord) -> str:
        # Base log entry
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Add context if available
        context = get_logging_context()
        if context:
            log_entry.update(context.to_dict())
        
        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": traceback.format_exception(*record.exc_info),
            }
        
        # Add extra fields from record
        for key, value in record.__dict__.items():
            if key not in (
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "exc_info", "exc_text", "thread", "threadName",
                "message",
            ):
                log_entry[key] = value
        
        return json.dumps(log_entry, default=str)


def configure_logging(
    level: str = "INFO",
    service_name: str = "api",
    environment: str = "development",
) -> None:
    """Configure structured logging for the application."""
    # Create formatter
    formatter = StructuredJsonFormatter()
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add stream handler with JSON formatter
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)
    
    # Set default context
    set_logging_context(LoggingContext(
        service_name=service_name,
        environment=environment,
    ))
```

### Context-Aware Logger

```python
import logging
from typing import Any, Optional


class ContextLogger:
    """
    Logger wrapper that automatically includes context.
    
    Usage:
        logger = ContextLogger(__name__)
        logger.info("Processing", job_id="123", duration_ms=150)
    """
    
    def __init__(self, name: str):
        self._logger = logging.getLogger(name)
    
    def _log(
        self,
        level: int,
        message: str,
        exc_info: bool = False,
        **kwargs: Any,
    ) -> None:
        """Log with extra context fields."""
        # Get current context
        context = get_logging_context()
        
        # Merge context with kwargs
        extra = {}
        if context:
            extra.update(context.to_dict())
        extra.update(kwargs)
        
        self._logger.log(level, message, exc_info=exc_info, extra=extra)
    
    def debug(self, message: str, **kwargs: Any) -> None:
        self._log(logging.DEBUG, message, **kwargs)
    
    def info(self, message: str, **kwargs: Any) -> None:
        self._log(logging.INFO, message, **kwargs)
    
    def warning(self, message: str, **kwargs: Any) -> None:
        self._log(logging.WARNING, message, **kwargs)
    
    def error(self, message: str, exc_info: bool = False, **kwargs: Any) -> None:
        self._log(logging.ERROR, message, exc_info=exc_info, **kwargs)
    
    def exception(self, message: str, **kwargs: Any) -> None:
        self._log(logging.ERROR, message, exc_info=True, **kwargs)


# Convenience function
def get_logger(name: str) -> ContextLogger:
    """Get a context-aware logger."""
    return ContextLogger(name)
```

### FastAPI Middleware

```python
import time
import uuid
from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that sets up logging context for each request.
    
    Features:
    - Generates correlation ID (or uses X-Correlation-ID header)
    - Logs request start and completion
    - Tracks request duration
    - Propagates context to all handlers
    """
    
    async def dispatch(self, request: Request, call_next) -> Response:
        # Get or generate correlation ID
        correlation_id = request.headers.get(
            "X-Correlation-ID",
            str(uuid.uuid4()),
        )
        
        # Extract user ID from auth (if available)
        user_id = None
        if hasattr(request.state, "user"):
            user_id = request.state.user.id
        
        # Create logging context
        context = LoggingContext(
            correlation_id=correlation_id,
            user_id=user_id,
            request_path=request.url.path,
            request_method=request.method,
        )
        
        # Set context
        token = set_logging_context(context)
        
        try:
            # Log request start
            logger.info(
                "Request started",
                query_params=str(request.query_params),
                client_ip=request.client.host if request.client else None,
            )
            
            # Process request
            start_time = time.perf_counter()
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000
            
            # Log request completion
            logger.info(
                "Request completed",
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )
            
            # Add correlation ID to response headers
            response.headers["X-Correlation-ID"] = correlation_id
            
            return response
            
        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.exception(
                "Request failed",
                duration_ms=round(duration_ms, 2),
                error_type=type(e).__name__,
            )
            raise
            
        finally:
            reset_logging_context(token)


def setup_logging_middleware(app: FastAPI) -> None:
    """Add logging middleware to FastAPI app."""
    app.add_middleware(LoggingMiddleware)
```

### Performance Timing Decorator

```python
import functools
import time
from typing import Callable, TypeVar, Any

F = TypeVar("F", bound=Callable[..., Any])

logger = get_logger(__name__)


def timed(
    operation_name: str = None,
    log_args: bool = False,
    threshold_ms: float = None,
) -> Callable[[F], F]:
    """
    Decorator to log function execution time.
    
    Args:
        operation_name: Name for the operation (defaults to function name)
        log_args: Whether to log function arguments
        threshold_ms: Only log if duration exceeds threshold
        
    Usage:
        @timed("database_query")
        async def fetch_user(user_id: str):
            ...
    """
    def decorator(func: F) -> F:
        name = operation_name or func.__name__
        
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            start = time.perf_counter()
            
            try:
                result = await func(*args, **kwargs)
                duration_ms = (time.perf_counter() - start) * 1000
                
                # Only log if above threshold (or no threshold)
                if threshold_ms is None or duration_ms >= threshold_ms:
                    log_kwargs = {
                        "operation": name,
                        "duration_ms": round(duration_ms, 2),
                    }
                    if log_args:
                        log_kwargs["args"] = str(args)[:200]
                        log_kwargs["kwargs"] = str(kwargs)[:200]
                    
                    logger.info(f"{name} completed", **log_kwargs)
                
                return result
                
            except Exception as e:
                duration_ms = (time.perf_counter() - start) * 1000
                logger.error(
                    f"{name} failed",
                    operation=name,
                    duration_ms=round(duration_ms, 2),
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                raise
        
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            start = time.perf_counter()
            
            try:
                result = func(*args, **kwargs)
                duration_ms = (time.perf_counter() - start) * 1000
                
                if threshold_ms is None or duration_ms >= threshold_ms:
                    logger.info(
                        f"{name} completed",
                        operation=name,
                        duration_ms=round(duration_ms, 2),
                    )
                
                return result
                
            except Exception as e:
                duration_ms = (time.perf_counter() - start) * 1000
                logger.error(
                    f"{name} failed",
                    operation=name,
                    duration_ms=round(duration_ms, 2),
                    error_type=type(e).__name__,
                    exc_info=True,
                )
                raise
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator
```

### Worker Metrics

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional
import threading


@dataclass
class WorkerMetrics:
    """Metrics for a background worker."""
    worker_name: str
    jobs_processed: int = 0
    jobs_failed: int = 0
    total_duration_ms: float = 0
    last_job_at: Optional[datetime] = None
    current_job_id: Optional[str] = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    @property
    def avg_duration_ms(self) -> float:
        if self.jobs_processed == 0:
            return 0
        return self.total_duration_ms / self.jobs_processed
    
    @property
    def success_rate(self) -> float:
        total = self.jobs_processed + self.jobs_failed
        if total == 0:
            return 1.0
        return self.jobs_processed / total
    
    def to_dict(self) -> Dict:
        return {
            "worker_name": self.worker_name,
            "jobs_processed": self.jobs_processed,
            "jobs_failed": self.jobs_failed,
            "avg_duration_ms": round(self.avg_duration_ms, 2),
            "success_rate": round(self.success_rate, 4),
            "last_job_at": self.last_job_at.isoformat() if self.last_job_at else None,
            "current_job_id": self.current_job_id,
            "uptime_seconds": (datetime.now(timezone.utc) - self.started_at).total_seconds(),
        }


class WorkerMetricsCollector:
    """
    Collects and exposes worker metrics.
    
    Thread-safe for use in multi-threaded workers.
    """
    
    _instance: Optional["WorkerMetricsCollector"] = None
    _lock = threading.Lock()
    
    def __init__(self):
        self._metrics: Dict[str, WorkerMetrics] = {}
        self._metrics_lock = threading.Lock()
    
    @classmethod
    def get_instance(cls) -> "WorkerMetricsCollector":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def register_worker(self, worker_name: str) -> None:
        """Register a new worker."""
        with self._metrics_lock:
            if worker_name not in self._metrics:
                self._metrics[worker_name] = WorkerMetrics(worker_name=worker_name)
    
    def job_started(self, worker_name: str, job_id: str) -> None:
        """Record job start."""
        with self._metrics_lock:
            if worker_name in self._metrics:
                self._metrics[worker_name].current_job_id = job_id
    
    def job_completed(
        self,
        worker_name: str,
        job_id: str,
        duration_ms: float,
    ) -> None:
        """Record successful job completion."""
        with self._metrics_lock:
            if worker_name in self._metrics:
                metrics = self._metrics[worker_name]
                metrics.jobs_processed += 1
                metrics.total_duration_ms += duration_ms
                metrics.last_job_at = datetime.now(timezone.utc)
                metrics.current_job_id = None
    
    def job_failed(self, worker_name: str, job_id: str) -> None:
        """Record job failure."""
        with self._metrics_lock:
            if worker_name in self._metrics:
                metrics = self._metrics[worker_name]
                metrics.jobs_failed += 1
                metrics.last_job_at = datetime.now(timezone.utc)
                metrics.current_job_id = None
    
    def get_metrics(self, worker_name: str = None) -> Dict:
        """Get metrics for one or all workers."""
        with self._metrics_lock:
            if worker_name:
                metrics = self._metrics.get(worker_name)
                return metrics.to_dict() if metrics else {}
            return {
                name: m.to_dict()
                for name, m in self._metrics.items()
            }


# Convenience functions
def get_metrics_collector() -> WorkerMetricsCollector:
    return WorkerMetricsCollector.get_instance()
```

### Worker Context Manager

```python
import time
from contextlib import contextmanager
from typing import Generator

logger = get_logger(__name__)


@contextmanager
def worker_job_context(
    worker_name: str,
    job_id: str,
    user_id: str = None,
) -> Generator[None, None, None]:
    """
    Context manager for worker job execution.
    
    Sets up logging context and tracks metrics.
    
    Usage:
        with worker_job_context("generation_worker", job_id, user_id):
            # Process job
            ...
    """
    # Set up logging context
    context = LoggingContext(
        correlation_id=job_id,
        user_id=user_id,
        service_name=worker_name,
        extra={"job_id": job_id},
    )
    token = set_logging_context(context)
    
    # Track metrics
    collector = get_metrics_collector()
    collector.job_started(worker_name, job_id)
    
    start_time = time.perf_counter()
    
    try:
        logger.info("Job started", job_id=job_id)
        yield
        
        duration_ms = (time.perf_counter() - start_time) * 1000
        collector.job_completed(worker_name, job_id, duration_ms)
        logger.info(
            "Job completed",
            job_id=job_id,
            duration_ms=round(duration_ms, 2),
        )
        
    except Exception as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        collector.job_failed(worker_name, job_id)
        logger.exception(
            "Job failed",
            job_id=job_id,
            duration_ms=round(duration_ms, 2),
            error_type=type(e).__name__,
        )
        raise
        
    finally:
        reset_logging_context(token)
```

## Usage Examples

### In API Routes

```python
from fastapi import APIRouter

router = APIRouter()
logger = get_logger(__name__)


@router.post("/generate")
@timed("generate_asset")
async def generate_asset(request: GenerateRequest):
    logger.info("Starting generation", asset_type=request.asset_type)
    
    # Processing...
    
    logger.info("Generation queued", job_id=job.id)
    return {"job_id": job.id}
```

### In Workers

```python
def process_job(job_id: str, user_id: str):
    with worker_job_context("generation_worker", job_id, user_id):
        logger.info("Processing generation job")
        
        # All logs within this block include job_id and user_id
        result = generate_image(...)
        
        logger.info("Image generated", size_bytes=len(result))
```

### Metrics Endpoint

```python
@router.get("/metrics")
async def get_worker_metrics():
    """Get worker metrics for monitoring."""
    collector = get_metrics_collector()
    return collector.get_metrics()
```

## Best Practices

1. **Always use correlation IDs** - Essential for distributed tracing
2. **Structured logging** - JSON format for log aggregation
3. **Context propagation** - Use contextvars for async code
4. **Performance thresholds** - Only log slow operations
5. **Sensitive data** - Never log passwords, tokens, or PII
6. **Log levels** - DEBUG for development, INFO for production
7. **Metrics collection** - Track success rates and durations
