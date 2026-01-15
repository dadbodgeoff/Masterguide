# Graceful Shutdown

> Clean shutdown with in-flight job tracking, signal handlers, and buffer draining.

## The Problem

Abrupt shutdowns cause:
- Lost in-flight work
- Corrupted data from partial writes
- Orphaned resources
- Buffer data loss

## The Pattern

```
SIGTERM received
      │
      ▼
┌─────────────────┐
│ Stop accepting  │
│ new work        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Wait for        │
│ in-flight jobs  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Drain buffers   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run cleanup     │
│ callbacks       │
└────────┬────────┘
         │
         ▼
    Process exits
```

## Implementation

```typescript
type ShutdownCallback = () => Promise<void>;
type DrainCallback = () => Promise<{ flushed: number; dropped: number }>;

interface InFlightJob {
  id: string;
  workerName: string;
  startedAt: Date;
  timeoutMs: number;
}


class GracefulShutdown {
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private callbacks: ShutdownCallback[] = [];
  private drainCallbacks: DrainCallback[] = [];
  private inFlightJobs = new Map<string, InFlightJob>();
  private shutdownTimeoutMs = 30000;

  registerSignals(): void {
    const handler = (signal: string) => {
      console.log(`[Shutdown] Received ${signal}`);
      this.shutdown(`Signal: ${signal}`);
    };

    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGINT', () => handler('SIGINT'));
  }

  onShutdown(callback: ShutdownCallback): void {
    this.callbacks.push(callback);
  }

  onDrain(callback: DrainCallback): void {
    this.drainCallbacks.push(callback);
  }

  trackJob(id: string, workerName: string, timeoutMs = 60000): void {
    this.inFlightJobs.set(id, { id, workerName, startedAt: new Date(), timeoutMs });
  }

  completeJob(id: string): void {
    this.inFlightJobs.delete(id);
  }

  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.isShuttingDown = true;
    console.log(`[Shutdown] Starting: ${reason}`);

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const startTime = Date.now();

    // 1. Wait for in-flight jobs
    console.log(`[Shutdown] Waiting for ${this.inFlightJobs.size} jobs...`);
    
    while (this.inFlightJobs.size > 0) {
      if (Date.now() - startTime > this.shutdownTimeoutMs) {
        console.log(`[Shutdown] Timeout! ${this.inFlightJobs.size} jobs still running`);
        break;
      }

      // Force-complete stuck jobs
      const now = Date.now();
      for (const [id, job] of this.inFlightJobs) {
        if (now - job.startedAt.getTime() > job.timeoutMs) {
          console.log(`[Shutdown] Force-completing stuck job: ${id}`);
          this.inFlightJobs.delete(id);
        }
      }

      await this.sleep(100);
    }

    // 2. Drain buffers
    if (this.drainCallbacks.length > 0) {
      console.log(`[Shutdown] Draining ${this.drainCallbacks.length} buffers...`);
      
      let totalFlushed = 0, totalDropped = 0;
      
      for (const drain of this.drainCallbacks) {
        try {
          const result = await Promise.race([
            drain(),
            this.sleep(10000).then(() => ({ flushed: 0, dropped: 0 })),
          ]);
          totalFlushed += result.flushed;
          totalDropped += result.dropped;
        } catch (err) {
          console.error('[Shutdown] Drain error:', err);
        }
      }
      
      console.log(`[Shutdown] Drained: ${totalFlushed} flushed, ${totalDropped} dropped`);
    }

    // 3. Run cleanup callbacks
    console.log(`[Shutdown] Running ${this.callbacks.length} cleanup callbacks...`);
    
    for (const callback of this.callbacks) {
      try {
        await Promise.race([
          callback(),
          this.sleep(5000).then(() => { throw new Error('Callback timeout'); }),
        ]);
      } catch (err) {
        console.error('[Shutdown] Callback error:', err);
      }
    }

    console.log(`[Shutdown] Complete in ${Date.now() - startTime}ms`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
let instance: GracefulShutdown | null = null;

export function getShutdownHandler(): GracefulShutdown {
  if (!instance) instance = new GracefulShutdown();
  return instance;
}
```

## Usage

```typescript
const shutdown = getShutdownHandler();
shutdown.registerSignals();

// Register cleanup
shutdown.onShutdown(async () => {
  await database.close();
  await redis.quit();
});

// Register buffer drain
shutdown.onDrain(async () => {
  return backpressureBuffer.flush();
});

// Track jobs
function runJob(id: string) {
  shutdown.trackJob(id, 'my-worker', 30000);
  try {
    // ... do work
  } finally {
    shutdown.completeJob(id);
  }
}

// Check before starting new work
if (shutdown.isShutdownInProgress()) {
  return; // Don't start new work
}
```

## Key Points

1. Register signal handlers early in app startup
2. Track all in-flight work with timeouts
3. Drain buffers before cleanup callbacks
4. Set reasonable timeouts - don't hang forever

## Time Estimate: 3 hours
