"""Немного правил D&D 5e (2014) на стороне сервера — чтобы бой считал попадания и урон сам.

Те же формулы, что в web/js/rules.js (КД, спасброски, бонус мастерства), плюс разбор статблока
монстра (спасброски, скорость, сопротивления) и расстояние по клеткам карты.
"""
from __future__ import annotations

import math
import re

ABILS = ("str", "dex", "con", "int", "wis", "cha")
# как характеристики пишут в статблоках (ru / en, сокращения и полные)
AB_WORDS = {
    "str": ("сил", "str"), "dex": ("лов", "dex"), "con": ("тел", "con"),
    "int": ("инт", "int"), "wis": ("мдр", "мудр", "wis"), "cha": ("хар", "cha"),
}


def _i(v, d: int = 0) -> int:
    try:
        return int(float(str(v).replace("−", "-").replace(",", ".")))
    except (TypeError, ValueError):
        return d


def mod(score) -> int:
    return (_i(score, 10) - 10) // 2


# ------------------------------------------------------------------ персонаж (лист)
def level(doc: dict) -> int:
    cls = doc.get("classes") if isinstance(doc.get("classes"), list) else []
    return max(1, sum(_i(k.get("level"), 0) for k in cls if isinstance(k, dict)))


def prof(doc: dict) -> int:
    return 2 + (level(doc) - 1) // 4


def ab_mod(doc: dict, ab: str) -> int:
    return mod((doc.get("abilities") or {}).get(ab, 10))


def save_bonus(doc: dict, ab: str) -> int:
    saves = doc.get("saves") if isinstance(doc.get("saves"), list) else []
    return ab_mod(doc, ab) + (prof(doc) if ab in saves else 0)


def char_ac(doc: dict) -> int:
    """Как R.ac в клиенте: вручную или по надетому доспеху/щиту/защите без доспехов."""
    ac = doc.get("ac") if isinstance(doc.get("ac"), dict) else {}
    if ac.get("mode") == "manual":
        return _i(ac.get("manual"), 10) + _i(ac.get("bonus"), 0)
    inv = [i for i in (doc.get("inventory") or []) if isinstance(i, dict)]
    armor = next((i for i in inv if i.get("equipped") and i.get("kind") == "armor"), None)
    shield = next((i for i in inv if i.get("equipped") and i.get("kind") == "shield"), None)
    dex = ab_mod(doc, "dex")
    if armor:
        base = _i(armor.get("ac"), 10)
        if armor.get("acat") == "heavy" or armor.get("dex") is False:
            v = base
        elif armor.get("acat") == "medium":
            v = base + min(dex, _i(armor.get("maxdex"), 2) if armor.get("maxdex") is not None else 2)
        else:
            v = base + dex
    elif ac.get("unarmored") == "barb":
        v = 10 + dex + ab_mod(doc, "con")
    elif ac.get("unarmored") == "monk" and not shield:
        v = 10 + dex + ab_mod(doc, "wis")
    else:
        v = 10 + dex
    if shield:
        v += _i(shield.get("ac"), 2)
    return v + _i(ac.get("bonus"), 0)


def char_speed(doc: dict) -> int:
    return max(0, _i(doc.get("speed"), 30))


# ------------------------------------------------------------------ монстр (статблок)
def mon_save_bonus(m: dict, ab: str) -> int:
    """«Лов +4, Мдр +3» — если характеристика указана, берём число, иначе модификатор."""
    s = str(m.get("saves") or "").lower()
    for w in AB_WORDS[ab]:
        mm = re.search(rf"(?:^|[^а-яa-z]){w}[а-яa-z.]*\s*([+−-]\s*\d+)", s)
        if mm:
            return _i(mm.group(1).replace(" ", ""))
    return mod((m.get("abil") or {}).get(ab, 10))


def mon_speed(m: dict) -> int:
    mm = re.search(r"\d+", str(m.get("speed") or ""))
    return int(mm.group(0)) if mm else 30


