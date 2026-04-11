import asyncio
import json
import logging
import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from openai import APIStatusError, AsyncOpenAI
from pydantic import BaseModel, Field

from models.schemas import (
    Chapter,
    CourseMetadata,
    SectionAnalysis,
    StructureAnalysis,
    StudyPlan,
)
from services.content_verifier import (
    _count_exercises,
    _count_formulas,
    _count_tables,
    _extract_signature_keywords,
    _normalize_markdown_text,
    verify_content_preservation,
)

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

ProgressCallback = Callable[[str, int, str], Awaitable[None]]
DOCUMENT_SEPARATOR = "\n\n---\n\n"
_RETRY_DELAYS = (1, 2, 4)  # exponential backoff in seconden voor 429/503
TARGET_CHUNK_CHARS = 60_000
HARD_CHUNK_CHARS = 80_000
MIN_RECURSIVE_CHUNK_CHARS = 4_000
REFERENCE_TOPIC = "Referentie"
RECOVERY_TOPIC = "Ontbrekend Materiaal"
STRUCTURE_MODEL = "gpt-4.1-mini"
PRESERVATION_MODEL = "gpt-4.1"
METADATA_MODEL = "gpt-4.1-mini"
COURSE_METADATA_MODEL = "gpt-4o-mini"
DEFAULT_RECOVERY_SUMMARY = (
    "Automatisch hersteld bronmateriaal dat in de eerste AI-generatie onvoldoende behouden bleef."
)


@dataclass
class SemanticBlock:
    content: str
    block_type: str  # 'code', 'formula', 'table', 'exercise', 'definition', 'prose', 'header'
    is_atomic: bool
    char_count: int


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


STRUCTURE_ANALYSIS_PROMPT = """You analyze document structure only. You do NOT rewrite or summarize content.

Return valid JSON with this exact shape:
{
  "sections": [
    {
      "start_marker": "exact start marker from input",
      "section_type": "theory | exercise | definition | example | formula",
      "suggested_topic": "Topic name",
      "suggested_chapter_title": "Chapter title",
      "related_sections": ["other start marker"]
    }
  ],
  "suggested_topics": ["Topic 1", "Topic 2"],
  "document_type": "slides | schedule | formula_sheet | exam | article | textbook | mixed | auto"
}

Rules:
- Use the EXACT provided `start_marker` values.
- Return the SAME number of sections as the input and keep the SAME order.
- Determine chapter boundaries by reusing the same `suggested_topic` + `suggested_chapter_title` across contiguous sections.
- `related_sections` must only reference existing `start_marker` values.
- If the material is a formula sheet, classify sections as `formula`, use topic `Referentie`, and use chapter title `Formuleoverzicht`.
- Base your decision only on headers, first-sentence previews, marker keywords, and table headers."""


CONTENT_PRESERVATION_PROMPT = """You preserve the exact source content for a predetermined chapter.

Return valid JSON with this exact shape:
{
  "content": "Full preserved markdown"
}

Rules:
- The chapter title and topic are already decided. Do NOT invent new chapter boundaries.
- Preserve the source text EXACTLY. Do not summarize, paraphrase, shorten, omit, or rename source content.
- You may only add light Markdown structure and explicit markers such as `Kernbegrippen`, `OEFENING:`, `DEFINITIE:`, `VOORBEELD:`, and `### Relevante Formules` when they are directly supported by the source text or chapter analysis.
- Keep formulas literal in LaTeX and keep full tables and exercises.
- Generate NO summary and NO metadata in this step.
- Return only the preserved markdown for this chunk of the predetermined chapter."""


METADATA_PROMPT = """You generate lightweight study metadata only. You do NOT rewrite chapter titles, topics, or source content.

Return valid JSON with this exact shape:
{
  "summaries": ["2-3 sentence summary", "..."],
  "prerequisites": [["Chapter title"], []],
  "master_study_map": "<markdown table>",
  "gpt_system_instructions": "<instructions>",
  "search_profiles": [["Vraag 1?", "Vraag 2?", ...], ...]
}

Rules:
- The `summaries` list MUST have the same length and order as the input chapters.
- Each summary must be 2-3 sentences and at most 60 words.
- `prerequisites` must align 1:1 with the input chapters and contain chapter titles only.
- `master_study_map` must include topic, chapter title, core concepts, exercise count, and prerequisites.
- `gpt_system_instructions` must tell the tutor to cite topic/chapter sources and use active recall + spaced repetition.
- `search_profiles` must have the same length and order as `summaries`. Each entry is a list of 5-10 student questions (in the chapter's language) that this chapter directly answers. Use natural student phrasing such as "Wat is het verschil tussen X en Y?", "Hoe werkt Z?", "Welke factoren bepalen W?". Base the questions on the chapter title, topic, core_concepts, and content_sample.
- Use only the provided chapter metadata."""


COURSE_METADATA_PROMPT = """Return valid JSON only. Do not wrap it in markdown. Do not add explanation.

Return this exact shape:
{
  "has_formulas": false,
  "has_exercises": false,
  "has_code": false,
  "primary_language": "nl",
  "exercise_types": [],
  "total_exercises": 0,
  "detected_tools": [],
  "difficulty_keywords": []
}

Rules:
- Every field must be present.
- Use booleans, strings, integers, and arrays only. Never use null.
- Use [] for empty lists.
- `primary_language` must be a short lowercase language code like `nl` or `en`.
- `exercise_types` may only contain: `meerkeuze`, `open`, `berekening`.
- `detected_tools` may only include tools explicitly visible in the input, such as `R`, `Python`, `SPSS`, `Excel`, `Stata`, `MATLAB`.
- Be conservative: if unsure, prefer false or an empty list.

Recognition guidance:
- Detect formulas from LaTeX/math markers such as `$$`, `$...$`, `\\mu`, `\\sigma`, `\\int`, `\\sum`.
- Detect code from fenced code blocks, inline code, or syntax such as `library(`, `import`, `def`, `<-`, `ggplot`, `lm(`.
- Detect exercises from markers such as `OEFENING:`, `Vraag 1`, or exercise-oriented sections.
- Detect `meerkeuze` from explicit multiple-choice wording or visible options like `A.`, `B.`, `C.`, `D.`.
- Detect `berekening` from words like `bereken`, `werk uit`, `uitwerking`.
- Detect `open` from prompt styles like `verklaar`, `beschrijf`, `licht toe`, `toon aan`.
- `difficulty_keywords` should only include visible, course-relevant challenge terms from the input."""


DEFAULT_GPT_SYSTEM_INSTRUCTIONS = """Gebruik de knowledge base als primaire bron. Werk onderwerp voor onderwerp, citeer altijd expliciet het onderwerp en hoofdstuk, gebruik file_search om relevante stukken op te halen, en stel actieve-recall-vragen op basis van de gemarkeerde OEFENINGEN. Leg concepten uit met de exacte inhoud uit de knowledge base, bewaak studievoortgang per hoofdstuk, verwijs terug naar prerequisites wanneer basiskennis ontbreekt, en gebruik gespreide herhaling wanneer een student eerder behandelde stof opnieuw lastig vindt."""

_HEADING_RE = re.compile(r"(?m)^#{1,6}\s+(.+)$")
_FORMULA_RE = re.compile(r"\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\[A-Za-z]+")
_SENTENCE_RE = re.compile(r"(.+?[.!?])(?:\s|$)")
_NORMALIZE_SECTION_RE = re.compile(r"^(theory|exercise|definition|example|formula)$")
_CODE_FENCE_RE = re.compile(r"```(?:[A-Za-z0-9_+-]+)?\n[\s\S]*?```")
_MULTIPLE_CHOICE_RE = re.compile(r"(?im)^\s*(?:[A-D][\.\)]|[a-d][\.\)])\s+")
_INLINE_CODE_SIGNAL_RE = re.compile(r"`[^`\n]+`|(?:^|\W)(?:library\(|import\s|def\s|<-|ggplot|lm\()")
_LANGUAGE_CODE_ALLOWLIST = {"nl", "en"}
_EXERCISE_TYPE_ALLOWLIST = {"meerkeuze", "open", "berekening"}
_TOOL_CANONICAL_MAP = {
    "r": "R",
    "python": "Python",
    "spss": "SPSS",
    "excel": "Excel",
    "stata": "Stata",
    "matlab": "MATLAB",
}
_DIFFICULTY_KEYWORDS = (
    "bewijs",
    "afleiding",
    "integratie",
    "regressie",
    "hypothesetoets",
    "optimalisatie",
    "differentiaalvergelijking",
    "statistische significantie",
)
_DUTCH_MARKERS = {"de", "het", "een", "voor", "met", "zoals", "bereken", "hoofdstuk"}
_ENGLISH_MARKERS = {"the", "and", "with", "chapter", "calculate", "question", "because"}


