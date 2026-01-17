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
- `packages/types/src/errors.test.ts` — Tests for error types and guards
- `packages/types/src/jobs.test.ts` — Tests for job state machine
- `packages/backend/src/exceptions.py` — Python exception classes
- `packages/backend/src/exception_handlers.py` — FastAPI error handlers
- `packages/backend/tests/test_exceptions.py` — Tests for exception classes
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


---

## Testing Additions

> Tests for type guards, error code mapping, and exception behavior.

### 9. packages/types/src/errors.test.ts

```typescript
/**
 * Tests for error types and utilities.
 */

import { describe, it, expect } from 'vitest';
import { 
  ErrorCode, 
  ErrorStatusMap, 
  isApiError,
  type ApiError,
  type ErrorCodeType 
} from './errors';

describe('ErrorCode', () => {
  it('should have all expected error codes', () => {
    expect(ErrorCode.AUTH_REQUIRED).toBe('AUTH_REQUIRED');
    expect(ErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
    expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('should have matching status codes for all error codes', () => {
    const errorCodes = Object.values(ErrorCode);
    
    for (const code of errorCodes) {
      expect(ErrorStatusMap[code as ErrorCodeType]).toBeDefined();
      expect(typeof ErrorStatusMap[code as ErrorCodeType]).toBe('number');
    }
  });
});

describe('ErrorStatusMap', () => {
  it('should map auth errors to 401', () => {
    expect(ErrorStatusMap[ErrorCode.AUTH_REQUIRED]).toBe(401);
    expect(ErrorStatusMap[ErrorCode.AUTH_TOKEN_EXPIRED]).toBe(401);
    expect(ErrorStatusMap[ErrorCode.AUTH_TOKEN_INVALID]).toBe(401);
  });

  it('should map authorization errors to 403', () => {
    expect(ErrorStatusMap[ErrorCode.FORBIDDEN]).toBe(403);
    expect(ErrorStatusMap[ErrorCode.INSUFFICIENT_TIER]).toBe(403);
  });

  it('should map not found to 404', () => {
    expect(ErrorStatusMap[ErrorCode.RESOURCE_NOT_FOUND]).toBe(404);
  });

  it('should map rate limit to 429', () => {
    expect(ErrorStatusMap[ErrorCode.RATE_LIMIT_EXCEEDED]).toBe(429);
  });

  it('should map internal error to 500', () => {
    expect(ErrorStatusMap[ErrorCode.INTERNAL_ERROR]).toBe(500);
  });
});

describe('isApiError', () => {
  it('should return true for valid API error', () => {
    const error: ApiError = {
      error: {
        message: 'Not found',
        code: 'RESOURCE_NOT_FOUND',
      },
    };
    
    expect(isApiError(error)).toBe(true);
  });

  it('should return true for API error with details', () => {
    const error: ApiError = {
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: { field: 'email', reason: 'invalid format' },
      },
    };
    
    expect(isApiError(error)).toBe(true);
  });

  it('should return true for API error with retryAfter', () => {
    const error: ApiError = {
      error: {
        message: 'Rate limited',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60,
      },
    };
    
    expect(isApiError(error)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isApiError(undefined)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isApiError('error')).toBe(false);
    expect(isApiError(123)).toBe(false);
  });

  it('should return false for object without error property', () => {
    expect(isApiError({ message: 'error' })).toBe(false);
  });

  it('should return false for object with invalid error structure', () => {
    expect(isApiError({ error: 'string' })).toBe(false);
    expect(isApiError({ error: { message: 'test' } })).toBe(false);
  });
});
```

### 10. packages/types/src/jobs.test.ts

