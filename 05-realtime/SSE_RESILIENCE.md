# SSE Stream Resilience Pattern

> **Time to implement:** 6-8 hours  
> **Complexity:** High  
> **Prerequisites:** Redis, Background job system

## The Problem

SSE streams can fail silently:
- Client disconnects mid-stream → orphaned server resources
- Completion events lost → user never sees result
- No visibility into stream health
- Resource leaks from abandoned streams

## The Solution

Redis-backed stream management with:
1. Stream registry (track all active streams)
2. Heartbeat monitoring (detect orphans)
3. Completion store (persist terminal events)
4. Stream guardian (background cleanup)

## Architecture

```
Client ←→ SSE Endpoint ←→ Stream Registry (Redis)
                              ↓
                    Completion Store (Redis)
                              ↓
                    Stream Guardian (Background)
```

## Core Implementation

### Types

```typescript
// lib/sse/types.ts
export enum StreamType {
  GENERATION = 'generation',
  AI_CHAT = 'ai_chat',
  EXPORT = 'export',
}

export enum StreamState {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ORPHANED = 'orphaned',
  EXPIRED = 'expired',
}

export interface StreamMetadata {
  streamId: string;
  streamType: StreamType;
  userId: string;
  startedAt: Date;
  lastHeartbeat: Date;
  state: StreamState;
  metadata: Record<string, unknown>;
}

export interface CompletionData {
  streamId: string;
  terminalEventType: string;
  terminalEventData: Record<string, unknown>;
  completedAt: Date;
}
```

### Stream Registry

