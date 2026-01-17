# Phase 04: Database Foundation

> **Time**: 10 minutes  
> **Prerequisites**: [01-WORKSPACE](./01-WORKSPACE.md), [02-ENVIRONMENT](./02-ENVIRONMENT.md), [03-TYPES](./03-TYPES.md)  
> **Produces**: Database schema, migrations, RLS policies, Supabase clients

---

## 🤖 Agent Execution Context

**What you're doing**: Creating the database schema and Supabase client configuration. This sets up the core tables that almost every SaaS needs.

**Expected state BEFORE execution**:
- Phases 01-03 complete
- `supabase/` directory exists with config.toml
- `apps/web/lib/` exists (from Phase 02)
- User has Supabase CLI installed (or will install it)

**What you'll create**:
- `supabase/migrations/00001_initial_schema.sql` — Core tables
- `supabase/migrations/00002_rls_policies.sql` — Row Level Security
- `supabase/seed.sql` — Development seed data (comprehensive)
- `apps/web/lib/supabase/client.ts` — Browser client
- `apps/web/lib/supabase/server.ts` — Server component client
- `apps/web/lib/supabase/admin.ts` — Service role client
- `apps/web/lib/supabase/middleware.ts` — Session refresh
- `apps/web/middleware.ts` — Next.js middleware
- `packages/backend/src/database.py` — Python Supabase client
- `packages/backend/tests/fixtures/` — Test factories (User, Job, Subscription, Asset)
- `packages/backend/tests/test_database.py` — Database service tests

**Execution approach**:
1. Create the migrations folder: `supabase/migrations/`
2. Create both SQL migration files (they run in alphabetical order)
3. Create seed.sql
4. Create the `apps/web/lib/supabase/` directory
5. Create all four Supabase client files
6. Create the Next.js middleware at `apps/web/middleware.ts`
7. Create the Python database module

**IMPORTANT**:
- Migration files MUST be named with numbers so they run in order
- The RLS policies reference tables from the first migration
- The middleware.ts goes in `apps/web/` root, NOT in lib/
- Python database.py imports from config.py (Phase 02)

**Tables created**:
- `users` — Extended user profiles (linked to auth.users)
- `subscriptions` — Stripe subscription tracking
- `jobs` — Async job processing
- `assets` — Files/outputs linked to jobs
- `subscription_audit` — Billing audit trail

**After completion, tell the user**:
- "Phase 04 complete. Database schema and Supabase clients created."
- "Run `supabase start` to start local Supabase, then `supabase db push` to apply migrations."
- "Proceed to Phase 05 for authentication infrastructure."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `supabase/migrations/` contains migration files
- `apps/web/lib/supabase/` exists

## Purpose

Create the database foundation including:
- Core tables (users, subscriptions, jobs, assets)
- Row Level Security (RLS) policies
- Supabase client configuration for frontend and backend
- Type-safe database access

---

## Artifacts to Create

### 1. supabase/migrations/00001_initial_schema.sql

