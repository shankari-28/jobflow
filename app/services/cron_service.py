"""
cron_service.py — APScheduler integration.

Responsibilities:
1. Register all active ScheduledJobs (cron) with APScheduler on startup
2. Run every 10s: promote scheduled jobs whose time has arrived → queued
3. Run every 10s: re-enqueue failed jobs whose retry delay elapsed
4. Run every 30s: mark stale workers offline; requeue orphaned claimed jobs
"""
import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.scheduled_job import ScheduledJob
from app.models.job import JobType
from app.models.worker_model import WorkerModel, WorkerStatus
from app.services import job_service
from app.config import settings

logger = logging.getLogger("cron_service")
scheduler = AsyncIOScheduler()


# ---------------------------------------------------------------------------
# Background polling tasks
# ---------------------------------------------------------------------------

async def _promote_scheduled_task():
    async with AsyncSessionLocal() as db:
        async with db.begin():
            n = await job_service.promote_scheduled_jobs(db)
            if n:
                logger.info(f"Promoted {n} scheduled jobs → queued")


async def _requeue_retries_task():
    async with AsyncSessionLocal() as db:
        async with db.begin():
            n = await job_service.requeue_ready_retries(db)
            if n:
                logger.info(f"Re-enqueued {n} failed jobs for retry")


async def _watchdog_task():
    """Mark stale workers offline and requeue their orphaned jobs."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            # Mark stale workers offline
            stale_cutoff = datetime.utcnow() - __import__("datetime").timedelta(
                seconds=settings.WORKER_STALE_SECONDS
            )
            result = await db.execute(
                select(WorkerModel).where(
                    WorkerModel.last_heartbeat_at < stale_cutoff,
                    WorkerModel.status != WorkerStatus.offline,
                )
            )
            stale_workers = result.scalars().all()
            for w in stale_workers:
                w.status = WorkerStatus.offline
                logger.warning(f"Worker {w.name} ({w.id}) marked offline (stale heartbeat)")

            # Requeue orphaned claimed jobs
            n = await job_service.requeue_orphaned_jobs(db, settings.WORKER_STALE_SECONDS)
            if n:
                logger.warning(f"Requeued {n} orphaned claimed jobs")


# ---------------------------------------------------------------------------
# Cron job firing
# ---------------------------------------------------------------------------

async def _fire_cron_job(scheduled_job_id: str):
    """Create a child job for a cron-scheduled job."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == scheduled_job_id))
            sj = result.scalar_one_or_none()
            if not sj or not sj.is_active:
                return

            await job_service.enqueue_job(
                db=db,
                queue_id=sj.queue_id,
                name=sj.name,
                payload=sj.payload or {},
                job_type=JobType.immediate,
                scheduled_job_id=sj.id,
            )
            sj.last_run_at = datetime.utcnow()
            logger.info(f"Cron job '{sj.name}' fired → new child job created")


def register_cron_job(scheduled_job: ScheduledJob):
    """Register a cron ScheduledJob with APScheduler."""
    if not scheduled_job.cron_expression:
        return
    job_id = f"cron_{scheduled_job.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    try:
        trigger = CronTrigger.from_crontab(scheduled_job.cron_expression)
        scheduler.add_job(
            _fire_cron_job,
            trigger=trigger,
            id=job_id,
            args=[scheduled_job.id],
            replace_existing=True,
        )
        logger.info(f"Registered cron job '{scheduled_job.name}' ({scheduled_job.cron_expression})")
    except Exception as e:
        logger.error(f"Failed to register cron job {scheduled_job.id}: {e}")


def unregister_cron_job(scheduled_job_id: str):
    job_id = f"cron_{scheduled_job_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

async def start_scheduler():
    """Load all active cron jobs from DB and start APScheduler."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ScheduledJob).where(
                ScheduledJob.is_active.is_(True),
                ScheduledJob.cron_expression.isnot(None),
            )
        )
        cron_jobs = result.scalars().all()
        for sj in cron_jobs:
            register_cron_job(sj)

    # Register background polling tasks
    scheduler.add_job(
        _promote_scheduled_task, "interval",
        seconds=settings.SCHEDULER_INTERVAL_SECONDS,
        id="promote_scheduled", replace_existing=True,
    )
    scheduler.add_job(
        _requeue_retries_task, "interval",
        seconds=settings.SCHEDULER_INTERVAL_SECONDS,
        id="requeue_retries", replace_existing=True,
    )
    scheduler.add_job(
        _watchdog_task, "interval",
        seconds=30,
        id="watchdog", replace_existing=True,
    )

    scheduler.start()
    logger.info("APScheduler started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
    logger.info("APScheduler stopped")
