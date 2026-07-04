"""
worker.py — Standalone worker process.

Run independently (multiple instances allowed):
    python worker.py --id worker-1 --concurrency 5
    python worker.py --id worker-2 --concurrency 5
    python worker.py --id worker-3 --concurrency 3

Each instance:
  1. Registers itself in the `workers` table
  2. Polls for queued jobs using SELECT FOR UPDATE SKIP LOCKED
  3. Executes jobs concurrently (bounded by --concurrency semaphore)
  4. Sends heartbeats every 5 seconds
  5. Writes job execution records and log lines
  6. Handles retries and DLQ promotion on failure
  7. Gracefully drains on SIGTERM/SIGINT

This proves distributed correctness: N independent processes compete for the
same jobs without duplicates, because SELECT FOR UPDATE SKIP LOCKED is atomic.
"""
import asyncio
import argparse
import logging
import os
import random
import signal
import socket
import traceback
import uuid
from datetime import datetime

import psutil
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.job import Job, JobStatus
from app.models.worker_model import WorkerModel, WorkerHeartbeat, WorkerStatus
from app.services.job_service import (
    claim_next_job,
    begin_execution,
    complete_execution,
    fail_execution,
    log_job_event,
)
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("worker")

# ---------------------------------------------------------------------------
# Job handler registry — simulates real job execution
# ---------------------------------------------------------------------------

async def handler_echo(payload: dict) -> dict:
    """Default handler: logs payload and succeeds immediately."""
    await asyncio.sleep(0.2)
    return {"result": "echoed", "payload_keys": list(payload.keys())}


async def handler_sleep(payload: dict) -> dict:
    """Sleeps for `duration_seconds` (default 2). Tests concurrency."""
    duration = float(payload.get("duration_seconds", 2))
    await asyncio.sleep(duration)
    return {"result": "slept", "duration_seconds": duration}


async def handler_fail(payload: dict) -> dict:
    """Always raises an exception. Tests retry and DLQ logic."""
    reason = payload.get("reason", "Intentional failure for testing")
    raise ValueError(f"handler_fail: {reason}")


async def handler_flaky(payload: dict) -> dict:
    """Fails with probability `fail_rate` (default 0.5). Tests retry logic."""
    fail_rate = float(payload.get("fail_rate", 0.5))
    await asyncio.sleep(0.3)
    if random.random() < fail_rate:
        raise RuntimeError(f"Flaky job failed (rate={fail_rate})")
    return {"result": "flaky_succeeded", "fail_rate": fail_rate}


async def handler_cpu(payload: dict) -> dict:
    """Simulates CPU-bound work."""
    iterations = int(payload.get("iterations", 100000))
    result = sum(i * i for i in range(iterations))
    return {"result": "cpu_done", "iterations": iterations, "checksum": result % 1000000}


HANDLERS = {
    "echo": handler_echo,
    "sleep": handler_sleep,
    "fail": handler_fail,
    "flaky": handler_flaky,
    "cpu": handler_cpu,
}


async def dispatch_job(payload: dict) -> dict:
    """Dispatch to the appropriate handler based on payload['__handler']."""
    handler_name = payload.get("__handler", "echo")
    handler = HANDLERS.get(handler_name, handler_echo)
    return await handler(payload)


# ---------------------------------------------------------------------------
# Worker class
# ---------------------------------------------------------------------------

