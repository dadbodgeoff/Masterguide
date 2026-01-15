# Backpressure Management

> **Implementation Time**: 8h  
> **Complexity**: High  
> **Dependencies**: None

## Problem

Database is slow. Events keep coming. Memory fills up. OOM crash. Data loss. Your pipeline can produce faster than it can persist.

## Solution

Backpressure. Bounded buffers. Adaptive flushing. When the system is overwhelmed, slow down producers or drop low-priority data gracefully.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Backpressure Controller                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Producer   │───▶│   Bounded    │───▶│    Flush     │          │
│  │    Gate      │    │   Buffer     │    │  Scheduler   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │    State     │◀──▶│   Metrics    │◀──▶│   Adaptive   │          │
│  │   Machine    │    │  Collector   │    │    Rate      │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │    Database      │
                    │  (with Circuit   │
                    │    Breaker)      │
                    └──────────────────┘
```

## State Machine

```
         ┌─────────────────────────────────────────────────┐
         │                                                 │
         ▼                                                 │
    ┌─────────┐     buffer > 50%      ┌──────────┐        │
    │ NORMAL  │──────────────────────▶│ ELEVATED │        │
    │         │                       │          │        │
    └────┬────┘                       └────┬─────┘        │
         │                                 │              │
         │ buffer < 50%                    │ buffer > 80% │
         │◀────────────────────────────────│              │
         │                                 ▼              │
         │                           ┌──────────┐         │
         │                           │ CRITICAL │         │
         │                           │          │         │
         │                           └────┬─────┘         │
         │                                │               │
         │                                │ buffer = 100% │
         │                                ▼               │
         │                           ┌──────────┐         │
         │                           │ BLOCKED  │         │
         │                           │          │         │
         │                           └────┬─────┘         │
         │                                │               │
         │◀───────────────────────────────┘               │
         │         buffer < 80%                           │
         │                                                │
         │         shutdown signal                        │
         │────────────────────────────────────────────────┘
         │
         ▼
    ┌──────────┐
    │ DRAINING │
    └──────────┘
```

## Implementation

### Types

```typescript
// types.ts
export enum BackpressureState {
  NORMAL = 'normal',       // Below low watermark
  ELEVATED = 'elevated',   // Between watermarks
  CRITICAL = 'critical',   // Above high watermark
  BLOCKED = 'blocked',     // Buffer full
  DRAINING = 'draining',   // Shutdown mode
}

export enum BackpressureStrategy {
  BLOCK = 'block',           // Block producers
  DROP_OLDEST = 'drop_oldest', // Drop oldest items
  DROP_NEWEST = 'drop_newest', // Reject new items
  SAMPLE = 'sample',         // Keep every Nth item
}

export interface BackpressureConfig {
  maxBufferSize: number;
  highWatermark: number;     // 0-1, trigger backpressure
  lowWatermark: number;      // 0-1, release backpressure
  strategy: BackpressureStrategy;
  sampleRate?: number;       // For SAMPLE strategy
  maxBlockTimeMs?: number;   // For BLOCK strategy
  batchSize: number;
  minFlushIntervalMs: number;
  maxFlushIntervalMs: number;
  targetLatencyMs: number;
}

export interface FlushResult {
  success: number;
  failed: number;
  errors: Error[];
}

export type FlushFunction<T> = (items: T[]) => Promise<FlushResult>;
```

### Bounded Buffer

```typescript
// buffer.ts
export class BoundedBuffer<T> {
  private items: T[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.maxSize;
  }

  get utilization(): number {
    return this.items.length / this.maxSize;
  }

  isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(item: T): boolean {
    if (this.isFull()) {
      return false;
    }
    this.items.push(item);
    return true;
  }

  pushWithEviction(item: T): T | null {
    let evicted: T | null = null;
    if (this.isFull()) {
      evicted = this.items.shift() ?? null;
    }
    this.items.push(item);
    return evicted;
  }

  take(count: number): T[] {
    return this.items.splice(0, Math.min(count, this.items.length));
  }

  peek(count: number): T[] {
    return this.items.slice(0, Math.min(count, this.items.length));
  }

  clear(): T[] {
    const all = this.items;
    this.items = [];
    return all;
  }
}
```

### State Machine

```typescript
// state-machine.ts
import { BackpressureState, BackpressureConfig } from './types';

export class BackpressureStateMachine {
  private state: BackpressureState = BackpressureState.NORMAL;
  private stateHistory: { state: BackpressureState; timestamp: Date }[] = [];

  constructor(private config: BackpressureConfig) {}

  getState(): BackpressureState {
    return this.state;
  }

  /**
   * Update state based on buffer utilization.
   */
  update(utilization: number): BackpressureState {
    const previousState = this.state;
    
    // Handle draining state (terminal until reset)
    if (this.state === BackpressureState.DRAINING) {
      return this.state;
    }

    // Determine new state based on utilization
    if (utilization >= 1.0) {
      this.state = BackpressureState.BLOCKED;
    } else if (utilization >= this.config.highWatermark) {
      this.state = BackpressureState.CRITICAL;
    } else if (utilization >= this.config.lowWatermark) {
      this.state = BackpressureState.ELEVATED;
    } else {
      this.state = BackpressureState.NORMAL;
    }

    // Record state change
    if (this.state !== previousState) {
      this.stateHistory.push({ state: this.state, timestamp: new Date() });
      console.log(`[Backpressure] State: ${previousState} → ${this.state} (${(utilization * 100).toFixed(1)}%)`);
    }

    return this.state;
  }

