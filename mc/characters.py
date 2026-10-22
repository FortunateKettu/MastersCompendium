"""Персонажи: хранение в кампании, правки по операциям, файлы .character.

Лист — это JSON-документ (его устройство знает веб-клиент, см. web/js/rules.js → MC.newCharacter).
Сервер не считает правила, он только хранит документ, проверяет права и рассылает правки.

Правка — список операций:
    {"op": "set",    "path": ["hp", "cur"], "value": 7}
    {"op": "add",    "path": ["inventory"], "value": {...}}      — в конец списка (id выдаётся, если нет)
    {"op": "remove", "path": ["inventory", "<id>"]}               — удалить элемент списка по id
В пути элемент списка адресуется своим id (или номером).
"""
from __future__ import annotations

import copy
import json
import time
import uuid
from pathlib import Path

from . import paths
from .campaign import Campaign, clean_name

MAX_DOC_BYTES = 3 * 1024 * 1024       # с портретом
MAX_PATH = 8
PROTECTED = {"id", "owner", "version", "system", "created"}
SYSTEM = "dnd5e_2014"
FILE_FORMAT = 1


class CharError(Exception):
    pass


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def chars(c: Campaign) -> list[dict]:
    lst = c.extra.setdefault("characters", [])
    if not isinstance(lst, list):
        lst = c.extra["characters"] = []
    return lst


def find(c: Campaign, cid: str) -> dict | None:
    return next((d for d in chars(c) if isinstance(d, dict) and d.get("id") == cid), None)


def sanitize_new(doc: dict, owner: str | None) -> dict:
    if not isinstance(doc, dict):
        raise CharError("bad_doc")
    d = copy.deepcopy(doc)
    d["id"] = uuid.uuid4().hex[:12]
    d["owner"] = owner
    d["version"] = 1
    d["system"] = SYSTEM
    d["created"] = d["modified"] = _now()
    d["name"] = clean_name(str(d.get("name", ""))) or "?"
    if len(json.dumps(d, ensure_ascii=False).encode("utf-8")) > MAX_DOC_BYTES:
        raise CharError("too_big")
    return d


def create(c: Campaign, doc: dict, owner: str | None) -> dict:
    d = sanitize_new(doc, owner)
    with c.lock:
        chars(c).append(d)
        c.touch()
    return d


def delete(c: Campaign, cid: str) -> dict | None:
    with c.lock:
        d = find(c, cid)
        if d:
            chars(c).remove(d)
            c.touch()
        return d


def assign(c: Campaign, cid: str, owner: str | None) -> dict | None:
    with c.lock:
        d = find(c, cid)
        if d:
            d["owner"] = owner
            d["version"] = int(d.get("version", 0)) + 1
            c.touch()
        return d


# ------------------------------------------------------------------ операции
def _step(node, key):
    if isinstance(node, dict):
        if not isinstance(key, str):
            raise CharError("bad_path")
        return node, key
    if isinstance(node, list):
        if isinstance(key, int):
            if not 0 <= key < len(node):
                raise CharError("bad_index")
            return node, key
        for i, el in enumerate(node):
            if isinstance(el, dict) and el.get("id") == key:
                return node, i
        raise CharError("no_item")
    raise CharError("bad_path")


def _resolve(doc: dict, path: list, create: bool = False) -> tuple:
    """→ (контейнер, ключ) для последнего элемента пути. create — достраивать недостающие объекты (для set)."""
    if not isinstance(path, list) or not path or len(path) > MAX_PATH:
        raise CharError("bad_path")
    if path[0] in PROTECTED:
        raise CharError("protected")
    node = doc
    for key in path[:-1]:
        cont, k = _step(node, key)
        nxt = cont[k] if isinstance(cont, list) or k in cont else None
        if nxt is None:
            if create and isinstance(cont, dict):
                cont[k] = {}
                nxt = cont[k]
            else:
                raise CharError("bad_path")
        node = nxt
    last = path[-1]
    if isinstance(node, list):
        return _step(node, last)
    if isinstance(node, dict) and isinstance(last, str):
        return node, last
    raise CharError("bad_path")


