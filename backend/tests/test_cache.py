"""Tests for backend/services/cache.py — TTL and version validation."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.cache import (
    CACHE_VERSION,
    get_cached_markdown,
    save_markdown_to_cache,
    clear_expired_markdown_cache,
    CACHE_DIR,
)


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Redirect CACHE_DIR to a temp directory for each test."""
    import services.cache as cache_module
    monkeypatch.setattr(cache_module, "CACHE_DIR", tmp_path)
    return tmp_path


def _write_meta(tmp_path: object, file_hash: str, created_at: datetime, version: int = CACHE_VERSION) -> None:
    meta_file = tmp_path / f"md_{file_hash}.meta.json"  # type: ignore[operator]
    meta_file.write_text(
        json.dumps({"created_at": created_at.isoformat(), "version": version}),
        encoding="utf-8",
    )


def test_fresh_entry_is_returned(tmp_path):
    """A just-saved markdown entry should be returned immediately."""
    save_markdown_to_cache("abc123", "# Hello")
    result = get_cached_markdown("abc123")
    assert result == "# Hello"


def test_expired_entry_returns_none(tmp_path):
    """An entry older than CACHE_MAX_AGE_DAYS should return None."""
    file_hash = "expired001"
    txt_file = tmp_path / f"md_{file_hash}.txt"
    txt_file.write_text("old content", encoding="utf-8")

    old_ts = datetime.now(timezone.utc) - timedelta(days=8)
    _write_meta(tmp_path, file_hash, old_ts)

    assert get_cached_markdown(file_hash) is None


def test_wrong_version_returns_none(tmp_path):
    """An entry with an outdated cache version should return None."""
    file_hash = "wrongver"
    txt_file = tmp_path / f"md_{file_hash}.txt"
    txt_file.write_text("some content", encoding="utf-8")

    _write_meta(tmp_path, file_hash, datetime.now(timezone.utc), version=CACHE_VERSION - 1)

    assert get_cached_markdown(file_hash) is None


def test_missing_meta_returns_none(tmp_path):
    """A .txt file without a .meta.json sidecar should return None."""
    file_hash = "nometa"
    txt_file = tmp_path / f"md_{file_hash}.txt"
    txt_file.write_text("content", encoding="utf-8")

    assert get_cached_markdown(file_hash) is None


def test_clear_expired_removes_stale_entries(tmp_path):
    """clear_expired_markdown_cache should remove expired entries and leave fresh ones."""
    # Create one fresh and one expired entry
    save_markdown_to_cache("fresh001", "fresh content")

    old_hash = "stale001"
    (tmp_path / f"md_{old_hash}.txt").write_text("stale content", encoding="utf-8")
    _write_meta(tmp_path, old_hash, datetime.now(timezone.utc) - timedelta(days=10))

    removed = clear_expired_markdown_cache()

    assert removed == 1
    assert not (tmp_path / f"md_{old_hash}.txt").exists()
    assert not (tmp_path / f"md_{old_hash}.meta.json").exists()
    # Fresh entry untouched
    assert get_cached_markdown("fresh001") == "fresh content"
