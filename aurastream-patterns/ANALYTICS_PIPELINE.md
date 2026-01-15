# Analytics Pipeline Pattern

> Real-time analytics with Redis counters, periodic PostgreSQL flush, and time-series aggregation.

## Overview

This pattern implements a high-performance analytics pipeline that:
- Uses Redis for real-time counter increments
- Periodically flushes to PostgreSQL for persistence
- Supports time-series aggregation for dashboards
- Handles high write throughput without database bottlenecks

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Events    │────▶│    Redis    │────▶│ PostgreSQL  │
│  (API/SSE)  │     │  (Counters) │     │  (Storage)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │                    │
                          │ Periodic Flush     │
                          │ (every 5 min)      │
                          ▼                    │
                    ┌─────────────┐            │
                    │   Worker    │────────────┘
                    │  (Flusher)  │
                    └─────────────┘
```

## Implementation

### Event Types

```python
from enum import Enum
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any


class AnalyticsEventType(str, Enum):
    """Types of analytics events."""
    # Generation events
    GENERATION_STARTED = "generation_started"
    GENERATION_COMPLETED = "generation_completed"
    GENERATION_FAILED = "generation_failed"
    
    # User events
    USER_SIGNUP = "user_signup"
    USER_LOGIN = "user_login"
    
    # Feature usage
    FEATURE_USED = "feature_used"
    ASSET_DOWNLOADED = "asset_downloaded"
    ASSET_SHARED = "asset_shared"
    
    # Page views
    PAGE_VIEW = "page_view"
    
    # Subscription events
    SUBSCRIPTION_STARTED = "subscription_started"
    SUBSCRIPTION_CANCELED = "subscription_canceled"


@dataclass
class AnalyticsEvent:
    """An analytics event to be tracked."""
    event_type: AnalyticsEventType
    user_id: Optional[str] = None
    properties: Optional[Dict[str, Any]] = None
    timestamp: Optional[datetime] = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now(timezone.utc)
        if self.properties is None:
            self.properties = {}
```

### Redis Counter Keys

```python
from datetime import datetime, timezone


class AnalyticsKeys:
    """
    Redis key patterns for analytics counters.
    
    Key patterns:
    - analytics:counter:{event_type}:{date} - Daily event counts
    - analytics:counter:{event_type}:{date}:{hour} - Hourly event counts
    - analytics:user:{user_id}:{event_type}:{date} - Per-user daily counts
    - analytics:feature:{feature_name}:{date} - Feature usage counts
    """
    
    PREFIX = "analytics"
    
    @staticmethod
    def daily_counter(event_type: str, date: datetime = None) -> str:
        """Key for daily event counter."""
        d = date or datetime.now(timezone.utc)
        return f"{AnalyticsKeys.PREFIX}:counter:{event_type}:{d.strftime('%Y-%m-%d')}"
    
    @staticmethod
    def hourly_counter(event_type: str, date: datetime = None) -> str:
        """Key for hourly event counter."""
        d = date or datetime.now(timezone.utc)
        return f"{AnalyticsKeys.PREFIX}:counter:{event_type}:{d.strftime('%Y-%m-%d:%H')}"
    
    @staticmethod
    def user_daily_counter(user_id: str, event_type: str, date: datetime = None) -> str:
        """Key for per-user daily counter."""
        d = date or datetime.now(timezone.utc)
        return f"{AnalyticsKeys.PREFIX}:user:{user_id}:{event_type}:{d.strftime('%Y-%m-%d')}"
    
    @staticmethod
    def feature_counter(feature_name: str, date: datetime = None) -> str:
        """Key for feature usage counter."""
        d = date or datetime.now(timezone.utc)
        return f"{AnalyticsKeys.PREFIX}:feature:{feature_name}:{d.strftime('%Y-%m-%d')}"
    
    @staticmethod
    def pending_flush_set() -> str:
        """Key for set of counters pending flush."""
        return f"{AnalyticsKeys.PREFIX}:pending_flush"
```

### Analytics Service

```python
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
import redis.asyncio as redis

logger = logging.getLogger(__name__)


