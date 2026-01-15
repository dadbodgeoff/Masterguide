# Background Job Processing Pattern

> Worker-based job processing with Redis queues, graceful shutdown, progress reporting, and CPU-bound task offloading.

## Overview

This pattern implements background job processing with:
- Redis Queue (RQ) for job distribution
- Graceful shutdown handling
- CPU-bound task offloading to thread pools
- Real-time progress reporting via SSE
- Multi-variant asset processing
- Execution report submission

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    API      │────▶│   Redis     │────▶│   Worker    │
│  (Enqueue)  │     │   Queue     │     │  (Process)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                          ▼                   ▼                   ▼
                    ┌──────────┐       ┌──────────┐       ┌──────────┐
                    │   AI     │       │  Storage │       │ Database │
                    │  Client  │       │  Upload  │       │  Update  │
                    └──────────┘       └──────────┘       └──────────┘
```

## Implementation

### Worker Configuration

```python
import os
import logging
import sys
from redis import Redis
from rq import Worker, Queue

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = logging.getLogger(__name__)

WORKER_NAME = "generation_worker"
QUEUE_NAME = "generation"
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")


def get_redis_connection() -> Redis:
    """Create a Redis connection."""
    return Redis.from_url(REDIS_URL)


def get_queue() -> Queue:
    """Get the job queue instance."""
    redis_conn = get_redis_connection()
    return Queue(QUEUE_NAME, connection=redis_conn)


def start_worker():
    """
    Start the RQ worker.
    
    Graceful Shutdown:
    RQ Worker handles SIGTERM/SIGINT signals. When received:
    1. Stop accepting new jobs
    2. Wait for current job to complete (up to job_timeout)
    3. Terminate cleanly
    """
    redis_conn = get_redis_connection()
    queue = Queue(QUEUE_NAME, connection=redis_conn)
    
    worker = Worker(
        [queue],
        connection=redis_conn,
        name=WORKER_NAME,
    )
    
    logger.info(f"Starting worker: {WORKER_NAME}")
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    start_worker()
```

### Job Enqueuing

```python
from rq import Queue
from datetime import timedelta