```typescript
/**
 * Tests for job types and state machine.
 */

import { describe, it, expect } from 'vitest';
import { 
  VALID_JOB_TRANSITIONS, 
  isTerminalStatus, 
  isValidTransition,
  type JobStatus 
} from './jobs';

describe('VALID_JOB_TRANSITIONS', () => {
  it('should allow queued to transition to processing', () => {
    expect(VALID_JOB_TRANSITIONS.queued).toContain('processing');
  });

  it('should allow processing to transition to completed, partial, or failed', () => {
    expect(VALID_JOB_TRANSITIONS.processing).toContain('completed');
    expect(VALID_JOB_TRANSITIONS.processing).toContain('partial');
    expect(VALID_JOB_TRANSITIONS.processing).toContain('failed');
  });

  it('should not allow completed to transition', () => {
    expect(VALID_JOB_TRANSITIONS.completed).toHaveLength(0);
  });

  it('should not allow failed to transition', () => {
    expect(VALID_JOB_TRANSITIONS.failed).toHaveLength(0);
  });

  it('should not allow partial to transition', () => {
    expect(VALID_JOB_TRANSITIONS.partial).toHaveLength(0);
  });
});

describe('isTerminalStatus', () => {
  it('should return true for completed', () => {
    expect(isTerminalStatus('completed')).toBe(true);
  });

  it('should return true for failed', () => {
    expect(isTerminalStatus('failed')).toBe(true);
  });

  it('should return true for partial', () => {
    expect(isTerminalStatus('partial')).toBe(true);
  });

  it('should return false for queued', () => {
    expect(isTerminalStatus('queued')).toBe(false);
  });

  it('should return false for processing', () => {
    expect(isTerminalStatus('processing')).toBe(false);
  });
});

describe('isValidTransition', () => {
  it('should allow queued -> processing', () => {
    expect(isValidTransition('queued', 'processing')).toBe(true);
  });

  it('should allow processing -> completed', () => {
    expect(isValidTransition('processing', 'completed')).toBe(true);
  });

  it('should allow processing -> failed', () => {
    expect(isValidTransition('processing', 'failed')).toBe(true);
  });

  it('should allow processing -> partial', () => {
    expect(isValidTransition('processing', 'partial')).toBe(true);
  });

  it('should not allow queued -> completed (skip processing)', () => {
    expect(isValidTransition('queued', 'completed')).toBe(false);
  });

  it('should not allow completed -> processing (reverse)', () => {
    expect(isValidTransition('completed', 'processing')).toBe(false);
  });

  it('should not allow failed -> queued (restart)', () => {
    expect(isValidTransition('failed', 'queued')).toBe(false);
  });

  it('should not allow processing -> queued (reverse)', () => {
    expect(isValidTransition('processing', 'queued')).toBe(false);
  });
});
```

### 11. packages/backend/tests/test_exceptions.py

```python
"""
Tests for exception classes and error handling.
"""

import pytest
from src.exceptions import (
    AppError,
    ErrorCode,
    AuthenticationError,
    InvalidCredentialsError,
    TokenExpiredError,
    AuthorizationError,
    InsufficientTierError,
    NotFoundError,
    JobNotFoundError,
    ValidationError,
    InvalidStateTransitionError,
    RateLimitError,
    ExternalServiceError,
)


class TestErrorCode:
    """Tests for ErrorCode enum."""
    
    def test_error_codes_are_strings(self):
        """All error codes should be string values."""
        for code in ErrorCode:
            assert isinstance(code.value, str)
    
    def test_auth_codes_exist(self):
        """Authentication error codes should exist."""
        assert ErrorCode.AUTH_REQUIRED
        assert ErrorCode.AUTH_TOKEN_EXPIRED
        assert ErrorCode.AUTH_INVALID_CREDENTIALS
    
    def test_resource_codes_exist(self):
        """Resource error codes should exist."""
        assert ErrorCode.RESOURCE_NOT_FOUND
        assert ErrorCode.RESOURCE_CONFLICT


class TestAppError:
    """Tests for base AppError class."""
    
    def test_to_dict_basic(self):
        """to_dict should return correct structure."""
        error = AppError(
            message="Test error",
            code=ErrorCode.INTERNAL_ERROR,
        )
        
        result = error.to_dict()
        
        assert result["error"]["message"] == "Test error"
        assert result["error"]["code"] == "INTERNAL_ERROR"
        assert "details" not in result["error"]
        assert "retryAfter" not in result["error"]
    
    def test_to_dict_with_details(self):
        """to_dict should include details when present."""
        error = AppError(
            message="Test error",
            code=ErrorCode.VALIDATION_ERROR,
            details={"field": "email"},
        )
        
        result = error.to_dict()
        
        assert result["error"]["details"] == {"field": "email"}
    
    def test_to_dict_with_retry_after(self):
        """to_dict should include retryAfter when present."""
        error = AppError(
            message="Rate limited",
            code=ErrorCode.RATE_LIMIT_EXCEEDED,
            retry_after=60,
        )
        
        result = error.to_dict()
        
        assert result["error"]["retryAfter"] == 60
    
    def test_str_representation(self):
        """String representation should include code and message."""
        error = AppError(
            message="Something went wrong",
            code=ErrorCode.INTERNAL_ERROR,
        )
        
        assert str(error) == "INTERNAL_ERROR: Something went wrong"


class TestAuthenticationErrors:
    """Tests for authentication exceptions."""
    
    def test_authentication_error_defaults(self):
        """AuthenticationError should have correct defaults."""
        error = AuthenticationError()
        
        assert error.status_code == 401
        assert error.code == ErrorCode.AUTH_REQUIRED
    
    def test_invalid_credentials_error(self):
        """InvalidCredentialsError should have correct values."""
        error = InvalidCredentialsError()
        
        assert error.status_code == 401
        assert error.code == ErrorCode.AUTH_INVALID_CREDENTIALS
        assert "Invalid email or password" in error.message
    
    def test_token_expired_error(self):
        """TokenExpiredError should have correct values."""
        error = TokenExpiredError()
        
        assert error.status_code == 401
        assert error.code == ErrorCode.AUTH_TOKEN_EXPIRED


class TestAuthorizationErrors:
    """Tests for authorization exceptions."""
    
    def test_authorization_error_with_resource_type(self):
        """AuthorizationError should include resource type."""
        error = AuthorizationError(resource_type="job")
        
        assert error.status_code == 403
        assert "job" in error.message
        assert error.details["resource_type"] == "job"
    
    def test_insufficient_tier_error(self):
        """InsufficientTierError should include tier info."""
        error = InsufficientTierError(
            required_tier="pro",
            current_tier="free",
        )
        
        assert error.status_code == 403
        assert error.code == ErrorCode.INSUFFICIENT_TIER
        assert "pro" in error.message
        assert error.details["required_tier"] == "pro"
        assert error.details["current_tier"] == "free"


class TestResourceErrors:
    """Tests for resource exceptions."""
    
    def test_not_found_error(self):
        """NotFoundError should include resource info."""
        error = NotFoundError(
            resource_type="user",
            resource_id="123",
        )
        
        assert error.status_code == 404
        assert error.code == ErrorCode.RESOURCE_NOT_FOUND
        assert "User" in error.message
        assert error.details["resource_type"] == "user"
        assert error.details["resource_id"] == "123"
    
    def test_job_not_found_error(self):
        """JobNotFoundError should be specialized NotFoundError."""
        error = JobNotFoundError(job_id="job-456")
        
        assert error.status_code == 404
        assert error.resource_type == "job"
        assert error.resource_id == "job-456"


class TestValidationErrors:
    """Tests for validation exceptions."""
    
    def test_validation_error_with_field_errors(self):
        """ValidationError should include field errors."""
        error = ValidationError(
            field_errors={
                "email": ["Invalid format"],
                "password": ["Too short", "Missing number"],
            }
        )
        
        assert error.status_code == 422
        assert error.details["fields"]["email"] == ["Invalid format"]
        assert len(error.details["fields"]["password"]) == 2
    
    def test_invalid_state_transition_error(self):
        """InvalidStateTransitionError should include states."""
        error = InvalidStateTransitionError(
            current_status="completed",
            target_status="processing",
        )
        
        assert error.status_code == 409
        assert error.code == ErrorCode.INVALID_STATE_TRANSITION
        assert "completed" in error.message
        assert "processing" in error.message


class TestRateLimitError:
    """Tests for rate limit exception."""
    
    def test_rate_limit_error(self):
        """RateLimitError should include retry_after."""
        error = RateLimitError(retry_after=30)
        
        assert error.status_code == 429
        assert error.retry_after == 30
        assert error.details["retry_after"] == 30
        
        result = error.to_dict()
        assert result["error"]["retryAfter"] == 30


class TestExternalServiceError:
    """Tests for external service exception."""
    
    def test_external_service_error(self):
        """ExternalServiceError should include service name."""
        error = ExternalServiceError(service_name="stripe")
        
        assert error.status_code == 502
        assert "stripe" in error.message
        assert error.details["service"] == "stripe"
```

