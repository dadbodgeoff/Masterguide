# Job State Machine Pattern

> Async job processing with validated state transitions, progress tracking, and linked asset creation.

## Overview

This pattern implements a robust job processing system with:
- Defined job states and valid transitions
- State transition validation
- Progress tracking
- Terminal state handling
- Asset linking to jobs

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   API       │────▶│   Queue     │────▶│   Worker    │
│  (Create)   │     │  (Redis)    │     │  (Process)  │
└─────────────┘     └─────────────┘     └─────────────┘
      │                                        │
      │                                        │
      ▼                                        ▼
┌─────────────────────────────────────────────────────┐
│                    Database                          │
│  ┌─────────────┐              ┌─────────────┐       │
│  │    Jobs     │──────────────│   Assets    │       │
│  │  (status)   │   1:many     │  (job_id)   │       │
│  └─────────────┘              └─────────────┘       │
└─────────────────────────────────────────────────────┘
```

## State Machine

```
                    ┌─────────┐
                    │ QUEUED  │
                    └────┬────┘
                         │
                         ▼
                    ┌─────────┐
              ┌─────│PROCESSING│─────┐
              │     └─────────┘     │
              │          │          │
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │COMPLETED│ │PARTIAL │ │ FAILED │
         └────────┘ └────────┘ └────────┘
              │          │          │
              └──────────┴──────────┘
                    (Terminal)
```

## Implementation

### Job Status Enum

```python
from enum import Enum


class JobStatus(str, Enum):
    """Status values for async jobs."""
    QUEUED = "queued"          # Job created, waiting for worker
    PROCESSING = "processing"  # Worker picked up job
    COMPLETED = "completed"    # Job finished successfully
    FAILED = "failed"          # Job failed with error
    PARTIAL = "partial"        # Job partially completed (some assets created)


# Valid state transitions
VALID_TRANSITIONS = {
    JobStatus.QUEUED: [JobStatus.PROCESSING],
    JobStatus.PROCESSING: [JobStatus.COMPLETED, JobStatus.PARTIAL, JobStatus.FAILED],
    JobStatus.COMPLETED: [],  # Terminal state
    JobStatus.PARTIAL: [],    # Terminal state
    JobStatus.FAILED: [],     # Terminal state
}


def is_terminal_state(status: JobStatus) -> bool:
    """Check if a status is terminal (no further transitions)."""
    return len(VALID_TRANSITIONS.get(status, [])) == 0
```

### Job Model

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any


@dataclass
class Job:
    """
    Represents an async processing job.
    
    Attributes:
        id: Unique job identifier (UUID)
        user_id: Owner's user ID
        job_type: Type of job (e.g., "generation", "export")
        status: Current job status
        progress: Progress percentage (0-100)
        error_message: Error message if failed
        parameters: Job-specific parameters
        result: Job result data (when completed)
        created_at: Job creation timestamp
        updated_at: Last update timestamp
        completed_at: Completion timestamp (terminal states)
    """
    id: str
    user_id: str
    job_type: str
    status: JobStatus
    progress: int
    error_message: Optional[str]
    parameters: Optional[Dict[str, Any]]
    result: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]
    
    def is_terminal(self) -> bool:
        """Check if job is in a terminal state."""
        return is_terminal_state(self.status)
    
    def can_transition_to(self, target: JobStatus) -> bool:
        """Check if transition to target status is valid."""
        return target in VALID_TRANSITIONS.get(self.status, [])
```

### State Transition Exception

```python
from dataclasses import dataclass


@dataclass
class InvalidStateTransitionError(Exception):
    """Raised when an invalid state transition is attempted."""
    current_status: str
    target_status: str
    
    def __str__(self):
        return f"Cannot transition from '{self.current_status}' to '{self.target_status}'"
```

### Job Service

