import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from models.schemas import StudyPlan

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

CACHE_VERSION = 2
CACHE_MAX_AGE_DAYS = int(os.getenv("CACHE_MAX_AGE_DAYS", "7"))


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
    """Return cached extracted markdown for a file, or None if not cached or expired."""
    cache_file = CACHE_DIR / f"md_{file_hash}.txt"
    meta_file = CACHE_DIR / f"md_{file_hash}.meta.json"

    if not cache_file.exists() or not meta_file.exists():
        return None

    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    if meta.get("version") != CACHE_VERSION:
        return None

    try:
        created_at = datetime.fromisoformat(meta["created_at"])
    except (KeyError, ValueError):
        return None

    if datetime.now(timezone.utc) - created_at > timedelta(days=CACHE_MAX_AGE_DAYS):
        return None

    return cache_file.read_text(encoding="utf-8")


def save_markdown_to_cache(file_hash: str, markdown: str) -> None:
    """Cache extracted markdown for a file."""
    cache_file = CACHE_DIR / f"md_{file_hash}.txt"
    meta_file = CACHE_DIR / f"md_{file_hash}.meta.json"
    cache_file.write_text(markdown, encoding="utf-8")
    meta = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "version": CACHE_VERSION,
    }
    meta_file.write_text(json.dumps(meta), encoding="utf-8")


def clear_expired_markdown_cache() -> int:
    """Remove expired or version-mismatched markdown cache entries. Returns number removed."""
    removed = 0
    for meta_file in CACHE_DIR.glob("md_*.meta.json"):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}

        should_remove = False
        if meta.get("version") != CACHE_VERSION:
            should_remove = True
        else:
            try:
                created_at = datetime.fromisoformat(meta["created_at"])
                if datetime.now(timezone.utc) - created_at > timedelta(days=CACHE_MAX_AGE_DAYS):
                    should_remove = True
            except (KeyError, ValueError):
                should_remove = True

        if should_remove:
            hash_str = meta_file.name.removeprefix("md_").removesuffix(".meta.json")
            txt_file = CACHE_DIR / f"md_{hash_str}.txt"
            if txt_file.exists():
                txt_file.unlink()
            meta_file.unlink(missing_ok=True)
            removed += 1

    return removed


if __name__ == "__main__":
    if "--clear-expired" in sys.argv:
        count = clear_expired_markdown_cache()
        print(f"Removed {count} expired cache entries.")
    else:
        print("Usage: python -m backend.services.cache --clear-expired")
