# Circuit Breaker Pattern

> **Implementation Time**: 4h  
> **Complexity**: Medium  
> **Dependencies**: None

## Problem

External service goes down. Your app keeps hammering it. Requests pile up. Timeouts cascade. Your whole system grinds to a halt because one dependency failed.

## Solution

Circuit breaker. After N failures, stop trying. Fail fast. Give the service time to recover. Periodically test if it's back.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Circuit Breaker               │
                    │                                         │
                    │  ┌─────────┐   ┌─────────┐   ┌───────┐  │
                    │  │ CLOSED  │──▶│  OPEN   │──▶│ HALF  │  │
                    │  │         │   │         │   │ OPEN  │  │
                    │  │ Normal  │   │ Fail    │   │ Test  │  │
                    │  │ traffic │   │ fast    │   │ mode  │  │
                    │  └────┬────┘   └────┬────┘   └───┬───┘  │
                    │       │             │            │      │
                    │       │  failures   │  timeout   │      │
                    │       │  >= N       │  expires   │      │
                    │       │             │            │      │
                    │       └─────────────┘            │      │
                    │                                  │      │
                    │       ┌──────────────────────────┘      │
                    │       │  success: back to CLOSED        │
                    │       │  failure: back to OPEN          │
                    │       ▼                                 │
                    └─────────────────────────────────────────┘
```

## Implementation

### Types

```typescript
// types.ts
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing fast
  HALF_OPEN = 'half_open' // Testing recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening
  successThreshold: number;    // Successes to close from half-open
  timeoutSeconds: number;      // How long to stay open
  halfOpenMaxCalls: number;    // Max test calls in half-open
}

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastStateChange: Date;
}
```

### Core Implementation

```typescript
// circuit-breaker.ts
import { CircuitState, CircuitBreakerConfig, CircuitBreakerState } from './types';

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeoutSeconds: 60,
  halfOpenMaxCalls: 3,
};

export class CircuitBreakerError extends Error {
  constructor(
    public serviceName: string,
    public retryAfter: number,
  ) {
    super(`Circuit breaker open for ${serviceName}, retry after ${retryAfter}s`);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private halfOpenCalls = 0;
  private lastFailure?: Date;
  private lastStateChange = new Date();
  private config: CircuitBreakerConfig;

  constructor(
    public readonly serviceName: string,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should allow the call
    if (!this.canExecute()) {
      const retryAfter = this.getRetryAfter();
      throw new CircuitBreakerError(this.serviceName, retryAfter);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check if a call should be allowed.
   */
  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if timeout has expired
        if (this.shouldAttemptReset()) {
          this.transitionTo(CircuitState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited calls to test recovery
        if (this.halfOpenCalls < this.config.halfOpenMaxCalls) {
          this.halfOpenCalls++;
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Record a successful call.
   */
  private recordSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Record a failed call.
   */
  private recordFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open goes back to open
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failures >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successes = 0;
      this.halfOpenCalls = 0;
    }

    console.log(`[CircuitBreaker] ${this.serviceName}: ${oldState} → ${newState}`);
  }

  /**
   * Check if we should attempt to reset from OPEN state.
   */
  private shouldAttemptReset(): boolean {
    const elapsed = (Date.now() - this.lastStateChange.getTime()) / 1000;
    return elapsed >= this.config.timeoutSeconds;
  }

  /**
   * Get seconds until retry is allowed.
   */
  private getRetryAfter(): number {
    const elapsed = (Date.now() - this.lastStateChange.getTime()) / 1000;
    return Math.max(0, Math.ceil(this.config.timeoutSeconds - elapsed));
  }

  /**
   * Get current state for monitoring.
   */
  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Check if circuit is open (for quick checks).
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Force reset to closed state (for testing/admin).
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }
}
```

### Circuit Breaker Registry

```typescript
// registry.ts
import { CircuitBreaker } from './circuit-breaker';
import type { CircuitBreakerConfig } from './types';

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a service.
 */
export function getCircuitBreaker(
  serviceName: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  let breaker = breakers.get(serviceName);
  
  if (!breaker) {
    breaker = new CircuitBreaker(serviceName, config);
    breakers.set(serviceName, breaker);
  }
  
  return breaker;
}

/**
 * Get all circuit breakers for monitoring.
 */
export function getAllBreakers(): Map<string, CircuitBreaker> {
  return breakers;
}

/**
 * Reset all circuit breakers.
 */
export function resetAllBreakers(): void {
  breakers.forEach(breaker => breaker.reset());
}
```

### Usage Examples

```typescript
// Basic usage
import { getCircuitBreaker, CircuitBreakerError } from './circuit-breaker';

const breaker = getCircuitBreaker('payment-api', {
  failureThreshold: 3,
  timeoutSeconds: 30,
});

async function processPayment(amount: number) {
  try {
    return await breaker.execute(async () => {
      const response = await fetch('https://api.stripe.com/charge', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      
      if (!response.ok) {
        throw new Error(`Payment failed: ${response.status}`);
      }
      
      return response.json();
    });
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      // Circuit is open - fail fast
      console.log(`Payment service unavailable, retry in ${error.retryAfter}s`);
      throw new Error('Payment service temporarily unavailable');
    }
    throw error;
  }
}
```

### With Fallback

```typescript
async function fetchDataWithFallback() {
  const breaker = getCircuitBreaker('data-api');
  
  try {
    return await breaker.execute(() => fetchFromPrimaryAPI());
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      // Use cached data when circuit is open
      console.log('Using cached data due to circuit breaker');
      return getCachedData();
    }
    throw error;
  }
}
```

### Health Check Endpoint

```typescript
// app/api/health/route.ts
import { getAllBreakers } from '@/lib/circuit-breaker';

export async function GET() {
  const breakers = getAllBreakers();
  const status: Record<string, object> = {};
  
  breakers.forEach((breaker, name) => {
    status[name] = breaker.getState();
  });
  
  const hasOpenCircuit = Array.from(breakers.values())
    .some(b => b.isOpen());
  
  return Response.json({
    status: hasOpenCircuit ? 'degraded' : 'healthy',
    circuits: status,
  }, {
    status: hasOpenCircuit ? 503 : 200,
  });
}
```

## Configuration Guide

| Scenario | failureThreshold | timeoutSeconds | successThreshold |
|----------|------------------|----------------|------------------|
| Critical API | 3 | 30 | 2 |
| Background job | 5 | 60 | 3 |
| Non-critical | 10 | 120 | 5 |
| Database | 3 | 15 | 2 |

## Monitoring

Log these metrics:
- State transitions (CLOSED → OPEN, etc.)
- Failure counts per service
- Time spent in OPEN state
- Recovery success rate

```typescript
// Prometheus-style metrics
const metrics = {
  circuit_state: new Gauge('circuit_breaker_state', 'Current state', ['service']),
  circuit_failures: new Counter('circuit_breaker_failures', 'Total failures', ['service']),
  circuit_opens: new Counter('circuit_breaker_opens', 'Times circuit opened', ['service']),
};
```

## Production Checklist

- [ ] Circuit breaker on all external API calls
- [ ] Appropriate thresholds per service criticality
- [ ] Fallback behavior defined for each circuit
- [ ] Health endpoint exposes circuit states
- [ ] Alerts on circuits staying open
- [ ] Logging on state transitions

## Related Patterns

- [Retry & Fallback](./RETRY_FALLBACK.md)
- [Resilient Storage](./RESILIENT_STORAGE.md)
- [Health Monitoring](../04-workers/HEALTH_MONITORING.md)
