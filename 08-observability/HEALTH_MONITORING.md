# Health Monitoring Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium  
> **Prerequisites:** Worker/job system

## The Problem

You need to know when workers are:
- Offline (no heartbeat)
- Degraded (slow or failing sometimes)
- Unhealthy (high failure rate)
- Stuck (started but never completed)

## The Solution

Heartbeat-based health monitoring with:
1. Configurable thresholds
2. Rolling duration windows
3. Failure rate calculation
4. Stuck job detection

## Architecture

```
Worker → Heartbeat → Health Monitor → Status Determination
           ↓
    Record Execution → Update Stats → Calculate Health
```

## Core Implementation

### Types

```typescript
// lib/health/types.ts
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  OFFLINE = 'offline',
  UNKNOWN = 'unknown',
}

export interface HealthThresholds {
  heartbeatTimeoutSeconds: number;
  degradedFailureRate: number;    // 0-1
  unhealthyFailureRate: number;   // 0-1
  degradedLatencyMultiplier: number;
  unhealthyLatencyMultiplier: number;
  maxQueueDepth: number;
}

export interface WorkerHealthState {
  workerName: string;
  status: HealthStatus;
  lastHeartbeat?: Date;
  heartbeatCount: number;
  jobsProcessed: number;
  jobsFailed: number;
  avgDurationMs: number;
  lastDurationMs: number;
  expectedDurationMs: number;
  queueDepth: number;
  memoryMb: number;
  cpuPercent: number;
}

export interface HealthSummary {
  totalWorkers: number;
  byStatus: Record<HealthStatus, number>;
  healthyCount: number;
  unhealthyCount: number;
  totalJobsProcessed: number;
  totalJobsFailed: number;
  overallFailureRate: number;
  systemStatus: 'healthy' | 'degraded' | 'unhealthy';
}
```

### Health Monitor