class PreservationResponse(BaseModel):
    content: str


class PreservedChapter(BaseModel):
    title: str
    topic: str
    content: str
    section_markers: list[str] = Field(default_factory=list)
    section_types: list[str] = Field(default_factory=list)
    key_concepts: list[str] = Field(default_factory=list)
    related_section_markers: list[str] = Field(default_factory=list)


class PlanMetadata(BaseModel):
    summaries: list[str]
    prerequisites: list[list[str]]
    master_study_map: str
    gpt_system_instructions: str
    course_metadata: CourseMetadata = Field(default_factory=CourseMetadata)
    search_profiles: list[list[str]] = Field(default_factory=list)


@dataclass
class SourceSection:
    index: int
    start_marker: str
    content: str
    headers: list[str]
    first_sentence: str
    markers: list[str]
    table_headers: list[str]


@dataclass
class ChapterPlan:
    index: int
    title: str
    topic: str
    source_sections: list[SourceSection]
    related_sections: list[str]
    section_types: list[str]


@dataclass
class RecoveryBlock:
    index: int
    title_marker: str
    normalized_title: str
    content: str
    normalized_content: str
    words: int
    keywords: set[str]
    snippets: list[str]
    has_exercise: bool
    has_table: bool
    has_formula: bool


@dataclass
class GeneratedChapterProfile:
    chapter_id: str
    normalized_content: str
    keywords: set[str]
    has_exercise: bool
    has_table: bool
    has_formula: bool


async def generate_study_plan(
    markdown_content: str,
    doc_type: str = "auto",
    on_progress: ProgressCallback | None = None,
    max_retries: int = 3,
) -> StudyPlan:
    if on_progress:
        await on_progress("ai", 5, "Documentstructuur analyseren...")

    structure_analysis = await _analyze_structure(
        markdown_content,
        doc_type_hint=doc_type,
        max_retries=max_retries,
    )

    if on_progress:
        await on_progress(
            "ai",
            20,
            f"Structuuranalyse voltooid ({len(structure_analysis.sections)} secties).",
        )

    preserved_chapters = await _generate_chunked_study_plan(
        markdown_content,
        structure_analysis=structure_analysis,
        on_progress=on_progress,
        max_retries=max_retries,
    )

    if on_progress:
        await on_progress(
            "ai",
            80,
            "Content-preservatie voltooid. Metadata genereren...",
        )

    metadata = await _generate_metadata(
        preserved_chapters,
        document_type=structure_analysis.document_type,
        max_retries=max_retries,
    )

    if on_progress:
        await on_progress("ai", 95, "Metadata voltooid. Studieplan verifiëren...")

    plan = _finalize_study_plan(markdown_content, preserved_chapters, metadata)

    if on_progress:
        await on_progress("ai", 100, "Studieplan succesvol gegenereerd!")

    logger.info(
        "Study plan generated via 3-phase pipeline: %s chapters, %s topics, verification=%s",
        len(plan.chapters),
        len(plan.topics),
        plan.verificationReport.status if plan.verificationReport else "unknown",
    )
    return plan


async def _analyze_structure(
    markdown: str,
    *,
    doc_type_hint: str = "auto",
    max_retries: int = 3,
) -> StructureAnalysis:
    source_sections = _extract_source_sections(markdown)
    if not source_sections:
        raise ValueError("Geen bruikbare documentsecties gevonden voor structuuranalyse.")

    outline_payload = {
        "document_type_hint": doc_type_hint,
        "sections": [
            {
                "index": section.index,
                "start_marker": section.start_marker,
                "headers": section.headers,
                "first_sentence": section.first_sentence,
                "markers": section.markers,
                "table_headers": section.table_headers,
            }
            for section in source_sections
        ],
    }

    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                model=STRUCTURE_MODEL,
                system_prompt=STRUCTURE_ANALYSIS_PROMPT,
                user_content=json.dumps(outline_payload, ensure_ascii=False),
            )
            structure_analysis = StructureAnalysis.model_validate(
                _unwrap_payload(parsed, "structure_analysis", "structureAnalysis")
            )
            return _normalize_structure_analysis(
                structure_analysis,
                source_sections,
                doc_type_hint,
            )
        except Exception as exc:
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "Structure analysis failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
                continue

            logger.warning(
                "Structure analysis failed after %s attempts. Falling back to heuristic analysis: %s",
                max_retries,
                exc,
            )
            return _fallback_structure_analysis(source_sections, doc_type_hint)

    raise RuntimeError("Unreachable")


async def _generate_chunked_study_plan(
    markdown_content: str,
    *,
    structure_analysis: StructureAnalysis,
    on_progress: ProgressCallback | None,
    max_retries: int,
) -> list[PreservedChapter]:
    source_sections = _extract_source_sections(markdown_content)
    if not source_sections:
        raise ValueError("Geen bruikbare documentsecties gevonden voor content-preservatie.")

    normalized_analysis = _normalize_structure_analysis(
        structure_analysis,
        source_sections,
        structure_analysis.document_type,
    )
    chapter_plans = _build_chapter_plans(source_sections, normalized_analysis)
    if not chapter_plans:
        raise ValueError("Geen chapter-plannen afgeleid uit de structuuranalyse.")

    preserved_chapters: list[PreservedChapter] = []
    total_chapters = len(chapter_plans)

    for chapter_index, chapter_plan in enumerate(chapter_plans, start=1):
        start_progress = 20 + math.floor((chapter_index - 1) * 60 / max(total_chapters, 1))
        end_progress = 20 + math.floor(chapter_index * 60 / max(total_chapters, 1))

        if on_progress:
            await on_progress(
                "ai",
                start_progress,
                f"Content exact preserveren voor hoofdstuk {chapter_index}/{total_chapters}...",
            )

        raw_content = _compose_chapter_content(chapter_plan)

        # Detect semantic blocks that exceed HARD_CHUNK_CHARS and will require force-splitting.
        if len(raw_content) > TARGET_CHUNK_CHARS:
            oversized = [
                b for b in _iter_semantic_blocks(raw_content)
                if len(b.strip()) > HARD_CHUNK_CHARS
            ]
            if oversized and on_progress:
                await on_progress(
                    "ai_warning",
                    start_progress,
                    f"Hoofdstuk {chapter_index}/{total_chapters}: {len(oversized)} "
                    f"blok(ken) overschrijdt {HARD_CHUNK_CHARS:,} tekens en wordt geforceerd gesplitst.",
                )

        chapter_parts = (
            _split_markdown_into_chunks(raw_content)
            if len(raw_content) > TARGET_CHUNK_CHARS
            else [raw_content]
        )

        preserved_parts: list[str] = []
        for part_index, part in enumerate(chapter_parts, start=1):
            if on_progress and len(chapter_parts) > 1:
                part_progress = start_progress + math.floor(
                    (part_index - 1) * max(end_progress - start_progress, 1)
                    / max(len(chapter_parts), 1)
                )
                await on_progress(
                    "ai_chunk",
                    part_progress,
                    (
                        f"Hoofdstuk {chapter_index}/{total_chapters} "
                        f"deel {part_index}/{len(chapter_parts)} preserveren..."
                    ),
                )

            preserved_parts.append(
                await _generate_chunk_chapters(
                    part,
                    chapter_plan=chapter_plan,
                    structure_analysis=normalized_analysis,
                    chunk_index=part_index,
                    total_chunks=len(chapter_parts),
                    max_retries=max_retries,
                )
            )

        merged_content = "\n\n".join(part.strip() for part in preserved_parts if part.strip()).strip()
        if not merged_content:
            raise ValueError(f"Lege content teruggekregen voor hoofdstuk '{chapter_plan.title}'.")

        preserved_chapters.append(
            PreservedChapter(
                title=chapter_plan.title,
                topic=chapter_plan.topic,
                content=merged_content,
                section_markers=[section.start_marker for section in chapter_plan.source_sections],
                section_types=chapter_plan.section_types,
                key_concepts=_extract_core_concepts(merged_content),
                related_section_markers=chapter_plan.related_sections,
            )
        )

        if on_progress:
            await on_progress(
                "ai",
                end_progress,
                f"Hoofdstuk {chapter_index}/{total_chapters} gepreserveerd.",
            )

    return preserved_chapters


