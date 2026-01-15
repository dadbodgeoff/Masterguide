# AI Generation Provenance & Audit Trail Pattern

> **Time to implement:** 6-8 hours  
> **Complexity:** High  
> **Prerequisites:** Database, Redis (optional)

## The Problem

AI-generated content lacks transparency:
- "Why did the AI suggest this?" - No explanation
- "What data was used?" - Unknown inputs
- "How confident is this?" - No scoring
- "How much did this cost?" - No tracking
- Regulatory compliance requires audit trails

## The Solution

Complete provenance tracking with:
1. Decision factors (why)
2. Data lineage (from what)
3. Reasoning chain (how)
4. Confidence scoring
5. Cost tracking

## Architecture

```
AI Request → Capture Context → Track Sources → Record Factors
                                    ↓
                            Build Reasoning Chain
                                    ↓
                            Store Provenance Record
                                    ↓
                            Query & Audit
```

## Core Implementation

### Types

```typescript
// lib/provenance/types.ts
export enum InsightType {
  // Content insights
  CONTENT_SUGGESTION = 'content_suggestion',
  TITLE_OPTIMIZATION = 'title_optimization',
  TREND_DETECTION = 'trend_detection',
  
  // Generation insights
  IMAGE_GENERATION = 'image_generation',
  TEXT_GENERATION = 'text_generation',
  SUMMARY_GENERATION = 'summary_generation',
}

export enum ConfidenceLevel {
  VERY_HIGH = 'very_high',  // 90-100%
  HIGH = 'high',            // 75-89%
  MEDIUM = 'medium',        // 50-74%
  LOW = 'low',              // 25-49%
  VERY_LOW = 'very_low',    // 0-24%
}

export interface DataSource {
  sourceType: string;       // 'database', 'api', 'cache', 'user_input'
  sourceKey: string;        // 'postgres:users', 'openai:gpt-4'
  recordsUsed: number;
  freshnessSeconds: number; // Age of data
  qualityScore: number;     // 0-1
  sampleIds: string[];      // For audit
}

export interface DecisionFactor {
  factorName: string;       // 'engagement_rate', 'trend_score'
  rawValue: number;
  normalizedValue: number;  // 0-1
  weight: number;           // 0-1
  contribution: number;     // normalizedValue * weight
  reasoning: string;        // Human-readable explanation
}

export interface ReasoningStep {
  stepNumber: number;
  operation: string;        // 'filter', 'score', 'rank', 'generate'
  description: string;
  inputCount: number;
  outputCount: number;
  algorithm: string;        // 'weighted_average', 'gpt-4', etc.
  parameters: Record<string, unknown>;
  durationMs: number;
}

export interface GenerationMetrics {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface ProvenanceRecord {
  provenanceId: string;
  
  // Identity
  workerId: string;
  executionId: string;
  userId: string;
  
  // Context
  insightType: InsightType;
  categoryKey: string;
  
  // Timing
  computedAt: Date;
  durationMs: number;
  
  // Insight
  insightId: string;
  insightSummary: string;
  insightValue: Record<string, unknown>;
  
  // Confidence
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  qualityScore: number;
  
  // Data lineage
  dataSources: DataSource[];
  totalRecordsAnalyzed: number;
  dataFreshnessAvgSeconds: number;
  
  // Decision factors
  decisionFactors: DecisionFactor[];
  primaryFactor: string;
  
  // Reasoning
  reasoningChain: ReasoningStep[];
  algorithmVersion: string;
  
  // Generation metrics (if applicable)
  generationMetrics?: GenerationMetrics;
  
  // Validation
  validationPassed: boolean;
  validationErrors: string[];
  
  // Tags
  tags: string[];
}
```

### Confidence Level Helper

```typescript
// lib/provenance/confidence.ts
export function getConfidenceLevel(score: number): ConfidenceLevel {
  // Normalize to 0-100 if provided as 0-1
  const normalized = score <= 1 ? score * 100 : score;

  if (normalized >= 90) return ConfidenceLevel.VERY_HIGH;
  if (normalized >= 75) return ConfidenceLevel.HIGH;
  if (normalized >= 50) return ConfidenceLevel.MEDIUM;
  if (normalized >= 25) return ConfidenceLevel.LOW;
  return ConfidenceLevel.VERY_LOW;
}

export function getConfidenceRecommendation(level: ConfidenceLevel): string {
  const recommendations: Record<ConfidenceLevel, string> = {
    [ConfidenceLevel.VERY_HIGH]: 'Highly recommended - strong signal',
    [ConfidenceLevel.HIGH]: 'Recommended - good confidence',
    [ConfidenceLevel.MEDIUM]: 'Consider - moderate confidence',
    [ConfidenceLevel.LOW]: 'Use caution - low confidence',
    [ConfidenceLevel.VERY_LOW]: 'Not recommended - very uncertain',
  };
  return recommendations[level];
}
```

