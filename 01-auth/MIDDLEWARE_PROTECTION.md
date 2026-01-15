# Middleware Route Protection

> **Implementation Time**: 2h  
> **Complexity**: Low  
> **Dependencies**: @supabase/ssr

## Problem

Some routes need authentication. Some don't. Checking auth in every page/API route is repetitive and error-prone.

## Solution

Next.js middleware intercepts all requests. Check auth once, protect routes declaratively.

## Architecture

```
Request
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│                     Middleware                          │
│                                                         │
│  1. Is route public? ──────────────────▶ Pass through   │
│                                                         │
│  2. Refresh session (if exists)                         │
│                                                         │
│  3. Is route protected?                                 │
│     └─ No user? ──────────────────────▶ 401 or redirect │
│                                                         │
│  4. Add user ID to headers                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
   │
   ▼
Page / API Route
```

## Implementation

### middleware.ts

```typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that require authentication
const PROTECTED_ROUTES = [
  '/dashboard',
  '/settings',
  '/api/user',
  '/api/predictions/',  // Note: trailing slash = nested routes
];

// Routes that are always public
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/signup',
  '/api/health',
  '/api/public',
];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)
  ) {
    return NextResponse.next();
  }

  // Skip explicitly public routes
  if (PUBLIC_ROUTES.some(route => pathname === route)) {
    return NextResponse.next();
  }

  // Create response that we'll modify
  let response = NextResponse.next({ request });

  // Create Supabase client with cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Update request cookies
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Create new response with updated cookies
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session (important for SSR)
  const { data: { user } } = await supabase.auth.getUser();

  // Check if route requires auth
  const requiresAuth = PROTECTED_ROUTES.some(route => 
    pathname.startsWith(route)
  );

  if (requiresAuth && !user) {
    // API routes: return 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
          loginUrl: '/login',
        },
        { status: 401 }
      );
    }
    
    // Pages: redirect to login with return URL
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // Add user ID to headers for downstream use
  if (user) {
    response.headers.set('x-user-id', user.id);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

### Using User ID in API Routes

```typescript
// app/api/user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  // User ID was added by middleware
  const userId = request.headers.get('x-user-id');
  
  if (!userId) {
    // Shouldn't happen if middleware is configured correctly
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  return NextResponse.json({ profile });
}
```

### Handling Redirect After Login

```typescript
// app/login/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectTo = searchParams.get('redirectTo') || '/dashboard';

  const handleLogin = async (e: React.FormEvent) => {
    // ... login logic ...
    
    if (!error) {
      router.push(redirectTo);
      router.refresh();
    }
  };

  // ... rest of component
}
```

## Route Configuration Patterns

### Pattern 1: Prefix-Based

```typescript
const PROTECTED_PREFIXES = ['/dashboard', '/settings', '/api/user'];

const requiresAuth = PROTECTED_PREFIXES.some(prefix => 
  pathname.startsWith(prefix)
);
```

### Pattern 2: Regex-Based

```typescript
const PROTECTED_PATTERNS = [
  /^\/dashboard(\/.*)?$/,
  /^\/api\/user\/.*$/,
  /^\/settings$/,
];

const requiresAuth = PROTECTED_PATTERNS.some(pattern => 
  pattern.test(pathname)
);
```

### Pattern 3: Role-Based

```typescript
const ROUTE_ROLES: Record<string, string[]> = {
  '/admin': ['admin'],
  '/dashboard': ['user', 'admin'],
  '/api/admin': ['admin'],
};

// In middleware, after getting user:
const requiredRoles = Object.entries(ROUTE_ROLES)
  .find(([route]) => pathname.startsWith(route))?.[1];

if (requiredRoles && !requiredRoles.includes(user.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

## Error Response Format

```typescript
// Consistent error format for API routes
interface AuthError {
  error: string;
  code: 'AUTH_REQUIRED' | 'SESSION_EXPIRED' | 'FORBIDDEN';
  message?: string;
  loginUrl: string;
}

// 401 - Not authenticated
{
  "error": "Authentication required",
  "code": "AUTH_REQUIRED",
  "loginUrl": "/login"
}

// 403 - Authenticated but not authorized
{
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "message": "Admin access required"
}
```

## Production Checklist

- [ ] All protected routes listed
- [ ] API routes return JSON errors (not redirects)
- [ ] Pages redirect to login with return URL
- [ ] Session refresh happens in middleware
- [ ] Static assets excluded from middleware
- [ ] User ID passed to downstream handlers

## Related Patterns

- [Supabase Auth](./SUPABASE_AUTH.md)
- [Tier Entitlements](./TIER_ENTITLEMENTS.md)
