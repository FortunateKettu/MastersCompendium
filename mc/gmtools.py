"""Инструменты мастера: бестиарий (свои и импортированные с ttg.club монстры), бой (инициатива),
раздаточные материалы и заметки. Здесь — данные и их проверка; сетевую часть делает сервер.

campaign.extra:
    monsters: [monster]      — статблоки
    combat:   {active, round, cur, list: [entry]}
    handouts: [{id, title, text, img, to, ts}]   to: "all" | [player_id, ...] | [] (ещё не показана)
    notes:    [{id, title, text, ts}]
"""
from __future__ import annotations

import html
import math
import re
import secrets
import time
import uuid
from html.parser import HTMLParser

from .campaign import ASSET_RE, Campaign

SIZES = ("tiny", "small", "medium", "large", "huge", "gargantuan")
SIZE_CELLS = {"tiny": 0.5, "small": 1, "medium": 1, "large": 2, "huge": 3, "gargantuan": 4}
ABILS = ("str", "dex", "con", "int", "wis", "cha")
BLOCKS = ("traits", "actions", "bonus", "reactions", "legendary")
MAX_MONSTERS = 500
MAX_COMBAT = 60
MAX_HANDOUTS = 200
MAX_NOTES = 300


class ToolError(ValueError):
    pass


def uid() -> str:
    return uuid.uuid4().hex[:10]


def _s(v, n: int) -> str:
    s = str(v if v is not None else "")
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s).replace("\r\n", "\n").replace("\r", "\n")
    return s.strip()[:n]


def _line(v, n: int) -> str:
    return re.sub(r"\s+", " ", _s(v, n * 2)).strip()[:n]


def _int(v, lo: int, hi: int, default: int = 0) -> int:
    try:
        f = float(str(v).replace(",", ".").replace("−", "-"))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    return int(max(lo, min(hi, round(f))))


def _asset(v) -> str:
    return v if isinstance(v, str) and ASSET_RE.fullmatch(v) else ""


def _list(c: Campaign, key: str) -> list:
    v = c.extra.get(key)
    if not isinstance(v, list):
        v = c.extra[key] = []
    return v


def mod(score: int) -> int:
    return (int(score) - 10) // 2


# ------------------------------------------------------------------ монстры
def clean_monster(m, old: dict | None = None) -> dict:
    m = m if isinstance(m, dict) else {}
    o = old or {}
    ab = m.get("abil") if isinstance(m.get("abil"), dict) else {}
    out = {
        "id": o.get("id") or uid(),
        "name": _line(m.get("name"), 80) or "?", "name_en": _line(m.get("name_en"), 80),
        "src": _line(m.get("src"), 40) or "custom", "url": _line(m.get("url"), 200),
        "size": m.get("size") if m.get("size") in SIZES else "medium",
        "type": _line(m.get("type"), 80), "alignment": _line(m.get("alignment"), 60),
        "ac": _int(m.get("ac"), 0, 50, 10), "ac_text": _line(m.get("ac_text"), 120),
        "hp": _int(m.get("hp"), 0, 99999, 1), "hp_formula": _line(m.get("hp_formula"), 40),
        "speed": _line(m.get("speed"), 200),
        "abil": {a: _int(ab.get(a), 1, 30, 10) for a in ABILS},
        "saves": _line(m.get("saves"), 200), "skills": _line(m.get("skills"), 300),
        "dmg_vul": _line(m.get("dmg_vul"), 300), "dmg_res": _line(m.get("dmg_res"), 300),
        "dmg_imm": _line(m.get("dmg_imm"), 300), "cond_imm": _line(m.get("cond_imm"), 300),
        "senses": _line(m.get("senses"), 300), "languages": _line(m.get("languages"), 300),
        "cr": _line(m.get("cr"), 8) or "—", "xp": _int(m.get("xp"), 0, 500000, 0), "pb": _int(m.get("pb"), 0, 10, 2),
        "legendary_text": _s(m.get("legendary_text"), 3000), "lair": _s(m.get("lair"), 8000),
        "desc": _s(m.get("desc"), 12000), "img": _asset(m.get("img")),
    }
    for b in BLOCKS:
        items = m.get(b) if isinstance(m.get(b), list) else []
        out[b] = [{"name": _line(x.get("name"), 120), "text": _s(x.get("text"), 5000)}
                  for x in items[:50] if isinstance(x, dict) and (x.get("name") or x.get("text"))]
    return out


def monsters(c: Campaign) -> list[dict]:
    return _list(c, "monsters")


