"""Сервер: бестиарий и импорт с ttg.club, бой (инициатива), раздатки, заметки мастера.

Подмешивается в GameServer (class GameServer(GMToolsMixin)). Все правки данных — под campaign.lock.
"""
from __future__ import annotations

import asyncio
import copy
import re
import time

import aiohttp

from . import characters as ch
from . import dice, paths
from . import gmtools as gt
from . import maps as mp
from . import rules5e as r5

TTG_BASE = "https://5e14.ttg.club"
TTG_TIMEOUT = 20
IMG_MAX = 6 * 1024 * 1024


def image_ext(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"GIF8"):
        return "gif"
    if data[4:12] in (b"ftypavif", b"ftypavis"):
        return "avif"
    return None
def image_complete(data: bytes) -> bool:
    """Файл скачан целиком? Для WebP размер записан в заголовке RIFF, у PNG/JPEG есть метка конца."""
    if data[:4] == b"RIFF" and len(data) >= 8:
        return len(data) >= int.from_bytes(data[4:8], "little") + 8
    if data.startswith(b"\x89PNG"):
        return b"IEND" in data[-16:]
    if data.startswith(b"\xff\xd8"):
        return data.rstrip(b"\x00").endswith(b"\xff\xd9")
    return True


GM_ONLY = {"mon_list", "mon_get", "mon_save", "mon_del", "mon_tokens", "ttg_search", "ttg_import",
           "cb_start", "cb_end", "cb_add", "cb_set", "cb_del", "cb_roll", "cb_hp", "cb_prev", "cb_move", "cb_cur",
           "ho_save", "ho_del", "ho_share", "notes", "note_save", "note_del",
           "grp_list", "grp_save", "grp_del", "dice_style_set", "cb_endno", "cb_rules", "cur_set", "xp_award", "cfg_set"}
CB_EXTRA = {"cb_maneuver"}
# боевые действия: мастер — за любого, игрок — за своего персонажа (проверка внутри)
CB_ACTIONS = {"cb_attack", "cb_save", "cb_heal", "cb_econ", "cb_effect", "cb_conc"}
GM_MSGS = GM_ONLY | CB_ACTIONS | {"cb_get", "cb_next", "ho_list", "dice_styles", "cur_get", "cfg_get"} | CB_EXTRA
AB_RU = {"str": "Сил", "dex": "Лов", "con": "Тел", "int": "Инт", "wis": "Мдр", "cha": "Хар"}