async def _generate_chunk_chapters(
    chunk: str,
    *,
    chapter_plan: ChapterPlan,
    structure_analysis: StructureAnalysis,
    chunk_index: int,
    total_chunks: int,
    max_retries: int,
) -> str:
    if not chunk.strip():
        return ""

    relevant_sections = [
        section.model_dump()
        for section in structure_analysis.sections
        if section.start_marker in {item.start_marker for item in chapter_plan.source_sections}
    ]

    payload = {
        "document_type": structure_analysis.document_type,
        "chapter": {
            "title": chapter_plan.title,
            "topic": chapter_plan.topic,
            "section_markers": [section.start_marker for section in chapter_plan.source_sections],
            "section_types": chapter_plan.section_types,
            "related_sections": chapter_plan.related_sections,
            "part_index": chunk_index,
            "total_parts": total_chunks,
        },
        "structure_sections": relevant_sections,
        "content": chunk,
    }

    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                model=PRESERVATION_MODEL,
                system_prompt=CONTENT_PRESERVATION_PROMPT,
                user_content=json.dumps(payload, ensure_ascii=False),
            )
            response = PreservationResponse.model_validate(
                _unwrap_payload(parsed, "preservation", "preserved_content", "chapter")
            )
            return response.content.strip()
        except Exception as exc:
            if _should_fallback_to_chunking(exc) and len(chunk) > MIN_RECURSIVE_CHUNK_CHARS:
                mid = len(chunk) // 2
                split_at = chunk.rfind("\n", 0, mid)
                if split_at == -1:
                    split_at = mid

                left = chunk[:split_at].strip()
                right = chunk[split_at:].strip()
                if left and right:
                    logger.warning(
                        "Preservation chunk %s/%s for chapter '%s' still too large; recursively splitting.",
                        chunk_index,
                        total_chunks,
                        chapter_plan.title,
                    )
                    left_content = await _generate_chunk_chapters(
                        left,
                        chapter_plan=chapter_plan,
                        structure_analysis=structure_analysis,
                        chunk_index=chunk_index,
                        total_chunks=total_chunks,
                        max_retries=max_retries,
                    )
                    right_content = await _generate_chunk_chapters(
                        right,
                        chapter_plan=chapter_plan,
                        structure_analysis=structure_analysis,
                        chunk_index=chunk_index,
                        total_chunks=total_chunks,
                        max_retries=max_retries,
                    )
                    return "\n\n".join(
                        part.strip() for part in (left_content, right_content) if part.strip()
                    )

            if attempt < max_retries - 1 and not _should_fallback_to_chunking(exc):
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "Preservation chunk failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
                continue

            raise

    raise RuntimeError("Unreachable")


async def _generate_metadata(
    chapters: list[PreservedChapter],
    *,
    document_type: str,
    max_retries: int,
) -> PlanMetadata:
    chapter_payload = [
        {
            "index": index,
            "title": chapter.title,
            "topic": chapter.topic,
            "core_concepts": chapter.key_concepts or _extract_core_concepts(chapter.content),
            "section_types": chapter.section_types,
            "content_sample": chapter.content[:400],
        }
        for index, chapter in enumerate(chapters, start=1)
    ]

    payload = {
        "document_type": document_type,
        "chapters": chapter_payload,
    }

    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                model=METADATA_MODEL,
                system_prompt=METADATA_PROMPT,
                user_content=json.dumps(payload, ensure_ascii=False),
            )
            metadata = PlanMetadata.model_validate(
                _unwrap_payload(parsed, "metadata", "plan_metadata", "planMetadata")
            )
            metadata.course_metadata = await _generate_course_metadata(
                chapters,
                max_retries=max_retries,
            )
            _validate_plan_metadata(metadata, chapter_count=len(chapters))
            return _normalize_plan_metadata(metadata, chapters)
        except Exception as exc:
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "Metadata generation failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
                continue

            logger.warning(
                "Metadata generation failed after %s attempts. Falling back to deterministic metadata: %s",
                max_retries,
                exc,
            )
            return _fallback_plan_metadata(chapters)

    raise RuntimeError("Unreachable")


async def _generate_course_metadata(
    chapters: list[PreservedChapter],
    *,
    max_retries: int,
) -> CourseMetadata:
    payload = {
        "chapters": [
            {
                "index": index,
                "title": chapter.title,
                "topic": chapter.topic,
                "core_concepts": chapter.key_concepts or _extract_core_concepts(chapter.content),
                "section_types": chapter.section_types,
                "exercise_count": _count_exercises(chapter.content),
                "has_formula_markers": _has_formula_markers(chapter.content),
                "has_code_markers": _has_code_markers(chapter.content),
                "sample_markers": _extract_course_sample_markers(chapter.content),
            }
            for index, chapter in enumerate(chapters, start=1)
        ]
    }

    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                model=COURSE_METADATA_MODEL,
                system_prompt=COURSE_METADATA_PROMPT,
                user_content=json.dumps(payload, ensure_ascii=False),
            )
            course_metadata = CourseMetadata.model_validate(
                _unwrap_payload(parsed, "course_metadata", "courseMetadata", "metadata")
            )
            return _normalize_course_metadata(course_metadata)
        except Exception as exc:
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "Course metadata generation failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
                continue

            logger.warning(
                "Course metadata generation failed after %s attempts. Falling back to heuristics: %s",
                max_retries,
                exc,
            )
            return _fallback_course_metadata_from_preserved_chapters(chapters)

    raise RuntimeError("Unreachable")


async def _call_json_completion(
    *,
    model: str,
    system_prompt: str,
    user_content: str,
) -> dict:
    client = _get_client()
    last_exc: APIStatusError | None = None

    for attempt, delay in enumerate((None, *_RETRY_DELAYS)):
        if delay is not None:
            logger.warning(
                "OpenAI API %s-fout (poging %s/%s): %s — opnieuw proberen in %ss...",
                last_exc.status_code if last_exc else "?",
                attempt,
                1 + len(_RETRY_DELAYS),
                last_exc,
                delay,
            )
            await asyncio.sleep(delay)

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.02,
            )

            text = response.choices[0].message.content
            if not text:
                raise ValueError("Empty response from OpenAI")

            return json.loads(text)
        except APIStatusError as exc:
            if exc.status_code not in (429, 503):
                raise
            last_exc = exc
            if attempt >= len(_RETRY_DELAYS):
                logger.error(
                    "OpenAI API %s-fout na %s pogingen — geen retries meer.",
                    exc.status_code,
                    1 + len(_RETRY_DELAYS),
                )
                raise

    raise RuntimeError("Unreachable")


def _extract_source_sections(markdown_content: str) -> list[SourceSection]:
    sections: list[SourceSection] = []
    seen_markers: set[str] = set()

    for index, block in enumerate(_iter_semantic_blocks(markdown_content), start=1):
        block = block.strip()
        if not block:
            continue

        headers = [match.strip() for match in _HEADING_RE.findall(block)]
        first_sentence = _extract_first_sentence(block)
        markers = _extract_marker_keywords(block)
        table_headers = _extract_table_headers(block)
        start_marker = _make_unique_marker(
            headers[0] if headers else first_sentence or f"Sectie {index}",
            seen_markers,
        )
        seen_markers.add(start_marker)

        sections.append(
            SourceSection(
                index=index,
                start_marker=start_marker,
                content=block,
                headers=headers,
                first_sentence=first_sentence,
                markers=markers,
                table_headers=table_headers,
            )
        )

    return sections


def _extract_first_sentence(block: str) -> str:
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("|") or set(line) <= {"|", "-", ":", " "}:
            continue

        sentence_match = _SENTENCE_RE.match(line)
        if sentence_match:
            return sentence_match.group(1).strip()[:180]
        return line[:180]

    plain = re.sub(r"\s+", " ", block).strip()
    return plain[:180]


def _extract_marker_keywords(block: str) -> list[str]:
    markers: list[str] = []
    content_upper = block.upper()

    if "OEFENING" in content_upper:
        markers.append("OEFENING")
    if "DEFINITIE" in content_upper:
        markers.append("DEFINITIE")
    if "VOORBEELD" in content_upper:
        markers.append("VOORBEELD")
    if _FORMULA_RE.search(block):
        markers.append("FORMULE")
    if _extract_table_headers(block):
        markers.append("TABEL")

    return markers


def _extract_table_headers(block: str) -> list[str]:
    lines = [line.strip() for line in block.splitlines()]
    for index, line in enumerate(lines[:-1]):
        next_line = lines[index + 1]
        if "|" not in line or "|" not in next_line:
            continue
        if not re.fullmatch(r"[\s|\-:]+", next_line):
            continue

        headers = [part.strip() for part in line.strip("|").split("|")]
        return [header for header in headers if header]
    return []


