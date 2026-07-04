from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class WorkerOut(BaseModel):
    id: str
    name: str
    hostname: str
    pid: int
    status: str
    concurrency: int
    registered_at: datetime
    last_heartbeat_at: datetime
    model_config = {"from_attributes": True}


class WorkerHeartbeatCreate(BaseModel):
    jobs_running: int = 0
    jobs_completed: int = 0
    cpu_percent: Optional[float] = None
    memory_mb: Optional[float] = None


class WorkerHeartbeatOut(BaseModel):
    id: str
    worker_id: str
    jobs_running: int
    jobs_completed: int
    cpu_percent: Optional[float]
    memory_mb: Optional[float]
    created_at: datetime
    model_config = {"from_attributes": True}
