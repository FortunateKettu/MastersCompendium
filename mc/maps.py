"""Карты: данные, проверка правок и то, что видит каждый игрок.

Карта хранится в campaign.extra["maps"], показанная игрокам — campaign.extra["map_active"].
Координаты везде — в пикселях картинки карты (для пустой карты — в «виртуальных» пикселях).

    map = {id, name, img, iw, ih, bg,
           grid: {on, size, ox, oy, color, alpha, ft, diag},
           fog:  {on, zones: [{id, name, pts: [[x, y], ...], open}]},
           tokens: [{id, name, x, y, s, color, img, char, owner, hidden, conds, hp, show_hp, req}],
           tmpls:  [{id, kind, x, y, ang, len, w, color, by}]}

Игроку не отправляются: спрятанные мастером фишки, фишки в тумане (кроме своих),
закрытые зоны тумана, хиты чужих монстров и заявки на ход.
"""
from __future__ import annotations

import copy
import math
import re
import uuid

from .campaign import ASSET_RE, Campaign

MOVE_MODES = ("own", "approve", "gm")
TMPL_KINDS = ("circle", "cone", "line", "cube")
DIAG = ("5", "5-10")
CONDS = {"blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
         "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "exhaustion", "concentration",
         "bloodied", "dead", "flying", "dodge", "disengage", "cover_half", "cover_3q", "cover_full",
         "surprised", "ready", "hiding", "dash"}
COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")
MAX_MAPS = 60
MAX_TOKENS = 300
MAX_ZONES = 200
MAX_PTS = 2000
MAX_TMPLS = 60
COORD = 100_000


class MapError(ValueError):
    pass


def _uid() -> str:
    return uuid.uuid4().hex[:10]


