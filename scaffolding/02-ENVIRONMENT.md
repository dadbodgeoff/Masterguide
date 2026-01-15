# Phase 02: Environment Configuration

> **Time**: 5 minutes  
> **Prerequisites**: [01-WORKSPACE](./01-WORKSPACE.md)  
> **Produces**: Type-safe environment validation for both TypeScript and Python

---

## 🤖 Agent Execution Context

**What you're doing**: Adding environment variable validation that fails fast at startup if config is invalid.

**Expected state BEFORE execution**:
- Phase 01 complete
- `apps/web/` exists with package.json
- `packages/backend/` exists with pyproject.toml
- `pnpm install` has been run (node_modules exist)

**What you'll create**:
- `apps/web/lib/env.ts` — Zod-based env validation for Next.js
- `apps/web/lib/env.test.ts` — Tests for env validation
- `packages/backend/src/config.py` — Pydantic settings for Python
- `packages/backend/src/config_test.py` — Tests for config
- `packages/backend/tests/` — Test directory structure

**Execution approach**:
1. Create the `apps/web/lib/` directory if it doesn't exist
2. Create env.ts and env.test.ts
3. Create config.py in the backend
4. Create test files
5. Update main.py to use settings

**IMPORTANT**:
- The .env.example was created in Phase 01 — don't recreate it
- These files IMPORT from each other, so create them in order
- The Python config uses `pydantic-settings` which was added in Phase 01's pyproject.toml

**Common issues**:
- If `lib/` folder doesn't exist, create it
- If imports fail, check that Phase 01 files are in place

**After completion, tell the user**:
- "Phase 02 complete. Environment validation added for both TypeScript and Python."
- "Create a `.env` file based on `.env.example` before running the app."
- "Proceed to Phase 03 for shared types."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `apps/web/lib/env.ts`
- `packages/backend/src/config.py`

## Purpose

Create centralized, validated environment configuration that:
- Fails fast at startup if config is invalid
- Provides type-safe access to environment variables
- Separates public (client) from private (server) variables
- Works consistently across TypeScript and Python

---

## Artifacts to Create

### 1. apps/web/lib/env.ts

```typescript
import { z } from 'zod';

/**
 * Server-side environment variables.
 * These are NOT exposed to the browser.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  
  // Backend
  BACKEND_URL: z.string().url().default('http://localhost:8000'),
  REDIS_URL: z.string().url().optional(),
  
  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  
  // Integrations
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  SENDGRID_API_KEY: z.string().startsWith('SG.').optional(),
  
  // Feature flags
  ENABLE_ANALYTICS: z.coerce.boolean().default(false),
  ENABLE_RATE_LIMITING: z.coerce.boolean().default(true),
  ENABLE_WEBHOOKS: z.coerce.boolean().default(true),
  
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
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
});

// Type definitions
export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

/**
 * Validate and parse environment variables.
 * Called once at module load time.
 */
function validateEnv() {
  // Only validate on server
  if (typeof window !== 'undefined') {
    return {
      server: {} as ServerEnv,
      client: clientSchema.parse({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      }),
    };
  }

  const serverResult = serverSchema.safeParse(process.env);
  const clientResult = clientSchema.safeParse(process.env);

  if (!serverResult.success) {
    console.error('❌ Invalid server environment variables:');
    console.error(JSON.stringify(serverResult.error.flatten().fieldErrors, null, 2));
    throw new Error('Invalid server environment configuration');
  }

  if (!clientResult.success) {
    console.error('❌ Invalid client environment variables:');
    console.error(JSON.stringify(clientResult.error.flatten().fieldErrors, null, 2));
    throw new Error('Invalid client environment configuration');
  }

  return {
    server: serverResult.data,
    client: clientResult.data,
  };
}

const validated = validateEnv();

/**
 * Type-safe server environment.
 * Use this in API routes and server components.
 */
export const env = validated.server;

/**
 * Type-safe client environment.
 * Use this in client components.
 */
export const publicEnv = validated.client;

/**
 * Helper to check if we're in development mode.
 */
export const isDev = env.NODE_ENV === 'development';

/**
 * Helper to check if we're in production mode.
 */
export const isProd = env.NODE_ENV === 'production';

/**
 * Helper to check if we're in test mode.
 */
export const isTest = env.NODE_ENV === 'test';
```

