"""
debug_worker.py — Runs worker logic DIRECTLY (not as subprocess) so errors print visibly.
"""
import asyncio
import uuid
import traceback
from datetime import datetime
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.job import Job, JobStatus
from app.models.queue import Queue
from app.models.worker_model import WorkerModel, WorkerHeartbeat, WorkerStatus
from app.models.job_execution import JobExecution
from app.services.job_service import (
    claim_next_job, begin_execution, complete_execution,
    fail_execution, log_job_event, enqueue_job
)
from app.services.auth_service import create_user
from app.models.organization import Organization, OrgMember, MemberRole
from app.models.project import Project


async def run():
    print("=== DIRECT WORKER DEBUG ===\n")

    # Seed data
    async with AsyncSessionLocal() as db:
        async with db.begin():
            # Create user + org + project if needed
            result = await db.execute(select(Project).limit(1))
            project = result.scalar_one_or_none()
            if not project:
                import re
                uid = str(uuid.uuid4())[:6]
                email = f"debug_{uid}@test.com"
                uname = f"debug_{uid}"
                from app.models.user import User
                from app.services.auth_service import hash_password
                user = User(email=email, username=uname, hashed_password=hash_password("password123"))
                db.add(user)
                await db.flush()
                org = Organization(name="Debug Org", slug=f"debug-org-{uid}", owner_id=user.id)
                db.add(org)
                await db.flush()
                project = Project(org_id=org.id, name="Debug Project", description="test")
                db.add(project)
                await db.flush()
            project_id = project.id
            print(f"Project: {project.name} ({project_id})")

            # Create queue
            queue = Queue(
                project_id=project_id,
                name=f"debug-queue-{uuid.uuid4().hex[:6]}",
                concurrency_limit=5,
                priority=0
            )
            db.add(queue)
            await db.flush()
            queue_id = queue.id
            print(f"Queue: {queue.name} ({queue_id})")

            # Enqueue test job
            job = Job(
                queue_id=queue_id,
                name="Debug Echo Job",
                payload={"__handler": "echo", "msg": "hello"},
                status=JobStatus.queued,
                job_type="immediate",
                priority=0,
                max_retries=3,
                retry_strategy="exponential",
                base_delay_ms=1000,
                max_delay_ms=60000,
                jitter_ms=0,
            )
            db.add(job)
            await db.flush()
            job_id = job.id
            print(f"Job enqueued: {job.name} ({job_id})")

    worker_id = f"debug-worker-{uuid.uuid4().hex[:6]}"
    print(f"\nWorker ID: {worker_id}")

    # Register worker
    async with AsyncSessionLocal() as db:
        async with db.begin():
            w = WorkerModel(
                id=worker_id, name="debug-worker",
                hostname="localhost", pid=0,
                status=WorkerStatus.idle, concurrency=5
            )
            db.add(w)
    print("Worker registered.")

    # Step 1: Claim
    print("\n--- Step 1: Claiming job ---")
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                claimed_job = await claim_next_job(db, worker_id)
        if claimed_job:
            print(f"Claimed job: {claimed_job.id} status={claimed_job.status}")
        else:
            print("No job to claim!")
            return
    except Exception as e:
        print(f"CLAIM ERROR: {e}")
        traceback.print_exc()
        return

    # Step 2: Begin execution
    print("\n--- Step 2: Begin execution (claimed → running) ---")
    exec_id = None
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                result = await db.execute(select(Job).where(Job.id == job_id))
                j = result.scalar_one()
                print(f"  Job status before begin_execution: {j.status}")
                execution = await begin_execution(db, j, worker_id)
                exec_id = execution.id
                print(f"  Execution created: {exec_id} status={execution.status}")
                # Check job status in same transaction
                result2 = await db.execute(select(Job).where(Job.id == job_id))
                j2 = result2.scalar_one()
                print(f"  Job status after begin_execution (in tx): {j2.status}")
    except Exception as e:
        print(f"BEGIN_EXECUTION ERROR: {e}")
        traceback.print_exc()
        return

    # Verify status committed
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        j = result.scalar_one()
        print(f"  Job status AFTER commit: {j.status}")

    # Step 3: Complete
    print("\n--- Step 3: Completing job ---")
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                j_res = await db.execute(select(Job).where(Job.id == job_id))
                j = j_res.scalar_one()
                e_res = await db.execute(select(JobExecution).where(JobExecution.id == exec_id))
                e = e_res.scalar_one()
                await complete_execution(db, j, e)
                print(f"  Job completed! status={j.status}")
    except Exception as e:
        print(f"COMPLETE_EXECUTION ERROR: {e}")
        traceback.print_exc()
        return

    # Final state
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        j = result.scalar_one()
        print(f"\nFINAL Job status: {j.status}")
        execs = await db.execute(select(JobExecution).where(JobExecution.job_id == job_id))
        all_execs = execs.scalars().all()
        print(f"Executions in DB: {len(all_execs)}")
        for ex in all_execs:
            print(f"  Attempt {ex.attempt_number}: {ex.status}")

    print("\n=== DEBUG COMPLETE ===")


if __name__ == "__main__":
    asyncio.run(run())
