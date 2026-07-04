"""
job_service.py — Core job lifecycle management.

Critical function: claim_next_job() uses SELECT FOR UPDATE SKIP LOCKED
to guarantee atomic, exactly-once job claiming across multiple worker processes.
"""
import traceback
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import HTTPException
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatus, JobType
from app.models.job_execution import JobExecution, ExecutionStatus
from app.models.job_log import JobLog, LogLevel
from app.models.queue import Queue
from app.models.dead_letter_queue import DeadLetterQueue
from app.models.scheduled_job import ScheduledJob
from app.services.retry_service import compute_next_retry_at, should_retry


# ---------------------------------------------------------------------------
# Enqueueing
# ---------------------------------------------------------------------------

async def enqueue_job(
    db: AsyncSession,
    queue_id: str,
    name: str,
    payload: dict,
    job_type: str = "immediate",
    priority: int = 0,
    delay_seconds: Optional[int] = None,
    scheduled_at: Optional[datetime] = None,
    cron_expression: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    max_retries_override: Optional[int] = None,
    scheduled_job_id: Optional[str] = None,
) -> Job:
    """Enqueue a job. Handles immediate, delayed, scheduled, and recurring types."""

    # Idempotency check
    if idempotency_key:
        existing = await db.execute(select(Job).where(Job.idempotency_key == idempotency_key))
        existing_job = existing.scalar_one_or_none()
        if existing_job:
            return existing_job

    # Fetch queue to get retry policy
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(status_code=404, detail=f"Queue {queue_id} not found")

    # Determine initial status and scheduled_at
    status = JobStatus.queued
    run_at = None

    if job_type == "delayed" and delay_seconds:
        run_at = datetime.utcnow() + timedelta(seconds=delay_seconds)
        status = JobStatus.scheduled

    elif job_type == "scheduled" and scheduled_at:
        run_at = scheduled_at
        status = JobStatus.scheduled

    elif job_type == "recurring":
        # Recurring jobs are managed via ScheduledJob; child jobs are immediate
        status = JobStatus.queued

    # Get retry settings from queue's policy (if any)
    retry_strategy = "exponential"
    base_delay_ms = 1000
    max_delay_ms = 60000
    jitter_ms = 0
    max_retries = 3

    if queue.retry_policy:
        retry_strategy = queue.retry_policy.strategy.value
        base_delay_ms = queue.retry_policy.base_delay_ms
        max_delay_ms = queue.retry_policy.max_delay_ms
        jitter_ms = queue.retry_policy.jitter_ms
        max_retries = queue.retry_policy.max_retries

    if max_retries_override is not None:
        max_retries = max_retries_override

    job = Job(
        queue_id=queue_id,
        name=name,
        payload=payload or {},
        status=status,
        job_type=job_type,
        priority=priority,
        max_retries=max_retries,
        retry_strategy=retry_strategy,
        base_delay_ms=base_delay_ms,
        max_delay_ms=max_delay_ms,
        jitter_ms=jitter_ms,
        scheduled_at=run_at,
        idempotency_key=idempotency_key,
        scheduled_job_id=scheduled_job_id,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    return job


async def enqueue_batch(db: AsyncSession, queue_id: str, jobs_data: list) -> List[Job]:
    jobs = []
    for jd in jobs_data:
        job = await enqueue_job(db, queue_id, **jd)
        jobs.append(job)
    return jobs


# ---------------------------------------------------------------------------
# Atomic Claiming — the distributed core
# ---------------------------------------------------------------------------

async def claim_next_job(db: AsyncSession, worker_id: str) -> Optional[Job]:
    """
    Atomically claim one queued job across ALL non-paused queues.

    Uses SELECT ... FOR UPDATE SKIP LOCKED (MySQL 8.0+):
    - Multiple worker processes can call this concurrently
    - Each row is locked by exactly one transaction
    - SKIP LOCKED means other workers skip already-locked rows instantly
    - No deadlocks, no duplicate processing

    NOTE: Caller must wrap this in `async with db.begin()` to hold the lock.
    """
    result = await db.execute(
        select(Job)
        .join(Queue, Job.queue_id == Queue.id)
        .where(
            Job.status == JobStatus.queued,
            Queue.is_paused.is_(False),
        )
        .order_by(Job.priority.desc(), Job.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = result.scalar_one_or_none()
    if not job:
        return None

    job.status = JobStatus.claimed
    job.worker_id = worker_id
    await db.flush()

    return job


# ---------------------------------------------------------------------------
# Execution lifecycle
# ---------------------------------------------------------------------------

async def begin_execution(db: AsyncSession, job: Job, worker_id: str) -> JobExecution:
    """Transition job to running, create execution record."""
    job.status = JobStatus.running
    job.started_at = job.started_at or datetime.utcnow()
    await db.flush()

    execution = JobExecution(
        job_id=job.id,
        worker_id=worker_id,
        attempt_number=job.retry_count + 1,
        status=ExecutionStatus.running,
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.flush()
    await db.refresh(execution)
    return execution


async def complete_execution(db: AsyncSession, job: Job, execution: JobExecution) -> None:
    """Mark job and execution as completed."""
    now = datetime.utcnow()
    execution.status = ExecutionStatus.completed
    execution.finished_at = now
    execution.duration_ms = int((now - execution.started_at).total_seconds() * 1000)

    job.status = JobStatus.completed
    job.completed_at = now
    job.worker_id = None
    await db.flush()


async def fail_execution(
    db: AsyncSession,
    job: Job,
    execution: JobExecution,
    error: str,
    tb: Optional[str] = None,
) -> None:
    """
    Mark execution as failed. Either schedule a retry or promote to DLQ.
    """
    now = datetime.utcnow()
    execution.status = ExecutionStatus.failed
    execution.finished_at = now
    execution.duration_ms = int((now - execution.started_at).total_seconds() * 1000)
    execution.error_message = error
    execution.error_traceback = tb

    job.retry_count += 1
    job.worker_id = None

    if should_retry(job.retry_count, job.max_retries):
        # Schedule retry
        job.status = JobStatus.failed
        job.next_retry_at = compute_next_retry_at(
            strategy=job.retry_strategy,
            base_delay_ms=job.base_delay_ms,
            max_delay_ms=job.max_delay_ms,
            jitter_ms=job.jitter_ms,
            attempt=job.retry_count,
        )
    else:
        # Promote to dead + DLQ
        job.status = JobStatus.dead
        dlq = DeadLetterQueue(
            job_id=job.id,
            queue_id=job.queue_id,
            original_payload=job.payload,
            failure_reason=error,
            failure_traceback=tb,
            retry_count=job.retry_count,
        )
        db.add(dlq)

    await db.flush()


# ---------------------------------------------------------------------------
# Scheduled job promotion (called by APScheduler every N seconds)
# ---------------------------------------------------------------------------

async def promote_scheduled_jobs(db: AsyncSession) -> int:
    """Move scheduled jobs whose time has arrived → queued. Pure app logic, no DDL tricks."""
    now = datetime.utcnow()
    result = await db.execute(
        select(Job).where(
            Job.status == JobStatus.scheduled,
            Job.scheduled_at <= now,
        ).with_for_update(skip_locked=True)
    )
    jobs = result.scalars().all()
    for job in jobs:
        job.status = JobStatus.queued
        job.scheduled_at = None
    await db.flush()
    return len(jobs)


async def requeue_ready_retries(db: AsyncSession) -> int:
    """Re-enqueue failed jobs whose retry delay has elapsed."""
    now = datetime.utcnow()
    result = await db.execute(
        select(Job).where(
            Job.status == JobStatus.failed,
            Job.retry_count < Job.max_retries,
            Job.next_retry_at <= now,
        ).with_for_update(skip_locked=True)
    )
    jobs = result.scalars().all()
    for job in jobs:
        job.status = JobStatus.queued
        job.next_retry_at = None
    await db.flush()
    return len(jobs)


async def requeue_orphaned_jobs(db: AsyncSession, stale_seconds: int) -> int:
    """
    Re-enqueue jobs stuck in 'claimed' state whose worker has gone offline.
    Called by the heartbeat watchdog.
    """
    stale_cutoff = datetime.utcnow() - timedelta(seconds=stale_seconds)
    from app.models.worker_model import WorkerModel
    result = await db.execute(
        select(Job)
        .join(WorkerModel, Job.worker_id == WorkerModel.id)
        .where(
            Job.status == JobStatus.claimed,
            WorkerModel.last_heartbeat_at < stale_cutoff,
        )
        .with_for_update(skip_locked=True)
    )
    jobs = result.scalars().all()
    for job in jobs:
        job.status = JobStatus.queued
        job.worker_id = None
    await db.flush()
    return len(jobs)


# ---------------------------------------------------------------------------
# Logging helper (writes inside existing execution)
# ---------------------------------------------------------------------------

async def log_job_event(
    db: AsyncSession,
    job_id: str,
    execution_id: str,
    level: str,
    message: str,
    metadata: Optional[dict] = None,
) -> None:
    log = JobLog(
        job_id=job_id,
        execution_id=execution_id,
        level=level,
        message=message,
        metadata_=metadata,
    )
    db.add(log)
    await db.flush()


# ---------------------------------------------------------------------------
# Manual operations
# ---------------------------------------------------------------------------

async def cancel_job(db: AsyncSession, job_id: str) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.queued, JobStatus.scheduled):
        raise HTTPException(status_code=409, detail=f"Cannot cancel job in status '{job.status}'")
    job.status = JobStatus.cancelled
    await db.flush()
    return job


async def retry_job_manually(db: AsyncSession, job_id: str) -> Job:
    """Re-enqueue a failed or dead job for manual retry."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.failed, JobStatus.dead, JobStatus.cancelled):
        raise HTTPException(status_code=409, detail=f"Cannot retry job in status '{job.status}'")
    job.status = JobStatus.queued
    job.next_retry_at = None
    job.worker_id = None
    await db.flush()
    return job


async def requeue_from_dlq(db: AsyncSession, dlq_id: str) -> Job:
    result = await db.execute(select(DeadLetterQueue).where(DeadLetterQueue.id == dlq_id))
    dlq = result.scalar_one_or_none()
    if not dlq:
        raise HTTPException(status_code=404, detail="DLQ entry not found")

    job_result = await db.execute(select(Job).where(Job.id == dlq.job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Original job not found")

    job.status = JobStatus.queued
    job.retry_count = 0
    job.next_retry_at = None
    job.worker_id = None
    dlq.requeued_at = datetime.utcnow()
    await db.flush()
    return job
