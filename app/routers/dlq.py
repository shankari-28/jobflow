from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.dead_letter_queue import DeadLetterQueue
from app.models.job import Job
from app.models.queue import Queue
from app.services.job_service import requeue_from_dlq

router = APIRouter(prefix="/api/dlq", tags=["Dead Letter Queue"])


@router.get("", response_model=dict)
async def list_dlq(
    db: DBSession,
    current_user: CurrentUser,
    queue_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    from sqlalchemy import func
    query = select(DeadLetterQueue, Job, Queue).join(Job, DeadLetterQueue.job_id == Job.id).join(Queue, DeadLetterQueue.queue_id == Queue.id)
    if queue_id:
        query = query.where(DeadLetterQueue.queue_id == queue_id)
    query = query.order_by(DeadLetterQueue.moved_at.desc())

    count_result = await db.execute(select(func.count()).select_from(
        select(DeadLetterQueue).where(DeadLetterQueue.queue_id == queue_id).subquery()
        if queue_id else select(DeadLetterQueue).subquery()
    ))
    total = count_result.scalar_one()

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    rows = result.all()

    data = []
    for dlq, job, queue in rows:
        data.append({
            "id": dlq.id,
            "job_id": dlq.job_id,
            "job_name": job.name,
            "queue_id": dlq.queue_id,
            "queue_name": queue.name,
            "original_payload": dlq.original_payload,
            "failure_reason": dlq.failure_reason,
            "failure_traceback": dlq.failure_traceback,
            "retry_count": dlq.retry_count,
            "moved_at": dlq.moved_at.isoformat() if dlq.moved_at else None,
            "requeued_at": dlq.requeued_at.isoformat() if dlq.requeued_at else None,
        })
    return {
        "success": True,
        "data": data,
        "meta": {"page": page, "page_size": page_size, "total": total, "pages": (total + page_size - 1) // page_size},
    }


@router.get("/{dlq_id}", response_model=dict)
async def get_dlq_entry(dlq_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(DeadLetterQueue).where(DeadLetterQueue.id == dlq_id))
    dlq = result.scalar_one_or_none()
    if not dlq:
        raise HTTPException(404, "DLQ entry not found")
    return {
        "success": True,
        "data": {
            "id": dlq.id, "job_id": dlq.job_id, "queue_id": dlq.queue_id,
            "original_payload": dlq.original_payload,
            "failure_reason": dlq.failure_reason,
            "failure_traceback": dlq.failure_traceback,
            "retry_count": dlq.retry_count,
            "moved_at": dlq.moved_at.isoformat() if dlq.moved_at else None,
            "requeued_at": dlq.requeued_at.isoformat() if dlq.requeued_at else None,
        },
    }


@router.post("/{dlq_id}/requeue", response_model=dict)
async def requeue_dlq_entry(dlq_id: str, db: DBSession, current_user: CurrentUser):
    job = await requeue_from_dlq(db, dlq_id)
    return {"success": True, "data": {"job_id": job.id, "status": "queued"}}


@router.delete("/{dlq_id}", response_model=dict)
async def discard_dlq_entry(dlq_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(DeadLetterQueue).where(DeadLetterQueue.id == dlq_id))
    dlq = result.scalar_one_or_none()
    if not dlq:
        raise HTTPException(404, "DLQ entry not found")
    await db.delete(dlq)
    await db.flush()
    return {"success": True, "data": {"deleted": True}}
