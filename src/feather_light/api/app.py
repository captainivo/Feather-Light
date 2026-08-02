"""FastAPI application factory."""

from fastapi import FastAPI

from feather_light import __version__
from feather_light.api.errors import FeatherLightError, feather_light_error_handler
from feather_light.api.models import HealthResponse, RootStatus, StatusResponse
from feather_light.config import Settings
from feather_light.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Feather-Light API",
        version=__version__,
        description="Compact, provenance-preserving Westpole archive retrieval.",
    )
    app.state.settings = settings
    app.add_exception_handler(FeatherLightError, feather_light_error_handler)

    @app.get("/health", response_model=HealthResponse, tags=["operations"])
    async def health() -> HealthResponse:
        return HealthResponse(service=settings.service_name, version=__version__)

    @app.get("/v1/status", response_model=StatusResponse, tags=["operations"])
    async def status() -> StatusResponse:
        return StatusResponse(
            schema_version="uninitialized",
            parser_version="uninitialized",
            roots=[
                RootStatus(root_id=root.root_id, enabled=root.enabled)
                for root in settings.archive_roots
            ],
        )

    return app


app = create_app()
