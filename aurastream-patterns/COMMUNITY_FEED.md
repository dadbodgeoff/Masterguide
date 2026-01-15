# Community Feed Pattern

> Social feed with batch queries, cursor pagination, trending algorithms, and engagement tracking.

## Overview

This pattern implements a community feed system with:
- Batch query optimization
- Cursor-based pagination
- Trending and following feeds
- Like/engagement tracking
- Efficient database queries

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Feed      │────▶│  Database   │
│  (Infinite  │     │  Service    │     │  (Posts,    │
│   Scroll)   │     │             │     │   Likes)    │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ├── Trending Algorithm
                          ├── Following Filter
                          └── Batch Loading
```

## Implementation

### Data Models

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any


@dataclass
class CommunityPost:
    """A post in the community feed."""
    id: str
    user_id: str
    asset_id: str
    title: str
    description: Optional[str]
    tags: List[str]
    show_prompt: bool
    like_count: int
    comment_count: int
    view_count: int
    is_featured: bool
    created_at: datetime
    updated_at: datetime
    
    # Joined data
    asset_url: Optional[str] = None
    asset_type: Optional[str] = None
    prompt: Optional[str] = None  # Only if show_prompt is True


@dataclass
class PostAuthor:
    """Author information for a post."""
    id: str
    display_name: str
    avatar_url: Optional[str]
    subscription_tier: str


@dataclass
class CommunityPostWithAuthor(CommunityPost):
    """Post with author information."""
    author: Optional[PostAuthor] = None
    is_liked_by_viewer: bool = False
    inspired_by_post_id: Optional[str] = None


@dataclass
class PaginatedPosts:
    """Paginated feed response."""
    posts: List[CommunityPostWithAuthor]
    total_count: int
    has_more: bool
    next_cursor: Optional[str]
```

### Feed Service