def enqueue_generation_job(
    job_id: str,
    user_id: str,
    priority: str = "default",
) -> str:
    """
    Enqueue a generation job for processing.
    
    Args:
        job_id: The job ID to process
        user_id: Owner's user ID
        priority: Job priority ("high", "default", "low")
        
    Returns:
        RQ job ID
    """
    queue = get_queue()
    
    # Set timeout based on job type
    job_timeout = "10m"  # 10 minutes for generation
    
    # Enqueue with metadata
    rq_job = queue.enqueue(
        process_generation_job,
        job_id,
        user_id,
        job_timeout=job_timeout,
        result_ttl=3600,  # Keep result for 1 hour
        failure_ttl=86400,  # Keep failures for 24 hours
        meta={
            "job_id": job_id,
            "user_id": user_id,
            "enqueued_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    
    logger.info(f"Enqueued job: job_id={job_id}, rq_job_id={rq_job.id}")
    
    return rq_job.id
```

### CPU-Bound Task Executor

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar, Any

T = TypeVar("T")

# Thread pool for CPU-bound operations
_executor: ThreadPoolExecutor = None


def get_executor() -> ThreadPoolExecutor:
    """Get or create the thread pool executor."""
    global _executor
    if _executor is None:
        # Use number of CPUs for thread count
        import os
        workers = os.cpu_count() or 4
        _executor = ThreadPoolExecutor(max_workers=workers)
    return _executor


async def run_cpu_bound(func: Callable[..., T], *args, **kwargs) -> T:
    """
    Run a CPU-bound function in the thread pool.
    
    Prevents blocking the async event loop for operations like:
    - Image processing (PIL)
    - Background removal (rembg)
    - File compression
    
    Args:
        func: The function to run
        *args: Positional arguments
        **kwargs: Keyword arguments
        
    Returns:
        Function result
    """
    loop = asyncio.get_event_loop()
    executor = get_executor()
    
    # Run in thread pool
    return await loop.run_in_executor(
        executor,
        lambda: func(*args, **kwargs),
    )
```

### Progress Reporting via SSE

```python
import json
from typing import Optional


async def store_sse_progress(
    job_id: str,
    progress: int,
    message: str = "",
) -> None:
    """
    Store SSE progress event for real-time frontend updates.
    
    Uses stream ID format `gen:{job_id}` which the frontend
    polls via the SSE recovery endpoint.
    
    Args:
        job_id: Generation job UUID
        progress: Progress percentage (0-100)
        message: Optional progress message
    """
    try:
        from app.sse import get_completion_store, get_stream_registry, StreamType
        
        completion_store = get_completion_store()
        registry = get_stream_registry()
        stream_id = f"gen:{job_id}"
        
        # Ensure stream is registered
        existing = await registry.get_stream(stream_id)
        if not existing:
            # Get user_id from job for registration
            job = await get_job(job_id)
            await registry.register(
                stream_id=stream_id,
                stream_type=StreamType.GENERATION,
                user_id=job.user_id,
                metadata={"job_id": job_id, "source": "worker"},
            )
        else:
            await registry.heartbeat(stream_id)
        
        # Store progress event
        await completion_store.store_event(
            stream_id=stream_id,
            event_id=f"progress_{progress}",
            event_data={
                "type": "progress",
                "job_id": job_id,
                "progress": progress,
                "message": message,
            },
        )
        
        logger.debug(f"Stored SSE progress: job_id={job_id}, progress={progress}")
        
    except Exception as e:
        # Non-fatal - don't block generation for SSE issues
        logger.debug(f"Failed to store SSE progress: {e}")
```

### Main Job Processor

```python
import time
from dataclasses import dataclass
from typing import Optional, List, Dict, Any


@dataclass
class ExecutionReport:
    """Report of job execution for analytics."""
    job_id: str
    user_id: str
    outcome: str  # "success", "partial", "failed"
    duration_ms: int
    assets_created: int
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


async def process_generation_job(job_id: str, user_id: str) -> Dict[str, Any]:
    """
    Main job processing function.
    
    Lifecycle:
    1. Update status to PROCESSING
    2. Prepare generation context (download assets, etc.)
    3. Call AI generation API
    4. Process results (resize, background removal, etc.)
    5. Upload to storage
    6. Create asset records
    7. Update status to COMPLETED/FAILED
    8. Submit execution report
    
    Args:
        job_id: Job UUID
        user_id: Owner's user ID
        
    Returns:
        Dict with job result
    """
    start_time = time.perf_counter()
    generation_service = get_generation_service()
    storage_service = get_storage_service()
    ai_client = get_ai_client()
    
    report = ExecutionReport(
        job_id=job_id,
        user_id=user_id,
        outcome="failed",
        duration_ms=0,
        assets_created=0,
    )
    
    try:
        # 1. Update to PROCESSING
        job = await generation_service.update_job_status(
            job_id=job_id,
            status=JobStatus.PROCESSING,
            progress=0,
        )
        await store_sse_progress(job_id, 5, "Starting generation...")
        
        # 2. Prepare context
        await store_sse_progress(job_id, 10, "Preparing assets...")
        context = await prepare_generation_context(job)
        
        # 3. Generate image
        await store_sse_progress(job_id, 20, "Generating image...")
        
        request = GenerationRequest(
            prompt=context["final_prompt"],
            width=job.parameters.get("width", 1280),
            height=job.parameters.get("height", 720),
            input_image=context.get("input_image"),
            media_assets=context.get("media_assets"),
        )
        
        response = await ai_client.generate(request)
        
        await store_sse_progress(job_id, 60, "Processing result...")
        
        # 4. Process result (CPU-bound operations in thread pool)
        processed_images = await process_generated_image(
            image_data=response.image_data,
            asset_type=job.asset_type,
        )
        
        await store_sse_progress(job_id, 80, "Uploading assets...")
        
        # 5-6. Upload and create records
        created_assets = []
        for img_data, variant_type, width, height in processed_images:
            upload_result = await storage_service.upload_asset(
                user_id=user_id,
                job_id=job_id,
                image_data=img_data,
                content_type="image/png",
            )
            
            asset = await generation_service.create_asset(
                job_id=job_id,
                user_id=user_id,
                asset_type=variant_type,
                url=upload_result.url,
                storage_path=upload_result.path,
                width=width,
                height=height,
                file_size=len(img_data),
            )
            
            created_assets.append(asset)
        
        # 7. Mark completed
        await generation_service.update_job_status(
            job_id=job_id,
            status=JobStatus.COMPLETED,
            progress=100,
        )
        
        await store_sse_progress(job_id, 100, "Complete!")
        
        # Update report
        report.outcome = "success"
        report.assets_created = len(created_assets)
        
        return {
            "status": "completed",
            "assets": [{"id": a.id, "url": a.url} for a in created_assets],
        }
        
    except ContentPolicyError as e:
        logger.warning(f"Content policy violation: job_id={job_id}, reason={e.reason}")
        
        await generation_service.update_job_status(
            job_id=job_id,
            status=JobStatus.FAILED,
            error_message="Content policy violation",
        )
        
        report.error_message = "content_policy"
        raise
        
    except RateLimitError as e:
        logger.warning(f"Rate limited: job_id={job_id}, retry_after={e.retry_after}")
        
        # Re-queue for later
        await requeue_job(job_id, delay_seconds=e.retry_after)
        
        report.outcome = "requeued"
        report.error_message = "rate_limited"
        
        return {"status": "requeued", "retry_after": e.retry_after}
        
    except Exception as e:
        logger.exception(f"Job failed: job_id={job_id}, error={e}")
        
        await generation_service.update_job_status(
            job_id=job_id,
            status=JobStatus.FAILED,
            error_message=str(e)[:500],
        )
        
        report.error_message = str(e)[:200]
        raise
        
    finally:
        # Calculate duration
        report.duration_ms = int((time.perf_counter() - start_time) * 1000)
        
        # Submit execution report
        await submit_execution_report(report)
```


### Image Processing (CPU-Bound)

```python
from PIL import Image
from io import BytesIO
from typing import List, Tuple


# Asset dimensions for different types
ASSET_DIMENSIONS = {
    "thumbnail": (1280, 720),
    "overlay": (1920, 1080),
    "banner": (1200, 480),
    "twitch_emote": (112, 112),
    "twitch_emote_56": (56, 56),
    "twitch_emote_28": (28, 28),
}

# Emote sizes that need multi-variant processing
TWITCH_EMOTE_SIZES = [112, 56, 28]


def is_emote_type(asset_type: str) -> bool:
    """Check if asset type needs multi-size processing."""
    return asset_type.startswith("twitch_emote") or asset_type.startswith("tiktok_emote")


async def process_generated_image(
    image_data: bytes,
    asset_type: str,
) -> List[Tuple[bytes, str, int, int]]:
    """
    Process generated image into required variants.
    
    For emotes: removes background and creates all size variants.
    For other types: returns as-is with correct dimensions.
    
    Args:
        image_data: Raw image bytes from AI
        asset_type: Type of asset
        
    Returns:
        List of (image_bytes, variant_type, width, height) tuples
    """
    if is_emote_type(asset_type):
        # Process emote with background removal and resizing
        return await run_cpu_bound(
            _process_emote_sync,
            image_data,
            TWITCH_EMOTE_SIZES,
        )
    else:
        # Return as-is
        width, height = ASSET_DIMENSIONS.get(asset_type, (1280, 720))
        return [(image_data, asset_type, width, height)]


def _process_emote_sync(
    image_data: bytes,
    sizes: List[int],
) -> List[Tuple[bytes, str, int, int]]:
    """
    Synchronous emote processing - runs in thread pool.
    
    Steps:
    1. Remove background using rembg
    2. Resize to each required size
    3. Export as PNG with transparency
    """
    import rembg
    
    # Remove background (CPU-intensive)
    transparent_bytes = rembg.remove(image_data)
    
    # Load as PIL Image
    img = Image.open(BytesIO(transparent_bytes)).convert("RGBA")
    
    results = []
    
    for size in sizes:
        # Resize with high-quality resampling
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Export as PNG
        buffer = BytesIO()
        resized.save(buffer, format="PNG", optimize=True)
        buffer.seek(0)
        png_bytes = buffer.read()
        
        variant_type = f"twitch_emote_{size}"
        results.append((png_bytes, variant_type, size, size))
    
    return results
```

### Media Asset Download

```python
import httpx
from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class MediaAssetInput:
    """Downloaded media asset for generation."""
    image_data: bytes
    mime_type: str
    asset_id: str
    display_name: str
    asset_type: str


async def download_media_assets(
    placements: List[dict],
    timeout: float = 30.0,
) -> Tuple[List[MediaAssetInput], List[dict]]:
    """
    Download media assets from URLs for AI generation.
    
    Args:
        placements: List of placement dicts with URLs
        timeout: HTTP timeout in seconds
        
    Returns:
        Tuple of (downloaded assets, successful placements)
        Only returns placements that downloaded successfully.
    """
    media_assets = []
    successful_placements = []
    
    # Sort by z_index for consistent ordering
    sorted_placements = sorted(
        placements,
        key=lambda p: p.get("zIndex") or p.get("z_index", 1),
    )
    
    async with httpx.AsyncClient(timeout=timeout) as client:
        for placement in sorted_placements:
            url = placement.get("url", "")
            if not url:
                continue
            
            try:
                # Use processed URL if available (background removed)
                fetch_url = placement.get("processedUrl") or url
                
                response = await client.get(fetch_url)
                
                if response.status_code == 200 and len(response.content) > 100:
                    content_type = response.headers.get("content-type", "image/png")
                    if ";" in content_type:
                        content_type = content_type.split(";")[0].strip()
                    
                    media_assets.append(MediaAssetInput(
                        image_data=response.content,
                        mime_type=content_type,
                        asset_id=placement.get("assetId", ""),
                        display_name=placement.get("displayName", "asset"),
                        asset_type=placement.get("assetType", "image"),
                    ))
                    successful_placements.append(placement)
                    
                    logger.info(
                        f"Downloaded asset: name={placement.get('displayName')}, "
                        f"size={len(response.content)}"
                    )
                else:
                    logger.warning(
                        f"Failed to download: status={response.status_code}, "
                        f"name={placement.get('displayName')}"
                    )
                    
            except Exception as e:
                logger.warning(f"Download error: {e}, name={placement.get('displayName')}")
    
    return media_assets, successful_placements
```

### Execution Report

```python
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any
from enum import Enum


class ExecutionOutcome(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    REQUEUED = "requeued"


@dataclass
class ExecutionReport:
    """Report of job execution for analytics and monitoring."""
    job_id: str
    user_id: str
    outcome: ExecutionOutcome
    duration_ms: int
    assets_created: int
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


async def submit_execution_report(report: ExecutionReport) -> None:
    """
    Submit execution report for analytics.
    
    Reports are used for:
    - Performance monitoring
    - Error tracking
    - Usage analytics
    - Billing reconciliation
    """
    try:
        # Store in database
        db = get_database()
        db.table("execution_reports").insert({
            "job_id": report.job_id,
            "user_id": report.user_id,
            "outcome": report.outcome.value,
            "duration_ms": report.duration_ms,
            "assets_created": report.assets_created,
            "error_message": report.error_message,
            "metadata": report.metadata,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        
        # Track metrics
        from app.metrics import track_job_completion
        track_job_completion(
            outcome=report.outcome.value,
            duration_ms=report.duration_ms,
        )
        
    except Exception as e:
        logger.error(f"Failed to submit execution report: {e}")
```

### Job Requeuing

```python
async def requeue_job(job_id: str, delay_seconds: int = 60) -> None:
    """
    Requeue a job for later processing.
    
    Used when:
    - Rate limited by external API
    - Temporary failure that may succeed later
    
    Args:
        job_id: Job to requeue
        delay_seconds: Delay before retry
    """
    queue = get_queue()
    
    # Schedule for later
    queue.enqueue_in(
        timedelta(seconds=delay_seconds),
        process_generation_job,
        job_id,
        job_timeout="10m",
        meta={"requeued": True, "original_job_id": job_id},
    )
    
    logger.info(f"Requeued job: job_id={job_id}, delay={delay_seconds}s")
```

## Database Schema

```sql
CREATE TABLE execution_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    user_id UUID NOT NULL REFERENCES users(id),
    outcome VARCHAR(20) NOT NULL,
    duration_ms INTEGER NOT NULL,
    assets_created INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_job ON execution_reports(job_id);
CREATE INDEX idx_reports_user ON execution_reports(user_id);
CREATE INDEX idx_reports_outcome ON execution_reports(outcome);
CREATE INDEX idx_reports_created ON execution_reports(created_at);
```

## Docker Configuration

```dockerfile
# Worker Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for image processing
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run worker
CMD ["python", "-m", "backend.workers.generation_worker"]
```

```yaml
# docker-compose.yml
services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=${DATABASE_URL}
      - AI_API_KEY=${AI_API_KEY}
    depends_on:
      - redis
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
    stop_grace_period: 5m  # Allow time for job completion
```

## Best Practices

1. **Graceful shutdown** - Allow in-progress jobs to complete
2. **Thread pool for CPU** - Don't block async loop with PIL/rembg
3. **Progress reporting** - Keep users informed during long jobs
4. **Execution reports** - Track all outcomes for monitoring
5. **Requeue on rate limit** - Don't fail jobs for temporary issues
6. **Verify uploads** - Check file sizes after upload
7. **Clean error messages** - Truncate for database storage
8. **Idempotent processing** - Handle job retries gracefully
