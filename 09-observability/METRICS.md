# Metrics Collection

> **Implementation Time**: 3h  
> **Complexity**: Medium  
> **Dependencies**: None (Prometheus-compatible)

## Problem

Something's slow. Something's failing. You don't know what. No visibility into system behavior. Flying blind in production.

## Solution

Structured metrics. Counters, gauges, histograms. Prometheus-compatible format. Export for dashboards and alerts.

## Metric Types

| Type | Use Case | Example |
|------|----------|---------|
| Counter | Things that only go up | Requests, errors, events processed |
| Gauge | Current value | Active connections, queue size |
| Histogram | Distribution of values | Request latency, response sizes |

## Implementation

```typescript
// lib/metrics.ts

interface CounterMetric {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface GaugeMetric {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface HistogramMetric {
  name: string;
  help: string;
  labels: string[];
  buckets: number[];
  values: Map<string, { count: number; sum: number; buckets: number[] }>;
}

class MetricsRegistry {
  private counters = new Map<string, CounterMetric>();
  private gauges = new Map<string, GaugeMetric>();
  private histograms = new Map<string, HistogramMetric>();

  // ============================================
  // Counter Methods
  // ============================================

  registerCounter(name: string, help: string, labels: string[] = []): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { name, help, labels, values: new Map() });
    }
  }

  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const counter = this.counters.get(name);
    if (!counter) {
      console.warn(`Counter ${name} not registered`);
      return;
    }

    const key = this.labelsToKey(labels);
    const current = counter.values.get(key) || 0;
    counter.values.set(key, current + value);
  }

  // ============================================
  // Gauge Methods
  // ============================================

  registerGauge(name: string, help: string, labels: string[] = []): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { name, help, labels, values: new Map() });
    }
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      console.warn(`Gauge ${name} not registered`);
      return;
    }

    const key = this.labelsToKey(labels);
    gauge.values.set(key, value);
  }

  incrementGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const key = this.labelsToKey(labels);
    const current = gauge.values.get(key) || 0;
    gauge.values.set(key, current + value);
  }

  decrementGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    this.incrementGauge(name, labels, -value);
  }

  // ============================================
  // Histogram Methods
  // ============================================

  registerHistogram(
    name: string,
    help: string,
    labels: string[] = [],
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { name, help, labels, buckets, values: new Map() });
    }
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      console.warn(`Histogram ${name} not registered`);
      return;
    }

    const key = this.labelsToKey(labels);
    let data = histogram.values.get(key);

    if (!data) {
      data = {
        count: 0,
        sum: 0,
        buckets: new Array(histogram.buckets.length).fill(0),
      };
      histogram.values.set(key, data);
    }

    data.count++;
    data.sum += value;

    // Update bucket counts
    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]) {
        data.buckets[i]++;
      }
    }
  }

  // ============================================
  // Timer Helper
  // ============================================

  startTimer(histogramName: string, labels: Record<string, string> = {}): () => void {
    const start = performance.now();
    return () => {
      const duration = (performance.now() - start) / 1000; // Convert to seconds
      this.observeHistogram(histogramName, duration, labels);
    };
  }

  // ============================================
  // Export Methods
  // ============================================

  /**
   * Export metrics in Prometheus text format.
   */
  toPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const [labels, value] of counter.values) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${counter.name}${labelStr} ${value}`);
      }
    }

    // Gauges
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const [labels, value] of gauge.values) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${gauge.name}${labelStr} ${value}`);
      }
    }

    // Histograms
    for (const histogram of this.histograms.values()) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      for (const [labels, data] of histogram.values) {
        const labelStr = labels ? `${labels},` : '';
        for (let i = 0; i < histogram.buckets.length; i++) {
          const le = histogram.buckets[i];
          lines.push(`${histogram.name}_bucket{${labelStr}le="${le}"} ${data.buckets[i]}`);
        }
        lines.push(`${histogram.name}_bucket{${labelStr}le="+Inf"} ${data.count}`);
        lines.push(`${histogram.name}_sum{${labels}} ${data.sum}`);
        lines.push(`${histogram.name}_count{${labels}} ${data.count}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Export metrics as JSON.
   */
  toJSON(): object {
    return {
      counters: Object.fromEntries(
        Array.from(this.counters.entries()).map(([name, metric]) => [
          name,
          Object.fromEntries(metric.values),
        ])
      ),
      gauges: Object.fromEntries(
        Array.from(this.gauges.entries()).map(([name, metric]) => [
          name,
          Object.fromEntries(metric.values),
        ])
      ),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([name, metric]) => [
          name,
          Object.fromEntries(metric.values),
        ])
      ),
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.counters.forEach(c => c.values.clear());
    this.gauges.forEach(g => g.values.clear());
    this.histograms.forEach(h => h.values.clear());
  }

  // ============================================
  // Private Helpers
  // ============================================

  private labelsToKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }
}

