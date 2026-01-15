# Data Transformers

> Centralized transformation logic for consistent data shaping across API routes.

## The Problem

Data transformation scattered across routes:
- Duplicate code
- Inconsistent output formats
- Hard to test
- Changes require updates in multiple places

## The Pattern

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Raw Data   │────▶│ Transformers │────▶│  API Output │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              aggregators    enrichers
              rankers        validators
```

## Implementation

### Category Aggregation

```typescript
interface CategoryTotals {
  [category: string]: number;
}

function aggregateCategories(
  items: Array<{ category: string; count?: number }>
): CategoryTotals {
  const totals: CategoryTotals = {};

  for (const item of items) {
    const category = item.category?.toUpperCase() || 'OTHER';
    totals[category] = (totals[category] || 0) + (item.count ?? 1);
  }

  return totals;
}


// Convert to display format with percentages
function categoriesToBreakdown(
  totals: CategoryTotals,
  previousTotals?: CategoryTotals
): Array<{ category: string; count: number; percentage: number; trend: string }> {
  const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
  
  return Object.entries(totals)
    .map(([category, count]) => {
      let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
      
      if (previousTotals) {
        const prevCount = previousTotals[category] ?? 0;
        const change = count - prevCount;
        if (change > prevCount * 0.1) trend = 'increasing';
        else if (change < -prevCount * 0.1) trend = 'decreasing';
      }

      return {
        category,
        count,
        percentage: total > 0 ? count / total : 0,
        trend,
      };
    })
    .sort((a, b) => b.count - a.count);
}
```

### Ranking

```typescript
interface Rankable {
  score: number;
  count: number;
}

function rankItems<T extends Rankable>(items: T[], limit = 5): (T & { rank: number })[] {
  return items
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.count - a.count;
    })
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}
```

### Trend Calculation

```typescript
type SimpleTrend = 'increasing' | 'stable' | 'decreasing';

function calculateTrend(current: number, previous: number): SimpleTrend {
  if (previous === 0) return 'stable';
  const change = (current - previous) / previous;
  
  if (change > 0.1) return 'increasing';
  if (change < -0.1) return 'decreasing';
  return 'stable';
}

function calculateRollingAverage(values: number[], window = 7): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-window);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}
```

### Data Sanitization

```typescript
interface Hotspot {
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  riskScore: number;
  eventCount: number;
}

function sanitizeHotspot(raw: Partial<Hotspot>): Hotspot | null {
  if (!raw.country || !raw.countryCode) return null;
  
  return {
    country: raw.country,
    countryCode: raw.countryCode,
    lat: raw.lat ?? 0,
    lon: raw.lon ?? 0,
    riskScore: Math.min(100, Math.max(0, raw.riskScore ?? 0)),
    eventCount: Math.max(0, raw.eventCount ?? 0),
  };
}

function filterValidHotspots(hotspots: Partial<Hotspot>[]): Hotspot[] {
  return hotspots.map(sanitizeHotspot).filter((h): h is Hotspot => h !== null);
}
```

## Usage in API Routes

```typescript
// api/dashboard/route.ts
import { aggregateCategories, rankItems, filterValidHotspots } from '@/lib/transformers';

export async function GET() {
  const rawData = await fetchFromDatabase();
  
  return Response.json({
    categories: aggregateCategories(rawData.predictions),
    topHotspots: rankItems(filterValidHotspots(rawData.hotspots), 5),
    globalRisk: calculateGlobalRisk(rawData.hotspots),
  });
}
```

## Key Points

1. One file for all transformers - easy to find and test
2. Pure functions - no side effects
3. Handle edge cases (empty arrays, missing fields)
4. Re-export from types package for shared use

## Time Estimate: 2 hours