### Provenance Builder

```typescript
// lib/provenance/builder.ts
import { v4 as uuid } from 'uuid';

export class ProvenanceBuilder {
  private record: Partial<ProvenanceRecord>;
  private startTime: number;
  private stepCounter = 0;

  constructor(insightType: InsightType, workerId: string) {
    this.startTime = Date.now();
    this.record = {
      provenanceId: uuid(),
      workerId,
      executionId: uuid(),
      insightType,
      computedAt: new Date(),
      dataSources: [],
      decisionFactors: [],
      reasoningChain: [],
      tags: [],
      validationPassed: true,
      validationErrors: [],
      algorithmVersion: '1.0.0',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEXT
  // ═══════════════════════════════════════════════════════════════

  setUser(userId: string): this {
    this.record.userId = userId;
    return this;
  }

  setCategory(categoryKey: string): this {
    this.record.categoryKey = categoryKey;
    return this;
  }

  addTag(tag: string): this {
    this.record.tags!.push(tag);
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA SOURCES
  // ═══════════════════════════════════════════════════════════════

  addDataSource(source: DataSource): this {
    this.record.dataSources!.push(source);
    return this;
  }

  addDatabaseSource(
    table: string,
    recordsUsed: number,
    freshnessSeconds: number,
    sampleIds: string[] = []
  ): this {
    return this.addDataSource({
      sourceType: 'database',
      sourceKey: `postgres:${table}`,
      recordsUsed,
      freshnessSeconds,
      qualityScore: 0.95,
      sampleIds: sampleIds.slice(0, 5),
    });
  }

  addApiSource(
    provider: string,
    model: string,
    freshnessSeconds = 0
  ): this {
    return this.addDataSource({
      sourceType: 'api',
      sourceKey: `${provider}:${model}`,
      recordsUsed: 1,
      freshnessSeconds,
      qualityScore: 0.9,
      sampleIds: [],
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DECISION FACTORS
  // ═══════════════════════════════════════════════════════════════

  addDecisionFactor(factor: Omit<DecisionFactor, 'contribution'>): this {
    const contribution = factor.normalizedValue * factor.weight;
    this.record.decisionFactors!.push({ ...factor, contribution });
    return this;
  }

  addFactor(
    name: string,
    rawValue: number,
    normalizedValue: number,
    weight: number,
    reasoning: string
  ): this {
    return this.addDecisionFactor({
      factorName: name,
      rawValue,
      normalizedValue,
      weight,
      reasoning,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // REASONING CHAIN
  // ═══════════════════════════════════════════════════════════════

  addReasoningStep(
    operation: string,
    description: string,
    inputCount: number,
    outputCount: number,
    algorithm: string,
    parameters: Record<string, unknown> = {},
    durationMs = 0
  ): this {
    this.stepCounter++;
    this.record.reasoningChain!.push({
      stepNumber: this.stepCounter,
      operation,
      description,
      inputCount,
      outputCount,
      algorithm,
      parameters,
      durationMs,
    });
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERATION METRICS
  // ═══════════════════════════════════════════════════════════════

  setGenerationMetrics(metrics: GenerationMetrics): this {
    this.record.generationMetrics = metrics;
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // INSIGHT
  // ═══════════════════════════════════════════════════════════════

  setInsight(
    insightId: string,
    summary: string,
    value: Record<string, unknown>
  ): this {
    this.record.insightId = insightId;
    this.record.insightSummary = summary;
    this.record.insightValue = value;
    return this;
  }

  setConfidence(score: number, qualityScore = 0.8): this {
    this.record.confidenceScore = score;
    this.record.confidenceLevel = getConfidenceLevel(score);
    this.record.qualityScore = qualityScore;
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════

  addValidationError(error: string): this {
    this.record.validationPassed = false;
    this.record.validationErrors!.push(error);
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════

  build(): ProvenanceRecord {
    // Calculate duration
    this.record.durationMs = Date.now() - this.startTime;

    // Calculate totals
    this.record.totalRecordsAnalyzed = this.record.dataSources!
      .reduce((sum, ds) => sum + ds.recordsUsed, 0);

    this.record.dataFreshnessAvgSeconds = this.record.dataSources!.length
      ? this.record.dataSources!.reduce((sum, ds) => sum + ds.freshnessSeconds, 0) 
        / this.record.dataSources!.length
      : 0;

    // Determine primary factor
    const factors = this.record.decisionFactors!;
    if (factors.length) {
      const primary = factors.reduce((max, f) => 
        f.contribution > max.contribution ? f : max
      );
      this.record.primaryFactor = primary.factorName;
    }

    // Auto-tag based on confidence
    if (this.record.confidenceScore! >= 0.9) {
      this.record.tags!.push('high_confidence');
    }

    return this.record as ProvenanceRecord;
  }
}
```

