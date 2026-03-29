import asyncio
import gc
import logging
import math
import os
import subprocess
import tempfile
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor

import fitz  # pymupdf
from PIL import Image

logger = logging.getLogger(__name__)

OCR_DPI = 300
MAX_OCR_TILE_WIDTH = 4_500
MAX_OCR_TILE_HEIGHT = 4_500
MAX_OCR_TILE_PIXELS = 18_000_000

_ocr_executor = ProcessPoolExecutor(max_workers=4)


def check_tesseract_languages() -> dict:
    """
    Check if Tesseract is installed and if required language packs are available.
    Returns a dict with keys: available (bool), languages (list[str]), missing (list[str]).
    """
    required = ["eng", "nld"]
    try:
        result = subprocess.run(
            ["tesseract", "--list-langs"],
            capture_output=True,
            text=True,
            check=False,
        )
        # tesseract --list-langs writes to stderr
        output = result.stderr + result.stdout
        available_langs = [
            line.strip()
            for line in output.splitlines()
            if line.strip() and not line.startswith("List of")
        ]
        missing = [lang for lang in required if lang not in available_langs]
        return {
            "available": result.returncode == 0 and len(missing) == 0,
            "languages": available_langs,
            "missing": missing,
        }
    except FileNotFoundError:
        return {
            "available": False,
            "languages": [],
            "missing": required,
            "error": "Tesseract niet gevonden. Installeer met: brew install tesseract",
        }


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


