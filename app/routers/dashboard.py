from fastapi import APIRouter
from app.deps import DBSession, CurrentUser
from app.services.metrics_service import get_system_metrics, get_queue_health, get_recent_activity

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/metrics", response_model=dict)
async def dashboard_metrics(db: DBSession, current_user: CurrentUser):
    metrics = await get_system_metrics(db)
    return {"success": True, "data": metrics.model_dump()}


@router.get("/activity", response_model=dict)
async def dashboard_activity(db: DBSession, current_user: CurrentUser):
    events = await get_recent_activity(db, limit=20)
    return {"success": True, "data": [e.model_dump() for e in events]}


@router.get("/queue-health", response_model=dict)
async def dashboard_queue_health(db: DBSession, current_user: CurrentUser):
    health = await get_queue_health(db)
    return {"success": True, "data": [h.model_dump() for h in health]}
