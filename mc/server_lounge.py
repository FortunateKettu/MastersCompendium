"""Комната ожидания: мини-игры для игроков, которые ждут свой ход.

Золото кликера — общая валюта. Его считает клиент и присылает сохранением; сервер хранит копию для таблицы
лидеров и сам начисляет выигрыши (ставки на бой, дуэли, кости лжеца) сообщением lz_gold.

  ставки на бой — пока ходит участник боя, ждущие ставят: первая его атака попадёт или промажет;
  дуэли         — вызов другого игрока, оба кидают d20, больший забирает ставки;
  кости лжеца   — 2–6 игроков, по 5 скрытых костей, ставки «N костей с гранью F», единицы — джокеры;
  доска         — общий холст для каракулей, мастер может сделать из неё карту.
"""
from __future__ import annotations

import asyncio
import copy
import re
import secrets
import time
from collections import deque

from . import gmtools as gt

DICE_TURN = 40          # секунд на ход в костях лжеца
DICE_AWAY = 12          # … если игрок вышел из приложения
DICE_REVEAL = 6         # сколько показываем вскрытие
DICE_OVER = 12          # сколько показываем победителя
DICE_SEATS = 6
DUEL_TTL = 60
FEED_KEEP = 25
DOODLE_MAX = 3000       # штрихов на доске
DOODLE_PTS = 2400       # координат в одном штрихе (x и y по отдельности)
DOODLE_W, DOODLE_H = 1000, 700
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")


def _amt(v) -> int:
    return gt._int(v, 0, 10 ** 15, 0)


