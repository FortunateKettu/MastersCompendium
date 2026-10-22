// Masters Compendium — веб-клиент: экраны, вкладки, список персонажей, партия, режим мастера.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, $$, t, esc } = MC;
  const R = MC.R;

  const COLORS = ["#8b5cf6", "#3d6df2", "#10b981", "#f59e0b", "#ef4444",
                  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#a3a3a3"];

  // ---------------------------------------------------------------- вход мастера по ключу из программы
  const params = new URLSearchParams(location.search);
  if (params.get("gm")) {
    MC.session.set("gm_key", params.get("gm"));
    history.replaceState(null, "", MC.popPath());
  }
  if (MC.pop) document.body.classList.add("pop", "pop-" + MC.pop.kind);
  if (["ru", "en"].includes(params.get("lang"))) MC.setLang(params.get("lang"));

  // ---------------------------------------------------------------- язык
  // статичные иконки разметки: <i data-ic="map"></i>
  $$("[data-ic]").forEach((el) => { el.outerHTML = MC.icon(el.dataset.ic, el.dataset.cls || ""); });

  function applyLang() {
    document.documentElement.lang = MC.lang;
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$("[data-lang-toggle]").forEach((b) => { b.textContent = MC.lang === "ru" ? "EN" : "RU"; });
    renderConn(); renderHeader(); renderParty(); renderChars(); MC.Dice.renderTab();
  }
  $$("[data-lang-toggle]").forEach((b) => b.addEventListener("click", () => MC.setLang(MC.lang === "ru" ? "en" : "ru")));
  MC.on("lang", applyLang);

  // ---------------------------------------------------------------- экраны
  function show(id) { ["scr-join", "scr-game", "scr-msg"].forEach((s) => { $("#" + s).hidden = s !== id; }); }
  function showMsg(titleKey, textKey, again = true) {
    $("#msg-title").textContent = t(titleKey);
    $("#msg-text").textContent = t(textKey);
    $("#btn-again").hidden = !again;
    show("scr-msg");
  }

  // ---------------------------------------------------------------- вход игрока
  let color = MC.store.get("color") || COLORS[Math.floor(Math.random() * COLORS.length)];
  let joining = false;
  function renderSwatches() {
    const box = $("#swatches");
    box.innerHTML = "";
    COLORS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (c === color ? " sel" : "");
      b.style.background = c;
      b.setAttribute("aria-label", c);
      b.addEventListener("click", () => { color = c; renderSwatches(); });
      box.appendChild(b);
    });
  }
  function joinError(key) {
    const el = $("#join-error");
    if (!key) { el.hidden = true; return; }
    el.textContent = t(key);
    el.hidden = false;
  }
  function setJoining(on) {
    joining = on;
    const b = $("#btn-join");
    b.disabled = on;
    b.textContent = t(on ? "join.connecting" : "join.go");
  }
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (joining) return;
    const name = $("#in-name").value.trim();
    const code = $("#in-code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!name) { joinError("err.bad_name"); $("#in-name").focus(); return; }
    if (!code) { joinError("err.bad_code"); $("#in-code").focus(); return; }
    joinError(null);
    MC.store.set("name", name);
    MC.store.set("color", color);
    setJoining(true);
    MC.connect({ t: "join", name, code, color });
  });
  MC.on("join_error", (code) => { setJoining(false); joinError("err." + code); });
  MC.on("join_failed", () => { if (joining) { setJoining(false); if ($("#join-error").hidden) joinError("err.no_server"); } });
  MC.on("auth_failed", (code) => {
    if (code === "bad_gm_key") { showMsg("err.bad_gm_key", "bye.text", false); return; }
    prefillJoin(); joinError("err.old_session"); show("scr-join");
  });

  function prefillJoin() {
    $("#in-name").value = MC.store.get("name", "");
    const code = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
    if (code) $("#in-code").value = code;
  }

  // ---------------------------------------------------------------- после входа
  MC.on("welcome", () => {
    setJoining(false);
    joinError(null);
    if (location.search) history.replaceState(null, "", MC.popPath());
    document.body.classList.toggle("gm", MC.isGM());
    renderHeader(); renderParty(); renderChars();
    show("scr-game");
    if (MC.pop) openPop();
    R.load().then(() => { renderChars(); if (MC.Sheet.cur.id) MC.Sheet.render(); }).catch(() => {});
  });
  MC.on("conn", renderConn);
  MC.on("rtt", renderConn);
  MC.on("players", () => { renderParty(); renderHeader(); });
  MC.on("dice_styles", renderParty);
  MC.on("campaign", renderHeader);
  MC.on("chars", () => { renderParty(); renderChars(); if (MC.pop) renderHeader(); hpGlow(); });

  // ---------------------------------------------------------------- урон / лечение своего персонажа: свечение по краям экрана
  const lastHp = new Map();
  function hpGlow() {
    if (MC.isGM() || MC.pop) return;
    const me = MC.state.me;
    let kind = "";
    for (const c of MC.state.chars.values()) {
      if (c.owner !== me?.id || !c.hp) continue;
      const v = MC.int(c.hp.cur) + MC.int(c.hp.temp);
      const was = lastHp.get(c.id);
      lastHp.set(c.id, v);
      if (was == null || was === v) continue;
      kind = v < was ? "hurt" : "heal";
    }
    if (!kind) return;
    let el = $("#hp-glow");
    if (!el) { el = document.createElement("div"); el.id = "hp-glow"; document.body.appendChild(el); }
    el.className = "";
    void el.offsetWidth;          // перезапуск анимации
    el.className = kind;
    if (kind === "hurt") try { navigator.vibrate?.(120); } catch { /* ignore */ }
  }
  MC.on("kicked", () => showMsg("kicked.title", "kicked.text"));
  MC.on("bye", () => showMsg("bye.title", "bye.text"));

  function renderConn() {
    const c = MC.state.conn;
    const dot = $("#conn-dot"), txt = $("#conn-text"), banner = $("#banner");
    if (!dot) return;
    dot.className = "dot" + (c === "on" ? " on" : c === "wait" ? " wait" : "");
    const rtt = MC.state.rtt;
    txt.textContent = t(c === "on" ? "conn.online" : c === "wait" ? "conn.reconnecting" : "conn.offline")
      + (c === "on" && rtt != null ? ` · ${rtt} ${t("conn.ms")}` : "");
    txt.classList.toggle("warn-text", c === "on" && rtt > 400);
    dot.classList.toggle("slow", c === "on" && rtt > 400);
    banner.hidden = c === "on" || $("#scr-game").hidden;
    banner.textContent = t(c === "wait" ? "conn.reconnecting" : "conn.offline");
  }
  // ---------------------------------------------------------------- отдельное окно
  let popDone = false;
  async function openPop() {
    const p = MC.pop;
    if (p.kind === "sheet") { if (!popDone || !MC.Sheet.cur.id) openSheet(p.id); $("#char-back").hidden = true; }
    if (p.kind === "combat") go("combat");
    if (p.kind === "log") go("dice");
    if (p.kind === "mon") { go("pop"); renderPopMon(); }
    popDone = true;
    renderHeader();
  }
  async function renderPopMon() {
    const box = $("#tab-pop");
    if (!MC.isGM()) { box.innerHTML = `<p class="muted center">${t("err.no_access")}</p>`; return; }
    try {
      MC.Statblock.forget(MC.pop.id);
      const m = await MC.Statblock.get(MC.pop.id);
      box.innerHTML = `<div class="card glass pop-sb">${MC.Statblock.html(m)}</div>`;
      renderHeader();
    } catch { box.innerHTML = `<p class="muted center">${t("err.not_found")}</p>`; }
  }
  MC.on("msg_monsters", () => { if (MC.pop?.kind === "mon" && MC.isGM()) renderPopMon(); });
  function popTitle() {
    const p = MC.pop;
    if (p.kind === "sheet") return MC.state.chars.get(p.id)?.name || t("tab.character");
    if (p.kind === "mon") return MC.Statblock.peek?.(p.id)?.name || t("gm.bestiary");
    if (p.kind === "log") return t("dice.log");
    return t("tab.combat");
  }

  function renderHeader() {
    const s = MC.state;
    $("#game-campaign").textContent = s.campaign ? s.campaign.name : "";
    document.title = MC.pop ? popTitle() + " · " + (s.campaign ? s.campaign.name : "Masters Compendium")
      : (s.campaign ? s.campaign.name + " · " : "") + "Masters Compendium";
    const chip = $("#me-chip");
    chip.innerHTML = "";
    if (s.me) {
      const i = document.createElement("i");
      i.style.background = s.me.color;
      chip.append(i, document.createTextNode(MC.isGM() ? t("gm.badge") : s.me.name));
    }
  }

  // ---------------------------------------------------------------- партия
  const hpBar = (c) => {
    const max = MC.int(c.hp?.max, 0), cur = MC.int(c.hp?.cur, 0);
    const pct = max ? MC.clamp(cur / max * 100, 0, 100) : 0;
    return `<div class="mini-hp"><div class="bar"><i style="width:${pct}%" class="${pct < 30 ? "low" : pct < 60 ? "mid" : ""}"></i></div><span>${cur}/${max}${c.hp?.temp ? ` +${c.hp.temp}` : ""}</span></div>`;
  };
  const classLine = (c) => (c.classes || []).map((k) => `${R.srd ? R.className(k) : k.name || k.id} ${k.level}`).join(" / ");
  const avatar = (c, color) => c.portrait ? `<img class="avatar" src="${esc(c.portrait)}" alt="">`
    : `<div class="avatar" style="background:${esc(color)}">${esc((c.name || "?").trim().charAt(0).toUpperCase())}</div>`;

  function renderParty() {
    const ul = $("#players");
    if (!ul) return;
    const s = MC.state;
    const chars = [...s.chars.values()];
    const list = [...s.players].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    ul.innerHTML = list.map((p) => {
      const mine = chars.filter((c) => c.owner === p.id);
      const you = s.me && p.id === s.me.id;
      return `<li class="player ${p.online ? "" : "off"}">
        <div class="pl-head">
          <div class="avatar" style="background:${esc(p.color)}">${esc((p.name || "?").charAt(0).toUpperCase())}</div>
          <div class="pl-who"><div class="nm">${esc(p.name)} ${you ? `<span class="tag">${t("party.you")}</span>` : ""}</div>
          <div class="st"><span class="dot ${p.online ? "on" : ""}"></span>${t(p.online ? "party.online" : "party.offline")}</div></div>
          ${MC.isGM() ? `<button class="btn small ds-btn" data-dstyle="${esc(p.id)}" title="${esc(t("ds.title"))}">${MC.Dice.styleChip(MC.Dice.styleOf(p))} ${t("ds.dice")}</button>`
    : you ? `<span class="ds-mine" title="${esc(t("ds.mine"))}">${MC.Dice.styleChip(MC.Dice.styleOf(p))}</span>` : ""}
        </div>
        ${mine.length ? mine.map((c) => `<div class="pl-char" ${MC.isGM() || you ? `data-open="${c.id}"` : ""}>${avatar(c, p.color)}
          <div class="pc-info"><b>${esc(c.name)}</b><span class="muted small">${esc(classLine(c))}</span>${hpBar(c)}
          ${c.conditions?.length && R.srd ? `<span class="small bad-text">${c.conditions.map((x) => esc(MC.L(R.srd.cond[x]))).join(", ")}</span>` : ""}</div></div>`).join("")
    : `<div class="muted small pl-none">${t("party.nochar")}</div>`}
      </li>`;
    }).join("");
    if (MC.isGM()) {
      ul.insertAdjacentHTML("afterbegin", `<li class="player"><div class="pl-head"><div class="avatar" style="background:#f5c542">${MC.icon("crown")}</div>
        <div class="pl-who"><div class="nm">${t("ds.gm_name")} <span class="tag">${t("party.you")}</span></div><div class="st muted">${t("ds.gm_hint")}</div></div>
        <button class="btn small ds-btn" data-dstyle="gm" title="${esc(t("ds.title"))}">${MC.Dice.styleChip(MC.Dice.styleOf({ id: "gm" }))} ${t("ds.dice")}</button></div></li>`);
    }
    const npcs = chars.filter((c) => !c.owner || !s.players.some((p) => p.id === c.owner));
    if (MC.isGM() && npcs.length) {
      ul.innerHTML += `<li class="player"><div class="pl-head"><div class="avatar" style="background:#f5c542">${MC.icon("crown")}</div><div class="nm">${t("chars.npc")}</div></div>
        ${npcs.map((c) => `<div class="pl-char" data-open="${c.id}">${avatar(c, "#555")}<div class="pc-info"><b>${esc(c.name)}</b><span class="muted small">${esc(classLine(c))}</span>${hpBar(c)}</div></div>`).join("")}</li>`;
    }
  }

  // ---------------------------------------------------------------- правая кнопка по персонажу
  async function withSheet(id, fn) {
    MC.emit("open_sheet", { id });
    for (let i = 0; i < 40 && !(MC.Sheet.cur.id === id && MC.Sheet.doc()); i++) await new Promise((r) => setTimeout(r, 50));
    const doc = MC.Sheet.doc();
    if (doc && doc.id === id) fn(doc);
  }
  MC.ctxAdd("[data-open]", (el) => {
    const c = MC.state.chars.get(el.dataset.open);
    if (!c) return null;
    const g = MC.isGM(), mine = g || c.owner === MC.state.me?.id;
    if (!mine) return null;
    const act = (k) => () => withSheet(c.id, (doc) => MC.Sheet.charAction(k, doc));
    const items = [
      { ic: "character", label: t("ctx.open"), fn: () => MC.emit("open_sheet", { id: c.id }) },
      { ic: "edit", label: t("ctx.edit_sheet"), fn: () => MC.emit("open_sheet", { id: c.id, editing: true }) },
      { sep: true },
      { ic: "short-rest", label: t("sh.short_rest"), fn: act("short") },
      { ic: "long-rest", label: t("sh.long_rest"), fn: act("long") },
      { ic: "download", label: t("sh.download"), fn: act("download") },
    ];
    if (g) {
      items.push({ sep: true });
      if (MC.Money?.giveDialog) items.push({ ic: "inventory", label: t("ctx.give"), fn: () => MC.Money.giveDialog([c.id]) });
      if (MC.Xp?.allow && c.owner) items.push({ ic: "level-up", label: t("xp.allow"), fn: () => MC.Xp.allow(c.id) });
      items.push({ ic: "user", label: t("sh.assign"), fn: act("assign") });
    }
    items.push({ ic: "trash", label: t("sh.delete"), bad: true, fn: act("delete") });
    return { items, title: c.name };
  });

  // ---------------------------------------------------------------- персонажи
  function myChars() {
    const s = MC.state;
    const all = [...s.chars.values()];
    return MC.isGM() ? all : all.filter((c) => c.owner === s.me?.id);
  }

  function renderChars() {
    const root = $("#sheet-root");
    if (!root || MC.Sheet.cur.id || $(".wizard")) return;
    const list = myChars();
    const s = MC.state;
    const ownerName = (c) => s.players.find((p) => p.id === c.owner)?.name || t("chars.npc");
    const cards = list.map((c) => `<button class="char-card card glass" data-open="${c.id}">
        ${avatar(c, s.players.find((p) => p.id === c.owner)?.color || "#8b5cf6")}
        <div class="pc-info"><b>${esc(c.name)}</b><span class="muted small">${esc(classLine(c))}</span>
        ${MC.isGM() ? `<span class="muted small with-ic">${MC.icon("user", "sm")} ${esc(ownerName(c))}</span>` : ""}${hpBar(c)}</div></button>`).join("");
    const actions = `<div class="new-char">
        <button class="tile" data-new="wizard"><span class="tile-ic">${MC.icon("wand")}</span><b>${t("chars.wizard")}</b><small>${t("chars.wizard.d")}</small></button>
        <button class="tile" data-new="blank"><span class="tile-ic">${MC.icon("file-new")}</span><b>${t("chars.blank")}</b><small>${t("chars.blank.d")}</small></button>
        <button class="tile" data-new="upload"><span class="tile-ic">${MC.icon("upload")}</span><b>${t("chars.upload")}</b><small>${t("chars.upload.d")}</small></button>
        <button class="tile" data-new="creator"><span class="tile-ic">${MC.icon("download")}</span><b>${t("chars.creator")}</b><small>${t("chars.creator.d")}</small></button>
        ${MC.isGM() ? `<button class="tile" data-new="npc"><span class="tile-ic">${MC.icon("ghost")}</span><b>${t("npc.title")}</b><small>${t("npc.tile")}</small></button>` : ""}
      </div>`;
    root.innerHTML = list.length
      ? `<h2 class="section">${t(MC.isGM() ? "chars.all" : "chars.mine")}</h2><div class="char-list">${cards}</div>
         <h2 class="section">${t("chars.new")}</h2>${actions}`
      : `<div class="empty-chars"><div class="soon-ico">${MC.icon("scroll", "huge")}</div><h2>${t("chars.empty")}</h2></div>${actions}`;
  }

  async function uploadCharacter() {
    const f = await MC.pickFile(".character,.json,application/json");
    if (!f) return;
    try {
      let data = JSON.parse(await f.text());
      if (data && data.character) data = data.character;
      if (!data || typeof data !== "object" || !data.abilities) throw new Error("not_a_character");
      const res = await MC.request({ t: "char_create", doc: data });
      openSheet(res.char.id);
    } catch (e) {
      MC.toast(t(e.code ? "err." + e.code : "err.not_a_character"), "bad");
    }
  }

  function openSheet(id, editing = false) {
    go("character");
    MC.Sheet.open(id).then(() => { if (editing) { MC.Sheet.cur.editing = true; MC.Sheet.render(); } });
    $("#char-back").hidden = false;
  }
  function closeSheet() {
    if (MC.pop?.kind === "sheet") return;       // в отдельном окне лист не закрываем
    if ($("#sheet-root .wizard")) $("#sheet-root").innerHTML = "";     // «назад» из мастера создания
    MC.Sheet.close();
    $("#char-back").hidden = true;
    renderChars();
  }
  MC.on("open_sheet", ({ id, editing }) => openSheet(id, editing));
  MC.on("sheet_closed", closeSheet);
  MC.on("doc_removed", (id) => { if (MC.Sheet.cur.id === id) closeSheet(); });
  $("#char-back").addEventListener("click", closeSheet);

  document.addEventListener("click", (e) => {
    const ps = e.target.closest("[data-popsheet]");
    if (ps) { if (MC.popOut("sheet", ps.dataset.popsheet)) closeSheet(); return; }
    const pw = e.target.closest("[data-popwin]");
    if (pw) { MC.popOut(pw.dataset.popwin); return; }
    const o = e.target.closest("[data-open]");
    if (o) { openSheet(o.dataset.open); return; }
    const n = e.target.closest("[data-new]");
    if (n) {
      if (n.dataset.new === "wizard") { $("#char-back").hidden = false; MC.Wizard.start(); }
      if (n.dataset.new === "blank") MC.Wizard.blank();
      if (n.dataset.new === "upload") uploadCharacter();
      if (n.dataset.new === "creator") MC.Creator?.build();
      if (n.dataset.new === "npc") MC.GM.npcCreate();
    }
  });

  // ---------------------------------------------------------------- вкладки
  function go(tab) {
    $$(".tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.go === tab));
    if (!MC.pop) MC.store.set("tab", tab);
    document.body.classList.toggle("on-map", tab === "map");
    if (tab === "dice") MC.Dice.renderTab();
    MC.emit("tab", tab);
  }
  MC.go = go;
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.go === "character" && $(".tab.active")?.dataset.tab === "character" && MC.Sheet.cur.id) closeSheet();
    go(b.dataset.go);
  }));

  $("#btn-leave").addEventListener("click", async () => {
    if (!await MC.confirm(t("leave.confirm"))) return;
    MC.stopConnection();
    MC.store.del("token");
    MC.session.del("gm_key");
    prefillJoin();
    show("scr-join");
  });
  $("#btn-again").addEventListener("click", () => {
    const m = MC.reconnectMessage();
    if (m) { MC.connect(m); return; }
    prefillJoin();
    show("scr-join");
  });

  // ---------------------------------------------------------------- старт
  async function loadInfo() {
    try {
      const info = await (await fetch("/api/info", { cache: "no-store" })).json();
      $("#join-campaign").textContent = info.name || "";
    } catch { $("#join-campaign").textContent = ""; }
  }
  if (!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.matchMedia("(display-mode: standalone)").matches) {
    $("#install-hint").hidden = true;
  }

  renderSwatches();
  prefillJoin();
  go(MC.pop ? { sheet: "character", combat: "combat", log: "dice", mon: "pop" }[MC.pop.kind] : MC.store.get("tab", "character"));
  applyLang();
  loadInfo();
  R.load().catch(() => {});

  const first = MC.reconnectMessage();
  if (first) { show("scr-game"); MC.state.conn = "wait"; renderConn(); MC.connect(first); }
  else { show("scr-join"); if (!$("#in-name").value) $("#in-name").focus(); }
})();
