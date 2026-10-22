"""Журнал действий игроков: всё, что игроки делают в кампании, — с возможностью откатить.

Записывается: правки листа (хиты, вещи, монеты, опыт, уровень, состояния…), перемещения фишек,
боевые действия (атаки, спасброски, лечение, приёмы), броски, покупки, склад.
Мастер видит журнал в разделе «Мастер → Журнал», фильтрует по игроку и виду и может откатить запись:
лист — к прежним значениям тех полей, что меняла запись; фишку — на прежнее место; бой — хиты целей как были.
Подряд идущие мелкие правки одного и того же (печатает заметку, двигает фишку по клеткам) склеиваются в одну запись.
"""
from __future__ import annotations

import copy
import time

from . import characters as ch
from . import gmtools as gt
from . import maps as mp

ACT_KEEP = 400
MERGE_SEC = 40
KEY_RU = {"name": "имя", "portrait": "портрет", "race": "раса", "classes": "классы", "background": "предыстория", "alignment": "мировоззрение",
          "xp": "опыт", "abilities": "характеристики", "saves": "спасброски", "skills": "навыки", "profs": "владения", "ac": "КД",
          "init_bonus": "инициатива", "speed": "скорость", "hp": "хиты", "hd_used": "кости хитов", "death": "спасброски от смерти",
          "inspiration": "вдохновение", "attacks": "атаки", "spells": "заклинания", "resources": "ресурсы", "inventory": "снаряжение",
          "coins": "монеты", "features": "умения", "conditions": "состояния", "exhaustion": "истощение", "persona": "личность",
          "notes": "заметки", "lvl_ok": "разрешение на уровень", "show_hp": "показ хитов"}
COMBAT_T = {"cb_attack": "атака", "cb_save": "спасбросок", "cb_heal": "лечение", "cb_maneuver": "приём", "cb_econ": "действие",
            "cb_effect": "эффект", "cb_conc": "концентрация"}
TRADE_T = {"stash_put", "stash_take", "stash_coin", "shop_buy", "shop_sell"}