```typescript
// lib/health/monitor.ts
const DEFAULT_THRESHOLDS: HealthThresholds = {
  heartbeatTimeoutSeconds: 60,
  degradedFailureRate: 0.05,      // 5%
  unhealthyFailureRate: 0.15,     // 15%
  degradedLatencyMultiplier: 1.5,
  unhealthyLatencyMultiplier: 3.0,
  maxQueueDepth: 100,
};

export class HealthMonitor {
  private workers = new Map<string, WorkerHealthState>();
  private thresholds: HealthThresholds;
  private durations = new Map<string, number[]>(); // Rolling window

  constructor(thresholds: Partial<HealthThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Register a worker for monitoring
   */
  registerWorker(
    workerName: string,
    expectedDurationMs: number
  ): void {
    if (!this.workers.has(workerName)) {
      this.workers.set(workerName, {
        workerName,
        status: HealthStatus.UNKNOWN,
        heartbeatCount: 0,
        jobsProcessed: 0,
        jobsFailed: 0,
        avgDurationMs: 0,
        lastDurationMs: 0,
        expectedDurationMs,
        queueDepth: 0,
        memoryMb: 0,
        cpuPercent: 0,
      });
      this.durations.set(workerName, []);
      console.log(`[Health] Registered worker: ${workerName}`);
    }
  }

  /**
   * Record a heartbeat from a worker
   */
  recordHeartbeat(
    workerName: string,
    metrics: {
      memoryMb?: number;
      cpuPercent?: number;
      queueDepth?: number;
    } = {}
  ): void {
    const state = this.workers.get(workerName);
    if (!state) return;

    state.lastHeartbeat = new Date();
    state.heartbeatCount++;
    state.memoryMb = metrics.memoryMb ?? state.memoryMb;
    state.cpuPercent = metrics.cpuPercent ?? state.cpuPercent;
    state.queueDepth = metrics.queueDepth ?? state.queueDepth;

    // Update status
    state.status = this.determineStatus(state);
  }

  /**
   * Record execution start (returns execution ID)
   */
  recordExecutionStart(workerName: string): string {
    return `${workerName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Record execution completion
   */
  recordExecutionComplete(
    workerName: string,
    executionId: string,
    success: boolean,
    durationMs: number,
    error?: string
  ): void {
    const state = this.workers.get(workerName);
    if (!state) return;

    state.jobsProcessed++;
    if (!success) {
      state.jobsFailed++;
    }

    state.lastDurationMs = durationMs;
    state.lastHeartbeat = new Date();

    // Update rolling duration window (keep last 100)
    const durations = this.durations.get(workerName) || [];
    durations.push(durationMs);
    if (durations.length > 100) {
      durations.shift();
    }
    this.durations.set(workerName, durations);

    // Calculate average
    state.avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;

    // Update status
    state.status = this.determineStatus(state);

    if (!success && error) {
      console.log(`[Health] ${workerName} failed: ${error.slice(0, 100)}`);
    }
  }

  /**
   * Determine health status for a worker
   */
  private determineStatus(state: WorkerHealthState): HealthStatus {
    const now = new Date();

    // 1. Check heartbeat
    if (!state.lastHeartbeat) {
      return HealthStatus.OFFLINE;
    }

    const heartbeatAge = (now.getTime() - state.lastHeartbeat.getTime()) / 1000;
    if (heartbeatAge > this.thresholds.heartbeatTimeoutSeconds) {
      return HealthStatus.OFFLINE;
    }

    // 2. Check failure rate
    const failureRate = state.jobsProcessed > 0
      ? state.jobsFailed / state.jobsProcessed
      : 0;

    if (failureRate >= this.thresholds.unhealthyFailureRate) {
      return HealthStatus.UNHEALTHY;
    }
    if (failureRate >= this.thresholds.degradedFailureRate) {
      return HealthStatus.DEGRADED;
    }

    // 3. Check latency
    if (state.avgDurationMs > state.expectedDurationMs * this.thresholds.unhealthyLatencyMultiplier) {
      return HealthStatus.UNHEALTHY;
    }
    if (state.avgDurationMs > state.expectedDurationMs * this.thresholds.degradedLatencyMultiplier) {
      return HealthStatus.DEGRADED;
    }

    // 4. Check queue depth
    if (state.queueDepth > this.thresholds.maxQueueDepth) {
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.HEALTHY;
  }

  /**
   * Get health status for a specific worker
   */
  getHealthStatus(workerName: string): HealthStatus {
    const state = this.workers.get(workerName);
    if (!state) return HealthStatus.UNKNOWN;

    state.status = this.determineStatus(state);
    return state.status;
  }

  /**
   * Get full health state for a worker
   */
  getWorkerHealth(workerName: string): WorkerHealthState | null {
    const state = this.workers.get(workerName);
    if (!state) return null;

    state.status = this.determineStatus(state);
    return { ...state };
  }

  /**
   * Get all worker health states
   */
  getAllHealth(): Map<string, WorkerHealthState> {
    for (const state of this.workers.values()) {
      state.status = this.determineStatus(state);
    }
    return new Map(this.workers);
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): HealthSummary {
    const allHealth = this.getAllHealth();

    const byStatus: Record<HealthStatus, number> = {
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      offline: 0,
      unknown: 0,
    };

    let totalJobs = 0;
    let totalFailed = 0;

    for (const state of allHealth.values()) {
      byStatus[state.status]++;
      totalJobs += state.jobsProcessed;
      totalFailed += state.jobsFailed;
    }

    const unhealthyCount = byStatus.unhealthy + byStatus.offline;

    let systemStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthyCount > 0) {
      systemStatus = 'unhealthy';
    } else if (byStatus.degraded > 0) {
      systemStatus = 'degraded';
    }

    return {
      totalWorkers: allHealth.size,
      byStatus,
      healthyCount: byStatus.healthy,
      unhealthyCount,
      totalJobsProcessed: totalJobs,
      totalJobsFailed: totalFailed,
      overallFailureRate: totalJobs > 0 ? totalFailed / totalJobs : 0,
      systemStatus,
    };
  }

  /**
   * Check for stuck jobs (workers that started but never completed)
   */
  checkStuckJobs(maxAgeSeconds = 300): string[] {
    const stuck: string[] = [];
    const now = new Date();

    for (const [name, state] of this.workers) {
      if (state.lastHeartbeat) {
        const age = (now.getTime() - state.lastHeartbeat.getTime()) / 1000;
        if (age > maxAgeSeconds && state.status !== HealthStatus.OFFLINE) {
          stuck.push(name);
        }
      }
    }

    return stuck;
  }

  /**
   * Get percentile duration for a worker
   */
  getPercentileDuration(workerName: string, percentile: number): number {
    const durations = this.durations.get(workerName);
    if (!durations || durations.length === 0) return 0;

    const sorted = [...durations].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Reset stats for a worker
   */
  resetWorkerStats(workerName: string): void {
    const state = this.workers.get(workerName);
    if (state) {
      state.jobsProcessed = 0;
      state.jobsFailed = 0;
      state.avgDurationMs = 0;
      this.durations.set(workerName, []);
    }
  }
}

// Singleton
let monitor: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (!monitor) {
    monitor = new HealthMonitor();
  }
  return monitor;
}
```

## Usage

```typescript
// Worker registration (at startup)
const monitor = getHealthMonitor();
monitor.registerWorker('email-sender', 5000);    // Expected 5s
monitor.registerWorker('data-processor', 30000); // Expected 30s
monitor.registerWorker('report-generator', 60000); // Expected 60s

