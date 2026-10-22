"""Настройки программы (data/settings.json)."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import paths

MAX_RECENT = 10


@dataclass
class Settings:
    lang: str = "ru"
    port: int = 8765
    recent: list[str] = field(default_factory=list)
    preferred_ip: str = ""
    window_geometry: str = ""
    tunnel_provider: str = ""     # "" — ещё не выбирали; "tuna" | "cloudflare"
    tuna_token: str = ""
    tuna_subdomain: str = ""      # зарезервированный в my.tuna.am поддомен — адрес не меняется между запусками

    # ---------- загрузка / сохранение ----------
    @classmethod
    def load(cls) -> "Settings":
        try:
            raw = json.loads(paths.SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls()
        s = cls()
        for key in asdict(s):
            if key in raw:
                setattr(s, key, raw[key])
        if s.lang not in ("ru", "en"):
            s.lang = "ru"
        if not isinstance(s.port, int) or not (1024 <= s.port <= 65000):
            s.port = 8765
        if not isinstance(s.recent, list):
            s.recent = []
        s.recent = [str(p) for p in s.recent][:MAX_RECENT]
        return s

    def save(self) -> None:
        """Не падаем, если папка только для чтения (например, защищённая флешка) — просто пишем в лог."""
        try:
            paths.ensure_dirs()
            tmp = paths.SETTINGS_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, paths.SETTINGS_FILE)
        except OSError:
            paths.log_exc("settings save")

    # ---------- недавние кампании ----------
    def add_recent(self, path: str | Path) -> None:
        p = str(Path(path).resolve())
        self.recent = [x for x in self.recent if os.path.normcase(x) != os.path.normcase(p)]
        self.recent.insert(0, p)
        del self.recent[MAX_RECENT:]

    def existing_recent(self) -> list[str]:
        return [p for p in self.recent if Path(p).is_file()]
