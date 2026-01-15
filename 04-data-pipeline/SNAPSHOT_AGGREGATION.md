# Snapshot Aggregation Pattern

> Daily compression with merge logic and storage estimation for time-series data.

**Time to implement**: 4 hours  
**Complexity**: Medium  
**Dependencies**: None (pure TypeScript)

## The Problem

Raw event data grows fast. You need daily snapshots for:
- Historical dashboards without querying millions of rows
- 90-day retention with minimal storage (~2-3KB/day)
- Multiple pipeline runs per day that merge correctly
- Storage estimation for capacity planning

AI typically implements simple daily counts, missing the merge logic and structured aggregation.

## Core Types

```typescript
interface DailySnapshot {
  snapshotDate: string;           // YYYY-MM-DD
  totalArticles: number;
  totalEvents: number;
  totalClusters: number;
  avgRiskScore: number;
  maxRiskScore: number;
  categoryTotals: CategoryTotals;
  topHotspots: Hotspot[];         // Top 10 by risk
  keyEvents: KeyEvent[];          // Top 20 by risk
  countryStats: CountryStats;
  riskTrend: number;              // vs previous day
  eventTrend: number;
  pipelineRuns: number;           // How many runs merged
  createdAt: string;
  updatedAt: string;
}

interface CategoryTotals {
  MILITARY: number;
  POLITICAL: number;
  TERRORISM: number;
  ECONOMIC: number;
  NUCLEAR: number;
  DIPLOMATIC: number;
  HUMANITARIAN: number;
}

interface Hotspot {
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  riskScore: number;
  eventCount: number;
  category: string;
  categoryEmoji: string;
  summary: string;
}

interface KeyEvent {
  id: string;
  title: string;
  country: string;
  category: string;
  categoryEmoji: string;
  riskScore: number;
  url?: string;
  timestamp: string;
}

type CountryStats = Record<string, {
  events: number;
  avgRisk: number;
  maxRisk: number;
  topCategory: string;
}>;
```


## Aggregate Pipeline Results

