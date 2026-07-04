import uuid
import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, JSON, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class JobStatus(str, enum.Enum):
    queued = "queued"
    scheduled = "scheduled"
    claimed = "claimed"
    running = "running"
    completed = "completed"
    failed = "failed"
    dead = "dead"
    cancelled = "cancelled"


class JobType(str, enum.Enum):
    immediate = "immediate"
    delayed = "delayed"
    scheduled = "scheduled"
    recurring = "recurring"
    batch = "batch"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    queue_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("queues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    worker_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("workers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scheduled_job_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("scheduled_jobs.id", ondelete="SET NULL"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus), nullable=False, default=JobStatus.queued, index=True
    )
    job_type: Mapped[JobType] = mapped_column(SAEnum(JobType), nullable=False, default=JobType.immediate)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # Retry config (copied from policy at job creation)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_strategy: Mapped[str] = mapped_column(String(30), nullable=False, default="exponential")
    base_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    max_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=60000)
    jitter_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timing
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Dedup
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)

    # Relationships
    queue: Mapped["Queue"] = relationship("Queue", back_populates="jobs")
    worker: Mapped[Optional["WorkerModel"]] = relationship("WorkerModel", back_populates="jobs")
    executions: Mapped[List["JobExecution"]] = relationship(
        "JobExecution", back_populates="job", cascade="all, delete-orphan"
    )
    logs: Mapped[List["JobLog"]] = relationship("JobLog", back_populates="job", cascade="all, delete-orphan")
    dlq_entry: Mapped[Optional["DeadLetterQueue"]] = relationship(
        "DeadLetterQueue", back_populates="job", cascade="all, delete-orphan"
    )
