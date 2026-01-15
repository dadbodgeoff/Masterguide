# Phase 05: Authentication Infrastructure

> **Time**: 15 minutes  
> **Prerequisites**: [04-DATABASE](./04-DATABASE.md)  
> **Produces**: Auth middleware, JWT handling, route protection, tier entitlements

---

## 🤖 Agent Execution Context

**What you're doing**: Building the authentication layer. This includes JWT handling, React auth context, server-side auth utilities, and tier-based access control.

**Expected state BEFORE execution**:
- Phases 01-04 complete
- Database schema exists with `users` table
- Supabase clients exist in `apps/web/lib/supabase/`
- Python config.py has JWT_SECRET setting

**What you'll create**:
- `apps/web/lib/auth/context.tsx` — React auth context provider
- `apps/web/lib/auth/hooks.ts` — useAuth, useUserProfile, useFeatureAccess
- `apps/web/lib/auth/server.ts` — Server-side getCurrentUser, requireAuth
- `apps/web/app/api/auth/callback/route.ts` — OAuth callback handler
- `packages/backend/src/auth/__init__.py` — Module exports
- `packages/backend/src/auth/jwt.py` — Token creation/verification
- `packages/backend/src/auth/dependencies.py` — FastAPI auth dependencies
- `packages/backend/src/auth/middleware.py` — Request auth middleware
- `packages/backend/src/auth/entitlements.py` — Tier feature checking
- UPDATE `packages/backend/src/main.py` — Add auth middleware

**Execution approach**:
1. Create `apps/web/lib/auth/` directory
2. Create all three frontend auth files
3. Create `apps/web/app/api/auth/callback/` directory structure
4. Create the callback route
5. Create `packages/backend/src/auth/` directory
6. Create all five Python auth files
7. Update main.py to add AuthMiddleware

**IMPORTANT**:
- The React context uses Supabase client from Phase 04
- Python JWT uses settings from Phase 02 (config.py)
- The dependencies.py imports exceptions from Phase 03
- Tier entitlements must match the TIER_ENTITLEMENTS in types/auth.ts

**Auth flow**:
1. User signs in via Supabase Auth
2. OAuth callback exchanges code for session
3. Frontend AuthProvider tracks session state
4. API requests include JWT in Authorization header
5. Backend middleware extracts user, dependencies verify access

**After completion, tell the user**:
- "Phase 05 complete. Authentication infrastructure ready."
- "Users can now sign in via Supabase Auth, and API routes are protected."
- "Proceed to Phase 06 for resilience patterns."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `apps/web/lib/auth/` directory exists
- `packages/backend/src/auth/` directory exists

## Purpose

Create authentication infrastructure including:
- Supabase Auth integration
- JWT token handling and refresh
- Route protection middleware
- Tier-based entitlements checking
- Auth context for React components

---

## Artifacts to Create

### 1. apps/web/lib/auth/context.tsx

```typescript
'use client';

/**
 * Authentication context provider.
 * 
 * Provides user session state to the entire application.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const supabase = createClient();

  const refreshSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    setUser(session?.user ?? null);
  }, [supabase]);

  useEffect(() => {
    // Get initial session
    refreshSession().finally(() => setIsLoading(false));

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase, refreshSession]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```


### 2. apps/web/lib/auth/hooks.ts

