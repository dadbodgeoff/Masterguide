# Resilient Storage Layer

> **Implementation Time**: 6h  
> **Complexity**: High  
> **Dependencies**: Optional Redis, Supabase

## Problem

Redis goes down. Database is slow. Your app crashes because it depends on a single storage backend. No graceful degradation.

## Solution

Multi-backend storage with automatic failover. Redis primary, Supabase secondary, memory fallback. Circuit breakers per backend. Health-aware routing.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Resilient Storage Layer                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Backend Selection                         │   │
│  │                                                              │   │
│  │   Strategy: FAILOVER | ROUND_ROBIN | PRIORITY               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                │
│         │                    │                    │                │
│         ▼                    ▼                    ▼                │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│  │   Redis     │     │  Supabase   │     │   Memory    │          │
│  │  Backend    │     │  Backend    │     │  Backend    │          │
│  │             │     │             │     │             │          │
│  │ Priority: 1 │     │ Priority: 2 │     │ Priority: 3 │          │
│  │ Circuit: ○  │     │ Circuit: ○  │     │ Circuit: ○  │          │
│  │ Health: ✓   │     │ Health: ✓   │     │ Health: ✓   │          │
│  └─────────────┘     └─────────────┘     └─────────────┘          │
│         │                    │                    │                │
│         └────────────────────┴────────────────────┘                │
│                              │                                      │
│                    ┌─────────────────┐                             │
│                    │ Health Monitor  │                             │
│                    │ (30s interval)  │                             │
│                    └─────────────────┘                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Types

```typescript
// types.ts
export enum StorageBackendType {
  REDIS = 'redis',
  SUPABASE = 'supabase',
  MEMORY = 'memory',
}

export enum BackendHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

export enum SelectionStrategy {
  FAILOVER = 'failover',     // Use first healthy backend
  ROUND_ROBIN = 'round_robin', // Distribute across backends
  PRIORITY = 'priority',     // Always prefer highest priority
}

export interface StorageBackendConfig {
  type: StorageBackendType;
  priority: number;
  enabled: boolean;
  connectionString?: string;
  options?: Record<string, unknown>;
}

export interface ResilientStorageConfig {
  backends: StorageBackendConfig[];
  strategy: SelectionStrategy;
  healthCheckIntervalMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}

export interface IStorageBackend {
  name: string;
  type: StorageBackendType;
  
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<BackendHealth>;
  
  // Key-value operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  
  // Lock operations
  acquireLock(name: string, holderId: string, ttlSeconds: number): Promise<LockResult>;
  releaseLock(name: string, holderId: string): Promise<boolean>;
  extendLock(name: string, holderId: string, additionalSeconds: number): Promise<boolean>;
  
  // Metrics
  getMetrics(): BackendMetrics;
}
```

### Memory Backend (Fallback)

```typescript
// memory-backend.ts
export class MemoryBackend implements IStorageBackend {
  name = 'memory';
  type = StorageBackendType.MEMORY;
  
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private locks = new Map<string, { holderId: string; expiresAt: number }>();
  
  async initialize(): Promise<void> {
    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000);
  }
  
  async shutdown(): Promise<void> {
    this.store.clear();
    this.locks.clear();
  }
  
  async healthCheck(): Promise<BackendHealth> {
    return BackendHealth.HEALTHY; // Memory is always healthy
  }
  
  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
    return true;
  }
  
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  
  async exists(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
  
  async acquireLock(name: string, holderId: string, ttlSeconds: number): Promise<LockResult> {
    const existing = this.locks.get(name);
    const now = Date.now();
    
    // Check if lock exists and is valid
    if (existing && existing.expiresAt > now && existing.holderId !== holderId) {
      return { acquired: false, error: 'Lock held by another process' };
    }
    
    // Acquire or extend lock
    this.locks.set(name, {
      holderId,
      expiresAt: now + ttlSeconds * 1000,
    });
    
    return { acquired: true };
  }
  
  async releaseLock(name: string, holderId: string): Promise<boolean> {
    const lock = this.locks.get(name);
    if (!lock || lock.holderId !== holderId) return false;
    this.locks.delete(name);
    return true;
  }
  
  async extendLock(name: string, holderId: string, additionalSeconds: number): Promise<boolean> {
    const lock = this.locks.get(name);
    if (!lock || lock.holderId !== holderId) return false;
    lock.expiresAt = Date.now() + additionalSeconds * 1000;
    return true;
  }
  
  getMetrics(): BackendMetrics {
    return {
      operations: 0,
      errors: 0,
      avgLatencyMs: 0,
    };
  }
  
  private cleanup(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
    
    for (const [name, lock] of this.locks) {
      if (lock.expiresAt < now) {
        this.locks.delete(name);
      }
    }
  }
}
```

### Resilient Storage Orchestrator

