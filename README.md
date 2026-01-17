# Masterguide: Production SaaS Patterns

> Battle-tested patterns extracted from production TypeScript/Next.js and Python/FastAPI applications.
> Ship enterprise-grade features in hours, not weeks.

**49 patterns** | **~192 hours total** | **Copy-paste ready**

## 🚀 Automated Scaffolding (NEW)

**For AI Agents**: The [scaffolding/](scaffolding/) directory contains a sequential execution system that scaffolds enterprise-grade infrastructure **before** you know what you're building.

```bash
# AI agents: Execute documents 01-11 in order
# Each document creates working, production-ready code
# Total time: ~2 hours for complete foundation
```

**What it creates**:
- Monorepo with Turborepo + pnpm
- Type-safe environment validation
- Shared types and exception taxonomy
- Database schema with RLS policies
- Auth infrastructure with JWT and tier entitlements
- Resilience patterns (circuit breakers, retries, locks)
- Job processing system with state machine
- API foundation with rate limiting
- Structured logging and metrics
- Stripe integration and webhook handling
- Design tokens and base components

See [scaffolding/00-MANIFEST.md](scaffolding/00-MANIFEST.md) to get started.

---

## What This Is

A curated collection of **copy-paste-ready** patterns for building production SaaS applications. Every pattern here has been extracted from real, running code—not theoretical best practices.

## Philosophy

1. **Real Code > Theory** - Every pattern includes working code
2. **Minimal Dependencies** - Prefer stdlib and simple abstractions
3. **Production-First** - Error handling, edge cases, and observability built-in
4. **48-Hour Rule** - Each pattern should be implementable in under 48 hours

## Quick Start

```bash
# Clone and explore
git clone <repo>
cd Masterguide

# See the full index
cat INDEX.md

# For automated scaffolding, see:
cat scaffolding/00-MANIFEST.md
```

## Repository Structure

```
Masterguide/
├── scaffolding/         # 🆕 Sequential scaffolding for AI agents
├── 00-foundations/      # Environment, TypeScript, Monorepo, Feature Flags
├── 01-auth/             # Authentication, Authorization, RLS
├── 02-database/         # Migrations, Schema Management
├── 03-resilience/       # Circuit Breakers, Retries, Graceful Degradation
├── 04-workers/          # Background Jobs, Orchestration, DLQ
├── 05-data-pipeline/    # Batch Processing, ETL, Validation
├── 06-api/              # API Design, Idempotency, Rate Limiting
├── 07-realtime/         # SSE, WebSockets, Multiplayer
├── 08-frontend/         # Design Tokens, Mobile, PWA
├── 09-observability/    # Metrics, Health, Anomaly Detection
├── 10-integrations/     # Stripe, OAuth, Webhooks, Email
├── 11-ai/               # Prompt Engine, Provenance, Coaching
├── 12-caching/          # Intelligent Cache
├── 13-data-processing/  # Fuzzy Matching, Scoring, Analytics
├── INDEX.md             # Full searchable index
├── PATTERN_TEMPLATE.md  # Template for new patterns
└── README.md            # This file
```

## Pattern Categories

### 🏗️ 00-foundations (4 patterns)
Core setup patterns for any project.

| Pattern | Time | Description |
|---------|------|-------------|
| [ENVIRONMENT_CONFIG](00-foundations/ENVIRONMENT_CONFIG.md) | 2h | Environment variable management |
| [TYPESCRIPT_STRICT](00-foundations/TYPESCRIPT_STRICT.md) | 1h | Strict TypeScript configuration |
| [MONOREPO_STRUCTURE](00-foundations/MONOREPO_STRUCTURE.md) | 4h | Turborepo/pnpm workspace setup |
| [FEATURE_FLAGS](00-foundations/FEATURE_FLAGS.md) | 3h | Feature flag system |

### 🔐 01-auth (5 patterns)
Authentication and authorization.

| Pattern | Time | Description |
|---------|------|-------------|
| [SUPABASE_AUTH](01-auth/SUPABASE_AUTH.md) | 4h | Supabase authentication |
| [JWT_REFRESH_ROTATION](01-auth/JWT_REFRESH_ROTATION.md) | 3h | Secure token rotation |
| [MIDDLEWARE_PROTECTION](01-auth/MIDDLEWARE_PROTECTION.md) | 2h | Route protection |
| [ROW_LEVEL_SECURITY](01-auth/ROW_LEVEL_SECURITY.md) | 4h | PostgreSQL RLS |
| [TIER_ENTITLEMENTS](01-auth/TIER_ENTITLEMENTS.md) | 3h | Subscription feature gating |

### 🗄️ 02-database (1 pattern)
Database management.

