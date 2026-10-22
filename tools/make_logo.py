"""Собрать логотип во всех нужных форматах из одной геометрии (mc/ui/style.py):
logo.png (512), icon.ico (16…256), web/logo.svg, web/icon-192.png, web/icon-512.png.

Запуск из корня проекта:  python tools/make_logo.py
"""
from __future__ import annotations

import io
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt6.QtCore import QBuffer, QIODevice, Qt  # noqa: E402
from PyQt6.QtGui import QGuiApplication, QPainter, QPixmap  # noqa: E402

from mc.ui.style import GRADIENT, _shrink, d20_facets, draw_logo  # noqa: E402


def render(px: int, bg: str | None = None, pad: float = 0.0) -> QPixmap:
    pm = QPixmap(px, px)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    if bg:
        from PyQt6.QtGui import QColor
        p.setBrush(QColor(bg))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(0, 0, px, px, px * 0.22, px * 0.22)
    inner = px * (1 - 2 * pad)
    p.translate(px * pad, px * pad)
    draw_logo(p, inner)
    p.end()
    return pm


def png_bytes(pm: QPixmap) -> bytes:
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    pm.save(buf, "PNG")
    return bytes(buf.data())


def write_ico(path: Path, sizes=(16, 24, 32, 48, 64, 128, 256)) -> None:
    """ICO с PNG-кадрами внутри (так умеет Windows Vista+)."""
    frames = [png_bytes(render(s)) for s in sizes]
    out = io.BytesIO()
    out.write(struct.pack("<HHH", 0, 1, len(sizes)))
    offset = 6 + 16 * len(sizes)
    for s, data in zip(sizes, frames, strict=True):
        out.write(struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    for data in frames:
        out.write(data)
    path.write_bytes(out.getvalue())


def write_svg(path: Path, size: int = 512) -> None:
    gap = size * 0.022
    polys = []
    for face in d20_facets(size):
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in _shrink(face, gap))
        polys.append(f'<polygon points="{pts}"/>')
    stops = "".join(f'<stop offset="{pos}" stop-color="{col}"/>' for pos, col in GRADIENT)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
           f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'
           f'<g fill="url(#g)">{"".join(polys)}</g></svg>\n')
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    app = QGuiApplication(sys.argv)  # noqa: F841 — должен жить до конца
    (ROOT / "web").mkdir(exist_ok=True)
    render(512).save(str(ROOT / "logo.png"))
    write_ico(ROOT / "icon.ico")
    write_svg(ROOT / "web" / "logo.svg")
    # иконки «на главный экран» — на тёмной плашке, иначе на светлых обоях теряются
    render(192, "#17181c", 0.14).save(str(ROOT / "web" / "icon-192.png"))
    render(512, "#17181c", 0.14).save(str(ROOT / "web" / "icon-512.png"))
    print("logo.png, icon.ico, web/logo.svg, web/icon-192.png, web/icon-512.png — готово")


if __name__ == "__main__":
    main()