```typescript
const CATEGORY_EMOJIS: Record<string, string> = {
  MILITARY: '🔴',
  POLITICAL: '🟠',
  TERRORISM: '🟣',
  ECONOMIC: '🟡',
  NUCLEAR: '☢️',
  DIPLOMATIC: '🟢',
  HUMANITARIAN: '🔵',
};

/**
 * Aggregate pipeline results into a daily snapshot
 */
export function aggregateToSnapshot(
  result: PipelineResult,
  rawEvents: RawEvent[] = [],
  date: string = new Date().toISOString().split('T')[0]
): DailySnapshot {
  const { predictions, stats } = result;
  
  // Calculate category totals from all predictions
  const categoryTotals = initCategoryTotals();
  for (const pred of predictions) {
    if (pred.categoryCounts) {
      for (const [cat, count] of Object.entries(pred.categoryCounts)) {
        if (cat in categoryTotals) {
          categoryTotals[cat as keyof CategoryTotals] += count;
        }
      }
    }
  }
  
  // Extract top 10 hotspots (highest risk clusters)
  const topHotspots: Hotspot[] = predictions
    .slice(0, 10)
    .map(p => ({
      country: getCountryName(p.countryCode),
      countryCode: p.countryCode,
      lat: p.lat,
      lon: p.lon,
      riskScore: p.riskScore,
      eventCount: p.eventCount,
      category: p.category,
      categoryEmoji: CATEGORY_EMOJIS[p.category] || '⚪',
      summary: p.summary,
    }));
  
  // Extract key events (top 20 by risk)
  const keyEvents: KeyEvent[] = rawEvents
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20)
    .map(e => ({
      id: e.id,
      title: truncate(e.title, 120),
      country: e.country,
      category: e.category,
      categoryEmoji: CATEGORY_EMOJIS[e.category] || '⚪',
      riskScore: e.riskScore,
      url: e.url,
      timestamp: new Date().toISOString(),
    }));
  
  // Build country stats
  const countryStats: CountryStats = {};
  for (const pred of predictions) {
    const country = pred.countryCode;
    if (!countryStats[country]) {
      countryStats[country] = {
        events: 0,
        avgRisk: 0,
        maxRisk: 0,
        topCategory: pred.category,
      };
    }
    countryStats[country].events += pred.eventCount;
    countryStats[country].maxRisk = Math.max(
      countryStats[country].maxRisk, 
      pred.riskScore
    );
  }
  
  // Calculate averages
  const countryPredCounts: Record<string, number> = {};
  for (const pred of predictions) {
    const country = pred.countryCode;
    countryPredCounts[country] = (countryPredCounts[country] || 0) + 1;
    countryStats[country].avgRisk += pred.riskScore;
  }
  for (const country of Object.keys(countryStats)) {
    countryStats[country].avgRisk = Math.round(
      countryStats[country].avgRisk / (countryPredCounts[country] || 1)
    );
  }
  
  // Aggregate stats
  const totalEvents = predictions.reduce((sum, p) => sum + p.eventCount, 0);
  const avgRiskScore = predictions.length > 0
    ? Math.round(predictions.reduce((sum, p) => sum + p.riskScore, 0) / predictions.length)
    : 0;
  const maxRiskScore = predictions.length > 0
    ? Math.max(...predictions.map(p => p.riskScore))
    : 0;
  
  return {
    snapshotDate: date,
    totalArticles: stats.totalFetched,
    totalEvents,
    totalClusters: stats.clustersFormed,
    avgRiskScore,
    maxRiskScore,
    categoryTotals,
    topHotspots,
    keyEvents,
    countryStats,
    riskTrend: 0,  // Calculated on insert by comparing to previous
    eventTrend: 0,
    pipelineRuns: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

## Merge Multiple Runs

Critical for pipelines that run multiple times per day:

```typescript
/**
 * Merge multiple snapshots from the same day
 */
export function mergeSnapshots(
  existing: DailySnapshot, 
  incoming: DailySnapshot
): DailySnapshot {
  // Merge category totals (take max - later run has more complete data)
  const categoryTotals = { ...existing.categoryTotals };
  for (const cat of Object.keys(categoryTotals) as (keyof CategoryTotals)[]) {
    categoryTotals[cat] = Math.max(
      categoryTotals[cat] || 0,
      incoming.categoryTotals[cat] || 0
    );
  }
  
  // Merge hotspots (keep top 10 by risk, dedupe by location)
  const allHotspots = [...existing.topHotspots, ...incoming.topHotspots];
  const uniqueHotspots = dedupeByKey(
    allHotspots, 
    h => `${h.lat.toFixed(1)},${h.lon.toFixed(1)}`
  );
  const topHotspots = uniqueHotspots
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);
  
  // Merge key events (keep top 20 by risk, dedupe by ID)
  const allEvents = [...existing.keyEvents, ...incoming.keyEvents];
  const uniqueEvents = dedupeByKey(allEvents, e => e.id);
  const keyEvents = uniqueEvents
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20);
  
  // Merge country stats (take max values)
  const countryStats = { ...existing.countryStats };
  for (const [country, stats] of Object.entries(incoming.countryStats)) {
    if (!countryStats[country]) {
      countryStats[country] = stats;
    } else {
      countryStats[country] = {
        events: Math.max(countryStats[country].events, stats.events),
        avgRisk: Math.round(
          (countryStats[country].avgRisk + stats.avgRisk) / 2
        ),
        maxRisk: Math.max(countryStats[country].maxRisk, stats.maxRisk),
        topCategory: stats.maxRisk > countryStats[country].maxRisk
          ? stats.topCategory
          : countryStats[country].topCategory,
      };
    }
  }
  
  return {
    ...existing,
    totalArticles: existing.totalArticles + incoming.totalArticles,
    totalEvents: Math.max(existing.totalEvents, incoming.totalEvents),
    totalClusters: Math.max(existing.totalClusters, incoming.totalClusters),
    avgRiskScore: Math.round(
      (existing.avgRiskScore + incoming.avgRiskScore) / 2
    ),
    maxRiskScore: Math.max(existing.maxRiskScore, incoming.maxRiskScore),
    categoryTotals,
    topHotspots,
    keyEvents,
    countryStats,
    pipelineRuns: existing.pipelineRuns + 1,
    updatedAt: new Date().toISOString(),
  };
}
```

## Storage Estimation

```typescript
/**
 * Estimate storage size of a snapshot (for monitoring)
 */
