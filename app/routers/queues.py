from fastapi import APIRouter, HTTPException
from sqlalchemy import select, func
from app.deps import DBSession, CurrentUser
from app.models.queue import Queue
from app.models.retry_policy import RetryPolicy
from app.models.project import Project
from app.models.job import Job, JobStatus
from app.schemas.queue import QueueCreate, QueueUpdate, QueueOut, QueueStats

router = APIRouter(tags=["Queues"])


@router.get("/api/projects/{project_id}/queues", response_model=dict)
async def list_queues(project_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.project_id == project_id))
    queues = result.scalars().all()
    return {"success": True, "data": [QueueOut.model_validate(q).model_dump() for q in queues]}


@router.get("/api/projects", response_model=dict)
async def list_all_projects(db: DBSession, current_user: CurrentUser):
    """Convenience endpoint: list all projects (used by frontend dropdowns)."""
    result = await db.execute(select(Project))
    projects = result.scalars().all()
    return {"success": True, "data": [{"id": p.id, "name": p.name, "org_id": p.org_id} for p in projects]}


@router.post("/api/projects/{project_id}/queues", response_model=dict, status_code=201)
async def create_queue(project_id: str, body: QueueCreate, db: DBSession, current_user: CurrentUser):
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    if not proj_result.scalar_one_or_none():
        raise HTTPException(404, "Project not found")

    retry_policy_id = body.retry_policy_id
    if not retry_policy_id:
        # Create an inline retry policy
        policy = RetryPolicy(
            project_id=project_id,
            name=f"{body.name}-policy",
            strategy=body.retry_strategy,
            max_retries=body.max_retries,
            base_delay_ms=body.base_delay_ms,
            max_delay_ms=body.max_delay_ms,
            jitter_ms=body.jitter_ms,
        )
        db.add(policy)
        await db.flush()
        retry_policy_id = policy.id

    queue = Queue(
        project_id=project_id,
        retry_policy_id=retry_policy_id,
        name=body.name,
        description=body.description,
        priority=body.priority,
        concurrency_limit=body.concurrency_limit,
    )
    db.add(queue)
    await db.flush()
    await db.refresh(queue)
    return {"success": True, "data": QueueOut.model_validate(queue).model_dump()}


@router.get("/api/queues/{queue_id}", response_model=dict)
async def get_queue(queue_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")
    return {"success": True, "data": QueueOut.model_validate(queue).model_dump()}


@router.put("/api/queues/{queue_id}", response_model=dict)
async def update_queue(queue_id: str, body: QueueUpdate, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(queue, field, value)
    await db.flush()
    await db.refresh(queue)
    return {"success": True, "data": QueueOut.model_validate(queue).model_dump()}


@router.delete("/api/queues/{queue_id}", response_model=dict)
async def delete_queue(queue_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")
    await db.delete(queue)
    await db.flush()
    return {"success": True, "data": {"deleted": True}}


@router.post("/api/queues/{queue_id}/pause", response_model=dict)
async def pause_queue(queue_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")
    queue.is_paused = True
    await db.flush()
    return {"success": True, "data": {"is_paused": True}}


@router.post("/api/queues/{queue_id}/resume", response_model=dict)
async def resume_queue(queue_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")
    queue.is_paused = False
    await db.flush()
    return {"success": True, "data": {"is_paused": False}}


@router.get("/api/queues/{queue_id}/stats", response_model=dict)
async def queue_stats(queue_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Queue).where(Queue.id == queue_id))
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(404, "Queue not found")

    counts_result = await db.execute(
        select(Job.status, func.count(Job.id).label("cnt"))
        .where(Job.queue_id == queue_id)
        .group_by(Job.status)
    )
    counts = {row.status: row.cnt for row in counts_result.all()}
    total = sum(counts.values())
    completed = counts.get(JobStatus.completed, 0)
    failed = counts.get(JobStatus.failed, 0)
    error_rate = failed / (completed + failed) if (completed + failed) > 0 else 0.0

    stats = QueueStats(
        queue_id=queue_id,
        queue_name=queue.name,
        total=total,
        queued=counts.get(JobStatus.queued, 0),
        scheduled=counts.get(JobStatus.scheduled, 0),
        claimed=counts.get(JobStatus.claimed, 0),
        running=counts.get(JobStatus.running, 0),
        completed=completed,
        failed=failed,
        dead=counts.get(JobStatus.dead, 0),
        cancelled=counts.get(JobStatus.cancelled, 0),
        error_rate=round(error_rate, 4),
    )
    return {"success": True, "data": stats.model_dump()}