| Pattern | Time | Description |
|---------|------|-------------|
| [MIGRATIONS](02-database/MIGRATIONS.md) | 2h | Safe migration patterns |

### 🛡️ 03-resilience (10 patterns)
Fault tolerance and graceful degradation.

| Pattern | Time | Description |
|---------|------|-------------|
| [CIRCUIT_BREAKER](03-resilience/CIRCUIT_BREAKER.md) | 4h | Prevent cascade failures |
| [RETRY_FALLBACK](03-resilience/RETRY_FALLBACK.md) | 2h | Exponential backoff |
| [BACKPRESSURE](03-resilience/BACKPRESSURE.md) | 4h | Buffer management |
| [DISTRIBUTED_LOCK](03-resilience/DISTRIBUTED_LOCK.md) | 3h | Redis-based locking |
| [DISTRIBUTED_LOCKING](03-resilience/DISTRIBUTED_LOCKING.md) | 3h | Async context manager |
| [GRACEFUL_SHUTDOWN](03-resilience/GRACEFUL_SHUTDOWN.md) | 3h | Clean shutdown |
| [LEADER_ELECTION](03-resilience/LEADER_ELECTION.md) | 4h | Single-leader coordination |
| [RESILIENT_STORAGE](03-resilience/RESILIENT_STORAGE.md) | 6h | Multi-backend failover |
| [ERROR_SANITIZATION](03-resilience/ERROR_SANITIZATION.md) | 2h | Safe error messages |
| [EXCEPTION_TAXONOMY](03-resilience/EXCEPTION_TAXONOMY.md) | 2h | Exception hierarchy |

### ⚙️ 04-workers (4 patterns)
Background job processing.

| Pattern | Time | Description |
|---------|------|-------------|
| [ORCHESTRATION](04-workers/ORCHESTRATION.md) | 4h | Worker coordination |
| [DEAD_LETTER_QUEUE](04-workers/DEAD_LETTER_QUEUE.md) | 3h | Failed job handling |
| [JOB_STATE_MACHINE](04-workers/JOB_STATE_MACHINE.md) | 4h | Job lifecycle |
| [BACKGROUND_JOB_PROCESSING](04-workers/BACKGROUND_JOB_PROCESSING.md) | 4h | General job patterns |

### 📊 05-data-pipeline (7 patterns)
Data processing and ETL.

| Pattern | Time | Description |
|---------|------|-------------|
| [BATCH_PROCESSING](05-data-pipeline/BATCH_PROCESSING.md) | 4h | Batched DB operations |
| [CHECKPOINT_RESUME](05-data-pipeline/CHECKPOINT_RESUME.md) | 4h | Exactly-once processing |
| [DEDUPLICATION](05-data-pipeline/DEDUPLICATION.md) | 4h | Event deduplication |
| [GEOGRAPHIC_CLUSTERING](05-data-pipeline/GEOGRAPHIC_CLUSTERING.md) | 5h | Geo clustering |
| [SECURE_UPLOAD_PIPELINE](05-data-pipeline/SECURE_UPLOAD_PIPELINE.md) | 6h | File upload with scanning |
| [SNAPSHOT_AGGREGATION](05-data-pipeline/SNAPSHOT_AGGREGATION.md) | 4h | Daily snapshots |
| [VALIDATION_QUARANTINE](05-data-pipeline/VALIDATION_QUARANTINE.md) | 4h | Data validation |

### 🔌 06-api (5 patterns)
API design and client patterns.

| Pattern | Time | Description |
|---------|------|-------------|
| [API_CLIENT](06-api/API_CLIENT.md) | 3h | Type-safe API client |
| [IDEMPOTENCY](06-api/IDEMPOTENCY.md) | 4h | Idempotent operations |
| [TIER_RATE_LIMITS](06-api/TIER_RATE_LIMITS.md) | 4h | Subscription rate limiting |
| [TIER_RATE_LIMITING](06-api/TIER_RATE_LIMITING.md) | 4h | Python rate limiting |
| [TRANSFORMERS](06-api/TRANSFORMERS.md) | 2h | Data transformation |

### 📡 07-realtime (5 patterns)
Real-time communication.

| Pattern | Time | Description |
|---------|------|-------------|
| [SSE_STREAMING](07-realtime/SSE_STREAMING.md) | 3h | Server-Sent Events |
| [SSE_RESILIENCE](07-realtime/SSE_RESILIENCE.md) | 3h | Resilient SSE |
| [WEBSOCKET_CONNECTION_MANAGEMENT](07-realtime/WEBSOCKET_CONNECTION_MANAGEMENT.md) | 4h | WebSocket lifecycle |
| [ATOMIC_MATCHMAKING](07-realtime/ATOMIC_MATCHMAKING.md) | 6h | Race-free matchmaking |
| [SERVER_AUTHORITATIVE_TICK](07-realtime/SERVER_AUTHORITATIVE_TICK.md) | 8h | Game server loop |

