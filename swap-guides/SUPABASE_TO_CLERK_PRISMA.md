# Swap Guide: Supabase → Clerk + Prisma

> Replace Supabase with Clerk for auth and Prisma for database

## Overview

| Supabase | Replacement |
|----------|-------------|
| Supabase Auth | Clerk |
| PostgreSQL + RLS | PostgreSQL + Prisma (any provider) |
| Supabase Storage | Keep or swap to S3/R2 |
| Realtime | Not included (add Pusher/Ably if needed) |

This swap is popular because:
- Clerk has better auth UI components
- Prisma has better TypeScript DX
- You can use any PostgreSQL provider (Neon, PlanetScale, Railway)

## Affected Files

### Must Replace (Delete and Recreate)

```
apps/web/lib/supabase/        → (delete, not needed)

apps/web/lib/auth/            → apps/web/lib/auth/
├── context.tsx               → (simplified, Clerk handles state)
├── hooks.ts                  → hooks.ts (use Clerk hooks)
└── middleware.ts             → (use Clerk middleware)

packages/backend/src/
├── database.py               → database.py (Prisma client)

New files:
├── prisma/
│   └── schema.prisma         # Prisma schema
├── apps/web/middleware.ts    # Clerk middleware
```

### Must Update (Modify in Place)

```
packages/backend/src/auth/
├── jwt.py                    # Verify Clerk JWT
├── dependencies.py           # Update user extraction

apps/web/app/layout.tsx       # Wrap in ClerkProvider

Environment files              # New variables
```

### No Change Needed

```
packages/backend/src/resilience/   # Service-agnostic
packages/backend/src/jobs/         # Uses Redis
packages/backend/src/cache/        # Uses Redis
packages/backend/src/integrations/ # Stripe, email unchanged
packages/backend/src/security/     # Patterns unchanged
packages/types/                    # Types stay the same
apps/web/components/ui/            # UI unchanged
```

---

## Current Pattern (Supabase)

### Frontend Auth
```typescript
// Current: Supabase Auth with manual context
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();
```

### Backend Database
```python
# Current: Supabase client
from supabase import create_client
client = create_client(url, key)
result = client.table("users").select("*").eq("id", user_id).execute()
```

---

## Replacement Pattern (Clerk + Prisma)

### Install Dependencies

```bash
# Frontend
pnpm add @clerk/nextjs --filter @project/web

# Backend
pip install prisma
prisma generate
```

### Clerk Setup (`apps/web/app/layout.tsx`)
```typescript
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### Frontend Auth (`apps/web/lib/auth/hooks.ts`)
```typescript
// New: Clerk hooks (much simpler)
import { useUser, useAuth, useClerk } from '@clerk/nextjs';

export function useAppAuth() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();

  return {
    user: user ? {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName,
    } : null,
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn,
    signOut,
    getToken, // For API calls
  };
}

// Get token for backend calls
export async function getAuthToken() {
  const { getToken } = useAuth();
  return await getToken();
}
```

### Clerk Middleware (`apps/web/middleware.ts`)
```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
```

### Clerk Sign In/Up Pages
```typescript
// apps/web/app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return <SignIn />;
}

// apps/web/app/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return <SignUp />;
}
```

### Prisma Schema (`prisma/schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-py"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                 String   @id // Clerk user ID
  email              String   @unique
  name               String?
  subscriptionTier   String   @default("free") @map("subscription_tier")
  subscriptionStatus String   @default("active") @map("subscription_status")
  stripeCustomerId   String?  @map("stripe_customer_id")
  monthlyUsage       Int      @default(0) @map("monthly_usage")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  
  jobs Job[]
  
  @@map("users")
}

model Job {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  type        String
  status      String   @default("pending")
  payload     Json
  result      Json?
  error       String?
  attempts    Int      @default(0)
  maxAttempts Int      @default(3) @map("max_attempts")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("jobs")
}
```

### Backend Database (`packages/backend/src/database.py`)
```python
# New: Prisma client
from prisma import Prisma

db = Prisma()

async def connect():
    await db.connect()

async def disconnect():
    await db.disconnect()

# Usage in routes
async def get_user(user_id: str):
    return await db.user.find_unique(where={"id": user_id})

async def get_user_jobs(user_id: str):
    return await db.job.find_many(where={"userId": user_id})

async def create_job(user_id: str, job_type: str, payload: dict):
    return await db.job.create(
        data={
            "userId": user_id,
            "type": job_type,
            "payload": payload,
        }
    )
```

### Backend Auth (`packages/backend/src/auth/jwt.py`)
```python
# New: Verify Clerk JWT
import httpx
from jose import jwt, JWTError