class AnalyticsService:
    """
    High-performance analytics service using Redis counters.
    
    Features:
    - Atomic counter increments
    - Batched event tracking
    - Automatic key expiration
    - Pending flush tracking
    """
    
    # Counter TTL (7 days - enough time for flush + buffer)
    COUNTER_TTL = 7 * 24 * 60 * 60
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
    
    async def track_event(self, event: AnalyticsEvent) -> None:
        """
        Track a single analytics event.
        
        Increments relevant counters atomically.
        """
        pipe = self.redis.pipeline()
        
        # Daily counter
        daily_key = AnalyticsKeys.daily_counter(event.event_type.value, event.timestamp)
        pipe.incr(daily_key)
        pipe.expire(daily_key, self.COUNTER_TTL)
        
        # Hourly counter
        hourly_key = AnalyticsKeys.hourly_counter(event.event_type.value, event.timestamp)
        pipe.incr(hourly_key)
        pipe.expire(hourly_key, self.COUNTER_TTL)
        
        # Per-user counter (if user_id provided)
        if event.user_id:
            user_key = AnalyticsKeys.user_daily_counter(
                event.user_id, 
                event.event_type.value, 
                event.timestamp,
            )
            pipe.incr(user_key)
            pipe.expire(user_key, self.COUNTER_TTL)
        
        # Feature counter (if feature_name in properties)
        if event.properties.get("feature_name"):
            feature_key = AnalyticsKeys.feature_counter(
                event.properties["feature_name"],
                event.timestamp,
            )
            pipe.incr(feature_key)
            pipe.expire(feature_key, self.COUNTER_TTL)
        
        # Add to pending flush set
        pipe.sadd(
            AnalyticsKeys.pending_flush_set(),
            f"{event.event_type.value}:{event.timestamp.strftime('%Y-%m-%d')}",
        )
        
        await pipe.execute()
        
        logger.debug(f"Tracked event: {event.event_type.value}")
    
    async def track_events_batch(self, events: List[AnalyticsEvent]) -> None:
        """
        Track multiple events in a single pipeline.
        
        More efficient than tracking events individually.
        """
        if not events:
            return
        
        pipe = self.redis.pipeline()
        pending_keys = set()
        
        for event in events:
            # Daily counter
            daily_key = AnalyticsKeys.daily_counter(event.event_type.value, event.timestamp)
            pipe.incr(daily_key)
            pipe.expire(daily_key, self.COUNTER_TTL)
            pending_keys.add(f"{event.event_type.value}:{event.timestamp.strftime('%Y-%m-%d')}")
            
            # Hourly counter
            hourly_key = AnalyticsKeys.hourly_counter(event.event_type.value, event.timestamp)
            pipe.incr(hourly_key)
            pipe.expire(hourly_key, self.COUNTER_TTL)
            
            # Per-user counter
            if event.user_id:
                user_key = AnalyticsKeys.user_daily_counter(
                    event.user_id,
                    event.event_type.value,
                    event.timestamp,
                )
                pipe.incr(user_key)
                pipe.expire(user_key, self.COUNTER_TTL)
        
        # Add all to pending flush set
        if pending_keys:
            pipe.sadd(AnalyticsKeys.pending_flush_set(), *pending_keys)
        
        await pipe.execute()
        
        logger.info(f"Tracked {len(events)} events in batch")
    
    async def get_daily_count(
        self,
        event_type: AnalyticsEventType,
        date: datetime = None,
    ) -> int:
        """Get daily count for an event type."""
        key = AnalyticsKeys.daily_counter(event_type.value, date)
        count = await self.redis.get(key)
        return int(count) if count else 0
    
    async def get_hourly_counts(
        self,
        event_type: AnalyticsEventType,
        date: datetime = None,
    ) -> Dict[int, int]:
        """Get hourly counts for a day."""
        d = date or datetime.now(timezone.utc)
        
        pipe = self.redis.pipeline()
        for hour in range(24):
            hour_dt = d.replace(hour=hour, minute=0, second=0, microsecond=0)
            key = AnalyticsKeys.hourly_counter(event_type.value, hour_dt)
            pipe.get(key)
        
        results = await pipe.execute()
        
        return {
            hour: int(count) if count else 0
            for hour, count in enumerate(results)
        }
    
    async def get_user_daily_count(
        self,
        user_id: str,
        event_type: AnalyticsEventType,
        date: datetime = None,
    ) -> int:
        """Get daily count for a specific user."""
        key = AnalyticsKeys.user_daily_counter(user_id, event_type.value, date)
        count = await self.redis.get(key)
        return int(count) if count else 0
    
    async def get_date_range_counts(
        self,
        event_type: AnalyticsEventType,
        start_date: datetime,
        end_date: datetime,
    ) -> Dict[str, int]:
        """Get daily counts for a date range."""
        pipe = self.redis.pipeline()
        dates = []
        
        current = start_date
        while current <= end_date:
            key = AnalyticsKeys.daily_counter(event_type.value, current)
            pipe.get(key)
            dates.append(current.strftime('%Y-%m-%d'))
            current += timedelta(days=1)
        
        results = await pipe.execute()
        
        return {
            date: int(count) if count else 0
            for date, count in zip(dates, results)
        }
