from fastapi.testclient import TestClient

from feather_light.api.app import create_app
from feather_light.config import ArchiveRootSettings, Settings


def test_health_reports_process_health_only() -> None:
    client = TestClient(create_app(Settings()))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "feather-light",
        "version": "0.1.0",
    }
    assert "fresh" not in response.json()


def test_status_is_explicitly_not_indexed() -> None:
    settings = Settings(
        archive_roots=[
            ArchiveRootSettings(
                root_id="westpole-working",
                display_name="Westpole working copy",
                path="/archive",
            )
        ]
    )
    client = TestClient(create_app(settings))

    response = client.get("/v1/status")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_indexed"
    assert body["stale"] is True
    assert body["partial"] is False
    assert body["roots"] == [
        {"root_id": "westpole-working", "enabled": True, "state": "not_indexed"}
    ]
    assert body["counts"]["source_files"] == 0
