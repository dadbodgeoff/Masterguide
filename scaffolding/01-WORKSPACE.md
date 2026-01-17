# Phase 01: Workspace Setup

> **Time**: 10 minutes  
> **Prerequisites**: None  
> **Produces**: Monorepo structure, tooling configuration, git initialization

---

## 🤖 Agent Execution Context

**What you're doing**: Creating the foundational monorepo structure from scratch. This is always the first phase.

**Expected state BEFORE execution**:
- Empty directory OR directory with only this Masterguide repo cloned
- No existing package.json, no node_modules, no apps/ or packages/ folders

**What you'll create**:
- Root config files (package.json, turbo.json, tsconfig.base.json, etc.)
- `apps/web/` — Next.js frontend skeleton
- `packages/types/` — Shared TypeScript types package
- `packages/backend/` — Python FastAPI backend skeleton
- `supabase/` — Supabase config

**Execution approach**:
1. Create all root-level config files first
2. Create the apps/web/ structure with all files
3. Create packages/types/ with all files
4. Create packages/backend/ with all files
5. Create supabase/ config
6. Run verification

**IMPORTANT**: 
- Create files in the ORDER listed below
- Use EXACT content provided — don't improvise
- The workspace root is where you're creating these files (NOT inside Masterguide/)

**After completion, tell the user**:
- "Phase 01 complete. Created monorepo structure with Next.js frontend, Python backend, and shared types package."
- "Run `pnpm install` to install dependencies, then proceed to Phase 02."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `package.json` with `workspaces` field
- `pnpm-workspace.yaml`
- `turbo.json`

## Purpose

Create a Turborepo + pnpm monorepo structure that supports:
- Next.js frontend (`apps/web`)
- Python backend (`packages/backend`)
- Shared TypeScript types (`packages/types`)
- Parallel builds and caching

---

## Artifacts to Create

### 1. Root package.json

```json
{
  "name": "saas-project",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean && rm -rf node_modules",
    "db:migrate": "supabase db push",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > packages/types/src/database.ts"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "turbo": "^2.4.0",
    "typescript": "^5.7.0"
  },
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 2. pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 3. turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local", ".env"],
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
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
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

### 4. tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "exclude": ["node_modules", "dist", ".next", ".turbo"]
}
```

### 5. .gitignore

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.next/
.turbo/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local
!.env.example

# Python
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
*.egg-info/
.mypy_cache/
.pytest_cache/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Testing
coverage/
.nyc_output/

# Supabase
supabase/.branches/
supabase/.temp/
```

### 6. .env.example

```bash
# =============================================================================
# Database (Supabase)
# =============================================================================
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# =============================================================================
# Backend
# =============================================================================
BACKEND_URL=http://localhost:8000
REDIS_URL=redis://localhost:6379

# =============================================================================
# Auth
# =============================================================================
JWT_SECRET=your-jwt-secret-min-32-chars-long
JWT_EXPIRY_MINUTES=15
REFRESH_TOKEN_EXPIRY_DAYS=7

# =============================================================================
# Integrations
# =============================================================================
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_STUDIO=price_xxx

SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# =============================================================================
# Feature Flags
# =============================================================================
ENABLE_ANALYTICS=false
ENABLE_RATE_LIMITING=true
ENABLE_WEBHOOKS=true

# =============================================================================
# App Config
# =============================================================================
NODE_ENV=development
LOG_LEVEL=debug
FRONTEND_URL=http://localhost:3000
```

### 7. apps/web/package.json

```json
{
  "name": "@project/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "@project/types": "workspace:*",
    "@supabase/ssr": "^0.6.0",
    "@supabase/supabase-js": "^2.47.0",
    "next": "^16.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^16.1.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

### 8. apps/web/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@project/types": ["../../packages/types/src"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 9. apps/web/next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@project/types'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

export default nextConfig;
```

### 10. apps/web/tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Will be populated by design tokens in Phase 11
      },
    },
  },
  plugins: [],
};
```

### 11. apps/web/postcss.config.js

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### 12. apps/web/app/layout.tsx

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SaaS App',
  description: 'Enterprise-grade SaaS application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### 13. apps/web/app/globals.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground: #171717;
  --background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground: #ededed;
    --background: #0a0a0a;
  }
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: system-ui, -apple-system, sans-serif;
}
```

### 14. apps/web/app/page.tsx

```typescript
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">SaaS Scaffolding Complete</h1>
      <p className="mt-4 text-lg text-gray-600">
        Enterprise foundation ready. Awaiting domain context.
      </p>
    </main>
  );
}
```

### 15. packages/types/package.json

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
    "test": "echo 'No tests yet'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

### 16. packages/types/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 17. packages/types/src/index.ts

```typescript
/**
 * Shared types package
 * 
 * This package contains all shared TypeScript types used across
 * the frontend and any TypeScript-based services.
 * 
 * Populated by subsequent scaffolding phases.
 */

