# Event Deduplication Pattern

> Canonical selection with reputation scoring and hash-based grouping for multi-source data.

**Time to implement**: 4 hours  
**Complexity**: Medium  
**Dependencies**: None (pure TypeScript)

## The Problem

When aggregating data from multiple sources, you get duplicates. AI typically implements simple URL deduplication, but production needs:
- Grouping by semantic similarity (same story, different outlets)
- Canonical selection (pick the "best" version)
- Reputation scoring (prefer authoritative sources)
- Handling both ID-based and content-based deduplication

## Two Deduplication Modes

```typescript
// gdelt/deduplicator.ts

// Mode 1: ID-based (when sources have unique IDs)
// Mode 2: Content-based (when grouping by semantic similarity)

export interface DeduplicationResult {
  events: ProcessedEvent[];
  originalCount: number;
  dedupedCount: number;
  reductionPercent: number;
  duplicateGroups?: number;
}
```

## ID-Based Deduplication

For sources with unique identifiers, keep the "best" version when IDs collide:

```typescript
/**
 * Deduplicate by unique ID, keeping best version
 */
export function deduplicateEvents(events: ProcessedEvent[]): DeduplicationResult {
  const seen = new Map<string, ProcessedEvent>();
  
  for (const event of events) {
    const existing = seen.get(event.id);
    if (existing) {
      // Prefer events with coordinates
      if (!existing.lat && event.lat) {
        seen.set(event.id, event);
      }
      // Prefer events with higher sentiment magnitude (more signal)
      else if (Math.abs(event.sentiment) > Math.abs(existing.sentiment)) {
        seen.set(event.id, event);
      }
    } else {
      seen.set(event.id, event);
    }
  }
  
  const dedupedEvents = Array.from(seen.values());
  const reductionPercent = events.length > 0
    ? Math.round((1 - dedupedEvents.length / events.length) * 100)
    : 0;
  
  return {
    events: dedupedEvents,
    originalCount: events.length,
    dedupedCount: dedupedEvents.length,
    reductionPercent,
  };
}
```

## Content-Based Deduplication

For multi-source aggregation where the same story appears from 50+ outlets:

```typescript
import { createHash } from 'crypto';

/**
 * Generate deduplication key from content
 * Groups by: normalized title + source country + date
 */
function generateDedupKey(article: Article): string {
  // Normalize title: lowercase, remove punctuation, take first 50 chars
  const normalizedTitle = article.title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
    .slice(0, 50);

  // Extract date (YYYYMMDD)
  const dateStr = article.publishedAt?.slice(0, 10).replace(/-/g, '') || 'unknown';

  return `${normalizedTitle}|${article.sourceCountry || 'unknown'}|${dateStr}`;
}

/**
 * Generate unique ID from URL
 */
function generateEventId(article: Article): string {
  return createHash('md5').update(article.url).digest('hex').slice(0, 12);
}
```

## Reputation-Based Canonical Selection

The key insight AI misses: when you have 50 versions of the same story, pick the most authoritative:

```typescript
/**
 * Source reputation scoring
 */
function getReputationScore(domain: string): number {
  // Tier 1: Wire services and major international
  const tier1 = ['reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 
                 'aljazeera.com', 'france24.com', 'dw.com'];
  if (tier1.some(r => domain.includes(r))) return 100;
  
  // Tier 2: Major newspapers
  const tier2 = ['nytimes.com', 'washingtonpost.com', 'theguardian.com', 
                 'ft.com', 'economist.com', 'wsj.com'];
  if (tier2.some(r => domain.includes(r))) return 75;
  
  // Tier 3: Regional/national papers
  const tier3 = ['cnn.com', 'foxnews.com', 'nbcnews.com', 'abcnews.go.com'];
  if (tier3.some(r => domain.includes(r))) return 50;
  
  // Unknown sources
  return 10;
}

/**
 * Select canonical article from duplicate group
 */
function selectCanonical(
  group: { article: Article; source: string }[]
): { article: Article; source: string } {
  return group.reduce((best, current) => {
    // Score = reputation + sentiment magnitude (more signal = better)
    const bestScore = getReputationScore(best.article.domain) + 
                      Math.abs(best.article.tone || 0);
    const currentScore = getReputationScore(current.article.domain) + 
                         Math.abs(current.article.tone || 0);
    
    return currentScore > bestScore ? current : best;
  });
}
```

## Full Multi-Source Deduplication

```typescript
/**
 * Deduplicate articles from multiple sources
 */
export function deduplicateArticles(
  sourceResults: { sourceName: string; articles: Article[] }[]
): DeduplicationResult {
  const groups = new Map<string, { article: Article; source: string }[]>();
  let totalArticles = 0;

  // Group articles by dedup key
  for (const { sourceName, articles } of sourceResults) {
    for (const article of articles) {
      totalArticles++;
      const key = generateDedupKey(article);
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push({ article, source: sourceName });
    }
  }

  // Select canonical article from each group
  const events: ProcessedEvent[] = [];
  
  for (const group of groups.values()) {
    const canonical = selectCanonical(group);
    events.push(toProcessedEvent(canonical.article, canonical.source));
  }

  const reductionPercent = totalArticles > 0 
    ? Math.round((1 - events.length / totalArticles) * 100)
    : 0;

  console.log(`[Dedup] ${totalArticles} → ${events.length} (${reductionPercent}% reduction)`);

  return {
    events,
    originalCount: totalArticles,
    dedupedCount: events.length,
    reductionPercent,
    duplicateGroups: groups.size,
  };
}
```

## Date Parsing Helper

```typescript
/**
 * Parse various date formats to Date object
 */
function parseDate(dateStr: string): Date {
  if (!dateStr || dateStr.length < 8) {
    return new Date();
  }
  
  // Handle YYYYMMDDTHHMMSSZ format
  if (dateStr.includes('T') && dateStr.length >= 15) {
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11) || '00';
    const min = dateStr.slice(11, 13) || '00';
    const sec = dateStr.slice(13, 15) || '00';
    
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
  }
  
  // Handle ISO format
  return new Date(dateStr);
}
```

## Usage Example

```typescript
// In your pipeline
async function processSources() {
  // Fetch from multiple sources
  const results = await Promise.all([
    fetchFromSourceA(),
    fetchFromSourceB(),
    fetchFromSourceC(),
  ]);
  
  // Deduplicate across all sources
  const { events, reductionPercent } = deduplicateArticles([
    { sourceName: 'source-a', articles: results[0] },
    { sourceName: 'source-b', articles: results[1] },
    { sourceName: 'source-c', articles: results[2] },
  ]);
  
  console.log(`Reduced ${reductionPercent}% duplicates`);
  
  // Continue processing with deduplicated events
  return events;
}
```

## Key Patterns

1. **Semantic Grouping** - Group by normalized content, not just URL
2. **Reputation Scoring** - Prefer authoritative sources as canonical
3. **Best Version Selection** - When IDs collide, keep version with most data
4. **Reduction Tracking** - Log how much deduplication helped
5. **Source Attribution** - Track which source the canonical came from

## Anti-Patterns to Avoid

- ❌ Simple URL deduplication (misses same story from different outlets)
- ❌ Random selection from duplicates (lose quality signal)
- ❌ No normalization (case/punctuation differences create false negatives)
- ❌ Not tracking reduction metrics (can't optimize)
- ❌ Hardcoded source lists (make configurable)
