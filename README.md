# 48-Hour SaaS Patterns

> Battle-tested patterns extracted from production TypeScript/Next.js and Python/FastAPI applications.
> Ship enterprise-grade features in hours, not weeks.

**49 patterns** | **~192 hours total** | **Copy-paste ready**

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
cd saas-patterns

# Patterns are organized by domain
ls -la
```

## Pattern Index

### 🏗️ Foundations
| Pattern | Description | Time |
|---------|-------------|------|
| [Monorepo Structure](00-foundations/MONOREPO_STRUCTURE.md) | Turborepo + pnpm workspace setup | 2h |
| [TypeScript Strict](00-foundations/TYPESCRIPT_STRICT.md) | Strict mode, path aliases, shared types | 1h |
| [Environment Config](00-foundations/ENVIRONMENT_CONFIG.md) | Multi-env config with validation | 1h |
| [Feature Flags](00-foundations/FEATURE_FLAGS.md) | Phased deployment with instant rollback | 3h |

### 🔐 Authentication & Authorization
| Pattern | Description | Time |
|---------|-------------|------|
| [Supabase Auth](01-auth/SUPABASE_AUTH.md) | Email/password with SSR sessions | 4h |
| [Middleware Protection](01-auth/MIDDLEWARE_PROTECTION.md) | Route protection with Next.js middleware | 2h |
| [Tier Entitlements](01-auth/TIER_ENTITLEMENTS.md) | Free/Pro feature gating | 3h |
| [Row Level Security](01-auth/ROW_LEVEL_SECURITY.md) | Postgres RLS policies | 2h |
| [JWT Refresh Rotation](01-auth/JWT_REFRESH_ROTATION.md) | Token rotation with reuse detection | 5h |

### 🗄️ Database
| Pattern | Description | Time |
|---------|-------------|------|
| [Migration Patterns](02-database/MIGRATIONS.md) | Safe schema evolution | 2h |

### 🛡️ Resilience (The Crown Jewels)
| Pattern | Description | Time |
|---------|-------------|------|
| [Circuit Breaker](03-resilience/CIRCUIT_BREAKER.md) | Prevent cascade failures | 4h |
| [Distributed Locking](03-resilience/DISTRIBUTED_LOCK.md) | Coordinate across instances | 4h |
| [Backpressure](03-resilience/BACKPRESSURE.md) | Memory-safe buffering | 8h |
| [Retry & Fallback](03-resilience/RETRY_FALLBACK.md) | Graceful degradation | 3h |
| [Leader Election](03-resilience/LEADER_ELECTION.md) | Single-writer coordination | 4h |
| [Resilient Storage](03-resilience/RESILIENT_STORAGE.md) | Multi-backend failover | 6h |
| [Graceful Shutdown](03-resilience/GRACEFUL_SHUTDOWN.md) | Clean shutdown with job tracking | 3h |
| [Tier Rate Limiting](08-resilience/TIER_RATE_LIMITING.md) | Free/Premium/Enterprise with concurrent tracking | 5h |
| [Distributed Locking (Python)](08-resilience/DISTRIBUTED_LOCKING.md) | Redis locks with ownership verification | 4h |
| [Error Sanitization](08-resilience/ERROR_SANITIZATION.md) | Production-safe error handling | 3h |

### 📊 Data Pipeline
| Pattern | Description | Time |
|---------|-------------|------|
| [Validation & Quarantine](04-data-pipeline/VALIDATION_QUARANTINE.md) | Quality scoring, suspicious data isolation | 4h |
| [Checkpoint & Resume](04-data-pipeline/CHECKPOINT_RESUME.md) | Exactly-once file processing | 4h |
| [Deduplication](04-data-pipeline/DEDUPLICATION.md) | Canonical selection, reputation scoring | 4h |
| [Geographic Clustering](04-data-pipeline/GEOGRAPHIC_CLUSTERING.md) | Grid-based clustering, medoid finding | 5h |
| [Snapshot Aggregation](04-data-pipeline/SNAPSHOT_AGGREGATION.md) | Daily compression, merge logic | 4h |
| [Secure Upload Pipeline](04-data-pipeline/SECURE_UPLOAD_PIPELINE.md) | Validation → Malware scan → Dedup → Storage | 6h |
| [Batch Processing](04-data-pipeline/BATCH_PROCESSING.md) | 30-40% throughput improvement pattern | 4h |

### ⚙️ Background Jobs
| Pattern | Description | Time |
|---------|-------------|------|
| [Worker Orchestration](04-workers/ORCHESTRATION.md) | Manage concurrent workers | 4h |
| [Dead Letter Queue](04-workers/DEAD_LETTER_QUEUE.md) | Failed job storage & replay | 3h |

### 🔌 API Design
| Pattern | Description | Time |
|---------|-------------|------|
| [Idempotency](05-api-design/IDEMPOTENCY.md) | Prevent duplicate operations | 3h |
| [API Client](05-api-design/API_CLIENT.md) | Typed client with auto-refresh | 5h |

### 📡 Realtime
| Pattern | Description | Time |
|---------|-------------|------|
| [SSE Streaming](05-realtime/SSE_STREAMING.md) | Server-sent events in Next.js | 3h |
| [SSE Resilience](05-realtime/SSE_RESILIENCE.md) | Orphan detection & recovery | 7h |

### 🎨 Frontend
| Pattern | Description | Time |
|---------|-------------|------|
| [Design Tokens](06-frontend/DESIGN_TOKENS.md) | Systematic design system | 4h |
| [PWA Setup](06-frontend/PWA_SETUP.md) | Manifest, icons, mobile meta | 2h |
| [Mobile Components](06-frontend/MOBILE_COMPONENTS.md) | Bottom sheet, mobile nav | 3h |
| [Fixed Timestep Game Loop](06-frontend/FIXED_TIMESTEP_GAME_LOOP.md) | Deterministic physics with interpolation | 4h |

### 📋 Data Contracts
| Pattern | Description | Time |
|---------|-------------|------|
| [Transformers](07-data-contracts/TRANSFORMERS.md) | Centralized data transformation | 2h |

### ⏱️ Rate Limiting
| Pattern | Description | Time |
|---------|-------------|------|
| [Tier Rate Limits](07-rate-limiting/TIER_RATE_LIMITS.md) | Sliding window with tier-based limits | 5h |

### 📊 Observability
| Pattern | Description | Time |
|---------|-------------|------|
| [Metrics Collection](08-observability/METRICS.md) | Prometheus-compatible metrics | 3h |
| [Anomaly Detection](08-observability/ANOMALY_DETECTION.md) | Rule-based detection with cooldowns | 4h |
| [Health Monitoring](08-observability/HEALTH_MONITORING.md) | Heartbeat tracking, failure rates | 4h |

### 🔔 Webhooks
| Pattern | Description | Time |
|---------|-------------|------|
| [Webhook Security](09-webhooks/WEBHOOK_SECURITY.md) | Idempotency & replay attack prevention | 5h |

### 🤖 AI Patterns
| Pattern | Description | Time |
|---------|-------------|------|
| [Prompt Engine](10-ai/PROMPT_ENGINE.md) | Template-based prompts with brand injection | 5h |
| [Provenance Audit](10-ai/PROVENANCE_AUDIT.md) | AI decision audit trail & explainability | 7h |

### 📧 Notifications
| Pattern | Description | Time |
|---------|-------------|------|
| [Email Service](11-notifications/EMAIL_SERVICE.md) | SendGrid with daily caps, per-user limits | 4h |

### 🔍 Fuzzy Matching
| Pattern | Description | Time |
|---------|-------------|------|
| [Multi-Stage Matching](11-fuzzy-matching/MULTI_STAGE_MATCHING.md) | 3-stage pipeline: PostgreSQL trigram → salient overlap → weighted similarity | 8h |

### 💾 Caching
| Pattern | Description | Time |
|---------|-------------|------|
| [Intelligent Cache](12-caching/INTELLIGENT_CACHE.md) | TTL by type, get-or-generate pattern | 5h |

### 🎮 Realtime Multiplayer
| Pattern | Description | Time |
|---------|-------------|------|
| [Atomic Matchmaking](13-realtime-multiplayer/ATOMIC_MATCHMAKING.md) | Two-phase commit for reliable match creation | 6h |
| [WebSocket Connection Management](13-realtime-multiplayer/WEBSOCKET_CONNECTION_MANAGEMENT.md) | Capacity limits, health checks, user routing | 4h |
| [Server-Authoritative Tick](13-realtime-multiplayer/SERVER_AUTHORITATIVE_TICK.md) | 60Hz game loop with lag compensation & anti-cheat | 8h |

---

## Tech Stack Assumptions

These patterns assume:
- **Runtime**: Node.js 20+ / Python 3.11+
- **Language**: TypeScript 5+ (strict mode) / Python with type hints
- **Framework**: Next.js 14+ (App Router) / FastAPI
- **Database**: PostgreSQL (via Supabase)
- **Cache**: Redis (optional, patterns degrade gracefully)
- **Package Manager**: pnpm / pip
- **Monorepo**: Turborepo (optional)

## New Patterns (Python/FastAPI)

The following patterns were extracted from production Python/FastAPI applications:

| Pattern | Source | Key Features |
|---------|--------|--------------|
| [Feature Flags](00-foundations/FEATURE_FLAGS.md) | RestaurantIQ | Phased deployment, beta users, instant rollback |
| [Secure Upload Pipeline](04-data-pipeline/SECURE_UPLOAD_PIPELINE.md) | RestaurantIQ | ClamAV malware scan, hash dedup, race protection |
| [Batch Processing](04-data-pipeline/BATCH_PROCESSING.md) | RestaurantIQ | 30-40% throughput improvement, fallback to sequential |
| [Tier Rate Limiting](08-resilience/TIER_RATE_LIMITING.md) | RestaurantIQ | Free/Premium/Enterprise, concurrent tracking |
| [Distributed Locking](08-resilience/DISTRIBUTED_LOCKING.md) | RestaurantIQ | Redis SET NX, ownership verification |
| [Error Sanitization](08-resilience/ERROR_SANITIZATION.md) | RestaurantIQ | Log everything, expose nothing |
| [Multi-Stage Matching](11-fuzzy-matching/MULTI_STAGE_MATCHING.md) | RestaurantIQ | PostgreSQL trigram + weighted similarity |

## Contributing

Each pattern follows the template in [PATTERN_TEMPLATE.md](PATTERN_TEMPLATE.md).

## License

MIT - Use these patterns freely in your projects.