```typescript
/**
 * Authentication hooks for client components.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './context';
import { createClient } from '@/lib/supabase/client';
import type { User, SubscriptionTier, TierEntitlements, TIER_ENTITLEMENTS } from '@project/types';

/**
 * Hook to get the current user's profile from the database.
 */
export function useUserProfile() {
  const { user, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    
    supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(new Error(error.message));
        } else {
          setProfile(data as User);
        }
        setIsLoading(false);
      });
  }, [user, authLoading]);

  return { profile, isLoading: authLoading || isLoading, error };
}

/**
 * Hook to check if user has access to a feature based on tier.
 */
export function useFeatureAccess(feature: string) {
  const { profile, isLoading } = useUserProfile();
  
  const hasAccess = !isLoading && profile 
    ? checkFeatureAccess(profile.subscriptionTier, feature)
    : false;

  return { hasAccess, isLoading, tier: profile?.subscriptionTier ?? 'free' };
}

/**
 * Check if a tier has access to a feature.
 */
function checkFeatureAccess(tier: SubscriptionTier, feature: string): boolean {
  const entitlements = TIER_ENTITLEMENTS[tier];
  return entitlements.features.includes(feature);
}

/**
 * Hook to check usage limits.
 */
export function useUsageLimit() {
  const { profile, isLoading } = useUserProfile();
  
  if (isLoading || !profile) {
    return { 
      isLoading, 
      limit: 0, 
      used: 0, 
      remaining: 0, 
      isAtLimit: false 
    };
  }

  const entitlements = TIER_ENTITLEMENTS[profile.subscriptionTier];
  const limit = entitlements.monthlyLimit;
  const used = profile.monthlyUsage ?? 0;
  const remaining = limit === -1 ? Infinity : Math.max(0, limit - used);
  const isAtLimit = limit !== -1 && used >= limit;

  return { isLoading, limit, used, remaining, isAtLimit };
}
```

### 3. apps/web/lib/auth/server.ts

```typescript
/**
 * Server-side authentication utilities.
 * 
 * Use these in Server Components and API routes.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@project/types';

/**
 * Get the current user from the session.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return null;
  }

  // Get full user profile
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  return profile as User | null;
}

/**
 * Require authentication. Redirects to login if not authenticated.
 */
export async function requireAuth(redirectTo = '/login'): Promise<User> {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect(redirectTo);
  }

  return user;
}

/**
 * Require a specific subscription tier.
 */
export async function requireTier(
  requiredTier: 'pro' | 'studio' | 'enterprise',
  redirectTo = '/pricing'
): Promise<User> {
  const user = await requireAuth();
  
  const tierOrder = ['free', 'pro', 'studio', 'enterprise'];
  const userTierIndex = tierOrder.indexOf(user.subscriptionTier);
  const requiredTierIndex = tierOrder.indexOf(requiredTier);

  if (userTierIndex < requiredTierIndex) {
    redirect(redirectTo);
  }

  return user;
}

/**
 * Check if user has access to a feature.
 */
export async function checkFeatureAccess(feature: string): Promise<boolean> {
  const user = await getCurrentUser();
  
  if (!user) {
    return false;
  }

  const { TIER_ENTITLEMENTS } = await import('@project/types');
  const entitlements = TIER_ENTITLEMENTS[user.subscriptionTier];
  
  return entitlements.features.includes(feature);
}
```

### 4. apps/web/app/api/auth/callback/route.ts

```typescript
/**
 * OAuth callback handler.
 * 
 * Handles the redirect from OAuth providers (Google, GitHub, etc.)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return to error page on failure
  return NextResponse.redirect(`${origin}/auth/error`);
}
```

### 5. packages/backend/src/auth/__init__.py

```python
"""Authentication module."""

from src.auth.dependencies import get_current_user, require_tier
from src.auth.jwt import create_access_token, verify_token
from src.auth.middleware import AuthMiddleware

__all__ = [
    "get_current_user",
    "require_tier",
    "create_access_token",
    "verify_token",
    "AuthMiddleware",
]
```

### 6. packages/backend/src/auth/jwt.py

```python
"""
JWT token handling.

Provides token creation and verification for API authentication.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from src.config import settings
from src.exceptions import TokenExpiredError, TokenInvalidError


def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a JWT access token.
    
    Args:
        data: Payload data (must include 'sub' for user ID)
        expires_delta: Optional custom expiration time
        
    Returns:
        Encoded JWT token
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.JWT_EXPIRY_MINUTES
        )
    
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    })
    
    return jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def verify_token(token: str) -> dict[str, Any]:
    """
    Verify and decode a JWT token.
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded token payload
        
    Raises:
        TokenExpiredError: If token has expired
        TokenInvalidError: If token is invalid
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise TokenExpiredError()
    except JWTError as e:
        raise TokenInvalidError(message=str(e))


def create_refresh_token(user_id: str) -> str:
    """
    Create a refresh token with longer expiration.
    
    Args:
        user_id: User ID to encode
        
    Returns:
        Encoded refresh token
    """
    expires_delta = timedelta(days=settings.REFRESH_TOKEN_EXPIRY_DAYS)
    return create_access_token(
        data={"sub": user_id, "type": "refresh"},
        expires_delta=expires_delta,
    )
```


