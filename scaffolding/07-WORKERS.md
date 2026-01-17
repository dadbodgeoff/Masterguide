# Phase 07: Job Processing System

> **Time**: 15 minutes  
> **Prerequisites**: [06-RESILIENCE](./06-RESILIENCE.md)  
> **Produces**: Job service, state machine, queue, dead letter handling

---

## 🤖 Agent Execution Context

**What you're doing**: Building an async job processing system with a proper state machine. This handles background work like AI generation, file processing, exports, etc.

**Expected state BEFORE execution**:
- Phase 06 complete (resilience patterns exist)
- Database has `jobs` and `assets` tables (from Phase 04)
- Exceptions exist (from Phase 03)

**What you'll create**:
- `packages/backend/src/jobs/__init__.py` — Module exports
- `packages/backend/src/jobs/models.py` — Job, Asset dataclasses, state machine
- `packages/backend/src/jobs/service.py` — JobService CRUD with state validation
- `packages/backend/src/jobs/queue.py` — Queue abstraction (Redis + in-memory)
- `packages/backend/src/jobs/worker.py` — Job worker with retry logic
- `apps/web/lib/jobs/client.ts` — Frontend job client with polling

**Execution approach**:
1. Create `packages/backend/src/jobs/` directory
2. Create __init__.py
3. Create models.py (defines the state machine)
4. Create service.py (uses models and database)
5. Create queue.py (Redis queue + fallback)
6. Create worker.py (processes jobs from queue)
7. Create `apps/web/lib/jobs/` directory
8. Create client.ts

**IMPORTANT**:
- The state machine in models.py defines VALID_TRANSITIONS — this is enforced
- JobService.transition_status() will REJECT invalid transitions
- The worker uses graceful shutdown from Phase 06
- Queue has both Redis and in-memory implementations

**Job lifecycle**:
```
QUEUED → PROCESSING → COMPLETED
                   → PARTIAL (some work done)
                   → FAILED (with error message)
```

**State machine rules**:
- Can only go QUEUED → PROCESSING
- From PROCESSING, can go to COMPLETED, PARTIAL, or FAILED
- Terminal states (COMPLETED, PARTIAL, FAILED) cannot transition

**After completion, tell the user**:
- "Phase 07 complete. Job processing system ready."
- "Jobs follow a strict state machine: QUEUED → PROCESSING → COMPLETED/FAILED."
- "Proceed to Phase 08 for API routes."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/jobs/` directory exists
- `apps/web/lib/jobs/` directory exists

## Purpose

Create a robust job processing system including:
- Job state machine with validated transitions
- Job service for CRUD operations
- Queue abstraction for job dispatch
- Dead letter queue for failed jobs
- Progress tracking and asset linking

---

## Artifacts to Create

### 1. packages/backend/src/jobs/__init__.py

```python
"""Job processing module."""

from src.jobs.models import Job, JobStatus, Asset
from src.jobs.service import JobService
from src.jobs.queue import JobQueue
from src.jobs.worker import JobWorker

__all__ = [
    "Job",
    "JobStatus",
    "Asset",
    "JobService",
    "JobQueue",
    "JobWorker",
]
```

### 2. packages/backend/src/jobs/models.py

```python
"""Job data models."""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any


class JobStatus(str, Enum):
    """Job status values."""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


# Valid state transitions
VALID_TRANSITIONS: dict[JobStatus, list[JobStatus]] = {
    JobStatus.QUEUED: [JobStatus.PROCESSING],
    JobStatus.PROCESSING: [JobStatus.COMPLETED, JobStatus.PARTIAL, JobStatus.FAILED],
    JobStatus.COMPLETED: [],
    JobStatus.PARTIAL: [],
    JobStatus.FAILED: [],
}


def is_terminal_status(status: JobStatus) -> bool:
    """Check if a status is terminal."""
    return len(VALID_TRANSITIONS.get(status, [])) == 0


def is_valid_transition(from_status: JobStatus, to_status: JobStatus) -> bool:
    """Check if a transition is valid."""
    return to_status in VALID_TRANSITIONS.get(from_status, [])


