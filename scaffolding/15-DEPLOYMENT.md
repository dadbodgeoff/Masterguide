# Phase 15: Deployment

> **Time**: 20 minutes  
> **Prerequisites**: All previous phases  
> **Produces**: Docker Compose, production Dockerfiles, health checks, deployment scripts

---

## 🤖 Agent Execution Context

**What you're doing**: Setting up deployment infrastructure — Docker Compose for local development, production Dockerfiles, health check endpoints, and deployment scripts. This enables consistent deployments across environments.

**Expected state BEFORE execution**:
- All previous phases complete
- `packages/backend/Dockerfile` exists (basic version from Phase 01)
- Application runs locally

**What you'll create**:
- `docker-compose.yml` — Local development stack
- `docker-compose.prod.yml` — Production overrides
- `apps/web/Dockerfile` — Production Next.js Dockerfile
- `packages/backend/Dockerfile.prod` — Production Python Dockerfile
- `packages/backend/src/health.py` — Health check endpoints
- `scripts/deploy.sh` — Deployment script
- `scripts/healthcheck.sh` — Health check script
- `.dockerignore` — Docker ignore file
- `apps/web/.dockerignore` — Web app Docker ignore
- `packages/backend/tests/test_health.py` — Health check tests

**Execution approach**:
1. Create Docker Compose files
2. Create production Dockerfiles
3. Create health check endpoints
4. Create deployment scripts
5. Create Docker ignore files
6. Create tests

**IMPORTANT**:
- Use multi-stage builds for smaller images
- Never include secrets in images
- Health checks should be fast and reliable
- Use non-root users in containers

**After completion, tell the user**:
- "Phase 15 complete. Deployment infrastructure ready."
- "Docker Compose, production Dockerfiles, and health checks configured."
- "Run `docker-compose up` to start the full stack locally."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `docker-compose.yml` exists with all services
- `apps/web/Dockerfile` exists

## Purpose

Set up deployment infrastructure with:
- Docker Compose for local development
- Production-optimized Dockerfiles
- Health check endpoints
- Deployment automation scripts

---

## Artifacts to Create

### 1. docker-compose.yml

```yaml
# Local development stack
# Usage: docker-compose up

version: '3.8'

services:
  # PostgreSQL (Supabase runs its own, this is for standalone)
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    command: redis-server --appendonly yes

  # Backend API
  backend:
    build:
      context: ./packages/backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET:-development-secret-change-in-production}
      - LOG_LEVEL=debug
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - ./packages/backend/src:/app/src:ro  # Hot reload in dev

  # Frontend (Next.js)
  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      - BACKEND_URL=http://backend:8000
    depends_on:
      - backend
    volumes:
      - ./apps/web:/app:ro
      - /app/node_modules
      - /app/.next

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    name: saas-network
```

### 2. docker-compose.prod.yml

```yaml
# Production overrides
# Usage: docker-compose -f docker-compose.yml -f docker-compose.prod.yml up

version: '3.8'

services:
  backend:
    build:
      context: ./packages/backend
      dockerfile: Dockerfile.prod
    environment:
      - LOG_LEVEL=info
    volumes: []  # No volume mounts in production
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
    volumes: []
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - web
      - backend
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
```

### 3. apps/web/Dockerfile

```dockerfile
# Production Dockerfile for Next.js
# Multi-stage build for minimal image size

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

# Install pnpm and dependencies
RUN corepack enable pnpm
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules

# Copy source
COPY . .

# Build types package first
RUN corepack enable pnpm
RUN pnpm --filter @project/types build

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @project/web build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
```

### 4. apps/web/Dockerfile.dev

```dockerfile
# Development Dockerfile for Next.js
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Build types package
RUN pnpm --filter @project/types build

EXPOSE 3000

CMD ["pnpm", "--filter", "@project/web", "dev"]
```

### 5. packages/backend/Dockerfile.prod