### 2. apps/web/lib/env.test.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Environment Configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export env and publicEnv', async () => {
    // Set required env vars
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';

    const { env, publicEnv } = await import('./env');
    
    expect(publicEnv.NEXT_PUBLIC_SUPABASE_URL).toBe('https://test.supabase.co');
    expect(env.NODE_ENV).toBeDefined();
  });
});
```

### 3. packages/backend/src/config.py

```python
"""
Environment configuration with validation.

Uses Pydantic Settings for type-safe environment variable parsing
with validation at startup.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    Validates at startup - fails fast if config is invalid.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )
    
    # ==========================================================================
    # Environment
    # ==========================================================================
    ENV: Literal["development", "production", "test"] = "development"
    DEBUG: bool = False
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    
    # ==========================================================================
    # Database (Supabase)
    # ==========================================================================
    SUPABASE_URL: str = Field(..., description="Supabase project URL")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(..., description="Supabase service role key")
    
    # ==========================================================================
    # Redis
    # ==========================================================================
    REDIS_URL: str | None = Field(default=None, description="Redis connection URL")
    REDIS_ENABLED: bool = True
    
    # ==========================================================================
    # Auth
    # ==========================================================================
    JWT_SECRET: str = Field(..., min_length=32, description="JWT signing secret")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRY_DAYS: int = 7
    
    # ==========================================================================
    # Stripe
    # ==========================================================================
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_PRICE_PRO: str | None = None
    STRIPE_PRICE_STUDIO: str | None = None
    
    # ==========================================================================
    # Email (SendGrid)
    # ==========================================================================
    SENDGRID_API_KEY: str | None = None
    SENDGRID_FROM_EMAIL: str = "noreply@example.com"
    
    # ==========================================================================
    # Feature Flags
    # ==========================================================================
    ENABLE_ANALYTICS: bool = False
    ENABLE_RATE_LIMITING: bool = True
    ENABLE_WEBHOOKS: bool = True
    
    # ==========================================================================
    # URLs
    # ==========================================================================
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"
    
    # ==========================================================================
    # Validators
    # ==========================================================================
    
    @field_validator("JWT_SECRET")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v
    
    @field_validator("STRIPE_SECRET_KEY")
    @classmethod
    def validate_stripe_key(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("sk_"):
            raise ValueError("STRIPE_SECRET_KEY must start with 'sk_'")
        return v
    
    @model_validator(mode="after")
    def validate_redis_config(self) -> "Settings":
        """Disable Redis features if URL not provided."""
        if self.REDIS_URL is None:
            self.REDIS_ENABLED = False
        return self
    
    # ==========================================================================
    # Computed Properties
    # ==========================================================================
    
    @property
    def is_development(self) -> bool:
        return self.ENV == "development"
    
    @property
    def is_production(self) -> bool:
        return self.ENV == "production"
    
    @property
    def is_test(self) -> bool:
        return self.ENV == "test"
    
    @property
    def stripe_enabled(self) -> bool:
        return self.STRIPE_SECRET_KEY is not None
    
    @property
    def email_enabled(self) -> bool:
        return self.SENDGRID_API_KEY is not None


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.
    
    Uses lru_cache to ensure settings are only loaded once.
    Call get_settings.cache_clear() to reload in tests.
    """
    return Settings()


# Convenience export
settings = get_settings()
```

### 4. packages/backend/src/config_test.py

```python
"""Tests for configuration module."""

import os
from unittest.mock import patch

import pytest

from src.config import Settings, get_settings


@pytest.fixture
def env_vars():
    """Minimal required environment variables."""
    return {
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        "JWT_SECRET": "test-jwt-secret-that-is-at-least-32-characters-long",
    }