```python
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Tuple
import base64
import json

logger = logging.getLogger(__name__)


class CommunityFeedService:
    """
    Service for community feed operations.
    
    Features:
    - Cursor-based pagination
    - Multiple feed types (trending, recent, following)
    - Batch author loading
    - Engagement tracking
    """
    
    def __init__(self, db):
        self.db = db
        self.posts_table = "community_posts"
        self.likes_table = "post_likes"
        self.follows_table = "user_follows"
    
    async def get_feed(
        self,
        feed_type: str = "trending",
        viewer_id: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 20,
        asset_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> PaginatedPosts:
        """
        Get paginated community feed.
        
        Args:
            feed_type: "trending", "recent", or "following"
            viewer_id: Current user ID (for personalization)
            cursor: Pagination cursor
            limit: Number of posts to return
            asset_type: Filter by asset type
            tags: Filter by tags
            
        Returns:
            PaginatedPosts with posts and pagination info
        """
        # Parse cursor
        cursor_data = self._parse_cursor(cursor) if cursor else None
        
        # Build base query
        query = self.db.table(self.posts_table).select(
            "*",
            "assets!inner(url, asset_type, prompt)",
            "users!inner(id, display_name, avatar_url, subscription_tier)",
        )
        
        # Apply filters
        if asset_type:
            query = query.eq("assets.asset_type", asset_type)
        
        if tags:
            query = query.contains("tags", tags)
        
        # Apply feed-specific logic
        if feed_type == "following" and viewer_id:
            # Get followed user IDs
            following = await self._get_following_ids(viewer_id)
            if following:
                query = query.in_("user_id", following)
            else:
                # No following, return empty
                return PaginatedPosts(
                    posts=[],
                    total_count=0,
                    has_more=False,
                    next_cursor=None,
                )
        
        # Apply ordering and cursor
        if feed_type == "trending":
            query = self._apply_trending_order(query, cursor_data)
        else:  # recent
            query = self._apply_recent_order(query, cursor_data)
        
        # Fetch one extra to check has_more
        query = query.limit(limit + 1)
        
        result = query.execute()
        posts_data = result.data or []
        
        # Check if there are more
        has_more = len(posts_data) > limit
        if has_more:
            posts_data = posts_data[:limit]
        
        # Transform to dataclasses
        posts = [self._transform_post(p) for p in posts_data]
        
        # Batch load viewer's likes
        if viewer_id and posts:
            liked_ids = await self._get_liked_post_ids(
                viewer_id,
                [p.id for p in posts],
            )
            for post in posts:
                post.is_liked_by_viewer = post.id in liked_ids
        
        # Generate next cursor
        next_cursor = None
        if has_more and posts:
            next_cursor = self._generate_cursor(posts[-1], feed_type)
        
        # Get total count (cached)
        total_count = await self._get_total_count(asset_type, tags)
        
        return PaginatedPosts(
            posts=posts,
            total_count=total_count,
            has_more=has_more,
            next_cursor=next_cursor,
        )
    
    def _apply_trending_order(self, query, cursor_data: Optional[dict]):
        """
        Apply trending algorithm ordering.
        
        Trending score = (likes + comments * 2 + views * 0.1) / age_hours^1.5
        """
        # Use database function for trending score
        query = query.order("trending_score", desc=True)
        
        if cursor_data:
            # Continue from cursor position
            query = query.lt("trending_score", cursor_data["score"])
        
        return query
    
    def _apply_recent_order(self, query, cursor_data: Optional[dict]):
        """Apply recent ordering with cursor."""
        query = query.order("created_at", desc=True)
        
        if cursor_data:
            query = query.lt("created_at", cursor_data["created_at"])
        
        return query
    
    async def _get_following_ids(self, user_id: str) -> List[str]:
        """Get IDs of users that user_id follows."""
        result = (
            self.db.table(self.follows_table)
            .select("following_id")
            .eq("follower_id", user_id)
            .execute()
        )
        return [r["following_id"] for r in (result.data or [])]
    
    async def _get_liked_post_ids(
        self,
        user_id: str,
        post_ids: List[str],
    ) -> set:
        """Batch check which posts user has liked."""
        if not post_ids:
            return set()
        
        result = (
            self.db.table(self.likes_table)
            .select("post_id")
            .eq("user_id", user_id)
            .in_("post_id", post_ids)
            .execute()
        )
        return {r["post_id"] for r in (result.data or [])}
    
    def _transform_post(self, data: dict) -> CommunityPostWithAuthor:
        """Transform database row to dataclass."""
        asset = data.get("assets", {})
        user = data.get("users", {})
        
        author = PostAuthor(
            id=user.get("id", ""),
            display_name=user.get("display_name", "Unknown"),
            avatar_url=user.get("avatar_url"),
            subscription_tier=user.get("subscription_tier", "free"),
        )
        
        return CommunityPostWithAuthor(
            id=data["id"],
            user_id=data["user_id"],
            asset_id=data["asset_id"],
            title=data["title"],
            description=data.get("description"),
            tags=data.get("tags", []),
            show_prompt=data.get("show_prompt", False),
            like_count=data.get("like_count", 0),
            comment_count=data.get("comment_count", 0),
            view_count=data.get("view_count", 0),
            is_featured=data.get("is_featured", False),
            created_at=self._parse_datetime(data["created_at"]),
            updated_at=self._parse_datetime(data["updated_at"]),
            asset_url=asset.get("url"),
            asset_type=asset.get("asset_type"),
            prompt=asset.get("prompt") if data.get("show_prompt") else None,
            author=author,
            inspired_by_post_id=data.get("inspired_by_post_id"),
        )
    
    def _parse_cursor(self, cursor: str) -> dict:
        """Parse base64 encoded cursor."""
        try:
            decoded = base64.b64decode(cursor).decode()
            return json.loads(decoded)
        except:
            return {}
    
    def _generate_cursor(self, post: CommunityPostWithAuthor, feed_type: str) -> str:
        """Generate cursor for next page."""
        if feed_type == "trending":
            data = {"score": post.like_count}  # Simplified
        else:
            data = {"created_at": post.created_at.isoformat()}
        
        return base64.b64encode(json.dumps(data).encode()).decode()
    
    async def _get_total_count(
        self,
        asset_type: Optional[str],
        tags: Optional[List[str]],
    ) -> int:
        """Get total count with caching."""
        # In production, cache this value
        query = self.db.table(self.posts_table).select("id", count="exact")
        
        if asset_type:
            query = query.eq("asset_type", asset_type)
        
        if tags:
            query = query.contains("tags", tags)
        
        result = query.execute()
        return result.count or 0
    
    def _parse_datetime(self, value) -> datetime:
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
```


