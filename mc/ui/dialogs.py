"""Диалоги: новая кампания, подключение игрока с ПК, QR на весь экран, помощь с подключением."""
from __future__ import annotations

import json
import re
import sys
import webbrowser
from pathlib import Path

from PyQt6.QtCore import QSize, Qt, QTimer
from PyQt6.QtGui import QGuiApplication
from PyQt6.QtNetwork import QHostAddress, QNetworkInterface, QUdpSocket
from PyQt6.QtWidgets import (QDialog, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget,
                             QListWidgetItem, QMessageBox, QPushButton, QVBoxLayout)

from .. import paths
from ..campaign import safe_filename
from ..i18n import get_lang, tr
from ..netutil import DISCOVERY_MAGIC, DISCOVERY_PORT, player_url
from .icons import icon, set_icon
from .widgets import QrWidget


# --------------------------------------------------------------------------- новая кампания

class NewCampaignDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(tr("newc.title"))
        self.setMinimumWidth(520)
        self._path_edited = False
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.setSpacing(10)
        lay.addWidget(QLabel(tr("newc.title"), objectName="title"))
        lay.addWidget(QLabel(tr("newc.name"), objectName="muted"))
        self.name = QLineEdit(placeholderText=tr("newc.name.ph"), maxLength=32)
        self.name.textChanged.connect(self._sync_path)
        lay.addWidget(self.name)
        lay.addWidget(QLabel(tr("newc.file"), objectName="muted"))
        row = QHBoxLayout()
        self.path = QLineEdit()
        self.path.textEdited.connect(lambda: setattr(self, "_path_edited", True))
        row.addWidget(self.path, 1)
        b = QPushButton(tr("newc.browse"))
        b.clicked.connect(self._browse)
        row.addWidget(b)
        lay.addLayout(row)
        lay.addSpacing(6)
        btns = QHBoxLayout()
        btns.addStretch(1)
        c = QPushButton(tr("common.cancel"))
        c.clicked.connect(self.reject)
        ok = QPushButton(tr("common.create"), objectName="primary")
        ok.setDefault(True)
        ok.clicked.connect(self._accept)
        btns.addWidget(c)
        btns.addWidget(ok)
        lay.addLayout(btns)
        self._sync_path()

    def _sync_path(self) -> None:
        if not self._path_edited:
            fname = safe_filename(self.name.text().strip() or "campaign") + paths.CAMPAIGN_EXT
            self.path.setText(str(paths.CAMPAIGNS_DIR / fname))

    def _browse(self) -> None:
        f, _ = QFileDialog.getSaveFileName(self, tr("newc.title"), self.path.text(), tr("file.filter"))
        if f:
            if not f.lower().endswith(paths.CAMPAIGN_EXT):
                f += paths.CAMPAIGN_EXT
            self.path.setText(f)
            self._path_edited = True

    def _accept(self) -> None:
        if not self.name.text().strip():
            self.name.setFocus()
            self.name.setStyleSheet("border-color: #ff8a8a;")
            self.name.setPlaceholderText(tr("newc.empty"))
            return
        p = self.result_path()
        if p.exists():
            r = QMessageBox.question(self, tr("newc.title"), tr("newc.exists"))
            if r != QMessageBox.StandardButton.Yes:
                return
        self.accept()

    def result_name(self) -> str:
        return self.name.text().strip()

    def result_path(self) -> Path:
        t = self.path.text().strip()
        if not t.lower().endswith(paths.CAMPAIGN_EXT):
            t += paths.CAMPAIGN_EXT
        return Path(t)


# --------------------------------------------------------------------------- подключение игрока с ПК

def normalize_address(text: str, default_port: int = 8765) -> str | None:
    """'192.168.1.5' / '192.168.1.5:8765' / 'http://…/?code=X' → полный URL, или None."""
    t = text.strip()
    if not t:
        return None
    if not re.match(r"^https?://", t, re.I):
        t = "http://" + t
    m = re.match(r"^(https?)://([A-Za-z0-9.\-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?(/.*)?$", t)
    if not m:
        return None
    scheme, host, port, rest = m.group(1).lower(), m.group(2), m.group(3), m.group(4) or "/"
    port = int(port) if port else default_port
    if not (0 < port < 65536):
        return None
    return f"{scheme}://{host}:{port}{rest}"


