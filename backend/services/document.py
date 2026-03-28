import logging
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
