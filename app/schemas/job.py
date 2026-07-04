from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, Any, Dict, List


class JobCreate(BaseModel):
    name: str
    payload: Optional[Dict[str, Any]] = {}
    job_type: str = "immediate"
    priority: int = 0
    # For delayed jobs
    delay_seconds: Optional[int] = None
    # For scheduled jobs
    scheduled_at: Optional[datetime] = None
    # For recurring jobs
    cron_expression: Optional[str] = None
    # Dedup
    idempotency_key: Optional[str] = None
    # Override queue retry policy
    max_retries: Optional[int] = None


class BatchJobCreate(BaseModel):
    jobs: List[JobCreate]


class JobOut(BaseModel):
    id: str
    queue_id: str
    worker_id: Optional[str]
    scheduled_job_id: Optional[str]
    name: str
    payload: Optional[Dict[str, Any]]
    status: str
    job_type: str
    priority: int
    max_retries: int
    retry_count: int
    retry_strategy: str
    base_delay_ms: int
    max_delay_ms: int
    jitter_ms: int
    next_retry_at: Optional[datetime]
    scheduled_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    idempotency_key: Optional[str]
    model_config = {"from_attributes": True}


class JobExecutionOut(BaseModel):
    id: str
    job_id: str
    worker_id: Optional[str]
    attempt_number: int
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    duration_ms: Optional[int]
    error_message: Optional[str]
    error_traceback: Optional[str]
    model_config = {"from_attributes": True}


class JobLogOut(BaseModel):
    id: str
    execution_id: str
    job_id: str
    level: str
    message: str
    metadata_: Optional[Dict[str, Any]] = None
    logged_at: datetime
    model_config = {"from_attributes": True, "populate_by_name": True}


class DLQEntryOut(BaseModel):
    id: str
    job_id: str
    queue_id: str
    original_payload: Optional[Dict[str, Any]]
    failure_reason: Optional[str]
    failure_traceback: Optional[str]
    retry_count: int
    moved_at: datetime
    requeued_at: Optional[datetime]
    model_config = {"from_attributes": True}


class PaginatedResponse(BaseModel):
    success: bool = True
    data: List[Any]
    meta: Dict[str, Any]