class JoinDialog(QDialog):
    """Игрок за ПК: ищем игры мастера в локальной сети (UDP-broadcast) или вводим адрес."""

    def __init__(self, default_port: int, parent=None):
        super().__init__(parent)
        self.default_port = default_port
        self.setWindowTitle(tr("join.title"))
        self.setMinimumSize(520, 440)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.setSpacing(10)
        lay.addWidget(QLabel(tr("join.title"), objectName="title"))
        self.status = QLabel(tr("join.searching"), objectName="muted")
        lay.addWidget(self.status)
        self.list = QListWidget()
        self.list.setIconSize(QSize(22, 22))
        self.list.itemActivated.connect(lambda it: self._open(it.data(Qt.ItemDataRole.UserRole)))
        lay.addWidget(self.list, 1)
        lay.addWidget(QLabel(tr("join.manual"), objectName="muted", wordWrap=True))
        row = QHBoxLayout()
        self.addr = QLineEdit(placeholderText=f"192.168.1.10:{default_port}")
        self.addr.returnPressed.connect(self._connect_manual)
        row.addWidget(self.addr, 1)
        go = QPushButton(tr("join.connect"), objectName="primary")
        go.clicked.connect(self._connect)
        row.addWidget(go)
        lay.addLayout(row)
        hint = QFrame(objectName="hint")
        hl = QVBoxLayout(hint)
        hl.setContentsMargins(12, 8, 12, 8)
        hl.addWidget(QLabel(tr("join.hint"), wordWrap=True))
        lay.addWidget(hint)

        self._found: dict[str, str] = {}
        self.sock = QUdpSocket(self)
        self.sock.bind(QHostAddress(QHostAddress.SpecialAddress.AnyIPv4), 0)
        self.sock.readyRead.connect(self._read)
        self.timer = QTimer(self, interval=2000, timeout=self._probe)
        self.timer.start()
        self._probe()

    def _probe(self) -> None:
        targets = {QHostAddress(QHostAddress.SpecialAddress.Broadcast)}
        for iface in QNetworkInterface.allInterfaces():
            flags = iface.flags()
            if not (flags & QNetworkInterface.InterfaceFlag.IsUp) or flags & QNetworkInterface.InterfaceFlag.IsLoopBack:
                continue
            for e in iface.addressEntries():
                b = e.broadcast()
                if not b.isNull():
                    targets.add(b)
        for t in targets:
            self.sock.writeDatagram(DISCOVERY_MAGIC, t, DISCOVERY_PORT)

    def _read(self) -> None:
        while self.sock.hasPendingDatagrams():
            dg = self.sock.receiveDatagram(4096)
            try:
                info = json.loads(bytes(dg.data()).decode("utf-8"))
                if info.get("app") != paths.APP_ID:
                    continue
                ip = dg.senderAddress().toString().removeprefix("::ffff:")
                if ":" in ip:          # только IPv4
                    continue
                port = int(info.get("port", self.default_port))
            except (ValueError, TypeError, AttributeError):
                continue
            url = player_url(ip, port)
            if url in self._found:
                continue
            name = str(info.get("name", "?"))[:40]
            self._found[url] = name
            lock = f'  ·  {tr("join.locked")}' if info.get("locked") else ""
            it = QListWidgetItem(icon("d20", grad=True, size=22), f"{name}{lock}\n{ip}:{port}")
            it.setData(Qt.ItemDataRole.UserRole, url)
            self.list.addItem(it)
            if self.list.count() == 1:
                self.list.setCurrentRow(0)
            self.status.setText(tr("join.found"))

    def _connect(self) -> None:
        if self.addr.text().strip():
            self._connect_manual()
            return
        it = self.list.currentItem()
        if it and it.data(Qt.ItemDataRole.UserRole):
            self._open(it.data(Qt.ItemDataRole.UserRole))
        else:
            self.addr.setFocus()

    def _connect_manual(self) -> None:
        url = normalize_address(self.addr.text(), self.default_port)
        if not url:
            QMessageBox.warning(self, tr("join.title"), tr("join.bad_address"))
            return
        self._open(url)

    def _open(self, url: str) -> None:
        webbrowser.open(url)
        self.accept()

    def done(self, r: int) -> None:
        self.timer.stop()
        self.sock.close()
        super().done(r)


# --------------------------------------------------------------------------- QR на весь экран

