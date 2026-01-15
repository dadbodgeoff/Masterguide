# Dead Letter Queue

> Store failed jobs for replay or manual inspection without blocking the pipeline.

## The Problem

Failed jobs need handling:
- Can't just drop them
- Retrying immediately may fail again
- Need visibility into failure patterns
- Manual intervention sometimes required

## The Pattern

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐
│  Worker  │────▶│  DLQ Store  │────▶│  Admin UI    │
└──────────┘     └─────────────┘     └──────────────┘
  on failure           │                    │
                       ▼                    ▼
                 ┌──────────┐         ┌──────────┐
                 │  Replay  │         │  Discard │
                 └──────────┘         └──────────┘
```

## Implementation

```typescript
interface DeadLetterJob {
  id: string;
  workerName: string;
  payload: Record<string, any>;
  errorMessage: string;
  errorType: string;
  stackTrace?: string;
  attempts: number;
  attemptErrors: string[];
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}


class DeadLetterQueue {
  private jobs = new Map<string, DeadLetterJob>();
  private maxSize = 1000;
  private counter = 0;

  add(
    workerName: string,
    payload: Record<string, any>,
    errorMessage: string,
    errorType: string,
    attempts: number,
    stackTrace?: string
  ): DeadLetterJob {
    const id = `dlq_${++this.counter}_${Date.now()}`;
    const now = new Date();

    const job: DeadLetterJob = {
      id,
      workerName,
      payload,
      errorMessage,
      errorType,
      stackTrace,
      attempts,
      attemptErrors: [errorMessage],
      firstAttemptAt: now,
      lastAttemptAt: now,
      createdAt: now,
    };

    this.jobs.set(id, job);
    this.enforceMaxSize();
    
    console.log(`[DLQ] Added: ${id} (${workerName})`);
    return job;
  }

  recordAttempt(jobId: string, errorMessage: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.attempts++;
    job.lastAttemptAt = new Date();
    job.attemptErrors.push(errorMessage);
    job.errorMessage = errorMessage;
    return true;
  }

  resolve(jobId: string, resolution: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.resolvedAt = new Date();
    job.resolution = resolution;
    return true;
  }

  discard(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  getUnresolved(): DeadLetterJob[] {
    return Array.from(this.jobs.values())
      .filter(j => !j.resolvedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getReplayable(maxAttempts = 5): DeadLetterJob[] {
    return this.getUnresolved().filter(j => j.attempts < maxAttempts);
  }

  getStats(): Record<string, any> {
    const jobs = Array.from(this.jobs.values());
    const unresolved = jobs.filter(j => !j.resolvedAt);
    
    const byWorker: Record<string, number> = {};
    const byErrorType: Record<string, number> = {};
    
    for (const job of unresolved) {
      byWorker[job.workerName] = (byWorker[job.workerName] || 0) + 1;
      byErrorType[job.errorType] = (byErrorType[job.errorType] || 0) + 1;
    }

    return { total: jobs.length, unresolved: unresolved.length, byWorker, byErrorType };
  }

  cleanupResolved(olderThanHours = 24): number {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    let deleted = 0;

    for (const [id, job] of this.jobs) {
      if (job.resolvedAt && job.resolvedAt.getTime() < cutoff) {
        this.jobs.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  private enforceMaxSize(): void {
    if (this.jobs.size <= this.maxSize) return;

    const sorted = Array.from(this.jobs.entries())
      .sort((a, b) => {
        if (a[1].resolvedAt && !b[1].resolvedAt) return -1;
        return a[1].createdAt.getTime() - b[1].createdAt.getTime();
      });

    while (sorted.length > this.maxSize) {
      const [id] = sorted.shift()!;
      this.jobs.delete(id);
    }
  }
}

// Singleton
let dlq: DeadLetterQueue | null = null;
export function getDeadLetterQueue(): DeadLetterQueue {
  if (!dlq) dlq = new DeadLetterQueue();
  return dlq;
}
```

## Usage

```typescript
const dlq = getDeadLetterQueue();

// In worker error handler
try {
  await processJob(job);
} catch (error) {
  if (job.attempts >= MAX_RETRIES) {
    dlq.add(
      'my-worker',
      job.payload,
      error.message,
      error.name,
      job.attempts,
      error.stack
    );
  }
}

// Admin: replay jobs
const replayable = dlq.getReplayable();
for (const job of replayable) {
  try {
    await processJob(job.payload);
    dlq.resolve(job.id, 'Replayed successfully');
  } catch (e) {
    dlq.recordAttempt(job.id, e.message);
  }
}

// Cleanup old resolved jobs
dlq.cleanupResolved(48);
```

## Key Points

1. Store enough context to replay
2. Track all attempt errors for debugging
3. Enforce max size to prevent memory issues
4. Expose stats for monitoring dashboards

## Time Estimate: 3 hours
