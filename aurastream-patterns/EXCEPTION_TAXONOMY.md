# Exception Taxonomy Pattern

> Hierarchical exception system with HTTP status codes, error codes, and structured responses for consistent API error handling.

## Overview

A well-designed exception taxonomy provides:
- Consistent error responses across all endpoints
- Machine-readable error codes for client handling
- Human-readable messages for debugging
- HTTP status code mapping
- Retry hints for transient failures

## Architecture

```
BaseAppError (abstract)
├── AuthenticationError (401)
│   ├── InvalidCredentialsError
│   ├── TokenExpiredError
│   ├── TokenInvalidError
│   └── EmailExistsError
├── AuthorizationError (403)
├── ResourceError (404/409)
│   ├── NotFoundError
│   ├── JobNotFoundError
│   ├── AssetNotFoundError
│   └── ConflictError
├── ValidationError (422)
│   └── WeakPasswordError
├── RateLimitError (429)
├── ExternalServiceError (502/503)
│   ├── GenerationError
│   ├── GenerationTimeoutError
│   └── ContentPolicyError
└── PaymentError (402)
```

## Implementation

### Base Exception Class

```python
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from enum import Enum


class ErrorCode(str, Enum):
    """Standardized error codes for API responses."""
    # Authentication
    AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS"
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"
    AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID"
    AUTH_EMAIL_EXISTS = "AUTH_EMAIL_EXISTS"
    AUTH_WEAK_PASSWORD = "AUTH_WEAK_PASSWORD"
    
    # Authorization
    FORBIDDEN = "FORBIDDEN"
    
    # Resources
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    RESOURCE_CONFLICT = "RESOURCE_CONFLICT"
    
    # Rate Limiting
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    
    # Generation
    GENERATION_FAILED = "GENERATION_FAILED"
    GENERATION_TIMEOUT = "GENERATION_TIMEOUT"
    CONTENT_POLICY_VIOLATION = "CONTENT_POLICY_VIOLATION"
    
    # Payment
    PAYMENT_REQUIRED = "PAYMENT_REQUIRED"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    
    # Validation
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"


@dataclass
class BaseAppError(Exception):
    """
    Base exception for all application errors.
    
    Provides consistent error structure with:
    - HTTP status code mapping
    - Machine-readable error code
    - Human-readable message
    - Optional details for debugging
    - Retry hint for transient failures
    """
    message: str
    code: ErrorCode
    status_code: int = 500
    details: Optional[Dict[str, Any]] = field(default_factory=dict)
    retry_after: Optional[int] = None  # Seconds until retry is allowed
    
    def __post_init__(self):
        super().__init__(self.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to API response format."""
        error_dict = {
            "error": {
                "message": self.message,
                "code": self.code.value,
            }
        }
        
        if self.details:
            error_dict["error"]["details"] = self.details
        
        if self.retry_after is not None:
            error_dict["error"]["retry_after"] = self.retry_after
        
        return error_dict
    
    def __str__(self) -> str:
        return f"{self.code.value}: {self.message}"
```

### Authentication Exceptions

```python
@dataclass
class InvalidCredentialsError(BaseAppError):
    """Raised when login credentials are invalid."""
    message: str = "Invalid email or password"
    code: ErrorCode = field(default=ErrorCode.AUTH_INVALID_CREDENTIALS)
    status_code: int = 401


@dataclass
class TokenExpiredError(BaseAppError):
    """Raised when a JWT token has expired."""
    message: str = "Token has expired"
    code: ErrorCode = field(default=ErrorCode.AUTH_TOKEN_EXPIRED)
    status_code: int = 401


@dataclass
class TokenInvalidError(BaseAppError):
    """Raised when a JWT token is malformed or invalid."""
    message: str = "Invalid token"
    code: ErrorCode = field(default=ErrorCode.AUTH_TOKEN_INVALID)
    status_code: int = 401
    
    def __init__(self, message: str = "Invalid token", reason: str = None):
        self.message = message
        self.details = {"reason": reason} if reason else {}
        super().__post_init__()


@dataclass
class EmailExistsError(BaseAppError):
    """Raised when attempting to register with an existing email."""
    email: str = ""
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.AUTH_EMAIL_EXISTS)
    status_code: int = 409
    
    def __post_init__(self):
        self.message = "An account with this email already exists"
        self.details = {"email": self.email} if self.email else {}
        super().__post_init__()


@dataclass
class WeakPasswordError(BaseAppError):
    """Raised when password doesn't meet requirements."""
    requirements: list = field(default_factory=list)
    message: str = "Password does not meet security requirements"
    code: ErrorCode = field(default=ErrorCode.AUTH_WEAK_PASSWORD)
    status_code: int = 422
    
    def __post_init__(self):
        self.details = {"requirements": self.requirements}
        super().__post_init__()
```

### Resource Exceptions

```python
@dataclass
class NotFoundError(BaseAppError):
    """Base class for resource not found errors."""
    resource_type: str = "resource"
    resource_id: str = ""
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.RESOURCE_NOT_FOUND)
    status_code: int = 404
    
    def __post_init__(self):
        self.message = f"{self.resource_type.title()} not found"
        self.details = {
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
        }
        super().__post_init__()


@dataclass
class JobNotFoundError(NotFoundError):
    """Raised when a generation job is not found."""
    resource_type: str = field(default="job", init=False)
    
    def __init__(self, job_id: str):
        self.resource_id = job_id
        super().__post_init__()


@dataclass
class AssetNotFoundError(NotFoundError):
    """Raised when an asset is not found."""
    resource_type: str = field(default="asset", init=False)
    
    def __init__(self, asset_id: str):
        self.resource_id = asset_id
        super().__post_init__()


@dataclass
class AuthorizationError(BaseAppError):
    """Raised when user lacks permission for a resource."""
    resource_type: str = "resource"
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.FORBIDDEN)
    status_code: int = 403
    
    def __post_init__(self):
        self.message = f"You do not have permission to access this {self.resource_type}"
        self.details = {"resource_type": self.resource_type}
        super().__post_init__()
```

