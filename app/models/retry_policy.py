import uuid
import enum
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class RetryStrategy(str, enum.Enum):
    fixed = "fixed"
    linear = "linear"
    exponential = "exponential"
    exponential_jitter = "exponential_jitter"


class RetryPolicy(Base):
    __tablename__ = "retry_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    strategy: Mapped[RetryStrategy] = mapped_column(
        SAEnum(RetryStrategy), nullable=False, default=RetryStrategy.exponential
    )
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    base_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    max_delay_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=60000)
    jitter_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="retry_policies")
    queues: Mapped[List["Queue"]] = relationship("Queue", back_populates="retry_policy")