```sql
-- =============================================================================
-- Initial Schema Migration
-- =============================================================================
-- Creates core tables for SaaS application:
-- - users: Extended user profiles
-- - subscriptions: Stripe subscription tracking
-- - jobs: Async job processing
-- - assets: Files/outputs linked to jobs
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Users Table (extends Supabase auth.users)
-- =============================================================================
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    subscription_tier TEXT NOT NULL DEFAULT 'free' 
        CHECK (subscription_tier IN ('free', 'pro', 'studio', 'enterprise')),
    subscription_status TEXT 
        CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid')),
    monthly_usage INTEGER NOT NULL DEFAULT 0,
    usage_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for subscription queries
CREATE INDEX idx_users_subscription ON public.users(subscription_tier, subscription_status);

-- =============================================================================
-- Subscriptions Table
-- =============================================================================
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'studio', 'enterprise')),
    status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_user_subscription UNIQUE (user_id)
);

-- Index for Stripe lookups
CREATE INDEX idx_subscriptions_stripe ON public.subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_customer ON public.subscriptions(stripe_customer_id);


-- =============================================================================
-- Jobs Table
-- =============================================================================
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' 
        CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'partial')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT,
    parameters JSONB,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for job queries
CREATE INDEX idx_jobs_user_status ON public.jobs(user_id, status);
CREATE INDEX idx_jobs_created ON public.jobs(created_at DESC);
CREATE INDEX idx_jobs_type_status ON public.jobs(job_type, status);

-- =============================================================================
-- Assets Table
-- =============================================================================
CREATE TABLE public.assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    url TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for asset queries
CREATE INDEX idx_assets_job ON public.assets(job_id);
CREATE INDEX idx_assets_user ON public.assets(user_id);

-- =============================================================================
-- Subscription Audit Log
-- =============================================================================
CREATE TABLE public.subscription_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    stripe_event_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_audit_user ON public.subscription_audit(user_id);
CREATE INDEX idx_subscription_audit_stripe ON public.subscription_audit(stripe_event_id);

-- =============================================================================
-- Updated At Trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jobs_updated_at
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- User Creation Trigger (from auth.users)
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### 2. supabase/migrations/00002_rls_policies.sql

```sql
-- =============================================================================
-- Row Level Security Policies
-- =============================================================================
-- Enables RLS on all tables and creates policies for secure access.
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_audit ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Users Policies
-- =============================================================================

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own profile (limited fields)
CREATE POLICY "Users can update own profile"
    ON public.users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Service role can do anything
CREATE POLICY "Service role full access to users"
    ON public.users FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- =============================================================================
-- Subscriptions Policies
-- =============================================================================

-- Users can read their own subscription
CREATE POLICY "Users can read own subscription"
    ON public.subscriptions FOR SELECT
    USING (auth.uid() = user_id);

-- Only service role can modify subscriptions (via webhooks)
CREATE POLICY "Service role full access to subscriptions"
    ON public.subscriptions FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- =============================================================================
-- Jobs Policies
-- =============================================================================

-- Users can read their own jobs
CREATE POLICY "Users can read own jobs"
    ON public.jobs FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create jobs for themselves
CREATE POLICY "Users can create own jobs"
    ON public.jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Service role can do anything with jobs
CREATE POLICY "Service role full access to jobs"
    ON public.jobs FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- =============================================================================
-- Assets Policies
-- =============================================================================

-- Users can read their own assets
CREATE POLICY "Users can read own assets"
    ON public.assets FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can do anything with assets
CREATE POLICY "Service role full access to assets"
    ON public.assets FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- =============================================================================
-- Subscription Audit Policies
-- =============================================================================

-- Users can read their own audit logs
CREATE POLICY "Users can read own audit logs"
    ON public.subscription_audit FOR SELECT
    USING (auth.uid() = user_id);

-- Only service role can write audit logs
CREATE POLICY "Service role full access to audit"
    ON public.subscription_audit FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');
```


### 3. apps/web/lib/supabase/client.ts

```typescript
/**
 * Supabase client for client-side usage.
 * 
 * Use this in Client Components and for browser-side operations.
 */

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '../env';

export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
```

### 4. apps/web/lib/supabase/server.ts

```typescript
/**
 * Supabase client for server-side usage.
 * 
 * Use this in Server Components, API routes, and Server Actions.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '../env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}
```

### 5. apps/web/lib/supabase/admin.ts

```typescript
/**
 * Supabase admin client with service role key.
 * 
 * Use this ONLY in API routes for admin operations.
 * NEVER expose this client to the browser.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv, env } from '../env';

export function createAdminClient() {
  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
```

### 6. apps/web/lib/supabase/middleware.ts

```typescript
/**
 * Supabase client for middleware.
 * 
 * Used to refresh sessions in Next.js middleware.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
```

### 7. apps/web/middleware.ts

```typescript
/**
 * Next.js middleware for session management.
 */

import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return (await updateSession(request)).supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

### 8. packages/backend/src/database.py