def _make_unique_marker(marker: str, seen: set[str]) -> str:
    normalized = re.sub(r"\s+", " ", marker).strip()[:120] or "Sectie"
    if normalized not in seen:
        return normalized

    suffix = 2
    while f"{normalized} [{suffix}]" in seen:
        suffix += 1
    return f"{normalized} [{suffix}]"


def _normalize_structure_analysis(
    structure_analysis: StructureAnalysis,
    source_sections: list[SourceSection],
    doc_type_hint: str,
) -> StructureAnalysis:
    if len(structure_analysis.sections) != len(source_sections):
        raise ValueError("Structure analysis returned a mismatched number of sections.")

    valid_markers = {section.start_marker for section in source_sections}
    by_marker: dict[str, SectionAnalysis] = {}

    for section in structure_analysis.sections:
        if section.start_marker not in valid_markers:
            raise ValueError(f"Unknown section marker returned by analysis: {section.start_marker}")
        if section.start_marker in by_marker:
            raise ValueError(f"Duplicate section marker returned by analysis: {section.start_marker}")
        by_marker[section.start_marker] = section

    normalized_sections: list[SectionAnalysis] = []
    for source_section in source_sections:
        analyzed = by_marker[source_section.start_marker]
        normalized_sections.append(
            SectionAnalysis(
                start_marker=source_section.start_marker,
                section_type=_normalize_section_type(
                    analyzed.section_type or _guess_section_type(source_section)
                ),
                suggested_topic=(
                    analyzed.suggested_topic.strip()
                    or _default_topic_for_section(source_section, doc_type_hint)
                ),
                suggested_chapter_title=(
                    analyzed.suggested_chapter_title.strip()
                    or _default_chapter_title(source_section, doc_type_hint)
                ),
                related_sections=[
                    marker
                    for marker in _unique_strings(analyzed.related_sections)
                    if marker in valid_markers and marker != source_section.start_marker
                ],
            )
        )

    normalized_topics = _merge_topics_with_reference_last(
        structure_analysis.suggested_topics,
        [{"topic": section.suggested_topic} for section in normalized_sections],
    )
    normalized_doc_type = (structure_analysis.document_type or doc_type_hint or "mixed").strip()

    return StructureAnalysis(
        sections=normalized_sections,
        suggested_topics=normalized_topics,
        document_type=normalized_doc_type,
    )


def _fallback_structure_analysis(
    source_sections: list[SourceSection],
    doc_type_hint: str,
) -> StructureAnalysis:
    sections: list[SectionAnalysis] = []
    for section in source_sections:
        fallback_topic = _default_topic_for_section(section, doc_type_hint)
        fallback_title = _default_chapter_title(section, doc_type_hint)
        sections.append(
            SectionAnalysis(
                start_marker=section.start_marker,
                section_type=_guess_section_type(section),
                suggested_topic=fallback_topic,
                suggested_chapter_title=fallback_title,
                related_sections=[],
            )
        )

    return StructureAnalysis(
        sections=sections,
        suggested_topics=_merge_topics_with_reference_last(
            [item.suggested_topic for item in sections]
        ),
        document_type=(doc_type_hint or "mixed").strip(),
    )


def _normalize_section_type(section_type: str) -> str:
    normalized = section_type.strip().lower()
    aliases = {
        "oefening": "exercise",
        "exercise": "exercise",
        "definition": "definition",
        "definitie": "definition",
        "voorbeeld": "example",
        "example": "example",
        "formula": "formula",
        "formule": "formula",
        "theory": "theory",
        "theorie": "theory",
    }
    normalized = aliases.get(normalized, normalized)
    if not _NORMALIZE_SECTION_RE.fullmatch(normalized):
        return "theory"
    return normalized


def _guess_section_type(section: SourceSection) -> str:
    marker_set = set(section.markers)
    if "FORMULE" in marker_set:
        return "formula"
    if "OEFENING" in marker_set:
        return "exercise"
    if "DEFINITIE" in marker_set:
        return "definition"
    if "VOORBEELD" in marker_set:
        return "example"
    return "theory"


def _default_topic_for_section(section: SourceSection, doc_type_hint: str) -> str:
    if doc_type_hint == "formula_sheet":
        return REFERENCE_TOPIC
    if section.headers:
        return section.headers[0][:80]
    return "Algemeen"


def _default_chapter_title(section: SourceSection, doc_type_hint: str) -> str:
    if doc_type_hint == "formula_sheet":
        return "Formuleoverzicht"
    if section.headers:
        return section.headers[0][:120]
    return section.start_marker[:120]


def _build_chapter_plans(
    source_sections: list[SourceSection],
    structure_analysis: StructureAnalysis,
) -> list[ChapterPlan]:
    plans: list[ChapterPlan] = []
    current_sections: list[SourceSection] = []
    current_related: list[str] = []
    current_types: list[str] = []
    current_topic = ""
    current_title = ""

    for source_section, analyzed_section in zip(
        source_sections,
        structure_analysis.sections,
        strict=True,
    ):
        topic = analyzed_section.suggested_topic.strip() or "Algemeen"
        title = analyzed_section.suggested_chapter_title.strip() or source_section.start_marker

        if not current_sections:
            current_sections = [source_section]
            current_related = list(analyzed_section.related_sections)
            current_types = [analyzed_section.section_type]
            current_topic = topic
            current_title = title
            continue

        if topic == current_topic and title == current_title:
            current_sections.append(source_section)
            current_related.extend(analyzed_section.related_sections)
            current_types.append(analyzed_section.section_type)
            continue

        plans.append(
            ChapterPlan(
                index=len(plans) + 1,
                title=current_title,
                topic=current_topic,
                source_sections=current_sections,
                related_sections=_unique_strings(current_related),
                section_types=_unique_strings(current_types),
            )
        )

        current_sections = [source_section]
        current_related = list(analyzed_section.related_sections)
        current_types = [analyzed_section.section_type]
        current_topic = topic
        current_title = title

    if current_sections:
        plans.append(
            ChapterPlan(
                index=len(plans) + 1,
                title=current_title,
                topic=current_topic,
                source_sections=current_sections,
                related_sections=_unique_strings(current_related),
                section_types=_unique_strings(current_types),
            )
        )

    return plans


def _compose_chapter_content(chapter_plan: ChapterPlan) -> str:
    return "\n\n".join(
        section.content.strip()
        for section in chapter_plan.source_sections
        if section.content.strip()
    ).strip()


def _validate_plan_metadata(metadata: PlanMetadata, *, chapter_count: int) -> None:
    if len(metadata.summaries) != chapter_count:
        raise ValueError("Metadata returned a mismatched number of summaries.")
    if len(metadata.prerequisites) != chapter_count:
        raise ValueError("Metadata returned a mismatched number of prerequisite lists.")
    if metadata.search_profiles and len(metadata.search_profiles) != chapter_count:
        metadata.search_profiles = [[] for _ in range(chapter_count)]


def _normalize_plan_metadata(
    metadata: PlanMetadata,
    chapters: list[PreservedChapter],
) -> PlanMetadata:
    summaries = [
        summary.strip() or f"Dit hoofdstuk behandelt {chapter.title.lower()}."
        for summary, chapter in zip(metadata.summaries, chapters, strict=True)
    ]
    prerequisites = [
        [item.strip() for item in items if item.strip()]
        for items in metadata.prerequisites
    ]

    master_study_map = metadata.master_study_map.strip()
    if not master_study_map:
        master_study_map = _build_master_study_map(
            _temporary_chapters(chapters, summaries),
            prerequisites=prerequisites,
        )

    gpt_system_instructions = (
        metadata.gpt_system_instructions.strip() or DEFAULT_GPT_SYSTEM_INSTRUCTIONS
    )
    course_metadata = _normalize_course_metadata(metadata.course_metadata)

    raw_profiles = metadata.search_profiles or []
    search_profiles = [
        [q.strip() for q in questions if q.strip()][:10]
        for questions in raw_profiles
    ]
    while len(search_profiles) < len(chapters):
        search_profiles.append([])

    return PlanMetadata(
        summaries=summaries,
        prerequisites=prerequisites,
        master_study_map=master_study_map,
        gpt_system_instructions=gpt_system_instructions,
        course_metadata=course_metadata,
        search_profiles=search_profiles,
    )