  /**
   * Enter draining mode for graceful shutdown.
   */
  startDraining(): void {
    this.state = BackpressureState.DRAINING;
    this.stateHistory.push({ state: this.state, timestamp: new Date() });
  }

  /**
   * Reset to normal state.
   */
  reset(): void {
    this.state = BackpressureState.NORMAL;
    this.stateHistory = [];
  }

  getHistory(): { state: BackpressureState; timestamp: Date }[] {
    return [...this.stateHistory];
  }
}
```

### Backpressure Controller

```typescript
// controller.ts
import { BoundedBuffer } from './buffer';
import { BackpressureStateMachine } from './state-machine';
import {
  BackpressureState,
  BackpressureStrategy,
  BackpressureConfig,
  FlushFunction,
  FlushResult,
} from './types';

const DEFAULT_CONFIG: BackpressureConfig = {
  maxBufferSize: 10000,
  highWatermark: 0.8,
  lowWatermark: 0.5,
  strategy: BackpressureStrategy.DROP_OLDEST,
  batchSize: 100,
  minFlushIntervalMs: 100,
  maxFlushIntervalMs: 30000,
  targetLatencyMs: 500,
};

export class BackpressureController<T> {
  private buffer: BoundedBuffer<T>;
  private stateMachine: BackpressureStateMachine;
  private config: BackpressureConfig;
  private flushFn: FlushFunction<T>;
  private flushInterval: NodeJS.Timeout | null = null;
  private currentFlushIntervalMs: number;
  private running = false;

  // Metrics
  private eventsAccepted = 0;
  private eventsDropped = 0;
  private eventsFlushed = 0;
  private flushErrors = 0;
  private lastFlushLatencyMs = 0;

  constructor(flushFn: FlushFunction<T>, config: Partial<BackpressureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = new BoundedBuffer(this.config.maxBufferSize);
    this.stateMachine = new BackpressureStateMachine(this.config);
    this.flushFn = flushFn;
    this.currentFlushIntervalMs = this.config.minFlushIntervalMs;
  }