def _ocr_page_worker(args: tuple) -> tuple[int, str]:
    """Synchronous worker that OCRs a single PDF page inside a ProcessPoolExecutor.

    All imports are local so the function is safely picklable across process
    boundaries regardless of the multiprocessing start method (fork / spawn).
    The PDF file is opened fresh in the worker because fitz objects cannot
    be serialised.

    Args:
        args: (page_index, file_path, dpi, max_tile_width, max_tile_height, max_tile_pixels)

    Returns:
        (page_index, extracted_text)
    """
    import gc as _gc
    import math as _math
    import os as _os
    import subprocess as _subprocess
    import tempfile as _tempfile

    import fitz as _fitz
    from PIL import Image as _Image

    page_index, file_path, dpi, max_tile_width, max_tile_height, max_tile_pixels = args

    # ── Local helpers (mirroring module-level helpers) ──────────────────────

    def _iter_steps_local(total: int, step: int) -> Iterator[int]:
        position = 0
        while position < total:
            yield position
            position += step

    def _page_pixel_size_local(width_points: float, height_points: float) -> tuple[int, int]:
        scale = dpi / 72
        return max(1, _math.ceil(width_points * scale)), max(1, _math.ceil(height_points * scale))

    def _build_tile_boxes_local(width: int, height: int) -> list[tuple[int, int, int, int]]:
        tile_width = min(width, max_tile_width)
        tile_height = min(height, max_tile_height)
        if tile_width * tile_height > max_tile_pixels:
            tile_height = max(1, max_tile_pixels // tile_width)
        boxes = []
        for top in _iter_steps_local(height, tile_height):
            for left in _iter_steps_local(width, tile_width):
                right = min(width, left + tile_width)
                bottom = min(height, top + tile_height)
                boxes.append((left, top, right, bottom))
        return boxes

    def _pixel_box_to_pdf_rect_local(
        page_rect: _fitz.Rect,
        left_px: int,
        top_px: int,
        right_px: int,
        bottom_px: int,
    ) -> _fitz.Rect:
        px_to_points = 72 / dpi
        return _fitz.Rect(
            page_rect.x0 + (left_px * px_to_points),
            page_rect.y0 + (top_px * px_to_points),
            page_rect.x0 + (right_px * px_to_points),
            page_rect.y0 + (bottom_px * px_to_points),
        )

    def _normalize_local(result: object) -> str:
        if isinstance(result, str):
            return result.strip()
        if not result:
            return ""
        lines: list[str] = []
        for item in result:
            text = str(item[0]).strip() if isinstance(item, tuple) else str(item).strip()
            if text:
                lines.append(text)
        return "\n".join(lines)

    def _run_tesseract_local(image: _Image.Image) -> str:
        with _tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            image.save(tmp.name, "PNG")
            tmp_path = tmp.name
        try:
            result = _subprocess.run(
                ["tesseract", tmp_path, "stdout", "-l", "eng+nld", "--psm", "6"],
                capture_output=True,
                text=True,
                check=False,
            )
        finally:
            _os.unlink(tmp_path)
        if result.returncode != 0:
            stderr = result.stderr.strip() or "Onbekende OCR-fout."
            raise RuntimeError(f"Tesseract OCR mislukt: {stderr}")
        return _normalize_local(result.stdout)

    def _ocr_pil_local(image: _Image.Image) -> str:
        width, height = image.size
        tiles = _build_tile_boxes_local(width, height)
        if len(tiles) == 1:
            return _run_tesseract_local(image)
        parts: list[str] = []
        for box in tiles:
            tile = image.crop(box)
            try:
                tile_text = _run_tesseract_local(tile)
            finally:
                tile.close()
            if tile_text.strip():
                parts.append(tile_text)
        return "\n\n".join(parts).strip()

    # ── Page processing ─────────────────────────────────────────────────────

    doc = _fitz.open(file_path)
    try:
        page = doc[page_index]
        width_px, height_px = _page_pixel_size_local(page.rect.width, page.rect.height)
        tile_boxes = _build_tile_boxes_local(width_px, height_px)
        page_text_parts: list[str] = []

        for left_px, top_px, right_px, bottom_px in tile_boxes:
            clip = _pixel_box_to_pdf_rect_local(
                page.rect, left_px, top_px, right_px, bottom_px
            )
            pix = page.get_pixmap(dpi=dpi, clip=clip)
            image = _Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            tile_text = _ocr_pil_local(image)
            if tile_text.strip():
                page_text_parts.append(tile_text)
            del pix, image
            _gc.collect()
    finally:
        doc.close()

    return page_index, "\n\n".join(page_text_parts).strip()


async def ocr_pdf(file_path: str, on_progress=None) -> str:
    """Run OCR on a scanned PDF using a ProcessPoolExecutor.

    Pages are processed in parallel (max_workers=4). Output is sorted by
    original page index to guarantee reading order regardless of completion
    order. Very large pages are rendered in smaller tiles inside each worker
    so Tesseract never receives a single giant PNG that exceeds Leptonica's
    limits.
    """
    doc = fitz.open(file_path)
    total_pages = doc.page_count
    doc.close()  # workers reopen the file themselves

    loop = asyncio.get_running_loop()
    args_list = [
        (i, file_path, OCR_DPI, MAX_OCR_TILE_WIDTH, MAX_OCR_TILE_HEIGHT, MAX_OCR_TILE_PIXELS)
        for i in range(total_pages)
    ]

    futures = [
        loop.run_in_executor(_ocr_executor, _ocr_page_worker, args)
        for args in args_list
    ]

    results: list[tuple[int, str]] = []
    for i, future in enumerate(asyncio.as_completed(futures)):
        page_index, page_text = await future
        results.append((page_index, page_text))
        if on_progress:
            progress = int((i + 1) / total_pages * 100)
            await on_progress("ocr", progress, f"OCR pagina {i + 1}/{total_pages}...")

    results.sort(key=lambda x: x[0])
    full_text = [f"--- Pagina {idx + 1} ---\n{text}" for idx, text in results]
    return "\n\n".join(full_text)


async def ocr_image(file_path: str) -> str:
    """Run OCR on a single image via the local Tesseract CLI, tiled when needed."""
    with Image.open(file_path) as image:
        rgb_image = image.convert("RGB")
        return await _ocr_pil_image(rgb_image)


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