### Engagement Operations

```python
class CommunityFeedService:
    # ... previous methods ...
    
    async def like_post(self, post_id: str, user_id: str) -> bool:
        """
        Like a post.
        
        Uses upsert to handle duplicate likes gracefully.
        Updates like_count atomically.
        
        Returns:
            True if like was added, False if already liked
        """
        # Check if already liked
        existing = (
            self.db.table(self.likes_table)
            .select("id")
            .eq("post_id", post_id)
            .eq("user_id", user_id)
            .execute()
        )
        
        if existing.data:
            return False  # Already liked
        
        # Add like
        self.db.table(self.likes_table).insert({
            "post_id": post_id,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        
        # Increment like count atomically
        self.db.rpc("increment_like_count", {"post_id": post_id}).execute()
        
        logger.info(f"Post liked: post_id={post_id}, user_id={user_id}")
        return True
    
    async def unlike_post(self, post_id: str, user_id: str) -> bool:
        """
        Unlike a post.
        
        Returns:
            True if like was removed, False if wasn't liked
        """
        result = (
            self.db.table(self.likes_table)
            .delete()
            .eq("post_id", post_id)
            .eq("user_id", user_id)
            .execute()
        )
        
        if not result.data:
            return False  # Wasn't liked
        
        # Decrement like count atomically
        self.db.rpc("decrement_like_count", {"post_id": post_id}).execute()
        
        logger.info(f"Post unliked: post_id={post_id}, user_id={user_id}")
        return True
    
    async def increment_view_count(self, post_id: str) -> None:
        """
        Increment view count for a post.
        
        Called when post is viewed. In production, debounce
        to avoid counting rapid refreshes.
        """
        self.db.rpc("increment_view_count", {"post_id": post_id}).execute()
    
    async def get_post_engagement(
        self,
        post_id: str,
        viewer_id: Optional[str] = None,
    ) -> dict:
        """Get engagement stats for a post."""
        result = (
            self.db.table(self.posts_table)
            .select("like_count, comment_count, view_count")
            .eq("id", post_id)
            .single()
            .execute()
        )
        
        data = result.data or {}
        
        engagement = {
            "like_count": data.get("like_count", 0),
            "comment_count": data.get("comment_count", 0),
            "view_count": data.get("view_count", 0),
            "is_liked": False,
        }
        
        if viewer_id:
            liked = await self._get_liked_post_ids(viewer_id, [post_id])
            engagement["is_liked"] = post_id in liked
        
        return engagement
```

### Trending Algorithm

```python
def calculate_trending_score(
    like_count: int,
    comment_count: int,
    view_count: int,
    created_at: datetime,
    is_featured: bool = False,
) -> float:
    """
    Calculate trending score for a post.
    
    Formula: (engagement_score) / (age_hours ^ decay_factor)
    
    Args:
        like_count: Number of likes
        comment_count: Number of comments
        view_count: Number of views
        created_at: Post creation time
        is_featured: Whether post is featured (boost)
        
    Returns:
        Trending score (higher = more trending)
    """
    # Engagement score with weights
    engagement = (
        like_count * 1.0 +
        comment_count * 2.0 +  # Comments worth more
        view_count * 0.1       # Views worth less
    )
    
    # Age in hours
    age_hours = (datetime.now(timezone.utc) - created_at).total_seconds() / 3600
    age_hours = max(age_hours, 0.1)  # Minimum 6 minutes
    
    # Decay factor (1.5 = moderate decay)
    decay_factor = 1.5
    
    # Calculate score
    score = engagement / (age_hours ** decay_factor)
    
    # Featured boost
    if is_featured:
        score *= 1.5
    
    return score


# Database function for trending score
TRENDING_SCORE_SQL = """
CREATE OR REPLACE FUNCTION calculate_trending_score(
    like_count INTEGER,
    comment_count INTEGER,
    view_count INTEGER,
    created_at TIMESTAMPTZ,
    is_featured BOOLEAN DEFAULT FALSE
) RETURNS FLOAT AS $$
DECLARE
    engagement FLOAT;
    age_hours FLOAT;
    score FLOAT;
BEGIN
    engagement := like_count * 1.0 + comment_count * 2.0 + view_count * 0.1;
    age_hours := GREATEST(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600, 0.1);
    score := engagement / POWER(age_hours, 1.5);
    
    IF is_featured THEN
        score := score * 1.5;
    END IF;
    
    RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add computed column
ALTER TABLE community_posts
ADD COLUMN trending_score FLOAT
GENERATED ALWAYS AS (
    calculate_trending_score(like_count, comment_count, view_count, created_at, is_featured)
) STORED;

CREATE INDEX idx_posts_trending ON community_posts(trending_score DESC);
"""
```

