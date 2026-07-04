import socket
import os
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.worker_model import WorkerModel, WorkerHeartbeat, WorkerStatus
from app.schemas.worker import WorkerOut, WorkerHeartbeatCreate

router = APIRouter(prefix="/api/workers", tags=["Workers"])


@router.get("", response_model=dict)
async def list_workers(db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(WorkerModel).order_by(WorkerModel.last_heartbeat_at.desc()))
    workers = result.scalars().all()
    data = []
    for w in workers:
        data.append({
            "id": w.id, "name": w.name, "hostname": w.hostname, "pid": w.pid,
            "status": w.status.value if hasattr(w.status, "value") else str(w.status),
            "concurrency": w.concurrency,
            "registered_at": w.registered_at.isoformat() if w.registered_at else None,
            "last_heartbeat_at": w.last_heartbeat_at.isoformat() if w.last_heartbeat_at else None,
        })
    return {"success": True, "data": data}


@router.get("/{worker_id}", response_model=dict)
async def get_worker(worker_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(WorkerModel).where(WorkerModel.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(404, "Worker not found")

    hb_result = await db.execute(
        select(WorkerHeartbeat)
        .where(WorkerHeartbeat.worker_id == worker_id)
        .order_by(WorkerHeartbeat.created_at.desc())
        .limit(20)
    )
    heartbeats = hb_result.scalars().all()

    return {
        "success": True,
        "data": {
            "id": worker.id, "name": worker.name, "hostname": worker.hostname,
            "pid": worker.pid,
            "status": worker.status.value if hasattr(worker.status, "value") else str(worker.status),
            "concurrency": worker.concurrency,
            "registered_at": worker.registered_at.isoformat() if worker.registered_at else None,
            "last_heartbeat_at": worker.last_heartbeat_at.isoformat() if worker.last_heartbeat_at else None,
            "heartbeat_history": [
                {
                    "jobs_running": hb.jobs_running,
                    "jobs_completed": hb.jobs_completed,
                    "cpu_percent": hb.cpu_percent,
                    "memory_mb": hb.memory_mb,
                    "created_at": hb.created_at.isoformat() if hb.created_at else None,
                }
                for hb in heartbeats
            ],
        },
    }


@router.post("/{worker_id}/heartbeat", response_model=dict)
async def worker_heartbeat(worker_id: str, body: WorkerHeartbeatCreate, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(WorkerModel).where(WorkerModel.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(404, "Worker not found")

    worker.last_heartbeat_at = datetime.utcnow()

    hb = WorkerHeartbeat(
        worker_id=worker_id,
        jobs_running=body.jobs_running,
        jobs_completed=body.jobs_completed,
        cpu_percent=body.cpu_percent,
        memory_mb=body.memory_mb,
    )
    db.add(hb)
    await db.flush()
    return {"success": True, "data": {"worker_id": worker_id, "timestamp": datetime.utcnow().isoformat()}}