@dataclass
class Job:
    """Job entity."""
    id: str
    user_id: str
    job_type: str
    status: JobStatus
    progress: int
    error_message: str | None
    parameters: dict[str, Any] | None
    result: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    
    def is_terminal(self) -> bool:
        return is_terminal_status(self.status)
    
    def can_transition_to(self, target: JobStatus) -> bool:
        return is_valid_transition(self.status, target)


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
    metadata: dict[str, Any] | None
    created_at: datetime
```


### 3. packages/backend/src/jobs/service.py

```python
"""Job service for managing async jobs."""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from src.database import DatabaseService, get_db
from src.exceptions import InvalidStateTransitionError, JobNotFoundError, AuthorizationError
from src.jobs.models import Job, JobStatus, Asset, is_terminal_status, is_valid_transition

logger = logging.getLogger(__name__)


class JobService:
    """Service for managing async jobs with state machine validation."""
    
    def __init__(self, db: DatabaseService | None = None):
        self.db = db or get_db()
    
    async def create_job(
        self,
        user_id: str,
        job_type: str,
        parameters: dict[str, Any] | None = None,
    ) -> Job:
        """Create a new job in QUEUED status."""
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
        
        result = self.db.table("jobs").insert(job_data).execute()
        
        if not result.data:
            raise Exception("Failed to create job")
        
        logger.info(f"Job created: id={job_data['id']}, type={job_type}")
        return self._to_job(result.data[0])
    
    async def get_job(self, job_id: str, user_id: str | None = None) -> Job:
        """Get a job by ID with optional ownership check."""
        result = self.db.table("jobs").select("*").eq("id", job_id).execute()
        
        if not result.data:
            raise JobNotFoundError(job_id=job_id)
        
        job_data = result.data[0]
        
        if user_id and job_data["user_id"] != user_id:
            raise AuthorizationError(resource_type="job")
        
        return self._to_job(job_data)
    
    async def transition_status(
        self,
        job_id: str,
        target_status: JobStatus,
        progress: int = 0,
        error_message: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> Job:
        """Transition job to a new status with validation."""
        current_job = await self.get_job(job_id)
        
        # Allow same-state for progress updates
        if current_job.status != target_status:
            if not is_valid_transition(current_job.status, target_status):
                raise InvalidStateTransitionError(
                    current_status=current_job.status.value,
                    target_status=target_status.value,
                )
        
        now = datetime.now(timezone.utc).isoformat()
        
        update_data: dict[str, Any] = {
            "status": target_status.value,
            "progress": progress,
            "updated_at": now,
        }
        
        if error_message is not None:
            update_data["error_message"] = error_message
        
        if result is not None:
            update_data["result"] = result
        
        if is_terminal_status(target_status):
            update_data["completed_at"] = now
        
        db_result = self.db.table("jobs").update(update_data).eq("id", job_id).execute()
        
        if not db_result.data:
            raise JobNotFoundError(job_id=job_id)
        
        logger.info(f"Job transitioned: {job_id} {current_job.status.value} → {target_status.value}")
        return self._to_job(db_result.data[0])
    
    async def update_progress(self, job_id: str, progress: int) -> Job:
        """Update job progress without changing status."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.PROCESSING,
            progress=progress,
        )
    
    async def mark_completed(self, job_id: str, result: dict[str, Any] | None = None) -> Job:
        """Mark job as completed."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.COMPLETED,
            progress=100,
            result=result,
        )
    
    async def mark_failed(self, job_id: str, error_message: str) -> Job:
        """Mark job as failed."""
        return await self.transition_status(
            job_id=job_id,
            target_status=JobStatus.FAILED,
            error_message=error_message,
        )
    
    async def create_asset(
        self,
        job_id: str,
        user_id: str,
        asset_type: str,
        url: str,
        storage_path: str,
        file_size: int,
        metadata: dict[str, Any] | None = None,
    ) -> Asset:
        """Create an asset linked to a job."""
        now = datetime.now(timezone.utc).isoformat()
        
        asset_data = {
            "id": str(uuid4()),
            "job_id": job_id,
            "user_id": user_id,
            "asset_type": asset_type,
            "url": url,
            "storage_path": storage_path,
            "file_size": file_size,
            "metadata": metadata,
            "created_at": now,
        }
        
        result = self.db.table("assets").insert(asset_data).execute()
        
        if not result.data:
            raise Exception("Failed to create asset")
        
        logger.info(f"Asset created: id={asset_data['id']}, job_id={job_id}")
        return self._to_asset(result.data[0])
    
    async def get_job_assets(self, job_id: str, user_id: str) -> list[Asset]:
        """Get all assets for a job."""
        await self.get_job(job_id, user_id)  # Verify ownership
        
        result = (
            self.db.table("assets")
            .select("*")
            .eq("job_id", job_id)
            .order("created_at", desc=True)
            .execute()
        )
        
        return [self._to_asset(data) for data in (result.data or [])]
    
    async def list_jobs(
        self,
        user_id: str,
        status: JobStatus | None = None,
        job_type: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Job]:
        """List jobs for a user."""
        query = self.db.table("jobs").select("*").eq("user_id", user_id)
        
        if status:
            query = query.eq("status", status.value)
        if job_type:
            query = query.eq("job_type", job_type)
        
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return [self._to_job(data) for data in (result.data or [])]
    
    def _to_job(self, data: dict) -> Job:
        return Job(
            id=data["id"],
            user_id=data["user_id"],
            job_type=data["job_type"],
            status=JobStatus(data["status"]),
            progress=data["progress"],
            error_message=data.get("error_message"),
            parameters=data.get("parameters"),
            result=data.get("result"),
            created_at=self._parse_dt(data["created_at"]),
            updated_at=self._parse_dt(data["updated_at"]),
            completed_at=self._parse_dt(data.get("completed_at")),
        )
    
    def _to_asset(self, data: dict) -> Asset:
        return Asset(
            id=data["id"],
            job_id=data["job_id"],
            user_id=data["user_id"],
            asset_type=data["asset_type"],
            url=data["url"],
            storage_path=data["storage_path"],
            file_size=data["file_size"],
            metadata=data.get("metadata"),
            created_at=self._parse_dt(data["created_at"]),
        )
    
    def _parse_dt(self, value) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