### Database Schema

```sql
CREATE TABLE community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    tags TEXT[] DEFAULT '{}',
    show_prompt BOOLEAN DEFAULT FALSE,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    inspired_by_post_id UUID REFERENCES community_posts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_user ON community_posts(user_id);
CREATE INDEX idx_posts_created ON community_posts(created_at DESC);
CREATE INDEX idx_posts_tags ON community_posts USING GIN(tags);

CREATE TABLE post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(post_id, user_id)
);

CREATE INDEX idx_likes_post ON post_likes(post_id);
CREATE INDEX idx_likes_user ON post_likes(user_id);

CREATE TABLE user_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES users(id),
    following_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(follower_id, following_id),
    CHECK(follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_follows_following ON user_follows(following_id);

-- Atomic increment functions
CREATE OR REPLACE FUNCTION increment_like_count(post_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE community_posts SET like_count = like_count + 1 WHERE id = post_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_like_count(post_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE community_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = post_id;
END;
$$ LANGUAGE plpgsql;
```

## API Routes

```python
from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/community")


@router.get("/feed")
async def get_feed(
    feed_type: str = Query("trending", regex="^(trending|recent|following)$"),
    cursor: Optional[str] = None,
    limit: int = Query(20, ge=1, le=50),
    asset_type: Optional[str] = None,
    tags: Optional[str] = None,
    current_user: Optional[User] = Depends(get_optional_user),
    feed_service: CommunityFeedService = Depends(get_feed_service),
):
    """Get community feed with pagination."""
    tag_list = tags.split(",") if tags else None
    
    result = await feed_service.get_feed(
        feed_type=feed_type,
        viewer_id=current_user.id if current_user else None,
        cursor=cursor,
        limit=limit,
        asset_type=asset_type,
        tags=tag_list,
    )
    
    return {
        "posts": [post.__dict__ for post in result.posts],
        "total_count": result.total_count,
        "has_more": result.has_more,
        "next_cursor": result.next_cursor,
    }


@router.post("/posts/{post_id}/like")
async def like_post(
    post_id: str,
    current_user: User = Depends(get_current_user),
    feed_service: CommunityFeedService = Depends(get_feed_service),
):
    """Like a post."""
    added = await feed_service.like_post(post_id, current_user.id)
    return {"liked": added}


@router.delete("/posts/{post_id}/like")
async def unlike_post(
    post_id: str,
    current_user: User = Depends(get_current_user),
    feed_service: CommunityFeedService = Depends(get_feed_service),
):
    """Unlike a post."""
    removed = await feed_service.unlike_post(post_id, current_user.id)
    return {"unliked": removed}
```

## Best Practices

1. **Cursor pagination** - More efficient than offset for large datasets
2. **Batch load relationships** - Avoid N+1 queries for authors, likes
3. **Computed trending score** - Store in database for efficient sorting
4. **Atomic counters** - Use database functions for like/view counts
5. **Index strategically** - Index on sort columns and filters
6. **Cache total counts** - Expensive to compute on every request
7. **Debounce views** - Don't count rapid refreshes as views
