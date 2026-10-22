"""Решения мастера: всё, что игрок просит сделать сверх правил, и что мастер подтверждает.

  • перемещение сверх скорости / не в свой ход;
  • конец хода;
  • действие сверх положенного (лишняя атака, второе действие, бонусное действие, реакция…).

Каждое такое событие попадает в журнал решений (его видят все в журнале бросков). Принятое мастер может откатить:
фишка вернётся на место, ход — назад, хиты целей и действия участника — как было до действия.
"""
from __future__ import annotations

import copy
import time

from . import characters as ch
from . import gmtools as gt
from . import maps as mp

DEC_KEEP = 120
# дополнительная атака: класс → [(уровень, атак за действие)]
EXTRA_ATTACK = {"fighter": [(20, 4), (11, 3), (5, 2)], "barbarian": [(5, 2)], "paladin": [(5, 2)], "ranger": [(5, 2)], "monk": [(5, 2)]}


class DecisionsMixin:
    # ------------------------------------------------------------------ журнал
    def _decs(self) -> list:
        c = self.campaign
        v = c.extra.get("decisions")
        if not isinstance(v, list):
            v = c.extra["decisions"] = []
        return v

    def _dec_add(self, kind: str, who: str, text: dict, state: str = "pending", **extra) -> dict:
        with self.campaign.lock:
            d = {"id": gt.uid(), "ts": time.time(), "kind": kind, "who": who, "text": text, "state": state, **extra}
            lst = self._decs()
            lst.append(d)
            del lst[: max(0, len(lst) - DEC_KEEP)]
            self.campaign.touch()
        return d

    def _dec_find(self, did: str) -> dict | None:
        return next((x for x in self._decs() if x.get("id") == did), None)

    def _dec_public(self, gm: bool) -> list:
        out = []
        for x in self._decs()[-60:]:
            y = {k: v for k, v in x.items() if k not in ("data", "undo", "pid")}
            y["can_undo"] = bool(x.get("undo")) and x.get("state") == "ok"
            out.append(y)
        return out

    async def _dec_push(self) -> None:
        with self.campaign.lock:
            pub = self._dec_public(True)
        await self._broadcast({"t": "decisions", "list": pub})

    # ------------------------------------------------------------------ лимит действий
    def _per_action(self, doc: dict) -> int:
        n = 1
        for k in doc.get("classes") or []:
            if not isinstance(k, dict):
                continue
            lv = int(k.get("level") or 0)
            for need, cnt in EXTRA_ATTACK.get(k.get("id"), []):
                if lv >= need:
                    n = max(n, cnt)
                    break
        return n

    def _over_limit(self, conn, t: str, src: dict | None, data: dict) -> str | None:
        """Игрок делает больше положенного? Возвращает причину (для мастера) или None."""
        # своя (не из листа) атака игрока — всегда с одобрения мастера
        if (not conn.gm and src and not data.get("approved") and t == "cb_attack"
                and isinstance(data.get("atk"), dict) and data["atk"].get("custom")):
            return "custom"
        if conn.gm or not src or src.get("entry") is None or data.get("approved") or data.get("spend") is False:
            return None
        if not self._rules_on():
            return None
        c = self.campaign
        cb = gt.combat(c)
        if not cb.get("active"):
            return None
        e = src["entry"]
        cost = data.get("cost") if data.get("cost") in gt.ECON_KEYS else "a"
        ec = e.get("econ") or {}
        if cost != "r" and cb.get("cur") != e["id"]:
            return "not_turn"
        if cost == "a" and t == "cb_attack" and not (data.get("atk") or {}).get("spell"):
            d = ch.find(c, src["char"]) if src.get("char") else None
            per = self._per_action(d) if d else 1
            used = int(ec.get("atk") or 0)
            if not ec.get("a"):
                return None
            if 0 < used < per:
                return None
            return f"atk:{used + 1}:{per}"
        if ec.get(cost):
            return "used_" + cost
        return None

    def _hp_snap(self, specs: list) -> list:
        out = []
        for s in specs:
            r = self._resolve(s)
            if r is None:
                continue
            if r.get("char"):
                d = ch.find(self.campaign, r["char"]) or {}
                hp = d.get("hp") or {}
                out.append({"spec": s, "cur": int(hp.get("cur") or 0), "temp": int(hp.get("temp") or 0)})
            else:
                _m, tok = self._r_tok(r)
                hp = (tok or r.get("entry") or {}).get("hp") or {}
                out.append({"spec": s, "cur": int(hp.get("cur") or 0)})
        return out

    async def _dec_request_action(self, conn, t: str, data: dict, src: dict, reason: str, reply) -> None:
        """Сохраняем действие и ждём мастера."""
        keep = {k: v for k, v in data.items() if k not in ("rid", "approved")}
        tgt = (data.get("tgt") and (self._resolve(data["tgt"]) or {}).get("name")) or ""
        what = (data.get("atk") or {}).get("name") or data.get("label") or ""
        d = self._dec_add("act", src["name"], {"reason": reason, "what": what, "tgt": tgt}, pid=conn.pid, t=t, data=keep)
        await reply({"pending": d["id"]})
        await self._dec_push()
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, {"t": "cb_events", "events": [{"k": "act_req", "id": d["id"], "who": src["name"], "reason": reason,
                                                                      "what": what, "tgt": tgt}]})

    # ------------------------------------------------------------------ сообщения
    async def _dec_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")
        if t == "dec_list":
            with c.lock:
                pub = self._dec_public(conn.gm)
            await self._send(conn.ws, {"t": "decisions", "list": pub, "rid": rid})
            return
        if not conn.gm:
            raise gt.ToolError("no_access")
        d = self._dec_find(str(data.get("id", "")))
        if d is None:
            raise gt.ToolError("not_found")
        if t in ("dec_ok", "dec_no") and d["kind"] == "sell":
            async def reply2(extra=None):
                await self._send(conn.ws, {"t": "ok", "rid": rid, **(extra or {})})
            await self._shop_sell_decide(conn, t == "dec_ok", {"id": d["id"]}, reply2)
            return
        if t == "dec_ok" and d["state"] == "pending" and d["kind"] == "act":
            pconn = next((x for x in self.conns if x.pid == d.get("pid")), None) or conn
            specs = [s for s in [d["data"].get("tgt"), *(d["data"].get("tgts") or [])] if s]
            snap = self._hp_snap(specs)
            src = self._resolve(d["data"].get("src"))
            econ = copy.deepcopy((src or {}).get("entry", {}) and src["entry"].get("econ")) if src else None
            d.update(state="ok", undo={"hp": snap, "src": d["data"].get("src"), "econ": econ})
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            try:
                await self._gm_msg(pconn, d["t"], {**d["data"], "approved": True, "rid": None})
            except gt.ToolError as e:
                d.update(state="no", undo=None, err=str(e))
            await self._dec_push()
            return
        if t == "dec_no" and d["state"] == "pending" and d["kind"] == "act":
            d["state"] = "no"
            c.touch()
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            await self._dec_push()
            for x in list(self.conns):
                if x.pid == d.get("pid"):
                    await self._send(x.ws, {"t": "cb_events", "events": [{"k": "act_no", "who": d["who"]}]})
            return
        if t == "dec_undo" and d["state"] == "ok" and d.get("undo"):
            await self._dec_undo(d)
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            await self._dec_push()
            return
        raise gt.ToolError("bad_request")

    async def _dec_undo(self, d: dict) -> None:
        c = self.campaign
        u = d["undo"]
        pushes = {"chars": {}, "maps": {}}
        push_map = None
        with c.lock:
            cb = gt.combat(c)
            if d["kind"] == "move":
                m = mp.find(c, u.get("map", ""))
                tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == u.get("tok")), None)
                if tok is not None:
                    tok.update(x=u["x"], y=u["y"], req=None)
                    push_map = m
                e = next((x for x in cb.get("list") or [] if x.get("id") == u.get("entry")), None)
                if e is not None and u.get("mv") is not None:
                    e.setdefault("econ", gt.clean_econ({}))["mv"] = int(u["mv"])
            elif d["kind"] == "end":
                if any(x.get("id") == u.get("cur") for x in cb.get("list") or []):
                    cb["cur"] = u["cur"]
                    cb["round"] = u.get("round") or cb.get("round")
                    e = next(x for x in cb["list"] if x["id"] == u["cur"])
                    if u.get("econ"):
                        e["econ"] = gt.clean_econ(u["econ"])
            elif d["kind"] == "act":
                for h in u.get("hp") or []:
                    r = self._resolve(h["spec"])
                    if r is None:
                        continue
                    target = r["entry"] if r["entry"] is not None else {"char": r["char"], "map": r["map"], "token": r["token"]}
                    if r["entry"] is not None and not target.get("token") and r["token"] and not target.get("char"):
                        target = {**target, "map": r["map"], "token": r["token"]}
                    kind, obj = self._hp_apply(target, None, h["cur"])
                    if kind == "char":
                        if "temp" in h:
                            obj = ch.patch(c, obj["id"], [{"op": "set", "path": ["hp", "temp"], "value": h["temp"]}])
                        pushes["chars"][obj["id"]] = obj
                    elif kind == "map":
                        pushes["maps"][obj["id"]] = obj
                src = self._resolve(u.get("src")) if u.get("src") else None
                if src and src["entry"] is not None and u.get("econ") is not None:
                    src["entry"]["econ"] = gt.clean_econ(u["econ"])
            d["state"] = "undone"
            c.touch()
        await self._flush(pushes)
        if push_map is not None:
            await self._push_map(push_map)
        await self._push_combat()