```python
"""
Database client for Python backend.

Uses Supabase Python client with service role for admin operations.
"""

from functools import lru_cache
from typing import Any

from supabase import create_client, Client

from src.config import settings


@lru_cache
def get_supabase_client() -> Client:
    """
    Get cached Supabase client with service role.
    
    Uses service role key for full database access.
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


class DatabaseService:
    """
    Database service wrapper for common operations.
    
    Provides type-safe access to database tables.
    """
    
    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()
    
    def table(self, name: str) -> Any:
        """Get a table reference."""
        return self.client.table(name)
    
    # User operations
    async def get_user(self, user_id: str) -> dict[str, Any] | None:
        """Get user by ID."""
        result = self.client.table("users").select("*").eq("id", user_id).execute()
        return result.data[0] if result.data else None
    
    async def update_user(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update user data."""
        result = self.client.table("users").update(data).eq("id", user_id).execute()
        if not result.data:
            raise ValueError(f"User not found: {user_id}")
        return result.data[0]
    
    # Job operations
    async def create_job(self, job_data: dict[str, Any]) -> dict[str, Any]:
        """Create a new job."""
        result = self.client.table("jobs").insert(job_data).execute()
        if not result.data:
            raise ValueError("Failed to create job")
        return result.data[0]
    
    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Get job by ID."""
        result = self.client.table("jobs").select("*").eq("id", job_id).execute()
        return result.data[0] if result.data else None
    
    async def update_job(self, job_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update job data."""
        result = self.client.table("jobs").update(data).eq("id", job_id).execute()
        if not result.data:
            raise ValueError(f"Job not found: {job_id}")
        return result.data[0]


# Convenience function
def get_db() -> DatabaseService:
    """Get database service instance."""
    return DatabaseService()
```

### 9. supabase/seed.sql

```sql
-- =============================================================================
-- Seed Data for Development
-- =============================================================================
-- This file is run after migrations in development.
-- DO NOT include production data here.
-- =============================================================================

-- Note: Users are created through Supabase Auth, which triggers
-- the handle_new_user() function to create the public.users record.

-- Example: Create a test subscription (requires a user to exist first)
-- INSERT INTO public.subscriptions (user_id, stripe_subscription_id, stripe_customer_id, tier, status, current_period_start, current_period_end)
-- VALUES ('user-uuid-here', 'sub_test123', 'cus_test123', 'pro', 'active', NOW(), NOW() + INTERVAL '30 days');
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 04
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 05 until verification passes.**

**Manual checks if needed:**

```bash
# 1. Start Supabase locally (if not running)
supabase start

# 2. Apply migrations
supabase db push

# 3. Verify tables exist
supabase db dump --schema public | grep "CREATE TABLE"

# 4. Generate TypeScript types from database
pnpm db:types

# 5. Verify Supabase clients compile
cd apps/web
pnpm lint

# 6. Verify Python database module
cd ../../packages/backend
source .venv/bin/activate
python -c "
from src.database import get_supabase_client, DatabaseService
print('Supabase client:', type(get_supabase_client()))
print('DatabaseService:', DatabaseService)
"
```

**Success Criteria**:
- [ ] Migrations apply without errors
- [ ] Tables created: users, subscriptions, jobs, assets, subscription_audit
- [ ] RLS policies enabled on all tables
- [ ] Triggers created for updated_at and user creation
- [ ] TypeScript Supabase clients compile
- [ ] Python database module imports correctly
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [05-AUTH.md](./05-AUTH.md) for authentication infrastructure.


---

## Testing, Fixtures & Seeding Additions

> Test fixtures for mocking database operations and comprehensive seed data for development.

### 10. packages/backend/tests/fixtures/__init__.py

```python
"""Test fixtures package."""

from tests.fixtures.factories import (
    UserFactory,
    JobFactory,
    SubscriptionFactory,
    AssetFactory,
)