```typescript
// resilient-storage.ts
interface BackendState {
  backend: IStorageBackend;
  config: StorageBackendConfig;
  health: BackendHealth;
  circuitOpen: boolean;
  circuitOpenedAt?: Date;
  consecutiveFailures: number;
}

export class ResilientStorage {
  private config: ResilientStorageConfig;
  private backends: BackendState[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  constructor(config: ResilientStorageConfig) {
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    // Initialize configured backends
    for (const backendConfig of this.config.backends) {
      if (!backendConfig.enabled) continue;
      
      try {
        const backend = await this.createBackend(backendConfig);
        await backend.initialize();
        
        this.backends.push({
          backend,
          config: backendConfig,
          health: BackendHealth.HEALTHY,
          circuitOpen: false,
          consecutiveFailures: 0,
        });
      } catch (error) {
        console.warn(`Failed to initialize ${backendConfig.type}:`, error);
      }
    }
    
    // Always add memory fallback
    if (!this.backends.some(b => b.backend.type === StorageBackendType.MEMORY)) {
      const memoryBackend = new MemoryBackend();
      await memoryBackend.initialize();
      this.backends.push({
        backend: memoryBackend,
        config: { type: StorageBackendType.MEMORY, priority: 999, enabled: true },
        health: BackendHealth.HEALTHY,
        circuitOpen: false,
        consecutiveFailures: 0,
      });
    }
    
    // Sort by priority
    this.backends.sort((a, b) => a.config.priority - b.config.priority);
    
    // Start health checks
    this.healthCheckInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );
  }
  
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    for (const state of this.backends) {
      await state.backend.shutdown();
    }
  }
  
  /**
   * Execute operation with automatic failover
   */
  private async executeWithFailover<T>(
    operation: string,
    fn: (backend: IStorageBackend) => Promise<T>,
    isSuccess: (result: T) => boolean = () => true
  ): Promise<T> {
    const triedBackends = new Set<string>();
    
    while (triedBackends.size < this.backends.length) {
      const state = this.selectBackend(triedBackends);
      if (!state) break;
      
      triedBackends.add(state.backend.name);
      
      try {
        const result = await fn(state.backend);
        
        if (isSuccess(result)) {
          this.recordSuccess(state);
          return result;
        }
        
        this.recordFailure(state);
      } catch (error) {
        console.warn(`${operation} failed on ${state.backend.name}:`, error);
        this.recordFailure(state);
      }
    }
    
    throw new Error(`All backends failed for: ${operation}`);
  }
  
  private selectBackend(exclude: Set<string> = new Set()): BackendState | null {
    const available = this.backends.filter(
      b => !exclude.has(b.backend.name) &&
           b.health !== BackendHealth.UNHEALTHY &&
           !b.circuitOpen
    );
    
    if (available.length === 0) {
      // Try memory fallback even if excluded
      return this.backends.find(b => b.backend.type === StorageBackendType.MEMORY) || null;
    }
    
    return available[0]; // Failover strategy: use first available
  }
  
  private recordSuccess(state: BackendState): void {
    state.consecutiveFailures = 0;
    if (state.circuitOpen) {
      state.circuitOpen = false;
      console.log(`Circuit closed for ${state.backend.name}`);
    }
  }
  
  private recordFailure(state: BackendState): void {
    state.consecutiveFailures++;
    
    if (state.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      if (!state.circuitOpen) {
        state.circuitOpen = true;
        state.circuitOpenedAt = new Date();
        console.warn(`Circuit opened for ${state.backend.name}`);
      }
    }
  }
  
  private async runHealthChecks(): Promise<void> {
    for (const state of this.backends) {
      try {
        state.health = await state.backend.healthCheck();
        
        // Reset circuit if healthy and timeout passed
        if (state.circuitOpen && state.circuitOpenedAt) {
          const elapsed = Date.now() - state.circuitOpenedAt.getTime();
          if (elapsed >= this.config.circuitBreakerResetMs && state.health === BackendHealth.HEALTHY) {
            state.circuitOpen = false;
            state.consecutiveFailures = 0;
            console.log(`Circuit reset for ${state.backend.name}`);
          }
        }
      } catch {
        state.health = BackendHealth.UNHEALTHY;
      }
    }
  }
  
  // Public API - delegates to executeWithFailover
  async get(key: string): Promise<string | null> {
    return this.executeWithFailover('get', b => b.get(key));
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    return this.executeWithFailover('set', b => b.set(key, value, ttlSeconds), r => r);
  }
  
  async acquireLock(name: string, holderId: string, ttlSeconds: number): Promise<LockResult> {
    return this.executeWithFailover(
      'acquireLock',
      b => b.acquireLock(name, holderId, ttlSeconds),
      r => r.acquired || !r.error
    );
  }
  
  // ... other methods delegate similarly
}
```

## Usage

```typescript
import { initializeResilientStorage, getResilientStorage } from './resilient-storage';

// Initialize at app startup
await initializeResilientStorage({
  backends: [
    { type: 'redis', priority: 1, enabled: true, connectionString: process.env.REDIS_URL },
    { type: 'supabase', priority: 2, enabled: true },
    { type: 'memory', priority: 999, enabled: true },
  ],
  strategy: 'failover',
  healthCheckIntervalMs: 30000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
});

// Use anywhere
const storage = getResilientStorage();

// Operations automatically failover
await storage.set('key', 'value', 3600);
const value = await storage.get('key');

// Locks work across backends
const lock = await storage.acquireLock('job:123', 'worker-1', 30);
```

## Health Endpoint

```typescript
// app/api/health/storage/route.ts
export async function GET() {
  const storage = getResilientStorage();
  const status = storage.getHealthStatus();
  
  const allHealthy = Object.values(status).every(
    s => s.health === 'healthy' && !s.circuitOpen
  );
  
  return Response.json({
    status: allHealthy ? 'healthy' : 'degraded',
    activeBackend: storage.getActiveBackend(),
    backends: status,
  }, {
    status: allHealthy ? 200 : 503,
  });
}
```

## Production Checklist

- [ ] Multiple backends configured
- [ ] Memory fallback always enabled
- [ ] Health checks running
- [ ] Circuit breaker thresholds tuned
- [ ] Monitoring on backend switches
- [ ] Alerts on all backends unhealthy

## Related Patterns

- [Circuit Breaker](./CIRCUIT_BREAKER.md)
- [Distributed Locking](./DISTRIBUTED_LOCK.md)
- [Leader Election](./LEADER_ELECTION.md)