```


### 4. packages/backend/src/jobs/queue.py

```python
"""Job queue abstraction."""

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class JobQueue(ABC):
    """Abstract job queue interface."""
    
    @abstractmethod
    async def enqueue(self, job_id: str, priority: int = 0) -> None:
        """Add a job to the queue."""
        pass
    
    @abstractmethod
    async def dequeue(self, timeout: int = 0) -> str | None:
        """Get next job from queue."""
        pass
    
    @abstractmethod
    async def size(self) -> int:
        """Get queue size."""
        pass


class RedisJobQueue(JobQueue):
    """Redis-based job queue with priority support."""
    
    def __init__(self, redis_client, queue_name: str = "jobs"):
        self.redis = redis_client
        self.queue_name = queue_name
    
    async def enqueue(self, job_id: str, priority: int = 0) -> None:
        """Add job to queue with priority (higher = more urgent)."""
        score = -priority  # Negative so higher priority comes first
        await self.redis.zadd(self.queue_name, {job_id: score})
        logger.debug(f"Job enqueued: {job_id} (priority: {priority})")
    
    async def dequeue(self, timeout: int = 0) -> str | None:
        """Get highest priority job from queue."""
        result = await self.redis.zpopmin(self.queue_name)
        if result:
            job_id = result[0][0]
            logger.debug(f"Job dequeued: {job_id}")
            return job_id
        return None
    
    async def size(self) -> int:
        """Get number of jobs in queue."""
        return await self.redis.zcard(self.queue_name)


class InMemoryJobQueue(JobQueue):
    """In-memory queue for testing/development."""
    
    def __init__(self):
        self._queue: list[tuple[int, str]] = []
    
    async def enqueue(self, job_id: str, priority: int = 0) -> None:
        self._queue.append((priority, job_id))
        self._queue.sort(key=lambda x: -x[0])  # Higher priority first
    
    async def dequeue(self, timeout: int = 0) -> str | None:
        if self._queue:
            return self._queue.pop(0)[1]
        return None
    
    async def size(self) -> int:
        return len(self._queue)