def apply_ops(doc: dict, ops: list) -> None:
    if not isinstance(ops, list) or len(ops) > 200:
        raise CharError("bad_ops")
    for op in ops:
        if not isinstance(op, dict):
            raise CharError("bad_ops")
        kind, path = op.get("op"), op.get("path")
        if kind == "set":
            cont, key = _resolve(doc, path, create=True)
            cont[key] = op.get("value")
        elif kind == "add":
            if not isinstance(path, list) or not path or path[0] in PROTECTED:
                raise CharError("bad_path")
            cont, key = _resolve(doc, path, create=True)
            lst = cont.get(key) if isinstance(cont, dict) else cont[key]
            if lst is None:
                lst = cont[key] = []
            if not isinstance(lst, list):
                raise CharError("not_list")
            val = op.get("value")
            if isinstance(val, dict) and not val.get("id"):
                val["id"] = uuid.uuid4().hex[:10]
            lst.append(val)
        elif kind == "inc":
            # прибавить число (деньги, количество) — чтобы не перезаписать чужую одновременную правку
            cont, key = _resolve(doc, path, create=True)
            try:
                cur = float(cont[key]) if (isinstance(cont, dict) and key in cont) or isinstance(cont, list) else 0
            except (TypeError, ValueError):
                cur = 0
            try:
                val = float(op.get("value"))
            except (TypeError, ValueError):
                raise CharError("bad_ops")
            res = cur + val
            cont[key] = int(res) if res == int(res) else res
        elif kind == "remove":
            cont, key = _resolve(doc, path)
            if isinstance(cont, list):
                cont.pop(key)
            else:
                cont.pop(key, None)
        else:
            raise CharError("bad_op")


def patch(c: Campaign, cid: str, ops: list) -> dict:
    """Применить правку атомарно: если что-то не так — документ не меняется."""
    with c.lock:
        d = find(c, cid)
        if d is None:
            raise CharError("no_char")
        work = copy.deepcopy(d)
        apply_ops(work, ops)
        if len(json.dumps(work, ensure_ascii=False).encode("utf-8")) > MAX_DOC_BYTES:
            raise CharError("too_big")
        work["version"] = int(d.get("version", 0)) + 1
        work["modified"] = _now()
        d.clear()
        d.update(work)
        c.touch()
        return d


# ------------------------------------------------------------------ сводка для списка партии
def summary(d: dict) -> dict:
    classes = d.get("classes") if isinstance(d.get("classes"), list) else []
    level = 0
    cls = []
    for k in classes:
        if isinstance(k, dict):
            lv = int(k.get("level") or 0)
            level += lv
            cls.append({"id": k.get("id", ""), "name": k.get("name", ""), "level": lv, "sub": k.get("sub", "")})
    hp = d.get("hp") if isinstance(d.get("hp"), dict) else {}
    race = d.get("race") if isinstance(d.get("race"), dict) else {}
    return {"id": d.get("id"), "name": d.get("name", "?"), "owner": d.get("owner"), "level": level,
            "classes": cls, "race": {"id": race.get("id", ""), "sub": race.get("sub", ""), "name": race.get("name", "")},
            "hp": {"cur": hp.get("cur", 0), "max": hp.get("max", 0), "temp": hp.get("temp", 0)},
            "portrait": d.get("portrait", "") if len(str(d.get("portrait", ""))) < 120_000 else "",
            "conditions": d.get("conditions", []) if isinstance(d.get("conditions"), list) else [],
            "show_hp": bool(d.get("show_hp")),
            "version": d.get("version", 0)}


# ------------------------------------------------------------------ файлы .character
def export_file(d: dict, path: str | Path) -> Path:
    path = Path(path)
    data = {"format": FILE_FORMAT, "app": paths.APP_ID, "system": SYSTEM, "character": d}
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)
    return path


def read_file(path: str | Path) -> dict:
    path = Path(path)
    if path.stat().st_size > MAX_DOC_BYTES + 100_000:
        raise CharError("too_big")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise CharError("broken_file") from e
    return unwrap(data)


def unwrap(data) -> dict:
    """Принимаем и файл .character, и «голый» документ персонажа."""
    if isinstance(data, dict) and isinstance(data.get("character"), dict):
        if data.get("app") not in (None, paths.APP_ID):
            raise CharError("not_a_character")
        data = data["character"]
    if not isinstance(data, dict) or "abilities" not in data:
        raise CharError("not_a_character")
    return data
