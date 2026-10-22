// Masters Compendium — пометки на карте: стрелки, линии, круги, рамки, надписи и рисунок от руки.
// Видят все. Мастер рисует всегда; игроки — если мастер разрешил. Своё можно стереть, мастер стирает любое.
(() => {
  "use strict";
  const MC = window.MC;
  const M = MC.Map;
  const { $, t, esc } = MC;
  const COLORS = ["#facc15", "#f87171", "#4ade80", "#60a5fa", "#c084fc", "#ffffff", "#111827"];
  const KINDS = [["arrow", "next"], ["line", "ruler"], ["pen", "pen"], ["circle", "t-circle"], ["rect", "rect"], ["text", "edit"], ["erase", "trash"]];
  const st = { kind: MC.store.get("mk_kind") || "arrow", color: MC.store.get("mk_color") || "#facc15", w: MC.num(MC.store.get("mk_w"), 4) };
  let draft = null;
  M.marksOk = false;
  const myId = () => (MC.isGM() ? "gm" : MC.state.me?.id);
  const canDel = (mk) => MC.isGM() || mk.by === myId();

  // ---------------------------------------------------------------- рисование
  function arrowHead(ctx, a, b, w) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = Math.max(12, w * 4);
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  }
  function drawOne(ctx, mk, z, ghost) {
    const p = mk.pts, w = mk.w || 4;
    ctx.save();
    ctx.globalAlpha = ghost ? 0.7 : 0.95;
    ctx.strokeStyle = ctx.fillStyle = mk.color || "#facc15";
    ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 4;
    if (mk.kind === "pen") { ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    else if (mk.kind === "line" || mk.kind === "arrow") {
      const a = p[0], b = p[p.length - 1];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if (mk.kind === "arrow") arrowHead(ctx, a, b, w);
    } else if (mk.kind === "circle") {
      const a = p[0], b = p[p.length - 1];
      ctx.beginPath(); ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2); ctx.stroke();
    } else if (mk.kind === "rect") {
      const a = p[0], b = p[p.length - 1];
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    } else if (mk.kind === "text" && mk.text) {
      const fs = Math.max(14, w * 6);
      ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, fs / 6); ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.shadowBlur = 0;
      ctx.strokeText(mk.text, p[0][0], p[0][1]);
      ctx.fillText(mk.text, p[0][0], p[0][1]);
    }
    ctx.restore();
  }
  M.drawMarks = (ctx, m, z) => {
    for (const mk of m.marks || []) drawOne(ctx, mk, z, false);
  };
  /** Ближайшая к точке пометка (для стирания). */
  function hit(w) {
    const z = M.view.z, tol = 12 / z;
    const segD = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L));
      return Math.hypot(p.x - a[0] - k * dx, p.y - a[1] - k * dy);
    };
    const list = (M.map?.marks || []).slice().reverse();
    for (const mk of list) {
      const p = mk.pts, a = p[0], b = p[p.length - 1];
      let d = Infinity;
      if (mk.kind === "pen") for (let i = 1; i < p.length; i++) d = Math.min(d, segD(w, p[i - 1], p[i]));
      else if (mk.kind === "line" || mk.kind === "arrow") d = segD(w, a, b);
      else if (mk.kind === "circle") d = Math.abs(Math.hypot(w.x - a[0], w.y - a[1]) - Math.hypot(b[0] - a[0], b[1] - a[1]));
      else if (mk.kind === "rect") {
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        d = Math.min(segD(w, [x0, y0], [x1, y0]), segD(w, [x1, y0], [x1, y1]), segD(w, [x1, y1], [x0, y1]), segD(w, [x0, y1], [x0, y0]));
      } else if (mk.kind === "text") d = Math.hypot(w.x - a[0] - (mk.text.length * Math.max(14, (mk.w || 4) * 6) * 0.25), w.y - a[1]) - Math.max(14, (mk.w || 4) * 6) * 0.6;
      if (d <= tol + (mk.w || 4) / 2) return mk;
    }
    return null;
  }

  // ---------------------------------------------------------------- инструмент
  const send = (o) => MC.request(o).catch((e) => MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"));
  M.tools.marks = {
    cursor: "crosshair",
    down(w) {
      if (!M.map) return false;
      if (st.kind === "erase") {
        const mk = hit(w);
        if (mk && canDel(mk)) send({ t: "mark_del", map: M.map.id, id: mk.id });
        return true;
      }
      draft = { kind: st.kind, color: st.color, w: st.w, pts: [[w.x, w.y]] };
      return true;
    },
    move(w) {
      if (!draft) return;
      if (draft.kind === "pen") {
        const l = draft.pts[draft.pts.length - 1];
        if (Math.hypot(w.x - l[0], w.y - l[1]) > 3 / M.view.z && draft.pts.length < 600) draft.pts.push([w.x, w.y]);
      } else draft.pts[1] = [w.x, w.y];
    },
    async up(w, e, moved) {
      if (!draft || !M.map) return;
      const d = draft;
      draft = null;
      if (d.kind === "text") {
        const v = await MC.modal({ title: t("mk.text"), body: `<input class="big-num" name="tx" maxlength="80" autofocus>`,
          buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (wr) => wr.querySelector("[name=tx]").value.trim() }],
          mount: (m, close) => m.querySelector("input").addEventListener("keydown", (ev) => { if (ev.key === "Enter") close(ev.target.value.trim()); }) });
        if (!v) { M.redraw(); return; }
        d.text = v;
      } else if (d.pts.length < 2 || !moved) { M.redraw(); return; }
      send({ t: "mark_add", map: M.map.id, mark: d });
    },
    cancel() { draft = null; },
    draw(ctx, z) { if (draft && (draft.pts.length > 1 || draft.kind === "text")) drawOne(ctx, draft, z, true); },
  };

  // ---------------------------------------------------------------- панель инструмента
  function renderPop() {
    let el = $("#marks-pop");
    if (M.tool !== "marks") { el?.remove(); return; }
    const stage = $("#map-stage");
    if (!stage) return;
    if (!el) { el = document.createElement("div"); el.id = "marks-pop"; el.className = "marks-pop glass"; stage.appendChild(el); }
    el.innerHTML = `<div class="mk-row">${KINDS.map(([k, ic]) => `<button class="mt-btn ${st.kind === k ? "on" : ""}" data-mkk="${k}" title="${esc(t("mk.k." + k))}">${MC.icon(ic, "sm")}</button>`).join("")}</div>
      <div class="mk-row">${COLORS.map((c) => `<button class="mk-col ${st.color === c ? "on" : ""}" data-mkc="${c}" style="background:${c}"></button>`).join("")}
        <select data-mkw title="${esc(t("mk.width"))}">${[2, 4, 7, 11].map((n) => `<option value="${n}" ${st.w === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="mk-row"><button class="btn small" data-mka="mine">${MC.icon("trash", "sm")} ${t("mk.clear_mine")}</button>
        ${MC.isGM() ? `<button class="btn small danger" data-mka="all">${t("mk.clear_all")}</button>` : ""}</div>
      ${MC.isGM() ? `<label class="check small"><input type="checkbox" data-mkperm ${M.marksOk ? "checked" : ""}> ${t("mk.perm")}</label>` : ""}`;
  }
  MC.on("map_tool", renderPop);
  document.addEventListener("click", async (e) => {
    const k = e.target.closest("[data-mkk]");
    if (k) { st.kind = k.dataset.mkk; MC.store.set("mk_kind", st.kind); renderPop(); return; }
    const c = e.target.closest("[data-mkc]");
    if (c) { st.color = c.dataset.mkc; MC.store.set("mk_color", st.color); renderPop(); return; }
    const a = e.target.closest("[data-mka]");
    if (a && M.map) {
      if (a.dataset.mka === "all" && !(await MC.confirm(t("mk.clear_all_q")))) return;
      send({ t: "mark_clear", map: M.map.id, mine: a.dataset.mka === "mine" });
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-mkw]")) { st.w = MC.int(e.target.value, 4); MC.store.set("mk_w", String(st.w)); }
    if (e.target.matches("[data-mkperm]")) send({ t: "mark_perm", on: e.target.checked });
  });
  MC.on("msg_marks_perm", (m) => {
    const was = M.marksOk;
    M.marksOk = !!m.on;
    M.renderToolbar?.();
    if (!MC.isGM() && was !== M.marksOk) {
      MC.toast(t(M.marksOk ? "mk.perm_on" : "mk.perm_off"), "", "pen");
      if (!M.marksOk && M.tool === "marks") M.setTool("pan");
    }
    renderPop();
  });
  MC.on("welcome", () => MC.request({ t: "mark_perm_get" }).then((m) => MC.emit("msg_marks_perm", m)).catch(() => {}));
})();
