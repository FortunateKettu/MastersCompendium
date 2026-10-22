"""Общий стиль (как в Ouroboros, TierForge, Media Grabber, Zapret Manager), логотип и окно ошибки."""
from __future__ import annotations

from PyQt6.QtCore import QPointF, Qt
from PyQt6.QtGui import QColor, QFont, QIcon, QLinearGradient, QPainter, QPainterPath, QPalette, QPixmap, QPolygonF
from PyQt6.QtWidgets import (QApplication, QDialog, QHBoxLayout, QLabel, QPlainTextEdit, QPushButton, QStyle,
                             QVBoxLayout)

from .. import paths
from ..i18n import tr

ACCENT = "#8b5cf6"
DND_ACCENT = "#e0455a"
CP_ACCENT = "#f5e642"
CP_ACCENT_2 = "#16e0d6"

QSS = """
* { font-family: 'Segoe UI', 'Inter', sans-serif; font-size: 10pt; color: #e6e8ee; }
QMainWindow, QWidget#root { background: #17181c; }
QDialog, QMessageBox, QInputDialog { background: #1e2026; }
QMessageBox QLabel { color: #e6e8ee; }
QMessageBox QPushButton { min-width: 80px; }
QToolTip { background: #26282e; color: #e6e8ee; border: 1px solid #3a3d47; padding: 4px; }
QGroupBox { border: 1px solid #2c2f37; border-radius: 10px; margin-top: 14px; padding: 12px 10px 10px 10px; }
QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 4px; color: #8ab4ff; font-weight: 600; }
QFrame#card { background: #1e2026; border: 1px solid #2c2f37; border-radius: 12px; }
QFrame#hint { background: #1a1f2c; border: 1px solid #2a3350; border-radius: 10px; }
QLabel#title { font-size: 16pt; font-weight: 700; color: #ffffff; }
QLabel#bigtitle { font-size: 24pt; font-weight: 700; color: #ffffff; }
QLabel#muted { color: #8b91a0; }
QLabel#section { font-size: 11pt; font-weight: 700; color: #ffffff; }
QLabel#badge { background: #2e2450; color: #c4b5fd; border-radius: 5px; padding: 1px 7px;
               font-size: 8pt; font-weight: 700; }
QLabel#code { font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 22pt; font-weight: 700;
              color: #ffffff; letter-spacing: 4px; }
QLineEdit, QComboBox, QPlainTextEdit, QListWidget, QSpinBox {
    background: #14151a; border: 1px solid #2f323b; border-radius: 8px; padding: 6px 8px;
    selection-background-color: #3d6df2; }
QLineEdit:focus, QComboBox:focus, QPlainTextEdit:focus, QSpinBox:focus { border-color: #8b5cf6; }
QLineEdit:disabled, QComboBox:disabled, QSpinBox:disabled { color: #5d6270; }
QComboBox::drop-down { border: none; width: 22px; }
QComboBox QAbstractItemView { background: #1e2026; border: 1px solid #2f323b; selection-background-color: #3d6df2; }
QListWidget { padding: 4px; outline: none; }
QListWidget::item { padding: 6px 6px; border-radius: 6px; }
QListWidget::item:selected { background: #2e2450; color: #ffffff; }
QListWidget::item:hover:!selected { background: #1f2229; }
QPushButton { background: #2a2d36; border: 1px solid #353946; border-radius: 8px; padding: 8px 14px; }
QPushButton:hover { background: #333744; }
QPushButton:pressed { background: #23262e; }
QPushButton:disabled { color: #5d6270; background: #202228; border-color: #2a2c33; }
QPushButton#primary { background: #6d3df0; border-color: #8b5cf6; font-weight: 600; }
QPushButton#primary:hover { background: #7c4dff; }
QPushButton#danger { background: #3a2226; border-color: #5a2d33; color: #ff9aa2; }
QPushButton#danger:hover { background: #4a2a30; }
QPushButton#success { background: #1f3b2e; border-color: #2b5a43; color: #7ee2b0; font-weight: 600; }
QPushButton#success:hover { background: #26493a; }
QPushButton#tool { padding: 0; border-radius: 7px; background: #23262e; min-width: 32px; min-height: 32px; }
QPushButton#tool:hover { background: #333744; }
QPushButton#link { background: transparent; border: none; color: #c4b5fd; padding: 2px 4px; }
QPushButton#link:hover { color: #ddd3ff; text-decoration: underline; }
QPushButton#seg { background: transparent; border: 1px solid #353946; border-radius: 7px; padding: 4px 10px;
                  font-weight: 700; color: #8b91a0; }
QPushButton#seg:checked { background: #2e2450; border-color: #8b5cf6; color: #ffffff; }
QPushButton::menu-indicator { subcontrol-position: right center; right: 8px; }
QMenu { background: #1e2026; border: 1px solid #2f323b; border-radius: 8px; padding: 4px; }
QMenu::item { padding: 6px 22px 6px 14px; border-radius: 6px; }
QMenu::item:selected { background: #6d3df0; }
QMenu::item:disabled { color: #5d6270; }
QMenu::separator { height: 1px; background: #2f323b; margin: 4px 8px; }
QCheckBox, QRadioButton { spacing: 8px; }
QCheckBox::indicator { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #4a4e5c; background: #14151a; }
QCheckBox::indicator:hover { border-color: #8b5cf6; }
QCheckBox::indicator:checked { background: #8b5cf6; border-color: #a78bfa; }
QScrollArea, QScrollArea > QWidget > QWidget { background: transparent; }
QScrollBar:vertical { background: transparent; width: 10px; }
QScrollBar::handle:vertical { background: #353946; border-radius: 5px; min-height: 30px; }
QScrollBar:horizontal { background: transparent; height: 10px; }
QScrollBar::handle:horizontal { background: #353946; border-radius: 5px; min-width: 30px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; width: 0; }
"""


