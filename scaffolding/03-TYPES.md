# Phase 03: Shared Types & Exception Taxonomy

> **Time**: 10 minutes  
> **Prerequisites**: [01-WORKSPACE](./01-WORKSPACE.md), [02-ENVIRONMENT](./02-ENVIRONMENT.md)  
> **Produces**: Shared TypeScript types, error codes, Python exception hierarchy

---

## 🤖 Agent Execution Context

**What you're doing**: Creating the type system and exception hierarchy that BOTH frontend and backend will use. This ensures consistent error handling across the entire stack.

**Expected state BEFORE execution**:
- Phase 01 and 02 complete
- `packages/types/src/` exists with index.ts and common.ts
- `packages/backend/src/` exists

**What you'll create**:
- `packages/types/src/errors.ts` — Error codes and ApiError type
- `packages/types/src/auth.ts` — User, Session, Tier types
- `packages/types/src/jobs.ts` — Job status, state machine types
- `packages/types/src/api.ts` — API response types
- `packages/types/src/index.ts` — UPDATE to export new files
- `packages/backend/src/exceptions.py` — Python exception classes
- `packages/backend/src/exception_handlers.py` — FastAPI error handlers
- UPDATE `packages/backend/src/main.py` — Register exception handlers

**Execution approach**:
1. Create all TypeScript type files in packages/types/src/
2. UPDATE the index.ts to export them (don't overwrite, ADD exports)
3. Create Python exceptions.py
4. Create exception_handlers.py
5. Update main.py to register handlers

**IMPORTANT**:
- The ErrorCode enum in TypeScript and Python MUST match exactly
- The Python exceptions use dataclasses, not regular classes
- When updating index.ts, ADD to existing exports, don't replace

**Why this matters**:
- Frontend can switch on error.code to show appropriate UI
- Backend returns consistent error format
- Type safety across the entire request/response cycle

**After completion, tell the user**:
- "Phase 03 complete. Shared types and exception taxonomy created."
- "Error codes are now consistent between frontend and backend."
- "Proceed to Phase 04 for database schema."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/types/src/errors.ts`
- `packages/backend/src/exceptions.py`

## Purpose

Create a unified type system and exception hierarchy that:
- Provides consistent error codes across frontend and backend
- Enables type-safe error handling
- Maps exceptions to HTTP status codes
- Includes retry hints for transient failures

---

## Artifacts to Create

### 1. packages/types/src/errors.ts

```typescript
/**
 * Standardized error codes used across the application.
 * 
 * These codes are used in API responses and enable
 * client-side error handling logic.
 */
export const ErrorCode = {
  // Authentication (401)
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_EMAIL_EXISTS: 'AUTH_EMAIL_EXISTS',
  AUTH_WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  
  // Authorization (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_TIER: 'INSUFFICIENT_TIER',
  
  // Resources (404/409)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  
  // Validation (422)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  
  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Payment (402)
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  
  // External Services (502/503/504)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  GENERATION_FAILED: 'GENERATION_FAILED',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
  
  // Internal (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];


/**
 * Standard API error response structure.
 */
export interface ApiError {
  error: {
    message: string;
    code: ErrorCodeType;
    details?: Record<string, unknown>;
    retryAfter?: number;
  };
}

/**
 * Type guard to check if a response is an API error.
 */
export function isApiError(response: unknown): response is ApiError {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as ApiError).error.code === 'string'
  );
}

/**
 * HTTP status code mapping for error codes.
 */
export const ErrorStatusMap: Record<ErrorCodeType, number> = {
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 401,
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 401,
  [ErrorCode.AUTH_TOKEN_INVALID]: 401,
  [ErrorCode.AUTH_EMAIL_EXISTS]: 409,
  [ErrorCode.AUTH_WEAK_PASSWORD]: 422,
  [ErrorCode.AUTH_REQUIRED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INSUFFICIENT_TIER]: 403,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_CONFLICT]: 409,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.INVALID_STATE_TRANSITION]: 409,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PAYMENT_REQUIRED]: 402,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.GENERATION_FAILED]: 502,
  [ErrorCode.GENERATION_TIMEOUT]: 504,
  [ErrorCode.INTERNAL_ERROR]: 500,
};
```

### 2. packages/types/src/auth.ts

```typescript
/**
 * Authentication and authorization types.
 */

import type { UUID, ISOTimestamp } from './common';

/**
 * Subscription tiers available in the system.
 */
export type SubscriptionTier = 'free' | 'pro' | 'studio' | 'enterprise';

/**
 * Subscription status values.
 */
export type SubscriptionStatus = 
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing'
  | 'unpaid';

/**
 * User profile data.
 */
