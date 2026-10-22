// Masters Compendium — вкладка «Привал»: сцены вне боя.
//  • привал: персонажи вокруг костра, можно делать друг другу визуальные действия (обнять, пощёчина, полечить…);
//  • диалог: слева персонажи игроков, справа НИП/противники крупными портретами с именами — кто говорит, видно всем;
//  • заметки игрока (во вкладке «Партия»): о ком угодно, с привязкой к НИП из диалогов.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const SC = (MC.Scene = { mode: "off", members: [], say: null, title: "", met: [] });
  const gm = () => MC.isGM();
  const me = () => MC.state.me?.id;
  const curTab = () => document.querySelector(".tab.active")?.dataset.tab;
  const here = () => curTab() === "camp";
  const goTab = (tab) => document.querySelector(`.tabbar [data-go="${tab}"]`)?.click();

  // действия: e — эмодзи-эффект, self — делается без цели
  const ACTS = [
    { id: "hug", e: "🤗", fx: ["❤️", "💕", "❤️"] }, { id: "highfive", e: "🙌", fx: ["✨", "⭐", "✨"] },
    { id: "cheers", e: "🍻", fx: ["🍺", "✨"] }, { id: "heal", e: "💚", fx: ["✚", "✚", "✚", "✨"], heal: true },
    { id: "kiss", e: "😘", fx: ["💋", "❤️"] }, { id: "bow", e: "🙇", fx: ["✨"] },
    { id: "poke", e: "👉", fx: ["❗"] }, { id: "slap", e: "🖐️", fx: ["💢", "✋"], hit: true },
    { id: "punch", e: "👊", fx: ["💥", "⭐"], hit: true },
    { id: "sing", e: "🎶", fx: ["🎵", "🎶", "🎵"], self: true }, { id: "dance", e: "💃", fx: ["✨", "🎶"], self: true },
    { id: "cheer", e: "🎉", fx: ["🎉", "🎊", "✨"], self: true }, { id: "sleep", e: "😴", fx: ["💤", "z", "Z"], self: true },
    { id: "cry", e: "😢", fx: ["💧", "💧"], self: true },
  ];

  const canAct = (m) => !!m && (gm() || (m.owner && m.owner === me()));
  const avatar = (m, cls = "") => `<span class="sc-av ${cls}" style="--c:${esc(m.color)}">${esc((m.name || "?").charAt(0).toUpperCase())}${m.img ? `<img src="${esc(m.img)}" alt="" onerror="this.remove()">` : ""}</span>`;

  // ---------------------------------------------------------------- отрисовка
  let sel = null;          // выбранный «кто делает»
  function gmBar() {
    if (!gm()) return "";
    return `<div class="card glass sc-gm">
      <div class="sc-modes">${[["camp", "crit"], ["talk", "players"], ["off", "power"]].map(([k, ic]) => `<button class="chip ${SC.mode === k ? "on" : ""}" data-scmode="${k}">${MC.icon(ic, "sm")} ${t("sc.mode." + k)}</button>`).join("")}</div>
      <div class="sc-gm-row">
        <input id="sc-title" value="${esc(SC.title)}" placeholder="${esc(t("sc.title_ph"))}" maxlength="60">
        <button class="btn small" data-scgm="people">${MC.icon("user-plus", "sm")} ${t("sc.people")}</button>
        <button class="btn small primary" data-scgm="call">${MC.icon("alert", "sm")} ${t("sc.call")}</button></div>
      ${SC.mode === "talk" ? `<div class="sc-gm-row"><input id="sc-line" placeholder="${esc(t("sc.line_ph"))}" maxlength="200">
        <button class="btn small" data-scgm="say">${MC.icon("pen", "sm")} ${t("sc.say")}</button>
        <button class="btn small" data-scgm="hush">${MC.icon("x", "sm")}</button></div>
        <p class="muted small">${t("sc.gm_talk_hint")}</p>` : SC.mode === "camp" ? `<p class="muted small">${t("sc.gm_camp_hint")}</p>` : ""}</div>`;
  }
  function campHtml() {
    const list = SC.members;
    const n = list.length;
    const pos = list.map((m, i) => {
      const a = Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      return { m, x: 50 + Math.cos(a) * 36, y: 54 + Math.sin(a) * 30 };
    });
    return `<div class="camp-stage" id="camp-stage">
      <div class="camp-stars"></div><div class="camp-ground"></div>
      <div class="campfire" style="left:50%;top:54%"><i class="cf-glow"></i><canvas class="cf-cv" width="200" height="260"></canvas></div>
      ${pos.map(({ m, x, y }) => `<button class="camp-seat ${sel === m.key ? "sel" : ""} ${canAct(m) ? "mine" : ""}" data-sckey="${esc(m.key)}" style="left:${x}%;top:${y}%">
        ${avatar(m)}<span class="sc-name">${esc(m.name)}</span></button>`).join("")}
      <div class="camp-log" id="camp-log"></div>
      ${!n ? `<p class="camp-empty muted">${t("sc.nobody")}</p>` : ""}
    </div>
    <p class="muted small center">${t(sel ? "sc.pick_target" : "sc.camp_hint")}</p>`;
  }
  function talkHtml() {
    const side = (s) => SC.members.filter((m) => (s === "pc" ? m.side === "pc" : m.side !== "pc"));
    const card = (m) => {
      const speaking = SC.say?.key === m.key;
      return `<div class="talk-card ${speaking ? "speak" : ""} ${m.side}" data-sckey="${esc(m.key)}">
        ${speaking && SC.say.text ? `<div class="talk-bubble">${esc(SC.say.text)}</div>` : ""}
        ${avatar(m, "big")}<b class="talk-name">${esc(m.name)}</b>
        ${!gm() && m.side !== "pc" ? `<button class="btn small" data-scnote="${esc(m.key)}">${MC.icon("pen", "sm")} ${t("pn.about_btn")}</button>` : ""}
        ${speaking ? `<span class="talk-speaking">${MC.icon("volume", "sm")} ${t("sc.speaking")}</span>` : ""}</div>`;
    };
    return `<div class="talk-stage">${SC.title ? `<h3 class="talk-title">${esc(SC.title)}</h3>` : ""}
      <div class="talk-sides"><div class="talk-side pc">${side("pc").map(card).join("") || `<p class="muted">${t("sc.no_pcs")}</p>`}</div>
        <div class="talk-vs">${MC.icon("players")}</div>
        <div class="talk-side npc">${side("npc").map(card).join("") || `<p class="muted">${t("sc.no_npcs")}</p>`}</div></div>
      <p class="muted small center">${t(gm() ? "sc.gm_talk_hint2" : "sc.talk_hint")}</p></div>`;
  }
  function render() {
    const el = $("#camp-tab");
    if (!el) return;
    const body = SC.mode === "camp" ? campHtml() : SC.mode === "talk" ? talkHtml()
      : `<div class="card glass sc-off">${MC.icon("crit", "huge")}<p>${t(gm() ? "sc.off_gm" : "sc.off")}</p></div>`;
    el.innerHTML = `${gmBar()}${SC.mode === "camp" && SC.title ? `<h2 class="section">${MC.icon("crit", "sm")} ${esc(SC.title)}</h2>` : ""}${body}`;
  }
  SC.render = render;
  function syncTab() {
    const b = document.querySelector('.tabbar [data-go="camp"]');
    const show = !MC.pop && (gm() || SC.mode !== "off");
    if (b) { b.hidden = !show; b.querySelector("[data-i18n]").textContent = t(SC.mode === "talk" ? "tab.talk" : "tab.camp"); }
    if (!show && here()) goTab("character");
  }

  // ---------------------------------------------------------------- действия на привале
  function actMenu(src, dst, at) {
    $("#sc-menu")?.remove();
    const acts = ACTS.filter((a) => (dst ? !a.self : a.self));
    const el = document.createElement("div");
    el.id = "sc-menu";
    el.className = "sc-menu glass";
    el.innerHTML = `<div class="sc-menu-h">${esc(src.name)}${dst ? " → " + esc(dst.name) : ""}</div>
      <div class="sc-menu-g">${acts.map((a) => `<button data-scact="${a.id}"><span>${a.e}</span><small>${t("sc.a." + a.id)}</small></button>`).join("")}</div>`;
    document.body.appendChild(el);
    const r = at.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = MC.clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + "px";
    el.style.top = MC.clamp(r.bottom + 8, 8, window.innerHeight - h - 8) + "px";
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-scact]");
      if (!b) return;
      MC.request({ t: "sc_fx", from: src.key, to: dst?.key || "", act: b.dataset.scact }).catch(() => {});
      el.remove();
      sel = null;
      render();
    });
  }
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#sc-menu") && !e.target.closest(".camp-seat")) $("#sc-menu")?.remove(); });

  const seatEl = (key) => [...document.querySelectorAll(".camp-seat")].find((x) => x.dataset.sckey === key);
  function burst(stage, x, y, list, big = false) {
    list.forEach((s, i) => {
      const p = document.createElement("span");
      p.className = "sc-fx" + (big ? " big" : "");
      p.textContent = s;
      p.style.left = x + (Math.random() * 50 - 25) + "px";
      p.style.top = y + (Math.random() * 20 - 10) + "px";
      p.style.animationDelay = i * 90 + "ms";
      if (s === "✚") p.style.color = "#4ade80";
      stage.appendChild(p);
      setTimeout(() => p.remove(), 1700 + i * 90);
    });
  }
  function playFx(m) {
    const a = ACTS.find((x) => x.id === m.act);
    logLine(t("sc.l." + m.act, { a: m.a, b: m.b }));
    const stage = $("#camp-stage");
    if (!a || !stage) return;
    const src = seatEl(m.from), dst = m.to ? seatEl(m.to) : null;
    if (!src) return;
    const sr = stage.getBoundingClientRect();
    const c = (el) => { const r = el.getBoundingClientRect(); return [r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2 - 18]; };
    const [sx, sy] = c(src);
    if (!dst) {
      src.animate(m.act === "dance" ? [{ transform: "translate(-50%,-50%) rotate(0)" }, { transform: "translate(-50%,-50%) rotate(-12deg)" }, { transform: "translate(-50%,-50%) rotate(12deg)" }, { transform: "translate(-50%,-50%) rotate(0)" }]
        : [{ transform: "translate(-50%,-50%) scale(1)" }, { transform: "translate(-50%,-50%) scale(1.12)" }, { transform: "translate(-50%,-50%) scale(1)" }], { duration: 700, iterations: m.act === "dance" ? 2 : 1 });
      burst(stage, sx, sy - 20, a.fx);
      return;
    }
    const [dx, dy] = c(dst);
    // подбегает к цели и возвращается
    const mx = (dx - sx) * 0.62, my = (dy - sy) * 0.62;
    src.animate([{ transform: "translate(-50%,-50%)" }, { transform: `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`, offset: 0.45 },
      { transform: `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`, offset: 0.6 }, { transform: "translate(-50%,-50%)" }], { duration: 900, easing: "ease-in-out" });
    setTimeout(() => {
      burst(stage, dx, dy - 10, a.fx, a.hit);
      if (a.hit) dst.animate([{ transform: "translate(-50%,-50%)" }, { transform: "translate(calc(-50% - 7px),-50%) rotate(-8deg)" }, { transform: "translate(calc(-50% + 6px),-50%) rotate(6deg)" }, { transform: "translate(-50%,-50%)" }], { duration: 380 });
      if (a.heal) dst.animate([{ filter: "drop-shadow(0 0 0 #4ade80)" }, { filter: "drop-shadow(0 0 18px #4ade80)" }, { filter: "drop-shadow(0 0 0 #4ade80)" }], { duration: 1000 });
    }, 420);
  }
  const lines = [];
  function logLine(s) {
    lines.push(s);
    if (lines.length > 4) lines.shift();
    const el = $("#camp-log");
    if (el) el.innerHTML = lines.map((x) => `<div>${esc(x)}</div>`).join("");
  }

  // ---------------------------------------------------------------- клики
  document.addEventListener("click", async (e) => {
    const md = e.target.closest("[data-scmode]");
    if (md) { send({ t: "sc_set", mode: md.dataset.scmode, title: $("#sc-title")?.value || "" }); return; }
    const g = e.target.closest("[data-scgm]");
    if (g) {
      const k = g.dataset.scgm;
      if (k === "people") peopleDialog();
      if (k === "call") { send({ t: "sc_set", title: $("#sc-title")?.value || "", call: true }); MC.toast(t("sc.called"), "ok"); }
      if (k === "say" && SC.say?.key) send({ t: "sc_say", key: SC.say.key, text: $("#sc-line")?.value || "" });
      if (k === "say" && !SC.say?.key) MC.toast(t("sc.pick_speaker"), "warn");
      if (k === "hush") send({ t: "sc_say", key: "" });
      return;
    }
    const nb = e.target.closest("[data-scnote]");
    if (nb) { const m = SC.members.find((x) => x.key === nb.dataset.scnote); if (m) MC.Notes?.edit(null, m); return; }
    const card = e.target.closest(".talk-card[data-sckey]");
    if (card) {
      const m = SC.members.find((x) => x.key === card.dataset.sckey);
      if (!m) return;
      if (gm()) send({ t: "sc_say", key: SC.say?.key === m.key ? "" : m.key, text: SC.say?.key === m.key ? "" : $("#sc-line")?.value || "" });
      else if (canAct(m)) send({ t: "sc_say", key: SC.say?.key === m.key ? "" : m.key, text: "" });
      return;
    }
    const seat = e.target.closest(".camp-seat[data-sckey]");
    if (seat) {
      const m = SC.members.find((x) => x.key === seat.dataset.sckey);
      if (!m) return;
      if (!sel) {
        if (!canAct(m)) { MC.toast(t("sc.not_yours"), "warn"); return; }
        // свой единственный персонаж — сразу «кто делает»
        sel = m.key; render();
        return;
      }
      const src = SC.members.find((x) => x.key === sel);
      if (sel === m.key) { actMenu(src, null, seatEl(m.key)); return; }
      actMenu(src, m, seatEl(m.key));
    }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "sc-title") send({ t: "sc_set", title: e.target.value }); });
  function send(o) { MC.request(o).catch((er) => MC.toast(t(er.code ? "err." + er.code : "conn.offline"), "warn")); }

  // ---------------------------------------------------------------- мастер: кто в сцене
  async function peopleDialog() {
    const chars = [...MC.state.chars.values()];
    const pids = new Set(MC.state.players.map((p) => p.id));
    const pcs = chars.filter((c) => pids.has(c.owner)), npcChars = chars.filter((c) => !pids.has(c.owner));
    const toks = (MC.Map?.map?.tokens || []).filter((x) => !x.char);
    const mons = MC.GM?.monsters || [];
    const cur = new Map((SC.npcRefs || []).map((r) => [JSON.stringify(r), r]));
    const pcSel = new Set(SC.pcs || []);
    const keyOf = (r) => JSON.stringify(r);
    const chip = (r, label) => `<label class="check sc-pick"><input type="checkbox" data-ref='${esc(keyOf(r))}' ${cur.has(keyOf(r)) ? "checked" : ""}> ${esc(label)}</label>`;
    const v = await MC.modal({ title: t("sc.people"), wide: true, body: `
      ${SC.mode === "talk" ? `<h4>${t("sc.p.pcs")}</h4><div class="sc-picks">${pcs.map((c) => `<label class="check sc-pick"><input type="checkbox" data-pc="${c.id}" ${pcSel.has(c.id) || !SC.pcs?.length ? "checked" : ""}> ${esc(c.name)}</label>`).join("") || `<span class="muted small">—</span>`}</div>`
    : `<p class="muted small">${t("sc.p.camp_hint")}</p>`}
      <h4>${t("sc.p.npc_chars")}</h4><div class="sc-picks">${npcChars.map((c) => chip({ t: "char", id: c.id }, c.name)).join("") || `<span class="muted small">—</span>`}</div>
      <h4>${t("sc.p.tokens")}</h4><div class="sc-picks">${toks.map((x) => chip({ t: "tok", map: MC.Map.map.id, id: x.id }, x.name || "?")).join("") || `<span class="muted small">—</span>`}</div>
      <h4>${t("sc.p.bestiary")}</h4><div class="sc-picks sc-mons">${mons.map((m) => chip({ t: "mon", id: m.id }, m.name)).join("") || `<span class="muted small">—</span>`}</div>
      <h4>${t("sc.p.free")}</h4><div class="sc-free">${[...cur.values()].filter((r) => r.t === "free").map((r) => chip(r, r.name)).join("")}
        <input id="sc-free" placeholder="${esc(t("sc.p.free_ph"))}" maxlength="40"></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => {
        const npcs = [...w.querySelectorAll("[data-ref]:checked")].map((x) => JSON.parse(x.dataset.ref));
        const free = w.querySelector("#sc-free").value.trim();
        if (free) npcs.push({ t: "free", name: free });
        return { npcs, pcs: [...w.querySelectorAll("[data-pc]:checked")].map((x) => x.dataset.pc) };
      } }] });
    if (!v) return;
    SC.npcRefs = v.npcs; SC.pcs = v.pcs;
    send({ t: "sc_set", npcs: v.npcs, pcs: v.pcs });
  }

  // ---------------------------------------------------------------- сообщения
  MC.on("msg_scene", (m) => {
    const was = SC.mode;
    Object.assign(SC, { mode: m.mode || "off", members: m.members || [], say: m.say || null, title: m.title || "", met: m.met || [], npcRefs: m.refs || [], pcs: m.pcs || [] });
    if (sel && !SC.members.some((x) => x.key === sel)) sel = null;
    syncTab();
    if (here()) {
      const ae = document.activeElement;
      if (!(ae && ["sc-title", "sc-line"].includes(ae.id))) render();
    }
    if (!gm() && was === "off" && SC.mode !== "off" && !MC.pop) MC.toast(t("sc.started." + SC.mode), "ok", "crit");
    MC.emit("scene");
  });
  MC.on("msg_sc_fx", (m) => { if (here()) playFx(m); });
  MC.on("msg_sc_call", (m) => {
    if (gm() || MC.pop || m.mode === "off") return;
    if (MC.Combat?.state?.active) return;          // в бою не уводим со стола
    goTab("camp");
    try { navigator.vibrate?.([60, 40, 60]); } catch { /* ignore */ }
  });
  MC.on("welcome", async () => {
    try {
      const r = await MC.request({ t: "sc_get" });
      // мастеру — ссылки для окна «кто в сцене» хранятся на сервере, восстанавливаем по ключам
      Object.assign(SC, { mode: r.mode, members: r.members || [], say: r.say, title: r.title || "", met: r.met || [], npcRefs: r.refs || [], pcs: r.pcs || [] });
    } catch { /* старый сервер */ }
    syncTab();
    if (here()) render();
  });
  MC.on("tab", (tab) => { if (tab === "camp") render(); else { $("#sc-menu")?.remove(); sel = null; } });
  MC.on("lang", () => { syncTab(); if (here()) render(); });
  // портреты/имена персонажей поменялись — обновим сцену (не чаще раза в 2 с)
  let charsTimer = 0;
  MC.on("chars", () => {
    if (!here() || SC.mode === "off" || charsTimer) return;
    charsTimer = setTimeout(() => { charsTimer = 0; MC.send({ t: "sc_get" }); }, 2000);
  });
  // ---------------------------------------------------------------- костёр: живое пламя на холсте
  // Частицы огня рисуются со сложением цветов («lighter»): от белого ядра к жёлтому, оранжевому, красному,
  // сверху — дымок, вокруг — искры, которые вылетают и гаснут. Анимация идёт, только пока костёр виден.
  const fire = { parts: [], sparks: [], smoke: [], raf: 0, last: 0, logs: null };
  const FIRE_COLS = [[255, 255, 235], [255, 236, 150], [255, 180, 60], [255, 110, 25], [220, 50, 15], [90, 20, 10]];
  const fcol = (k, a) => {
    const t3 = Math.min(FIRE_COLS.length - 1.001, k * (FIRE_COLS.length - 1)), i = Math.floor(t3), f = t3 - i;
    const A = FIRE_COLS[i], B = FIRE_COLS[i + 1];
    return `rgba(${Math.round(A[0] + (B[0] - A[0]) * f)},${Math.round(A[1] + (B[1] - A[1]) * f)},${Math.round(A[2] + (B[2] - A[2]) * f)},${a})`;
  };
  function drawLogs(x) {
    // поленья и угли (рисуются один раз в отдельный холст)
    const c = document.createElement("canvas"); c.width = 200; c.height = 260;
    const g = c.getContext("2d");
    const log = (cx, cy, len, ang, w) => {
      g.save(); g.translate(cx, cy); g.rotate(ang);
      const gr = g.createLinearGradient(0, -w / 2, 0, w / 2); gr.addColorStop(0, "#7a4a24"); gr.addColorStop(0.5, "#5a3418"); gr.addColorStop(1, "#2e1a0c");
      g.fillStyle = gr; g.beginPath(); g.roundRect(-len / 2, -w / 2, len, w, w / 2); g.fill();
      g.fillStyle = "#a8743f"; g.beginPath(); g.ellipse(len / 2 - 2, 0, 4, w / 2 - 1, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(255,120,40,.55)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-len / 4, w / 2 - 2); g.lineTo(len / 5, w / 2 - 3); g.stroke();
      g.restore();
    };
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.fillStyle = "#3d3a36"; g.beginPath(); g.ellipse(100 + Math.cos(a) * 46, 222 + Math.sin(a) * 13, 9, 6, 0, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.ellipse(98 + Math.cos(a) * 46, 220 + Math.sin(a) * 13, 5, 3, 0, 0, 7); g.fill(); }
    const em = g.createRadialGradient(100, 220, 2, 100, 220, 40); em.addColorStop(0, "rgba(255,170,60,.95)"); em.addColorStop(0.5, "rgba(200,60,20,.6)"); em.addColorStop(1, "rgba(60,20,10,0)");
    g.fillStyle = em; g.beginPath(); g.ellipse(100, 220, 40, 14, 0, 0, 7); g.fill();
    log(88, 214, 84, -0.32, 15); log(112, 214, 84, 0.32, 15); log(100, 222, 76, 0.04, 13);
    return c;
  }
  function fireStep(now) {
    fire.raf = 0;
    const cv = document.querySelector(".campfire .cf-cv");
    if (!cv || !cv.isConnected || cv.offsetParent === null) return;          // не видно — спим, разбудит смена вкладки
    if (document.hidden) { setTimeout(SC.fireKick, 500); return; }
    const g = cv.getContext("2d");
    const dt = Math.min(0.05, (now - fire.last) / 1000 || 0.016); fire.last = now;
    if (!fire.logs) fire.logs = drawLogs();
    // языки пламени: несколько «капель» с градиентом, высота и изгиб дрожат по шуму — без белого пятна
    if (Math.random() < dt * 9) fire.sparks.push({ x: 100 + (Math.random() - 0.5) * 30, y: 180, vx: (Math.random() - 0.5) * 40, vy: -(80 + Math.random() * 100), age: 0, life: 0.7 + Math.random() * 1.1, ph: Math.random() * 6 });
    if (Math.random() < dt * 4) fire.smoke.push({ x: 100 + (Math.random() - 0.5) * 16, y: 105, vx: (Math.random() - 0.5) * 10, vy: -(20 + Math.random() * 12), r: 9, age: 0, life: 2.4 + Math.random() });
    g.clearRect(0, 0, cv.width, cv.height);
    fire.smoke = fire.smoke.filter((q) => (q.age += dt) < q.life);
    for (const q of fire.smoke) {
      const k = q.age / q.life; q.x += (q.vx + Math.sin(now / 900 + q.age) * 8) * dt; q.y += q.vy * dt;
      g.fillStyle = `rgba(70,66,62,${0.1 * Math.sin(k * Math.PI)})`; g.beginPath(); g.arc(q.x, q.y, q.r + k * 24, 0, 7); g.fill();
    }
    g.drawImage(fire.logs, 0, 0);
    const T = now / 1000;
    const nz = (x) => Math.sin(x) * 0.5 + Math.sin(x * 2.3 + 1.7) * 0.3 + Math.sin(x * 5.1 + 0.4) * 0.2;
    const tongue = (cx, base, w, h, lean, cols, alpha) => {
      const tipX = cx + lean, tipY = base - h;
      g.beginPath();
      g.moveTo(cx - w, base);
      g.bezierCurveTo(cx - w * 1.05, base - h * 0.45, tipX - w * 0.35, tipY + h * 0.3, tipX, tipY);
      g.bezierCurveTo(tipX + w * 0.35, tipY + h * 0.3, cx + w * 1.05, base - h * 0.45, cx + w, base);
      g.quadraticCurveTo(cx, base + w * 0.35, cx - w, base);
      const gr = g.createLinearGradient(0, base, 0, tipY);
      gr.addColorStop(0, cols[0]); gr.addColorStop(0.35, cols[1]); gr.addColorStop(0.75, cols[2]); gr.addColorStop(1, "rgba(180,30,10,0)");
      g.globalAlpha = alpha; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
    };
    g.globalCompositeOperation = "lighter";
    // внешнее пламя (красно-оранжевое), затем среднее, затем ядро (жёлтое, не белое)
    const OUT = ["rgba(255,120,30,.9)", "rgba(240,80,20,.75)", "rgba(190,40,10,.45)"];
    const MID = ["rgba(255,190,70,.95)", "rgba(255,140,40,.8)", "rgba(230,70,20,.35)"];
    const CORE = ["rgba(255,236,170,.95)", "rgba(255,200,90,.8)", "rgba(255,140,40,.25)"];
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * 11, ph = i * 1.9;
      tongue(100 + off, 214, 15 - Math.abs(i - 2) * 2, 70 + nz(T * 3.1 + ph) * 22 - Math.abs(i - 2) * 10, nz(T * 2.2 + ph) * 12 + off * 0.25, OUT, 0.55);
    }
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 9, ph = i * 2.7 + 5;
      tongue(100 + off, 214, 11, 52 + nz(T * 3.7 + ph) * 16, nz(T * 2.8 + ph) * 8, MID, 0.6);
    }
    tongue(100, 214, 9, 30 + nz(T * 4.3) * 8, nz(T * 3.3 + 2) * 4, CORE, 0.7);
    // мелкие отрывающиеся языки
    if (Math.random() < dt * 14) fire.parts.push({ x: 100 + (Math.random() - 0.5) * 34, y: 160 - Math.random() * 20, vx: (Math.random() - 0.5) * 10, vy: -(50 + Math.random() * 40), r: 5 + Math.random() * 5, age: 0, life: 0.35 + Math.random() * 0.3, ph: Math.random() * 6 });
    fire.parts = fire.parts.filter((q) => (q.age += dt) < q.life);
    for (const q of fire.parts) {
      const k = q.age / q.life;
      q.x += (q.vx + Math.sin(q.age * 9 + q.ph) * 14) * dt; q.y += q.vy * dt;
      g.fillStyle = fcol(0.35 + k * 0.5, 0.35 * (1 - k));
      g.beginPath(); g.ellipse(q.x, q.y, q.r * (1 - k * 0.6) * 0.7, q.r * (1 - k * 0.5), 0, 0, 7); g.fill();
    }
    fire.sparks = fire.sparks.filter((q) => (q.age += dt) < q.life);
    for (const q of fire.sparks) {
      const k = q.age / q.life; q.x += (q.vx + Math.sin(q.age * 7 + q.ph) * 30) * dt; q.y += q.vy * dt; q.vy += 40 * dt;
      g.fillStyle = fcol(0.25 + k * 0.6, (1 - k) * (0.6 + 0.4 * Math.sin(q.age * 40 + q.ph)));
      g.beginPath(); g.arc(q.x, q.y, 1.6 * (1 - k * 0.5), 0, 7); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    fire.raf = requestAnimationFrame(fireStep);
  }
  /** Запустить костёр (после каждой перерисовки привала). */
  SC.fireKick = () => { if (!fire.raf && document.querySelector(".campfire .cf-cv")) fire.raf = requestAnimationFrame(fireStep); };
  new MutationObserver(() => SC.fireKick()).observe(document.body, { childList: true, subtree: true });
  MC.on("tab", () => setTimeout(SC.fireKick, 50));
})();
