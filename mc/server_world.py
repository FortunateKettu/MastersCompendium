"""Мир кампании: календарь и время суток, погода, таймеры, тайные броски, припасы, общий склад, лавка,
хроника событий и журнал сессий.

Хроника (c.extra["chron"]) — короткие записи о важном (бой, опыт, выдача, смена дня…), из неё мастер
собирает черновик пересказа «в прошлый раз…».
"""
from __future__ import annotations

import copy
import random
import re
import secrets
import time

from . import characters as ch
from . import gmtools as gt

MONTHS_RU = [("Январь", 31), ("Февраль", 28), ("Март", 31), ("Апрель", 30), ("Май", 31), ("Июнь", 30), ("Июль", 31),
             ("Август", 31), ("Сентябрь", 30), ("Октябрь", 31), ("Ноябрь", 30), ("Декабрь", 31)]
CLIMATES = ("temperate", "cold", "hot", "tropic", "sea")
# погода: вид → (вес по сезонам [зима, весна, лето, осень]) для умеренного климата; остальные климаты сдвигают веса
WEATHER = {
    "clear": (3, 4, 6, 3), "cloudy": (3, 4, 3, 4), "overcast": (3, 3, 2, 4), "fog": (1, 2, 1, 3),
    "drizzle": (0, 3, 2, 3), "rain": (0, 3, 2, 3), "storm": (0, 1, 2, 1), "snow": (4, 1, 0, 1), "blizzard": (2, 0, 0, 0),
    "wind": (2, 2, 1, 3), "heat": (0, 0, 2, 0), "sandstorm": (0, 0, 0, 0),
}
CLIMATE_MOD = {
    "cold": {"snow": 3, "blizzard": 3, "heat": 0, "storm": 0.5, "rain": 0.5, "clear": 1},
    "hot": {"snow": 0, "blizzard": 0, "heat": 4, "sandstorm": 2, "rain": 0.3, "drizzle": 0.3, "fog": 0.3, "clear": 2},
    "tropic": {"snow": 0, "blizzard": 0, "rain": 2.5, "storm": 2, "heat": 2, "fog": 1.5},
    "sea": {"fog": 2, "wind": 2.5, "storm": 1.8, "snow": 0.5, "blizzard": 0.3},
}
TEMP = {"temperate": (-8, 10, 24, 9), "cold": (-25, -6, 8, -8), "hot": (16, 28, 40, 27), "tropic": (24, 28, 31, 28), "sea": (2, 11, 20, 12)}
SUPPLY = {"ration": r"рацион|паёк|паек|ration", "water": r"бурдюк|вода|waterskin|water", "torch": r"факел|torch",
          "arrow": r"стрел|arrow", "bolt": r"болт|bolt", "bullet": r"снаряд|пул[ия]|bullet", "needle": r"игл|needle"}
CHRON_KEEP = 400