export interface User {
  id: UUID;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

/**
 * JWT token payload.
 */
export interface TokenPayload {
  sub: string;  // User ID
  email: string;
  tier: SubscriptionTier;
  iat: number;  // Issued at
  exp: number;  // Expiration
}

/**
 * Authentication response from login/signup.
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: ISOTimestamp;
}

/**
 * Session data stored client-side.
 */
export interface Session {
  user: User;
  accessToken: string;
  expiresAt: ISOTimestamp;
}

/**
 * Tier feature entitlements.
 */
export interface TierEntitlements {
  tier: SubscriptionTier;
  monthlyLimit: number;
  features: string[];
  apiAccess: boolean;
  prioritySupport: boolean;
}

/**
 * Default entitlements per tier.
 */
export const TIER_ENTITLEMENTS: Record<SubscriptionTier, TierEntitlements> = {
  free: {
    tier: 'free',
    monthlyLimit: 10,
    features: ['basic'],
    apiAccess: false,
    prioritySupport: false,
  },
  pro: {
    tier: 'pro',
    monthlyLimit: 100,
    features: ['basic', 'advanced', 'analytics'],
    apiAccess: false,
    prioritySupport: true,
  },
  studio: {
    tier: 'studio',
    monthlyLimit: 500,
    features: ['basic', 'advanced', 'analytics', 'api', 'white_label'],
    apiAccess: true,
    prioritySupport: true,
  },
  enterprise: {
    tier: 'enterprise',
    monthlyLimit: -1,  // Unlimited
    features: ['basic', 'advanced', 'analytics', 'api', 'white_label', 'custom'],
    apiAccess: true,
    prioritySupport: true,
  },
};
```

### 3. packages/types/src/jobs.ts

```typescript
/**
 * Job processing types.
 */

import type { UUID, ISOTimestamp } from './common';

/**
 * Job status values.
 */
export type JobStatus = 
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial';

/**
 * Valid state transitions for jobs.
 */
export const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ['processing'],
  processing: ['completed', 'partial', 'failed'],
  completed: [],
  partial: [],
  failed: [],
};

/**
 * Check if a job status is terminal.
 */
export function isTerminalStatus(status: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[status].length === 0;
}

/**
 * Check if a transition is valid.
 */
export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[from].includes(to);
}

/**
 * Job entity.
 */
export interface Job {
  id: UUID;
  userId: UUID;
  jobType: string;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  parameters: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  completedAt: ISOTimestamp | null;
}

/**
 * Job creation request.
 */
export interface CreateJobRequest {
  jobType: string;
  parameters?: Record<string, unknown>;
}

/**
 * Job status response.
 */
export interface JobStatusResponse {
  id: UUID;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  createdAt: ISOTimestamp;
  completedAt: ISOTimestamp | null;
}

/**
 * Asset linked to a job.
 */
export interface Asset {
  id: UUID;
  jobId: UUID;
  userId: UUID;
  assetType: string;
  url: string;
  storagePath: string;
  fileSize: number;
  createdAt: ISOTimestamp;
}
```

### 4. packages/types/src/api.ts

```typescript
/**
 * API request/response types.
 */

import type { PaginatedResponse, ApiResponse, ApiErrorResponse } from './common';

/**
 * Standard success response.
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

/**
 * Standard error response.
 */
export interface ErrorResponse {
  success: false;
  error: ApiErrorResponse['error'];
}

/**
 * Union type for API responses.
 */
export type ApiResult<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Health check response.
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error' | 'disabled';
    external: Record<string, 'ok' | 'error'>;
  };
}

/**
 * Rate limit headers.
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;  // Unix timestamp
}

/**
 * Idempotency key header name.
 */
export const IDEMPOTENCY_KEY_HEADER = 'X-Idempotency-Key';

/**
 * Rate limit header names.
 */
export const RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
} as const;
```


### 5. Update packages/types/src/index.ts

```typescript
/**
 * Shared types package
 * 
 * This package contains all shared TypeScript types used across
 * the frontend and any TypeScript-based services.
 */