class LoungeMixin:
    # ------------------------------------------------------------------ общее
    def _lz(self) -> dict:
        st = getattr(self, "_lzs", None)
        if st is None:
            st = self._lzs = {"market": None, "duels": {}, "feed": deque(maxlen=FEED_KEEP), "dice": self._lzd_fresh()}
        return st

    @staticmethod
    def _lz_key(conn) -> str | None:
        return "gm" if conn.gm else conn.pid

    def _lz_who(self, key: str) -> dict:
        if key == "gm":
            return {"name": "GM", "color": "#f5c542"}
        p = next((p for p in self.campaign.players if p.id == key), None)
        return {"name": p.name if p else "?", "color": p.color if p else "#888888"}

    def _lz_online(self, key: str) -> bool:
        return any(self._lz_key(x) == key for x in self.conns)

    async def _lz_send_key(self, key: str, msg: dict) -> None:
        for x in list(self.conns):
            if self._lz_key(x) == key:
                await self._send(x.ws, msg)

    def _lz_state(self) -> dict:
        c = self.campaign
        with c.lock:
            lz = gt.lounge(c)
            return {"t": "lz_board", "on": bool(lz["on"]), "board": copy.deepcopy(gt.lz_board(c))}

    def _lz_store(self, key: str, save) -> None:
        """Сохранение кликера от клиента; ставку он уже вычел из золота у себя."""
        c = self.campaign
        with c.lock:
            gt.lounge(c)["saves"][key] = gt.clean_lz_save(save)
            c.touch()

    async def _lz_pay(self, key: str, gold: int, profit: int, why: str) -> None:
        """Начислить выигрыш (или вернуть ставку): на сервере и у самого игрока."""
        if gold <= 0:
            return
        c = self.campaign
        with c.lock:
            saves = gt.lounge(c)["saves"]
            s = saves.get(key) or gt.clean_lz_save({})
            s["gold"] = s.get("gold", 0) + gold
            s["total"] = s.get("total", 0) + max(0, profit)
            saves[key] = s
            c.touch()
        await self._lz_send_key(key, {"t": "lz_gold", "gold": gold, "total": max(0, profit), "why": why})

    async def _lz_feed(self, item: dict) -> None:
        item["ts"] = time.time()
        self._lz()["feed"].append(item)
        await self._broadcast({"t": "lz_feed", "item": item})

    def _lz_on(self) -> bool:
        with self.campaign.lock:
            return bool(gt.lounge(self.campaign)["on"])

    # ------------------------------------------------------------------ сообщения
    async def _lounge_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")
        key = self._lz_key(conn)
        if not key:
            raise gt.ToolError("no_access")

        async def reply(extra: dict | None = None) -> None:
            await self._send(conn.ws, {"t": "ok", "rid": rid, **(extra or {})})

        if t in ("lz_set", "lz_call", "lz_reset", "lzp_clear") and not conn.gm:
            raise gt.ToolError("no_access")
        if not conn.gm and t not in ("lz_get", "lzp_get") and not self._lz_on():
            raise gt.ToolError("no_access")
        st = self._lz()

        if t == "lz_get":
            with c.lock:
                mine = copy.deepcopy(gt.lounge(c)["saves"].get(key))
            await reply({**self._lz_state(), "save": mine, "feed": list(st["feed"]), "market": self._lz_market_view(),
                         "dice": self._lzd_view(key), "duels": self._lz_duels_for(key)})
            return
        if t == "lz_save":
            self._lz_store(key, data.get("save"))
            await reply()
            await self._broadcast(self._lz_state())
            return
        if t == "lz_set":
            with c.lock:
                gt.lounge(c)["on"] = bool(data.get("on"))
                c.touch()
            await reply()
            await self._broadcast(self._lz_state())
            if not self._lz_on():
                await self._lz_close_all()
            else:
                await self._lz_combat_sync()
            return
        if t == "lz_reset":
            await self._lz_close_all()
            with c.lock:
                gt.lounge(c)["saves"] = {}
                c.touch()
            await reply()
            await self._broadcast({**self._lz_state(), "reset": True})
            return
        if t == "lz_call":
            await reply()
            await self._broadcast({"t": "lz_call"})
            return

        if t == "lz_bet":
            await self._lz_bet(conn, key, data)
            await reply()
            return
        if t in ("lz_duel", "lz_duel_ans", "lz_duel_cancel"):
            await self._lz_duel_msg(conn, key, t, data)
            await reply()
            return
        if t.startswith("lzd_"):
            await self._lzd_msg(conn, key, t, data)
            await reply()
            return
        if t.startswith("lzp_"):
            await self._lzp_msg(conn, key, t, data, reply)
            return
        raise gt.ToolError("bad_request")

    async def _lz_close_all(self) -> None:
        """Комнату выключили или обнулили: все ставки и столы возвращают деньги."""
        st = self._lz()
        m = st["market"]
        if m and m["open"]:
            await self._lz_refund_market(m)
        st["market"] = None
        for d in list(st["duels"].values()):
            await self._lz_pay(d["a"], d["stake"], 0, "refund")
        st["duels"].clear()
        g = st["dice"]
        if g["phase"] in ("lobby", "play", "reveal"):
            for s in g["seats"]:
                await self._lz_pay(s["key"], g["fee"], 0, "refund")
        st["dice"] = self._lzd_fresh()
        await self._broadcast({"t": "lz_market", "market": None})
        await self._lzd_push()
        for x in list(self.conns):
            k = self._lz_key(x)
            if k:
                await self._send(x.ws, {"t": "lz_duels", "duels": []})

    # ================================================================== ставки на бой
    def _lz_market_view(self) -> dict | None:
        m = self._lz()["market"]
        if not m:
            return None
        pools = {"hit": 0, "miss": 0}
        for b in m["bets"].values():
            pools[b["side"]] += b["amt"]
        return {"id": m["id"], "name": m["name"], "open": m["open"], "pools": pools,
                "bets": [{"key": k, "name": b["name"], "color": b["color"], "side": b["side"], "amt": b["amt"]} for k, b in m["bets"].items()],
                "res": m.get("res")}

    async def _lz_push_market(self) -> None:
        await self._broadcast({"t": "lz_market", "market": self._lz_market_view()})

    async def _lz_combat_sync(self) -> None:
        """Ход в бою сменился — старый рынок закрываем (возврат), открываем новый на текущего участника."""
        st = self._lz()
        c = self.campaign
        with c.lock:
            cb = gt.combat(c)
            cur = next((e for e in cb.get("list") or [] if e.get("id") == cb.get("cur")), None) if cb.get("active") else None
            want = f"{cb.get('round', 0)}:{cur['id']}" if cur and not cur.get("hidden") and gt.lounge(c)["on"] else None
            name = cur.get("name", "?") if cur else ""
            eid = cur["id"] if cur else None
        m = st["market"]
        if m and m["turn"] == want:
            return
        if m and m["open"]:
            await self._lz_refund_market(m)
        st["market"] = {"id": secrets.token_hex(4), "turn": want, "actor": eid, "name": name, "open": True, "bets": {}} if want else None
        await self._lz_push_market()

    async def _lz_refund_market(self, m: dict) -> None:
        m["open"] = False
        for k, b in m["bets"].items():
            await self._lz_pay(k, b["amt"], 0, "refund")

    async def _lz_bet(self, conn, key: str, data: dict) -> None:
        m = self._lz()["market"]
        side = data.get("side")
        amt = _amt(data.get("amt"))
        if conn.gm:
            raise gt.ToolError("no_access")
        if not m or not m["open"] or side not in ("hit", "miss") or amt < 1:
            raise gt.ToolError("bad_request")
        old = m["bets"].get(key)
        if old and old["side"] != side:
            raise gt.ToolError("bad_request")
        self._lz_store(key, data.get("save"))
        who = self._lz_who(key)
        m["bets"][key] = {"side": side, "amt": (old["amt"] if old else 0) + amt, **who}
        await self._lz_push_market()

    async def _lz_attack(self, eid: str | None, hit: bool, crit: bool, hidden: bool) -> None:
        """Первая атака участника, на которого ставили: рассчитываем рынок."""
        m = self._lz()["market"]
        if not m or not m["open"] or not eid or m["actor"] != eid:
            return
        if hidden:
            await self._lz_refund_market(m)
            m["res"] = {"side": "", "hidden": True}
            await self._lz_push_market()
            return
        m["open"] = False
        side = "hit" if hit else "miss"
        win = {k: b for k, b in m["bets"].items() if b["side"] == side}
        w = sum(b["amt"] for b in win.values())
        lose = sum(b["amt"] for b in m["bets"].values()) - w
        pays = []
        for k, b in win.items():
            share = b["amt"] + (b["amt"] * lose // w if lose else b["amt"] // 2)
            if crit:
                share += b["amt"]
            await self._lz_pay(k, share, share - b["amt"], "bet")
            pays.append({"name": b["name"], "color": b["color"], "won": share - b["amt"]})
        m["res"] = {"side": side, "crit": bool(crit), "pays": pays}
        await self._lz_push_market()
        if m["bets"]:
            await self._lz_feed({"k": "bet", "who": m["name"], "side": side, "crit": bool(crit), "pays": pays})

    # ================================================================== дуэли
    def _lz_duels_for(self, key: str) -> list[dict]:
        return [copy.deepcopy(d) for d in self._lz()["duels"].values() if key in (d["a"], d["b"])]

    async def _lz_push_duels(self, *keys: str) -> None:
        for k in keys:
            await self._lz_send_key(k, {"t": "lz_duels", "duels": self._lz_duels_for(k)})

    async def _lz_duel_msg(self, conn, key: str, t: str, data: dict) -> None:
        st = self._lz()
        if conn.gm:
            raise gt.ToolError("no_access")
        if t == "lz_duel":
            to = str(data.get("to", ""))[:40]
            stake = _amt(data.get("stake"))
            if to == key or not any(p.id == to for p in self.campaign.players) or not self._lz_online(to):
                raise gt.ToolError("not_found")
            if any(d["a"] == key for d in st["duels"].values()):
                raise gt.ToolError("busy")
            self._lz_store(key, data.get("save"))
            did = secrets.token_hex(4)
            st["duels"][did] = {"id": did, "a": key, "b": to, "stake": stake, "ts": time.time(), "ttl": DUEL_TTL,
                                "an": self._lz_who(key)["name"], "bn": self._lz_who(to)["name"],
                                "ac": self._lz_who(key)["color"], "bc": self._lz_who(to)["color"]}
            asyncio.get_running_loop().call_later(DUEL_TTL, lambda: asyncio.ensure_future(self._lz_duel_expire(did)))
            await self._lz_push_duels(key, to)
            return
        d = st["duels"].get(str(data.get("id", "")))
        if d is None:
            raise gt.ToolError("not_found")
        if t == "lz_duel_cancel":
            if key not in (d["a"], d["b"]):
                raise gt.ToolError("no_access")
            st["duels"].pop(d["id"], None)
            await self._lz_pay(d["a"], d["stake"], 0, "refund")
            await self._lz_push_duels(d["a"], d["b"])
            await self._lz_send_key(d["a"], {"t": "lz_duel_res", "duel": d, "declined": True})
            return
        if key != d["b"]:
            raise gt.ToolError("no_access")
        st["duels"].pop(d["id"], None)
        if not data.get("ok"):
            await self._lz_pay(d["a"], d["stake"], 0, "refund")
            await self._lz_push_duels(d["a"], d["b"])
            await self._lz_send_key(d["a"], {"t": "lz_duel_res", "duel": d, "declined": True})
            return
        self._lz_store(key, data.get("save"))
        rolls = []
        while True:            # ничья — перебрасываем
            ra, rb = 1 + secrets.randbelow(20), 1 + secrets.randbelow(20)
            rolls.append([ra, rb])
            if ra != rb or len(rolls) >= 10:
                break
        win = d["a"] if ra >= rb else d["b"]
        await self._lz_pay(win, d["stake"] * 2, d["stake"], "duel")
        res = {"t": "lz_duel_res", "duel": d, "rolls": rolls, "win": win}
        await self._lz_push_duels(d["a"], d["b"])
        await self._lz_send_key(d["a"], res)
        await self._lz_send_key(d["b"], res)
        await self._lz_feed({"k": "duel", "a": d["an"], "b": d["bn"], "ac": d["ac"], "bc": d["bc"], "ra": ra, "rb": rb,
                             "win": d["an"] if win == d["a"] else d["bn"], "stake": d["stake"]})

    async def _lz_duel_expire(self, did: str) -> None:
        d = self._lz()["duels"].pop(did, None)
        if d is None:
            return
        await self._lz_pay(d["a"], d["stake"], 0, "refund")
        await self._lz_push_duels(d["a"], d["b"])
        await self._lz_send_key(d["a"], {"t": "lz_duel_res", "duel": d, "declined": True, "expired": True})

    # ================================================================== кости лжеца
    @staticmethod
    def _lzd_fresh() -> dict:
        return {"phase": "lobby", "seats": [], "fee": 0, "pot": 0, "turn": None, "bid": None, "dl": 0, "host": None,
                "last": None, "win": None, "tok": 0}

    def _lzd_view(self, key: str) -> dict:
        g = self._lz()["dice"]
        show_all = g["phase"] in ("reveal", "over")
        return {"phase": g["phase"], "fee": g["fee"], "pot": g["pot"], "turn": g["turn"], "bid": g["bid"], "host": g["host"],
                "left": max(0, round(g["dl"] - time.time())) if g["dl"] else 0, "last": g["last"], "win": g["win"],
                "total": sum(len(s["dice"]) for s in g["seats"]),
                "seats": [{"key": s["key"], "name": s["name"], "color": s["color"], "n": len(s["dice"]),
                           "dice": s["dice"] if (show_all or s["key"] == key) else None} for s in g["seats"]]}

    async def _lzd_push(self) -> None:
        for x in list(self.conns):
            k = self._lz_key(x)
            if k:
                await self._send(x.ws, {"t": "lz_dice", "dice": self._lzd_view(k)})

    def _lzd_timer(self, sec: float, fn) -> None:
        g = self._lz()["dice"]
        g["tok"] += 1
        tok = g["tok"]
        g["dl"] = time.time() + sec
        asyncio.get_running_loop().call_later(sec, lambda: asyncio.ensure_future(fn(tok)))

    def _lzd_turn_timer(self) -> None:
        g = self._lz()["dice"]
        self._lzd_timer(DICE_TURN if self._lz_online(g["turn"]) else DICE_AWAY, self._lzd_timeout)

    @staticmethod
    def _lzd_roll(n: int) -> list[int]:
        return sorted(1 + secrets.randbelow(6) for _ in range(n))

    def _lzd_next_key(self, key: str) -> str | None:
        seats = self._lz()["dice"]["seats"]
        if not seats:
            return None
        i = next((i for i, s in enumerate(seats) if s["key"] == key), -1)
        return seats[(i + 1) % len(seats)]["key"]

    async def _lzd_msg(self, conn, key: str, t: str, data: dict) -> None:
        g = self._lz()["dice"]
        seat = next((s for s in g["seats"] if s["key"] == key), None)
        if t == "lzd_join":
            if g["phase"] != "lobby" or seat or len(g["seats"]) >= DICE_SEATS:
                raise gt.ToolError("bad_request")
            if not g["seats"]:
                g["fee"] = _amt(data.get("fee"))
                g["host"] = key
            self._lz_store(key, data.get("save"))
            g["pot"] += g["fee"]
            g["seats"].append({"key": key, **self._lz_who(key), "dice": []})
        elif t == "lzd_leave":
            if not seat:
                return
            g["seats"].remove(seat)
            if g["phase"] == "lobby":
                g["pot"] -= g["fee"]
                await self._lz_pay(key, g["fee"], 0, "refund")
                if g["host"] == key:
                    g["host"] = g["seats"][0]["key"] if g["seats"] else None
                if not g["seats"]:
                    self._lz()["dice"] = self._lzd_fresh()
            elif g["phase"] in ("play", "reveal"):
                if g["host"] == key:
                    g["host"] = g["seats"][0]["key"] if g["seats"] else None
                if len(g["seats"]) <= 1:
                    await self._lzd_finish()
                    return
                if g["turn"] == key and g["phase"] == "play":
                    g["turn"] = g["seats"][0]["key"]
                    g["bid"] = None
                    self._lzd_turn_timer()
        elif t == "lzd_start":
            if g["phase"] != "lobby" or g["host"] != key or len(g["seats"]) < 2:
                raise gt.ToolError("bad_request")
            for s in g["seats"]:
                s["dice"] = self._lzd_roll(5)
            g.update(phase="play", bid=None, last=None, turn=g["seats"][secrets.randbelow(len(g["seats"]))]["key"])
            self._lzd_turn_timer()
        elif t == "lzd_bid":
            if g["phase"] != "play" or g["turn"] != key:
                raise gt.ToolError("bad_request")
            q, f = gt._int(data.get("q"), 0, 99, 0), gt._int(data.get("f"), 0, 9, 0)
            total = sum(len(s["dice"]) for s in g["seats"])
            b = g["bid"]
            if not (2 <= f <= 6 and 1 <= q <= total and (b is None or q > b["q"] or (q == b["q"] and f > b["f"]))):
                raise gt.ToolError("bad_request")
            g["bid"] = {"q": q, "f": f, "by": key, "name": seat["name"]}
            g["turn"] = self._lzd_next_key(key)
            self._lzd_turn_timer()
        elif t == "lzd_call":
            if g["phase"] != "play" or g["turn"] != key or not g["bid"] or g["bid"]["by"] == key:
                raise gt.ToolError("bad_request")
            await self._lzd_reveal(key)
            return
        else:
            raise gt.ToolError("bad_request")
        await self._lzd_push()

    async def _lzd_reveal(self, caller: str) -> None:
        g = self._lz()["dice"]
        b = g["bid"]
        count = sum(1 for s in g["seats"] for d in s["dice"] if d == b["f"] or d == 1)
        loser = caller if count >= b["q"] else b["by"]
        ls = next((s for s in g["seats"] if s["key"] == loser), None)
        g["last"] = {"caller": self._lz_who(caller)["name"], "bidder": b["name"], "q": b["q"], "f": b["f"], "count": count,
                     "loser": loser, "loser_name": ls["name"] if ls else "?",
                     "all": {s["key"]: list(s["dice"]) for s in g["seats"]}}
        g["phase"] = "reveal"
        g["turn"] = loser
        self._lzd_timer(DICE_REVEAL, self._lzd_after_reveal)
        await self._lzd_push()

    async def _lzd_after_reveal(self, tok: int) -> None:
        g = self._lz()["dice"]
        if g["tok"] != tok or g["phase"] != "reveal":
            return
        loser = g["last"]["loser"] if g["last"] else None
        for s in g["seats"]:
            if s["key"] == loser and s["dice"]:
                s["dice"].pop()
        out = [s for s in g["seats"] if not s["dice"]]
        nxt = loser
        if loser in [s["key"] for s in out]:
            nxt = self._lzd_next_key(loser)
        g["seats"] = [s for s in g["seats"] if s["dice"]]
        if len(g["seats"]) <= 1:
            await self._lzd_finish()
            return
        if nxt not in [s["key"] for s in g["seats"]]:
            nxt = g["seats"][0]["key"]
        for s in g["seats"]:
            s["dice"] = self._lzd_roll(len(s["dice"]))
        g.update(phase="play", bid=None, turn=nxt)
        self._lzd_turn_timer()
        await self._lzd_push()

    async def _lzd_finish(self) -> None:
        g = self._lz()["dice"]
        w = g["seats"][0] if g["seats"] else None
        if w:
            await self._lz_pay(w["key"], g["pot"], g["pot"] - g["fee"], "dice")
            g["win"] = {"key": w["key"], "name": w["name"], "color": w["color"], "pot": g["pot"]}
            await self._lz_feed({"k": "dice", "win": w["name"], "wc": w["color"], "pot": g["pot"]})
        g.update(phase="over", turn=None, bid=None)
        self._lzd_timer(DICE_OVER, self._lzd_reset)
        await self._lzd_push()

    async def _lzd_reset(self, tok: int) -> None:
        if self._lz()["dice"]["tok"] != tok:
            return
        self._lz()["dice"] = self._lzd_fresh()
        await self._lzd_push()

    async def _lzd_timeout(self, tok: int) -> None:
        """Игрок задумался (или ушёл играть по-настоящему): «Лжец!», если есть чужая ставка, иначе минимальная ставка."""
        g = self._lz()["dice"]
        if g["tok"] != tok or g["phase"] != "play":
            return
        key = g["turn"]
        seat = next((s for s in g["seats"] if s["key"] == key), None)
        if seat is None:
            return
        if g["bid"] and g["bid"]["by"] != key:
            await self._lzd_reveal(key)
            return
        b = g["bid"]
        q, f = (1, 2) if b is None else (b["q"] + 1, b["f"])
        g["bid"] = {"q": q, "f": f, "by": key, "name": seat["name"], "auto": True}
        g["turn"] = self._lzd_next_key(key)
        self._lzd_turn_timer()
        await self._lzd_push()

    # ================================================================== общая доска
    def _doodle(self) -> list:
        c = self.campaign
        d = c.extra.get("doodle")
        if not isinstance(d, dict) or not isinstance(d.get("strokes"), list):
            d = c.extra["doodle"] = {"strokes": []}
        return d["strokes"]

    async def _lzp_msg(self, conn, key: str, t: str, data: dict, reply) -> None:
        c = self.campaign
        if t == "lzp_get":
            with c.lock:
                await reply({"strokes": copy.deepcopy(self._doodle())})
            return
        if t == "lzp_add":
            sid = re.sub(r"[^a-zA-Z0-9]", "", str(data.get("id", "")))[:12]
            raw = data.get("p") if isinstance(data.get("p"), list) else []
            pts = []
            for i in range(0, min(len(raw), 600) - 1, 2):
                pts += [gt._int(raw[i], 0, DOODLE_W, 0), gt._int(raw[i + 1], 0, DOODLE_H, 0)]
            if not sid or not pts:
                raise gt.ToolError("bad_request")
            color = data.get("c") if isinstance(data.get("c"), str) and HEX_RE.fullmatch(data["c"]) else "#ffffff"
            w, er = gt._int(data.get("w"), 1, 60, 4), bool(data.get("e"))
            with c.lock:
                lst = self._doodle()
                s = next((x for x in reversed(lst[-50:]) if x["id"] == sid and x["by"] == key), None)
                if s is None:
                    s = {"id": sid, "by": key, "c": color, "w": w, "e": er, "p": []}
                    lst.append(s)
                    if len(lst) > DOODLE_MAX:
                        del lst[: len(lst) - DOODLE_MAX]
                room = DOODLE_PTS - len(s["p"])
                pts = pts[: max(0, room - room % 2)]
                s["p"] += pts
                c.touch()
                msg = {"t": "lzp", "op": "add", "s": {"id": sid, "by": key, "c": s["c"], "w": s["w"], "e": s["e"], "p": pts}}
            await reply()
            for x in list(self.conns):
                if x is not conn and self._lz_key(x):
                    await self._send(x.ws, msg)
            return
        if t == "lzp_undo":
            with c.lock:
                lst = self._doodle()
                s = next((x for x in reversed(lst) if x["by"] == key), None)
                if s:
                    lst.remove(s)
                    c.touch()
            await reply()
            if s:
                await self._broadcast({"t": "lzp", "op": "del", "id": s["id"], "by": key})
            return
        if t == "lzp_clear":
            with c.lock:
                c.extra["doodle"] = {"strokes": []}
                c.touch()
            await reply()
            await self._broadcast({"t": "lzp", "op": "clear"})
            return
        raise gt.ToolError("bad_request")