export function estimateSnapshotSize(snapshot: DailySnapshot): number {
  return JSON.stringify(snapshot).length;
}

// Typical snapshot: 2-3KB
// 90 days retention: ~270KB total
// 1 year: ~1MB
```

## Helper Functions

```typescript
function initCategoryTotals(): CategoryTotals {
  return {
    MILITARY: 0,
    POLITICAL: 0,
    TERRORISM: 0,
    ECONOMIC: 0,
    NUCLEAR: 0,
    DIPLOMATIC: 0,
    HUMANITARIAN: 0,
  };
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function dedupeByKey<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

## Database Schema

```sql
CREATE TABLE daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE UNIQUE NOT NULL,
  total_articles INTEGER DEFAULT 0,
  total_events INTEGER DEFAULT 0,
  total_clusters INTEGER DEFAULT 0,
  avg_risk_score INTEGER DEFAULT 0,
  max_risk_score INTEGER DEFAULT 0,
  category_totals JSONB DEFAULT '{}',
  top_hotspots JSONB DEFAULT '[]',
  key_events JSONB DEFAULT '[]',
  country_stats JSONB DEFAULT '{}',
  risk_trend INTEGER DEFAULT 0,
  event_trend INTEGER DEFAULT 0,
  pipeline_runs INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for date range queries
CREATE INDEX idx_snapshots_date ON daily_snapshots(snapshot_date DESC);

-- Auto-cleanup old snapshots (90 days)
CREATE OR REPLACE FUNCTION cleanup_old_snapshots()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM daily_snapshots 
  WHERE snapshot_date < CURRENT_DATE - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

## Usage Example

```typescript
// In your pipeline
async function saveDailySnapshot(result: PipelineResult) {
  const today = new Date().toISOString().split('T')[0];
  
  // Create snapshot from this run
  const newSnapshot = aggregateToSnapshot(result, result.rawEvents, today);
  
  // Check for existing snapshot today
  const { data: existing } = await supabase
    .from('daily_snapshots')
    .select('*')
    .eq('snapshot_date', today)
    .single();
  
  if (existing) {
    // Merge with existing
    const merged = mergeSnapshots(existing, newSnapshot);
    await supabase
      .from('daily_snapshots')
      .update(merged)
      .eq('snapshot_date', today);
  } else {
    // Insert new
    await supabase
      .from('daily_snapshots')
      .insert(newSnapshot);
  }
  
  console.log(`Snapshot size: ${estimateSnapshotSize(newSnapshot)} bytes`);
}
```

## Key Patterns

1. **Structured Aggregation** - Not just counts, but top-N lists and breakdowns
2. **Merge Logic** - Multiple runs per day combine correctly
3. **Deduplication** - Hotspots/events dedupe by key before merging
4. **Storage Estimation** - Track size for capacity planning
5. **Trend Calculation** - Compare to previous day on insert

## Anti-Patterns to Avoid

- ❌ Simple daily counts (lose detail for dashboards)
- ❌ Overwriting on multiple runs (lose data)
- ❌ No deduplication in merge (duplicate hotspots)
- ❌ Unbounded arrays (memory issues)
- ❌ No retention policy (storage grows forever)