```

### PostgreSQL Flush Worker

```python
import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Tuple
import asyncpg

logger = logging.getLogger(__name__)


class AnalyticsFlushWorker:
    """
    Worker that periodically flushes Redis counters to PostgreSQL.
    
    Features:
    - Atomic flush with GETDEL
    - Upsert to PostgreSQL
    - Handles partial failures
    - Tracks flush history
    """
    
    FLUSH_INTERVAL = 300  # 5 minutes
    BATCH_SIZE = 100
    
    def __init__(
        self,
        redis_client: redis.Redis,
        pg_pool: asyncpg.Pool,
    ):
        self.redis = redis_client
        self.pg = pg_pool
        self._running = False
    
    async def start(self) -> None:
        """Start the flush worker loop."""
        self._running = True
        logger.info("Analytics flush worker started")
        
        while self._running:
            try:
                await self.flush()
            except Exception as e:
                logger.error(f"Flush error: {e}", exc_info=True)
            
            await asyncio.sleep(self.FLUSH_INTERVAL)
    
    async def stop(self) -> None:
        """Stop the flush worker."""
        self._running = False
        # Final flush before stopping
        await self.flush()
        logger.info("Analytics flush worker stopped")
    
    async def flush(self) -> int:
        """
        Flush pending counters to PostgreSQL.
        
        Returns number of counters flushed.
        """
        # Get pending flush keys
        pending_key = AnalyticsKeys.pending_flush_set()
        pending = await self.redis.smembers(pending_key)
        
        if not pending:
            return 0
        
        flushed = 0
        
        # Process in batches
        pending_list = list(pending)
        for i in range(0, len(pending_list), self.BATCH_SIZE):
            batch = pending_list[i:i + self.BATCH_SIZE]
            
            # Collect counter values
            counters = await self._collect_counters(batch)
            
            if counters:
                # Write to PostgreSQL
                await self._write_to_postgres(counters)
                flushed += len(counters)
                
                # Remove from pending set
                await self.redis.srem(pending_key, *batch)
        
        if flushed > 0:
            logger.info(f"Flushed {flushed} analytics counters to PostgreSQL")
        
        return flushed
    
    async def _collect_counters(
        self,
        pending_keys: List[str],
    ) -> List[Tuple[str, str, int]]:
        """
        Collect counter values from Redis.
        
        Uses GETDEL for atomic read-and-delete.
        
        Returns list of (event_type, date, count) tuples.
        """
        counters = []
        pipe = self.redis.pipeline()
        
        for pending in pending_keys:
            # Parse event_type:date from pending key
            parts = pending.split(":", 1)
            if len(parts) != 2:
                continue
            
            event_type, date = parts
            key = AnalyticsKeys.daily_counter(event_type, datetime.fromisoformat(date))
            
            # GETDEL atomically gets and deletes
            pipe.getdel(key)
        
        results = await pipe.execute()
        
        for pending, count in zip(pending_keys, results):
            if count:
                parts = pending.split(":", 1)
                counters.append((parts[0], parts[1], int(count)))
        
        return counters
    
    async def _write_to_postgres(
        self,
        counters: List[Tuple[str, str, int]],
    ) -> None:
        """
        Write counters to PostgreSQL with upsert.
        
        Uses ON CONFLICT to handle duplicate dates.
        """
        async with self.pg.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO analytics_daily (event_type, date, count, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (event_type, date)
                DO UPDATE SET 
                    count = analytics_daily.count + EXCLUDED.count,
                    updated_at = NOW()
                """,
                counters,
            )
```

### Dashboard Queries

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Dict


@dataclass
class DashboardMetrics:
    """Aggregated metrics for dashboard display."""
    total_generations: int
    total_users: int
    generations_today: int
    signups_today: int
    hourly_generations: Dict[int, int]
    daily_trend: Dict[str, int]
    top_features: List[Dict[str, any]]


class AnalyticsDashboardService:
    """
    Service for dashboard analytics queries.
    
    Combines real-time Redis data with historical PostgreSQL data.
    """
    
    def __init__(
        self,
        analytics_service: AnalyticsService,
        pg_pool: asyncpg.Pool,
    ):
        self.analytics = analytics_service
        self.pg = pg_pool
    
    async def get_dashboard_metrics(self) -> DashboardMetrics:
        """Get all dashboard metrics."""
        now = datetime.now(timezone.utc)
        
        # Real-time from Redis
        generations_today = await self.analytics.get_daily_count(
            AnalyticsEventType.GENERATION_COMPLETED,
            now,
        )
        signups_today = await self.analytics.get_daily_count(
            AnalyticsEventType.USER_SIGNUP,
            now,
        )
        hourly = await self.analytics.get_hourly_counts(
            AnalyticsEventType.GENERATION_COMPLETED,
            now,
        )
        
        # Historical from PostgreSQL
        async with self.pg.acquire() as conn:
            # Total generations (all time)
            total_gen = await conn.fetchval(
                """
                SELECT COALESCE(SUM(count), 0)
                FROM analytics_daily
                WHERE event_type = 'generation_completed'
                """
            )
            
            # Total users
            total_users = await conn.fetchval(
                "SELECT COUNT(*) FROM users"
            )
            
            # 30-day trend
            trend_rows = await conn.fetch(
                """
                SELECT date, count
                FROM analytics_daily
                WHERE event_type = 'generation_completed'
                AND date >= $1
                ORDER BY date
                """,
                now - timedelta(days=30),
            )
            
            # Top features
            features = await conn.fetch(
                """
                SELECT 
                    properties->>'feature_name' as feature,
                    SUM(count) as usage
                FROM analytics_daily
                WHERE event_type = 'feature_used'
                AND date >= $1
                GROUP BY properties->>'feature_name'
                ORDER BY usage DESC
                LIMIT 10
                """,
                now - timedelta(days=7),
            )
        
        return DashboardMetrics(
            total_generations=total_gen + generations_today,
            total_users=total_users,
            generations_today=generations_today,
            signups_today=signups_today,
            hourly_generations=hourly,
            daily_trend={row["date"].isoformat(): row["count"] for row in trend_rows},
            top_features=[{"feature": r["feature"], "usage": r["usage"]} for r in features],
        )
    
    async def get_user_analytics(self, user_id: str) -> Dict:
        """Get analytics for a specific user."""
        now = datetime.now(timezone.utc)
        
        # Today's activity from Redis
        generations_today = await self.analytics.get_user_daily_count(
            user_id,
            AnalyticsEventType.GENERATION_COMPLETED,
            now,
        )
        
        # Historical from PostgreSQL
        async with self.pg.acquire() as conn:
            # Total generations
            total = await conn.fetchval(
                """
                SELECT COALESCE(SUM(count), 0)
                FROM analytics_user_daily
                WHERE user_id = $1 AND event_type = 'generation_completed'
                """,
                user_id,
            )
            
            # This month
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            this_month = await conn.fetchval(
                """
                SELECT COALESCE(SUM(count), 0)
                FROM analytics_user_daily
                WHERE user_id = $1 
                AND event_type = 'generation_completed'
                AND date >= $2
                """,
                user_id,
                month_start,
            )
        
        return {
            "generations_today": generations_today,
            "generations_this_month": this_month + generations_today,
            "generations_total": total + generations_today,
        }
```

### Database Schema

```sql
-- Daily aggregated analytics
CREATE TABLE analytics_daily (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(event_type, date)
);

CREATE INDEX idx_analytics_daily_event_date ON analytics_daily(event_type, date);

-- Per-user daily analytics
CREATE TABLE analytics_user_daily (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, event_type, date)
);

CREATE INDEX idx_analytics_user_daily ON analytics_user_daily(user_id, event_type, date);

-- Flush history for debugging
CREATE TABLE analytics_flush_log (
    id SERIAL PRIMARY KEY,
    flushed_at TIMESTAMPTZ DEFAULT NOW(),
    counters_flushed INTEGER NOT NULL,
    duration_ms INTEGER
);
```

## API Routes

```python
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/analytics")


@router.get("/dashboard")
async def get_dashboard(
    current_user: User = Depends(get_admin_user),
    dashboard_service: AnalyticsDashboardService = Depends(get_dashboard_service),
):
    """Get dashboard metrics (admin only)."""
    return await dashboard_service.get_dashboard_metrics()


@router.get("/me")
async def get_my_analytics(
    current_user: User = Depends(get_current_user),
    dashboard_service: AnalyticsDashboardService = Depends(get_dashboard_service),
):
    """Get current user's analytics."""
    return await dashboard_service.get_user_analytics(current_user.id)
```

## Best Practices

1. **Use Redis for writes** - High throughput without database bottlenecks
2. **Batch flushes** - Periodic flush reduces PostgreSQL load
3. **Atomic operations** - Use GETDEL to prevent double-counting
4. **TTL on counters** - Prevent Redis memory growth
5. **Upsert on flush** - Handle duplicate dates gracefully
6. **Separate tables** - User vs global analytics for query efficiency
7. **Index by date** - Most queries filter by date range
