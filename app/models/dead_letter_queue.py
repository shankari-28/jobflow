import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class DeadLetterQueue(Base):
    __tablename__ = "dead_letter_queue"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    queue_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("queues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    original_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    failure_traceback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    moved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    requeued_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="dlq_entry")
    queue: Mapped["Queue"] = relationship("Queue", back_populates="dlq_entries")
