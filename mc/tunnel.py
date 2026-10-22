"""Игра через интернет без VPN: туннель от публичного сервиса до нашего локального сервера.

Два варианта:
  • tuna       — tuna.am, узлы в России: работает у российских провайдеров без VPN.
                 Нужна бесплатная регистрация и токен (my.tuna.am). Адрес вида https://xxxx.ru.tuna.am
  • cloudflare — бесплатный «быстрый туннель» Cloudflare, без регистрации. В России Cloudflare
                 сильно ограничен — без VPN у мастера и у игроков обычно не работает.

Нужная программа (tuna.exe или cloudflared.exe) скачивается один раз в папку данных.
"""
from __future__ import annotations

import io
import os
import re
import sys
import zipfile
from pathlib import Path

from PyQt6.QtCore import QObject, QProcess, QProcessEnvironment, QTimer, QUrl, pyqtSignal
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest

from . import paths

START_TIMEOUT_MS = 60_000
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]")

PROVIDERS = {
    "tuna": {
        "exe": "tuna.exe" if sys.platform == "win32" else "tuna",
        "url": {"win32": "https://releases.tuna.am/tuna/latest/tuna_windows_amd64.zip",
                "linux": "https://releases.tuna.am/tuna/latest/tuna_linux_amd64.tar.gz"},
        "zip": True,
        # адрес бывает на разных доменах (…ru.tuna.am, …a.2na.am) — берём ссылку из строки «Forwarding»
        "re": re.compile(r"Forwarding\s+(https://[^\s\"'|]+)|(https://[a-z0-9][a-z0-9.-]*\.(?:tuna\.am|2na\.am))", re.I),
        "token": True,
    },
    "cloudflare": {
        "exe": "cloudflared.exe" if sys.platform == "win32" else "cloudflared",
        "url": {"win32": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
                "linux": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"},
        "zip": False,
        "re": re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com"),
        "token": False,
    },
}


def exe_path(provider: str) -> Path:
    return paths.DATA_DIR / "tools" / PROVIDERS[provider]["exe"]


def find_exe(provider: str) -> Path | None:
    p = exe_path(provider)
    if p.exists() and p.stat().st_size > 500_000:
        return p
    name = PROVIDERS[provider]["exe"]
    for d in os.environ.get("PATH", "").split(os.pathsep):
        q = Path(d) / name
        if q.exists():
            return q
    return None


def clean_subdomain(v: str) -> str:
    """«https://kettu.ru.tuna.am/» или «kettu» → «kettu»."""
    s = re.sub(r"^\s*https?://", "", str(v or "").strip().lower())
    s = s.split("/")[0].split(".")[0]
    return re.sub(r"[^a-z0-9-]", "", s)[:63].strip("-")


def args_for(provider: str, port: int) -> list[str]:
    if provider == "tuna":
        return ["http", str(port), "--inspect=false"]
    return ["tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"]


class Tunnel(QObject):
    """Состояния: off → downloading → starting → on (url) → off. Ошибка — failed(code)."""
    state_changed = pyqtSignal(str)
    progress = pyqtSignal(int)
    url_ready = pyqtSignal(str)
    failed = pyqtSignal(str)

    def __init__(self, port: int, parent=None):
        super().__init__(parent)
        self.port = port
        self.provider = "tuna"
        self.token = ""
        self.subdomain = ""
        self.state = "off"
        self.url = ""
        self.proc: QProcess | None = None
        self._net: QNetworkAccessManager | None = None
        self._reply: QNetworkReply | None = None
        self._data = bytearray()
        self._buf = ""
        self._timer = QTimer(self, singleShot=True, interval=START_TIMEOUT_MS, timeout=self._start_timeout)

    def _set(self, st: str) -> None:
        self.state = st
        self.state_changed.emit(st)

    # ------------------------------------------------------------------ запуск / остановка
    def start(self, provider: str, token: str = "", subdomain: str = "") -> None:
        if self.state != "off" or provider not in PROVIDERS:
            return
        # токен копируют по-разному: с кавычками, пробелами, с префиксом «tuna config save-token»
        tok = re.sub(r"^\s*tuna\s+config\s+save-token\s+", "", token or "").strip().strip("'\"").strip()
        self.provider, self.token = provider, tok
        self.subdomain = clean_subdomain(subdomain) if provider == "tuna" else ""
        if PROVIDERS[provider]["token"] and not self.token:
            self.failed.emit("tunnel_no_token")
            return
        exe = find_exe(provider)
        if exe is None:
            self._download()
            return
        self._run(exe)

    def stop(self) -> None:
        self._timer.stop()
        if self._reply is not None:
            self._reply.abort()
        if self.proc is not None:
            self.proc.blockSignals(True)
            self.proc.terminate()
            if not self.proc.waitForFinished(2500):
                self.proc.kill()
                self.proc.waitForFinished(1500)
            self.proc = None
        self.url = ""
        if self.state != "off":
            self._set("off")

    # ------------------------------------------------------------------ скачивание
    def _download(self) -> None:
        url = PROVIDERS[self.provider]["url"].get(sys.platform)
        if not url:
            self.failed.emit("tunnel_no_exe")
            return
        self._set("downloading")
        self._data = bytearray()
        self._net = self._net or QNetworkAccessManager(self)
        req = QNetworkRequest(QUrl(url))
        req.setAttribute(QNetworkRequest.Attribute.RedirectPolicyAttribute,
                         QNetworkRequest.RedirectPolicy.NoLessSafeRedirectPolicy)
        req.setHeader(QNetworkRequest.KnownHeaders.UserAgentHeader, f"MastersCompendium/{paths.APP_VERSION}")
        self._reply = self._net.get(req)
        self._reply.readyRead.connect(self._dl_chunk)
        self._reply.downloadProgress.connect(lambda got, total: self.progress.emit(int(got * 100 / total) if total > 0 else 0))
        self._reply.finished.connect(self._dl_done)

    def _dl_chunk(self) -> None:
        if self._reply is not None:
            self._data += bytes(self._reply.readAll())
            if len(self._data) > 200_000_000:
                self._reply.abort()

    def _dl_done(self) -> None:
        reply, self._reply = self._reply, None
        if reply is None:
            return
        err = reply.error()
        if err == QNetworkReply.NetworkError.NoError:
            self._data += bytes(reply.readAll())
        msg = reply.errorString()
        reply.deleteLater()
        if err == QNetworkReply.NetworkError.OperationCanceledError:
            self._set("off")
            return
        if err != QNetworkReply.NetworkError.NoError or len(self._data) < 500_000:
            paths.log(f"tunnel download ({self.provider}) failed: {msg}, {len(self._data)} bytes")
            self._set("off")
            self.failed.emit("tunnel_download")
            return
        target = exe_path(self.provider)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            blob = bytes(self._data)
            if PROVIDERS[self.provider]["zip"]:
                blob = self._unpack(blob, PROVIDERS[self.provider]["exe"])
            tmp = target.with_name(target.name + ".part")
            tmp.write_bytes(blob)
            tmp.replace(target)
            if sys.platform != "win32":
                target.chmod(0o755)
        except (OSError, ValueError, zipfile.BadZipFile) as e:
            paths.log(f"tunnel unpack/write failed: {e!r}")
            self._set("off")
            self.failed.emit("tunnel_write")
            return
        finally:
            self._data = bytearray()
        self._set("off")
        self._run(target)

    @staticmethod
    def _unpack(blob: bytes, name: str) -> bytes:
        if blob[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                member = next((n for n in z.namelist() if n.rsplit("/", 1)[-1].lower() == name.lower()), None)
                if member is None:
                    raise ValueError("exe not in zip")
                return z.read(member)
        import tarfile
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:*") as t:
            m = next((x for x in t.getmembers() if x.name.rsplit("/", 1)[-1] == name), None)
            if m is None:
                raise ValueError("exe not in archive")
            f = t.extractfile(m)
            return f.read() if f else b""

    # ------------------------------------------------------------------ процесс
    def _save_token(self, exe: Path) -> None:
        """tuna читает токен из своего конфига — сохраняем его туда штатной командой (как в документации tuna)."""
        p = QProcess()
        p.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        p.start(str(exe), ["config", "save-token", self.token])
        if not p.waitForFinished(15000):
            p.kill()
            p.waitForFinished(2000)
        out = ANSI_RE.sub("", bytes(p.readAll()).decode("utf-8", "replace")).strip().replace("\n", " | ")
        paths.log(f"tuna save-token: exit {p.exitCode()} {out[:300]}")

    def _run(self, exe: Path) -> None:
        if self.provider == "tuna" and self.token:
            self._save_token(exe)
        self._set("starting")
        self._buf = ""
        self.proc = QProcess(self)
        self.proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        env = QProcessEnvironment.systemEnvironment()
        if self.token:
            env.insert("TUNA_TOKEN", self.token)
        env.insert("NO_COLOR", "1")
        env.insert("TERM", "dumb")
        if self.provider == "tuna":
            # без TTY новый TUI-интерфейс tuna рисует экран escape-кодами и адрес не попадает в вывод
            env.insert("TUNA_TUI", "0")
            env.insert("TUNA_NO_PROMPT", "1")
            env.insert("TUNA_LOG", "stdout")
            env.insert("TUNA_LOG_FORMAT", "text")
            env.insert("TUNA_INSPECT", "false")
            if self.subdomain:
                # постоянный адрес: у игроков сохраняется вход (браузер помнит его для одного адреса)
                env.insert("TUNA_SUBDOMAIN", self.subdomain)
        self.proc.setProcessEnvironment(env)
        self.proc.readyReadStandardOutput.connect(self._on_output)
        self.proc.finished.connect(self._on_finished)
        self.proc.errorOccurred.connect(self._on_error)
        args = args_for(self.provider, self.port)
        paths.log(f"tunnel start: {exe} {' '.join(args)}" + (f" (subdomain {self.subdomain})" if self.subdomain else ""))
        self.proc.start(str(exe), args)
        self._timer.start()

    def _on_output(self) -> None:
        if self.proc is None:
            return
        text = bytes(self.proc.readAllStandardOutput()).decode("utf-8", "replace")
        self._buf = (self._buf + ANSI_RE.sub("", text))[-30000:]
        if self.state == "starting":
            m = PROVIDERS[self.provider]["re"].search(self._buf)
            if m:
                self._timer.stop()
                self.url = (m.group(1) or m.group(2) or m.group(0)).rstrip(".")
                paths.log(f"tunnel ready: {self.url}")
                self._set("on")
                self.url_ready.emit(self.url)

    def _on_error(self, err) -> None:
        paths.log(f"tunnel process error: {err}")
        if err == QProcess.ProcessError.FailedToStart:
            self.proc = None
            self._timer.stop()
            self._set("off")
            self.failed.emit("tunnel_start")

    def _on_finished(self, *_):
        self._timer.stop()
        was = self.state
        tail = self._buf[-800:].replace("\n", " | ")
        paths.log(f"tunnel exited ({self.provider}, state {was}): {tail}")
        self.proc = None
        self.url = ""
        self._set("off")
        if was in ("starting", "on"):
            low = tail.lower()
            if self.provider == "tuna" and self.subdomain and ("subdomain" in low or "поддомен" in low):
                self.failed.emit("tunnel_bad_sub")
            elif self.provider == "tuna" and ("token" in low or "unauthorized" in low or "401" in low):
                self.failed.emit("tunnel_bad_token")
            else:
                self.failed.emit(("tunnel_closed" if was == "on" else "tunnel_start") + ("_cf" if self.provider == "cloudflare" else ""))

    def _start_timeout(self) -> None:
        if self.state == "starting":
            paths.log(f"tunnel: no URL in time; output: {self._buf[-800:]!r}")
            self.stop()
            self.failed.emit("tunnel_timeout" + ("_cf" if self.provider == "cloudflare" else ""))