### Provenance Store

```typescript
// lib/provenance/store.ts
export class ProvenanceStore {
  constructor(private db: Database) {}

  async save(record: ProvenanceRecord): Promise<void> {
    await this.db.provenanceRecords.insert({
      ...record,
      dataSources: JSON.stringify(record.dataSources),
      decisionFactors: JSON.stringify(record.decisionFactors),
      reasoningChain: JSON.stringify(record.reasoningChain),
      insightValue: JSON.stringify(record.insightValue),
      generationMetrics: record.generationMetrics 
        ? JSON.stringify(record.generationMetrics) 
        : null,
      tags: JSON.stringify(record.tags),
      validationErrors: JSON.stringify(record.validationErrors),
    });
  }

  async getById(provenanceId: string): Promise<ProvenanceRecord | null> {
    const row = await this.db.provenanceRecords.findById(provenanceId);
    if (!row) return null;
    return this.deserialize(row);
  }

  async getByInsightId(insightId: string): Promise<ProvenanceRecord | null> {
    const row = await this.db.provenanceRecords.findByInsightId(insightId);
    if (!row) return null;
    return this.deserialize(row);
  }

  async query(filters: {
    userId?: string;
    insightType?: InsightType;
    confidenceLevel?: ConfidenceLevel;
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<ProvenanceRecord[]> {
    const rows = await this.db.provenanceRecords.query(filters);
    return rows.map(row => this.deserialize(row));
  }

  async getStats(userId: string, days = 30): Promise<{
    totalInsights: number;
    byType: Record<string, number>;
    byConfidence: Record<string, number>;
    avgConfidence: number;
    totalCostUsd: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const records = await this.query({ userId, startDate });

    const byType: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    let totalConfidence = 0;
    let totalCost = 0;

    for (const record of records) {
      byType[record.insightType] = (byType[record.insightType] || 0) + 1;
      byConfidence[record.confidenceLevel] = (byConfidence[record.confidenceLevel] || 0) + 1;
      totalConfidence += record.confidenceScore;
      totalCost += record.generationMetrics?.estimatedCostUsd || 0;
    }

    return {
      totalInsights: records.length,
      byType,
      byConfidence,
      avgConfidence: records.length ? totalConfidence / records.length : 0,
      totalCostUsd: totalCost,
    };
  }

  private deserialize(row: Record<string, unknown>): ProvenanceRecord {
    return {
      ...row,
      dataSources: JSON.parse(row.dataSources as string),
      decisionFactors: JSON.parse(row.decisionFactors as string),
      reasoningChain: JSON.parse(row.reasoningChain as string),
      insightValue: JSON.parse(row.insightValue as string),
      generationMetrics: row.generationMetrics 
        ? JSON.parse(row.generationMetrics as string) 
        : undefined,
      tags: JSON.parse(row.tags as string),
      validationErrors: JSON.parse(row.validationErrors as string),
      computedAt: new Date(row.computedAt as string),
    } as ProvenanceRecord;
  }
}
```

## Usage Example

