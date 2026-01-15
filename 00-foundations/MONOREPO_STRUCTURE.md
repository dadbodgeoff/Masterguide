# Monorepo Structure

> **Implementation Time**: 2h  
> **Complexity**: Low  
> **Dependencies**: turborepo, pnpm

## Problem

As your SaaS grows, you need shared code between frontend, backend, and workers. Copy-pasting leads to drift. Separate repos lead to version hell.

## Solution

Turborepo + pnpm workspaces. One repo, multiple packages, shared types, parallel builds.

## Architecture

```
project-root/
├── apps/
│   └── web/                    # Next.js frontend + API routes
│       ├── app/                # App router
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── packages/
│   ├── types/                  # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── index.ts        # Main exports
│   │   │   ├── predictions.ts
│   │   │   ├── dashboard.ts
│   │   │   └── schemas.ts      # Zod schemas
│   │   └── package.json
│   │
│   ├── ml-pipeline/            # Backend data processing
│   │   ├── src/
│   │   │   ├── infrastructure/ # Resilience patterns
│   │   │   ├── persistence/    # Database layer
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── circuit-breaker/        # Standalone resilience package
│   │   └── package.json
│   │
│   └── distributed-lock/       # Standalone locking package
│       └── package.json
│
├── supabase/
│   ├── migrations/             # Database migrations
│   └── config.toml
│
├── package.json                # Root package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json          # Shared TS config
```

## Implementation

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root package.json

```json
{
  "name": "my-saas",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

### Shared Types Package (packages/types/package.json)

```json
{
  "name": "@my-saas/types",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

### Using Shared Types in Apps

```json
// apps/web/package.json
{
  "dependencies": {
    "@my-saas/types": "workspace:*"
  }
}
```

```typescript
// apps/web/app/api/dashboard/route.ts
import type { DashboardData, Prediction } from '@my-saas/types';

export async function GET(): Promise<Response> {
  const data: DashboardData = await fetchDashboard();
  return Response.json(data);
}
```

## Key Principles

### 1. Types Flow Down
```
packages/types (source of truth)
    ↓
packages/ml-pipeline (imports types)
    ↓
apps/web (imports types)
```

### 2. Build Order Matters
Turborepo handles this via `dependsOn: ["^build"]` - packages build before apps.

### 3. Version with `workspace:*`
Always use `workspace:*` for internal dependencies. pnpm resolves these at install time.

### 4. One tsconfig.base.json
Extend from root, override only what's needed:

```json
// packages/types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

## Common Commands

```bash
# Install all dependencies
pnpm install

# Run all dev servers
pnpm dev

# Build everything (respects dependency order)
pnpm build

# Run tests across all packages
pnpm test

# Add dependency to specific package
pnpm add zod --filter @my-saas/types

# Add dev dependency to root
pnpm add -D prettier -w
```

## Production Checklist

- [ ] All internal deps use `workspace:*`
- [ ] `turbo.json` has correct `dependsOn` chains
- [ ] Shared types package builds first
- [ ] CI runs `pnpm build` (not individual builds)
- [ ] `.gitignore` includes `dist/`, `.turbo/`, `node_modules/`

## Related Patterns

- [TypeScript Strict](./TYPESCRIPT_STRICT.md)
- [Environment Config](./ENVIRONMENT_CONFIG.md)