  /**
   * Start the controller.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleFlush();
  }

  /**
   * Stop the controller.
   */
  stop(): void {
    this.running = false;
    if (this.flushInterval) {
      clearTimeout(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Push an item to the buffer.
   * Returns true if accepted, false if dropped.
   */
  async push(item: T): Promise<boolean> {
    const state = this.stateMachine.getState();

    // Handle based on strategy and state
    switch (this.config.strategy) {
      case BackpressureStrategy.BLOCK:
        if (state === BackpressureState.BLOCKED) {
          // Wait for space
          const waited = await this.waitForSpace();
          if (!waited) {
            this.eventsDropped++;
            return false;
          }
        }
        break;

      case BackpressureStrategy.DROP_NEWEST:
        if (this.buffer.isFull()) {
          this.eventsDropped++;
          return false;
        }
        break;

      case BackpressureStrategy.DROP_OLDEST:
        if (this.buffer.isFull()) {
          this.buffer.pushWithEviction(item);
          this.eventsDropped++;
          this.eventsAccepted++;
          this.updateState();
          return true;
        }
        break;

      case BackpressureStrategy.SAMPLE:
        if (state !== BackpressureState.NORMAL) {
          const sampleRate = this.config.sampleRate || 10;
          if (this.eventsAccepted % sampleRate !== 0) {
            this.eventsDropped++;
            return false;
          }
        }
        break;
    }

    const accepted = this.buffer.push(item);
    if (accepted) {
      this.eventsAccepted++;
    } else {
      this.eventsDropped++;
    }

    this.updateState();
    return accepted;
  }

  /**
   * Push multiple items.
   */
  async pushBatch(items: T[]): Promise<{ accepted: number; dropped: number }> {
    let accepted = 0;
    let dropped = 0;

    for (const item of items) {
      if (await this.push(item)) {
        accepted++;
      } else {
        dropped++;
      }
    }

    return { accepted, dropped };
  }

  /**
   * Drain all remaining items (for shutdown).
   */
  async drain(): Promise<void> {
    this.stateMachine.startDraining();
    
    while (!this.buffer.isEmpty()) {
      await this.flush();
    }
  }

  /**
   * Get current metrics.
   */
  getMetrics() {
    return {
      state: this.stateMachine.getState(),
      bufferSize: this.buffer.size,
      bufferCapacity: this.buffer.capacity,
      bufferUtilization: this.buffer.utilization,
      eventsAccepted: this.eventsAccepted,
      eventsDropped: this.eventsDropped,
      eventsFlushed: this.eventsFlushed,
      flushErrors: this.flushErrors,
      lastFlushLatencyMs: this.lastFlushLatencyMs,
      currentFlushIntervalMs: this.currentFlushIntervalMs,
    };
  }

  /**
   * Flush items to the destination.
   */
  private async flush(): Promise<void> {
    if (this.buffer.isEmpty()) return;

    const batch = this.buffer.take(this.config.batchSize);
    if (batch.length === 0) return;

    const startTime = Date.now();

    try {
      const result = await this.flushFn(batch);
      
      this.eventsFlushed += result.success;
      this.flushErrors += result.failed;
      this.lastFlushLatencyMs = Date.now() - startTime;

      // Adapt flush interval based on latency
      this.adaptFlushInterval();
    } catch (error) {
      console.error('[Backpressure] Flush error:', error);
      this.flushErrors += batch.length;
      
      // Put items back on failure (optional - depends on requirements)
      // batch.forEach(item => this.buffer.push(item));
    }

    this.updateState();
  }

  /**
   * Schedule the next flush.
   */
  private scheduleFlush(): void {
    if (!this.running) return;

    this.flushInterval = setTimeout(async () => {
      await this.flush();
      this.scheduleFlush();
    }, this.currentFlushIntervalMs);
  }

  /**
   * Adapt flush interval based on latency.
   */
  private adaptFlushInterval(): void {
    const { targetLatencyMs, minFlushIntervalMs, maxFlushIntervalMs } = this.config;

    if (this.lastFlushLatencyMs > targetLatencyMs * 1.5) {
      // Slow down - database is struggling
      this.currentFlushIntervalMs = Math.min(
        this.currentFlushIntervalMs * 1.5,
        maxFlushIntervalMs
      );
    } else if (this.lastFlushLatencyMs < targetLatencyMs * 0.5) {
      // Speed up - database is healthy
      this.currentFlushIntervalMs = Math.max(
        this.currentFlushIntervalMs * 0.8,
        minFlushIntervalMs
      );
    }
  }

  /**
   * Update state machine based on buffer utilization.
   */
  private updateState(): void {
    this.stateMachine.update(this.buffer.utilization);
  }

  /**
   * Wait for buffer space (for BLOCK strategy).
   */
  private async waitForSpace(): Promise<boolean> {
    const maxWait = this.config.maxBlockTimeMs || 5000;
    const startTime = Date.now();
    const pollInterval = 50;

    while (Date.now() - startTime < maxWait) {
      if (!this.buffer.isFull()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }
}
```

## Usage Examples

### Basic Usage

```typescript
import { BackpressureController, BackpressureStrategy } from './backpressure';

// Create controller with flush function
const controller = new BackpressureController(
  async (items) => {
    const result = await db.batchInsert('events', items);
    return {
      success: result.inserted,
      failed: result.failed,
      errors: result.errors,
    };
  },
  {
    strategy: BackpressureStrategy.DROP_OLDEST,
    maxBufferSize: 10000,
    batchSize: 100,
  }
);

// Start the controller
controller.start();

// Push events
const accepted = await controller.push(event);

// On shutdown
await controller.drain();
controller.stop();
```

### With Metrics Monitoring

```typescript
// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  const metrics = controller.getMetrics();
  
  res.json({
    backpressure_state: metrics.state,
    backpressure_buffer_utilization: metrics.bufferUtilization,
    backpressure_events_accepted: metrics.eventsAccepted,
    backpressure_events_dropped: metrics.eventsDropped,
    backpressure_flush_latency_ms: metrics.lastFlushLatencyMs,
  });
});
```

### Strategy Selection Guide

| Strategy | Use Case | Trade-off |
|----------|----------|-----------|
| `BLOCK` | Critical data, can't lose | Producers slow down |
| `DROP_OLDEST` | Time-series, recent matters | Lose historical data |
| `DROP_NEWEST` | Batch processing | Reject new work |
| `SAMPLE` | High-volume telemetry | Statistical accuracy |

## Configuration Presets

```typescript
// High throughput (speed over reliability)
const HIGH_THROUGHPUT = {
  maxBufferSize: 50000,
  highWatermark: 0.9,
  lowWatermark: 0.7,
  strategy: BackpressureStrategy.DROP_OLDEST,
  batchSize: 500,
  minFlushIntervalMs: 50,
};

// High reliability (data integrity over speed)
const HIGH_RELIABILITY = {
  maxBufferSize: 5000,
  highWatermark: 0.7,
  lowWatermark: 0.4,
  strategy: BackpressureStrategy.BLOCK,
  maxBlockTimeMs: 10000,
  batchSize: 50,
  minFlushIntervalMs: 200,
};
```

## Production Checklist

- [ ] Buffer size based on available memory
- [ ] Strategy matches data criticality
- [ ] Metrics exposed for monitoring
- [ ] Alerts on high drop rates
- [ ] Graceful drain on shutdown
- [ ] Circuit breaker on flush function

## Related Patterns

- [Circuit Breaker](./CIRCUIT_BREAKER.md)
- [Worker Orchestration](../04-workers/ORCHESTRATION.md)
- [Metrics Collection](../08-observability/METRICS.md)
