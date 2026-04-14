from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.schemas import (  # noqa: E402
    Chapter,
    ConceptLink,
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

    async def fake_bloom(*_a, **_kw):
        return [1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

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

    async def fake_bloom(*_a, **_kw):
        return [1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

    plan = asyncio.run(ai.generate_study_plan("dummy content"))

    assert plan.chapters[0].summary == "Dit hoofdstuk behandelt vectoren en matrices."
    assert "Lineaire Algebra" in plan.masterStudyMap
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

    async def fake_bloom(*_a, **_kw):
        return []

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

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

    async def fake_bloom(*_a, **_kw):
        return [1, 1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

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

    async def fake_bloom(*_a, **_kw):
        return [1, 1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", fake_verify)
    monkeypatch.setattr(ai, "_recover_missing_chapters", fake_recover)
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

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
    # Context headers add ~100 chars per chunk; allow small overhead beyond HARD_CHUNK_CHARS
    _CONTEXT_HEADER_OVERHEAD = 200
    assert all(len(chunk) <= ai.HARD_CHUNK_CHARS + _CONTEXT_HEADER_OVERHEAD for chunk in chunks)


def test_split_markdown_into_chunks_single_block_under_limit():
    content = "## Sectie\n\nKorte inhoud met wat tekst.\n"

    chunks = ai._split_markdown_into_chunks(content)

    assert len(chunks) == 1
    # Each chunk is prefixed with a [CONTEXT: ...] header
    assert chunks[0].startswith("[CONTEXT:")
    assert content.strip() in chunks[0]


def test_semantic_chunking_keeps_atomic_blocks_intact():
    """Een OEFENING:-blok dat groter is dan TARGET_CHUNK_CHARS mag nooit worden gesplitst."""
    long_exercise = "OEFENING: Bereken de integraal\n" + ("x " * (ai.TARGET_CHUNK_CHARS // 2 + 1000))

    markdown_content = (
        "# Hoofdstuk 1\n\nInleiding tot calculus.\n\n"
        + long_exercise
        + "\n\n# Hoofdstuk 2\n\nNa de oefening.\n"
    )

    result = ai._split_markdown_into_chunks(markdown_content)

    # De oefening moet in precies één chunk zitten (is_atomic → nooit splitsen)
    exercise_chunks = [c for c in result if "OEFENING:" in c]
    assert len(exercise_chunks) == 1, "Atomic OEFENING:-blok mag niet over meerdere chunks verspreid zijn"

    # De oefeningstekst moet volledig intact zijn
    assert "Bereken de integraal" in exercise_chunks[0]

    # Andere content mag normaal gechunkt zijn
    assert any("Inleiding tot calculus" in c for c in result)
    assert any("Na de oefening" in c for c in result)


# ---------------------------------------------------------------------------
# Search profile tests
# ---------------------------------------------------------------------------

def test_search_profiles_are_stored_on_chapters(monkeypatch):
    """Search profiles returned by the metadata phase are stored on each Chapter."""
    chapter_content = (
        "## Attitudes\n\n"
        "Cognitieve dissonantie treedt op wanneer twee cognities tegenstrijdig zijn. "
        "Affectief commitment verwijst naar emotionele binding. "
        "Normatief commitment is gebaseerd op verplichting.\n\n"
        "OEFENING: Wat is het verschil tussen affectief en normatief commitment?"
    )
    expected_questions = [
        "Wat is cognitieve dissonantie en hoe los je het op?",
        "Wat is het verschil tussen affectief en normatief commitment?",
        "Hoe werkt de Theory of Planned Behavior?",
    ]

    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Attitudes",
                section_type="theory",
                suggested_topic="Organisatiepsychologie",
                suggested_chapter_title="Attitudes",
                related_sections=[],
            )
        ],
        suggested_topics=["Organisatiepsychologie"],
        document_type="textbook",
    )
    preserved = [
        ai.PreservedChapter(
            title="Attitudes",
            topic="Organisatiepsychologie",
            content=chapter_content,
            section_markers=["Attitudes"],
            section_types=["theory"],
            key_concepts=["cognitieve dissonantie", "affectief commitment", "normatief commitment"],
        )
    ]
    metadata = ai.PlanMetadata(
        summaries=["Behandelt attitudes, commitment en cognitieve dissonantie."],
        prerequisites=[[]],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
        search_profiles=[expected_questions],
    )

    async def fake_analyze(*_args, **_kwargs):
        return structure

    async def fake_preserve(*_args, **_kwargs):
        return preserved

    async def fake_metadata(*_args, **_kwargs):
        return metadata

    async def fake_bloom(*_a, **_kw):
        return [1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", lambda *a, **kw: make_verification_report())
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

    plan = asyncio.run(ai.generate_study_plan("irrelevant"))

    assert len(plan.chapters) == 1
    chapter = plan.chapters[0]
    assert chapter.search_profile == expected_questions
    assert all(isinstance(q, str) and q for q in chapter.search_profile)


def test_search_profile_questions_contain_chapter_terms(monkeypatch):
    """Search profile questions reference terms that appear in chapter content/key_concepts."""
    chapter_content = (
        "## Theory of Planned Behavior\n\n"
        "De Theory of Planned Behavior (TPB) beschrijft hoe intenties gedrag voorspellen. "
        "Attitudes, subjectieve norm en gedragscontrole bepalen samen de intentie. "
        "Cognitieve dissonantie leidt tot attitude-verandering.\n"
    )
    key_concepts = ["Theory of Planned Behavior", "cognitieve dissonantie", "subjectieve norm"]
    questions = [
        "Hoe werkt de Theory of Planned Behavior?",
        "Wat bepaalt de intentie volgens de TPB?",
        "Wat is cognitieve dissonantie en hoe los je het op?",
        "Welke rol speelt subjectieve norm in de TPB?",
    ]

    structure = StructureAnalysis(
        sections=[
            SectionAnalysis(
                start_marker="Theory of Planned Behavior",
                section_type="theory",
                suggested_topic="Attitudes",
                suggested_chapter_title="Theory of Planned Behavior",
                related_sections=[],
            )
        ],
        suggested_topics=["Attitudes"],
        document_type="textbook",
    )
    preserved = [
        ai.PreservedChapter(
            title="Theory of Planned Behavior",
            topic="Attitudes",
            content=chapter_content,
            section_markers=["Theory of Planned Behavior"],
            section_types=["theory"],
            key_concepts=key_concepts,
        )
    ]
    metadata = ai.PlanMetadata(
        summaries=["Legt de Theory of Planned Behavior uit."],
        prerequisites=[[]],
        master_study_map="| onderwerp | hoofdstuk |",
        gpt_system_instructions="Gebruik de knowledge base.",
        search_profiles=[questions],
    )

    async def fake_analyze(*_args, **_kwargs):
        return structure

    async def fake_preserve(*_args, **_kwargs):
        return preserved

    async def fake_metadata(*_args, **_kwargs):
        return metadata

    async def fake_bloom(*_a, **_kw):
        return [1]

    async def fake_detect(*_a, **_kw):
        return []

    monkeypatch.setattr(ai, "_analyze_structure", fake_analyze)
    monkeypatch.setattr(ai, "_generate_chunked_study_plan", fake_preserve)
    monkeypatch.setattr(ai, "_generate_metadata", fake_metadata)
    monkeypatch.setattr(ai, "verify_content_preservation", lambda *a, **kw: make_verification_report())
    monkeypatch.setattr(ai, "_detect_bloom_levels", fake_bloom)
    monkeypatch.setattr(ai, "_detect_overlapping_content", fake_detect)

    plan = asyncio.run(ai.generate_study_plan("irrelevant"))

    chapter = plan.chapters[0]
    assert chapter.search_profile, "search_profile mag niet leeg zijn"

    # Every key concept must appear as a substring in at least one search question
    all_questions_text = " ".join(chapter.search_profile).lower()
    for concept in key_concepts:
        assert concept.lower() in all_questions_text, (
            f"Concept '{concept}' ontbreekt in de zoekprofielvragen"
        )


# ---------------------------------------------------------------------------
# Concept-linking tests
# ---------------------------------------------------------------------------


def test_detect_overlapping_content_returns_concept_links(monkeypatch):
    """_detect_overlapping_content parses GPT output into ConceptLink objects."""
    raw_response = {
        "concept_links": [
            {"concept": "Cognitieve dissonantie", "chapter_ids": ["T1-C1", "T1-C2"], "relationship": "overlap"},
            {"concept": "Attitude", "chapter_ids": ["T1-C1", "T1-C2"], "relationship": "extends"},
        ]
    }

    async def fake_completion(*_args, **_kwargs):
        return raw_response

    monkeypatch.setattr(ai, "_call_json_completion", fake_completion)

    chapters = [
        Chapter(id="T1-C1", title="Attitudes", summary="s", topic="Gedrag", content="## Kernbegrippen\n- cognitieve dissonantie"),
        Chapter(id="T1-C2", title="Commitment", summary="s", topic="Gedrag", content="## Kernbegrippen\n- attitude\n- commitment"),
    ]

    links = asyncio.run(ai._detect_overlapping_content(chapters))

    assert len(links) == 2
    assert all(isinstance(link, ConceptLink) for link in links)
    assert links[0].concept == "Cognitieve dissonantie"
    assert set(links[0].chapter_ids) == {"T1-C1", "T1-C2"}
    assert links[0].relationship == "overlap"


def test_apply_concept_links_injects_cross_refs_in_plan():
    """_apply_concept_links adds Gerelateerd materiaal, updates masterStudyMap, and sets concept_links."""
    chapters = [
        Chapter(id="T1-C1", title="Attitudes", summary="s", topic="Gedrag", content="Inhoud A"),
        Chapter(id="T1-C2", title="Commitment", summary="s", topic="Gedrag", content="Inhoud B"),
    ]
    plan = StudyPlan(
        chapters=chapters,
        topics=["Gedrag"],
        masterStudyMap=ai._build_master_study_map(chapters),
        gptSystemInstructions="Use KB.",
    )

    concept_links = [
        ConceptLink(concept="Cognitieve dissonantie", chapter_ids=["T1-C1", "T1-C2"], relationship="overlap")
    ]

    result = ai._apply_concept_links(plan, concept_links)

    # concept_links set on plan
    assert result.concept_links == concept_links

    # Cross-refs injected into masterStudyMap
    assert "Cross-refs" in result.masterStudyMap
    assert "T1-C2" in result.masterStudyMap
    assert "T1-C1" in result.masterStudyMap

    # Gerelateerd materiaal injected into chapter content
    c1 = next(c for c in result.chapters if c.id == "T1-C1")
    assert "Gerelateerd materiaal" in c1.content
    assert "T1-C2" in c1.content

    # Concept map in gptSystemInstructions
    assert "Concept Overlap Map" in result.gptSystemInstructions
    assert "Cognitieve dissonantie" in result.gptSystemInstructions


# ---------------------------------------------------------------------------
# Bloom's Taxonomy tests
# ---------------------------------------------------------------------------


def test_detect_bloom_levels_parses_gpt_output(monkeypatch):
    """_detect_bloom_levels returns a list of integers matching chapter count."""
    raw_response = {"bloom_levels": [1, 4]}

    async def fake_completion(*_args, **_kwargs):
        return raw_response

    monkeypatch.setattr(ai, "_call_json_completion", fake_completion)

    chapters = [
        Chapter(id="T1-C1", title="Feiten", summary="s", topic="Kennis", content="Definitie van een begrip."),
        Chapter(id="T1-C2", title="Analyse", summary="s", topic="Kennis", content="Casusstudie over marketing."),
    ]

    levels = asyncio.run(ai._detect_bloom_levels(chapters))

    assert levels == [1, 4]


def test_bloom_level_and_study_time_calculation():
    """_apply_bloom_metadata computes estimatedStudyMinutes from word count and bloom speed."""
    # Bloom 1 → 100 wpm; 100 words → 1 minute
    content_bloom1 = " ".join(["word"] * 100)
    # Bloom 4 → 60 wpm; 120 words → 2 minutes
    content_bloom4 = " ".join(["word"] * 120)

    chapters = [
        Chapter(id="T1-C1", title="Kennis", summary="s", topic="Topic", content=content_bloom1),
        Chapter(id="T1-C2", title="Analyse", summary="s", topic="Topic", content=content_bloom4),
    ]
    plan = StudyPlan(
        chapters=chapters,
        topics=["Topic"],
        masterStudyMap=ai._build_master_study_map(chapters),
        gptSystemInstructions="Use KB.",
    )

    result = ai._apply_bloom_metadata(plan, bloom_levels=[1, 4])

    c1 = next(c for c in result.chapters if c.id == "T1-C1")
    c2 = next(c for c in result.chapters if c.id == "T1-C2")

    assert c1.bloomLevel == 1
    assert c1.estimatedStudyMinutes == 1  # 100 words / 100 wpm = 1 min

    assert c2.bloomLevel == 4
    assert c2.estimatedStudyMinutes == 2  # 120 words / 60 wpm = 2 min

    assert "Bloom Level" in result.masterStudyMap
    assert "Est. Tijd (min)" in result.masterStudyMap
