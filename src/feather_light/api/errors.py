"""Machine-readable API errors."""

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    status: str
    error: ErrorDetail


class FeatherLightError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


async def feather_light_error_handler(_request: Request, exc: FeatherLightError) -> JSONResponse:
    body = ErrorResponse(
        status=exc.code,
        error=ErrorDetail(code=exc.code, message=exc.message, details=exc.details),
    )
    return JSONResponse(status_code=exc.status_code, content=body.model_dump(exclude_none=True))
