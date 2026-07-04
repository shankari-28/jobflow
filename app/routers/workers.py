import socket
import os
import sys
import uuid
import subprocess
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.worker_model import WorkerModel, WorkerHeartbeat, WorkerStatus
from app.models.project import Project
from app.models.organization import OrgMember
from app.schemas.worker import WorkerOut, WorkerHeartbeatCreate, WorkerCreate

router = APIRouter(prefix="/api/workers", tags=["Workers"])


@router.get("", response_model=dict)
async def list_workers(db: DBSession, current_user: CurrentUser):
    # Security scoping: Find projects the user has access to
    user_projects_stmt = (
        select(Project)
        .join(OrgMember, Project.org_id == OrgMember.org_id)
        .where(OrgMember.user_id == current_user.id)
    )
    user_projects = (await db.execute(user_projects_stmt)).scalars().all()
    user_project_ids = [p.id for p in user_projects]
    project_names = {p.id: p.name for p in user_projects}

    if not user_project_ids:
        return {"success": True, "data": []}

    # Fetch workers assigned to the user's projects
    result = await db.execute(
        select(WorkerModel)
        .where(WorkerModel.project_id.in_(user_project_ids))
        .order_by(WorkerModel.last_heartbeat_at.desc())
    )
    workers = result.scalars().all()

    data = []
    for w in workers:
        data.append({
            "id": w.id,
            "name": w.name,
            "hostname": w.hostname,
            "pid": w.pid,
            "status": w.status.value if hasattr(w.status, "value") else str(w.status),
            "concurrency": w.concurrency,
            "project_id": w.project_id,
            "project_name": project_names.get(w.project_id, "Unknown Project"),
            "registered_at": w.registered_at.isoformat() if w.registered_at else None,
            "last_heartbeat_at": w.last_heartbeat_at.isoformat() if w.last_heartbeat_at else None,
        })
    return {"success": True, "data": data}


@router.post("", response_model=dict, status_code=201)
async def start_worker(body: WorkerCreate, db: DBSession, current_user: CurrentUser):
    # Verify user has access to this project
    project_stmt = (
        select(Project)
        .join(OrgMember, Project.org_id == OrgMember.org_id)
        .where(Project.id == body.project_id, OrgMember.user_id == current_user.id)
    )
    project = (await db.execute(project_stmt)).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found or access denied")

    worker_id = f"worker-ui-{uuid.uuid4().hex[:8]}"
    worker_name = body.name or f"worker-{uuid.uuid4().hex[:4]}"

    # Spawn worker subprocess
    try:
        subprocess.Popen(
            [
                sys.executable,
                "worker.py",
                "--id", worker_id,
                "--name", worker_name,
                "--project", body.project_id,
                "--concurrency", str(body.concurrency),
                "--poll", str(body.poll_interval)
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to start worker process: {str(e)}")

    return {
        "success": True,
        "data": {
            "id": worker_id,
            "name": worker_name,
            "project_id": body.project_id,
            "concurrency": body.concurrency,
            "status": "idle"
        }
    }


@router.post("/{worker_id}/stop", response_model=dict)
async def stop_worker(worker_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(WorkerModel).where(WorkerModel.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(404, "Worker not found")

    # Access control: verify user has access to the worker's project
    if worker.project_id:
        project_stmt = (
            select(Project)
            .join(OrgMember, Project.org_id == OrgMember.org_id)
            .where(Project.id == worker.project_id, OrgMember.user_id == current_user.id)
        )
        project = (await db.execute(project_stmt)).scalar_one_or_none()
        if not project:
            raise HTTPException(403, "Access denied to this worker's project")

    # Set status to offline. The worker's heartbeat loop will detect this on the next iteration and exit.
    worker.status = WorkerStatus.offline
    await db.flush()
    return {"success": True, "data": {"id": worker_id, "status": "offline"}}


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
            "id": worker.id,
            "name": worker.name,
            "hostname": worker.hostname,
            "pid": worker.pid,
            "status": worker.status.value if hasattr(worker.status, "value") else str(worker.status),
            "concurrency": worker.concurrency,
            "project_id": worker.project_id,
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
