# Environment Configuration

> **Implementation Time**: 1h  
> **Complexity**: Low  
> **Dependencies**: None (optional: zod for validation)

## Problem

Environment variables scattered across code. Missing vars cause runtime crashes. No validation. Different configs for dev/staging/prod.

## Solution

Centralized env config with validation. Fail fast at startup if config is invalid.

## File Structure

```
project/
├── .env                    # Local development (gitignored)
├── .env.example            # Template (committed)
├── .env.production         # Production overrides (gitignored or in CI)
├── .env.local              # Local overrides (gitignored)
└── apps/web/
    └── .env.local          # App-specific local overrides
```

## Implementation

### .env.example (Committed to Git)

```bash
# =============================================================================
# Database
# =============================================================================
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# =============================================================================
# External Services
# =============================================================================
ML_PIPELINE_URL=http://localhost:8787
REDIS_URL=redis://localhost:6379

# =============================================================================
# Feature Flags
# =============================================================================
ENABLE_ANALYTICS=false
ENABLE_RATE_LIMITING=true

# =============================================================================
# App Config
# =============================================================================
NODE_ENV=development
LOG_LEVEL=debug
```

### Environment Validation (lib/env.ts)

```typescript
import { z } from 'zod';

/**
 * Server-side environment variables.
 * These are NOT exposed to the browser.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  
  // External services
  ML_PIPELINE_URL: z.string().url().default('http://localhost:8787'),
  REDIS_URL: z.string().url().optional(),
  
  // Feature flags
  ENABLE_ANALYTICS: z.coerce.boolean().default(false),
  ENABLE_RATE_LIMITING: z.coerce.boolean().default(true),
  
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Client-side environment variables.
 * MUST be prefixed with NEXT_PUBLIC_
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

// Validate at module load time
const serverEnv = serverSchema.safeParse(process.env);
const clientEnv = clientSchema.safeParse(process.env);

if (!serverEnv.success) {
  console.error('❌ Invalid server environment variables:');
  console.error(serverEnv.error.flatten().fieldErrors);
  throw new Error('Invalid server environment configuration');
}

if (!clientEnv.success) {
  console.error('❌ Invalid client environment variables:');
  console.error(clientEnv.error.flatten().fieldErrors);
  throw new Error('Invalid client environment configuration');
}

/**
 * Type-safe server environment.
 * Use this in API routes and server components.
 */
export const env = serverEnv.data;

/**
 * Type-safe client environment.
 * Use this in client components.
 */
export const publicEnv = clientEnv.data;

// Type exports for use elsewhere
export type Env = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof clientSchema>;
```

### Usage in Code

```typescript
// ✅ Server-side (API routes, server components)
import { env } from '@/lib/env';

export async function GET() {
  const response = await fetch(env.ML_PIPELINE_URL + '/api/data');
  // ...
}

// ✅ Client-side (client components)
import { publicEnv } from '@/lib/env';

const supabase = createClient(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL,
  publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
```

### Fallback Pattern (Without Zod)

```typescript
// lib/env.ts - Simple version without Zod

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function boolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

export const env = {
  // Required
  SUPABASE_URL: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  
  // Optional with defaults
  ML_PIPELINE_URL: optionalEnv('ML_PIPELINE_URL', 'http://localhost:8787'),
  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),
  
  // Booleans
  ENABLE_ANALYTICS: boolEnv('ENABLE_ANALYTICS', false),
  
  // Computed
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
} as const;
```

## Multi-Environment Setup

### Development (.env)

```bash
NODE_ENV=development
ML_PIPELINE_URL=http://localhost:8787
LOG_LEVEL=debug
ENABLE_ANALYTICS=false
```

### Production (.env.production)

```bash
NODE_ENV=production
ML_PIPELINE_URL=https://api.myapp.com
LOG_LEVEL=warn
ENABLE_ANALYTICS=true
```

### Loading Order (Next.js)

1. `.env` (always loaded)
2. `.env.local` (always loaded, gitignored)
3. `.env.development` or `.env.production` (based on NODE_ENV)
4. `.env.development.local` or `.env.production.local` (gitignored)

Later files override earlier ones.

## Docker/CI Configuration

### Dockerfile

```dockerfile
# Build args become env vars at build time
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Runtime env vars are set via docker-compose or k8s
```

### docker-compose.yml

```yaml
services:
  web:
    build: .
    environment:
      - NODE_ENV=production
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - ML_PIPELINE_URL=http://ml-pipeline:8787
    env_file:
      - .env.production
```

### GitHub Actions

```yaml
jobs:
  deploy:
    env:
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    steps:
      - run: pnpm build
```

## Security Rules

1. **Never commit secrets** - `.env` and `.env.local` in `.gitignore`
2. **NEXT_PUBLIC_ prefix** - Only these are exposed to browser
3. **Validate early** - Fail at startup, not at runtime
4. **Use secrets manager in prod** - AWS Secrets Manager, Vault, etc.

## .gitignore

```gitignore
# Environment files
.env
.env.local
.env.*.local
.env.production

# Keep the example
!.env.example
```

## Production Checklist

- [ ] `.env.example` committed with all keys (no values)
- [ ] Validation runs at app startup
- [ ] No secrets in `NEXT_PUBLIC_*` vars
- [ ] CI/CD injects secrets from secure store
- [ ] Different configs for dev/staging/prod

## Related Patterns

- [Monorepo Structure](./MONOREPO_STRUCTURE.md)
- [TypeScript Strict](./TYPESCRIPT_STRICT.md)