### 12. Update packages/types/package.json for tests

Add vitest to the types package:

```json
{
  "name": "@project/types",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

---

## Updated Verification

**Additional test checks:**

```bash
# 1. Run TypeScript type tests
cd packages/types
pnpm test

# 2. Run Python exception tests
cd ../backend
source .venv/bin/activate
pytest tests/test_exceptions.py -v

# 3. Verify error code parity
python -c "
from src.exceptions import ErrorCode
ts_codes = ['AUTH_INVALID_CREDENTIALS', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID', 
            'AUTH_EMAIL_EXISTS', 'AUTH_WEAK_PASSWORD', 'AUTH_REQUIRED', 'FORBIDDEN',
            'INSUFFICIENT_TIER', 'RESOURCE_NOT_FOUND', 'RESOURCE_CONFLICT',
            'VALIDATION_ERROR', 'INVALID_STATE_TRANSITION', 'RATE_LIMIT_EXCEEDED',
            'PAYMENT_REQUIRED', 'PAYMENT_FAILED', 'SERVICE_UNAVAILABLE',
            'EXTERNAL_SERVICE_ERROR', 'GENERATION_FAILED', 'GENERATION_TIMEOUT',
            'INTERNAL_ERROR']
py_codes = [e.value for e in ErrorCode]
missing = set(ts_codes) - set(py_codes)
extra = set(py_codes) - set(ts_codes)
assert not missing, f'Missing in Python: {missing}'
assert not extra, f'Extra in Python: {extra}'
print('Error codes match between TypeScript and Python')
"
```

**Updated Success Criteria**:
- [ ] All original criteria pass
- [ ] `pnpm --filter @project/types test` passes
- [ ] `pytest tests/test_exceptions.py` passes
- [ ] Error codes match between TypeScript and Python
