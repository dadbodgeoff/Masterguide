# Masterguide Pattern Index

> **49 Production-Ready SaaS Patterns** for TypeScript/Next.js and Python/FastAPI

## 🚀 Automated Scaffolding

**NEW**: Use the [scaffolding/](scaffolding/) system to automatically scaffold enterprise-grade infrastructure before you even know what you're building.

| Document | Time | What It Creates |
|----------|------|-----------------|
| [00-MANIFEST](scaffolding/00-MANIFEST.md) | - | Execution guide and dependency map |
| [01-WORKSPACE](scaffolding/01-WORKSPACE.md) | 10m | Monorepo, tooling, git, CI, testing setup |
| [02-ENVIRONMENT](scaffolding/02-ENVIRONMENT.md) | 5m | Type-safe env validation |
| [03-TYPES](scaffolding/03-TYPES.md) | 10m | Shared types, exceptions, type tests |
| [04-DATABASE](scaffolding/04-DATABASE.md) | 10m | Schema, migrations, RLS, fixtures, seeding |
| [05-AUTH](scaffolding/05-AUTH.md) | 15m | Auth infrastructure, auth tests |
| [06-RESILIENCE](scaffolding/06-RESILIENCE.md) | 15m | Circuit breakers, retries, resilience tests |
| [07-WORKERS](scaffolding/07-WORKERS.md) | 15m | Job system, state machine, worker tests |
| [08-API](scaffolding/08-API.md) | 10m | API foundation, middleware, API tests |
| [09-OBSERVABILITY](scaffolding/09-OBSERVABILITY.md) | 10m | Logging, metrics, health |
| [10-INTEGRATIONS](scaffolding/10-INTEGRATIONS.md) | 10m | Stripe, webhooks, email, integration tests |
| [11-FRONTEND](scaffolding/11-FRONTEND.md) | 15m | Design tokens, components, component tests |
| [12-SECURITY](scaffolding/12-SECURITY.md) | 20m | CSP, CORS, audit logging, input sanitization |
| [13-FILE-STORAGE](scaffolding/13-FILE-STORAGE.md) | 15m | Supabase Storage, uploads, signed URLs |
| [14-CACHING](scaffolding/14-CACHING.md) | 15m | Redis client, cache patterns, sessions |
| [15-DEPLOYMENT](scaffolding/15-DEPLOYMENT.md) | 20m | Docker Compose, Dockerfiles, health checks |

**Total**: ~3 hours for complete enterprise foundation with testing

---

## Quick Navigation

