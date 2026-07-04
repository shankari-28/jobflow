import uuid
import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ExecutionStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"
    timeout = "timeout"


class JobExecution(Base):
    __tablename__ = "job_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    worker_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("workers.id", ondelete="SET NULL"), nullable=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[ExecutionStatus] = mapped_column(
        SAEnum(ExecutionStatus), nullable=False, default=ExecutionStatus.running
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_traceback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="executions")
    worker: Mapped[Optional["WorkerModel"]] = relationship("WorkerModel", back_populates="executions")
    logs: Mapped[List["JobLog"]] = relationship(
        "JobLog", back_populates="execution", cascade="all, delete-orphan"
    )
