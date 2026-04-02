from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.schemas import Chapter  # noqa: E402
from services import ai  # noqa: E402
from services.content_verifier import verify_content_preservation  # noqa: E402


def make_word_block(word: str, count: int) -> str:
    return " ".join([word] * count)


def make_original_markdown() -> str:
    section_one = "\n".join(
        [
            "## Basisbegrippen",
            make_word_block("gemiddelde", 220),
            "OEFENING: Vraag 1 bereken het gemiddelde van de steekproef.",
        ]
    )
    section_two = "\n".join(
        [
            "## Tabellen en formules",
            make_word_block("frequentietabel", 190),
            "| score | kans |",
            "| --- | --- |",
            "| 1 | 0.20 |",
            "| 2 | 0.80 |",
            "$$P(X=x)=\\frac{x}{10}$$",
        ]
    )
    section_three = "\n".join(
        [
            "## Regressieanalyse",
            make_word_block("regressie", 170),
            make_word_block("likelihood", 60),
            "| model | fout |",
            "| --- | --- |",
            "| lineair | 0.12 |",
            "| logistisch | 0.08 |",
            "OEFENING: Vraag 2 interpreteer de regressiecoefficienten.",
        ]
    )
    section_four = "\n".join(
        [
            "## Variantie en standaardisatie",
            make_word_block("variantie", 180),
            "De standaardscore wordt gegeven door $z = (x - \\mu) / \\sigma$.",
            "OEFENING: Vraag 3 standaardiseer de waarneming.",
        ]
    )
    return "\n\n".join([section_one, section_two, section_three, section_four])


def make_generated_chapters() -> list[Chapter]:
    return [
        Chapter(
            id="T1-C1",
            title="Basisbegrippen",
            summary="Basis",
            topic="Statistiek",
            content="\n".join(
                [
                    "## Basisbegrippen",
                    make_word_block("gemiddelde", 220),
                    "OEFENING: Vraag 1 bereken het gemiddelde van de steekproef.",
                ]
            ),
            key_concepts=["gemiddelde"],
            related_sections=[],
        ),
        Chapter(
            id="T1-C2",
            title="Tabellen en formules",
            summary="Tabel",
            topic="Statistiek",
            content="\n".join(
                [
                    "## Tabellen en formules",
                    make_word_block("frequentietabel", 90),
                    "| score | kans |",
                    "| --- | --- |",
                    "| 1 | 0.20 |",
                    "| 2 | 0.80 |",
                    "$$P(X=x)=\\frac{x}{10}$$",
                ]
            ),
            key_concepts=["frequentietabel"],
            related_sections=[],
        ),
    ]


def test_verify_content_preservation_flags_critical_loss():
    original_markdown = make_original_markdown()
    generated_chapters = make_generated_chapters()

    report = verify_content_preservation(original_markdown, generated_chapters)

    assert report.status == "CRITICAL"
    assert report.word_ratio < 0.7
    assert report.exercise_count_original == 3
    assert report.exercise_count_generated == 1
    assert "regressie" in report.missing_keywords
    assert "likelihood" in report.missing_keywords
    assert any("Slechts" in issue for issue in report.issues)
    assert "2 oefeningen ontbreken" in report.issues
    assert any("tabellen" in issue.lower() or "tabel" in issue.lower() for issue in report.issues)
    assert any("formule" in issue.lower() for issue in report.issues)


def test_finalize_study_plan_recovers_missing_material():
    original_markdown = make_original_markdown()
    generated_chapters = make_generated_chapters()
    preserved = [
        ai.PreservedChapter(
            title=chapter.title,
            topic=chapter.topic,
            content=chapter.content,
            section_markers=[chapter.title],
            section_types=["theory"],
        )
        for chapter in generated_chapters
    ]
    metadata = ai.PlanMetadata(
        summaries=["Basis hoofdstuk.", "Tabel hoofdstuk."],
        prerequisites=[[], ["Basisbegrippen"]],
        master_study_map="",
        gpt_system_instructions="Gebruik de knowledge base.",
    )

    plan = ai._finalize_study_plan(original_markdown, preserved, metadata)

    recovery_chapters = [
        chapter for chapter in plan.chapters if chapter.topic == ai.RECOVERY_TOPIC
    ]

    assert recovery_chapters
    assert any(chapter.id.startswith("T2-C") for chapter in recovery_chapters)
    assert any("Regressieanalyse" in chapter.content for chapter in recovery_chapters)
    assert any("Variantie en standaardisatie" in chapter.content for chapter in recovery_chapters)
    assert plan.verificationReport is not None
    assert plan.verificationReport.exercise_count_generated >= 3
