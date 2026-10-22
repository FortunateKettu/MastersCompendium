"""Броски кубиков. Кидает только сервер мастера — так все видят один результат и подкрутить нельзя.

Формулы: «1d20+5», «2d6+1d4+3», «4d6kh3» (оставить 3 лучших), «2d20kl1» (худший), «d%», «d100».
Режимы для первого d20: преимущество (adv) → 2d20kh1, помеха (dis) → 2d20kl1.
"""
from __future__ import annotations

import re
import secrets

_rng = secrets.SystemRandom()

MAX_DICE = 100
MAX_SIDES = 1000
MAX_TERMS = 20

_TERM = re.compile(r"([+-])?\s*(?:(\d*)\s*[dDкК]\s*(\d+|%)(?:\s*(kh|kl|k)\s*(\d+))?|(\d+))")


class DiceError(ValueError):
    pass


def parse(formula: str) -> list[dict]:
    if re.search(r"[\dкКdD%]\s+[\d]", formula or ""):
        raise DiceError("missing operator")
    s = (formula or "").strip().replace(" ", "")
    if not s:
        raise DiceError("empty")
    if len(s) > 120:
        raise DiceError("too_long")
    terms, pos = [], 0
    while pos < len(s):
        m = _TERM.match(s, pos)
        if not m or m.end() == pos:
            raise DiceError(f"bad formula at {pos}")
        if terms and not m.group(1):
            raise DiceError("missing operator")
        sign = -1 if m.group(1) == "-" else 1
        if m.group(6) is not None:
            terms.append({"sign": sign, "const": int(m.group(6))})
        else:
            n = int(m.group(2) or 1)
            sides = 100 if m.group(3) == "%" else int(m.group(3))
            if not (1 <= n <= MAX_DICE) or not (2 <= sides <= MAX_SIDES):
                raise DiceError("limits")
            keep = None
            if m.group(4):
                k = int(m.group(5))
                if not (1 <= k <= n):
                    raise DiceError("keep")
                keep = ("kl" if m.group(4) == "kl" else "kh", k)
            terms.append({"sign": sign, "n": n, "sides": sides, "keep": keep})
        pos = m.end()
        if len(terms) > MAX_TERMS:
            raise DiceError("too_many_terms")
    return terms


def apply_mode(terms: list[dict], mode: str) -> list[dict]:
    """Преимущество/помеха: первый одиночный d20 превращается в 2d20kh1 / 2d20kl1."""
    if mode not in ("adv", "dis"):
        return terms
    for t in terms:
        if t.get("sides") == 20 and t.get("n") == 1 and not t.get("keep"):
            t["n"] = 2
            t["keep"] = ("kh" if mode == "adv" else "kl", 1)
            break
    return terms


def roll(formula: str, mode: str = "normal") -> dict:
    terms = apply_mode(parse(formula), mode)
    total = 0
    parts = []
    crit = fumble = False
    first_d20 = True
    for t in terms:
        if "const" in t:
            total += t["sign"] * t["const"]
            parts.append({"sign": t["sign"], "const": t["const"]})
            continue
        rolls = [_rng.randint(1, t["sides"]) for _ in range(t["n"])]
        kept = list(range(len(rolls)))
        if t["keep"]:
            kind, k = t["keep"]
            order = sorted(range(len(rolls)), key=lambda i: rolls[i], reverse=(kind == "kh"))
            kept = sorted(order[:k])
        s = sum(rolls[i] for i in kept)
        total += t["sign"] * s
        label = f'{t["n"]}d{t["sides"]}' + (f'{t["keep"][0]}{t["keep"][1]}' if t["keep"] else "")
        parts.append({"sign": t["sign"], "dice": label, "sides": t["sides"], "rolls": rolls, "kept": kept, "sum": s})
        if t["sides"] == 20 and first_d20 and len(kept) == 1:
            first_d20 = False
            nat = rolls[kept[0]]
            crit, fumble = nat == 20, nat == 1
    return {"total": total, "parts": parts, "crit": crit, "fumble": fumble, "formula": canonical(terms)}


def canonical(terms: list[dict]) -> str:
    out = []
    for i, t in enumerate(terms):
        sign = "-" if t["sign"] < 0 else ("+" if i else "")
        if "const" in t:
            out.append(f'{sign}{t["const"]}')
        else:
            k = f'{t["keep"][0]}{t["keep"][1]}' if t.get("keep") else ""
            out.append(f'{sign}{t["n"]}d{t["sides"]}{k}')
    return "".join(out)
