"""Лобби мастера: список игроков + QR-код и код комнаты для подключения."""
from __future__ import annotations

from PyQt6.QtCore import QSize, Qt, pyqtSignal
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtWidgets import (QCheckBox, QComboBox, QFileDialog, QFrame, QHBoxLayout, QInputDialog, QLabel,
                             QListWidget, QListWidgetItem, QMessageBox, QPushButton, QVBoxLayout, QWidget)

from .. import paths
from ..campaign import safe_filename
from ..i18n import get_lang, tr
from ..netutil import player_url
from .browser import open_app_window
from .dialogs import BigQrDialog, HelpDialog, TunnelDialog
from .session import Session, local_addresses
from .style import show_error
from .icons import set_icon
from .widgets import EmptyState, QrWidget, avatar_pixmap, icon_title, portrait_pixmap


class PlayerRow(QWidget):
    kick = pyqtSignal(str)

    def __init__(self, p: dict, parent=None):
        super().__init__(parent)
        self.pid = p["id"]
        lay = QHBoxLayout(self)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(12)
        av = QLabel()
        av.setPixmap(avatar_pixmap(p["name"], p["color"], 38, p.get("online", False)))
        lay.addWidget(av)
        box = QVBoxLayout()
        box.setSpacing(0)
        nm = QLabel(p["name"])
        nm.setStyleSheet(f"font-size: 11pt; font-weight: 600; color: {'#ffffff' if p.get('online') else '#8b91a0'};")
        box.addWidget(nm)
        st = QLabel(("●  " + tr("lobby.online")) if p.get("online") else ("○  " + tr("lobby.offline")))
        st.setStyleSheet(f"color: {'#34d399' if p.get('online') else '#5d6270'}; font-size: 9pt;")
        box.addWidget(st)
        lay.addLayout(box, 1)
        k = QPushButton(objectName="tool")
        set_icon(k, "x")
        k.setToolTip(tr("lobby.remove"))
        k.setCursor(Qt.CursorShape.PointingHandCursor)
        k.clicked.connect(lambda: self.kick.emit(self.pid))
        lay.addWidget(k)


_CLASS_NAMES: dict[str, dict] | None = None


def class_name(cid: str, fallback: str) -> str:
    """Название класса из справочника SRD (для списка персонажей)."""
    global _CLASS_NAMES
    if _CLASS_NAMES is None:
        _CLASS_NAMES = {}
        try:
            import json
            d = json.loads((paths.WEB_DIR / "data" / "srd2014.json").read_text(encoding="utf-8"))
            _CLASS_NAMES = {c["id"]: {"ru": c["ru"], "en": c["en"]} for c in d.get("classes", [])}
        except (OSError, ValueError, KeyError):
            paths.log_exc("class names")
    n = _CLASS_NAMES.get(cid)
    return (n or {}).get(get_lang()) or fallback or cid or "?"


class CharRow(QWidget):
    export = pyqtSignal(str)
    delete = pyqtSignal(str)
    open = pyqtSignal(str)

    def __init__(self, c: dict, owner: dict | None, parent=None):
        super().__init__(parent)
        self.cid = c["id"]
        lay = QHBoxLayout(self)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(12)
        av = QLabel()
        pm = portrait_pixmap(c.get("portrait", ""), 42)
        av.setPixmap(pm if pm is not None else avatar_pixmap(c.get("name", "?"), (owner or {}).get("color", "#5d6270"), 42))
        lay.addWidget(av)
        box = QVBoxLayout()
        box.setSpacing(0)
        nm = QLabel(c.get("name", "?"))
        nm.setTextFormat(Qt.TextFormat.PlainText)
        nm.setStyleSheet("font-size: 11pt; font-weight: 600; color: #ffffff;")
        box.addWidget(nm)
        cls = " / ".join(f'{class_name(k.get("id", ""), k.get("name", ""))} {k.get("level", 1)}' for k in c.get("classes", []))
        who = owner["name"] if owner else tr("lobby.chars.npc")
        hp = c.get("hp") or {}
        sub = QLabel(f'{cls or "—"}  ·  {who}  ·  {tr("lobby.hp")} {hp.get("cur", 0)}/{hp.get("max", 0)}')
        sub.setTextFormat(Qt.TextFormat.PlainText)
        sub.setStyleSheet("color: #8b91a0; font-size: 9pt;")
        box.addWidget(sub)
        lay.addLayout(box, 1)
        for icon_name, sig, tip in (("wand", self.open, "lobby.gm_window"), ("save", self.export, "lobby.chars.export"),
                                    ("x", self.delete, "lobby.remove")):
            b = QPushButton(objectName="tool")
            set_icon(b, icon_name)
            b.setToolTip(tr(tip))
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(lambda _=False, s=sig: s.emit(self.cid))
            lay.addWidget(b)


