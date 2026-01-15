# Phase 08: API Foundation

> **Time**: 10 minutes  
> **Prerequisites**: [05-AUTH](./05-AUTH.md), [06-RESILIENCE](./06-RESILIENCE.md)  
> **Produces**: API routes, middleware chain, rate limiting, idempotency

---

## 🤖 Agent Execution Context

**What you're doing**: Creating the API layer — FastAPI routes for the backend and Next.js API routes for the frontend. Includes rate limiting and idempotency handling.

**Expected state BEFORE execution**:
- Phase 05 complete (auth dependencies exist)
- Phase 06 complete (resilience patterns exist)
- Phase 07 complete (job service exists)
- `packages/backend/src/auth/dependencies.py` has CurrentUser

**What you'll create**:
- `packages/backend/src/api/__init__.py` — Module exports
- `packages/backend/src/api/router.py` — Main API router
- `packages/backend/src/api/routes/__init__.py` — Routes package
- `packages/backend/src/api/routes/health.py` — Health check endpoints
- `packages/backend/src/api/routes/jobs.py` — Job CRUD endpoints
- `packages/backend/src/api/routes/users.py` — User profile endpoint
- `packages/backend/src/api/middleware.py` — Rate limiting, idempotency
- `packages/backend/src/api/responses.py` — Response helpers
- `apps/web/app/api/jobs/route.ts` — Next.js jobs endpoint
- `apps/web/app/api/jobs/[jobId]/route.ts` — Single job endpoint
- `apps/web/app/api/health/route.ts` — Health check

**Execution approach**:
1. Create `packages/backend/src/api/` directory
2. Create `packages/backend/src/api/routes/` directory
3. Create all Python API files
4. Create `apps/web/app/api/jobs/` directory
5. Create `apps/web/app/api/jobs/[jobId]/` directory
6. Create all Next.js API routes

**IMPORTANT**:
- FastAPI routes use `CurrentUser` dependency from Phase 05
- Job routes use `JobService` from Phase 07
- Rate limiting middleware is IN-MEMORY (use Redis for production)
- Next.js routes use Supabase client from Phase 04

**API structure**:
```
Backend (FastAPI):
  /api/v1/health
  /api/v1/health/detailed
  /api/v1/jobs (POST, GET)
  /api/v1/jobs/{job_id} (GET)
  /api/v1/jobs/{job_id}/assets (GET)
  /api/v1/users/me (GET)

Frontend (Next.js):
  /api/health
  /api/jobs (POST, GET)
  /api/jobs/[jobId] (GET)
```

**After completion, tell the user**:
- "Phase 08 complete. API routes created for both backend and frontend."
- "Rate limiting and response helpers are ready."
- "Proceed to Phase 09 for observability."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/api/` directory exists
- `apps/web/app/api/jobs/` directory exists

## Purpose

Create API infrastructure including:
- FastAPI router organization
- Rate limiting middleware
- Idempotency handling
- API response formatting
- Next.js API routes for jobs and health

---

## Artifacts to Create

### 1. packages/backend/src/api/__init__.py

```python
"""API module."""

from src.api.router import api_router
from src.api.middleware import RateLimitMiddleware
from src.api.responses import success_response, error_response

__all__ = [
    "api_router",
    "RateLimitMiddleware",
    "success_response",
    "error_response",
]
```

### 2. packages/backend/src/api/router.py

```python
"""Main API router."""

from fastapi import APIRouter

from src.api.routes import health, jobs, users

api_router = APIRouter(prefix="/api/v1")