### 7. packages/backend/src/auth/dependencies.py

```python
"""
FastAPI dependencies for authentication.

Provides dependency injection for route handlers.
"""

from typing import Annotated

from fastapi import Depends, Header

from src.auth.jwt import verify_token
from src.database import DatabaseService, get_db
from src.exceptions import (
    AuthenticationError,
    AuthorizationError,
    InsufficientTierError,
    NotFoundError,
)


async def get_token_from_header(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    """Extract token from Authorization header."""
    if not authorization:
        raise AuthenticationError()
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthenticationError(message="Invalid authorization header format")
    
    return parts[1]


async def get_current_user(
    token: Annotated[str, Depends(get_token_from_header)],
    db: Annotated[DatabaseService, Depends(get_db)],
) -> dict:
    """
    Get the current authenticated user.
    
    Use as a dependency in route handlers:
    
        @router.get("/me")
        async def get_me(user: dict = Depends(get_current_user)):
            return user
    """
    payload = verify_token(token)
    user_id = payload.get("sub")
    
    if not user_id:
        raise AuthenticationError(message="Invalid token payload")
    
    user = await db.get_user(user_id)
    
    if not user:
        raise NotFoundError(resource_type="user", resource_id=user_id)
    
    return user


def require_tier(required_tier: str):
    """
    Dependency factory for tier-based access control.
    
    Usage:
        @router.get("/pro-feature")
        async def pro_feature(user: dict = Depends(require_tier("pro"))):
            return {"message": "Pro feature accessed"}
    """
    tier_order = ["free", "pro", "studio", "enterprise"]
    
    async def check_tier(
        user: Annotated[dict, Depends(get_current_user)],
    ) -> dict:
        user_tier = user.get("subscription_tier", "free")
        user_tier_index = tier_order.index(user_tier) if user_tier in tier_order else 0
        required_tier_index = tier_order.index(required_tier)
        
        if user_tier_index < required_tier_index:
            raise InsufficientTierError(
                required_tier=required_tier,
                current_tier=user_tier,
            )
        
        return user
    
    return check_tier


# Type aliases for cleaner route signatures
CurrentUser = Annotated[dict, Depends(get_current_user)]
ProUser = Annotated[dict, Depends(require_tier("pro"))]
StudioUser = Annotated[dict, Depends(require_tier("studio"))]
EnterpriseUser = Annotated[dict, Depends(require_tier("enterprise"))]
```

### 8. packages/backend/src/auth/middleware.py

```python
"""
Authentication middleware for FastAPI.

Provides request-level authentication handling.
"""

from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from src.auth.jwt import verify_token
from src.exceptions import TokenExpiredError, TokenInvalidError


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware to attach user info to request state.
    
    Does NOT block requests - just attaches user info if token is valid.
    Use dependencies for actual route protection.
    """
    
    # Paths that don't need auth processing
    SKIP_PATHS = {"/", "/health", "/docs", "/openapi.json", "/redoc"}
    
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Response],
    ) -> Response:
        # Skip auth processing for certain paths
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)
        
        # Try to extract and verify token
        request.state.user = None
        request.state.user_id = None
        
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = verify_token(token)
                request.state.user_id = payload.get("sub")
                request.state.token_payload = payload
            except (TokenExpiredError, TokenInvalidError):
                # Don't block - let route handlers decide
                pass
        
        return await call_next(request)
```

### 9. packages/backend/src/auth/entitlements.py

