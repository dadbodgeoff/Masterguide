# Geographic Clustering Pattern

> Grid-based clustering with medoid finding and risk scoring from event density.

**Time to implement**: 5 hours  
**Complexity**: Medium  
**Dependencies**: None (pure TypeScript)

## The Problem

When you have thousands of geo-located events, you need to cluster them for visualization and analysis. AI typically uses simple distance-based clustering, but production needs:
- Grid-based clustering (O(n) vs O(n²) for distance-based)
- Medoid finding (actual data point as center, not synthetic centroid)
- Risk scoring from cluster characteristics
- Dominant category/country detection

## Core Types

```typescript
interface ProcessedEvent {
  id: string;
  lat?: number;
  lon?: number;
  sentiment: number;
  seenDate: Date;
  sourceCountry: string;
  // ... other fields
}

interface Cluster {
  id: string;
  events: ProcessedEvent[];
  centroidLat: number;
  centroidLon: number;
  countryCode: string;
}

// Grid cell size in degrees (~100km at equator)
const GRID_SIZE = 1.0;
```

## Grid-Based Clustering

Much faster than distance-based algorithms for large datasets:

```typescript
/**
 * Generate grid cell key for coordinates
 */
function getGridKey(lat: number, lon: number): string {
  const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE;
  const gridLon = Math.floor(lon / GRID_SIZE) * GRID_SIZE;
  return `${gridLat},${gridLon}`;
}

/**
 * Cluster events by geographic grid
 */
export function clusterEvents(
  events: ProcessedEvent[], 
  minClusterSize: number = 3
): Cluster[] {
  const grid = new Map<string, ProcessedEvent[]>();

  // O(n) grouping by grid cell
  for (const event of events) {
    if (event.lat === undefined || event.lon === undefined) continue;
    
    const key = getGridKey(event.lat, event.lon);
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(event);
  }

  // Convert grid cells to clusters
  const clusters: Cluster[] = [];
  let clusterId = 1;

  for (const [key, clusterEvents] of grid) {
    // Filter out small clusters (noise)
    if (clusterEvents.length < minClusterSize) continue;

    const centroidLat = clusterEvents.reduce((sum, e) => sum + (e.lat || 0), 0) 
                        / clusterEvents.length;
    const centroidLon = clusterEvents.reduce((sum, e) => sum + (e.lon || 0), 0) 
                        / clusterEvents.length;

    clusters.push({
      id: `cluster-${clusterId++}`,
      events: clusterEvents,
      centroidLat,
      centroidLon,
      countryCode: getDominantCountry(clusterEvents),
    });
  }

  console.log(`[Clusterer] ${clusters.length} clusters from ${events.length} events`);
  return clusters;
}
```


## Medoid Finding

The medoid is the actual data point closest to the centroid - better for map markers than synthetic centroids:

```typescript
/**
 * Find the medoid (most central actual point) in a cluster
 */
function findMedoid(events: ProcessedEvent[]): ProcessedEvent {
  if (events.length === 0) throw new Error('Cannot find medoid of empty cluster');
  if (events.length === 1) return events[0];

  // Calculate centroid
  const centroidLat = events.reduce((sum, e) => sum + (e.lat || 0), 0) / events.length;
  const centroidLon = events.reduce((sum, e) => sum + (e.lon || 0), 0) / events.length;

  // Find point closest to centroid
  let medoid = events[0];
  let minDist = Infinity;

  for (const event of events) {
    const dist = Math.hypot(
      (event.lat || 0) - centroidLat, 
      (event.lon || 0) - centroidLon
    );
    if (dist < minDist) {
      minDist = dist;
      medoid = event;
    }
  }

  return medoid;
}
```

## Dominant Category Detection

```typescript
/**
 * Get most common country code in cluster
 */
function getDominantCountry(events: ProcessedEvent[]): string {
  const counts: Record<string, number> = {};
  
  for (const event of events) {
    const country = event.sourceCountry || 'XX';
    counts[country] = (counts[country] || 0) + 1;
  }

  let maxCount = 0;
  let dominant = 'XX';
  
  for (const [country, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = country;
    }
  }

  return dominant;
}
```

## Risk Scoring from Clusters

This is where AI usually oversimplifies - risk is multi-factor:

