"""Стартовый экран (выбор системы) и меню D&D (мастер / игрок, недавние кампании)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, pyqtSignal
from PyQt6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QListWidget, QListWidgetItem, QMenu, QPushButton,
                             QVBoxLayout, QWidget)

from ..campaign import peek_name
from ..i18n import tr
from .style import CP_ACCENT, CP_ACCENT_2, DND_ACCENT
from .icons import icon, set_icon
from .widgets import SystemCard, TileButton, icon_hint, icon_title


class StartPage(QWidget):
    dnd_chosen = pyqtSignal()
    cyberpunk_chosen = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(40, 10, 40, 40)
        lay.addStretch(1)
        t = QLabel(tr("start.choose"), objectName="title")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(t)
        lay.addSpacing(18)
        row = QHBoxLayout()
        row.setSpacing(28)
        row.addStretch(1)
        dnd = SystemCard("dnd", tr("start.dnd.title"), tr("start.dnd.desc"), DND_ACCENT, "#8b5cf6")
        dnd.clicked.connect(self.dnd_chosen)
        cp = SystemCard("cyberpunk", tr("start.cp.title"), tr("start.cp.desc"), CP_ACCENT, CP_ACCENT_2,
                        badge=tr("common.soon").upper())
        cp.clicked.connect(self.cyberpunk_chosen)
        for c in (dnd, cp):
            c.setFixedSize(380, 420)
            row.addWidget(c)
        row.addStretch(1)
        lay.addLayout(row)
        lay.addStretch(2)


class DndMenuPage(QWidget):
    back = pyqtSignal()
    new_campaign = pyqtSignal()
    open_campaign = pyqtSignal(str)       # "" — показать диалог выбора файла
    find_game = pyqtSignal()
    forget_recent = pyqtSignal(str)

    def __init__(self, recent: list[str], parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(36, 6, 36, 30)
        lay.setSpacing(14)

        head = QHBoxLayout()
        b = QPushButton(tr("common.back"))
        set_icon(b, "back")
        b.clicked.connect(self.back)
        head.addWidget(b)
        head.addSpacing(10)
        head.addWidget(QLabel(tr("dnd.title"), objectName="title"))
        head.addStretch(1)
        lay.addLayout(head)

        cols = QHBoxLayout()
        cols.setSpacing(18)

        # ---- мастер
        gm = QFrame(objectName="card")
        gl = QVBoxLayout(gm)
        gl.setContentsMargins(18, 18, 18, 18)
        gl.setSpacing(12)
        gl.addWidget(icon_title("wand", tr("dnd.gm")))
        gl.addWidget(QLabel(tr("dnd.gm.desc"), objectName="muted", wordWrap=True))
        nb = TileButton("spells", tr("dnd.new"), tr("newc.name.ph"))
        nb.clicked.connect(self.new_campaign)
        gl.addWidget(nb)
        ob = TileButton("folder", tr("dnd.open"), "*.campaign")
        ob.clicked.connect(lambda: self.open_campaign.emit(""))
        gl.addWidget(ob)
        gl.addSpacing(4)
        gl.addWidget(QLabel(tr("dnd.recent"), objectName="section"))
        self.recent = QListWidget()
        self.recent.setIconSize(QSize(22, 22))
        self.recent.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.recent.customContextMenuRequested.connect(self._recent_menu)
        self.recent.itemActivated.connect(lambda it: self.open_campaign.emit(it.data(Qt.ItemDataRole.UserRole)))
        self._fill_recent(recent)
        gl.addWidget(self.recent, 1)
        cols.addWidget(gm, 3)

        # ---- игрок
        pl = QFrame(objectName="card")
        pll = QVBoxLayout(pl)
        pll.setContentsMargins(18, 18, 18, 18)
        pll.setSpacing(12)
        pll.addWidget(icon_title("main", tr("dnd.player")))
        pll.addWidget(QLabel(tr("dnd.player.desc"), objectName="muted", wordWrap=True))
        fb = TileButton("radar", tr("join.title"), tr("join.searching").rstrip("…"))
        fb.clicked.connect(self.find_game)
        pll.addWidget(fb)
        hint = QFrame(objectName="hint")
        hl = QVBoxLayout(hint)
        hl.setContentsMargins(12, 10, 12, 10)
        hl.addWidget(icon_hint("phone", tr("join.hint")))
        pll.addWidget(hint)
        pll.addStretch(1)
        cols.addWidget(pl, 2)

        lay.addLayout(cols, 1)

    def _fill_recent(self, recent: list[str]) -> None:
        self.recent.clear()
        for path in recent:
            name = peek_name(path) or Path(path).stem
            it = QListWidgetItem(icon("d20", grad=True, size=22), f"{name}\n{path}")
            it.setData(Qt.ItemDataRole.UserRole, path)
            it.setToolTip(path)
            self.recent.addItem(it)
        if not recent:
            it = QListWidgetItem(tr("dnd.recent.empty"))
            it.setFlags(Qt.ItemFlag.NoItemFlags)
            self.recent.addItem(it)

    def _recent_menu(self, pos) -> None:
        it = self.recent.itemAt(pos)
        if not it or not it.data(Qt.ItemDataRole.UserRole):
            return
        path = it.data(Qt.ItemDataRole.UserRole)
        m = QMenu(self)
        m.addAction(icon("folder"), tr("common.open"), lambda: self.open_campaign.emit(path))
        m.addAction(icon("folder"), tr("dnd.show_folder"),
                    lambda: _show_in_folder(path))
        m.addSeparator()
        m.addAction(icon("x"), tr("dnd.forget"),
                    lambda: self.forget_recent.emit(path))
        m.exec(self.recent.viewport().mapToGlobal(pos))


def _show_in_folder(path: str) -> None:
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            subprocess.Popen(["xdg-open", str(Path(path).parent)])
    except OSError:
        pass