```dockerfile
# Production Dockerfile for Python backend
# Multi-stage build for minimal image size

# Stage 1: Builder
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir .

# Stage 2: Runner
FROM python:3.11-slim AS runner

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application code
COPY src/ ./src/

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser
RUN chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# Run with production settings
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

### 6. packages/backend/src/health.py

```python
"""
Health check endpoints.

Provides liveness and readiness probes for container orchestration.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["health"])


class HealthStatus:
    """Health check status."""
    
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


async def check_database() -> dict[str, Any]:
    """Check database connectivity."""
    try:
        # Import here to avoid circular imports
        from src.database import get_supabase
        
        client = get_supabase()
        # Simple query to verify connection
        await client.table("users").select("id").limit(1).execute()
        return {"status": HealthStatus.HEALTHY}
    except Exception as e:
        logger.warning("database_health_check_failed", error=str(e))
        return {"status": HealthStatus.UNHEALTHY, "error": str(e)}


async def check_redis() -> dict[str, Any]:
    """Check Redis connectivity."""
    try:
        from src.cache import get_redis
        
        redis = await get_redis()
        if await redis.health_check():
            return {"status": HealthStatus.HEALTHY}
        return {"status": HealthStatus.UNHEALTHY}
    except Exception as e:
        logger.warning("redis_health_check_failed", error=str(e))
        return {"status": HealthStatus.UNHEALTHY, "error": str(e)}


@router.get("/health")
async def health() -> dict[str, Any]:
    """
    Basic health check endpoint.
    
    Returns 200 if the service is running.
    Used for liveness probes.
    """
    return {
        "status": HealthStatus.HEALTHY,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/ready")
async def readiness() -> dict[str, Any]:
    """
    Readiness check endpoint.
    
    Checks all dependencies and returns overall status.
    Used for readiness probes.
    """
    checks = {
        "database": await check_database(),
        "redis": await check_redis(),
    }
    
    # Determine overall status
    statuses = [c["status"] for c in checks.values()]
    
    if all(s == HealthStatus.HEALTHY for s in statuses):
        overall = HealthStatus.HEALTHY
        status_code = status.HTTP_200_OK
    elif any(s == HealthStatus.UNHEALTHY for s in statuses):
        overall = HealthStatus.UNHEALTHY
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        overall = HealthStatus.DEGRADED
        status_code = status.HTTP_200_OK
    
    response = {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }
    
    if status_code != status.HTTP_200_OK:
        raise HTTPException(status_code=status_code, detail=response)
    
    return response


@router.get("/health/live")
async def liveness() -> dict[str, str]:
    """
    Liveness check endpoint.
    
    Simple check that the process is running.
    Used for liveness probes in Kubernetes.
    """
    return {"status": "alive"}


@router.get("/health/startup")
async def startup() -> dict[str, Any]:
    """
    Startup check endpoint.
    
    Verifies the application has started correctly.
    Used for startup probes in Kubernetes.
    """
    return {
        "status": "started",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
```


### 7. Update packages/backend/src/main.py

Add health router to the FastAPI app:

```python
# Add to imports
from src.health import router as health_router

# Add router
app.include_router(health_router)
```

### 8. scripts/deploy.sh

```bash
#!/bin/bash
# Deployment script
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-staging}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying to $ENVIRONMENT..."

# Load environment variables
if [ -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]; then
    export $(cat "$PROJECT_ROOT/.env.$ENVIRONMENT" | grep -v '^#' | xargs)
fi

# Build images
echo "📦 Building Docker images..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Run database migrations
echo "🗄️ Running database migrations..."
# Add your migration command here
# supabase db push

# Deploy based on environment
case $ENVIRONMENT in
    staging)
        echo "🔄 Deploying to staging..."
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
        ;;
    production)
        echo "🔄 Deploying to production..."
        # Add production deployment commands
        # e.g., kubectl apply, docker swarm, etc.
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
        ;;
    *)
        echo "❌ Unknown environment: $ENVIRONMENT"
        exit 1
        ;;
esac

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Run health checks
echo "🏥 Running health checks..."
./scripts/healthcheck.sh

echo "✅ Deployment complete!"
```

### 9. scripts/healthcheck.sh

```bash
#!/bin/bash
# Health check script
# Usage: ./scripts/healthcheck.sh [service]

set -e

SERVICE=${1:-all}
BACKEND_URL=${BACKEND_URL:-http://localhost:8000}
FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}

check_backend() {
    echo "Checking backend health..."
    response=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health/ready" || echo "000")
    
    if [ "$response" = "200" ]; then
        echo "✅ Backend is healthy"
        return 0
    else
        echo "❌ Backend is unhealthy (HTTP $response)"
        return 1
    fi
}

check_frontend() {
    echo "Checking frontend health..."
    response=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" || echo "000")
    
    if [ "$response" = "200" ]; then
        echo "✅ Frontend is healthy"
        return 0
    else
        echo "❌ Frontend is unhealthy (HTTP $response)"
        return 1
    fi
}

check_redis() {
    echo "Checking Redis health..."
    if docker-compose exec -T redis redis-cli ping | grep -q "PONG"; then
        echo "✅ Redis is healthy"
        return 0
    else
        echo "❌ Redis is unhealthy"
        return 1
    fi
}

check_postgres() {
    echo "Checking PostgreSQL health..."
    if docker-compose exec -T postgres pg_isready -U postgres | grep -q "accepting"; then
        echo "✅ PostgreSQL is healthy"
        return 0
    else
        echo "❌ PostgreSQL is unhealthy"
        return 1
    fi
}

# Run checks based on service argument
case $SERVICE in
    backend)
        check_backend
        ;;
    frontend)
        check_frontend
        ;;
    redis)
        check_redis
        ;;
    postgres)
        check_postgres
        ;;
    all)
        failed=0
        check_postgres || failed=1
        check_redis || failed=1
        check_backend || failed=1
        check_frontend || failed=1
        
        if [ $failed -eq 0 ]; then
            echo ""
            echo "✅ All services are healthy!"
        else
            echo ""
            echo "❌ Some services are unhealthy"
            exit 1
        fi
        ;;
    *)
        echo "Unknown service: $SERVICE"
        echo "Usage: $0 [backend|frontend|redis|postgres|all]"
        exit 1
        ;;
esac
```

### 10. .dockerignore

```dockerignore
# Git
.git
.gitignore

# Node
node_modules
npm-debug.log
yarn-error.log

# Build outputs
dist
.next
.turbo
*.tsbuildinfo

# Python
__pycache__
*.py[cod]
*$py.class
.venv
venv
*.egg-info
.mypy_cache
.pytest_cache
.coverage
htmlcov

# IDE
.idea
.vscode
*.swp
*.swo

# Environment
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Testing
coverage
.nyc_output

# Documentation
docs
*.md
!README.md

# Misc
Masterguide
scripts
*.log
```

### 11. apps/web/.dockerignore

```dockerignore
# Dependencies
node_modules
.pnpm-store

# Build
.next
out
dist

# Testing
coverage
.nyc_output

# Environment
.env
.env.local
.env.*.local

# IDE
.idea
.vscode

# Misc
*.log
*.md
```

### 12. packages/backend/.dockerignore

```dockerignore
# Python
__pycache__
*.py[cod]
*$py.class
.venv
venv
*.egg-info
.mypy_cache
.pytest_cache

# Testing
.coverage
htmlcov
coverage.xml

# IDE
.idea
.vscode

# Environment
.env
.env.local

# Misc
*.log
*.md
tests
```

---

## Deployment Testing

### 13. packages/backend/tests/test_health.py

```python
"""
Health check endpoint tests.
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoints:
    """Tests for health check endpoints."""
    
    def test_health_returns_200(self, client):
        """Basic health check should return 200."""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
    
    def test_liveness_returns_alive(self, client):
        """Liveness check should return alive status."""
        response = client.get("/health/live")
        
        assert response.status_code == 200
        assert response.json()["status"] == "alive"
    
    def test_startup_returns_started(self, client):
        """Startup check should return started status."""
        response = client.get("/health/startup")
        
        assert response.status_code == 200
        assert response.json()["status"] == "started"
    
    @patch("src.health.check_database")
    @patch("src.health.check_redis")
    def test_readiness_all_healthy(self, mock_redis, mock_db, client):
        """Readiness should return healthy when all checks pass."""
        mock_db.return_value = {"status": "healthy"}
        mock_redis.return_value = {"status": "healthy"}
        
        response = client.get("/health/ready")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "checks" in data
    
    @patch("src.health.check_database")
    @patch("src.health.check_redis")
    def test_readiness_degraded(self, mock_redis, mock_db, client):
        """Readiness should return degraded when some checks fail."""
        mock_db.return_value = {"status": "healthy"}
        mock_redis.return_value = {"status": "degraded"}
        
        response = client.get("/health/ready")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
    
    @patch("src.health.check_database")
    @patch("src.health.check_redis")
    def test_readiness_unhealthy(self, mock_redis, mock_db, client):
        """Readiness should return 503 when critical checks fail."""
        mock_db.return_value = {"status": "unhealthy", "error": "Connection refused"}
        mock_redis.return_value = {"status": "healthy"}
        
        response = client.get("/health/ready")
        
        assert response.status_code == 503
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 15
```

**Manual checks:**

```bash
# 1. Make scripts executable
chmod +x scripts/*.sh

# 2. Build Docker images
docker-compose build

# 3. Start the stack
docker-compose up -d

# 4. Run health checks
./scripts/healthcheck.sh

# 5. Check logs
docker-compose logs -f

# 6. Stop the stack
docker-compose down
```

**Success Criteria**:
- [ ] Docker Compose starts all services
- [ ] Health check endpoints respond correctly
- [ ] Production Dockerfiles build successfully
- [ ] Scripts are executable and work
- [ ] All health tests pass

---

## 🎉 Scaffolding Complete!

Congratulations! You have completed all 15 phases of the enterprise SaaS scaffolding.

### What's Been Created

| Phase | Components |
|-------|------------|
| 01 | Workspace, Testing, CI, DX tooling |
| 02 | Environment validation |
| 03 | Shared types, Type tests |
| 04 | Database schema, Fixtures, Seeding |
| 05 | Auth infrastructure, Auth tests |
| 06 | Resilience patterns, Resilience tests |
| 07 | Job system, State machine tests |
| 08 | API foundation, API tests |
| 09 | Observability |
| 10 | Integrations, Mock tests |
| 11 | Frontend foundation, Component tests |
| 12 | Security hardening |
| 13 | File storage |
| 14 | Caching |
| 15 | Deployment |

### Next Steps

1. **Configure environment** — Set all required environment variables
2. **Start Supabase** — `supabase start`
3. **Apply migrations** — `supabase db push`
4. **Start development** — `pnpm dev` or `docker-compose up`
5. **Run tests** — `pnpm test`
6. **Begin feature development** — The foundation is ready!

### Production Checklist

Before going to production:

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] SSL/TLS certificates configured
- [ ] Rate limiting tuned for expected load
- [ ] Monitoring and alerting set up
- [ ] Backup strategy implemented
- [ ] Security audit completed
- [ ] Load testing performed
- [ ] Disaster recovery plan documented

### Reference Documentation

For deeper understanding of any pattern, see:
- [../INDEX.md](../INDEX.md) — Full pattern index
- Individual pattern docs in parent directories