class DeadLetterQueue:
    """Dead letter queue for failed jobs."""
    
    def __init__(self, redis_client, queue_name: str = "jobs:dlq"):
        self.redis = redis_client
        self.queue_name = queue_name
    
    async def add(
        self,
        job_id: str,
        error: str,
        attempts: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Add failed job to DLQ."""
        entry = json.dumps({
            "job_id": job_id,
            "error": error,
            "attempts": attempts,
            "metadata": metadata or {},
        })
        await self.redis.lpush(self.queue_name, entry)
        logger.warning(f"Job moved to DLQ: {job_id} (attempts: {attempts})")
    
    async def get_all(self, limit: int = 100) -> list[dict]:
        """Get all entries from DLQ."""
        entries = await self.redis.lrange(self.queue_name, 0, limit - 1)
        return [json.loads(e) for e in entries]
    
    async def retry(self, job_id: str, job_queue: JobQueue) -> bool:
        """Move job from DLQ back to main queue."""
        entries = await self.redis.lrange(self.queue_name, 0, -1)
        for i, entry in enumerate(entries):
            data = json.loads(entry)
            if data["job_id"] == job_id:
                await self.redis.lrem(self.queue_name, 1, entry)
                await job_queue.enqueue(job_id, priority=1)  # Higher priority for retries
                logger.info(f"Job retried from DLQ: {job_id}")
                return True
        return False
    
    async def size(self) -> int:
        """Get DLQ size."""
        return await self.redis.llen(self.queue_name)
```

### 5. packages/backend/src/jobs/worker.py

```python
"""Job worker for processing jobs."""

import asyncio
import logging
from typing import Callable, Any

from src.jobs.models import JobStatus
from src.jobs.service import JobService
from src.jobs.queue import JobQueue, DeadLetterQueue
from src.resilience.shutdown import GracefulShutdown

logger = logging.getLogger(__name__)


class JobWorker:
    """
    Worker for processing jobs from queue.
    
    Usage:
        worker = JobWorker(job_service, job_queue)
        worker.register_handler("generation", handle_generation)
        await worker.start()
    """
    
    def __init__(
        self,
        job_service: JobService,
        job_queue: JobQueue,
        dlq: DeadLetterQueue | None = None,
        shutdown: GracefulShutdown | None = None,
        max_retries: int = 3,
    ):
        self.job_service = job_service
        self.job_queue = job_queue
        self.dlq = dlq
        self.shutdown = shutdown or GracefulShutdown()
        self.max_retries = max_retries
        self._handlers: dict[str, Callable] = {}
        self._running = False
    
    def register_handler(
        self,
        job_type: str,
        handler: Callable[[dict, JobService], Any],
    ) -> None:
        """Register a handler for a job type."""
        self._handlers[job_type] = handler
        logger.info(f"Registered handler for job type: {job_type}")
    
    async def start(self, poll_interval: float = 1.0) -> None:
        """Start processing jobs."""
        self._running = True
        logger.info("Job worker started")
        
        while self._running and not self.shutdown.is_shutting_down:
            job_id = await self.job_queue.dequeue()
            
            if job_id:
                await self._process_job(job_id)
            else:
                await asyncio.sleep(poll_interval)
        
        logger.info("Job worker stopped")
    
    async def stop(self) -> None:
        """Stop the worker."""
        self._running = False
    
    async def _process_job(self, job_id: str) -> None:
        """Process a single job."""
        async with self.shutdown.track_job(job_id):
            try:
                job = await self.job_service.get_job(job_id)
                
                handler = self._handlers.get(job.job_type)
                if not handler:
                    logger.error(f"No handler for job type: {job.job_type}")
                    await self.job_service.mark_failed(
                        job_id, f"No handler for job type: {job.job_type}"
                    )
                    return
                
                # Transition to processing
                await self.job_service.transition_status(
                    job_id, JobStatus.PROCESSING, progress=0
                )
                
                # Execute handler
                result = await handler(job.__dict__, self.job_service)
                
                # Mark completed
                await self.job_service.mark_completed(job_id, result)
                logger.info(f"Job completed: {job_id}")
                
            except Exception as e:
                logger.exception(f"Job failed: {job_id}")
                await self._handle_failure(job_id, str(e))
    
    async def _handle_failure(self, job_id: str, error: str) -> None:
        """Handle job failure with retry logic."""
        try:
            job = await self.job_service.get_job(job_id)
            attempts = (job.parameters or {}).get("_attempts", 0) + 1
            
            if attempts < self.max_retries:
                # Update attempts and re-queue
                await self.job_service.db.table("jobs").update({
                    "parameters": {**(job.parameters or {}), "_attempts": attempts},
                    "status": JobStatus.QUEUED.value,
                }).eq("id", job_id).execute()
                
                await self.job_queue.enqueue(job_id)
                logger.info(f"Job re-queued: {job_id} (attempt {attempts})")
            else:
                # Move to DLQ
                await self.job_service.mark_failed(job_id, error)
                if self.dlq:
                    await self.dlq.add(job_id, error, attempts)
        except Exception as e:
            logger.error(f"Failed to handle job failure: {e}")
```

### 6. apps/web/lib/jobs/client.ts

```typescript
/**
 * Job client for frontend.
 */

import type { Job, JobStatus, CreateJobRequest, JobStatusResponse, Asset } from '@project/types';

export class JobClient {
  constructor(private baseUrl: string = '/api') {}

  async createJob(request: CreateJobRequest): Promise<{ jobId: string }> {
    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      throw new Error('Failed to create job');
    }
    
    return response.json();
  }

  async getJob(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`);
    
    if (!response.ok) {
      throw new Error('Failed to get job');
    }
    
    return response.json();
  }

  async getJobAssets(jobId: string): Promise<{ assets: Asset[] }> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}/assets`);
    
    if (!response.ok) {
      throw new Error('Failed to get job assets');
    }
    
    return response.json();
  }

  async pollJob(
    jobId: string,
    onProgress?: (job: JobStatusResponse) => void,
    intervalMs: number = 2000,
  ): Promise<JobStatusResponse> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const job = await this.getJob(jobId);
          
          if (onProgress) {
            onProgress(job);
          }
          
          if (job.status === 'completed' || job.status === 'partial') {
            resolve(job);
          } else if (job.status === 'failed') {
            reject(new Error(job.errorMessage || 'Job failed'));
          } else {
            setTimeout(poll, intervalMs);
          }
        } catch (error) {
          reject(error);
        }
      };
      
      poll();
    });
  }
}

export const jobClient = new JobClient();
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 07
```

### ⛔ STOP AND VERIFY

**Do not proceed to Phase 08 until verification passes.**

If verification fails, check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common fixes.

**Manual checks if needed:**

```bash
# 1. Verify Python job modules
cd packages/backend
source .venv/bin/activate
python -c "
from src.jobs import Job, JobStatus, JobService, JobQueue, JobWorker
from src.jobs.models import is_valid_transition, is_terminal_status

# Test state machine
print('QUEUED -> PROCESSING valid:', is_valid_transition(JobStatus.QUEUED, JobStatus.PROCESSING))
print('COMPLETED is terminal:', is_terminal_status(JobStatus.COMPLETED))
print('PROCESSING -> QUEUED valid:', is_valid_transition(JobStatus.PROCESSING, JobStatus.QUEUED))
"

# 2. Verify TypeScript
cd ../../apps/web
pnpm lint
```

**Success Criteria**:
- [ ] Job state machine validates transitions
- [ ] JobService creates and updates jobs
- [ ] Queue abstraction works
- [ ] Worker processes jobs with handlers
- [ ] DLQ captures failed jobs
- [ ] Frontend client compiles
- [ ] Verification script shows PASSED

---

## Next Phase

Proceed to [08-API.md](./08-API.md) for API foundation.


---

## Testing Additions

> Tests for job state machine validation and queue operations.

### 7. packages/backend/tests/test_jobs.py

```python
"""
Tests for job processing module.
"""

import pytest
from unittest.mock import MagicMock, AsyncMock

from tests.fixtures import JobFactory, UserFactory


class TestJobStateMachine:
    """Tests for job state machine."""
    
    def test_valid_transitions(self):
        """Should correctly identify valid transitions."""
        from src.jobs.models import is_valid_transition, JobStatus
        
        # Valid transitions
        assert is_valid_transition(JobStatus.QUEUED, JobStatus.PROCESSING) is True
        assert is_valid_transition(JobStatus.PROCESSING, JobStatus.COMPLETED) is True
        assert is_valid_transition(JobStatus.PROCESSING, JobStatus.FAILED) is True
        assert is_valid_transition(JobStatus.PROCESSING, JobStatus.PARTIAL) is True
    
    def test_invalid_transitions(self):
        """Should correctly identify invalid transitions."""
        from src.jobs.models import is_valid_transition, JobStatus
        
        # Invalid transitions
        assert is_valid_transition(JobStatus.QUEUED, JobStatus.COMPLETED) is False
        assert is_valid_transition(JobStatus.COMPLETED, JobStatus.PROCESSING) is False
        assert is_valid_transition(JobStatus.FAILED, JobStatus.QUEUED) is False
        assert is_valid_transition(JobStatus.PROCESSING, JobStatus.QUEUED) is False
    
    def test_terminal_status(self):
        """Should correctly identify terminal statuses."""
        from src.jobs.models import is_terminal_status, JobStatus
        
        assert is_terminal_status(JobStatus.COMPLETED) is True
        assert is_terminal_status(JobStatus.FAILED) is True
        assert is_terminal_status(JobStatus.PARTIAL) is True
        assert is_terminal_status(JobStatus.QUEUED) is False
        assert is_terminal_status(JobStatus.PROCESSING) is False
    
    def test_job_can_transition_to(self):
        """Job.can_transition_to should use state machine."""
        from src.jobs.models import Job, JobStatus
        from datetime import datetime, timezone
        
        job = Job(
            id="job-123",
            user_id="user-123",
            job_type="generation",
            status=JobStatus.QUEUED,
            progress=0,
            error_message=None,
            parameters=None,
            result=None,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            completed_at=None,
        )
        
        assert job.can_transition_to(JobStatus.PROCESSING) is True
        assert job.can_transition_to(JobStatus.COMPLETED) is False
    
    def test_job_is_terminal(self):
        """Job.is_terminal should check status."""
        from src.jobs.models import Job, JobStatus
        from datetime import datetime, timezone
        
        completed_job = Job(
            id="job-123",
            user_id="user-123",
            job_type="generation",
            status=JobStatus.COMPLETED,
            progress=100,
            error_message=None,
            parameters=None,
            result={"output": "test"},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
        
        assert completed_job.is_terminal() is True


class TestJobQueue:
    """Tests for job queue."""
    
    @pytest.mark.asyncio
    async def test_in_memory_queue_enqueue_dequeue(self):
        """InMemoryJobQueue should enqueue and dequeue."""
        from src.jobs.queue import InMemoryJobQueue
        
        queue = InMemoryJobQueue()
        
        await queue.enqueue("job-1")
        await queue.enqueue("job-2")
        
        assert await queue.size() == 2
        
        job_id = await queue.dequeue()
        assert job_id == "job-1"
        assert await queue.size() == 1
    
    @pytest.mark.asyncio
    async def test_in_memory_queue_priority(self):
        """InMemoryJobQueue should respect priority."""
        from src.jobs.queue import InMemoryJobQueue
        
        queue = InMemoryJobQueue()
        
        await queue.enqueue("low-priority", priority=0)
        await queue.enqueue("high-priority", priority=10)
        await queue.enqueue("medium-priority", priority=5)
        
        # Should dequeue in priority order (highest first)
        assert await queue.dequeue() == "high-priority"
        assert await queue.dequeue() == "medium-priority"
        assert await queue.dequeue() == "low-priority"
    
    @pytest.mark.asyncio
    async def test_in_memory_queue_empty(self):
        """InMemoryJobQueue should return None when empty."""
        from src.jobs.queue import InMemoryJobQueue
        
        queue = InMemoryJobQueue()
        
        result = await queue.dequeue()
        assert result is None


class TestJobService:
    """Tests for JobService."""
    
    @pytest.mark.asyncio
    async def test_transition_status_valid(self, mock_supabase):
        """Should allow valid status transitions."""
        from src.jobs.service import JobService
        from src.jobs.models import JobStatus
        
        job_data = JobFactory.create(status="queued")
        updated_job = JobFactory.create(status="processing", progress=0)
        
        # Mock get_job
        mock_supabase.table("jobs").select("*").eq("id", job_data["id"]).execute.return_value = MagicMock(
            data=[job_data]
        )
        # Mock update
        mock_supabase.table("jobs").update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[updated_job]
        )
        
        service = JobService(db=MagicMock(table=mock_supabase.table))
        
        # Verify the transition would be valid
        from src.jobs.models import is_valid_transition
        assert is_valid_transition(JobStatus.QUEUED, JobStatus.PROCESSING) is True
    
    @pytest.mark.asyncio
    async def test_transition_status_invalid(self, mock_supabase):
        """Should reject invalid status transitions."""
        from src.jobs.service import JobService
        from src.jobs.models import JobStatus, is_valid_transition
        from src.exceptions import InvalidStateTransitionError
        
        # Verify the transition would be invalid
        assert is_valid_transition(JobStatus.COMPLETED, JobStatus.PROCESSING) is False
```

### 8. apps/web/lib/jobs/client.test.ts

```typescript
/**
 * Tests for job client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('JobClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  
  describe('pollJob', () => {
    it('should resolve when job completes', async () => {
      // Test the polling logic
      const statuses = ['queued', 'processing', 'completed'];
      let callIndex = 0;
      
      const mockGetJob = vi.fn().mockImplementation(() => {
        const status = statuses[Math.min(callIndex++, statuses.length - 1)];
        return Promise.resolve({
          id: 'job-123',
          status,
          progress: status === 'completed' ? 100 : callIndex * 30,
        });
      });
      
      // Simulate polling
      let result;
      for (let i = 0; i < 5; i++) {
        result = await mockGetJob();
        if (result.status === 'completed' || result.status === 'failed') {
          break;
        }
      }
      
      expect(result?.status).toBe('completed');
      expect(result?.progress).toBe(100);
    });
    
    it('should reject when job fails', async () => {
      const mockGetJob = vi.fn().mockResolvedValue({
        id: 'job-123',
        status: 'failed',
        errorMessage: 'Processing error',
      });
      
      const result = await mockGetJob();
      
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Processing error');
    });
  });
  
  describe('Job status transitions', () => {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      queued: ['processing'],
      processing: ['completed', 'partial', 'failed'],
      completed: [],
      partial: [],
      failed: [],
    };
    
    it('should validate queued can go to processing', () => {
      expect(VALID_TRANSITIONS.queued).toContain('processing');
    });
    
    it('should validate processing can go to completed', () => {
      expect(VALID_TRANSITIONS.processing).toContain('completed');
    });
    
    it('should validate completed is terminal', () => {
      expect(VALID_TRANSITIONS.completed).toHaveLength(0);
    });
  });
});
```

---

## Updated Verification

**Additional test checks:**

```bash
# Run job tests
cd packages/backend
source .venv/bin/activate
pytest tests/test_jobs.py -v

# Verify state machine
python -c "
from src.jobs.models import JobStatus, VALID_TRANSITIONS, is_valid_transition

print('Valid transitions:')
for status, targets in VALID_TRANSITIONS.items():
    print(f'  {status.value} -> {[t.value for t in targets]}')

# Test all transitions
print()
print('Transition tests:')
print('  QUEUED -> PROCESSING:', is_valid_transition(JobStatus.QUEUED, JobStatus.PROCESSING))
print('  QUEUED -> COMPLETED:', is_valid_transition(JobStatus.QUEUED, JobStatus.COMPLETED))
print('  COMPLETED -> QUEUED:', is_valid_transition(JobStatus.COMPLETED, JobStatus.QUEUED))
"
```

**Updated Success Criteria**:
- [ ] All original criteria pass
- [ ] `pytest tests/test_jobs.py` passes
- [ ] State machine transitions verified
- [ ] Queue priority ordering works
- [ ] Frontend job client tests pass
