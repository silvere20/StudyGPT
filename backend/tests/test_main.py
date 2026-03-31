from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from models.schemas import Chapter, StudyPlan  # noqa: E402


def make_plan(title: str, content: str = "content") -> StudyPlan:
    return StudyPlan(
        chapters=[
            Chapter(
                id="T1-C1",
                title=title,
                summary=f"{title} summary",
                topic="Algemeen",
                content=content,
            )
        ],
        topics=["Algemeen"],
        masterStudyMap="| onderwerp | chapter |",
        gptSystemInstructions="Use the KB.",
    )


def parse_sse_events(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue

        event_type = ""
        data = ""
        for line in block.splitlines():
            if line.startswith("event: "):
                event_type = line[7:].strip()
            elif line.startswith("data: "):
                data = line[6:]

        if event_type and data:
            events.append((event_type, json.loads(data)))

    return events


def test_process_simple_returns_single_file_cache(monkeypatch):
    cached_plan = make_plan("Cached")

    monkeypatch.setattr(main, "get_cached_result", lambda _: cached_plan)
    monkeypatch.setattr(main, "process_document", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "generate_study_plan", lambda *args, **kwargs: None)

    client = TestClient(main.app)
    response = client.post(
        "/api/process-simple",
        files={"files": ("cached.txt", b"cached", "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["plan"]["chapters"][0]["title"] == "Cached"


def test_process_simple_multi_file_skips_cache_short_circuit(monkeypatch):
    cache_calls = {"count": 0}
    processed_files: list[str] = []

    def fake_get_cached_result(_file_hash):
        cache_calls["count"] += 1
        return make_plan("Cached")

    async def fake_process_document(_file_path, filename, on_progress=None):
        processed_files.append(filename)
        return f"# processed {filename}"

    async def fake_generate(markdown_content, doc_type="auto", on_progress=None, max_retries=3):
        return make_plan("Generated", markdown_content)

    monkeypatch.setattr(main, "get_cached_result", fake_get_cached_result)
    monkeypatch.setattr(main, "process_document", fake_process_document)
    monkeypatch.setattr(main, "generate_study_plan", fake_generate)
    monkeypatch.setattr(main, "save_to_cache", lambda *_args, **_kwargs: None)

    client = TestClient(main.app)
    response = client.post(
        "/api/process-simple",
        files=[
            ("files", ("first.txt", b"one", "text/plain")),
            ("files", ("second.txt", b"two", "text/plain")),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["plan"]["chapters"][0]["title"] == "Generated"
    assert processed_files == ["first.txt", "second.txt"]
    assert cache_calls["count"] == 0


def test_process_stream_forwards_document_and_ai_progress(monkeypatch):
    async def fake_process_document(_file_path, filename, on_progress=None):
        if on_progress:
            await on_progress("document", 45, f"extracting {filename}")
        return f"# processed {filename}"

    async def fake_generate(markdown_content, doc_type="auto", on_progress=None, max_retries=3):
        if on_progress:
            await on_progress("ai", 80, "building plan")
        return make_plan("Generated", markdown_content)

    monkeypatch.setattr(main, "get_cached_result", lambda _: None)
    monkeypatch.setattr(main, "get_cached_markdown", lambda _: None)
    monkeypatch.setattr(main, "save_markdown_to_cache", lambda *_: None)
    monkeypatch.setattr(main, "process_document", fake_process_document)
    monkeypatch.setattr(main, "generate_study_plan", fake_generate)
    monkeypatch.setattr(main, "save_to_cache", lambda *_args, **_kwargs: None)

    client = TestClient(main.app)
    with client.stream(
        "POST",
        "/api/process",
        files={"files": ("notes.txt", b"hello", "text/plain")},
    ) as response:
        text = "".join(response.iter_text())

    events = parse_sse_events(text)
    progress_messages = [payload["message"] for event_type, payload in events if event_type == "progress"]
    terminal_events = [event_type for event_type, _payload in events if event_type in {"result", "error"}]

    assert response.status_code == 200
    assert any("extracting notes.txt" in message for message in progress_messages)
    assert any("building plan" in message for message in progress_messages)
    assert terminal_events == ["result"]


def test_multi_file_uses_markdown_cache(monkeypatch):
    """Bestand 1 zit al in de markdown-cache; process_document mag dan niet worden aangeroepen."""
    import hashlib

    process_document_calls: list[str] = []

    # Bestand 1 heeft een bekende hash → markdown-cache retourneert content
    file1_hash = hashlib.sha256(b"file1content").hexdigest()

    def fake_get_cached_markdown(file_hash: str) -> str | None:
        if file_hash == file1_hash:
            return "# Gecachte markdown voor bestand 1"
        return None

    async def fake_process_document(_file_path, filename, on_progress=None):
        process_document_calls.append(filename)
        return f"# verwerkt {filename}"

    async def fake_generate(markdown_content, doc_type="auto", on_progress=None, max_retries=3):
        return make_plan("Gegenereerd", markdown_content)

    monkeypatch.setattr(main, "get_cached_result", lambda _: None)
    monkeypatch.setattr(main, "get_cached_markdown", fake_get_cached_markdown)
    monkeypatch.setattr(main, "save_markdown_to_cache", lambda *_: None)
    monkeypatch.setattr(main, "process_document", fake_process_document)
    monkeypatch.setattr(main, "generate_study_plan", fake_generate)
    monkeypatch.setattr(main, "save_to_cache", lambda *_: None)

    client = TestClient(main.app)
    with client.stream(
        "POST",
        "/api/process",
        files=[
            ("files", ("file1.txt", b"file1content", "text/plain")),
            ("files", ("file2.txt", b"file2content", "text/plain")),
        ],
    ) as response:
        text = "".join(response.iter_text())

    events = parse_sse_events(text)

    # process_document mag alleen voor bestand 2 zijn aangeroepen
    assert process_document_calls == ["file2.txt"]

    # Er moet een cache-event zijn voor bestand 1
    cache_events = [
        payload
        for event_type, payload in events
        if event_type == "progress" and payload.get("step") == "cache"
    ]
    assert len(cache_events) >= 1
    assert any(payload.get("fileName") == "file1.txt" for payload in cache_events)

    # Stream eindigt met een result-event
    terminal_events = [event_type for event_type, _ in events if event_type in {"result", "error"}]
    assert terminal_events == ["result"]


def test_process_returns_error_when_semaphore_full(monkeypatch):
    """Als de semaphore vol is, krijgt de client direct een SSE error-event."""
    # Druk de semaphore leeg door _value direct op 0 te zetten (asyncio is single-threaded)
    original_value = main._processing_semaphore._value
    main._processing_semaphore._value = 0

    try:
        client = TestClient(main.app)
        with client.stream(
            "POST",
            "/api/process",
            files={"files": ("test.txt", b"inhoud", "text/plain")},
        ) as response:
            text = "".join(response.iter_text())
    finally:
        # Herstel de semaphore zodat andere tests niet worden beïnvloed
        main._processing_semaphore._value = original_value

    events = parse_sse_events(text)
    error_events = [payload for event_type, payload in events if event_type == "error"]

    assert len(error_events) == 1
    assert "tegelijkertijd" in error_events[0]["message"]


def test_health_includes_ocr_status(monkeypatch):
    """Het health-endpoint geeft ocr_available en ocr_missing_langs terug."""
    monkeypatch.setattr(main, "_ocr_status", {"available": False, "missing": ["nld"]})

    client = TestClient(main.app)
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ocr_available"] is False
    assert "nld" in body["ocr_missing_langs"]


def test_result_event_contains_file_order(monkeypatch):
    """result SSE event must include file_order matching the upload order."""
    plan = make_plan("Order Test")

    async def fake_process_document(_path, filename, on_progress=None):
        return f"# {filename}"

    monkeypatch.setattr(main, "get_cached_result", lambda _: None)
    monkeypatch.setattr(main, "get_cached_markdown", lambda _: None)
    monkeypatch.setattr(main, "save_markdown_to_cache", lambda *_: None)
    monkeypatch.setattr(main, "process_document", fake_process_document)
    async def fake_generate(*args, **kwargs):
        return plan

    monkeypatch.setattr(main, "generate_study_plan", fake_generate)

    client = TestClient(main.app)
    with client.stream(
        "POST",
        "/api/process",
        files=[
            ("files", ("alpha.txt", b"aaa", "text/plain")),
            ("files", ("beta.txt", b"bbb", "text/plain")),
        ],
    ) as response:
        text = "".join(response.iter_text())

    events = parse_sse_events(text)
    result_events = [payload for event_type, payload in events if event_type == "result"]

    assert len(result_events) == 1
    assert result_events[0]["file_order"] == ["alpha.txt", "beta.txt"]


def test_process_stream_emits_single_error_terminal_event(monkeypatch):
    async def fake_process_document(_file_path, _filename, on_progress=None):
        if on_progress:
            await on_progress("document", 10, "starting")
        raise RuntimeError("boom")

    monkeypatch.setattr(main, "get_cached_result", lambda _: None)
    monkeypatch.setattr(main, "get_cached_markdown", lambda _: None)
    monkeypatch.setattr(main, "save_markdown_to_cache", lambda *_: None)
    monkeypatch.setattr(main, "process_document", fake_process_document)

    client = TestClient(main.app)
    with client.stream(
        "POST",
        "/api/process",
        files={"files": ("broken.txt", b"hello", "text/plain")},
    ) as response:
        text = "".join(response.iter_text())

    events = parse_sse_events(text)
    terminal_events = [event_type for event_type, _payload in events if event_type in {"result", "error"}]

    assert response.status_code == 200
    assert terminal_events == ["error"]
    assert all(event_type != "result" for event_type, _payload in events)
