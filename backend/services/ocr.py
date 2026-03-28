import gc
import logging
import math
import os
import subprocess
import tempfile
from collections.abc import Iterator

import fitz  # pymupdf
from PIL import Image

logger = logging.getLogger(__name__)

OCR_DPI = 300
MAX_OCR_TILE_WIDTH = 4_500
MAX_OCR_TILE_HEIGHT = 4_500
MAX_OCR_TILE_PIXELS = 18_000_000


def is_scanned_pdf(file_path: str, threshold: int = 50) -> bool:
    """Detect if a PDF is scanned by combining text density and text-page coverage."""
    doc = fitz.open(file_path)
    if doc.page_count == 0:
        doc.close()
        return False

    page_texts = [page.get_text().strip() for page in doc]
    total_chars = sum(len(text) for text in page_texts)
    pages_with_meaningful_text = sum(1 for text in page_texts if len(text) >= 10)
    avg_chars = total_chars / doc.page_count
    text_coverage = pages_with_meaningful_text / doc.page_count
    doc.close()

    logger.info(
        "PDF text density: %.0f chars/page, coverage: %.0f%% (threshold: %s)",
        avg_chars,
        text_coverage * 100,
        threshold,
    )
    return avg_chars < threshold and text_coverage < 0.5


async def ocr_pdf(file_path: str, on_progress=None) -> str:
    """
    Run OCR on a scanned PDF at high quality.
    Very large pages are rendered in smaller tiles so Tesseract never receives
    a single giant PNG that exceeds Leptonica's limits.
    """
    doc = fitz.open(file_path)
    total_pages = doc.page_count
    full_text = []

    for i, page in enumerate(doc):
        page_text = await _ocr_pdf_page(page)
        full_text.append(f"--- Pagina {i + 1} ---\n{page_text}")

        gc.collect()

        if on_progress:
            progress = int((i + 1) / total_pages * 100)
            await on_progress("ocr", progress, f"OCR pagina {i + 1}/{total_pages}...")

    doc.close()
    return "\n\n".join(full_text)


async def ocr_image(file_path: str) -> str:
    """Run OCR on a single image via the local Tesseract CLI, tiled when needed."""
    with Image.open(file_path) as image:
        rgb_image = image.convert("RGB")
        return await _ocr_pil_image(rgb_image)


async def _ocr_pdf_page(page: fitz.Page) -> str:
    width_px, height_px = _page_pixel_size(page.rect.width, page.rect.height, OCR_DPI)
    tile_boxes = _build_tile_boxes(width_px, height_px)
    tile_count = len(tile_boxes)
    page_text_parts: list[str] = []

    if tile_count > 1:
        logger.info(
            "Rendering oversized PDF page as %s OCR tiles (%sx%s px at %s DPI)",
            tile_count,
            width_px,
            height_px,
            OCR_DPI,
        )

    for left_px, top_px, right_px, bottom_px in tile_boxes:
        clip = _pixel_box_to_pdf_rect(
            page.rect,
            left_px,
            top_px,
            right_px,
            bottom_px,
            dpi=OCR_DPI,
        )
        pix = page.get_pixmap(dpi=OCR_DPI, clip=clip)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        tile_text = await _ocr_pil_image(image)

        if tile_text.strip():
            page_text_parts.append(tile_text)

        del pix, image
        gc.collect()

    return "\n\n".join(page_text_parts).strip()


async def _ocr_pil_image(image: Image.Image) -> str:
    width, height = image.size
    tile_boxes = _build_tile_boxes(width, height)

    if len(tile_boxes) == 1:
        return await _run_tesseract_on_image(image)

    logger.info(
        "Processing oversized image as %s OCR tiles (%sx%s px)",
        len(tile_boxes),
        width,
        height,
    )

    parts: list[str] = []
    for box in tile_boxes:
        tile = image.crop(box)
        try:
            tile_text = await _run_tesseract_on_image(tile)
        finally:
            tile.close()

        if tile_text.strip():
            parts.append(tile_text)

    return "\n\n".join(parts).strip()


async def _run_tesseract_on_image(image: Image.Image) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        image.save(tmp.name, "PNG")
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "tesseract",
                tmp_path,
                "stdout",
                "-l",
                "eng+nld",
                "--psm",
                "6",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        os.unlink(tmp_path)

    if result.returncode != 0:
        stderr = result.stderr.strip() or "Onbekende OCR-fout."
        raise RuntimeError(f"Tesseract OCR mislukt: {stderr}")

    return _normalize_ocr_output(result.stdout)


def _page_pixel_size(width_points: float, height_points: float, dpi: int) -> tuple[int, int]:
    scale = dpi / 72
    return max(1, math.ceil(width_points * scale)), max(1, math.ceil(height_points * scale))


def _build_tile_boxes(width: int, height: int) -> list[tuple[int, int, int, int]]:
    tile_width = min(width, MAX_OCR_TILE_WIDTH)
    tile_height = min(height, MAX_OCR_TILE_HEIGHT)

    if tile_width * tile_height > MAX_OCR_TILE_PIXELS:
        tile_height = max(1, MAX_OCR_TILE_PIXELS // tile_width)

    boxes = []
    for top in _iter_steps(height, tile_height):
        for left in _iter_steps(width, tile_width):
            right = min(width, left + tile_width)
            bottom = min(height, top + tile_height)
            boxes.append((left, top, right, bottom))
    return boxes


def _iter_steps(total: int, step: int) -> Iterator[int]:
    position = 0
    while position < total:
        yield position
        position += step


def _pixel_box_to_pdf_rect(
    page_rect: fitz.Rect,
    left_px: int,
    top_px: int,
    right_px: int,
    bottom_px: int,
    *,
    dpi: int,
) -> fitz.Rect:
    px_to_points = 72 / dpi
    return fitz.Rect(
        page_rect.x0 + (left_px * px_to_points),
        page_rect.y0 + (top_px * px_to_points),
        page_rect.x0 + (right_px * px_to_points),
        page_rect.y0 + (bottom_px * px_to_points),
    )


def _normalize_ocr_output(result) -> str:
    if isinstance(result, str):
        return result.strip()

    if not result:
        return ""

    lines: list[str] = []
    for item in result:
        if isinstance(item, tuple):
            text = str(item[0]).strip()
        else:
            text = str(item).strip()

        if text:
            lines.append(text)

    return "\n".join(lines)
