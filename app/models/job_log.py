import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, ForeignKey, JSON, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class LogLevel(str, enum.Enum):
    debug = "debug"
    info = "info"
    warning = "warning"
    error = "error"


class JobLog(Base):
    __tablename__ = "job_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    execution_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("job_executions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalised for direct job-level queries
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[LogLevel] = mapped_column(SAEnum(LogLevel), nullable=False, default=LogLevel.info)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    execution: Mapped["JobExecution"] = relationship("JobExecution", back_populates="logs")
    job: Mapped["Job"] = relationship("Job", back_populates="logs")