```typescript
/**
 * Calculate risk score for a cluster (0-100)
 */
function calculateRiskScore(cluster: Cluster): number {
  const eventCount = cluster.events.length;
  const avgSentiment = cluster.events.reduce((sum, e) => sum + e.sentiment, 0) 
                       / eventCount;

  // Factor 1: Event density (0-40 points)
  // More events = higher risk, caps at 300 events
  const eventFactor = Math.min(eventCount / 300, 1) * 40;

  // Factor 2: Sentiment (0-30 points)
  // More negative sentiment = higher risk
  const sentimentFactor = Math.abs(Math.min(avgSentiment, 0)) * 30;

  // Factor 3: Recency (0-30 points)
  // More recent events = higher risk
  const now = Date.now();
  const avgAge = cluster.events.reduce((sum, e) => {
    return sum + (now - e.seenDate.getTime());
  }, 0) / eventCount;
  const hoursOld = avgAge / (1000 * 60 * 60);
  const recencyFactor = Math.max(0, 30 - hoursOld);

  const total = eventFactor + sentimentFactor + recencyFactor;
  return Math.round(Math.min(100, Math.max(0, total)));
}
```

## Signal Generation

```typescript
/**
 * Generate human-readable signals for a cluster
 */
function generateSignals(cluster: Cluster, riskScore: number): string[] {
  const signals: string[] = [];
  const avgSentiment = cluster.events.reduce((sum, e) => sum + e.sentiment, 0) 
                       / cluster.events.length;

  // Event count signal
  signals.push(`${cluster.events.length} events`);

  // Sentiment signal
  if (avgSentiment < -0.5) {
    signals.push('Very negative tone');
  } else if (avgSentiment < -0.2) {
    signals.push('Negative tone');
  }

  // Risk level signal
  if (riskScore >= 80) {
    signals.push('Critical risk');
  } else if (riskScore >= 60) {
    signals.push('High risk');
  } else if (riskScore >= 40) {
    signals.push('Elevated risk');
  }

  return signals.slice(0, 3); // Top 3 signals
}
```

## Convert Clusters to Predictions

```typescript
interface RiskPrediction {
  id: string;
  lat: number;
  lon: number;
  riskScore: number;
  sentiment: number;
  eventCount: number;
  topSignals: string[];
  summary: string;
  countryCode: string;
  updatedAt: string;
}

/**
 * Convert clusters to risk predictions for API/UI
 */
export function clustersToPredictions(clusters: Cluster[]): RiskPrediction[] {
  const predictions: RiskPrediction[] = [];

  for (const cluster of clusters) {
    const medoid = findMedoid(cluster.events);
    const riskScore = calculateRiskScore(cluster);
    const avgSentiment = cluster.events.reduce((sum, e) => sum + e.sentiment, 0) 
                         / cluster.events.length;

    const riskLevel = riskScore >= 80 ? 'Critical' 
                    : riskScore >= 60 ? 'High' 
                    : riskScore >= 40 ? 'Moderate' 
                    : 'Low';

    predictions.push({
      id: cluster.id,
      lat: medoid.lat || cluster.centroidLat,
      lon: medoid.lon || cluster.centroidLon,
      riskScore,
      sentiment: avgSentiment,
      eventCount: cluster.events.length,
      topSignals: generateSignals(cluster, riskScore),
      summary: `${riskLevel} risk in ${cluster.countryCode}: ${cluster.events.length} events`,
      countryCode: cluster.countryCode,
      updatedAt: new Date().toISOString(),
    });
  }

  // Sort by risk score descending
  return predictions.sort((a, b) => b.riskScore - a.riskScore);
}
```

## Usage Example

```typescript
// In your pipeline
async function processEvents() {
  const events = await fetchEvents();
  
  // Cluster geographically
  const clusters = clusterEvents(events, 3); // min 3 events per cluster
  
  // Convert to predictions
  const predictions = clustersToPredictions(clusters);
  
  // Return top 50 for map
  return predictions.slice(0, 50);
}
```

## Key Patterns

1. **Grid-Based O(n)** - Much faster than distance-based clustering for large datasets
2. **Medoid vs Centroid** - Use actual data point for map markers
3. **Multi-Factor Risk** - Combine density, sentiment, and recency
4. **Minimum Cluster Size** - Filter noise with threshold
5. **Dominant Detection** - Find most common category/country in cluster

## Tuning Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `GRID_SIZE` | 1.0° | ~100km cells, adjust for density |
| `minClusterSize` | 3 | Filter noise, increase for sparse data |
| Event cap | 300 | Max events for density scoring |
| Recency window | 30h | Hours before recency factor hits 0 |

## Anti-Patterns to Avoid

- ❌ Distance-based clustering on large datasets (O(n²))
- ❌ Synthetic centroids for map markers (may be in ocean)
- ❌ Single-factor risk scoring (misses nuance)
- ❌ No minimum cluster size (noise becomes clusters)
- ❌ Hardcoded risk thresholds (make configurable)
