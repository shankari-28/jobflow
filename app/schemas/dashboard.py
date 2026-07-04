from pydantic import BaseModel
from typing import List, Dict, Any, Optional


class SystemMetrics(BaseModel):
    total_jobs: int
    queued: int
    scheduled: int
    running: int
    completed: int
    failed: int
    dead: int
    cancelled: int
    total_queues: int
    total_workers: int
    active_workers: int
    offline_workers: int
    jobs_per_minute: float
    error_rate: float


class ActivityEvent(BaseModel):
    job_id: str
    job_name: str
    queue_name: str
    status: str
    timestamp: str
    worker_id: Optional[str]


class QueueHealth(BaseModel):
    queue_id: str
    queue_name: str
    project_name: str
    queued: int
    running: int
    completed: int
    failed: int
    dead: int
    error_rate: float
    is_paused: bool


class DashboardMetricsResponse(BaseModel):
    success: bool = True
    data: SystemMetrics


class ActivityResponse(BaseModel):
    success: bool = True
    data: List[ActivityEvent]


class QueueHealthResponse(BaseModel):
    success: bool = True
    data: List[QueueHealth]