export * from './common';
export * from './errors';
export * from './auth';
export * from './jobs';
export * from './api';
```

### 6. packages/backend/src/exceptions.py

```python
"""
Exception taxonomy for the application.

Provides a hierarchical exception system with:
- HTTP status code mapping
- Machine-readable error codes
- Human-readable messages
- Optional retry hints for transient failures
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ErrorCode(str, Enum):
    """Standardized error codes matching frontend."""
    
    # Authentication (401)
    AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS"
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"
    AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID"
    AUTH_EMAIL_EXISTS = "AUTH_EMAIL_EXISTS"
    AUTH_WEAK_PASSWORD = "AUTH_WEAK_PASSWORD"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    
    # Authorization (403)
    FORBIDDEN = "FORBIDDEN"
    INSUFFICIENT_TIER = "INSUFFICIENT_TIER"
    
    # Resources (404/409)
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    RESOURCE_CONFLICT = "RESOURCE_CONFLICT"
    
    # Validation (422)
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"
    
    # Rate Limiting (429)
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    
    # Payment (402)
    PAYMENT_REQUIRED = "PAYMENT_REQUIRED"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    
    # External Services (502/503/504)
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    GENERATION_FAILED = "GENERATION_FAILED"
    GENERATION_TIMEOUT = "GENERATION_TIMEOUT"
    
    # Internal (500)
    INTERNAL_ERROR = "INTERNAL_ERROR"


@dataclass
class AppError(Exception):
    """
    Base exception for all application errors.
    
    Attributes:
        message: Human-readable error message
        code: Machine-readable error code
        status_code: HTTP status code
        details: Additional error context
        retry_after: Seconds until retry is allowed (for rate limits)
    """
    
    message: str
    code: ErrorCode
    status_code: int = 500
    details: dict[str, Any] = field(default_factory=dict)
    retry_after: int | None = None
    
    def __post_init__(self) -> None:
        super().__init__(self.message)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        error_dict: dict[str, Any] = {
            "error": {
                "message": self.message,
                "code": self.code.value,
            }
        }
        
        if self.details:
            error_dict["error"]["details"] = self.details
        
        if self.retry_after is not None:
            error_dict["error"]["retryAfter"] = self.retry_after
        
        return error_dict
    
    def __str__(self) -> str:
        return f"{self.code.value}: {self.message}"


# =============================================================================
# Authentication Exceptions (401)
# =============================================================================

@dataclass
class AuthenticationError(AppError):
    """Base class for authentication errors."""
    
    message: str = "Authentication required"
    code: ErrorCode = field(default=ErrorCode.AUTH_REQUIRED)
    status_code: int = 401


@dataclass
class InvalidCredentialsError(AuthenticationError):
    """Invalid email or password."""
    
    message: str = "Invalid email or password"
    code: ErrorCode = field(default=ErrorCode.AUTH_INVALID_CREDENTIALS)


@dataclass
class TokenExpiredError(AuthenticationError):
    """JWT token has expired."""
    
    message: str = "Token has expired"
    code: ErrorCode = field(default=ErrorCode.AUTH_TOKEN_EXPIRED)


@dataclass
class TokenInvalidError(AuthenticationError):
    """JWT token is malformed or invalid."""
    
    message: str = "Invalid token"
    code: ErrorCode = field(default=ErrorCode.AUTH_TOKEN_INVALID)


# =============================================================================
# Authorization Exceptions (403)
# =============================================================================

@dataclass
class AuthorizationError(AppError):
    """User lacks permission for the requested resource."""
    
    message: str = "You do not have permission to access this resource"
    code: ErrorCode = field(default=ErrorCode.FORBIDDEN)
    status_code: int = 403
    resource_type: str = "resource"
    
    def __post_init__(self) -> None:
        self.message = f"You do not have permission to access this {self.resource_type}"
        self.details = {"resource_type": self.resource_type}
        super().__post_init__()


@dataclass
class InsufficientTierError(AppError):
    """User's subscription tier doesn't allow this action."""
    
    required_tier: str = "pro"
    current_tier: str = "free"
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.INSUFFICIENT_TIER)
    status_code: int = 403
    
    def __post_init__(self) -> None:
        self.message = f"This feature requires {self.required_tier} tier or higher"
        self.details = {
            "required_tier": self.required_tier,
            "current_tier": self.current_tier,
        }
        super().__post_init__()


# =============================================================================
# Resource Exceptions (404/409)
# =============================================================================

@dataclass
class NotFoundError(AppError):
    """Resource not found."""
    
    resource_type: str = "resource"
    resource_id: str = ""
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.RESOURCE_NOT_FOUND)
    status_code: int = 404
    
    def __post_init__(self) -> None:
        self.message = f"{self.resource_type.title()} not found"
        self.details = {
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
        }
        super().__post_init__()


@dataclass
class JobNotFoundError(NotFoundError):
    """Job not found."""
    
    job_id: str = ""
    resource_type: str = field(default="job", init=False)
    
    def __post_init__(self) -> None:
        self.resource_id = self.job_id
        super().__post_init__()


@dataclass
class ConflictError(AppError):
    """Resource conflict (e.g., duplicate)."""
    
    message: str = "Resource conflict"
    code: ErrorCode = field(default=ErrorCode.RESOURCE_CONFLICT)
    status_code: int = 409


@dataclass
class EmailExistsError(ConflictError):
    """Email already registered."""
    
    email: str = ""
    message: str = "An account with this email already exists"
    code: ErrorCode = field(default=ErrorCode.AUTH_EMAIL_EXISTS)


# =============================================================================
# Validation Exceptions (422)
# =============================================================================

@dataclass
class ValidationError(AppError):
    """Request validation failed."""
    
    message: str = "Validation error"
    code: ErrorCode = field(default=ErrorCode.VALIDATION_ERROR)
    status_code: int = 422
    field_errors: dict[str, list[str]] = field(default_factory=dict)
    
    def __post_init__(self) -> None:
        if self.field_errors:
            self.details = {"fields": self.field_errors}
        super().__post_init__()


@dataclass
class InvalidStateTransitionError(AppError):
    """Invalid state machine transition."""
    
    current_status: str = ""
    target_status: str = ""
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.INVALID_STATE_TRANSITION)
    status_code: int = 409
    
    def __post_init__(self) -> None:
        self.message = f"Cannot transition from '{self.current_status}' to '{self.target_status}'"
        self.details = {
            "current_status": self.current_status,
            "target_status": self.target_status,
        }
        super().__post_init__()


# =============================================================================
# Rate Limiting (429)
# =============================================================================

@dataclass
class RateLimitError(AppError):
    """Rate limit exceeded."""
    
    retry_after: int = 60
    message: str = "Rate limit exceeded"
    code: ErrorCode = field(default=ErrorCode.RATE_LIMIT_EXCEEDED)
    status_code: int = 429
    
    def __post_init__(self) -> None:
        self.details = {"retry_after": self.retry_after}
        super().__post_init__()


# =============================================================================
# External Service Exceptions (502/503/504)
# =============================================================================

@dataclass
class ExternalServiceError(AppError):
    """External service failed."""
    
    service_name: str = "external"
    message: str = field(init=False)
    code: ErrorCode = field(default=ErrorCode.EXTERNAL_SERVICE_ERROR)
    status_code: int = 502
    
    def __post_init__(self) -> None:
        self.message = f"External service error: {self.service_name}"
        self.details = {"service": self.service_name}
        super().__post_init__()


@dataclass
class ServiceUnavailableError(AppError):
    """Service temporarily unavailable."""
    
    retry_after: int = 30
    message: str = "Service temporarily unavailable"
    code: ErrorCode = field(default=ErrorCode.SERVICE_UNAVAILABLE)
    status_code: int = 503

```

### 7. packages/backend/src/exception_handlers.py

```python
"""
FastAPI exception handlers for consistent error responses.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.exceptions import AppError


