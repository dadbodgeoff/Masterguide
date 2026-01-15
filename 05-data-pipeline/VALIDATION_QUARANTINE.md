# Data Validation & Quarantine

> Validate incoming data with quality scoring and quarantine suspicious records without blocking the pipeline.

## The Problem

External data sources are unreliable:
- Schema violations crash your pipeline
- Low-quality data pollutes your database
- You can't manually review every record

## The Pattern

```
┌─────────────┐     ┌───────────────┐     ┌─────────────┐
│  Raw Data   │────▶│   Validator   │────▶│   Valid     │
└─────────────┘     └───────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Quarantine  │
                    └─────────────┘
```

## Implementation

### Validator with Quality Scoring

```typescript
import { z, ZodError } from 'zod';

interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: { path: string; message: string; code: string }[];
  qualityScore: number;
  warnings: string[];
}

interface BatchResult<T> {
  valid: T[];
  invalid: { original: unknown; errors: any[] }[];
  quarantined: { original: unknown; score: number; warnings: string[] }[];
  metrics: {
    totalProcessed: number;
    validPercent: number;
    avgQualityScore: number;
    processingTimeMs: number;
  };
}

class DataValidator<T> {
  constructor(
    private schema: z.ZodSchema<T>,
    private qualityScorer: (data: T) => { score: number; warnings: string[] },
    private quarantineThreshold = 50
  ) {}

  validate(raw: unknown): ValidationResult<T> {
    try {
      const parsed = this.schema.parse(raw);
      const { score, warnings } = this.qualityScorer(parsed);
      return { success: true, data: parsed, qualityScore: score, warnings };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          success: false,
          errors: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
          qualityScore: 0,
          warnings: [],
        };
      }
      throw error;
    }
  }

  validateBatch(items: unknown[]): BatchResult<T> {
    const start = Date.now();
    const valid: T[] = [];
    const invalid: any[] = [];
    const quarantined: any[] = [];
    let totalScore = 0;

    for (const item of items) {
      const result = this.validate(item);
      
      if (!result.success) {
        invalid.push({ original: item, errors: result.errors });
      } else if (result.qualityScore < this.quarantineThreshold) {
        quarantined.push({
          original: item,
          score: result.qualityScore,
          warnings: result.warnings,
        });
      } else {
        valid.push(result.data!);
        totalScore += result.qualityScore;
      }
    }

    return {
      valid,
      invalid,
      quarantined,
      metrics: {
        totalProcessed: items.length,
        validPercent: items.length > 0 ? (valid.length / items.length) * 100 : 0,
        avgQualityScore: valid.length > 0 ? totalScore / valid.length : 0,
        processingTimeMs: Date.now() - start,
      },
    };
  }
}
```

### Quality Scorer Example

```typescript
function scoreArticle(article: Article): { score: number; warnings: string[] } {
  let score = 100;
  const warnings: string[] = [];

  // Title checks
  if (article.title.length < 20) {
    score -= 10;
    warnings.push('Short title');
  }
  if (/\b(click|subscribe|newsletter)\b/i.test(article.title)) {
    score -= 15;
    warnings.push('Promotional language');
  }

  // Source checks
  const ugcPlatforms = ['blogspot', 'wordpress', 'medium'];
  if (ugcPlatforms.some(p => article.domain.includes(p))) {
    score -= 10;
    warnings.push('User-generated content platform');
  }

  // Freshness check
  const ageMs = Date.now() - new Date(article.publishedAt).getTime();
  if (ageMs > 365 * 24 * 60 * 60 * 1000) {
    score -= 20;
    warnings.push('Article over 1 year old');
  }

  return { score: Math.max(0, score), warnings };
}
```

### Quarantine Store

```typescript
type QuarantineReason = 
  | 'low_quality_score'
  | 'suspicious_content'
  | 'duplicate_detected'
  | 'source_blacklisted';

interface QuarantinedItem<T> {
  id: string;
  data: T;
  reason: QuarantineReason;
  qualityScore: number;
  warnings: string[];
  quarantinedAt: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

class QuarantineStore<T> {
  private items = new Map<string, QuarantinedItem<T>>();
  private maxItems = 10000;
  private autoRejectDays = 7;

  add(data: T, reason: QuarantineReason, score: number, warnings: string[]): string {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    this.items.set(id, {
      id,
      data,
      reason,
      qualityScore: score,
      warnings,
      quarantinedAt: new Date().toISOString(),
      reviewStatus: 'pending',
    });

    this.enforceLimit();
    return id;
  }

  approve(id: string): T | null {
    const item = this.items.get(id);
    if (!item || item.reviewStatus !== 'pending') return null;
    
    item.reviewStatus = 'approved';
    return item.data;
  }

  reject(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    
    item.reviewStatus = 'rejected';
    return true;
  }

  getPending(limit = 100): QuarantinedItem<T>[] {
    return Array.from(this.items.values())
      .filter(i => i.reviewStatus === 'pending')
      .slice(0, limit);
  }

  releaseApproved(): T[] {
    const approved: T[] = [];
    for (const [id, item] of this.items) {
      if (item.reviewStatus === 'approved') {
        approved.push(item.data);
        this.items.delete(id);
      }
    }
    return approved;
  }

  autoRejectStale(): number {
    const cutoff = Date.now() - this.autoRejectDays * 24 * 60 * 60 * 1000;
    let count = 0;
    
    for (const item of this.items.values()) {
      if (item.reviewStatus === 'pending' && 
          new Date(item.quarantinedAt).getTime() < cutoff) {
        item.reviewStatus = 'rejected';
        count++;
      }
    }
    return count;
  }

  private enforceLimit(): void {
    if (this.items.size <= this.maxItems) return;
    
    // Remove oldest rejected first
    const sorted = Array.from(this.items.entries())
      .sort((a, b) => {
        if (a[1].reviewStatus === 'rejected' && b[1].reviewStatus !== 'rejected') return -1;
        return new Date(a[1].quarantinedAt).getTime() - new Date(b[1].quarantinedAt).getTime();
      });

    while (sorted.length > this.maxItems) {
      const [id] = sorted.shift()!;
      this.items.delete(id);
    }
  }
}
```

## Usage

```typescript
// Define schema
const ArticleSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  domain: z.string(),
  publishedAt: z.string().datetime(),
  content: z.string().optional(),
});

type Article = z.infer<typeof ArticleSchema>;

// Create validator
const validator = new DataValidator(ArticleSchema, scoreArticle, 50);
const quarantine = new QuarantineStore<Article>();

// Process batch
const result = validator.validateBatch(rawArticles);

// Handle quarantined items
for (const q of result.quarantined) {
  quarantine.add(q.original as Article, 'low_quality_score', q.score, q.warnings);
}

// Use valid data
await saveToDatabase(result.valid);

console.log(`Processed: ${result.metrics.totalProcessed}`);
console.log(`Valid: ${result.valid.length} (${result.metrics.validPercent.toFixed(1)}%)`);
console.log(`Quarantined: ${result.quarantined.length}`);
```

## Key Points

1. Never block the pipeline for bad data
2. Quality scores are domain-specific - tune thresholds
3. Auto-reject stale quarantined items
4. Expose quarantine for manual review via admin UI

## Time Estimate: 4 hours