def apply_style(app: QApplication) -> None:
    app.setStyle("Fusion")
    f = app.font()
    f.setStyleStrategy(QFont.StyleStrategy.PreferAntialias | QFont.StyleStrategy.NoSubpixelAntialias)
    app.setFont(f)
    pal = QPalette()
    for role, col in [(QPalette.ColorRole.Window, "#1e2026"), (QPalette.ColorRole.WindowText, "#e6e8ee"),
                      (QPalette.ColorRole.Base, "#14151a"), (QPalette.ColorRole.AlternateBase, "#1e2026"),
                      (QPalette.ColorRole.Text, "#e6e8ee"), (QPalette.ColorRole.Button, "#2a2d36"),
                      (QPalette.ColorRole.ButtonText, "#e6e8ee"), (QPalette.ColorRole.Highlight, "#6d3df0"),
                      (QPalette.ColorRole.HighlightedText, "#ffffff"), (QPalette.ColorRole.ToolTipBase, "#26282e"),
                      (QPalette.ColorRole.ToolTipText, "#e6e8ee")]:
        pal.setColor(role, QColor(col))
    app.setPalette(pal)
    app.setStyleSheet(QSS)


# --------------------------------------------------------------------------- логотип
# Знак Masters Compendium: двадцатигранник (d20) из отдельных граней с зазорами между ними —
# тот же приём, что у Уробороса и TierForge: цельный силуэт, залитый диагональным градиентом.

def d20_facets(size: float) -> list[list[tuple[float, float]]]:
    """Грани d20 (вид спереди) в координатах квадрата size×size. Общие с SVG-версией для веба."""
    import math
    cx, cy, R = size / 2, size / 2, size * 0.46
    # внешний шестиугольник, вершина сверху
    hexa = [(cx + R * math.cos(math.radians(-90 + 60 * i)), cy + R * math.sin(math.radians(-90 + 60 * i)))
            for i in range(6)]
    T, UR, LR, B, LL, UL = hexa
    # центральный треугольник (вершиной вверх)
    r = R * 0.58
    A = (cx, cy - r * 0.86)
    Br = (cx + r * 0.88, cy + r * 0.56)
    Bl = (cx - r * 0.88, cy + r * 0.56)
    return [
        [A, Br, Bl],                 # центральная грань
        [T, A, UL], [T, UR, A],      # верх
        [UL, A, Bl], [UL, Bl, LL],   # лево
        [UR, Br, A], [UR, LR, Br],   # право
        [LL, Bl, B], [Bl, Br, B], [Br, LR, B],  # низ
    ]


