# Scoring Engine Pattern

> Statistical scoring with z-scores, percentiles, freshness decay, and cross-category normalization.

## Overview

This pattern implements a scoring engine for ranking and comparing items across categories:
- Z-score and percentile calculations
- Category statistics with outlier removal
- Freshness decay algorithms
- Confidence scoring based on sample size
- Cross-category normalization

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Raw Data   │────▶│   Stats     │────▶│   Scores    │
│  (Videos)   │     │  Builder    │     │  (0-100)    │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ├── Outlier Removal
                          ├── Percentile Calc
                          └── Caching
```

## Implementation

### Category Statistics

```python
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import statistics
import math


@dataclass
class CategoryStats:
    """
    Statistical summary for a category.
    
    Used as baseline for scoring items within the category.
    """
    category_key: str
    sample_count: int
    
    # View statistics
    view_mean: float
    view_std: float
    view_median: float
    view_p25: float
    view_p50: float
    view_p75: float
    view_p90: float
    view_min: float
    view_max: float
    
    # Engagement statistics
    like_mean: float = 0
    like_std: float = 0
    comment_mean: float = 0
    comment_std: float = 0
    
    # Category metadata
    avg_stream_count: float = 0
    avg_total_viewers: float = 0
    
    # Processing metadata
    outliers_removed: int = 0
    computed_at: Optional[str] = None
    
    @classmethod
    def from_videos(
        cls,
        category_key: str,
        videos: List[Dict],
        remove_outliers: bool = True,
    ) -> "CategoryStats":
        """
        Build statistics from a list of videos.
        
        Args:
            category_key: Category identifier
            videos: List of video dicts with view_count, like_count, etc.
            remove_outliers: Whether to remove statistical outliers
            
        Returns:
            CategoryStats instance
        """
        if not videos:
            return cls._empty(category_key)
        
        # Extract view counts
        views = [v.get("view_count", 0) for v in videos if v.get("view_count", 0) > 0]
        
        if not views:
            return cls._empty(category_key)
        
        outliers_removed = 0
        
        # Remove outliers using IQR method
        if remove_outliers and len(views) > 10:
            views, outliers_removed = cls._remove_outliers(views)
        
        # Calculate statistics
        view_mean = statistics.mean(views)
        view_std = statistics.stdev(views) if len(views) > 1 else 0
        
        sorted_views = sorted(views)
        n = len(sorted_views)
        
        return cls(
            category_key=category_key,
            sample_count=len(views),
            view_mean=view_mean,
            view_std=view_std,
            view_median=statistics.median(views),
            view_p25=sorted_views[int(n * 0.25)],
            view_p50=sorted_views[int(n * 0.50)],
            view_p75=sorted_views[int(n * 0.75)],
            view_p90=sorted_views[int(n * 0.90)],
            view_min=min(views),
            view_max=max(views),
            outliers_removed=outliers_removed,
        )
    
    @staticmethod
    def _remove_outliers(values: List[float]) -> tuple[List[float], int]:
        """Remove outliers using IQR method."""
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        
        q1 = sorted_vals[int(n * 0.25)]
        q3 = sorted_vals[int(n * 0.75)]
        iqr = q3 - q1
        
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        filtered = [v for v in values if lower_bound <= v <= upper_bound]
        removed = len(values) - len(filtered)
        
        return filtered, removed
    
    @classmethod
    def _empty(cls, category_key: str) -> "CategoryStats":
        """Create empty stats for category with no data."""
        return cls(
            category_key=category_key,
            sample_count=0,
            view_mean=0,
            view_std=1,  # Avoid division by zero
            view_median=0,
            view_p25=0,
            view_p50=0,
            view_p75=0,
            view_p90=0,
            view_min=0,
            view_max=0,
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict for caching."""
        return {
            "category_key": self.category_key,
            "sample_count": self.sample_count,
            "view_mean": self.view_mean,
            "view_std": self.view_std,
            "view_median": self.view_median,
            "view_p25": self.view_p25,
            "view_p50": self.view_p50,
            "view_p75": self.view_p75,
            "view_p90": self.view_p90,
            "view_min": self.view_min,
            "view_max": self.view_max,
            "outliers_removed": self.outliers_removed,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CategoryStats":
        """Deserialize from dict."""
        return cls(**data)
```

### Scoring Functions

```python
from dataclasses import dataclass
from typing import Optional
import math


@dataclass
class PercentileThresholds:
    """Percentile thresholds for scoring."""
    p25: float
    p50: float
    p75: float
    p90: float


def calculate_z_score(value: float, mean: float, std: float) -> float:
    """
    Calculate z-score (standard deviations from mean).
    
    Args:
        value: The value to score
        mean: Population mean
        std: Population standard deviation
        
    Returns:
        Z-score (can be negative)
    """
    if std == 0:
        return 0.0
    return (value - mean) / std


def calculate_percentile_score(
    value: float,
    thresholds: PercentileThresholds,
) -> float:
    """
    Calculate percentile-based score (0-100).
    
    Maps value to a 0-100 score based on percentile thresholds.
    
    Args:
        value: The value to score
        thresholds: Percentile thresholds from category stats
        
    Returns:
        Score from 0-100
    """
    if value <= 0:
        return 0.0
    
    if value <= thresholds.p25:
        # 0-25 range
        return 25 * (value / thresholds.p25) if thresholds.p25 > 0 else 0
    
    elif value <= thresholds.p50:
        # 25-50 range
        range_size = thresholds.p50 - thresholds.p25
        if range_size > 0:
            return 25 + 25 * ((value - thresholds.p25) / range_size)
        return 25
    
    elif value <= thresholds.p75:
        # 50-75 range
        range_size = thresholds.p75 - thresholds.p50
        if range_size > 0:
            return 50 + 25 * ((value - thresholds.p50) / range_size)
        return 50
    
    elif value <= thresholds.p90:
        # 75-90 range
        range_size = thresholds.p90 - thresholds.p75
        if range_size > 0:
            return 75 + 15 * ((value - thresholds.p75) / range_size)
        return 75
    
    else:
        # 90-100 range (above p90)
        # Use logarithmic scaling for extreme values
        excess = value - thresholds.p90
        max_excess = thresholds.p90 * 2  # Cap at 2x p90
        if excess > max_excess:
            return 100.0
        return 90 + 10 * (excess / max_excess)


def calculate_percentile(value: float, sorted_values: List[float]) -> float:
    """
    Calculate exact percentile of value in distribution.
    
    Args:
        value: The value to find percentile for
        sorted_values: Sorted list of all values
        
    Returns:
        Percentile (0-100)
    """
    if not sorted_values:
        return 50.0
    
    n = len(sorted_values)
    count_below = sum(1 for v in sorted_values if v < value)
    
    return (count_below / n) * 100
```


### Decay Functions

```python
import math


def freshness_decay(hours_old: float, half_life: float = 24.0) -> float:
    """
    Calculate freshness decay factor using exponential decay.
    
    Args:
        hours_old: Age in hours
        half_life: Hours until value is halved (default 24)
        
    Returns:
        Decay factor (0-1), where 1 is fresh and 0 is stale
    """
    if hours_old <= 0:
        return 1.0
    
    # Exponential decay: factor = 0.5^(age/half_life)
    return math.pow(0.5, hours_old / half_life)


def recency_boost(hours_old: float, boost_window: float = 6.0) -> float:
    """
    Calculate recency boost for very fresh content.
    
    Provides extra boost for content within the boost window.
    
    Args:
        hours_old: Age in hours
        boost_window: Hours within which boost applies
        
    Returns:
        Boost factor (1.0-1.5)
    """
    if hours_old >= boost_window:
        return 1.0
    
    # Linear boost from 1.5 at 0 hours to 1.0 at boost_window
    return 1.5 - (0.5 * hours_old / boost_window)


def velocity_from_age(
    current_value: float,
    hours_old: float,
    min_hours: float = 1.0,
) -> float:
    """
    Calculate velocity (rate of accumulation).
    
    Args:
        current_value: Current accumulated value (views, likes)
        hours_old: Age in hours
        min_hours: Minimum hours to avoid division issues
        
    Returns:
        Velocity (value per hour)
    """
    effective_hours = max(hours_old, min_hours)
    return current_value / effective_hours
```

### Confidence Scoring

```python
def calculate_confidence(
    sample_size: int,
    score_variance: float = 0.0,
    data_freshness_hours: float = 0.0,
) -> int:
    """
    Calculate confidence score (0-100) for a scoring result.
    
    Higher confidence when:
    - Larger sample size
    - Lower score variance
    - Fresher data
    
    Args:
        sample_size: Number of samples used
        score_variance: Variance in component scores
        data_freshness_hours: Age of underlying data
        
    Returns:
        Confidence score (0-100)
    """
    # Base confidence from sample size (logarithmic)
    if sample_size <= 0:
        return 0
    
    # 10 samples = 50%, 100 samples = 75%, 1000 samples = 100%
    sample_confidence = min(100, 25 * math.log10(sample_size + 1))
    
    # Reduce for high variance
    variance_penalty = min(30, score_variance * 10)
    
    # Reduce for stale data
    freshness_penalty = min(20, data_freshness_hours / 12)
    
    confidence = sample_confidence - variance_penalty - freshness_penalty
    
    return max(0, min(100, int(confidence)))


def calculate_score_variance(scores: Dict[str, float]) -> float:
    """
    Calculate variance across component scores.
    
    High variance indicates inconsistent signals.
    
    Args:
        scores: Dict of component name to score
        
    Returns:
        Variance (0-1 scale)
    """
    if not scores or len(scores) < 2:
        return 0.0
    
    values = list(scores.values())
    mean = sum(values) / len(values)
    
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    
    # Normalize to 0-1 scale (assuming scores are 0-100)
    return min(1.0, variance / 2500)
```

### Score Combination

```python
from typing import Dict, Tuple, Optional


def combine_scores(
    scores: Dict[str, float],
    weights: Dict[str, float],
    confidence_factors: Optional[Dict[str, float]] = None,
) -> Tuple[float, int]:
    """
    Combine multiple scores with weights and confidence.
    
    Args:
        scores: Dict of component name to score (0-100)
        weights: Dict of component name to weight
        confidence_factors: Optional per-component confidence (0-1)
        
    Returns:
        Tuple of (combined score, confidence)
    """
    if not scores:
        return 0.0, 0
    
    total_weight = 0.0
    weighted_sum = 0.0
    
    for name, score in scores.items():
        weight = weights.get(name, 1.0)
        
        # Apply confidence factor if provided
        if confidence_factors and name in confidence_factors:
            weight *= confidence_factors[name]
        
        weighted_sum += score * weight
        total_weight += weight
    
    if total_weight == 0:
        return 0.0, 0
    
    combined = weighted_sum / total_weight
    
    # Calculate overall confidence
    variance = calculate_score_variance(scores)
    confidence = calculate_confidence(
        sample_size=len(scores) * 10,  # Proxy for sample size
        score_variance=variance,
    )
    
    return combined, confidence


def weighted_harmonic_mean(
    scores: Dict[str, float],
    weights: Dict[str, float],
) -> float:
    """
    Calculate weighted harmonic mean of scores.
    
    Harmonic mean penalizes low scores more than arithmetic mean,
    useful when all components should be reasonably high.
    
    Args:
        scores: Dict of component name to score (0-100)
        weights: Dict of component name to weight
        
    Returns:
        Weighted harmonic mean
    """
    if not scores:
        return 0.0
    
    total_weight = 0.0
    weighted_reciprocal_sum = 0.0
    
    for name, score in scores.items():
        if score <= 0:
            return 0.0  # Any zero score makes harmonic mean zero
        
        weight = weights.get(name, 1.0)
        weighted_reciprocal_sum += weight / score
        total_weight += weight
    
    if weighted_reciprocal_sum == 0:
        return 0.0
    
    return total_weight / weighted_reciprocal_sum


def normalize_across_categories(
    category_scores: Dict[str, float],
    category_stats: Dict[str, CategoryStats],
) -> Dict[str, float]:
    """
    Normalize scores across categories with different difficulty.
    
    Adjusts scores based on category competition level.
    
    Args:
        category_scores: Dict of category to raw score
        category_stats: Dict of category to stats
        
    Returns:
        Dict of category to normalized score
    """
    normalized = {}
    
    for category, score in category_scores.items():
        stats = category_stats.get(category)
        
        if not stats or stats.sample_count == 0:
            normalized[category] = score
            continue
        
        # Calculate difficulty factor based on competition
        difficulty = calculate_category_difficulty(
            view_mean=stats.view_mean,
            avg_stream_count=stats.avg_stream_count,
            avg_total_viewers=stats.avg_total_viewers,
        )
        
        # Boost scores in harder categories
        normalized[category] = score * (1 + difficulty * 0.2)
    
    return normalized


def calculate_category_difficulty(
    view_mean: float,
    avg_stream_count: float = 0,
    avg_total_viewers: float = 0,
) -> float:
    """
    Calculate category difficulty (0-1).
    
    Higher difficulty for categories with:
    - Higher average views (more competition)
    - More active streamers
    - More total viewers
    
    Args:
        view_mean: Average views in category
        avg_stream_count: Average number of streams
        avg_total_viewers: Average total viewers
        
    Returns:
        Difficulty factor (0-1)
    """
    # Normalize each factor to 0-1 scale
    view_factor = min(1.0, view_mean / 1_000_000)  # 1M views = max
    stream_factor = min(1.0, avg_stream_count / 1000)  # 1000 streams = max
    viewer_factor = min(1.0, avg_total_viewers / 100_000)  # 100K viewers = max
    
    # Weighted combination
    return (view_factor * 0.5 + stream_factor * 0.3 + viewer_factor * 0.2)
```

### Scoring Engine

```python
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple
import redis.asyncio as redis

logger = logging.getLogger(__name__)


class ScoringEngine:
    """
    Enterprise-grade scoring engine with Redis caching.
    
    Provides centralized access to all scoring functions.
    """
    
    CACHE_TTL = 72 * 60 * 60  # 72 hours
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self._stats_cache: Dict[str, Tuple[CategoryStats, datetime]] = {}
        self._cache_ttl = timedelta(hours=1)
    
    async def build_category_stats(
        self,
        category_key: str,
        force_refresh: bool = False,
    ) -> Optional[CategoryStats]:
        """
        Build statistics from cached data.
        
        Args:
            category_key: Category identifier
            force_refresh: Bypass cache
            
        Returns:
            CategoryStats or None if no data
        """
        # Check in-memory cache
        if not force_refresh and category_key in self._stats_cache:
            cached_stats, cached_at = self._stats_cache[category_key]
            if datetime.now(timezone.utc) - cached_at < self._cache_ttl:
                return cached_stats
        
        # Check Redis cache
        if not force_refresh:
            stats_key = f"scoring:stats:{category_key}"
            cached_json = await self.redis.get(stats_key)
            if cached_json:
                try:
                    stats = CategoryStats.from_dict(json.loads(cached_json))
                    self._stats_cache[category_key] = (stats, datetime.now(timezone.utc))
                    return stats
                except Exception as e:
                    logger.warning(f"Failed to parse cached stats: {e}")
        
        # Fetch raw data
        data_key = f"data:{category_key}"
        raw_data = await self.redis.get(data_key)
        
        if not raw_data:
            return None
        
        try:
            data = json.loads(raw_data)
            videos = data.get("videos", [])
        except json.JSONDecodeError:
            return None
        
        if not videos:
            return None
        
        # Build stats
        stats = CategoryStats.from_videos(category_key, videos, remove_outliers=True)
        
        # Cache in Redis
        stats_key = f"scoring:stats:{category_key}"
        await self.redis.setex(
            stats_key,
            self.CACHE_TTL,
            json.dumps(stats.to_dict()),
        )
        
        # Cache in memory
        self._stats_cache[category_key] = (stats, datetime.now(timezone.utc))
        
        return stats
    
    def score_item(
        self,
        views: int,
        likes: int,
        comments: int,
        hours_old: float,
        stats: CategoryStats,
    ) -> Tuple[float, int]:
        """
        Score an item against category statistics.
        
        Returns:
            Tuple of (score 0-100, confidence 0-100)
        """
        # Calculate component scores
        thresholds = PercentileThresholds(
            p25=stats.view_p25,
            p50=stats.view_p50,
            p75=stats.view_p75,
            p90=stats.view_p90,
        )
        
        view_score = calculate_percentile_score(views, thresholds)
        
        # Apply freshness
        freshness = freshness_decay(hours_old)
        recency = recency_boost(hours_old)
        
        # Calculate velocity score
        velocity = velocity_from_age(views, hours_old)
        velocity_score = calculate_percentile_score(
            velocity,
            PercentileThresholds(
                p25=stats.view_p25 / 24,
                p50=stats.view_p50 / 24,
                p75=stats.view_p75 / 24,
                p90=stats.view_p90 / 24,
            ),
        )
        
        # Combine scores
        scores = {
            "views": view_score,
            "velocity": velocity_score,
        }
        weights = {
            "views": 0.6,
            "velocity": 0.4,
        }
        
        combined, confidence = combine_scores(scores, weights)
        
        # Apply freshness and recency
        final_score = combined * freshness * recency
        
        return min(100, final_score), confidence


# Singleton
_scoring_engine: Optional[ScoringEngine] = None


def get_scoring_engine() -> ScoringEngine:
    global _scoring_engine
    if _scoring_engine is None:
        from app.redis import get_redis_client
        _scoring_engine = ScoringEngine(get_redis_client())
    return _scoring_engine
```

## Best Practices

1. **Remove outliers** - Extreme values skew statistics
2. **Use percentiles** - More robust than mean/std for skewed data
3. **Apply freshness decay** - Older content should score lower
4. **Calculate confidence** - Indicate reliability of scores
5. **Cache statistics** - Expensive to compute, stable over time
6. **Normalize across categories** - Fair comparison between categories
7. **Use harmonic mean** - When all components must be good