```python
from datetime import datetime, timezone
from typing import Optional, List
from uuid import uuid4
import logging

logger = logging.getLogger(__name__)


class JobService:
    """
    Service for managing async jobs with state machine validation.
    
    Responsibilities:
    - Create jobs with initial QUEUED status
    - Validate and execute state transitions
    - Track progress updates
    - Link assets to jobs
    """
    
    def __init__(self, db):
        self.db = db
        self.jobs_table = "jobs"
        self.assets_table = "assets"
    
    async def create_job(
        self,
        user_id: str,
        job_type: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Job:
        """
        Create a new job in QUEUED status.
        
        Args:
            user_id: Owner's user ID
            job_type: Type of job
            parameters: Job-specific parameters
            
        Returns:
            Created Job with generated ID
        """
        now = datetime.now(timezone.utc).isoformat()
        
        job_data = {
            "id": str(uuid4()),
            "user_id": user_id,
            "job_type": job_type,
            "status": JobStatus.QUEUED.value,
            "progress": 0,
            "error_message": None,
            "parameters": parameters or {},
            "result": None,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }
        
        result = self.db.table(self.jobs_table).insert(job_data).execute()
        
        if not result.data:
            raise Exception("Failed to create job")
        
        logger.info(f"Job created: id={job_data['id']}, type={job_type}")
        
        return self._dict_to_job(result.data[0])
    
    async def get_job(self, job_id: str, user_id: str) -> Job:
        """
        Get a job by ID with ownership verification.
        
        Args:
            job_id: Job UUID
            user_id: User ID for ownership check
            
        Returns:
            Job if found and owned by user
            
        Raises:
            JobNotFoundError: If job doesn't exist
            AuthorizationError: If user doesn't own the job
        """
        result = self.db.table(self.jobs_table).select("*").eq("id", job_id).execute()
        
        if not result.data:
            raise JobNotFoundError(job_id)
        
        job_data = result.data[0]
        
        if job_data["user_id"] != user_id:
            raise AuthorizationError("job")
        
        return self._dict_to_job(job_data)
    
    async def transition_status(
        self,
        job_id: str,
        target_status: JobStatus,
        progress: int = 0,
        error_message: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
    ) -> Job:
        """
        Transition job to a new status with validation.
        
        Args:
            job_id: Job UUID
            target_status: Target status
            progress: Progress percentage (0-100)
            error_message: Error message (for FAILED status)
            result: Result data (for COMPLETED status)
            
        Returns:
            Updated Job
            
        Raises:
            JobNotFoundError: If job doesn't exist
            InvalidStateTransitionError: If transition is invalid
        """
        # Get current job state
        result_data = self.db.table(self.jobs_table).select("*").eq("id", job_id).execute()
        
        if not result_data.data:
            raise JobNotFoundError(job_id)
        
        current_job = result_data.data[0]
        current_status = JobStatus(current_job["status"])
        
        # Allow same-state transitions for progress updates
        if current_status != target_status:
            # Validate transition
            if target_status not in VALID_TRANSITIONS.get(current_status, []):
                raise InvalidStateTransitionError(
                    current_status=current_status.value,
                    target_status=target_status.value,
                )
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Build update data
        update_data = {
            "status": target_status.value,
            "progress": progress,
            "updated_at": now,
        }
        
        if error_message is not None:
            update_data["error_message"] = error_message
        
        if result is not None:
            update_data["result"] = result
        
        # Set completed_at for terminal states
        if is_terminal_state(target_status):
            update_data["completed_at"] = now
        
        result_data = (
            self.db.table(self.jobs_table)
            .update(update_data)
            .eq("id", job_id)
            .execute()
        )
        
        if not result_data.data:
            raise JobNotFoundError(job_id)
        
        logger.info(
            f"Job transitioned: id={job_id}, "
            f"{current_status.value} -> {target_status.value}"
        )
        
        return self._dict_to_job(result_data.data[0])
    
    async def update_progress(
        self,
        job_id: str,
        progress: int,
        message: Optional[str] = None,
    ) -> Job:
        """
        Update job progress without changing status.
        
        Args:
            job_id: Job UUID
            progress: Progress percentage (0-100)
            message: Optional progress message
            
        Returns:
            Updated Job
        """
        # Get current status
        result = self.db.table(self.jobs_table).select("status").eq("id", job_id).execute()
        
        if not result.data:
            raise JobNotFoundError(job_id)
        
        current_status = JobStatus(result.data[0]["status"])
        
        # Only allow progress updates in PROCESSING state
        if current_status != JobStatus.PROCESSING:
            logger.warning(
                f"Ignoring progress update for job {job_id} in {current_status.value} state"
            )
            return await self.get_job_internal(job_id)
        
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.PROCESSING,
            progress=progress,
        )
    
    async def mark_completed(
        self,
        job_id: str,
        result: Optional[Dict[str, Any]] = None,
    ) -> Job:
        """Mark job as completed."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.COMPLETED,
            progress=100,
            result=result,
        )
    
    async def mark_failed(
        self,
        job_id: str,
        error_message: str,
    ) -> Job:
        """Mark job as failed."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.FAILED,
            error_message=error_message,
        )
    
    async def mark_partial(
        self,
        job_id: str,
        result: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> Job:
        """Mark job as partially completed."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.PARTIAL,
            progress=100,
            result=result,
            error_message=error_message,
        )
    
    async def list_jobs(
        self,
        user_id: str,
        status: Optional[JobStatus] = None,
        job_type: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> List[Job]:
        """List jobs for a user with optional filters."""
        query = (
            self.db.table(self.jobs_table)
            .select("*")
            .eq("user_id", user_id)
        )
        
        if status is not None:
            query = query.eq("status", status.value)
        
        if job_type is not None:
            query = query.eq("job_type", job_type)
        
        result = (
            query
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        
        return [self._dict_to_job(data) for data in (result.data or [])]
    
    def _dict_to_job(self, data: dict) -> Job:
        """Convert database dict to Job dataclass."""
        return Job(
            id=data["id"],
            user_id=data["user_id"],
            job_type=data["job_type"],
            status=JobStatus(data["status"]),
            progress=data["progress"],
            error_message=data.get("error_message"),
            parameters=data.get("parameters"),
            result=data.get("result"),
            created_at=self._parse_datetime(data["created_at"]),
            updated_at=self._parse_datetime(data["updated_at"]),
            completed_at=self._parse_datetime(data.get("completed_at")),
        )
    
    def _parse_datetime(self, value) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
```

