import logging
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("error_handler")


def error_response(code: str, message: str, status_code: int, details: dict = None):
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            },
        },
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return error_response(
        code="HTTP_ERROR",
        message=str(exc.detail),
        status_code=exc.status_code,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = {}
    for error in exc.errors():
        field = " → ".join(str(loc) for loc in error["loc"])
        details[field] = error["msg"]
    return error_response(
        code="VALIDATION_ERROR",
        message="Request validation failed",
        status_code=422,
        details=details,
    )


async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.error(f"DB IntegrityError on {request.url}: {exc}")
    message = "Database constraint violation"
    if "Duplicate entry" in str(exc.orig):
        message = "A record with this value already exists"
    return error_response(code="INTEGRITY_ERROR", message=message, status_code=409)


async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception on {request.url}: {exc}")
    return error_response(
        code="INTERNAL_ERROR",
        message="An internal server error occurred",
        status_code=500,
    )
