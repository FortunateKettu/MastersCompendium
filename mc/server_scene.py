"""Сцены вне боя и заметки игроков.

  привал — персонажи игроков (и кого мастер добавит) сидят вокруг костра и могут делать друг другу визуальные
           действия: обнять, дать пощёчину, полечить, ударить… Это только картинка — на хиты не влияет;
  диалог — слева персонажи игроков, справа НИП и противники крупными портретами с именами, мастер отмечает,
           кто говорит, и может вывести реплику;
  заметки игроков — у каждого свои, можно привязать к НИП («с кем мы говорили»).
"""
from __future__ import annotations

import copy
import re
import time

from . import characters as ch
from . import gmtools as gt
from . import maps as mp

ACTS = {"hug", "slap", "heal", "punch", "highfive", "cheers", "poke", "kiss", "bow", "sleep", "sing", "cheer", "dance", "cry"}
MAX_NPCS = 12
MAX_PNOTES = 200
FX_GAP = 0.6          # не чаще раза в 0,6 с от одного участника


class SceneMixin:
    # ------------------------------------------------------------------ состояние
    def _scene(self) -> dict:
        c = self.campaign
        s = c.extra.get("scene")
        if not isinstance(s, dict):
            s = c.extra["scene"] = {"mode": "off", "npcs": [], "pcs": [], "say": None, "title": ""}
        return s

    def _sc_ref(self, ref) -> dict | None:
        """Ссылка на участника → {key, name, img, color, side, owner}."""
        c = self.campaign
        if not isinstance(ref, dict):
            return None
        kind = ref.get("t")
        if kind == "char":
            d = ch.find(c, str(ref.get("id", "")))
            if d is None:
                return None
            pids = {p.id: p for p in c.players}
            owner = d.get("owner") if d.get("owner") in pids else ""
            portrait = str(d.get("portrait") or "")
            return {"key": "c:" + d["id"], "name": d.get("name") or "?", "img": portrait if len(portrait) < 120_000 else "",
                    "color": pids[owner].color if owner else "#f5c542", "side": "pc" if owner else "npc", "owner": owner, "char": d["id"]}
        if kind == "mon":
            m = gt.find_monster(c, str(ref.get("id", "")))
            if m is None:
                return None
            name = gt._line(ref.get("name") or m.get("name") or "?", 40)
            return {"key": "m:" + m["id"] + ":" + name, "name": name, "img": "/asset/" + m["img"] if m.get("img") else "",
                    "color": "#ef4444", "side": "npc", "owner": ""}
        if kind == "tok":
            m = mp.find(c, str(ref.get("map", "")))
            tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == ref.get("id")), None)
            if tok is None:
                return None
            if tok.get("char"):
                return self._sc_ref({"t": "char", "id": tok["char"]})
            img = "/asset/" + tok["img"] if tok.get("img") else ""
            if not img and tok.get("mon"):
                mon = gt.find_monster(c, tok["mon"]) or {}
                img = "/asset/" + mon["img"] if mon.get("img") else ""
            return {"key": "t:" + tok["id"], "name": tok.get("name") or "?", "img": img, "color": tok.get("color") or "#ef4444",
                    "side": "npc", "owner": ""}
        if kind == "free":
            name = gt._line(ref.get("name") or "", 40)
            if not name:
                return None
            img = ref.get("img") if isinstance(ref.get("img"), str) and re.fullmatch(r"[a-f0-9]{8,40}\.\w{3,4}", ref.get("img") or "") else ""
            return {"key": "f:" + name, "name": name, "img": "/asset/" + img if img else "", "color": "#94a3b8", "side": "npc", "owner": ""}
        return None

    def _sc_payload(self) -> dict:
        c = self.campaign
        with c.lock:
            s = copy.deepcopy(self._scene())
            pids = {p.id for p in c.players}
            if s["mode"] == "camp":
                pcs = [d["id"] for d in ch.chars(c) if isinstance(d, dict) and d.get("owner") in pids]
            else:
                pcs = list(s.get("pcs") or []) or [d["id"] for d in ch.chars(c) if isinstance(d, dict) and d.get("owner") in pids]
            members = [x for x in (self._sc_ref({"t": "char", "id": cid}) for cid in pcs) if x]
            members += [x for x in (self._sc_ref(r) for r in s.get("npcs") or []) if x]
            met = copy.deepcopy(c.extra.get("scene_met") or [])
        return {"t": "scene", "mode": s["mode"], "title": s.get("title") or "", "members": members, "say": s.get("say"), "met": met,
                "refs": s.get("npcs") or [], "pcs": s.get("pcs") or []}

    def _sc_remember(self) -> None:
        """Кого игроки видели в диалогах — для заметок «о ком»."""
        c = self.campaign
        with c.lock:
            met = c.extra.get("scene_met") if isinstance(c.extra.get("scene_met"), list) else []
            for r in self._scene().get("npcs") or []:
                x = self._sc_ref(r)
                if x and not any(y.get("key") == x["key"] for y in met):
                    met.append({"key": x["key"], "name": x["name"], "img": x["img"] if not x["img"].startswith("data:") else "", "color": x["color"]})
            c.extra["scene_met"] = met[-100:]

    # ------------------------------------------------------------------ сообщения
    async def _scene_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")

        async def reply(extra: dict | None = None) -> None:
            await self._send(conn.ws, {"t": "ok", "rid": rid, **(extra or {})})

        if t == "sc_get":
            await self._send(conn.ws, {**self._sc_payload(), "rid": rid})
            return
        if t == "sc_set":
            if not conn.gm:
                raise gt.ToolError("no_access")
            with c.lock:
                s = self._scene()
                if data.get("mode") in ("off", "camp", "talk"):
                    s["mode"] = data["mode"]
                    s["say"] = None
                if isinstance(data.get("npcs"), list):
                    s["npcs"] = [r for r in data["npcs"] if isinstance(r, dict) and self._sc_ref(r)][:MAX_NPCS]
                if isinstance(data.get("pcs"), list):
                    s["pcs"] = [str(x)[:40] for x in data["pcs"] if ch.find(c, str(x))][:12]
                if "title" in data:
                    s["title"] = gt._line(data.get("title") or "", 60)
                c.touch()
            if self._scene()["mode"] == "talk":
                self._sc_remember()
                names = [x["name"] for x in self._sc_payload()["members"] if x.get("side") != "pc"]
                if names and data.get("mode") == "talk":
                    self._chron("talk", "Разговор: " + ", ".join(names[:6]))
            await reply()
            await self._broadcast(self._sc_payload())
            if data.get("call"):
                await self._broadcast({"t": "sc_call", "mode": self._scene()["mode"]})
            return
        if t == "sc_say":
            key = str(data.get("key", ""))[:80]
            text = gt._line(data.get("text") or "", 200)
            pay = self._sc_payload()
            mem = next((x for x in pay["members"] if x["key"] == key), None)
            if not conn.gm and (mem is None or mem.get("owner") != conn.pid):
                raise gt.ToolError("no_access")
            with c.lock:
                s = self._scene()
                s["say"] = None if not key or (s.get("say") or {}).get("key") == key and not text else {"key": key, "text": text, "ts": time.time()}
                c.touch()
            await reply()
            await self._broadcast(self._sc_payload())
            return
        if t == "sc_fx":
            act = data.get("act")
            if act not in ACTS:
                raise gt.ToolError("bad_request")
            pay = self._sc_payload()
            if pay["mode"] == "off":
                raise gt.ToolError("bad_request")
            src = next((x for x in pay["members"] if x["key"] == data.get("from")), None)
            dst = next((x for x in pay["members"] if x["key"] == data.get("to")), None) if data.get("to") else None
            if src is None or (data.get("to") and dst is None):
                raise gt.ToolError("not_found")
            if not conn.gm and src.get("owner") != conn.pid:
                raise gt.ToolError("no_access")
            last = getattr(self, "_sc_last", {})
            now = time.monotonic()
            if now - last.get(src["key"], 0) < FX_GAP:
                await reply()
                return
            last[src["key"]] = now
            self._sc_last = last
            await reply()
            await self._broadcast({"t": "sc_fx", "from": src["key"], "to": dst["key"] if dst else "", "act": act,
                                   "a": src["name"], "b": dst["name"] if dst else ""})
            return

        # --- заметки игрока (у каждого свои; мастер своих заметок тут не ведёт)
        key = "gm" if conn.gm else conn.pid
        with c.lock:
            allp = c.extra.get("pnotes") if isinstance(c.extra.get("pnotes"), dict) else {}
            c.extra["pnotes"] = allp
            mine = allp.setdefault(key, [])
            if t == "pn_save":
                n = data.get("note") if isinstance(data.get("note"), dict) else {}
                old = next((x for x in mine if x.get("id") == n.get("id")), None)
                about = n.get("about") if isinstance(n.get("about"), dict) else None
                if about:
                    about = {"key": gt._line(about.get("key") or "", 80), "name": gt._line(about.get("name") or "", 40),
                             "img": str(about.get("img") or "")[:200] if not str(about.get("img") or "").startswith("data:") else "",
                             "color": about.get("color") if isinstance(about.get("color"), str) and gt.HEX_RE.fullmatch(about["color"]) else "#94a3b8"}
                note = {"id": old["id"] if old else gt.uid(), "title": gt._line(n.get("title") or "", 80),
                        "text": gt._s(n.get("text") or "", 20000), "about": about, "ts": int(time.time())}
                if old:
                    mine[mine.index(old)] = note
                else:
                    if len(mine) >= MAX_PNOTES:
                        raise gt.ToolError("too_many")
                    mine.append(note)
                c.touch()
            elif t == "pn_del":
                allp[key] = [x for x in mine if x.get("id") != data.get("id")]
                c.touch()
            elif t != "pn_list":
                raise gt.ToolError("bad_request")
            lst = copy.deepcopy(allp.get(key) or [])
        await self._send(conn.ws, {"t": "pnotes", "notes": lst, "rid": rid})