class BigQrDialog(QDialog):
    def __init__(self, url: str, code: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(tr("lobby.fullscreen_qr"))
        self.setStyleSheet("QDialog { background: #17181c; }")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(40, 30, 40, 30)
        lay.setSpacing(14)
        t = QLabel(tr("lobby.scan"), objectName="title")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(t)
        qr = QrWidget()
        qr.set_data(url)
        scr = QGuiApplication.primaryScreen().availableGeometry()
        side = int(min(scr.width(), scr.height()) * 0.62)
        qr.setFixedSize(side, side)
        lay.addWidget(qr, 0, Qt.AlignmentFlag.AlignCenter)
        c = QLabel(f"{tr('lobby.code')}:  {code}", objectName="code")
        c.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(c)
        u = QLabel(url, objectName="muted")
        u.setAlignment(Qt.AlignmentFlag.AlignCenter)
        u.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        lay.addWidget(u)
        b = QPushButton(tr("common.close"))
        b.clicked.connect(self.accept)
        lay.addWidget(b, 0, Qt.AlignmentFlag.AlignCenter)

    def keyPressEvent(self, e) -> None:
        if e.key() in (Qt.Key.Key_Escape, Qt.Key.Key_Space, Qt.Key.Key_Return):
            self.accept()
        else:
            super().keyPressEvent(e)


# --------------------------------------------------------------------------- «Не подключается?»

HELP_RU = """<b>Если телефон не открывает страницу:</b>
<ol>
<li>Телефон и компьютер должны быть в <b>одной Wi-Fi сети</b> (не мобильный интернет, не гостевая сеть роутера).</li>
<li>При первом запуске Windows спрашивает про брандмауэр — нужно <b>разрешить доступ</b>.
    Если окно закрыли — нажми кнопку ниже, она добавит разрешающее правило (попросит права администратора).</li>
<li>В «Параметры → Сеть и Интернет → Wi-Fi → свойства сети» тип профиля лучше поставить <b>«Частная сеть»</b>.</li>
<li>Если в списке «Сеть» несколько адресов — попробуй другой (обычно нужен вида 192.168.x.x).</li>
<li>Некоторые роутеры изолируют устройства друг от друга («AP isolation» / «изоляция клиентов») — её нужно выключить в настройках роутера.</li>
</ol>
<b>Игра через интернет — проще всего:</b> кнопка <b>«Играть через интернет (без VPN)»</b> в лобби.
Программа откроет публичный адрес через <b>tuna.am</b> (сервера в России, работает без VPN; нужен бесплатный
токен) или <b>Cloudflare</b> (в России обычно только с VPN) и выберет его в списке «Сеть» — игрокам достаточно
ссылки или QR, ставить ничего не нужно. Вход — по коду комнаты.<br><br>
<b>Или через VPN:</b> все ставят одну VPN-сеть — <b>Radmin VPN</b>, <b>ZeroTier</b> или <b>Tailscale</b>,
потом выбери в списке «Сеть» адрес VPN (Radmin — 26.x.x.x, Tailscale — 100.x.x.x)."""

HELP_EN = """<b>If the phone can't open the page:</b>
<ol>
<li>The phone and the PC must be on the <b>same Wi-Fi network</b> (not mobile data, not the router's guest network).</li>
<li>On first launch Windows asks about the firewall — <b>allow access</b>.
    If you closed that window, press the button below: it adds an allow rule (asks for admin rights).</li>
<li>In “Settings → Network & Internet → Wi-Fi → network properties” set the profile type to <b>Private</b>.</li>
<li>If the “Network” list has several addresses, try another one (usually 192.168.x.x).</li>
<li>Some routers isolate devices from each other (“AP / client isolation”) — turn it off in the router settings.</li>
</ol>
<b>Playing online — the easy way:</b> the <b>“Play over the internet (no VPN)”</b> button in the lobby.
The app opens a public address via <b>tuna.am</b> (servers in Russia, free token needed) or <b>Cloudflare</b>
(no sign-up) and selects it in the “Network” list — players just open the link or QR. Joining needs the room code.<br><br>
<b>Or via VPN:</b> everyone joins one VPN network — <b>Radmin VPN</b>, <b>ZeroTier</b> or <b>Tailscale</b>,
then pick the VPN address in the “Network” list (Radmin — 26.x.x.x, Tailscale — 100.x.x.x)."""


class HelpDialog(QDialog):
    def __init__(self, port: int, parent=None):
        super().__init__(parent)
        ru = get_lang() == "ru"
        self.port = port
        self.setWindowTitle(tr("lobby.help"))
        self.setMinimumWidth(600)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.setSpacing(12)
        txt = QLabel(HELP_RU if ru else HELP_EN, wordWrap=True)
        txt.setTextFormat(Qt.TextFormat.RichText)
        lay.addWidget(txt)
        row = QHBoxLayout()
        if sys.platform == "win32":
            fw = QPushButton("Разрешить в брандмауэре Windows" if ru else "Allow in Windows Firewall")
            set_icon(fw, "main")
            fw.clicked.connect(self._firewall)
            row.addWidget(fw)
        row.addStretch(1)
        ok = QPushButton(tr("common.close"), objectName="primary")
        ok.clicked.connect(self.accept)
        row.addWidget(ok)
        lay.addLayout(row)

    def _firewall(self) -> None:
        """Добавить правила брандмауэра для порта игры и автопоиска (через UAC)."""
        import ctypes
        name = "Masters Compendium"
        cmd = (f'netsh advfirewall firewall delete rule name="{name}" >nul 2>&1 & '
               f'netsh advfirewall firewall add rule name="{name}" dir=in action=allow protocol=TCP localport={self.port} & '
               f'netsh advfirewall firewall add rule name="{name}" dir=in action=allow protocol=UDP localport={DISCOVERY_PORT}')
        try:
            from ctypes import wintypes
            fn = ctypes.windll.shell32.ShellExecuteW
            fn.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
                           wintypes.LPCWSTR, ctypes.c_int]
            fn.restype = ctypes.c_void_p
            rc = fn(None, "runas", "cmd.exe", f"/c {cmd}", None, 0) or 0
        except (AttributeError, OSError):
            rc = 0
        ru = get_lang() == "ru"
        if rc > 32:
            QMessageBox.information(self, self.windowTitle(),
                                    "Готово. Попробуй подключиться ещё раз." if ru else "Done. Try connecting again.")
        else:
            QMessageBox.warning(self, self.windowTitle(),
                                "Не получилось (возможно, запрос прав администратора был отклонён)." if ru
                                else "Didn't work (the admin prompt may have been declined).")