### External Service Exceptions

```python
@dataclass
class RateLimitError(BaseAppError):
    """Raised when rate limit is exceeded."""
    retry_after: int = 60
    message: str = "Rate limit exceeded"
    code: ErrorCode = field(default=ErrorCode.RATE_LIMIT_EXCEEDED)
    status_code: int = 429
    
    def __post_init__(self):
        self.details = {"retry_after": self.retry_after}
        super().__post_init__()


@dataclass
class GenerationError(BaseAppError):
    """Raised when AI generation fails."""
    message: str = "Image generation failed"
    code: ErrorCode = field(default=ErrorCode.GENERATION_FAILED)
    status_code: int = 502
    
    def __init__(self, message: str = "Image generation failed", details: dict = None):
        self.message = message
        self.details = details or {}
        super().__post_init__()


@dataclass
class GenerationTimeoutError(BaseAppError):
    """Raised when AI generation times out."""
    timeout_seconds: int = 120
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.GENERATION_TIMEOUT)
    status_code: int = 504
    retry_after: int = field(init=False)
    
    def __post_init__(self):
        self.message = f"Generation timed out after {self.timeout_seconds} seconds"
        self.retry_after = 30  # Suggest retry after 30 seconds
        self.details = {"timeout_seconds": self.timeout_seconds}
        super().__post_init__()


@dataclass
class ContentPolicyError(BaseAppError):
    """Raised when content violates AI safety policies."""
    reason: str = "Content violates usage policies"
    message: str = "Content policy violation"
    code: ErrorCode = field(default=ErrorCode.CONTENT_POLICY_VIOLATION)
    status_code: int = 400
    
    def __post_init__(self):
        self.details = {"reason": self.reason}
        super().__post_init__()
```

### State Transition Exception

```python
@dataclass
class InvalidStateTransitionError(BaseAppError):
    """Raised when an invalid state transition is attempted."""
    current_status: str = ""
    target_status: str = ""
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.INVALID_STATE_TRANSITION)
    status_code: int = 409
    
    def __post_init__(self):
        self.message = f"Cannot transition from '{self.current_status}' to '{self.target_status}'"
        self.details = {
            "current_status": self.current_status,
            "target_status": self.target_status,
        }
        super().__post_init__()
```

## FastAPI Integration

### Exception Handlers

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


@app.exception_handler(BaseAppError)
async def app_error_handler(request: Request, exc: BaseAppError) -> JSONResponse:
    """Handle all application errors with consistent response format."""
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
        headers={"Retry-After": str(exc.retry_after)} if exc.retry_after else None,
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected errors."""
    # Log the full exception for debugging
    logger.exception(f"Unexpected error: {exc}")
    
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "message": "An unexpected error occurred",
                "code": "INTERNAL_ERROR",
            }
        },
    )
```

### Route Usage

```python
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str = Depends(get_current_user)):
    job = await job_service.get(job_id)
    
    if not job:
        raise JobNotFoundError(job_id)
    
    if job.user_id != user_id:
        raise AuthorizationError(resource_type="job")
    
    return job


@router.post("/jobs/{job_id}/transition")
async def transition_job(job_id: str, target_status: str):
    job = await job_service.get(job_id)
    
    if target_status not in VALID_TRANSITIONS.get(job.status, []):
        raise InvalidStateTransitionError(
            current_status=job.status,
            target_status=target_status,
        )
    
    return await job_service.update_status(job_id, target_status)
```

## Client-Side Handling

### TypeScript Error Types

```typescript
interface APIError {
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
    retry_after?: number;
  };
}

// Error code constants
const ErrorCodes = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CONTENT_POLICY_VIOLATION: 'CONTENT_POLICY_VIOLATION',
} as const;

// Handle errors by code
function handleAPIError(error: APIError): void {
  switch (error.error.code) {
    case ErrorCodes.AUTH_TOKEN_EXPIRED:
      // Trigger token refresh
      authStore.refreshToken();
      break;
    
    case ErrorCodes.RATE_LIMIT_EXCEEDED:
      // Show retry message with countdown
      const retryAfter = error.error.retry_after || 60;
      toast.error(`Rate limited. Try again in ${retryAfter}s`);
      break;
    
    case ErrorCodes.CONTENT_POLICY_VIOLATION:
      // Show content policy message
      toast.error('Your content was flagged. Please modify and try again.');
      break;
    
    default:
      toast.error(error.error.message);
  }
}
```

## Best Practices

1. **Use specific exceptions** - Create domain-specific exceptions rather than generic ones
2. **Include context** - Always include relevant IDs and state in error details
3. **Map to HTTP codes** - Each exception should have a clear HTTP status code
4. **Provide retry hints** - For transient failures, include `retry_after`
5. **Log appropriately** - Log full details server-side, return safe messages to clients
6. **Use error codes** - Machine-readable codes enable client-side handling logic

## Testing

```python
import pytest
from app.exceptions import JobNotFoundError, InvalidStateTransitionError


def test_job_not_found_error():
    error = JobNotFoundError("job-123")
    
    assert error.status_code == 404
    assert error.code == ErrorCode.RESOURCE_NOT_FOUND
    assert "job-123" in error.to_dict()["error"]["details"]["resource_id"]


def test_invalid_state_transition():
    error = InvalidStateTransitionError(
        current_status="completed",
        target_status="processing",
    )
    
    assert error.status_code == 409
    assert "completed" in error.message
    assert "processing" in error.message
```
