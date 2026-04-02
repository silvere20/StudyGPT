from __future__ import annotations

import re
from collections import Counter

from models.schemas import Chapter, VerificationReport

_WORD_RE = re.compile(r"[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'_-]*")
_DISPLAY_FORMULA_RE = re.compile(r"\$\$[\s\S]+?\$\$")
_INLINE_FORMULA_RE = re.compile(r"(?<!\$)\$(?!\$)(?:\\.|[^$\n])+(?<!\\)\$(?!\$)")
_EXERCISE_RE = re.compile(r"(?i)\bOEFENING\s*:|\bVraag\s+\d+\b")
_TABLE_LINE_RE = re.compile(r"^\s*\|.*\|\s*$")
_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```")
_STOPWORDS = {
    "about",
    "above",
    "after",
    "again",
    "against",
    "alles",
    "also",
    "altijd",
    "ander",
    "andere",
    "anders",
    "been",
    "being",
    "below",
    "between",
    "bij",
    "binnen",
    "both",
    "cannot",
    "could",
    "daar",
    "daarna",
    "dan",
    "dat",
    "deze",
    "dit",
    "door",
    "eens",
    "een",
    "eens",
    "elke",
    "enough",
    "eruit",
    "from",
    "geen",
    "geweest",
    "haar",
    "have",
    "having",
    "heel",
    "hier",
    "hij",
    "hoe",
    "hun",
    "into",
    "jaar",
    "jezelf",
    "jouw",
    "just",
    "krijgen",
    "later",
    "maar",
    "meest",
    "meer",
    "met",
    "mijn",
    "naar",
    "niet",
    "niets",
    "nog",
    "omdat",
    "onder",
    "ons",
    "onze",
    "ook",
    "over",
    "same",
    "she",
    "should",
    "sinds",
    "some",
    "such",
    "than",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "through",
    "tot",
    "tussen",
    "under",
    "very",
    "veel",
    "voor",
    "waar",
    "waren",
    "wat",
    "when",
    "which",
    "while",
    "will",
    "with",
    "worden",
    "would",
    "your",
    "zich",
    "zijn",
    "zoals",
    "zonder",
    "zoals",
}


def verify_content_preservation(
    original_markdown: str,
    generated_chapters: list[Chapter],
) -> VerificationReport:
    generated_markdown = "\n\n".join(
        chapter.content.strip() for chapter in generated_chapters if chapter.content.strip()
    )

    original_word_count = max(_count_words(original_markdown), 1)
    generated_word_count = _count_words(generated_markdown)
    word_ratio = round(generated_word_count / original_word_count, 4)

    original_keywords = _extract_signature_keywords(original_markdown, min_frequency=3)
    generated_tokens = set(_tokenize_words(generated_markdown))
    missing_keywords = [keyword for keyword in original_keywords if keyword not in generated_tokens]

    exercise_count_original = _count_exercises(original_markdown)
    exercise_count_generated = _count_exercises(generated_markdown)
    table_count_original = _count_tables(original_markdown)
    table_count_generated = _count_tables(generated_markdown)
    formula_count_original = _count_formulas(original_markdown)
    formula_count_generated = _count_formulas(generated_markdown)

    issues: list[str] = []
    is_critical = False
    is_warning = False

    if word_ratio < 0.7:
        issues.append(f"Slechts {round(word_ratio * 100)}% van de tekst is behouden")
        is_critical = True
    elif word_ratio < 0.9:
        issues.append(f"Tekstbehoud is gedaald naar {round(word_ratio * 100)}%")
        is_warning = True

    if missing_keywords:
        preview = ", ".join(missing_keywords[:5])
        if len(missing_keywords) > 5:
            preview += ", ..."
        issues.append(
            f"{len(missing_keywords)} kernterm{'en' if len(missing_keywords) != 1 else ''} ontbreken: {preview}"
        )
        is_warning = True

    missing_exercises = max(exercise_count_original - exercise_count_generated, 0)
    if missing_exercises:
        issues.append(
            f"{missing_exercises} oefening{'en' if missing_exercises != 1 else ''} ontbreken"
        )
        is_critical = True

    missing_tables = max(table_count_original - table_count_generated, 0)
    if missing_tables:
        if missing_tables == 1:
            issues.append("1 tabel ontbreekt")
        else:
            issues.append(f"{missing_tables} tabellen ontbreken")
        is_warning = True

    missing_formulas = max(formula_count_original - formula_count_generated, 0)
    if missing_formulas:
        if missing_formulas == 1:
            issues.append("1 formule ontbreekt")
        else:
            issues.append(f"{missing_formulas} formules ontbreken")
        is_warning = True

    status = "OK"
    if is_critical:
        status = "CRITICAL"
    elif is_warning:
        status = "WARNING"

    return VerificationReport(
        status=status,
        word_ratio=word_ratio,
        missing_keywords=missing_keywords,
        exercise_count_original=exercise_count_original,
        exercise_count_generated=exercise_count_generated,
        issues=issues,
    )


def _count_words(text: str) -> int:
    return len(_tokenize_words(text))


def _tokenize_words(text: str) -> list[str]:
    return [match.lower() for match in _WORD_RE.findall(_normalize_markdown_text(text))]


def _normalize_markdown_text(text: str) -> str:
    normalized = _CODE_FENCE_RE.sub(" ", text)
    normalized = _DISPLAY_FORMULA_RE.sub(" ", normalized)
    normalized = _INLINE_FORMULA_RE.sub(" ", normalized)
    normalized = re.sub(r"`([^`]+)`", r" \1 ", normalized)
    normalized = re.sub(r"[*_>#~\-]+", " ", normalized)
    normalized = re.sub(r"[|\[\](){}:;,.!?/\\]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip().lower()


def _extract_signature_keywords(text: str, *, min_frequency: int) -> list[str]:
    counts = Counter(
        token
        for token in _tokenize_words(text)
        if len(token) > 4 and token not in _STOPWORDS
    )
    return [
        token
        for token, count in counts.most_common()
        if count >= min_frequency
    ]


def _count_exercises(text: str) -> int:
    count = 0
    for line in text.splitlines():
        if _EXERCISE_RE.search(line):
            count += 1
    return count


def _count_tables(text: str) -> int:
    count = 0
    in_table = False

    for line in text.splitlines():
        is_table_line = bool(_TABLE_LINE_RE.match(line.strip()))
        if is_table_line and not in_table:
            count += 1
        in_table = is_table_line

    return count


def _count_formulas(text: str) -> int:
    display_formulas = _DISPLAY_FORMULA_RE.findall(text)
    without_display = _DISPLAY_FORMULA_RE.sub(" ", text)
    inline_formulas = _INLINE_FORMULA_RE.findall(without_display)
    return len(display_formulas) + len(inline_formulas)
