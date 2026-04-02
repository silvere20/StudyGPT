from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.schemas import (  # noqa: E402
    Chapter,
    CourseMetadata,
    SectionAnalysis,
    StructureAnalysis,
    StudyPlan,
    VerificationReport,
)
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


def make_verification_report(status: str = "OK") -> VerificationReport:
    return VerificationReport(
        status=status,
        word_ratio=1.0 if status == "OK" else 0.65,
        missing_keywords=[],
        exercise_count_original=1,
        exercise_count_generated=1 if status == "OK" else 0,
        issues=[] if status == "OK" else ["2 oefeningen ontbreken"],
    )


def make_course_metadata(**overrides) -> CourseMetadata:
    base = CourseMetadata(
        has_formulas=False,
        has_exercises=False,
        has_code=False,
        primary_language="nl",
        exercise_types=[],
        total_exercises=0,
        detected_tools=[],
        difficulty_keywords=[],
    )
    return base.model_copy(update=overrides)


def count_words(text: str) -> int:
    return len(re.findall(r"\S+", text))


def normalize_preserved_output(text: str) -> str:
    filtered: list[str] = []
    skipping_kernbegrippen = False

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("## kernbegrippen"):
            skipping_kernbegrippen = True
            continue

        if skipping_kernbegrippen:
            if not stripped or stripped.startswith("-") or stripped.startswith("*"):
                continue
            if stripped.startswith("#"):
                skipping_kernbegrippen = False
            else:
                continue

        filtered.append(line)

    return "\n".join(filtered).strip()


def test_analyze_structure_uses_mini_model_and_preserves_section_order(monkeypatch):
    markdown = (
        "## Afgeleiden\n"
        "De afgeleide meet verandering in een functie.\n\n"
        "## Integralen\n"
        "Een integraal telt oppervlak onder een grafiek."
    )
    source_sections = ai._extract_source_sections(markdown)
    captured: dict[str, str] = {}

    async def fake_call_json_completion(*, model: str, system_prompt: str, user_content: str) -> dict:
        captured["model"] = model
        captured["system_prompt"] = system_prompt
        captured["user_content"] = user_content
        return {
            "sections": [
                {
                    "start_marker": source_sections[0].start_marker,
                    "section_type": "theory",
                    "suggested_topic": "Calculus",
                    "suggested_chapter_title": "Afgeleiden",
                    "related_sections": [source_sections[1].start_marker],
                },
                {
                    "start_marker": source_sections[1].start_marker,
                    "section_type": "theory",
                    "suggested_topic": "Calculus",
                    "suggested_chapter_title": "Integralen",
                    "related_sections": [source_sections[0].start_marker],
                },
            ],
            "suggested_topics": ["Calculus"],
            "document_type": "textbook",
        }

    monkeypatch.setattr(ai, "_call_json_completion", fake_call_json_completion)

    analysis = asyncio.run(
        ai._analyze_structure(markdown, doc_type_hint="textbook", max_retries=1)
    )

    assert captured["model"] == ai.STRUCTURE_MODEL
    assert [section.start_marker for section in analysis.sections] == [
        section.start_marker for section in source_sections
    ]
    assert analysis.document_type == "textbook"
    assert analysis.suggested_topics == ["Calculus"]


def test_generate_study_plan_uses_three_phase_pipeline(monkeypatch):
    calls: list[str] = []
    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Afgeleiden",
                section_type="theory",
                suggested_topic="Calculus",
                suggested_chapter_title="Afgeleiden",
                related_sections=[],
            )
        ],
        suggested_topics=["Calculus"],
        document_type="textbook",
    )
    preserved = [
        ai.PreservedChapter(
            title="Afgeleiden",
            topic="Calculus",
            content="Afgeleiden inhoud",
            section_markers=["Afgeleiden"],
            section_types=["theory"],
        )
    ]
    metadata = ai.PlanMetadata(
        summaries=["Samenvatting over afgeleiden."],
        prerequisites=[[]],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
    )

    async def fake_analyze(*args, **kwargs):
        calls.append("phase1")
        return structure

    async def fake_preserve(*args, **kwargs):
        calls.append("phase2")
        return preserved

    async def fake_metadata(*args, **kwargs):
        calls.append("phase3")
        return metadata

    def fake_verify(*args, **kwargs):
        calls.append("verify")
        return make_verification_report()

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)

    plan = asyncio.run(ai.generate_study_plan("irrelevant"))

    assert calls == ["phase1", "phase2", "phase3", "verify"]
    assert plan.chapters[0].summary == "Samenvatting over afgeleiden."
    assert plan.verificationReport is not None
    assert plan.verificationReport.status == "OK"


