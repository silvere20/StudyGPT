import asyncio
import json
import logging
import math
import re
from collections.abc import Awaitable, Callable

from openai import APIStatusError, AsyncOpenAI
from pydantic import BaseModel

from models.schemas import Chapter, StudyPlan

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

ProgressCallback = Callable[[str, int, str], Awaitable[None]]
DOCUMENT_SEPARATOR = "\n\n---\n\n"
_RETRY_DELAYS = (1, 2, 4)  # exponential backoff in seconden voor 429/503
TARGET_CHUNK_CHARS = 60_000
HARD_CHUNK_CHARS = 80_000
MIN_RECURSIVE_CHUNK_CHARS = 4_000


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


STUDY_PLAN_PROMPT = """You are an expert educational content architect specializing in creating AI-tutoring-ready study materials. Your output will be uploaded as a Knowledge Base for a Custom GPT that will interactively tutor a student through ALL material.

## YOUR MISSION
Transform the provided document content into a perfectly structured "Master Study Architecture" organized BY TOPIC/SUBJECT. Each topic groups related chapters together. Do NOT organize by week — organize by logical subject matter.

## TWO DISTINCT LAYERS — READ CAREFULLY

### SOURCE LAYER: the `content` field — ZERO DATA LOSS (PRIORITEIT #1 — ABSOLUTE VEREISTE)
- The `content` field is a verbatim reproduction of the source material with navigation structure added.
- PRESERVE ALL content exactly as-is. Every table, formula, exercise, definition, example, code block, footnote, and paragraph MUST appear in your `content` output — word for word.
- NEVER summarize, paraphrase, shorten, omit, or rewrite ANY part of the source inside `content`. This is non-negotiable.
- You ONLY add Markdown structural markers (##, ###, OEFENING:, DEFINITIE:, Kernbegrippen) — you NEVER remove or alter existing text.
- If the source has a table → reproduce the full table. If it has a formula → reproduce the full formula. If it has an exercise with multiple sub-questions → reproduce ALL sub-questions and answers.
- If content seems incomplete or cut off, add inside `content`: "[WAARSCHUWING: Document content lijkt hier onvolledig — controleer het bronbestand]"
- CONTENT INTEGRITY CHECK: Before finalizing each chapter, verify: (a) no sentences were dropped, (b) no tables were shortened, (c) no exercises were omitted.

### TEACHER LAYER: the `summary` field — AI SYNTHESIS
- The `summary` field is a short AI-generated synthesis. It is explicitly NOT the source text.
- Write 2–3 sentences (max 60 words) describing the chapter's core contribution and what the student will learn.
- This is derived from the content; it does NOT replace it.

## TOPIC ORGANIZATION RULES
- Group chapters into logical TOPICS (onderwerpen/thema's) based on subject matter.
- A topic is a high-level theme (e.g. "Lineaire Algebra", "Statistiek", "Marketing Strategie").
- Each topic can contain one or more chapters.
- Order topics in a logical learning sequence (foundations first, advanced topics later).
- Use clear, descriptive topic names in the language of the document content.

## RAG OPTIMIZATION RULES (for GPT's file_search)
1. **Semantic Headers**: Start every major section with a descriptive H2/H3 header containing the key concept name.
2. **Keyword Anchors**: At the start of each chapter, include a "Kernbegrippen" (key concepts) list.
3. **Self-Contained Sections**: Each section should be understandable on its own.
4. **Cross-References**: When content references other chapters, explicitly name them: "Zie ook: [topic], Hoofdstuk [nr] - [titel]".
5. **Exercise Markers**: Mark exercises clearly with "OEFENING:" prefix.
6. **Definition Markers**: Mark definitions with "DEFINITIE:" prefix.

## CONTENT FORMATTING RULES
- TEXT: Preserve perfectly. Use Markdown headers (##, ###) for structure.
- TABLES: Keep as Markdown tables with aligned columns.
- MATH & FORMULAS: Use LaTeX. Inline: $x^2$. Block: $$E=mc^2$$.
- EXERCISES & SOLUTIONS: Format as numbered lists with "Vraag:" and "Antwoord:" labels.
- DIAGRAMS: Describe in detail with all data points, labels, and conclusions.

## OUTPUT STRUCTURE
Return this exact JSON structure:
{
  "chapters": [
    {
      "id": "T1-C1",
      "title": "Descriptive chapter title",
      "summary": "2-3 sentence summary",
      "topic": "Topic Name",
      "content": "Full Markdown content..."
    }
  ],
  "topics": ["Topic 1", "Topic 2", "Topic 3"],
  "masterStudyMap": "<markdown table>",
  "gptSystemInstructions": "<detailed instructions>"
}

## MASTER STUDY MAP
Generate a Markdown table mapping EVERY chapter to:
- Topic name
- Chapter title
- Core concepts (comma-separated)
- Number of exercises
- Prerequisites (which chapters should be studied first)

## GPT SYSTEM INSTRUCTIONS
Generate detailed instructions for the Custom GPT that include:
- How to use file_search to find relevant content
- How to track which chapters the student has completed
- How to quiz the student using the marked exercises
- How to explain concepts using the exact content from the knowledge base
- How to guide study per topic (complete one topic before moving to the next)
- How to use active recall and spaced repetition principles
- Instructions to ALWAYS cite which topic/chapter information comes from

## CRITICAL JSON SAFETY
Your response MUST be valid, complete JSON. If approaching output limits, gracefully close the JSON and add a warning."""