class Worker:
    def __init__(self, worker_id: str, name: str, concurrency: int, poll_interval: float):
        self.id = worker_id
        self.name = name
        self.concurrency = concurrency
        self.poll_interval = poll_interval
        self.hostname = socket.gethostname()
        self.pid = os.getpid()
        self.shutdown_event = asyncio.Event()
        self.semaphore = asyncio.Semaphore(concurrency)
        self.jobs_completed = 0
        self.active_tasks: set = set()

    async def register(self):
        """Register this worker in the DB."""
        async with AsyncSessionLocal() as db:
            async with db.begin():
                existing = await db.execute(select(WorkerModel).where(WorkerModel.id == self.id))
                worker_row = existing.scalar_one_or_none()
                if worker_row:
                    worker_row.status = WorkerStatus.idle
                    worker_row.last_heartbeat_at = datetime.utcnow()
                    worker_row.hostname = self.hostname
                    worker_row.pid = self.pid
                else:
                    worker_row = WorkerModel(
                        id=self.id,
                        name=self.name,
                        hostname=self.hostname,
                        pid=self.pid,
                        status=WorkerStatus.idle,
                        concurrency=self.concurrency,
                    )
                    db.add(worker_row)
        logger.info(f"Worker '{self.name}' ({self.id}) registered | host={self.hostname} pid={self.pid}")

    async def deregister(self):
        """Mark this worker offline on shutdown."""
        async with AsyncSessionLocal() as db:
            async with db.begin():
                result = await db.execute(select(WorkerModel).where(WorkerModel.id == self.id))
                worker_row = result.scalar_one_or_none()
                if worker_row:
                    worker_row.status = WorkerStatus.offline

    async def heartbeat_loop(self):
        """Send heartbeats every WORKER_HEARTBEAT_INTERVAL seconds."""
        proc = psutil.Process()
        while not self.shutdown_event.is_set():
            try:
                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        result = await db.execute(select(WorkerModel).where(WorkerModel.id == self.id))
                        worker_row = result.scalar_one_or_none()
                        if worker_row:
                            jobs_running = len(self.active_tasks)
                            worker_row.last_heartbeat_at = datetime.utcnow()
                            worker_row.status = WorkerStatus.busy if jobs_running > 0 else WorkerStatus.idle

                            hb = WorkerHeartbeat(
                                worker_id=self.id,
                                jobs_running=jobs_running,
                                jobs_completed=self.jobs_completed,
                                cpu_percent=proc.cpu_percent(interval=None),
                                memory_mb=proc.memory_info().rss / 1024 / 1024,
                            )
                            db.add(hb)
            except Exception as e:
                logger.warning(f"Heartbeat error: {e}")
            await asyncio.sleep(settings.WORKER_HEARTBEAT_INTERVAL)

    async def execute_job(self, job_id: str):
        """Execute a single job: run handler, write execution record, handle retry/DLQ.

        Uses separate top-level AsyncSessionLocal() sessions for each step to avoid
        SQLAlchemy session/transaction scoping issues that caused jobs to get stuck in 'claimed'.
        """
        async with self.semaphore:
            task = asyncio.current_task()
            self.active_tasks.add(task)
            exec_id = None
            job_name = job_id  # fallback for logging

            try:
                # --- Step 1: Load job and transition claimed → running ---
                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        result = await db.execute(select(Job).where(Job.id == job_id))
                        job = result.scalar_one_or_none()
                        if not job:
                            logger.warning(f"Job {job_id} not found — skipping")
                            return
                        job_name = job.name
                        execution = await begin_execution(db, job, self.id)
                        exec_id = execution.id
                        attempt = execution.attempt_number

                logger.info(f"[{self.name}] START job={job_name} id={job_id} attempt={attempt}")

                # --- Step 2: Write start log ---
                async with AsyncSessionLocal() as log_db:
                    async with log_db.begin():
                        await log_job_event(log_db, job_id, exec_id, "info",
                                            f"Job started on worker {self.name}", {"worker": self.name})

                # --- Step 3: Run the actual handler (no DB session held) ---
                error_msg = None
                error_tb = None
                success = False
                try:
                    # Fetch payload fresh outside any session
                    async with AsyncSessionLocal() as pdb:
                        pr = await pdb.execute(select(Job).where(Job.id == job_id))
                        pj = pr.scalar_one()
                        payload = pj.payload or {}

                    await dispatch_job(payload)
                    success = True
                    logger.info(f"[{self.name}] DONE  job={job_name} id={job_id}")
                except Exception as exc:
                    error_msg = str(exc)
                    error_tb = traceback.format_exc()
                    logger.warning(f"[{self.name}] FAIL  job={job_name} id={job_id}: {error_msg}")

                # --- Step 4: Write outcome (complete or fail/retry/DLQ) ---
                from app.models.job_execution import JobExecution
                async with AsyncSessionLocal() as finish_db:
                    async with finish_db.begin():
                        j_result = await finish_db.execute(select(Job).where(Job.id == job_id))
                        j = j_result.scalar_one()
                        e_result = await finish_db.execute(
                            select(JobExecution).where(JobExecution.id == exec_id)
                        )
                        e = e_result.scalar_one()

                        if success:
                            await complete_execution(finish_db, j, e)
                            await log_job_event(finish_db, job_id, exec_id, "info",
                                                "Job completed successfully")
                            self.jobs_completed += 1
                        else:
                            await fail_execution(finish_db, j, e, error_msg, error_tb)
                            await log_job_event(finish_db, job_id, exec_id, "error",
                                                f"Job failed: {error_msg}",
                                                {"traceback": error_tb})

            except Exception as e:
                logger.exception(f"Unexpected error in execute_job({job_id}): {e}")
            finally:
                self.active_tasks.discard(task)

    async def poll_loop(self):
        """Continuously poll for jobs and dispatch them."""
        logger.info(f"[{self.name}] Poll loop started (concurrency={self.concurrency}, interval={self.poll_interval}s)")
        while not self.shutdown_event.is_set():
            try:
                # Check if we have capacity (don't block; semaphore managed in execute_job)
                if len(self.active_tasks) >= self.concurrency:
                    await asyncio.sleep(self.poll_interval)
                    continue

                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        job = await claim_next_job(db, self.id)

                if job:
                    task = asyncio.create_task(self.execute_job(job.id))
                    self.active_tasks.add(task)
                    task.add_done_callback(self.active_tasks.discard)
                else:
                    await asyncio.sleep(self.poll_interval)

            except Exception as e:
                logger.error(f"[{self.name}] Poll error: {e}")
                await asyncio.sleep(self.poll_interval)

    async def drain(self):
        """Wait for all in-flight jobs to complete."""
        if self.active_tasks:
            logger.info(f"[{self.name}] Draining {len(self.active_tasks)} in-flight jobs...")
            await asyncio.gather(*self.active_tasks, return_exceptions=True)
        logger.info(f"[{self.name}] Drain complete.")

    async def run(self):
        await self.register()
        loop = asyncio.get_running_loop()

        def _shutdown():
            logger.info(f"[{self.name}] Shutdown signal received — draining...")
            self.shutdown_event.set()

        try:
            loop.add_signal_handler(signal.SIGTERM, _shutdown)
            loop.add_signal_handler(signal.SIGINT, _shutdown)
        except NotImplementedError:
            # Fallback for Windows (loop.add_signal_handler is not implemented)
            import signal as sync_signal
            def sync_shutdown(signum, frame):
                logger.info(f"[{self.name}] Shutdown signal received (sync) — draining...")
                loop.call_soon_threadsafe(self.shutdown_event.set)
            
            try:
                sync_signal.signal(sync_signal.SIGTERM, sync_shutdown)
                sync_signal.signal(sync_signal.SIGINT, sync_shutdown)
            except ValueError:
                pass

        try:
            await asyncio.gather(
                self.poll_loop(),
                self.heartbeat_loop(),
            )
        finally:
            await self.drain()
            await self.deregister()
            logger.info(f"[{self.name}] Worker exited. Total jobs completed: {self.jobs_completed}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JobQueue Worker Process")
    parser.add_argument("--id", default=str(uuid.uuid4()), help="Unique worker ID (default: random UUID)")
    parser.add_argument("--name", default=None, help="Worker display name (default: worker-<id[:6]>)")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent jobs (default: 5)")
    parser.add_argument("--poll", type=float, default=settings.WORKER_POLL_INTERVAL, help="Poll interval in seconds")
    args = parser.parse_args()

    worker_name = args.name or f"worker-{args.id[:8]}"
    worker = Worker(
        worker_id=args.id,
        name=worker_name,
        concurrency=args.concurrency,
        poll_interval=args.poll,
    )

    asyncio.run(worker.run())