```typescript
// services/content-suggestion.ts
async function generateContentSuggestion(
  userId: string,
  topic: string
): Promise<{ suggestion: string; provenanceId: string }> {
  const provenance = new ProvenanceBuilder(
    InsightType.CONTENT_SUGGESTION,
    'content-worker'
  )
    .setUser(userId)
    .setCategory(`topic:${topic}`);

  // Step 1: Fetch trending data
  const trendingData = await fetchTrending(topic);
  provenance
    .addDatabaseSource('trending_topics', trendingData.length, 300)
    .addReasoningStep(
      'filter',
      `Fetched ${trendingData.length} trending items for topic "${topic}"`,
      0,
      trendingData.length,
      'sql_query',
      { topic, limit: 100 }
    );

  // Step 2: Score items
  const scored = scoreItems(trendingData);
  provenance
    .addFactor(
      'trend_velocity',
      scored.avgVelocity,
      scored.normalizedVelocity,
      0.4,
      `Trend velocity of ${scored.avgVelocity}/hr indicates ${scored.normalizedVelocity > 0.7 ? 'high' : 'moderate'} interest`
    )
    .addFactor(
      'engagement_rate',
      scored.avgEngagement,
      scored.normalizedEngagement,
      0.3,
      `Engagement rate of ${(scored.avgEngagement * 100).toFixed(1)}% is ${scored.normalizedEngagement > 0.6 ? 'above' : 'below'} average`
    )
    .addReasoningStep(
      'score',
      'Calculated weighted scores for each item',
      trendingData.length,
      trendingData.length,
      'weighted_average',
      { weights: { velocity: 0.4, engagement: 0.3, recency: 0.3 } }
    );

  // Step 3: Generate suggestion with AI
  const startGen = Date.now();
  const aiResult = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `Suggest content for: ${topic}` }],
  });
  const genDuration = Date.now() - startGen;

  provenance
    .addApiSource('openai', 'gpt-4')
    .setGenerationMetrics({
      model: 'gpt-4',
      promptTokens: aiResult.usage?.prompt_tokens || 0,
      completionTokens: aiResult.usage?.completion_tokens || 0,
      totalTokens: aiResult.usage?.total_tokens || 0,
      latencyMs: genDuration,
      estimatedCostUsd: calculateCost(aiResult.usage),
    })
    .addReasoningStep(
      'generate',
      'Generated content suggestion using GPT-4',
      1,
      1,
      'gpt-4',
      { temperature: 0.7 },
      genDuration
    );

  // Finalize
  const suggestion = aiResult.choices[0].message.content!;
  const insightId = uuid();

  provenance
    .setInsight(insightId, `Content suggestion for "${topic}"`, { suggestion })
    .setConfidence(0.85)
    .addTag('ai_generated');

  const record = provenance.build();
  await provenanceStore.save(record);

  return { suggestion, provenanceId: record.provenanceId };
}
```

## API Endpoints

```typescript
// app/api/provenance/[id]/route.ts
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const record = await provenanceStore.getById(params.id);
  
  if (!record) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(record);
}
```

```typescript
// app/api/provenance/stats/route.ts
export async function GET(req: Request) {
  const userId = req.headers.get('x-user-id')!;
  const stats = await provenanceStore.getStats(userId);
  return Response.json(stats);
}
```

## Database Schema

```sql
CREATE TABLE provenance_records (
  provenance_id UUID PRIMARY KEY,
  worker_id TEXT NOT NULL,
  execution_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  insight_type TEXT NOT NULL,
  category_key TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER NOT NULL,
  insight_id TEXT NOT NULL,
  insight_summary TEXT NOT NULL,
  insight_value JSONB NOT NULL,
  confidence_score DECIMAL(5,4) NOT NULL,
  confidence_level TEXT NOT NULL,
  quality_score DECIMAL(5,4) NOT NULL,
  data_sources JSONB NOT NULL,
  total_records_analyzed INTEGER NOT NULL,
  data_freshness_avg_seconds DECIMAL(10,2) NOT NULL,
  decision_factors JSONB NOT NULL,
  primary_factor TEXT,
  reasoning_chain JSONB NOT NULL,
  algorithm_version TEXT NOT NULL,
  generation_metrics JSONB,
  validation_passed BOOLEAN NOT NULL DEFAULT TRUE,
  validation_errors JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provenance_user ON provenance_records(user_id);
CREATE INDEX idx_provenance_insight ON provenance_records(insight_id);
CREATE INDEX idx_provenance_type ON provenance_records(insight_type);
CREATE INDEX idx_provenance_date ON provenance_records(computed_at);
```

## Checklist

- [ ] ProvenanceRecord type with all fields
- [ ] ConfidenceLevel enum and helpers
- [ ] ProvenanceBuilder with fluent API
- [ ] Data source tracking
- [ ] Decision factor capture
- [ ] Reasoning chain steps
- [ ] Generation metrics (tokens, cost)
- [ ] ProvenanceStore with query support
- [ ] Stats aggregation
- [ ] API endpoints for retrieval
- [ ] Database schema with indexes
- [ ] Auto-tagging based on confidence
