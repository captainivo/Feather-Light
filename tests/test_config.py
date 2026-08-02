import pytest
from pydantic import ValidationError

from feather_light.config import ArchiveRootSettings, ServerSettings


def test_archive_roots_must_be_read_only() -> None:
    with pytest.raises(ValidationError, match="must be read-only"):
        ArchiveRootSettings(
            root_id="westpole-working",
            display_name="Westpole",
            path="/archive",
            read_only=False,
        )


def test_non_local_binding_is_rejected() -> None:
    with pytest.raises(ValidationError, match="network binding"):
        ServerSettings(host="0.0.0.0")