def test_phase2_preserves_word_count_after_normalizing_allowed_markers(monkeypatch):
    markdown = (
        "## Afgeleiden\n"
        "De afgeleide meet verandering in een functie.\n\n"
        "DEFINITIE: De afgeleide is de limiet van het differentiequotiënt.\n\n"
        "OEFENING: Bereken de afgeleide van x^2."
    )
    source_section = ai._extract_source_sections(markdown)[0]
    structure_analysis = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker=source_section.start_marker,
                section_type="theory",
                suggested_topic="Calculus",
                suggested_chapter_title="Afgeleiden",
                related_sections=[],
            )
        ],
        suggested_topics=["Calculus"],
        document_type="textbook",
    )

    async def fake_call_json_completion(*, model: str, system_prompt: str, user_content: str) -> dict:
        assert model == ai.PRESERVATION_MODEL
        return {
            "content": "## Kernbegrippen\n- afgeleide\n\n" + markdown
        }

    monkeypatch.setattr(ai, "_call_json_completion", fake_call_json_completion)

    chapters = asyncio.run(
        ai._generate_chunked_study_plan(
            markdown,
            structure_analysis=structure_analysis,
            on_progress=None,
            max_retries=1,
        )
    )

    assert len(chapters) == 1
    normalized_output = normalize_preserved_output(chapters[0].content)
    assert count_words(markdown) == count_words(normalized_output)


def test_generate_study_plan_builds_final_plan_from_metadata(monkeypatch):
    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Lineaire Algebra",
                section_type="theory",
                suggested_topic="Wiskunde",
                suggested_chapter_title="Lineaire Algebra",
                related_sections=[],
            )
        ],
        suggested_topics=["Wiskunde"],
        document_type="textbook",
    )
    preserved = [
        ai.PreservedChapter(
            title="Lineaire Algebra",
            topic="Wiskunde",
            content="## Kernbegrippen\n- vector\n\nInhoud",
            section_markers=["Lineaire Algebra"],
            section_types=["theory"],
        )
    ]
    metadata = ai.PlanMetadata(
        summaries=["Dit hoofdstuk behandelt vectoren en matrices."],
        prerequisites=[[]],
        master_study_map="| Onderwerp | Hoofdstuk |",
        gpt_system_instructions="Gebruik file_search en citeer hoofdstukken.",
        course_metadata=make_course_metadata(
            has_formulas=True,
            has_exercises=True,
            total_exercises=2,
            difficulty_keywords=["regressie"],
        ),
    )

    async def fake_analyze(*args, **kwargs):
        return structure

    async def fake_preserve(*args, **kwargs):
        return preserved

    async def fake_metadata(*args, **kwargs):
        return metadata

    def fake_verify(*args, **kwargs):
        return make_verification_report()

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)

    plan = asyncio.run(ai.generate_study_plan("dummy content"))

    assert plan.chapters[0].summary == "Dit hoofdstuk behandelt vectoren en matrices."
    assert plan.masterStudyMap == "| Onderwerp | Hoofdstuk |"
    assert plan.gptSystemInstructions == "Gebruik file_search en citeer hoofdstukken."
    assert plan.topics == ["Wiskunde"]
    assert plan.verificationReport is not None
    assert plan.verificationReport.status == "OK"
    assert plan.courseMetadata is not None
    assert plan.courseMetadata.has_formulas is True
    assert plan.courseMetadata.total_exercises == 2


def test_assign_final_chapter_ids_populates_key_concepts_and_resolves_related_sections():
    chapters = [
        ai.PreservedChapter(
            title="Afgeleiden",
            topic="Calculus",
            content="## Kernbegrippen\n- afgeleide\n\nInhoud over afgeleiden",
            section_markers=["Afgeleiden"],
            section_types=["theory"],
            related_section_markers=["Integralen"],
        ),
        ai.PreservedChapter(
            title="Integralen",
            topic="Calculus",
            content="## Kernbegrippen\n- integraal\n\nInhoud over integralen",
            section_markers=["Integralen"],
            section_types=["theory"],
            related_section_markers=["Afgeleiden"],
        ),
    ]

    final_chapters = ai._assign_final_chapter_ids(
        chapters,
        ["Samenvatting afgeleiden.", "Samenvatting integralen."],
        ["Calculus"],
    )

    assert final_chapters[0].key_concepts == ["afgeleide"]
    assert final_chapters[1].key_concepts == ["integraal"]
    assert final_chapters[0].related_sections == ["T1-C2"]
    assert final_chapters[1].related_sections == ["T1-C1"]