// In worker execution
async function processJob(job: Job) {
  const execId = monitor.recordExecutionStart('data-processor');
  const startTime = Date.now();

  try {
    await doWork(job);
    
    monitor.recordExecutionComplete(
      'data-processor',
      execId,
      true,
      Date.now() - startTime
    );
  } catch (error) {
    monitor.recordExecutionComplete(
      'data-processor',
      execId,
      false,
      Date.now() - startTime,
      error.message
    );
    throw error;
  }
}

// Heartbeat (every 30s)
setInterval(() => {
  const memUsage = process.memoryUsage();
  
  monitor.recordHeartbeat('data-processor', {
    memoryMb: Math.round(memUsage.heapUsed / 1024 / 1024),
    cpuPercent: getCpuUsage(),
    queueDepth: getQueueDepth(),
  });
}, 30000);
```

## API Endpoint

```typescript
// app/api/health/route.ts
export async function GET() {
  const monitor = getHealthMonitor();
  const summary = monitor.getHealthSummary();
  const workers = Object.fromEntries(monitor.getAllHealth());
  const stuck = monitor.checkStuckJobs();

  // Return appropriate status code
  const statusCode = summary.systemStatus === 'healthy' ? 200 :
                     summary.systemStatus === 'degraded' ? 200 : 503;

  return Response.json({
    status: summary.systemStatus,
    summary,
    workers,
    stuckJobs: stuck,
    percentiles: {
      'data-processor': {
        p50: monitor.getPercentileDuration('data-processor', 50),
        p95: monitor.getPercentileDuration('data-processor', 95),
        p99: monitor.getPercentileDuration('data-processor', 99),
      },
    },
  }, { status: statusCode });
}
```

## Kubernetes Probes

```typescript
// app/api/health/live/route.ts
export async function GET() {
  // Liveness: Is the process running?
  return Response.json({ status: 'ok' });
}

// app/api/health/ready/route.ts
export async function GET() {
  // Readiness: Can we accept traffic?
  const monitor = getHealthMonitor();
  const summary = monitor.getHealthSummary();

  if (summary.systemStatus === 'unhealthy') {
    return Response.json(
      { status: 'not ready', reason: 'unhealthy workers' },
      { status: 503 }
    );
  }

  return Response.json({ status: 'ready' });
}
```

## Checklist

- [ ] HealthStatus enum (healthy/degraded/unhealthy/offline/unknown)
- [ ] Configurable thresholds
- [ ] Worker registration with expected duration
- [ ] Heartbeat recording with metrics
- [ ] Execution start/complete tracking
- [ ] Rolling duration window (last 100)
- [ ] Failure rate calculation
- [ ] Latency-based status determination
- [ ] Queue depth monitoring
- [ ] Stuck job detection
- [ ] Percentile duration calculation
- [ ] System health summary
- [ ] Kubernetes probe endpoints
