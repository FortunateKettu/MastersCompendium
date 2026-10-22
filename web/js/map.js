// Masters Compendium — карта: отрисовка (canvas 2D), перемещение и масштаб, фишки, линейка, шаблоны, туман.
// Инструменты мастера (карты, сетка, зоны тумана, волшебная палочка) — в map_gm.js, он подключается через M.tools.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const M = (MC.Map = {
    map: null, mode: "own", active: false,
    tool: "pan", tools: {},          // tools[name] = {down, move, up, draw, cursor}
    sel: null,                       // выбранная фишка (id)
    limit: true,                     // в бою: сверх скорости и не в свой ход — с подтверждения мастера
    tmplKind: "circle", tmplLen: 20,
    // цвет шаблона: по стихии/школе — огонь, холод, яд и т.д. Запоминаем выбор для каждой формы
    tmplColors: (() => { try { return JSON.parse(localStorage.getItem("mc_tmpl_colors")) || {}; } catch { return {}; } })(),
  });

  // настройки эффектов (их можно выключить для слабых устройств)
  const fxOpt = (k) => MC.store.get("mfx_" + k) !== "0";
  M.fx = { hover: fxOpt("hover"), move: fxOpt("move"), conds: fxOpt("conds"), reach: fxOpt("reach"), names: MC.store.get("opt_names") || "always" };
  // окошки на карте справа: бой и журнал бросков
  const dockOpt = (k) => { const v = MC.store.get("dock_" + k); return v == null ? window.innerWidth >= 900 : v === "1"; };
  M.dock = { combat: dockOpt("combat"), log: dockOpt("log") };

  let cv, ctx, wrap, dpr = 1, W = 0, H = 0;      // ctx временно подменяется при рисовании наклонённой фишки
  const hov = { id: null, k: 0, target: 0, tx: 0, ty: 0, cx: 0, cy: 0 };     // фишка под мышкой: подъём и наклон
  const moves = new Map();                                                       // id → плавное перемещение
  const drops = new Map();                                                       // id → где чужая фишка была отпущена
  const view = { z: 1, tx: 0, ty: 0, fitted: null };
  let needDraw = false, animUntil = 0;
  const fx = { rulers: new Map(), pings: [], drags: new Map() };   // чужие линейки/метки/перетаскивания

  // ---------------------------------------------------------------- геометрия
  M.toWorld = (sx, sy) => ({ x: (sx - view.tx) / view.z, y: (sy - view.ty) / view.z });
  M.toScreen = (x, y) => ({ x: x * view.z + view.tx, y: y * view.z + view.ty });
  M.view = view;
  const grid = () => M.map?.grid || { on: false, size: 70, ox: 0, oy: 0, ft: 5, diag: "5" };
  const cell = () => grid().size || 70;
  const ftPx = () => cell() / (grid().ft || 5);

  // ---- шестиугольная сетка: hexh — острая вершина сверху (ряды), hexv — плоская (столбцы); size — шаг между центрами
  const SQ3 = Math.sqrt(3);
  M.isHex = (g = grid()) => g.on && (g.type === "hexh" || g.type === "hexv");
  M.hexAxial = (g, x, y) => {
    const R = g.size / SQ3, px = x - (g.ox || 0), py = y - (g.oy || 0);
    return g.type === "hexv" ? { q: (2 / 3 * px) / R, r: (-1 / 3 * px + SQ3 / 3 * py) / R } : { q: (SQ3 / 3 * px - 1 / 3 * py) / R, r: (2 / 3 * py) / R };
  };
  M.hexRound = (q, r) => {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return { q: rx, r: rz };
  };
  M.hexCenter = (g, q, r) => {
    const R = g.size / SQ3;
    return g.type === "hexv" ? { x: (g.ox || 0) + R * 1.5 * q, y: (g.oy || 0) + R * SQ3 * (r + q / 2) } : { x: (g.ox || 0) + R * SQ3 * (q + r / 2), y: (g.oy || 0) + R * 1.5 * r };
  };
  M.hexSteps = (g, a, b) => { const A = M.hexAxial(g, a.x, a.y), B = M.hexAxial(g, b.x, b.y); const dq = B.q - A.q, dr = B.r - A.r; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
  M.hexPath = (c, g, cx, cy, inset = 0) => {
    const R = g.size / SQ3 - inset;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + (g.type === "hexv" ? 0 : Math.PI / 6);
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  };
  /** Центры клеток (шестиугольников) в прямоугольнике. */
  M.hexCellsIn = (g, x0, y0, x1, y1) => {
    const out = [], R = g.size / SQ3;
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => M.hexAxial(g, x, y));
    const qs = corners.map((c) => c.q), rs = corners.map((c) => c.r);
    for (let q = Math.floor(Math.min(...qs)) - 1; q <= Math.ceil(Math.max(...qs)) + 1; q++) {
      for (let r = Math.floor(Math.min(...rs)) - 1; r <= Math.ceil(Math.max(...rs)) + 1; r++) {
        const c = M.hexCenter(g, q, r);
        if (c.x >= x0 - R && c.x <= x1 + R && c.y >= y0 - R && c.y <= y1 + R) out.push(c);
      }
    }
    return out;
  };

  M.snap = (x, y, s = 1) => {
    const g = grid();
    if (!g.on) return { x, y };
    if (M.isHex(g)) { const a = M.hexAxial(g, x, y), h = M.hexRound(a.q, a.r); return M.hexCenter(g, h.q, h.r); }
    const c = g.size;
    const even = s >= 2 && Math.round(s) % 2 === 0;
    const f = (v, o) => (even ? o + Math.round((v - o) / c) * c : o + (Math.floor((v - o) / c) + 0.5) * c);
    return { x: f(x, g.ox), y: f(y, g.oy) };
  };
  M.snapCorner = (x, y) => {
    const g = grid();
    if (!g.on) return { x, y };
    return { x: g.ox + Math.round((x - g.ox) / g.size) * g.size, y: g.oy + Math.round((y - g.oy) / g.size) * g.size };
  };
  /** Расстояние в футах по правилам 5e (диагональ = 5 фт или 5/10). */
  M.dist = (a, b) => {
    const g = grid();
    const dx = Math.abs(b.x - a.x) / g.size, dy = Math.abs(b.y - a.y) / g.size;
    if (!g.on) return Math.round(Math.hypot(dx, dy) * (g.ft || 5));
    if (M.isHex(g)) return Math.floor(M.hexSteps(g, a, b) + 0.5) * (g.ft || 5);
    const cx = Math.round(dx), cy = Math.round(dy);
    const n = g.diag === "5-10" ? Math.max(cx, cy) + Math.floor(Math.min(cx, cy) / 2) : Math.max(cx, cy);
    return n * (g.ft || 5);
  };

  M.pointInPoly = (x, y, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
    }
    return inside;
  };

  /** Фигура шаблона в мировых координатах: {circle:{x,y,r}} или {poly:[[x,y]...]} */
  M.tmplShape = (tm) => {
    const L = tm.len * ftPx(), ca = Math.cos(tm.ang), sa = Math.sin(tm.ang);
    const P = (f, s) => [tm.x + ca * f - sa * s, tm.y + sa * f + ca * s];
    if (tm.kind === "circle") return { circle: { x: tm.x, y: tm.y, r: L } };
    if (tm.kind === "cone") return { poly: [P(0, 0), P(L, -L / 2), P(L, L / 2)] };
    if (tm.kind === "line") { const w = (tm.w || 5) * ftPx() / 2; return { poly: [P(0, -w), P(L, -w), P(L, w), P(0, w)] }; }
    return { poly: [P(0, -L / 2), P(L, -L / 2), P(L, L / 2), P(0, L / 2)] };     // куб: от середины грани
  };
  const inShape = (sh, x, y) => (sh.circle ? Math.hypot(x - sh.circle.x, y - sh.circle.y) <= sh.circle.r + 0.5 : M.pointInPoly(x, y, sh.poly));

  // ---------------------------------------------------------------- кто есть кто
  const me = () => MC.state.me;
  const charOf = (tok) => (tok.char ? MC.state.chars.get(tok.char) : null);
  M.mine = (tok) => {
    if (MC.isGM() || !me()) return false;
    return tok.owner === me().id || charOf(tok)?.owner === me().id;
  };
  M.canMove = (tok) => MC.isGM() || (M.mine(tok) && M.mode !== "gm");
  const playerColor = (pid) => MC.state.players.find((p) => p.id === pid)?.color;
  M.tokColor = (tok) => {
    const c = charOf(tok);
    return (c && playerColor(c.owner)) || (tok.owner && playerColor(tok.owner)) || tok.color || "#ef4444";
  };
  M.tokName = (tok) => charOf(tok)?.name || tok.name || "?";
  M.tokHp = (tok) => { const c = charOf(tok); return c ? c.hp : tok.hp; };
  M.tokConds = (tok) => { const c = charOf(tok); return c ? [...(c.conditions || []), ...(tok.conds || []).filter((x) => !(c.conditions || []).includes(x))] : tok.conds || []; };
  M.tokR = (tok) => (tok.s || 1) * cell() * 0.46;

  // ---------------------------------------------------------------- картинки
  const imgs = new Map();
  M.img = (src) => {
    if (!src) return null;
    let e = imgs.get(src);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.onload = () => { e.ok = true; M.redraw(); MC.emit("map_img", src); };
      e.img.src = src;
      imgs.set(src, e);
    }
    return e.ok ? e.img : null;
  };
  M.assetUrl = (id) => (id ? "/asset/" + id : "");
  /** Картинка фишки: портрет персонажа или своя картинка. */
  M.tokPic = (tok) => (tok.char ? MC.state.chars.get(tok.char)?.portrait : "") || M.assetUrl(tok.img);
  const iconImgs = new Map();
  function iconImg(name, color) {
    const key = name + color;
    if (iconImgs.has(key)) return iconImgs.get(key);
    const body = (MC.ICONS || {})[name] || "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    const im = new Image();
    im.onload = () => M.redraw();
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    iconImgs.set(key, im);
    return im;
  }
  M.COND_COLOR = { blinded: "#64748b", charmed: "#ec4899", deafened: "#64748b", frightened: "#a855f7", grappled: "#f59e0b",
    incapacitated: "#ef4444", invisible: "#94a3b8", paralyzed: "#eab308", petrified: "#78716c", poisoned: "#22c55e",
    prone: "#f97316", restrained: "#f59e0b", stunned: "#facc15", unconscious: "#3b82f6", exhaustion: "#b45309",
    concentration: "#8b5cf6", bloodied: "#dc2626", dead: "#111827", flying: "#38bdf8", dodge: "#14b8a6", disengage: "#a3e635", dash: "#facc15", hiding: "#64748b",
    cover_half: "#a8a29e", cover_3q: "#78716c", cover_full: "#44403c", ready: "#f59e0b", surprised: "#fb923c" };
  /** Расстояние между краями фишек в футах (как на сервере: соседние клетки — 5 фт). */
  M.gapFt = (a, b) => {
    const g = M.map?.grid || {};
    const size = Number(g.size) || 70, ft = Number(g.ft) || 5;
    const dx = Math.abs(a.x - b.x) / size, dy = Math.abs(a.y - b.y) / size, half = ((a.s || 1) + (b.s || 1)) / 2;
    if (g.on && (g.type === "hexh" || g.type === "hexv")) return (Math.floor(Math.max(0, M.hexSteps({ ...g, size }, a, b) - half) + 0.5) + 1) * ft;
    return (Math.floor(Math.max(Math.max(0, dx - half), Math.max(0, dy - half)) + 0.5) + 1) * ft;
  };

  // ---------------------------------------------------------------- холст
  function ensureCanvas() {
    if (cv) return true;
    wrap = $("#map-stage");
    if (!wrap) return false;
    cv = document.createElement("canvas");
    cv.className = "map-canvas";
    wrap.prepend(cv);
    ctx = cv.getContext("2d");
    new ResizeObserver(resize).observe(wrap);
    bindInput();
    resize();
    return true;
  }
  function resize() {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const firstSize = !W;
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    if (firstSize || view.fitted !== M.map?.id) M.fit();
    M.redraw();
  }
  M.redraw = () => {
    if (needDraw || !ctx) return;
    needDraw = true;
    requestAnimationFrame(draw);
  };
  M.animate = (ms) => { animUntil = Math.max(animUntil, performance.now() + ms); M.redraw(); };

  M.fit = () => {
    const m = M.map;
    if (!m || !W) return;
    const pad = 24, left = M.insetLeft ? M.insetLeft() : 0, right = 60 + dockInset();
    const aw = Math.max(100, W - left - right);
    view.z = Math.min((aw - pad * 2) / m.iw, (H - pad * 2) / m.ih);
    view.z = MC.clamp(view.z, 0.05, 4);
    view.tx = left + (aw - m.iw * view.z) / 2;
    view.ty = (H - m.ih * view.z) / 2;
    view.fitted = m.id;
    M.redraw();
  };
  /** На телефоне вся карта бывает слишком мелкой — тогда приближаем к своей фишке (или к центру). */
  function autoZoom() {
    const m = M.map;
    if (!m || !W || cell() * view.z >= 26) return;
    const tok = (m.tokens || []).find((x) => M.mine(x));
    view.z = 38 / cell();
    if (tok) M.centerOn(tok.x, tok.y); else M.centerOn(m.iw / 2, m.ih / 2);
  }
  M.zoomAt = (sx, sy, k) => {
    const z = MC.clamp(view.z * k, 0.04, 8);
    const w = M.toWorld(sx, sy);
    view.z = z;
    view.tx = sx - w.x * z;
    view.ty = sy - w.y * z;
    M.redraw();
  };
  M.centerOn = (x, y) => { view.tx = W / 2 - x * view.z; view.ty = H / 2 - y * view.z; M.redraw(); };

  // ---------------------------------------------------------------- отрисовка
  function draw(now) {
    needDraw = false;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const m = M.map;
    if (!m) return;
    const z = view.z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * view.tx, dpr * view.ty);
    // фон и картинка
    ctx.fillStyle = m.bg || "#1b1c22";
    ctx.fillRect(0, 0, m.iw, m.ih);
    // полная картинка, а пока она грузится (медленный интернет) — маленькая копия
    const im = M.img(M.assetUrl(m.img)) || (m.img_s ? M.img(M.assetUrl(m.img_s)) : null);
    if (im) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(im, 0, 0, m.iw, m.ih); }
    drawGrid(m);
    drawTerrain(m);
    drawTemplates(m);
    M.drawMarks?.(ctx, m, z);
    drawReach(m);
    drawFog(m);
    if (MC.isGM()) M.tools.zones?.draw?.(ctx, z);
    const hovBusy = stepHover();
    dragAnim = false;
    drawTokens(m, now);
    drawReachLabel(m);
    drawFx(now);
    M.tools[M.tool]?.draw?.(ctx, z);
    if (now < animUntil || fx.pings.length || fx.rulers.size || hovBusy || moves.size || dragAnim || fx.floats.length) M.redraw();
    else if (animFx && M.fx.conds && isOpen() && !document.hidden) { clearTimeout(animTimer); animTimer = setTimeout(M.redraw, 66); }
  }

  function drawGrid(m) {
    const g = m.grid;
    if (!g?.on || g.size * view.z < 6) return;
    const s = g.size;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, m.iw, m.ih);
    ctx.clip();
    ctx.strokeStyle = g.color || "#fff";
    ctx.globalAlpha = g.alpha ?? 0.2;
    ctx.lineWidth = 1 / view.z;
    ctx.beginPath();
    if (M.isHex(g)) {
      // рисуем только видимую часть — шестиугольников может быть много
      const few = (m.iw * m.ih) / (s * s) < 6000;
      const a = few ? { x: 0, y: 0 } : M.toWorld(0, 0), b = few ? { x: m.iw, y: m.ih } : M.toWorld(W, H);
      for (const c of M.hexCellsIn(g, Math.max(0, a.x), Math.max(0, a.y), Math.min(m.iw, b.x), Math.min(m.ih, b.y))) M.hexPath(ctx, g, c.x, c.y);
    } else {
      for (let x = g.ox % s; x <= m.iw; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, m.ih); }
      for (let y = g.oy % s; y <= m.ih; y += s) { ctx.moveTo(0, y); ctx.lineTo(m.iw, y); }
    }
    ctx.stroke();
    ctx.restore();
  }

  function shapePath(sh) {
    ctx.beginPath();
    if (sh.circle) ctx.arc(sh.circle.x, sh.circle.y, sh.circle.r, 0, Math.PI * 2);
    else { sh.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  }
  M.drawTemplate = (tm, ghost = false) => {
    const sh = M.tmplShape(tm);
    const g = grid();
    ctx.save();
    ctx.fillStyle = tm.color || "#8b5cf6";
    // клетки, которые задевает шаблон (центр клетки внутри фигуры)
    if (g.on && M.map) {
      const s = g.size;
      let x0, y0, x1, y1;
      if (sh.circle) { x0 = sh.circle.x - sh.circle.r; x1 = sh.circle.x + sh.circle.r; y0 = sh.circle.y - sh.circle.r; y1 = sh.circle.y + sh.circle.r; }
      else { const xs = sh.poly.map((p) => p[0]), ys = sh.poly.map((p) => p[1]); x0 = Math.min(...xs); x1 = Math.max(...xs); y0 = Math.min(...ys); y1 = Math.max(...ys); }
      ctx.globalAlpha = ghost ? 0.22 : 0.28;
      if (M.isHex(g)) {
        ctx.beginPath();
        for (const c of M.hexCellsIn(g, x0, y0, x1, y1)) if (inShape(sh, c.x, c.y)) M.hexPath(ctx, g, c.x, c.y);
        ctx.fill();
      } else
      for (let cx = Math.floor((x0 - g.ox) / s); cx <= Math.ceil((x1 - g.ox) / s); cx++) {
        for (let cy = Math.floor((y0 - g.oy) / s); cy <= Math.ceil((y1 - g.oy) / s); cy++) {
          const px = g.ox + (cx + 0.5) * s, py = g.oy + (cy + 0.5) * s;
          if (inShape(sh, px, py)) ctx.fillRect(g.ox + cx * s, g.oy + cy * s, s, s);
        }
      }
    }
    shapePath(sh);
    ctx.globalAlpha = g.on ? 0.12 : 0.25;
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = tm.color || "#8b5cf6";
    ctx.lineWidth = 2.5 / view.z;
    if (ghost) ctx.setLineDash([8 / view.z, 6 / view.z]);
    ctx.stroke();
    ctx.restore();
  };
  // трудная местность: штриховка; движение по ней стоит вдвое
  let terrPat = null;
  function drawTerrain(m) {
    const list = (m.terrain || []).filter((z) => (z.pts || []).length >= 3);
    if (!list.length) return;
    if (!terrPat) {
      const p = document.createElement("canvas"); p.width = p.height = 16;
      const g = p.getContext("2d");
      g.strokeStyle = "rgba(180,120,60,.55)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-4, 20); g.lineTo(20, -4); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke();
      terrPat = ctx.createPattern(p, "repeat");
    }
    ctx.save();
    for (const z of list) {
      ctx.beginPath();
      z.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(120,72,30,.18)"; ctx.fill();
      ctx.fillStyle = terrPat; ctx.fill();
      ctx.lineWidth = 1.5 / view.z; ctx.strokeStyle = "rgba(217,140,70,.7)"; ctx.setLineDash([6 / view.z, 4 / view.z]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  /** Стоимость перемещения с учётом трудной местности (как на сервере). */
  M.moveCost = (a, b) => {
    const base = M.dist(a, b);
    const zones = (M.map?.terrain || []).filter((z) => (z.pts || []).length >= 3);
    if (!zones.length || base <= 0) return base;
    let inside = 0;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      if (zones.some((z) => M.pointInPoly(x, y, z.pts))) inside++;
    }
    return base + Math.round(base * inside / n);
  };
  function drawTemplates(m) { (m.tmpls || []).forEach((tm) => M.drawTemplate(tm)); }

  let fogCv = null;
  function drawFog(m) {
    if (!m.fog?.on) return;
    if (!fogCv) fogCv = document.createElement("canvas");
    if (fogCv.width !== cv.width || fogCv.height !== cv.height) { fogCv.width = cv.width; fogCv.height = cv.height; }
    const f = fogCv.getContext("2d");
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, fogCv.width, fogCv.height);
    f.globalCompositeOperation = "source-over";
    f.fillStyle = MC.isGM() ? "rgba(8,6,16,0.55)" : "#0b0a10";
    f.fillRect(0, 0, fogCv.width, fogCv.height);
    f.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * view.tx, dpr * view.ty);
    f.globalCompositeOperation = "destination-out";
    const soft = Math.max(2, cell() * 0.12);
    try { f.filter = `blur(${soft * view.z * dpr}px)`; } catch { /* Safari — без размытия */ }
    f.fillStyle = "#000";
    for (const zn of m.fog.zones || []) {
      if (!zn.open || !zn.pts?.length) continue;
      f.beginPath();
      zn.pts.forEach(([x, y], i) => (i ? f.lineTo(x, y) : f.moveTo(x, y)));
      f.closePath();
      f.fill();
    }
    f.filter = "none";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fogCv, 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------- эффекты на фишках
  // Что анимируется (концентрация, оглушение, «при смерти»), то и заставляет карту перерисовываться ~15 раз/с.
  let animFx = false;
  const ANIM = new Set(["flying", "concentration", "stunned", "paralyzed", "frightened", "charmed", "invisible"]);
  function auraEffects(x, y, r, conds, t) {
    const has = (k) => conds.includes(k);
    if (conds.some((k) => ANIM.has(k))) animFx = true;
    if (has("frightened")) {        // фиолетовая дрожащая аура
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2, rr = r * (1.22 + 0.06 * Math.sin(a * 7 + t * 6));
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(168,85,247,.28)";
      ctx.fill();
      ctx.restore();
    }
    if (has("charmed")) {           // розовое сияние
      const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * (1.45 + 0.05 * Math.sin(t * 3)));
      g.addColorStop(0, "rgba(236,72,153,.55)"); g.addColorStop(1, "rgba(236,72,153,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    if (has("poisoned")) {
      const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.35);
      g.addColorStop(0, "rgba(34,197,94,.45)"); g.addColorStop(1, "rgba(34,197,94,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function overlayEffects(x, y, r, conds, down, t) {
    const has = (k) => conds.includes(k);
    const fill = (style, op = "source-over") => { ctx.globalCompositeOperation = op; ctx.fillStyle = style; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.globalCompositeOperation = "source-over"; };
    if (has("petrified")) { fill("#9ca3af", "saturation"); fill("rgba(120,113,108,.45)"); }
    if (down || has("dead") || has("unconscious")) fill("#808080", "saturation");
    if (has("dead")) fill("rgba(0,0,0,.45)");
    else if (down || has("unconscious")) fill("rgba(15,23,42,.35)");
    if (has("poisoned")) fill("rgba(34,197,94,.22)");
    if (has("blinded")) fill("rgba(0,0,0,.42)");
    if (has("invisible")) {          // «марево»: полупрозрачные полосы
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = r * 0.08;
      for (let i = -3; i <= 3; i++) { const yy = y + i * r * 0.3 + Math.sin(t * 2 + i) * r * 0.06; ctx.beginPath(); ctx.moveTo(x - r, yy); ctx.lineTo(x + r, yy); ctx.stroke(); }
    }
    if (has("dead")) {               // красный крест
      ctx.strokeStyle = "rgba(220,38,38,.9)"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 0.5, y + r * 0.5);
      ctx.moveTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x - r * 0.5, y + r * 0.5); ctx.stroke();
    }
    if (has("unconscious") && !has("dead")) {
      ctx.fillStyle = "rgba(191,219,254,.95)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `800 ${r * 0.42}px "Segoe UI", system-ui, sans-serif`; ctx.fillText("Zz", x + r * 0.25, y - r * 0.3);
    }
  }
  function ringEffects(x, y, r, conds, hp, down, t) {
    const has = (k) => conds.includes(k);
    const z = view.z;
    const ring = (rr, color, w, dash, rot = 0) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.restore();
    };
    if (has("concentration")) ring(r * 1.2, "rgba(167,139,250,.95)", Math.max(2 / z, r * 0.07), [r * 0.35, r * 0.18], t * 1.6);
    if (has("stunned") || has("paralyzed")) {       // жёлтые искры по кругу
      ring(r * 1.12, "rgba(250,204,21,.9)", Math.max(2 / z, r * 0.06), [r * 0.08, r * 0.22], -t * 2.5);
    }
    if (has("restrained") || has("grappled")) ring(r * 1.08, "rgba(180,83,9,.95)", Math.max(2.5 / z, r * 0.1), [r * 0.22, r * 0.1]);
    if (has("incapacitated")) ring(r * 1.05, "rgba(148,163,184,.9)", Math.max(2 / z, r * 0.06), [r * 0.12, r * 0.12]);
    // игрок не видит хиты монстра, но видит пометку «ранен» — та же красная кромка
    if (!(hp && hp.max > 0) && has("bloodied") && !has("dead")) {
      const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, "rgba(220,38,38,0)"); g.addColorStop(1, "rgba(220,38,38,.45)");
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    }
    // ранен — красная кромка; при смерти (0 хитов) — пульсирует
    if (hp && hp.max > 0 && !has("dead")) {
      const k = hp.cur / hp.max;
      if (down) {
        animFx = true;
        const p = 0.5 + 0.5 * Math.sin(t * 5);
        ring(r * 1.04, `rgba(239,68,68,${0.4 + 0.5 * p})`, Math.max(3 / z, r * 0.12));
      } else if (k <= 0.5) {
        const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
        g.addColorStop(0, "rgba(220,38,38,0)"); g.addColorStop(1, `rgba(220,38,38,${k <= 0.25 ? 0.55 : 0.32})`);
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      }
    }
  }

  /** Мягкая тень приподнятой фишки «на столе». */
  function liftShadow(x, y, r, lift, ox = 0) {
    const cy = y + r * 0.32 * lift, cx = x + ox;
    const sh = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * (1.25 + 0.25 * lift));
    sh.addColorStop(0, `rgba(0,0,0,${0.55 * lift})`); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // Наклон под мышкой: фишку рисуем в отдельный холст, повёрнутый так, что ось наклона — вдоль X,
  // и переносим на карту узкими полосками с перспективой (дальний край меньше). Так наклон честный
  // в любую сторону, а не «сжимается к верху».
  let tiltCv = null;
  function drawTilted(tok, x, y, lift, tilt) {
    const r = M.tokR(tok);
    const k = 1 + 0.12 * lift;
    const sc = view.z * dpr * k;
    const half = Math.max(16, Math.ceil(r * 1.75 * sc));
    const S = half * 2;
    if (!tiltCv) tiltCv = document.createElement("canvas");
    // холст по умолчанию 300×150 — проверяем обе стороны, иначе фишку срежет сверху/снизу
    if (tiltCv.width < S || tiltCv.height < S) { const n = Math.max(S, tiltCv.width, tiltCv.height); tiltCv.width = n; tiltCv.height = n; }
    const o = tiltCv.getContext("2d");
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, tiltCv.width, tiltCv.height);     // весь холст: иначе от прошлых кадров остаются «рамки»
    const mag = Math.min(1, Math.hypot(tilt.x, tilt.y)), th = Math.atan2(tilt.y, tilt.x);
    o.setTransform(sc, 0, 0, sc, half, half);
    o.rotate(-th);
    o.translate(-x, -y);
    ctx.save();
    liftShadow(x, y, r, lift, -tilt.x * r * 0.25 * lift);
    ctx.restore();
    const main = ctx;
    ctx = o;
    try { drawToken(tok, x, y, 1, false, lift, tilt, true); } finally { ctx = main; }
    const sp = M.toScreen(x, y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(sp.x * dpr, sp.y * dpr - r * view.z * dpr * 0.06 * lift);
    ctx.rotate(th);
    const phi = 0.22 * mag * lift, f = 2.8, cosp = Math.cos(phi), sinp = Math.sin(phi);
    const proj = (u) => { const z = u * sinp; return { x: (u * cosp * f) / (f + z), s: f / (f + z) }; };
    const N = 30, w = S / N;
    for (let i = 0; i < N; i++) {
      const u0 = -1 + (2 * i) / N, u1 = u0 + 2 / N;
      const a = proj(u0), b = proj(u1), m = proj((u0 + u1) / 2);
      const h = m.s * half;
      ctx.drawImage(tiltCv, i * w, 0, w, S, a.x * half, -h, (b.x - a.x) * half + 0.5, 2 * h);
    }
    ctx.restore();
    drawName(tok, x, y + r * 0.04 * lift, r * k, M.tokHp(tok));
  }

  function drawName(tok, x, y, r, hp) {
    if (M.fx.names === "hover" ? !(M.sel === tok.id || hov.id === tok.id || nameHov === tok.id) : !(r * view.z > 16 || M.sel === tok.id || hov.id === tok.id)) return;
    const fs = Math.max(11 / view.z, r * 0.36);
    ctx.save();
    ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const name = M.tokName(tok);
    const ty = y + r * 1.02 + (hp && hp.max > 0 ? r * 0.12 : 0);
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(10,9,16,.72)";
    ctx.fillRect(x - tw / 2 - fs * 0.3, ty, tw + fs * 0.6, fs * 1.3);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, x, ty + fs * 0.15);
    ctx.restore();
  }

  function drawToken(tok, x, y, alpha = 1, ghost = false, lift = 0, tilt = null, inner = false) {
    const r = M.tokR(tok);
    const col = M.tokColor(tok);
    const c = charOf(tok);
    ctx.save();
    ctx.globalAlpha = alpha * (tok.hidden ? 0.55 : 1);
    // «Полёт»: фишка парит над столом и чуть покачивается
    if (!ghost && !inner && M.tokConds(tok).includes("flying")) lift = Math.max(lift, 0.75 + 0.12 * Math.sin(performance.now() / 420 + x * 0.01));
    if (lift > 0.004 && !inner) {
      // приподнятая фишка (движется / тащат): тень на «столе», сама крупнее
      liftShadow(x, y, r, lift);
      const k = 1 + 0.2 * lift;
      ctx.translate(x, y - r * 0.12 * lift);
      ctx.scale(k, k);
      ctx.translate(-x, -y);
    }
    // тень
    ctx.beginPath();
    ctx.arc(x, y + r * 0.08, r * 1.02, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fill();
    const conds = ghost ? [] : M.tokConds(tok);
    const hpNow = M.tokHp(tok);
    const has = (k) => conds.includes(k);
    const down = hpNow && hpNow.max > 0 && hpNow.cur <= 0;
    const fxNow = performance.now() / 1000;
    if (!ghost) auraEffects(x, y, r, conds, fxNow);
    if (has("invisible")) ctx.globalAlpha *= 0.42;
    // картинка / буква
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    if (has("prone")) { ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.scale(1, 0.82); ctx.translate(-x, -y); }
    const src = c?.portrait || M.assetUrl(tok.img);
    const im = src ? M.img(src) : null;
    if (im) {
      const k = Math.max((2 * r) / im.width, (2 * r) / im.height);
      ctx.drawImage(im, x - (im.width * k) / 2, y - (im.height * k) / 2, im.width * k, im.height * k);
    } else {
      const gr = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, col); gr.addColorStop(1, "#1d1830");
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${r * 0.95}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((M.tokName(tok).trim().charAt(0) || "?").toUpperCase(), x, y + r * 0.04);
    }
    if (!ghost) overlayEffects(x, y, r, conds, down, fxNow);
    if (lift > 0.004 && tilt) {      // блик, который бегает за мышкой — как на карточках
      const gx = x + tilt.x * r * 0.65, gy = y + tilt.y * r * 0.65;
      const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 1.25);
      gl.addColorStop(0, `rgba(255,255,255,${0.38 * lift})`); gl.addColorStop(0.45, `rgba(255,255,255,${0.1 * lift})`); gl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gl;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
    if (!ghost) ringEffects(x, y, r, conds, hpNow, down, fxNow);
    // кольцо
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2 / view.z, r * 0.12);
    ctx.strokeStyle = col;
    if (ghost) ctx.setLineDash([r * 0.3, r * 0.2]);
    ctx.stroke();
    ctx.setLineDash([]);
    const turn = MC.Combat?.curToken?.();
    if (turn && !ghost && ((turn.token && turn.token === tok.id) || (turn.char && turn.char === tok.char))) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.28, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(3 / view.z, r * 0.1);
      ctx.strokeStyle = "#f5c542";
      ctx.shadowColor = "#f5c542"; ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (M.sel === tok.id && !ghost) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.16, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 / view.z;
      ctx.strokeStyle = "#e9e3ff";
      ctx.shadowColor = "#8b5cf6"; ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (ghost) { ctx.restore(); return; }
    // полоска хитов
    const hp = M.tokHp(tok);
    if (hp && hp.max > 0) {
      const w = r * 1.6, h = Math.max(3 / view.z, r * 0.14), bx = x - w / 2, by = y + r * 0.82;
      const k = MC.clamp(hp.cur / hp.max, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,.7)";
      ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = k < 0.3 ? "#ef4444" : k < 0.6 ? "#f59e0b" : "#22c55e";
      ctx.fillRect(bx, by, w * k, h);
      if (hp.temp > 0) {          // временные хиты — голубой «щит» поверх
        ctx.fillStyle = "rgba(56,189,248,.95)";
        ctx.fillRect(bx, by - h * 0.55, w * MC.clamp(hp.temp / hp.max, 0, 1), h * 0.5);
      }
    }
    // состояния — значки по кругу сверху
    const badges = conds.filter((x) => x !== "bloodied");
    const br = Math.max(7 / view.z, r * 0.3);
    badges.slice(0, 5).forEach((cd, i) => {
      const a = -Math.PI / 2 + (i - (Math.min(badges.length, 5) - 1) / 2) * 0.62;
      const cx = x + Math.cos(a) * r * 1.02, cy = y + Math.sin(a) * r * 1.02;
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.fillStyle = M.COND_COLOR[cd] || "#475569";
      ctx.fill();
      ctx.lineWidth = 1.5 / view.z;
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.stroke();
      const ic = iconImg(cd === "bloodied" ? "droplet" : cd === "dead" ? "skull" : "c-" + cd, "#fff");
      if (ic.complete) ctx.drawImage(ic, cx - br * 0.68, cy - br * 0.68, br * 1.36, br * 1.36);
    });
    // номер одинаковых монстров («Гоблин 3») — маленький значок справа снизу, чтобы их различать
    const num = !c && /\s(\d{1,2})$/.exec(M.tokName(tok));
    if (num) {
      const nr = Math.max(7 / view.z, r * 0.3), nx = x + r * 0.74, ny = y + r * 0.62;
      ctx.beginPath(); ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fillStyle = "#14121c"; ctx.fill();
      ctx.lineWidth = Math.max(1.5 / view.z, nr * 0.16); ctx.strokeStyle = col; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `800 ${nr * 1.15}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(num[1], nx, ny + nr * 0.06);
    }
    ctx.restore();
    // имя — когда фишка достаточно крупная или выбрана (у наклонённой рисуется отдельно, без перспективы)
    if (!inner) {
      const k = lift > 0.004 ? 1 + 0.2 * lift : 1;
      drawName(tok, x, y - r * 0.12 * (lift > 0.004 ? lift : 0), r * k, hp);
    }
  }

  let animTimer = 0;
  function drawTokens(m, now) {
    animFx = false;
    // крупные снизу; фишка под мышкой и движущиеся — поверх остальных
    const rank = (x) => (x.id === hov.id ? 2 : moves.has(x.id) ? 1 : 0);
    const toks = [...(m.tokens || [])].sort((a, b) => (rank(a) - rank(b)) || ((b.s || 1) - (a.s || 1)));
    for (const tok of toks) {
      const d = drag && drag.tok.id === tok.id ? drag : fx.drags.get(tok.id);
      if (tok.req && (MC.isGM() || M.mine(tok))) {
        drawToken(tok, tok.req.x, tok.req.y, 0.6, true);
        arrow(tok.x, tok.y, tok.req.x, tok.req.y, M.tokColor(tok));
      }
      if (d && d !== drag) smoothDrag(d, now);         // чужое перетаскивание — плавно догоняем, а не прыжками
      if (d && d.done) {
        if (now - d.ts < 1500) { drawToken(tok, d.dx, d.dy, 1); continue; }
        fx.drags.delete(tok.id);
      } else if (d && (!d.ts || now - d.ts < 3000)) {
        const px = d === drag ? d.x : d.dx, py = d === drag ? d.y : d.dy;
        drawToken(tok, tok.x, tok.y, 0.3, true);
        drawToken(tok, px, py, 1, false, d === drag ? 0.6 : 0.35);
        rulerLine({ x: tok.x, y: tok.y }, { x: px, y: py }, M.tokColor(tok), true);
        continue;
      }
      const mv = movePos(tok, now);
      if (mv) { drawToken(tok, mv.x, mv.y, 1, false, mv.lift); continue; }
      if (hov.id === tok.id && hov.k > 0.004) drawTilted(tok, tok.x, tok.y, hov.k, { x: hov.cx, y: hov.cy });
      else drawToken(tok, tok.x, tok.y, 1);
    }
  }

  let dragAnim = false;
  function smoothDrag(d, now) {
    const dt = Math.min(200, now - (d.st || now - 16));
    d.st = now;
    const a = 1 - Math.exp(-dt / 75);
    d.dx += (d.x - d.dx) * a;
    d.dy += (d.y - d.dy) * a;
    if (Math.abs(d.x - d.dx) > 0.4 || Math.abs(d.y - d.dy) > 0.4) dragAnim = true;
  }

  // ---------------------------------------------------------------- наведение и плавное перемещение
  /** Шаг анимации наведения; true — ещё анимируется. */
  function stepHover() {
    if (!hov.id) return false;
    // сглаживание по времени, а не по кадрам: на медленном устройстве анимация не растягивается
    const now = performance.now(), dt = Math.min(200, now - (hov.t || now - 16));
    hov.t = now;
    const a = 1 - Math.exp(-dt / 65), b = 1 - Math.exp(-dt / 55);
    hov.k += (hov.target - hov.k) * a;
    hov.cx += (hov.tx - hov.cx) * b;
    hov.cy += (hov.ty - hov.cy) * b;
    if (hov.target === 0 && hov.k < 0.01) { hov.id = null; hov.k = 0; return false; }
    return Math.abs(hov.target - hov.k) > 0.005 || Math.abs(hov.tx - hov.cx) > 0.005 || Math.abs(hov.ty - hov.cy) > 0.005;
  }
  let nameHov = null;          // над какой фишкой мышь (для «имена при наведении»)
  function setHover(tok, w) {
    const nid = tok && !drag ? tok.id : null;
    if (nid !== nameHov) { nameHov = nid; if (M.fx.names === "hover") M.redraw(); }
    if (!M.fx.hover || !tok || drag || gesture || M.tool !== "pan") {
      if (hov.id && hov.target !== 0) { hov.target = 0; M.redraw(); }
      return;
    }
    const r = M.tokR(tok);
    if (hov.id !== tok.id) { hov.id = tok.id; hov.k = 0; hov.cx = 0; hov.cy = 0; hov.t = 0; }
    hov.target = 1;
    hov.tx = MC.clamp((w.x - tok.x) / r, -1, 1);
    hov.ty = MC.clamp((w.y - tok.y) / r, -1, 1);
    M.redraw();
  }
  function startMove(id, x0, y0, x1, y1) {
    if (!M.fx.move) return;
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1 || d > 60 * cell()) return;
    const cells = d / cell();
    moves.set(id, { x0, y0, x1, y1, t0: performance.now(), dur: MC.clamp(200 + cells * 70, 220, 850) });
    M.redraw();
  }
  function movePos(tok, now) {
    const a = moves.get(tok.id);
    if (!a) return null;
    if (a.x1 !== tok.x || a.y1 !== tok.y) { moves.delete(tok.id); return null; }
    const p = Math.min(1, (now - a.t0) / a.dur);
    if (p >= 1) { moves.delete(tok.id); return null; }
    const e = 1 - Math.pow(1 - p, 3);
    return { x: a.x0 + (a.x1 - a.x0) * e, y: a.y0 + (a.y1 - a.y0) * e, lift: 0.45 * Math.sin(Math.PI * Math.min(1, p * 1.15)) };
  }

  function arrow(x0, y0, x1, y1, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3 / view.z;
    ctx.setLineDash([10 / view.z, 7 / view.z]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  function rulerLine(a, b, color, small = false) {
    const z = view.z;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = (small ? 2.5 : 3.5) / z;
    ctx.setLineDash([12 / z, 7 / z]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    [a, b].forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 / z, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
    const d = M.dist(a, b);
    const label = `${d} ${t("map.ft")}`;
    const fs = 14 / z;
    ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width + fs * 1.1;
    const mx = b.x + 18 / z, my = b.y - 18 / z;
    ctx.fillStyle = "rgba(14,12,22,.88)";
    roundRect(mx - w / 2, my - fs * 0.85, w, fs * 1.7, fs * 0.5);
    ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 / z; ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, mx, my + fs * 0.05);
    ctx.restore();
  }
  M.rulerLine = (a, b, c) => rulerLine(a, b, c);
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- бой на карте: куда можно дойти, цифры над фишками
  function turnToken(m) {
    const cb = MC.Combat?.state;
    if (!cb?.active || !cb.cur) return null;
    const e = cb.list.find((x) => x.id === cb.cur);
    if (!e) return null;
    const tok = (m.tokens || []).find((x) => (e.token && e.map === m.id && x.id === e.token) || (e.char && x.char === e.char));
    return tok ? { e, tok } : null;
  }
  function drawReach(m) {
    if (M.fx.reach === false) return;
    const tt = turnToken(m);
    if (!tt || !(MC.isGM() || M.mine(tt.tok))) return;
    const left = Math.max(0, MC.int(tt.e.speed, 30) - MC.int(tt.e.econ?.mv, 0));
    const g = grid();
    const o = { x: tt.tok.x, y: tt.tok.y };
    ctx.save();
    ctx.fillStyle = "rgba(250,204,21,.09)";
    ctx.strokeStyle = "rgba(250,204,21,.28)";
    ctx.lineWidth = 1 / view.z;
    if (M.isHex(g) && left > 0) {
      const R = (left / (g.ft || 5) + 1) * g.size;
      ctx.beginPath();
      for (const c of M.hexCellsIn(g, o.x - R, o.y - R, o.x + R, o.y + R)) {
        if (c.x < 0 || c.y < 0 || c.x > m.iw || c.y > m.ih) continue;
        if (M.moveCost(o, c) <= left) M.hexPath(ctx, g, c.x, c.y, 1 / view.z);
      }
      ctx.fill();
    } else if (g.on && left > 0) {
      const s = g.size, n = Math.ceil(left / (g.ft || 5)) + 1;
      const c0x = Math.floor((o.x - g.ox) / s), c0y = Math.floor((o.y - g.oy) / s);
      for (let cx = c0x - n; cx <= c0x + n; cx++) {
        for (let cy = c0y - n; cy <= c0y + n; cy++) {
          const px = g.ox + (cx + 0.5) * s, py = g.oy + (cy + 0.5) * s;
          if (px < 0 || py < 0 || px > m.iw || py > m.ih) continue;
          if (M.moveCost(o, { x: px, y: py }) <= left) { ctx.fillRect(g.ox + cx * s + 1 / view.z, g.oy + cy * s + 1 / view.z, s - 2 / view.z, s - 2 / view.z); }
        }
      }
    } else if (left > 0) {
      ctx.beginPath(); ctx.arc(o.x, o.y, left * ftPx(), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  /** Надпись «сколько футов осталось» — поверх фишек, чтобы её не закрывали. */
  function drawReachLabel(m) {
    if (M.fx.reach === false) return;
    const tt = turnToken(m);
    if (!tt || !(MC.isGM() || M.mine(tt.tok))) return;
    const left = Math.max(0, MC.int(tt.e.speed, 30) - MC.int(tt.e.econ?.mv, 0));
    const d = drag && drag.tok.id === tt.tok.id ? drag : null;
    const o = d ? { x: d.x, y: d.y } : { x: tt.tok.x, y: tt.tok.y };
    const used = d ? M.moveCost({ x: tt.tok.x, y: tt.tok.y }, M.snap(d.x, d.y, tt.tok.s || 1)) : 0;
    const rest = left - used;
    ctx.save();
    const r = M.tokR(tt.tok), fs = Math.max(12 / view.z, r * 0.36);
    const over = rest < 0;
    const label = over ? t("map.move_over", { n: -rest }) : `${t("map.move_left")} ${rest} ${t("map.ft")}`;
    ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width + fs;
    const lx = o.x, ly = o.y - r * 1.75;
    ctx.fillStyle = over ? "rgba(40,6,10,.9)" : "rgba(20,16,4,.88)";
    roundRect(lx - tw / 2, ly - fs * 0.75, tw, fs * 1.5, fs * 0.6); ctx.fill();
    ctx.strokeStyle = over ? "rgba(248,113,113,.9)" : "rgba(250,204,21,.85)"; ctx.lineWidth = 1.5 / view.z; ctx.stroke();
    ctx.fillStyle = over ? "#fecaca" : "#fde68a"; ctx.fillText(label, lx, ly + fs * 0.05);
    ctx.restore();
  }

  fx.floats = [];
  const FLOAT_STYLE = { miss: ["#cbd5e1", "fl.miss"], hit: ["#f87171", ""], crit: ["#fbbf24", "fl.crit"], save_ok: ["#67e8f9", "fl.saved"],
    save_fail: ["#f87171", "fl.failed"], heal: ["#4ade80", ""], conc_lost: ["#c084fc", "fl.conc_lost"] };
  MC.on("msg_cb_events", (m) => {
    const now = performance.now();
    for (const ev of m.events || []) {
      const st = FLOAT_STYLE[ev.k];
      if (!st || !M.map || ev.map !== M.map.id) continue;
      const n = MC.int(ev.dmg, 0);
      const num = ev.k === "heal" ? `+${n}` : n ? `−${n}` : "";
      const word = st[1] ? t(st[1]) : "";
      const text = [word, num].filter(Boolean).join(" ") || (ev.k === "hit" ? t("fl.hit") : "");
      if (!text) continue;
      const same = fx.floats.filter((f) => f.tok === ev.token && now - f.ts < 400).length;
      fx.floats.push({ tok: ev.token, text, color: st[0], ts: now + same * 260, big: ev.k === "crit" });
    }
    M.redraw();
  });
  function drawFloats(now) {
    fx.floats = fx.floats.filter((f) => now - f.ts < 1900);
    for (const f of fx.floats) {
      const tok = M.map?.tokens?.find((x) => x.id === f.tok);
      if (!tok || now < f.ts) continue;
      const k = (now - f.ts) / 1900;
      const r = M.tokR(tok), mv = movePos(tok, now);
      const x = mv ? mv.x : tok.x, y = (mv ? mv.y : tok.y) - r * 1.1 - k * r * 1.3;
      const fs = Math.max(16 / view.z, r * (f.big ? 0.75 : 0.55)) * (k < 0.12 ? 0.6 + k * 3.4 : 1);
      ctx.save();
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `900 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = fs * 0.22; ctx.strokeStyle = "rgba(10,8,18,.9)"; ctx.lineJoin = "round";
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
      ctx.restore();
    }
  }

  function drawFx(now) {
    drawFloats(now);
    for (const [k, r] of fx.rulers) {
      const age = now - r.ts;
      if (age > (r.done ? 1800 : 4000)) { fx.rulers.delete(k); continue; }
      ctx.save(); ctx.globalAlpha = r.done ? Math.max(0, 1 - age / 1800) : 1;
      rulerLine(r.a, r.b, r.color);
      ctx.restore();
    }
    if (ruler) rulerLine(ruler.a, ruler.b, me()?.color || "#8b5cf6");
    fx.pings = fx.pings.filter((p) => now - p.ts < 1600);
    for (const p of fx.pings) {
      const k = (now - p.ts) / 1600;
      for (let i = 0; i < 2; i++) {
        const kk = (k + i * 0.3) % 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (12 + kk * 60) / view.z, 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = (1 - kk) * (1 - k * 0.5);
        ctx.lineWidth = 4 / view.z; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- ввод
  const ptrs = new Map();
  let gesture = null, drag = null, ruler = null, pressTimer = 0, lastFx = 0;
  M.hitToken = (x, y) => {
    const toks = M.map?.tokens || [];
    for (let i = toks.length - 1; i >= 0; i--) {
      const tok = toks[i];
      if (Math.hypot(x - tok.x, y - tok.y) <= M.tokR(tok) * 1.05) return tok;
    }
    return null;
  };
  M.sendFx = (kind, d, force = false) => {
    const now = performance.now();
    if (!force && now - lastFx < 50) return;
    lastFx = now;
    if (M.map) MC.send({ t: "fx", map: M.map.id, kind, d });
  };
  function local(e) { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

  function bindInput() {
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const { sx, sy } = local(e);
      M.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });

    cv.addEventListener("pointerleave", () => { if (hov.id) { hov.target = 0; M.redraw(); } });
    cv.addEventListener("pointerdown", (e) => {
      if (!M.map) return;
      if (hov.id) hov.target = 0;
      try { cv.setPointerCapture(e.pointerId); } catch { /* указатель уже ушёл */ }
      const p = local(e);
      ptrs.set(e.pointerId, p);
      clearTimeout(pressTimer);
      if (ptrs.size === 2) {                              // щипок — отменяем всё остальное
        cancelAction();
        const [a, b] = [...ptrs.values()];
        gesture = { kind: "pinch", d: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 };
        return;
      }
      if (ptrs.size > 2) return;
      const w = M.toWorld(p.sx, p.sy);
      if (e.button === 1 || e.button === 2) { gesture = { kind: "pan", sx: p.sx, sy: p.sy, tx: view.tx, ty: view.ty, moved: true }; return; }
      const tool = M.tools[M.tool];
      if (tool && tool.down && tool.down(w, e) !== false) { gesture = { kind: "tool", sx: p.sx, sy: p.sy, moved: false }; return; }
      if (M.tool === "ruler") { const a = M.snap(w.x, w.y); ruler = { a, b: a }; gesture = { kind: "ruler" }; M.redraw(); return; }
      if (M.tool === "tmpl") { startTmpl(w); gesture = { kind: "tmpl" }; return; }
      const tok = M.hitToken(w.x, w.y);
      if (tok && M.canMove(tok)) {
        drag = { tok, x: tok.x, y: tok.y, ox: w.x - tok.x, oy: w.y - tok.y, moved: false, sx: p.sx, sy: p.sy };
        gesture = { kind: "drag" };
        if (e.pointerType !== "mouse") {                 // держим палец на фишке, не двигая, — меню быстрых действий
          const cx = e.clientX, cy = e.clientY;
          pressTimer = setTimeout(() => {
            if (gesture && gesture.kind === "drag" && drag && !drag.moved) { drag = null; gesture = { kind: "none" }; M.redraw(); openCtx(tok, cx, cy); try { navigator.vibrate?.(25); } catch { /* */ } }
          }, 520);
        }
      } else {
        gesture = { kind: "pan", sx: p.sx, sy: p.sy, tx: view.tx, ty: view.ty, moved: false, tok };
        const cx = e.clientX, cy = e.clientY, touch = e.pointerType !== "mouse";
        pressTimer = setTimeout(() => {                 // долгое нажатие — меню фишки (с пальца) или метка «смотрите сюда»
          if (gesture && gesture.kind === "pan" && !gesture.moved) {
            gesture.kind = "none";
            if (tok && touch) { openCtx(tok, cx, cy); try { navigator.vibrate?.(25); } catch { /* */ } } else ping(w.x, w.y);
          }
        }, 550);
      }
    });

    cv.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId)) { hover(e); return; }
      const p = local(e);
      ptrs.set(e.pointerId, p);
      if (!gesture) return;
      const w = M.toWorld(p.sx, p.sy);
      if (gesture.kind === "pinch" && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
        view.tx += cx - gesture.cx; view.ty += cy - gesture.cy;
        M.zoomAt(cx, cy, d / (gesture.d || d));
        gesture.d = d; gesture.cx = cx; gesture.cy = cy;
        return;
      }
      if (gesture.kind === "pan") {
        if (Math.hypot(p.sx - gesture.sx, p.sy - gesture.sy) > 5) gesture.moved = true;
        if (gesture.moved) { view.tx = gesture.tx + p.sx - gesture.sx; view.ty = gesture.ty + p.sy - gesture.sy; M.redraw(); }
        return;
      }
      if (gesture.kind === "tool") {
        if (Math.hypot(p.sx - gesture.sx, p.sy - gesture.sy) > 4) gesture.moved = true;
        M.tools[M.tool]?.move?.(w, e); M.redraw(); return;
      }
      if (gesture.kind === "ruler") {
        ruler.b = M.snap(w.x, w.y);
        M.sendFx("ruler", { a: ruler.a, b: ruler.b });
        M.redraw(); return;
      }
      if (gesture.kind === "tmpl") { moveTmpl(w); return; }
      if (gesture.kind === "drag") {
        if (Math.hypot(p.sx - drag.sx, p.sy - drag.sy) > 4) drag.moved = true;
        if (!drag.moved) return;
        drag.x = w.x - drag.ox; drag.y = w.y - drag.oy;
        M.sendFx("drag", { id: drag.tok.id, x: drag.x, y: drag.y });
        M.redraw();
      }
    });

    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      clearTimeout(pressTimer);
      if (!gesture) return;
      if (gesture.kind === "pinch") { if (ptrs.size === 0) gesture = null; return; }
      const p = local(e), w = M.toWorld(p.sx, p.sy);
      const g = gesture;
      gesture = null;
      if (g.kind === "pan" && !g.moved) { if (tapTarget(g.tok || null)) return; select(g.tok || null); if (g.tok) tapCheck(g.tok); }
      else if (g.kind === "tool") M.tools[M.tool]?.up?.(w, e, g.moved);
      else if (g.kind === "ruler") {
        M.sendFx("ruler", { a: ruler.a, b: ruler.b, done: true }, true);
        fx.rulers.set("me", { a: ruler.a, b: ruler.b, color: me()?.color || "#8b5cf6", ts: performance.now(), done: true });
        ruler = null; M.redraw();
      } else if (g.kind === "tmpl") endTmpl();
      else if (g.kind === "drag") endDrag();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); cancelAction(); gesture = null; });

    window.addEventListener("keydown", (e) => {
      if (!isOpen() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
      M.tools[M.tool]?.key?.(e);
      if (e.key === "Escape") { if (M.targeting) { stopTargeting(); return; } cancelAction(); M.setTool("pan"); select(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && MC.isGM() && M.sel && !M.tools[M.tool]?.key) delToken(M.sel);
    });
  }
  const isOpen = () => !!wrap && wrap.closest(".tab")?.classList.contains("active");
  function hover(e) {
    if (!M.map || e.pointerType !== "mouse") return;
    const p = local(e), w = M.toWorld(p.sx, p.sy);
    const tool = M.tools[M.tool];
    if (tool?.hover) tool.hover(w);
    const tok = M.hitToken(w.x, w.y);
    cv.style.cursor = tool?.cursor || (M.tool === "ruler" || M.tool === "tmpl" ? "crosshair" : tok && M.canMove(tok) ? "grab" : tok ? "pointer" : "default");
    setHover(tok, w);
  }
  function cancelAction() {
    if (drag) drag = null;
    ruler = null;
    tmplDraft = null;
    M.tools[M.tool]?.cancel?.();
    M.redraw();
  }

  function endDrag() {
    const d = drag;
    drag = null;
    if (!d.moved) { if (tapTarget(d.tok)) return; select(d.tok); tapCheck(d.tok); M.redraw(); return; }
    const s = M.snap(d.x, d.y, d.tok.s || 1);
    const tok = d.tok;
    M.sendFx("drag", { id: tok.id, x: s.x, y: s.y, done: true }, true);
    const ask = !MC.isGM() && (M.mode === "approve" || mustAsk(tok, s));
    if (ask) {
      tok.req = { x: s.x, y: s.y };
      MC.toast(t(M.mode === "approve" ? "map.move_asked" : "map.move_asked_limit"), "", "hourglass");
    } else { tok.x = s.x; tok.y = s.y; startMove(tok.id, d.x, d.y, s.x, s.y); }
    MC.send({ t: "tok_move", map: M.map.id, id: tok.id, x: s.x, y: s.y });
    // перетащили — сводку не открываем (на телефоне она закрывала бы карту); открытая — обновится
    if (M.sel === tok.id) renderPanel();
    M.redraw();
  }

  // двойной клик/тап по фишке — лист персонажа или статблок (на ПК — в отдельном окне)
  let lastTap = { id: null, t: 0 };
  function tapCheck(tok) {
    const now = performance.now();
    if (lastTap.id === tok.id && now - lastTap.t < 380) { lastTap = { id: null, t: 0 }; M.openTok(tok); return; }
    lastTap = { id: tok.id, t: now };
  }
  M.openTok = async (tok) => {
    const gm = MC.isGM();
    if (tok.char && (gm || M.mine(tok))) {
      if (MC.canPop()) MC.popOut("sheet", tok.char); else MC.emit("open_sheet", { id: tok.char });
      return;
    }
    if (tok.mon && gm) {
      if (MC.canPop()) { MC.popOut("mon", tok.mon); return; }
      try { MC.Statblock.show(await MC.Statblock.get(tok.mon)); } catch { MC.toast(t("err.not_found"), "warn"); }
      return;
    }
    if (gm) MC.emit("map_edit_token", tok);
  };

  /** Бой и лимит: не свой ход или дальше оставшейся скорости — ход уйдёт мастеру на подтверждение. */
  function mustAsk(tok, to) {
    const cb = MC.Combat?.state;
    if (!M.limit || !cb?.active || !cb.cur) return false;
    const e = cb.list.find((x) => (x.token && x.token === tok.id) || (tok.char && x.char === tok.char));
    if (!e) return false;
    if (e.id !== cb.cur) return true;
    return M.moveCost({ x: tok.x, y: tok.y }, to) > MC.int(e.speed, 30) - MC.int(e.econ?.mv, 0);
  }

  function ping(x, y) {
    const c = me()?.color || "#8b5cf6";
    fx.pings.push({ x, y, color: c, ts: performance.now() });
    M.sendFx("ping", { x, y }, true);
    if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* ignore */ }
    M.redraw();
  }
  M.ping = ping;

  // ---------------------------------------------------------------- шаблоны заклинаний
  let tmplDraft = null;
  function startTmpl(w) {
    const o = M.tmplKind === "circle" ? M.snapCorner(w.x, w.y) : M.snapCorner(w.x, w.y);
    tmplDraft = { kind: M.tmplKind, x: o.x, y: o.y, ang: 0, len: M.tmplLen, w: 5, color: M.tmplColor() };
    M.redraw();
  }
  function moveTmpl(w) {
    if (!tmplDraft) return;
    if (tmplDraft.kind === "circle") { const o = M.snapCorner(w.x, w.y); tmplDraft.x = o.x; tmplDraft.y = o.y; }
    else if (Math.hypot(w.x - tmplDraft.x, w.y - tmplDraft.y) > 4) tmplDraft.ang = Math.atan2(w.y - tmplDraft.y, w.x - tmplDraft.x);
    M.redraw();
  }
  function endTmpl() {
    if (!tmplDraft) return;
    const tm = tmplDraft;
    tmplDraft = null;
    MC.send({ t: "tmpl_add", map: M.map.id, tmpl: tm });
    M.redraw();
  }
  M.tools.tmpl = { draw: () => { if (tmplDraft) M.drawTemplate(tmplDraft, true); } };
  M.tools.tmpl.down = () => false;     // обработка встроенная (см. pointerdown)

  // ---------------------------------------------------------------- выбор фишки и панель
  function select(tok) {
    if ((tok ? tok.id : null) !== M.sel) condsOpen = false;
    M.sel = tok ? tok.id : null;
    // нажали на шаблон? (свой или мастер) — предложим убрать
    if (!tok && M.map && M.tool === "pan") {
      const p = lastTapWorld;
      const tm = p && [...(M.map.tmpls || [])].reverse().find((x) => inShape(M.tmplShape(x), p.x, p.y));
      if (tm && (MC.isGM() || tm.by === me()?.id)) { tmplMenu(tm); }
    }
    renderPanel();
    M.redraw();
  }
  let lastTapWorld = null;
  document.addEventListener("pointerdown", (e) => { if (cv && e.target === cv) { const p = local(e); lastTapWorld = M.toWorld(p.sx, p.sy); } }, true);
  M.select = (id) => { M.sel = id; renderPanel(); M.redraw(); };

  async function tmplMenu(tm) {
    const inside = tokensIn(tm);
    const v = await MC.modal({ title: t("map.tmpl." + tm.kind), body: `<p class="muted">${tm.len} ${t("map.ft")} · ${t("act.in_area", { n: inside.length })}</p>`,
      buttons: [{ label: t("close"), value: null }, { label: t("map.tmpl.remove"), kind: "danger", value: "del" },
        ...(inside.length ? [{ label: t("act.aoe_save"), kind: "primary", value: "save" }] : [])] });
    if (v === "del") MC.send({ t: "tmpl_del", map: M.map.id, id: tm.id });
    if (v === "save") MC.Combat.actionDialog(mySource(), mapTargets(), { kind: "save", tgt: inside.map((x) => "t:" + x.id) });
  }
  /** Фишки, задетые шаблоном: центр внутри фигуры или край фишки внутри круга. */
  function tokensIn(tm) {
    const sh = M.tmplShape(tm);
    return (M.map?.tokens || []).filter((x) => {
      if (inShape(sh, x.x, x.y)) return true;
      const r = M.tokR(x) * 0.7;
      return sh.circle ? Math.hypot(x.x - sh.circle.x, x.y - sh.circle.y) <= sh.circle.r + r
        : [[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => inShape(sh, x.x + dx, x.y + dy));
    });
  }
  /** Цели на карте для окна действия. */
  function mapTargets() {
    return (M.map?.tokens || []).map((x) => {
      const hp = M.tokHp(x);
      return { key: "t:" + x.id, spec: { map: M.map.id, token: x.id }, name: M.tokName(x), color: M.tokColor(x), pic: M.tokPic(x),
        sub: hp && hp.max ? `${hp.cur}/${hp.max}` : "" };
    });
  }
  M.mapTargets = mapTargets;
  const tokSrc = (tok) => ({ spec: { map: M.map.id, token: tok.id }, info: { char: tok.char || "", mon: tok.mon || "", name: M.tokName(tok) } });
  /** Кто кастует область: чей сейчас ход (если свой), иначе своя фишка, у мастера — «Мастер». */
  function mySource() {
    const cb = MC.Combat?.state;
    const cur = cb?.active && cb.list.find((x) => x.id === cb.cur);
    if (cur && (MC.isGM() ? cur.kind === "npc" : cur.kind === "pc" && cur.owner === me()?.id)) return MC.Combat.entrySrc(cur);
    if (MC.isGM()) return { spec: null, info: { name: t("ds.gm_name") } };
    const mine = (M.map?.tokens || []).find((x) => M.mine(x));
    if (mine) return tokSrc(mine);
    return { spec: null, info: { name: t("ds.gm_name") } };
  }

  // ---------------------------------------------------------------- атака с карты: своя фишка → цель → короткое меню
  M.targeting = null;
  function startTargeting(tok) {
    M.targeting = { tok };
    let el = $("#map-hint");
    if (!el) { el = document.createElement("div"); el.id = "map-hint"; el.className = "map-hint glass"; $("#map-stage").appendChild(el); }
    el.innerHTML = `${MC.icon("target", "sm")} <span>${t("act.pick_target", { name: esc(M.tokName(tok)) })}</span><button class="icon-btn small" data-mp-cancel>${MC.icon("x", "sm")}</button>`;
    el.hidden = false;
    cv.style.cursor = "crosshair";
    M.redraw();
  }
  function stopTargeting() {
    M.targeting = null;
    const el = $("#map-hint"); if (el) el.hidden = true;
    closeActMenu();
    M.redraw();
  }
  M.stopTargeting = stopTargeting;
  /** Нажали на фишку в режиме выбора цели. true — нажатие обработано. */
  function tapTarget(tok) {
    if (!M.targeting) return false;
    if (!tok || tok.id === M.targeting.tok.id) { stopTargeting(); return true; }
    openActMenu(M.targeting.tok, tok);
    return true;
  }
  function closeActMenu() { $("#act-menu")?.remove(); }
  async function openActMenu(srcTok, tgtTok) {
    closeActMenu();
    const src = tokSrc(srcTok);
    const acts = (await MC.Actions.list(src.info)).filter((a) => ["attack", "save", "heal"].includes(a.kind)).slice(0, 8);
    const p = M.toScreen(tgtTok.x, tgtTok.y);
    const el = document.createElement("div");
    el.id = "act-menu";
    el.className = "act-menu glass";
    el.innerHTML = `<div class="am-h">${MC.icon("swords", "sm")} <b>${esc(M.tokName(srcTok))}</b> → <b>${esc(M.tokName(tgtTok))}</b> <span class="muted small">${M.gapFt(srcTok, tgtTok)} ${t("st.ft")}</span></div>
      ${acts.map((a, i) => `<button class="am-row ${a.rng === "melee" && M.gapFt(srcTok, tgtTok) > (a.reach || 5) ? "far" : ""}" data-am="${i}"><span class="act-ic k-${a.kind}">${MC.icon(a.icon || "sword", "sm")}</span><span class="am-n">${esc(a.name)}</span><small>${esc(MC.Actions.label(a))}</small></button>`).join("")
        || `<p class="muted small">${t("act.none")}</p>`}
      <div class="am-foot"><button class="btn small" data-am="more">${MC.icon("more", "sm")} ${t("act.more")}</button><button class="btn small" data-am="x">${MC.icon("x", "sm")}</button></div>`;
    $("#map-stage").appendChild(el);
    const W0 = wrap.clientWidth, H0 = wrap.clientHeight;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = MC.clamp(p.x + 24, 8, W0 - w - 8) + "px";
    el.style.top = MC.clamp(p.y - h / 2, 8, H0 - h - 8) + "px";
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-am]");
      if (!b) return;
      const k = b.dataset.am;
      if (k === "x") { stopTargeting(); return; }
      if (k === "more") { stopTargeting(); MC.Combat.actionDialog(src, mapTargets(), { tgt: ["t:" + tgtTok.id] }); return; }
      const a = acts[+k];
      stopTargeting();
      const tg = { map: M.map.id, token: tgtTok.id };
      const common = { src: src.spec, hidden: MC.isGM() && MC.Dice.hidden, cost: a.cost || "a", conc: a.conc ? a.name : "" };
      const req = (o) => MC.request(o, 15000).catch((er) => MC.toast(t(er.code ? "err." + er.code : "conn.offline"), "warn"));
      if (a.kind === "attack") MC.Combat.sendAttack({ t: "cb_attack", ...common, tgt: tg, atk: { name: a.name, bonus: a.bonus, dmg: a.dmg, dtype: a.dtype, rng: a.rng || "", reach: a.reach || 5 } });
      if (a.kind === "save") req({ t: "cb_save", ...common, tgts: [tg], ab: a.ab, dc: a.dc, dmg: a.dmg, half: a.half, label: a.name, dtype: a.dtype || "" });
      if (a.kind === "heal") req({ t: "cb_heal", ...common, tgt: tg, amount: a.amount, label: a.name });
    });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-mp-cancel]")) stopTargeting(); });

  const COND_LIST = M.COND_LIST = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
    "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "flying", "dodge", "disengage", "dash", "hiding", "cover_half", "cover_3q", "cover_full", "ready", "surprised"];
  const EXTRA = ["concentration", "bloodied", "dead"];
  const condName = (cd) => (MC.R.srd?.cond?.[cd] ? MC.L(MC.R.srd.cond[cd]) : t("map.c." + cd));

  // ---------------------------------------------------------------- сводка по фишке (справа)
  const askedDocs = new Set();
  let condsOpen = false;
  const R = () => MC.R;
  const sgn = (n) => MC.sign(n);
  const roll1 = (mod) => "1d20" + (mod >= 0 ? "+" : "-") + Math.abs(mod);
  function hpBlock(hp, ctl) {
    if (!hp || !(hp.max > 0)) return "";
    const k = MC.clamp(hp.cur / hp.max, 0, 1), tk = hp.temp > 0 ? MC.clamp(hp.temp / hp.max, 0, 1) : 0;
    return `<div class="mp-hp2"><span class="mp-hp-ic">${MC.icon("heart", "sm")}</span>
      <div class="mp-bar"><i class="${k < 0.3 ? "low" : k < 0.6 ? "mid" : ""}" style="width:${k * 100}%"></i>${tk ? `<u style="width:${tk * 100}%"></u>` : ""}</div>
      <b class="mp-hp-n">${hp.cur}<small>/${hp.max}</small>${hp.temp > 0 ? `<em>+${hp.temp}</em>` : ""}</b>
      ${ctl ? `<span class="mp-hp-ctl"><button class="icon-btn small bad" data-mp="${ctl}dmg" title="${esc(t("hp.damage"))}">${MC.icon("minus", "sm")}</button>
        <button class="icon-btn small okc" data-mp="${ctl}heal" title="${esc(t("hp.heal"))}">${MC.icon("plus", "sm")}</button>
        ${ctl === "c" ? `<button class="icon-btn small" data-mp="ctemp" title="${esc(t("hp.set_temp"))}">${MC.icon("shield-half", "sm")}</button>` : ""}</span>` : ""}</div>`;
  }
  const stat = (icon, label, value, roll = "") => `<div class="mp-stat" title="${esc(label)}">${roll || ""}<span class="mp-st-ic">${MC.icon(icon, "sm")}</span><b>${value}</b><small>${esc(label)}</small></div>`;
  function abilTiles(get, name, charId, canRoll) {
    return `<div class="mp-abil">${R().ABILS.map((a) => {
      const sc = get(a), md = R().mod(sc);
      const inner = `<span>${esc(R().abName(a, true))}</span><b>${sgn(md)}</b><small>${sc}</small>`;
      return canRoll ? `<button type="button" class="mp-ab roll-chip plain" data-roll="${roll1(md)}" data-label="${esc(name)}: ${esc(R().abName(a))}" data-kind="check" ${charId ? `data-char="${esc(charId)}"` : ""}>${inner}</button>`
        : `<div class="mp-ab">${inner}</div>`;
    }).join("")}</div>`;
  }

  function renderPanel() {
    const box = $("#map-panel");
    if (!box) return;
    const tok = M.map?.tokens?.find((x) => x.id === M.sel);
    if (!tok) { box.hidden = true; box.innerHTML = ""; dockLayout(); return; }
    const gm = MC.isGM(), mine = M.mine(tok), c = charOf(tok);
    const doc = c ? MC.state.docs.get(c.id) : null;
    if (c && !doc && gm && !askedDocs.has(c.id)) { askedDocs.add(c.id); MC.send({ t: "char_get", id: c.id }); }
    const mon = tok.mon && gm ? MC.Statblock?.peek(tok.mon) : null;
    if (tok.mon && gm && !mon) MC.Statblock?.get(tok.mon).then(() => { if (M.sel === tok.id) renderPanel(); }).catch(() => {});
    const hp = M.tokHp(tok);
    const conds = M.tokConds(tok);
    const canCond = gm || mine;
    const list = c ? COND_LIST : [...COND_LIST, ...EXTRA];
    const col = M.tokColor(tok);
    const pic = c?.portrait || (tok.img ? M.assetUrl(tok.img) : "");
    let sub = "";
    if (c) sub = [c.race?.name || (MC.R.srd && c.race?.id ? MC.R.raceName({ race: c.race }) : ""), (c.classes || []).map((k) => `${MC.R.srd ? MC.R.className(k) : k.name || k.id} ${k.level}`).join(" / ")].filter(Boolean).join(" · ");
    else if (mon) sub = [mon.type, `${t("sb.cr_short")} ${mon.cr}`].filter(Boolean).join(" · ");
    const owner = c ? MC.state.players.find((p) => p.id === c.owner) : null;
    const canSheet = c && (gm || mine);
    const pop = MC.canPop();
    let body = "";
    if (doc) {
      const ab = (a) => R().score(doc, a);
      const caster = R().casterClasses(doc).length > 0;
      const init = R().initiative(doc);
      body += `<div class="mp-stats">
        ${stat("main", t("st.ac"), R().ac(doc))}
        ${stat("init", t("st.init"), sgn(init), canCond ? `<button type="button" class="mp-st-roll roll-chip plain" data-roll="${roll1(init)}" data-label="${esc(t("st.init"))}" data-kind="init" data-char="${esc(c.id)}"></button>` : "")}
        ${stat("speed", t("st.speed"), `${MC.int(doc.speed, 30)}<i>${t("st.ft")}</i>`)}
        ${stat("eye", t("mp.passive_s"), R().passive(doc, "perception"))}
        ${stat("star", t("mp.prof_s"), sgn(R().prof(doc)))}
        ${caster ? stat("spells", t("mp.dc"), R().spellDC(doc)) : stat("level-up", t("mp.level"), R().level(doc))}
      </div>${abilTiles(ab, doc.name || c.name, c.id, canCond)}`;
      if (hp && hp.max > 0 && hp.cur <= 0) {
        const ds = doc.death || {};
        body += `<div class="mp-death">${MC.icon("skull", "sm")} ${t("hp.death")}
          <span class="mp-ds ok">${[0, 1, 2].map((i) => `<i class="${i < ds.ok ? "on" : ""}"></i>`).join("")}</span>
          <span class="mp-ds bad">${[0, 1, 2].map((i) => `<i class="${i < ds.fail ? "on" : ""}"></i>`).join("")}</span></div>`;
      }
    } else if (mon) {
      body += `<div class="mp-stats four">
        ${stat("main", t("st.ac"), mon.ac)}
        ${stat("init", t("mp.init_s"), sgn(R().mod(mon.abil?.dex)), `<button type="button" class="mp-st-roll roll-chip plain" data-roll="${roll1(R().mod(mon.abil?.dex))}" data-label="${esc(tok.name)}: ${esc(t("st.init"))}" data-kind="check"></button>`)}
        ${stat("crit", t("sb.cr_short"), esc(mon.cr))}
        ${stat("star", t("mp.pb_s"), "+" + (mon.pb || 2))}
      </div>
      ${mon.speed ? `<div class="mp-line">${MC.icon("speed", "sm")} ${esc(mon.speed)}</div>` : ""}
      ${abilTiles((a) => MC.int(mon.abil?.[a], 10), tok.name, "", true)}
      ${[["actions", "sb.actions"], ["bonus", "sb.bonus"], ["reactions", "sb.reactions"], ["legendary", "sb.legendary"]].filter(([k]) => mon[k]?.length).map(([k, l]) =>
        `<details class="mp-acts" data-acts="${k}" ${MC.store.get("mp_acts_" + k) === "1" ? "open" : ""}><summary>${t(l)} · ${mon[k].length}</summary>
          <div class="statblock">${mon[k].map((x) => `<p class="sb-p">${x.name ? `<b class="sb-n">${esc(x.name)}.</b> ` : ""}${MC.Statblock.rollify(x.text, `${tok.name}: ${x.name || t(l)}`)}</p>`).join("")}</div></details>`).join("")}`;
    } else if (c && !doc && !gm) {
      body += `<p class="muted small mp-note">${t("mp.other_pc", { name: esc(owner?.name || "?") })}</p>`;
    }
    box.hidden = false;
    box.innerHTML = `<div class="mp-top">
        <div class="mp-av" style="--c:${esc(col)}">${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ""}<span>${esc((M.tokName(tok).trim().charAt(0) || "?").toUpperCase())}</span></div>
        <div class="mp-title"><b>${esc(M.tokName(tok))}</b><span class="muted small">${esc(sub || (owner ? owner.name : tok.mon ? "" : t("mp.token")))}</span>
          ${tok.hidden ? `<span class="tag">${MC.icon("hidden", "sm")} ${t("map.hidden")}</span>` : ""}</div>
        <div class="mp-acts-top">
          ${canSheet ? `<button class="icon-btn small" data-mp="sheet" title="${esc(t(pop ? "mp.sheet_win" : "map.open_sheet"))}">${MC.icon(pop ? "external" : "character", "sm")}</button>` : ""}
          ${gm && tok.mon ? `<button class="icon-btn small" data-mp="sb" title="${esc(t(pop ? "mp.sb_win" : "cb.statblock"))}">${MC.icon(pop ? "external" : "book", "sm")}</button>` : ""}
          ${gm ? `<button class="icon-btn small" data-mp="edit" title="${esc(t("edit"))}">${MC.icon("edit", "sm")}</button>` : ""}
          <button class="icon-btn small" data-mp="close">${MC.icon("x", "sm")}</button></div></div>
      ${tok.req && (gm || mine) ? `<div class="mp-req">${MC.icon("hourglass", "sm")} ${t("map.move_wait")}
        ${gm ? `<button class="btn small ok" data-mp="req-ok">${MC.icon("check", "sm")}</button><button class="btn small" data-mp="req-no">${MC.icon("x", "sm")}</button>` : ""}</div>` : ""}
      ${hpBlock(hp, c ? (gm || mine ? "c" : "") : (gm ? "t" : ""))}
      ${(gm || mine) && !(tok.mon && hp && hp.max && hp.cur <= 0) ? `<div class="mp-actrow"><button class="btn small primary" data-mp="act">${MC.icon("swords", "sm")} ${t("act.attack_btn")}</button>
        ${canSheet || (gm && tok.mon) ? `<button class="btn small" data-mp="actfull">${MC.icon("more", "sm")} ${t("act.all")}</button>` : ""}</div>` : ""}
      ${body}
      <div class="mp-conds">${list.map((cd) => {
        const on = conds.includes(cd);
        if ((!canCond || !condsOpen) && !on) return "";
        return `<button class="cond-chip ${on ? "on" : ""}" ${canCond ? `data-cond="${cd}"` : "disabled"} title="${esc(condName(cd))}" style="--cc:${M.COND_COLOR[cd]}">
          ${MC.icon(cd === "bloodied" ? "droplet" : cd === "dead" ? "skull" : "c-" + cd, "sm")}<span>${esc(condName(cd))}</span></button>`;
      }).join("")}${canCond ? `<button class="cond-chip more" data-mp="conds">${MC.icon(condsOpen ? "minus" : "plus", "sm")}<span>${t(condsOpen ? "mp.conds_less" : conds.length ? "mp.conds_more" : "mp.conds_add")}</span></button>` : ""}</div>
      ${gm && !(c && c.owner && MC.state.players.some((p) => p.id === c.owner)) ? `<button class="btn small hpv ${(c ? c.show_hp : tok.show_hp) ? "on" : ""}" data-mp="showhp">
        ${MC.icon((c ? c.show_hp : tok.show_hp) ? "eye" : "hidden", "sm")} ${t((c ? c.show_hp : tok.show_hp) ? "hpv.shown" : "hpv.hidden")}</button>` : ""}
      ${gm ? `<div class="mp-gm">
        <button class="btn small" data-mp="center">${MC.icon("locate", "sm")}</button>
        <button class="btn small" data-mp="hide">${MC.icon(tok.hidden ? "eye" : "hidden", "sm")} ${t(tok.hidden ? "map.show_tok" : "map.hide_tok")}</button>
        <button class="btn small danger" data-mp="del">${MC.icon("trash", "sm")}</button></div>` : ""}
      ${canSheet || (gm && tok.mon) ? `<div class="mp-hint muted small">${t(matchMedia("(pointer: coarse)").matches ? "mp.dbl_hint_touch" : "mp.dbl_hint")}</div>` : ""}`;
    dockLayout();
  }
  M.renderPanel = renderPanel;
  /** Мастер открывает/прячет хиты НИП или противника для игроков: у персонажа-НИП — в листе, у фишки — на фишке. */
  MC.setShowHp = (ref, on) => {
    if (ref.char) {
      const c = MC.state.chars.get(ref.char);
      if (c) c.show_hp = on;
      const op = [{ op: "set", path: ["show_hp"], value: on }];
      if (MC.state.docs.has(ref.char)) MC.patch(ref.char, op);
      else MC.send({ t: "char_patch", id: ref.char, ops: op, rid: MC.uid() });
    } else if (ref.map && ref.token) {
      MC.send({ t: "tok_set", map: ref.map, id: ref.token, fields: { show_hp: on } });
    }
    MC.toast(t(on ? "hpv.toast_on" : "hpv.toast_off"), "", on ? "eye" : "hidden");
    renderPanel();
  };
  M.hoverState = () => ({ ...hov });

  // ---------------------------------------------------------------- меню фишки по правой кнопке мыши
  function closeCtx() { $("#tok-ctx")?.remove(); }
  function openCtx(tok, cx, cy) {
    closeCtx();
    const gmv = MC.isGM(), mine = M.mine(tok), c = charOf(tok);
    const it = (attr, icon, label, cls = "") => `<button class="ctx-it ${cls}" ${attr}>${MC.icon(icon, "sm")}<span>${esc(label)}</span></button>`;
    const sep = '<i class="ctx-sep"></i>';
    const rows = [];
    const inCombat = MC.Combat?.state?.active;
    if (gmv || mine) {
      rows.push(it('data-mp="act"', "target", t("ctx.attack")), it('data-mp="actfull"', "swords", t("ctx.action")));
    } else if (myTok()) {
      rows.push(it('data-ctx="hitme"', "target", t("ctx.attack_this")));
    }
    if (rows.length) rows.push(sep);
    rows.push(it('data-ctx="sel"', "info", t("ctx.summary")));
    if (c && (gmv || mine)) rows.push(it('data-mp="sheet"', "character", t("ctx.sheet")));
    if (!c && tok.mon && gmv) rows.push(it('data-mp="sb"', "book", t("cb.statblock")));
    if (gmv || mine) rows.push(it('data-ctx="conds"', "c-poisoned", t("ctx.conds")));
    rows.push(it('data-mp="center"', "locate", t("ctx.center")));
    if (gmv) {
      rows.push(sep);
      rows.push(it(`data-mp="${c ? "cdmg" : "tdmg"}"`, "minus", t("hp.damage")), it(`data-mp="${c ? "cheal" : "theal"}"`, "plus", t("hp.heal")));
      rows.push(it('data-mp="hide"', tok.hidden ? "eye" : "hidden", t(tok.hidden ? "ctx.show" : "ctx.hide")));
      if (!(c && MC.state.players.some((p) => p.id === c.owner))) rows.push(it('data-mp="showhp"', "heart", t("ctx.showhp")));
      rows.push(it('data-mp="edit"', "edit", t("ctx.edit")), it('data-mp="del"', "trash", t("ctx.del"), "bad"));
    }
    if (tok.req && gmv) rows.unshift(it('data-mp="req-ok"', "check", t("ctx.req_ok")), it('data-mp="req-no"', "x", t("ctx.req_no")), sep);
    if ((gmv || mine) && (c || tok.mon) && MC.Actions) {
      // быстрые действия из листа / статблока: атаки и заклинания одним нажатием
      const host = '<div class="ctx-quick" id="ctx-quick"><span class="muted small">…</span></div>';
      rows.unshift(host, sep);
      MC.Actions.list(tokSrc(tok).info).then((list) => {
        const q = $("#ctx-quick");
        if (!q) return;
        const pick = list.filter((a) => ["atk", "spell", "mon"].includes(a.group || "")).slice(0, 10);
        q.innerHTML = pick.length ? `<div class="ctx-qh">${t("ctx.quick")}</div>` + pick.map((a) => `<button class="ctx-it" data-qa="${esc(a.id)}">${MC.icon(a.icon || "sword", "sm")}<span>${esc(a.name)}</span><small class="muted">${esc(MC.Actions.label(a))}</small></button>`).join("") : "";
        const box = $("#tok-ctx");
        if (box) { box.style.top = MC.clamp(parseFloat(box.style.top), 6, window.innerHeight - box.offsetHeight - 6) + "px"; }
      }).catch(() => { $("#ctx-quick")?.remove(); });
    }
    const el = document.createElement("div");
    el.id = "tok-ctx";
    el.className = "tok-ctx glass";
    el.dataset.tok = tok.id;
    el.innerHTML = `<div class="ctx-h"><i style="background:${esc(M.tokColor(tok))}"></i>${esc(M.tokName(tok))}${inCombat ? "" : ""}</div>${rows.join("")}`;
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = MC.clamp(cx, 6, window.innerWidth - w - 6) + "px";
    el.style.top = MC.clamp(cy, 6, window.innerHeight - h - 6) + "px";
  }
  /** Своя фишка для атаки: того, чей сейчас ход, иначе первая своя. */
  function myTok() {
    const own = (M.map?.tokens || []).filter((x) => M.mine(x));
    const cb = MC.Combat?.state;
    const cur = cb?.active ? cb.list.find((e) => e.id === cb.cur) : null;
    return (cur && own.find((x) => x.id === cur.token || (x.char && x.char === cur.char))) || own[0] || null;
  }
  let rDown = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.button === 2 && e.target.closest?.(".map-canvas")) rDown = { x: e.clientX, y: e.clientY };
    if (!e.target.closest?.("#tok-ctx")) closeCtx();
  }, true);
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest?.(".map-canvas") || !M.map) return;
    e.preventDefault();
    if (!rDown || Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 6) return;      // тащили правой — это была прокрутка
    const p = local(e), w = M.toWorld(p.sx, p.sy);
    const tok = M.hitToken(w.x, w.y);
    if (tok) openCtx(tok, e.clientX, e.clientY);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCtx(); });
  document.addEventListener("click", (e) => {
    const q = e.target.closest("#tok-ctx [data-qa]");
    if (q) {
      const tok = M.map?.tokens?.find((x) => x.id === q.closest("#tok-ctx").dataset.tok);
      closeCtx();
      if (tok) MC.Combat.actionDialog(tokSrc(tok), mapTargets(), { act: q.dataset.qa });
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#tok-ctx [data-ctx]");
    if (!b) return;
    const tok = M.map?.tokens?.find((x) => x.id === b.closest("#tok-ctx").dataset.tok);
    closeCtx();
    if (!tok) return;
    const k = b.dataset.ctx;
    if (k === "sel" || k === "conds") { if (k === "conds") condsOpen = true; M.select(tok.id); }
    if (k === "hitme") { const me = myTok(); if (me) { startTargeting(me); openActMenu(me, tok); } }
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mp], [data-cond]");
    if (!b || !(b.closest("#map-panel") || b.closest("#tok-ctx"))) return;
    const ctxEl = b.closest("#tok-ctx");
    const tok = M.map?.tokens?.find((x) => x.id === (ctxEl ? ctxEl.dataset.tok : M.sel));
    if (ctxEl) closeCtx();
    if (!tok) return;
    const send = (fields) => MC.send({ t: "tok_set", map: M.map.id, id: tok.id, fields });
    if (b.dataset.cond) {
      const cd = b.dataset.cond, c = charOf(tok);
      if (c && COND_LIST.includes(cd)) {
        const cur = c.conditions || [];
        const next = cur.includes(cd) ? cur.filter((x) => x !== cd) : [...cur, cd];
        c.conditions = next;      // сразу у себя; сервер разошлёт сводку всем
        if (MC.state.docs.has(c.id)) MC.set(c.id, ["conditions"], next);
        else MC.send({ t: "char_patch", id: c.id, ops: [{ op: "set", path: ["conditions"], value: next }], rid: MC.uid() });
      } else {
        const cur = tok.conds || [];
        tok.conds = cur.includes(cd) ? cur.filter((x) => x !== cd) : [...cur, cd];
        send({ conds: tok.conds });
      }
      renderPanel(); M.redraw();
      return;
    }
    const a = b.dataset.mp;
    if (a === "close") select(null);
    if (a === "conds") { condsOpen = !condsOpen; renderPanel(); return; }
    if (a === "showhp") { const c = charOf(tok); MC.setShowHp({ char: tok.char, map: M.map.id, token: tok.id }, !(c ? c.show_hp : tok.show_hp)); return; }
    if (a === "act") { startTargeting(tok); return; }
    if (a === "actfull") { MC.Combat.actionDialog(tokSrc(tok), mapTargets(), {}); return; }
    if (a === "sheet" || a === "sb") M.openTok(tok);
    if (a === "center") M.centerOn(tok.x, tok.y);
    if (a === "edit") MC.emit("map_edit_token", tok);
    if (a === "cdmg" || a === "cheal" || a === "ctemp") charHp(charOf(tok), a.slice(1));
    if (a === "hide") send({ hidden: !tok.hidden });
    if (a === "del") delToken(tok.id);
    if (a === "req-ok" || a === "req-no") MC.send({ t: "tok_req", map: M.map.id, id: tok.id, ok: a === "req-ok" });
    if (a === "tdmg" || a === "theal") {
      const n = await MC.askNumber(t(a === "tdmg" ? "hp.damage" : "hp.heal"));
      if (!n) return;
      const hp = tok.hp || { cur: 0, max: 0 };
      const cur = MC.clamp(hp.cur + (a === "tdmg" ? -n : n), 0, hp.max);
      const conds = (tok.conds || []).filter((x) => x !== "dead" && x !== "bloodied");
      if (cur <= 0) conds.push("dead"); else if (cur <= hp.max / 2) conds.push("bloodied");
      send({ hp: { cur, max: hp.max }, conds });
    }
  });

  /** Урон / лечение / временные хиты персонажа прямо с карты (врем. хиты принимают урон первыми). */
  async function charHp(c, kind) {
    if (!c) return;
    const n = await MC.askNumber(t(kind === "dmg" ? "hp.damage" : kind === "heal" ? "hp.heal" : "hp.set_temp"));
    if (n == null || n < 0 || (!n && kind !== "temp")) return;
    const doc = MC.state.docs.get(c.id);
    const hp = { cur: 0, max: 0, temp: 0, ...(doc?.hp || c.hp || {}) };
    let cur = MC.int(hp.cur), tmp = MC.int(hp.temp);
    const mx = MC.int(hp.max);
    if (kind === "dmg") { const take = Math.min(tmp, n); tmp -= take; cur -= n - take; }
    if (kind === "heal") cur += n;
    if (kind === "temp") tmp = n;
    cur = mx ? MC.clamp(cur, 0, mx) : Math.max(0, cur);
    const ops = [{ op: "set", path: ["hp", "cur"], value: cur }, { op: "set", path: ["hp", "temp"], value: tmp }];
    if (doc) MC.patch(c.id, ops);
    else MC.send({ t: "char_patch", id: c.id, ops, rid: MC.uid() });
    c.hp = { ...c.hp, cur, temp: tmp };
    renderPanel(); M.redraw();
  }

  async function delToken(id) {
    const tok = M.map?.tokens?.find((x) => x.id === id);
    if (!tok || !await MC.confirm(t("confirm.delete", { name: M.tokName(tok) }))) return;
    MC.send({ t: "tok_del", map: M.map.id, id });
    if (M.sel === id) select(null);
  }

  // ---------------------------------------------------------------- окошки справа: бой и журнал бросков
  const wide = () => window.innerWidth >= 900;
  M.dockShows = (k) => (k === "combat" ? M.dock.combat && (MC.Combat?.state.active || MC.isGM()) : k === "log" ? M.dock.log : false);
  function dockInset() { return wide() && (M.dockShows("combat") || M.dockShows("log")) ? ($("#map-dock")?.offsetWidth || 330) + 10 : 0; }
  function dockHead(kind, icon, title) {
    return `<header class="dock-h">${MC.icon(icon, "sm")}<b>${esc(title)}</b><span class="sp"></span>
      ${MC.canPop() ? `<button class="icon-btn small" data-dpop="${kind}" title="${esc(t("mp.pop"))}">${MC.icon("external", "sm")}</button>` : ""}
      <button class="icon-btn small" data-dclose="${kind}" title="${esc(t("close"))}">${MC.icon("x", "sm")}</button></header>`;
  }
  function renderDock(force = false) {
    const cb = $("#dock-combat"), lg = $("#dock-log");
    if (!cb || !lg) return;
    const showCb = M.dockShows("combat"), showLg = M.dockShows("log");
    if (!showCb || force) cb.innerHTML = "";
    if (!showLg || force) lg.innerHTML = "";
    if (showCb && !cb.innerHTML) { cb.innerHTML = dockHead("combat", "attacks", t("tab.combat")) + `<div class="dock-body"><div class="combat-host"></div></div>`; MC.Combat?.render(); }
    if (showLg && !lg.innerHTML) { lg.innerHTML = dockHead("log", "history", t("dice.log")) + `<div class="dock-body dice-log-host"></div>`; MC.Dice?.renderLog(); }
    cb.hidden = !showCb; lg.hidden = !showLg;
    MC.Combat?.renderStrip?.();
    dockLayout();
  }
  function dockLayout() {
    const d = $("#map-dock");
    if (!d) return;
    const any = [...d.children].some((x) => !x.hidden);
    d.classList.toggle("empty", !any);
    d.classList.toggle("with-panel", !$("#map-panel").hidden);
    document.body.classList.toggle("dock-on", any);
  }
  M.renderDock = renderDock;

  // ---------------------------------------------------------------- окошки можно растягивать (на ПК)
  // ширина — за край (ручка), высота каждого окошка — за нижний правый угол; размеры запоминаются
  // ручка — отдельный элемент рядом с окошком (внутри панели с прокруткой она бы уезжала)
  function widthGrip(el, side, key, min, max) {
    if (!el || el.dataset.grip) return;
    el.dataset.grip = "1";
    const g = document.createElement("div");
    g.className = "w-grip " + side;
    g.title = t("ui.resize");
    el.parentElement.appendChild(g);
    const place = () => {
      const vis = !el.hidden && el.offsetWidth > 0 && !el.classList.contains("empty");
      g.hidden = !vis;
      if (!vis) return;
      g.style.top = el.offsetTop + "px";
      g.style.height = el.offsetHeight + "px";
      g.style.left = (side === "left" ? el.offsetLeft - 5 : el.offsetLeft + el.offsetWidth - 5) + "px";
    };
    new ResizeObserver(place).observe(el);
    new MutationObserver(place).observe(el, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    window.addEventListener("resize", place);
    setTimeout(place, 0);
    const saved = MC.int(MC.store.get(key), 0);
    if (saved) el.style.width = MC.clamp(saved, min, max) + "px";
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = el.getBoundingClientRect().width;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        el.style.width = MC.clamp(w0 + (side === "left" ? -dx : dx), min, Math.min(max, window.innerWidth - 140)) + "px";
      };
      const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); MC.store.set(key, Math.round(el.getBoundingClientRect().width)); };
      g.addEventListener("pointermove", mv);
      g.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", () => { el.style.width = ""; MC.store.del(key); });
  }
  function heightMemory(card) {
    if (!card || card.dataset.hm) return;
    card.dataset.hm = "1";
    const key = "dock_h_" + card.id;
    const saved = MC.int(MC.store.get(key), 0);
    if (saved) { card.style.height = saved + "px"; card.style.flex = "0 0 auto"; }
    let down = false;
    card.addEventListener("pointerdown", (e) => {
      const r = card.getBoundingClientRect();
      down = e.clientX > r.right - 22 && e.clientY > r.bottom - 22;        // угол с ручкой
    });
    window.addEventListener("pointerup", () => {
      if (!down) return;
      down = false;
      if (card.style.height) { card.style.flex = "0 0 auto"; MC.store.set(key, Math.round(card.getBoundingClientRect().height)); }
    });
    card.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".dock-h")) return;
      card.style.height = ""; card.style.flex = ""; MC.store.del(key);
    });
  }
  function setupResize() {
    if (!wide()) return;
    widthGrip($("#map-dock"), "left", "dock_w", 260, 720);
    widthGrip($("#map-gm"), "right", "gm_w", 260, 620);
    ["map-panel", "dock-combat", "dock-log"].forEach((id) => heightMemory($("#" + id)));
  }
  MC.on("welcome", () => setTimeout(setupResize, 0));
  MC.on("tab", (tab) => { if (tab === "map") setTimeout(setupResize, 0); });
  M.setDock = (k, on) => setDock(k, on);
  function setDock(k, on) {
    M.dock[k] = on;
    MC.store.set("dock_" + k, on ? "1" : "0");
    renderDock(); renderToolbar();
  }
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-dpop]");
    if (p) { if (MC.popOut(p.dataset.dpop)) setDock(p.dataset.dpop, false); return; }
    const c = e.target.closest("[data-dclose]");
    if (c) { setDock(c.dataset.dclose, false); return; }
    const d = e.target.closest("[data-mdock]");
    if (d) { setDock(d.dataset.mdock, !M.dock[d.dataset.mdock]); return; }
    const f = e.target.closest("[data-mfx]");
    if (f && f.tagName === "INPUT") {
      M.fx[f.dataset.mfx] = f.checked;
      MC.store.set("mfx_" + f.dataset.mfx, f.checked ? "1" : "0");
      if (!M.fx.move) moves.clear();
      if (!M.fx.hover) { hov.id = null; hov.k = 0; }
      M.redraw();
      return;
    }
    const set = $("#map-set");
    if (set && !set.hidden && !e.target.closest("#map-set") && !e.target.closest('[data-mact="settings"]')) set.hidden = true;
  });
  document.addEventListener("toggle", (e) => { const k = e.target?.dataset?.acts; if (k) MC.store.set("mp_acts_" + k, e.target.open ? "1" : "0"); }, true);
  function toggleSettings() {
    const el = $("#map-set");
    if (!el) return;
    el.hidden = !el.hidden;
    if (el.hidden) return;
    el.innerHTML = `<b class="ms-title">${MC.icon("settings", "sm")} ${t("mfx.title")}</b>
      <label class="check"><input type="checkbox" data-mfx="hover" ${M.fx.hover ? "checked" : ""}> ${t("mfx.hover")}</label>
      <label class="check"><input type="checkbox" data-mfx="move" ${M.fx.move ? "checked" : ""}> ${t("mfx.move")}</label>
      <label class="check"><input type="checkbox" data-mfx="conds" ${M.fx.conds ? "checked" : ""}> ${t("mfx.conds")}</label>
      <label class="check"><input type="checkbox" data-mfx="reach" ${M.fx.reach ? "checked" : ""}> ${t("mfx.reach")}</label>
      <p class="muted small">${t("mfx.hint")}</p>`;
  }

  // ---------------------------------------------------------------- панель инструментов
  M.setTool = (name) => {
    M.tools[M.tool]?.cancel?.();
    M.tool = name;
    renderToolbar();
    MC.emit("map_tool", name);
    M.redraw();
  };
  function renderToolbar() {
    const bar = $("#map-tools");
    if (!bar) return;
    const b = (tool, icon, title) => `<button class="mt-btn ${M.tool === tool ? "on" : ""}" data-mtool="${tool}" title="${esc(title)}">${MC.icon(icon, "sm")}</button>`;
    const mineTok = (M.map?.tokens || []).find((x) => M.mine(x));
    bar.innerHTML = `${b("pan", "pointer", t("map.t.pan"))}${b("ruler", "ruler", t("map.t.ruler"))}${b("tmpl", "t-" + M.tmplKind, t("map.t.tmpl"))}${MC.isGM() || M.marksOk ? b("marks", "pen", t("map.t.marks")) : ""}
      <span class="mt-sep"></span>
      <button class="mt-btn" data-mact="zin" title="${esc(t("map.zoom_in"))}">${MC.icon("zoom-in", "sm")}</button>
      <button class="mt-btn" data-mact="zout" title="${esc(t("map.zoom_out"))}">${MC.icon("zoom-out", "sm")}</button>
      <button class="mt-btn" data-mact="fit" title="${esc(t("map.fit"))}">${MC.icon("maximize", "sm")}</button>
      ${mineTok ? `<button class="mt-btn" data-mact="me" title="${esc(t("map.to_me"))}">${MC.icon("locate", "sm")}</button>` : ""}
      <span class="mt-sep"></span>
      ${MC.isGM() || MC.Combat?.state.active ? `<button class="mt-btn ${M.dock.combat ? "on" : ""}" data-mdock="combat" title="${esc(t("mp.dock_combat"))}">${MC.icon("attacks", "sm")}</button>` : ""}
      <button class="mt-btn ${M.dock.log ? "on" : ""}" data-mdock="log" title="${esc(t("mp.dock_log"))}">${MC.icon("history", "sm")}</button>
      <button class="mt-btn" data-mact="settings" title="${esc(t("mfx.title"))}">${MC.icon("settings", "sm")}</button>`;
    const tp = $("#map-tmpl-pop");
    if (tp) {
      tp.hidden = M.tool !== "tmpl";
      tp.innerHTML = `${["circle", "cone", "line", "cube"].map((k) => `<button class="chip ${M.tmplKind === k ? "on" : ""}" data-tk="${k}">${MC.icon("t-" + k, "sm")} ${t("map.tmpl." + k)}</button>`).join("")}
        <div class="tp-colors">${M.TMPL_COLORS.map(([c, k]) => `<button class="tp-col ${M.tmplColor() === c ? "on" : ""}" data-tcol="${c}" title="${esc(t(k))}" style="background:${c}"></button>`).join("")}</div>
        <label class="tp-len">${t("map.tmpl.len")} <input type="number" min="5" max="500" step="5" value="${M.tmplLen}" id="tmpl-len"> ${t("map.ft")}</label>
        <span class="muted small">${t("map.tmpl.hint")}</span>`;
    }
  }
  M.renderToolbar = renderToolbar;
  M.TMPL_COLORS = [["#f97316", "map.col.fire"], ["#38bdf8", "map.col.cold"], ["#facc15", "map.col.lightning"], ["#22c55e", "map.col.poison"],
    ["#a3e635", "map.col.acid"], ["#a855f7", "map.col.force"], ["#e879f9", "map.col.psychic"], ["#fde68a", "map.col.radiant"],
    ["#64748b", "map.col.necrotic"], ["#f1f5f9", "map.col.thunder"]];
  const TMPL_DEF = { circle: "#f97316", cone: "#38bdf8", line: "#facc15", cube: "#a855f7" };
  M.tmplColor = () => M.tmplColors[M.tmplKind] || TMPL_DEF[M.tmplKind] || "#8b5cf6";
  document.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-mtool]");
    if (tb) { M.setTool(tb.dataset.mtool); return; }
    const a = e.target.closest("[data-mact]");
    if (a) {
      const k = a.dataset.mact;
      if (k === "zin") M.zoomAt(W / 2, H / 2, 1.3);
      if (k === "zout") M.zoomAt(W / 2, H / 2, 1 / 1.3);
      if (k === "fit") M.fit();
      if (k === "settings") toggleSettings();
      if (k === "me") { const tok = (M.map?.tokens || []).find((x) => M.mine(x)); if (tok) { M.centerOn(tok.x, tok.y); select(tok); } }
      return;
    }
    const tk = e.target.closest("[data-tk]");
    if (tk) { M.tmplKind = tk.dataset.tk; renderToolbar(); }
    const tc = e.target.closest("[data-tcol]");
    if (tc) {
      M.tmplColors[M.tmplKind] = tc.dataset.tcol;
      try { localStorage.setItem("mc_tmpl_colors", JSON.stringify(M.tmplColors)); } catch { /* ignore */ }
      renderToolbar();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "tmpl-len") { M.tmplLen = MC.clamp(MC.int(e.target.value, 20), 5, 500); }
  });

  // ---------------------------------------------------------------- данные с сервера
  function setMap(msg) {
    const prev = M.map?.id;
    const old = new Map();
    if (msg.map && prev === msg.map.id) {
      const now = performance.now();
      for (const x of M.map.tokens || []) {
        const mv = movePos(x, now);
        old.set(x.id, mv ? { x: mv.x, y: mv.y } : { x: x.x, y: x.y });
      }
      for (const [id, d] of drops) { if (now - d.ts < 4000) old.set(id, d); }
      for (const [id, d] of fx.drags) { if (d.done && d.dx != null) old.set(id, { x: d.dx, y: d.dy }); }
    } else moves.clear();
    drops.clear();
    for (const [id, d] of fx.drags) if (d.done) fx.drags.delete(id);
    const oldReq = new Set((prev === msg.map?.id ? M.map?.tokens || [] : []).filter((x) => x.req).map((x) => x.id));
    M.map = msg.map;
    if (msg.limit != null) M.limit = !!msg.limit;
    if (MC.isGM() && prev === M.map?.id) {        // игрок попросил передвинуть фишку — скажем мастеру
      for (const x of M.map.tokens || []) if (x.req && !oldReq.has(x.id)) MC.toast(t("map.req_toast", { name: M.tokName(x) }), "warn", "hourglass");
    }
    for (const x of M.map?.tokens || []) {
      const o = old.get(x.id);
      if (o && (Math.abs(o.x - x.x) > 0.5 || Math.abs(o.y - x.y) > 0.5)) startMove(x.id, o.x, o.y, x.x, x.y);
    }
    M.mode = msg.mode || M.mode;
    M.active = !!msg.active;
    if (M.map && !(M.map.tokens || []).some((x) => x.id === M.sel)) M.sel = null;
    renderEmpty();
    ensureCanvas();
    if (M.map && prev !== M.map.id) { view.fitted = null; M.fit(); autoZoom(); }
    renderToolbar(); renderPanel();
    MC.emit("map_changed");
    M.redraw();
  }
  function renderEmpty() {
    const el = $("#map-empty");
    if (!el) return;
    el.hidden = !!M.map;
    el.innerHTML = MC.isGM() ? "" : `<div class="soon-ico">${MC.icon("map", "huge")}</div><h2>${t("map.none")}</h2><p class="muted">${t("map.none.d")}</p>`;
    const badge = $("#map-mode");
    if (badge) {
      badge.hidden = MC.isGM() || !M.map || M.mode === "own";
      badge.innerHTML = M.mode === "gm" ? `${MC.icon("lock", "sm")} ${t("map.mode.gm.badge")}` : `${MC.icon("hourglass", "sm")} ${t("map.mode.approve.badge")}`;
    }
  }
  MC.on("msg_map", setMap);
  MC.on("msg_map_mode", (m) => { M.mode = m.mode; if (m.limit != null) M.limit = !!m.limit; renderEmpty(); renderPanel(); MC.emit("map_limit"); });
  MC.on("msg_fx", (m) => {
    if (!M.map || m.map !== M.map.id) return;
    const d = m.d || {}, color = m.by?.color || "#8b5cf6", now = performance.now();
    if (m.kind === "ruler") fx.rulers.set(m.by.id, { a: d.a, b: d.b, color, ts: now, done: !!d.done });
    if (m.kind === "ping") fx.pings.push({ x: d.x, y: d.y, color, ts: now });
    if (m.kind === "drag") {
      const prev = fx.drags.get(d.id);
      const tok = M.map.tokens?.find((x) => x.id === d.id);
      // показываемое положение (dx, dy) плавно догоняет присланное (x, y)
      const base = prev ? { dx: prev.dx, dy: prev.dy, st: prev.st } : { dx: tok ? tok.x : d.x, dy: tok ? tok.y : d.y };
      if (d.done) {          // итог придёт вместе с картой; до тех пор держим фишку там, где её отпустили
        fx.drags.delete(d.id);
        if (m.by?.id === "gm" || M.mode === "own") { fx.drags.set(d.id, { x: d.x, y: d.y, ts: now, done: true, ...base }); drops.set(d.id, { x: d.x, y: d.y, ts: now }); }
      } else fx.drags.set(d.id, { x: d.x, y: d.y, ts: now, ...base });
    }
    M.redraw();
  });
  MC.on("chars", () => { M.redraw(); renderPanel(); });
  MC.on("doc", (id) => { const tok = M.map?.tokens?.find((x) => x.id === M.sel); if (tok && tok.char === id) renderPanel(); });
  MC.on("combat_changed", () => { renderDock(); renderToolbar(); M.redraw(); });
  MC.on("welcome", () => { renderDock(true); renderToolbar(); });
  MC.on("players", () => M.redraw());
  MC.on("welcome", () => { renderEmpty(); });
  MC.on("lang", () => { renderToolbar(); renderPanel(); renderEmpty(); renderDock(true); });
  // вкладку открыли — холст мог быть нулевого размера
  MC.on("tab", (tab) => { if (tab === "map") { ensureCanvas(); resize(); } });
})();
