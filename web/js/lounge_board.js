// Masters Compendium — комната ожидания: общая доска для каракулей. Рисуют все сразу, видно вживую.
// Мастер может очистить доску или сделать из неё новую карту.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t } = MC;
  const L = MC.Lounge;

  const W = 1000, H = 700, K = 1.5;            // логический размер и запас чёткости
  const BG = "#efe6d2";
  const COLORS = ["#1f1a17", "#ffffff", "#ef4444", "#f59e0b", "#facc15", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#8b5a2b"];
  const SIZES = [3, 8, 18];
  let strokes = [], loaded = false, loading = false;
  let color = MC.store.get("lzb_color") || COLORS[0], size = MC.int(MC.store.get("lzb_size"), 8), erase = false;
  let cv = null, ctx = null;
  let cur = null, buf = [], flushTimer = null;

  // ---------------------------------------------------------------- рисование
  function strokeStyle(s) {
    ctx.globalCompositeOperation = s.e ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.lineCap = ctx.lineJoin = "round";
  }
  /** Нарисовать штрих начиная с точки from (индекс пары). */
  function drawFrom(s, from = 0) {
    if (!ctx || !s.p.length) return;
    strokeStyle(s);
    const p = s.p;
    if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    const start = Math.max(0, from - 1);
    ctx.beginPath();
    ctx.moveTo(p[start * 2], p[start * 2 + 1]);
    for (let i = start + 1; i < p.length / 2; i++) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
    ctx.stroke();
  }
  function redraw() {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(K, 0, 0, K, 0, 0);
    for (const s of strokes) drawFrom(s, 0);
  }

  function pos(e) {
    const r = cv.getBoundingClientRect();
    return [Math.round(MC.clamp((e.clientX - r.left) / r.width * W, 0, W)), Math.round(MC.clamp((e.clientY - r.top) / r.height * H, 0, H))];
  }
  function flush() {
    if (!cur || !buf.length) return;
    MC.send({ t: "lzp_add", id: cur.id, c: cur.c, w: cur.w, e: cur.e, p: buf });
    buf = [];
  }
  function down(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (!loaded) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const [x, y] = pos(e);
    cur = { id: MC.uid().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12), by: L.key(), c: color, w: erase ? size * 2.5 : size, e: erase, p: [x, y] };
    strokes.push(cur);
    buf = [x, y];
    drawFrom(cur, 0);
    flushTimer = setInterval(flush, 70);
  }
  function move(e) {
    if (!cur) return;
    const n = cur.p.length;
    const [x, y] = pos(e);
    if (Math.abs(x - cur.p[n - 2]) + Math.abs(y - cur.p[n - 1]) < 2) return;
    if (cur.p.length >= 2400) return;
    cur.p.push(x, y); buf.push(x, y);
    drawFrom(cur, cur.p.length / 2 - 1);
  }
  function up() {
    if (!cur) return;
    clearInterval(flushTimer);
    flush();
    cur = null;
  }

  // ---------------------------------------------------------------- разметка
  function html() {
    return `<div class="card glass lzb">
      <div class="lzb-tools">
        <div class="lzb-colors">${COLORS.map((c) => `<button class="lzb-col ${c === color && !erase ? "on" : ""}" data-lzbc="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
        <div class="lzb-sizes">${SIZES.map((s) => `<button class="lzb-size ${s === size ? "on" : ""}" data-lzbs="${s}"><i style="width:${Math.min(18, s + 2)}px;height:${Math.min(18, s + 2)}px"></i></button>`).join("")}
          <button class="chip ${erase ? "on" : ""}" data-lzb="erase">${MC.icon("droplet", "sm")} ${t("lzb.erase")}</button>
          <button class="chip" data-lzb="undo">${MC.icon("undo", "sm")} ${t("lzb.undo")}</button>
          ${L.gm() ? `<button class="chip" data-lzb="clear">${MC.icon("trash", "sm")} ${t("lzb.clear")}</button>
          <button class="chip" data-lzb="map">${MC.icon("map", "sm")} ${t("lzb.to_map")}</button>` : ""}</div></div>
      <div class="lzb-wrap" style="background:${BG}"><canvas id="lzb-cv" width="${W * K}" height="${H * K}"></canvas>${loaded ? "" : `<span class="lzb-load muted">…</span>`}</div>
      <p class="muted small">${t("lzb.hint")}</p></div>`;
  }
  function mount(el) {
    el.innerHTML = html();
    cv = $("#lzb-cv");
    ctx = cv.getContext("2d");
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("lostpointercapture", up);
    redraw();
    if (!loaded) load();
  }
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const r = await MC.request({ t: "lzp_get" });
      strokes = (r.strokes || []).map((s) => ({ ...s, p: [...s.p] }));
      loaded = true;
      if (L.here() && L.sub() === "board") mount($("#lz-body"));
    } catch { /* нет связи */ } finally { loading = false; }
  }

  async function toMap() {
    const out = document.createElement("canvas");
    out.width = W * K; out.height = H * K;
    const o = out.getContext("2d");
    o.fillStyle = BG; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(cv, 0, 0);
    const blob = await new Promise((ok) => out.toBlob(ok, "image/png"));
    if (!blob || !MC.uploadAsset) return;
    MC.toast(t("map.uploading"), "", "upload");
    try {
      const id = await MC.uploadAsset(blob, 2400);
      const d = new Date();
      await MC.request({ t: "map_new", map: { name: `${t("lzb.map_name")} ${d.getDate()}.${d.getMonth() + 1}`, img: id, iw: out.width, ih: out.height, grid: { on: false } } });
      MC.toast(t("lzb.map_done"), "ok", "map");
    } catch { MC.toast(t("map.upload_failed"), "bad"); }
  }

  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-lzbc]");
    if (c) { color = c.dataset.lzbc; erase = false; MC.store.set("lzb_color", color); repaintTools(); return; }
    const s = e.target.closest("[data-lzbs]");
    if (s) { size = Number(s.dataset.lzbs); MC.store.set("lzb_size", size); repaintTools(); return; }
    const b = e.target.closest("[data-lzb]");
    if (!b) return;
    const k = b.dataset.lzb;
    if (k === "erase") { erase = !erase; repaintTools(); }
    if (k === "undo") {
      const mine = [...strokes].reverse().find((x) => x.by === L.key());
      if (mine) { strokes = strokes.filter((x) => x !== mine); redraw(); MC.send({ t: "lzp_undo" }); }
    }
    if (k === "clear" && await MC.confirm(t("lzb.clear_q"))) MC.send({ t: "lzp_clear" });
    if (k === "map") toMap();
  });
  function repaintTools() {
    for (const x of document.querySelectorAll("[data-lzbc]")) x.classList.toggle("on", x.dataset.lzbc === color && !erase);
    for (const x of document.querySelectorAll("[data-lzbs]")) x.classList.toggle("on", Number(x.dataset.lzbs) === size);
    document.querySelector('[data-lzb="erase"]')?.classList.toggle("on", erase);
  }

  MC.on("msg_lzp", (m) => {
    if (!loaded) return;
    if (m.op === "clear") { strokes = []; redraw(); return; }
    if (m.op === "del") {
      const i = strokes.map((s) => s.id === m.id && s.by === m.by).lastIndexOf(true);
      if (i >= 0) { strokes.splice(i, 1); redraw(); }
      return;
    }
    if (m.op === "add") {
      const x = m.s;
      let s = strokes.find((y) => y.id === x.id && y.by === x.by);
      if (!s) { s = { ...x, p: [] }; strokes.push(s); }
      const from = s.p.length / 2;
      s.p.push(...x.p);
      drawFrom(s, from);
    }
  });
  MC.on("welcome", () => {
    loaded = false; strokes = [];
    if (L.here() && L.sub() === "board" && cv) mount($("#lz-body"));
  });

  L.register({
    id: "board", ic: "pen",
    render: (el) => mount(el),
    hide: () => { up(); cv = null; ctx = null; },
  });
})();