# типы урона: основа слова (ru) и en — чтобы «огнём», «огонь», «огненный» и «fire» совпали
DMG_STEMS = {
    "acid": ("кислот", "acid"), "bludgeoning": ("дробящ", "bludgeon"), "cold": ("холод", "cold"),
    "fire": ("огн", "огон", "fire"), "force": ("силов", "force"), "lightning": ("электр", "молни", "lightning"),
    "necrotic": ("некрот", "necrotic"), "piercing": ("колющ", "pierc"), "poison": ("яд", "poison"),
    "psychic": ("психич", "psychic"), "radiant": ("излучен", "свет", "radiant"), "slashing": ("рубящ", "slash"),
    "thunder": ("звук", "гром", "thunder"),
}


def _has_stem(text: str, stems) -> bool:
    t = (text or "").lower()
    return any(re.search(rf"(?<![а-яёa-z]){s}", t) for s in stems)


def dmg_type(text: str) -> str:
    for k, stems in DMG_STEMS.items():
        if _has_stem(text, stems):
            return k
    return ""


def resist_mult(m: dict | None, dtype: str) -> float:
    """Множитель урона по статблоку: иммунитет 0, сопротивление ½, уязвимость ×2."""
    if not m or not dtype:
        return 1.0
    stems = DMG_STEMS.get(dtype, ())
    has = lambda field: _has_stem(str(m.get(field) or ""), stems)  # noqa: E731
    if has("dmg_imm"):
        return 0.0
    if has("dmg_res"):
        return 0.5
    if has("dmg_vul"):
        return 2.0
    return 1.0


# ------------------------------------------------------------------ формулы
_DICE = re.compile(r"(\d*)\s*[dDкК]\s*(\d+)")


def crit_formula(f: str) -> str:
    """Критическое попадание: удвоить количество костей (модификаторы не трогаем)."""
    return _DICE.sub(lambda m: f"{(int(m.group(1)) if m.group(1) else 1) * 2}d{m.group(2)}", f or "")


def clean_formula(f: str) -> str:
    s = str(f or "").replace("−", "-").replace("–", "-")
    s = re.sub(r"[кК]", "d", s)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"\+?MOD", "", s, flags=re.I)
    return s[:60]


# ------------------------------------------------------------------ карта
def is_hex(grid: dict) -> bool:
    return (grid or {}).get("type") in ("hexh", "hexv")


def hex_axial(grid: dict, x: float, y: float) -> tuple[float, float]:
    """Точка → дробные осевые координаты шестиугольной сетки (size — расстояние между центрами соседей)."""
    g = grid or {}
    s = float(g.get("size") or 70) or 70
    r_ = s / math.sqrt(3)
    px, py = x - float(g.get("ox") or 0), y - float(g.get("oy") or 0)
    if g.get("type") == "hexv":           # плоская вершина — столбцы
        return (2 / 3 * px) / r_, (-1 / 3 * px + math.sqrt(3) / 3 * py) / r_
    return (math.sqrt(3) / 3 * px - 1 / 3 * py) / r_, (2 / 3 * py) / r_


def hex_steps(grid: dict, a: tuple[float, float], b: tuple[float, float]) -> float:
    aq, ar = hex_axial(grid, *a)
    bq, br = hex_axial(grid, *b)
    dq, dr = bq - aq, br - ar
    return (abs(dq) + abs(dr) + abs(dq + dr)) / 2


def dist_ft(grid: dict, a: tuple[float, float], b: tuple[float, float]) -> int:
    """Как M.dist в клиенте: по клеткам, диагональ 5 фт или 5/10."""
    g = grid or {}
    size = float(g.get("size") or 70) or 70
    ft = _i(g.get("ft"), 5) or 5
    dx, dy = abs(b[0] - a[0]) / size, abs(b[1] - a[1]) / size
    if not g.get("on"):
        return round(math.hypot(dx, dy) * ft)
    if is_hex(g):
        return int(hex_steps(g, a, b) + 0.5) * ft
    cx, cy = round(dx), round(dy)
    n = max(cx, cy) + (min(cx, cy) // 2 if g.get("diag") == "5-10" else 0)
    return n * ft