# Include route modules
api_router.include_router(health.router, tags=["Health"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["Jobs"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
```

### 3. packages/backend/src/api/routes/__init__.py

```python
"""API route modules."""
```

### 4. packages/backend/src/api/routes/health.py

```python
"""Health check endpoints."""

from fastapi import APIRouter, Depends
from src.config import settings

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """Basic health check."""
    return {
        "status": "healthy",
        "version": "0.1.0",
        "environment": settings.ENV,
    }


@router.get("/health/detailed")
async def detailed_health() -> dict:
    """Detailed health check with dependency status."""
    checks = {
        "database": "ok",
        "redis": "disabled" if not settings.REDIS_ENABLED else "ok",
    }
    
    # Check database
    try:
        from src.database import get_db
        db = get_db()
        db.table("users").select("id").limit(1).execute()
    except Exception:
        checks["database"] = "error"
    
    status = "healthy" if all(v in ("ok", "disabled") for v in checks.values()) else "degraded"
    
    return {
        "status": status,
        "version": "0.1.0",
        "checks": checks,
    }
```

### 5. packages/backend/src/api/routes/jobs.py

```python
"""Job API endpoints."""

from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Any

from src.auth.dependencies import CurrentUser
from src.jobs import JobService, JobStatus

router = APIRouter()


class CreateJobRequest(BaseModel):
    job_type: str
    parameters: dict[str, Any] | None = None


class JobResponse(BaseModel):
    id: str
    status: str
    progress: int
    error_message: str | None = None
    result: dict[str, Any] | None = None
    created_at: str
    completed_at: str | None = None


@router.post("")
async def create_job(
    request: CreateJobRequest,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new job."""
    job_service = JobService()
    job = await job_service.create_job(
        user_id=user["id"],
        job_type=request.job_type,
        parameters=request.parameters,
    )
    
    # TODO: Enqueue job for processing
    # background_tasks.add_task(process_job, job.id)
    
    return {"job_id": job.id, "status": job.status.value}


@router.get("/{job_id}")
async def get_job(job_id: str, user: CurrentUser) -> JobResponse:
    """Get job status."""
    job_service = JobService()
    job = await job_service.get_job(job_id, user["id"])
    
    return JobResponse(
        id=job.id,
        status=job.status.value,
        progress=job.progress,
        error_message=job.error_message,
        result=job.result,
        created_at=job.created_at.isoformat(),
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
    )


@router.get("/{job_id}/assets")
async def get_job_assets(job_id: str, user: CurrentUser) -> dict:
    """Get assets for a job."""
    job_service = JobService()
    assets = await job_service.get_job_assets(job_id, user["id"])
    
    return {
        "assets": [
            {
                "id": a.id,
                "url": a.url,
                "asset_type": a.asset_type,
                "file_size": a.file_size,
            }
            for a in assets
        ]
    }


@router.get("")
async def list_jobs(
    user: CurrentUser,
    status: str | None = None,
    job_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """List user's jobs."""
    job_service = JobService()
    
    status_enum = JobStatus(status) if status else None
    jobs = await job_service.list_jobs(
        user_id=user["id"],
        status=status_enum,
        job_type=job_type,
        limit=limit,
        offset=offset,
    )
    
    return {
        "jobs": [
            {
                "id": j.id,
                "job_type": j.job_type,
                "status": j.status.value,
                "progress": j.progress,
                "created_at": j.created_at.isoformat(),
            }
            for j in jobs
        ],
        "limit": limit,
        "offset": offset,
    }
```


### 6. packages/backend/src/api/routes/users.py

```python
"""User API endpoints."""

from fastapi import APIRouter

from src.auth.dependencies import CurrentUser

router = APIRouter()


@router.get("/me")
async def get_current_user(user: CurrentUser) -> dict:
    """Get current user profile."""
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name"),
        "subscription_tier": user.get("subscription_tier", "free"),
        "subscription_status": user.get("subscription_status"),
        "monthly_usage": user.get("monthly_usage", 0),
    }
```

### 7. packages/backend/src/api/middleware.py

```python
"""API middleware."""

import time
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import settings
from src.exceptions import RateLimitError

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple rate limiting middleware.
    
    For production, use Redis-based rate limiting.
    """
    
    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self._requests: dict[str, list[float]] = {}
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not settings.ENABLE_RATE_LIMITING:
            return await call_next(request)
        
        # Get client identifier
        client_id = self._get_client_id(request)
        
        # Check rate limit
        now = time.time()
        window_start = now - 60
        
        # Clean old requests
        if client_id in self._requests:
            self._requests[client_id] = [
                t for t in self._requests[client_id] if t > window_start
            ]
        else:
            self._requests[client_id] = []
        
        # Check limit
        if len(self._requests[client_id]) >= self.requests_per_minute:
            retry_after = int(60 - (now - self._requests[client_id][0]))
            raise RateLimitError(retry_after=max(1, retry_after))
        
        # Record request
        self._requests[client_id].append(now)
        
        # Add rate limit headers
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(
            self.requests_per_minute - len(self._requests[client_id])
        )
        response.headers["X-RateLimit-Reset"] = str(int(window_start + 60))
        
        return response
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier for rate limiting."""
        # Use user ID if authenticated
        if hasattr(request.state, "user_id") and request.state.user_id:
            return f"user:{request.state.user_id}"
        
        # Fall back to IP
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return f"ip:{forwarded.split(',')[0].strip()}"
        
        return f"ip:{request.client.host if request.client else 'unknown'}"


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Idempotency middleware for POST/PUT/PATCH requests.
    
    Requires Redis for production use.
    """
    
    IDEMPOTENCY_HEADER = "X-Idempotency-Key"
    TTL = 86400  # 24 hours
    
    def __init__(self, app, redis_client=None):
        super().__init__(app)
        self.redis = redis_client
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only apply to mutating methods
        if request.method not in ("POST", "PUT", "PATCH"):
            return await call_next(request)
        
        idempotency_key = request.headers.get(self.IDEMPOTENCY_HEADER)
        
        if not idempotency_key or not self.redis:
            return await call_next(request)
        
        cache_key = f"idempotency:{idempotency_key}"
        
        # Check for cached response
        cached = await self.redis.get(cache_key)
        if cached:
            import json
            data = json.loads(cached)
            return Response(
                content=data["body"],
                status_code=data["status"],
                headers={"X-Idempotency-Replayed": "true"},
                media_type="application/json",
            )
        
        # Process request
        response = await call_next(request)
        
        # Cache successful responses
        if 200 <= response.status_code < 300:
            body = b""
            async for chunk in response.body_iterator:
                body += chunk
            
            import json
            await self.redis.setex(
                cache_key,
                self.TTL,
                json.dumps({"status": response.status_code, "body": body.decode()}),
            )
            
            return Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )
        
        return response
```

### 8. packages/backend/src/api/responses.py

```python
"""API response helpers."""

from typing import Any


def success_response(data: Any, meta: dict | None = None) -> dict:
    """Create a success response."""
    response = {"success": True, "data": data}
    if meta:
        response["meta"] = meta
    return response


def error_response(message: str, code: str, details: dict | None = None) -> dict:
    """Create an error response."""
    error = {"message": message, "code": code}
    if details:
        error["details"] = details
    return {"success": False, "error": error}


def paginated_response(
    data: list,
    total: int,
    limit: int,
    offset: int,
) -> dict:
    """Create a paginated response."""
    return {
        "success": True,
        "data": data,
        "meta": {
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(data) < total,
        },
    }
```

### 9. apps/web/app/api/jobs/route.ts

```typescript
/**
 * Jobs API route handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const CreateJobSchema = z.object({
  jobType: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Unauthorized', code: 'AUTH_REQUIRED' } },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const parsed = CreateJobSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: { message: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() } },
        { status: 422 }
      );
    }
    
    // Create job in database
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        user_id: user.id,
        job_type: parsed.data.jobType,
        parameters: parsed.data.parameters || {},
        status: 'queued',
        progress: 0,
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    // TODO: Enqueue job for processing
    
    return NextResponse.json({ jobId: job.id, status: job.status });
  } catch (error) {
    console.error('Create job error:', error);
    return NextResponse.json(
      { error: { message: 'Internal error', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Unauthorized', code: 'AUTH_REQUIRED' } },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    let query = supabase
      .from('jobs')
      .select('id, job_type, status, progress, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: jobs, error } = await query;
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({ jobs, limit, offset });
  } catch (error) {
    console.error('List jobs error:', error);
    return NextResponse.json(
      { error: { message: 'Internal error', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
```

### 10. apps/web/app/api/jobs/[jobId]/route.ts

```typescript
/**
 * Single job API route handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Unauthorized', code: 'AUTH_REQUIRED' } },
        { status: 401 }
      );
    }
    
    const { data: job, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', params.jobId)
      .eq('user_id', user.id)
      .single();
    
    if (error || !job) {
      return NextResponse.json(
        { error: { message: 'Job not found', code: 'RESOURCE_NOT_FOUND' } },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.error_message,
      result: job.result,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    });
  } catch (error) {
    console.error('Get job error:', error);
    return NextResponse.json(
      { error: { message: 'Internal error', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
```

### 11. apps/web/app/api/health/route.ts

```typescript
/**
 * Health check API route.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const checks: Record<string, string> = {
    database: 'ok',
  };
  
  // Check database
  try {
    const supabase = createAdminClient();
    await supabase.from('users').select('id').limit(1);
  } catch {
    checks.database = 'error';
  }
  
  const status = Object.values(checks).every(v => v === 'ok') ? 'healthy' : 'degraded';
  
  return NextResponse.json({
    status,
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    checks,
  });
}
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 08
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 09 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Verify Python API modules
cd packages/backend
source .venv/bin/activate
python -c "
from src.api import api_router, RateLimitMiddleware
from src.api.responses import success_response, paginated_response

print('API router prefix:', api_router.prefix)
print('Success response:', success_response({'test': 'data'}))
"

# 2. Verify TypeScript API routes
cd ../../apps/web
pnpm lint
```

**Success Criteria**:
- [ ] FastAPI router includes all route modules
- [ ] Rate limiting middleware works
- [ ] Response helpers format correctly
- [ ] Next.js API routes compile
- [ ] Health check endpoint works
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [09-OBSERVABILITY.md](./09-OBSERVABILITY.md) for logging and metrics.
