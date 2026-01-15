# Anomaly Detection Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium  
> **Prerequisites:** Health monitoring system

## The Problem

Production systems fail in subtle ways:
- Jobs slowly getting slower (not failing, just degrading)
- Error rates creeping up over time
- Same error repeating but not triggering alerts
- Alert fatigue from too many notifications

## The Solution

Rule-based anomaly detection with:
1. Configurable detection rules
2. Severity levels (critical/high/medium/low)
3. Cooldown periods (prevent alert storms)
4. Error pattern tracking

## Architecture

```
Worker Metrics → Check Rules → Cooldown Filter → Create Alert
                     ↓
              Track Errors → Detect Patterns → Alert on Repeats
```

## Core Implementation

### Types

```typescript
// lib/anomaly/types.ts
export enum AnomalyType {
  SLOW_JOB = 'slow_job',
  HIGH_FAILURE_RATE = 'high_failure_rate',
  WORKER_UNHEALTHY = 'worker_unhealthy',
  QUEUE_BACKLOG = 'queue_backlog',
  TIMEOUT_SPIKE = 'timeout_spike',
  REPEATED_ERROR = 'repeated_error',
  MEMORY_SPIKE = 'memory_spike',
  CPU_SPIKE = 'cpu_spike',
}

export enum AnomalySeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export interface AnomalyAlert {
  id: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  workerName: string;
  jobId?: string;
  message: string;
  details: Record<string, unknown>;
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

export interface AnomalyRule {
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  checkFn: (ctx: RuleContext) => boolean;
  messageTemplate: string;
  cooldownSeconds: number;
}

export interface RuleContext {
  workerName: string;
  status: string;
  failureRate: number;
  queueDepth: number;
  durationMs: number;
  expectedDurationMs: number;
  timeoutCount: number;
  errorRepeatCount: number;
  errorMessage: string;
  memoryMb: number;
  cpuPercent: number;
}
```

### Anomaly Rules Configuration

```typescript
// lib/anomaly/rules.ts
export const ANOMALY_RULES: AnomalyRule[] = [
  {
    anomalyType: AnomalyType.SLOW_JOB,
    severity: AnomalySeverity.MEDIUM,
    description: 'Job execution time exceeds expected duration',
    checkFn: (ctx) => ctx.durationMs > ctx.expectedDurationMs * 2,
    messageTemplate: 'Job took {durationMs}ms, expected {expectedDurationMs}ms',
    cooldownSeconds: 300, // 5 minutes
  },
  {
    anomalyType: AnomalyType.HIGH_FAILURE_RATE,
    severity: AnomalySeverity.HIGH,
    description: 'Worker failure rate exceeds threshold',
    checkFn: (ctx) => ctx.failureRate > 0.15, // 15%
    messageTemplate: 'Failure rate {failureRate}% exceeds 15% threshold',
    cooldownSeconds: 600, // 10 minutes
  },
  {
    anomalyType: AnomalyType.WORKER_UNHEALTHY,
    severity: AnomalySeverity.CRITICAL,
    description: 'Worker health status is unhealthy',
    checkFn: (ctx) => ctx.status === 'unhealthy',
    messageTemplate: 'Worker {workerName} is unhealthy',
    cooldownSeconds: 300,
  },
  {
    anomalyType: AnomalyType.QUEUE_BACKLOG,
    severity: AnomalySeverity.MEDIUM,
    description: 'Queue depth exceeds threshold',
    checkFn: (ctx) => ctx.queueDepth > 50,
    messageTemplate: 'Queue depth {queueDepth} exceeds threshold',
    cooldownSeconds: 300,
  },
  {
    anomalyType: AnomalyType.TIMEOUT_SPIKE,
    severity: AnomalySeverity.HIGH,
    description: 'Multiple timeouts detected',
    checkFn: (ctx) => ctx.timeoutCount > 3,
    messageTemplate: '{timeoutCount} timeouts in last window',
    cooldownSeconds: 600,
  },
  {
    anomalyType: AnomalyType.REPEATED_ERROR,
    severity: AnomalySeverity.HIGH,
    description: 'Same error repeated multiple times',
    checkFn: (ctx) => ctx.errorRepeatCount > 5,
    messageTemplate: 'Error "{errorMessage}" repeated {errorRepeatCount} times',
    cooldownSeconds: 900, // 15 minutes
  },
  {
    anomalyType: AnomalyType.MEMORY_SPIKE,
    severity: AnomalySeverity.HIGH,
    description: 'Memory usage exceeds threshold',
    checkFn: (ctx) => ctx.memoryMb > 1024, // 1GB
    messageTemplate: 'Memory usage {memoryMb}MB exceeds 1GB threshold',
    cooldownSeconds: 300,
  },
  {
    anomalyType: AnomalyType.CPU_SPIKE,
    severity: AnomalySeverity.MEDIUM,
    description: 'CPU usage exceeds threshold',
    checkFn: (ctx) => ctx.cpuPercent > 90,
    messageTemplate: 'CPU usage {cpuPercent}% exceeds 90% threshold',
    cooldownSeconds: 300,
  },
];
```

