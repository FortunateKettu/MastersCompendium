"""Главное окно: общая шапка (логотип, язык) + страницы со сменой через плавное проявление."""
from __future__ import annotations

from PyQt6.QtCore import QByteArray, Qt
from PyQt6.QtWidgets import (QButtonGroup, QFileDialog, QHBoxLayout, QLabel, QMainWindow, QMessageBox, QPushButton,
                             QVBoxLayout, QWidget)

from .. import paths
from ..campaign import Campaign, CampaignError
from ..i18n import set_lang, tr
from ..settings import Settings
from .dialogs import JoinDialog, NewCampaignDialog
from .lobby import LobbyPage
from .pages import DndMenuPage, StartPage
from .session import Session
from .style import app_icon, make_logo, show_error
from .widgets import FadeStack, Toast


class MainWindow(QMainWindow):
    def __init__(self, settings: Settings):
        super().__init__()
        self.settings = settings
        self.session: Session | None = None
        self.lobby: LobbyPage | None = None
        self._page = "start"

        self.setWindowTitle(paths.APP_NAME)
        self.setWindowIcon(app_icon())
        self.setMinimumSize(980, 640)
        self.resize(1180, 760)
        if settings.window_geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(settings.window_geometry.encode()))
            except (ValueError, TypeError):
                pass

        root = QWidget(objectName="root")
        self.setCentralWidget(root)
        lay = QVBoxLayout(root)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(self._build_header())
        self.stack = FadeStack()
        lay.addWidget(self.stack, 1)
        self.toast = Toast(root)

        self.show_page("start", animate=False)

    # ------------------------------------------------------------------ шапка
    def _build_header(self) -> QWidget:
        w = QWidget()
        w.setFixedHeight(76)
        h = QHBoxLayout(w)
        h.setContentsMargins(30, 14, 30, 6)
        logo = QLabel()
        logo.setPixmap(make_logo(44))
        h.addWidget(logo)
        h.addSpacing(8)
        txt = QVBoxLayout()
        txt.setSpacing(0)
        self.h_title = QLabel(paths.APP_NAME)
        self.h_title.setStyleSheet("font-size: 15pt; font-weight: 700; color: #ffffff;")
        txt.addWidget(self.h_title)
        self.h_sub = QLabel(objectName="muted")
        txt.addWidget(self.h_sub)
        h.addLayout(txt)
        h.addStretch(1)
        self.h_lang = QLabel(objectName="muted")
        h.addWidget(self.h_lang)
        self.lang_group = QButtonGroup(self)
        for code in ("ru", "en"):
            b = QPushButton(code.upper(), objectName="seg", checkable=True)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setChecked(code == self.settings.lang)
            b.clicked.connect(lambda _=False, c=code: self.set_language(c))
            self.lang_group.addButton(b)
            h.addWidget(b)
        self._retranslate_header()
        return w

    def _retranslate_header(self) -> None:
        self.h_sub.setText(f"{tr('app.subtitle')}  ·  v{paths.APP_VERSION}")
        self.h_lang.setText(tr("lang.label") + ":")

    def set_language(self, lang: str) -> None:
        if lang == self.settings.lang:
            return
        self.settings.lang = lang
        set_lang(lang)
        for b in self.lang_group.buttons():
            b.setChecked(b.text().lower() == lang)
        self.settings.save()
        self._retranslate_header()
        # страницы проще пересобрать — так все надписи гарантированно обновятся
        if self._page == "lobby" and self.session:
            self._open_lobby(animate=False)
        else:
            self.show_page(self._page, animate=False)

    # ------------------------------------------------------------------ страницы
    def show_page(self, name: str, animate: bool = True) -> None:
        old = self.stack.currentWidget()
        if name == "start":
            w = StartPage()
            w.dnd_chosen.connect(lambda: self.show_page("dnd"))
            w.cyberpunk_chosen.connect(lambda: self.toast.show_text(tr("start.cp.toast")))
        elif name == "dnd":
            w = DndMenuPage(self.settings.existing_recent())
            w.back.connect(lambda: self.show_page("start"))
            w.new_campaign.connect(self.new_campaign)
            w.open_campaign.connect(self.open_campaign)
            w.find_game.connect(self.find_game)
            w.forget_recent.connect(self._forget_recent)
        else:
            return
        self._page = name
        self._swap(w, old, animate)

    def _swap(self, w: QWidget, old: QWidget | None, animate: bool) -> None:
        if animate:
            self.stack.fade_to(w)
        else:
            self.stack.addWidget(w)
            self.stack.setCurrentWidget(w)
        if old is not None and old is not w:
            self.stack.removeWidget(old)
            old.deleteLater()

    # ------------------------------------------------------------------ кампании
    def new_campaign(self) -> None:
        d = NewCampaignDialog(self)
        if not d.exec():
            return
        c = Campaign(d.result_name())
        try:
            c.save(d.result_path())
        except OSError as e:
            show_error(self, tr("file.save_failed"), f"{d.result_path()}\n\n{e}")
            return
        self._start_session(c)

    def open_campaign(self, path: str) -> None:
        if not path:
            path, _ = QFileDialog.getOpenFileName(self, tr("dnd.open"), str(paths.CAMPAIGNS_DIR), tr("file.filter"))
            if not path:
                return
        try:
            c = Campaign.load(path)
        except (CampaignError, OSError) as e:
            show_error(self, tr("file.open_failed"), f"{path}\n\n{e}")
            return
        self._start_session(c)

    def _forget_recent(self, path: str) -> None:
        self.settings.recent = [p for p in self.settings.recent if p != path]
        self.settings.save()
        self.show_page("dnd", animate=False)

    def find_game(self) -> None:
        JoinDialog(self.settings.port, self).exec()

    # ------------------------------------------------------------------ сессия
    def _start_session(self, c: Campaign) -> None:
        if self.session:
            self.end_session()
        s = Session(c, self)
        try:
            s.start(self.settings.port)
        except Exception as e:  # noqa: BLE001
            details = paths.log_exc("start session")
            show_error(self, f"{tr('lobby.server_failed')}: {e}", details)
            return
        self.session = s
        s.save_failed.connect(lambda err: self.toast.show_text(tr("file.save_failed")))
        if c.path:
            self.settings.add_recent(c.path)
            self.settings.save()
        self._open_lobby()

    def _open_lobby(self, animate: bool = True) -> None:
        old = self.stack.currentWidget()
        lobby = LobbyPage(self.session, self.settings.preferred_ip, self.settings)
        lobby.end_session.connect(self.end_session)
        lobby.toast.connect(self.toast.show_text)
        lobby.addr.currentIndexChanged.connect(lambda: self._remember_ip(lobby.selected_ip()))
        self.lobby = lobby
        self._page = "lobby"
        self._swap(lobby, old, animate)

    def _remember_ip(self, ip: str) -> None:
        if ip.startswith("https://"):      # адрес туннеля каждый раз новый — не запоминаем
            return
        self.settings.preferred_ip = ip
        self.settings.save()

    def end_session(self) -> None:
        if self.session:
            self.session.stop()
            self.session.deleteLater()
            self.session = None
        self.lobby = None
        self.show_page("dnd")

    # ------------------------------------------------------------------ закрытие
    def closeEvent(self, e) -> None:
        if self.session and self.session.running:
            r = QMessageBox.question(self, paths.APP_NAME, tr("close.confirm"))
            if r != QMessageBox.StandardButton.Yes:
                e.ignore()
                return
            self.session.stop()
            self.session = None
        self.settings.window_geometry = bytes(self.saveGeometry().toBase64()).decode()
        self.settings.save()
        super().closeEvent(e)

    def resizeEvent(self, e) -> None:
        super().resizeEvent(e)
        if self.toast.isVisible():
            p = self.toast.parentWidget()
            self.toast.move((p.width() - self.toast.width()) // 2, p.height() - self.toast.height() - 28)