CHUNK_STUDY_PLAN_PROMPT = """You are processing a PARTIAL slice of a larger course document.

Your job is to convert ONLY this chunk into JSON chapter objects that preserve the original material.

Rules:
- Preserve all substantive content from this chunk.
- Do not invent missing text from other chunks.
- Do not drop exercises, definitions, formulas, tables, or examples.
- You may split the chunk into multiple chapters if that improves structure.
- Use semantic headers and add "Kernbegrippen", "OEFENING:", "DEFINITIE:" where helpful.
- Assign a descriptive topic name to each chapter based on its subject matter.
- Use placeholder IDs like "TEMP-1". The application will renumber them later.

Return this exact JSON structure:
{
  "chapters": [{"id": "TEMP-1", "title": "...", "summary": "...", "topic": "Topic Name", "content": "..."}]
}"""


TOPIC_PLANNER_PROMPT = """You are organizing course chapters into logical topics/subjects.

You receive an ordered list of chapters. Your job:
- Assign each chapter to a logical topic (onderwerp/thema) based on its content.
- Topics should be high-level themes that group related chapters.
- Keep the chapter order EXACTLY as given.
- Use clear, descriptive topic names in the same language as the chapter content.
- A topic can contain 1 or more chapters.
- Order topics logically (foundations first, advanced later).

Return this exact JSON structure:
{
  "topics": ["Topic 1", "Topic 2"],
  "assignments": ["Topic 1", "Topic 1", "Topic 2", "Topic 2"]
}"""


DEFAULT_GPT_SYSTEM_INSTRUCTIONS = """Gebruik de knowledge base als primaire bron. Werk onderwerp voor onderwerp, citeer altijd expliciet het onderwerp en hoofdstuk, gebruik file_search om relevante stukken op te halen, en stel actieve-recall-vragen op basis van de gemarkeerde OEFENINGEN. Leg concepten uit met de exacte inhoud uit de knowledge base, bewaak studievoortgang per hoofdstuk, verwijs terug naar prerequisites wanneer basiskennis ontbreekt, en gebruik gespreide herhaling wanneer een student eerder behandelde stof opnieuw lastig vindt."""


class ChunkStudyPlan(BaseModel):
    chapters: list[Chapter]


class TopicPlan(BaseModel):
    topics: list[str]
    assignments: list[str]


async def generate_study_plan(
    markdown_content: str,
    doc_type: str = "auto",
    on_progress: ProgressCallback | None = None,
    max_retries: int = 3,
) -> StudyPlan:
    """
    Try a direct GPT-4.1 study-plan generation first.
    If the payload is too large, automatically fall back to chunked generation.
    """
    if on_progress:
        await on_progress("ai", 50, "Studieplan genereren met GPT-4.1...")

    try:
        return await _generate_full_study_plan(
            markdown_content,
            doc_type=doc_type,
            on_progress=on_progress,
            max_retries=max_retries,
        )
    except Exception as exc:
        if not _should_fallback_to_chunking(exc):
            raise

        logger.warning(
            "OpenAI request too large for direct generation; falling back to chunked processing: %s",
            exc,
        )
        if on_progress:
            await on_progress(
                "ai",
                55,
                "Input is erg groot. Overschakelen naar automatische batchverwerking...",
            )

        return await _generate_chunked_study_plan(
            markdown_content,
            doc_type=doc_type,
            on_progress=on_progress,
            max_retries=max_retries,
        )