class LobbyPage(QWidget):
    end_session = pyqtSignal()
    toast = pyqtSignal(str)

    def __init__(self, session: Session, preferred_ip: str = "", settings=None, parent=None):
        super().__init__(parent)
        self.s = session
        self.settings = settings
        c = session.campaign

        lay = QVBoxLayout(self)
        lay.setContentsMargins(30, 6, 30, 24)
        lay.setSpacing(14)

        # ---- шапка
        head = QHBoxLayout()
        head.addWidget(icon_title("d20", c.name, "title", 26))
        self.badge = QLabel("D&D 5e · 2014", objectName="badge")
        head.addWidget(self.badge)
        head.addStretch(1)
        self.status = QLabel(tr("lobby.status.running", port=session.port), objectName="muted")
        head.addWidget(self.status)
        head.addSpacing(10)
        gmw = QPushButton(tr("lobby.gm_window"), objectName="primary")
        set_icon(gmw, "wand", "#ffffff")
        gmw.setToolTip(tr("lobby.gm_window.tip"))
        gmw.clicked.connect(self._gm_window)
        head.addWidget(gmw)
        end = QPushButton(tr("lobby.end"), objectName="danger")
        set_icon(end, "power", "#ff9aa2")
        end.clicked.connect(self._end)
        head.addWidget(end)
        lay.addLayout(head)

        cols = QHBoxLayout()
        cols.setSpacing(18)

        # ---- игроки
        left_col = QVBoxLayout()
        left_col.setSpacing(14)
        left = QFrame(objectName="card")
        ll = QVBoxLayout(left)
        ll.setContentsMargins(16, 16, 16, 16)
        ll.setSpacing(8)
        pt = icon_title("players", "")
        self.players_title = pt.label
        ll.addWidget(pt)
        self.list = QListWidget()
        self.list.setStyleSheet("QListWidget { background: transparent; border: none; }"
                                "QListWidget::item { padding: 0; } QListWidget::item:selected { background: #23252d; }")
        self.list.setSelectionMode(QListWidget.SelectionMode.NoSelection)
        ll.addWidget(self.list, 1)
        self.empty = EmptyState("phone", tr("lobby.players.empty"))
        ll.addWidget(self.empty, 1)
        left_col.addWidget(left, 2)

        # ---- персонажи
        chars = QFrame(objectName="card")
        cl_ = QVBoxLayout(chars)
        cl_.setContentsMargins(16, 16, 16, 16)
        cl_.setSpacing(8)
        ctt = icon_title("character", "")
        self.chars_title = ctt.label
        cl_.addWidget(ctt)
        self.clist = QListWidget()
        self.clist.setStyleSheet(self.list.styleSheet())
        self.clist.setSelectionMode(QListWidget.SelectionMode.NoSelection)
        cl_.addWidget(self.clist, 1)
        self.cempty = EmptyState("scroll", tr("lobby.chars.empty"))
        cl_.addWidget(self.cempty, 1)
        crow = QHBoxLayout()
        imp = QPushButton(tr("lobby.chars.import"))
        set_icon(imp, "upload")
        imp.clicked.connect(self._import_char)
        crow.addWidget(imp)
        crow.addStretch(1)
        cl_.addLayout(crow)
        left_col.addWidget(chars, 3)
        cols.addLayout(left_col, 3)

        # ---- подключение
        right = QFrame(objectName="card")
        rl = QVBoxLayout(right)
        rl.setContentsMargins(18, 16, 18, 16)
        rl.setSpacing(10)
        scan = QLabel(tr("lobby.scan"), objectName="section")
        scan.setAlignment(Qt.AlignmentFlag.AlignCenter)
        rl.addWidget(scan)
        self.qr = QrWidget()
        self.qr.setFixedSize(230, 230)
        self.qr.setCursor(Qt.CursorShape.PointingHandCursor)
        self.qr.setToolTip(tr("lobby.fullscreen_qr"))
        self.qr.mouseReleaseEvent = lambda e: self._big_qr()
        rl.addWidget(self.qr, 0, Qt.AlignmentFlag.AlignCenter)

        code_row = QHBoxLayout()
        code_row.addStretch(1)
        cl = QLabel(tr("lobby.code") + ":", objectName="muted")
        code_row.addWidget(cl)
        self.code = QLabel(c.room_code, objectName="code")
        self.code.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        code_row.addWidget(self.code)
        nc = QPushButton(objectName="tool")
        set_icon(nc, "refresh")
        nc.setToolTip(tr("lobby.new_code"))
        nc.clicked.connect(self._new_code)
        code_row.addWidget(nc)
        code_row.addStretch(1)
        rl.addLayout(code_row)

        rl.addWidget(QLabel(tr("lobby.network"), objectName="muted"))
        self.addr = QComboBox()
        self.addr.setToolTip(tr("lobby.network.hint"))
        self.addr.currentIndexChanged.connect(self._refresh_url)
        rl.addWidget(self.addr)
        url_row = QHBoxLayout()
        self.url = QLabel(objectName="muted")
        self.url.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        url_row.addWidget(self.url, 1)
        cp = QPushButton(objectName="tool")
        set_icon(cp, "copy")
        cp.setToolTip(tr("common.copy"))
        cp.clicked.connect(self._copy_url)
        url_row.addWidget(cp)
        rl.addLayout(url_row)

        # ---- интернет без VPN
        self.net_btn = QPushButton(tr("lobby.inet"))
        set_icon(self.net_btn, "network")
        self.net_btn.setToolTip(tr("lobby.inet.tip"))
        self.net_btn.clicked.connect(self._toggle_tunnel)
        net_row = QHBoxLayout()
        net_row.addWidget(self.net_btn, 1)
        gear = QPushButton(objectName="tool")
        set_icon(gear, "settings")
        gear.setToolTip(tr("tun.title"))
        gear.clicked.connect(lambda: self._tunnel_setup(start=False))
        net_row.addWidget(gear)
        rl.addLayout(net_row)
        self.net_info = QLabel(objectName="muted")
        self.net_info.setWordWrap(True)
        self.net_info.hide()
        rl.addWidget(self.net_info)

        self.lock = QCheckBox(tr("lobby.lock"))
        self.lock.setChecked(c.locked)
        self.lock.toggled.connect(self.s.set_locked)
        rl.addWidget(self.lock)

        btns = QHBoxLayout()
        big = QPushButton(tr("lobby.fullscreen_qr"))
        set_icon(big, "maximize")
        big.clicked.connect(self._big_qr)
        btns.addWidget(big)
        hb = QPushButton(tr("lobby.help"))
        set_icon(hb, "help")
        hb.clicked.connect(lambda: HelpDialog(self.s.port, self).exec())
        btns.addWidget(hb)
        rl.addLayout(btns)
        rl.addStretch(1)
        cols.addWidget(right, 2)

        lay.addLayout(cols, 1)

        self._fill_addresses(preferred_ip)
        t = session.tunnel
        if t is not None:
            t.state_changed.connect(self._tunnel_state)
            t.progress.connect(lambda p: self._tunnel_state("downloading", p))
            t.url_ready.connect(lambda u: self._fill_addresses(self.selected_ip(), select=u))
            t.failed.connect(self._tunnel_failed)
            self._tunnel_state(t.state)
            if t.url:
                self._fill_addresses(preferred_ip, select=t.url)
        self._render_players(session.players)
        self._render_chars(session.chars)
        session.players_changed.connect(self._render_players)
        session.players_changed.connect(lambda _: self._render_chars(self.s.chars))
        session.chars_changed.connect(self._render_chars)
        session.player_joined.connect(lambda p: self.toast.emit(tr("lobby.joined", name=p.get("name", "?"))))
        session.player_left.connect(lambda p: self.toast.emit(tr("lobby.left", name=p.get("name", "?"))))

    # ------------------------------------------------------------------ адреса / QR
    def _fill_addresses(self, preferred: str, select: str = "") -> None:
        self.addr.blockSignals(True)
        self.addr.clear()
        t = self.s.tunnel
        if t is not None and t.url:
            self.addr.addItem(f"{t.url.replace('https://', '')}   —   {tr('lobby.inet.item')}", t.url)
        for a in local_addresses(preferred):
            tag = "  · VPN" if a.is_vpn else ""
            self.addr.addItem(f"{a.ip}   —   {a.label}{tag}", a.ip)
        if self.addr.count() == 0:
            self.addr.addItem("127.0.0.1", "127.0.0.1")
        self.addr.blockSignals(False)
        if select:
            i = self.addr.findData(select)
            if i >= 0:
                self.addr.setCurrentIndex(i)
        self._refresh_url()

    def selected_ip(self) -> str:
        return self.addr.currentData() or "127.0.0.1"

    def current_url(self, with_code: bool = True) -> str:
        sel = self.selected_ip()
        code = self.s.campaign.room_code if with_code else ""
        if sel.startswith("https://"):            # туннель: порт не нужен
            return f"{sel}/?code={code}" if code else sel + "/"
        return player_url(sel, self.s.port, code)

    # ------------------------------------------------------------------ интернет без VPN
    def _toggle_tunnel(self) -> None:
        t = self.s.tunnel
        if t is None:
            return
        if t.state != "off":
            t.stop()
            self._fill_addresses("")
            return
        st = self.settings
        if st is None or not st.tunnel_provider:
            self._tunnel_setup(start=True)
            return
        self._tunnel_go(st.tunnel_provider, st.tuna_token, st.tuna_subdomain)

    def _tunnel_setup(self, start: bool = True) -> None:
        st = self.settings
        d = TunnelDialog(st.tunnel_provider if st else "", st.tuna_token if st else "", self,
                         subdomain=st.tuna_subdomain if st else "")
        if d.exec() != d.DialogCode.Accepted:
            return
        provider, token, subd = d.result_value()
        if st is not None:
            st.tunnel_provider = provider
            if token:
                st.tuna_token = token
            st.tuna_subdomain = subd
            st.save()
        t = self.s.tunnel
        if t is not None and t.state != "off":
            t.stop()
            self._fill_addresses("")
        self._tunnel_go(provider, token or (st.tuna_token if st else ""), subd)

    def _tunnel_go(self, provider: str, token: str, subdomain: str = "") -> None:
        from .. import tunnel as tn
        t = self.s.tunnel
        if t is None:
            return
        if tn.find_exe(provider) is None:
            r = QMessageBox.question(self, tr("lobby.inet"), tr("lobby.inet.download." + provider))
            if r != QMessageBox.StandardButton.Yes:
                return
        t.start(provider, token, subdomain)

    def _tunnel_state(self, st: str, pct: int = -1) -> None:
        if st == "downloading":
            self.net_btn.setText(tr("lobby.inet.downloading", p=max(0, pct)))
            self.net_btn.setEnabled(True)
        elif st == "starting":
            self.net_btn.setText(tr("lobby.inet.starting"))
        elif st == "on":
            self.net_btn.setText(tr("lobby.inet.stop"))
            self.net_info.setText(tr("lobby.inet.on"))
            self.net_info.show()
        else:
            self.net_btn.setText(tr("lobby.inet"))
            self.net_info.hide()

    def _tunnel_failed(self, code: str) -> None:
        self._fill_addresses("")
        QMessageBox.warning(self, tr("lobby.inet"), tr("lobby." + code))
        if code in ("tunnel_no_token", "tunnel_bad_token", "tunnel_bad_sub") or code.endswith("_cf"):
            self._tunnel_setup(start=True)

    def _refresh_url(self) -> None:
        url = self.current_url()
        self.qr.set_data(url)
        self.url.setText(self.current_url(with_code=False))
        self.code.setText(self.s.campaign.room_code)

    def _copy_url(self) -> None:
        QGuiApplication.clipboard().setText(self.current_url())
        self.toast.emit(tr("common.copied"))

    def _new_code(self) -> None:
        self.s.new_code()
        self._refresh_url()

    def _big_qr(self) -> None:
        d = BigQrDialog(self.current_url(), self.s.campaign.room_code, self)
        d.showMaximized()
        d.exec()

    # ------------------------------------------------------------------ игроки
    def _render_players(self, players: list) -> None:
        self.list.clear()
        online = sum(1 for p in players if p.get("online"))
        self.players_title.setText(f"{tr('lobby.players')}  ·  {online}/{len(players)}")
        for p in sorted(players, key=lambda x: (not x.get("online"), x.get("name", "").casefold())):
            row = PlayerRow(p)
            row.kick.connect(self._kick)
            it = QListWidgetItem()
            it.setSizeHint(QSize(10, 58))
            self.list.addItem(it)
            self.list.setItemWidget(it, row)
        self.list.setVisible(bool(players))
        self.empty.setVisible(not players)

    def _kick(self, pid: str) -> None:
        p = next((x for x in self.s.players if x["id"] == pid), None)
        name = p["name"] if p else "?"
        r = QMessageBox.question(self, tr("lobby.remove"), tr("lobby.kick.confirm", name=name))
        if r == QMessageBox.StandardButton.Yes:
            self.s.kick(pid)

    # ------------------------------------------------------------------ персонажи
    def _render_chars(self, chars: list) -> None:
        self.clist.clear()
        names = {p["id"]: p for p in self.s.players}
        self.chars_title.setText(f"{tr('lobby.chars')}  ·  {len(chars)}")
        for c in sorted(chars, key=lambda x: (x.get("owner") is None, x.get("name", "").casefold())):
            row = CharRow(c, names.get(c.get("owner") or ""))
            row.export.connect(self._export_char)
            row.delete.connect(self._delete_char)
            row.open.connect(lambda _cid: self._gm_window())
            it = QListWidgetItem()
            it.setSizeHint(QSize(10, 62))
            self.clist.addItem(it)
            self.clist.setItemWidget(it, row)
        self.clist.setVisible(bool(chars))
        self.cempty.setVisible(not chars)

    def _gm_window(self) -> None:
        url = self.s.gm_url()
        if url:
            open_app_window(url)

    def _export_char(self, cid: str) -> None:
        c = next((x for x in self.s.chars if x.get("id") == cid), None)
        if not c:
            return
        default = str(paths.CHARACTERS_DIR / (safe_filename(c.get("name", "character")) + paths.CHARACTER_EXT))
        f, _ = QFileDialog.getSaveFileName(self, tr("lobby.chars.export"), default, tr("file.char_filter"))
        if not f:
            return
        if not f.lower().endswith(paths.CHARACTER_EXT):
            f += paths.CHARACTER_EXT
        try:
            self.s.export_character(cid, f)
            self.toast.emit(tr("lobby.saved"))
        except Exception as e:  # noqa: BLE001
            show_error(self, tr("file.save_failed"), f"{f}\n\n{e}")

    def _import_char(self) -> None:
        f, _ = QFileDialog.getOpenFileName(self, tr("lobby.chars.import"), str(paths.CHARACTERS_DIR), tr("file.char_filter"))
        if not f:
            return
        names = [tr("lobby.chars.npc")] + [p["name"] for p in self.s.players]
        ids = [None] + [p["id"] for p in self.s.players]
        choice, ok = QInputDialog.getItem(self, tr("lobby.chars.import"), tr("lobby.chars.owner"), names, 0, False)
        if not ok:
            return
        try:
            self.s.import_character(f, ids[names.index(choice)])
        except Exception as e:  # noqa: BLE001
            show_error(self, tr("file.open_failed"), f"{f}\n\n{e}")

    def _delete_char(self, cid: str) -> None:
        c = next((x for x in self.s.chars if x.get("id") == cid), None)
        if not c:
            return
        r = QMessageBox.question(self, tr("lobby.remove"), tr("lobby.chars.delete", name=c.get("name", "?")))
        if r == QMessageBox.StandardButton.Yes:
            self.s.delete_character(cid)

    def _end(self) -> None:
        r = QMessageBox.question(self, tr("lobby.end"), tr("lobby.end.confirm"))
        if r == QMessageBox.StandardButton.Yes:
            self.end_session.emit()