CLERK_JWKS_URL = "https://{your-clerk-domain}/.well-known/jwks.json"

_jwks_cache = None

async def get_clerk_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            response = await client.get(CLERK_JWKS_URL)
            _jwks_cache = response.json()
    return _jwks_cache

async def verify_clerk_token(token: str) -> dict:
    """Verify Clerk JWT token."""
    try:
        jwks = await get_clerk_jwks()
        
        # Get the key ID from token header
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        
        # Find matching key
        key = None
        for k in jwks["keys"]:
            if k["kid"] == kid:
                key = k
                break
        
        if not key:
            raise AuthenticationError("Key not found")
        
        # Verify token
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=os.getenv("CLERK_AUDIENCE"),
        )
        
        return {
            "user_id": payload["sub"],
            "email": payload.get("email"),
        }
    except JWTError as e:
        raise AuthenticationError(f"Invalid token: {e}")
```

### Sync Clerk Users to Database

Clerk manages users, but you need them in your database for relations:

```python
# Webhook handler for Clerk events
@router.post("/webhooks/clerk")
async def clerk_webhook(request: Request):
    payload = await request.json()
    event_type = payload.get("type")
    
    if event_type == "user.created":
        user_data = payload["data"]
        await db.user.create(
            data={
                "id": user_data["id"],
                "email": user_data["email_addresses"][0]["email_address"],
                "name": f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip(),
            }
        )
    
    elif event_type == "user.updated":
        user_data = payload["data"]
        await db.user.update(
            where={"id": user_data["id"]},
            data={
                "email": user_data["email_addresses"][0]["email_address"],
                "name": f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip(),
            }
        )
    
    elif event_type == "user.deleted":
        await db.user.delete(where={"id": payload["data"]["id"]})
    
    return {"received": True}
```

---

## Migration Steps

### 1. Create Clerk Application

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Create new application
3. Enable Email/Password sign-in
4. Get API keys

### 2. Set Up Database

Choose a PostgreSQL provider:
- **Neon** — Serverless, generous free tier
- **PlanetScale** — MySQL-compatible (change Prisma provider)
- **Railway** — Simple PostgreSQL
- **Supabase** — Keep Supabase just for database (no auth)

### 3. Install Dependencies

```bash
# Frontend
pnpm add @clerk/nextjs --filter @project/web

# Backend
pip install prisma
```

### 4. Update Environment Variables

```bash
# .env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_xxx
CLERK_SECRET_KEY=sk_xxx
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# Database (Prisma)
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### 5. Generate Prisma Client

```bash
cd packages/backend
prisma generate
prisma db push  # or prisma migrate dev
```

### 6. Update Frontend Files

1. Delete `apps/web/lib/supabase/`
2. Update `apps/web/app/layout.tsx` with ClerkProvider
3. Create sign-in/sign-up pages
4. Update `apps/web/middleware.ts`
5. Update `apps/web/lib/auth/hooks.ts`

### 7. Update Backend Files

1. Update `packages/backend/src/database.py`
2. Update `packages/backend/src/auth/jwt.py`
3. Add Clerk webhook handler
4. Update auth dependencies

### 8. Set Up Clerk Webhooks

1. In Clerk Dashboard → Webhooks
2. Add endpoint: `https://your-api.com/webhooks/clerk`
3. Select events: `user.created`, `user.updated`, `user.deleted`

### 9. Migrate Existing Users

If you have existing Supabase users:
1. Export from Supabase
2. Create users in Clerk (API or import)
3. Import to new database with Clerk IDs

---

## Key Differences

| Supabase Auth | Clerk |
|---------------|-------|
| Self-hosted UI | Pre-built components |
| Manual session handling | Automatic session |
| `supabase.auth.getUser()` | `useUser()` hook |
| RLS for authorization | Manual checks in code |
| Free tier generous | Free tier limited |

| Supabase DB | Prisma |
|-------------|--------|
| RLS policies | Manual authorization |
| SQL queries | Type-safe client |
| Migrations in SQL | Prisma migrate |
| Realtime built-in | Need separate solution |

---

## Verification Checklist

- [ ] Clerk application created
- [ ] Database provisioned and connected
- [ ] Prisma schema matches old schema
- [ ] Frontend auth works (sign in, sign out)
- [ ] Clerk webhook syncs users to database
- [ ] Backend token validation works
- [ ] Database queries work with Prisma
- [ ] Authorization checks in place (no RLS)
- [ ] All tests pass
- [ ] STEERING.md files updated
