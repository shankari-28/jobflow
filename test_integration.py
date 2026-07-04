import asyncio
import os
import sys
import uuid
import subprocess
import time
from sqlalchemy import select
from app.database import AsyncSessionLocal, engine
from app.config import settings
from app.models import *
from app.services import auth_service, job_service
from app.models.job import JobStatus
from app.models.job_execution import ExecutionStatus

async def test_lifecycle():
    print("==================================================")
    print("           RUNNING INTEGRATION TEST               ")
    print("==================================================")

    # 1. Initialize DB
    print("\n[1/6] Cleaning up and initializing database...")
    from init_db import main as init_db_main
    init_db_main()

    # 2. Register a user and auto-seed org/project
    print("\n[2/6] Registering test user...")
    test_email = f"test_{uuid.uuid4().hex[:6]}@example.com"
    test_user = "test_user_" + uuid.uuid4().hex[:6]
    test_password = "password123"

    async with AsyncSessionLocal() as db:
        user = await auth_service.create_user(db, test_email, test_user, test_password)
        print(f"User created: {user.username} ({user.email})")

        # Get the seeded project
        result = await db.execute(select(Project))
        project = result.scalars().first()
        if not project:
            print("ERROR: Seeded project not found!", file=sys.stderr)
            sys.exit(1)
        print(f"Auto-seeded Project found: {project.name} ({project.id})")

        # 3. Create a queue
        print("\n[3/6] Creating test queue...")
        queue = Queue(
            project_id=project.id,
            name="test-queue",
            description="Integration test queue",
            priority=10,
            concurrency_limit=5
        )
        db.add(queue)
        await db.flush()
        queue_id = queue.id
        print(f"Queue created: {queue.name} ({queue.id})")

        # 4. Enqueue immediate, delayed, and flaky/fail jobs
        print("\n[4/6] Enqueuing jobs...")
        # Job A: Echo success
        job_a = await job_service.enqueue_job(
            db, queue_id, "Echo Job",
            payload={"__handler": "echo", "msg": "hello"},
            job_type="immediate"
        )
        # Job B: Flaky/Failure -> retries -> DLQ
        job_b = await job_service.enqueue_job(
            db, queue_id, "Fail Job",
            payload={"__handler": "fail", "reason": "test error"},
            job_type="immediate",
            max_retries_override=1  # Fail immediately after 1 retry attempt to keep test fast
        )
        await db.commit()
        print(f"Job A (Success) enqueued: ID={job_a.id}")
        print(f"Job B (Fail -> DLQ) enqueued: ID={job_b.id}")

    # 5. Start standalone worker process in background
    print("\n[5/6] Starting worker process in background...")
    worker_id = f"worker-test-{uuid.uuid4().hex[:4]}"
    log_file = open("worker_test.log", "w", encoding="utf-8")
    worker_proc = subprocess.Popen(
        [sys.executable, "worker.py", "--id", worker_id, "--concurrency", "2", "--poll", "0.5"],
        stdout=log_file,
        stderr=log_file,
        text=True
    )
    print(f"Worker process started with PID={worker_proc.pid}")

    try:
        # Wait and poll job status from DB
        print("Polling job status until finished (max 15 seconds)...")
        success_a = False
        success_b = False

        for i in range(30):
            await asyncio.sleep(0.5)
            async with AsyncSessionLocal() as db:
                # Check Job A
                res_a = await db.execute(select(Job).where(Job.id == job_a.id))
                j_a = res_a.scalar_one()
                # Check Job B
                res_b = await db.execute(select(Job).where(Job.id == job_b.id))
                j_b = res_b.scalar_one()

                print(f"  [Time {i*0.5:.1f}s] Job A status: {j_a.status} | Job B status: {j_b.status}")

                if j_a.status == JobStatus.completed:
                    success_a = True
                if j_b.status == JobStatus.dead:
                    success_b = True

                if success_a and success_b:
                    print("\nAll jobs reached terminal status!")
                    break
        else:
            print("ERROR: Test timed out before jobs reached terminal status!", file=sys.stderr)

        # 6. Verify Execution Logs & DLQ
        print("\n[6/6] Verifying records in DB...")
        async with AsyncSessionLocal() as db:
            # Check executions
            exec_result = await db.execute(select(JobExecution).where(JobExecution.job_id == job_a.id))
            execs_a = exec_result.scalars().all()
            print(f"Job A executions found: {len(execs_a)}")
            for ex in execs_a:
                print(f"  Attempt {ex.attempt_number}: {ex.status} | duration={ex.duration_ms}ms")

            # Check logs
            log_result = await db.execute(select(JobLog).where(JobLog.job_id == job_a.id))
            logs_a = log_result.scalars().all()
            print(f"Job A execution logs found: {len(logs_a)}")
            for log in logs_a:
                print(f"  [{log.level.upper()}] {log.message}")

            # Check DLQ
            dlq_result = await db.execute(select(DeadLetterQueue).where(DeadLetterQueue.job_id == job_b.id))
            dlq_entry = dlq_result.scalar_one_or_none()
            if dlq_entry:
                print(f"Job B successfully promoted to DLQ! Reason: {dlq_entry.failure_reason}")
            else:
                print("ERROR: Job B not found in DLQ!", file=sys.stderr)

        if success_a and success_b and dlq_entry:
            print("\n==================================================")
            print("          INTEGRATION TEST PASSED!                ")
            print("==================================================")
        else:
            print("\n==================================================")
            print("          INTEGRATION TEST FAILED!                ")
            print("==================================================")

    finally:
        # Stop worker
        print("\nStopping worker process...")
        worker_proc.terminate()
        try:
            worker_proc.wait(timeout=3)
            print("Worker process exited gracefully.")
        except subprocess.TimeoutExpired:
            worker_proc.kill()
            print("Worker process force killed.")

if __name__ == "__main__":
    asyncio.run(test_lifecycle())
