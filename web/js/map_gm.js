// Masters Compendium — карта, инструменты мастера: карты, картинка и сетка, фишки, зоны тумана
// (прямоугольник, многоугольник, волшебная палочка), режим перемещения фишек.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, $$, t, esc } = MC;
  const M = MC.Map;
  const gm = () => MC.isGM();
  let pendingRender = false, lastMapId = null;
  // отложенную перерисовку делаем после отпускания кнопки мыши — иначе «съедим» клик по кнопке панели
  let ptrDown = false, afterUp = false;
  document.addEventListener("pointerdown", () => { ptrDown = true; }, true);
  document.addEventListener("pointerup", () => { ptrDown = false; if (afterUp) { afterUp = false; setTimeout(renderGM, 0); } });
  document.addEventListener("pointercancel", () => { ptrDown = false; if (afterUp) { afterUp = false; setTimeout(renderGM, 0); } });
  document.addEventListener("focusout", (e) => {
    if (!pendingRender || !e.target.closest?.("#map-gm")) return;
    if (ptrDown) afterUp = true; else setTimeout(renderGM, 0);
  });
  let list = [], panelOpen = MC.store.get("map_gm_open") !== "0", section = MC.store.get("map_gm_sec") || "maps";

  const send = (o) => MC.send(o);
  const req = (o) => MC.request(o).catch((e) => { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; });
  const cur = () => M.map;

  // ---------------------------------------------------------------- загрузка картинки на сервер
  const MAX_SIDE = 4096;
  async function postAsset(blob) {
    const r = await fetch("/api/asset", { method: "POST", body: blob, headers: { "X-MC-Key": MC.session.get("gm_key") || "" } });
    const j = await r.json();
    if (!r.ok || !j.id) throw new Error(j.error || "upload");
    return j;
  }
  async function uploadImage(file, maxSide = MAX_SIDE, withThumb = false) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      let blob = file;
      // большие и «тяжёлые» картинки ужимаем — телефонам так легче
      if (k < 1 || file.size > 3_000_000 || !/png|jpe?g|webp|gif/.test(file.type)) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        blob = await new Promise((ok) => c.toBlob((b) => ok(b), "image/webp", 0.9));
        if (!blob || blob.type !== "image/webp") blob = await new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.9));
      }
      const j = await postAsset(blob);
      // маленькая копия для медленного интернета: игроки видят её сразу, пока грузится полная
      let thumb = "";
      if (withThumb && Math.max(w, h) > 1200) {
        const tk = 1024 / Math.max(w, h);
        const c = document.createElement("canvas");
        c.width = Math.round(w * tk); c.height = Math.round(h * tk);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const tb = await new Promise((ok) => c.toBlob((b) => ok(b), "image/webp", 0.7));
        if (tb) { try { thumb = (await postAsset(tb)).id; } catch { thumb = ""; } }
      }
      return { id: j.id, w, h, scale: k, thumb };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------------------------------------------------------------- новая карта
  async function newMap() {
    let file = null;
    const v = await MC.modal({ title: t("map.new"), wide: true,
      body: `<div class="form-grid">
        <label class="field"><span>${t("map.name")}</span><input name="name" value="${esc(t("map.new.default"))}" autofocus></label>
        <div class="field"><span>${t("map.image")}</span><button type="button" class="btn" id="nm-file">${MC.icon("image", "sm")} ${t("map.pick_image")}</button><small class="muted" id="nm-fname">${t("map.image.hint")}</small></div>
        <label class="field"><span>${t("map.blank.cols")}</span><input name="cols" type="number" min="5" max="200" value="30"></label>
        <label class="field"><span>${t("map.blank.rows")}</span><input name="rows" type="number" min="5" max="200" value="20"></label>
      </div><p class="muted small">${t("map.new.hint")}</p>
      <button type="button" class="btn mg-open" id="nm-gen">${MC.icon("shuffle-map", "sm")} ${t("mg.open")}</button>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("create"), kind: "primary", value: (w) => ({
        name: w.querySelector("[name=name]").value, cols: MC.int(w.querySelector("[name=cols]").value, 30), rows: MC.int(w.querySelector("[name=rows]").value, 20) }) }],
      mount: (m, close) => {
        m.querySelector("#nm-file").addEventListener("click", async () => {
          file = await MC.pickFile("image/*");
          if (file) m.querySelector("#nm-fname").textContent = file.name;
        });
        m.querySelector("#nm-gen").addEventListener("click", () => close("gen"));
      } });
    if (v === "gen") { MC.MapGen?.open(); return; }
    if (!v) return;
    let data;
    if (file) {
      MC.toast(t("map.uploading"), "", "upload");
      try {
        const up = await uploadImage(file, MAX_SIDE, true);
        data = { name: v.name, img: up.id, img_s: up.thumb, iw: up.w, ih: up.h, grid: { on: true, size: Math.max(20, Math.round(up.w / 30)) } };
      } catch (e) { MC.toast(t("map.upload_failed"), "bad"); return; }
    } else {
      const s = 70;
      data = { name: v.name, iw: MC.clamp(v.cols, 5, 200) * s, ih: MC.clamp(v.rows, 5, 200) * s, grid: { on: true, size: s, alpha: 0.22 } };
    }
    const r = await req({ t: "map_new", map: data });
    if (r) { section = "map"; renderGM(); if (file) MC.toast(t("map.grid_hint"), "", "grid"); }
  }

  async function replaceImage() {
    const f = await MC.pickFile("image/*");
    if (!f || !cur()) return;
    MC.toast(t("map.uploading"), "", "upload");
    try {
      const up = await uploadImage(f, MAX_SIDE, true);
      send({ t: "map_set", map: cur().id, fields: { img: up.id, img_s: up.thumb, iw: up.w, ih: up.h } });
    } catch { MC.toast(t("map.upload_failed"), "bad"); }
  }

  // ---------------------------------------------------------------- фишки
  const SIZES = [[0.5, "map.size.tiny"], [1, "map.size.medium"], [2, "map.size.large"], [3, "map.size.huge"], [4, "map.size.garg"]];
  const COLORS = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#06b6d4", "#3d6df2", "#8b5cf6", "#ec4899", "#a3a3a3"];
  function placeSpots(n, s = 1, taken = null) {
    const m = cur();
    const st = $("#map-stage");
    // карта может быть не открыта (мастер на другой вкладке) — тогда ставим в центр карты
    let c = st && st.clientWidth ? M.toWorld(st.clientWidth / 2, st.clientHeight / 2) : { x: m.iw / 2, y: m.ih / 2 };
    if (c.x < 0 || c.y < 0 || c.x > m.iw || c.y > m.ih) c = { x: m.iw / 2, y: m.ih / 2 };
    const cs = (m.grid?.size || 70) * Math.max(1, s);
    taken = taken || takenSet();
    const out = [];
    for (let ring = 0; out.length < n && ring < 30; ring++) {
      for (let dx = -ring; dx <= ring && out.length < n; dx++) {
        for (let dy = -ring; dy <= ring && out.length < n; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const p = M.snap(c.x + dx * cs, c.y + dy * cs, s);
          const key = Math.round(p.x) + ":" + Math.round(p.y);
          if (taken.has(key)) continue;
          taken.add(key);
          out.push(p);
        }
      }
    }
    return out;
  }
  const takenSet = () => new Set((cur()?.tokens || []).map((x) => Math.round(x.x) + ":" + Math.round(x.y)));

  // ---------------------------------------------------------------- добавление фишек: персонажи, бестиарий, группы
  const MON_S = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
  const groups = () => MC.GM?.groups || [];
  const monsters = () => MC.GM?.monsters || [];
  const ownerOf = (c) => MC.state.players.find((p) => p.id === c.owner);
  const charAv = (c) => c.portrait ? `<img src="${esc(c.portrait)}" alt="">` : esc((c.name || "?").trim().charAt(0).toUpperCase());
  const monAv = (x) => `${esc((x.name || "?").charAt(0).toUpperCase())}${x.img ? `<img src="/asset/${esc(x.img)}" alt="" onerror="this.remove()">` : ""}`;
  const classLine = (c) => (c.classes || []).map((k) => `${MC.R.srd ? MC.R.className(k) : k.name || k.id} ${k.level}`).join(" / ");
  function groupLine(g) {
    const pcs = g.members.filter((x) => x.char).length;
    const mons = g.members.filter((x) => x.mon).reduce((s, x) => s + (x.count || 1), 0);
    return [pcs ? t("map.grp.pcs", { n: pcs }) : "", mons ? t("map.grp.mons", { n: mons }) : ""].filter(Boolean).join(" · ") || t("map.grp.empty");
  }

  /** Поставить на текущую карту: [{char} | {mon, count, hidden}]. Персонажи, которые уже на карте, пропускаем. */
  async function spawn(members, opts = {}) {
    const m = cur();
    if (!m) { MC.toast(t("gm.mon.no_map"), "warn"); return 0; }
    const on = new Set((m.tokens || []).map((x) => x.char).filter(Boolean));
    const taken = takenSet();
    let n = 0, skipped = 0;
    for (const it of members) {
      if (it.char) {
        const c = MC.state.chars.get(it.char);
        if (!c) continue;
        if (on.has(c.id)) { skipped++; continue; }
        on.add(c.id);
        const [p] = placeSpots(1, 1, taken);
        send({ t: "tok_add", map: m.id, tok: { name: c.name, char: c.id, owner: c.owner || "", x: p?.x || 0, y: p?.y || 0, s: 1 } });
        n++;
      } else if (it.mon) {
        const mon = monsters().find((x) => x.id === it.mon);
        if (!mon) continue;
        const cnt = MC.clamp(MC.int(it.count, 1), 1, 30);
        const spots = placeSpots(cnt, MON_S[mon.size] || 1, taken);
        const r = await req({ t: "mon_tokens", mon: mon.id, map: m.id, count: cnt, roll_hp: !!opts.roll, hidden: !!(it.hidden || opts.hidden), spots });
        if (r) n += cnt;
      }
    }
    if (n) MC.toast(t("gm.mon.placed", { n }), "ok", "map");
    if (skipped) MC.toast(t("map.grp.skipped", { n: skipped }), "warn");
    return n;
  }
  M.spawn = spawn;

  async function addPicker() {
    const m = cur();
    if (!m) return;
    let filter = MC.store.get("tp_filter") || "all", q = "";
    const sel = new Map();        // ключ строки → {char} | {mon, count} | {grp}
    const onMap = new Set((m.tokens || []).map((x) => x.char).filter(Boolean));
    const rows = () => {
      const qq = q.trim().toLowerCase();
      const ok = (...v) => !qq || v.some((s) => String(s || "").toLowerCase().includes(qq));
      const out = [];
      if (filter === "all" || filter === "groups") groups().filter((g) => ok(g.name)).forEach((g) => out.push({ key: "g:" + g.id, g }));
      if (filter === "all" || filter === "chars") [...MC.state.chars.values()].filter((c) => ok(c.name)).forEach((c) => out.push({ key: "c:" + c.id, c }));
      if (filter === "all" || filter === "mons") monsters().filter((x) => ok(x.name, x.name_en, x.type)).forEach((x) => out.push({ key: "m:" + x.id, x }));
      return out;
    };
    const rowHtml = (r) => {
      const on = sel.has(r.key);
      if (r.g) {
        return `<li class="tp-row ${on ? "on" : ""}" data-tpk="${r.key}"><span class="tp-av grp">${MC.icon("group", "sm")}</span>
          <div class="tp-info"><b>${esc(r.g.name)}</b><span class="muted small">${esc(groupLine(r.g))}</span></div>
          <span class="tp-kind">${t("map.grp.one")}</span><span class="tp-check">${MC.icon("check", "sm")}</span></li>`;
      }
      if (r.c) {
        const busy = onMap.has(r.c.id), o = ownerOf(r.c);
        return `<li class="tp-row ${on ? "on" : ""} ${busy ? "busy" : ""}" ${busy ? "" : `data-tpk="${r.key}"`}><span class="tp-av" style="background:${esc(o?.color || "#555")}">${charAv(r.c)}</span>
          <div class="tp-info"><b>${esc(r.c.name)}</b><span class="muted small">${esc([o ? o.name : t("chars.npc"), classLine(r.c)].filter(Boolean).join(" · "))}</span></div>
          ${busy ? `<span class="tp-kind">${t("map.tp.on_map")}</span>` : `<span class="tp-kind">${t("map.tp.pc")}</span><span class="tp-check">${MC.icon("check", "sm")}</span>`}</li>`;
      }
      const it = sel.get(r.key);
      return `<li class="tp-row ${on ? "on" : ""}" data-tpk="${r.key}"><span class="tp-av mon">${monAv(r.x)}</span>
        <div class="tp-info"><b>${esc(r.x.name)}</b><span class="muted small">${esc([r.x.type, `${t("sb.cr_short")} ${r.x.cr}`].filter(Boolean).join(" · "))} · ${MC.icon("heart", "sm")} ${r.x.hp}</span></div>
        ${on ? `<span class="tp-cnt" data-nostop><button type="button" data-tpc="-1">−</button><b>${it.count}</b><button type="button" data-tpc="1">+</button></span>` : `<span class="tp-kind">${t("map.tp.mon")}</span>`}
        <span class="tp-check">${MC.icon("check", "sm")}</span></li>`;
    };
    const total = () => [...sel.values()].reduce((s, v) => s + (v.count || (v.grp ? groupCount(v.grp) : 1)), 0);
    const groupCount = (id) => { const g = groups().find((x) => x.id === id); return g ? g.members.reduce((s, x) => s + (x.char ? 1 : x.count || 1), 0) : 0; };
    const chips = [["all", "map.tp.all"], ["chars", "map.tp.chars"], ["mons", "map.tp.mons"], ["groups", "map.tp.groups"]];
    const v = await MC.modal({ title: t("map.tok.add"), wide: true,
      body: `<div class="tp-top"><input type="search" id="tp-q" placeholder="${esc(t("map.tp.search"))}" autofocus>
          <div class="chips tp-chips">${chips.map(([k, l]) => `<button type="button" class="chip ${filter === k ? "on" : ""}" data-tpf="${k}">${t(l)}</button>`).join("")}</div></div>
        <ul class="tp-list" id="tp-list"></ul>
        <div class="tp-opts"><label class="check"><input type="checkbox" id="tp-hidden"> ${t("map.tok.hidden")}</label>
          <label class="check"><input type="checkbox" id="tp-roll" ${MC.store.get("tp_roll") === "1" ? "checked" : ""}> ${t("map.tp.roll")}</label></div>`,
      buttons: [{ label: t("map.tp.custom"), value: "custom" }, { label: t("cancel"), value: null },
        { label: t("map.tp.place"), kind: "primary", value: (w) => ({ items: [...sel.values()], hidden: w.querySelector("#tp-hidden").checked, roll: w.querySelector("#tp-roll").checked }) }],
      mount: (box) => {
        const list = box.querySelector("#tp-list");
        const go = box.querySelector('[data-btn="2"]');
        const refresh = () => {
          const r = rows();
          list.innerHTML = r.map(rowHtml).join("") || `<li class="muted center tp-none">${t(filter === "groups" && !groups().length ? "map.grp.none" : "gm.mon.nothing")}</li>`;
          const n = total();
          go.textContent = n ? `${t("map.tp.place")} · ${n}` : t("map.tp.place");
          go.disabled = !n;
        };
        refresh();
        box.querySelector("#tp-q").addEventListener("input", (e) => { q = e.target.value; refresh(); });
        box.addEventListener("click", (e) => {
          const f = e.target.closest("[data-tpf]");
          if (f) { filter = f.dataset.tpf; MC.store.set("tp_filter", filter); box.querySelectorAll("[data-tpf]").forEach((b) => b.classList.toggle("on", b === f)); refresh(); return; }
          const row = e.target.closest("[data-tpk]");
          if (!row) return;
          const key = row.dataset.tpk;
          const c = e.target.closest("[data-tpc]");
          if (c) { const it = sel.get(key); if (it) it.count = MC.clamp(it.count + MC.int(c.dataset.tpc), 1, 30); refresh(); return; }
          if (e.target.closest("[data-nostop]")) return;
          if (sel.has(key)) sel.delete(key);
          else if (key[0] === "c") sel.set(key, { char: key.slice(2) });
          else if (key[0] === "m") sel.set(key, { mon: key.slice(2), count: 1 });
          else sel.set(key, { grp: key.slice(2) });
          refresh();
        });
      } });
    if (v === "custom") { tokenForm(null); return; }
    if (!v || !v.items.length) return;
    MC.store.set("tp_roll", v.roll ? "1" : "0");
    const items = [];
    for (const it of v.items) {
      if (it.grp) { const g = groups().find((x) => x.id === it.grp); if (g) items.push(...g.members); } else items.push(it);
    }
    spawn(items, { hidden: v.hidden, roll: v.roll });
  }

  // ---------------------------------------------------------------- группы
  async function groupForm(g) {
    const isNew = !g?.id;
    g = MC.clone(g || { name: "", members: [] });
    const chars = [...MC.state.chars.values()].sort((a, b) => (!a.owner - !b.owner) || a.name.localeCompare(b.name));
    const pcSet = new Set(g.members.filter((x) => x.char).map((x) => x.char));
    let mons = g.members.filter((x) => x.mon && monsters().some((y) => y.id === x.mon));
    const monRows = () => mons.map((x, i) => {
      const mm = monsters().find((y) => y.id === x.mon);
      return `<li class="tp-row on"><span class="tp-av mon">${monAv(mm)}</span><div class="tp-info"><b>${esc(mm.name)}</b><span class="muted small">${t("sb.cr_short")} ${esc(mm.cr)}</span></div>
        <span class="tp-cnt"><button type="button" data-gmc="${i}" data-d="-1">−</button><b>${x.count}</b><button type="button" data-gmc="${i}" data-d="1">+</button></span>
        <label class="check small" title="${esc(t("map.tok.hidden"))}"><input type="checkbox" data-gmh="${i}" ${x.hidden ? "checked" : ""}>${MC.icon("hidden", "sm")}</label>
        <button type="button" class="icon-btn small" data-gmd="${i}">${MC.icon("x", "sm")}</button></li>`;
    }).join("") || `<li class="muted small">${t("map.grp.no_mons")}</li>`;
    const v = await MC.modal({ title: isNew ? t("map.grp.new") : g.name, wide: true,
      body: `<div class="form-grid"><label class="field full"><span>${t("map.name")}</span><input name="gname" value="${esc(g.name)}" placeholder="${esc(t("map.grp.name_ph"))}" autofocus></label></div>
        <h4 class="grp-h">${MC.icon("players", "sm")} ${t("map.tp.chars")}</h4>
        <div class="grp-pcs">${chars.map((c) => `<label class="grp-pc ${pcSet.has(c.id) ? "on" : ""}"><input type="checkbox" value="${c.id}" ${pcSet.has(c.id) ? "checked" : ""}>
          <span class="tp-av" style="background:${esc(ownerOf(c)?.color || "#555")}">${charAv(c)}</span><span>${esc(c.name)}</span></label>`).join("") || `<span class="muted small">${t("map.no_pcs")}</span>`}</div>
        <h4 class="grp-h">${MC.icon("skull", "sm")} ${t("map.tp.mons")}</h4>
        <ul class="tp-list grp-mons" id="grp-mons">${monRows()}</ul>
        ${monsters().length ? `<select id="grp-add"><option value="">+ ${esc(t("map.grp.add_mon"))}</option>${monsters().map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.cr)})</option>`).join("")}</select>` : `<p class="muted small">${t("gm.mon.empty")}</p>`}`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "danger", value: "del" }]), { label: t("cancel"), value: null },
        { label: t("save"), kind: "primary", value: (w) => ({ name: w.querySelector("[name=gname]").value.trim() || t("map.grp.default"),
          members: [...[...w.querySelectorAll(".grp-pcs input:checked")].map((x) => ({ char: x.value })), ...mons] }) }],
      mount: (box) => {
        const ul = box.querySelector("#grp-mons");
        box.addEventListener("change", (e) => {
          if (e.target.id === "grp-add" && e.target.value) {
            const ex = mons.find((x) => x.mon === e.target.value);
            if (ex) ex.count = Math.min(30, ex.count + 1); else mons.push({ mon: e.target.value, count: 1, hidden: false });
            e.target.value = ""; ul.innerHTML = monRows();
          }
          if (e.target.dataset.gmh != null) mons[+e.target.dataset.gmh].hidden = e.target.checked;
          if (e.target.closest(".grp-pc")) e.target.closest(".grp-pc").classList.toggle("on", e.target.checked);
        });
        box.addEventListener("click", (e) => {
          const c = e.target.closest("[data-gmc]");
          if (c) { const x = mons[+c.dataset.gmc]; x.count = MC.clamp(x.count + MC.int(c.dataset.d), 1, 30); ul.innerHTML = monRows(); return; }
          const d = e.target.closest("[data-gmd]");
          if (d) { mons.splice(+d.dataset.gmd, 1); ul.innerHTML = monRows(); }
        });
      } });
    if (v === "del") { if (await MC.confirm(t("confirm.delete", { name: g.name }))) req({ t: "grp_del", id: g.id }); return; }
    if (v) { const r = await req({ t: "grp_save", group: { id: g.id, ...v } }); if (r) MC.toast(t("saved"), "ok", "check"); }
  }
  /** Группа из того, что сейчас стоит на карте: персонажи + монстры (по виду, со счётом). */
  function groupFromMap() {
    const m = cur();
    if (!m) return;
    const members = [];
    const counts = new Map();
    for (const x of m.tokens || []) {
      if (x.char && MC.state.chars.has(x.char)) members.push({ char: x.char });
      else if (x.mon) counts.set(x.mon, { mon: x.mon, count: Math.min(30, (counts.get(x.mon)?.count || 0) + 1), hidden: !!x.hidden });
    }
    members.push(...counts.values());
    if (!members.length) { MC.toast(t("map.grp.nothing"), "warn"); return; }
    groupForm({ name: m.name, members });
  }

  function addPCs() {
    const m = cur();
    if (!m) return;
    const on = new Set((m.tokens || []).map((x) => x.char).filter(Boolean));
    const pcs = [...MC.state.chars.values()].filter((c) => c.owner && MC.state.players.some((p) => p.id === c.owner) && !on.has(c.id));
    if (!pcs.length) { MC.toast(t("map.no_pcs"), "warn"); return; }
    const spots = placeSpots(pcs.length);
    pcs.forEach((c, i) => send({ t: "tok_add", map: m.id, tok: { name: c.name, char: c.id, owner: c.owner, x: spots[i].x, y: spots[i].y, s: 1 } }));
  }

  async function tokenForm(tok) {
    const isNew = !tok;
    tok = tok || { name: "", s: 1, color: "#ef4444", hp: null, hidden: false, show_hp: false, owner: "", img: "" };
    const chars = [...MC.state.chars.values()];
    let img = tok.img || "";
    const v = await MC.modal({ title: isNew ? t("map.tok.new") : t("map.tok.edit"), wide: true,
      body: `<div class="form-grid">
        ${isNew ? `<label class="field full"><span>${t("map.tok.from_char")}</span><select name="char"><option value="">— ${t("map.tok.custom")} —</option>
          ${chars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>${t("map.name")}</span><input name="name" value="${esc(tok.name)}" ${tok.char ? "disabled" : ""} placeholder="${esc(t("map.tok.name_ph"))}"></label>
        <label class="field"><span>${t("map.tok.size")}</span><select name="s">${SIZES.map(([s, k]) => `<option value="${s}" ${+tok.s === s ? "selected" : ""}>${t(k)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("map.tok.hp")}</span><input name="hp" type="number" min="0" value="${tok.hp?.max ?? ""}" placeholder="—"></label>
        ${isNew ? `<label class="field"><span>${t("map.tok.count")}</span><input name="count" type="number" min="1" max="30" value="1"></label>` : `<label class="field"><span>${t("map.tok.hp_cur")}</span><input name="hpcur" type="number" value="${tok.hp?.cur ?? ""}"></label>`}
        <div class="field full"><span>${t("map.tok.color")}</span><div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === tok.color ? "sel" : ""}" data-col="${c}" style="background:${c}"></button>`).join("")}</div></div>
        <label class="field"><span>${t("map.tok.owner")}</span><select name="owner"><option value="">—</option>${MC.state.players.map((p) => `<option value="${p.id}" ${tok.owner === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <div class="field"><span>${t("map.tok.image")}</span><div class="gm-row"><button type="button" class="btn" id="tk-img">${MC.icon("image", "sm")} ${t(img ? "map.tok.image_change" : "map.pick_image")}</button>
          <button type="button" class="btn" id="tk-crop" ${img ? "" : "hidden"}>${MC.icon("maximize", "sm")} ${t("crop.recrop")}</button></div></div>
        <label class="check full"><input type="checkbox" name="hidden" ${tok.hidden ? "checked" : ""}> ${t("map.tok.hidden")}</label>
        <label class="check full"><input type="checkbox" name="show_hp" ${tok.show_hp ? "checked" : ""}> ${t("map.tok.show_hp")}</label>
      </div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t(isNew ? "create" : "save"), kind: "primary", value: (w) => {
        const q = (n) => w.querySelector(`[name=${n}]`);
        const hpMax = q("hp").value === "" ? null : MC.int(q("hp").value, 0);
        return { char: q("char")?.value || tok.char || "", name: q("name").value.trim(), s: MC.num(q("s").value, 1),
          hp: hpMax == null ? null : { max: hpMax, cur: q("hpcur") ? MC.int(q("hpcur").value, hpMax) : hpMax },
          count: q("count") ? MC.clamp(MC.int(q("count").value, 1), 1, 30) : 1,
          color: w.querySelector(".swatch.sel")?.dataset.col || tok.color, owner: q("owner").value,
          hidden: q("hidden").checked, show_hp: q("show_hp").checked, img };
      } }],
      mount: (m) => {
        m.addEventListener("click", async (e) => {
          const sw = e.target.closest("[data-col]");
          if (sw) { m.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("sel", x === sw)); return; }
          if (e.target.closest("#tk-img")) {
            const f = await MC.pickImageCropped(512);
            if (!f) return;
            try { img = (await uploadImage(f, 512)).id; e.target.closest("#tk-img").textContent = "✓ " + f.name; m.querySelector("#tk-crop").hidden = false; } catch { MC.toast(t("map.upload_failed"), "bad"); }
          }
          if (e.target.closest("#tk-crop") && img) {
            // перекадрировать уже загруженную картинку
            try {
              const blob = await (await fetch(M.assetUrl(img))).blob();
              const f = await MC.cropImage(new File([blob], "token", { type: blob.type }), 512);
              if (f) { img = (await uploadImage(f, 512)).id; m.querySelector("#tk-crop").textContent = "✓ " + t("crop.done"); }
            } catch { MC.toast(t("map.upload_failed"), "bad"); }
          }
        });
        const sel = m.querySelector("[name=char]");
        sel?.addEventListener("change", () => {
          const c = MC.state.chars.get(sel.value);
          const nm = m.querySelector("[name=name]");
          nm.disabled = !!c;
          if (c) { nm.value = c.name; m.querySelector("[name=owner]").value = c.owner || ""; }
        });
      } });
    if (!v) return;
    const m = cur();
    if (isNew) {
      const base = v.name || (v.char ? MC.state.chars.get(v.char)?.name : "") || t("map.tok.default");
      const spots = placeSpots(v.count, v.s);
      for (let i = 0; i < v.count; i++) {
        send({ t: "tok_add", map: m.id, tok: { ...v, name: v.count > 1 ? `${base} ${i + 1}` : base, x: spots[i]?.x || 0, y: spots[i]?.y || 0 } });
      }
    } else {
      send({ t: "tok_set", map: m.id, id: tok.id, fields: { name: v.name || tok.name, s: v.s, hp: v.hp, color: v.color, owner: v.owner, hidden: v.hidden, show_hp: v.show_hp, img: v.img } });
    }
  }
  MC.on("map_edit_token", (tok) => tokenForm(tok));

  // ---------------------------------------------------------------- зоны тумана: рисование
  let draft = null, zoneSeq = 0;          // {kind:'rect', a, b} | {kind:'poly', pts, hover}
  let hoverZone = null;
  const zones = () => cur()?.fog?.zones || [];
  const polyArea = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);
  function zoneAt(x, y) {
    const hit = zones().filter((z) => M.pointInPoly(x, y, z.pts));
    hit.sort((a, b) => polyArea(a.pts) - polyArea(b.pts));
    return hit[0] || null;
  }
  function addZone(pts) {
    const m = cur();
    if (!m || pts.length < 3) return;
    // номер: больше любого уже существующего «Зона N» (сервер ещё мог не прислать только что созданные)
    const used = zones().map((z) => MC.int(String(z.name).replace(/\D+/g, ""), 0));
    zoneSeq = Math.max(zoneSeq, ...used, 0) + 1;
    const n = zoneSeq;
    send({ t: "zone_add", map: m.id, zone: { name: `${t("map.zone")} ${n}`, pts: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), open: false } });
    if (!m.fog?.on) send({ t: "map_set", map: m.id, fields: { fog_on: true } });
  }
  function centroid(p) { let x = 0, y = 0; p.forEach((q) => { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }

  M.tools.zones = {
    draw(ctx, z) {
      if (!gm() || !String(M.tool).startsWith("fog")) return;
      for (const zn of zones()) {
        ctx.save();
        ctx.beginPath();
        zn.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        if (zn === hoverZone) { ctx.fillStyle = zn.open ? "rgba(34,197,94,.18)" : "rgba(139,92,246,.22)"; ctx.fill(); }
        ctx.lineWidth = 2 / z;
        ctx.strokeStyle = zn.open ? "#22c55e" : "#a78bfa";
        if (!zn.open) ctx.setLineDash([8 / z, 5 / z]);
        ctx.stroke();
        const [cx, cy] = centroid(zn.pts);
        const fs = 13 / z;
        ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(10,9,16,.75)";
        const tw = ctx.measureText(zn.name).width;
        ctx.fillRect(cx - tw / 2 - 5 / z, cy - fs * 0.75, tw + 10 / z, fs * 1.5);
        ctx.fillStyle = zn.open ? "#bbf7d0" : "#e9e3ff";
        ctx.fillText(zn.name, cx, cy);
        ctx.restore();
      }
    },
  };

  const previewStyle = (ctx, z) => { ctx.lineWidth = 2.5 / z; ctx.strokeStyle = "#f5c542"; ctx.setLineDash([6 / z, 4 / z]); ctx.fillStyle = "rgba(245,197,66,.15)"; };
  M.tools["fog-rect"] = {
    cursor: "crosshair",
    down(w) { draft = { a: w, b: w }; },
    move(w) { if (draft) draft.b = w; },
    up(w, e, moved) {
      if (!draft) return;
      const { a } = draft; const b = w;
      draft = null;
      if (!moved || Math.abs(b.x - a.x) < 8 || Math.abs(b.y - a.y) < 8) { toggleAt(w); return; }
      addZone([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]]);
    },
    cancel() { draft = null; },
    draw(ctx, z) {
      if (!draft) return;
      ctx.save(); previewStyle(ctx, z);
      ctx.beginPath(); ctx.rect(draft.a.x, draft.a.y, draft.b.x - draft.a.x, draft.b.y - draft.a.y); ctx.fill(); ctx.stroke(); ctx.restore();
    },
  };
  // трудная местность: прямоугольник; «убрать» — нажать на участок
  M.tools["terr-rect"] = {
    cursor: "crosshair",
    down(w) { draft = { a: w, b: w }; },
    move(w) { if (draft) draft.b = w; },
    up(w, e, moved) {
      if (!draft) return;
      const { a } = draft; const b = w;
      draft = null;
      const m = cur();
      if (!m || !moved || Math.abs(b.x - a.x) < 8 || Math.abs(b.y - a.y) < 8) return;
      const g = m.grid || {};
      // по сетке — края к линиям клеток, чтобы считалось честно
      const sn = (v, o) => (g.on && g.size ? Math.round((v - (o || 0)) / g.size) * g.size + (o || 0) : v);
      const x1 = sn(Math.min(a.x, b.x), g.ox), x2 = sn(Math.max(a.x, b.x), g.ox), y1 = sn(Math.min(a.y, b.y), g.oy), y2 = sn(Math.max(a.y, b.y), g.oy);
      if (x2 - x1 < 4 || y2 - y1 < 4) return;
      send({ t: "terr_add", map: m.id, zone: { pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] } });
    },
    cancel() { draft = null; },
    draw(ctx, z) {
      if (!draft) return;
      ctx.save(); ctx.lineWidth = 2.5 / z; ctx.strokeStyle = "#d98c46"; ctx.setLineDash([6 / z, 4 / z]); ctx.fillStyle = "rgba(217,140,70,.18)";
      ctx.beginPath(); ctx.rect(draft.a.x, draft.a.y, draft.b.x - draft.a.x, draft.b.y - draft.a.y); ctx.fill(); ctx.stroke(); ctx.restore();
    },
  };
  M.tools["terr-erase"] = {
    cursor: "pointer",
    down() {},
    up(w) {
      const m = cur();
      const z = (m?.terrain || []).find((q) => M.pointInPoly(w.x, w.y, q.pts));
      if (z) send({ t: "terr_del", map: m.id, id: z.id });
    },
  };
  let lastPolyDown = 0;
  M.tools["fog-poly"] = {
    cursor: "crosshair",
    down(w) {
      const now = performance.now();
      if (!draft) draft = { pts: [], hover: w };
      const pts = draft.pts;
      const near = (p) => Math.hypot(p[0] - w.x, p[1] - w.y) * M.view.z < 12;
      if (pts.length >= 3 && (near(pts[0]) || (now - lastPolyDown < 350 && near(pts[pts.length - 1])))) { finishPoly(); return; }
      lastPolyDown = now;
      pts.push([w.x, w.y]);
    },
    move(w) { if (draft) draft.hover = w; },
    hover(w) { if (draft) { draft.hover = w; M.redraw(); } },
    up() {},
    key(e) {
      if (!draft) return;
      if (e.key === "Enter") finishPoly();
      if (e.key === "Backspace") { draft.pts.pop(); M.redraw(); e.preventDefault(); }
    },
    cancel() { draft = null; },
    draw(ctx, z) {
      if (!draft?.pts?.length) return;
      ctx.save(); previewStyle(ctx, z);
      ctx.beginPath();
      draft.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (draft.hover) ctx.lineTo(draft.hover.x, draft.hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      draft.pts.forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(x, y, (i ? 3.5 : 6) / z, 0, Math.PI * 2); ctx.fillStyle = i ? "#f5c542" : "#22c55e"; ctx.fill(); });
      ctx.restore();
    },
  };
  function finishPoly() {
    if (draft?.pts?.length >= 3) addZone(draft.pts);
    draft = null;
    M.redraw();
  }
  function toggleAt(w) {
    const zn = zoneAt(w.x, w.y);
    if (!zn) return;
    send({ t: "zone_set", map: cur().id, id: zn.id, fields: { open: !zn.open } });
    zn.open = !zn.open;
    M.redraw();
  }
  M.tools["fog-toggle"] = {
    cursor: "pointer",
    down(w) { toggleAt(w); },
    hover(w) { const z = zoneAt(w.x, w.y); if (z !== hoverZone) { hoverZone = z; M.redraw(); } },
    cancel() { hoverZone = null; },
  };

  // ---------------------------------------------------------------- волшебная палочка
  const wand = { tol: MC.int(MC.store.get("wand_tol"), 38), seeds: [], polys: [], key: "", data: null, w: 0, h: 0, k: 1 };
  function wandImage() {
    const m = cur();
    const im = m?.img ? M.img(M.assetUrl(m.img)) : null;
    if (!im) return false;
    if (wand.key === m.img && wand.data) return true;
    const k = Math.min(1, 1100 / Math.max(m.iw, m.ih));
    const w = Math.max(1, Math.round(m.iw * k)), h = Math.max(1, Math.round(m.ih * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0, w, h);
    try { wand.data = x.getImageData(0, 0, w, h).data; } catch { return false; }
    Object.assign(wand, { key: m.img, w, h, k });
    return true;
  }
  function floodMask() {
    const { w, h, data, tol } = wand;
    const mask = new Uint8Array(w * h);
    const t2 = tol * tol * 3;
    for (const s of wand.seeds) {
      const sx = MC.clamp(Math.floor(s.x * wand.k), 0, w - 1), sy = MC.clamp(Math.floor(s.y * wand.k), 0, h - 1);
      const i0 = (sy * w + sx) * 4;
      const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2];
      const stack = [sy * w + sx];
      const seen = new Uint8Array(w * h);
      seen[sy * w + sx] = 1;
      while (stack.length) {
        const p = stack.pop();
        const i = p * 4;
        const dr = data[i] - r0, dg = data[i + 1] - g0, db = data[i + 2] - b0;
        if (dr * dr + dg * dg + db * db > t2) continue;
        mask[p] = 1;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
    }
    return mask;
  }
  function morph(mask, w, h, r, dilate) {
    // разделимый квадратный фильтр: max (наращивание) или min (сужение)
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let d = -r; d <= r; d++) {
          const xx = x + d;
          const m = xx < 0 || xx >= w ? (dilate ? 0 : 1) : mask[y * w + xx];
          if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
        }
        tmp[y * w + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = dilate ? 0 : 1;
        for (let d = -r; d <= r; d++) {
          const yy = y + d;
          const m = yy < 0 || yy >= h ? (dilate ? 0 : 1) : tmp[yy * w + x];
          if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }
  function fillHoles(mask, w, h) {
    const out = new Uint8Array(w * h);
    const stack = [];
    const push = (p) => { if (!mask[p] && !out[p]) { out[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
    }
    for (let i = 0; i < w * h; i++) out[i] = out[i] ? 0 : 1;     // всё, что не «снаружи» — внутри
    return out;
  }
  function trace(inside, sx, sy) {
    const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    let px = sx, py = sy, bdir = 4;
    const pts = [[px, py]];
    for (let n = 0; n < 400000; n++) {
      let found = false;
      for (let i = 1; i <= 8; i++) {
        const k = (bdir + i) % 8, qx = px + D[k][0], qy = py + D[k][1];
        if (inside(qx, qy)) {
          const bx = px + D[(k + 7) % 8][0], by = py + D[(k + 7) % 8][1];
          px = qx; py = qy;
          bdir = D.findIndex((d) => d[0] === bx - px && d[1] === by - py);
          found = true;
          break;
        }
      }
      if (!found || (px === sx && py === sy)) break;
      pts.push([px, py]);
    }
    return pts;
  }
  function rdp(pts, eps) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const L = Math.hypot(bx - ax, by - ay) || 1;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  /** Упростить замкнутый контур: делим его на две половины по самой дальней от начала точке. */
  function simplifyRing(pts, eps) {
    if (pts.length < 6) return pts;
    let far = 0, best = -1;
    pts.forEach(([x, y], i) => { const d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2; if (d > best) { best = d; far = i; } });
    const a = rdp(pts.slice(0, far + 1), eps), b = rdp(pts.slice(far).concat([pts[0]]), eps);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }
  function wandCompute() {
    wand.polys = [];
    if (!wand.seeds.length || !wandImage()) { M.redraw(); renderGM(); return; }
    const { w, h } = wand;
    let mask = floodMask();
    mask = morph(morph(mask, w, h, 2, true), w, h, 2, false);     // закрыть щели (линии сетки, мелкий шум)
    mask = fillHoles(mask, w, h);
    mask = morph(mask, w, h, 1, true);                               // чуть шире — захватить края стен
    // компоненты связности → контур каждой
    const label = new Int32Array(w * h);
    let id = 0;
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || label[p]) continue;
      id++;
      let area = 0;
      const st = [p]; label[p] = id;
      while (st.length) {
        const q = st.pop(); area++;
        const x = q % w, y = (q - x) / w;
        const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
        for (const n of nb) if (n >= 0 && mask[n] && !label[n]) { label[n] = id; st.push(n); }
      }
      if (area < 40) continue;
      const sx = p % w, sy = (p - sx) / w;
      const lid = id;
      const raw = trace((x, y) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === lid, sx, sy);
      const simple = simplifyRing(raw, 1.1);
      if (simple.length >= 3) wand.polys.push(simple.map(([x, y]) => [(x + 0.5) / wand.k, (y + 0.5) / wand.k]));
    }
    M.redraw();
    renderGM();
  }
  M.tools["fog-wand"] = {
    cursor: "crosshair",
    down(w, e) {
      if (!cur()?.img) { MC.toast(t("map.wand.no_image"), "warn"); return; }
      if (!e.shiftKey && !wand.add) wand.seeds = [];
      wand.seeds.push({ x: w.x, y: w.y });
      wandCompute();
    },
    up() {},
    key(e) { if (e.key === "Enter" && wand.polys.length) wandCommit(); },
    cancel() { wand.seeds = []; wand.polys = []; },
    draw(ctx, z) {
      if (!wand.polys.length) return;
      ctx.save(); previewStyle(ctx, z);
      for (const p of wand.polys) { ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    },
  };
  function wandCommit() {
    wand.polys.forEach((p) => addZone(p));
    wand.seeds = []; wand.polys = [];
    renderGM(); M.redraw();
  }

  // ---------------------------------------------------------------- панель мастера
  const sec = (id, icon, title, body) => `<section class="gm-sec ${section === id ? "open" : ""}">
    <button class="gm-sec-h" data-gsec="${id}">${MC.icon(icon, "sm")} <span>${title}</span>${MC.icon(section === id ? "dis" : "next", "sm")}</button>
    ${section === id ? `<div class="gm-sec-b">${body}</div>` : ""}</section>`;

  // перерисовка панели посреди клика «съедает» клик — откладываем до отпускания кнопки
  function renderGM() {
    if (ptrDown) { afterUp = true; return; }
    doRenderGM();
  }
  function doRenderGM() {
    const box = $("#map-gm");
    const tg = $("#map-gm-toggle");
    if (!box) return;
    if (!gm()) { box.hidden = true; if (tg) tg.hidden = true; return; }
    if (tg) { tg.hidden = false; tg.classList.toggle("on", panelOpen); }
    box.hidden = !panelOpen;
    if (!panelOpen) return;
    const ae = document.activeElement;
    if (ae && box.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && ae.type !== "checkbox" && ae.type !== "radio") {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    const m = cur();
    const g = m?.grid || {};
    const mapsBody = `<ul class="gm-maps">${list.map((x) => `<li class="${m && x.id === m.id ? "cur" : ""}" data-gopen="${x.id}">
        ${MC.icon(x.active ? "cast" : "map", "sm")}<span>${esc(x.name)}</span>${x.active ? `<span class="tag ok">${t("map.shown")}</span>` : ""}
        <button class="icon-btn small gm-mdel" data-gmdel="${x.id}" title="${esc(t("map.delete"))}">${MC.icon("trash", "sm")}</button></li>`).join("") || `<li class="muted">${t("map.list.empty")}</li>`}</ul>
      <button class="btn small primary" data-g="new">${MC.icon("plus", "sm")} ${t("map.new")}</button>`;
    if (!m) { box.innerHTML = `<div class="gm-head"><b>${t("map.gm.title")}</b></div>${sec("maps", "layers", t("map.gm.maps"), mapsBody)}`; return; }
    const cells = g.size ? Math.round(m.iw / g.size * 10) / 10 : 0;
    const mapBody = `
      <label class="gm-f"><span>${t("map.name")}</span><input data-gset="name" value="${esc(m.name)}"></label>
      <div class="gm-row">
        <button class="btn small ${M.active ? "ok" : "primary"}" data-g="show">${MC.icon("cast", "sm")} ${t(M.active ? "map.hide_players" : "map.show_players")}</button>
        <button class="btn small" data-g="img">${MC.icon("image", "sm")} ${t(m.img ? "map.replace_image" : "map.add_image")}</button>
      </div>
      <h4>${MC.icon("grid", "sm")} ${t("map.grid")}</h4>
      <label class="check"><input type="checkbox" data-grid="on" ${g.on ? "checked" : ""}> ${t("map.grid.on")}</label>
      <div class="chips grid-type">${[["square", "grid", "map.grid.sq"], ["hexh", "shuffle-map", "map.grid.hexh"], ["hexv", "shuffle-map", "map.grid.hexv"]].map(([k, ic, lb]) => `<button class="chip ${(g.type || "square") === k ? "on" : ""}" data-gridtype="${k}">${k === "square" ? MC.icon(ic, "sm") : `<span class="hex-ic ${k}"></span>`} ${t(lb)}</button>`).join("")}</div>
      <label class="gm-f"><span>${t("map.grid.cells")}</span><input type="number" step="0.5" min="2" max="300" data-grid="cells" value="${cells}"></label>
      <label class="gm-f"><span>${t("map.grid.size")} <b>${Math.round(g.size * 10) / 10}px</b></span><input type="range" min="10" max="300" step="0.5" data-grid="size" value="${g.size}"></label>
      <label class="gm-f"><span>${t("map.grid.ox")} <b>${g.ox}</b></span><input type="range" min="0" max="${Math.round(g.size)}" step="0.5" data-grid="ox" value="${((g.ox % g.size) + g.size) % g.size}"></label>
      <label class="gm-f"><span>${t("map.grid.oy")} <b>${g.oy}</b></span><input type="range" min="0" max="${Math.round(g.size)}" step="0.5" data-grid="oy" value="${((g.oy % g.size) + g.size) % g.size}"></label>
      <label class="gm-f"><span>${t("map.grid.alpha")}</span><input type="range" min="0" max="1" step="0.02" data-grid="alpha" value="${g.alpha}"></label>
      <div class="gm-row"><label class="gm-f sm"><span>${t("map.grid.color")}</span><input type="color" data-grid="color" value="${g.color}"></label>
        <label class="gm-f sm"><span>${t("map.grid.ft")}</span><input type="number" min="1" max="100" data-grid="ft" value="${g.ft}"></label>
        <label class="gm-f sm"><span>${t("map.grid.diag")}</span><select data-grid="diag"><option value="5" ${g.diag === "5" ? "selected" : ""}>5/5</option><option value="5-10" ${g.diag === "5-10" ? "selected" : ""}>5/10</option></select></label></div>
      <h4>${MC.icon("footprints", "sm")} ${t("terr.title")}</h4>
      <div class="gm-tools">${[["terr-rect", "rect", "terr.draw"], ["terr-erase", "trash", "terr.erase"]].map(([k, ic, lb]) => `<button class="chip ${M.tool === k ? "on" : ""}" data-mtool="${k}">${MC.icon(ic, "sm")} ${t(lb)}</button>`).join("")}
        ${(m.terrain || []).length ? `<button class="chip" data-g="terrclear">${MC.icon("x", "sm")} ${t("terr.clear")} (${m.terrain.length})</button>` : ""}</div>
      <p class="muted small">${t("terr.hint")}</p>
      <button class="btn small danger" data-g="del">${MC.icon("trash", "sm")} ${t("map.delete")}</button>`;
    const z = zones();
    const fogBody = `
      <label class="check"><input type="checkbox" data-g="fogon" ${m.fog?.on ? "checked" : ""}> ${t("map.fog.on")}</label>
      <div class="gm-tools">
        ${[["fog-toggle", "pointer", "map.fog.toggle"], ["fog-rect", "rect", "map.fog.rect"], ["fog-poly", "poly", "map.fog.poly"], ["fog-wand", "wand", "map.fog.wand"]]
    .map(([k, ic, lb]) => `<button class="chip ${M.tool === k ? "on" : ""}" data-mtool="${k}">${MC.icon(ic, "sm")} ${t(lb)}</button>`).join("")}</div>
      <p class="muted small">${t("map.fog.hint." + (String(M.tool).startsWith("fog") ? M.tool : "none"))}</p>
      ${M.tool === "fog-wand" ? `<label class="gm-f"><span>${t("map.wand.tol")} <b>${wand.tol}</b></span><input type="range" min="5" max="120" data-g="tol" value="${wand.tol}"></label>
        <label class="check"><input type="checkbox" data-g="wadd" ${wand.add ? "checked" : ""}> ${t("map.wand.add")}</label>
        ${wand.polys.length ? `<div class="gm-row"><button class="btn small primary" data-g="wok">${MC.icon("check", "sm")} ${t("map.wand.create", { n: wand.polys.length })}</button><button class="btn small" data-g="wreset">${MC.icon("x", "sm")}</button></div>` : ""}` : ""}
      <div class="gm-row"><button class="btn small" data-g="openall">${MC.icon("eye", "sm")} ${t("map.fog.open_all")}</button><button class="btn small" data-g="closeall">${MC.icon("hidden", "sm")} ${t("map.fog.close_all")}</button></div>
      <ul class="gm-zones">${z.map((zn) => `<li><button class="icon-btn small ${zn.open ? "ok" : ""}" data-zt="${zn.id}" title="${esc(t(zn.open ? "map.zone.close" : "map.zone.open"))}">${MC.icon(zn.open ? "eye" : "hidden", "sm")}</button>
        <input value="${esc(zn.name)}" data-zn="${zn.id}"><button class="icon-btn small" data-zd="${zn.id}">${MC.icon("trash", "sm")}</button></li>`).join("") || `<li class="muted small">${t("map.fog.no_zones")}</li>`}</ul>`;
    const toks = m.tokens || [];
    const tokBody = `<div class="gm-row"><button class="btn small primary" data-g="addtok">${MC.icon("plus", "sm")} ${t("map.tok.add")}</button>
        <button class="btn small" data-g="addpcs">${MC.icon("user-plus", "sm")} ${t("map.tok.add_pcs")}</button></div>
      <h4>${MC.icon("group", "sm")} ${t("map.grp.title")}</h4>
      <ul class="gm-grps">${groups().map((g) => `<li><button class="gm-grp-go" data-grpgo="${g.id}" title="${esc(t("map.grp.spawn"))}">${MC.icon("play", "sm")}</button>
          <div class="gm-grp-i" data-grpedit="${g.id}"><b>${esc(g.name)}</b><span class="muted small">${esc(groupLine(g))}</span></div>
          <button class="icon-btn small" data-grpedit="${g.id}">${MC.icon("edit", "sm")}</button></li>`).join("") || `<li class="muted small">${t("map.grp.hint")}</li>`}</ul>
      <div class="gm-row"><button class="btn small" data-g="grpnew">${MC.icon("plus", "sm")} ${t("map.grp.new")}</button>
        ${(m.tokens || []).some((x) => x.char || x.mon) ? `<button class="btn small" data-g="grpfrom">${MC.icon("save", "sm")} ${t("map.grp.from_map")}</button>` : ""}</div>
      <h4 class="gm-h-act">${MC.icon("map-pin", "sm")} ${t("map.tok.on_map")}<button class="icon-btn small" data-g="fnew" title="${esc(t("fold.new"))}">${MC.icon("folder", "sm")}</button></h4>
      ${toksTree(m, toks)}
      <h4>${MC.icon("move", "sm")} ${t("map.mode")}</h4>
      <div class="gm-modes">${["own", "approve", "gm"].map((k) => `<label class="check"><input type="radio" name="mmode" value="${k}" ${M.mode === k ? "checked" : ""}> ${t("map.mode." + k)}</label>`).join("")}</div>
      <label class="check"><input type="checkbox" data-g="mlimit" ${M.limit ? "checked" : ""}> ${t("map.mode.limit")}</label>
      <p class="muted small">${t("map.mode.limit_hint")}</p>
      ${(m.tmpls || []).length ? `<button class="btn small" data-g="tclear">${MC.icon("trash", "sm")} ${t("map.tmpl.clear")} (${m.tmpls.length})</button>` : ""}`;
    box.innerHTML = `<div class="gm-head"><b>${esc(m.name)}</b>${M.active ? `<span class="tag ok">${t("map.shown")}</span>` : `<span class="tag">${t("map.not_shown")}</span>`}</div>
      ${sec("maps", "layers", t("map.gm.maps"), mapsBody)}
      ${sec("map", "settings", t("map.gm.map"), mapBody)}
      ${sec("fog", "fog", t("map.gm.fog") + (z.length ? ` · ${z.filter((q) => q.open).length}/${z.length}` : ""), fogBody)}
      ${sec("tokens", "players", t("map.gm.tokens") + ` · ${toks.length}`, tokBody)}`;
  }
  M.renderGM = renderGM;

  // ---------------------------------------------------------------- папки фишек (как группы слоёв в фотошопе)
  const folders = (m) => (Array.isArray(m?.folders) ? m.folders : []);
  const foldOpen = (id) => MC.store.get("fold_" + id) !== "0";
  function tokRow(x, inFold) {
    const pic = M.tokPic(x);
    return `<li data-gtok="${x.id}" draggable="true" class="${M.sel === x.id ? "cur" : ""} ${inFold ? "in-fold" : ""} ${x.hidden ? "hid" : ""}">
      <span class="gm-tav" style="--c:${esc(M.tokColor(x))}">${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ""}</span><span>${esc(M.tokName(x))}</span>
      ${x.req ? MC.icon("hourglass", "sm") : ""}<button class="icon-btn small" data-th="${x.id}">${MC.icon(x.hidden ? "hidden" : "eye", "sm")}</button></li>`;
  }
  function toksTree(m, toks) {
    const fl = folders(m);
    const ids = new Set(fl.map((f) => f.id));
    const root = toks.filter((x) => !x.fold || !ids.has(x.fold));
    const fh = fl.map((f) => {
      const inside = toks.filter((x) => x.fold === f.id);
      const open = foldOpen(f.id);
      const allHidden = inside.length && inside.every((x) => x.hidden);
      return `<li class="gm-fold ${open ? "open" : ""}" data-fold="${f.id}">
          <button class="icon-btn small gm-fold-tog" data-ftog="${f.id}">${MC.icon("next", "sm")}</button>
          ${MC.icon("folder", "sm")}<span class="gm-fold-n" data-ftog="${f.id}">${esc(f.name)}</span><span class="muted small">${inside.length}</span>
          <button class="icon-btn small" data-fren="${f.id}" title="${esc(t("fold.rename"))}">${MC.icon("edit", "sm")}</button>
          <button class="icon-btn small" data-fdel="${f.id}" title="${esc(t("fold.del"))}">${MC.icon("trash", "sm")}</button>
          <button class="icon-btn small" data-feye="${f.id}">${MC.icon(allHidden ? "hidden" : "eye", "sm")}</button></li>
        ${open ? inside.map((x) => tokRow(x, true)).join("") || `<li class="in-fold muted small" data-fold="${f.id}">${t("fold.empty")}</li>` : ""}`;
    }).join("");
    const body = fh + root.map((x) => tokRow(x, false)).join("");
    return `<ul class="gm-toks">${body || `<li class="muted small">${t("map.tok.none")}</li>`}
      ${fl.length ? `<li class="gm-fold-root muted small" data-fold="">${t("fold.root")}</li>` : ""}</ul>`;
  }
  async function foldName(old = "") {
    const v = await MC.modal({ title: t(old ? "fold.rename" : "fold.new"), body: `<label class="field full"><span>${t("map.name")}</span><input name="fn" value="${esc(old)}" autofocus></label>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => w.querySelector("[name=fn]").value.trim() }] });
    return v || null;
  }
  async function foldClick(e) {
    const m = cur();
    if (!m) return false;
    const b = e.target.closest("[data-ftog],[data-fren],[data-fdel],[data-feye]");
    if (!b || !b.closest("#map-gm")) return false;
    const d = b.dataset;
    if (d.ftog) { MC.store.set("fold_" + d.ftog, foldOpen(d.ftog) ? "0" : "1"); renderGM(); }
    if (d.fren) {
      const f = folders(m).find((x) => x.id === d.fren);
      const n = f && await foldName(f.name);
      if (n) send({ t: "map_set", map: m.id, fields: { folders: folders(m).map((x) => (x.id === f.id ? { ...x, name: n } : x)) } });
    }
    if (d.fdel) {
      const f = folders(m).find((x) => x.id === d.fdel);
      if (f && await MC.confirm(t("fold.del_q", { name: f.name }))) {
        for (const x of m.tokens.filter((q) => q.fold === f.id)) send({ t: "tok_set", map: m.id, id: x.id, fields: { fold: "" } });
        send({ t: "map_set", map: m.id, fields: { folders: folders(m).filter((x) => x.id !== f.id) } });
      }
    }
    if (d.feye) {
      const inside = m.tokens.filter((q) => q.fold === d.feye);
      const hide = !inside.every((x) => x.hidden);
      for (const x of inside) if (x.hidden !== hide) send({ t: "tok_set", map: m.id, id: x.id, fields: { hidden: hide } });
    }
    return true;
  }
  document.addEventListener("click", (e) => { if (e.target.closest("#map-gm [data-ftog],#map-gm [data-fren],#map-gm [data-fdel],#map-gm [data-feye]")) { e.stopPropagation(); foldClick(e); } }, true);
  // перетаскивание фишки в папку (или обратно — на «вне папок» или на фишку вне папки)
  let dragTok = null;
  document.addEventListener("dragstart", (e) => {
    const li = e.target.closest?.("#map-gm [data-gtok]");
    if (!li) return;
    dragTok = li.dataset.gtok;
    try { e.dataTransfer.setData("text/plain", dragTok); e.dataTransfer.effectAllowed = "move"; } catch { /* */ }
    li.classList.add("dragging");
  });
  document.addEventListener("dragend", () => { dragTok = null; $$("#map-gm .drop-on, #map-gm .dragging").forEach((x) => x.classList.remove("drop-on", "dragging")); });
  const dropTarget = (e) => e.target.closest?.("#map-gm [data-fold], #map-gm [data-gtok]");
  document.addEventListener("dragover", (e) => {
    if (!dragTok) return;
    const tg = dropTarget(e);
    if (!tg) return;
    e.preventDefault();
    $$("#map-gm .drop-on").forEach((x) => x !== tg && x.classList.remove("drop-on"));
    tg.classList.add("drop-on");
  });
  document.addEventListener("drop", (e) => {
    if (!dragTok) return;
    const tg = dropTarget(e), m = cur();
    if (!tg || !m) return;
    e.preventDefault();
    let fold = tg.dataset.fold;
    if (fold == null) fold = m.tokens.find((x) => x.id === tg.dataset.gtok)?.fold || "";
    const tok = m.tokens.find((x) => x.id === dragTok);
    if (tok && (tok.fold || "") !== fold) send({ t: "tok_set", map: m.id, id: tok.id, fields: { fold } });
    if (fold) MC.store.set("fold_" + fold, "1");
    dragTok = null;
  });
  M.freeSpots = (n, s) => placeSpots(n, s);
  MC.uploadAsset = async (file, maxSide) => (await uploadImage(file, maxSide)).id;
  M.uploadImage = uploadImage;
  MC.ctxAdd?.("[data-gopen]", (el) => {
    const x = list.find((q) => q.id === el.dataset.gopen);
    if (!x || !gm()) return null;
    return { title: x.name, items: [
      { ic: "map", label: t("ctx.open"), fn: () => req({ t: "map_get", id: x.id }) },
      { ic: "cast", label: t("ctx.map_show"), fn: async () => { await req({ t: "map_get", id: x.id }); send({ t: "map_show", id: x.id }); } },
      { ic: "trash", label: t("map.delete"), bad: true, fn: async () => { if (await MC.confirm(t("confirm.delete", { name: x.name }))) send({ t: "map_del", map: x.id }); } },
    ] };
  });
  MC.ctxAdd?.("[data-gtok]", (el) => {
    const m = cur(), tk = m?.tokens.find((q) => q.id === el.dataset.gtok);
    if (!tk) return null;
    return { title: tk.name, items: [
      { ic: "locate", label: t("ctx.center"), fn: () => { M.centerOn(tk.x, tk.y); M.select(tk.id); } },
      { ic: tk.hidden ? "eye" : "hidden", label: t(tk.hidden ? "ctx.show" : "ctx.hide"), fn: () => send({ t: "tok_set", map: m.id, id: tk.id, fields: { hidden: !tk.hidden } }) },
      { ic: "trash", label: t("ctx.del"), bad: true, fn: async () => { if (await MC.confirm(t("confirm.delete", { name: tk.name }))) send({ t: "tok_del", map: m.id, id: tk.id }); } },
    ] };
  });
  /** Создать карту (генератор и т. п.) и открыть её в панели мастера. */
  M.createMap = async (data) => {
    const r = await req({ t: "map_new", map: data });
    if (r) { section = "map"; renderGM(); }
    return r;
  };
  M.insetLeft = () => (gm() && panelOpen && window.innerWidth > 700 ? ($("#map-gm")?.offsetWidth || 310) + 20 : 0);

  // события панели
  let gridTimer = 0;
  function setGrid(k, v) {
    const m = cur();
    if (!m) return;
    m.grid = { ...m.grid, [k]: v };
    M.redraw();
    clearTimeout(gridTimer);
    gridTimer = setTimeout(() => send({ t: "map_set", map: m.id, fields: { grid: m.grid } }), 250);
  }
  document.addEventListener("input", (e) => {
    if (!e.target.closest("#map-gm")) return;
    const d = e.target.dataset;
    if (d.grid) {
      const m = cur();
      const v = e.target.type === "checkbox" ? e.target.checked : e.target.type === "color" || d.grid === "diag" ? e.target.value : MC.num(e.target.value, 0);
      if (d.grid === "cells") { if (v >= 2) setGrid("size", m.iw / v); return; }
      setGrid(d.grid, v);
      const lbl = e.target.closest(".gm-f")?.querySelector("b");
      if (lbl) lbl.textContent = d.grid === "size" ? Math.round(v * 10) / 10 + "px" : v;
    }
    if (d.g === "tol") { wand.tol = MC.int(e.target.value, 38); MC.store.set("wand_tol", wand.tol); e.target.closest(".gm-f").querySelector("b").textContent = wand.tol; clearTimeout(wand.tm); wand.tm = setTimeout(wandCompute, 120); }
  });
  document.addEventListener("change", (e) => {
    if (!e.target.closest("#map-gm")) return;
    const d = e.target.dataset, m = cur();
    if (d.grid === "cells" || d.grid === "size") renderGM();
    if (d.gset === "name" && m) send({ t: "map_set", map: m.id, fields: { name: e.target.value } });
    if (d.g === "fogon" && m) send({ t: "map_set", map: m.id, fields: { fog_on: e.target.checked } });
    if (d.g === "wadd") wand.add = e.target.checked;
    if (d.zn && m) send({ t: "zone_set", map: m.id, id: d.zn, fields: { name: e.target.value } });
    if (e.target.name === "mmode") send({ t: "map_mode", mode: e.target.value });
    if (d.g === "mlimit") send({ t: "map_mode", limit: e.target.checked });
  });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#map-gm-toggle")) { panelOpen = !panelOpen; MC.store.set("map_gm_open", panelOpen ? "1" : "0"); renderGM(); return; }
    if (!e.target.closest("#map-gm")) return;
    const gtb = e.target.closest("#map-gm [data-gridtype]");
    if (gtb) { setGrid("type", gtb.dataset.gridtype); renderGM(); return; }
    const el = e.target.closest("[data-gmdel],[data-gsec],[data-g],[data-gopen],[data-zt],[data-zd],[data-gtok],[data-th],[data-grpgo],[data-grpedit]");
    if (!el) return;
    const d = el.dataset, m = cur();
    if (d.gsec) { section = section === d.gsec ? "" : d.gsec; MC.store.set("map_gm_sec", section); renderGM(); return; }
    if (d.gmdel) {
      const x = list.find((q) => q.id === d.gmdel);
      if (x && await MC.confirm(t("confirm.delete", { name: x.name }))) send({ t: "map_del", map: x.id });
      return;
    }
    if (d.gopen) { await req({ t: "map_get", id: d.gopen }); return; }
    if (d.grpgo) { const g = groups().find((x) => x.id === d.grpgo); if (g) spawn(g.members); return; }
    if (d.grpedit) { const g = groups().find((x) => x.id === d.grpedit); if (g) groupForm(g); return; }
    if (d.zt && m) { const zn = zones().find((x) => x.id === d.zt); if (zn) send({ t: "zone_set", map: m.id, id: zn.id, fields: { open: !zn.open } }); return; }
    if (d.zd && m) { send({ t: "zone_del", map: m.id, id: d.zd }); return; }
    if (d.th && m) { e.stopPropagation(); const x = m.tokens.find((q) => q.id === d.th); if (x) send({ t: "tok_set", map: m.id, id: x.id, fields: { hidden: !x.hidden } }); return; }
    if (d.gtok && m) { const x = m.tokens.find((q) => q.id === d.gtok); if (x) { M.centerOn(x.x, x.y); M.select(x.id); renderGM(); } return; }
    switch (d.g) {
      case "new": newMap(); break;
      case "terrclear": if (await MC.confirm(t("terr.clear_q"))) send({ t: "terr_clear", map: m.id }); break;
      case "fnew": {
        const n = await foldName();
        if (n) send({ t: "map_set", map: m.id, fields: { folders: [...folders(m), { id: MC.uid().replace(/[^a-z0-9]/gi, "").slice(0, 10), name: n }] } });
        break;
      }
      case "img": replaceImage(); break;
      case "show": send({ t: "map_show", id: M.active ? null : m.id }); break;
      case "del":
        if (await MC.confirm(t("confirm.delete", { name: m.name }))) send({ t: "map_del", map: m.id });
        break;
      case "openall": send({ t: "fog_all", map: m.id, open: true }); break;
      case "closeall": send({ t: "fog_all", map: m.id, open: false }); break;
      case "wok": wandCommit(); break;
      case "wreset": wand.seeds = []; wand.polys = []; renderGM(); M.redraw(); break;
      case "addtok": addPicker(); break;
      case "grpnew": groupForm(null); break;
      case "grpfrom": groupFromMap(); break;
      case "addpcs": addPCs(); break;
      case "tclear": send({ t: "tmpl_clear", map: m.id }); break;
      default: break;
    }
  });

  MC.on("msg_maps", (msg) => { list = msg.maps || []; if (msg.mode) M.mode = msg.mode; if (msg.limit != null) M.limit = !!msg.limit; renderGM(); });
  MC.on("map_limit", () => { if (gm()) renderGM(); });
  MC.on("map_changed", () => {
    if (M.map?.id !== lastMapId) { lastMapId = M.map?.id; zoneSeq = 0; } if (gm()) { if (M.map?.img !== wand.key) { wand.data = null; wand.key = ""; } renderGM(); } });
  MC.on("map_tool", () => { draft = null; hoverZone = null; if (gm()) renderGM(); });
  MC.on("map_img", () => { if (gm() && wand.seeds.length && !wand.data) wandCompute(); });
  MC.on("welcome", () => { if (gm()) { send({ t: "maps" }); send({ t: "grp_list" }); } renderGM(); });
  MC.on("msg_groups", (msg) => { if (MC.GM) MC.GM.groups = msg.groups || []; renderGM(); });
  MC.on("msg_monsters", () => { if (gm() && section === "tokens") renderGM(); });
  MC.on("lang", renderGM);
  MC.on("chars", () => { if (gm()) renderGM(); });
})();