def _shrink(poly: list[tuple[float, float]], gap: float) -> list[tuple[float, float]]:
    """Сдвинуть вершины к центру грани — получаются тонкие «линии» между гранями."""
    mx = sum(p[0] for p in poly) / len(poly)
    my = sum(p[1] for p in poly) / len(poly)
    out = []
    for x, y in poly:
        dx, dy = mx - x, my - y
        d = (dx * dx + dy * dy) ** 0.5 or 1.0
        k = min(gap / d, 0.45)
        out.append((x + dx * k, y + dy * k))
    return out


def logo_path(size: float) -> QPainterPath:
    path = QPainterPath()
    path.setFillRule(Qt.FillRule.WindingFill)
    gap = size * 0.022
    for face in d20_facets(size):
        pts = _shrink(face, gap)
        path.addPolygon(QPolygonF([QPointF(x, y) for x, y in pts]))
        path.closeSubpath()
    return path


GRADIENT = (("0.0", "#4c1d95"), ("0.45", "#7c3aed"), ("0.8", "#a78bfa"), ("1.0", "#f3eeff"))


def draw_logo(p: QPainter, size: float) -> None:
    g = QLinearGradient(0, 0, size, size)
    for pos, col in GRADIENT:
        g.setColorAt(float(pos), QColor(col))
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.fillPath(logo_path(size), g)


def make_logo(px: int = 256) -> QPixmap:
    logo = paths.RES_DIR / "logo.png"
    if logo.exists():
        src = QPixmap(str(logo))
        if not src.isNull():
            return src.scaled(px, px, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
    pm = QPixmap(px, px)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    draw_logo(p, px)
    p.end()
    return pm


def app_icon() -> QIcon:
    ico = paths.RES_DIR / "icon.ico"
    if ico.exists():
        return QIcon(str(ico))
    icon = QIcon()
    for s in (16, 24, 32, 48, 64, 128, 256):
        icon.addPixmap(make_logo(s))
    return icon


# --------------------------------------------------------------------------- окно ошибки

class ErrorDialog(QDialog):
    """Окно ошибки: понятный текст и подробности по кнопке."""

    def __init__(self, message: str, details: str = "", parent=None, title: str | None = None):
        super().__init__(parent)
        self.setWindowTitle(f"{paths.APP_NAME} — {tr('common.error').lower()}")
        self.setMinimumWidth(480)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.setSpacing(10)
        head = QHBoxLayout()
        ic = QLabel()
        ic.setPixmap(self.style().standardIcon(QStyle.StandardPixmap.SP_MessageBoxCritical).pixmap(36, 36))
        head.addWidget(ic, 0, Qt.AlignmentFlag.AlignTop)
        tl = QLabel(title or tr("error.unexpected"), wordWrap=True)
        tl.setStyleSheet("font-size: 13pt; font-weight: 700; color: #ff8a8a;")
        head.addWidget(tl, 1)
        lay.addLayout(head)
        msg = QLabel(message or "?", wordWrap=True)
        msg.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        lay.addWidget(msg)
        self.details = QPlainTextEdit(details, readOnly=True)
        self.details.setStyleSheet("font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 9pt;")
        self.details.setVisible(False)
        self.details.setMinimumHeight(140)
        lay.addWidget(self.details)
        btns = QHBoxLayout()
        if details:
            bd = QPushButton(tr("common.details"))
            bd.clicked.connect(lambda: self.details.setVisible(not self.details.isVisible()))
            btns.addWidget(bd)
        btns.addStretch(1)
        ok = QPushButton(tr("common.ok"), objectName="primary")
        ok.clicked.connect(self.accept)
        btns.addWidget(ok)
        lay.addLayout(btns)


def show_error(parent, message: str, details: str = "", title: str | None = None) -> None:
    ErrorDialog(message, details, parent, title).exec()
