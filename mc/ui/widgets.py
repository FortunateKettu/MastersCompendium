"""Общие виджеты: анимированные карточки выбора, тост, стек с плавной сменой страниц, QR-код."""
from __future__ import annotations

import math

from PyQt6.QtCore import (QEasingCurve, QPointF, QPropertyAnimation, QRectF, QSize, Qt, QTimer, QVariantAnimation,
                          pyqtSignal)
from PyQt6.QtGui import (QBrush, QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap,
                         QRadialGradient)
from PyQt6.QtWidgets import (QGraphicsOpacityEffect, QHBoxLayout, QLabel, QPushButton, QStackedWidget, QVBoxLayout,
                             QWidget)

from .icons import pixmap as icon_pixmap
from .style import draw_logo


# --------------------------------------------------------------------------- плавная смена страниц

class FadeStack(QStackedWidget):
    """QStackedWidget, который плавно проявляет новую страницу."""

    def fade_to(self, w: QWidget) -> None:
        if self.indexOf(w) < 0:
            self.addWidget(w)
        self.setCurrentWidget(w)
        eff = QGraphicsOpacityEffect(w)
        w.setGraphicsEffect(eff)
        anim = QPropertyAnimation(eff, b"opacity", w)
        anim.setDuration(220)
        anim.setStartValue(0.0)
        anim.setEndValue(1.0)
        anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        # после анимации эффект снимаем — он замедляет отрисовку
        anim.finished.connect(lambda: w.setGraphicsEffect(None))
        anim.start(QPropertyAnimation.DeletionPolicy.DeleteWhenStopped)


# --------------------------------------------------------------------------- тост