def _num(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


class ActLogMixin:
    # ------------------------------------------------------------------ хранение
    def _acts(self) -> list:
        v = self.campaign.extra.get("actlog")
        if not isinstance(v, list):
            v = self.campaign.extra["actlog"] = []
        return v

    def _act_who(self, conn) -> tuple[str, str, str]:
        p = getattr(conn, "player", None)
        return (getattr(p, "id", "") or "", getattr(p, "name", "") or "?", getattr(p, "color", "") or "#888")

    async def _act_add(self, conn, kind: str, text: str, undo: dict | None = None, merge_key: str = "", **extra) -> dict | None:
        if conn is None or conn.gm:
            return None
        pid, name, color = self._act_who(conn)
        now = time.time()
        with self.campaign.lock:
            lst = self._acts()
            last = lst[-1] if lst else None
            if (merge_key and last and last.get("mk") == merge_key and last.get("pid") == pid and now - last.get("ts", 0) < MERGE_SEC
                    and last.get("state") == "ok"):
                # то же самое подряд — обновляем текст, а «как было» оставляем от первой правки
                last.update(ts=now, text=text, n=int(last.get("n") or 1) + 1)
                if undo and last.get("undo") is None:
                    last["undo"] = undo
                for k, v in extra.items():
                    if k not in last:
                        last[k] = v
                e = last
            else:
                e = {"id": gt.uid(), "ts": now, "pid": pid, "who": name, "color": color, "kind": kind, "text": gt._s(text, 500),
                     "undo": undo, "state": "ok", "mk": merge_key, **extra}
                lst.append(e)
                del lst[: max(0, len(lst) - ACT_KEEP)]
            self.campaign.touch()
            pub = self._act_public(e)
        for x in list(self.conns):
            if x.gm:
                await self._send(x.ws, {"t": "actlog_new", "e": pub})
        return e

    @staticmethod
    def _act_public(e: dict) -> dict:
        y = {k: v for k, v in e.items() if k not in ("undo", "mk", "before")}
        y["can_undo"] = bool(e.get("undo")) and e.get("state") == "ok"
        return y

    # ------------------------------------------------------------------ описание правки листа
    def _act_diff(self, before: dict, after: dict) -> str:
        parts = []
        for k, b in before.items():
            a = after.get(k)
            if a == b:
                continue
            if k == "hp" and isinstance(a, dict) and isinstance(b, dict):
                sub = []
                if _num(a.get("cur")) != _num(b.get("cur")):
                    dlt = _num(a.get("cur")) - _num(b.get("cur"))
                    sub.append(f"хиты {_num(b.get('cur'))} → {_num(a.get('cur'))} ({dlt:+d})")
                if _num(a.get("max")) != _num(b.get("max")):
                    sub.append(f"макс. хиты {_num(b.get('max'))} → {_num(a.get('max'))}")
                if _num(a.get("temp")) != _num(b.get("temp")):
                    sub.append(f"временные хиты {_num(b.get('temp'))} → {_num(a.get('temp'))}")
                parts.append(", ".join(sub) or "хиты")
            elif k == "coins" and isinstance(a, dict) and isinstance(b, dict):
                sub = []
                for u in sorted(set(a) | set(b)):
                    dlt = _num(a.get(u)) - _num(b.get(u))
                    if dlt:
                        sub.append(f"{dlt:+d} {u}")
                parts.append("монеты " + " ".join(sub) if sub else "монеты")
            elif k in ("inventory", "attacks", "features", "resources") and isinstance(a, list) and isinstance(b, list):
                bi = {x.get("id"): x for x in b if isinstance(x, dict)}
                ai = {x.get("id"): x for x in a if isinstance(x, dict)}
                nm = lambda x: str(x.get("name") or x.get("srd") or "?")[:40]
                sub = []
                added = [ai[i] for i in ai if i not in bi]
                gone = [bi[i] for i in bi if i not in ai]
                if added:
                    sub.append("+ " + ", ".join(nm(x) + (f" ×{x.get('qty')}" if k == "inventory" and _num(x.get("qty"), 1) != 1 else "") for x in added[:6]))
                if gone:
                    sub.append("− " + ", ".join(nm(x) for x in gone[:6]))
                for i in ai:
                    if i in bi and ai[i] != bi[i]:
                        x, y = bi[i], ai[i]
                        if k == "inventory" and x.get("qty") != y.get("qty"):
                            sub.append(f"{nm(y)}: {x.get('qty')} → {y.get('qty')}")
                        elif k == "inventory" and bool(x.get("equipped")) != bool(y.get("equipped")):
                            sub.append(f"{nm(y)}: {'надел(а)' if y.get('equipped') else 'снял(а)'}")
                        elif k == "resources" and x.get("used") != y.get("used"):
                            sub.append(f"{nm(y)}: потрачено {x.get('used')} → {y.get('used')}")
                        else:
                            sub.append(f"{nm(y)}: изменено")
                parts.append(f"{KEY_RU.get(k, k)}: " + "; ".join(sub[:8]) if sub else KEY_RU.get(k, k))
            elif k == "conditions" and isinstance(a, list) and isinstance(b, list):
                add = [x for x in a if x not in b]
                rem = [x for x in b if x not in a]
                parts.append("состояния " + " ".join([f"+{x}" for x in add] + [f"−{x}" for x in rem]))
            elif k == "classes":
                lv = lambda v: sum(_num(x.get("level")) for x in (v or []) if isinstance(x, dict))
                parts.append(f"уровень {lv(b)} → {lv(a)}" if lv(a) != lv(b) else "классы")
            elif k in ("xp", "exhaustion", "speed", "init_bonus", "lvl_ok"):
                parts.append(f"{KEY_RU.get(k, k)} {b} → {a}")
            elif k == "spells" and isinstance(a, dict) and isinstance(b, dict):
                if a.get("slots_used") != b.get("slots_used"):
                    parts.append("ячейки заклинаний " + "/".join(str(_num(x)) for x in (a.get("slots_used") or [])[:9]).rstrip("/0"))
                if a.get("list") != b.get("list"):
                    parts.append("список заклинаний")
                if a.get("slots_used") == b.get("slots_used") and a.get("list") == b.get("list"):
                    parts.append("заклинания")
            elif k == "death" and isinstance(a, dict):
                parts.append(f"спасброски от смерти: успехи {a.get('ok')}, провалы {a.get('fail')}")
            elif k == "inspiration":
                parts.append("вдохновение " + ("получено" if a else "потрачено"))
            else:
                parts.append(f"изменено: {KEY_RU.get(k, k)}")
        return "; ".join(p for p in parts if p)[:480]

    @staticmethod
    def _act_keys(ops) -> list:
        if not isinstance(ops, list):
            return []
        return sorted({str(o.get("path")[0]) for o in ops if isinstance(o, dict) and isinstance(o.get("path"), list) and o.get("path")})

    async def _act_patch(self, conn, before: dict, cid: str) -> None:
        """Вызывается после успешной правки листа игроком; before — прежние значения затронутых полей."""
        if conn.gm or not before:
            return
        keys = sorted(before)
        with self.campaign.lock:
            d = ch.find(self.campaign, cid)
            if d is None:
                return
            # при склейке сравниваем с самым первым состоянием
            lst = self._acts()
            mk = f"patch:{cid}:{','.join(keys)}"
            last = lst[-1] if lst else None
            if last and last.get("mk") == mk and last.get("state") == "ok" and time.time() - last.get("ts", 0) < MERGE_SEC and last.get("undo"):
                before = copy.deepcopy(last["undo"]["keys"])
            text = self._act_diff(before, d)
            name = d.get("name") or "?"
        if not text:
            return
        await self._act_add(conn, "sheet", f"{name}: {text}", {"t": "keys", "char": cid, "keys": before}, merge_key=mk, char=cid)

    # ------------------------------------------------------------------ откат
    async def _act_undo(self, e: dict) -> None:
        c = self.campaign
        u = e.get("undo") or {}
        if u.get("t") == "keys":
            with c.lock:
                d = ch.find(c, u.get("char") or "")
                if d is None:
                    raise gt.ToolError("not_found")
                ops = [{"op": "set", "path": [k], "value": copy.deepcopy(v)} for k, v in (u.get("keys") or {}).items() if v is not None]
                d = ch.patch(c, d["id"], ops) if ops else d
                e["state"] = "undone"
                c.touch()
            await self._send_char(d)
            await self._push_summary(d)
        elif u.get("t") == "move":
            with c.lock:
                m = mp.find(c, u.get("map") or "")
                tok = next((x for x in (m or {}).get("tokens", []) if x.get("id") == u.get("tok")), None)
                if tok is None:
                    raise gt.ToolError("not_found")
                tok.update(x=u["x"], y=u["y"], req=None)
                e["state"] = "undone"
                c.touch()
            await self._push_map(m)
        elif u.get("t") == "act":
            pseudo = {"kind": "act", "undo": u, "state": "ok"}
            await self._dec_undo(pseudo)
            with c.lock:
                e["state"] = "undone"
                c.touch()
        else:
            raise gt.ToolError("bad_request")

    # ------------------------------------------------------------------ сообщения мастера
    async def _actlog_msg(self, conn, t: str, data: dict) -> None:
        if not conn.gm:
            raise gt.ToolError("no_access")
        rid = data.get("rid")
        if t == "actlog_get":
            with self.campaign.lock:
                lst = [self._act_public(e) for e in self._acts()[-ACT_KEEP:]]
            await self._send(conn.ws, {"t": "actlog", "list": lst, "rid": rid})
            return
        if t == "actlog_undo":
            e = next((x for x in self._acts() if x.get("id") == data.get("id")), None)
            if e is None or e.get("state") != "ok" or not e.get("undo"):
                raise gt.ToolError("not_found")
            await self._act_undo(e)
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            for x in list(self.conns):
                if x.gm:
                    await self._send(x.ws, {"t": "actlog_new", "e": self._act_public(e)})
            return
        if t == "actlog_clear":
            with self.campaign.lock:
                self.campaign.extra["actlog"] = []
                self.campaign.touch()
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            return
        raise gt.ToolError("bad_request")

    # ------------------------------------------------------------------ обёртка для боевых и торговых действий игрока
    async def _act_wrap(self, conn, t: str, data: dict, run) -> None:
        """Запомнить, что было до действия (хиты целей, кошелёк), выполнить его и записать в журнал."""
        if conn.gm or (t not in COMBAT_T and t not in TRADE_T):
            await run()
            return
        c = self.campaign
        undo = None
        text = ""
        with c.lock:
            if t in COMBAT_T:
                specs = [s for s in [data.get("tgt"), *(data.get("tgts") or [])] if s]
                src = self._resolve(data.get("src")) if data.get("src") else None
                snap = self._hp_snap(specs) if specs else []
                econ = copy.deepcopy(src["entry"].get("econ")) if src and src.get("entry") is not None else None
                undo = {"t": "act", "hp": snap, "src": data.get("src"), "econ": econ}
                tg = [((self._resolve(s) or {}).get("name") or "?") for s in specs]
                what = (data.get("atk") or {}).get("name") if isinstance(data.get("atk"), dict) else ""
                what = what or data.get("label") or data.get("kind") or data.get("spell") or ""
                text = f"{(src or {}).get('name') or '?'}: {COMBAT_T[t]}{' «' + str(what)[:40] + '»' if what else ''}{' → ' + ', '.join(tg[:4]) if tg else ''}"
            else:
                d = ch.find(c, str(data.get("char") or ""))
                if d is not None:
                    undo = {"t": "keys", "char": d["id"], "keys": {k: copy.deepcopy(d.get(k)) for k in ("coins", "inventory", "attacks")}}
                    text = d.get("name") or "?"
            lg = gt.combat(c).get("log") or []
            mark = lg[-1] if lg else None
        await run()
        if t in COMBAT_T:
            with c.lock:
                log = gt.combat(c).get("log") or []
                i0 = next((i + 1 for i in range(len(log) - 1, -1, -1) if log[i] is mark), 0) if mark is not None else 0
                res = [x for x in log[i0:] if isinstance(x, dict)]
                tail = []
                for x in res[:3]:
                    if x.get("k") == "atk":
                        tail.append(("крит! " if x.get("crit") else "попал" if x.get("hit") else "промах") + (f", урон {x.get('dmg')}" if x.get("dmg") else ""))
                    elif x.get("k") == "save":
                        tail.append(f"{x.get('tgt')}: {'спас' if x.get('ok') else 'провал'}" + (f", урон {x.get('dmg')}" if x.get("dmg") else ""))
                    elif x.get("k") == "heal":
                        tail.append(f"+{x.get('amount')} хитов")
                    elif x.get("k") == "mnv":
                        tail.append("успех" if x.get("ok") else "неудача")
            if tail:
                text += " — " + "; ".join(tail)
            elif t in ("cb_attack", "cb_save", "cb_heal"):
                text += " (ждёт решения мастера или без результата)"
            await self._act_add(conn, "combat", text, undo if any(h for h in undo.get("hp") or []) or undo.get("econ") else None)
        else:
            label = {"stash_put": "кладёт на склад", "stash_take": "берёт со склада", "stash_coin": "деньги склада",
                     "shop_buy": "покупает в лавке", "shop_sell": "предлагает продать"}[t]
            with c.lock:
                d = ch.find(c, (undo or {}).get("char") or "")
                diff = self._act_diff(undo["keys"], d) if d is not None and undo else ""
            if diff or t == "shop_sell":
                await self._act_add(conn, "trade", f"{text}: {label}" + (f" — {diff}" if diff else ""), undo if diff else None)

    async def _act_move(self, conn, m: dict, tok_id: str, old: tuple, new: tuple) -> None:
        if conn.gm or old == new:
            return
        tok = next((x for x in m.get("tokens", []) if x.get("id") == tok_id), None)
        if tok is None:
            return
        mk = f"move:{m['id']}:{tok_id}"
        lst = self._acts()
        last = lst[-1] if lst else None
        start = old
        if last and last.get("mk") == mk and last.get("state") == "ok" and time.time() - last.get("ts", 0) < MERGE_SEC and last.get("undo"):
            start = (last["undo"]["x"], last["undo"]["y"])
        from . import rules5e as r5
        ft = r5.dist_ft(m.get("grid") or {}, start, new)
        await self._act_add(conn, "move", f"{tok.get('name') or '?'}: перемещение на {ft} фт",
                            {"t": "move", "map": m["id"], "tok": tok_id, "x": start[0], "y": start[1]}, merge_key=mk)

    async def _act_roll(self, conn, entry: dict) -> None:
        if conn.gm or not isinstance(entry, dict):
            return
        await self._act_add(conn, "roll", f"{entry.get('char') or ''}{': ' if entry.get('char') else ''}{entry.get('label') or entry.get('formula')} = {entry.get('total')}"
                            + (" (скрытый)" if entry.get("hidden") else ""))