```typescript
// lib/sse/stream-registry.ts
import Redis from 'ioredis';

const STREAM_KEY_PREFIX = 'sse:stream:';
const USER_STREAMS_PREFIX = 'sse:user:';
const ACTIVE_STREAMS_KEY = 'sse:active';

const STREAM_TTL = 3600;        // 1 hour max lifetime
const STALE_THRESHOLD = 30;     // 30 seconds = stale

export class StreamRegistry {
  constructor(private redis: Redis) {}

  /**
   * Register a new SSE stream
   */
  async register(metadata: StreamMetadata): Promise<boolean> {
    const streamKey = `${STREAM_KEY_PREFIX}${metadata.streamId}`;
    const userKey = `${USER_STREAMS_PREFIX}${metadata.userId}:streams`;

    // Check if already exists
    if (await this.redis.exists(streamKey)) {
      return false;
    }

    const pipeline = this.redis.pipeline();

    // Store stream metadata
    pipeline.hset(streamKey, {
      streamId: metadata.streamId,
      streamType: metadata.streamType,
      userId: metadata.userId,
      startedAt: metadata.startedAt.toISOString(),
      lastHeartbeat: metadata.lastHeartbeat.toISOString(),
      state: metadata.state,
      metadata: JSON.stringify(metadata.metadata),
    });
    pipeline.expire(streamKey, STREAM_TTL);

    // Add to user's stream set
    pipeline.sadd(userKey, metadata.streamId);
    pipeline.expire(userKey, STREAM_TTL);

    // Add to active streams sorted set (score = heartbeat timestamp)
    pipeline.zadd(ACTIVE_STREAMS_KEY, metadata.lastHeartbeat.getTime(), metadata.streamId);

    await pipeline.exec();
    return true;
  }

  /**
   * Update heartbeat timestamp
   */
  async heartbeat(streamId: string): Promise<boolean> {
    const streamKey = `${STREAM_KEY_PREFIX}${streamId}`;
    const now = new Date();

    if (!await this.redis.exists(streamKey)) {
      return false;
    }

    const pipeline = this.redis.pipeline();
    pipeline.hset(streamKey, 'lastHeartbeat', now.toISOString());
    pipeline.zadd(ACTIVE_STREAMS_KEY, now.getTime(), streamId);
    await pipeline.exec();

    return true;
  }

  /**
   * Unregister a stream (clean disconnect)
   */
  async unregister(streamId: string): Promise<boolean> {
    const streamKey = `${STREAM_KEY_PREFIX}${streamId}`;
    const userId = await this.redis.hget(streamKey, 'userId');

    if (!userId) return false;

    const userKey = `${USER_STREAMS_PREFIX}${userId}:streams`;

    const pipeline = this.redis.pipeline();
    pipeline.del(streamKey);
    pipeline.srem(userKey, streamId);
    pipeline.zrem(ACTIVE_STREAMS_KEY, streamId);
    await pipeline.exec();

    return true;
  }

  /**
   * Get stream metadata
   */
  async getStream(streamId: string): Promise<StreamMetadata | null> {
    const streamKey = `${STREAM_KEY_PREFIX}${streamId}`;
    const data = await this.redis.hgetall(streamKey);

    if (!data.streamId) return null;

    return {
      streamId: data.streamId,
      streamType: data.streamType as StreamType,
      userId: data.userId,
      startedAt: new Date(data.startedAt),
      lastHeartbeat: new Date(data.lastHeartbeat),
      state: data.state as StreamState,
      metadata: JSON.parse(data.metadata || '{}'),
    };
  }

  /**
   * Get all streams for a user
   */
  async getUserStreams(userId: string): Promise<StreamMetadata[]> {
    const userKey = `${USER_STREAMS_PREFIX}${userId}:streams`;
    const streamIds = await this.redis.smembers(userKey);

    const streams: StreamMetadata[] = [];
    for (const streamId of streamIds) {
      const stream = await this.getStream(streamId);
      if (stream) streams.push(stream);
    }

    return streams;
  }

  /**
   * Find stale streams (no heartbeat within threshold)
   */
  async getStaleStreams(thresholdSeconds = STALE_THRESHOLD): Promise<StreamMetadata[]> {
    const cutoff = Date.now() - (thresholdSeconds * 1000);
    const staleIds = await this.redis.zrangebyscore(ACTIVE_STREAMS_KEY, 0, cutoff);

    const streams: StreamMetadata[] = [];
    for (const streamId of staleIds) {
      const stream = await this.getStream(streamId);
      if (stream && stream.state === StreamState.ACTIVE) {
        streams.push(stream);
      }
    }

    return streams;
  }

  /**
   * Update stream state
   */
  async updateState(streamId: string, state: StreamState): Promise<boolean> {
    const streamKey = `${STREAM_KEY_PREFIX}${streamId}`;
    
    if (!await this.redis.exists(streamKey)) {
      return false;
    }

    await this.redis.hset(streamKey, 'state', state);
    return true;
  }

  /**
   * Get count of active streams
   */
  async getActiveCount(): Promise<number> {
    return this.redis.zcard(ACTIVE_STREAMS_KEY);
  }
}
```

### Completion Store

```typescript
// lib/sse/completion-store.ts
import Redis from 'ioredis';

const COMPLETION_KEY_PREFIX = 'sse:completion:';
const EVENTS_KEY_PREFIX = 'sse:events:';
const COMPLETION_TTL = 300;  // 5 minutes for recovery window

export class CompletionStore {
  constructor(private redis: Redis) {}

  /**
   * Store completion data for a stream
   */
  async storeCompletion(data: CompletionData): Promise<void> {
    const key = `${COMPLETION_KEY_PREFIX}${data.streamId}`;

    await this.redis.hset(key, {
      streamId: data.streamId,
      terminalEventType: data.terminalEventType,
      terminalEventData: JSON.stringify(data.terminalEventData),
      completedAt: data.completedAt.toISOString(),
    });
    await this.redis.expire(key, COMPLETION_TTL);
  }

  /**
   * Get completion data for recovery
   */
  async getCompletion(streamId: string): Promise<CompletionData | null> {
    const key = `${COMPLETION_KEY_PREFIX}${streamId}`;
    const data = await this.redis.hgetall(key);

    if (!data.streamId) return null;

    return {
      streamId: data.streamId,
      terminalEventType: data.terminalEventType,
      terminalEventData: JSON.parse(data.terminalEventData || '{}'),
      completedAt: new Date(data.completedAt),
    };
  }

  /**
   * Store event for replay
   */
  async storeEvent(
    streamId: string,
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<void> {
    const key = `${EVENTS_KEY_PREFIX}${streamId}`;
    const event = JSON.stringify({ type: eventType, data: eventData, ts: Date.now() });

    await this.redis.rpush(key, event);
    await this.redis.expire(key, COMPLETION_TTL);
  }

  /**
   * Get events for replay
   */
  async getEvents(streamId: string): Promise<Array<{ type: string; data: unknown }>> {
    const key = `${EVENTS_KEY_PREFIX}${streamId}`;
    const events = await this.redis.lrange(key, 0, -1);

    return events.map(e => JSON.parse(e));
  }

  /**
   * Delete completion data
   */
  async deleteCompletion(streamId: string): Promise<void> {
    await this.redis.del(
      `${COMPLETION_KEY_PREFIX}${streamId}`,
      `${EVENTS_KEY_PREFIX}${streamId}`
    );
  }
}
```