def _num(v, lo: float, hi: float, default: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    return max(lo, min(hi, f))


def _str(v, n: int = 60) -> str:
    s = re.sub(r"[\x00-\x1f\x7f<>]", "", str(v or "")).strip()
    return s[:n]


def _color(v, default: str) -> str:
    return v if isinstance(v, str) and COLOR_RE.fullmatch(v) else default


def _asset(v) -> str:
    return v if isinstance(v, str) and ASSET_RE.fullmatch(v) else ""


# ------------------------------------------------------------------ хранилище
def maps(c: Campaign) -> list[dict]:
    lst = c.extra.get("maps")
    if not isinstance(lst, list):
        lst = c.extra["maps"] = []
    return lst


def find(c: Campaign, mid: str) -> dict | None:
    return next((m for m in maps(c) if isinstance(m, dict) and m.get("id") == mid), None)


def active_id(c: Campaign) -> str | None:
    mid = c.extra.get("map_active")
    return mid if isinstance(mid, str) and find(c, mid) else None


def move_mode(c: Campaign) -> str:
    st = c.extra.get("settings") if isinstance(c.extra.get("settings"), dict) else {}
    m = st.get("token_move")
    return m if m in MOVE_MODES else "own"


def set_move_mode(c: Campaign, mode: str) -> None:
    if mode not in MOVE_MODES:
        raise MapError("bad_mode")
    with c.lock:
        st = c.extra.setdefault("settings", {})
        if not isinstance(st, dict):
            st = c.extra["settings"] = {}
        st["token_move"] = mode
        c.touch()


def move_limit(c: Campaign) -> bool:
    """В бою: ход сверх скорости (и не в свой ход) — только с подтверждения мастера."""
    st = c.extra.get("settings") if isinstance(c.extra.get("settings"), dict) else {}
    return bool(st.get("move_limit", True))


def set_move_limit(c: Campaign, on: bool) -> None:
    with c.lock:
        st = c.extra.setdefault("settings", {})
        if not isinstance(st, dict):
            st = c.extra["settings"] = {}
        st["move_limit"] = bool(on)
        c.touch()


def listing(c: Campaign) -> list[dict]:
    act = active_id(c)
    return [{"id": m["id"], "name": m.get("name", ""), "img": m.get("img", ""), "active": m["id"] == act,
             "tokens": len(m.get("tokens", [])), "fog": bool(m.get("fog", {}).get("on"))}
            for m in maps(c) if isinstance(m, dict)]


# ------------------------------------------------------------------ проверка частей
def clean_grid(g, old: dict | None = None) -> dict:
    g = g if isinstance(g, dict) else {}
    o = old or {"on": True, "size": 70, "ox": 0, "oy": 0, "color": "#ffffff", "alpha": 0.18, "ft": 5, "diag": "5"}
    return {"on": bool(g.get("on", o["on"])), "size": _num(g.get("size", o["size"]), 8, 1000, 70),
            "ox": _num(g.get("ox", o["ox"]), -1000, 1000, 0), "oy": _num(g.get("oy", o["oy"]), -1000, 1000, 0),
            "color": _color(g.get("color", o["color"]), "#ffffff"), "alpha": _num(g.get("alpha", o["alpha"]), 0, 1, 0.18),
            "ft": _num(g.get("ft", o["ft"]), 1, 100, 5), "diag": g.get("diag") if g.get("diag") in DIAG else o["diag"],
            "type": g.get("type") if g.get("type") in ("square", "hexh", "hexv") else o.get("type", "square")}


def clean_pts(pts) -> list[list[float]]:
    if not isinstance(pts, list) or not 3 <= len(pts) <= MAX_PTS:
        raise MapError("bad_zone")
    out = []
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise MapError("bad_zone")
        out.append([round(_num(p[0], -COORD, COORD, 0), 1), round(_num(p[1], -COORD, COORD, 0), 1)])
    return out


def clean_zone(z, old: dict | None = None) -> dict:
    z = z if isinstance(z, dict) else {}
    o = old or {"id": _uid(), "name": "", "pts": None, "open": False}
    return {"id": o["id"], "name": _str(z.get("name", o["name"]), 40),
            "pts": clean_pts(z["pts"]) if "pts" in z else (o["pts"] or clean_pts(None)),
            "open": bool(z.get("open", o["open"]))}


def clean_token(t, old: dict | None = None, gm: bool = True) -> dict:
    t = t if isinstance(t, dict) else {}
    o = old or {"id": _uid(), "name": "", "x": 0, "y": 0, "s": 1, "color": "#ef4444", "img": "", "char": "",
                "owner": "", "hidden": False, "conds": [], "hp": None, "show_hp": False, "req": None}
    hp = t.get("hp", o.get("hp"))
    if isinstance(hp, dict):
        mx = int(_num(hp.get("max"), 0, 99999, 0))
        hp = {"cur": int(_num(hp.get("cur"), -99999, 99999, mx)), "max": mx}
    else:
        hp = None
    conds = t.get("conds", o.get("conds"))
    conds = [x for x in conds if x in CONDS][:20] if isinstance(conds, list) else []
    out = {"id": o["id"], "name": _str(t.get("name", o["name"]), 40),
           "x": _num(t.get("x", o["x"]), -COORD, COORD, 0), "y": _num(t.get("y", o["y"]), -COORD, COORD, 0),
           "s": _num(t.get("s", o["s"]), 0.5, 6, 1), "color": _color(t.get("color", o["color"]), "#ef4444"),
           "img": _asset(t.get("img", o["img"])), "char": _str(t.get("char", o["char"]), 40),
           "owner": _str(t.get("owner", o["owner"]), 40), "hidden": bool(t.get("hidden", o["hidden"])),
           "conds": conds, "hp": hp, "show_hp": bool(t.get("show_hp", o.get("show_hp"))), "req": o.get("req"),
           "mon": _str(t.get("mon", o.get("mon", "")), 40), "fold": _str(t.get("fold", o.get("fold", "")), 12)}
    if not gm:  # игрок меняет только положение и состояния своей фишки
        keep = {k: o[k] for k in o if k not in ("x", "y", "conds")}
        out.update(keep)
    return out


def clean_tmpl(t, by: str) -> dict:
    t = t if isinstance(t, dict) else {}
    kind = t.get("kind")
    if kind not in TMPL_KINDS:
        raise MapError("bad_template")
    return {"id": _uid(), "kind": kind, "x": _num(t.get("x"), -COORD, COORD, 0), "y": _num(t.get("y"), -COORD, COORD, 0),
            "ang": _num(t.get("ang"), -10, 10, 0), "len": _num(t.get("len"), 5, 500, 20), "w": _num(t.get("w"), 5, 100, 5),
            "color": _color(t.get("color"), "#8b5cf6"), "by": by}


def new_map(data) -> dict:
    d = data if isinstance(data, dict) else {}
    iw = _num(d.get("iw"), 100, 20000, 1400)
    ih = _num(d.get("ih"), 100, 20000, 1000)
    return {"id": _uid(), "name": _str(d.get("name"), 60) or "Map", "img": _asset(d.get("img")), "img_s": _asset(d.get("img_s")),
            "iw": iw, "ih": ih,
            "bg": _color(d.get("bg"), "#1b1c22"), "grid": clean_grid(d.get("grid")),
            "fog": {"on": False, "zones": []}, "tokens": [], "tmpls": []}


def update_meta(m: dict, f: dict) -> None:
    if not isinstance(f, dict):
        raise MapError("bad_request")
    if "name" in f:
        m["name"] = _str(f["name"], 60) or m["name"]
    if "img" in f:
        m["img"] = _asset(f["img"])
        m["img_s"] = _asset(f.get("img_s"))
    for k in ("iw", "ih"):
        if k in f:
            m[k] = _num(f[k], 100, 20000, m[k])
    if "bg" in f:
        m["bg"] = _color(f["bg"], m.get("bg", "#1b1c22"))
    if "grid" in f:
        m["grid"] = clean_grid(f["grid"], m.get("grid"))
    if "folders" in f and isinstance(f["folders"], list):
        # папки фишек в списке мастера (как группы слоёв в фотошопе)
        m["folders"] = [{"id": _str(x.get("id"), 12) or _uid()[:12], "name": _str(x.get("name"), 40) or "…"}
                        for x in f["folders"][:50] if isinstance(x, dict)]
    if "fog_on" in f:
        m.setdefault("fog", {"on": False, "zones": []})["on"] = bool(f["fog_on"])


# ------------------------------------------------------------------ видимость
def point_in_poly(x: float, y: float, pts: list) -> bool:
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def in_open_zone(m: dict, x: float, y: float) -> bool:
    return any(z.get("open") and point_in_poly(x, y, z.get("pts") or []) for z in m.get("fog", {}).get("zones", []))


def token_mine(t: dict, pid: str | None, chars_owner: dict) -> bool:
    if not pid:
        return False
    return t.get("owner") == pid or (bool(t.get("char")) and chars_owner.get(t["char"]) == pid)


def token_visible(m: dict, t: dict, pid: str | None, chars_owner: dict) -> bool:
    """Видит ли игрок pid фишку (мастер видит всё — сюда не попадает)."""
    if token_mine(t, pid, chars_owner):
        return True
    if t.get("hidden"):
        return False
    if m.get("fog", {}).get("on") and not in_open_zone(m, t.get("x", 0), t.get("y", 0)):
        return False
    return True


def for_player(m: dict, pid: str | None, chars_owner: dict) -> dict:
    out = copy.deepcopy(m)
    fog = out.get("fog", {"on": False, "zones": []})
    if fog.get("on"):
        fog["zones"] = [z for z in fog.get("zones", []) if z.get("open")]
    else:
        fog["zones"] = []
    toks = []
    for t in out.get("tokens", []):
        if not token_visible(m, t, pid, chars_owner):
            continue
        if not token_mine(t, pid, chars_owner):
            t.pop("req", None)
        if not (t.get("show_hp") or token_mine(t, pid, chars_owner)):
            t["hp"] = None
        toks.append(t)
    out["tokens"] = toks
    return out