class Toast(QLabel):
    """Короткое всплывающее сообщение внизу окна."""

    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setStyleSheet("background: rgba(38,40,48,235); color: #ffffff; border: 1px solid #3a3d47;"
                           "border-radius: 10px; padding: 9px 16px; font-weight: 600;")
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self._eff = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(self._eff)
        self._anim = QPropertyAnimation(self._eff, b"opacity", self)
        self._anim.setDuration(180)
        self._timer = QTimer(self, singleShot=True, timeout=self._hide)
        self.hide()

    def show_text(self, text: str, ms: int = 2200) -> None:
        self.setText(text)
        self.adjustSize()
        p = self.parentWidget()
        self.move((p.width() - self.width()) // 2, p.height() - self.height() - 28)
        self.raise_()
        self.show()
        self._anim.stop()
        self._anim.setStartValue(self._eff.opacity() if self.isVisible() else 0.0)
        self._anim.setEndValue(1.0)
        self._anim.start()
        self._timer.start(ms)

    def _hide(self) -> None:
        self._anim.stop()
        self._anim.setStartValue(1.0)
        self._anim.setEndValue(0.0)
        try:
            self._anim.finished.disconnect()
        except TypeError:
            pass
        self._anim.finished.connect(lambda: self._eff.opacity() < 0.05 and self.hide())
        self._anim.start()


# --------------------------------------------------------------------------- карточка выбора системы

class SystemCard(QWidget):
    """Большой блок выбора режима (D&D / Cyberpunk RED) с анимацией при наведении."""

    clicked = pyqtSignal()

    def __init__(self, kind: str, title: str, desc: str, accent: str, accent2: str | None = None,
                 badge: str = "", parent=None):
        super().__init__(parent)
        self.kind, self.title, self.desc, self.badge = kind, title, desc, badge
        self.accent = QColor(accent)
        self.accent2 = QColor(accent2 or accent)
        self._hover = 0.0
        self._t = 0.0
        self.setMinimumSize(300, 340)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMouseTracking(True)
        self._anim = QVariantAnimation(self, duration=260, easingCurve=QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._set_hover)
        # лёгкое «дыхание» эмблемы, пока курсор над карточкой
        self._tick = QTimer(self, interval=16, timeout=self._advance)

    def sizeHint(self) -> QSize:
        return QSize(380, 420)

    def _set_hover(self, v) -> None:
        self._hover = float(v)
        self.update()

    def _advance(self) -> None:
        self._t += 0.016
        self.update()

    def enterEvent(self, e) -> None:
        self._anim.stop()
        self._anim.setStartValue(self._hover)
        self._anim.setEndValue(1.0)
        self._anim.start()
        self._tick.start()

    def leaveEvent(self, e) -> None:
        self._anim.stop()
        self._anim.setStartValue(self._hover)
        self._anim.setEndValue(0.0)
        self._anim.start()
        self._tick.stop()

    def mouseReleaseEvent(self, e) -> None:
        if e.button() == Qt.MouseButton.LeftButton and self.rect().contains(e.position().toPoint()):
            self.clicked.emit()

    # ------------------------------------------------------------------ отрисовка
    def paintEvent(self, e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        h = self._hover
        lift = 6 * h
        r = QRectF(self.rect()).adjusted(10, 10 + 6 - lift, -10, -10 - lift)

        # тень / свечение
        for i in range(6, 0, -1):
            c = QColor(self.accent)
            c.setAlpha(int((10 + 22 * h) / i))
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(c)
            p.drawRoundedRect(r.adjusted(-i * 1.6, -i * 1.2 + 4, i * 1.6, i * 2.2 + 4), 22 + i, 22 + i)

        # фон карточки: тёмное стекло с подкраской акцентом
        path = QPainterPath()
        path.addRoundedRect(r, 20, 20)
        g = QLinearGradient(r.topLeft(), r.bottomRight())
        top = QColor(self.accent)
        top.setAlpha(int(38 + 30 * h))
        g.setColorAt(0.0, top)
        g.setColorAt(0.55, QColor(30, 32, 38, 245))
        g.setColorAt(1.0, QColor(22, 23, 28, 250))
        p.fillPath(path, g)
        glow = QRadialGradient(QPointF(r.center().x(), r.top() + r.height() * 0.38), r.width() * 0.6)
        gc = QColor(self.accent2)
        gc.setAlpha(int(30 + 45 * h))
        glow.setColorAt(0.0, gc)
        glow.setColorAt(1.0, QColor(0, 0, 0, 0))
        p.fillPath(path, glow)

        # рамка
        border = QColor(self.accent)
        border.setAlpha(int(70 + 150 * h))
        pen = QPen(border, 1.4 + 0.8 * h)
        if self.kind == "cyberpunk":
            pen.setDashPattern([6, 4])
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(path)

        # эмблема
        em = min(r.width(), r.height()) * (0.42 + 0.03 * h)
        cx, cy = r.center().x(), r.top() + r.height() * 0.38
        if self.kind == "dnd":
            self._paint_d20(p, cx, cy, em, h)
        else:
            self._paint_cyber(p, cx, cy, em, h)

        # бейдж «Скоро»
        if self.badge:
            f = QFont(self.font())
            f.setPointSizeF(8.5)
            f.setBold(True)
            p.setFont(f)
            tw = p.fontMetrics().horizontalAdvance(self.badge) + 18
            br = QRectF(r.right() - tw - 14, r.top() + 14, tw, 22)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(self.accent.red(), self.accent.green(), self.accent.blue(), 40))
            p.drawRoundedRect(br, 6, 6)
            p.setPen(self.accent)
            p.drawText(br, Qt.AlignmentFlag.AlignCenter, self.badge)

        # текст
        f = QFont(self.font())
        f.setPointSizeF(17)
        f.setBold(True)
        p.setFont(f)
        p.setPen(QColor("#ffffff"))
        tr_ = QRectF(r.left() + 16, r.top() + r.height() * 0.70, r.width() - 32, 34)
        p.drawText(tr_, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter, self.title)
        f.setPointSizeF(10)
        f.setBold(False)
        p.setFont(f)
        p.setPen(QColor("#9aa0ad"))
        dr = QRectF(r.left() + 16, tr_.bottom() + 2, r.width() - 32, 40)
        p.drawText(dr, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop | Qt.TextFlag.TextWordWrap, self.desc)
        p.end()

    def _paint_d20(self, p: QPainter, cx: float, cy: float, size: float, h: float) -> None:
        p.save()
        p.translate(cx, cy)
        p.rotate(math.sin(self._t * 1.6) * 4 * h)
        p.translate(-size / 2, -size / 2)
        draw_logo(p, size)
        p.restore()

    def _paint_cyber(self, p: QPainter, cx: float, cy: float, size: float, h: float) -> None:
        """Неоновая надпись RED с глитчем при наведении."""
        f = QFont("Segoe UI", 10)
        f.setPixelSize(int(size * 0.46))
        f.setBold(True)
        f.setItalic(True)
        f.setLetterSpacing(QFont.SpacingType.PercentageSpacing, 104)
        p.setFont(f)
        rect = QRectF(cx - size, cy - size * 0.38, size * 2, size * 0.76)
        jitter = 0.0
        if h > 0.05:
            jitter = (math.sin(self._t * 37) * math.sin(self._t * 13)) * 4 * h
        cyan = QColor(self.accent2)
        cyan.setAlpha(int(140 * h))
        mag = QColor("#ff2a6d")
        mag.setAlpha(int(140 * h))
        p.setPen(cyan)
        p.drawText(rect.translated(-3 - jitter, 0), Qt.AlignmentFlag.AlignCenter, "RED")
        p.setPen(mag)
        p.drawText(rect.translated(3 + jitter, 0), Qt.AlignmentFlag.AlignCenter, "RED")
        p.setPen(self.accent)
        p.drawText(rect, Qt.AlignmentFlag.AlignCenter, "RED")
        # подчёркивание-«микросхема»
        y = rect.bottom() + 4
        pen = QPen(self.accent, 2)
        p.setPen(pen)
        w = size * 0.9
        p.drawLine(QPointF(cx - w / 2, y), QPointF(cx + w / 2 - 18, y))
        p.drawLine(QPointF(cx + w / 2 - 18, y), QPointF(cx + w / 2, y - 10))
        p.setBrush(QBrush(self.accent))
        p.drawEllipse(QPointF(cx - w / 2, y), 3, 3)


# --------------------------------------------------------------------------- маленькие плашки

class TileButton(QPushButton):
    """Крупная кнопка-плитка с заголовком и описанием (меню D&D)."""

    def __init__(self, icon_name: str, title: str, desc: str, parent=None):
        super().__init__(parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(74)
        self.setStyleSheet(
            "QPushButton { text-align: left; padding: 12px 16px; border-radius: 12px; background: #23252d;"
            " border: 1px solid #30333d; }"
            "QPushButton:hover { background: #2a2535; border-color: #8b5cf6; }")
        lay = QHBoxLayout(self)
        lay.setContentsMargins(16, 10, 16, 10)
        lay.setSpacing(14)
        ic = QLabel()
        ic.setFixedSize(46, 46)
        ic.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ic.setPixmap(icon_pixmap(icon_name, 26, grad=True, width=1.7))
        ic.setStyleSheet("background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 rgba(124,58,237,0.30),"
                         " stop:1 rgba(61,109,242,0.12)); border: 1px solid rgba(139,92,246,0.40); border-radius: 13px;")
        ic.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        lay.addWidget(ic)
        txt = QLabel(f"<div style='font-size:12pt;font-weight:700;color:#fff'>{title}</div>"
                     f"<div style='color:#9aa0ad'>{desc}</div>")
        txt.setStyleSheet("background: transparent;")
        txt.setWordWrap(True)
        txt.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        lay.addWidget(txt, 1)


def avatar_pixmap(name: str, color: str, size: int = 36, online: bool = True) -> QPixmap:
    dpr = 2
    pm = QPixmap(size * dpr, size * dpr)
    pm.setDevicePixelRatio(dpr)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    c = QColor(color)
    if not online:
        c.setAlpha(110)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(c)
    p.drawEllipse(QRectF(0, 0, size, size))
    f = QFont("Segoe UI")
    f.setPixelSize(int(size * 0.44))
    f.setBold(True)
    p.setFont(f)
    p.setPen(QColor(255, 255, 255, 255 if online else 150))
    p.drawText(QRectF(0, 0, size, size), Qt.AlignmentFlag.AlignCenter, (name.strip()[:1] or "?").upper())
    p.end()
    return pm


def portrait_pixmap(data_url: str, size: int = 40) -> QPixmap | None:
    """Портрет из листа (data:image/...;base64,...) → круглая картинка, или None."""
    if not data_url or not data_url.startswith("data:image/") or "," not in data_url:
        return None
    import base64
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=False)
    except (ValueError, TypeError):
        return None
    src = QPixmap()
    if not src.loadFromData(raw):
        return None
    dpr = 2
    pm = QPixmap(size * dpr, size * dpr)
    pm.setDevicePixelRatio(dpr)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
    clip = QPainterPath()
    clip.addEllipse(QRectF(0, 0, size, size))
    p.setClipPath(clip)
    p.drawPixmap(QRectF(0, 0, size, size).toRect(), src)
    p.end()
    return pm


# --------------------------------------------------------------------------- QR-код

class QrWidget(QWidget):
    """QR-код: тёмные модули на белой подложке (так его читают все камеры)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._matrix: list[list[bool]] = []
        self.setMinimumSize(180, 180)

    def set_data(self, text: str) -> None:
        import qrcode
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
        qr.add_data(text)
        qr.make(fit=True)
        self._matrix = qr.get_matrix()
        self.update()

    def hasHeightForWidth(self) -> bool:
        return True

    def heightForWidth(self, w: int) -> int:
        return w

    def paintEvent(self, e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        side = min(self.width(), self.height())
        ox, oy = (self.width() - side) / 2, (self.height() - side) / 2
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor("#ffffff"))
        p.drawRoundedRect(QRectF(ox, oy, side, side), side * 0.06, side * 0.06)
        if not self._matrix:
            p.end()
            return
        n = len(self._matrix)
        quiet = 3
        cell = side / (n + quiet * 2)
        p.setBrush(QColor("#17181c"))
        for y, row in enumerate(self._matrix):
            for x, on in enumerate(row):
                if on:
                    p.drawRect(QRectF(ox + (x + quiet) * cell, oy + (y + quiet) * cell, cell + 0.6, cell + 0.6))
        p.end()


def icon_title(icon_name: str, text: str, object_name: str = "section", size: int = 18) -> QWidget:
    """Заголовок с иконкой слева (иконка в фирменном градиенте)."""
    w = QWidget()
    lay = QHBoxLayout(w)
    lay.setContentsMargins(0, 0, 0, 0)
    lay.setSpacing(8)
    ic = QLabel()
    ic.setPixmap(icon_pixmap(icon_name, size, grad=True))
    lay.addWidget(ic)
    lb = QLabel(text, objectName=object_name)
    lb.setTextFormat(Qt.TextFormat.PlainText)
    lay.addWidget(lb)
    lay.addStretch(1)
    w.label = lb
    return w


def icon_hint(icon_name: str, text: str) -> QWidget:
    """Строка-подсказка: маленькая иконка + текст с переносом."""
    w = QWidget()
    lay = QHBoxLayout(w)
    lay.setContentsMargins(0, 0, 0, 0)
    lay.setSpacing(10)
    ic = QLabel()
    ic.setPixmap(icon_pixmap(icon_name, 18, "#8ab4ff"))
    ic.setAlignment(Qt.AlignmentFlag.AlignTop)
    lay.addWidget(ic, 0, Qt.AlignmentFlag.AlignTop)
    lb = QLabel(text, wordWrap=True)
    lay.addWidget(lb, 1)
    return w


class EmptyState(QWidget):
    """Пустой список: крупная иконка в градиенте и пояснение."""

    def __init__(self, icon_name: str, text: str, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setSpacing(10)
        lay.addStretch(1)
        ic = QLabel()
        ic.setPixmap(icon_pixmap(icon_name, 44, grad=True, width=1.4))
        ic.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(ic)
        lb = QLabel(text, objectName="muted", wordWrap=True)
        lb.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(lb)
        lay.addStretch(1)
