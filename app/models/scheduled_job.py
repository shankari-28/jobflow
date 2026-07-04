import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ScheduledJob(Base):
    __tablename__ = "scheduled_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    queue_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("queues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)

    # Either cron_expression (recurring) OR run_at (one-shot delayed)
    cron_expression: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    queue: Mapped["Queue"] = relationship("Queue", back_populates="scheduled_jobs")
    spawned_jobs: Mapped[list] = relationship("Job", back_populates=None, foreign_keys="Job.scheduled_job_id")
