"""Пометки на карте: стрелки, круги, линии, рамки, надписи и рисунок от руки — видят все.

Рисовать всегда может мастер, игроки — только если мастер разрешил («Пометки игроков»).
Игрок стирает свои пометки, мастер — любые и может очистить все разом.
"""
from __future__ import annotations

import re

from . import gmtools as gt
from . import maps as mp

KINDS = ("pen", "arrow", "line", "circle", "rect", "text")
MAX_MARKS = 300
COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")


def clean_mark(x, by: str) -> dict | None:
    if not isinstance(x, dict) or x.get("kind") not in KINDS:
        return None
    pts = x.get("pts")
    if not isinstance(pts, list) or not 1 <= len(pts) <= 600:
        return None
    out_pts = []
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        out_pts.append([round(mp._num(p[0], -mp.COORD, mp.COORD, 0), 1), round(mp._num(p[1], -mp.COORD, mp.COORD, 0), 1)])
    col = x.get("color") if isinstance(x.get("color"), str) and COLOR_RE.fullmatch(x["color"]) else "#facc15"
    out = {"id": gt.uid(), "kind": x["kind"], "pts": out_pts, "color": col, "w": mp._num(x.get("w"), 1, 16, 4), "by": by}
    if x["kind"] == "text":
        out["text"] = gt._line(x.get("text") or "", 80)
        if not out["text"]:
            return None
    return out


class MarksMixin:
    def _marks_ok(self) -> bool:
        return bool(self.campaign.extra.get("marks_players"))

    async def _marks_msg(self, conn, t: str, data: dict) -> None:
        c = self.campaign
        rid = data.get("rid")
        if t == "mark_perm":
            if not conn.gm:
                raise gt.ToolError("no_access")
            with c.lock:
                c.extra["marks_players"] = bool(data.get("on"))
                c.touch()
            await self._send(conn.ws, {"t": "ok", "rid": rid})
            await self._broadcast({"t": "marks_perm", "on": self._marks_ok()})
            return
        if t == "mark_perm_get":
            await self._send(conn.ws, {"t": "marks_perm", "on": self._marks_ok(), "rid": rid})
            return
        m = mp.find(c, str(data.get("map") or ""))
        if m is None:
            raise gt.ToolError("not_found")
        by = "gm" if conn.gm else conn.pid
        with c.lock:
            marks = m.setdefault("marks", [])
            if t == "mark_add":
                if not conn.gm and not self._marks_ok():
                    raise gt.ToolError("no_access")
                mk = clean_mark(data.get("mark"), by)
                if mk is None:
                    raise gt.ToolError("bad_request")
                marks.append(mk)
                del marks[:max(0, len(marks) - MAX_MARKS)]
            elif t == "mark_del":
                mk = next((x for x in marks if x.get("id") == data.get("id")), None)
                if mk is None:
                    raise gt.ToolError("not_found")
                if not conn.gm and mk.get("by") != by:
                    raise gt.ToolError("no_access")
                m["marks"] = [x for x in marks if x is not mk]
            elif t == "mark_clear":
                if conn.gm:
                    m["marks"] = [] if not data.get("mine") else [x for x in marks if x.get("by") != "gm"]
                else:
                    m["marks"] = [x for x in marks if x.get("by") != by]
            else:
                raise gt.ToolError("bad_request")
            c.touch()
        await self._send(conn.ws, {"t": "ok", "rid": rid})
        await self._push_map(m)
