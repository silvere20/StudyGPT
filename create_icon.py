#!/usr/bin/env python3
"""
Genereert het StudyFlow AI app-icoon en installeert het in de .app bundle.
Draai eenmalig: python3 create_icon.py
"""
import math
import os
import shutil
import subprocess
import sys
import tempfile

VENV_PYTHON = os.path.join(os.path.dirname(__file__), "backend", ".venv", "bin", "python")

# Als we niet in de venv draaien, herstart dan binnen de venv (want Pillow zit daar)
if sys.executable != VENV_PYTHON and os.path.exists(VENV_PYTHON):
    os.execv(VENV_PYTHON, [VENV_PYTHON] + sys.argv)

from PIL import Image, ImageDraw  # noqa: E402

ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def draw_icon(size: int) -> Image.Image:
    """Teken een oranje afgerond vierkant met een open boek."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Afgerond vierkant (oranje gradient effect)
    r = size // 6
    orange = (255, 107, 53)
    dark_orange = (230, 80, 20)

    # Achtergrond: effen oranje afgerond vierkant
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=r, fill=orange)

    # Subtiele schaduw binnenin (iets donkerder onderaan)
    for i in range(size // 3):
        alpha = int(40 * (i / (size // 3)))
        d.line([(0, size - 1 - i), (size - 1, size - 1 - i)],
               fill=(*dark_orange, alpha))

    # Boek tekenen — wit, relatief groot
    m = size // 6       # marge
    bw = size - 2 * m   # breedte boek
    bh = int(bw * 0.78) # hoogte boek
    bx = m
    by = (size - bh) // 2

    # Beide boekpagina's (links en rechts)
    half = bw // 2
    line_w = max(1, size // 64)
    spine = max(2, size // 40)

    # Linkerpagina
    d.rounded_rectangle(
        [(bx, by), (bx + half - spine // 2, by + bh)],
        radius=max(2, size // 80),
        fill="white",
    )
    # Rechterpagina
    d.rounded_rectangle(
        [(bx + half + spine // 2, by), (bx + bw, by + bh)],
        radius=max(2, size // 80),
        fill="white",
    )

    # Regeltjes op de pagina's
    num_lines = 4
    line_margin = bh // 6
    for i in range(1, num_lines + 1):
        y = by + line_margin + int(i * (bh - 2 * line_margin) / (num_lines + 1))
        # Links
        d.rectangle(
            [(bx + size // 20, y), (bx + half - spine // 2 - size // 20, y + line_w)],
            fill=orange,
        )
        # Rechts
        d.rectangle(
            [(bx + half + spine // 2 + size // 20, y), (bx + bw - size // 20, y + line_w)],
            fill=orange,
        )

    # Rugbinding
    d.rectangle(
        [(bx + half - spine // 2, by), (bx + half + spine // 2, by + bh)],
        fill=(200, 200, 200, 180),
    )

    return img


def make_iconset(dest_dir: str):
    """Maak een .iconset map met alle benodigde groottes."""
    iconset = os.path.join(dest_dir, "studyflow.iconset")
    os.makedirs(iconset, exist_ok=True)

    for size in ICON_SIZES:
        img = draw_icon(size)
        img.save(os.path.join(iconset, f"icon_{size}x{size}.png"))
        if size <= 512:
            img2 = draw_icon(size * 2)
            img2.save(os.path.join(iconset, f"icon_{size}x{size}@2x.png"))

    return iconset


def build_icns(iconset_dir: str, output_path: str) -> bool:
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", "-o", output_path, iconset_dir],
            check=True, capture_output=True,
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"iconutil fout: {e.stderr.decode()}")
        return False


def set_app_icon(app_path: str, icns_path: str):
    """Kopieer het .icns naar de .app bundle en verwijder gecachte iconen."""
    resources = os.path.join(app_path, "Contents", "Resources")
    os.makedirs(resources, exist_ok=True)
    dest = os.path.join(resources, "applet.icns")
    shutil.copy2(icns_path, dest)

    # Forceer Finder om icoon opnieuw te lezen
    subprocess.run(["touch", app_path], capture_output=True)
    subprocess.run(
        ["osascript", "-e", f'tell application "Finder" to update item (POSIX file "{app_path}") of desktop'],
        capture_output=True,
    )
    print(f"✅ Icoon ingesteld: {dest}")


def create_app_bundle(app_path: str, project_dir: str, python_bin: str) -> bool:
    """Maak een .app bundle met AppleScript die Terminal niet opent."""
    if os.path.exists(app_path):
        shutil.rmtree(app_path)

    script = f'''do shell script "export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH && cd '{project_dir}' && '{python_bin}' launcher.py > /tmp/studyflow.log 2>&1 &"'''

    with tempfile.NamedTemporaryFile(suffix=".applescript", mode="w", delete=False) as f:
        f.write(script)
        tmp = f.name

    try:
        result = subprocess.run(
            ["osacompile", "-o", app_path, tmp],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"osacompile fout: {result.stderr}")
            return False
        return True
    finally:
        os.unlink(tmp)


def main():
    project_dir = os.path.dirname(os.path.abspath(__file__))
    desktop = os.path.expanduser("~/Desktop")
    app_path = os.path.join(desktop, "StudyFlow AI.app")
    python_bin = os.path.join(project_dir, "backend", ".venv", "bin", "python")

    print("📦 StudyFlow AI .app aanmaken...")

    # 1. App bundle
    if create_app_bundle(app_path, project_dir, python_bin):
        print(f"✅ App bundle: {app_path}")
    else:
        print("❌ App bundle mislukt")
        sys.exit(1)

    # 2. Icoon genereren
    with tempfile.TemporaryDirectory() as tmp:
        print("🎨 Icoon genereren...")
        iconset = make_iconset(tmp)
        icns = os.path.join(tmp, "studyflow.icns")

        # Sla ook een PNG op voor tkinter (in project dir)
        png_path = os.path.join(project_dir, "icon_512.png")
        draw_icon(512).save(png_path)
        print(f"✅ PNG opgeslagen: {png_path}")

        if build_icns(iconset, icns):
            set_app_icon(app_path, icns)
            # Kopieer ook naar project voor toekomstig gebruik
            shutil.copy2(icns, os.path.join(project_dir, "studyflow.icns"))
            print("✅ .icns opgeslagen in project")
        else:
            print("⚠️  .icns aanmaken mislukt, app heeft standaard icoon")

    print(f"\n✅ Klaar! Dubbelklik op {app_path}")
    print("   (Terminal opent niet meer)")


if __name__ == "__main__":
    main()