def test_settings_loads_from_env(env_vars):
    """Settings should load from environment variables."""
    with patch.dict(os.environ, env_vars, clear=True):
        get_settings.cache_clear()
        settings = Settings()
        
        assert settings.SUPABASE_URL == "https://test.supabase.co"
        assert settings.ENV == "development"  # default


def test_jwt_secret_validation():
    """JWT secret must be at least 32 characters."""
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(
            SUPABASE_URL="https://test.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY="key",
            JWT_SECRET="short",
        )


def test_stripe_key_validation(env_vars):
    """Stripe key must start with sk_."""
    with patch.dict(os.environ, env_vars, clear=True):
        with pytest.raises(ValueError, match="must start with 'sk_'"):
            Settings(
                **env_vars,
                STRIPE_SECRET_KEY="invalid_key",
            )


def test_redis_disabled_without_url(env_vars):
    """Redis should be disabled if URL not provided."""
    with patch.dict(os.environ, env_vars, clear=True):
        settings = Settings(**env_vars)
        
        assert settings.REDIS_URL is None
        assert settings.REDIS_ENABLED is False


def test_computed_properties(env_vars):
    """Computed properties should work correctly."""
    with patch.dict(os.environ, env_vars, clear=True):
        settings = Settings(**env_vars, ENV="production")
        
        assert settings.is_production is True
        assert settings.is_development is False
        assert settings.stripe_enabled is False
```

### 5. packages/backend/tests/__init__.py

```python
"""Test package."""
```

### 6. packages/backend/tests/conftest.py

```python
"""Pytest configuration and fixtures."""

import os
from typing import Generator
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def reset_settings_cache() -> Generator[None, None, None]:
    """Reset settings cache before each test."""
    from src.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def mock_env() -> Generator[dict[str, str], None, None]:
    """Provide mock environment variables for testing."""
    env_vars = {
        "ENV": "test",
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        "JWT_SECRET": "test-jwt-secret-that-is-at-least-32-characters-long",
        "REDIS_URL": "redis://localhost:6379",
    }
    with patch.dict(os.environ, env_vars, clear=True):
        yield env_vars
```

---

## Update Existing Files

### Update: packages/backend/src/main.py

Add settings import and use in CORS:

```python
"""
FastAPI application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings

app = FastAPI(
    title="SaaS Backend",
    description="Enterprise-grade SaaS backend",
    version="0.1.0",
    debug=settings.DEBUG,
)

# CORS middleware - use settings
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
node Masterguide/scaffolding/scripts/verify-phase.js 02
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 03 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues.

**Manual checks if needed:**

```bash
# 1. TypeScript env validation (should fail without .env)
cd apps/web
# Create minimal .env for testing
echo "NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co" > .env.local
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key" >> .env.local
echo "SUPABASE_SERVICE_ROLE_KEY=test-key" >> .env.local
echo "JWT_SECRET=test-jwt-secret-that-is-at-least-32-chars" >> .env.local

# 2. Run TypeScript tests
pnpm test

# 3. Python config validation
cd ../../packages/backend
source .venv/bin/activate

# Create test .env
echo "SUPABASE_URL=https://test.supabase.co" > .env
echo "SUPABASE_SERVICE_ROLE_KEY=test-key" >> .env
echo "JWT_SECRET=test-jwt-secret-that-is-at-least-32-chars" >> .env

# 4. Run Python tests
pytest src/config_test.py -v

# 5. Verify settings load
python -c "from src.config import settings; print(f'Env: {settings.ENV}')"
```

**Success Criteria**:
- [ ] TypeScript env module exports `env` and `publicEnv`
- [ ] Python settings load without errors
- [ ] Validation fails for invalid JWT_SECRET (< 32 chars)
- [ ] Validation fails for invalid Stripe key format
- [ ] Redis auto-disables when URL not provided
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [03-TYPES.md](./03-TYPES.md) for shared types and exception taxonomy.
