from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatus
from app.models.queue import Queue
from app.models.project import Project
from app.models.worker_model import WorkerModel, WorkerStatus
from app.schemas.dashboard import SystemMetrics, ActivityEvent, QueueHealth
from app.config import settings


async def get_system_metrics(db: AsyncSession) -> SystemMetrics:
    # Job counts by status
    result = await db.execute(
        select(Job.status, func.count(Job.id).label("cnt")).group_by(Job.status)
    )
    rows = result.all()
    counts = {row.status: row.cnt for row in rows}

    total = sum(counts.values())
    completed = counts.get(JobStatus.completed, 0)
    failed = counts.get(JobStatus.failed, 0)
    error_rate = failed / (completed + failed) if (completed + failed) > 0 else 0.0

    # Jobs completed in last 60 seconds → jobs/min
    since = datetime.utcnow() - timedelta(seconds=60)
    jpm_result = await db.execute(
        select(func.count(Job.id)).where(
            Job.status == JobStatus.completed,
            Job.completed_at >= since,
        )
    )
    jobs_per_min = float(jpm_result.scalar_one() or 0)

    # Worker counts
    w_result = await db.execute(
        select(WorkerModel.status, func.count(WorkerModel.id).label("cnt")).group_by(WorkerModel.status)
    )
    w_counts = {row.status: row.cnt for row in w_result.all()}
    total_workers = sum(w_counts.values())
    offline_workers = w_counts.get(WorkerStatus.offline, 0)
    active_workers = total_workers - offline_workers

    queue_count_result = await db.execute(select(func.count(Queue.id)))
    total_queues = queue_count_result.scalar_one() or 0

    return SystemMetrics(
        total_jobs=total,
        queued=counts.get(JobStatus.queued, 0),
        scheduled=counts.get(JobStatus.scheduled, 0),
        running=counts.get(JobStatus.running, 0),
        completed=completed,
        failed=failed,
        dead=counts.get(JobStatus.dead, 0),
        cancelled=counts.get(JobStatus.cancelled, 0),
        claimed=counts.get(JobStatus.claimed, 0),
        total_queues=total_queues,
        total_workers=total_workers,
        active_workers=active_workers,
        offline_workers=offline_workers,
        jobs_per_minute=jobs_per_min,
        error_rate=round(error_rate, 4),
    )


async def get_queue_health(db: AsyncSession) -> List[QueueHealth]:
    result = await db.execute(
        select(Queue, Project).join(Project, Queue.project_id == Project.id)
    )
    queue_project_pairs = result.all()

    health_list = []
    for queue, project in queue_project_pairs:
        # Count jobs by status for this queue
        counts_result = await db.execute(
            select(Job.status, func.count(Job.id).label("cnt"))
            .where(Job.queue_id == queue.id)
            .group_by(Job.status)
        )
        counts = {row.status: row.cnt for row in counts_result.all()}
        completed = counts.get(JobStatus.completed, 0)
        failed = counts.get(JobStatus.failed, 0)
        error_rate = failed / (completed + failed) if (completed + failed) > 0 else 0.0

        health_list.append(QueueHealth(
            queue_id=queue.id,
            queue_name=queue.name,
            project_name=project.name,
            queued=counts.get(JobStatus.queued, 0),
            running=counts.get(JobStatus.running, 0),
            completed=completed,
            failed=failed,
            dead=counts.get(JobStatus.dead, 0),
            error_rate=round(error_rate, 4),
            is_paused=queue.is_paused,
        ))
    return health_list


async def get_recent_activity(db: AsyncSession, limit: int = 20) -> List[ActivityEvent]:
    result = await db.execute(
        select(Job, Queue)
        .join(Queue, Job.queue_id == Queue.id)
        .order_by(Job.created_at.desc())
        .limit(limit)
    )
    rows = result.all()
    events = []
    for job, queue in rows:
        ts = job.completed_at or job.started_at or job.created_at
        events.append(ActivityEvent(
            job_id=job.id,
            job_name=job.name,
            queue_name=queue.name,
            status=job.status.value if hasattr(job.status, "value") else str(job.status),
            timestamp=ts.isoformat() if ts else "",
            worker_id=job.worker_id,
        ))
    return events