def test_generate_course_metadata_uses_gpt4o_mini_for_beta_course(monkeypatch):
    chapters = [
        ai.PreservedChapter(
            title="Regressie in R",
            topic="Statistiek",
            content=(
                "## Kernbegrippen\n- regressie\n\n"
                "```r\nlibrary(ggplot2)\nmodel <- lm(y ~ x, data = df)\n```\n\n"
                "$$\\mu = \\frac{1}{n}\\sum x_i$$\n\n"
                "OEFENING: Bereken de regressielijn."
            ),
            section_markers=["Regressie in R"],
            section_types=["theory", "exercise"],
        )
    ]

    async def fake_call_json_completion(*, model: str, system_prompt: str, user_content: str) -> dict:
        assert model == ai.COURSE_METADATA_MODEL
        assert "Return valid JSON only" in system_prompt
        assert "exercise_types" in system_prompt
        assert "library(ggplot2)" in user_content
        return {
            "has_formulas": True,
            "has_exercises": True,
            "has_code": True,
            "primary_language": "nl",
            "exercise_types": ["berekening"],
            "total_exercises": 1,
            "detected_tools": ["R"],
            "difficulty_keywords": ["regressie"],
        }

    monkeypatch.setattr(ai, "_call_json_completion", fake_call_json_completion)

    metadata = asyncio.run(ai._generate_course_metadata(chapters, max_retries=1))

    assert metadata.has_formulas is True
    assert metadata.has_code is True
    assert metadata.detected_tools == ["R"]
    assert metadata.exercise_types == ["berekening"]


def test_fallback_course_metadata_detects_theory_only_alpha_course():
    chapters = [
        ai.PreservedChapter(
            title="Literatuurgeschiedenis",
            topic="Letterkunde",
            content="## Kernbegrippen\n- modernisme\n\nDeze tekst bespreekt auteurs, stromingen en context zonder oefeningen of code.",
            section_markers=["Literatuurgeschiedenis"],
            section_types=["theory"],
        )
    ]

    metadata = ai._fallback_course_metadata_from_preserved_chapters(chapters)

    assert metadata.has_formulas is False
    assert metadata.has_code is False
    assert metadata.has_exercises is False
    assert metadata.total_exercises == 0
    assert metadata.detected_tools == []


def test_generate_study_plan_progress_spans_three_phases(monkeypatch):
    progress_updates: list[int] = []
    structure = StructureAnalysis(
        sections=[],
        suggested_topics=["Algemeen"],
        document_type="mixed",
    )
    preserved: list[ai.PreservedChapter] = []
    metadata = ai.PlanMetadata(
        summaries=[],
        prerequisites=[],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
    )

    async def fake_analyze(*args, **kwargs):
        return structure

    async def fake_preserve(*args, **kwargs):
        return preserved

    async def fake_metadata(*args, **kwargs):
        return metadata

    def fake_verify(*args, **kwargs):
        return make_verification_report()

    async def on_progress(step: str, progress: int, message: str) -> None:
        assert step == "ai"
        assert message
        progress_updates.append(progress)

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)

    asyncio.run(ai.generate_study_plan("dummy", on_progress=on_progress))

    assert progress_updates == [5, 20, 80, 95, 100]
    assert min(progress_updates) < 20
    assert any(20 <= value <= 80 for value in progress_updates)
    assert any(80 <= value <= 100 for value in progress_updates)


