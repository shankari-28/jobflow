from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.job import Job, JobStatus, JobType
from app.models.job_execution import JobExecution
from app.models.job_log import JobLog
from app.models.queue import Queue
from app.models.scheduled_job import ScheduledJob
from app.schemas.job import (
    JobCreate, BatchJobCreate, JobOut, JobExecutionOut, JobLogOut, DLQEntryOut
)
from app.services import job_service
from app.services.cron_service import register_cron_job
from datetime import datetime

router = APIRouter(tags=["Jobs"])


def _job_out(job: Job) -> dict:
    return {
        "id": job.id,
        "queue_id": job.queue_id,
        "worker_id": job.worker_id,
        "scheduled_job_id": job.scheduled_job_id,
        "name": job.name,
        "payload": job.payload,
        "status": job.status.value if hasattr(job.status, "value") else str(job.status),
        "job_type": job.job_type.value if hasattr(job.job_type, "value") else str(job.job_type),
        "priority": job.priority,
        "max_retries": job.max_retries,
        "retry_count": job.retry_count,
        "retry_strategy": job.retry_strategy,
        "base_delay_ms": job.base_delay_ms,
        "max_delay_ms": job.max_delay_ms,
        "jitter_ms": job.jitter_ms,
        "next_retry_at": job.next_retry_at.isoformat() if job.next_retry_at else None,
        "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "idempotency_key": job.idempotency_key,
    }


@router.get("/api/queues/{queue_id}/jobs", response_model=dict)
async def list_jobs(
    queue_id: str,
    db: DBSession,
    current_user: CurrentUser,
    status: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = select(Job).where(Job.queue_id == queue_id)
    if status:
        query = query.where(Job.status == status)
    if job_type:
        query = query.where(Job.job_type == job_type)
    query = query.order_by(Job.created_at.desc())

    # Count total
    from sqlalchemy import func
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    result = await db.execute(query)
    jobs = result.scalars().all()

    return {
        "success": True,
        "data": [_job_out(j) for j in jobs],
        "meta": {"page": page, "page_size": page_size, "total": total, "pages": (total + page_size - 1) // page_size},
    }


@router.post("/api/queues/{queue_id}/jobs", response_model=dict, status_code=201)
async def create_job(queue_id: str, body: JobCreate, db: DBSession, current_user: CurrentUser):
    # Handle recurring: create a ScheduledJob + register with APScheduler
    if body.job_type == "recurring":
        if not body.cron_expression:
            raise HTTPException(422, "cron_expression required for recurring jobs")
        sj = ScheduledJob(
            queue_id=queue_id,
            name=body.name,
            payload=body.payload or {},
            cron_expression=body.cron_expression,
        )
        db.add(sj)
        await db.flush()
        await db.refresh(sj)
        register_cron_job(sj)
        return {"success": True, "data": {"scheduled_job_id": sj.id, "type": "recurring", "cron": body.cron_expression}}

    job = await job_service.enqueue_job(
        db=db,
        queue_id=queue_id,
        name=body.name,
        payload=body.payload or {},
        job_type=body.job_type,
        priority=body.priority,
        delay_seconds=body.delay_seconds,
        scheduled_at=body.scheduled_at,
        idempotency_key=body.idempotency_key,
        max_retries_override=body.max_retries,
    )
    return {"success": True, "data": _job_out(job)}


@router.post("/api/queues/{queue_id}/jobs/batch", response_model=dict, status_code=201)
async def create_batch_jobs(queue_id: str, body: BatchJobCreate, db: DBSession, current_user: CurrentUser):
    jobs = []
    for jc in body.jobs:
        job = await job_service.enqueue_job(
            db=db,
            queue_id=queue_id,
            name=jc.name,
            payload=jc.payload or {},
            job_type=jc.job_type,
            priority=jc.priority,
            delay_seconds=jc.delay_seconds,
            scheduled_at=jc.scheduled_at,
            idempotency_key=jc.idempotency_key,
            max_retries_override=jc.max_retries,
        )
        jobs.append(_job_out(job))
    return {"success": True, "data": jobs, "meta": {"count": len(jobs)}}


@router.get("/api/jobs/{job_id}", response_model=dict)
async def get_job(job_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    return {"success": True, "data": _job_out(job)}


@router.post("/api/jobs/{job_id}/cancel", response_model=dict)
async def cancel_job(job_id: str, db: DBSession, current_user: CurrentUser):
    job = await job_service.cancel_job(db, job_id)
    return {"success": True, "data": _job_out(job)}


@router.post("/api/jobs/{job_id}/retry", response_model=dict)
async def retry_job(job_id: str, db: DBSession, current_user: CurrentUser):
    job = await job_service.retry_job_manually(db, job_id)
    return {"success": True, "data": _job_out(job)}


@router.get("/api/jobs/{job_id}/executions", response_model=dict)
async def get_executions(job_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(
        select(JobExecution)
        .where(JobExecution.job_id == job_id)
        .order_by(JobExecution.attempt_number.asc())
    )
    execs = result.scalars().all()
    data = []
    for e in execs:
        data.append({
            "id": e.id, "job_id": e.job_id, "worker_id": e.worker_id,
            "attempt_number": e.attempt_number,
            "status": e.status.value if hasattr(e.status, "value") else str(e.status),
            "started_at": e.started_at.isoformat() if e.started_at else None,
            "finished_at": e.finished_at.isoformat() if e.finished_at else None,
            "duration_ms": e.duration_ms,
            "error_message": e.error_message,
            "error_traceback": e.error_traceback,
        })
    return {"success": True, "data": data}


@router.get("/api/jobs/{job_id}/logs", response_model=dict)
async def get_logs(job_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(
        select(JobLog)
        .where(JobLog.job_id == job_id)
        .order_by(JobLog.logged_at.asc())
    )
    logs = result.scalars().all()
    data = []
    for log in logs:
        data.append({
            "id": log.id, "execution_id": log.execution_id, "job_id": log.job_id,
            "level": log.level.value if hasattr(log.level, "value") else str(log.level),
            "message": log.message,
            "metadata": log.metadata_,
            "logged_at": log.logged_at.isoformat() if log.logged_at else None,
        })
    return {"success": True, "data": data}


@router.get("/api/jobs", response_model=dict)
async def list_all_jobs(
    db: DBSession,
    current_user: CurrentUser,
    status: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    queue_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List all jobs across all queues with filtering and pagination."""
    from sqlalchemy import func
    query = select(Job)
    if status:
        query = query.where(Job.status == status)
    if job_type:
        query = query.where(Job.job_type == job_type)
    if queue_id:
        query = query.where(Job.queue_id == queue_id)
    query = query.order_by(Job.created_at.desc())

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    jobs = result.scalars().all()

    return {
        "success": True,
        "data": [_job_out(j) for j in jobs],
        "meta": {"page": page, "page_size": page_size, "total": total, "pages": (total + page_size - 1) // page_size},
    }
