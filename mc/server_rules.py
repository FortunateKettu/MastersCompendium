"""Правила боя по положению фишек (D&D 5e 2014).

  • ближняя атака — только по цели в пределах досягаемости (обычно 5 фт, у некоторых оружий и монстров 10);
  • дальняя атака, когда рядом (5 фт) враг, который может действовать, — с помехой. Летящие (состояние «Полёт»)
    и те, кто на земле, считаются на разной высоте и «рядом» друг для друга не бывают;
  • преимущество и помеха от состояний (лежит, опутан, ослеплён, невидим, парализован, «Уклонение» и т. д.),
    автоматический крит по парализованному/бессознательному вплотную;
  • атака по возможности: фишка вышла из досягаемости врага (без «Отхода») — тому, кто может ударить, приходит
    предложение потратить реакцию.

Всё это можно выключить в бою (галочка «Правила боя» у мастера).
"""
from __future__ import annotations

import re

from . import characters as ch
from . import gmtools as gt
from . import maps as mp
from . import rules5e as r5

INCAP = {"incapacitated", "paralyzed", "stunned", "unconscious", "petrified", "dead"}
REACH_RE = re.compile(r"(?:досягаемост[а-яё]*|reach)\s*(\d+)", re.I)


class RulesMixin:
    # ------------------------------------------------------------------ общее
    def _rules_on(self) -> bool:
        with self.campaign.lock:
            return gt.combat(self.campaign).get("rules", True) is not False

    def _r_tok(self, r: dict | None):
        """(карта, фишка) участника: по записи боя/фишке, иначе фишка персонажа на показанной карте."""
        if not r:
            return None, None
        c = self.campaign
        if r.get("token") and r.get("map"):
            m = mp.find(c, r["map"])
            tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == r["token"]), None)
            if tok is not None:
                return m, tok
        if r.get("char"):
            for m in [mp.find(c, mp.active_id(c) or "")] + mp.maps(c):
                tok = next((x for x in (m or {}).get("tokens", []) if x.get("char") == r["char"]), None)
                if tok is not None:
                    return m, tok
        return None, None

    def _r_conds(self, tok: dict) -> set:
        conds = set(tok.get("conds") or [])
        if tok.get("char"):
            d = ch.find(self.campaign, tok["char"])
            if d:
                conds |= set(d.get("conditions") or [])
        hp = tok.get("hp")
        if not tok.get("char") and isinstance(hp, dict) and hp.get("max") and hp.get("cur", 1) <= 0:
            conds.add("dead")
        return conds

    def _r_side(self, tok: dict) -> str:
        """«Свои» — фишки игроков (персонаж с хозяином-игроком или фишка с владельцем), остальные — противники."""
        c = self.campaign
        pids = {p.id for p in c.players}
        if tok.get("owner") in pids:
            return "pc"
        if tok.get("char"):
            d = ch.find(c, tok["char"])
            if d and d.get("owner") in pids:
                return "pc"
        return "foe"

    @staticmethod
    def _r_gap(m: dict, a: dict, b: dict, at: tuple | None = None) -> int:
        """Расстояние между краями фишек в футах (соседние клетки — 5 фт)."""
        g = m.get("grid") or {}
        size = float(g.get("size") or 70) or 70
        ft = int(g.get("ft") or 5) or 5
        ax, ay = at if at else (a["x"], a["y"])
        half = (float(a.get("s") or 1) + float(b.get("s") or 1)) / 2
        if g.get("on") and r5.is_hex(g):
            steps = r5.hex_steps(g, (ax, ay), (b["x"], b["y"]))
            return (int(max(0.0, steps - half) + 0.5) + 1) * ft
        dx, dy = abs(ax - b["x"]) / size, abs(ay - b["y"]) / size
        gx, gy = max(0.0, dx - half), max(0.0, dy - half)
        return (int(max(gx, gy) + 0.5) + 1) * ft

    def _r_reach(self, tok: dict) -> int:
        """Досягаемость: у монстра — из статблока («досягаемость 10 фт»), у персонажа 10 с оружием «Досягаемость»."""
        c = self.campaign
        best = 5
        if tok.get("mon"):
            mon = gt.find_monster(c, tok["mon"]) or {}
            for x in (mon.get("actions") or []):
                for v in REACH_RE.findall(str(x.get("text") or "")):
                    best = max(best, int(v))
        if tok.get("char"):
            d = ch.find(c, tok["char"]) or {}
            for a in d.get("attacks") or []:
                if isinstance(a, dict) and "reach" in (a.get("props") or []):
                    best = max(best, 10)
        return min(best, 30)

    # ------------------------------------------------------------------ атака
    def _r_attack(self, src: dict | None, tgt: dict, rng: str, reach: int, rmax: tuple = (0, 0)) -> dict:
        """Что меняют правила: {"adv": [...], "dis": [...], "crit": bool, "far": футы | None, "dist": футы | None,
        "ac": +к КД от укрытия, "full": полное укрытие}. rmax — (обычная, предельная) дистанция дальней атаки."""
        out = {"adv": [], "dis": [], "crit": False, "far": None, "dist": None, "ac": 0, "full": False}
        if not self._rules_on():
            return out
        ms, st = self._r_tok(src)
        mt, tt = self._r_tok(tgt)
        sc = self._r_conds(st) if st else set()
        tc = self._r_conds(tt) if tt else set()
        dist = self._r_gap(ms, st, tt) if st and tt and ms is mt else None
        out["dist"] = dist
        melee = rng == "melee"
        if melee and dist is not None and dist > reach:
            out["far"] = dist
        # дальность стрельбы: за обычной — помеха, за предельной — нельзя
        if rng == "ranged" and dist is not None and rmax and rmax[0]:
            if rmax[1] and dist > rmax[1]:
                out["far"] = dist
            elif dist > rmax[0]:
                out["dis"].append("long_range")
        # укрытие: отмеченное у цели или существа на линии выстрела (половинное)
        cov = 5 if "cover_3q" in tc else 2 if "cover_half" in tc else 0
        if "cover_full" in tc:
            out["full"] = True
        if not cov and st is not None and tt is not None and ms is mt and dist is not None and dist > 5:
            if self._r_between(ms, st, tt):
                cov = 2
                out["auto_cover"] = True
        if cov:
            out["ac"] = cov
        # спрятался: атака по нему — с помехой; из укрытия — с преимуществом
        if "hiding" in tc:
            out["dis"].append("tgt_hidden")
        if "hiding" in sc:
            out["adv"].append("src_hidden")
        if rng == "ranged" and st is not None:
            fly = "flying" in sc
            for x in ms.get("tokens", []):
                if x is st or x.get("hidden") or self._r_side(x) == self._r_side(st):
                    continue
                xc = self._r_conds(x)
                if xc & INCAP or ("flying" in xc) != fly:
                    continue
                if self._r_gap(ms, st, x) <= 5:
                    out["dis"].append("foe_adjacent")
                    break
        # состояния цели
        close = dist is not None and dist <= 5
        if "prone" in tc:
            (out["adv"] if close and melee else out["dis"]).append("tgt_prone")
        for k in ("restrained", "paralyzed", "stunned", "unconscious", "petrified", "blinded"):
            if k in tc:
                out["adv"].append("tgt_" + k)
        if "invisible" in tc:
            out["dis"].append("tgt_invisible")
        if "dodge" in tc and not (tc & INCAP):
            out["dis"].append("tgt_dodge")
        if close and melee and tc & {"paralyzed", "unconscious"}:
            out["crit"] = True
        # состояния атакующего
        for k in ("prone", "restrained", "blinded", "poisoned", "frightened"):
            if k in sc:
                out["dis"].append("src_" + k)
        if "invisible" in sc:
            out["adv"].append("src_invisible")
        return out

    def _r_between(self, m: dict, a: dict, b: dict) -> bool:
        """Есть ли существо на линии между двумя фишками (даёт половинное укрытие)."""
        ax, ay, bx, by = a["x"], a["y"], b["x"], b["y"]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy or 1
        size = float((m.get("grid") or {}).get("size") or 70) or 70
        for x in m.get("tokens", []):
            if x is a or x is b or x.get("hidden"):
                continue
            k = ((x["x"] - ax) * dx + (x["y"] - ay) * dy) / ll
            if k <= 0.05 or k >= 0.95:
                continue
            px, py = ax + k * dx, ay + k * dy
            r = float(x.get("s") or 1) * size * 0.42
            if (x["x"] - px) ** 2 + (x["y"] - py) ** 2 <= r * r and not (self._r_conds(x) & {"dead"}):
                return True
        return False

    def _oa_peek(self, src: dict | None, tgt: dict) -> bool:
        import time as _t
        if not src or src.get("entry") is None:
            return False
        _m, tt = self._r_tok(tgt)
        ts = getattr(self, "_oa_pend", {}).get((src["entry"]["id"], tt["id"])) if tt else None
        return ts is not None and _t.monotonic() - ts < 120

    def _oa_ok(self, src: dict | None, tgt: dict) -> bool:
        """Атака по возможности, которую предложили (2 минуты на ответ): расстояние не проверяем."""
        import time as _t
        if not src or src.get("entry") is None:
            return False
        _m, tt = self._r_tok(tgt)
        if tt is None:
            return False
        pend = getattr(self, "_oa_pend", {})
        ts = pend.pop((src["entry"]["id"], tt["id"]), None)
        return ts is not None and _t.monotonic() - ts < 120

    @staticmethod
    def _r_mode(user_mode: str, mods: dict) -> str:
        adv = bool(mods["adv"]) or user_mode == "adv"
        dis = bool(mods["dis"]) or user_mode == "dis"
        return "adv" if adv and not dis else "dis" if dis and not adv else "normal"

    # ------------------------------------------------------------------ атака по возможности
    async def _r_after_move(self, m: dict, tok_id: str, old: tuple, new: tuple) -> None:
        await self._r_grapple_check(m, tok_id)          # захват снимаем всегда, даже без правил боя
        if not self._rules_on():
            return
        await self._r_spot(m)
        c = self.campaign
        with c.lock:
            cb = gt.combat(c)
            if not cb.get("active"):
                return
            tok = next((x for x in m.get("tokens", []) if x.get("id") == tok_id), None)
            if tok is None:
                return
            tc = self._r_conds(tok)
            if "disengage" in tc or tc & INCAP:
                return
            fly = "flying" in tc
            side = self._r_side(tok)
            mover = next((e for e in cb["list"] if e.get("token") == tok_id or (tok.get("char") and e.get("char") == tok.get("char"))), None)
            offers = []
            for x in m.get("tokens", []):
                if x is tok or self._r_side(x) == side:
                    continue
                xc = self._r_conds(x)
                if xc & INCAP or ("flying" in xc) != fly:
                    continue
                e = next((q for q in cb["list"] if q.get("token") == x.get("id") or (x.get("char") and q.get("char") == x.get("char"))), None)
                if e is None or (e.get("econ") or {}).get("r") or "surprised" in xc:
                    continue          # не в бою, реакция уже потрачена или застигнут врасплох
                if self._r_dead(x, e):
                    continue          # мёртвые и без сознания не бьют
                if "blinded" in xc or tc & {"invisible", "hiding"}:
                    continue          # бьют только того, кого видят
                if self._r_side(x) == "pc" and (tok.get("hidden") or (m.get("fog", {}).get("on") and not mp.in_open_zone(m, old[0], old[1])
                                                                    and not mp.in_open_zone(m, new[0], new[1]))):
                    continue          # фишку, скрытую мастером или туманом, игроки не видят — и не узнают о ней из предложения
                reach = self._r_reach(x)
                if self._r_left_reach(m, tok, x, old, new, reach):
                    offers.append((x, e))
        pend = getattr(self, "_oa_pend", {})
        for x, e in offers:
            pend[(e["id"], tok["id"])] = __import__("time").monotonic()
        self._oa_pend = pend
        for x, e in offers:
            msg = {"t": "cb_oa", "src": {"e": e["id"]}, "tgt": {"map": m["id"], "token": tok["id"]},
                   "tgt_e": mover["id"] if mover else "", "who": e["name"], "tgt_name": tok.get("name") or (mover or {}).get("name", "?")}
            if self._r_side(x) == "pc":           # бьёт персонаж игрока — предлагаем игроку
                d = ch.find(c, x.get("char") or "") if x.get("char") else None
                owner = (d or {}).get("owner") or x.get("owner")
                targets = [conn for conn in self.conns if conn.pid == owner]
            else:                                  # бьёт противник — мастеру
                targets = [conn for conn in self.conns if conn.gm]
            for conn in targets:
                await self._send(conn.ws, msg)

    def _r_dead(self, tok: dict, e: dict | None) -> bool:
        if self._r_conds(tok) & {"dead", "unconscious"}:
            return True
        hp = tok.get("hp") if isinstance(tok.get("hp"), dict) else None
        if hp and hp.get("max") and int(hp.get("cur") or 0) <= 0:
            return True
        ehp = (e or {}).get("hp") if isinstance((e or {}).get("hp"), dict) else None
        if ehp and ehp.get("max") and int(ehp.get("cur") or 0) <= 0:
            return True
        if tok.get("char"):
            d = ch.find(self.campaign, tok["char"])
            if d and int(((d.get("hp") or {}).get("cur")) or 0) <= 0 and int(((d.get("hp") or {}).get("max")) or 0) > 0:
                return True
        return False

    def _r_left_reach(self, m: dict, tok: dict, x: dict, old: tuple, new: tuple, reach: int) -> bool:
        """Покинул ли досягаемость x за этот ход: проверяем весь путь (прошёл мимо — тоже считается)."""
        if self._r_gap(m, tok, x, at=new) <= reach:
            return False
        size = float((m.get("grid") or {}).get("size") or 70) or 70
        dist = ((new[0] - old[0]) ** 2 + (new[1] - old[1]) ** 2) ** 0.5
        n = max(1, int(dist / (size / 4)))
        for i in range(n + 1):
            k = i / n
            p = (old[0] + (new[0] - old[0]) * k, old[1] + (new[1] - old[1]) * k)
            if self._r_gap(m, tok, x, at=p) <= reach:
                return True
        return False

    async def _r_grapple_check(self, m: dict, tok_id: str) -> None:
        """Захват держится, только пока схвативший рядом (и сам может действовать)."""
        c = self.campaign
        pushes = {"chars": {}, "maps": {}}
        released = []
        with c.lock:
            cb = gt.combat(c)
            gr = cb.get("grapples") or {}
            for tkey, skey in list(gr.items()):
                tgt = self._resolve(self._r_spec(tkey))
                src = self._resolve(self._r_spec(skey))
                if tgt is None:
                    gr.pop(tkey, None)
                    continue
                mt, tt = self._r_tok(tgt)
                ms, st = self._r_tok(src) if src else (None, None)
                if tt is not None and "grappled" not in self._r_conds(tt):
                    gr.pop(tkey, None)          # «схвачен» сняли вручную — запись о захвате больше не нужна
                    continue
                if tt is None or (tok_id is not None and tt.get("id") != tok_id and (st or {}).get("id") != tok_id and src is not None):
                    continue
                far = st is None or ms is not mt or self._r_gap(mt, st, tt) > max(5, self._r_reach(st))
                if far or self._r_conds(st) & INCAP or self._r_dead(st, (src or {}).get("entry")):
                    self._cond_set(tgt, "grappled", False, pushes)
                    gr.pop(tkey, None)
                    released.append(tgt["name"])
            # «Схвачен» поставили вручную (без записи, кто держит): фишка ушла и рядом нет противника — свободна
            tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == tok_id), None) if tok_id else None
            if tok is not None and "grappled" in self._r_conds(tok):
                keyed = any((self._resolve(self._r_spec(k)) or {}).get("token") == tok_id for k in gr)
                if not keyed:
                    side = self._r_side(tok)
                    near = any(x is not tok and self._r_side(x) != side and not (self._r_conds(x) & INCAP) and not self._r_dead(x, None)
                               and self._r_gap(m, tok, x) <= max(5, self._r_reach(x)) for x in m.get("tokens", []))
                    if not near:
                        r = {"char": tok.get("char") or "", "map": m["id"], "token": tok["id"], "entry": None, "name": tok.get("name") or "?"}
                        if tok.get("char"):
                            d = ch.find(c, tok["char"])
                            if d is not None:
                                self._cond_set({**r, "char": tok["char"]}, "grappled", False, pushes)
                        if "grappled" in (tok.get("conds") or []):
                            self._cond_set({**r, "char": ""}, "grappled", False, pushes)
                        released.append(r["name"])
            if released:
                c.touch()
        if released:
            await self._flush(pushes)
            await self._push_combat()
            await self._broadcast({"t": "cb_events", "events": [{"k": "grapple_free", "who": n} for n in released]})

    # ================================================================== навыки (для приёмов и скрытности)
    SKILL_AB = {"athletics": "str", "acrobatics": "dex", "stealth": "dex", "perception": "wis", "medicine": "wis"}
    SKILL_WORDS = {"athletics": ("атлет", "athlet"), "acrobatics": ("акроб", "acrob"), "stealth": ("скрыт", "stealth"),
                   "perception": ("внимат", "восприят", "percep"), "medicine": ("медиц", "medic")}

    def _r_doc_mon(self, r: dict):
        c = self.campaign
        d = ch.find(c, r["char"]) if r.get("char") else None
        mon = None
        if d is None:
            mid = r.get("mon") or ((r.get("entry") or {}).get("mon"))
            if not mid:
                _, tok = self._r_tok(r)
                mid = (tok or {}).get("mon")
            mon = gt.find_monster(c, mid) if mid else None
        return d, mon

    def _r_skill(self, r: dict, sk: str) -> int:
        """Бонус навыка: у персонажа — характеристика + владение, у монстра — из строки «Навыки» или характеристика."""
        d, mon = self._r_doc_mon(r)
        ab = self.SKILL_AB[sk]
        if d is not None:
            lvl = int((d.get("skills") or {}).get(sk) or 0) if isinstance(d.get("skills"), dict) else 0
            b = r5.ab_mod(d, ab) + lvl * r5.prof(d)
            if not lvl and d.get("jack"):
                b += r5.prof(d) // 2
            return b
        if mon is not None:
            s = str(mon.get("skills") or "").lower()
            for w in self.SKILL_WORDS[sk]:
                mm = re.search(rf"{w}[а-яёa-z]*\s*([+−-]\s*\d+)", s)
                if mm:
                    return int(mm.group(1).replace("−", "-").replace(" ", ""))
            return r5.mod((mon.get("abil") or {}).get(ab, 10))
        return 0

    def _r_passive(self, r: dict) -> int:
        d, mon = self._r_doc_mon(r)
        if mon is not None:
            mm = re.search(r"(?:пассивн[а-яё]*\s+(?:внимательност[а-яё]*|восприяти[а-яё]*)|passive\s+perception)\s*(\d+)", str(mon.get("senses") or ""), re.I)
            if mm:
                return int(mm.group(1))
        return 10 + self._r_skill(r, "perception")

    def _r_ref(self, m: dict, tok: dict) -> dict:
        """Фишка → описание как у _resolve (для навыков и состояний)."""
        c = self.campaign
        cb = gt.combat(c)
        e = next((q for q in cb.get("list") or [] if q.get("token") == tok.get("id") or (tok.get("char") and q.get("char") == tok.get("char"))), None)
        return {"entry": e, "name": tok.get("name") or (e or {}).get("name") or "?", "char": tok.get("char") or "", "map": m["id"],
                "token": tok["id"], "mon": tok.get("mon") or "", "hidden": bool(tok.get("hidden"))}

    # ================================================================== приёмы: захват, толчок, высвободиться, спрятаться, стабилизировать
    SIZE_IDX = {0.5: 1, 1: 1, 2: 2, 3: 3, 4: 4}

    async def _r_maneuver(self, conn, data: dict, reply) -> None:
        c = self.campaign
        kind = data.get("kind")
        if kind not in ("grapple", "shove", "escape", "hide", "stabilize"):
            raise gt.ToolError("bad_request")
        src = self._resolve(data.get("src"))
        if src is None:
            raise gt.ToolError("not_found")
        if not self._can_act(conn, src):
            raise gt.ToolError("no_access")
        tgt = self._resolve(data.get("tgt")) if data.get("tgt") else None
        if kind in ("grapple", "shove", "stabilize") and tgt is None:
            raise gt.ToolError("need_target")
        hidden = conn.gm and bool(src.get("hidden"))
        npc_secret = not self._is_pc(src)
        pushes = {"chars": {}, "maps": {}}
        ms, st = self._r_tok(src)
        mt, tt = self._r_tok(tgt) if tgt else (None, None)
        if tgt is not None and st is not None and tt is not None and ms is mt and not conn.gm and self._r_gap(ms, st, tt) > 5:
            raise gt.ToolError("too_far")
        res = {"kind": kind, "ok": False}
        cb = gt.combat(c)

        async def contest(a: dict, a_sk: str, b: dict, b_sks: tuple, label: str) -> tuple[bool, int, int]:
            ab = self._r_skill(a, a_sk)
            bb = max(self._r_skill(b, s) for s in b_sks)
            ra = await self._make_roll(conn, f"1d20{ab:+d}", f"{a['name']}: {label}", "check", "normal", hidden, char_name=a["name"])
            rb = await self._make_roll(conn, f"1d20{bb:+d}", f"{b['name']}: {label} (сопротивление)", "check", "normal", hidden,
                                       char_name=b["name"])
            return ra["total"] >= rb["total"], ra["total"], rb["total"]

        if kind in ("grapple", "shove"):
            if st and tt and self.SIZE_IDX.get(float(tt.get("s") or 1), 3) - self.SIZE_IDX.get(float(st.get("s") or 1), 1) > 1:
                raise gt.ToolError("too_big")
            ok, a, b = await contest(src, "athletics", tgt, ("athletics", "acrobatics"), "Захват" if kind == "grapple" else "Толчок")
            res.update(ok=ok, a=a, b=b)
            if ok:
                with c.lock:
                    if kind == "grapple":
                        self._cond_set(tgt, "grappled", True, pushes)
                        cb.setdefault("grapples", {})[self._r_key(tgt)] = self._r_key(src)
                    else:
                        self._cond_set(tgt, "prone", True, pushes)
        elif kind == "escape":
            gkey = (cb.get("grapples") or {}).get(self._r_key(src))
            if gkey is None:                # захват мог быть записан по фишке, а вырывается участник боя (или наоборот)
                _ms, _st = self._r_tok(src)
                for tk, sk in (cb.get("grapples") or {}).items():
                    _mt, _tt = self._r_tok(self._resolve(self._r_spec(tk)) or {"map": "", "token": "", "char": "", "entry": None})
                    if _tt is not None and _st is not None and _tt.get("id") == _st.get("id"):
                        gkey = sk
                        (cb.get("grapples") or {})[self._r_key(src)] = sk
                        break
            grab = self._resolve(self._r_spec(gkey)) if gkey else None
            if grab is None:            # кто держит — неизвестно: сложность 10 + бонус Атлетики 0
                ab = max(self._r_skill(src, "athletics"), self._r_skill(src, "acrobatics"))
                rr = await self._make_roll(conn, f"1d20{ab:+d}", f"{src['name']}: высвободиться · СЛ 10", "check", "normal", hidden, char_name=src["name"])
                ok, a, b = rr["total"] >= 10, rr["total"], 10
            else:
                ab = max(self._r_skill(src, "athletics"), self._r_skill(src, "acrobatics"))
                ra = await self._make_roll(conn, f"1d20{ab:+d}", f"{src['name']}: высвободиться", "check", "normal", hidden, char_name=src["name"])
                bb = self._r_skill(grab, "athletics")
                rb = await self._make_roll(conn, f"1d20{bb:+d}", f"{grab['name']}: удержать", "check", "normal", hidden, char_name=grab["name"])
                ok, a, b = ra["total"] >= rb["total"], ra["total"], rb["total"]
            res.update(ok=ok, a=a, b=b)
            if ok:
                with c.lock:
                    self._cond_set(src, "grappled", False, pushes)
                    _ms, _st = self._r_tok(src)
                    for tk in list((cb.get("grapples") or {})):
                        _r = self._resolve(self._r_spec(tk))
                        if tk == self._r_key(src) or (_r and _st is not None and (self._r_tok(_r)[1] or {}).get("id") == _st.get("id")):
                            cb["grapples"].pop(tk, None)
        elif kind == "hide":
            bonus = self._r_skill(src, "stealth")
            rr = await self._make_roll(conn, f"1d20{bonus:+d}", f"{src['name']}: Скрытность", "check", "normal", hidden or npc_secret,
                                       char_name=src["name"], gm_only=npc_secret)
            with c.lock:
                if src["entry"] is not None:
                    src["entry"]["stealth"] = rr["total"]
                self._cond_set(src, "hiding", True, pushes)
                if st is not None and npc_secret and not st.get("hidden"):
                    st["hidden"] = True
                    st["hid_by_hide"] = True
                    pushes["maps"][ms["id"]] = ms
                if st is not None:
                    st["stealth"] = rr["total"]
            res.update(ok=True, a=rr["total"] if not npc_secret or conn.gm else None)
        elif kind == "stabilize":
            d = ch.find(c, tgt["char"]) if tgt.get("char") else None
            if d is None or int((d.get("hp") or {}).get("cur") or 0) > 0:
                raise gt.ToolError("not_dying")
            bonus = self._r_skill(src, "medicine")
            rr = await self._make_roll(conn, f"1d20{bonus:+d}", f"{src['name']} → {tgt['name']}: Медицина · СЛ 10", "check", "normal", hidden, char_name=src["name"])
            ok = rr["total"] >= 10
            res.update(ok=ok, a=rr["total"], b=10)
            if ok:
                with c.lock:
                    d = ch.patch(c, d["id"], [{"op": "set", "path": ["death"], "value": {"ok": 3, "fail": int((d.get("death") or {}).get("fail") or 0)}}])
                    pushes["chars"][d["id"]] = d
                self._chron("death", f"{src['name']} стабилизирует {tgt['name']}")
        with c.lock:
            if src["entry"] is not None and cb.get("active") and data.get("spend", True):
                src["entry"].setdefault("econ", gt.clean_econ({}))[data.get("cost") if data.get("cost") in gt.ECON_KEYS else "a"] = True
            gt.cb_log(cb, "", hidden)
            cb["log"][-1].update(k="mnv", who=src["name"], tgt=(tgt or {}).get("name", ""), mnv=kind, ok=res["ok"], secret=kind == "hide" and npc_secret)
            c.touch()
        await reply(res)
        await self._flush(pushes)
        await self._push_combat()
        if kind == "hide" and ms is not None and st is not None:
            await self._r_spot(ms)

    def _r_key(self, r: dict) -> str:
        if r.get("entry") is not None:
            return "e:" + r["entry"]["id"]
        if r.get("token"):
            return f"t:{r['map']}:{r['token']}"
        return "c:" + (r.get("char") or "")

    @staticmethod
    def _r_spec(key: str) -> dict | None:
        if not key:
            return None
        if key.startswith("e:"):
            return {"e": key[2:]}
        if key.startswith("t:"):
            _, mid, tid = key.split(":", 2)
            return {"map": mid, "token": tid}
        return {"char": key[2:]}

    # ================================================================== скрытность против пассивной Внимательности
    async def _r_spot(self, m: dict, near_ft: int = 30) -> None:
        """Каждый спрятавшийся проверяется против пассивной Внимательности врагов рядом (30 фт)."""
        if not self._rules_on():
            return
        c = self.campaign
        found = []
        pushes = {"chars": {}, "maps": {}}
        with c.lock:
            for h in m.get("tokens", []):
                hc = self._r_conds(h)
                if "hiding" not in hc:
                    continue
                stealth = int(h.get("stealth") or 0)
                side = self._r_side(h)
                for x in m.get("tokens", []):
                    if x is h or self._r_side(x) == side or self._r_conds(x) & INCAP:
                        continue
                    if self._r_gap(m, h, x) > near_ft:
                        continue
                    if self._r_passive(self._r_ref(m, x)) >= stealth:
                        found.append((h, x))
                        break
            for h, x in found:
                self._r_reveal(m, h, pushes)
        await self._flush(pushes)
        for h, x in found:
            await self._broadcast({"t": "cb_events", "events": [{"k": "spotted", "map": m["id"], "token": h["id"],
                                                                  "who": x.get("name") or "?", "tgt": h.get("name") or "?"}]})
        if found:
            await self._push_combat()

    def _r_reveal(self, m: dict, tok: dict, pushes: dict) -> None:
        r = self._r_ref(m, tok)
        self._cond_set(r, "hiding", False, pushes)
        if tok.get("hid_by_hide"):
            tok["hidden"] = False
            tok.pop("hid_by_hide", None)
        tok.pop("stealth", None)
        pushes["maps"][m["id"]] = m
        self.campaign.touch()

    # ================================================================== трудная местность
    @staticmethod
    def _r_terrain_cost(m: dict, a: tuple, b: tuple, base: int) -> int:
        """Сколько стоит перемещение: по трудной местности каждый фут — за два."""
        zones = [z.get("pts") for z in (m.get("terrain") or []) if isinstance(z, dict) and len(z.get("pts") or []) >= 3]
        if not zones or base <= 0:
            return base
        n = 24
        inside = 0
        for i in range(n):
            k = (i + 0.5) / n
            x, y = a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k
            if any(mp.point_in_poly(x, y, p) for p in zones):
                inside += 1
        return base + round(base * inside / n)

    # ================================================================== спасброски от смерти
    async def _r_death_turn(self) -> None:
        """Начало хода персонажа игрока с 0 хитов — бросок спасброска от смерти сам."""
        if not self._rules_on():
            return
        c = self.campaign
        with c.lock:
            cb = gt.combat(c)
            cur = next((x for x in cb.get("list") or [] if x.get("id") == cb.get("cur")), None)
            d = ch.find(c, cur["char"]) if cur and cur.get("char") else None
            if d is None or not self._is_pc({"char": d["id"]}):
                return
            hp = d.get("hp") or {}
            death = d.get("death") if isinstance(d.get("death"), dict) else {}
            if int(hp.get("cur") or 0) > 0 or int(hp.get("max") or 0) <= 0 or int(death.get("ok") or 0) >= 3 or int(death.get("fail") or 0) >= 3:
                return
        conn = next((x for x in self.conns if x.gm), None) or next(iter(self.conns), None)
        if conn is None:
            return
        r = await self._make_roll(conn, "1d20", f"{d.get('name')}: спасбросок от смерти", "death", "normal", False, char_name=d.get("name") or "")
        p0 = (r.get("parts") or [{}])[0]
        rolls = p0.get("rolls") or [r["total"]]
        nat = rolls[(p0.get("kept") or [0])[0]] if rolls else r["total"]
        ok, fail = int(death.get("ok") or 0), int(death.get("fail") or 0)
        ops = []
        res = ""
        if nat == 20:
            ops = [{"op": "set", "path": ["hp", "cur"], "value": 1}, {"op": "set", "path": ["death"], "value": {"ok": 0, "fail": 0}}]
            res = "nat20"
        else:
            if nat == 1:
                fail += 2
            elif r["total"] >= 10:
                ok += 1
            else:
                fail += 1
            ok, fail = min(3, ok), min(3, fail)
            ops = [{"op": "set", "path": ["death"], "value": {"ok": ok, "fail": fail}}]
            res = "stable" if ok >= 3 else "dead" if fail >= 3 else ""
            if res == "dead":
                self._chron("death", f"{d.get('name')} погибает")
        with c.lock:
            d = ch.patch(c, d["id"], ops)
            cb = gt.combat(c)
            gt.cb_log(cb, "", False)
            cb["log"][-1].update(k="death", who=d.get("name"), roll=r["total"], ok=ok, fail=fail, res=res)
        await self._send_char(d)
        await self._push_summary(d)
        await self._broadcast({"t": "cb_events", "events": [{"k": "death_save", "who": d.get("name"), "roll": r["total"], "ok": ok, "fail": fail, "res": res}]})

    def _r_damage_down(self, r: dict, before: int, amount: int, crit: bool, pushes: dict) -> None:
        """Урон по персонажу с 0 хитов — провал спасброска от смерти (крит — два); лечение с 0 — всё сначала."""
        if not r.get("char") or not self._rules_on():
            return
        c = self.campaign
        d = ch.find(c, r["char"])
        if d is None or not self._is_pc(r):
            return
        death = d.get("death") if isinstance(d.get("death"), dict) else {}
        if amount > 0 and before <= 0:
            fail = min(3, int(death.get("fail") or 0) + (2 if crit else 1))
            d = ch.patch(c, d["id"], [{"op": "set", "path": ["death"], "value": {"ok": int(death.get("ok") or 0), "fail": fail}}])
            pushes["chars"][d["id"]] = d
        elif amount < 0 and before <= 0 and (death.get("ok") or death.get("fail")):
            d = ch.patch(c, d["id"], [{"op": "set", "path": ["death"], "value": {"ok": 0, "fail": 0}}])
            pushes["chars"][d["id"]] = d

    def _r_after_hp(self, r: dict, before: int | None, cur: int, mx: int, pushes: dict) -> None:
        """Хиты изменились: 0 хитов — без сознания и ничком (персонаж), концентрация прерывается;
        вылечили с нуля — приходит в себя."""
        if not self._rules_on():
            return
        conds = set(self._conds_of(r))
        if cur <= 0 and mx > 0:
            if r.get("char") and self._is_pc(r):
                if "unconscious" not in conds:
                    self._cond_set(r, "unconscious", True, pushes)
                if "prone" not in conds:
                    self._cond_set(r, "prone", True, pushes)
            if "concentration" in conds:
                self._cond_set(r, "concentration", False, pushes)
            if r.get("entry") is not None:
                r["entry"]["conc"] = ""
                # уклонение и подготовленное действие тоже пропадают
                r["entry"]["effects"] = [f for f in r["entry"].get("effects") or [] if f.get("cond") not in ("dodge", "ready")]
            for k in ("dodge", "ready", "hiding"):
                if k in conds:
                    self._cond_set(r, k, False, pushes)
        elif cur > 0 and before is not None and before <= 0 and r.get("char") and "unconscious" in conds:
            self._cond_set(r, "unconscious", False, pushes)

    # ================================================================== внезапность
    def _r_surprise_turn(self, cb: dict, pushes: dict) -> str | None:
        """Застигнутый врасплох в первом раунде пропускает ход; снимаем «Врасплох» с того, кто уже отходил."""
        for e in cb.get("list") or []:
            if e.get("surp_done"):
                r = self._resolve({"e": e["id"]})
                if r:
                    self._cond_set(r, "surprised", False, pushes)
                e["effects"] = [f for f in e.get("effects") or [] if f.get("cond") != "surprised"]
                e.pop("surp_done", None)
        cur = next((x for x in cb.get("list") or [] if x.get("id") == cb.get("cur")), None)
        if cur is None:
            return None
        r = self._resolve({"e": cur["id"]})
        if r and "surprised" in self._conds_of(r):
            if int(cb.get("round") or 1) <= 1:
                cur["econ"] = {"a": True, "b": True, "r": True, "mv": 9999}
                cur["surp_done"] = True
                return cur["name"]
            self._cond_set(r, "surprised", False, pushes)
            cur["effects"] = [f for f in cur.get("effects") or [] if f.get("cond") != "surprised"]
        return None
