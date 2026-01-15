# Worker Orchestration

> Manage concurrent background workers with scheduling, health monitoring, and graceful degradation.

## The Problem

Multiple background jobs need coordination:
- Jobs shouldn't run concurrently if they conflict
- Failed jobs shouldn't bring down the system
- Need visibility into what's running
- Graceful shutdown without data loss

## The Pattern

```
┌─────────────────────────────────────────────────────┐
│                   Orchestrator                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Worker1 │  │ Worker2 │  │ Worker3 │  ...        │
│  └────┬────┘  └────┬────┘  └────┬────┘             │
│       │            │            │                   │
│       ▼            ▼            ▼                   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Health Monitor │ Circuit Breaker │ DLQ     │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Implementation

### Worker Configuration

```typescript
enum WorkerExecutionMode {
  SCHEDULED = 'scheduled',  // Run on interval
  TRIGGERED = 'triggered',  // Run on demand
  CONTINUOUS = 'continuous' // Run in loop
}

enum JobPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
}

interface WorkerConfig {
  name: string;
  executionMode: WorkerExecutionMode;
  intervalSeconds: number;
  timeoutSeconds: number;
  maxRetries: number;
  priority: JobPriority;
  maxConsecutiveFailures: number;
  dependsOn: string[];      // Must complete before this runs
  blocks: string[];         // Cannot run while this runs
  
  // Runtime state
  isEnabled: boolean;
  isRunning: boolean;
  consecutiveFailures: number;
  lastRun?: Date;
  lastSuccess?: Date;
  lastError?: string;
}

type WorkerFn = (config: WorkerConfig) => Promise<void>;
```

### Orchestrator

```typescript
interface OrchestratorConfig {
  tickIntervalMs: number;
  maxConcurrentWorkers: number;
  enableHealthChecks: boolean;
}

class WorkerOrchestrator {
  private workers = new Map<string, WorkerConfig>();
  private workerFns = new Map<string, WorkerFn>();
  private running = new Set<string>();
  private tickInterval: NodeJS.Timeout | null = null;
  private state: 'stopped' | 'running' | 'stopping' = 'stopped';

  constructor(private config: OrchestratorConfig) {}

  registerWorker(name: string, fn: WorkerFn, options: Partial<WorkerConfig> = {}): void {
    this.workers.set(name, {
      name,
      executionMode: options.executionMode || WorkerExecutionMode.SCHEDULED,
      intervalSeconds: options.intervalSeconds || 300,
      timeoutSeconds: options.timeoutSeconds || 60,
      maxRetries: options.maxRetries || 3,
      priority: options.priority || JobPriority.NORMAL,
      maxConsecutiveFailures: options.maxConsecutiveFailures || 5,
      dependsOn: options.dependsOn || [],
      blocks: options.blocks || [],
      isEnabled: true,
      isRunning: false,
      consecutiveFailures: 0,
    });
    this.workerFns.set(name, fn);
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    
    this.state = 'running';
    this.tickInterval = setInterval(() => this.tick(), this.config.tickIntervalMs);
    console.log(`[Orchestrator] Started with ${this.workers.size} workers`);
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    
    this.state = 'stopping';
    if (this.tickInterval) clearInterval(this.tickInterval);

    // Wait for running workers (with timeout)
    const maxWait = 30000;
    const start = Date.now();
    while (this.running.size > 0 && Date.now() - start < maxWait) {
      await this.sleep(100);
    }

    this.state = 'stopped';
    console.log('[Orchestrator] Stopped');
  }

  private async tick(): Promise<void> {
    if (this.state !== 'running') return;

    for (const [name, config] of this.workers) {
      if (!config.isEnabled || config.isRunning) continue;
      if (this.running.size >= this.config.maxConcurrentWorkers) break;

      if (this.shouldRun(config)) {
        this.executeWorker(name, config);
      }
    }
  }

  private shouldRun(config: WorkerConfig): boolean {
    // Check dependencies
    for (const dep of config.dependsOn) {
      if (this.workers.get(dep)?.isRunning) return false;
    }

    // Check blockers
    for (const blocker of config.blocks) {
      if (this.workers.get(blocker)?.isRunning) return false;
    }

    // Check schedule
    if (!config.lastRun) return true;
    const elapsed = (Date.now() - config.lastRun.getTime()) / 1000;
    return elapsed >= config.intervalSeconds;
  }

  private async executeWorker(name: string, config: WorkerConfig): Promise<void> {
    const fn = this.workerFns.get(name);
    if (!fn) return;

    config.isRunning = true;
    this.running.add(name);

    try {
      await fn(config);
      
      config.lastRun = new Date();
      config.lastSuccess = new Date();
      config.consecutiveFailures = 0;
      
    } catch (error) {
      config.lastRun = new Date();
      config.lastError = error instanceof Error ? error.message : String(error);
      config.consecutiveFailures++;

      // Disable after too many failures
      if (config.consecutiveFailures >= config.maxConsecutiveFailures) {
        config.isEnabled = false;
        console.log(`[Orchestrator] Disabled ${name} after ${config.consecutiveFailures} failures`);
      }
    } finally {
      config.isRunning = false;
      this.running.delete(name);
    }
  }

  // Manual trigger
  async triggerWorker(name: string): Promise<boolean> {
    const config = this.workers.get(name);
    if (!config || config.isRunning) return false;
    
    await this.executeWorker(name, config);
    return true;
  }

  // Re-enable a disabled worker
  enableWorker(name: string): void {
    const config = this.workers.get(name);
    if (config) {
      config.isEnabled = true;
      config.consecutiveFailures = 0;
    }
  }

  getStatus(): Record<string, any> {
    return {
      state: this.state,
      workers: this.workers.size,
      running: this.running.size,
      workerStates: Object.fromEntries(
        Array.from(this.workers.entries()).map(([name, config]) => [
          name,
          { enabled: config.isEnabled, running: config.isRunning, failures: config.consecutiveFailures },
        ])
      ),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Usage

```typescript
const orchestrator = new WorkerOrchestrator({
  tickIntervalMs: 5000,
  maxConcurrentWorkers: 5,
  enableHealthChecks: true,
});

// Register workers
orchestrator.registerWorker('fetch-data', fetchDataWorker, {
  intervalSeconds: 60,
  timeoutSeconds: 30,
  priority: JobPriority.HIGH,
});

orchestrator.registerWorker('process-data', processDataWorker, {
  intervalSeconds: 120,
  dependsOn: ['fetch-data'],  // Wait for fetch to complete
});

orchestrator.registerWorker('cleanup', cleanupWorker, {
  intervalSeconds: 3600,
  priority: JobPriority.LOW,
});

// Start
await orchestrator.start();

// Graceful shutdown
process.on('SIGTERM', () => orchestrator.stop());
```

## Key Points

1. Use `dependsOn` for sequential workflows
2. Use `blocks` for mutually exclusive jobs
3. Auto-disable after consecutive failures
4. Always implement graceful shutdown

## Time Estimate: 4 hours
