import logging
import re
import tempfile
from pathlib import Path

from docling.document_converter import DocumentConverter
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    TableFormerMode,
    TableStructureOptions,
)
from docling.datamodel.base_models import InputFormat
from docling.document_converter import PdfFormatOption

from services.ocr import is_scanned_pdf, ocr_pdf, ocr_image

logger = logging.getLogger(__name__)

# Configure docling for maximum quality
_converter = None


def _get_converter() -> DocumentConverter:
    """Lazy-load docling converter with maximum quality settings."""
    global _converter
    if _converter is None:
        logger.info("Initializing docling converter...")
        pipeline_options = PdfPipelineOptions(
            do_table_structure=True,
            table_structure_options=TableStructureOptions(
                mode=TableFormerMode.ACCURATE
            ),
            do_ocr=False,
        )
        _converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            }
        )
        logger.info("docling converter ready.")
    return _converter


_SLIDE_NUMBER_RE = re.compile(
    r"""
    (?:^|\n)          # start of string or new line
    (?:
        slide\s*\d+   # "Slide 7"
        | \bdia\s*\d+ # "Dia 3"
        | -{3,}\s*\d+\s*-{3,}   # "--- 4 ---"
        | \[\s*\d+\s*/\s*\d+\s*\]  # "[4 / 12]"
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

_DATE_RE = re.compile(
    r"""
    \b(?:
        week\s*\d+
        | \d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}   # 12/03/2025 or 3-4-25
        | \b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}
        | deadline
        | due\s+(?:date|by)
        | inlever
        | tentamen
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

_MATH_INLINE_RE = re.compile(r"\$[^$\n]{1,120}\$")
_MATH_BLOCK_RE = re.compile(r"\$\$[\s\S]{1,600}?\$\$")
_CITATION_RE = re.compile(
    r"""
    \((?:[A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*\d{4})\)  # (Author, 2020)
    | \[\d+\]                                          # [12]
    """,
    re.VERBOSE,
)
_QUESTION_RE = re.compile(
    r"""
    (?:^|\n)
    (?:
        vraag\s*\d+       # "Vraag 3"
        | question\s*\d+
        | \d+\.\s+\w      # "3. What..."
        | \([a-d]\)\s+\w  # "(a) option"
        | \b(?:a|b|c|d)\)\s+\w  # "a) option"
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)
_POINTS_RE = re.compile(
    r"""
    \b(?:
        \d+\s*punt(?:en)?     # "3 punten"
        | \(\s*\d+\s*p\.?\s*\)  # "(2 p.)"
        | \d+\s*(?:pts?|points?)
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def detect_document_type(markdown: str, filename: str) -> str:
    """
    Detect the type of document from its extracted Markdown content and filename.

    Returns one of:
      "slides", "schedule", "formula_sheet", "exam",
      "article", "textbook", "mixed"
    """
    name_lower = filename.lower()
    ext = Path(filename).suffix.lower()

    # ── Filename heuristics (fast path) ─────────────────────────────────────
    if ext in (".pptx", ".ppt"):
        return "slides"
    if any(kw in name_lower for kw in ("rooster", "schedule", "planning", "kalender", "schema")):
        return "schedule"
    if any(kw in name_lower for kw in ("formule", "formula", "cheat", "reference", "samenvatting_formule")):
        return "formula_sheet"
    if any(kw in name_lower for kw in ("tentamen", "exam", "toets", "quiz", "opgave")):
        return "exam"

    # ── Content-based scoring ────────────────────────────────────────────────
    total_chars = max(len(markdown), 1)
    lines = markdown.splitlines()
    total_lines = max(len(lines), 1)

    # Slide signals
    slide_matches = len(_SLIDE_NUMBER_RE.findall(markdown))
    # Short paragraphs (≤ 15 words) as fraction of all non-empty lines
    short_lines = sum(1 for ln in lines if ln.strip() and len(ln.split()) <= 15)
    short_line_ratio = short_lines / total_lines

    # Schedule signals
    date_matches = len(_DATE_RE.findall(markdown))
    table_count = markdown.count("|")

    # Formula-sheet signals
    math_inline = len(_MATH_INLINE_RE.findall(markdown))
    math_block = len(_MATH_BLOCK_RE.findall(markdown))
    math_density = (math_inline + math_block * 3) / (total_chars / 1000)  # per 1k chars

    # Exam signals
    question_matches = len(_QUESTION_RE.findall(markdown))
    points_matches = len(_POINTS_RE.findall(markdown))

    # Article / textbook signals
    citation_count = len(_CITATION_RE.findall(markdown))
    # Long paragraphs (> 60 words) as fraction of non-empty lines
    long_lines = sum(1 for ln in lines if len(ln.split()) > 60)
    long_line_ratio = long_lines / total_lines

    # ── Decision tree ────────────────────────────────────────────────────────
    # Slides: many slide-number patterns OR very high short-line ratio + not much prose
    if slide_matches >= 3 or (short_line_ratio > 0.80 and long_line_ratio < 0.05 and total_chars > 500):
        return "slides"

    # Schedule: date-heavy + significant table structure
    if date_matches >= 5 and table_count >= 20:
        return "schedule"

    # Formula sheet: high math density, low prose
    if math_density >= 4.0 and long_line_ratio < 0.10:
        return "formula_sheet"

    # Exam: question + points markers
    if (question_matches >= 3 and points_matches >= 2) or points_matches >= 5:
        return "exam"

    # Article: citations + long prose paragraphs
    if citation_count >= 4 and long_line_ratio >= 0.08:
        return "article"

    # Textbook: long document with prose but no dominant special markers
    if total_chars > 8_000 and long_line_ratio >= 0.05:
        return "textbook"

    return "mixed"


async def process_document(file_path: str, filename: str, on_progress=None) -> str:
    """
    Process a document and return structured Markdown.

    Pipeline:
    - PDF (text-based) -> docling -> Markdown
    - PDF (scanned) -> myOCR (300 DPI) -> text
    - Images -> myOCR -> text
    - DOCX/PPTX/XLSX -> docling -> Markdown
    - TXT/MD -> direct read
    """
    ext = Path(filename).suffix.lower()

    if on_progress:
        await on_progress("document", 10, f"Document analyseren: {filename}...")

    # Plain text files: read directly
    if ext in (".txt", ".md"):
        return Path(file_path).read_text(encoding="utf-8", errors="replace")

    # Images: use myOCR
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"):
        if on_progress:
            await on_progress("ocr", 20, "OCR uitvoeren op afbeelding...")
        text = await ocr_image(file_path)
        if on_progress:
            await on_progress("ocr", 100, "OCR voltooid.")
        return text

    # PDF: check if scanned or text-based
    if ext == ".pdf":
        if is_scanned_pdf(file_path):
            logger.info("Scanned PDF detected: %s - using Tesseract OCR", filename)
            if on_progress:
                await on_progress("ocr", 15, "Gescande PDF gedetecteerd, OCR starten...")
            text = await ocr_pdf(file_path, on_progress)
            if on_progress:
                await on_progress("document", 80, "OCR voltooid, tekst structureren...")
            return text
        else:
            logger.info("Text-based PDF: %s - using docling", filename)

    # All other supported formats: use docling
    if on_progress:
        await on_progress("document", 30, f"Document verwerken met docling: {filename}...")

    converter = _get_converter()
    result = converter.convert(file_path)
    markdown = result.document.export_to_markdown()

    if on_progress:
        await on_progress("document", 90, "Documentverwerking voltooid.")

    return markdown