// Singleton instance
export const metrics = new MetricsRegistry();

// Pre-register common metrics
metrics.registerCounter('http_requests_total', 'Total HTTP requests', ['method', 'path', 'status']);
metrics.registerCounter('errors_total', 'Total errors', ['type', 'source']);
metrics.registerHistogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'path']);
metrics.registerGauge('active_connections', 'Active connections');
metrics.registerGauge('queue_size', 'Queue size', ['queue']);
```

## Usage Examples

### HTTP Request Tracking

```typescript
// middleware.ts or API route wrapper
import { metrics } from '@/lib/metrics';

export async function withMetrics(
  handler: () => Promise<Response>,
  method: string,
  path: string
): Promise<Response> {
  const endTimer = metrics.startTimer('http_request_duration_seconds', { method, path });

  try {
    const response = await handler();
    
    metrics.incrementCounter('http_requests_total', {
      method,
      path,
      status: String(response.status),
    });

    return response;
  } catch (error) {
    metrics.incrementCounter('http_requests_total', {
      method,
      path,
      status: '500',
    });
    metrics.incrementCounter('errors_total', {
      type: 'http',
      source: path,
    });
    throw error;
  } finally {
    endTimer();
  }
}
```

### Queue Monitoring

```typescript
import { metrics } from '@/lib/metrics';

class JobQueue {
  private queue: Job[] = [];

  add(job: Job): void {
    this.queue.push(job);
    metrics.setGauge('queue_size', this.queue.length, { queue: 'jobs' });
  }

  process(): Job | undefined {
    const job = this.queue.shift();
    metrics.setGauge('queue_size', this.queue.length, { queue: 'jobs' });
    return job;
  }
}
```

### Business Metrics

```typescript
import { metrics } from '@/lib/metrics';

// Register business metrics
metrics.registerCounter('predictions_generated', 'Predictions generated', ['tier']);
metrics.registerCounter('user_signups', 'User signups', ['source']);
metrics.registerHistogram('prediction_latency_seconds', 'Prediction generation time');

// Track prediction
async function generatePrediction(userId: string, tier: string) {
  const endTimer = metrics.startTimer('prediction_latency_seconds');

  try {
    const prediction = await mlPipeline.generate();
    metrics.incrementCounter('predictions_generated', { tier });
    return prediction;
  } finally {
    endTimer();
  }
}
```

### Metrics Endpoint

```typescript
// app/api/metrics/route.ts
import { metrics } from '@/lib/metrics';

export async function GET() {
  return new Response(metrics.toPrometheus(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
```

## Key Metrics to Track

### System Metrics
- `http_requests_total` - Request count by method, path, status
- `http_request_duration_seconds` - Request latency
- `errors_total` - Error count by type
- `active_connections` - Current connections

### Business Metrics
- `user_signups_total` - New users
- `predictions_generated_total` - Core feature usage
- `subscription_upgrades_total` - Revenue events

### Infrastructure Metrics
- `queue_size` - Job queue depth
- `cache_hits_total` / `cache_misses_total` - Cache efficiency
- `db_query_duration_seconds` - Database performance

## Prometheus Output Format

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/dashboard",status="200"} 1523
http_requests_total{method="POST",path="/api/predictions",status="200"} 89
http_requests_total{method="POST",path="/api/predictions",status="429"} 12

# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",path="/api/dashboard",le="0.1"} 1400
http_request_duration_seconds_bucket{method="GET",path="/api/dashboard",le="0.5"} 1510
http_request_duration_seconds_bucket{method="GET",path="/api/dashboard",le="+Inf"} 1523
http_request_duration_seconds_sum{method="GET",path="/api/dashboard"} 152.3
http_request_duration_seconds_count{method="GET",path="/api/dashboard"} 1523
```

## Production Checklist

- [ ] Core HTTP metrics registered
- [ ] Business metrics defined
- [ ] /metrics endpoint exposed
- [ ] Prometheus scraping configured
- [ ] Grafana dashboards created
- [ ] Alerts on error rates and latency

## Related Patterns

- [Health Monitoring](../04-workers/HEALTH_MONITORING.md)
- [Circuit Breaker](../03-resilience/CIRCUIT_BREAKER.md)