export * from './common';

// Will export more as phases complete:
// export * from './errors';
// export * from './auth';
// export * from './jobs';
// export * from './api';
```

### 18. packages/types/src/common.ts

```typescript
/**
 * Common utility types used throughout the application.
 */

/** Make specific keys required */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Make specific keys optional */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Extract the resolved type of a Promise */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/** Branded type for type-safe IDs */
export type Brand<T, B> = T & { __brand: B };

/** UUID branded type */
export type UUID = Brand<string, 'UUID'>;

/** ISO timestamp branded type */
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;

/** Pagination parameters */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Standard API response wrapper */
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Standard API error response */
export interface ApiErrorResponse {
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
    retryAfter?: number;
  };
}

/** Result type for operations that can fail */
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };
```

### 19. packages/backend/pyproject.toml

```toml
[project]
name = "backend"
version = "0.1.0"
description = "FastAPI backend for SaaS application"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.7.0",
    "pydantic-settings>=2.3.0",
    "python-jose[cryptography]>=3.3.0",
    "passlib[bcrypt]>=1.7.4",
    "httpx>=0.27.0",
    "redis>=5.0.0",
    "supabase>=2.5.0",
    "stripe>=10.0.0",
    "structlog>=24.2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=5.0.0",
    "mypy>=1.10.0",
    "ruff>=0.4.0",
    "httpx>=0.27.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src"]

[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_ignores = true
disallow_untyped_defs = true

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "C4", "SIM"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

### 20. packages/backend/src/__init__.py

```python
"""
Backend package for SaaS application.

This package contains the FastAPI backend with:
- Authentication and authorization
- Job processing system
- Resilience patterns (circuit breakers, retries)
- Integration services (Stripe, email)
- Observability (logging, metrics, health)
"""

__version__ = "0.1.0"
```

### 21. packages/backend/src/main.py

```python
"""
FastAPI application entry point.

Populated by subsequent scaffolding phases.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="SaaS Backend",
    description="Enterprise-grade SaaS backend",
    version="0.1.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Updated in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"status": "ok", "message": "SaaS Backend Running"}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
```

### 22. packages/backend/Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Copy application code
COPY src/ ./src/

# Create non-root user
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Run application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 23. supabase/config.toml

```toml
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323
api_url = "http://localhost"

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = true
```

### 24. README.md (Root)

```markdown
# SaaS Project

Enterprise-grade SaaS application scaffolded with production-ready patterns.

## Tech Stack

- **Frontend**: Next.js 16+ (App Router, Turbopack), React 19, TypeScript, Tailwind CSS
- **Backend**: Python 3.11+, FastAPI, Pydantic
- **Database**: PostgreSQL (Supabase)
- **Cache**: Redis
- **Payments**: Stripe
- **Auth**: Supabase Auth + JWT

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.11+
- Docker (for local Supabase)

### Installation

```bash
# Install dependencies
pnpm install

# Setup Python backend
cd packages/backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"

# Start Supabase locally
supabase start

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Run development servers
pnpm dev
```

### Project Structure

```
├── apps/web/           # Next.js frontend
├── packages/
│   ├── types/          # Shared TypeScript types
│   └── backend/        # Python FastAPI backend
├── supabase/           # Database migrations and config
└── ...
```

## Development

```bash
# Run all dev servers
pnpm dev

# Run tests
pnpm test

# Build all packages
pnpm build

# Lint
pnpm lint
```

## License

MIT
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 01
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 02 until verification passes.**

If verification fails:
1. Check which files are missing
2. Create the missing files
3. Re-run verification

**Manual checks if needed:**

```bash
# 1. Install dependencies
pnpm install

# 2. Build types package
pnpm --filter @project/types build

# 3. Check TypeScript compilation
pnpm --filter @project/web lint

# 4. Verify Python setup
cd packages/backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
python -c "from src.main import app; print('Backend OK')"

# 5. Start dev server (should start without errors)
cd ../..
pnpm dev
```

**Success Criteria**:
- [ ] `pnpm install` completes without errors
- [ ] Types package builds successfully
- [ ] Next.js dev server starts on port 3000
- [ ] Python backend imports without errors
- [ ] All directories created as specified
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [02-ENVIRONMENT.md](./02-ENVIRONMENT.md) for environment configuration and validation.