```python
"""
Tier-based entitlements checking.

Provides utilities for checking feature access based on subscription tier.
"""

from dataclasses import dataclass
from typing import Literal

SubscriptionTier = Literal["free", "pro", "studio", "enterprise"]


@dataclass
class TierEntitlements:
    """Entitlements for a subscription tier."""
    
    tier: SubscriptionTier
    monthly_limit: int  # -1 for unlimited
    features: list[str]
    api_access: bool
    priority_support: bool


# Tier entitlements configuration
TIER_ENTITLEMENTS: dict[SubscriptionTier, TierEntitlements] = {
    "free": TierEntitlements(
        tier="free",
        monthly_limit=10,
        features=["basic"],
        api_access=False,
        priority_support=False,
    ),
    "pro": TierEntitlements(
        tier="pro",
        monthly_limit=100,
        features=["basic", "advanced", "analytics"],
        api_access=False,
        priority_support=True,
    ),
    "studio": TierEntitlements(
        tier="studio",
        monthly_limit=500,
        features=["basic", "advanced", "analytics", "api", "white_label"],
        api_access=True,
        priority_support=True,
    ),
    "enterprise": TierEntitlements(
        tier="enterprise",
        monthly_limit=-1,
        features=["basic", "advanced", "analytics", "api", "white_label", "custom"],
        api_access=True,
        priority_support=True,
    ),
}


def get_entitlements(tier: SubscriptionTier) -> TierEntitlements:
    """Get entitlements for a tier."""
    return TIER_ENTITLEMENTS.get(tier, TIER_ENTITLEMENTS["free"])


def has_feature(tier: SubscriptionTier, feature: str) -> bool:
    """Check if a tier has access to a feature."""
    entitlements = get_entitlements(tier)
    return feature in entitlements.features


def check_usage_limit(tier: SubscriptionTier, current_usage: int) -> bool:
    """Check if user is within usage limits."""
    entitlements = get_entitlements(tier)
    if entitlements.monthly_limit == -1:
        return True
    return current_usage < entitlements.monthly_limit


def get_remaining_usage(tier: SubscriptionTier, current_usage: int) -> int:
    """Get remaining usage for the month."""
    entitlements = get_entitlements(tier)
    if entitlements.monthly_limit == -1:
        return -1  # Unlimited
    return max(0, entitlements.monthly_limit - current_usage)
```

### 10. Update packages/backend/src/main.py

```python
"""
FastAPI application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.exception_handlers import register_exception_handlers
from src.auth.middleware import AuthMiddleware

app = FastAPI(
    title="SaaS Backend",
    description="Enterprise-grade SaaS backend",
    version="0.1.0",
    debug=settings.DEBUG,
)

# Register exception handlers
register_exception_handlers(app)

# Auth middleware (must be before CORS)
app.add_middleware(AuthMiddleware)

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
node Masterguide/scaffolding/scripts/verify-phase.js 05
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 06 until verification passes.**

**Manual checks if needed:**

```bash
# 1. Verify TypeScript auth modules compile
cd apps/web
pnpm lint

# 2. Verify Python auth modules
cd ../../packages/backend
source .venv/bin/activate
python -c "
from src.auth import (
    get_current_user, require_tier,
    create_access_token, verify_token,
    AuthMiddleware
)
from src.auth.entitlements import (
    get_entitlements, has_feature, check_usage_limit
)

# Test token creation/verification
token = create_access_token({'sub': 'test-user-id', 'email': 'test@example.com'})
print('Token created:', token[:50] + '...')

payload = verify_token(token)
print('Token verified, sub:', payload['sub'])

# Test entitlements
ent = get_entitlements('pro')
print('Pro tier limit:', ent.monthly_limit)
print('Pro has analytics:', has_feature('pro', 'analytics'))
"

# 3. Run tests
pytest -v
```

**Success Criteria**:
- [ ] Auth context provider created for React
- [ ] Server-side auth utilities work
- [ ] OAuth callback route created
- [ ] JWT token creation and verification works
- [ ] FastAPI dependencies for auth work
- [ ] Tier entitlements checking works
- [ ] Auth middleware attaches user to request
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [06-RESILIENCE.md](./06-RESILIENCE.md) for resilience patterns.