class GMToolsMixin:
    _http: aiohttp.ClientSession | None = None

    # ------------------------------------------------------------------ ttg.club
    async def _http_session(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=TTG_TIMEOUT),
                headers={"User-Agent": f"MastersCompendium/{paths.APP_VERSION} (+desktop GM app)",
                         "Accept": "application/json, text/plain, */*"})
        return self._http

    async def _close_http(self) -> None:
        if self._http is not None and not self._http.closed:
            await self._http.close()

    async def _ttg_post(self, path: str, payload: dict | None):
        s = await self._http_session()
        try:
            async with s.post(TTG_BASE + path, json=payload or {}) as r:
                if r.status == 404:
                    raise gt.ToolError("ttg_not_found")
                if r.status != 200:
                    paths.log(f"ttg {path}: HTTP {r.status}")
                    raise gt.ToolError("ttg_failed")
                return await r.json(content_type=None)
        except gt.ToolError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            paths.log(f"ttg {path}: {e!r}")
            raise gt.ToolError("ttg_offline") from e

    async def _fetch_image(self, url: str) -> str:
        """Скачать картинку (жетон монстра) и положить в кампанию. Пустая строка, если не вышло.
        Сайт картинок может отдавать заглушку без Referer — поэтому представляемся как страница ttg.club."""
        if not re.match(r"https?://", url or ""):
            return ""
        s = await self._http_session()
        headers = {"Referer": TTG_BASE + "/", "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5"}
        data, ctype = b"", ""
        for attempt in range(2):          # сайт картинок бывает медленным — вторая попытка
            try:
                async with s.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=60, sock_read=30)) as r:
                    if r.status != 200:
                        paths.log(f"ttg image {url}: HTTP {r.status}")
                        return ""
                    ctype = r.headers.get("Content-Type", "")
                    # читаем ДО КОНЦА: content.read(n) отдаёт только то, что уже пришло (раньше сохранялись обрывки по ~1 КБ)
                    buf = bytearray()
                    async for chunk in r.content.iter_chunked(64 * 1024):
                        buf += chunk
                        if len(buf) > IMG_MAX:
                            break
                    data = bytes(buf)
                    want = r.content_length
                if want and len(data) < want:
                    raise aiohttp.ClientPayloadError(f"short body {len(data)}/{want}")
                if not image_complete(data):
                    raise aiohttp.ClientPayloadError(f"truncated image {len(data)} bytes")
                break
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                paths.log(f"ttg image {url}: {e!r} (попытка {attempt + 1})")
                data = b""
        if not data:
            return ""
        ext = image_ext(data)
        if len(data) > IMG_MAX or not ext or len(data) < 200:
            paths.log(f"ttg image {url}: skipped ({len(data)} bytes, {ctype}, {ext})")
            return ""
        paths.log(f"ttg image {url}: ok {len(data)} bytes {ext}")
        return self.campaign.add_asset(data, ext)

    def _image_candidates(self, urls: list[str]) -> list[str]:
        out = []
        for u in urls:
            if u.startswith("//"):
                u = "https:" + u
            if u.startswith("/"):
                out += [TTG_BASE + u, "https://ttg.club" + u, "https://img.ttg.club" + u]
            elif re.match(r"https?://", u):
                out.append(u)
            elif u:
                out += [TTG_BASE + "/" + u, "https://img.ttg.club/" + u]
        return list(dict.fromkeys(out))

    # ------------------------------------------------------------------ рассылки
    def _combat_payload(self, conn) -> dict:
        c = self.campaign
        with c.lock:
            cb = copy.deepcopy(gt.combat(c))
            owners = {d.get("id"): d.get("owner") for d in ch.chars(c) if isinstance(d, dict)}
            pids = {p.id for p in c.players}
            sums = {d.get("id"): d for d in ch.chars(c) if isinstance(d, dict)}
            toks, tmaps = {}, {}
            for m in mp.maps(c):
                for t in m.get("tokens", []):
                    toks[(m["id"], t["id"])] = t
                    tmaps[(m["id"], t["id"])] = m
            out = []
            cur_hidden = False
            for e in gt.order(cb):
                tok = toks.get((e.get("map"), e.get("token")))
                show_hp = False
                if e.get("char") and e["char"] in sums:
                    hp = sums[e["char"]].get("hp") or {}
                    e["hp"] = {"cur": hp.get("cur", 0), "max": hp.get("max", 0)}
                    e["owner"] = owners.get(e["char"])
                    e["conds"] = sums[e["char"]].get("conditions") or []
                    show_hp = bool(sums[e["char"]].get("show_hp"))
                    if e["owner"] not in pids:          # персонаж без игрока — это НИП
                        e["kind"] = "npc"
                elif tok is not None:
                    e["hp"] = tok.get("hp")
                    e["conds"] = tok.get("conds") or []
                    e["hidden"] = e.get("hidden") or tok.get("hidden", False)
                    # противник в тумане войны — игроки не видят его и в очереди ходов
                    if not conn.gm and not e["hidden"] and not mp.token_visible(tmaps[(e.get("map"), e.get("token"))], tok, conn.pid, owners):
                        e["hidden"] = True
                    show_hp = bool(tok.get("show_hp"))
                e["show_hp"] = show_hp
                if not conn.gm:
                    if e.get("hidden"):
                        cur_hidden = cur_hidden or e["id"] == cb.get("cur")
                        continue
                    if e.get("kind") != "pc":
                        e["state"] = gt.hp_state(e.get("hp"))
                        if not show_hp:
                            e["hp"] = None
                        e["ac"] = None
                    e.pop("note", None)
                out.append(e)
            for e in out:
                e["speed"] = self._speed_of(e)
                if e.get("char") and (conn.gm or e.get("owner") == conn.pid):
                    d = ch.find(c, e["char"])
                    if d is not None:
                        e["ac"] = r5.char_ac(d)
            log = []
            for x in cb.get("log") or []:
                if x.get("hidden") and not conn.gm:
                    continue
                if not conn.gm:
                    drop = {"ac", "hp"} | ({"roll"} if x.get("secret") else set())
                    x = {k: v for k, v in x.items() if k not in drop}
                log.append(x)
            cb["log"] = log[-60:]
            cb["list"] = out
            if cur_hidden:
                cb["cur"] = None
                cb["cur_hidden"] = True
        return {"t": "combat", "combat": cb}

    async def _push_combat(self) -> None:
        for x in list(self.conns):
            await self._send(x.ws, self._combat_payload(x))
        await self._lz_combat_sync()

    def _handouts_payload(self, conn) -> dict:
        with self.campaign.lock:
            lst = [copy.deepcopy(h) for h in gt.handouts(self.campaign)
                   if conn.gm or gt.handout_visible(h, conn.pid)]
        if not conn.gm:
            for h in lst:
                h.pop("to", None)
        return {"t": "handouts", "handouts": lst}

    async def _push_handouts(self) -> None:
        for x in list(self.conns):
            await self._send(x.ws, self._handouts_payload(x))

    async def _push_mon_list(self) -> None:
        with self.campaign.lock:
            msg = {"t": "monsters", "monsters": [gt.monster_summary(m) for m in gt.monsters(self.campaign)]}
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, msg)

    async def _push_groups(self) -> None:
        with self.campaign.lock:
            msg = {"t": "groups", "groups": copy.deepcopy(gt.groups(self.campaign))}
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, msg)

    async def _push_notes(self) -> None:
        with self.campaign.lock:
            msg = {"t": "notes", "notes": copy.deepcopy(gt.notes(self.campaign))}
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, msg)

    # ------------------------------------------------------------------ бой: помощники
    def _dex_for(self, mon_id: str) -> int:
        m = gt.find_monster(self.campaign, mon_id) if mon_id else None
        return gt.mod(m["abil"]["dex"]) if m else 0

    def _pc_dex(self, cid: str) -> int:
        d = ch.find(self.campaign, cid)
        try:
            return gt.mod(int(((d or {}).get("abilities") or {}).get("dex", 10)))
        except (TypeError, ValueError):
            return 0

    async def _init_from_roll(self, cid: str, total: int) -> None:
        """Игрок кинул инициативу из листа — записываем в бой."""
        c = self.campaign
        changed = False
        with c.lock:
            cb = gt.combat(c)
            if not cb.get("active"):
                return
            for e in cb["list"]:
                if e.get("char") == cid:
                    e["init"] = int(total)
                    changed = True
            if changed:
                c.touch()
        if changed:
            await self._push_combat()

    def _hp_apply(self, e: dict, delta: int | None, value: int | None) -> tuple[str, object]:
        """Изменить хиты участника боя. Возвращает (что изменилось, объект) для рассылки."""
        c = self.campaign
        if e.get("char"):
            d = ch.find(c, e["char"])
            if d is None:
                return "", None
            hp = d.get("hp") if isinstance(d.get("hp"), dict) else {}
            mx, cur, tmp = int(hp.get("max") or 0), int(hp.get("cur") or 0), int(hp.get("temp") or 0)
            if value is not None:
                cur = value
            elif delta < 0:
                dmg = -delta
                take = min(tmp, dmg)
                tmp -= take
                cur -= dmg - take
            else:
                cur += delta
            cur = max(0, min(mx, cur)) if mx else max(0, cur)
            d = ch.patch(c, e["char"], [{"op": "set", "path": ["hp", "cur"], "value": cur},
                                        {"op": "set", "path": ["hp", "temp"], "value": tmp}])
            return "char", d
        m = mp.find(c, e.get("map", "")) if e.get("token") else None
        tok = next((t for t in (m or {}).get("tokens", []) if t.get("id") == e.get("token")), None)
        target = tok if tok is not None else e
        hp = target.get("hp") or {"cur": 0, "max": 0}
        cur = value if value is not None else hp["cur"] + (delta or 0)
        cur = max(0, min(hp["max"], cur)) if hp["max"] else max(0, cur)
        target["hp"] = {"cur": cur, "max": hp["max"]}
        if tok is not None:
            conds = [x for x in tok.get("conds", []) if x not in ("dead", "bloodied")]
            if hp["max"]:
                if cur <= 0:
                    conds.append("dead")
                elif cur <= hp["max"] / 2:
                    conds.append("bloodied")
            tok["conds"] = conds
            return "map", m
        return "", None

    def _hp_roll(self, mon: dict) -> int:
        f = re.sub(r"[кК]", "d", mon.get("hp_formula") or "")
        f = re.sub(r"[−–]", "-", f)
        m = re.match(r"\s*(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)", f)
        if m:
            try:
                return max(1, int(dice.roll(m.group(1).replace(" ", ""))["total"]))
            except dice.DiceError:
                pass
        return int(mon.get("hp") or 1)

    # ------------------------------------------------------------------ бой: кто есть кто
    def _speed_of(self, e: dict) -> int:
        c = self.campaign
        if e.get("char"):
            d = ch.find(c, e["char"])
            sp = r5.char_speed(d) if d else 30
        else:
            mon = gt.find_monster(c, e.get("mon")) if e.get("mon") else None
            sp = r5.mon_speed(mon) if mon else 30
        if self._rules_on() and e.get("id"):
            r = self._resolve({"e": e["id"]})
            cs = set(self._conds_of(r)) if r else set()
            if cs & {"grappled", "restrained", "paralyzed", "stunned", "unconscious", "petrified"}:
                return 0          # схвачен/опутан — скорость 0
            if "dash" in cs:
                sp *= 2           # рывок
        return sp

    def _resolve(self, spec) -> dict | None:
        """Источник/цель действия: {"e": id записи боя} | {"map", "token"} | {"char"} → описание."""
        c = self.campaign
        if not isinstance(spec, dict):
            return None
        cb = gt.combat(c)
        r = None
        if spec.get("e"):
            e = next((x for x in cb["list"] if x["id"] == spec["e"]), None)
            if e is None:
                return None
            r = {"entry": e, "name": e["name"], "char": e.get("char") or "", "map": e.get("map") or "",
                 "token": e.get("token") or "", "mon": e.get("mon") or "", "hidden": bool(e.get("hidden"))}
        elif spec.get("token"):
            m = mp.find(c, str(spec.get("map") or ""))
            tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == spec.get("token")), None)
            if tok is None:
                return None
            r = {"entry": None, "name": tok.get("name") or "?", "char": tok.get("char") or "", "map": m["id"],
                 "token": tok["id"], "mon": tok.get("mon") or "", "hidden": bool(tok.get("hidden"))}
        elif spec.get("char"):
            d = ch.find(c, str(spec["char"]))
            if d is None:
                return None
            r = {"entry": None, "name": d.get("name") or "?", "char": d["id"], "map": "", "token": "", "mon": "", "hidden": False}
        if r is None:
            return None
        if r["entry"] is None and cb.get("active"):      # эта фишка / персонаж в бою — берём запись боя
            r["entry"] = next((x for x in cb["list"] if (r["token"] and x.get("token") == r["token"])
                               or (r["char"] and x.get("char") == r["char"])), None)
            if r["entry"] is not None:
                r["name"] = r["entry"]["name"]
        if r["char"] and not r["token"]:                  # фишка персонажа — для цифр над ней
            for mm in [mp.find(c, mp.active_id(c) or "")] + mp.maps(c):
                tk = next((x for x in (mm or {}).get("tokens", []) if x.get("char") == r["char"]), None)
                if tk:
                    r["map"], r["token"] = mm["id"], tk["id"]
                    break
        if r["mon"]:
            r["mon_doc"] = gt.find_monster(c, r["mon"])
        return r

    def _ac_of(self, r: dict) -> int | None:
        if r["char"]:
            d = ch.find(self.campaign, r["char"])
            return r5.char_ac(d) if d else None
        if r["entry"] is not None and r["entry"].get("ac") is not None:
            return int(r["entry"]["ac"])
        m = r.get("mon_doc")
        return int(m["ac"]) if m else None

    def _save_of(self, r: dict, ab: str) -> int:
        if r["char"]:
            d = ch.find(self.campaign, r["char"])
            return r5.save_bonus(d, ab) if d else 0
        m = r.get("mon_doc")
        return r5.mon_save_bonus(m, ab) if m else 0

    def _is_pc(self, r: dict) -> bool:
        """Персонаж игрока (его броски все видят). Монстры, фишки и НИП — нет."""
        if not r["char"]:
            return False
        d = ch.find(self.campaign, r["char"]) or {}
        return bool(d.get("owner")) and any(p.id == d.get("owner") for p in self.campaign.players)

    def _can_act(self, conn, r: dict) -> bool:
        if conn.gm:
            return True
        if not r["char"]:
            return False
        d = ch.find(self.campaign, r["char"])
        return bool(d) and d.get("owner") == conn.pid

    def _conds_of(self, r: dict) -> list:
        c = self.campaign
        if r["char"]:
            d = ch.find(c, r["char"]) or {}
            return list(d.get("conditions") or [])
        m = mp.find(c, r["map"]) if r["token"] else None
        tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == r["token"]), None)
        return list((tok or {}).get("conds") or [])

    def _cond_set(self, r: dict, cond: str, on: bool, pushes: dict) -> None:
        """Поставить/снять состояние (у персонажа — в листе, у фишки — на фишке)."""
        c = self.campaign
        if r["char"]:
            d = ch.find(c, r["char"])
            if d is None:
                return
            cur = [x for x in (d.get("conditions") or []) if x != cond]
            if on:
                cur.append(cond)
            if cur != list(d.get("conditions") or []):
                d = ch.patch(c, r["char"], [{"op": "set", "path": ["conditions"], "value": cur}])
                pushes["chars"][d["id"]] = d
            return
        m = mp.find(c, r["map"]) if r["token"] else None
        tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == r["token"]), None)
        if tok is None:
            return
        cur = [x for x in (tok.get("conds") or []) if x != cond]
        if on:
            cur.append(cond)
        tok["conds"] = cur
        pushes["maps"][m["id"]] = m

    def _damage(self, r: dict, amount: int, pushes: dict, crit: bool = False) -> dict:
        """Урон (amount > 0) или лечение (amount < 0). Возвращает {hp, dropped}."""
        before = None
        if r.get("char"):
            d0 = ch.find(self.campaign, r["char"])
            before = int(((d0 or {}).get("hp") or {}).get("cur") or 0) if d0 else None
        target = r["entry"] if r["entry"] is not None else {"char": r["char"], "map": r["map"], "token": r["token"]}
        if r["entry"] is not None and not target.get("token") and r["token"] and not target.get("char"):
            target = {**target, "map": r["map"], "token": r["token"]}
        kind, obj = self._hp_apply(target, -amount, None)
        if kind == "char":
            pushes["chars"][obj["id"]] = obj
            hp = obj.get("hp") or {}
        elif kind == "map":
            pushes["maps"][obj["id"]] = obj
            tok = next((x for x in obj.get("tokens", []) if x.get("id") == target.get("token")), {})
            hp = tok.get("hp") or {}
        else:
            hp = target.get("hp") or {}
        if before is not None:
            self._r_damage_down(r, before, amount, crit, pushes)
        self._r_after_hp(r, before, int(hp.get("cur") or 0), int(hp.get("max") or 0), pushes)
        return {"cur": int(hp.get("cur") or 0), "max": int(hp.get("max") or 0)}

    async def _effect_ticks(self, conn, prev_id: str | None, cur_id: str | None) -> None:
        """Повторяющиеся эффекты: спасбросок в конце хода прошлого участника, урон/лечение в начале хода нового."""
        c = self.campaign
        pushes = {"chars": {}, "maps": {}}
        evs = []
        changed = False
        cb = gt.combat(c)
        prev = next((e for e in cb.get("list") or [] if e.get("id") == prev_id), None)
        if prev is not None:
            for ef in list(prev.get("effects") or []):
                if not ef.get("sv_ab"):
                    continue
                r = self._resolve({"e": prev["id"]})
                if r is None:
                    continue
                bonus = self._save_of(r, ef["sv_ab"])
                sr = await self._make_roll(conn, f"1d20{bonus:+d}", f"{prev['name']}: {ef.get('name') or ef.get('cond')} · спасбросок {AB_RU[ef['sv_ab']]} · СЛ {ef['sv_dc']}",
                                           "save", "normal", bool(prev.get("hidden")), char_name=prev["name"], gm_only=not self._is_pc(r))
                ok = sr["total"] >= int(ef["sv_dc"])
                with c.lock:
                    gt.cb_log(cb, "", prev.get("hidden"))
                    cb["log"][-1].update(k="ef_save", who=prev["name"], ef=ef.get("name") or ef.get("cond"), roll=sr["total"], dc=ef["sv_dc"], ok=ok)
                    if ok:
                        prev["effects"] = [x for x in prev.get("effects") or [] if x.get("id") != ef.get("id")]
                        if ef.get("cond") and not any(x.get("cond") == ef["cond"] for x in prev["effects"]):
                            self._cond_set(r, ef["cond"], False, pushes)
                    changed = True
        cur = next((e for e in cb.get("list") or [] if e.get("id") == cur_id), None)
        if cur is not None:
            for ef in list(cur.get("effects") or []):
                if not ef.get("dot"):
                    continue
                r = self._resolve({"e": cur["id"]})
                if r is None:
                    continue
                try:
                    dr = await self._make_roll(conn, ef["dot"], f"{cur['name']}: {ef.get('name') or ef.get('cond')} · {'лечение' if ef.get('heal') else 'урон'}",
                                               "damage", "normal", bool(cur.get("hidden")), char_name=cur["name"])
                except dice.DiceError:
                    continue
                amount = max(0, int(dr["total"]))
                with c.lock:
                    hp = self._damage(r, -amount if ef.get("heal") else amount, pushes)
                    gt.cb_log(cb, "", cur.get("hidden"))
                    cb["log"][-1].update(k="ef_tick", who=cur["name"], ef=ef.get("name") or ef.get("cond"), dmg=amount, heal=bool(ef.get("heal")), hp=hp)
                    changed = True
                evs.append({"k": "heal" if ef.get("heal") else "hit", "map": r.get("map"), "token": r.get("token"), "dmg": amount, "hidden": bool(cur.get("hidden")), "rng": "spell"})
                if not ef.get("heal") and amount:
                    await self._conc_check(conn, r, amount, bool(cur.get("hidden")), pushes, evs)
        if changed:
            c.touch()
            await self._flush(pushes)
            await self._events(evs)
            await self._push_combat()

    def _turn_ended(self, cb: dict) -> dict:
        """Конец хода: «Рывок» и «Отход» действуют только до конца своего хода."""
        pushes = {"chars": {}, "maps": {}}
        e = next((x for x in cb.get("list") or [] if x.get("id") == cb.get("cur")), None)
        if e is None:
            return pushes
        gone = [f for f in e.get("effects") or [] if f.get("cond") in ("dash", "disengage")]
        if gone:
            e["effects"] = [f for f in e.get("effects") or [] if f not in gone]
        r = self._resolve({"e": e["id"]})
        if r:
            conds = set(self._conds_of(r))
            for k in ("dash", "disengage"):
                if k in conds:
                    self._cond_set(r, k, False, pushes)
        return pushes

    def _turn_started(self, cb: dict) -> dict:
        """Начало хода: обнулить действия, отсчитать эффекты (закончившиеся — снять состояние)."""
        pushes = {"chars": {}, "maps": {}}
        for e, ef in gt.start_turn(cb):
            gt.cb_log(cb, "", e.get("hidden"))
            cb["log"][-1].update(k="ef_end", who=e["name"], ef=ef.get("name") or ef.get("cond"))
            if ef.get("cond") and not any(x.get("cond") == ef["cond"] for x in e.get("effects") or []):
                r = self._resolve({"e": e["id"]})
                if r:
                    self._cond_set(r, ef["cond"], False, pushes)
        cur = next((x for x in cb["list"] if x["id"] == cb.get("cur")), None)
        if int(cb.get("round") or 0) != int(cb.get("_tr") or 0):
            if cb.get("_tr"):
                self._w_fired = getattr(self, "_w_fired", []) + self._w_round_tick()
            cb["_tr"] = int(cb.get("round") or 0)
        if cur:
            gt.cb_log(cb, "", cur.get("hidden"))
            cb["log"][-1].update(k="turn", who=cur["name"], rnd=cb.get("round") or 1)
            if self._rules_on() and self._r_surprise_turn(cb, pushes):
                gt.cb_log(cb, "", cur.get("hidden"))
                cb["log"][-1].update(k="surprised", who=cur["name"])
        return pushes

    async def _flush(self, pushes: dict) -> None:
        for d in pushes.get("chars", {}).values():
            await self._send_char(d)
            await self._push_summary(d)
        for m in pushes.get("maps", {}).values():
            await self._push_map(m)

    def _ev_visible(self, conn, e: dict) -> bool:
        """Событие на фишке, которую игрок не видит (скрыта, в тумане), — ему не показываем."""
        if conn.gm:
            return True
        if e.get("hidden"):
            return False
        if e.get("map") and e.get("token"):
            m = mp.find(self.campaign, e["map"])
            tok = next((t for t in (m or {}).get("tokens", []) if t.get("id") == e["token"]), None)
            if tok is not None and not mp.token_visible(m, tok, conn.pid, self._owners()):
                return False
        return True

    async def _events(self, evs: list[dict]) -> None:
        for x in list(self.conns):
            vis = [e for e in evs if self._ev_visible(x, e)]
            if vis:
                await self._send(x.ws, {"t": "cb_events", "events": vis})

    def _move_needs_ok(self, m: dict, tok: dict, old: tuple, new: tuple) -> bool:
        """Бой идёт и включён лимит: игрок двигает фишку не в свой ход или дальше своей скорости — нужен мастер."""
        c = self.campaign
        if not mp.move_limit(c):
            return False
        cb = gt.combat(c)
        if not cb.get("active") or not cb.get("cur"):
            return False
        e = next((x for x in cb["list"] if x.get("token") == tok.get("id") or (tok.get("char") and x.get("char") == tok.get("char"))), None)
        if e is None:
            return False
        if e["id"] != cb["cur"]:
            return True
        left = self._speed_of(e) - int((e.get("econ") or {}).get("mv") or 0)
        return self._r_terrain_cost(m, old, new, r5.dist_ft(m.get("grid") or {}, old, new)) > left

    async def _cb_track_move(self, m: dict, tok_id: str, old: tuple, new: tuple) -> None:
        """Ход: фишка того, чей ход, сдвинулась — копим потраченное движение."""
        c = self.campaign
        with c.lock:
            cb = gt.combat(c)
            if not cb.get("active") or not cb.get("cur"):
                return
            e = next((x for x in cb["list"] if x["id"] == cb["cur"]), None)
            tok = next((x for x in m.get("tokens", []) if x.get("id") == tok_id), None)
            if e is None or tok is None:
                return
            if not ((e.get("token") == tok_id) or (e.get("char") and e.get("char") == tok.get("char"))):
                return
            e.setdefault("econ", gt.clean_econ({}))
            e["econ"]["mv"] = min(9999, e["econ"].get("mv", 0) + self._r_terrain_cost(m, old, new, r5.dist_ft(m.get("grid") or {}, old, new)))
            c.touch()
        await self._push_combat()

    async def _conc_check(self, conn, r: dict, dmg: int, hidden: bool, pushes: dict, evs: list) -> None:
        """Урон по концентрирующемуся: спасбросок Телосложения СЛ max(10, урон/2), провал — концентрация спадает."""
        e = r["entry"]
        conc = (e or {}).get("conc") or ""
        if dmg <= 0 or not (conc or "concentration" in self._conds_of(r)):
            return
        dc = max(10, dmg // 2)
        bonus = self._save_of(r, "con")
        try:
            sr = await self._make_roll(conn, f"1d20{bonus:+d}", f"{r['name']}: концентрация · СЛ {dc}", "save",
                                       "normal", hidden, char_name=r["name"], gm_only=not self._is_pc(r))
        except dice.DiceError:
            return
        ok = sr["total"] >= dc
        cb = gt.combat(self.campaign)
        with self.campaign.lock:
            gt.cb_log(cb, "", hidden)
            cb["log"][-1].update(k="conc", who=r["name"], dc=dc, roll=sr["total"], ok=ok, spell=conc, secret=not self._is_pc(r))
            if not ok:
                if e is not None:
                    e["conc"] = ""
                self._cond_set(r, "concentration", False, pushes)
        evs.append({"k": "conc_ok" if ok else "conc_lost", "map": r["map"], "token": r["token"], "hidden": hidden})

    async def _cb_action(self, conn, t: str, data: dict, reply) -> None:
        c = self.campaign
        cb = gt.combat(c)
        pushes = {"chars": {}, "maps": {}}
        evs: list[dict] = []
        if t in ("cb_econ", "cb_effect", "cb_conc"):
            with c.lock:
                e = next((x for x in cb["list"] if x["id"] == data.get("id")), None)
                if e is None:
                    raise gt.ToolError("not_found")
                r = self._resolve({"e": e["id"]})
                if not self._can_act(conn, r):
                    raise gt.ToolError("no_access")
                if t == "cb_econ":
                    ec = gt.clean_econ(e.get("econ"))
                    if data.get("k") in gt.ECON_KEYS:
                        ec[data["k"]] = bool(data.get("v"))
                    if data.get("mv") is not None:
                        ec["mv"] = gt._int(data.get("mv"), 0, 9999, 0)
                    e["econ"] = ec
                elif t == "cb_effect":
                    if data.get("op") == "del":
                        ef = next((x for x in e.get("effects") or [] if x.get("id") == data.get("eid")), None)
                        e["effects"] = [x for x in e.get("effects") or [] if x.get("id") != data.get("eid")]
                        if ef and ef.get("cond") and not any(x.get("cond") == ef["cond"] for x in e["effects"]):
                            self._cond_set(r, ef["cond"], False, pushes)
                    else:
                        ef = gt.clean_effect(data.get("effect"))
                        if ef is None:
                            raise gt.ToolError("bad_request")
                        e.setdefault("effects", []).append(ef)
                        e["effects"] = e["effects"][-20:]
                        if ef.get("cond"):
                            self._cond_set(r, ef["cond"], True, pushes)
                        gt.cb_log(cb, "", e.get("hidden"))
                        cb["log"][-1].update(k="ef_add", who=e["name"], ef=ef["name"] or ef["cond"], cond=ef["cond"], rounds=ef["rounds"])
                else:
                    spell = gt._line(data.get("spell") or "", 60)
                    e["conc"] = spell
                    self._cond_set(r, "concentration", bool(spell), pushes)
                c.touch()
            await reply({})
            await self._flush(pushes)
            await self._push_combat()
            return

        src = self._resolve(data.get("src")) if data.get("src") else None
        if data.get("src") and src is None:
            raise gt.ToolError("not_found")
        if src is None and not conn.gm:
            raise gt.ToolError("no_access")
        if src is not None and not self._can_act(conn, src):
            raise gt.ToolError("no_access")
        hidden = conn.gm and (bool(data.get("hidden")) or bool(src and src["hidden"]))
        who = src["name"] if src else (data.get("who") or "")
        label = gt._line(data.get("label") or "", 60)
        # больше положенного (лишняя атака, второе действие…) — ждём решения мастера
        if t in ("cb_attack", "cb_save", "cb_heal"):
            with c.lock:
                why = self._over_limit(conn, t, src, data)
            if why and t == "cb_attack":
                # то, что нельзя по правилам вообще (далеко, полное укрытие), — отказ сразу, без мастера
                tgt_ = self._resolve(data.get("tgt"))
                atk_ = data.get("atk") if isinstance(data.get("atk"), dict) else {}
                rr_ = atk_.get("range") if isinstance(atk_.get("range"), list) else []
                if tgt_ is not None:
                    mods_ = self._r_attack(src, tgt_, atk_.get("rng") if atk_.get("rng") in ("melee", "ranged") else "",
                                           gt._int(atk_.get("reach"), 5, 100, 5),
                                           (gt._int(rr_[0] if rr_ else 0, 0, 2000, 0), gt._int(rr_[1] if len(rr_) > 1 else 0, 0, 5000, 0)))
                    if mods_["far"] is not None and not (data.get("oa") and self._oa_peek(src, tgt_)):
                        raise gt.ToolError("too_far")
                    if mods_["full"]:
                        raise gt.ToolError("full_cover")
            if why:
                await self._dec_request_action(conn, t, data, src, why, reply)
                return

        if t == "cb_attack":
            tgt = self._resolve(data.get("tgt"))
            if tgt is None:
                raise gt.ToolError("not_found")
            atk = data.get("atk") if isinstance(data.get("atk"), dict) else {}
            bonus = gt._int(atk.get("bonus"), -20, 40, 0)
            dmg = r5.clean_formula(atk.get("dmg"))
            name = gt._line(atk.get("name") or label or "Атака", 50)
            mode = data.get("mode") if data.get("mode") in ("adv", "dis") else "normal"
            # правила по положению фишек: досягаемость, помеха вплотную, состояния
            rng = atk.get("rng") if atk.get("rng") in ("melee", "ranged") else ""
            rr = atk.get("range") if isinstance(atk.get("range"), list) else []
            rmax = (gt._int(rr[0] if rr else 0, 0, 2000, 0), gt._int(rr[1] if len(rr) > 1 else 0, 0, 5000, 0))
            mods = self._r_attack(src, tgt, rng, gt._int(atk.get("reach"), 5, 100, 5), rmax)
            if data.get("oa") and self._oa_ok(src, tgt):
                mods["far"] = None          # атака по возможности — по месту, откуда цель ушла
            if mods["far"] is not None and not conn.gm and not data.get("force"):
                raise gt.ToolError("too_far")
            if mods["full"] and not conn.gm:
                raise gt.ToolError("full_cover")
            mode = self._r_mode(mode, mods)
            try:
                ar = await self._make_roll(conn, f"1d20{bonus:+d}", f"{who} → {tgt['name']}: {name}", "attack", mode, hidden, char_name=who)
            except dice.DiceError:
                raise gt.ToolError("bad_formula")
            ac = self._ac_of(tgt)
            if ac is not None and mods["ac"]:
                ac += mods["ac"]
            crit, fumble = bool(ar.get("crit")), bool(ar.get("fumble"))
            hit = not fumble and (crit or ac is None or ar["total"] >= ac)
            crit = crit or (hit and mods["crit"])
            total = 0
            mult = 1.0
            if hit and dmg:
                try:
                    dr = await self._make_roll(conn, r5.crit_formula(dmg) if crit else dmg, f"{who} → {tgt['name']}: {name} · урон",
                                               "damage", "normal", hidden, char_name=who)
                    mult = r5.resist_mult(tgt.get("mon_doc"), r5.dmg_type(atk.get("dtype") or "") or r5.dmg_type(name))
                    total = max(0, int(dr["total"] * mult))
                except dice.DiceError:
                    total = 0
            with c.lock:
                hp = self._damage(tgt, total, pushes, crit=crit) if total else None
                if src and src["entry"] is not None and cb.get("active") and data.get("spend", True):
                    src["entry"].setdefault("econ", gt.clean_econ({}))[data.get("cost") if data.get("cost") in gt.ECON_KEYS else "a"] = True
                    if (data.get("cost") or "a") == "a" and not atk.get("spell"):
                        src["entry"]["econ"]["atk"] = int(src["entry"]["econ"].get("atk") or 0) + 1
                gt.cb_log(cb, "", hidden)
                cb["log"][-1].update(k="atk", who=who, tgt=tgt["name"], atk=name, roll=ar["total"], ac=ac, hit=hit, crit=crit,
                                     fumble=fumble, dmg=total, mult=mult, hp=hp, why=mods["adv"] + mods["dis"], mode=mode)
                c.touch()
            evs.append({"k": "crit" if crit and hit else "hit" if hit else "miss", "map": tgt["map"], "token": tgt["token"],
                        "rng": "spell" if atk.get("spell") else ("ranged" if atk.get("rng") == "ranged" else "melee"),
                        "dmg": total, "mult": mult, "hidden": hidden})
            with c.lock:
                ammo_left = self._use_ammo(src, str(atk.get("ammo") or ""))
                for dd in getattr(self, "_pending_chars", {}).values():
                    pushes["chars"][dd["id"]] = dd
                self._pending_chars = {}
            await reply({"hit": hit, "crit": crit, "dmg": total, "mode": mode, "adv": mods["adv"], "dis": mods["dis"], "far": mods["far"],
                         "cover": mods["ac"], "full": mods["full"], "ammo": ammo_left})
            # спрятавшийся выдал себя атакой
            if src:
                ms_, st_ = self._r_tok(src)
                if st_ is not None and "hiding" in self._r_conds(st_):
                    with c.lock:
                        self._r_reveal(ms_, st_, pushes)
            await self._lz_attack(src["entry"]["id"] if src and src["entry"] is not None else None, hit, crit, hidden)
            await self._conc_check(conn, tgt, total, hidden, pushes, evs)

        elif t == "cb_save":
            tg = data.get("tgts") if isinstance(data.get("tgts"), list) else []
            tgts = [x for x in (self._resolve(s) for s in tg[:30]) if x]
            if not tgts:
                raise gt.ToolError("not_found")
            ab = data.get("ab") if data.get("ab") in r5.ABILS else "dex"
            dc = gt._int(data.get("dc"), 1, 40, 10)
            dmg = r5.clean_formula(data.get("dmg"))
            half = bool(data.get("half", True))
            name = label or "Спасбросок"
            base = 0
            if dmg:
                try:
                    dr = await self._make_roll(conn, dmg, f"{who + ': ' if who else ''}{name} · урон", "damage", "normal", hidden, char_name=who)
                    base = dr["total"]
                except dice.DiceError:
                    base = 0
            results = []
            for tg_r in tgts:
                bonus = self._save_of(tg_r, ab)
                if ab == "dex" and self._rules_on():          # укрытие помогает спасброскам Ловкости
                    _m, _t = self._r_tok(tg_r)
                    tcs = self._r_conds(_t) if _t else set(self._conds_of(tg_r))
                    bonus += 5 if "cover_3q" in tcs else 2 if "cover_half" in tcs else 0
                th = hidden or tg_r["hidden"] and conn.gm
                try:
                    secret = not self._is_pc(tg_r)       # спасброски противников и НИП видит только мастер
                    sr = await self._make_roll(conn, f"1d20{bonus:+d}", f"{tg_r['name']}: спасбросок {AB_RU[ab]} · СЛ {dc}", "save",
                                               "normal", th, char_name=tg_r["name"], gm_only=secret)
                except dice.DiceError:
                    continue
                ok = sr["total"] >= dc
                mult = r5.resist_mult(tg_r.get("mon_doc"), r5.dmg_type(data.get("dtype") or "") or r5.dmg_type(name))
                amount = int((base // 2 if half else 0) * mult) if ok else int(base * mult)
                with c.lock:
                    hp = self._damage(tg_r, amount, pushes) if amount else None
                    gt.cb_log(cb, "", th)
                    cb["log"][-1].update(k="save", who=who, tgt=tg_r["name"], spell=name, ab=ab, dc=dc, roll=sr["total"], ok=ok,
                                         dmg=amount, hp=hp, secret=secret)
                evs.append({"k": "save_ok" if ok else "save_fail", "map": tg_r["map"], "token": tg_r["token"], "dmg": amount, "hidden": th})
                results.append({"name": tg_r["name"], "ok": ok, "dmg": amount})
                await self._conc_check(conn, tg_r, amount, th, pushes, evs)
            with c.lock:
                if src and src["entry"] is not None and cb.get("active") and data.get("spend", True):
                    src["entry"].setdefault("econ", gt.clean_econ({}))[data.get("cost") if data.get("cost") in gt.ECON_KEYS else "a"] = True
                c.touch()
            await reply({"results": results})

        elif t == "cb_heal":
            tgt = self._resolve(data.get("tgt"))
            if tgt is None:
                raise gt.ToolError("not_found")
            f = r5.clean_formula(data.get("amount"))
            try:
                hr = await self._make_roll(conn, f, f"{who} → {tgt['name']}: {label or 'лечение'}", "free", "normal", hidden, char_name=who)
            except dice.DiceError:
                raise gt.ToolError("bad_formula")
            amount = max(0, hr["total"])
            with c.lock:
                hp = self._damage(tgt, -amount, pushes)
                if src and src["entry"] is not None and cb.get("active") and data.get("spend", True):
                    src["entry"].setdefault("econ", gt.clean_econ({}))[data.get("cost") if data.get("cost") in gt.ECON_KEYS else "a"] = True
                gt.cb_log(cb, "", hidden)
                cb["log"][-1].update(k="heal", who=who, tgt=tgt["name"], spell=label, amount=amount, hp=hp)
                c.touch()
            evs.append({"k": "heal", "map": tgt["map"], "token": tgt["token"], "dmg": amount, "hidden": hidden})
            await reply({"amount": amount})

        # заклинание или лечение тоже выдаёт спрятавшегося (атака — выше)
        if src and t in ("cb_save", "cb_heal"):
            ms_, st_ = self._r_tok(src)
            if st_ is not None and "hiding" in self._r_conds(st_):
                with c.lock:
                    self._r_reveal(ms_, st_, pushes)
        # концентрация на новом заклинании
        conc = gt._line(data.get("conc") or "", 60)
        if conc and src and src["entry"] is not None:
            with c.lock:
                src["entry"]["conc"] = conc
                self._cond_set(src, "concentration", True, pushes)
        await self._flush(pushes)
        await self._events(evs)
        await self._push_combat()
        if t in ("cb_attack", "cb_save"):
            await self._r_grapple_check(None, None)      # схвативший упал/умер — захват снимается

    # ------------------------------------------------------------------ сообщения
    async def _gm_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")
        if t in GM_ONLY and not conn.gm:
            raise gt.ToolError("no_access")

        async def reply(extra: dict) -> None:
            await self._send(conn.ws, {"t": "ok", "rid": rid, **extra})

        # --- бестиарий
        if t == "mon_list":
            await self._push_mon_list()
            return
        if t == "mon_get":
            with c.lock:
                m = copy.deepcopy(gt.find_monster(c, data.get("id")))
            if m is None:
                raise gt.ToolError("not_found")
            await reply({"monster": m})
            return
        if t == "mon_save":
            m = gt.save_monster(c, data.get("monster"))
            await reply({"monster": m})
            await self._push_mon_list()
            return
        if t == "mon_del":
            gt.delete_monster(c, data.get("id"))
            await reply({})
            await self._push_mon_list()
            return
        if t == "ttg_search":
            q = str(data.get("q", "")).strip()[:60]
            page = gt._int(data.get("page"), 0, 50, 0)
            res = await self._ttg_post("/api/v1/bestiary", {
                "page": page, "size": 40, "search": {"value": q, "exact": False},
                "order": [{"field": "challengeRating", "direction": "asc"}, {"field": "name", "direction": "asc"}]})
            items = [x for x in (gt.ttg_list_item(i) for i in (res if isinstance(res, list) else [])) if x]
            await reply({"items": items})
            return
        if t == "ttg_import":
            slug = re.sub(r"[^a-z0-9_\-']", "", str(data.get("slug", "")).lower())[:120]
            if not slug:
                raise gt.ToolError("not_found")
            raw = await self._ttg_post("/api/v1/bestiary/" + slug, {})
            parsed = gt.from_ttg(raw, TTG_BASE)
            mon = parsed["monster"]
            paths.log(f"ttg import {slug}: images {parsed['images'][:4]}")
            for url in self._image_candidates(parsed["images_raw"])[:6]:   # первая — круглый жетон, если есть
                aid = await self._fetch_image(url)
                if aid:
                    mon["img"] = aid
                    break
            with c.lock:   # тот же монстр уже есть — обновляем
                old = next((m for m in gt.monsters(c) if m.get("url") and m.get("url") == mon["url"]), None)
                if old:
                    mon["id"] = old["id"]
            mon = gt.save_monster(c, mon)
            await reply({"monster": mon})
            await self._push_mon_list()
            return
        if t == "mon_tokens":
            mon = gt.find_monster(c, data.get("mon"))
            m = mp.find(c, str(data.get("map", "")))
            if mon is None or m is None:
                raise gt.ToolError("not_found")
            spots = data.get("spots") if isinstance(data.get("spots"), list) else []
            n = gt._int(data.get("count"), 1, 30, 1)
            with c.lock:
                for i in range(n):
                    hp = self._hp_roll(mon) if data.get("roll_hp") else int(mon.get("hp") or 1)
                    p = spots[i] if i < len(spots) and isinstance(spots[i], dict) else {"x": 0, "y": 0}
                    tok = mp.clean_token({"name": mon["name"] + (f" {i + 1}" if n > 1 else ""), "x": p.get("x"), "y": p.get("y"),
                                          "s": gt.SIZE_CELLS.get(mon.get("size"), 1), "color": "#ef4444", "img": mon.get("img", ""),
                                          "hp": {"cur": hp, "max": hp}, "hidden": bool(data.get("hidden")), "mon": mon["id"]})
                    if len(m.setdefault("tokens", [])) < mp.MAX_TOKENS:
                        m["tokens"].append(tok)
                c.touch()
            await reply({})
            await self._push_map(m)
            return

        # --- приёмы боя: захват, толчок, высвободиться, спрятаться, стабилизировать
        if t == "cb_maneuver":
            await self._r_maneuver(conn, data, reply)
            return

        # --- настройки кампании (режим повышения уровня) и выдача опыта
        if t in ("cfg_get", "cfg_set"):
            with c.lock:
                cfg = c.extra.get("cfg") if isinstance(c.extra.get("cfg"), dict) else {}
                if t == "cfg_set":
                    if data.get("lvl_mode") in ("xp", "milestone", "free"):
                        cfg["lvl_mode"] = data["lvl_mode"]
                    c.extra["cfg"] = cfg
                    c.touch()
                msg = {"t": "camp_cfg", "lvl_mode": cfg.get("lvl_mode", "xp")}
            if t == "cfg_get":
                await self._send(conn.ws, msg)
            else:
                await reply({})
                await self._broadcast(msg)
            return
        if t == "xp_award":
            ids = [str(x)[:40] for x in (data.get("chars") or []) if isinstance(x, str)][:20]
            each = gt._int(data.get("each"), -1000000, 1000000, 0)
            lvl = bool(data.get("lvl"))
            reason = gt._line(data.get("reason") or "", 80)
            got = []
            with c.lock:
                for cid in ids:
                    d = ch.find(c, cid)
                    if d is None:
                        continue
                    ops = []
                    if each:
                        ops.append({"op": "set", "path": ["xp"], "value": max(0, int(d.get("xp") or 0) + each)})
                    if lvl:
                        ops.append({"op": "inc", "path": ["lvl_ok"], "value": 1})
                    if ops:
                        d = ch.patch(c, cid, ops)
                        got.append(d)
            await reply({"n": len(got)})
            if got and each:
                self._chron("xp", f"Опыт +{each}: {', '.join(d.get('name') for d in got)}" + (f" ({reason})" if reason else ""))
            for d in got:
                await self._send_char(d)
                await self._push_summary(d)
            await self._broadcast({"t": "xp_note", "each": each, "lvl": lvl, "reason": reason,
                                   "names": [d.get("name") for d in got], "ids": [d["id"] for d in got]})
            return

        # --- валюта кампании (названия монет и курсы обмена)
        if t in ("cur_get", "cur_set"):
            with c.lock:
                if t == "cur_set":
                    c.extra["currency"] = gt.clean_currency(data.get("units"))
                    c.touch()
                msg = {"t": "currency", "units": copy.deepcopy(gt.currency(c))}
            if t == "cur_get":
                await self._send(conn.ws, msg)
            else:
                await reply({})
                await self._broadcast(msg)
            return

        # --- правила боя по положению фишек: вкл/выкл
        if t == "cb_rules":
            with c.lock:
                gt.combat(c)["rules"] = bool(data.get("on"))
                c.touch()
            await reply({})
            await self._push_combat()
            return

        # --- стиль кубиков: мастер выдаёт цвет и след себе и игрокам, видят все
        if t == "dice_styles":
            with c.lock:
                msg = {"t": "dice_styles", "styles": copy.deepcopy(gt.dice_styles(c))}
            await self._send(conn.ws, msg)
            return
        if t == "dice_style_set":
            who = str(data.get("who", ""))[:40]
            with c.lock:
                if who != "gm" and not any(p.id == who for p in c.players):
                    raise gt.ToolError("not_found")
                styles = gt.dice_styles(c)
                st = gt.clean_dice_style(data.get("style"))
                if st is None:
                    styles.pop(who, None)
                else:
                    styles[who] = st
                c.touch()
                msg = {"t": "dice_styles", "styles": copy.deepcopy(styles)}
            await reply({})
            for x in list(self.conns):
                await self._send(x.ws, msg)
            return

        # --- группы фишек
        if t.startswith("grp_"):
            g = None
            with c.lock:
                lst = gt.groups(c)
                if t == "grp_save":
                    gd = data.get("group") if isinstance(data.get("group"), dict) else {}
                    old = next((x for x in lst if x.get("id") == gd.get("id")), None)
                    g = gt.clean_group(gd, old)
                    if old:
                        lst[lst.index(old)] = g
                    else:
                        if len(lst) >= gt.MAX_GROUPS:
                            raise gt.ToolError("too_many")
                        lst.append(g)
                    c.touch()
                elif t == "grp_del":
                    c.extra["groups"] = [x for x in lst if x.get("id") != data.get("id")]
                    c.touch()
            await reply({"group": g} if g else {})
            await self._push_groups()
            return

        # --- бой
        if t == "cb_get":
            await self._send(conn.ws, {**self._combat_payload(conn), "rid": rid})
            return
        if t == "cb_next":
            with c.lock:
                cb = gt.combat(c)
                cur = next((e for e in cb["list"] if e["id"] == cb.get("cur")), None)
                mine = cur and cur.get("char") and (ch.find(c, cur["char"]) or {}).get("owner") == conn.pid
                if not conn.gm and not mine:
                    raise gt.ToolError("no_access")
                if not conn.gm:
                    # игрок только просит закончить ход — переход делает мастер (подтверждает)
                    cb["end_req"] = cur["id"]
                    c.touch()
                    req_name = cur["name"]
                    if not cb.get("end_dec"):
                        cb["end_dec"] = self._dec_add("end", cur["name"], {})["id"]
                else:
                    if cb.get("end_dec"):
                        dd = self._dec_find(cb["end_dec"])
                        if dd and cur:
                            dd.update(state="ok", undo={"cur": cur["id"], "round": cb.get("round"), "econ": copy.deepcopy(cur.get("econ"))})
                        cb["end_dec"] = None
                    cb["end_req"] = None
                    tick_prev = cb.get("cur")
                    end_pushes = self._turn_ended(cb)
                    gt.advance(cb, 1)
                    pushes = self._turn_started(cb)
                    for k in ("chars", "maps"):
                        for kk, vv in end_pushes[k].items():
                            pushes[k].setdefault(kk, vv)
                    c.touch()
            await reply({})
            await self._dec_push()
            if not conn.gm:
                for x in list(self.conns):
                    if x.gm:
                        await self._send(x.ws, {"t": "cb_events", "events": [{"k": "end_req", "who": req_name}]})
                await self._push_combat()
                return
            await self._flush(pushes)
            await self._push_combat()
            await self._r_grapple_check(None, None)
            await self._effect_ticks(conn, tick_prev, cb.get("cur"))
            await self._r_death_turn()
            fired, self._w_fired = getattr(self, "_w_fired", []), []
            if fired:
                for x in fired:
                    await self._w_timer_done(x)
                await self._w_push()
            soon, self._w_soon = getattr(self, "_w_soon", []), []
            for x in soon:
                await self._w_timer_note(x, "soon")
            return
        if t == "cb_endno":
            with c.lock:
                gt.combat(c)["end_req"] = None
                dd = self._dec_find(gt.combat(c).pop("end_dec", None) or "")
                if dd:
                    dd["state"] = "no"
            await self._dec_push()
            await reply({})
            await self._push_combat()
            return
        if t in CB_ACTIONS:
            await self._cb_action(conn, t, data, reply)
            return
        with c.lock:
            cb = gt.combat(c)
            push_map = None
            changed_char = None
            xp_offer = None
            if t == "cb_start":
                mid = str(data.get("map") or mp.active_id(c) or "")
                m = mp.find(c, mid)
                lst = []
                seen_chars = set()
                if m:
                    for tok in m.get("tokens", []):
                        if tok.get("char"):
                            seen_chars.add(tok["char"])
                            lst.append(gt.clean_entry({"name": tok.get("name"), "kind": "pc", "char": tok["char"],
                                                       "map": mid, "token": tok["id"], "dex": self._pc_dex(tok["char"])}))
                        elif data.get("npcs", True):
                            dex = self._dex_for(tok.get("mon", ""))
                            mon = gt.find_monster(c, tok.get("mon", ""))
                            lst.append(gt.clean_entry({"name": tok.get("name"), "kind": "npc", "map": mid, "token": tok["id"],
                                                       "mon": tok.get("mon", ""), "dex": dex, "hidden": tok.get("hidden"),
                                                       "ac": mon["ac"] if mon else None,
                                                       "init": gt.roll_init(dex) if data.get("roll", True) else None}))
                if data.get("pcs", True):
                    online = {p.id for p in c.players}
                    for d in ch.chars(c):
                        if isinstance(d, dict) and d.get("owner") in online and d.get("id") not in seen_chars:
                            lst.append(gt.clean_entry({"name": d.get("name"), "kind": "pc", "char": d["id"], "dex": self._pc_dex(d["id"])}))
                cb.update(active=True, round=1, cur=None, list=lst[:gt.MAX_COMBAT], log=[])
                cb.pop("_tr", None)
                gt.advance(cb, 0)
                cb["cur"] = None          # ход начнётся, когда мастер нажмёт «Начать» (после бросков инициативы)
                gt.cb_log(cb, "")
                cb["log"][-1].update(k="start")
                foes = [e.get("name") for e in cb["list"] if e.get("kind") != "pc"][:8]
                self._chron("combat", "Начался бой" + (f": {', '.join(foes)}" if foes else ""))
            elif t == "cb_end":
                # опыт за бой: сумма опыта побеждённых монстров — мастеру предложим раздать
                xp_total, defeated, pcs = 0, [], []
                pids = {p.id for p in c.players}
                for e in cb.get("list") or []:
                    if e.get("char"):
                        d = ch.find(c, e["char"])
                        if d and d.get("owner") in pids:
                            pcs.append(e["char"])
                        continue
                    r = self._resolve({"e": e["id"]})
                    _m, tk = self._r_tok(r) if r else (None, None)
                    hp = (tk or e).get("hp") or {}
                    down = (hp.get("max") and int(hp.get("cur") or 0) <= 0) or "dead" in ((tk or {}).get("conds") or [])
                    mon = gt.find_monster(c, e.get("mon") or (tk or {}).get("mon")) if (e.get("mon") or (tk or {}).get("mon")) else None
                    if down and mon:
                        xp_total += int(mon.get("xp") or 0)
                        defeated.append(e.get("name") or mon.get("name"))
                xp_offer = {"t": "cb_xp", "xp": xp_total, "defeated": defeated, "pcs": pcs}
                self._chron("combat", "Бой окончен" + (f": побеждены {', '.join(defeated[:10])}" if defeated else ""))
                cb.update(active=False, round=0, cur=None, list=[], end_req=None)
            elif t == "cb_add":
                if len(cb["list"]) >= gt.MAX_COMBAT:
                    raise gt.ToolError("too_many")
                e = gt.clean_entry(data.get("entry"))
                if e.get("mon") and e["init"] is None and data.get("roll"):
                    e["init"] = gt.roll_init(self._dex_for(e["mon"]))
                cb["list"].append(e)
                cb["active"] = True
            elif t == "cb_set":
                e = next((x for x in cb["list"] if x["id"] == data.get("id")), None)
                if e is None:
                    raise gt.ToolError("not_found")
                e.update(gt.clean_entry(data.get("fields"), e))
                if isinstance(data.get("fields"), dict) and "init" in data["fields"]:
                    e.pop("tb", None)
            elif t == "cb_move":
                # поменять очередь: участник встаёт на место соседа (выше/ниже), остальные сдвигаются
                seq = gt.order(cb)
                i = next((k for k, x in enumerate(seq) if x["id"] == data.get("id")), None)
                if i is None:
                    raise gt.ToolError("not_found")
                j = gt._int(data.get("to"), 0, len(seq) - 1, i) if data.get("to") is not None else i + (1 if data.get("dir") == "down" else -1)
                j = max(0, min(len(seq) - 1, j))
                if j != i:
                    e = seq.pop(i)
                    seq.insert(j, e)
                    # инициатива — как у соседа, а порядок при равенстве задаёт «tb»
                    nb = seq[j + 1] if j + 1 < len(seq) else seq[j - 1] if j > 0 else None
                    if nb is not None and nb.get("init") is not None:
                        e["init"] = nb["init"]
                    elif e.get("init") is None:
                        e["init"] = 0
                    for k, x in enumerate(seq):
                        x["tb"] = len(seq) - k
            elif t == "cb_cur":
                e = next((x for x in cb["list"] if x["id"] == data.get("id")), None)
                if e is None:
                    raise gt.ToolError("not_found")
                cb["cur"] = e["id"]
                cb["end_req"] = None
                cb["round"] = max(1, int(cb.get("round") or 1))
                self._turn_started(cb)
            elif t == "cb_del":
                if cb.get("cur") == data.get("id"):
                    gt.advance(cb, 1)
                cb["list"] = [x for x in cb["list"] if x["id"] != data.get("id")]
                if not cb["list"]:
                    cb["cur"] = None
            elif t == "cb_roll":
                for e in cb["list"]:
                    if e.get("kind") == "npc" and (e.get("init") is None or data.get("all")):
                        e["init"] = gt.roll_init(e.get("dex") or self._dex_for(e.get("mon", "")))
            elif t == "cb_prev":
                gt.advance(cb, -1)
                cb["end_req"] = None
            elif t == "cb_hp":
                e = next((x for x in cb["list"] if x["id"] == data.get("id")), None)
                if e is None:
                    raise gt.ToolError("not_found")
                delta = gt._int(data.get("delta"), -99999, 99999, 0) if data.get("delta") is not None else None
                value = gt._int(data.get("value"), -99999, 99999, 0) if data.get("value") is not None else None
                if delta is None and value is None:
                    raise gt.ToolError("bad_request")
                kind, obj = self._hp_apply(e, delta, value)
                if kind == "map":
                    push_map = obj
                elif kind == "char":
                    changed_char = obj
            # --- раздатки
            elif t == "ho_list":
                pass
            elif t == "ho_save":
                lst = gt.handouts(c)
                hd = data.get("handout") if isinstance(data.get("handout"), dict) else {}
                old = next((x for x in lst if x["id"] == hd.get("id")), None)
                h = gt.clean_handout(hd, old)
                if old:
                    lst[lst.index(old)] = h
                else:
                    if len(lst) >= gt.MAX_HANDOUTS:
                        raise gt.ToolError("too_many")
                    lst.append(h)
            elif t == "ho_del":
                c.extra["handouts"] = [x for x in gt.handouts(c) if x["id"] != data.get("id")]
            elif t == "ho_share":
                h = next((x for x in gt.handouts(c) if x["id"] == data.get("id")), None)
                if h is None:
                    raise gt.ToolError("not_found")
                h["to"] = gt.clean_handout({"to": data.get("to")}, h)["to"]
                h["ts"] = int(time.time())
            # --- заметки
            elif t == "notes":
                pass
            elif t == "note_save":
                lst = gt.notes(c)
                nd = data.get("note") if isinstance(data.get("note"), dict) else {}
                old = next((x for x in lst if isinstance(x, dict) and x.get("id") == nd.get("id")), None)
                n = gt.clean_note(nd, old)
                if old:
                    lst[lst.index(old)] = n
                else:
                    if len(lst) >= gt.MAX_NOTES:
                        raise gt.ToolError("too_many")
                    lst.append(n)
                await_note = n
            elif t == "note_del":
                c.extra["notes"] = [x for x in gt.notes(c) if not (isinstance(x, dict) and x.get("id") == data.get("id"))]
            if t not in ("ho_list", "notes"):
                c.touch()

        if t.startswith("cb_"):
            await reply({})
            if push_map is not None:
                await self._push_map(push_map)
            if changed_char is not None:
                await self._send_char(changed_char)
                await self._push_summary(changed_char)
            await self._push_combat()
            if xp_offer and xp_offer["pcs"]:
                await self._send(conn.ws, xp_offer)
        elif t.startswith("ho_"):
            if t == "ho_list":
                await self._send(conn.ws, {**self._handouts_payload(conn), "rid": rid})
            else:
                await reply({})
                await self._push_handouts()
                if t == "ho_share":
                    with c.lock:
                        h = copy.deepcopy(next((x for x in gt.handouts(c) if x["id"] == data.get("id")), {}))
                    for x in list(self.conns):
                        if not x.gm and h and gt.handout_visible(h, x.pid):
                            await self._send(x.ws, {"t": "handout_new", "id": h["id"], "title": h["title"]})
        elif t.startswith("note"):
            if t == "notes":
                await self._push_notes()
            else:
                await reply({"note": await_note} if t == "note_save" else {})
                await self._push_notes()