class TunnelDialog(QDialog):
    """Как играть через интернет: tuna.am (работает в России без VPN, нужен токен) или Cloudflare."""

    def __init__(self, provider: str, token: str, parent=None, subdomain: str = ""):
        super().__init__(parent)
        from PyQt6.QtWidgets import QButtonGroup, QRadioButton
        self.setWindowTitle(tr("tun.title"))
        self.setMinimumWidth(620)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 18, 22, 16)
        lay.setSpacing(10)
        intro = QLabel(tr("tun.intro"), wordWrap=True)
        lay.addWidget(intro)
        self.group = QButtonGroup(self)
        self.r_tuna = QRadioButton(tr("tun.tuna"))
        self.r_cf = QRadioButton(tr("tun.cf"))
        for b in (self.r_tuna, self.r_cf):
            self.group.addButton(b)
        lay.addWidget(self.r_tuna)
        t1 = QLabel(tr("tun.tuna.d"), objectName="muted", wordWrap=True)
        t1.setTextFormat(Qt.TextFormat.RichText)
        t1.setOpenExternalLinks(True)
        t1.setContentsMargins(26, 0, 0, 0)
        lay.addWidget(t1)
        row = QHBoxLayout()
        row.setContentsMargins(26, 0, 0, 0)
        self.token = QLineEdit(token)
        self.token.setPlaceholderText(tr("tun.token.ph"))
        self.token.setEchoMode(QLineEdit.EchoMode.PasswordEchoOnEdit)
        row.addWidget(self.token, 1)
        get = QPushButton(tr("tun.token.get"))
        set_icon(get, "user-plus")
        get.clicked.connect(lambda: webbrowser.open("https://my.tuna.am/"))
        row.addWidget(get)
        lay.addLayout(row)
        # постоянный адрес: без него ссылка меняется при каждом запуске и игрокам приходится входить заново
        row2 = QHBoxLayout()
        row2.setContentsMargins(26, 0, 0, 0)
        row2.addWidget(QLabel(tr("tun.sub")))
        self.sub = QLineEdit(subdomain)
        self.sub.setPlaceholderText(tr("tun.sub.ph"))
        row2.addWidget(self.sub, 1)
        lay.addLayout(row2)
        t3 = QLabel(tr("tun.sub.d"), objectName="muted", wordWrap=True)
        t3.setTextFormat(Qt.TextFormat.RichText)
        t3.setOpenExternalLinks(True)
        t3.setContentsMargins(26, 0, 0, 0)
        lay.addWidget(t3)
        lay.addSpacing(6)
        lay.addWidget(self.r_cf)
        t2 = QLabel(tr("tun.cf.d"), objectName="muted", wordWrap=True)
        t2.setContentsMargins(26, 0, 0, 0)
        lay.addWidget(t2)
        (self.r_cf if provider == "cloudflare" else self.r_tuna).setChecked(True)
        self.r_tuna.toggled.connect(lambda on: (self.token.setEnabled(on), self.sub.setEnabled(on)))
        self.token.setEnabled(self.r_tuna.isChecked())
        self.sub.setEnabled(self.r_tuna.isChecked())
        btns = QHBoxLayout()
        btns.addStretch(1)
        cancel = QPushButton(tr("common.cancel"))
        cancel.clicked.connect(self.reject)
        ok = QPushButton(tr("tun.start"), objectName="primary")
        set_icon(ok, "network", "#ffffff")
        ok.clicked.connect(self._ok)
        btns.addWidget(cancel)
        btns.addWidget(ok)
        lay.addLayout(btns)

    def _ok(self) -> None:
        if self.r_tuna.isChecked() and not self.token.text().strip():
            self.token.setFocus()
            self.token.setStyleSheet("border: 1px solid #ff8a8a;")
            return
        self.accept()

    def result_value(self) -> tuple[str, str, str]:
        from ..tunnel import clean_subdomain
        return ("tuna" if self.r_tuna.isChecked() else "cloudflare"), self.token.text().strip(), clean_subdomain(self.sub.text())