def find_monster(c: Campaign, mid) -> dict | None:
    return next((m for m in monsters(c) if isinstance(m, dict) and m.get("id") == mid), None)


def save_monster(c: Campaign, data) -> dict:
    with c.lock:
        lst = monsters(c)
        old = find_monster(c, (data or {}).get("id")) if isinstance(data, dict) else None
        m = clean_monster(data, old)
        if old:
            lst[lst.index(old)] = m
        else:
            if len(lst) >= MAX_MONSTERS:
                raise ToolError("too_many")
            lst.append(m)
        c.touch()
    return m


def delete_monster(c: Campaign, mid) -> None:
    with c.lock:
        m = find_monster(c, mid)
        if m:
            monsters(c).remove(m)
            c.touch()


def monster_summary(m: dict) -> dict:
    return {k: m.get(k) for k in ("id", "name", "name_en", "type", "cr", "size", "ac", "hp", "src", "img")}


# ------------------------------------------------------------------ импорт с ttg.club
class _Text(HTMLParser):
    """HTML описания с ttg.club → обычный текст. <dice-roller> превращается в формулу броска."""
    BLOCK = {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "ul", "ol", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.dice_depth = 0
        self.dice_formula = ""
        self.dice_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "dice-roller":
            self.dice_depth += 1
            self.dice_formula = a.get("formula", "") or ""
            self.dice_text = []
            return
        if tag in self.BLOCK:
            self.out.append("\n")
        if tag == "li":
            self.out.append("• ")

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if tag == "dice-roller":
            self.out.append(_formula(a.get("formula", "")))
        elif tag == "br":
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag == "dice-roller" and self.dice_depth:
            self.dice_depth -= 1
            txt = "".join(self.dice_text).strip()
            self.out.append(txt or _formula(self.dice_formula))
            return
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5"):
            self.out.append("\n")

    def handle_data(self, data):
        if self.dice_depth:
            self.dice_text.append(data)
        else:
            self.out.append(data)

    def text(self) -> str:
        s = "".join(self.out).replace("\xa0", " ")
        s = re.sub(r"[ \t]+", " ", s)
        s = re.sub(r" *\n *", "\n", s)
        return re.sub(r"\n{3,}", "\n\n", s).strip()


def _formula(f: str) -> str:
    f = (f or "").strip()
    if f.startswith(("к", "d")):
        f = "1" + f
    return f


def html_to_text(v) -> str:
    if not v:
        return ""
    p = _Text()
    try:
        p.feed(str(v))
        p.close()
    except Exception:  # noqa: BLE001 — кривой HTML: просто снимаем теги
        return re.sub(r"<[^>]+>", " ", html.unescape(str(v))).strip()
    return p.text()


def _nv_join(items, unit: str = "") -> str:
    """[{name, value, additional}] → «30 фт., летая 60 фт. (парит)»"""
    parts = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        name, val, add = str(it.get("name") or "").strip(), it.get("value"), it.get("additional")
        val = "" if val in (None, "") else f"{val}{unit}"
        s = " ".join(x for x in (name, val) if x)
        if add:
            s += f" ({add})"
        if s:
            parts.append(s)
    return ", ".join(parts)


def _bonus_join(items) -> str:
    parts = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        v = it.get("value")
        try:
            v = f"{int(v):+d}"
        except (TypeError, ValueError):
            v = str(v or "")
        nm = str(it.get("shortName") or it.get("name") or "").strip()
        add = f" {it['additional']}" if it.get("additional") else ""
        parts.append(f"{nm} {v}{add}".strip())
    return ", ".join(parts)


def _size_key(sz) -> str:
    eng = str((sz or {}).get("eng", "") if isinstance(sz, dict) else sz or "").lower()
    for s in SIZES:
        if s in eng:
            return s
    rus = str((sz or {}).get("rus", "") if isinstance(sz, dict) else "").lower()
    for k, v in {"крош": "tiny", "мал": "small", "сред": "medium", "больш": "large", "огром": "huge", "громад": "gargantuan"}.items():
        if rus.startswith(k):
            return v
    return "medium"


def _actions(items) -> list[dict]:
    return [{"name": str(x.get("name") or "").strip(), "text": html_to_text(x.get("value"))}
            for x in items or [] if isinstance(x, dict)]


def from_ttg(d: dict, base: str = "") -> dict:
    """Ответ /api/v1/bestiary/{name} → наш статблок (ещё без id)."""
    if not isinstance(d, dict):
        raise ToolError("ttg_bad_data")
    name = d.get("name") if isinstance(d.get("name"), dict) else {}
    hits = d.get("hits") if isinstance(d.get("hits"), dict) else {}
    ab = d.get("ability") if isinstance(d.get("ability"), dict) else {}
    tp = d.get("type")
    tname = tp.get("name", "") if isinstance(tp, dict) else str(tp or "")
    if isinstance(tp, dict) and tp.get("tags"):
        tname += f" ({', '.join(map(str, tp['tags']))})"
    sz = d.get("size")
    size_txt = sz.get("rus", "") if isinstance(sz, dict) else ""
    formula = str(hits.get("formula") or "")
    if hits.get("bonus"):
        formula += f"{hits.get('sign') or ' + '}{abs(int(hits['bonus']))}"
    if hits.get("text"):
        formula += f" {hits['text']}"
    senses = d.get("senses") if isinstance(d.get("senses"), dict) else {}
    sense_txt = _nv_join(senses.get("senses"), " фт.")
    if senses.get("passivePerception"):
        sense_txt = (sense_txt + ", " if sense_txt else "") + f"пассивная Внимательность {senses['passivePerception']}"
    langs = ", ".join(map(str, d.get("languages") or []))
    if d.get("language"):
        langs = (langs + ", " if langs else "") + str(d["language"])
    leg = d.get("legendary") if isinstance(d.get("legendary"), dict) else {}
    lair = d.get("lair") if isinstance(d.get("lair"), dict) else {}
    lair_txt = "\n\n".join(html_to_text(lair.get(k)) for k in ("description", "action", "effect") if lair.get(k))
    armor = ", ".join(str(x.get("name", "")) for x in d.get("armors") or [] if isinstance(x, dict))
    ac_text = ", ".join(x for x in (armor, str(d.get("armorText") or "")) if x)
    imgs = [u for u in d.get("images") or [] if isinstance(u, str)]
    url = str(d.get("url") or "")
    reactions = _actions(d.get("reactions"))
    if d.get("reaction") and reactions:
        reactions[0]["text"] = html_to_text(d["reaction"]) + "\n" + reactions[0]["text"]
    src = d.get("source") if isinstance(d.get("source"), dict) else {}
    m = {
        "name": name.get("rus") or name.get("eng") or "?", "name_en": name.get("eng", ""),
        "src": "ttg" + (f" · {src.get('shortName')}" if src.get("shortName") else ""),
        "url": (base.rstrip("/") + url) if url.startswith("/") else url,
        "size": _size_key(sz), "type": " ".join(x for x in (size_txt, tname) if x),
        "alignment": d.get("alignment", ""), "ac": d.get("armorClass") or 10, "ac_text": ac_text,
        "hp": hits.get("average") or 1, "hp_formula": formula.strip(),
        "speed": _nv_join(d.get("speed"), " фт."),
        "abil": {"str": ab.get("str"), "dex": ab.get("dex"), "con": ab.get("con"), "int": ab.get("int"),
                 "wis": ab.get("wiz", ab.get("wis")), "cha": ab.get("cha")},
        "saves": _bonus_join(d.get("savingThrows")), "skills": _bonus_join(d.get("skills")),
        "dmg_vul": ", ".join(map(str, d.get("damageVulnerabilities") or [])),
        "dmg_res": ", ".join(map(str, d.get("damageResistances") or [])),
        "dmg_imm": ", ".join(map(str, d.get("damageImmunities") or [])),
        "cond_imm": ", ".join(map(str, d.get("conditionImmunities") or [])),
        "senses": sense_txt, "languages": langs or "—",
        "cr": str(d.get("challengeRating") or "—"), "xp": d.get("experience") or 0,
        "pb": _int(d.get("proficiencyBonus"), 0, 10, 2),
        "traits": _actions(d.get("feats")), "actions": _actions(d.get("actions")),
        "bonus": _actions(d.get("bonusActions")), "reactions": reactions,
        "legendary": _actions(leg.get("list")), "legendary_text": html_to_text(leg.get("description")),
        "lair": lair_txt, "desc": html_to_text(d.get("description")),
    }
    return {"monster": clean_monster(m), "images": [(base.rstrip("/") + u) if u.startswith("/") else u for u in imgs],
            "images_raw": imgs}


def ttg_list_item(d: dict) -> dict | None:
    if not isinstance(d, dict):
        return None
    name = d.get("name") if isinstance(d.get("name"), dict) else {}
    url = str(d.get("url") or "")
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    if not slug:
        return None
    src = d.get("source") if isinstance(d.get("source"), dict) else {}
    return {"slug": slug, "name": name.get("rus") or name.get("eng") or slug, "name_en": name.get("eng", ""),
            "type": str(d.get("type") or ""), "cr": str(d.get("challengeRating") or ""),
            "src": str(src.get("shortName") or "")}


# ------------------------------------------------------------------ бой
def combat(c: Campaign) -> dict:
    cb = c.extra.get("combat")
    if not isinstance(cb, dict):
        cb = c.extra["combat"] = {"active": False, "round": 0, "cur": None, "list": []}
    cb.setdefault("list", [])
    return cb


def clean_entry(e, old: dict | None = None) -> dict:
    e = e if isinstance(e, dict) else {}
    o = old or {"id": uid(), "name": "", "init": None, "dex": 0, "kind": "npc", "char": "", "token": "", "map": "",
                "mon": "", "hidden": False, "hp": None, "ac": None, "note": ""}
    init = e.get("init", o.get("init"))
    init = None if init in (None, "") else _int(init, -20, 60, 0)
    hp = e.get("hp", o.get("hp"))
    if isinstance(hp, dict):
        mx = _int(hp.get("max"), 0, 99999, 0)
        hp = {"cur": _int(hp.get("cur"), -99999, 99999, mx), "max": mx}
    else:
        hp = None
    ac = e.get("ac", o.get("ac"))
    return {"id": o["id"], "name": _line(e.get("name", o["name"]), 60) or "?", "init": init,
            "dex": _int(e.get("dex", o.get("dex")), -10, 20, 0),
            "kind": e.get("kind") if e.get("kind") in ("pc", "npc") else o.get("kind", "npc"),
            "char": _line(e.get("char", o["char"]), 40), "token": _line(e.get("token", o["token"]), 40),
            "map": _line(e.get("map", o["map"]), 40), "mon": _line(e.get("mon", o["mon"]), 40),
            "hidden": bool(e.get("hidden", o["hidden"])), "hp": hp,
            "ac": None if ac in (None, "") else _int(ac, 0, 50, 10), "note": _line(e.get("note", o.get("note")), 120),
            "econ": clean_econ(e.get("econ", o.get("econ"))),
            "effects": [x for x in (clean_effect(x) for x in (e.get("effects", o.get("effects")) or [])[:20]) if x],
            "conc": _line(e.get("conc", o.get("conc")) or "", 60)}


ECON_KEYS = ("a", "b", "r")        # действие, бонусное действие, реакция (True — потрачено)


def clean_econ(v) -> dict:
    v = v if isinstance(v, dict) else {}
    return {"a": bool(v.get("a")), "b": bool(v.get("b")), "r": bool(v.get("r")), "mv": _int(v.get("mv"), 0, 9999, 0),
            "atk": _int(v.get("atk"), 0, 20, 0)}


def clean_effect(x) -> dict | None:
    """Эффект на участнике боя: {id, name, cond, rounds} — rounds 0 = пока не снимут."""
    if not isinstance(x, dict):
        return None
    name = _line(x.get("name"), 60)
    cond = _line(x.get("cond") or "", 30)
    if not name and not cond:
        return None
    out = {"id": _line(x.get("id"), 20) or uid(), "name": name, "cond": cond, "rounds": _int(x.get("rounds"), 0, 999, 0)}
    # повторяющийся эффект: урон/лечение в начале хода, спасбросок в конце хода (успех — эффект кончается)
    dot = re.sub(r"\s+", "", str(x.get("dot") or ""))[:30]
    if dot and re.fullmatch(r"[0-9dDкК+\-]{1,30}", dot) and re.search(r"\d", dot):
        out["dot"] = dot.replace("к", "d").replace("К", "d").replace("D", "d")
        out["heal"] = bool(x.get("heal"))
    if x.get("sv_ab") in ("str", "dex", "con", "int", "wis", "cha"):
        out["sv_ab"] = x["sv_ab"]
        out["sv_dc"] = _int(x.get("sv_dc"), 1, 40, 12)
    return out


def cb_log(cb: dict, text: str, hidden: bool = False) -> None:
    lst = cb.setdefault("log", [])
    lst.append({"ts": int(time.time()), "text": text[:300], "hidden": bool(hidden)})
    del lst[:-120]


def start_turn(cb: dict) -> list[tuple[dict, dict]]:
    """Начало хода текущего участника: обнулить действия, отсчитать эффекты. Возвращает закончившиеся (участник, эффект)."""
    e = next((x for x in cb.get("list", []) if x.get("id") == cb.get("cur")), None)
    if e is None:
        return []
    e["econ"] = clean_econ({})
    ended = []
    keep = []
    for ef in e.get("effects") or []:
        if ef.get("rounds", 0) > 0:
            ef["rounds"] -= 1
            if ef["rounds"] <= 0:
                ended.append((e, ef))
                continue
        keep.append(ef)
    e["effects"] = keep
    return ended


def order(cb: dict) -> list[dict]:
    """Порядок ходов: инициатива ↓, при равенстве — Ловкость ↓, без инициативы — в конце."""
    return sorted(cb.get("list", []), key=lambda e: (e.get("init") is None, -(e.get("init") or 0), -(e.get("tb") or 0), -(e.get("dex") or 0), e.get("name", "")))


def roll_init(dex_mod: int) -> int:
    return secrets.randbelow(20) + 1 + dex_mod


def advance(cb: dict, step: int = 1) -> None:
    seq = order(cb)
    if not seq:
        cb["cur"], cb["round"] = None, 0
        return
    ids = [e["id"] for e in seq]
    if cb.get("cur") not in ids:
        cb["cur"] = ids[0]
        cb["round"] = max(1, cb.get("round") or 1)
        return
    i = ids.index(cb["cur"]) + step
    if i >= len(ids):
        i = 0
        cb["round"] = (cb.get("round") or 1) + 1
    elif i < 0:
        i = len(ids) - 1
        cb["round"] = max(1, (cb.get("round") or 1) - 1)
    cb["cur"] = ids[i]


def hp_state(hp: dict | None) -> str:
    if not hp or not hp.get("max"):
        return ""
    if hp["cur"] <= 0:
        return "dead"
    if hp["cur"] <= hp["max"] / 2:
        return "bloodied"
    return "ok"


# ------------------------------------------------------------------ раздатки и заметки
def handouts(c: Campaign) -> list[dict]:
    return _list(c, "handouts")


def clean_handout(h, old: dict | None = None) -> dict:
    h = h if isinstance(h, dict) else {}
    want = str(h.get("id") or "")
    o = old or {"id": want if re.fullmatch(r"[a-z0-9]{8,16}", want) else uid(), "title": "", "text": "", "img": "", "to": [], "ts": 0}
    to = h.get("to", o["to"])
    if to != "all":
        to = [_line(x, 40) for x in to][:50] if isinstance(to, list) else []
    return {"id": o["id"], "title": _line(h.get("title", o["title"]), 100) or "…", "text": _s(h.get("text", o["text"]), 20000),
            "img": _asset(h.get("img", o["img"])), "to": to, "ts": o.get("ts") or 0}


def handout_visible(h: dict, pid: str | None) -> bool:
    to = h.get("to")
    return to == "all" or (isinstance(to, list) and pid in to)


def notes(c: Campaign) -> list[dict]:
    lst = _list(c, "notes")
    # раньше тут мог лежать пустой список-заготовка другого вида — оставляем только заметки
    return lst


def clean_note(n, old: dict | None = None) -> dict:
    n = n if isinstance(n, dict) else {}
    o = old or {"id": uid(), "title": "", "text": "", "ts": 0}
    return {"id": o["id"], "title": _line(n.get("title", o["title"]), 100) or "…", "text": _s(n.get("text", o["text"]), 200000),
            "pin": bool(n.get("pin", o.get("pin", False))), "ts": int(time.time()),
            "fmt": "html" if n.get("fmt", o.get("fmt")) == "html" else ""}


# ------------------------------------------------------------------ группы фишек (отряд игроков, банда гоблинов…)
MAX_GROUPS = 100


def groups(c: Campaign) -> list[dict]:
    return _list(c, "groups")


def clean_group(g, old: dict | None = None) -> dict:
    """Группа: {id, name, members: [{char} | {mon, count, hidden}]}. Ставится на карту одной кнопкой."""
    g = g if isinstance(g, dict) else {}
    o = old or {"id": uid(), "name": "", "members": []}
    members = []
    src = g.get("members", o["members"])
    for m in (src if isinstance(src, list) else [])[:40]:
        if not isinstance(m, dict):
            continue
        if m.get("char"):
            members.append({"char": _line(m["char"], 40)})
        elif m.get("mon"):
            members.append({"mon": _line(m["mon"], 40), "count": _int(m.get("count"), 1, 30, 1),
                            "hidden": bool(m.get("hidden"))})
    return {"id": o["id"], "name": _line(g.get("name", o["name"]), 60) or "…", "members": members}


# ------------------------------------------------------------------ стиль кубиков (цвет, градиент, след)
TRAILS = {"", "fire", "ice", "poison", "lightning", "arcane", "shadow", "holy", "blood", "nature", "water", "earth", "wind", "petals", "cosmos"}
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")


def dice_styles(c: Campaign) -> dict:
    v = c.extra.get("dice_styles")
    if not isinstance(v, dict):
        v = c.extra["dice_styles"] = {}
    return v


def clean_dice_style(st) -> dict | None:
    """{color, color2, trail}; None — сбросить на обычный."""
    if not isinstance(st, dict):
        return None
    color = st.get("color") if isinstance(st.get("color"), str) and HEX_RE.fullmatch(st["color"]) else ""
    color2 = st.get("color2") if isinstance(st.get("color2"), str) and HEX_RE.fullmatch(st["color2"]) else ""
    trail = st.get("trail") if st.get("trail") in TRAILS else ""
    if not (color or color2 or trail):
        return None
    return {"color": color.lower(), "color2": color2.lower(), "trail": trail}


# ------------------------------------------------------------------ комната ожидания (мини-игры)
LZ_UPS = ("click", "luck", "goblin", "bard", "mine", "lair", "portal")
LZ_MAX = 1e18


def lounge(c: Campaign) -> dict:
    v = c.extra.get("lounge")
    if not isinstance(v, dict):
        v = c.extra["lounge"] = {}
    v.setdefault("on", True)
    if not isinstance(v.get("saves"), dict):
        v["saves"] = {}
    return v


def _num(v, hi: float = LZ_MAX) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    if x != x or x < 0:
        return 0.0
    return min(x, hi)


def clean_lz_save(s) -> dict:
    """Кликер: {gold, total, clicks, crits, ups:{id: n}}. Это игрушка — проверяем только форму и пределы."""
    s = s if isinstance(s, dict) else {}
    ups = s.get("ups") if isinstance(s.get("ups"), dict) else {}
    return {"gold": _num(s.get("gold")), "total": _num(s.get("total")), "clicks": int(_num(s.get("clicks"), 1e12)),
            "crits": int(_num(s.get("crits"), 1e12)), "best": _num(s.get("best")),
            "ups": {k: int(_num(ups.get(k), 10000)) for k in LZ_UPS if ups.get(k)}, "ts": time.time()}


def lz_board(c: Campaign) -> list[dict]:
    saves = lounge(c)["saves"]
    names = {p.id: p for p in c.players}
    out = []
    for pid, s in saves.items():
        p = names.get(pid)
        if pid != "gm" and p is None:
            continue
        out.append({"id": pid, "name": p.name if p else "GM", "color": p.color if p else "#f5c542",
                    "total": s.get("total", 0), "crits": s.get("crits", 0)})
    out.sort(key=lambda x: -x["total"])
    return out[:30]


# ------------------------------------------------------------------ валюта кампании
# rate — сколько «самых мелких» единиц в одной монете; name — короткое имя (пусто — по языку игрока: зм, см…)
DEFAULT_CURRENCY = [{"id": "pp", "name": "", "full": "", "rate": 1000}, {"id": "gp", "name": "", "full": "", "rate": 100},
                    {"id": "ep", "name": "", "full": "", "rate": 50}, {"id": "sp", "name": "", "full": "", "rate": 10},
                    {"id": "cp", "name": "", "full": "", "rate": 1}]
CUR_ID_RE = re.compile(r"[a-z0-9]{1,8}")


def currency(c: Campaign) -> list[dict]:
    v = c.extra.get("currency")
    return v if isinstance(v, list) and v else [dict(x) for x in DEFAULT_CURRENCY]


def clean_currency(lst) -> list[dict]:
    out, seen = [], set()
    for x in lst if isinstance(lst, list) else []:
        if not isinstance(x, dict):
            continue
        cid = str(x.get("id") or "").lower()
        if not CUR_ID_RE.fullmatch(cid) or cid in seen:
            cid = "u" + uid()[:6]
        seen.add(cid)
        out.append({"id": cid, "name": _line(x.get("name") or "", 12), "full": _line(x.get("full") or "", 30),
                    "rate": _int(x.get("rate"), 1, 10 ** 9, 1)})
        if len(out) >= 8:
            break
    out.sort(key=lambda u: -u["rate"])
    return out or [dict(x) for x in DEFAULT_CURRENCY]
