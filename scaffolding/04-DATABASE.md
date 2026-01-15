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
- `supabase/seed.sql` — Development seed data
- `apps/web/lib/supabase/client.ts` — Browser client
- `apps/web/lib/supabase/server.ts` — Server component client
- `apps/web/lib/supabase/admin.ts` — Service role client
- `apps/web/lib/supabase/middleware.ts` — Session refresh
- `apps/web/middleware.ts` — Next.js middleware
- `packages/backend/src/database.py` — Python Supabase client

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