### Anomaly Detector

```typescript
// lib/anomaly/detector.ts
export class AnomalyDetector {
  private alerts = new Map<string, AnomalyAlert>();
  private cooldowns = new Map<string, Date>();
  private errorCounts = new Map<string, Map<string, number>>();
  private timeoutCounts = new Map<string, number>();
  private alertIdCounter = 0;

  /**
   * Check for anomalies based on worker health
   */
  checkWorkerHealth(
    workerName: string,
    health: {
      status: string;
      jobsProcessed: number;
      jobsFailed: number;
      queueDepth: number;
      lastDurationMs: number;
      expectedDurationMs: number;
      memoryMb: number;
      cpuPercent: number;
    }
  ): AnomalyAlert[] {
    const detected: AnomalyAlert[] = [];
    
    const failureRate = health.jobsProcessed > 0
      ? (health.jobsFailed / health.jobsProcessed) * 100
      : 0;

    const ctx: RuleContext = {
      workerName,
      status: health.status,
      failureRate,
      queueDepth: health.queueDepth,
      durationMs: health.lastDurationMs,
      expectedDurationMs: health.expectedDurationMs,
      timeoutCount: this.timeoutCounts.get(workerName) || 0,
      errorRepeatCount: 0,
      errorMessage: '',
      memoryMb: health.memoryMb,
      cpuPercent: health.cpuPercent,
    };

    for (const rule of ANOMALY_RULES) {
      // Skip if on cooldown
      if (this.isOnCooldown(workerName, rule.anomalyType)) continue;

      // Check rule
      if (rule.checkFn(ctx)) {
        const alert = this.createAlert(workerName, rule, ctx);
        detected.push(alert);
        this.setCooldown(workerName, rule.anomalyType, rule.cooldownSeconds);
      }
    }

    return detected;
  }

  /**
   * Check for job-level anomalies
   */
  checkJobExecution(
    workerName: string,
    jobId: string,
    durationMs: number,
    expectedDurationMs: number,
    success: boolean,
    error?: string
  ): AnomalyAlert[] {
    const detected: AnomalyAlert[] = [];

    // Track errors for pattern detection
    if (!success && error) {
      this.trackError(workerName, error);
    }

    // Check slow job
    if (durationMs > expectedDurationMs * 2) {
      if (!this.isOnCooldown(workerName, AnomalyType.SLOW_JOB)) {
        const alert = this.createAlert(workerName, ANOMALY_RULES[0], {
          durationMs,
          expectedDurationMs,
          jobId,
        } as RuleContext);
        alert.jobId = jobId;
        detected.push(alert);
        this.setCooldown(workerName, AnomalyType.SLOW_JOB, 300);
      }
    }

    // Check repeated errors
    if (error) {
      const errorCounts = this.errorCounts.get(workerName);
      const count = errorCounts?.get(error.slice(0, 200)) || 0;
      
      if (count > 5 && !this.isOnCooldown(workerName, AnomalyType.REPEATED_ERROR)) {
        const rule = ANOMALY_RULES.find(r => r.anomalyType === AnomalyType.REPEATED_ERROR)!;
        const alert = this.createAlert(workerName, rule, {
          errorMessage: error.slice(0, 100),
          errorRepeatCount: count,
        } as RuleContext);
        detected.push(alert);
        this.setCooldown(workerName, AnomalyType.REPEATED_ERROR, 900);
      }
    }

    return detected;
  }

  /**
   * Record a timeout event
   */
  recordTimeout(workerName: string): void {
    const count = (this.timeoutCounts.get(workerName) || 0) + 1;
    this.timeoutCounts.set(workerName, count);
  }

  /**
   * Reset timeout counter (call after successful execution)
   */
  resetTimeouts(workerName: string): void {
    this.timeoutCounts.set(workerName, 0);
  }

  /**
   * Resolve an anomaly
   */
  resolveAnomaly(alertId: string, resolution: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolvedAt) return false;

    alert.resolvedAt = new Date();
    alert.resolution = resolution;
    console.log(`[Anomaly] Resolved: ${alertId} - ${resolution}`);
    return true;
  }

  /**
   * Get active (unresolved) anomalies
   */
  getActiveAnomalies(): AnomalyAlert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolvedAt)
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a.severity] - order[b.severity];
      });
  }

  /**
   * Get anomaly counts by severity
   */
  getAnomalyCounts(): Record<AnomalySeverity, number> {
    const counts: Record<AnomalySeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const alert of this.alerts.values()) {
      if (!alert.resolvedAt) {
        counts[alert.severity]++;
      }
    }

    return counts;
  }

  /**
   * Cleanup old resolved anomalies (24h retention)
   */
  cleanup(): number {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, alert] of this.alerts) {
      if (alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.alerts.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════

  private trackError(workerName: string, error: string): void {
    if (!this.errorCounts.has(workerName)) {
      this.errorCounts.set(workerName, new Map());
    }
    const counts = this.errorCounts.get(workerName)!;
    const key = error.slice(0, 200); // Truncate for grouping
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  private createAlert(
    workerName: string,
    rule: AnomalyRule,
    ctx: Partial<RuleContext>
  ): AnomalyAlert {
    const id = `anomaly_${++this.alertIdCounter}_${Date.now()}`;

    // Format message with context values
    let message = rule.messageTemplate;
    for (const [key, value] of Object.entries(ctx)) {
      message = message.replace(`{${key}}`, String(value));
    }

    const alert: AnomalyAlert = {
      id,
      anomalyType: rule.anomalyType,
      severity: rule.severity,
      workerName,
      message,
      details: ctx as Record<string, unknown>,
      detectedAt: new Date(),
    };

    this.alerts.set(id, alert);
    console.log(`[Anomaly] ${rule.severity.toUpperCase()}: ${message}`);

    return alert;
  }

  private isOnCooldown(workerName: string, anomalyType: AnomalyType): boolean {
    const key = `${workerName}:${anomalyType}`;
    const cooldownEnd = this.cooldowns.get(key);
    return cooldownEnd !== undefined && cooldownEnd > new Date();
  }

  private setCooldown(
    workerName: string,
    anomalyType: AnomalyType,
    seconds: number
  ): void {
    const key = `${workerName}:${anomalyType}`;
    this.cooldowns.set(key, new Date(Date.now() + seconds * 1000));
  }
}

// Singleton
let detector: AnomalyDetector | null = null;

export function getAnomalyDetector(): AnomalyDetector {
  if (!detector) {
    detector = new AnomalyDetector();
  }
  return detector;
}
```