### Stream Guardian (Background Process)

```typescript
// lib/sse/stream-guardian.ts
export class StreamGuardian {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private registry: StreamRegistry,
    private completionStore: CompletionStore,
    private checkIntervalMs = 30000  // 30 seconds
  ) {}

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(
      () => this.runCheck(),
      this.checkIntervalMs
    );

    console.log('Stream Guardian started');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCheck(): Promise<void> {
    try {
      const staleStreams = await this.registry.getStaleStreams();

      for (const stream of staleStreams) {
        await this.handleOrphanedStream(stream);
      }

      // Log health metrics
      const activeCount = await this.registry.getActiveCount();
      console.log(`Stream Guardian: ${activeCount} active, ${staleStreams.length} orphaned`);
    } catch (err) {
      console.error('Stream Guardian error:', err);
    }
  }

  private async handleOrphanedStream(stream: StreamMetadata): Promise<void> {
    console.log(`Handling orphaned stream: ${stream.streamId}`);

    // Check if the underlying job completed
    const jobCompleted = await this.checkJobCompletion(stream);

    if (jobCompleted) {
      // Store completion data for client recovery
      await this.completionStore.storeCompletion({
        streamId: stream.streamId,
        terminalEventType: 'completed',
        terminalEventData: jobCompleted,
        completedAt: new Date(),
      });
    }

    // Mark as orphaned
    await this.registry.updateState(stream.streamId, StreamState.ORPHANED);
  }

  private async checkJobCompletion(
    stream: StreamMetadata
  ): Promise<Record<string, unknown> | null> {
    // Implement based on your job system
    // Example: check if generation job completed
    const jobId = stream.metadata.jobId as string;
    if (!jobId) return null;

    // const job = await jobService.getJob(jobId);
    // if (job?.status === 'completed') {
    //   return job.result;
    // }
    return null;
  }
}
```

### SSE Endpoint with Resilience

```typescript
// app/api/stream/[streamId]/route.ts
import { v4 as uuid } from 'uuid';

const registry = new StreamRegistry(redis);
const completionStore = new CompletionStore(redis);

export async function GET(
  req: Request,
  { params }: { params: { streamId: string } }
) {
  const userId = req.headers.get('x-user-id')!;
  const streamId = params.streamId || uuid();

  // Check for existing completion (recovery)
  const existingCompletion = await completionStore.getCompletion(streamId);
  if (existingCompletion) {
    // Return completion data immediately
    return new Response(
      `data: ${JSON.stringify({
        type: existingCompletion.terminalEventType,
        data: existingCompletion.terminalEventData,
      })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  }

  // Register new stream
  const metadata: StreamMetadata = {
    streamId,
    streamType: StreamType.GENERATION,
    userId,
    startedAt: new Date(),
    lastHeartbeat: new Date(),
    state: StreamState.ACTIVE,
    metadata: { jobId: req.headers.get('x-job-id') },
  };

  await registry.register(metadata);

  // Create SSE stream
  const encoder = new TextEncoder();
  let heartbeatInterval: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', streamId })}\n\n`)
      );

      // Heartbeat every 15 seconds
      heartbeatInterval = setInterval(async () => {
        try {
          await registry.heartbeat(streamId);
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Stream may be closed
        }
      }, 15000);
    },

    cancel() {
      // Clean disconnect
      clearInterval(heartbeatInterval);
      registry.unregister(streamId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Stream-Id': streamId,
    },
  });
}

