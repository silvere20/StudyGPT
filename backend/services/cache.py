import hashlib
import json
import os
from pathlib import Path

from models.schemas import StudyPlan

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)


def get_file_hash(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def get_cached_result(file_hash: str) -> StudyPlan | None:
    cache_file = CACHE_DIR / f"{file_hash}.json"
    if cache_file.exists():
        data = json.loads(cache_file.read_text())
        return StudyPlan.model_validate(data)
    return None


def save_to_cache(file_hash: str, plan: StudyPlan) -> None:
    cache_file = CACHE_DIR / f"{file_hash}.json"
    cache_file.write_text(plan.model_dump_json(indent=2))


def get_cached_markdown(file_hash: str) -> str | None:
    """Return cached extracted markdown for a file, or None if not cached."""
    cache_file = CACHE_DIR / f"md_{file_hash}.txt"
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")
    return None


def save_markdown_to_cache(file_hash: str, markdown: str) -> None:
    """Cache extracted markdown for a file."""
    cache_file = CACHE_DIR / f"md_{file_hash}.txt"
    cache_file.write_text(markdown, encoding="utf-8")
