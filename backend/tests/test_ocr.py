import asyncio
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fitz
from PIL import Image, ImageDraw

import services.ocr as ocr_module
from services.ocr import (
    MAX_OCR_TILE_HEIGHT,
    MAX_OCR_TILE_PIXELS,
    MAX_OCR_TILE_WIDTH,
    _build_tile_boxes,
    check_tesseract_languages,
    is_scanned_pdf,
    ocr_image,
    ocr_pdf,
)


def test_is_scanned_pdf_treats_short_text_pdf_as_text_based(tmp_path: Path):
    pdf_path = tmp_path / "short-text.pdf"

    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Week 1\nGemiddelde en variantie")
    document.save(pdf_path)
    document.close()

    assert is_scanned_pdf(str(pdf_path)) is False


def test_is_scanned_pdf_detects_image_only_pdf(tmp_path: Path):
    image_path = tmp_path / "scan-source.png"
    pdf_path = tmp_path / "scan.pdf"

    image = Image.new("RGB", (1200, 400), color="white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 1160, 360), outline="black", width=6)
    image.save(image_path)
    image.save(pdf_path, "PDF")

    assert is_scanned_pdf(str(pdf_path)) is True


def test_ocr_image_returns_tesseract_stdout(monkeypatch, tmp_path: Path):
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (120, 60), color="white").save(image_path)

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout="OCR TEST\nLineaire regressie\n",
            stderr="",
        ),
    )

    assert asyncio.run(ocr_image(str(image_path))) == "OCR TEST\nLineaire regressie"


def test_check_tesseract_languages_only_requires_english_and_dutch(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout="eng\nnld\n",
            stderr="List of available languages in \"/opt/homebrew/share/tessdata/\" (2):\n",
        ),
    )

    status = check_tesseract_languages()

    assert status["available"] is True
    assert status["missing"] == []
    assert "eng" in status["languages"]
    assert "nld" in status["languages"]


def test_ocr_pdf_respects_page_order(monkeypatch, tmp_path: Path):
    """Pagina's worden parallel verwerkt maar de output staat altijd in volgorde."""
    # Maak een 2-pagina PDF aan
    pdf_path = tmp_path / "scan.pdf"
    doc = fitz.open()
    for _ in range(2):
        doc.new_page()
    doc.save(pdf_path)
    doc.close()

    # Vervang de ProcessPoolExecutor door een ThreadPoolExecutor (geen pickle nodig)
    monkeypatch.setattr(ocr_module, "_ocr_executor", ThreadPoolExecutor(max_workers=2))

    # Vervang de worker door een simpele stub die (page_index, tekst) teruggeeft
    monkeypatch.setattr(
        ocr_module,
        "_ocr_page_worker",
        lambda args: (args[0], f"tekst pagina {args[0]}"),
    )

    result = asyncio.run(ocr_pdf(str(pdf_path)))

    # Pagina 1 moet vóór Pagina 2 staan
    pos_pagina_1 = result.find("Pagina 1")
    pos_pagina_2 = result.find("Pagina 2")
    assert pos_pagina_1 != -1, "Pagina 1 niet gevonden in output"
    assert pos_pagina_2 != -1, "Pagina 2 niet gevonden in output"
    assert pos_pagina_1 < pos_pagina_2, "Pagina 1 staat niet vóór Pagina 2"


def test_build_tile_boxes_splits_extremely_large_images():
    boxes = _build_tile_boxes(14_250, 60_000)

    assert len(boxes) > 1
    assert all((right - left) <= MAX_OCR_TILE_WIDTH for left, _top, right, _bottom in boxes)
    assert all((bottom - top) <= MAX_OCR_TILE_HEIGHT for _left, top, _right, bottom in boxes)
    assert all((right - left) * (bottom - top) <= MAX_OCR_TILE_PIXELS for left, top, right, bottom in boxes)
