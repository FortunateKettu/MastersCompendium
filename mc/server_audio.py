"""Звук мастера, который слышат игроки: атмосфера (дождь, ветер, костёр…), музыка и звуковые эффекты.

Мастер включает «Транслировать игрокам» — сервер хранит, что сейчас звучит, и рассылает всем.
Каждый игрок может выключить у себя звук мастера в «Настройках».
Музыку мастер выбирает из своих файлов: при трансляции файл загружается на сервер (кэш в папке данных,
не в файл кампании), игроки слушают его отсюда же. Позиция трека синхронизируется по времени сервера.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import time

from aiohttp import web

from . import gmtools as gt
from . import paths

MAX_AUDIO = 40 * 1024 * 1024
AUDIO_RE = re.compile(r"[0-9a-f]{24}\.(?:mp3|ogg|wav|m4a|flac|webm|opus)")
AUDIO_TYPES = {"mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "m4a": "audio/mp4", "flac": "audio/flac",
               "webm": "audio/webm", "opus": "audio/ogg"}
LAYERS = ("rain", "storm", "wind", "fire", "forest", "sea", "night", "stream", "tavern", "city", "cave", "drums")
SFX = ("thunder", "gong", "bell", "clash", "boom", "horn", "door", "magic")


def _audio_ext(data: bytes) -> str | None:
    if data[:3] == b"ID3" or (len(data) > 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0 and data[1] & 0x06):
        return "mp3"
    if data[:4] == b"OggS":
        return "opus" if b"OpusHead" in data[:200] else "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[4:8] == b"ftyp":
        return "m4a"
    if data[:4] == b"fLaC":
        return "flac"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    return None


def _audio_dir():
    d = paths.DATA_DIR / "audio_cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


class AudioMixin:
    # ------------------------------------------------------------------ состояние
    def _au(self) -> dict:
        c = self.campaign
        a = c.extra.get("audio")
        if not isinstance(a, dict):
            a = c.extra["audio"] = {}
        a.setdefault("share", False)
        a.setdefault("layers", {})
        a.setdefault("master", 0.7)
        a.setdefault("music", None)
        a.setdefault("auto_wx", False)
        a.setdefault("custom", [])          # свои звуки мастера: [{id: файл на сервере, name}]
        return a

    def _au_public(self) -> dict:
        a = self._au()
        return {"t": "au", "share": a["share"], "layers": dict(a["layers"]), "master": a["master"],
                "music": dict(a["music"]) if a.get("music") else None, "auto_wx": a["auto_wx"],
                "custom": [dict(x) for x in a["custom"]], "now": time.time()}

    # ------------------------------------------------------------------ файлы музыки
    async def _audio_upload(self, request: web.Request) -> web.Response:
        if not secrets.compare_digest(request.headers.get("X-MC-Key", ""), self.gm_key):
            return web.json_response({"error": "bad_gm_key"}, status=403)
        if (request.content_length or 0) > MAX_AUDIO:
            return web.json_response({"error": "too_big"}, status=413)
        data = await request.read()
        if len(data) > MAX_AUDIO or len(data) < 64:
            return web.json_response({"error": "too_big" if data else "empty"}, status=413)
        ext = _audio_ext(data)
        if ext is None:
            return web.json_response({"error": "bad_audio"}, status=415)
        aid = hashlib.sha256(data).hexdigest()[:24] + "." + ext
        p = _audio_dir() / aid
        if not p.exists():
            tmp = p.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(p)
        return web.json_response({"id": aid})

    async def _audio_get(self, request: web.Request) -> web.StreamResponse:
        aid = request.match_info.get("aid", "")
        if not AUDIO_RE.fullmatch(aid):
            raise web.HTTPNotFound()
        p = _audio_dir() / aid
        if not p.is_file():
            raise web.HTTPNotFound()
        # FileResponse умеет Range — без этого телефоны (Safari) не перематывают и не всегда играют
        return web.FileResponse(p, headers={"Content-Type": AUDIO_TYPES[aid.rsplit(".", 1)[1]],
                                            "Cache-Control": "public, max-age=31536000, immutable"})

    # ------------------------------------------------------------------ сообщения
    async def _au_msg(self, conn, t: str, data: dict) -> None:
        rid = data.get("rid")
        c = self.campaign
        if t == "au_get":
            with c.lock:
                pub = self._au_public()
            await self._send(conn.ws, {**pub, "rid": rid})
            return
        if not conn.gm:
            raise gt.ToolError("no_access")
        if t == "au_set":
            with c.lock:
                a = self._au()
                if "share" in data:
                    a["share"] = bool(data["share"])
                if "auto_wx" in data:
                    a["auto_wx"] = bool(data["auto_wx"])
                if "master" in data:
                    a["master"] = max(0.0, min(1.0, float(data.get("master") or 0)))
                if isinstance(data.get("layers"), dict):
                    a["layers"] = {k: round(max(0.0, min(1.0, float(v or 0))), 3) for k, v in data["layers"].items() if k in LAYERS}
                if isinstance(data.get("custom"), list):
                    a["custom"] = [{"id": x["id"], "name": gt._line(x.get("name") or "", 40) or "♪"} for x in data["custom"][:60]
                                   if isinstance(x, dict) and AUDIO_RE.fullmatch(str(x.get("id") or ""))]
                if "music" in data:
                    m = data.get("music")
                    if isinstance(m, dict) and AUDIO_RE.fullmatch(str(m.get("id") or "")):
                        a["music"] = {"id": m["id"], "name": gt._line(m.get("name") or "", 100), "playing": bool(m.get("playing")),
                                      "pos": max(0.0, float(m.get("pos") or 0)), "at": time.time(),
                                      "vol": max(0.0, min(1.0, float(m.get("vol") if m.get("vol") is not None else 0.6))),
                                      "loop": bool(m.get("loop"))}
                    else:
                        a["music"] = None
                c.touch()
                pub = self._au_public()
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            await self._broadcast(pub)
            return
        if t == "au_sfx":
            k = data.get("k")
            custom = isinstance(k, str) and k.startswith("c:") and any(x["id"] == k[2:] for x in self._au()["custom"])
            if k not in SFX and not custom:
                raise gt.ToolError("bad_request")
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            if self._au()["share"]:
                for x in list(self.conns):
                    if not x.gm:
                        await self._send(x.ws, {"t": "au_sfx", "k": k})
            return
        raise gt.ToolError("bad_request")