class WorldMixin:
    # ================================================================== состояние
    def _world(self) -> dict:
        c = self.campaign
        w = c.extra.get("world")
        if not isinstance(w, dict):
            w = c.extra["world"] = {}
        w.setdefault("day", 1)
        w.setdefault("minute", 8 * 60)
        w.setdefault("year", 1490)
        w.setdefault("months", [{"name": n, "days": d} for n, d in MONTHS_RU])
        w.setdefault("climate", "temperate")
        w.setdefault("auto_weather", True)
        w.setdefault("weather_fx", True)
        w.setdefault("supplies", False)
        w.setdefault("ammo", True)          # считать стрелы/болты (работает, когда включён учёт припасов)
        w.setdefault("weather", None)
        w.setdefault("timers", [])
        return w

    def _w_date(self, w: dict) -> dict:
        months = w["months"] or [{"name": "—", "days": 30}]
        total = sum(max(1, int(m.get("days") or 30)) for m in months)
        d0 = int(w["day"]) - 1
        year = int(w["year"]) + d0 // total
        rest = d0 % total
        mi = 0
        for i, m in enumerate(months):
            n = max(1, int(m.get("days") or 30))
            if rest < n:
                mi = i
                break
            rest -= n
        return {"year": year, "month": mi, "month_name": months[mi]["name"], "dom": rest + 1, "season": self._w_season(mi, len(months))}

    @staticmethod
    def _w_season(mi: int, n: int) -> int:
        """0 зима, 1 весна, 2 лето, 3 осень (по положению месяца в году)."""
        k = (mi + 1) % n / n            # декабрь/январь — зима
        return min(3, int(k * 4))

    def _w_public(self, gm: bool) -> dict:
        with self.campaign.lock:
            w = copy.deepcopy(self._world())
        w["date"] = self._w_date(w)
        if not gm:
            w["timers"] = [x for x in w["timers"] if x.get("vis")]
        return {"t": "world", **w}

    async def _w_push(self) -> None:
        for x in list(self.conns):
            await self._send(x.ws, self._w_public(x.gm))

    # ================================================================== хроника
    def _chron(self, k: str, text: str, **extra) -> None:
        c = self.campaign
        with c.lock:
            lst = c.extra.get("chron") if isinstance(c.extra.get("chron"), list) else []
            w = self._world()
            lst.append({"ts": time.time(), "day": w["day"], "k": k, "text": gt._line(text, 300), **extra})
            c.extra["chron"] = lst[-CHRON_KEEP:]
            c.touch()

    # ================================================================== погода
    def _w_roll_weather(self, w: dict) -> dict:
        season = self._w_date(w)["season"]
        mod = CLIMATE_MOD.get(w.get("climate"), {})
        kinds, weights = [], []
        for k, ws in WEATHER.items():
            wt = ws[season] * mod.get(k, 1)
            if k == "sandstorm" and w.get("climate") == "hot":
                wt = max(wt, 1)
            if wt > 0:
                kinds.append(k)
                weights.append(wt)
        rnd = random.Random(secrets.randbits(32))
        kind = rnd.choices(kinds, weights)[0]
        base = TEMP.get(w.get("climate"), TEMP["temperate"])[season]
        temp = base + rnd.randint(-5, 5) + {"heat": 7, "snow": -4, "blizzard": -8, "clear": 1, "storm": -2}.get(kind, 0)
        wind = rnd.choice(["calm", "light", "light", "moderate", "strong"]) if kind not in ("storm", "blizzard", "sandstorm", "wind") else "strong"
        return {"kind": kind, "temp": int(temp), "wind": wind}

    # ================================================================== время
    async def _w_advance(self, minutes: int) -> None:
        c = self.campaign
        notes = []
        day_changed = 0
        with c.lock:
            w = self._world()
            total = int(w["minute"]) + int(minutes)
            day_changed = total // 1440
            w["minute"] = total % 1440
            w["day"] = max(1, int(w["day"]) + day_changed)
            # таймеры по игровому времени
            for x in w["timers"]:
                if x.get("kind") == "min" and x.get("left", 0) > 0:
                    x["left"] = max(0, x["left"] - minutes)
                    if x["left"] == 0:
                        notes.append(x)
            w["timers"] = [x for x in w["timers"] if not (x.get("kind") == "min" and x.get("left", 0) <= 0)]
            if day_changed and w.get("auto_weather"):
                w["weather"] = self._w_roll_weather(w)
            c.touch()
        if day_changed:
            d = self._w_date(self._world())
            self._chron("day", f"{d['dom']} {d['month_name']} {d['year']}", days=day_changed)
            if self._world().get("supplies"):
                for _ in range(min(day_changed, 30)):
                    await self._w_consume_day()
        for x in notes:
            await self._w_timer_done(x)
        await self._w_push()

    async def _w_timer_done(self, x: dict) -> None:
        msg = {"t": "w_timer", "name": x.get("name"), "vis": bool(x.get("vis"))}
        for conn in list(self.conns):
            if conn.gm or x.get("vis"):
                await self._send(conn.ws, msg)

    async def _w_timer_note(self, x: dict, kind: str) -> None:
        """Игрокам — о видимых таймерах: поставили («new») и скоро истекает («soon»)."""
        msg = {"t": "w_timer_" + kind, "name": x.get("name"), "kind": x.get("kind"), "left": x.get("left"),
               "end": x.get("end"), "vis": bool(x.get("vis"))}
        for conn in list(self.conns):
            if x.get("vis") or (conn.gm and kind == "soon"):
                await self._send(conn.ws, msg)

    async def _w_real_check(self) -> None:
        """Таймеры в реальных минутах: истёкшие — срабатывают, за минуту до конца — предупреждение."""
        now = time.time()
        done, soon = [], []
        with self.campaign.lock:
            w = self._world()
            for x in w["timers"]:
                if x.get("kind") != "real":
                    continue
                if float(x.get("end") or 0) <= now + 0.5:
                    done.append(x)
                elif float(x.get("end") or 0) - now <= 61 and not x.get("warned") and float(x.get("dur") or 0) > 120:
                    x["warned"] = True
                    soon.append(x)
            if done:
                w["timers"] = [x for x in w["timers"] if x not in done]
                self.campaign.touch()
        for x in soon:
            await self._w_timer_note(x, "soon")
        for x in done:
            await self._w_timer_done(x)
        if done:
            await self._w_push()

    def _w_schedule(self, x: dict) -> None:
        import asyncio
        sched = self.__dict__.setdefault("_w_sched", set())
        if x.get("id") in sched:
            return
        sched.add(x.get("id"))
        loop = asyncio.get_running_loop()
        left = float(x.get("end") or 0) - time.time()
        loop.call_later(max(0.2, left + 0.3), lambda: asyncio.ensure_future(self._w_real_check()))
        if left > 120:
            loop.call_later(left - 60, lambda: asyncio.ensure_future(self._w_real_check()))

    def _w_round_tick(self) -> list:
        """Новый раунд боя — таймеры в раундах на 1 меньше. Возвращает сработавшие."""
        w = self._world()
        done = []
        self._w_soon = []
        for x in w["timers"]:
            if x.get("kind") == "round" and x.get("left", 0) > 0:
                x["left"] -= 1
                if x["left"] <= 0:
                    done.append(x)
                elif x["left"] == 1:
                    self._w_soon.append(x)
        w["timers"] = [x for x in w["timers"] if x not in done]
        return done

    # ================================================================== припасы
    @staticmethod
    def _find_supply(doc: dict, kind: str):
        rx = re.compile(SUPPLY[kind], re.I)
        for it in doc.get("inventory") or []:
            if isinstance(it, dict) and rx.search(str(it.get("name") or it.get("srd") or "")):
                return it
        return None

    async def _w_consume_day(self) -> None:
        """Новый день в пути: у каждого персонажа игрока −1 рацион и −1 вода."""
        c = self.campaign
        short = []
        changed = []
        with c.lock:
            pids = {p.id for p in c.players}
            for d in ch.chars(c):
                if not isinstance(d, dict) or d.get("owner") not in pids:
                    continue
                ops = []
                for kind in ("ration", "water"):
                    it = self._find_supply(d, kind)
                    if kind == "water" and it is not None and re.search(r"бурдюк|waterskin", str(it.get("name") or it.get("srd")), re.I):
                        # бурдюк не тратится — его наполняют; считаем «воду» как отдельные порции, если есть
                        continue
                    if it is None or float(it.get("qty") or 0) <= 0:
                        short.append({"name": d.get("name"), "kind": kind})
                        continue
                    ops.append({"op": "set", "path": ["inventory", it["id"], "qty"], "value": max(0, float(it.get("qty") or 0) - 1)})
                    if float(it.get("qty") or 0) - 1 <= 1:
                        short.append({"name": d.get("name"), "kind": kind, "low": True})
                if ops:
                    changed.append(ch.patch(c, d["id"], ops))
        for d in changed:
            await self._send_char(d)
            await self._push_summary(d)
        if short:
            await self._broadcast({"t": "w_supply", "short": short})

    def _use_ammo(self, src: dict | None, ammo: str) -> int | None:
        """Выстрел: −1 боеприпас из инвентаря. Возвращает остаток (None — учёт выключен/нечего считать, -1 — нет)."""
        if not ammo or ammo not in SUPPLY or not src or not src.get("char") or not self._world().get("supplies") or not self._world().get("ammo", True):
            return None
        c = self.campaign
        d = ch.find(c, src["char"])
        if d is None:
            return None
        it = self._find_supply(d, ammo)
        if it is None or float(it.get("qty") or 0) <= 0:
            return -1
        left = max(0, float(it.get("qty") or 0) - 1)
        d = ch.patch(c, d["id"], [{"op": "set", "path": ["inventory", it["id"], "qty"], "value": left}])
        self._pending_chars = getattr(self, "_pending_chars", {})
        self._pending_chars[d["id"]] = d
        return int(left)

    # ================================================================== тайные броски
    SECRET_SKILLS = ("perception", "insight", "investigation", "stealth", "survival", "arcana", "history", "nature", "religion",
                     "athletics", "acrobatics", "medicine", "deception", "persuasion", "intimidation", "sleight-of-hand",
                     "animal-handling", "performance")
    SKILL_ABIL = {"perception": "wis", "insight": "wis", "investigation": "int", "stealth": "dex", "survival": "wis", "arcana": "int",
                  "history": "int", "nature": "int", "religion": "int", "athletics": "str", "acrobatics": "dex", "medicine": "wis",
                  "deception": "cha", "persuasion": "cha", "intimidation": "cha", "sleight-of-hand": "dex", "animal-handling": "wis",
                  "performance": "cha"}

    def _skill_of_doc(self, d: dict, sk: str) -> int:
        from . import rules5e as r5
        if sk in ("str", "dex", "con", "int", "wis", "cha"):
            return r5.ab_mod(d, sk)
        if sk.startswith("save_"):
            return r5.save_bonus(d, sk[5:])
        ab = self.SKILL_ABIL.get(sk, "wis")
        lvl = int((d.get("skills") or {}).get(sk) or 0) if isinstance(d.get("skills"), dict) else 0
        b = r5.ab_mod(d, ab) + lvl * r5.prof(d)
        if not lvl and d.get("jack"):
            b += r5.prof(d) // 2
        return b

    # ================================================================== склад и лавка
    def _stash(self) -> dict:
        c = self.campaign
        s = c.extra.get("stash")
        if not isinstance(s, dict):
            s = c.extra["stash"] = {"items": [], "coins": {}}
        s.setdefault("items", [])
        s.setdefault("coins", {})
        return s

    def _shop(self) -> dict:
        c = self.campaign
        s = c.extra.get("shop")
        if not isinstance(s, dict):
            s = c.extra["shop"] = {"open": False, "name": "", "items": [], "rate": 50}
        return s

    def _rates(self) -> dict:
        return {u["id"]: int(u["rate"]) for u in gt.currency(self.campaign)}

    def _purse_base(self, coins: dict) -> int:
        r = self._rates()
        return sum(int(coins.get(k) or 0) * v for k, v in r.items())

    def _pay(self, coins: dict, price: int) -> dict | None:
        """Заплатить price (в самых мелких) из кошелька: сначала мелкими монетами, сдача — мелкими."""
        rates = sorted(self._rates().items(), key=lambda kv: kv[1])
        coins = {k: int(coins.get(k) or 0) for k, _ in rates} | {k: v for k, v in coins.items() if k not in dict(rates)}
        if self._purse_base(coins) < price:
            return None
        need = price
        for k, r in rates:
            use = min(coins[k], need // r)
            coins[k] -= use
            need -= use * r
        if need > 0:
            for k, r in rates:
                if coins[k] > 0 and r >= need:
                    coins[k] -= 1
                    change = r - need
                    need = 0
                    for k2, r2 in sorted(rates, key=lambda kv: -kv[1]):
                        if r2 < r:
                            n = change // r2
                            coins[k2] += n
                            change -= n * r2
                    break
        if need > 0:                      # редкий случай — переложим всё в базовые и раздадим крупными
            base = self._purse_base(coins) - need
            coins = {k: 0 for k, _ in rates}
            for k, r in sorted(rates, key=lambda kv: -kv[1]):
                coins[k] = base // r
                base -= coins[k] * r
        return coins

    def _give_coins(self, coins: dict, base: int) -> dict:
        coins = dict(coins)
        for k, r in sorted(self._rates().items(), key=lambda kv: -kv[1]):
            n = base // r
            if n:
                coins[k] = int(coins.get(k) or 0) + n
                base -= n * r
        return coins

    @staticmethod
    def _clean_item(it) -> dict | None:
        if not isinstance(it, dict):
            return None
        out = {k: v for k, v in it.items() if k in ("srd", "name", "kind", "w", "notes", "dmg", "dmg2", "dtype", "props", "range", "dist",
                                                    "cat", "ac", "acat", "dex", "maxdex", "strmin", "stealth")}
        out["name"] = gt._line(it.get("name") or "", 80) or "?"
        out["kind"] = it.get("kind") if it.get("kind") in ("gear", "consumable", "weapon", "armor", "shield") else "gear"
        try:
            out["qty"] = max(0.0, min(99999.0, float(it.get("qty") or 1)))
        except (TypeError, ValueError):
            out["qty"] = 1.0
        if out["qty"] == int(out["qty"]):
            out["qty"] = int(out["qty"])
        return out

    # ================================================================== сообщения
    async def _world_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")

        async def reply(extra: dict | None = None) -> None:
            await self._send(conn.ws, {"t": "ok", "rid": rid, **(extra or {})})

        GM = {"w_set", "w_time", "w_weather", "tmr_add", "tmr_del", "sroll", "stash_add", "stash_split", "stash_del",
              "shop_set", "shop_sell_ok", "shop_sell_no", "sess_draft", "sess_save", "sess_share", "sess_del", "chron_add"}
        if t in GM and not conn.gm:
            raise gt.ToolError("no_access")

        # ---------- мир
        if t == "w_get":
            await self._w_real_check()
            with c.lock:
                pend = [x for x in self._world()["timers"] if x.get("kind") == "real"]
            for x in pend:          # после перезапуска сервера — снова завести
                self._w_schedule(x)
            await self._send(conn.ws, {**self._w_public(conn.gm), "rid": rid})
            return
        if t == "w_set":
            with c.lock:
                w = self._world()
                if isinstance(data.get("months"), list):
                    ms = [{"name": gt._line(m.get("name") or "", 24) or "—", "days": gt._int(m.get("days"), 1, 400, 30)}
                          for m in data["months"][:24] if isinstance(m, dict)]
                    if ms:
                        w["months"] = ms
                for k, lo, hi in (("year", -100000, 100000), ("day", 1, 10 ** 7), ("minute", 0, 1439)):
                    if data.get(k) is not None:
                        w[k] = gt._int(data[k], lo, hi, w[k])
                if data.get("climate") in CLIMATES:
                    w["climate"] = data["climate"]
                for k in ("auto_weather", "weather_fx", "supplies", "ammo"):
                    if k in data:
                        w[k] = bool(data[k])
                c.touch()
            await reply()
            await self._w_push()
            return
        if t == "w_time":
            await reply()
            await self._w_advance(gt._int(data.get("add"), -100000, 100000, 0))
            return
        if t == "w_weather":
            with c.lock:
                w = self._world()
                if data.get("roll"):
                    w["weather"] = self._w_roll_weather(w)
                elif data.get("kind") in WEATHER:
                    w["weather"] = {"kind": data["kind"], "temp": gt._int(data.get("temp"), -60, 60, 15),
                                    "wind": data.get("wind") if data.get("wind") in ("calm", "light", "moderate", "strong") else "light"}
                elif data.get("kind") == "":
                    w["weather"] = None
                c.touch()
                wk = (w["weather"] or {}).get("kind")
            await reply()
            if wk:
                self._chron("weather", wk)
            await self._w_push()
            return
        if t == "tmr_add":
            with c.lock:
                w = self._world()
                kind = data.get("kind") if data.get("kind") in ("round", "min", "real") else "round"
                n = gt._int(data.get("n"), 1, 100000, 1)
                x = {"id": gt.uid(), "name": gt._line(data.get("name") or "", 60) or "…", "kind": kind, "vis": bool(data.get("vis"))}
                if kind == "real":
                    x["end"] = time.time() + n
                    x["dur"] = n
                else:
                    x["left"] = n
                w["timers"].append(x)
                w["timers"] = w["timers"][-30:]
                c.touch()
            await reply()
            await self._w_push()
            if kind == "real":
                self._w_schedule(x)
            await self._w_timer_note(x, "new")
            return
        if t == "tmr_del":
            with c.lock:
                w = self._world()
                w["timers"] = [x for x in w["timers"] if x.get("id") != data.get("id")]
                c.touch()
            await reply()
            await self._w_push()
            return

        # ---------- тайный бросок за всю партию
        if t == "sroll":
            sk = str(data.get("sk") or "perception")
            ok_sk = sk in self.SECRET_SKILLS or sk in ("str", "dex", "con", "int", "wis", "cha") or (sk.startswith("save_") and sk[5:] in self.SKILL_ABIL.values())
            if not ok_sk:
                raise gt.ToolError("bad_request")
            dc = gt._int(data.get("dc"), 0, 40, 0)
            ids = data.get("chars") if isinstance(data.get("chars"), list) else None
            res = []
            with c.lock:
                pids = {p.id for p in c.players}
                docs = [d for d in ch.chars(c) if isinstance(d, dict) and (d["id"] in ids if ids else d.get("owner") in pids)]
            for d in docs:
                b = self._skill_of_doc(d, sk)
                passive = 10 + b
                r = await self._make_roll(conn, f"1d20{b:+d}", f"{d.get('name')}: тайный бросок", "check", "normal", True,
                                          char_name=d.get("name") or "", gm_only=True)
                res.append({"name": d.get("name"), "id": d["id"], "roll": r["total"], "bonus": b, "passive": passive,
                            "ok": (r["total"] >= dc) if dc else None, "pok": (passive >= dc) if dc else None})
            await reply({"results": res, "sk": sk, "dc": dc})
            return

        # ---------- склад партии
        if t == "stash_get":
            with c.lock:
                await reply({"stash": copy.deepcopy(self._stash())})
            return
        if t in ("stash_put", "stash_take", "stash_coin", "stash_add", "stash_split", "stash_del"):
            await self._stash_op(conn, t, data)
            await reply()
            await self._broadcast({"t": "stash", "stash": copy.deepcopy(self._stash())})
            return

        # ---------- лавка
        if t == "shop_get":
            with c.lock:
                s = copy.deepcopy(self._shop())
            if not conn.gm and not s.get("open"):
                s = {"open": False}
            await reply({"shop": s})
            return
        if t == "shop_set":
            with c.lock:
                s = self._shop()
                if "open" in data:
                    s["open"] = bool(data["open"])
                if "name" in data:
                    s["name"] = gt._line(data.get("name") or "", 60)
                if "rate" in data:
                    s["rate"] = gt._int(data.get("rate"), 0, 100, 50)
                if isinstance(data.get("items"), list):
                    items = []
                    for x in data["items"][:300]:
                        it = self._clean_item(x)
                        if it is None:
                            continue
                        it["id"] = str(x.get("id") or gt.uid())[:12]
                        it["price"] = gt._int(x.get("price"), 0, 10 ** 9, 0)
                        it["stock"] = gt._int(x.get("stock"), -1, 99999, -1)
                        items.append(it)
                    s["items"] = items
                c.touch()
                was_open = s["open"]
            await reply()
            await self._shop_push()
            if data.get("open") and was_open:
                self._chron("shop", f"Открыта лавка «{self._shop().get('name') or '—'}»")
            return
        if t == "shop_buy":
            await self._shop_buy(conn, data, reply)
            return
        if t == "shop_sell":
            await self._shop_sell(conn, data, reply)
            return
        if t in ("shop_sell_ok", "shop_sell_no"):
            await self._shop_sell_decide(conn, t == "shop_sell_ok", data, reply)
            return

        # ---------- хроника и журнал сессий
        if t == "chron_add":
            self._chron(gt._line(data.get("k") or "note", 20), gt._line(data.get("text") or "", 300))
            await reply()
            return
        if t == "chron_lvl":
            d = ch.find(c, str(data.get("char") or ""))
            if d and (conn.gm or d.get("owner") == conn.pid):
                from . import rules5e as r5
                self._chron("lvl", f"{d.get('name')} достигает {r5.level(d)} уровня")
            await reply()
            return
        if t == "sess_list":
            with c.lock:
                lst = copy.deepcopy(c.extra.get("sessions") or [])
            await reply({"sessions": lst if conn.gm else [x for x in lst if x.get("shared")]})
            return
        if t == "sess_draft":
            await reply({"text": self._sess_draft()})
            return
        if t == "sess_save":
            with c.lock:
                lst = c.extra.get("sessions") if isinstance(c.extra.get("sessions"), list) else []
                sid = str(data.get("id") or "")
                old = next((x for x in lst if x.get("id") == sid), None)
                item = {"id": old["id"] if old else gt.uid(), "title": gt._line(data.get("title") or "", 100) or f"Сессия {len(lst) + 1}",
                        "text": gt._s(data.get("text") or "", 30000), "ts": old["ts"] if old else time.time(),
                        "shared": old.get("shared", False) if old else False}
                if old:
                    lst[lst.index(old)] = item
                else:
                    lst.append(item)
                    c.extra["chron_mark"] = time.time()      # следующая сессия начнётся отсюда
                c.extra["sessions"] = lst[-200:]
                c.touch()
            await reply({"session": item})
            return
        if t == "sess_del":
            with c.lock:
                c.extra["sessions"] = [x for x in c.extra.get("sessions") or [] if x.get("id") != data.get("id")]
                c.touch()
            await reply()
            return
        if t == "sess_share":
            with c.lock:
                s = next((x for x in c.extra.get("sessions") or [] if x.get("id") == data.get("id")), None)
                if s is None:
                    raise gt.ToolError("not_found")
                s["shared"] = True
                h = gt.clean_handout({"title": "В прошлый раз: " + s["title"], "text": s["text"]})
                h["to"] = "all"
                h["ts"] = int(time.time())
                gt.handouts(c).append(h)
                c.touch()
            await reply()
            await self._push_handouts()
            for x in list(self.conns):
                if not x.gm:
                    await self._send(x.ws, {"t": "handout_new", "id": h["id"], "title": h["title"]})
            return
        raise gt.ToolError("bad_request")

    # ------------------------------------------------------------------ склад
    async def _stash_op(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        changed = None
        with c.lock:
            s = self._stash()
            d = ch.find(c, str(data.get("char") or "")) if data.get("char") else None
            if d is not None and not conn.gm and d.get("owner") != conn.pid:
                raise gt.ToolError("no_access")
            if t == "stash_add":
                it = self._clean_item(data.get("item"))
                if it:
                    it["id"] = gt.uid()
                    s["items"].append(it)
                for k, n in (data.get("coins") or {}).items():
                    s["coins"][str(k)[:8]] = max(0, int(s["coins"].get(k) or 0) + gt._int(n, 0, 10 ** 9, 0))
            elif t == "stash_del":
                s["items"] = [x for x in s["items"] if x.get("id") != data.get("sid")]
            elif t == "stash_put":
                if d is None:
                    raise gt.ToolError("not_found")
                it = next((x for x in d.get("inventory") or [] if x.get("id") == data.get("item")), None)
                if it is None:
                    raise gt.ToolError("not_found")
                q = float(it.get("qty") or 1)
                n = min(q, max(0.0, float(data.get("qty") or q)))
                copy_it = self._clean_item({**it, "qty": n})
                copy_it["id"] = gt.uid()
                copy_it["by"] = d.get("name")
                same = next((x for x in s["items"] if x.get("name") == copy_it["name"] and x.get("srd") == copy_it.get("srd") and x.get("kind") == copy_it["kind"]), None)
                if same:
                    same["qty"] = same.get("qty", 0) + copy_it["qty"]
                else:
                    s["items"].append(copy_it)
                ops = [{"op": "remove", "path": ["inventory", it["id"]]}] if n >= q else [{"op": "set", "path": ["inventory", it["id"], "qty"], "value": q - n}]
                if n >= q:   # оружие убрали — и атаку с ним
                    ops += [{"op": "remove", "path": ["attacks", a["id"]]} for a in d.get("attacks") or [] if a.get("item") == it["id"]]
                changed = ch.patch(c, d["id"], ops)
                self._chron("stash", f"{d.get('name')} кладёт на склад: {copy_it['name']}" + (f" ×{n:g}" if n != 1 else ""))
            elif t == "stash_take":
                if d is None:
                    raise gt.ToolError("not_found")
                it = next((x for x in s["items"] if x.get("id") == data.get("sid")), None)
                if it is None:
                    raise gt.ToolError("not_found")
                q = float(it.get("qty") or 1)
                n = min(q, max(0.0, float(data.get("qty") or q)))
                new = {k: v for k, v in it.items() if k not in ("by",)}
                new.update(id=gt.uid(), qty=int(n) if n == int(n) else n, equipped=False)
                ops = [{"op": "add", "path": ["inventory"], "value": new}]
                if isinstance(data.get("attack"), dict):        # клиент собрал атаку для оружия
                    a = dict(data["attack"])
                    a["item"] = new["id"]
                    a["id"] = gt.uid()
                    ops.append({"op": "add", "path": ["attacks"], "value": a})
                changed = ch.patch(c, d["id"], ops)
                if n >= q:
                    s["items"].remove(it)
                else:
                    it["qty"] = q - n
                self._chron("stash", f"{d.get('name')} берёт со склада: {new['name']}" + (f" ×{n:g}" if n != 1 else ""))
            elif t == "stash_coin":
                if d is None:
                    raise gt.ToolError("not_found")
                unit = str(data.get("unit") or "")
                if unit not in self._rates():
                    raise gt.ToolError("bad_request")
                n = gt._int(data.get("n"), -10 ** 9, 10 ** 9, 0)
                have_char = int((d.get("coins") or {}).get(unit) or 0)
                have_st = int(s["coins"].get(unit) or 0)
                if n > 0 and have_char < n or n < 0 and have_st < -n:
                    raise gt.ToolError("no_money")
                s["coins"][unit] = have_st + n
                changed = ch.patch(c, d["id"], [{"op": "set", "path": ["coins", unit], "value": have_char - n}])
            elif t == "stash_split":
                pids = {p.id for p in c.players}
                pcs = [x for x in ch.chars(c) if isinstance(x, dict) and x.get("owner") in pids]
                if not pcs:
                    raise gt.ToolError("not_found")
                # каждую монету делим отдельно (золото — золотом), остаток остаётся на складе
                share = {k: int(v or 0) // len(pcs) for k, v in s["coins"].items() if int(v or 0) >= len(pcs)}
                changed_list = []
                for x in pcs:
                    coins = dict(x.get("coins") or {})
                    for k, n in share.items():
                        coins[k] = int(coins.get(k) or 0) + n
                    changed_list.append(ch.patch(c, x["id"], [{"op": "set", "path": ["coins"], "value": coins}]))
                s["coins"] = {k: int(v or 0) - share.get(k, 0) * len(pcs) for k, v in s["coins"].items() if int(v or 0) - share.get(k, 0) * len(pcs) > 0}
                self._chron("stash", f"Деньги склада поделены между {len(pcs)} персонажами")
                c.touch()
            c.touch()
        if t == "stash_split":
            for x in changed_list:
                await self._send_char(x)
                await self._push_summary(x)
        if changed is not None:
            await self._send_char(changed)
            await self._push_summary(changed)

    # ------------------------------------------------------------------ лавка
    async def _shop_push(self) -> None:
        with self.campaign.lock:
            s = copy.deepcopy(self._shop())
        for x in list(self.conns):
            await self._send(x.ws, {"t": "shop", "shop": s if (x.gm or s.get("open")) else {"open": False}})

    async def _shop_buy(self, conn, data: dict, reply) -> None:
        c = self.campaign
        with c.lock:
            s = self._shop()
            if not s.get("open") and not conn.gm:
                raise gt.ToolError("shop_closed")
            d = ch.find(c, str(data.get("char") or ""))
            if d is None or (not conn.gm and d.get("owner") != conn.pid):
                raise gt.ToolError("no_access")
            it = next((x for x in s["items"] if x.get("id") == data.get("id")), None)
            if it is None:
                raise gt.ToolError("not_found")
            n = gt._int(data.get("qty"), 1, 999, 1)
            if it.get("stock", -1) >= 0 and it["stock"] < n:
                raise gt.ToolError("out_of_stock")
            price = int(it.get("price") or 0) * n
            coins = self._pay(d.get("coins") or {}, price)
            if coins is None:
                raise gt.ToolError("no_money")
            new = {k: v for k, v in it.items() if k not in ("price", "stock")}
            new.update(id=gt.uid(), qty=n, equipped=False)
            ops = [{"op": "set", "path": ["coins"], "value": coins}, {"op": "add", "path": ["inventory"], "value": new}]
            if isinstance(data.get("attack"), dict):
                a = dict(data["attack"])
                a.update(item=new["id"], id=gt.uid())
                ops.append({"op": "add", "path": ["attacks"], "value": a})
            d = ch.patch(c, d["id"], ops)
            if it.get("stock", -1) >= 0:
                it["stock"] -= n
            c.touch()
            self._chron("shop", f"{d.get('name')} покупает: {new['name']}" + (f" ×{n}" if n > 1 else ""))
        await reply({"paid": price})
        await self._send_char(d)
        await self._push_summary(d)
        await self._shop_push()

    async def _shop_sell(self, conn, data: dict, reply) -> None:
        """Продажа — только с разрешения мастера: создаём запрос."""
        c = self.campaign
        with c.lock:
            s = self._shop()
            if not s.get("open") and not conn.gm:
                raise gt.ToolError("shop_closed")
            d = ch.find(c, str(data.get("char") or ""))
            if d is None or (not conn.gm and d.get("owner") != conn.pid):
                raise gt.ToolError("no_access")
            it = next((x for x in d.get("inventory") or [] if x.get("id") == data.get("item")), None)
            if it is None:
                raise gt.ToolError("not_found")
            n = min(float(it.get("qty") or 1), max(1.0, float(data.get("qty") or 1)))
            price = gt._int(data.get("price"), 0, 10 ** 9, 0)
        dec = self._dec_add("sell", d.get("name") or "?", {"what": it.get("name") or "?", "qty": n, "price": price},
                            sell={"char": d["id"], "item": it["id"], "qty": n, "price": price}, pid=conn.pid)
        await reply({"pending": dec["id"]})
        await self._dec_push()
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, {"t": "shop_sell_req", "id": dec["id"], "who": d.get("name"), "what": it.get("name"), "qty": n, "price": price})

    async def _shop_sell_decide(self, conn, ok: bool, data: dict, reply) -> None:
        c = self.campaign
        dec = self._dec_find(str(data.get("id") or ""))
        if dec is None or dec.get("kind") != "sell" or dec.get("state") != "pending":
            raise gt.ToolError("not_found")
        sale = dec["sell"]
        price = gt._int(data.get("price"), 0, 10 ** 9, sale["price"]) if data.get("price") is not None else sale["price"]
        d2 = None
        with c.lock:
            if ok:
                d = ch.find(c, sale["char"])
                it = next((x for x in (d or {}).get("inventory") or [] if x.get("id") == sale["item"]), None)
                if d is None or it is None:
                    dec["state"] = "no"
                    ok = False
                else:
                    q = float(it.get("qty") or 1)
                    n = min(q, sale["qty"])
                    ops = [{"op": "remove", "path": ["inventory", it["id"]]}] if n >= q else [{"op": "set", "path": ["inventory", it["id"], "qty"], "value": q - n}]
                    if n >= q:
                        ops += [{"op": "remove", "path": ["attacks", a["id"]]} for a in d.get("attacks") or [] if a.get("item") == it["id"]]
                    ops.append({"op": "set", "path": ["coins"], "value": self._give_coins(d.get("coins") or {}, price)})
                    d2 = ch.patch(c, d["id"], ops)
                    dec["state"] = "ok"
                    dec["text"]["price"] = price
                    self._chron("shop", f"{d.get('name')} продаёт: {it.get('name')}")
            else:
                dec["state"] = "no"
            c.touch()
        await reply()
        if d2 is not None:
            await self._send_char(d2)
            await self._push_summary(d2)
        await self._dec_push()
        for x in list(self.conns):
            if x.pid == dec.get("pid"):
                await self._send(x.ws, {"t": "shop_sell_res", "ok": ok, "what": dec["text"].get("what"), "price": price})

    # ------------------------------------------------------------------ черновик пересказа
    def _sess_draft(self) -> str:
        c = self.campaign
        mark = float(c.extra.get("chron_mark") or 0)
        ev = [x for x in c.extra.get("chron") or [] if x.get("ts", 0) > mark]
        if not ev:
            return ""
        out = []
        day = None
        for x in ev:
            if x.get("k") == "day":
                out.append(f"\n— {x['text']} —")
                continue
            if x.get("k") == "weather":
                continue
            if day != x.get("day"):
                day = x.get("day")
            out.append("• " + x["text"])
        return "\n".join(out).strip()
