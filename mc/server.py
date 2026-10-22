"""Игровой сервер мастера.

Работает в отдельном потоке со своим asyncio-циклом:
  * HTTP: раздаёт веб-клиент (телефоны игроков и окно мастера открывают http://IP:порт/)
  * WebSocket /ws: живое соединение с каждым игроком и с окном мастера
  * UDP-автопоиск: отвечает «я тут» программам игроков в той же сети

Вход (первое сообщение):
  {"t":"hello","token":...}                         — игрок переподключается
  {"t":"join","name":...,"code":...,"color":...}    — игрок входит впервые
  {"t":"gm","key":...}                              — окно мастера (ключ знает только программа мастера)

Дальше (клиент → сервер):
  ping · chars · char_get{id} · char_create{doc,owner?} · char_patch{id,ops,rid?} · char_delete{id}
  char_assign{id,owner} (мастер) · roll{rid,formula,label,mode,hidden,char} · log

Сервер → клиент:
  welcome · players · campaign · chars · char · char_patched · char_ack · char_removed · char_summary
  rolled · log · error{code,rid?} · kicked · bye · pong

GUI получает события через колбэк on_event(kind, data) из потока сервера —
в GUI он пробрасывается через Qt-сигнал.
"""
from __future__ import annotations

import asyncio
import copy
import gzip
import json
import mimetypes
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from typing import Callable

from aiohttp import WSMsgType, web

from . import characters as ch
from . import dice, paths
from . import gmtools as gt
from . import maps as mp
from . import rules5e as r5
from .server_gm import GM_MSGS, GMToolsMixin
from .server_lounge import LoungeMixin
from .server_rules import RulesMixin
from .server_scene import SceneMixin
from .server_decisions import DecisionsMixin
from .server_world import WorldMixin
from .server_actlog import ActLogMixin
from .server_audio import AudioMixin
from .server_marks import MarksMixin
from .campaign import Campaign, CampaignError, Player, clean_name, normalize_code
from .netutil import DISCOVERY_MAGIC, DISCOVERY_PORT

# В Windows реестр иногда отдаёт для .js «text/plain» — тогда браузер откажется грузить модули (3D-кубики).
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".json", "application/json"), (".svg", "image/svg+xml"), (".webmanifest", "application/manifest+json"), (".mp3", "audio/mpeg")):
    mimetypes.add_type(_type, _ext)

PROTOCOL = 2
HELLO_TIMEOUT = 20
MAX_MSG = 4 * 1024 * 1024
MAX_ASSET = 40 * 1024 * 1024
FX_KINDS = ("ruler", "ping", "drag", "tmpl")
IMG_MAGIC = ((b"\x89PNG\r\n\x1a\n", "png", "image/png"), (b"\xff\xd8\xff", "jpg", "image/jpeg"),
             (b"GIF8", "gif", "image/gif"))
FAIL_WINDOW = 60          # сек
FAIL_LIMIT = 12           # неверных кодов с одного адреса за окно
LOG_KEEP = 300
LOG_SAVE = 150
GM_COLOR = "#f5c542"

EventCallback = Callable[[str, dict], None]
MAP_MSGS = {"terr_add", "terr_del", "terr_clear", "maps", "map_get", "map_new", "map_set", "map_del", "map_show", "map_mode", "tok_add", "tok_set",
            "tok_del", "tok_move", "tok_req", "zone_add", "zone_set", "zone_del", "fog_all", "tmpl_add", "tmpl_del",
            "tmpl_clear", "fx"}


def client_ip(request: web.Request) -> str:
    """Адрес игрока. Через туннель Cloudflare все приходят с 127.0.0.1 — настоящий адрес в заголовке."""
    ip = request.remote or "?"
    if ip in ("127.0.0.1", "::1"):
        ip = request.headers.get("CF-Connecting-IP", ip)[:64]
    return ip


class Conn:
    __slots__ = ("ws", "role", "player", "cid", "view")

    def __init__(self, ws: web.WebSocketResponse, role: str, player: Player | None):
        self.ws = ws
        self.role = role
        self.player = player
        self.cid = uuid.uuid4().hex[:8]
        self.view: str | None = None      # какую карту смотрит мастер (игроки — всегда показанную)

    @property
    def gm(self) -> bool:
        return self.role == "gm"

    @property
    def pid(self) -> str | None:
        return self.player.id if self.player else None


class _Discovery(asyncio.DatagramProtocol):
    def __init__(self, server: "GameServer"):
        self.server = server
        self.transport: asyncio.DatagramTransport | None = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        if data.strip() != DISCOVERY_MAGIC or self.transport is None:
            return
        c = self.server.campaign
        with c.lock:
            info = {"app": paths.APP_ID, "v": PROTOCOL, "name": c.name, "system": c.system,
                    "port": self.server.port, "locked": c.locked}
        try:
            self.transport.sendto(json.dumps(info, ensure_ascii=False).encode("utf-8"), addr)
        except OSError:
            pass