// Helper to send events to a stream
export async function sendStreamEvent(
  streamId: string,
  eventType: string,
  data: Record<string, unknown>,
  isTerminal = false
): Promise<void> {
  // Store event for replay
  await completionStore.storeEvent(streamId, eventType, data);

  if (isTerminal) {
    // Store completion for recovery
    await completionStore.storeCompletion({
      streamId,
      terminalEventType: eventType,
      terminalEventData: data,
      completedAt: new Date(),
    });

    // Update stream state
    await registry.updateState(
      streamId,
      eventType === 'completed' ? StreamState.COMPLETED : StreamState.FAILED
    );
  }
}
```

### Recovery Endpoint

```typescript
// app/api/stream/[streamId]/recover/route.ts
export async function GET(
  req: Request,
  { params }: { params: { streamId: string } }
) {
  const { streamId } = params;

  // Get completion data
  const completion = await completionStore.getCompletion(streamId);
  
  if (completion) {
    return Response.json({
      status: 'completed',
      ...completion,
    });
  }

  // Get stream status
  const stream = await registry.getStream(streamId);
  
  if (!stream) {
    return Response.json({ status: 'not_found' }, { status: 404 });
  }

  // Get events for replay
  const events = await completionStore.getEvents(streamId);

  return Response.json({
    status: stream.state,
    events,
  });
}
```

## Client-Side Recovery

```typescript
// hooks/use-resilient-sse.ts
export function useResilientSSE(streamId: string) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'completed' | 'error'>('connecting');
  const [data, setData] = useState<unknown>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connect = async () => {
      // First, check for existing completion
      try {
        const recovery = await fetch(`/api/stream/${streamId}/recover`);
        const result = await recovery.json();

        if (result.status === 'completed') {
          setStatus('completed');
          setData(result.terminalEventData);
          return;
        }
      } catch {
        // Continue to SSE connection
      }

      // Connect to SSE
      eventSource = new EventSource(`/api/stream/${streamId}`);

      eventSource.onopen = () => {
        setStatus('connected');
        reconnectAttempts.current = 0;
      };

      eventSource.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        
        if (parsed.type === 'completed' || parsed.type === 'failed') {
          setStatus('completed');
          setData(parsed.data);
          eventSource?.close();
        } else {
          setData(parsed);
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        
        // Retry with backoff
        if (reconnectAttempts.current < 3) {
          reconnectAttempts.current++;
          setTimeout(connect, 1000 * reconnectAttempts.current);
        } else {
          setStatus('error');
        }
      };
    };

    connect();

    return () => {
      eventSource?.close();
    };
  }, [streamId]);

  return { status, data };
}
```

## Redis Key Structure

```
sse:stream:{streamId}
├── streamId, streamType, userId
├── startedAt, lastHeartbeat
├── state, metadata
TTL: 1 hour

sse:user:{userId}:streams
└── Set of stream IDs
TTL: 1 hour

sse:active
└── Sorted set (score = heartbeat timestamp)

sse:completion:{streamId}
├── terminalEventType, terminalEventData
└── completedAt
TTL: 5 minutes

sse:events:{streamId}
└── List of events for replay
TTL: 5 minutes
```

## Checklist

- [ ] StreamRegistry with Redis
- [ ] CompletionStore for terminal events
- [ ] StreamGuardian background process
- [ ] Heartbeat mechanism (15s interval)
- [ ] Orphan detection (30s threshold)
- [ ] Recovery endpoint
- [ ] Client-side reconnection logic
- [ ] Event replay capability
- [ ] Health metrics logging
- [ ] Graceful cleanup on disconnect
