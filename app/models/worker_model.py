import uuid
import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class WorkerStatus(str, enum.Enum):
    idle = "idle"
    busy = "busy"
    draining = "draining"
    offline = "offline"


class WorkerModel(Base):
    """DB representation of a registered worker process."""
    __tablename__ = "workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False)
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[WorkerStatus] = mapped_column(
        SAEnum(WorkerStatus), nullable=False, default=WorkerStatus.idle
    )
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    registered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )

    # Relationships
    heartbeats: Mapped[List["WorkerHeartbeat"]] = relationship(
        "WorkerHeartbeat", back_populates="worker", cascade="all, delete-orphan"
    )
    jobs: Mapped[List["Job"]] = relationship("Job", back_populates="worker")
    executions: Mapped[List["JobExecution"]] = relationship("JobExecution", back_populates="worker")


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    worker_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jobs_running: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    jobs_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cpu_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memory_mb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    worker: Mapped["WorkerModel"] = relationship("WorkerModel", back_populates="heartbeats")