def test_generate_study_plan_with_formula_sheet_includes_reference_chapter(monkeypatch):
    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Afgeleiden",
                section_type="theory",
                suggested_topic="Calculus",
                suggested_chapter_title="Afgeleiden",
                related_sections=["Formuleoverzicht"],
            ),
            SectionAnalysis(
                start_marker="Formuleoverzicht",
                section_type="formula",
                suggested_topic="Referentie",
                suggested_chapter_title="Formuleoverzicht",
                related_sections=["Afgeleiden"],
            ),
        ],
        suggested_topics=["Calculus", "Referentie"],
        document_type="formula_sheet",
    )
    preserved = [
        ai.PreservedChapter(
            title="Afgeleiden",
            topic="Calculus",
            content="### Relevante Formules\n$$f'(x)=2x$$",
            section_markers=["Afgeleiden"],
            section_types=["theory"],
        ),
        ai.PreservedChapter(
            title="Formuleoverzicht",
            topic="Referentie",
            content="## Formules\n$$f'(x)=2x$$",
            section_markers=["Formuleoverzicht"],
            section_types=["formula"],
        ),
    ]
    metadata = ai.PlanMetadata(
        summaries=["Samenvatting calculus.", "Samenvatting referentie."],
        prerequisites=[[], ["Afgeleiden"]],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
    )

    async def fake_analyze(*args, **kwargs):
        return structure

    async def fake_preserve(*args, **kwargs):
        return preserved

    async def fake_metadata(*args, **kwargs):
        return metadata

    def fake_verify(*args, **kwargs):
        return make_verification_report()

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)

    plan = asyncio.run(
        ai.generate_study_plan(
            "Hoofdstuk calculus met los formuleblad",
            doc_type="formula_sheet",
        )
    )

    assert any(
        chapter.id == "REF-FORMULAS" and chapter.topic == "Referentie"
        for chapter in plan.chapters
    )
    assert plan.topics == ["Calculus", "Referentie"]


def test_generate_study_plan_verifies_then_recovers_missing_content(monkeypatch):
    calls: list[str] = []
    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Statistiek",
                section_type="theory",
                suggested_topic="Statistiek",
                suggested_chapter_title="Statistiek",
                related_sections=[],
            )
        ],
        suggested_topics=["Statistiek"],
        document_type="textbook",
    )
    preserved = [
        ai.PreservedChapter(
            title="Statistiek",
            topic="Statistiek",
            content="Inleidende inhoud",
            section_markers=["Statistiek"],
            section_types=["theory"],
        )
    ]
    metadata = ai.PlanMetadata(
        summaries=["Samenvatting statistiek."],
        prerequisites=[[]],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
    )
    recovered = [
        ai.PreservedChapter(
            title="Herstel: Oefeningen",
            topic=ai.RECOVERY_TOPIC,
            content="OEFENING: Herstelde oefening",
            section_markers=["Recovery 1-1: Oefeningen"],
            section_types=["exercise"],
        )
    ]
    verification_calls = {"count": 0}

    async def fake_analyze(*args, **kwargs):
        calls.append("phase1")
        return structure

    async def fake_preserve(*args, **kwargs):
        calls.append("phase2")
        return preserved

    async def fake_metadata(*args, **kwargs):
        calls.append("phase3")
        return metadata

    def fake_verify(*args, **kwargs):
        verification_calls["count"] += 1
        calls.append(f"verify{verification_calls['count']}")
        if verification_calls["count"] == 1:
            return make_verification_report("CRITICAL")
        return make_verification_report("OK")

    def fake_recover(*args, **kwargs):
        calls.append("recover")
        return recovered

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_recover_missing_chapters", fake_recover)

    plan = asyncio.run(ai.generate_study_plan("broninhoud"))

    assert calls == ["phase1", "phase2", "phase3", "verify1", "recover", "verify2"]
    assert any(chapter.topic == ai.RECOVERY_TOPIC for chapter in plan.chapters)
    assert any(chapter.id == "T2-C1" for chapter in plan.chapters if chapter.topic == ai.RECOVERY_TOPIC)
    assert plan.verificationReport is not None
    assert plan.verificationReport.status == "OK"


def test_merge_topics_places_recovery_before_reference():
    topics = ai._merge_topics_with_reference_last(
        ["Calculus", ai.REFERENCE_TOPIC, ai.RECOVERY_TOPIC]
    )

    assert topics == ["Calculus", ai.RECOVERY_TOPIC, ai.REFERENCE_TOPIC]


def test_split_markdown_into_chunks_respects_size_limits():
    block = ("## Hoofdstuk\n" + ("regel\n" * 5_000)).strip()
    content = "\n\n---\n\n".join([
        f"# Document {i + 1}\n\n{block}" for i in range(3)
    ])

    chunks = ai._split_markdown_into_chunks(content)

    assert len(chunks) > 1
    assert all(len(chunk) <= ai.HARD_CHUNK_CHARS for chunk in chunks)


def test_split_markdown_into_chunks_single_block_under_limit():
    content = "## Sectie\n\nKorte inhoud met wat tekst.\n"

    chunks = ai._split_markdown_into_chunks(content)

    assert len(chunks) == 1
    assert chunks[0] == content.strip() or content.strip() in chunks[0]
