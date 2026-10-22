"""Иконки программы мастера — тот же набор, что в веб-клиенте (web/js/icons.js).

icon("dice")                    → QIcon серого цвета для кнопок
icon("dice", "#ffffff")         → своим цветом
icon("dice", grad=True)         → фиолетовый градиент, как у логотипа
pixmap("dice", 32, grad=True)   → QPixmap для QLabel
"""
from __future__ import annotations

from functools import lru_cache

from PyQt6.QtCore import QByteArray, QRectF, QSize, Qt
from PyQt6.QtGui import QIcon, QPainter, QPixmap
from PyQt6.QtSvg import QSvgRenderer

from .icons_data import ICONS

DEFAULT = "#c9ccd6"
GRAD = ('<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">'
        '<stop offset="0" stop-color="#a78bfa"/><stop offset=".55" stop-color="#8b5cf6"/>'
        '<stop offset="1" stop-color="#e9e3ff"/></linearGradient></defs>')


def _svg(name: str, color: str, grad: bool, width: float) -> bytes:
    stroke = "url(#g)" if grad else color
    body = ICONS.get(name, "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{stroke}" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round">{GRAD if grad else ""}{body}</svg>').encode()


@lru_cache(maxsize=512)
def pixmap(name: str, size: int = 18, color: str = DEFAULT, grad: bool = False, width: float = 1.9) -> QPixmap:
    dpr = 2
    pm = QPixmap(size * dpr, size * dpr)
    pm.setDevicePixelRatio(dpr)
    pm.fill(Qt.GlobalColor.transparent)
    r = QSvgRenderer(QByteArray(_svg(name, color, grad, width)))
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    r.render(p, QRectF(0, 0, size, size))
    p.end()
    return pm


def icon(name: str, color: str = DEFAULT, grad: bool = False, size: int = 18) -> QIcon:
    ic = QIcon()
    ic.addPixmap(pixmap(name, size, color, grad), QIcon.Mode.Normal)
    ic.addPixmap(pixmap(name, size, "#5d6270", False), QIcon.Mode.Disabled)
    return ic


def set_icon(button, name: str, color: str = DEFAULT, grad: bool = False, size: int = 18) -> None:
    button.setIcon(icon(name, color, grad, size))
    button.setIconSize(QSize(size, size))