def _fallback_plan_metadata(chapters: list[PreservedChapter]) -> PlanMetadata:
    summaries = [
        (
            f"Dit hoofdstuk behandelt {chapter.title.lower()}. "
            "Gebruik de knowledge base als primaire bron om de stof interactief te oefenen."
        )
        for chapter in chapters
    ]
    prerequisites = [
        [] if index == 0 else [chapters[index - 1].title]
        for index in range(len(chapters))
    ]
    master_study_map = _build_master_study_map(
        _temporary_chapters(chapters, summaries),
        prerequisites=prerequisites,
    )
    return PlanMetadata(
        summaries=summaries,
        prerequisites=prerequisites,
        master_study_map=master_study_map,
        gpt_system_instructions=DEFAULT_GPT_SYSTEM_INSTRUCTIONS,
        course_metadata=_fallback_course_metadata_from_preserved_chapters(chapters),
        search_profiles=[[] for _ in chapters],
    )


def _normalize_course_metadata(course_metadata: CourseMetadata | None) -> CourseMetadata:
    metadata = course_metadata or CourseMetadata()
    primary_language = (metadata.primary_language or "nl").strip().lower() or "nl"
    if primary_language not in _LANGUAGE_CODE_ALLOWLIST:
        primary_language = "nl"

    exercise_types = [
        normalized
        for raw in metadata.exercise_types
        for normalized in [_normalize_exercise_type(raw)]
        if normalized
    ]

    detected_tools = [
        canonical
        for raw in metadata.detected_tools
        for canonical in [_normalize_tool_name(raw)]
        if canonical
    ]

    difficulty_keywords = [
        keyword
        for raw in metadata.difficulty_keywords
        for keyword in [_normalize_difficulty_keyword(raw)]
        if keyword
    ]

    total_exercises = max(int(metadata.total_exercises or 0), 0)

    return CourseMetadata(
        has_formulas=bool(metadata.has_formulas),
        has_exercises=bool(metadata.has_exercises or total_exercises > 0),
        has_code=bool(metadata.has_code),
        primary_language=primary_language,
        exercise_types=_unique_strings(exercise_types),
        total_exercises=total_exercises,
        detected_tools=_unique_strings(detected_tools),
        difficulty_keywords=_unique_strings(difficulty_keywords),
    )


def _merge_course_metadata(
    primary: CourseMetadata | None,
    fallback: CourseMetadata | None,
) -> CourseMetadata:
    primary_normalized = _normalize_course_metadata(primary) if primary is not None else None
    fallback_normalized = _normalize_course_metadata(fallback)
    primary_data = primary_normalized or CourseMetadata()

    primary_language = fallback_normalized.primary_language
    if primary_normalized is not None and (
        primary_normalized.primary_language != "nl"
        or fallback_normalized.primary_language == "nl"
    ):
        primary_language = primary_normalized.primary_language

    return CourseMetadata(
        has_formulas=primary_data.has_formulas or fallback_normalized.has_formulas,
        has_exercises=primary_data.has_exercises or fallback_normalized.has_exercises,
        has_code=primary_data.has_code or fallback_normalized.has_code,
        primary_language=primary_language,
        exercise_types=_unique_strings(
            [*primary_data.exercise_types, *fallback_normalized.exercise_types]
        ),
        total_exercises=max(
            primary_data.total_exercises,
            fallback_normalized.total_exercises,
        ),
        detected_tools=_unique_strings(
            [*primary_data.detected_tools, *fallback_normalized.detected_tools]
        ),
        difficulty_keywords=_unique_strings(
            [*primary_data.difficulty_keywords, *fallback_normalized.difficulty_keywords]
        ),
    )


def _fallback_course_metadata_from_preserved_chapters(
    chapters: list[PreservedChapter],
) -> CourseMetadata:
    chapter_records = [
        {
            "title": chapter.title,
            "topic": chapter.topic,
            "content": chapter.content,
            "section_types": chapter.section_types,
        }
        for chapter in chapters
    ]
    return _fallback_course_metadata_from_chapter_records(chapter_records)


def _fallback_course_metadata_from_final_chapters(
    chapters: list[Chapter],
) -> CourseMetadata:
    chapter_records = [
        {
            "title": chapter.title,
            "topic": chapter.topic,
            "content": chapter.content,
            "section_types": [],
        }
        for chapter in chapters
    ]
    return _fallback_course_metadata_from_chapter_records(chapter_records)


def _fallback_course_metadata_from_chapter_records(
    chapter_records: list[dict[str, Any]],
) -> CourseMetadata:
    combined_text = "\n\n".join(
        f"{record['title']}\n{record['topic']}\n{record['content']}".strip()
        for record in chapter_records
    )
    total_exercises = sum(_count_exercises(record["content"]) for record in chapter_records)
    has_formulas = any(
        _has_formula_markers(record["content"]) or "formula" in record.get("section_types", [])
        for record in chapter_records
    )
    has_code = any(_has_code_markers(record["content"]) for record in chapter_records)
    exercise_types = _detect_exercise_types(combined_text)
    detected_tools = _detect_tools(combined_text)
    difficulty_keywords = _detect_difficulty_keywords(combined_text)

    return CourseMetadata(
        has_formulas=has_formulas,
        has_exercises=total_exercises > 0,
        has_code=has_code,
        primary_language=_detect_primary_language(combined_text),
        exercise_types=exercise_types,
        total_exercises=total_exercises,
        detected_tools=detected_tools,
        difficulty_keywords=difficulty_keywords,
    )


def _has_formula_markers(content: str) -> bool:
    signals = ("$$", "\\mu", "\\sigma", "\\int", "\\sum")
    return any(signal in content for signal in signals) or _FORMULA_RE.search(content) is not None


def _has_code_markers(content: str) -> bool:
    return bool(_CODE_FENCE_RE.search(content) or _INLINE_CODE_SIGNAL_RE.search(content))


def _extract_course_sample_markers(content: str) -> list[str]:
    markers: list[str] = []
    markers.extend([heading.strip() for heading in _HEADING_RE.findall(content)[:4]])

    lowered = content.lower()
    if "meerkeuze" in lowered:
        markers.append("meerkeuze")
    if _MULTIPLE_CHOICE_RE.search(content):
        markers.append("A/B/C/D opties")
    if "bereken" in lowered:
        markers.append("bereken")
    if "oefening" in lowered:
        markers.append("oefening")
    if _has_formula_markers(content):
        markers.append("latex-formules")
    if _has_code_markers(content):
        markers.append("codevoorbeeld")

    tool_matches = _detect_tools(content)
    markers.extend(tool_matches[:3])
    return _unique_strings(markers)[:8]


