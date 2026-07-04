from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional


class RetryPolicyCreate(BaseModel):
    name: str
    strategy: str = "exponential"
    max_retries: int = 3
    base_delay_ms: int = 1000
    max_delay_ms: int = 60000
    jitter_ms: int = 0


class QueueCreate(BaseModel):
    name: str
    description: Optional[str] = None
    priority: int = 0
    concurrency_limit: int = 5
    retry_policy_id: Optional[str] = None
    # Inline retry policy (alternative to retry_policy_id)
    retry_strategy: str = "exponential"
    max_retries: int = 3
    base_delay_ms: int = 1000
    max_delay_ms: int = 60000
    jitter_ms: int = 0

    @field_validator("concurrency_limit")
    @classmethod
    def concurrency_range(cls, v: int) -> int:
        if v < 1 or v > 100:
            raise ValueError("concurrency_limit must be between 1 and 100")
        return v


class QueueUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    concurrency_limit: Optional[int] = None
    retry_policy_id: Optional[str] = None


class QueueOut(BaseModel):
    id: str
    project_id: str
    retry_policy_id: Optional[str]
    name: str
    description: Optional[str]
    priority: int
    concurrency_limit: int
    is_paused: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class QueueStats(BaseModel):
    queue_id: str
    queue_name: str
    total: int
    queued: int
    scheduled: int
    claimed: int
    running: int
    completed: int
    failed: int
    dead: int
    cancelled: int
    error_rate: float  # failed / (completed + failed), 0.0–1.0