def register_exception_handlers(app: FastAPI) -> None:
    """Register all exception handlers with the FastAPI app."""
    
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        """Handle all application errors with consistent response format."""
        headers = {}
        if exc.retry_after is not None:
            headers["Retry-After"] = str(exc.retry_after)
        
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_dict(),
            headers=headers if headers else None,
        )
    
    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
        """Handle unexpected errors."""
        # Log the full exception for debugging
        import logging
        logger = logging.getLogger(__name__)
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

### 8. Update packages/backend/src/main.py

```python
"""
FastAPI application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.exception_handlers import register_exception_handlers

app = FastAPI(
    title="SaaS Backend",
    description="Enterprise-grade SaaS backend",
    version="0.1.0",
    debug=settings.DEBUG,
)

# Register exception handlers
register_exception_handlers(app)

# CORS middleware
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
node Masterguide/scaffolding/scripts/verify-phase.js 03
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 04 until verification passes.**

**Manual checks if needed:**

```bash
# 1. Build types package
pnpm --filter @project/types build

# 2. Verify TypeScript exports
cd packages/types
node -e "const t = require('./dist'); console.log('ErrorCode:', Object.keys(t.ErrorCode).length, 'codes')"

# 3. Verify Python exceptions
cd ../backend
source .venv/bin/activate
python -c "
from src.exceptions import (
    AppError, ErrorCode, NotFoundError, 
    RateLimitError, InvalidStateTransitionError
)
print('ErrorCode values:', len(ErrorCode))

# Test exception creation
err = NotFoundError(resource_type='job', resource_id='123')
print('NotFoundError:', err.to_dict())

err = RateLimitError(retry_after=30)
print('RateLimitError:', err.to_dict())
"

# 4. Run Python tests
pytest -v

# 5. Verify exception handlers work
python -c "
from fastapi.testclient import TestClient
from src.main import app
client = TestClient(app)
response = client.get('/health')
print('Health check:', response.json())
"
```

**Success Criteria**:
- [ ] Types package builds without errors
- [ ] All error codes exported from TypeScript
- [ ] Python exceptions create correct response format
- [ ] Exception handlers registered with FastAPI
- [ ] Error responses include code, message, and optional details
- [ ] Rate limit errors include retry_after
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [04-DATABASE.md](./04-DATABASE.md) for database schema and migrations.