async def _generate_full_study_plan(
    markdown_content: str,
    *,
    doc_type: str,
    on_progress: ProgressCallback | None,
    max_retries: int,
) -> StudyPlan:
    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                system_prompt=STUDY_PLAN_PROMPT,
                user_content=f"Document type: {doc_type}\n\nDocument content:\n\n{markdown_content}",
            )
            plan = _parse_full_study_plan(parsed)

            if on_progress:
                await on_progress("ai", 100, "Studieplan succesvol gegenereerd!")

            logger.info(
                "Study plan generated directly: %s chapters, %s topics",
                len(plan.chapters),
                len(plan.topics),
            )
            return plan
        except Exception as exc:
            if _should_fallback_to_chunking(exc):
                raise

            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "OpenAI call failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                if on_progress:
                    await on_progress(
                        "ai",
                        50,
                        f"Fout opgetreden, opnieuw proberen ({attempt + 2}/{max_retries})...",
                    )
                await asyncio.sleep(wait_time)
                continue

            logger.error("OpenAI call failed after %s attempts: %s", max_retries, exc)
            raise


async def _generate_chunked_study_plan(
    markdown_content: str,
    *,
    doc_type: str,
    on_progress: ProgressCallback | None,
    max_retries: int,
) -> StudyPlan:
    chunks = _split_markdown_into_chunks(markdown_content)
    total_chunks = len(chunks)
    all_chapters: list[Chapter] = []

    logger.info("Generating study plan in %s automatic batches", total_chunks)

    for index, chunk in enumerate(chunks, start=1):
        start_progress = 55 + math.floor((index - 1) * 35 / max(total_chunks, 1))
        end_progress = 55 + math.floor(index * 35 / max(total_chunks, 1))

        if on_progress:
            await on_progress(
                "ai",
                start_progress,
                f"Automatische batch {index}/{total_chunks} verwerken...",
            )

        chunk_chapters = await _generate_chunk_chapters(
            chunk,
            doc_type=doc_type,
            chunk_index=index,
            total_chunks=total_chunks,
            max_retries=max_retries,
        )
        all_chapters.extend(chunk_chapters)

        if on_progress:
            await on_progress(
                "ai",
                end_progress,
                f"Batch {index}/{total_chunks} verwerkt.",
            )

    if not all_chapters:
        raise ValueError("Geen hoofdstukken gegenereerd uit automatische batchverwerking.")

    plan = await _finalize_study_plan(
        all_chapters,
        gpt_system_instructions=DEFAULT_GPT_SYSTEM_INSTRUCTIONS,
        on_progress=on_progress,
    )

    if on_progress:
        await on_progress(
            "ai",
            100,
            "Studieplan succesvol gegenereerd via automatische batchverwerking!",
        )

    logger.info(
        "Study plan generated via chunked flow: %s chapters, %s topics",
        len(plan.chapters),
        len(plan.topics),
    )
    return plan


