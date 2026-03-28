import asyncio
import subprocess
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

from services.ocr import (
    MAX_OCR_TILE_HEIGHT,
    MAX_OCR_TILE_PIXELS,
    MAX_OCR_TILE_WIDTH,
    _build_tile_boxes,
    is_scanned_pdf,
    ocr_image,
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


def test_build_tile_boxes_splits_extremely_large_images():
    boxes = _build_tile_boxes(14_250, 60_000)

    assert len(boxes) > 1
    assert all((right - left) <= MAX_OCR_TILE_WIDTH for left, _top, right, _bottom in boxes)
    assert all((bottom - top) <= MAX_OCR_TILE_HEIGHT for _left, top, _right, bottom in boxes)
    assert all((right - left) * (bottom - top) <= MAX_OCR_TILE_PIXELS for left, top, right, bottom in boxes)