### Asset Linking

```python
@dataclass
class Asset:
    """Asset linked to a job."""
    id: str
    job_id: str
    user_id: str
    asset_type: str
    url: str
    storage_path: str
    file_size: int
    created_at: datetime


class JobService:
    # ... previous methods ...
    
    async def create_asset(
        self,
        job_id: str,
        user_id: str,
        asset_type: str,
        url: str,
        storage_path: str,
        file_size: int,
    ) -> Asset:
        """
        Create an asset linked to a job.
        
        Assets are created during job processing and linked
        via job_id for retrieval.
        """
        now = datetime.now(timezone.utc).isoformat()
        
        asset_data = {
            "id": str(uuid4()),
            "job_id": job_id,
            "user_id": user_id,
            "asset_type": asset_type,
            "url": url,
            "storage_path": storage_path,
            "file_size": file_size,
            "created_at": now,
        }
        
        result = self.db.table(self.assets_table).insert(asset_data).execute()
        
        if not result.data:
            raise Exception("Failed to create asset")
        
        logger.info(f"Asset created: id={asset_data['id']}, job_id={job_id}")
        
        return self._dict_to_asset(result.data[0])
    
    async def get_job_assets(self, job_id: str, user_id: str) -> List[Asset]:
        """Get all assets for a job."""
        # Verify job ownership
        await self.get_job(job_id, user_id)
        
        result = (
            self.db.table(self.assets_table)
            .select("*")
            .eq("job_id", job_id)
            .order("created_at", desc=True)
            .execute()
        )
        
        return [self._dict_to_asset(data) for data in (result.data or [])]
```

### Worker Integration

```python
async def process_job(job_id: str):
    """Worker function to process a job."""
    job_service = get_job_service()
    
    try:
        # Transition to PROCESSING
        await job_service.transition_status(
            job_id=job_id,
            target_status=JobStatus.PROCESSING,
            progress=0,
        )
        
        # Get job details
        job = await job_service.get_job_internal(job_id)
        
        # Process with progress updates
        await job_service.update_progress(job_id, 25)
        result1 = await do_step_1(job.parameters)
        
        await job_service.update_progress(job_id, 50)
        result2 = await do_step_2(result1)
        
        await job_service.update_progress(job_id, 75)
        asset_url = await upload_result(result2)
        
        # Create asset
        await job_service.create_asset(
            job_id=job_id,
            user_id=job.user_id,
            asset_type=job.job_type,
            url=asset_url,
            storage_path=f"{job.user_id}/{job_id}/result.png",
            file_size=len(result2),
        )
        
        # Mark completed
        await job_service.mark_completed(
            job_id=job_id,
            result={"asset_count": 1},
        )
        
    except Exception as e:
        logger.exception(f"Job {job_id} failed: {e}")
        await job_service.mark_failed(
            job_id=job_id,
            error_message=str(e),
        )
```

## API Routes

```python
from fastapi import APIRouter, Depends, BackgroundTasks

router = APIRouter(prefix="/jobs")


@router.post("/")
async def create_job(
    request: CreateJobRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
    queue: JobQueue = Depends(get_job_queue),
):
    """Create a new job and queue for processing."""
    job = await job_service.create_job(
        user_id=current_user.id,
        job_type=request.job_type,
        parameters=request.parameters,
    )
    
    # Queue for async processing
    await queue.enqueue(job.id)
    
    return {"job_id": job.id, "status": job.status.value}


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
):
    """Get job status and details."""
    job = await job_service.get_job(job_id, current_user.id)
    
    return {
        "id": job.id,
        "status": job.status.value,
        "progress": job.progress,
        "error_message": job.error_message,
        "result": job.result,
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@router.get("/{job_id}/assets")
async def get_job_assets(
    job_id: str,
    current_user: User = Depends(get_current_user),
    job_service: JobService = Depends(get_job_service),
):
    """Get assets created by a job."""
    assets = await job_service.get_job_assets(job_id, current_user.id)
    
    return {
        "assets": [
            {
                "id": a.id,
                "url": a.url,
                "asset_type": a.asset_type,
                "file_size": a.file_size,
            }
            for a in assets
        ]
    }
```

## Database Schema

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    parameters JSONB,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    CONSTRAINT valid_status CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'partial')),
    CONSTRAINT valid_progress CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);

CREATE TABLE assets (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    asset_type VARCHAR(50) NOT NULL,
    url TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assets_job_id ON assets(job_id);
CREATE INDEX idx_assets_user_id ON assets(user_id);
```

## Best Practices

1. **Validate all transitions** - Never skip state machine validation
2. **Use terminal states** - Jobs should always reach a terminal state
3. **Track progress** - Provide feedback during long operations
4. **Link assets to jobs** - Maintain relationship for cleanup
5. **Log transitions** - Essential for debugging job issues
6. **Handle partial success** - Use PARTIAL status when some work completed
7. **Include error details** - Store meaningful error messages