async def _generate_chunk_chapters(
    chunk: str,
    *,
    doc_type: str,
    chunk_index: int,
    total_chunks: int,
    max_retries: int,
) -> list[Chapter]:
    for attempt in range(max_retries):
        try:
            parsed = await _call_json_completion(
                system_prompt=CHUNK_STUDY_PLAN_PROMPT,
                user_content=(
                    f"Document type: {doc_type}\n"
                    f"Chunk {chunk_index}/{total_chunks}\n\n"
                    f"Document chunk:\n\n{chunk}"
                ),
            )
            return _parse_chunk_plan(parsed)
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
                        "Chunk %s/%s still too large; recursively splitting",
                        chunk_index,
                        total_chunks,
                    )
                    left_chapters = await _generate_chunk_chapters(
                        left,
                        doc_type=doc_type,
                        chunk_index=chunk_index,
                        total_chunks=total_chunks,
                        max_retries=max_retries,
                    )
                    right_chapters = await _generate_chunk_chapters(
                        right,
                        doc_type=doc_type,
                        chunk_index=chunk_index,
                        total_chunks=total_chunks,
                        max_retries=max_retries,
                    )
                    return left_chapters + right_chapters

            if attempt < max_retries - 1 and not _should_fallback_to_chunking(exc):
                wait_time = 2 ** (attempt + 1)
                logger.warning(
                    "Chunk call failed (attempt %s/%s): %s. Retrying in %ss...",
                    attempt + 1,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
                continue

            raise


async def _call_json_completion(*, system_prompt: str, user_content: str) -> dict:
    """Voert een OpenAI JSON-completion uit met automatische retry bij 429/503.

    Bij een RateLimitError (429) of ServiceUnavailableError (503) wordt maximaal
    3 keer opnieuw geprobeerd met exponential backoff: 1s, 2s, 4s.
    Alle andere fouten worden direct doorgegeven aan de aanroeper.
    """
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
                model="gpt-4.1",
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

    raise RuntimeError("Unreachable")  # mypy safety


def _parse_full_study_plan(parsed: dict) -> StudyPlan:
    if "studyPlan" in parsed:
        parsed = parsed["studyPlan"]

    # Ensure topics list exists
    if "topics" not in parsed:
        # Extract unique topics from chapters in order
        chapters = parsed.get("chapters", [])
        seen = set()
        topics = []
        for ch in chapters:
            t = ch.get("topic", "Algemeen")
            if t not in seen:
                seen.add(t)
                topics.append(t)
        parsed["topics"] = topics

    # Migrate legacy week-based format
    for ch in parsed.get("chapters", []):
        if "topic" not in ch:
            ch["topic"] = "Algemeen"
        if "week" in ch:
            del ch["week"]

    if "totalWeeks" in parsed:
        del parsed["totalWeeks"]

    return StudyPlan.model_validate(parsed)


def _parse_chunk_plan(parsed: dict) -> list[Chapter]:
    if "studyPlan" in parsed:
        parsed = parsed["studyPlan"]

    # Ensure topic field exists on each chapter
    for ch in parsed.get("chapters", []):
        if "topic" not in ch:
            ch["topic"] = "Algemeen"
        if "week" in ch:
            del ch["week"]

    return ChunkStudyPlan.model_validate(parsed).chapters


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


def _split_markdown_into_chunks(markdown_content: str) -> list[str]:
    chunks: list[str] = []
    current_parts: list[str] = []
    current_length = 0

    for block in _iter_semantic_blocks(markdown_content):
        block = block.strip()
        if not block:
            continue

        block_length = len(block)
        separator_length = 2 if current_parts else 0

        if block_length > HARD_CHUNK_CHARS:
            oversized_parts = _split_large_block(block)
            if current_parts:
                chunks.append("\n\n".join(current_parts))
                current_parts = []
                current_length = 0
            chunks.extend(oversized_parts)
            continue

        if current_parts and current_length + separator_length + block_length > TARGET_CHUNK_CHARS:
            chunks.append("\n\n".join(current_parts))
            current_parts = [block]
            current_length = block_length
            continue

        current_parts.append(block)
        current_length += separator_length + block_length

    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks or [markdown_content]


def _iter_semantic_blocks(markdown_content: str) -> list[str]:
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


def _split_large_block(block: str) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", block) if part.strip()]
    if len(paragraphs) <= 1:
        return _split_by_character_limit(block)

    parts: list[str] = []
    current: list[str] = []
    current_length = 0

    for paragraph in paragraphs:
        paragraph_length = len(paragraph)
        separator_length = 2 if current else 0
        if current and current_length + separator_length + paragraph_length > TARGET_CHUNK_CHARS:
            parts.append("\n\n".join(current))
            current = [paragraph]
            current_length = paragraph_length
            continue

        if paragraph_length > HARD_CHUNK_CHARS:
            if current:
                parts.append("\n\n".join(current))
                current = []
                current_length = 0
            parts.extend(_split_by_character_limit(paragraph))
            continue

        current.append(paragraph)
        current_length += separator_length + paragraph_length

    if current:
        parts.append("\n\n".join(current))

    normalized_parts: list[str] = []
    for part in parts:
        if len(part) > HARD_CHUNK_CHARS:
            normalized_parts.extend(_split_by_character_limit(part))
        else:
            normalized_parts.append(part)

    return normalized_parts


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


async def _finalize_study_plan(
    chapters: list[Chapter],
    *,
    gpt_system_instructions: str,
    on_progress: ProgressCallback | None,
) -> StudyPlan:
    normalized = _normalize_chapters(chapters)

    if not normalized:
        raise ValueError("Geen bruikbare hoofdstukken om samen te voegen.")

    if on_progress:
        await on_progress(
            "ai",
            92,
            "Hoofdstukken logisch per onderwerp groeperen...",
        )

    # Check if chapters already have meaningful topics
    has_meaningful_topics = any(
        ch.topic and ch.topic != "Algemeen" and ch.topic != "TEMP"
        for ch in normalized
    )

    if has_meaningful_topics:
        # Use the topics already assigned by GPT
        topic_assignments = [ch.topic for ch in normalized]
        seen = set()
        topics = []
        for t in topic_assignments:
            if t not in seen:
                seen.add(t)
                topics.append(t)
    else:
        # Ask GPT to assign topics
        topics, topic_assignments = await _choose_topic_assignments(normalized)

    final_chapters = _apply_topic_assignments(normalized, topic_assignments, topics)

    return StudyPlan(
        chapters=final_chapters,
        topics=topics,
        masterStudyMap=_build_master_study_map(final_chapters),
        gptSystemInstructions=gpt_system_instructions or DEFAULT_GPT_SYSTEM_INSTRUCTIONS,
    )


def _normalize_chapters(chapters: list[Chapter]) -> list[Chapter]:
    return [
        Chapter(
            id="TEMP",
            title=chapter.title.strip() or "Onbenoemd hoofdstuk",
            summary=chapter.summary.strip() or "Samenvatting ontbreekt.",
            topic=chapter.topic.strip() if chapter.topic else "Algemeen",
            content=chapter.content.strip(),
        )
        for chapter in chapters
        if chapter.content.strip()
    ]


async def _choose_topic_assignments(
    chapters: list[Chapter],
) -> tuple[list[str], list[str]]:
    metadata = []
    for index, chapter in enumerate(chapters, start=1):
        metadata.append(
            {
                "index": index,
                "title": chapter.title,
                "summary": chapter.summary,
                "concepts": _extract_core_concepts(chapter.content),
            }
        )

    try:
        parsed = await _call_json_completion(
            system_prompt=TOPIC_PLANNER_PROMPT,
            user_content=json.dumps(
                {"chapters": metadata},
                ensure_ascii=False,
            ),
        )
        topic_plan = TopicPlan.model_validate(parsed)
        _validate_topic_plan(topic_plan, chapter_count=len(chapters))
        return topic_plan.topics, topic_plan.assignments
    except Exception as exc:
        logger.warning(
            "Topic planning via OpenAI failed; assigning all to single topic: %s",
            exc,
        )
        topics = ["Algemeen"]
        assignments = ["Algemeen"] * len(chapters)
        return topics, assignments


def _validate_topic_plan(topic_plan: TopicPlan, *, chapter_count: int) -> None:
    if len(topic_plan.assignments) != chapter_count:
        raise ValueError("Topic planner returned a mismatched number of assignments.")
    if not topic_plan.topics:
        raise ValueError("Topic planner returned no topics.")

    valid_topics = set(topic_plan.topics)
    for assignment in topic_plan.assignments:
        if assignment not in valid_topics:
            raise ValueError(f"Topic planner assigned unknown topic: {assignment}")


def _apply_topic_assignments(
    chapters: list[Chapter],
    assignments: list[str],
    topics: list[str],
) -> list[Chapter]:
    topic_index_map = {t: i + 1 for i, t in enumerate(topics)}
    chapter_numbers_per_topic: dict[str, int] = {}
    final_chapters: list[Chapter] = []

    for chapter, topic in zip(chapters, assignments, strict=True):
        chapter_numbers_per_topic[topic] = chapter_numbers_per_topic.get(topic, 0) + 1
        topic_num = topic_index_map.get(topic, 1)
        final_chapters.append(
            Chapter(
                id=f"T{topic_num}-C{chapter_numbers_per_topic[topic]}",
                title=chapter.title,
                summary=chapter.summary,
                topic=topic,
                content=chapter.content,
            )
        )

    return final_chapters


def _build_master_study_map(chapters: list[Chapter]) -> str:
    lines = [
        "| Onderwerp | Hoofdstuk | Kernbegrippen | Oefeningen | Prerequisites |",
        "| --- | --- | --- | --- | --- |",
    ]

    for index, chapter in enumerate(chapters):
        core_concepts = ", ".join(_extract_core_concepts(chapter.content)) or "-"
        exercises = chapter.content.count("OEFENING:")
        prerequisites = chapters[index - 1].title if index > 0 else "-"
        lines.append(
            f"| {chapter.topic} | {chapter.title} | {core_concepts} | {exercises} | {prerequisites} |"
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
