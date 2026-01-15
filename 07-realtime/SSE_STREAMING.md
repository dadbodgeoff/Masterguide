# Server-Sent Events (SSE) Streaming

> **Implementation Time**: 3h  
> **Complexity**: Low  
> **Dependencies**: None

## Problem

User asks a question. AI generates a long response. User stares at a spinner for 10 seconds. Bad UX. You need to stream the response as it's generated.

## Solution

Server-Sent Events. One-way stream from server to client. Native browser support. No WebSocket complexity.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        SSE Flow                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client                    Server                    Backend     │
│    │                         │                          │        │
│    │  POST /api/ask/stream   │                          │        │
│    │─────────────────────────▶                          │        │
│    │                         │                          │        │
│    │  Content-Type:          │  fetch data              │        │
│    │  text/event-stream      │─────────────────────────▶│        │
│    │◀─────────────────────────                          │        │
│    │                         │                          │        │
│    │  data: {"type":"start"} │◀─────────────────────────│        │
│    │◀─────────────────────────  chunk 1                 │        │
│    │                         │                          │        │
│    │  data: {"type":"chunk"} │◀─────────────────────────│        │
│    │◀─────────────────────────  chunk 2                 │        │
│    │                         │                          │        │
│    │  data: {"type":"chunk"} │◀─────────────────────────│        │
│    │◀─────────────────────────  chunk 3                 │        │
│    │                         │                          │        │
│    │  data: {"type":"done"}  │                          │        │
│    │◀─────────────────────────                          │        │
│    │                         │                          │        │
│    │  [connection closes]    │                          │        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Implementation

### Server (Next.js API Route)

```typescript
// app/api/ask/stream/route.ts
import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.ML_PIPELINE_URL || 'http://localhost:8787';

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json();
        const { query } = body;

        if (!query) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Query required' })}\n\n`)
          );
          controller.close();
          return;
        }

        // Send start event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'start', 
            query,
            timestamp: new Date().toISOString()
          })}\n\n`)
        );

        // Fetch from backend
        try {
          const response = await fetch(`${BACKEND_URL}/api/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });

          if (!response.ok) {
            throw new Error('Backend unavailable');
          }

          const result = await response.json();

          // Stream response in chunks
          const chunks = chunkText(result.response || '', 100);

          for (let i = 0; i < chunks.length; i++) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'chunk', 
                content: chunks[i],
                index: i,
                total: chunks.length
              })}\n\n`)
            );

            // Small delay for streaming effect
            await sleep(50);
          }

          // Send metadata
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ 
              type: 'metadata',
              confidence: result.confidence,
              sources: result.sources,
            })}\n\n`)
          );

          // Send completion
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete',
              success: true
            })}\n\n`)
          );

        } catch (fetchError) {
          // Send error event
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ 
              type: 'error',
              message: 'Service temporarily unavailable'
            })}\n\n`)
          );
        }

      } catch (error) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error instanceof Error ? error.message : 'Unknown error'
          })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Helper: Split text into chunks
function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const words = text.split(' ');
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).length > maxLength) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Client (React Hook)

```typescript
// hooks/useStreamingQuery.ts
'use client';

import { useState, useCallback, useRef } from 'react';

interface StreamEvent {
  type: 'start' | 'chunk' | 'metadata' | 'complete' | 'error';
  content?: string;
  message?: string;
  [key: string]: unknown;
}

interface UseStreamingQueryResult {
  response: string;
  isStreaming: boolean;
  error: string | null;
  metadata: Record<string, unknown> | null;
  send: (query: string) => Promise<void>;
  cancel: () => void;
}

export function useStreamingQuery(): UseStreamingQueryResult {
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const send = useCallback(async (query: string) => {
    // Cancel any existing request
    cancel();

    // Reset state
    setResponse('');
    setError(null);
    setMetadata(null);
    setIsStreaming(true);

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch('/api/ask/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete events
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'chunk':
                  setResponse(prev => prev + (event.content || ''));
                  break;

                case 'metadata':
                  setMetadata(event);
                  break;

                case 'error':
                  setError(event.message || 'Unknown error');
                  break;

                case 'complete':
                  // Stream finished successfully
                  break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled
        return;
      }
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [cancel]);

  return {
    response,
    isStreaming,
    error,
    metadata,
    send,
    cancel,
  };
}
```

### Client Component

```typescript
// components/StreamingChat.tsx
'use client';

import { useState } from 'react';
import { useStreamingQuery } from '@/hooks/useStreamingQuery';

export function StreamingChat() {
  const [query, setQuery] = useState('');
  const { response, isStreaming, error, send, cancel } = useStreamingQuery();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    await send(query);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 px-4 py-2 border rounded"
          disabled={isStreaming}
        />
        
        {isStreaming ? (
          <button
            type="button"
            onClick={cancel}
            className="px-4 py-2 bg-red-500 text-white rounded"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Send
          </button>
        )}
      </form>

      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded mb-4">
          {error}
        </div>
      )}

      <div className="p-4 bg-gray-100 rounded min-h-[200px]">
        {response || (isStreaming ? 'Thinking...' : 'Response will appear here')}
        {isStreaming && <span className="animate-pulse">▊</span>}
      </div>
    </div>
  );
}
```

## SSE Event Format

```
data: {"type":"start","timestamp":"2024-01-15T10:30:00Z"}\n\n
data: {"type":"chunk","content":"Hello, "}\n\n
data: {"type":"chunk","content":"how can I help?"}\n\n
data: {"type":"metadata","confidence":0.95}\n\n
data: {"type":"complete","success":true}\n\n
```

Key rules:
- Each event starts with `data: `
- Events end with `\n\n` (double newline)
- JSON payload after `data: `

## Error Handling

```typescript
// Server-side error event
controller.enqueue(
  encoder.encode(`data: ${JSON.stringify({ 
    type: 'error',
    code: 'TIMEOUT',
    message: 'Request timed out',
    retryable: true
  })}\n\n`)
);

// Client-side handling
if (event.type === 'error') {
  if (event.retryable) {
    // Show retry button
  } else {
    // Show error message
  }
}
```

## Timeout Handling

```typescript
// Server: Add timeout to backend fetch
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(url, {
    signal: controller.signal,
  });
  clearTimeout(timeout);
} catch (error) {
  if (error.name === 'AbortError') {
    // Send timeout event
  }
}
```

## Production Checklist

- [ ] Content-Type: text/event-stream
- [ ] Cache-Control: no-cache
- [ ] Connection: keep-alive
- [ ] Client handles abort/cancel
- [ ] Server handles client disconnect
- [ ] Timeout on backend requests
- [ ] Error events for failures

## Related Patterns

- [Retry & Fallback](../03-resilience/RETRY_FALLBACK.md)