| Category | Patterns | Description |
|----------|----------|-------------|
| [00-foundations](#00-foundations) | 4 | Environment, TypeScript, Monorepo, Feature Flags |
| [01-auth](#01-auth) | 5 | Authentication, Authorization, RLS |
| [02-database](#02-database) | 1 | Migrations, Schema Management |
| [03-resilience](#03-resilience) | 10 | Circuit Breakers, Retries, Graceful Degradation |
| [04-workers](#04-workers) | 4 | Background Jobs, Orchestration, DLQ |
| [05-data-pipeline](#05-data-pipeline) | 7 | Batch Processing, ETL, Validation |
| [06-api](#06-api) | 5 | API Design, Idempotency, Rate Limiting |
| [07-realtime](#07-realtime) | 5 | SSE, WebSockets, Multiplayer |
| [08-frontend](#08-frontend) | 4 | Design Tokens, Mobile, PWA |
| [09-observability](#09-observability) | 5 | Metrics, Health, Anomaly Detection |
| [10-integrations](#10-integrations) | 4 | Stripe, OAuth, Webhooks, Email |
| [11-ai](#11-ai) | 4 | Prompt Engine, Provenance, Coaching |
| [12-caching](#12-caching) | 1 | Intelligent Cache |
| [13-data-processing](#13-data-processing) | 3 | Fuzzy Matching, Scoring, Analytics |

---

## 00-foundations

Core setup patterns for any project.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [ENVIRONMENT_CONFIG](00-foundations/ENVIRONMENT_CONFIG.md) | 2h | Low | Environment variable management with validation |
| [TYPESCRIPT_STRICT](00-foundations/TYPESCRIPT_STRICT.md) | 1h | Low | Strict TypeScript configuration |
| [MONOREPO_STRUCTURE](00-foundations/MONOREPO_STRUCTURE.md) | 4h | Medium | Turborepo/pnpm workspace setup |
| [FEATURE_FLAGS](00-foundations/FEATURE_FLAGS.md) | 3h | Medium | Feature flag system with gradual rollout |

---

## 01-auth

Authentication and authorization patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [SUPABASE_AUTH](01-auth/SUPABASE_AUTH.md) | 4h | Medium | Supabase authentication integration |
| [JWT_REFRESH_ROTATION](01-auth/JWT_REFRESH_ROTATION.md) | 3h | Medium | Secure JWT refresh token rotation |
| [MIDDLEWARE_PROTECTION](01-auth/MIDDLEWARE_PROTECTION.md) | 2h | Low | Route protection middleware |
| [ROW_LEVEL_SECURITY](01-auth/ROW_LEVEL_SECURITY.md) | 4h | Medium | PostgreSQL RLS policies |
| [TIER_ENTITLEMENTS](01-auth/TIER_ENTITLEMENTS.md) | 3h | Medium | Subscription tier feature gating |

---

## 02-database

Database management patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [MIGRATIONS](02-database/MIGRATIONS.md) | 2h | Low | Safe migration patterns for zero-downtime deploys |

---

## 03-resilience

Fault tolerance and graceful degradation.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [CIRCUIT_BREAKER](03-resilience/CIRCUIT_BREAKER.md) | 4h | Medium | Prevent cascade failures |
| [RETRY_FALLBACK](03-resilience/RETRY_FALLBACK.md) | 2h | Low | Exponential backoff with fallbacks |
| [BACKPRESSURE](03-resilience/BACKPRESSURE.md) | 4h | Medium | Buffer management under load |
| [DISTRIBUTED_LOCK](03-resilience/DISTRIBUTED_LOCK.md) | 3h | Medium | Redis-based distributed locking (TypeScript) |
| [DISTRIBUTED_LOCKING](03-resilience/DISTRIBUTED_LOCKING.md) | 3h | Medium | Async context manager for locks (Python) |
| [GRACEFUL_SHUTDOWN](03-resilience/GRACEFUL_SHUTDOWN.md) | 3h | Medium | Clean shutdown with job tracking |
| [LEADER_ELECTION](03-resilience/LEADER_ELECTION.md) | 4h | Medium | Single-leader coordination |
| [RESILIENT_STORAGE](03-resilience/RESILIENT_STORAGE.md) | 6h | High | Multi-backend storage with failover |
| [ERROR_SANITIZATION](03-resilience/ERROR_SANITIZATION.md) | 2h | Low | Safe error messages for production |
| [EXCEPTION_TAXONOMY](03-resilience/EXCEPTION_TAXONOMY.md) | 2h | Low | Structured exception hierarchy |

---

## 04-workers

Background job processing.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [ORCHESTRATION](04-workers/ORCHESTRATION.md) | 4h | Medium | Worker coordination and scheduling |
| [DEAD_LETTER_QUEUE](04-workers/DEAD_LETTER_QUEUE.md) | 3h | Medium | Failed job handling and replay |
| [JOB_STATE_MACHINE](04-workers/JOB_STATE_MACHINE.md) | 4h | Medium | State machine for job lifecycle |
| [BACKGROUND_JOB_PROCESSING](04-workers/BACKGROUND_JOB_PROCESSING.md) | 4h | Medium | General background job patterns |

---

## 05-data-pipeline

Data processing and ETL patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [BATCH_PROCESSING](05-data-pipeline/BATCH_PROCESSING.md) | 4h | Medium | Batched DB operations with fallback |
| [CHECKPOINT_RESUME](05-data-pipeline/CHECKPOINT_RESUME.md) | 4h | Medium | Exactly-once processing semantics |
| [DEDUPLICATION](05-data-pipeline/DEDUPLICATION.md) | 4h | Medium | Multi-source event deduplication |
| [GEOGRAPHIC_CLUSTERING](05-data-pipeline/GEOGRAPHIC_CLUSTERING.md) | 5h | Medium | Grid-based geo clustering |
| [SECURE_UPLOAD_PIPELINE](05-data-pipeline/SECURE_UPLOAD_PIPELINE.md) | 6h | High | File upload with malware scanning |
| [SNAPSHOT_AGGREGATION](05-data-pipeline/SNAPSHOT_AGGREGATION.md) | 4h | Medium | Daily snapshot compression |
| [VALIDATION_QUARANTINE](05-data-pipeline/VALIDATION_QUARANTINE.md) | 4h | Medium | Data validation with quarantine |

---

## 06-api

API design and client patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [API_CLIENT](06-api/API_CLIENT.md) | 3h | Medium | Type-safe API client wrapper |
| [IDEMPOTENCY](06-api/IDEMPOTENCY.md) | 4h | Medium | Idempotent API operations |
| [TIER_RATE_LIMITS](06-api/TIER_RATE_LIMITS.md) | 4h | Medium | Subscription-based rate limiting (TypeScript) |
| [TIER_RATE_LIMITING](06-api/TIER_RATE_LIMITING.md) | 4h | Medium | Subscription-based rate limiting (Python) |
| [TRANSFORMERS](06-api/TRANSFORMERS.md) | 2h | Low | Data transformation utilities |

---

## 07-realtime

Real-time communication patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [SSE_STREAMING](07-realtime/SSE_STREAMING.md) | 3h | Medium | Server-Sent Events streaming |
| [SSE_RESILIENCE](07-realtime/SSE_RESILIENCE.md) | 3h | Medium | Resilient SSE with reconnection |
| [WEBSOCKET_CONNECTION_MANAGEMENT](07-realtime/WEBSOCKET_CONNECTION_MANAGEMENT.md) | 4h | Medium | WebSocket connection lifecycle |
| [ATOMIC_MATCHMAKING](07-realtime/ATOMIC_MATCHMAKING.md) | 6h | High | Race-free matchmaking system |
| [SERVER_AUTHORITATIVE_TICK](07-realtime/SERVER_AUTHORITATIVE_TICK.md) | 8h | High | Server-authoritative game loop |

---

## 08-frontend

Frontend architecture patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [DESIGN_TOKENS](08-frontend/DESIGN_TOKENS.md) | 4h | Medium | Design token system |
| [DESIGN_TOKEN_SYSTEM](08-frontend/DESIGN_TOKEN_SYSTEM.md) | 4h | Medium | Comprehensive token architecture |
| [MOBILE_COMPONENTS](08-frontend/MOBILE_COMPONENTS.md) | 3h | Low | Mobile-first components |
| [PWA_SETUP](08-frontend/PWA_SETUP.md) | 2h | Low | Progressive Web App setup |
| [FIXED_TIMESTEP_GAME_LOOP](08-frontend/FIXED_TIMESTEP_GAME_LOOP.md) | 4h | Medium | Deterministic game loop |

---

## 09-observability

Monitoring and alerting patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [METRICS](09-observability/METRICS.md) | 3h | Medium | Prometheus-compatible metrics |
| [HEALTH_MONITORING](09-observability/HEALTH_MONITORING.md) | 4h | Medium | Worker health tracking |
| [ANOMALY_DETECTION](09-observability/ANOMALY_DETECTION.md) | 5h | Medium | Rule-based anomaly detection |
| [LOGGING_OBSERVABILITY](09-observability/LOGGING_OBSERVABILITY.md) | 3h | Medium | Structured logging patterns |
| [FILE_STORAGE](09-observability/FILE_STORAGE.md) | 3h | Medium | File storage with tracking |

---

## 10-integrations

Third-party service integrations.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [STRIPE_INTEGRATION](10-integrations/STRIPE_INTEGRATION.md) | 6h | High | Stripe payments and subscriptions |
| [OAUTH_INTEGRATION](10-integrations/OAUTH_INTEGRATION.md) | 4h | Medium | OAuth provider integration |
| [WEBHOOK_SECURITY](10-integrations/WEBHOOK_SECURITY.md) | 4h | Medium | Secure webhook handling |
| [EMAIL_SERVICE](10-integrations/EMAIL_SERVICE.md) | 4h | Medium | SendGrid email with rate limits |

---

## 11-ai

AI/ML integration patterns.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [PROMPT_ENGINE](11-ai/PROMPT_ENGINE.md) | 4h | Medium | Structured prompt management |
| [PROVENANCE_AUDIT](11-ai/PROVENANCE_AUDIT.md) | 6h | High | AI generation audit trail |
| [AI_COACHING_SYSTEM](11-ai/AI_COACHING_SYSTEM.md) | 8h | High | AI-powered coaching system |
| [AI_GENERATION_CLIENT](11-ai/AI_GENERATION_CLIENT.md) | 4h | Medium | AI generation client wrapper |

---

## 12-caching

Caching strategies.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [INTELLIGENT_CACHE](12-caching/INTELLIGENT_CACHE.md) | 4h | Medium | Smart caching with invalidation |

---

## 13-data-processing

Data processing and analysis.

| Pattern | Time | Complexity | Description |
|---------|------|------------|-------------|
| [MULTI_STAGE_MATCHING](13-data-processing/MULTI_STAGE_MATCHING.md) | 5h | Medium | Fuzzy matching pipeline |
| [SCORING_ENGINE](13-data-processing/SCORING_ENGINE.md) | 4h | Medium | Configurable scoring system |
| [ANALYTICS_PIPELINE](13-data-processing/ANALYTICS_PIPELINE.md) | 6h | High | Analytics data pipeline |
| [COMMUNITY_FEED](13-data-processing/COMMUNITY_FEED.md) | 4h | Medium | Social feed algorithms |

---

## By Use Case

### Starting a New Project
1. [ENVIRONMENT_CONFIG](00-foundations/ENVIRONMENT_CONFIG.md)
2. [TYPESCRIPT_STRICT](00-foundations/TYPESCRIPT_STRICT.md)
3. [SUPABASE_AUTH](01-auth/SUPABASE_AUTH.md)
4. [MIGRATIONS](02-database/MIGRATIONS.md)

### Adding Payments
1. [STRIPE_INTEGRATION](10-integrations/STRIPE_INTEGRATION.md)
2. [TIER_ENTITLEMENTS](01-auth/TIER_ENTITLEMENTS.md)
3. [TIER_RATE_LIMITS](06-api/TIER_RATE_LIMITS.md)

### Building Real-Time Features
1. [SSE_STREAMING](07-realtime/SSE_STREAMING.md)
2. [WEBSOCKET_CONNECTION_MANAGEMENT](07-realtime/WEBSOCKET_CONNECTION_MANAGEMENT.md)
3. [BACKPRESSURE](03-resilience/BACKPRESSURE.md)

### Processing Large Data
1. [BATCH_PROCESSING](05-data-pipeline/BATCH_PROCESSING.md)
2. [CHECKPOINT_RESUME](05-data-pipeline/CHECKPOINT_RESUME.md)
3. [VALIDATION_QUARANTINE](05-data-pipeline/VALIDATION_QUARANTINE.md)

### Adding AI Features
1. [PROMPT_ENGINE](11-ai/PROMPT_ENGINE.md)
2. [AI_GENERATION_CLIENT](11-ai/AI_GENERATION_CLIENT.md)
3. [PROVENANCE_AUDIT](11-ai/PROVENANCE_AUDIT.md)

### Production Hardening
1. [CIRCUIT_BREAKER](03-resilience/CIRCUIT_BREAKER.md)
2. [GRACEFUL_SHUTDOWN](03-resilience/GRACEFUL_SHUTDOWN.md)
3. [HEALTH_MONITORING](09-observability/HEALTH_MONITORING.md)
4. [ERROR_SANITIZATION](03-resilience/ERROR_SANITIZATION.md)

---

## Pattern Template

See [PATTERN_TEMPLATE.md](PATTERN_TEMPLATE.md) for the standard format when adding new patterns.

---

## Contributing

1. Follow the pattern template
2. Include implementation time estimate
3. Add production checklist
4. Link to related patterns
5. Include both TypeScript and Python where applicable
