// Masters Compendium — броски: режим (преимущество/помеха/скрыто), карточки результата, вкладка «Кубы».
// Кидает сервер мастера; здесь — запрос и красивый показ (3D-кубики — js/dice3d.js, грузятся лениво).
(() => {
  "use strict";
  const MC = window.MC;
  const D = (MC.Dice = {});

  D.mode = "normal";                   // normal | adv | dis — сбрасывается после броска d20
  D.hidden = MC.store.get("hidden") === "1";
  D.lastCrit = null;                   // {atk, ts} — следующий урон этой атакой удваивает кости

  D.setMode = (m) => { D.mode = D.mode === m ? "normal" : m; MC.emit("dice_mode"); };
  D.toggleHidden = () => { D.hidden = !D.hidden; MC.store.set("hidden", D.hidden ? "1" : "0"); MC.emit("dice_mode"); };

  /**
   * Бросить. kind: check | save | attack | damage | init | death | hd | free
   * Возвращает запись броска (или null при ошибке).
   */
  D.roll = async (formula, label = "", opts = {}) => {
    const usesD20 = /(^|[^\d])1?d20(?!\d)/i.test(formula) && ["check", "save", "attack", "init", "death", "free"].includes(opts.kind || "free");
    const mode = opts.mode || (usesD20 ? D.mode : "normal");
    try {
      const res = await MC.request({ t: "roll", formula, label, kind: opts.kind || "free", mode,
        hidden: opts.hidden ?? D.hidden, char: opts.char || "" });
      if (usesD20 && D.mode !== "normal" && !opts.keepMode) { D.mode = "normal"; MC.emit("dice_mode"); }
      return res.roll;
    } catch (e) {
      MC.toast(MC.t(e.code ? "err." + e.code : e.message === "timeout" ? "err.timeout" : "conn.offline"), "warn");
      return null;
    }
  };

  // ---------------------------------------------------------------- карточки результата
  function partsHtml(r) {
    return (r.parts || []).map((p, i) => {
      const sign = i === 0 ? (p.sign < 0 ? "−" : "") : (p.sign < 0 ? " − " : " + ");
      if (p.const != null) return `${sign}<span class="cst">${p.const}</span>`;
      const dice = p.rolls.map((v, j) => {
        const kept = p.kept.includes(j);
        const cls = ["die", "d" + p.sides, kept ? "" : "drop", p.sides === 20 && kept && v === 20 ? "nat20" : "",
          p.sides === 20 && kept && v === 1 ? "nat1" : ""].join(" ");
        return `<span class="${cls}">${v}</span>`;
      }).join("");
      return `${sign}<span class="grp" title="${MC.esc(p.dice)}">${dice}</span>`;
    }).join("");
  }

  D.entryHtml = (r, compact = false) => {
    const me = MC.state.me;
    const mine = r.who && me && r.who.id === me.id;
    const tags = [];
    if (r.mode === "adv") tags.push(`<span class="tag ok">${MC.t("mode.adv")}</span>`);
    if (r.mode === "dis") tags.push(`<span class="tag bad">${MC.t("mode.dis")}</span>`);
    if (r.hidden) tags.push(`<span class="tag">${MC.icon("hidden", "sm")} ${MC.t("dice.hidden")}</span>`);
    const cls = r.crit ? "crit" : r.fumble ? "fumble" : "";
    const who = r.char || r.who?.name || "?";
    return `<div class="roll-entry ${cls} ${compact ? "compact" : ""}" data-rf="${MC.esc(r.formula || "")}" data-rl="${MC.esc(r.label || "")}">
      <div class="re-head"><i style="background:${MC.esc(r.who?.color || "#888")}"></i>
        <b>${MC.esc(who)}</b>${r.char && r.who?.name ? `<span class="muted"> · ${MC.esc(r.who.name)}</span>` : ""}
        ${mine ? "" : ""}<span class="re-time">${new Date((r.ts || 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="re-label">${MC.esc(r.label || r.formula)} ${tags.join(" ")}</div>
      <div class="re-body"><div class="re-dice">${partsHtml(r)}</div>
        <div class="re-total">${r.total}${r.crit ? `<small>${MC.t("dice.crit")}</small>` : r.fumble ? `<small>${MC.t("dice.fumble")}</small>` : ""}</div></div>
      <div class="re-formula muted">${MC.esc(r.formula)}</div>
    </div>`;
  };

  /** Итог броска — строкой в общей колонке уведомлений (настройка: все / только мои / не показывать). */
  function showCard(r) {
    const mine = MC.state.me && r.who?.id === MC.state.me.id;
    const mode = MC.store.get("opt_rollcards") || "all";
    if (mode === "off" || (mode === "mine" && !mine)) return;
    if (!mine && D.muted(r.who)) return;
    const box = MC.notifyBox();
    const el = document.createElement("div");
    el.className = "roll-card glass" + (r.crit ? " crit" : r.fumble ? " fumble" : "");
    const who = r.char || r.who?.name || "?";
    el.innerHTML = `<i class="rc-dot" style="background:${MC.esc(r.who?.color || "#888")}"></i>
      <span class="rc-t"><b>${MC.esc(who)}</b><small>${MC.esc(r.label || r.formula)}${r.hidden ? " · " + MC.esc(MC.t("dice.hidden")) : ""}</small></span>
      <span class="rc-total">${r.total}</span>`;
    el.title = r.formula || "";
    el.addEventListener("click", () => dismiss(el));
    box.prepend(el);
    [...box.querySelectorAll(".roll-card")].slice(4).forEach((x) => x.remove());
    MC.notifyTrim?.();
    setTimeout(() => dismiss(el), MC.toastMs());
  }
  /** Чьи кубики игрок выключил (в «Настройках»). */
  D.muted = (who) => { if (!who?.id) return false; try { return (JSON.parse(MC.store.get("opt_dice_mute") || "[]")).includes(who.id); } catch { return false; } };
  function dismiss(el) { el.classList.add("out"); setTimeout(() => el.remove(), 250); }

  // ---------------------------------------------------------------- 3D-кубики
  const opt = (k, def) => { const v = MC.store.get("d3_" + k); return v == null ? def : v === "1"; };
  D.opts = { on: opt("on", true), sound: opt("sound", true), others: opt("others", true) };
  // в отдельных окнах кубики катятся только в главном окне — тут без 3D и звука
  if (MC.pop) D.opts.on = false;
  D.setOpt = (k, v) => { D.opts[k] = v; if (MC.pop) return; MC.store.set("d3_" + k, v ? "1" : "0"); if (k === "on" && v) load3d(); };
  let mod3d = null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function load3d() {
    if (!mod3d) mod3d = import("/web/js/dice3d.js?v=0.12.0").catch((e) => { console.warn("3D-кубики не загрузились", e); return null; });
    return mod3d;
  }
  // звук в браузере можно включить только после жеста пользователя
  document.addEventListener("pointerdown", () => { if (D.opts.on && D.opts.sound) load3d().then((m) => m?.unlockAudio()); }, { once: true, capture: true });
  if (D.opts.on && !reduced) setTimeout(() => (window.requestIdleCallback || setTimeout)(() => load3d()), 1500);

  // ---------------------------------------------------------------- стиль кубиков: цвет, перелив, след (выдаёт мастер)
  D.styles = {};
  D.GM_DEFAULT = { color: "#8b5cf6", color2: "#e9e3ff", trail: "" };      // как логотип: фиолетовый → белый
  D.TRAILS = ["", "fire", "ice", "poison", "lightning", "arcane", "shadow", "holy", "blood", "nature", "water", "earth", "wind", "petals", "cosmos"];
  /** Стиль кубиков того, кто бросает: {color, color2, trail}. */
  D.styleOf = (who) => {
    const id = who?.id || "";
    const st = D.styles[id];
    const base = id === "gm" ? D.GM_DEFAULT : { color: who?.color || "#8b5cf6", color2: "", trail: "" };
    return st ? { color: st.color || base.color, color2: st.color2 || "", trail: st.trail || "" } : base;
  };
  MC.on("msg_dice_styles", (m) => { D.styles = m.styles || {}; MC.emit("dice_styles"); if (MC.$("#tab-dice")?.classList.contains("active")) D.renderTab(); });
  MC.on("welcome", () => MC.send({ t: "dice_styles" }));
  D.preview = async (style, sides = [20, 8]) => {
    const m = await load3d();
    if (m?.supported) m.demo(sides, style);
  };

  const TRAIL_IC = { "": "x", fire: "crit", ice: "snowflake", poison: "c-poisoned", lightning: "init", arcane: "spells", shadow: "moon", holy: "sun", blood: "droplet", nature: "trees", water: "waves", earth: "mountain", wind: "wind", petals: "sparkle", cosmos: "star" };
  const SW = ["#8b5cf6", "#6366f1", "#3d6df2", "#06b6d4", "#10b981", "#84cc16", "#f5c542", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#e9e3ff", "#94a3b8", "#1f2937"];
  /** Маленький кружок-образец стиля (для списков). */
  D.styleChip = (st) => `<span class="ds-chip" style="--c1:${MC.esc(st.color)};--c2:${MC.esc(st.color2 || st.color)}">${st.trail ? MC.icon(TRAIL_IC[st.trail], "sm") : ""}</span>`;
  /** Мастер выбирает цвет, перелив и след кубиков для себя или игрока. */
  D.styleForm = async (whoId) => {
    const who = whoId === "gm" ? { id: "gm", name: MC.t("ds.gm_name"), color: "#f5c542" } : MC.state.players.find((p) => p.id === whoId);
    if (!who) return;
    const cur = D.styleOf(who);
    const st = { color: cur.color, color2: cur.color2, trail: cur.trail, grad: !!cur.color2 };
    const sw = (k) => `<div class="ds-sw">${SW.map((c) => `<button type="button" class="swatch ${st[k] === c ? "sel" : ""}" data-dsc="${k}" data-v="${c}" style="background:${c}"></button>`).join("")}
      <label class="ds-custom" title="${MC.esc(MC.t("ds.custom"))}"><input type="color" data-dsi="${k}" value="${MC.esc(st[k] || "#8b5cf6")}">${MC.icon("palette", "sm")}</label></div>`;
    const body = () => `<div class="ds-prev"><span class="ds-die" style="--c1:${st.color};--c2:${st.grad ? st.color2 || "#ffffff" : st.color}">${MC.icon("d20", "huge")}</span>
        <div><b>${MC.esc(who.name)}</b><div class="muted small">${MC.t(st.trail ? "ds.trail." + st.trail : "ds.trail.none")}</div>
        <button type="button" class="btn small" data-dsa="test">${MC.icon("dice", "sm")} ${MC.t("ds.test")}</button></div></div>
      <h4 class="grp-h">${MC.t("ds.color")}</h4>${sw("color")}
      <label class="check ds-grad"><input type="checkbox" data-dsa="grad" ${st.grad ? "checked" : ""}> ${MC.t("ds.grad")}</label>
      ${st.grad ? sw("color2") : ""}
      <h4 class="grp-h">${MC.t("ds.trail")}</h4>
      <div class="ds-trails">${D.TRAILS.map((k) => `<button type="button" class="chip ds-tr ${st.trail === k ? "on" : ""}" data-dst="${k}" data-k="${k || "none"}">${MC.icon(TRAIL_IC[k], "sm")} ${MC.t(k ? "ds.trail." + k : "ds.trail.none")}</button>`).join("")}</div>`;
    const out = () => ({ color: st.color, color2: st.grad ? st.color2 || "#ffffff" : "", trail: st.trail });
    const v = await MC.modal({ title: MC.t("ds.title"), wide: true, body: `<div class="ds-form">${body()}</div>`,
      buttons: [{ label: MC.t("ds.reset"), value: "reset" }, { label: MC.t("cancel"), value: null }, { label: MC.t("save"), kind: "primary", value: "save" }],
      mount: (box) => {
        const f = box.querySelector(".ds-form");
        const re = () => { f.innerHTML = body(); };
        box.addEventListener("click", (e) => {
          const c = e.target.closest("[data-dsc]");
          if (c) { st[c.dataset.dsc] = c.dataset.v; re(); return; }
          const tr = e.target.closest("[data-dst]");
          if (tr) { st.trail = tr.dataset.dst; re(); return; }
          if (e.target.closest('[data-dsa="test"]')) D.preview(out(), [20, 12, 6]);
        });
        box.addEventListener("change", (e) => {
          if (e.target.dataset.dsa === "grad") { st.grad = e.target.checked; if (st.grad && !st.color2) st.color2 = "#ffffff"; re(); }
          if (e.target.dataset.dsi) { st[e.target.dataset.dsi] = e.target.value; re(); }
        });
      } });
    if (!v) return;
    try {
      await MC.request({ t: "dice_style_set", who: whoId, style: v === "reset" ? null : out() });
      MC.toast(MC.t("saved"), "ok", "check");
    } catch (e) { MC.toast(MC.t(e.code ? "err." + e.code : "conn.offline"), "warn"); }
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dstyle]");
    if (b) { e.stopPropagation(); D.styleForm(b.dataset.dstyle); }
  }, true);

  async function show3d(r) {
    const mine = MC.state.me && r.who?.id === MC.state.me.id;
    if (!D.opts.on || reduced || document.hidden || (!mine && (!D.opts.others || D.muted(r.who)))) return;
    const m = await load3d();
    if (!m || !m.supported) return;
    m.setOpts?.({ vol: MC.num(MC.store.get("opt_d3_vol"), 0.6), size: MC.num(MC.store.get("opt_d3_size"), 1) });
    await m.play(r, { ...D.styleOf(r.who), sound: D.opts.sound });
  }

  MC.on("rolled", (r) => {
    // сначала катятся кубики, карточка с итогом — когда они легли (чтобы не спойлерить).
    // Новый бросок не ждёт старый: прежние кубики сразу убираются, их карточка показывается тут же.
    show3d(r).catch((e) => console.warn(e)).then(() => {
      if (!MC.$("#tab-dice")?.classList.contains("active") && !(MC.pop && ["log", "combat"].includes(MC.pop.kind))) showCard(r);
      D.renderLog();
    });
  });
  MC.on("log", () => D.renderLog());
  MC.on("msg_decisions", (m) => {
    MC.state.decisions = m.list || [];
    for (const d of MC.state.decisions) if (d.state !== "pending") document.getElementById("dec-" + d.id)?.remove();
    D.renderLog();
  });
  MC.on("welcome", () => MC.send({ t: "dec_list" }));

  // ---------------------------------------------------------------- переключатель режима (общий для листа и вкладки)
  D.modeBarHtml = () => `<div class="mode-bar">
    <button class="chip ${D.mode === "adv" ? "on ok" : ""}" data-dmode="adv">${MC.icon("adv", "sm")} ${MC.t("mode.adv")}</button>
    <button class="chip ${D.mode === "dis" ? "on bad" : ""}" data-dmode="dis">${MC.icon("dis", "sm")} ${MC.t("mode.dis")}</button>
    <button class="chip ${D.hidden ? "on" : ""}" data-dhidden title="${MC.esc(MC.t("mode.hidden.d"))}">${MC.icon("hidden", "sm")} ${MC.t("mode.hidden")}</button>
  </div>`;
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-dmode]");
    if (m) { D.setMode(m.dataset.dmode); return; }
    if (e.target.closest("[data-dhidden]")) D.toggleHidden();
  });
  MC.on("dice_mode", () => MC.$$(".mode-bar").forEach((b) => { b.outerHTML = D.modeBarHtml(); }));

  // ---------------------------------------------------------------- объёмные значки кубиков (SVG): грани с разной освещённостью
  let svgSeq = 0;
  const P = (pts) => pts.map((p) => p.join(",")).join(" ");
  const ring = (n, r, a0 = -90, cx = 32, cy = 32) => Array.from({ length: n }, (_, i) => {
    const a = ((a0 + (360 / n) * i) * Math.PI) / 180;
    return [+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)];
  });
  function dieFaces(sides) {
    // [точки, яркость грани 0..1] — 1 светлая (к свету), 0 тёмная
    if (sides === 4) { const A = [32, 5], B = [59, 55], C = [5, 55], O = [32, 40]; return [[[A, O, C], 0.55], [[A, B, O], 0.95], [[C, O, B], 0.25]]; }
    if (sides === 6) { const t = [[32, 6], [57, 19], [32, 32], [7, 19]]; return [[t, 1], [[[7, 19], [32, 32], [32, 59], [7, 46]], 0.45], [[[32, 32], [57, 19], [57, 46], [32, 59]], 0.7]]; }
    if (sides === 8) { const T = [32, 4], R = [59, 32], Bt = [32, 60], L = [5, 32], F = [35, 35]; return [[[T, L, F], 0.7], [[T, F, R], 1], [[L, F, Bt], 0.35], [[F, R, Bt], 0.55]]; }
    if (sides === 10) {
      const T = [32, 4], R = [58, 28], R2 = [56, 41], Bt = [32, 60], L2 = [8, 41], L = [6, 28], fl = [18, 34], fr = [46, 34], fb = [32, 46];
      return [[[T, fl, fb, fr], 1], [[T, L, L2, fl], 0.5], [[T, fr, R2, R], 0.7], [[fl, L2, Bt, fb], 0.35], [[fb, Bt, R2, fr], 0.55]];
    }
    if (sides === 12) {
      const o = ring(10, 28, -90), i = ring(5, 15, -90), out = [[i, 1]];
      for (let k = 0; k < 5; k++) out.push([[i[k], o[(2 * k) % 10], o[(2 * k + 1) % 10], o[(2 * k + 2) % 10], i[(k + 1) % 5]], [0.75, 0.6, 0.35, 0.45, 0.85][k]]);
      return out;
    }
    const h = ring(6, 29, -90), tr = [[32, 15], [47, 41], [17, 41]];        // d20 — как на логотипе
    return [[tr, 1], [[h[0], h[1], tr[1], tr[0]], 0.75], [[h[1], h[2], tr[1]], 0.55], [[h[2], h[3], h[4], tr[2], tr[1]], 0.3], [[h[4], h[5], tr[2]], 0.5], [[h[5], h[0], tr[0], tr[2]], 0.85]];
  }
  /** SVG объёмного кубика. sides 100 — два d10. */
  D.dieSvg = (sides, label, style) => {
    const id = "dg" + ++svgSeq;
    const st = style || D.styleOf(MC.state.me || { id: MC.isGM() ? "gm" : "" });
    const c1 = st.color || "#8b5cf6", c2 = st.color2 || st.color || "#8b5cf6";
    const one = (s, tf = "") => `<g ${tf}>${dieFaces(s).map(([pts, k]) => `<polygon points="${P(pts)}" fill="url(#${id})" stroke="rgba(255,255,255,.55)" stroke-width="1.2" stroke-linejoin="round"/>
      <polygon points="${P(pts)}" fill="${k > 0.6 ? "#fff" : "#000"}" fill-opacity="${(k > 0.6 ? (k - 0.6) * 0.55 : (0.6 - k) * 0.75).toFixed(2)}"/>`).join("")}</g>`;
    const body = sides === 100 ? one(10, 'transform="translate(-9 -3) scale(.8)"') + one(10, 'transform="translate(20 15) scale(.7)"') : one(sides);
    const ty = sides === 4 ? 45 : sides === 6 ? 47 : sides === 20 ? 37 : sides === 8 ? 34 : sides === 10 ? 32 : 33;
    return `<svg class="die3d" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MC.esc(c1)}"/><stop offset="1" stop-color="${MC.esc(c2)}"/></linearGradient></defs>${body}
      <text x="32" y="${ty}" text-anchor="middle" dominant-baseline="middle" class="die3d-t">${MC.esc(label)}</text></svg>`;
  };

  // ---------------------------------------------------------------- вкладка «Кубы»
  const DICE = [4, 6, 8, 10, 12, 20, 100];
  let count = MC.clamp(MC.int(MC.store.get("qd_count"), 1), 1, 20), modv = MC.clamp(MC.int(MC.store.get("qd_mod"), 0), -20, 30);
  D.renderTab = () => {
    const el = MC.$("#dice-tab");
    if (!el) return;
    el.innerHTML = `<div class="dice-cols"><div class="dc-left">
      <div class="card glass dice-panel">
        ${D.modeBarHtml()}
        <div class="dice-grid">${DICE.map((d) => `<button class="die-btn" data-quick="${d}">${D.dieSvg(d, d === 100 ? "%" : d)}<span>d${d}</span></button>`).join("")}</div>
        <div class="dice-row">
          <label class="mini">${MC.t("dice.count")}<div class="stepper"><button data-cnt="-1">−</button><b id="dice-cnt">${count}</b><button data-cnt="1">+</button></div></label>
          <label class="mini">${MC.t("dice.mod")}<div class="stepper"><button data-mod="-1">−</button><b id="dice-mod">${MC.sign(modv)}</b><button data-mod="1">+</button></div></label>
        </div>
        <div class="chips d3-opts">
          <button class="chip ${D.opts.on ? "on" : ""}" data-d3="on">${MC.icon("dice", "sm")} ${MC.t("dice.3d")}</button>
          <button class="chip ${D.opts.sound ? "on" : ""}" data-d3="sound" ${D.opts.on ? "" : "disabled"}>${MC.icon("volume", "sm")} ${MC.t("dice.sound")}</button>
          <button class="chip ${D.opts.others ? "on" : ""}" data-d3="others" ${D.opts.on ? "" : "disabled"}>${MC.icon("players", "sm")} ${MC.t("dice.others")}</button>
        </div>
        <form class="formula-row" id="dice-form"><input id="dice-formula" placeholder="${MC.esc(MC.t("dice.formula"))}" autocomplete="off" spellcheck="false">
          <button class="btn primary">${MC.t("dice.roll")}</button></form>
      </div></div><div class="dc-right">
      <h2 class="section with-act">${MC.t("dice.log")}${MC.canPop() ? `<button class="icon-btn small" data-popwin="log" title="${MC.esc(MC.t("mp.pop"))}">${MC.icon("external", "sm")}</button>` : ""}</h2>
      <div id="dice-log" class="dice-log"></div></div></div>`;
    D.renderLog();
  };
  /** Решение мастера в журнале: просьба игрока, принято/отклонено, откат. */
  D.decHtml = (d) => {
    const t = MC.t, esc = MC.esc, gm = MC.isGM();
    const txt = d.kind === "move" ? t("dec.k.move", { who: esc(d.who), ft: d.text?.ft ?? "?" })
      : d.kind === "end" ? t("dec.k.end", { who: esc(d.who) })
        : d.kind === "sell" ? `${t("dec.k.sell", { who: esc(d.who) })}: ${esc(d.text?.what || "")}${d.text?.qty > 1 ? " ×" + d.text.qty : ""} → ${esc(MC.Trade?.fmt?.(d.text?.price || 0) || "")}`
        : `${t("dec.k.act", { who: esc(d.who) })}: ${esc(MC.Combat?.decReason?.(d.text?.reason) || "")}${d.text?.what ? " · " + esc(d.text.what) : ""}${d.text?.tgt ? " → " + esc(d.text.tgt) : ""}`;
    let btns = "";
    if (gm && d.state === "pending") {
      if (d.kind === "move") btns = `<button class="btn small primary" data-dec="mok" data-id="${d.id}" data-map="${esc(d.map || "")}" data-tok="${esc(d.tok || "")}">${MC.icon("check", "sm")}</button><button class="btn small" data-dec="mno" data-id="${d.id}" data-map="${esc(d.map || "")}" data-tok="${esc(d.tok || "")}">${MC.icon("x", "sm")}</button>`;
      if (d.kind === "end") btns = `<button class="btn small primary" data-dec="eok" data-id="${d.id}">${MC.icon("check", "sm")}</button><button class="btn small" data-dec="eno" data-id="${d.id}">${MC.icon("x", "sm")}</button>`;
      if (d.kind === "act" || d.kind === "sell") btns = `<button class="btn small primary" data-dec="ok" data-id="${d.id}">${MC.icon("check", "sm")}</button><button class="btn small" data-dec="no" data-id="${d.id}">${MC.icon("x", "sm")}</button>`;
    }
    if (gm && d.can_undo) btns = `<button class="btn small" data-dec="undo" data-id="${d.id}" title="${esc(t("dec.undo"))}">${MC.icon("undo", "sm")} ${t("dec.undo")}</button>`;
    return `<div class="dec-entry st-${esc(d.state)}"><div class="dec-h">${MC.icon(d.kind === "move" ? "move" : d.kind === "end" ? "next" : d.kind === "sell" ? "coins" : "swords", "sm")}
        <span class="dec-t">${txt}</span><span class="re-time">${new Date((d.ts || 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="dec-f"><span class="dec-st">${t("dec.st." + d.state)}</span>${btns}</div></div>`;
  };
  D.renderLog = () => {
    const hosts = [MC.$("#dice-log"), ...MC.$$(".dice-log-host")].filter(Boolean);
    if (!hosts.length) return;
    const items = [...MC.state.log.slice(-80).map((r) => ({ ts: r.ts || 0, h: () => D.entryHtml(r, true) })),
      ...(MC.state.decisions || []).map((d) => ({ ts: d.ts || 0, h: () => D.decHtml(d) }))].sort((a, b) => b.ts - a.ts).slice(0, 100);
    const html = items.length ? items.map((x) => x.h()).join("") : `<p class="muted center">${MC.t("dice.log.empty")}</p>`;
    hosts.forEach((el) => { el.innerHTML = html; });
  };
  document.addEventListener("click", (e) => {
    const q = e.target.closest("[data-quick]");
    if (q) {
      const f = `${count}d${q.dataset.quick}${modv ? (modv > 0 ? "+" : "-") + Math.abs(modv) : ""}`;
      D.roll(f, f, { kind: q.dataset.quick === "20" && count === 1 ? "check" : "free" });
      return;
    }
    const o = e.target.closest("[data-d3]");
    if (o) { D.setOpt(o.dataset.d3, !D.opts[o.dataset.d3]); D.renderTab(); return; }
    const c = e.target.closest("[data-cnt]");
    if (c) { e.preventDefault(); count = MC.clamp(count + MC.int(c.dataset.cnt), 1, 20); MC.store.set("qd_count", count); MC.$("#dice-cnt").textContent = count; return; }
    const m = e.target.closest("[data-mod]");
    if (m) { e.preventDefault(); modv = MC.clamp(modv + MC.int(m.dataset.mod), -20, 30); MC.store.set("qd_mod", modv); MC.$("#dice-mod").textContent = MC.sign(modv); }
  });
  // ---------------------------------------------------------------- быстрые кубики (кнопка на остальных вкладках)
  const QD = { open: false, last: null, rid: 0 };
  const fab = () => MC.$("#qd-fab"), pop = () => MC.$("#qd-pop");
  const curTab = () => MC.$(".tab.active")?.dataset.tab;
  function syncFab() {
    const f = fab();
    if (!f) return;
    const show = !MC.pop && !MC.$("#scr-game")?.hidden && curTab() !== "dice";
    f.hidden = !show;
    if (!show) closeQD();
  }
  const qdFormula = (sides) => `${count}d${sides}${modv ? (modv > 0 ? "+" : "-") + Math.abs(modv) : ""}`;
  function renderQD() {
    const el = pop();
    if (!el) return;
    const l = QD.last;
    el.innerHTML = `<div class="qd-head"><b>${MC.icon("d20", "sm")} ${MC.t("qd.title")}</b><button class="icon-btn small" data-qd="close">${MC.icon("x", "sm")}</button></div>
      ${D.modeBarHtml()}
      <div class="qd-dice">${DICE.map((d) => `<button class="qd-die" data-qdroll="${d}">${D.dieSvg(d, d === 100 ? "%" : d)}<small>${MC.esc(qdFormula(d))}</small></button>`).join("")}</div>
      <div class="qd-row">
        <div class="qd-step"><span>${MC.t("dice.count")}</span><div class="stepper"><button data-qdc="-1">−</button><b>${count}</b><button data-qdc="1">+</button></div></div>
        <div class="qd-step"><span>${MC.t("dice.mod")}</span><div class="stepper"><button data-qdm="-1">−</button><b>${MC.sign(modv)}</b><button data-qdm="1">+</button></div></div>
      </div>
      <form class="qd-form" id="qd-form"><input id="qd-formula" placeholder="${MC.esc(MC.t("dice.formula"))}" autocomplete="off" spellcheck="false"><button class="btn primary">${MC.icon("d20", "sm")}</button></form>
      <div class="qd-last ${l ? (l.crit ? "crit" : l.fumble ? "fumble" : "") : "empty"}">${l ? `<span class="muted">${MC.esc(l.label || l.formula)}</span><b>${l.total}</b>` : `<span class="muted">${MC.t("qd.hint")}</span>`}</div>`;
  }
  function openQD() { QD.open = true; pop().hidden = false; fab().classList.add("on"); document.body.classList.add("qd-open"); renderQD(); }
  function closeQD() { if (!QD.open) return; QD.open = false; const p = pop(); if (p) p.hidden = true; fab()?.classList.remove("on"); document.body.classList.remove("qd-open"); }
  async function qdRoll(f, kind) {
    const my = ++QD.rid;
    const r = await D.roll(f, f, { kind });
    if (r && my === QD.rid) {
      // итог показываем, когда кубики легли — как и карточку
      const wait = D.opts.on && !reduced ? 1700 : 0;
      setTimeout(() => { if (my === QD.rid) { QD.last = r; if (QD.open) renderQD(); } }, wait);
    }
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#qd-fab")) { if (QD.open) closeQD(); else openQD(); return; }
    if (!QD.open) return;
    if (!e.target.closest("#qd-pop")) { if (!e.target.closest(".modal-wrap")) closeQD(); return; }
    const r = e.target.closest("[data-qdroll]");
    if (r) { qdRoll(qdFormula(r.dataset.qdroll), r.dataset.qdroll === "20" && count === 1 ? "check" : "free"); return; }
    const c = e.target.closest("[data-qdc]");
    if (c) { count = MC.clamp(count + MC.int(c.dataset.qdc), 1, 20); MC.store.set("qd_count", count); renderQD(); return; }
    const m = e.target.closest("[data-qdm]");
    if (m) { modv = MC.clamp(modv + MC.int(m.dataset.qdm), -20, 30); MC.store.set("qd_mod", modv); renderQD(); return; }
    if (e.target.closest('[data-qd="close"]')) closeQD();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && QD.open) closeQD(); });
  MC.on("dice_mode", () => { if (QD.open) renderQD(); });
  MC.on("tab", () => setTimeout(syncFab, 0));
  MC.on("welcome", () => setTimeout(syncFab, 0));
  MC.on("lang", () => { if (QD.open) renderQD(); });
  new MutationObserver(syncFab).observe(document.getElementById("scr-game") || document.body, { attributes: true, attributeFilter: ["hidden"] });

  document.addEventListener("submit", (e) => {
    if (e.target.id === "qd-form") {
      e.preventDefault();
      const f = MC.$("#qd-formula").value.trim();
      if (f) qdRoll(f, "free");
      return;
    }
    if (e.target.id !== "dice-form") return;
    e.preventDefault();
    const f = MC.$("#dice-formula").value.trim();
    if (f) D.roll(f, f, { kind: "free" });
  });
})();

// правая кнопка по броску в журнале: бросить ещё раз, скопировать
(() => {
  const MC = window.MC;
  MC.ctxAdd?.(".roll-entry[data-rf]", (el) => {
    const f = el.dataset.rf;
    if (!f) return null;
    return { title: el.dataset.rl || f, items: [
      { ic: "d20", label: MC.t("ctx.reroll"), fn: () => MC.Dice.roll(f, el.dataset.rl || "") },
      { ic: "copy", label: MC.t("ctx.copy_f"), fn: () => navigator.clipboard?.writeText(f).then(() => MC.toast(MC.t("copied"), "ok", "copy")).catch(() => {}) },
    ] };
  });
})();