## Usage

```typescript
// In worker execution
const detector = getAnomalyDetector();

async function executeJob(job: Job) {
  const startTime = Date.now();
  
  try {
    await processJob(job);
    const duration = Date.now() - startTime;
    
    // Check for anomalies
    const alerts = detector.checkJobExecution(
      'data-processor',
      job.id,
      duration,
      30000, // Expected 30s
      true
    );
    
    // Reset timeout counter on success
    detector.resetTimeouts('data-processor');
    
    // Handle alerts
    for (const alert of alerts) {
      await notifyOps(alert);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Check for anomalies including the error
    const alerts = detector.checkJobExecution(
      'data-processor',
      job.id,
      duration,
      30000,
      false,
      error.message
    );
    
    for (const alert of alerts) {
      await notifyOps(alert);
    }
    
    throw error;
  }
}

// Periodic health check
setInterval(async () => {
  const health = await getWorkerHealth('data-processor');
  const alerts = detector.checkWorkerHealth('data-processor', health);
  
  for (const alert of alerts) {
    if (alert.severity === 'critical') {
      await pageOnCall(alert);
    } else {
      await notifySlack(alert);
    }
  }
}, 30000);
```

## API Endpoint

```typescript
// app/api/anomalies/route.ts
export async function GET() {
  const detector = getAnomalyDetector();
  
  return Response.json({
    active: detector.getActiveAnomalies(),
    counts: detector.getAnomalyCounts(),
  });
}

export async function POST(req: Request) {
  const { alertId, resolution } = await req.json();
  const detector = getAnomalyDetector();
  
  const resolved = detector.resolveAnomaly(alertId, resolution);
  
  return Response.json({ resolved });
}
```

## Checklist

- [ ] AnomalyType enum for all anomaly categories
- [ ] AnomalySeverity levels (critical/high/medium/low)
- [ ] Configurable rules with check functions
- [ ] Message templates with placeholder substitution
- [ ] Cooldown periods per worker + anomaly type
- [ ] Error pattern tracking (repeated errors)
- [ ] Timeout spike detection
- [ ] Alert creation with full context
- [ ] Resolution tracking
- [ ] Cleanup of old resolved alerts
- [ ] Severity-based sorting
- [ ] Singleton pattern for global state