class GameServer(GMToolsMixin, LoungeMixin, RulesMixin, SceneMixin, DecisionsMixin, WorldMixin, ActLogMixin, AudioMixin, MarksMixin):
    def __init__(self, campaign: Campaign, port: int, on_event: EventCallback | None = None):
        self.campaign = campaign
        self.port = port
        self.on_event = on_event or (lambda kind, data: None)
        self.gm_key = secrets.token_urlsafe(18)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._start_error: BaseException | None = None
        self._runner: web.AppRunner | None = None
        self._udp: asyncio.DatagramTransport | None = None
        self._stop_fut: asyncio.Future | None = None
        self.conns: set[Conn] = set()
        self._static_cache: dict[str, tuple] = {}
        self._fails: dict[str, deque] = defaultdict(deque)
        self.discovery_ok = False
        saved = campaign.extra.get("roll_log")
        self.log: deque = deque(saved if isinstance(saved, list) else [], maxlen=LOG_KEEP)

    # ================================================================== запуск / остановка
    def start(self, timeout: float = 10.0) -> None:
        self._thread = threading.Thread(target=self._run, name="GameServer", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            raise RuntimeError("server start timeout")
        if self._start_error:
            raise self._start_error

    def _run(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._main())
        except BaseException as e:  # noqa: BLE001 — ошибку старта отдаём в GUI
            if not self._ready.is_set():
                self._start_error = e
                self._ready.set()
            else:
                paths.log_exc("server loop")
        finally:
            try:
                self.loop.run_until_complete(self.loop.shutdown_asyncgens())
            except Exception:
                pass
            self.loop.close()

    async def _main(self) -> None:
        app = web.Application(client_max_size=MAX_ASSET + 1024)
        app.router.add_get("/", self._index)
        app.router.add_get("/ws", self._ws)
        app.router.add_get("/api/info", self._info)
        app.router.add_post("/api/asset", self._asset_upload)
        app.router.add_get("/asset/{aid}", self._asset_get)
        app.router.add_post("/api/audio", self._audio_upload)
        app.router.add_get("/audio/{aid}", self._audio_get)
        app.router.add_get("/web/{path:.+}", self._static)
        self._runner = web.AppRunner(app, access_log=None, handle_signals=False)
        await self._runner.setup()
        # reuse_address по умолчанию: после перезапуска сессии тот же порт сразу свободен
        site = web.TCPSite(self._runner, host="0.0.0.0", port=self.port)
        await site.start()
        try:
            self._udp, _ = await self.loop.create_datagram_endpoint(
                lambda: _Discovery(self), local_addr=("0.0.0.0", DISCOVERY_PORT), allow_broadcast=True)
            self.discovery_ok = True
        except OSError:
            paths.log("discovery port busy — LAN auto-discovery disabled")
        self._stop_fut = self.loop.create_future()
        paths.log(f"server started on port {self.port}")
        self._ready.set()
        await self._stop_fut
        await self._broadcast({"t": "bye"})
        for c in list(self.conns):
            await c.ws.close()
        if self._udp:
            self._udp.close()
        await self._runner.cleanup()
        await self._close_http()
        paths.log("server stopped")

    def stop(self, timeout: float = 5.0) -> None:
        if self.loop and self._stop_fut and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(lambda: self._stop_fut.done() or self._stop_fut.set_result(None))
        if self._thread:
            self._thread.join(timeout)

    # ================================================================== API для GUI (потокобезопасно)
    def _call(self, coro_fn, *args) -> None:
        if self.loop and not self.loop.is_closed():
            asyncio.run_coroutine_threadsafe(coro_fn(*args), self.loop)

    def kick(self, player_id: str) -> None:
        self._call(self._kick, player_id)

    def push_campaign(self) -> None:
        self._call(self._push_campaign)

    def import_character(self, doc: dict, owner: str | None) -> None:
        self._call(self._gui_create, doc, owner)

    def delete_character(self, cid: str) -> None:
        self._call(self._gui_delete, cid)

    def assign_character(self, cid: str, owner: str | None) -> None:
        self._call(self._gui_assign, cid, owner)

    def online_ids(self) -> set[str]:
        return {c.pid for c in list(self.conns) if c.pid}

    def gm_url(self, host: str = "127.0.0.1", lang: str = "") -> str:
        return f"http://{host}:{self.port}/?gm={self.gm_key}" + (f"&lang={lang}" if lang in ("ru", "en") else "")

    # ================================================================== HTTP
    async def _index(self, request: web.Request) -> web.StreamResponse:
        return web.FileResponse(paths.WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    async def _info(self, request: web.Request) -> web.Response:
        c = self.campaign
        with c.lock:
            data = {"app": paths.APP_ID, "v": PROTOCOL, "version": paths.APP_VERSION,
                    "name": c.name, "system": c.system, "locked": c.locked}
        return web.json_response(data, headers={"Cache-Control": "no-cache"})

    async def _static(self, request: web.Request) -> web.StreamResponse:
        """Файлы клиента. Текст (js, css, json) отдаём сжатым gzip — через интернет это в 3–5 раз быстрее.
        Файлы с ?v=… неизменны — браузер кэширует их надолго."""
        rel = request.match_info.get("path", "")
        try:
            path = (paths.WEB_DIR / rel).resolve()
            path.relative_to(paths.WEB_DIR.resolve())
        except (ValueError, OSError):
            raise web.HTTPNotFound() from None
        if not path.is_file():
            raise web.HTTPNotFound()
        st = path.stat()
        key = (str(path), st.st_mtime_ns, st.st_size)
        hit = self._static_cache.get(str(path))
        if hit is None or hit[0] != key:
            data = path.read_bytes()
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            gz = None
            if len(data) > 1024 and (ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml", "application/manifest+json")):
                gz = gzip.compress(data, compresslevel=6, mtime=0)
            hit = (key, data, gz, ctype)
            self._static_cache[str(path)] = hit
        _, data, gz, ctype = hit
        etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
        immutable = bool(request.query.get("v")) or "/vendor/" in "/" + rel.replace("\\", "/")
        headers = {"Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache",
                   "Vary": "Accept-Encoding", "ETag": etag}
        if request.headers.get("If-None-Match") == etag:
            return web.Response(status=304, headers=headers)
        if gz is not None and "gzip" in request.headers.get("Accept-Encoding", ""):
            headers["Content-Encoding"] = "gzip"
            return web.Response(body=gz, content_type=ctype.split(";")[0], headers=headers,
                                charset="utf-8" if ctype.startswith("text/") or "json" in ctype else None)
        return web.Response(body=data, content_type=ctype.split(";")[0], headers=headers,
                            charset="utf-8" if ctype.startswith("text/") or "json" in ctype else None)

    async def _asset_upload(self, request: web.Request) -> web.Response:
        """Картинка карты/фишки от мастера (тело запроса — сами байты картинки)."""
        if not secrets.compare_digest(request.headers.get("X-MC-Key", ""), self.gm_key):
            return web.json_response({"error": "bad_gm_key"}, status=403)
        if (request.content_length or 0) > MAX_ASSET:
            return web.json_response({"error": "too_big"}, status=413)
        data = await request.read()
        if len(data) > MAX_ASSET or len(data) < 16:
            return web.json_response({"error": "too_big" if data else "empty"}, status=413)
        ext = next((e for magic, e, _ in IMG_MAGIC if data.startswith(magic)), None)
        if ext is None and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ext = "webp"
        if ext is None:
            return web.json_response({"error": "bad_image"}, status=415)
        aid = self.campaign.add_asset(data, ext)
        return web.json_response({"id": aid})

    async def _asset_get(self, request: web.Request) -> web.StreamResponse:
        aid = request.match_info.get("aid", "")
        data = self.campaign.get_asset(aid)
        if data is None:
            raise web.HTTPNotFound()
        ext = aid.rsplit(".", 1)[-1]
        ctype = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "avif": "image/avif"}.get(ext, "application/octet-stream")
        return web.Response(body=data, content_type=ctype, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    # ================================================================== WebSocket
    async def _ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
        await ws.prepare(request)
        conn: Conn | None = None
        try:
            conn = await self._handshake(ws, client_ip(request))
            if conn is None:
                return ws
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if isinstance(data, dict):
                    try:
                        await self._handle(conn, data)
                    except Exception:
                        paths.log_exc(f"handle {data.get('t')}")
                        await self._err(conn, "server_error", data.get("rid"))
        except ConnectionResetError:
            pass
        except Exception:
            paths.log_exc("ws handler")
        finally:
            if conn is not None:
                self.conns.discard(conn)
                p = conn.player
                if p is not None and p.id not in self.online_ids():
                    with self.campaign.lock:
                        p.last_seen = time.strftime("%Y-%m-%dT%H:%M:%S")
                    self._emit("left", p.public())
                    await self._push_players()
        return ws

    async def _handshake(self, ws: web.WebSocketResponse, ip: str) -> Conn | None:
        try:
            msg = await ws.receive(timeout=HELLO_TIMEOUT)
        except asyncio.TimeoutError:
            await ws.close()
            return None
        if msg.type != WSMsgType.TEXT:
            await ws.close()
            return None
        try:
            data = json.loads(msg.data)
            kind = data.get("t")
        except (ValueError, AttributeError):
            await self._fail(ws, "bad_request")
            return None

        c = self.campaign
        token: str | None = None
        if kind == "gm":
            if not secrets.compare_digest(str(data.get("key", "")), self.gm_key):
                await self._fail(ws, "bad_gm_key")
                return None
            conn = Conn(ws, "gm", None)
            self.conns.add(conn)
            await self._send(ws, {"t": "welcome", "v": PROTOCOL, "role": "gm",
                                  "me": {"id": "gm", "name": "GM", "color": GM_COLOR},
                                  "campaign": self._campaign_public(), "players": self._players_public()})
            return conn

        if kind == "hello":
            player = c.find_by_token(str(data.get("token", "")))
            if player is None:
                await self._fail(ws, "bad_token")
                return None
        elif kind == "join":
            if self._rate_limited(ip):
                await self._fail(ws, "rate_limit")
                return None
            if not c.check_code(normalize_code(str(data.get("code", "")))):
                self._fails[ip].append(time.monotonic())
                await self._fail(ws, "bad_code")
                return None
            name = clean_name(str(data.get("name", "")))
            if not name:
                await self._fail(ws, "bad_name")
                return None
            existing = c.find_by_name(name)
            if existing is not None:
                if existing.id in self.online_ids():
                    await self._fail(ws, "name_taken")
                    return None
                # тот же игрок с другого устройства / после очистки браузера: верный код комнаты = право вернуть имя
                player = existing
                token = c.reissue_token(player)
            else:
                with c.lock:
                    locked = c.locked
                if locked:
                    await self._fail(ws, "locked")
                    return None
                try:
                    player, token = c.add_player(name, str(data.get("color", "")) or None)
                except CampaignError:
                    await self._fail(ws, "bad_name")
                    return None
        else:
            await self._fail(ws, "bad_request")
            return None

        first = player.id not in self.online_ids()
        conn = Conn(ws, "player", player)
        self.conns.add(conn)
        with c.lock:
            player.last_seen = time.strftime("%Y-%m-%dT%H:%M:%S")
        welcome = {"t": "welcome", "v": PROTOCOL, "role": "player", "me": player.public(),
                   "campaign": self._campaign_public(), "players": self._players_public()}
        if token:
            welcome["token"] = token
        await self._send(ws, welcome)
        if first:
            self._emit("joined", player.public())
        await self._push_players()
        return conn

    # ================================================================== сообщения
    async def _handle(self, conn: Conn, data: dict) -> None:
        t = data.get("t")
        rid = data.get("rid")
        c = self.campaign
        if t == "ping":
            await self._send(conn.ws, {"t": "pong"})
        elif t == "chars":
            pids = self._player_ids()
            await self._send(conn.ws, {"t": "chars", "chars": [self._summary_for(conn, i, pids) for i in self._summaries()]})
        elif t == "char_get":
            d = ch.find(c, str(data.get("id", "")))
            if d is None or not self._can_edit(conn, d):
                await self._err(conn, "no_access", rid)
                return
            with c.lock:
                text = json.dumps({"t": "char", "char": d, "rid": rid}, ensure_ascii=False)
            await conn.ws.send_str(text)
        elif t == "char_create":
            owner = conn.pid
            if conn.gm:
                owner = data.get("owner") if isinstance(data.get("owner"), str) else None
            try:
                d = ch.create(c, data.get("doc"), owner)
            except ch.CharError as e:
                await self._err(conn, str(e), rid)
                return
            await self._send_char(d, rid=rid)
            await self._push_summaries()
        elif t == "char_patch":
            await self._patch(conn, data)
        elif t == "char_delete":
            d = ch.find(c, str(data.get("id", "")))
            if d is None or not self._can_edit(conn, d):
                await self._err(conn, "no_access", rid)
                return
            await self._delete(d)
        elif t == "char_assign" and conn.gm:
            owner = data.get("owner") if isinstance(data.get("owner"), str) else None
            await self._assign(str(data.get("id", "")), owner)
        elif t == "roll":
            await self._roll(conn, data)
        elif t == "log":
            await self._send(conn.ws, {"t": "log", "entries": [e for e in self.log if self._can_see(conn, e)]})
        elif t in MAP_MSGS:
            try:
                await self._map_msg(conn, t, data)
            except mp.MapError as e:
                await self._err(conn, str(e), rid)
        elif t in GM_MSGS:
            try:
                await self._act_wrap(conn, t, data, lambda: self._gm_msg(conn, t, data))
            except (gt.ToolError, ch.CharError) as e:
                await self._err(conn, str(e), rid)
        elif isinstance(t, str) and t.split("_")[0] in ("w", "tmr", "sroll", "stash", "shop", "chron", "sess"):
            try:
                await self._act_wrap(conn, t, data, lambda: self._world_msg(conn, t, data))
            except (gt.ToolError, ch.CharError) as e:
                await self._err(conn, str(e), rid)
        elif isinstance(t, str) and t.startswith("mark_"):
            try:
                await self._marks_msg(conn, t, data)
            except gt.ToolError as e:
                await self._err(conn, str(e), rid)
        elif isinstance(t, str) and t.startswith("au_"):
            try:
                await self._au_msg(conn, t, data)
            except (gt.ToolError, ValueError, TypeError) as e:
                await self._err(conn, str(e) if isinstance(e, gt.ToolError) else "bad_request", rid)
        elif isinstance(t, str) and t.startswith("actlog_"):
            try:
                await self._actlog_msg(conn, t, data)
            except (gt.ToolError, ch.CharError) as e:
                await self._err(conn, str(e), rid)
        elif t.startswith("dec_"):
            try:
                await self._dec_msg(conn, t, data)
            except gt.ToolError as e:
                await self._err(conn, str(e), rid)
        elif t.startswith("sc_") or t.startswith("pn_"):
            try:
                await self._scene_msg(conn, t, data)
            except (gt.ToolError, ch.CharError) as e:
                await self._err(conn, str(e), rid)
        elif t.startswith("lz"):
            try:
                await self._lounge_msg(conn, t, data)
            except gt.ToolError as e:
                await self._err(conn, str(e), rid)

    async def _patch(self, conn: Conn, data: dict) -> None:
        c = self.campaign
        cid, rid = str(data.get("id", "")), data.get("rid")
        d = ch.find(c, cid)
        if d is None or not self._can_edit(conn, d):
            await self._err(conn, "no_access", rid)
            return
        ops = data.get("ops")
        with c.lock:
            before = {k: copy.deepcopy(d.get(k)) for k in self._act_keys(ops)} if not conn.gm else {}
        try:
            d = ch.patch(c, cid, ops)
        except ch.CharError as e:
            await self._err(conn, str(e), rid, cid)
            return
        version = d["version"]
        await self._send(conn.ws, {"t": "char_ack", "id": cid, "version": version, "rid": rid})
        msg = {"t": "char_patched", "id": cid, "ops": ops, "version": version}
        for other in self._subscribers(d):
            if other is not conn:
                await self._send(other.ws, msg)
        await self._push_summary(d)
        if before:
            await self._act_patch(conn, before, cid)

    async def _delete(self, d: dict) -> None:
        subs = self._subscribers(d)
        ch.delete(self.campaign, d["id"])
        for s in subs:
            await self._send(s.ws, {"t": "char_removed", "id": d["id"]})
        await self._push_summaries()

    async def _roll(self, conn: Conn, data: dict) -> None:
        rid = data.get("rid")
        mode = data.get("mode") if data.get("mode") in ("adv", "dis") else "normal"
        cid = data.get("char")
        try:
            entry = await self._make_roll(conn, str(data.get("formula", "")), str(data.get("label", "")),
                                          str(data.get("kind", "")), mode, bool(data.get("hidden")),
                                          cid if isinstance(cid, str) else "", rid=rid)
        except dice.DiceError:
            await self._err(conn, "bad_formula", rid)
            return
        await self._act_roll(conn, entry)
        if entry["kind"] == "init" and isinstance(cid, str) and entry["char"]:
            await self._init_from_roll(cid, entry["total"])

    async def _make_roll(self, conn: Conn, formula: str, label: str, kind: str = "free", mode: str = "normal",
                         hidden: bool = False, cid: str = "", rid=None, char_name: str = "", gm_only: bool = False) -> dict:
        """Бросок от имени соединения: в журнал и всем, кто может его видеть. DiceError — плохая формула."""
        res = dice.roll(formula, mode)
        who = conn.player.public() if conn.player else {"id": "gm", "name": "GM", "color": GM_COLOR}
        if cid and not char_name:
            d = ch.find(self.campaign, cid)
            if d is not None and self._can_edit(conn, d):
                char_name = str(d.get("name", ""))
        entry = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "who": who, "char": char_name,
                 "label": label[:80], "kind": kind[:20], "mode": mode, "hidden": hidden or gm_only, "gm": conn.gm, **res}
        if gm_only:
            entry["gm_only"] = True
        self.log.append(entry)
        with self.campaign.lock:
            self.campaign.extra["roll_log"] = list(self.log)[-LOG_SAVE:]
            self.campaign.touch()
        for other in list(self.conns):
            if self._can_see(other, entry):
                msg = {"t": "rolled", "roll": entry}
                if other is conn and rid:
                    msg["rid"] = rid
                await self._send(other.ws, msg)
        return entry

    # ================================================================== права
    @staticmethod
    def _can_edit(conn: Conn, d: dict) -> bool:
        return conn.gm or (conn.pid is not None and d.get("owner") == conn.pid)

    @staticmethod
    def _can_see(conn: Conn, e: dict) -> bool:
        if conn.gm:
            return True
        if e.get("gm_only"):            # спасброски противников и НИП — только мастеру
            return False
        if not e.get("hidden"):
            return True
        who = e.get("who") or {}
        return not e.get("gm") and conn.pid is not None and who.get("id") == conn.pid

    def _subscribers(self, d: dict) -> list[Conn]:
        return [x for x in list(self.conns) if self._can_edit(x, d)]


    # ================================================================== карты
    def _viewing(self, conn: Conn) -> str | None:
        return conn.view if conn.gm else mp.active_id(self.campaign)

    def _owners(self) -> dict:
        return {d.get("id"): d.get("owner") for d in ch.chars(self.campaign) if isinstance(d, dict)}

    def _map_payload(self, conn: Conn, m: dict | None) -> dict:
        c = self.campaign
        with c.lock:
            if m is None:
                return {"t": "map", "map": None, "mode": mp.move_mode(c), "limit": mp.move_limit(c)}
            data = copy.deepcopy(m) if conn.gm else mp.for_player(m, conn.pid, self._owners())
            return {"t": "map", "map": data, "mode": mp.move_mode(c), "limit": mp.move_limit(c), "active": m["id"] == mp.active_id(c)}

    async def _push_map(self, m: dict | None, mid: str | None = None) -> None:
        mid = m["id"] if m else mid
        for x in list(self.conns):
            if self._viewing(x) == mid:
                await self._send(x.ws, self._map_payload(x, m))

    async def _push_map_list(self) -> None:
        with self.campaign.lock:
            msg = {"t": "maps", "maps": mp.listing(self.campaign), "mode": mp.move_mode(self.campaign), "limit": mp.move_limit(self.campaign)}
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, msg)

    async def _push_active(self) -> None:
        """Мастер показал другую карту — игрокам её целиком."""
        c = self.campaign
        with c.lock:
            m = mp.find(c, mp.active_id(c) or "")
        for x in list(self.conns):
            if not x.gm:
                await self._send(x.ws, self._map_payload(x, m))

    def _map_for(self, conn: Conn, data: dict) -> dict:
        mid = str(data.get("map", ""))
        m = mp.find(self.campaign, mid)
        if m is None or (not conn.gm and mid != mp.active_id(self.campaign)):
            raise mp.MapError("no_map")
        return m

    @staticmethod
    def _tok(m: dict, tid) -> dict:
        t = next((x for x in m.get("tokens", []) if x.get("id") == tid), None)
        if t is None:
            raise mp.MapError("no_token")
        return t

    async def _map_msg(self, conn: Conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")
        gm = conn.gm
        if t not in ("map_get", "tok_move", "tok_set", "tmpl_add", "tmpl_del", "fx") and not gm:
            raise mp.MapError("no_access")

        if t == "maps":
            await self._push_map_list()
            return
        if t == "map_get":
            with c.lock:
                if gm:
                    mid = data.get("id") or conn.view or mp.active_id(c)
                    m = mp.find(c, str(mid or "")) or (mp.maps(c)[0] if mp.maps(c) else None)
                    conn.view = m["id"] if m else None
                else:
                    m = mp.find(c, mp.active_id(c) or "")
            msg = self._map_payload(conn, m)
            msg["rid"] = rid
            await self._send(conn.ws, msg)
            return
        if t == "map_new":
            with c.lock:
                if len(mp.maps(c)) >= mp.MAX_MAPS:
                    raise mp.MapError("too_many")
                m = mp.new_map(data.get("map"))
                mp.maps(c).append(m)
                c.touch()
            conn.view = m["id"]
            msg = self._map_payload(conn, m)
            msg["rid"] = rid
            await self._send(conn.ws, msg)
            await self._push_map_list()
            return
        if t == "map_mode":
            if data.get("mode"):
                mp.set_move_mode(c, str(data.get("mode", "")))
            if data.get("limit") is not None:
                mp.set_move_limit(c, bool(data.get("limit")))
            await self._broadcast({"t": "map_mode", "mode": mp.move_mode(c), "limit": mp.move_limit(c)})
            await self._push_map_list()
            return
        if t == "map_show":
            with c.lock:
                mid = data.get("id")
                if mid and not mp.find(c, str(mid)):
                    raise mp.MapError("no_map")
                c.extra["map_active"] = str(mid) if mid else None
                c.touch()
            await self._push_active()
            await self._push_map_list()
            for x in list(self.conns):      # у мастера поменялась пометка «показана игрокам»
                if x.gm and x.view:
                    await self._send(x.ws, self._map_payload(x, mp.find(c, x.view)))
            return

        m = self._map_for(conn, data)
        mid = m["id"]
        pid = conn.pid
        list_changed = False
        fx_only = False
        moved = None
        dec_changed = False
        with c.lock:
            if t == "map_set":
                mp.update_meta(m, data.get("fields"))
                list_changed = True
            elif t == "map_del":
                mp.maps(c).remove(m)
                if c.extra.get("map_active") == mid:
                    c.extra["map_active"] = None
                list_changed = True
            elif t == "tok_add":
                if len(m.setdefault("tokens", [])) >= mp.MAX_TOKENS:
                    raise mp.MapError("too_many")
                m["tokens"].append(mp.clean_token(data.get("tok")))
            elif t == "tok_set":
                tok = self._tok(m, data.get("id"))
                if gm:
                    new = mp.clean_token(data.get("fields"), tok)
                elif mp.token_mine(tok, pid, self._owners()):
                    f = data.get("fields") if isinstance(data.get("fields"), dict) else {}
                    new = mp.clean_token({"conds": f.get("conds", tok.get("conds"))}, tok, gm=False)
                else:
                    raise mp.MapError("no_access")
                tok.clear()
                tok.update(new)
            elif t == "tok_del":
                tok = self._tok(m, data.get("id"))
                m["tokens"].remove(tok)
            elif t == "tok_move":
                tok = self._tok(m, data.get("id"))
                old_xy = (tok["x"], tok["y"])
                x = mp._num(data.get("x"), -mp.COORD, mp.COORD, tok["x"])
                y = mp._num(data.get("y"), -mp.COORD, mp.COORD, tok["y"])
                if gm:
                    tok.update(x=x, y=y, req=None)
                elif not mp.token_mine(tok, pid, self._owners()):
                    raise mp.MapError("no_access")
                else:
                    mode = mp.move_mode(c)
                    if mode == "gm":
                        raise mp.MapError("move_locked")
                    if mode == "approve" or self._move_needs_ok(m, tok, (tok["x"], tok["y"]), (x, y)):
                        old_dec = (tok.get("req") or {}).get("dec")
                        if old_dec and self._dec_find(old_dec):
                            self._dec_find(old_dec)["state"] = "no"
                        ft = r5.dist_ft(m.get("grid") or {}, (tok["x"], tok["y"]), (x, y))
                        dd = self._dec_add("move", tok.get("name") or "?", {"ft": ft}, map=mid, tok=tok["id"])
                        tok["req"] = {"x": x, "y": y, "dec": dd["id"]}
                        dec_changed = True
                        self._emit("move_request", {"map": mid, "token": tok.get("name", "")})
                    else:
                        tok.update(x=x, y=y, req=None)
                moved = (tok["id"], old_xy, (tok["x"], tok["y"]))
            elif t == "tok_req":
                tok = self._tok(m, data.get("id"))
                req = tok.get("req")
                old_xy = (tok["x"], tok["y"])
                dd = self._dec_find((req or {}).get("dec") or "")
                if dd:
                    cbx = gt.combat(c)
                    ent = next((q for q in cbx.get("list") or [] if q.get("token") == tok["id"] or (tok.get("char") and q.get("char") == tok.get("char"))), None)
                    dd["state"] = "ok" if data.get("ok") else "no"
                    if data.get("ok"):
                        dd["undo"] = {"map": mid, "tok": tok["id"], "x": tok["x"], "y": tok["y"],
                                      "entry": ent["id"] if ent else "", "mv": (ent.get("econ") or {}).get("mv", 0) if ent else None}
                    dec_changed = True
                if req and data.get("ok"):
                    tok.update(x=req["x"], y=req["y"])
                tok["req"] = None
                moved = (tok["id"], old_xy, (tok["x"], tok["y"]))
            elif t == "zone_add":
                zones = m.setdefault("fog", {"on": True, "zones": []}).setdefault("zones", [])
                if len(zones) >= mp.MAX_ZONES:
                    raise mp.MapError("too_many")
                z = mp.clean_zone(data.get("zone"))
                zones.append(z)
            elif t == "zone_set":
                zones = m.get("fog", {}).get("zones", [])
                z = next((x for x in zones if x.get("id") == data.get("id")), None)
                if z is None:
                    raise mp.MapError("no_zone")
                z.update(mp.clean_zone(data.get("fields"), z))
            elif t == "zone_del":
                zones = m.get("fog", {}).get("zones", [])
                m["fog"]["zones"] = [x for x in zones if x.get("id") != data.get("id")]
            elif t == "terr_add":
                # трудная местность: многоугольник, движение по нему стоит вдвое
                terr = m.setdefault("terrain", [])
                many = data.get("zones") if isinstance(data.get("zones"), list) else [data.get("zone")]
                for zz in many[: mp.MAX_ZONES]:
                    z = mp.clean_zone(zz)
                    if len(terr) >= mp.MAX_ZONES:
                        raise mp.MapError("too_many")
                    terr.append({"id": z["id"], "pts": z["pts"]})
            elif t == "terr_del":
                m["terrain"] = [x for x in m.get("terrain") or [] if x.get("id") != data.get("id")]
            elif t == "terr_clear":
                m["terrain"] = []
            elif t == "fog_all":
                for z in m.get("fog", {}).get("zones", []):
                    z["open"] = bool(data.get("open"))
            elif t == "tmpl_add":
                tm = m.setdefault("tmpls", [])
                if len(tm) >= mp.MAX_TMPLS:
                    tm.pop(0)
                tm.append(mp.clean_tmpl(data.get("tmpl"), pid or "gm"))
            elif t == "tmpl_del":
                tm = m.get("tmpls", [])
                x = next((q for q in tm if q.get("id") == data.get("id")), None)
                if x is None:
                    raise mp.MapError("no_template")
                if not gm and x.get("by") != pid:
                    raise mp.MapError("no_access")
                tm.remove(x)
            elif t == "tmpl_clear":
                m["tmpls"] = []
            elif t == "fx":
                fx_only = True
            if not fx_only:
                c.touch()

        if fx_only:
            await self._relay_fx(conn, m, data)
            return
        if rid:
            await self._send(conn.ws, {"t": "ok", "rid": rid})
        if t == "map_del":
            await self._push_map(None, mid)
            await self._push_active()
        else:
            await self._push_map(m)
        if list_changed:
            await self._push_map_list()
        if dec_changed:
            await self._dec_push()
        if moved and moved[1] != moved[2]:
            actor = conn
            if t == "tok_req" and conn.gm:          # одобренный мастером ход — в журнал игрока
                tk = next((x for x in m.get("tokens", []) if x.get("id") == moved[0]), {})
                owner = tk.get("owner")
                if not owner and tk.get("char"):
                    owner = (ch.find(self.campaign, tk["char"]) or {}).get("owner")
                actor = next((x for x in self.conns if owner and x.pid == owner), conn)
            await self._act_move(actor, m, *moved)
            await self._cb_track_move(m, *moved)
            await self._r_after_move(m, *moved)

    async def _relay_fx(self, conn: Conn, m: dict, data: dict) -> None:
        """Мгновенные эффекты (линейка, метка, перетаскивание) — без сохранения."""
        kind = data.get("kind")
        d = data.get("d") if isinstance(data.get("d"), dict) else {}
        if kind not in FX_KINDS or len(json.dumps(d)) > 4000:
            return
        who = conn.player.public() if conn.player else {"id": "gm", "name": "GM", "color": GM_COLOR}
        tok = None
        if kind == "drag":
            tok = next((x for x in m.get("tokens", []) if x.get("id") == d.get("id")), None)
            if tok is None:
                return
            with self.campaign.lock:
                owners = self._owners()
                if not conn.gm and (not mp.token_mine(tok, conn.pid, owners) or mp.move_mode(self.campaign) == "gm"):
                    return
        msg = {"t": "fx", "map": m["id"], "kind": kind, "by": who, "d": d}
        for x in list(self.conns):
            if x is conn or self._viewing(x) != m["id"]:
                continue
            if tok is not None and not x.gm:
                with self.campaign.lock:
                    moved = dict(tok, x=mp._num(d.get("x"), -mp.COORD, mp.COORD, 0), y=mp._num(d.get("y"), -mp.COORD, mp.COORD, 0))
                    if not (mp.token_visible(m, tok, x.pid, owners) and mp.token_visible(m, moved, x.pid, owners)):
                        continue
            await self._send(x.ws, msg)

    # ================================================================== служебное
    def _rate_limited(self, ip: str) -> bool:
        q = self._fails[ip]
        now = time.monotonic()
        while q and now - q[0] > FAIL_WINDOW:
            q.popleft()
        return len(q) >= FAIL_LIMIT

    async def _fail(self, ws: web.WebSocketResponse, code: str) -> None:
        await self._send(ws, {"t": "error", "code": code})
        await ws.close()

    async def _err(self, conn: Conn, code: str, rid=None, cid: str | None = None) -> None:
        msg = {"t": "error", "code": code, "rid": rid}
        if cid:
            msg["id"] = cid
        await self._send(conn.ws, msg)

    async def _send(self, ws: web.WebSocketResponse, data: dict) -> None:
        if ws.closed:
            return
        try:
            await ws.send_str(json.dumps(data, ensure_ascii=False))
        except (ConnectionResetError, RuntimeError):
            pass

    async def _broadcast(self, data: dict) -> None:
        text = json.dumps(data, ensure_ascii=False)
        for c in list(self.conns):
            if not c.ws.closed:
                try:
                    await c.ws.send_str(text)
                except (ConnectionResetError, RuntimeError):
                    pass

    async def _send_char(self, d: dict, rid=None) -> None:
        """Полный лист — владельцу и мастеру."""
        with self.campaign.lock:
            payload = {"t": "char", "char": d}
            text_plain = json.dumps(payload, ensure_ascii=False)
            payload["rid"] = rid
            text_rid = json.dumps(payload, ensure_ascii=False)
        for c in self._subscribers(d):
            try:
                await c.ws.send_str(text_rid if rid else text_plain)
            except (ConnectionResetError, RuntimeError):
                pass

    def _players_public(self) -> list[dict]:
        online = self.online_ids()
        with self.campaign.lock:
            return [{**p.public(), "online": p.id in online} for p in self.campaign.players]

    def _campaign_public(self) -> dict:
        c = self.campaign
        with c.lock:
            return {"id": c.id, "name": c.name, "system": c.system}

    def _summaries(self) -> list[dict]:
        with self.campaign.lock:
            return [ch.summary(d) for d in ch.chars(self.campaign) if isinstance(d, dict)]

    async def _push_players(self) -> None:
        players = self._players_public()
        await self._broadcast({"t": "players", "players": players})
        self._emit("players", {"players": players})

    def _player_ids(self) -> set:
        with self.campaign.lock:
            return {p.id for p in self.campaign.players}

    def _summary_for(self, conn: Conn, s: dict, pids: set) -> dict:
        """Хиты НИП (персонаж без игрока) игроки видят, только если мастер их открыл."""
        if conn.gm or s.get("show_hp") or (s.get("owner") and s["owner"] in pids):
            return s
        return {**s, "hp": None}

    async def _push_summaries(self) -> None:
        s = self._summaries()
        pids = self._player_ids()
        for x in list(self.conns):
            await self._send(x.ws, {"t": "chars", "chars": [self._summary_for(x, i, pids) for i in s]})
        self._emit("chars", {"chars": s})

    async def _push_summary(self, d: dict) -> None:
        with self.campaign.lock:
            s = ch.summary(d)
        pids = self._player_ids()
        for x in list(self.conns):
            await self._send(x.ws, {"t": "char_summary", "char": self._summary_for(x, s, pids)})
        self._emit("char_summary", {"char": s})

    async def _push_campaign(self) -> None:
        await self._broadcast({"t": "campaign", "campaign": self._campaign_public()})

    async def _kick(self, player_id: str) -> None:
        conns = [c for c in list(self.conns) if c.pid == player_id]
        removed = self.campaign.remove_player(player_id)
        for c in conns:
            self.conns.discard(c)
            await self._send(c.ws, {"t": "kicked"})
            await c.ws.close()
        if removed:
            self._emit("kicked", removed.public())
        await self._push_players()

    async def _gui_create(self, doc: dict, owner: str | None) -> None:
        try:
            d = ch.create(self.campaign, doc, owner)
        except ch.CharError as e:
            self._emit("error", {"code": str(e)})
            return
        await self._send_char(d)
        await self._push_summaries()

    async def _gui_delete(self, cid: str) -> None:
        d = ch.find(self.campaign, cid)
        if d:
            await self._delete(d)

    async def _gui_assign(self, cid: str, owner: str | None) -> None:
        await self._assign(cid, owner)

    async def _assign(self, cid: str, owner: str | None) -> None:
        d = ch.find(self.campaign, cid)
        if d is None:
            return
        before = set(self._subscribers(d))
        ch.assign(self.campaign, cid, owner)
        after = set(self._subscribers(d))
        for x in before - after:
            await self._send(x.ws, {"t": "char_removed", "id": cid})
        await self._send_char(d)
        await self._push_summaries()

    def _emit(self, kind: str, data: dict) -> None:
        try:
            self.on_event(kind, data)
        except Exception:
            paths.log_exc("server on_event")
