"""Открыть страницу мастера в отдельном окне без адресной строки.

На Windows 11 всегда есть Microsoft Edge: `msedge --app=URL` открывает страницу как отдельное
приложение (своё окно, своя иконка на панели задач). Если Edge нет — пробуем Chrome, потом обычный браузер.
"""
from __future__ import annotations

import os
import subprocess
import sys
import webbrowser
from pathlib import Path

from .. import paths


def _candidates() -> list[Path]:
    env = os.environ
    roots = [env.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), env.get("ProgramFiles", r"C:\Program Files"),
             env.get("LOCALAPPDATA", "")]
    rel = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe",
           r"BraveSoftware\Brave-Browser\Application\brave.exe", r"Yandex\YandexBrowser\Application\browser.exe"]
    return [Path(r) / x for x in rel for r in roots if r]


def open_app_window(url: str) -> None:
    if sys.platform == "win32":
        profile = paths.DATA_DIR / "gm_window"
        for exe in _candidates():
            if exe.is_file():
                try:
                    subprocess.Popen([str(exe), f"--app={url}", "--window-size=1320,880", "--no-first-run",
                                      f"--user-data-dir={profile}"],
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)
                    return
                except OSError:
                    paths.log_exc("open_app_window")
    webbrowser.open(url)