def _normalize_exercise_type(raw_value: str) -> str | None:
    normalized = raw_value.strip().lower()
    aliases = {
        "multiple choice": "meerkeuze",
        "mcq": "meerkeuze",
        "meerkeuzevraag": "meerkeuze",
        "open vraag": "open",
        "open vragen": "open",
        "calculation": "berekening",
        "rekenvraag": "berekening",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in _EXERCISE_TYPE_ALLOWLIST else None


def _normalize_tool_name(raw_value: str) -> str | None:
    normalized = raw_value.strip().lower()
    return _TOOL_CANONICAL_MAP.get(normalized)


def _normalize_difficulty_keyword(raw_value: str) -> str | None:
    normalized = raw_value.strip().lower()
    return normalized if normalized in _DIFFICULTY_KEYWORDS else None


def _detect_primary_language(text: str) -> str:
    normalized = _normalize_markdown_text(text)
    tokens = normalized.split()
    dutch_score = sum(1 for token in tokens if token in _DUTCH_MARKERS)
    english_score = sum(1 for token in tokens if token in _ENGLISH_MARKERS)
    return "en" if english_score > dutch_score else "nl"


def _detect_exercise_types(text: str) -> list[str]:
    normalized = text.lower()
    exercise_types: list[str] = []

    if "meerkeuze" in normalized or len(_MULTIPLE_CHOICE_RE.findall(text)) >= 2:
        exercise_types.append("meerkeuze")
    if any(keyword in normalized for keyword in ("bereken", "werk uit", "uitwerking", "calculate")):
        exercise_types.append("berekening")
    if any(keyword in normalized for keyword in ("verklaar", "beschrijf", "licht toe", "toon aan", "open vraag")):
        exercise_types.append("open")
    if _count_exercises(text) > 0 and not exercise_types:
        exercise_types.append("open")

    return _unique_strings(exercise_types)


def _detect_tools(text: str) -> list[str]:
    lowered = text.lower()
    detected: list[str] = []

    for needle, canonical in _TOOL_CANONICAL_MAP.items():
        if re.search(rf"(?<![A-Za-z0-9_]){re.escape(needle)}(?![A-Za-z0-9_])", lowered):
            detected.append(canonical)

    if "<-" in text or "library(" in lowered or "ggplot" in lowered or "lm(" in lowered:
        detected.append("R")
    if "import " in lowered or "def " in lowered:
        detected.append("Python")

    return _unique_strings(detected)


def _detect_difficulty_keywords(text: str) -> list[str]:
    lowered = _normalize_markdown_text(text)
    return [
        keyword
        for keyword in _DIFFICULTY_KEYWORDS
        if keyword in lowered
    ]


def _assemble_study_plan(
    chapters: list[PreservedChapter],
    metadata: PlanMetadata,
) -> StudyPlan:
    topics = _merge_topics_with_reference_last([chapter.topic for chapter in chapters])
    final_chapters = _assign_final_chapter_ids(
        chapters, metadata.summaries, topics, metadata.search_profiles
    )
    master_study_map = metadata.master_study_map.strip() or _build_master_study_map(
        final_chapters,
        prerequisites=metadata.prerequisites,
    )

    return StudyPlan(
        chapters=final_chapters,
        topics=topics,
        masterStudyMap=master_study_map,
        gptSystemInstructions=(
            metadata.gpt_system_instructions.strip()
            or DEFAULT_GPT_SYSTEM_INSTRUCTIONS
        ),
        courseMetadata=_merge_course_metadata(
            metadata.course_metadata,
            _fallback_course_metadata_from_final_chapters(final_chapters),
        ),
    )


def _finalize_study_plan(
    markdown_content: str,
    chapters: list[PreservedChapter],
    metadata: PlanMetadata,
) -> StudyPlan:
    plan = _assemble_study_plan(chapters, metadata)
    verification_report = verify_content_preservation(markdown_content, plan.chapters)

    if verification_report.status == "CRITICAL":
        recovery_chapters = _recover_missing_chapters(markdown_content, plan.chapters)
        if recovery_chapters:
            extended_metadata = _extend_metadata_for_recovery(metadata, len(recovery_chapters))
            plan = _assemble_study_plan([*chapters, *recovery_chapters], extended_metadata)
            verification_report = verify_content_preservation(markdown_content, plan.chapters)

    plan.verificationReport = verification_report
    plan.courseMetadata = _merge_course_metadata(
        plan.courseMetadata,
        _fallback_course_metadata_from_final_chapters(plan.chapters),
    )
    return plan


def _extend_metadata_for_recovery(
    metadata: PlanMetadata,
    recovery_count: int,
) -> PlanMetadata:
    if recovery_count <= 0:
        return metadata

    return PlanMetadata(
        summaries=[
            *metadata.summaries,
            *([DEFAULT_RECOVERY_SUMMARY] * recovery_count),
        ],
        prerequisites=[
            *metadata.prerequisites,
            *([[]] * recovery_count),
        ],
        master_study_map="",
        gpt_system_instructions=metadata.gpt_system_instructions,
        course_metadata=metadata.course_metadata,
        search_profiles=[
            *metadata.search_profiles,
            *([[]] * recovery_count),
        ],
    )


def _assign_final_chapter_ids(
    chapters: list[PreservedChapter],
    summaries: list[str],
    topics: list[str],
    search_profiles: list[list[str]] | None = None,
) -> list[Chapter]:
    topic_index_map = {topic: index + 1 for index, topic in enumerate(topics)}
    chapter_numbers_per_topic: dict[str, int] = {}
    reference_formula_assigned = False
    chapter_ids: list[str] = []
    marker_to_chapter_id: dict[str, str] = {}

    for chapter in chapters:
        if _is_reference_formula_chapter(chapter) and not reference_formula_assigned:
            chapter_id = "REF-FORMULAS"
            reference_formula_assigned = True
        else:
            chapter_numbers_per_topic[chapter.topic] = (
                chapter_numbers_per_topic.get(chapter.topic, 0) + 1
            )
            topic_num = topic_index_map.get(chapter.topic, 1)
            chapter_id = f"T{topic_num}-C{chapter_numbers_per_topic[chapter.topic]}"

        chapter_ids.append(chapter_id)
        for marker in chapter.section_markers:
            marker_to_chapter_id[marker] = chapter_id

    profiles = list(search_profiles) if search_profiles else []
    while len(profiles) < len(chapters):
        profiles.append([])

    final_chapters: list[Chapter] = []
    for index, (chapter, summary, chapter_id) in enumerate(
        zip(chapters, summaries, chapter_ids, strict=True)
    ):
        final_chapters.append(
            Chapter(
                id=chapter_id,
                title=chapter.title,
                summary=summary,
                topic=chapter.topic,
                content=chapter.content,
                key_concepts=chapter.key_concepts or _extract_core_concepts(chapter.content),
                section_types=chapter.section_types,
                related_sections=_resolve_related_sections(
                    chapter.related_section_markers,
                    marker_to_chapter_id,
                    current_chapter_id=chapter_id,
                ),
                search_profile=profiles[index],
            )
        )

    return final_chapters


def _is_reference_formula_chapter(chapter: PreservedChapter) -> bool:
    return chapter.topic == REFERENCE_TOPIC and (
        "formula" in chapter.section_types
        or "formule" in chapter.title.lower()
        or "formula" in chapter.title.lower()
    )


def _temporary_chapters(
    chapters: list[PreservedChapter],
    summaries: list[str],
) -> list[Chapter]:
    return [
        Chapter(
            id=f"TEMP-{index}",
            title=chapter.title,
            summary=summary,
            topic=chapter.topic,
            content=chapter.content,
            key_concepts=chapter.key_concepts or _extract_core_concepts(chapter.content),
            section_types=chapter.section_types,
            related_sections=[],
        )
        for index, (chapter, summary) in enumerate(zip(chapters, summaries, strict=True), start=1)
    ]


def _unwrap_payload(parsed: dict, *candidate_keys: str) -> dict:
    for key in candidate_keys:
        value = parsed.get(key)
        if isinstance(value, dict):
            return value
    return parsed


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_values.append(normalized)
    return unique_values


def _resolve_related_sections(
    markers: list[str],
    marker_to_chapter_id: dict[str, str],
    *,
    current_chapter_id: str,
) -> list[str]:
    related_ids: list[str] = []
    seen: set[str] = set()

    for marker in markers:
        chapter_id = marker_to_chapter_id.get(marker)
        if not chapter_id or chapter_id == current_chapter_id or chapter_id in seen:
            continue
        seen.add(chapter_id)
        related_ids.append(chapter_id)

    return related_ids


def _recover_missing_chapters(
    markdown_content: str,
    generated_chapters: list[Chapter],
) -> list[PreservedChapter]:
    recovery_blocks = _build_recovery_blocks(markdown_content)
    if not recovery_blocks:
        return []

    generated_profiles = _build_generated_chapter_profiles(generated_chapters)
    missing_block_indices = {
        block.index
        for block in recovery_blocks
        if not _is_recovery_block_covered(block, generated_profiles)
    }

    if not missing_block_indices:
        return []

    grouped_blocks: list[list[RecoveryBlock]] = []
    current_group: list[RecoveryBlock] = []

    for block in recovery_blocks:
        if block.index in missing_block_indices:
            current_group.append(block)
            continue
        if current_group:
            grouped_blocks.append(current_group)
            current_group = []

    if current_group:
        grouped_blocks.append(current_group)

    recovery_chapters: list[PreservedChapter] = []
    for group in grouped_blocks:
        group_content = "\n\n".join(block.content.strip() for block in group if block.content.strip()).strip()
        if not group_content:
            continue

        base_title = _select_recovery_group_title(group)
        section_types: list[str] = []
        if any(block.has_formula for block in group):
            section_types.append("formula")
        if any(block.has_exercise for block in group):
            section_types.append("exercise")
        if not section_types:
            section_types.append("theory")

        recovery_chapters.append(
            PreservedChapter(
                title=f"Herstel: {base_title}",
                topic=RECOVERY_TOPIC,
                content=group_content,
                section_markers=[f"Recovery {group[0].index}-{group[-1].index}: {base_title}"],
                section_types=section_types,
                key_concepts=_extract_core_concepts(group_content),
                related_section_markers=[],
            )
        )

    return recovery_chapters


def _build_recovery_blocks(markdown_content: str) -> list[RecoveryBlock]:
    raw_chunks: list[str] = []
    for document in markdown_content.split(DOCUMENT_SEPARATOR):
        document = document.strip()
        if not document:
            continue
        raw_chunks.extend(_split_document_into_recovery_chunks(document))

    merged_chunks = _merge_small_recovery_chunks(raw_chunks, min_words=120)
    recovery_blocks: list[RecoveryBlock] = []

    for index, chunk in enumerate(merged_chunks, start=1):
        chunk = chunk.strip()
        if not chunk:
            continue

        normalized_chunk = _normalize_markdown_text(chunk)
        if not normalized_chunk:
            continue

        title_marker = _extract_recovery_block_title(chunk, fallback=f"Sectie {index}")
        keywords = set(_extract_signature_keywords(chunk, min_frequency=1)[:12])
        if not keywords:
            keywords = {
                token
                for token in _normalize_markdown_text(title_marker).split()
                if len(token) > 4
            }

        recovery_blocks.append(
            RecoveryBlock(
                index=index,
                title_marker=title_marker,
                normalized_title=_normalize_markdown_text(title_marker),
                content=chunk,
                normalized_content=normalized_chunk,
                words=len(normalized_chunk.split()),
                keywords=keywords,
                snippets=_extract_recovery_snippets(chunk),
                has_exercise=_count_exercises(chunk) > 0,
                has_table=_count_tables(chunk) > 0,
                has_formula=_count_formulas(chunk) > 0,
            )
        )

    return recovery_blocks


def _split_document_into_recovery_chunks(document: str) -> list[str]:
    heading_matches = list(re.finditer(r"(?m)^#{2,3}(?!#)\s+.+$", document))
    if not heading_matches:
        return [block.strip() for block in _iter_semantic_blocks(document) if block.strip()]

    chunks: list[str] = []
    positions = [match.start() for match in heading_matches] + [len(document)]

    prefix = document[: positions[0]].strip()
    if prefix:
        chunks.append(prefix)

    for start, end in zip(positions, positions[1:], strict=False):
        chunk = document[start:end].strip()
        if chunk:
            chunks.append(chunk)

    return chunks


def _merge_small_recovery_chunks(chunks: list[str], *, min_words: int) -> list[str]:
    merged: list[str] = []
    index = 0

    while index < len(chunks):
        current = chunks[index].strip()
        index += 1

        while _estimate_recovery_word_count(current) < min_words and index < len(chunks):
            current = f"{current}\n\n{chunks[index].strip()}".strip()
            index += 1

        if _estimate_recovery_word_count(current) < min_words and merged:
            merged[-1] = f"{merged[-1]}\n\n{current}".strip()
            continue

        merged.append(current)

    return merged


def _estimate_recovery_word_count(text: str) -> int:
    return len(_normalize_markdown_text(text).split())


def _extract_recovery_block_title(text: str, *, fallback: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^#{2,3}(?!#)\s+", stripped):
            return re.sub(r"^#{2,3}(?!#)\s+", "", stripped).strip()[:120]
    return fallback[:120]


def _extract_recovery_snippets(text: str) -> list[str]:
    candidates: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("|") or stripped.startswith("```"):
            continue
        for piece in re.split(r"(?<=[.!?])\s+", stripped):
            normalized_piece = _normalize_markdown_text(piece)
            if len(normalized_piece.split()) >= 6:
                candidates.append(normalized_piece)

    if not candidates:
        normalized_text = _normalize_markdown_text(text)
        if normalized_text:
            words = normalized_text.split()
            candidates.append(" ".join(words[:18]))

    if not candidates:
        return []

    positions = [0, len(candidates) // 2, len(candidates) - 1]
    snippets: list[str] = []
    seen: set[str] = set()
    for position in positions:
        snippet = candidates[position].strip()
        if not snippet or snippet in seen:
            continue
        seen.add(snippet)
        snippets.append(snippet)

    return snippets


def _build_generated_chapter_profiles(
    generated_chapters: list[Chapter],
) -> list[GeneratedChapterProfile]:
    profiles: list[GeneratedChapterProfile] = []
    for chapter in generated_chapters:
        combined_text = f"{chapter.title}\n{chapter.content}"
        normalized_content = _normalize_markdown_text(combined_text)
        if not normalized_content:
            continue

        keywords = set(_extract_signature_keywords(combined_text, min_frequency=1)[:12])
        if not keywords:
            keywords = {
                token
                for token in _normalize_markdown_text(chapter.title).split()
                if len(token) > 4
            }

        profiles.append(
            GeneratedChapterProfile(
                chapter_id=chapter.id,
                normalized_content=normalized_content,
                keywords=keywords,
                has_exercise=_count_exercises(chapter.content) > 0,
                has_table=_count_tables(chapter.content) > 0,
                has_formula=_count_formulas(chapter.content) > 0,
            )
        )

    return profiles


def _is_recovery_block_covered(
    block: RecoveryBlock,
    chapter_profiles: list[GeneratedChapterProfile],
) -> bool:
    for profile in chapter_profiles:
        snippet_hits = sum(
            1 for snippet in block.snippets if snippet and snippet in profile.normalized_content
        )
        snippet_ratio = snippet_hits / max(len(block.snippets), 1)
        keyword_overlap = len(block.keywords & profile.keywords) / max(len(block.keywords), 1)
        heading_bonus = (
            1.0
            if block.normalized_title and block.normalized_title in profile.normalized_content
            else 0.0
        )

        structural_bonus = 0.0
        if block.has_exercise and profile.has_exercise:
            structural_bonus += 0.05
        if block.has_table and profile.has_table:
            structural_bonus += 0.05
        if block.has_formula and profile.has_formula:
            structural_bonus += 0.05

        score = min(
            1.0,
            (0.5 * keyword_overlap) + (0.3 * snippet_ratio) + (0.2 * heading_bonus) + structural_bonus,
        )
        if snippet_hits >= 2 or score >= 0.55:
            return True

    return False


def _select_recovery_group_title(group: list[RecoveryBlock]) -> str:
    for block in group:
        if block.title_marker and not block.title_marker.lower().startswith("sectie "):
            return block.title_marker[:120]
    return group[0].title_marker[:120]


def _should_fallback_to_chunking(exc: Exception) -> bool:
    message = str(exc).lower()
    signals = (
        "request too large",
        "tokens per min",
        "rate_limit_exceeded",
        "context_length_exceeded",
        "maximum context length",
        "requested",
    )

    return any(signal in message for signal in signals)


def _parse_semantic_blocks(markdown: str) -> list[SemanticBlock]:
    """Parse markdown into typed SemanticBlocks via a line-by-line state machine.

    Atomic blocks (code, formula, table, exercise, definition) are never split
    by the downstream chunker. Non-atomic blocks (prose, header) may be split
    on character limits when they exceed HARD_CHUNK_CHARS.
    """
    blocks: list[SemanticBlock] = []
    current_lines: list[str] = []
    current_type = "prose"
    state = "normal"

    _ATOMIC_TYPES = {"code", "formula", "table", "exercise", "definition"}

    def flush() -> None:
        nonlocal current_lines, current_type
        if not current_lines:
            return
        content = "\n".join(current_lines).strip()
        if content:
            blocks.append(
                SemanticBlock(
                    content=content,
                    block_type=current_type,
                    is_atomic=current_type in _ATOMIC_TYPES,
                    char_count=len(content),
                )
            )
        current_lines = []

    def dispatch_normal(line: str) -> tuple[str, str]:
        """Process one line in normal state; return (new_state, new_type)."""
        stripped = line.strip()

        if stripped.startswith("```"):
            flush()
            current_lines.append(line)
            return "code", "code"

        # Single-line $$...$$ formula
        if stripped.startswith("$$") and stripped.endswith("$$") and len(stripped) > 4:
            flush()
            blocks.append(
                SemanticBlock(
                    content=stripped,
                    block_type="formula",
                    is_atomic=True,
                    char_count=len(stripped),
                )
            )
            return "normal", "prose"

        # Multi-line formula open
        if stripped == "$$" or (stripped.startswith("$$") and not stripped[2:].strip()):
            flush()
            current_lines.append(line)
            return "formula", "formula"

        # Table row: stripped line starts and ends with |
        if stripped and stripped.startswith("|"):
            if current_type != "table":
                flush()
                current_lines.append(line)
                return "table", "table"
            # already in table (handled in table state, not here)
            current_lines.append(line)
            return "table", "table"

        if stripped.startswith("OEFENING:") or re.match(r"^Vraag\b", stripped):
            flush()
            current_lines.append(line)
            return "exercise", "exercise"

        if stripped.startswith("DEFINITIE:"):
            flush()
            current_lines.append(line)
            return "definition", "definition"

        if re.match(r"^#{1,6}\s", stripped):
            flush()
            blocks.append(
                SemanticBlock(
                    content=stripped,
                    block_type="header",
                    is_atomic=False,
                    char_count=len(stripped),
                )
            )
            return "normal", "prose"

        # Plain prose
        if current_type != "prose":
            flush()
        current_lines.append(line)
        return "normal", "prose"

    for line in markdown.splitlines():
        stripped = line.strip()

        if state == "normal":
            state, current_type = dispatch_normal(line)

        elif state == "code":
            current_lines.append(line)
            # Closing fence: ``` at start, but not the opening line (len > 1 lines)
            if stripped.startswith("```") and len(current_lines) > 1:
                flush()
                state = "normal"
                current_type = "prose"

        elif state == "formula":
            current_lines.append(line)
            if "$$" in stripped and len(current_lines) > 1:
                flush()
                state = "normal"
                current_type = "prose"

        elif state == "table":
            if stripped and stripped.startswith("|"):
                current_lines.append(line)
            else:
                # Table ended — flush, then re-dispatch current line
                flush()
                state, current_type = dispatch_normal(line)

        elif state == "exercise":
            if re.match(r"^#{1,6}\s", stripped):
                flush()
                blocks.append(
                    SemanticBlock(
                        content=stripped,
                        block_type="header",
                        is_atomic=False,
                        char_count=len(stripped),
                    )
                )
                state = "normal"
                current_type = "prose"
            elif stripped.startswith("OEFENING:") or re.match(r"^Vraag\b", stripped):
                # New exercise starts: flush current, begin fresh
                flush()
                current_lines.append(line)
                current_type = "exercise"
                state = "exercise"
            else:
                current_lines.append(line)

        elif state == "definition":
            if re.match(r"^#{1,6}\s", stripped):
                flush()
                blocks.append(
                    SemanticBlock(
                        content=stripped,
                        block_type="header",
                        is_atomic=False,
                        char_count=len(stripped),
                    )
                )
                state = "normal"
                current_type = "prose"
            elif not stripped:
                flush()
                state = "normal"
                current_type = "prose"
            else:
                current_lines.append(line)

    flush()
    return blocks


def _split_markdown_into_chunks(markdown_content: str) -> list[str]:
    """Split markdown into chunks using semantic block awareness.

    Atomic blocks (code, formula, table, exercise, definition) are never split.
    Non-atomic blocks (prose, header) may be broken at character limits when
    they individually exceed HARD_CHUNK_CHARS.

    Each returned chunk is prefixed with a [CONTEXT: ...] header so the AI
    model knows its position and content type without needing prior chunks.
    """
    blocks = _parse_semantic_blocks(markdown_content)
    if not blocks:
        return [markdown_content]

    chunk_groups: list[list[SemanticBlock]] = []
    current_group: list[SemanticBlock] = []
    current_length = 0

    def flush_group() -> None:
        nonlocal current_group, current_length
        if current_group:
            chunk_groups.append(current_group)
            current_group = []
            current_length = 0

    for block in blocks:
        sep = 2 if current_group else 0

        if block.is_atomic:
            if block.char_count > HARD_CHUNK_CHARS:
                logger.warning(
                    "Atomic %s block (%d chars) exceeds HARD_CHUNK_CHARS; placed in its own chunk without splitting.",
                    block.block_type,
                    block.char_count,
                )
                flush_group()
                chunk_groups.append([block])
            elif current_group and current_length + sep + block.char_count > TARGET_CHUNK_CHARS:
                flush_group()
                current_group = [block]
                current_length = block.char_count
            else:
                current_group.append(block)
                current_length += sep + block.char_count
        else:
            # prose / header — may be split on character limit if oversized
            if block.char_count > HARD_CHUNK_CHARS:
                flush_group()
                for sub in _split_by_character_limit(block.content):
                    chunk_groups.append(
                        [SemanticBlock(sub, block.block_type, False, len(sub))]
                    )
            elif current_group and current_length + sep + block.char_count > TARGET_CHUNK_CHARS:
                flush_group()
                current_group = [block]
                current_length = block.char_count
            else:
                current_group.append(block)
                current_length += sep + block.char_count

    flush_group()

    if not chunk_groups:
        return [markdown_content]

    total = len(chunk_groups)
    result: list[str] = []
    for i, group in enumerate(chunk_groups, start=1):
        types = list(dict.fromkeys(b.block_type for b in group))
        context_header = (
            f"[CONTEXT: Dit is chunk {i}/{total}. "
            f"Deze chunk bevat o.a.: {', '.join(types)}]"
        )
        body = "\n\n".join(b.content for b in group)
        result.append(f"{context_header}\n\n{body}")

    return result


def _iter_semantic_blocks(markdown_content: str) -> list[str]:
    """Split markdown into document-level sections grouped by header.

    Used for structural analysis (section extraction). Each returned string
    contains a header and all content under it. Not the same as
    _parse_semantic_blocks, which splits at the content-type level for chunking.
    """
    blocks: list[str] = []
    for document in markdown_content.split(DOCUMENT_SEPARATOR):
        document = document.strip()
        if not document:
            continue

        sections = re.split(r"(?m)(?=^#{1,6}\s)", document)
        if len(sections) == 1:
            blocks.append(document)
            continue

        for section in sections:
            section = section.strip()
            if section:
                blocks.append(section)
    return blocks


def _split_by_character_limit(text: str) -> list[str]:
    parts: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + TARGET_CHUNK_CHARS, len(text))
        if end < len(text):
            split_at = text.rfind("\n", start, end)
            if split_at > start:
                end = split_at
        parts.append(text[start:end].strip())
        start = end
    return [part for part in parts if part]


def _merge_topics_with_reference_last(
    topics: list[str],
    chapters: list[Any] | None = None,
) -> list[str]:
    ordered_topics: list[str] = []
    seen: set[str] = set()

    def add_topic(topic: str | None) -> None:
        normalized_topic = topic.strip() if topic else "Algemeen"
        if normalized_topic in seen:
            return
        seen.add(normalized_topic)
        ordered_topics.append(normalized_topic)

    for topic in topics:
        add_topic(topic)

    for chapter in chapters or []:
        if isinstance(chapter, dict):
            add_topic(chapter.get("topic"))
        else:
            add_topic(getattr(chapter, "topic", None))

    regular_topics = [
        topic
        for topic in ordered_topics
        if topic not in {RECOVERY_TOPIC, REFERENCE_TOPIC}
    ]
    recovery_topics = [topic for topic in ordered_topics if topic == RECOVERY_TOPIC]
    reference_topics = [topic for topic in ordered_topics if topic == REFERENCE_TOPIC]
    return regular_topics + recovery_topics + reference_topics


def _build_master_study_map(
    chapters: list[Chapter],
    prerequisites: list[list[str]] | None = None,
) -> str:
    lines = [
        "| Onderwerp | Hoofdstuk | Kernbegrippen | Oefeningen | Prerequisites |",
        "| --- | --- | --- | --- | --- |",
    ]

    for index, chapter in enumerate(chapters):
        core_concepts = ", ".join(chapter.key_concepts or _extract_core_concepts(chapter.content)) or "-"
        exercises = chapter.content.count("OEFENING:")
        if prerequisites and index < len(prerequisites):
            prerequisite_label = ", ".join(prerequisites[index]) or "-"
        else:
            prerequisite_label = chapters[index - 1].title if index > 0 else "-"
        lines.append(
            (
                f"| {chapter.topic} | {chapter.title} | {core_concepts} | "
                f"{exercises} | {prerequisite_label} |"
            )
        )

    return "\n".join(lines)


def _extract_core_concepts(content: str) -> list[str]:
    lines = content.splitlines()
    for index, line in enumerate(lines):
        if "kernbegrippen" not in line.lower():
            continue

        concepts: list[str] = []
        for follow_line in lines[index + 1 :]:
            stripped = follow_line.strip()
            if not stripped:
                if concepts:
                    break
                continue
            if stripped.startswith("#"):
                break
            if stripped[:1] in {"-", "*", "\u2022"}:
                concepts.append(stripped.lstrip("-*\u2022").strip())
                if len(concepts) == 5:
                    return concepts
            elif concepts:
                break
        if concepts:
            return concepts

    heading_matches = re.findall(r"(?m)^#{2,3}\s+(.+)$", content)
    return [heading.strip() for heading in heading_matches[:5]]
