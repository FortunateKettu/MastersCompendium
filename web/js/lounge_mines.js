// Masters Compendium — комната ожидания: «Подземелье с ловушками» (сапёр). Играется только у себя.
// Открой все безопасные плиты, не наступив на ловушку. Цифра — сколько ловушек рядом. Награда — золото.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t } = MC;
  const L = MC.Lounge;

  const LEVELS = {
    easy: { w: 8, h: 8, n: 10, gold: 60, k: 30 },
    mid: { w: 10, h: 12, n: 22, gold: 300, k: 90 },
    hard: { w: 12, h: 16, n: 40, gold: 1500, k: 240 },
  };
  let lvl = MC.store.get("lzm_lvl") || "easy";
  let flagMode = false;
  let G = null;          // {w,h,n,mines:Set,open:Set,flags:Set,state:"new"|"play"|"won"|"lost",t0,t1,boom}

  function newGame() {
    const L0 = LEVELS[lvl];
    G = { w: L0.w, h: L0.h, n: L0.n, mines: new Set(), open: new Set(), flags: new Set(), state: "new", t0: 0, t1: 0, boom: -1 };
  }
  const idx = (x, y) => y * G.w + x;
  function around(i) {
    const x = i % G.w, y = Math.floor(i / G.w), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < G.w && ny < G.h) out.push(idx(nx, ny));
    }
    return out;
  }
  const count = (i) => around(i).filter((j) => G.mines.has(j)).length;
  /** Ловушки раскладываем после первого хода — первая плита и соседние всегда безопасны. */
  function plant(first) {
    const safe = new Set([first, ...around(first)]);
    const cells = [];
    for (let i = 0; i < G.w * G.h; i++) if (!safe.has(i)) cells.push(i);
    for (let k = 0; k < G.n && cells.length; k++) {
      const j = Math.floor(Math.random() * cells.length);
      G.mines.add(cells.splice(j, 1)[0]);
    }
  }
  function reveal(i) {
    const st = [i];
    while (st.length) {
      const c = st.pop();
      if (G.open.has(c) || G.flags.has(c)) continue;
      G.open.add(c);
      if (!count(c)) for (const j of around(c)) if (!G.open.has(j) && !G.mines.has(j)) st.push(j);
    }
  }
  function dig(i) {
    if (G.state === "won" || G.state === "lost" || G.flags.has(i)) return;
    if (G.state === "new") { plant(i); G.state = "play"; G.t0 = Date.now(); }
    if (G.open.has(i)) {             // по открытой цифре: если флажков столько же — открываем соседей
      const nb = around(i);
      if (nb.filter((j) => G.flags.has(j)).length !== count(i)) return;
      for (const j of nb) if (!G.open.has(j) && !G.flags.has(j)) { if (G.mines.has(j)) return lose(j); reveal(j); }
    } else {
      if (G.mines.has(i)) return lose(i);
      reveal(i);
    }
    if (G.open.size === G.w * G.h - G.n) win();
    paint();
  }
  function flag(i) {
    if (G.state !== "play" && G.state !== "new") return;
    if (G.open.has(i)) return;
    if (G.flags.has(i)) G.flags.delete(i); else G.flags.add(i);
    try { navigator.vibrate?.(15); } catch { /* ignore */ }
    paint();
  }
  function lose(i) {
    G.state = "lost"; G.boom = i; G.t1 = Date.now();
    try { navigator.vibrate?.([80, 40, 140]); } catch { /* ignore */ }
    paint();
  }
  function win() {
    G.state = "won"; G.t1 = Date.now();
    const L0 = LEVELS[lvl];
    G.reward = Math.round(L0.gold + L.perSec() * L0.k);
    L.addGold(G.reward);
    L.save();
    const sec = Math.round((G.t1 - G.t0) / 1000);
    const best = MC.int(MC.store.get("lzm_best_" + lvl), 0);
    G.record = !best || sec < best;
    if (G.record) MC.store.set("lzm_best_" + lvl, sec);
  }

  const timeNow = () => (G.state === "new" ? 0 : Math.round(((G.t1 || Date.now()) - G.t0) / 1000));
  const NUMC = ["", "#60a5fa", "#34d399", "#f87171", "#a78bfa", "#fbbf24", "#22d3ee", "#f472b6", "#e5e7eb"];
  function cellHtml(i) {
    const end = G.state === "lost";
    if (G.open.has(i)) {
      const n = count(i);
      return `<button class="lzm-c open" data-lzm="${i}" ${n ? `style="color:${NUMC[n]}"` : ""}>${n || ""}</button>`;
    }
    if (end && G.mines.has(i)) return `<button class="lzm-c trap ${i === G.boom ? "boom" : ""}" data-lzm="${i}">${MC.icon("skull", "sm")}</button>`;
    if (G.flags.has(i)) return `<button class="lzm-c flag ${end && !G.mines.has(i) ? "wrong" : ""}" data-lzm="${i}">${MC.icon("map-pin", "sm")}</button>`;
    if (G.state === "won" && G.mines.has(i)) return `<button class="lzm-c flag" data-lzm="${i}">${MC.icon("map-pin", "sm")}</button>`;
    return `<button class="lzm-c" data-lzm="${i}"></button>`;
  }
  function html() {
    if (!G) newGame();
    const best = MC.int(MC.store.get("lzm_best_" + lvl), 0);
    const L0 = LEVELS[lvl];
    let msg = "";
    if (G.state === "won") msg = `<div class="lzm-msg won">${MC.icon("crown")} <b>${t("lzm.won", { n: L.fmt(G.reward) })}</b>${G.record ? ` · ${t("lzm.record")}` : ""}</div>`;
    if (G.state === "lost") msg = `<div class="lzm-msg lost">${MC.icon("skull")} <b>${t("lzm.lost")}</b></div>`;
    return `<div class="card glass lzm">
      <div class="lz-row lzm-top">${Object.keys(LEVELS).map((k) => `<button class="chip ${k === lvl ? "on" : ""}" data-lzmlvl="${k}">${t("lzm." + k)}</button>`).join("")}
        <span class="lzm-stat">${MC.icon("skull", "sm")} <b id="lzm-left">${G.n - G.flags.size}</b></span>
        <span class="lzm-stat">${MC.icon("hourglass", "sm")} <b id="lzm-time">${timeNow()}</b>${best ? `<small class="muted">/${best}</small>` : ""}</span></div>
      <div class="lzm-grid" style="--w:${G.w}">${Array.from({ length: G.w * G.h }, (_, i) => cellHtml(i)).join("")}</div>
      ${msg}
      <div class="lz-row lzm-bottom"><button class="chip ${flagMode ? "on" : ""}" data-lzmflag="1">${MC.icon("map-pin", "sm")} ${t("lzm.flag_mode")}</button>
        <button class="btn small" data-lzmnew="1">${MC.icon("refresh", "sm")} ${t("lzm.new")}</button>
        <span class="muted small">${t("lzm.reward", { n: L.fmt(L0.gold + L.perSec() * L0.k) })}</span></div>
      <details class="lz-rules"><summary>${t("lz.rules")}</summary><p class="muted small">${t("lzm.rules")}</p></details></div>`;
  }
  function paint() { if (L.here() && L.sub() === "mines") $("#lz-body").innerHTML = html(); }

  setInterval(() => {
    const el = $("#lzm-time");
    if (el && G?.state === "play") el.textContent = timeNow();
  }, 1000);

  // долгое нажатие на телефоне — флажок; правая кнопка мыши — тоже
  let press = null;
  document.addEventListener("pointerdown", (e) => {
    const c = e.target.closest("[data-lzm]");
    if (!c || e.button !== 0) return;
    press = { i: Number(c.dataset.lzm), timer: setTimeout(() => { flag(press.i); press.done = true; }, 420), done: false };
  });
  const cancelPress = () => { if (press) clearTimeout(press.timer); };
  document.addEventListener("pointerup", cancelPress);
  document.addEventListener("pointercancel", () => { cancelPress(); press = null; });
  document.addEventListener("contextmenu", (e) => {
    const c = e.target.closest("[data-lzm]");
    if (!c) return;
    e.preventDefault();
    if (press?.done) return;
    cancelPress(); press = { done: true };
    flag(Number(c.dataset.lzm));
  });
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-lzm]");
    if (c) {
      if (press?.done) { press = null; return; }
      press = null;
      const i = Number(c.dataset.lzm);
      if (flagMode && !G.open.has(i)) flag(i); else dig(i);
      return;
    }
    const lv = e.target.closest("[data-lzmlvl]");
    if (lv) { lvl = lv.dataset.lzmlvl; MC.store.set("lzm_lvl", lvl); newGame(); paint(); return; }
    if (e.target.closest("[data-lzmflag]")) { flagMode = !flagMode; paint(); return; }
    if (e.target.closest("[data-lzmnew]")) { newGame(); paint(); }
  });

  L.register({ id: "mines", ic: "skull", render: (el) => { el.innerHTML = html(); } });
})();
