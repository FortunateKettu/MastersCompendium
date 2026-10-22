"""Кампания: модель данных и файл .campaign.

Файл .campaign — это zip-архив:
    campaign.json   — все данные кампании
    assets/<id>     — картинки карт и фишек (id = часть sha256 + расширение)

Сохранение атомарное (сначала во временный файл, потом замена), перед перезаписью
старая версия кладётся в бэкапы (хранится BACKUPS_KEEP последних на кампанию).
Доступ к данным из потока сервера и из GUI идёт под общим замком ``lock``.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

FORMAT_VERSION = 1
SYSTEM_DND = "dnd5e_2014"
SYSTEM_CYBERPUNK = "cyberpunk_red"
BACKUPS_KEEP = 10
BACKUP_EVERY = 600

# без похожих символов (0/O, 1/I/L), чтобы код было легко продиктовать
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 6
NAME_MAX = 32
PLAYER_COLORS = ("#8b5cf6", "#3d6df2", "#10b981", "#f59e0b", "#ef4444",
                 "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#a3a3a3")


ASSET_RE = re.compile(r"[0-9a-f]{24}\.(?:png|jpg|webp|gif|avif)")


class CampaignError(Exception):
    pass


def new_room_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def clean_name(name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(name or ""))
    name = re.sub(r"\s+", " ", name).strip()
    return name[:NAME_MAX]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .")
    return (name or "campaign")[:80]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


@dataclass
class Player:
    id: str
    name: str
    color: str
    token_hash: str
    joined: str = field(default_factory=_now)
    last_seen: str = field(default_factory=_now)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "color": self.color}

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "color": self.color, "token_hash": self.token_hash,
                "joined": self.joined, "last_seen": self.last_seen}

    @classmethod
    def from_json(cls, d: dict) -> "Player":
        return cls(id=str(d["id"]), name=clean_name(d.get("name", "")) or "?",
                   color=str(d.get("color") or PLAYER_COLORS[0]), token_hash=str(d.get("token_hash", "")),
                   joined=str(d.get("joined") or _now()), last_seen=str(d.get("last_seen") or _now()))


class Campaign:
    def __init__(self, name: str, system: str = SYSTEM_DND):
        self.lock = threading.RLock()
        self.id = uuid.uuid4().hex
        self.name = clean_name(name) or "Campaign"
        self.system = system
        self.created = _now()
        self.modified = self.created
        self.room_code = new_room_code()
        self.locked = False
        self.players: list[Player] = []
        # заделы на следующие этапы — сохраняем как есть, чтобы ничего не терялось
        self.extra: dict = {"characters": [], "maps": [], "notes": [], "settings": {"token_move": "free"}}
        self.path: Path | None = None
        self.dirty = False
        self._assets_new: dict[str, bytes] = {}     # ещё не сохранённые в файл
        self._assets_cache: dict[str, bytes] = {}   # прочитанные из файла (небольшой кэш)

    # ------------------------------------------------------------------ картинки (карты, фишки)
    def add_asset(self, data: bytes, ext: str) -> str:
        aid = hashlib.sha256(data).hexdigest()[:24] + "." + ext
        with self.lock:
            if aid not in self._assets_new and not self._asset_in_file(aid):
                self._assets_new[aid] = data
                self.touch()
        return aid

    def _asset_in_file(self, aid: str) -> bool:
        if self.path is None or not self.path.exists():
            return False
        try:
            with zipfile.ZipFile(self.path) as z:
                z.getinfo("assets/" + aid)
            return True
        except (KeyError, zipfile.BadZipFile, OSError):
            return False

    def get_asset(self, aid: str) -> bytes | None:
        if not ASSET_RE.fullmatch(aid or ""):
            return None
        with self.lock:
            data = self._assets_new.get(aid) or self._assets_cache.get(aid)
            path = self.path
        if data is not None:
            return data
        if path is None or not path.exists():
            return None
        try:
            with zipfile.ZipFile(path) as z:
                data = z.read("assets/" + aid)
        except (KeyError, zipfile.BadZipFile, OSError):
            return None
        with self.lock:
            if sum(len(v) for v in self._assets_cache.values()) > 150_000_000:
                self._assets_cache.clear()
            self._assets_cache[aid] = data
        return data

    def used_assets(self) -> set[str]:
        """Какие картинки ещё нужны (на остальные нет ссылок — при сохранении выкидываем)."""
        with self.lock:
            text = json.dumps(self.extra, ensure_ascii=False)
        return set(ASSET_RE.findall(text))

    # ------------------------------------------------------------------ игроки
    def find_player(self, player_id: str) -> Player | None:
        with self.lock:
            return next((p for p in self.players if p.id == player_id), None)

    def find_by_token(self, token: str) -> Player | None:
        if not token:
            return None
        h = hash_token(token)
        with self.lock:
            return next((p for p in self.players if secrets.compare_digest(p.token_hash, h)), None)

    def find_by_name(self, name: str) -> Player | None:
        key = clean_name(name).casefold()
        with self.lock:
            return next((p for p in self.players if p.name.casefold() == key), None)

    def add_player(self, name: str, color: str | None = None) -> tuple[Player, str]:
        """Новый игрок. Возвращает (игрок, токен). Токен хранится только у игрока, у нас — его хеш."""
        name = clean_name(name)
        if not name:
            raise CampaignError("empty_name")
        token = secrets.token_urlsafe(24)
        with self.lock:
            if color not in PLAYER_COLORS:
                used = {p.color for p in self.players}
                color = next((c for c in PLAYER_COLORS if c not in used), PLAYER_COLORS[len(self.players) % len(PLAYER_COLORS)])
            p = Player(id=uuid.uuid4().hex[:12], name=name, color=color, token_hash=hash_token(token))
            self.players.append(p)
            self.touch()
        return p, token

    def reissue_token(self, player: Player) -> str:
        token = secrets.token_urlsafe(24)
        with self.lock:
            player.token_hash = hash_token(token)
            self.touch()
        return token

    def remove_player(self, player_id: str) -> Player | None:
        with self.lock:
            p = self.find_player(player_id)
            if p:
                self.players.remove(p)
                self.touch()
            return p

    def set_room_code(self, code: str | None = None) -> str:
        with self.lock:
            self.room_code = normalize_code(code) if code else new_room_code()
            self.touch()
            return self.room_code

    def check_code(self, code: str) -> bool:
        with self.lock:
            return secrets.compare_digest(normalize_code(code), self.room_code)

    def touch(self) -> None:
        self.modified = _now()
        self.dirty = True

    # ------------------------------------------------------------------ сериализация
    def to_json(self) -> dict:
        with self.lock:
            d = {
                "format": FORMAT_VERSION, "app": paths.APP_ID, "app_version": paths.APP_VERSION,
                "id": self.id, "name": self.name, "system": self.system,
                "created": self.created, "modified": self.modified,
                "room_code": self.room_code, "locked": self.locked,
                "players": [p.to_json() for p in self.players],
            }
            d.update(self.extra)
            return d

    @classmethod
    def from_json(cls, d: dict) -> "Campaign":
        if not isinstance(d, dict) or d.get("app") != paths.APP_ID:
            raise CampaignError("not_a_campaign")
        if int(d.get("format", 0)) > FORMAT_VERSION:
            raise CampaignError("newer_format")
        c = cls(str(d.get("name", "")), str(d.get("system", SYSTEM_DND)))
        c.id = str(d.get("id") or c.id)
        c.created = str(d.get("created") or c.created)
        c.modified = str(d.get("modified") or c.modified)
        code = normalize_code(str(d.get("room_code", "")))
        c.room_code = code if len(code) >= 4 else new_room_code()
        c.locked = bool(d.get("locked", False))
        c.players = []
        for pd in d.get("players", []) or []:
            try:
                c.players.append(Player.from_json(pd))
            except (KeyError, TypeError):
                continue
        known = {"format", "app", "app_version", "id", "name", "system", "created", "modified",
                 "room_code", "locked", "players"}
        for k, v in d.items():
            if k not in known:
                c.extra[k] = v
        c.dirty = False
        return c

    # ------------------------------------------------------------------ файл
    @classmethod
    def load(cls, path: str | Path) -> "Campaign":
        path = Path(path)
        try:
            with zipfile.ZipFile(path) as z:
                info = z.getinfo("campaign.json")
                if info.file_size > 50_000_000:
                    raise CampaignError("too_big")
                data = json.loads(z.read(info).decode("utf-8"))
        except (zipfile.BadZipFile, KeyError, UnicodeDecodeError, ValueError) as e:
            raise CampaignError("broken_file") from e
        c = cls.from_json(data)
        c.path = path
        return c

    def save(self, path: str | Path | None = None) -> Path:
        target = Path(path) if path else self.path
        if target is None:
            raise CampaignError("no_path")
        target.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps(self.to_json(), ensure_ascii=False, indent=1).encode("utf-8")
        tmp = target.with_name(target.name + ".tmp")
        used = self.used_assets()
        with self.lock:
            fresh = dict(self._assets_new)
            source = self.path if self.path and self.path.exists() else None
        written: set[str] = set()
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("campaign.json", data)
            # картинки уже сжаты — кладём без сжатия
            for aid, blob in fresh.items():
                if aid in used:
                    z.writestr("assets/" + aid, blob, compress_type=zipfile.ZIP_STORED)
                    written.add(aid)
            # остальные переносим из текущего файла кампании (и при «Сохранить как» тоже)
            for src in {source, target if target.exists() else None} - {None}:
                try:
                    with zipfile.ZipFile(src) as old:
                        for info in old.infolist():
                            aid = info.filename[7:]
                            if info.filename.startswith("assets/") and aid in used and aid not in written:
                                z.writestr(info, old.read(info))
                                written.add(aid)
                except (zipfile.BadZipFile, OSError):
                    pass
        if target.exists():
            self._backup(target)
        # в Windows замена не проходит, пока файл открыт на чтение (сервер как раз отдаёт картинку) — повторяем
        for attempt in range(8):
            try:
                os.replace(tmp, target)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(0.15)
        with self.lock:
            self.path = target
            self.dirty = False
            for aid in written:
                self._assets_new.pop(aid, None)
        return target

    def _backup(self, target: Path) -> None:
        try:
            paths.BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
            stem = f"{safe_filename(self.name)}_{self.id[:8]}"
            # автосохранение идёт часто — бэкап делаем не чаще раза в BACKUP_EVERY секунд,
            # чтобы 10 копий покрывали хотя бы пару часов игры, а не пару минут
            prev = sorted(paths.BACKUPS_DIR.glob(f"{stem}_*{paths.CAMPAIGN_EXT}"))
            if prev and time.time() - prev[-1].stat().st_mtime < BACKUP_EVERY:
                return
            shutil.copy2(target, paths.BACKUPS_DIR / f"{stem}_{time.strftime('%Y%m%d_%H%M%S')}{paths.CAMPAIGN_EXT}")
            old = sorted(paths.BACKUPS_DIR.glob(f"{stem}_*{paths.CAMPAIGN_EXT}"))
            for f in old[:-BACKUPS_KEEP]:
                f.unlink(missing_ok=True)
        except OSError:
            paths.log_exc("campaign backup")


def peek_name(path: str | Path) -> str | None:
    """Быстро прочитать название кампании для списка недавних (без полной загрузки)."""
    try:
        with zipfile.ZipFile(path) as z:
            d = json.loads(z.read("campaign.json").decode("utf-8"))
        return clean_name(d.get("name", "")) or None
    except Exception:
        return None