### 🎨 08-frontend (5 patterns)
Frontend architecture.

| Pattern | Time | Description |
|---------|------|-------------|
| [DESIGN_TOKENS](08-frontend/DESIGN_TOKENS.md) | 4h | Design token system |
| [DESIGN_TOKEN_SYSTEM](08-frontend/DESIGN_TOKEN_SYSTEM.md) | 4h | Comprehensive tokens |
| [MOBILE_COMPONENTS](08-frontend/MOBILE_COMPONENTS.md) | 3h | Mobile-first components |
| [PWA_SETUP](08-frontend/PWA_SETUP.md) | 2h | Progressive Web App |
| [FIXED_TIMESTEP_GAME_LOOP](08-frontend/FIXED_TIMESTEP_GAME_LOOP.md) | 4h | Deterministic game loop |

### 📊 09-observability (5 patterns)
Monitoring and alerting.

| Pattern | Time | Description |
|---------|------|-------------|
| [METRICS](09-observability/METRICS.md) | 3h | Prometheus metrics |
| [HEALTH_MONITORING](09-observability/HEALTH_MONITORING.md) | 4h | Worker health |
| [ANOMALY_DETECTION](09-observability/ANOMALY_DETECTION.md) | 5h | Anomaly detection |
| [LOGGING_OBSERVABILITY](09-observability/LOGGING_OBSERVABILITY.md) | 3h | Structured logging |
| [FILE_STORAGE](09-observability/FILE_STORAGE.md) | 3h | File storage tracking |

### 🔗 10-integrations (4 patterns)
Third-party integrations.

| Pattern | Time | Description |
|---------|------|-------------|
| [STRIPE_INTEGRATION](10-integrations/STRIPE_INTEGRATION.md) | 6h | Stripe payments |
| [OAUTH_INTEGRATION](10-integrations/OAUTH_INTEGRATION.md) | 4h | OAuth providers |
| [WEBHOOK_SECURITY](10-integrations/WEBHOOK_SECURITY.md) | 4h | Secure webhooks |
| [EMAIL_SERVICE](10-integrations/EMAIL_SERVICE.md) | 4h | SendGrid email |

### 🤖 11-ai (4 patterns)
AI/ML integration.

| Pattern | Time | Description |
|---------|------|-------------|
| [PROMPT_ENGINE](11-ai/PROMPT_ENGINE.md) | 4h | Prompt management |
| [PROVENANCE_AUDIT](11-ai/PROVENANCE_AUDIT.md) | 6h | AI audit trail |
| [AI_COACHING_SYSTEM](11-ai/AI_COACHING_SYSTEM.md) | 8h | AI coaching |
| [AI_GENERATION_CLIENT](11-ai/AI_GENERATION_CLIENT.md) | 4h | AI client wrapper |

### 💾 12-caching (1 pattern)
Caching strategies.

| Pattern | Time | Description |
|---------|------|-------------|
| [INTELLIGENT_CACHE](12-caching/INTELLIGENT_CACHE.md) | 4h | Smart caching |

### 📈 13-data-processing (4 patterns)
Data processing and analysis.

| Pattern | Time | Description |
|---------|------|-------------|
| [MULTI_STAGE_MATCHING](13-data-processing/MULTI_STAGE_MATCHING.md) | 5h | Fuzzy matching |
| [SCORING_ENGINE](13-data-processing/SCORING_ENGINE.md) | 4h | Scoring system |
| [ANALYTICS_PIPELINE](13-data-processing/ANALYTICS_PIPELINE.md) | 6h | Analytics pipeline |
| [COMMUNITY_FEED](13-data-processing/COMMUNITY_FEED.md) | 4h | Social feed |

---

## Tech Stack Assumptions

These patterns assume:
- **Runtime**: Node.js 20+ / Python 3.11+
- **Language**: TypeScript 5+ (strict mode) / Python with type hints
- **Framework**: Next.js 16+ (App Router, Turbopack) / FastAPI
- **React**: React 19+
- **Database**: PostgreSQL (via Supabase)
- **Cache**: Redis (optional, patterns degrade gracefully)
- **Package Manager**: pnpm / pip

## Full Index

See [INDEX.md](INDEX.md) for:
- Complete pattern listing with descriptions
- Use-case based navigation
- Cross-references between patterns

## Contributing

Each pattern follows the template in [PATTERN_TEMPLATE.md](PATTERN_TEMPLATE.md).

## License

MIT - Use these patterns freely in your projects.
