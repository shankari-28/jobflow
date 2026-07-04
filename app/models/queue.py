import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Queue(Base):
    __tablename__ = "queues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    retry_policy_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("retry_policies.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    concurrency_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    is_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="queues")
    retry_policy: Mapped[Optional["RetryPolicy"]] = relationship("RetryPolicy", back_populates="queues")
    jobs: Mapped[List["Job"]] = relationship("Job", back_populates="queue", cascade="all, delete-orphan")
    scheduled_jobs: Mapped[List["ScheduledJob"]] = relationship(
        "ScheduledJob", back_populates="queue", cascade="all, delete-orphan"
    )
    dlq_entries: Mapped[List["DeadLetterQueue"]] = relationship(
        "DeadLetterQueue", back_populates="queue", cascade="all, delete-orphan"
    )
