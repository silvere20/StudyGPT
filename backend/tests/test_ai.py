from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.schemas import Chapter, StudyPlan  # noqa: E402
from services import ai  # noqa: E402


def make_plan(title: str) -> StudyPlan:
    return StudyPlan(
        chapters=[
            Chapter(
                id="T1-C1",
                title=title,
                summary=f"{title} summary",
                topic="Algemeen",
                content="## Kernbegrippen\n- begrip\n\nOEFENING: oefen",
            )
        ],
        topics=["Algemeen"],
        masterStudyMap="| onderwerp | chapter |",
        gptSystemInstructions="Use the KB.",
    )


def test_generate_study_plan_falls_back_to_chunked_flow(monkeypatch):
    calls: list[str] = []

    async def fake_full(*args, **kwargs):
        calls.append("full")
        raise RuntimeError(
            "Error code: 429 - {'error': {'message': 'Request too large for gpt-4.1 on tokens per min'}}"
        )

    async def fake_chunked(*args, **kwargs):
        calls.append("chunked")
        return make_plan("Chunked")

    monkeypatch.setattr(ai, "_generate_full_study_plan", fake_full)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_chunked)

    plan = ai.asyncio.run(ai.generate_study_plan("x" * 50_000))

    assert plan.chapters[0].title == "Chunked"
    assert calls == ["full", "chunked"]


def test_split_markdown_into_chunks_respects_size_limits():
    # Each block ~25K chars; 3 blocks with --- separators force split at TARGET=60K
    block = ("## Hoofdstuk\n" + ("regel\n" * 5_000)).strip()
    content = "\n\n---\n\n".join([
        f"# Document {i + 1}\n\n{block}" for i in range(3)
    ])

    chunks = ai._split_markdown_into_chunks(content)

    assert len(chunks) > 1
    assert all(len(chunk) <= ai.HARD_CHUNK_CHARS for chunk in chunks)


def test_split_markdown_into_chunks_single_block_under_limit():
    # A single small block should produce exactly one chunk
    content = "## Sectie\n\nKorte inhoud met wat tekst.\n"

    chunks = ai._split_markdown_into_chunks(content)

    assert len(chunks) == 1
    assert chunks[0] == content.strip() or content.strip() in chunks[0]