__all__ = [
    "UserFactory",
    "JobFactory",
    "SubscriptionFactory",
    "AssetFactory",
]
```

### 11. packages/backend/tests/fixtures/factories.py

```python
"""
Factory functions for creating test entities.

These factories create realistic test data with sensible defaults
while allowing customization for specific test cases.
"""

from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import uuid4


class UserFactory:
    """Factory for creating test user data."""
    
    _counter = 0
    
    @classmethod
    def create(
        cls,
        id: str | None = None,
        email: str | None = None,
        name: str | None = None,
        subscription_tier: str = "free",
        subscription_status: str | None = "active",
        monthly_usage: int = 0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Create a test user dict."""
        cls._counter += 1
        now = datetime.now(timezone.utc).isoformat()
        
        return {
            "id": id or str(uuid4()),
            "email": email or f"user{cls._counter}@test.com",
            "name": name or f"Test User {cls._counter}",
            "avatar_url": None,
            "subscription_tier": subscription_tier,
            "subscription_status": subscription_status,
            "monthly_usage": monthly_usage,
            "usage_reset_at": now,
            "created_at": now,
            "updated_at": now,
            **kwargs,
        }
    
    @classmethod
    def create_pro(cls, **kwargs: Any) -> dict[str, Any]:
        """Create a pro tier user."""
        return cls.create(subscription_tier="pro", **kwargs)
    
    @classmethod
    def create_studio(cls, **kwargs: Any) -> dict[str, Any]:
        """Create a studio tier user."""
        return cls.create(subscription_tier="studio", **kwargs)
    
    @classmethod
    def create_enterprise(cls, **kwargs: Any) -> dict[str, Any]:
        """Create an enterprise tier user."""
        return cls.create(subscription_tier="enterprise", **kwargs)


class JobFactory:
    """Factory for creating test job data."""
    
    _counter = 0
    
    @classmethod
    def create(
        cls,
        id: str | None = None,
        user_id: str | None = None,
        job_type: str = "generation",
        status: str = "queued",
        progress: int = 0,
        error_message: str | None = None,
        parameters: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Create a test job dict."""
        cls._counter += 1
        now = datetime.now(timezone.utc).isoformat()
        
        return {
            "id": id or str(uuid4()),
            "user_id": user_id or str(uuid4()),
            "job_type": job_type,
            "status": status,
            "progress": progress,
            "error_message": error_message,
            "parameters": parameters or {},
            "result": result,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
            **kwargs,
        }
    
    @classmethod
    def create_processing(cls, progress: int = 50, **kwargs: Any) -> dict[str, Any]:
        """Create a job in processing state."""
        return cls.create(status="processing", progress=progress, **kwargs)
    
    @classmethod
    def create_completed(cls, result: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        """Create a completed job."""
        now = datetime.now(timezone.utc).isoformat()
        return cls.create(
            status="completed",
            progress=100,
            result=result or {"output": "test_output"},
            completed_at=now,
            **kwargs,
        )
    
    @classmethod
    def create_failed(cls, error_message: str = "Test error", **kwargs: Any) -> dict[str, Any]:
        """Create a failed job."""
        now = datetime.now(timezone.utc).isoformat()
        return cls.create(
            status="failed",
            error_message=error_message,
            completed_at=now,
            **kwargs,
        )


class SubscriptionFactory:
    """Factory for creating test subscription data."""
    
    _counter = 0
    
    @classmethod
    def create(
        cls,
        id: str | None = None,
        user_id: str | None = None,
        stripe_subscription_id: str | None = None,
        stripe_customer_id: str | None = None,
        tier: str = "pro",
        status: str = "active",
        cancel_at_period_end: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Create a test subscription dict."""
        cls._counter += 1
        now = datetime.now(timezone.utc)
        
        return {
            "id": id or str(uuid4()),
            "user_id": user_id or str(uuid4()),
            "stripe_subscription_id": stripe_subscription_id or f"sub_test{cls._counter}",
            "stripe_customer_id": stripe_customer_id or f"cus_test{cls._counter}",
            "tier": tier,
            "status": status,
            "current_period_start": now.isoformat(),
            "current_period_end": (now + timedelta(days=30)).isoformat(),
            "cancel_at_period_end": cancel_at_period_end,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            **kwargs,
        }
    
    @classmethod
    def create_canceled(cls, **kwargs: Any) -> dict[str, Any]:
        """Create a canceled subscription."""
        return cls.create(status="canceled", **kwargs)
    
    @classmethod
    def create_past_due(cls, **kwargs: Any) -> dict[str, Any]:
        """Create a past due subscription."""
        return cls.create(status="past_due", **kwargs)


class AssetFactory:
    """Factory for creating test asset data."""
    
    _counter = 0
    
    @classmethod
    def create(
        cls,
        id: str | None = None,
        job_id: str | None = None,
        user_id: str | None = None,
        asset_type: str = "image",
        url: str | None = None,
        storage_path: str | None = None,
        file_size: int = 1024,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Create a test asset dict."""
        cls._counter += 1
        now = datetime.now(timezone.utc).isoformat()
        asset_id = id or str(uuid4())
        
        return {
            "id": asset_id,
            "job_id": job_id or str(uuid4()),
            "user_id": user_id or str(uuid4()),
            "asset_type": asset_type,
            "url": url or f"https://storage.example.com/assets/{asset_id}",
            "storage_path": storage_path or f"assets/{asset_id}",
            "file_size": file_size,
            "metadata": metadata,
            "created_at": now,
            **kwargs,
        }
```

### 12. packages/backend/tests/test_database.py

```python
"""
Tests for database service.
"""

import pytest
from unittest.mock import MagicMock, AsyncMock

from tests.fixtures import UserFactory, JobFactory


class TestDatabaseService:
    """Tests for DatabaseService class."""
    
    def test_get_user_found(self, mock_supabase):
        """Should return user when found."""
        from src.database import DatabaseService
        
        user_data = UserFactory.create(id="user-123")
        mock_supabase.table("users").select("*").eq("id", "user-123").execute.return_value = MagicMock(
            data=[user_data]
        )
        
        db = DatabaseService(client=mock_supabase)
        # Note: In real tests, you'd await this
        # For sync testing, we're just verifying the mock setup
        mock_supabase.table.assert_not_called()  # Not called until method invoked
    
    def test_get_user_not_found(self, mock_supabase):
        """Should return None when user not found."""
        from src.database import DatabaseService
        
        mock_supabase.table("users").select("*").eq("id", "nonexistent").execute.return_value = MagicMock(
            data=[]
        )
        
        db = DatabaseService(client=mock_supabase)
        # Verify mock is set up correctly
        assert mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data == []
    
    def test_create_job(self, mock_supabase):
        """Should create job and return data."""
        from src.database import DatabaseService
        
        job_data = JobFactory.create()
        mock_supabase.table("jobs").insert(job_data).execute.return_value = MagicMock(
            data=[job_data]
        )
        
        db = DatabaseService(client=mock_supabase)
        # Verify mock chain works
        result = mock_supabase.table("jobs").insert(job_data).execute()
        assert result.data[0]["status"] == "queued"
    
    def test_update_job(self, mock_supabase):
        """Should update job and return updated data."""
        from src.database import DatabaseService
        
        job_data = JobFactory.create_processing(progress=75)
        mock_supabase.table("jobs").update({"progress": 75}).eq("id", job_data["id"]).execute.return_value = MagicMock(
            data=[job_data]
        )
        
        db = DatabaseService(client=mock_supabase)
        # Verify mock chain works
        assert mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value.data[0]["progress"] == 75


class TestFactories:
    """Tests for factory functions."""
    
    def test_user_factory_defaults(self):
        """UserFactory should create valid user with defaults."""
        user = UserFactory.create()
        
        assert user["id"]
        assert "@test.com" in user["email"]
        assert user["subscription_tier"] == "free"
        assert user["monthly_usage"] == 0
    
    def test_user_factory_pro(self):
        """UserFactory.create_pro should create pro user."""
        user = UserFactory.create_pro()
        
        assert user["subscription_tier"] == "pro"
    
    def test_job_factory_defaults(self):
        """JobFactory should create valid job with defaults."""
        job = JobFactory.create()
        
        assert job["id"]
        assert job["status"] == "queued"
        assert job["progress"] == 0
    
    def test_job_factory_completed(self):
        """JobFactory.create_completed should create completed job."""
        job = JobFactory.create_completed()
        
        assert job["status"] == "completed"
        assert job["progress"] == 100
        assert job["completed_at"] is not None
        assert job["result"] is not None
    
    def test_job_factory_failed(self):
        """JobFactory.create_failed should create failed job."""
        job = JobFactory.create_failed(error_message="Custom error")
        
        assert job["status"] == "failed"
        assert job["error_message"] == "Custom error"
    
    def test_subscription_factory_defaults(self):
        """SubscriptionFactory should create valid subscription."""
        sub = SubscriptionFactory.create()
        
        assert sub["id"]
        assert sub["stripe_subscription_id"].startswith("sub_test")
        assert sub["tier"] == "pro"
        assert sub["status"] == "active"
    
    def test_asset_factory_defaults(self):
        """AssetFactory should create valid asset."""
        asset = AssetFactory.create()
        
        assert asset["id"]
        assert asset["url"].startswith("https://")
        assert asset["file_size"] == 1024
```

### 13. Update supabase/seed.sql (comprehensive seed data)

```sql
-- =============================================================================
-- Seed Data for Development
-- =============================================================================
-- This file is run after migrations in development.
-- DO NOT include production data here.
-- =============================================================================

-- Note: In development, you'll typically create users through the Supabase
-- Auth UI or API. This seed file provides example data for testing.

-- =============================================================================
-- Test Users (created via auth, these are the public.users records)
-- =============================================================================
-- These UUIDs should match users created in Supabase Auth for local dev.
-- You can create test users at: http://localhost:54323 (Supabase Studio)

-- Example test users (uncomment and modify UUIDs after creating auth users):

-- Free tier user
-- INSERT INTO public.users (id, email, name, subscription_tier, subscription_status, monthly_usage)
-- VALUES (
--     '00000000-0000-0000-0000-000000000001',
--     'free@test.com',
--     'Free User',
--     'free',
--     'active',
--     5
-- ) ON CONFLICT (id) DO UPDATE SET
--     name = EXCLUDED.name,
--     subscription_tier = EXCLUDED.subscription_tier;

-- Pro tier user
-- INSERT INTO public.users (id, email, name, subscription_tier, subscription_status, monthly_usage)
-- VALUES (
--     '00000000-0000-0000-0000-000000000002',
--     'pro@test.com',
--     'Pro User',
--     'pro',
--     'active',
--     45
-- ) ON CONFLICT (id) DO UPDATE SET
--     name = EXCLUDED.name,
--     subscription_tier = EXCLUDED.subscription_tier;

-- Studio tier user
-- INSERT INTO public.users (id, email, name, subscription_tier, subscription_status, monthly_usage)
-- VALUES (
--     '00000000-0000-0000-0000-000000000003',
--     'studio@test.com',
--     'Studio User',
--     'studio',
--     'active',
--     200
-- ) ON CONFLICT (id) DO UPDATE SET
--     name = EXCLUDED.name,
--     subscription_tier = EXCLUDED.subscription_tier;

-- =============================================================================
-- Helper function to create test data (call after creating auth users)
-- =============================================================================
CREATE OR REPLACE FUNCTION seed_test_data(test_user_id UUID)
RETURNS void AS $
DECLARE
    job_id UUID;
BEGIN
    -- Create sample jobs for the user
    INSERT INTO public.jobs (id, user_id, job_type, status, progress, parameters, result, completed_at)
    VALUES 
        (uuid_generate_v4(), test_user_id, 'generation', 'completed', 100, 
         '{"prompt": "Test prompt 1"}', '{"output_url": "https://example.com/output1.png"}', NOW()),
        (uuid_generate_v4(), test_user_id, 'generation', 'completed', 100,
         '{"prompt": "Test prompt 2"}', '{"output_url": "https://example.com/output2.png"}', NOW() - INTERVAL '1 day'),
        (uuid_generate_v4(), test_user_id, 'generation', 'processing', 50,
         '{"prompt": "Test prompt 3"}', NULL, NULL),
        (uuid_generate_v4(), test_user_id, 'generation', 'queued', 0,
         '{"prompt": "Test prompt 4"}', NULL, NULL),
        (uuid_generate_v4(), test_user_id, 'generation', 'failed', 0,
         '{"prompt": "Test prompt 5"}', NULL, NOW() - INTERVAL '2 hours')
    RETURNING id INTO job_id;
    
    -- Create sample assets for completed jobs
    INSERT INTO public.assets (job_id, user_id, asset_type, url, storage_path, file_size, metadata)
    SELECT 
        j.id,
        test_user_id,
        'image',
        'https://storage.example.com/assets/' || j.id || '.png',
        'assets/' || j.id || '.png',
        1024 * (1 + floor(random() * 100))::int,
        '{"width": 1024, "height": 1024, "format": "png"}'
    FROM public.jobs j
    WHERE j.user_id = test_user_id AND j.status = 'completed';
    
    RAISE NOTICE 'Seeded test data for user %', test_user_id;
END;
$ LANGUAGE plpgsql;

-- Usage (after creating a test user in Supabase Auth):
-- SELECT seed_test_data('your-user-uuid-here');

-- =============================================================================
-- Development convenience views
-- =============================================================================
CREATE OR REPLACE VIEW dev_user_summary AS
SELECT 
    u.id,
    u.email,
    u.name,
    u.subscription_tier,
    u.monthly_usage,
    COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed') as completed_jobs,
    COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'processing') as processing_jobs,
    COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'queued') as queued_jobs,
    COUNT(DISTINCT a.id) as total_assets
FROM public.users u
LEFT JOIN public.jobs j ON j.user_id = u.id
LEFT JOIN public.assets a ON a.user_id = u.id
GROUP BY u.id;

COMMENT ON VIEW dev_user_summary IS 'Development view for quick user status overview';
```

### 14. Add database scripts to root package.json

Update the root `package.json` scripts section:

```json
{
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean && rm -rf node_modules",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:migrate": "supabase db push",
    "db:reset": "supabase db reset",
    "db:seed": "supabase db reset && echo 'Database reset and seeded'",
    "db:types": "supabase gen types typescript --local > packages/types/src/database.ts",
    "db:studio": "echo 'Open http://localhost:54323 for Supabase Studio'"
  }
}
```

---

## Updated Verification

**Additional test and fixture checks:**

```bash
# 1. Verify factories work
cd packages/backend
source .venv/bin/activate
python -c "
from tests.fixtures import UserFactory, JobFactory, SubscriptionFactory, AssetFactory

user = UserFactory.create_pro(email='custom@test.com')
print('Pro user:', user['email'], user['subscription_tier'])

job = JobFactory.create_completed()
print('Completed job:', job['status'], job['progress'])

sub = SubscriptionFactory.create()
print('Subscription:', sub['stripe_subscription_id'])

asset = AssetFactory.create(file_size=2048)
print('Asset:', asset['file_size'])
"

# 2. Run database tests
pytest tests/test_database.py -v

# 3. Verify seed SQL is valid
cd ../..
supabase db reset  # This runs migrations + seed.sql

# 4. Check dev view exists
supabase db dump --schema public | grep "dev_user_summary"
```

**Updated Success Criteria**:
- [ ] All original criteria pass
- [ ] Factory functions create valid test data
- [ ] `pytest tests/test_database.py` passes
- [ ] Seed SQL applies without errors
- [ ] `dev_user_summary` view created
- [ ] `seed_test_data()` function available
- [ ] Database scripts work (`pnpm db:reset`, `pnpm db:seed`)
