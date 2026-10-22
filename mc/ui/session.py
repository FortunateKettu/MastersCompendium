"""Сессия мастера: кампания + запущенный сервер + автосохранение. Мост между потоком сервера и GUI."""
from __future__ import annotations

from PyQt6.QtCore import QObject, QTimer, pyqtSignal
from PyQt6.QtNetwork import QNetworkInterface

from .. import paths
from .. import characters as ch
from ..campaign import Campaign
from ..netutil import LocalAddress, classify, find_free_port, is_skipped, sort_addresses
from ..server import GameServer
from ..tunnel import Tunnel

AUTOSAVE_MS = 15_000


class Session(QObject):
    # события сервера приходят из его потока — сигналы Qt сами передадут их в GUI-поток
    server_event = pyqtSignal(str, dict)
    players_changed = pyqtSignal(list)
    chars_changed = pyqtSignal(list)
    player_joined = pyqtSignal(dict)
    player_left = pyqtSignal(dict)
    saved = pyqtSignal()
    save_failed = pyqtSignal(str)

    def __init__(self, campaign: Campaign, parent=None):
        super().__init__(parent)
        self.campaign = campaign
        self.server: GameServer | None = None
        self.tunnel: Tunnel | None = None
        self.port = 0
        self.players: list[dict] = [{**p.public(), "online": False} for p in campaign.players]
        with campaign.lock:
            self.chars: list[dict] = [ch.summary(d) for d in ch.chars(campaign) if isinstance(d, dict)]
        self.server_event.connect(self._on_server_event)
        self._autosave = QTimer(self, interval=AUTOSAVE_MS, timeout=self.save_if_dirty)

    # ------------------------------------------------------------------ жизненный цикл
    def start(self, preferred_port: int) -> None:
        self.port = find_free_port(preferred_port)
        self.server = GameServer(self.campaign, self.port, on_event=self.server_event.emit)
        self.server.start()
        self._autosave.start()
        self.tunnel = Tunnel(self.port, self)

    def stop(self) -> None:
        self._autosave.stop()
        if self.tunnel:
            self.tunnel.stop()
        if self.server:
            self.server.stop()
            self.server = None
        self.save_if_dirty(force=True)

    @property
    def running(self) -> bool:
        return self.server is not None

    # ------------------------------------------------------------------ сохранение
    def save_if_dirty(self, force: bool = False) -> bool:
        if not (self.campaign.dirty or force) or self.campaign.path is None:
            return True
        try:
            self.campaign.save()
        except OSError as e:
            paths.log_exc("autosave")
            self.save_failed.emit(str(e))
            return False
        self.saved.emit()
        return True

    # ------------------------------------------------------------------ действия мастера
    def kick(self, player_id: str) -> None:
        if self.server:
            self.server.kick(player_id)
        else:
            self.campaign.remove_player(player_id)

    def new_code(self) -> str:
        code = self.campaign.set_room_code()
        self.save_if_dirty()
        return code

    def gm_url(self) -> str:
        from ..i18n import get_lang
        return self.server.gm_url(lang=get_lang()) if self.server else ""

    def export_character(self, cid: str, path: str) -> None:
        import copy
        with self.campaign.lock:
            d = ch.find(self.campaign, cid)
            if d is None:
                raise ch.CharError("no_char")
            d = copy.deepcopy(d)
        ch.export_file(d, path)

    def import_character(self, path: str, owner: str | None) -> None:
        doc = ch.read_file(path)
        if self.server:
            self.server.import_character(doc, owner)
        else:
            ch.create(self.campaign, doc, owner)

    def delete_character(self, cid: str) -> None:
        if self.server:
            self.server.delete_character(cid)

    def assign_character(self, cid: str, owner: str | None) -> None:
        if self.server:
            self.server.assign_character(cid, owner)

    def set_locked(self, locked: bool) -> None:
        with self.campaign.lock:
            self.campaign.locked = locked
            self.campaign.touch()

    # ------------------------------------------------------------------ события сервера
    def _on_server_event(self, kind: str, data: dict) -> None:
        if kind == "players":
            self.players = list(data.get("players", []))
            self.players_changed.emit(self.players)
        elif kind == "chars":
            self.chars = list(data.get("chars", []))
            self.chars_changed.emit(self.chars)
        elif kind == "char_summary":
            c = data.get("char") or {}
            self.chars = [c if x.get("id") == c.get("id") else x for x in self.chars]
            self.chars_changed.emit(self.chars)
        elif kind == "joined":
            self.player_joined.emit(data)
        elif kind in ("left", "kicked"):
            self.player_left.emit(data)


def local_addresses(preferred: str = "") -> list[LocalAddress]:
    """IPv4-адреса компьютера с именами адаптеров (Wi-Fi, Ethernet, Radmin VPN …)."""
    found: list[LocalAddress] = []
    skipped: list[LocalAddress] = []
    F = QNetworkInterface.InterfaceFlag
    for iface in QNetworkInterface.allInterfaces():
        flags = iface.flags()
        if not (flags & F.IsUp and flags & F.IsRunning) or flags & F.IsLoopBack:
            continue
        label = iface.humanReadableName() or iface.name()
        for e in iface.addressEntries():
            ip = e.ip().toString()
            if ":" in ip or ip.startswith("169.254.") or ip.startswith("127."):
                continue
            a = LocalAddress(ip, label, classify(ip, label))
            (skipped if is_skipped(label) else found).append(a)
    return sort_addresses(found or skipped, preferred)
