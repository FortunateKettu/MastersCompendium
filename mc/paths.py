"""Пути, версия и лог.

Программа портативная: все данные (настройки, кампании, бэкапы, лог) лежат в папке
MastersCompendium_data рядом с exe (или рядом с main.py при запуске из исходников).
Ресурсы (веб-клиент, логотип) берутся из сборки PyInstaller или из исходников.
"""
from __future__ import annotations

import sys
import threading
import time
import traceback
from pathlib import Path

APP_NAME = "Masters Compendium"
APP_ID = "MastersCompendium"
APP_VERSION = "0.12.0"
CAMPAIGN_EXT = ".campaign"
CHARACTER_EXT = ".character"

FROZEN = getattr(sys, "frozen", False)
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent.parent
RES_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))

DATA_DIR = APP_DIR / f"{APP_ID}_data"
CAMPAIGNS_DIR = DATA_DIR / "campaigns"
CHARACTERS_DIR = DATA_DIR / "characters"
BACKUPS_DIR = DATA_DIR / "backups"
SETTINGS_FILE = DATA_DIR / "settings.json"
LOG_FILE = DATA_DIR / "masters_compendium.log"

WEB_DIR = RES_DIR / "web"

_log_lock = threading.Lock()


def ensure_dirs() -> None:
    for d in (DATA_DIR, CAMPAIGNS_DIR, CHARACTERS_DIR, BACKUPS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n"
    with _log_lock:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            if LOG_FILE.exists() and LOG_FILE.stat().st_size > 2_000_000:
                LOG_FILE.replace(LOG_FILE.with_suffix(".old.log"))
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass
    if not FROZEN and sys.stderr is not None:
        try:
            sys.stderr.write(line)
        except Exception:
            pass


def log_exc(where: str) -> str:
    tb = traceback.format_exc()
    log(f"[{where}] {tb}")
    return tb
