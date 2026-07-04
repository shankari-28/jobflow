"""
main.py — FastAPI application factory.

Starts:
 - APScheduler (cron jobs + delayed-job promoter + retry re-enqueuer + watchdog)
 - REST API with all routers
 - Serves static frontend from /public at "/"

Does NOT start any worker pool — workers run as separate processes (see worker.py).
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.routers import auth, organizations, projects, queues, jobs, workers, dlq, dashboard
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
    integrity_error_handler,
    generic_exception_handler,
)
from app.services import cron_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting APScheduler (cron + background tasks)...")
    await cron_service.start_scheduler()
    logger.info("JobQueue API server ready.")
    yield
    # Shutdown
    logger.info("Stopping APScheduler...")
    cron_service.stop_scheduler()
    logger.info("API server shut down.")


app = FastAPI(
    title="JobQueue — Distributed Job Scheduling Platform",
    description="Production-grade distributed job queue with cron, retries, DLQ, and real-time dashboard.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow dashboard and external origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handlers
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(IntegrityError, integrity_error_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# Routers
app.include_router(auth.router)
app.include_router(organizations.router)
app.include_router(projects.router)
app.include_router(queues.router)
app.include_router(jobs.router)
app.include_router(workers.router)
app.include_router(dlq.router)
app.include_router(dashboard.router)

# Serve static frontend at root
# Mount AFTER all API routes
import os
static_dir = os.path.join(os.path.dirname(__file__), "..", "public")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
