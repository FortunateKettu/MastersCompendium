// Masters Compendium — вкладка «Мастер»: бестиарий (свои монстры + импорт с ttg.club), раздатки, заметки.
// И у игроков: раздатки в «Партии» и всплывающее окно, когда мастер что-то показал.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const G = (MC.GM = { monsters: [], handouts: [], notes: [], sub: MC.store.get("gm_sub") || "bestiary", q: "", extra: [] });
  /** Другие модули добавляют свои разделы во вкладку мастера: {id, ic, label, html(), mount?(box)} */
  G.addSub = (s) => { G.extra.push(s); };
  const gm = () => MC.isGM();

  async function send(obj, timeout) {
    try { return await MC.request(obj, timeout); } catch (e) { MC.toast(t(e.code ? "err." + e.code : e.message === "timeout" ? "err.timeout" : "conn.offline"), "warn"); return null; }
  }

  // ---------------------------------------------------------------- вкладка
  G.render = () => {
    const box = $("#gm-tab");
    if (!box || !gm()) return;
    const subs = [["bestiary", "skull", "gm.bestiary"], ["handouts", "scroll", "gm.handouts"], ["notes", "pen", "gm.notes"], ...G.extra.map((x) => [x.id, x.ic, x.label])];
    const ex = G.extra.find((x) => x.id === G.sub);
    box.innerHTML = `<div class="chips gm-subs">${subs.map(([k, ic, lb]) => `<button class="chip ${G.sub === k ? "on" : ""}" data-gsub="${k}">${MC.icon(ic, "sm")} ${t(lb)}</button>`).join("")}</div>
      <div id="gm-body">${ex ? ex.html() : G.sub === "bestiary" ? bestiaryHtml() : G.sub === "handouts" ? handoutsHtml() : notesHtml()}</div>`;
    if (ex) ex.mount?.($("#gm-body"));
    else if (G.sub === "notes") mountNoteEditor();
  };

  // ---------------------------------------------------------------- бестиарий
  function bestiaryHtml() {
    const q = G.q.trim().toLowerCase();
    const list = G.monsters.filter((m) => !q || m.name.toLowerCase().includes(q) || (m.name_en || "").toLowerCase().includes(q));
    return `<div class="best-top"><input type="search" id="gm-q" value="${esc(G.q)}" placeholder="${esc(t("gm.mon.search"))}">
        <button class="btn" data-gb="ttg">${MC.icon("download", "sm")} ttg.club</button>
        <button class="btn primary" data-gb="new">${MC.icon("plus", "sm")} ${t("gm.mon.new")}</button></div>
      ${G.monsters.length ? `<div class="muted small best-count">${t("gm.mon.count", { n: list.length })}</div>` : ""}
      <ul class="mon-list">${list.map((m) => `<li class="mon-row" data-mon="${m.id}">
          <span class="mon-av">${esc(m.name.charAt(0).toUpperCase())}${m.img ? `<img src="/asset/${esc(m.img)}" alt="" onerror="this.remove()">` : ""}</span>
          <div class="mon-info"><b>${esc(m.name)}</b><span class="muted small">${esc(m.type || "")}</span></div>
          <div class="mon-stats"><span class="tag">${t("sb.cr_short")} ${esc(m.cr)}</span><span class="mon-st" title="${esc(t("sb.ac"))}">${MC.icon("main", "sm")} ${m.ac}</span><span class="mon-st" title="${esc(t("sb.hp"))}">${MC.icon("heart", "sm")} ${m.hp}</span></div></li>`).join("")
    || `<li class="muted center">${t(G.monsters.length ? "gm.mon.nothing" : "gm.mon.empty")}</li>`}</ul>`;
  }

  async function openMonster(id) {
    let m;
    try { m = await MC.Statblock.get(id); } catch { return; }
    const map = MC.Map.map;
    const v = await MC.Statblock.show(m, [
      { label: t("delete"), value: "del", kind: "danger" },
      ...(MC.canPop() ? [{ label: t("gm.mon.window"), value: "win" }] : []),
      { label: t("edit"), value: "edit" },
      ...(MC.Combat.state.active ? [{ label: t("gm.mon.to_combat"), value: "combat" }] : []),
      ...(map ? [{ label: t("gm.mon.to_map"), value: "map", kind: "primary" }] : []),
    ]);
    if (v === "del" && await MC.confirm(t("confirm.delete", { name: m.name }))) { send({ t: "mon_del", id }); MC.Statblock.forget(id); }
    if (v === "edit") monsterForm(m);
    if (v === "win") MC.popOut("mon", m.id);
    if (v === "map") toMap(m);
    if (v === "combat") send({ t: "cb_add", entry: { name: m.name, mon: m.id, hp: { cur: m.hp, max: m.hp }, ac: m.ac, dex: Math.floor((m.abil.dex - 10) / 2), kind: "npc" }, roll: true });
  }

  async function toMap(m) {
    const map = MC.Map.map;
    if (!map) { MC.toast(t("gm.mon.no_map"), "warn"); return; }
    const v = await MC.modal({ title: t("gm.mon.to_map"), body: `<div class="form-grid">
        <label class="field"><span>${t("map.tok.count")}</span><input name="count" type="number" min="1" max="30" value="1" autofocus></label>
        <label class="check full"><input type="checkbox" name="roll"> ${t("gm.mon.roll_hp", { f: esc(m.hp_formula || "—") })}</label>
        <label class="check full"><input type="checkbox" name="hidden"> ${t("map.tok.hidden")}</label></div>
        <p class="muted small">${t("gm.mon.to_map.hint", { map: esc(map.name) })}</p>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => ({
        count: MC.clamp(MC.int(w.querySelector("[name=count]").value, 1), 1, 30), roll: w.querySelector("[name=roll]").checked, hidden: w.querySelector("[name=hidden]").checked }) }] });
    if (!v) return;
    const s = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[m.size] || 1;
    const spots = MC.Map.freeSpots ? MC.Map.freeSpots(v.count, s) : [];
    const r = await send({ t: "mon_tokens", mon: m.id, map: map.id, count: v.count, roll_hp: v.roll, hidden: v.hidden, spots });
    if (r) MC.toast(t("gm.mon.placed", { n: v.count }), "ok", "map");
  }

  // текст блока (черты, действия…) ⇄ «Название. Текст» абзацами через пустую строку
  const blockToText = (items) => (items || []).map((x) => (x.name ? `${x.name}. ${x.text}` : x.text)).join("\n\n");
  const textToBlock = (s) => String(s || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^([^.\n]{1,80})\.\s+([\s\S]*)$/);
    return m ? { name: m[1].trim(), text: m[2].trim() } : { name: "", text: p };
  });
  const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
  const ABILS = ["str", "dex", "con", "int", "wis", "cha"];

  async function monsterForm(m) {
    const isNew = !m;
    m = m || { name: "", size: "medium", type: "", alignment: "", ac: 12, ac_text: "", hp: 10, hp_formula: "3d8", speed: "30 фт.",
      abil: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: "", skills: "", dmg_vul: "", dmg_res: "", dmg_imm: "",
      cond_imm: "", senses: "", languages: "", cr: "1", xp: 200, pb: 2, traits: [], actions: [], bonus: [], reactions: [], legendary: [], legendary_text: "", lair: "", desc: "", img: "" };
    let img = m.img || "";
    const f = (k, label, extra = "") => `<label class="field"><span>${t(label)}</span><input name="${k}" value="${esc(m[k] ?? "")}" ${extra}></label>`;
    const ta = (k, label, val, rows = 4) => `<label class="field full"><span>${t(label)}</span><textarea name="${k}" rows="${rows}">${esc(val)}</textarea></label>`;
    const v = await MC.modal({ title: isNew ? t("gm.mon.new") : m.name, wide: true,
      body: `<div class="form-grid mon-form">
        ${f("name", "map.name", "autofocus")}
        <label class="field"><span>${t("map.tok.size")}</span><select name="size">${SIZES.map((s, i) => `<option value="${s}" ${m.size === s ? "selected" : ""}>${t(["map.size.tiny", "map.size.small", "map.size.medium", "map.size.large", "map.size.huge", "map.size.garg"][i])}</option>`).join("")}</select></label>
        ${f("type", "gm.f.type")}${f("alignment", "gm.f.alignment")}
        ${f("ac", "sb.ac", 'type="number"')}${f("ac_text", "gm.f.ac_text")}
        ${f("hp", "sb.hp", 'type="number"')}${f("hp_formula", "gm.f.hp_formula")}
        ${f("speed", "sb.speed")}${f("cr", "sb.cr")}${f("xp", "sb.xp", 'type="number"')}${f("pb", "sb.pb", 'type="number"')}
        <div class="field full"><span>${t("gm.f.abil")}</span><div class="mon-abil">${ABILS.map((a) => `<label><small>${esc(MC.R.abName(a, true))}</small><input type="number" min="1" max="30" name="ab_${a}" value="${m.abil?.[a] ?? 10}"></label>`).join("")}</div></div>
        ${f("saves", "sb.saves")}${f("skills", "sb.skills")}${f("dmg_vul", "sb.vul")}${f("dmg_res", "sb.res")}${f("dmg_imm", "sb.imm")}${f("cond_imm", "sb.cimm")}
        ${f("senses", "sb.senses")}${f("languages", "sb.langs")}
        <p class="muted small full">${t("gm.f.blocks_hint")}</p>
        ${ta("traits", "gm.f.traits", blockToText(m.traits))}${ta("actions", "sb.actions", blockToText(m.actions), 6)}
        ${ta("bonus", "sb.bonus", blockToText(m.bonus), 2)}${ta("reactions", "sb.reactions", blockToText(m.reactions), 2)}
        ${ta("legendary_text", "gm.f.legendary_text", m.legendary_text, 2)}${ta("legendary", "sb.legendary", blockToText(m.legendary), 3)}
        ${ta("lair", "sb.lair", m.lair, 2)}${ta("desc", "sb.desc", m.desc, 3)}
        <div class="field"><span>${t("map.tok.image")}</span><button type="button" class="btn" id="mf-img">${MC.icon("image", "sm")} ${t(img ? "map.tok.image_change" : "map.pick_image")}</button></div>
      </div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => {
        const q = (n) => w.querySelector(`[name=${n}]`)?.value ?? "";
        const out = { ...m, img };
        for (const k of ["name", "size", "type", "alignment", "ac_text", "hp_formula", "speed", "cr", "saves", "skills", "dmg_vul", "dmg_res", "dmg_imm", "cond_imm", "senses", "languages", "legendary_text", "lair", "desc"]) out[k] = q(k);
        for (const k of ["ac", "hp", "xp", "pb"]) out[k] = MC.int(q(k), 0);
        out.abil = Object.fromEntries(ABILS.map((a) => [a, MC.clamp(MC.int(q("ab_" + a), 10), 1, 30)]));
        for (const k of ["traits", "actions", "bonus", "reactions", "legendary"]) out[k] = textToBlock(q(k));
        return out;
      } }],
      mount: (box) => box.querySelector("#mf-img").addEventListener("click", async (e) => {
        const file = await MC.pickImageCropped(512);
        if (!file) return;
        try { img = await MC.uploadAsset(file, 512); e.target.closest("button").textContent = "✓ " + file.name; } catch { MC.toast(t("map.upload_failed"), "bad"); }
      }) });
    if (!v) return;
    const r = await send({ t: "mon_save", monster: v });
    if (r?.monster) { MC.Statblock.put(r.monster); MC.toast(t("saved"), "ok", "check"); }
  }

  async function ttgSearch() {
    let items = [], busy = false, q = G.q;
    const listHtml = () => busy ? `<li class="muted center">${t("gm.ttg.loading")}</li>`
      : items.length ? items.map((x) => `<li class="pick-row" data-ttg="${esc(x.slug)}"><span class="pr-name">${esc(x.name)} <span class="muted small pr-en">${esc(x.name_en)}</span></span>
          <span class="muted small">${esc(x.type)} · ${t("sb.cr_short")} ${esc(x.cr)}${x.src ? " · " + esc(x.src) : ""}</span><span class="pr-check">${MC.icon("download", "sm")}</span></li>`).join("")
        : `<li class="muted center">${t("gm.ttg.hint")}</li>`;
    await MC.modal({ title: t("gm.ttg.title"), wide: true,
      body: `<form class="search-bar" id="ttg-f"><input type="search" id="ttg-q" value="${esc(q)}" placeholder="${esc(t("gm.ttg.ph"))}" autofocus><button class="btn primary">${MC.icon("zoom-in", "sm")}</button></form>
        <ul class="pick-list-v" id="ttg-list">${listHtml()}</ul><p class="muted small">${t("gm.ttg.note")}</p>`,
      buttons: [{ label: t("done"), kind: "primary", value: true }],
      mount: (box) => {
        const refresh = () => { box.querySelector("#ttg-list").innerHTML = listHtml(); };
        box.querySelector("#ttg-f").addEventListener("submit", async (e) => {
          e.preventDefault();
          q = box.querySelector("#ttg-q").value.trim();
          if (!q) return;
          busy = true; refresh();
          const r = await send({ t: "ttg_search", q }, 25000);
          busy = false; items = r?.items || []; refresh();
          if (r && !items.length) box.querySelector("#ttg-list").innerHTML = `<li class="muted center">${t("gm.mon.nothing")}</li>`;
        });
        box.addEventListener("click", async (e) => {
          const row = e.target.closest("[data-ttg]");
          if (!row || row.classList.contains("busy")) return;
          row.classList.add("busy");
          row.querySelector(".pr-check").innerHTML = MC.icon("hourglass", "sm");
          const r = await send({ t: "ttg_import", slug: row.dataset.ttg }, 30000);
          row.classList.remove("busy");
          if (r?.monster) {
            MC.Statblock.put(r.monster);
            row.classList.add("picked");
            row.querySelector(".pr-check").innerHTML = MC.icon("check", "sm");
            MC.toast(t("gm.ttg.imported", { name: r.monster.name }), "ok", "check");
          } else row.querySelector(".pr-check").innerHTML = MC.icon("alert", "sm");
        });
      } });
  }

  // ---------------------------------------------------------------- НИП: из бестиария, копией персонажа или пустой
  const AB_WORDS = { str: ["сил", "str"], dex: ["лов", "dex"], con: ["тел", "con"], int: ["инт", "int"], wis: ["мдр", "мудр", "wis"], cha: ["хар", "cha"] };
  const SIZE_EN = { tiny: "Tiny", small: "Small", medium: "Medium", large: "Large", huge: "Huge", gargantuan: "Gargantuan" };
  const n0 = (v) => MC.int(String(v ?? "").replace(/[−–]/g, "-"), 0);
  /** Статблок монстра → лист персонажа (характеристики, хиты, КД, скорость, спасброски, навыки, атаки, умения). */
  function monsterToChar(m) {
    const R = MC.R;
    const doc = R.newCharacter();
    doc.name = m.name;
    doc.portrait = "";
    doc.size = SIZE_EN[m.size] || "Medium";
    doc.abilities = Object.fromEntries(R.ABILS.map((a) => [a, MC.clamp(MC.int(m.abil?.[a], 10), 1, 30)]));
    doc.hp = { max: Math.max(1, MC.int(m.hp, 1)), cur: Math.max(1, MC.int(m.hp, 1)), temp: 0 };
    doc.ac = { mode: "manual", manual: MC.int(m.ac, 10), bonus: 0, unarmored: "none" };
    doc.speed = MC.int(String(m.speed || "").match(/\d+/)?.[0], 30);
    doc.alignment = m.alignment || "";
    const saves = String(m.saves || "").toLowerCase();
    doc.saves = R.ABILS.filter((a) => AB_WORDS[a].some((w) => new RegExp(`(^|[^а-яa-z])${w}`).test(saves)));
    // навыки: «Скрытность +6, Восприятие +4» — ищем по названию; выше «владения» — экспертиза
    const skills = {};
    for (const part of String(m.skills || "").split(/[,;]/)) {
      const mm = part.trim().match(/^(.+?)\s*([+−-]\s*\d+)$/);
      if (!mm) continue;
      const name = mm[1].trim().toLowerCase();
      const sk = (R.srd?.skills || []).find((x) => [x.ru, x.en].some((v) => v && v.toLowerCase() === name));
      if (!sk) continue;
      const base = R.mod(doc.abilities[sk.ab]);
      skills[sk.id] = n0(mm[2].replace(/\s/g, "")) - base >= 4 ? 2 : 1;
    }
    doc.skills = skills;
    doc.profs = { armor: "", weapons: "", tools: "", languages: m.languages || "" };
    // атаки: «+4 к попаданию … 5 (1к6 + 2) рубящего урона»
    const attacks = [], feats = [];
    const addFeat = (x, kind) => feats.push({ id: MC.uid(), name: x.name || kind, src: m.name, desc: x.text || "" });
    for (const x of m.actions || []) {
      const hit = String(x.text || "").match(/([+−-]\s?\d+)\s+(?:к попаданию|to hit)/i);
      const dm = String(x.text || "").match(/\((\d+)\s?[кdD](\d+)\s*(?:([+−-])\s*(\d+))?\)/);
      if (hit && dm) {
        const ranged = /дальнобойн|ranged/i.test(x.text);
        const type = (String(x.text).match(/\)\s*([а-яёa-z]+)\s+(?:урона|damage)/i) || [])[1] || "";
        attacks.push({ id: MC.uid(), name: x.name || "?", item: "", ab: "none", prof: false, bonus: n0(hit[1].replace(/\s/g, "")),
          dmg: `${dm[1]}d${dm[2]}`, dmg2: "", dmg_ab: false, dmg_bonus: dm[4] ? (dm[3] === "+" ? 1 : -1) * MC.int(dm[4]) : 0, dtype: type,
          range: (String(x.text).match(/(?:досягаемость|reach|дистанция|range)\s*([\d/]+\s*(?:фт|ft)\.?)/i) || [])[1] || "",
          props: [], rangeType: ranged ? "ranged" : "melee", notes: x.text });
      } else addFeat(x, t("sb.actions"));
    }
    for (const k of ["traits", "bonus", "reactions", "legendary"]) for (const x of m[k] || []) addFeat(x, t("sb." + (k === "traits" ? "actions" : k)));
    doc.attacks = attacks;
    doc.features = feats;
    doc.notes = [m.type && `${m.type}`, m.senses && `${t("sb.senses")}: ${m.senses}`, m.dmg_res && `${t("sb.res")}: ${m.dmg_res}`,
      m.dmg_imm && `${t("sb.imm")}: ${m.dmg_imm}`, m.cond_imm && `${t("sb.cimm")}: ${m.cond_imm}`, `${t("sb.cr")}: ${m.cr}`, m.desc].filter(Boolean).join("\n");
    return doc;
  }

  async function createNpc(doc) {
    const r = await send({ t: "char_create", doc, owner: null });
    if (r?.char) { MC.toast(t("npc.created", { name: r.char.name }), "ok", "check"); MC.emit("open_sheet", { id: r.char.id, editing: true }); }
  }

  G.npcCreate = async () => {
    await MC.R.load();
    let mode = "mon", q = "", pick = null;
    const chars = [...MC.state.chars.values()];
    const rows = () => {
      const qq = q.trim().toLowerCase();
      if (mode === "mon") {
        return G.monsters.filter((x) => !qq || x.name.toLowerCase().includes(qq) || (x.name_en || "").toLowerCase().includes(qq)).map((x) =>
          `<li class="tp-row ${pick === x.id ? "on" : ""}" data-npick="${x.id}"><span class="tp-av mon">${esc(x.name.charAt(0))}${x.img ? `<img src="/asset/${esc(x.img)}" alt="" onerror="this.remove()">` : ""}</span>
          <div class="tp-info"><b>${esc(x.name)}</b><span class="muted small">${esc(x.type || "")} · ${t("sb.cr_short")} ${esc(x.cr)}</span></div><span class="tp-check">${MC.icon("check", "sm")}</span></li>`).join("")
          || `<li class="muted center tp-none">${t(G.monsters.length ? "gm.mon.nothing" : "gm.mon.empty")}</li>`;
      }
      return chars.filter((c) => !qq || c.name.toLowerCase().includes(qq)).map((c) => {
        const o = MC.state.players.find((p) => p.id === c.owner);
        return `<li class="tp-row ${pick === c.id ? "on" : ""}" data-npick="${c.id}"><span class="tp-av" style="background:${esc(o?.color || "#555")}">${c.portrait ? `<img src="${esc(c.portrait)}" alt="">` : esc(c.name.charAt(0))}</span>
          <div class="tp-info"><b>${esc(c.name)}</b><span class="muted small">${esc(o ? o.name : t("chars.npc"))}</span></div><span class="tp-check">${MC.icon("check", "sm")}</span></li>`;
      }).join("") || `<li class="muted center tp-none">${t("map.no_pcs")}</li>`;
    };
    const tabs = [["mon", "skull", "npc.from_mon"], ["copy", "copy", "npc.from_pc"], ["blank", "file-new", "npc.blank"]];
    const v = await MC.modal({ title: t("npc.title"), wide: true,
      body: `<div class="chips">${tabs.map(([k, ic, l]) => `<button type="button" class="chip ${mode === k ? "on" : ""}" data-nmode="${k}">${MC.icon(ic, "sm")} ${t(l)}</button>`).join("")}</div>
        <p class="muted small" id="npc-hint">${t("npc.hint.mon")}</p>
        <input type="search" id="npc-q" placeholder="${esc(t("map.tp.search"))}">
        <ul class="tp-list" id="npc-list" style="margin-top:10px">${rows()}</ul>
        <label class="field" style="margin-top:12px"><span>${t("npc.name")}</span><input id="npc-name" placeholder="${esc(t("npc.name_ph"))}"></label>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("create"), kind: "primary", value: (w) => ({ mode, pick, name: w.querySelector("#npc-name").value.trim() }) }],
      mount: (box) => {
        const list = box.querySelector("#npc-list"), hint = box.querySelector("#npc-hint"), qi = box.querySelector("#npc-q");
        const re = () => {
          list.innerHTML = mode === "blank" ? "" : rows();
          list.hidden = qi.hidden = mode === "blank";
          hint.textContent = t("npc.hint." + mode);
          box.querySelectorAll("[data-nmode]").forEach((b) => b.classList.toggle("on", b.dataset.nmode === mode));
        };
        qi.addEventListener("input", () => { q = qi.value; re(); });
        box.addEventListener("click", (e) => {
          const md = e.target.closest("[data-nmode]");
          if (md) { mode = md.dataset.nmode; pick = null; re(); return; }
          const r = e.target.closest("[data-npick]");
          if (r) { pick = r.dataset.npick; re(); }
        });
      } });
    if (!v) return;
    let doc;
    if (v.mode === "blank") {
      doc = MC.R.newCharacter();
      doc.name = v.name || t("npc.default");
      doc.hp = { max: 10, cur: 10, temp: 0 };
    } else if (!v.pick) { MC.toast(t("npc.pick"), "warn"); return; }
    else if (v.mode === "mon") {
      let m;
      try { m = await MC.Statblock.get(v.pick); } catch { MC.toast(t("err.not_found"), "warn"); return; }
      doc = monsterToChar(m);
      if (m.img) doc.portrait_asset = m.img;
      if (v.name) doc.name = v.name;
    } else {
      const r = await send({ t: "char_get", id: v.pick });
      if (!r?.char) return;
      doc = MC.clone(r.char);
      delete doc.id; delete doc.owner; delete doc.version;
      doc.name = v.name || `${doc.name} (${t("npc.copy")})`;
    }
    // портрет НИП из жетона монстра — маленькая картинка прямо в листе
    if (doc.portrait_asset) {
      try { doc.portrait = await assetToDataUrl(doc.portrait_asset); } catch { /* без портрета */ }
      delete doc.portrait_asset;
    }
    createNpc(doc);
  };
  async function assetToDataUrl(id) {
    const blob = await (await fetch("/asset/" + id)).blob();
    return MC.imageToDataUrl(blob, 256);
  }

  // ---------------------------------------------------------------- раздатки
  const shareLabel = (h) => (h.to === "all" ? t("gm.ho.to_all") : Array.isArray(h.to) && h.to.length
    ? h.to.map((id) => MC.state.players.find((p) => p.id === id)?.name || "?").join(", ") : t("gm.ho.to_none"));
  function handoutsHtml() {
    return `<div class="row-btns"><button class="btn small primary" data-gh="new">${MC.icon("plus", "sm")} ${t("gm.ho.new")}</button>
      <button class="btn small" data-gh="give">${MC.icon("inventory", "sm")} ${t("give.title")}</button>
      <button class="btn small" data-gh="cur">${MC.icon("coins", "sm")} ${t("money.cur_title")}</button></div>
      <ul class="ho-list">${G.handouts.slice().reverse().map((h) => `<li class="ho-row" data-ho="${h.id}">
        ${h.img ? `<img src="/asset/${esc(h.img)}" alt="">` : `<span class="mon-av">${MC.icon("scroll", "sm")}</span>`}
        <div class="mon-info"><b>${esc(h.title)}</b><span class="muted small">${MC.icon(h.to === "all" || h.to?.length ? "eye" : "hidden", "sm")} ${esc(shareLabel(h))}</span></div>
        <button class="btn small" data-hoshare="${h.id}">${MC.icon("cast", "sm")} ${t("gm.ho.share")}</button></li>`).join("")
      || `<li class="muted center">${t("gm.ho.empty")}</li>`}</ul>`;
  }
  async function handoutForm(h) {
    const isNew = !h;
    h = h || { title: "", text: "", img: "", to: [] };
    let img = h.img || "";
    const v = await MC.modal({ title: isNew ? t("gm.ho.new") : h.title, wide: true,
      body: `<div class="form-grid"><label class="field full"><span>${t("gm.ho.title")}</span><input name="title" value="${esc(h.title)}" autofocus></label>
        <label class="field full"><span>${t("gm.ho.text")}</span><textarea name="text" rows="8">${esc(h.text)}</textarea></label>
        <div class="field full"><span>${t("map.tok.image")}</span><div class="row-btns"><button type="button" class="btn" id="ho-img">${MC.icon("image", "sm")} ${t(img ? "map.tok.image_change" : "map.pick_image")}</button>
        ${img ? `<button type="button" class="btn" id="ho-noimg">${MC.icon("trash", "sm")}</button>` : ""}</div></div></div>`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "danger", value: "del" }]), { label: t("cancel"), value: null },
        { label: t("save"), kind: "primary", value: (w) => ({ id: h.id, title: w.querySelector("[name=title]").value, text: w.querySelector("[name=text]").value, img }) }],
      mount: (box) => box.addEventListener("click", async (e) => {
        if (e.target.closest("#ho-noimg")) { img = ""; e.target.closest("#ho-noimg").remove(); return; }
        if (!e.target.closest("#ho-img")) return;
        const file = await MC.pickFile("image/*");
        if (!file) return;
        try { img = await MC.uploadAsset(file, 2400); e.target.closest("#ho-img").textContent = "✓ " + file.name; } catch { MC.toast(t("map.upload_failed"), "bad"); }
      }) });
    if (v === "del") { if (await MC.confirm(t("confirm.delete", { name: h.title }))) send({ t: "ho_del", id: h.id }); return; }
    if (v) send({ t: "ho_save", handout: v });
  }
  async function shareForm(h) {
    const pls = MC.state.players;
    const to = h.to === "all" ? pls.map((p) => p.id) : h.to || [];
    const v = await MC.modal({ title: t("gm.ho.share") + ": " + h.title, body: `<div class="ho-share">
        ${pls.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" ${to.includes(p.id) ? "checked" : ""}> <i class="dot on" style="background:${esc(p.color)}"></i> ${esc(p.name)}</label>`).join("") || `<p class="muted">${t("gm.ho.no_players")}</p>`}</div>`,
      buttons: [{ label: t("gm.ho.hide"), value: "none" },
        { label: t("gm.ho.to_sel"), value: (w) => [...w.querySelectorAll(".ho-share input:checked")].map((x) => x.value) },
        { label: t("gm.ho.to_all"), kind: "primary", value: "all" }] });
    if (!v) return;
    send({ t: "ho_share", id: h.id, to: v === "none" ? [] : v });
  }

  // у игрока — в «Партии»
  function renderPlayerHandouts() {
    const box = $("#handouts");
    if (!box) return;
    const list = gm() ? [] : G.handouts.slice().reverse();
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<h2 class="section">${MC.icon("scroll", "sm")} ${t("gm.handouts")}</h2>
      <ul class="ho-list">${list.map((h) => `<li class="ho-row" data-hoview="${h.id}">${h.img ? `<img src="/asset/${esc(h.img)}" alt="">` : `<span class="mon-av">${MC.icon("scroll", "sm")}</span>`}
        <div class="mon-info"><b>${esc(h.title)}</b><span class="muted small">${esc((h.text || "").slice(0, 80))}</span></div></li>`).join("")}</ul>` : "";
  }
  function viewHandout(h) {
    MC.store.set("ho_seen_" + h.id + "_" + (h.ts || 0), "1");
    MC.modal({ title: h.title, wide: true, body: `<div class="handout">${h.img ? `<img src="/asset/${esc(h.img)}" alt="">` : ""}
      ${h.text ? `<p>${esc(h.text).replace(/\n/g, "<br>")}</p>` : ""}</div>`, buttons: [{ label: t("close"), kind: "primary", value: null }] });
  }

  // ---------------------------------------------------------------- заметки
  let noteCur = null, noteQ = "";
  // ---------- редактор: форматирование как в текстовом редакторе, хранится как безопасный HTML
  const OK_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "H1", "H2", "H3", "P", "DIV", "BR", "UL", "OL", "LI", "BLOCKQUOTE",
    "HR", "A", "SPAN", "FONT", "MARK", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "CODE", "PRE", "SUB", "SUP"]);
  const OK_STYLE = /^(color|background-color|text-align|text-decoration(-line)?|font-weight|font-style)$/;
  /** Оставить только разрешённые теги и стили (заметки — это HTML, но без скриптов и чужих ссылок-ловушек). */
  G.cleanHtml = (html) => {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const walk = (node) => {
      for (const el of [...node.children]) {
        if (!OK_TAGS.has(el.tagName)) {
          if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"].includes(el.tagName)) { el.remove(); continue; }
          walk(el);
          el.replaceWith(...el.childNodes);
          continue;
        }
        for (const a of [...el.attributes]) {
          const n = a.name.toLowerCase();
          if (n === "style") {
            const keep = a.value.split(";").map((x) => x.trim()).filter((x) => { const k = x.split(":")[0]?.trim().toLowerCase(); return k && OK_STYLE.test(k) && !/url\(|expression/i.test(x); });
            if (keep.length) el.setAttribute("style", keep.join("; ")); else el.removeAttribute("style");
          } else if (n === "href" && el.tagName === "A") {
            if (!/^https?:\/\//i.test(a.value)) el.removeAttribute("href"); else { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
          } else if (n === "class" && /^(chk|done)( (chk|done))*$/.test(a.value)) {
            /* чек-лист */
          } else if (n === "color" && el.tagName === "FONT" && /^#?[0-9a-z]+$/i.test(a.value)) {
            /* <font color> от execCommand */
          } else if (!(n === "target" || n === "rel" || n === "colspan" || n === "rowspan")) el.removeAttribute(a.name);
        }
        walk(el);
      }
    };
    walk(doc.body.firstChild);
    return doc.body.firstChild.innerHTML;
  };
  const noteHtml = (n) => (n.fmt === "html" ? G.cleanHtml(n.text || "") : esc(n.text || "").replace(/\n/g, "<br>"));
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent || ""; };
  const NOTE_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa", "#f472b6", "#e5e7eb"];
  const TB = [["bold", "B", "nf.bold"], ["italic", "I", "nf.italic"], ["underline", "U", "nf.underline"], ["strikeThrough", "S", "nf.strike"], ["|"],
    ["h1", "H1", "nf.h1"], ["h2", "H2", "nf.h2"], ["p", "¶", "nf.p"], ["|"], ["ul", "•", "nf.ul"], ["ol", "1.", "nf.ol"], ["check", "☑", "nf.check"],
    ["quote", "❝", "nf.quote"], ["hr", "—", "nf.hr"], ["table", "▦", "nf.table"], ["|"], ["link", "🔗", "nf.link"], ["color", "A", "nf.color"], ["mark", "▮", "nf.mark"],
    ["clear", "⌫", "nf.clear"], ["|"], ["undo", "↶", "nf.undo"], ["redo", "↷", "nf.redo"]];
  function notesHtml() {
    const q = noteQ.trim().toLowerCase();
    const list = G.notes.slice().sort((a, b) => (b.pin - a.pin) || (b.ts - a.ts))
      .filter((x) => !q || (x.title + " " + plain(x.fmt === "html" ? x.text : esc(x.text || ""))).toLowerCase().includes(q));
    const n = G.notes.find((x) => x.id === noteCur);
    return `<div class="notes-wrap"><div class="notes-side">
        <button class="btn small primary" data-gn="new">${MC.icon("plus", "sm")} ${t("gm.note.new")}</button>
        <input type="search" id="note-q" value="${esc(noteQ)}" placeholder="${esc(t("search"))}">
        <ul class="note-list">${list.map((x) => `<li class="${x.id === noteCur ? "cur" : ""}" data-note="${x.id}">${x.pin ? MC.icon("star", "sm") : ""}<span>${esc(x.title)}</span></li>`).join("") || `<li class="muted small">${t(q ? "gm.mon.nothing" : "gm.note.empty")}</li>`}</ul></div>
      <div class="notes-main">${n ? `<div class="note-head"><input id="note-title" value="${esc(n.title)}">
          <button class="icon-btn small ${n.pin ? "ok" : ""}" data-gn="pin" title="${esc(t("gm.note.pin"))}">${MC.icon("star", "sm")}</button>
          <button class="icon-btn small" data-gn="del">${MC.icon("trash", "sm")}</button></div>
        <div class="note-tb">${TB.map(([k, l, tt]) => (k === "|" ? '<i class="tb-sep"></i>' : `<button type="button" class="tb-b tb-${k}" data-nf="${k}" title="${esc(t(tt))}">${l}</button>`)).join("")}
          <div class="tb-pop" id="nf-colors" hidden>${NOTE_COLORS.map((c) => `<button type="button" data-nfc="${c}" style="background:${c}"></button>`).join("")}<button type="button" data-nfc="" title="${esc(t("nf.nocolor"))}">✕</button></div></div>
        <div id="note-text" class="note-ed" contenteditable="true" spellcheck="true" data-ph="${esc(t("gm.note.ph"))}">${noteHtml(n)}</div>
        <div class="muted small note-foot"><span id="note-state">${t("gm.note.autosave")}</span><span id="note-wc"></span></div>`
    : `<p class="muted center">${t("gm.note.pick")}</p>`}</div></div>`;
  }
  let colorMode = "color";
  function mountNoteEditor() {
    const ed = $("#note-text");
    if (!ed) return;
    try { document.execCommand("styleWithCSS", false, true); document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* старые браузеры */ }
    const wc = () => { const w = (ed.textContent || "").trim().split(/\s+/).filter(Boolean).length; const el = $("#note-wc"); if (el) el.textContent = t("nf.words", { n: w }); };
    wc();
    ed.addEventListener("input", wc);
    // чек-лист: щелчок по квадратику слева — отметить
    ed.addEventListener("click", (e) => {
      const li = e.target.closest("ul.chk > li");
      if (!li) return;
      const r = li.getBoundingClientRect();
      if (e.clientX - r.left < 24) { li.classList.toggle("done"); saveNote(); }
    });
    ed.addEventListener("paste", (e) => {
      const html = e.clipboardData?.getData("text/html");
      if (!html) return;
      e.preventDefault();
      document.execCommand("insertHTML", false, G.cleanHtml(html));
    });
  }
  // кнопки панели не забирают выделение у текста
  document.addEventListener("mousedown", (e) => { if (e.target.closest("[data-nf],[data-nfc]")) e.preventDefault(); });
  function noteCmd(k) {
    const ed = $("#note-text");
    if (!ed) return;
    ed.focus();
    const ex = (c, v = null) => document.execCommand(c, false, v);
    if (["bold", "italic", "underline", "strikeThrough", "undo", "redo"].includes(k)) ex(k);
    if (k === "h1" || k === "h2") ex("formatBlock", k.toUpperCase());
    if (k === "p") ex("formatBlock", "P");
    if (k === "quote") ex("formatBlock", "BLOCKQUOTE");
    if (k === "ul") ex("insertUnorderedList");
    if (k === "ol") ex("insertOrderedList");
    if (k === "hr") ex("insertHorizontalRule");
    if (k === "clear") { ex("removeFormat"); ex("formatBlock", "P"); }
    if (k === "check") {
      ex("insertUnorderedList");
      const sel = window.getSelection();
      const ul = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest("ul");
      if (ul && ed.contains(ul)) {
        ul.classList.add("chk");
        // курсор — в конец пункта (иначе Chromium ставит его в начало)
        const li = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest("li");
        if (li && sel.isCollapsed) { const r = document.createRange(); r.selectNodeContents(li); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
      }
    }
    if (k === "table") ex("insertHTML", `<table><tbody>${"<tr>" + "<td>&nbsp;</td>".repeat(3) + "</tr>"}${"<tr>" + "<td>&nbsp;</td>".repeat(3) + "</tr>"}</tbody></table><p><br></p>`);
    if (k === "link") {
      const url = window.prompt(t("nf.link_q"), "https://");
      if (url && /^https?:\/\//i.test(url)) ex("createLink", url);
    }
    saveNote();
  }
  let noteTimer = 0;
  function saveNote(immediate = false) {
    const n = G.notes.find((x) => x.id === noteCur);
    if (!n) return;
    clearTimeout(noteTimer);
    const go = () => {
      n.title = $("#note-title")?.value ?? n.title;
      const ed = $("#note-text");
      if (ed) { n.text = G.cleanHtml(ed.innerHTML); n.fmt = "html"; }
      MC.send({ t: "note_save", note: n, rid: MC.uid() });
      const st = $("#note-state"); if (st) st.textContent = t("gm.note.saved");
    };
    if (immediate) go(); else noteTimer = setTimeout(go, 800);
  }

  // ---------------------------------------------------------------- события
  document.addEventListener("click", async (e) => {
    const nf = e.target.closest("[data-nf]");
    if (nf) {
      e.preventDefault();
      if (nf.dataset.nf === "color" || nf.dataset.nf === "mark") { colorMode = nf.dataset.nf; const p = $("#nf-colors"); if (p) p.hidden = !p.hidden; return; }
      noteCmd(nf.dataset.nf);
      return;
    }
    const nfc = e.target.closest("[data-nfc]");
    if (nfc) {
      $("#note-text")?.focus();
      const c = nfc.dataset.nfc;
      if (colorMode === "color") document.execCommand("foreColor", false, c || "#e5e7eb");
      else document.execCommand("hiliteColor", false, c ? c + "55" : "transparent");
      $("#nf-colors").hidden = true;
      saveNote();
      return;
    }
    const sub = e.target.closest("[data-gsub]");
    if (sub) { saveNote(true); G.sub = sub.dataset.gsub; MC.store.set("gm_sub", G.sub); G.render(); return; }
    const gb = e.target.closest("[data-gb]");
    if (gb) { if (gb.dataset.gb === "ttg") ttgSearch(); else monsterForm(null); return; }
    const mon = e.target.closest("[data-mon]");
    if (mon) { openMonster(mon.dataset.mon); return; }
    const hs = e.target.closest("[data-hoshare]");
    if (hs) { e.stopPropagation(); const h = G.handouts.find((x) => x.id === hs.dataset.hoshare); if (h) shareForm(h); return; }
    const ho = e.target.closest("[data-ho]");
    if (ho) { const h = G.handouts.find((x) => x.id === ho.dataset.ho); if (h) handoutForm(h); return; }
    if (e.target.closest("[data-gh=new]")) { handoutForm(null); return; }
    if (e.target.closest("[data-gh=give]")) { MC.Money.giveDialog(); return; }
    if (e.target.closest("[data-gh=cur]")) { MC.Money.editor(); return; }
    const hv = e.target.closest("[data-hoview]");
    if (hv) { const h = G.handouts.find((x) => x.id === hv.dataset.hoview); if (h) viewHandout(h); return; }
    const nt = e.target.closest("[data-note]");
    if (nt) { saveNote(true); noteCur = nt.dataset.note; G.render(); return; }
    const gn = e.target.closest("[data-gn]");
    if (gn) {
      const a = gn.dataset.gn;
      if (a === "new") {
        saveNote(true);
        const r = await send({ t: "note_save", note: { title: t("gm.note.untitled"), text: "" } });
        if (r?.note) { noteCur = r.note.id; if (!G.notes.some((x) => x.id === r.note.id)) G.notes.push(r.note); G.render(); $("#note-title")?.select(); }
      }
      const n = G.notes.find((x) => x.id === noteCur);
      if (a === "pin" && n) { n.pin = !n.pin; saveNote(true); G.render(); }
      if (a === "del" && n && await MC.confirm(t("confirm.delete", { name: n.title }))) { send({ t: "note_del", id: n.id }); noteCur = null; }
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "gm-q") {
      G.q = e.target.value;
      const pos = e.target.selectionStart;
      G.render();
      const el = $("#gm-q"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }
    if (e.target.id === "note-text" || e.target.id === "note-title") { const st = $("#note-state"); if (st) st.textContent = t("gm.note.typing"); saveNote(); }
    if (e.target.id === "note-q") {
      noteQ = e.target.value;
      const pos = e.target.selectionStart;
      G.render();
      const el = $("#note-q"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }
  });

  MC.on("msg_monsters", (m) => { G.monsters = m.monsters || []; if (G.sub === "bestiary") G.render(); });
  MC.on("msg_handouts", (m) => {
    G.handouts = m.handouts || [];
    if (gm()) { if (G.sub === "handouts") G.render(); return; }
    renderPlayerHandouts();
    // показанное, пока игрок был не в сети, — тоже покажем один раз
    const fresh = G.handouts.filter((h) => !MC.store.get("ho_seen_" + h.id + "_" + (h.ts || 0)));
    if (fresh.length && G.handoutsLoaded) viewHandout(fresh[fresh.length - 1]);
    G.handoutsLoaded = true;
  });
  MC.on("msg_handout_new", (m) => { MC.toast(t("gm.ho.got", { title: m.title }), "ok", "scroll"); });
  MC.on("msg_notes", (m) => {
    const typing = document.activeElement && ["note-text", "note-title"].includes(document.activeElement.id);
    G.notes = (m.notes || []).filter((x) => x && x.id);
    if (G.sub === "notes" && !typing) G.render();
  });
  MC.on("welcome", () => {
    G.handoutsLoaded = false;
    MC.send({ t: "ho_list" });
    if (gm()) { MC.send({ t: "mon_list" }); MC.send({ t: "notes" }); }
    document.querySelector('[data-go="gm"]')?.toggleAttribute("hidden", !gm());
  });
  MC.on("tab", (tab) => { if (tab === "gm") G.render(); else saveNote(true); });
  MC.on("lang", () => { G.render(); renderPlayerHandouts(); });
  MC.on("players", () => { if (G.sub === "handouts") G.render(); });
})();

(() => {
  const MC = window.MC;
  const t = MC.t;
  MC.ctxAdd?.("[data-note]", (el) => {
    if (!MC.isGM()) return null;
    const n = MC.GM.notes.find((x) => x.id === el.dataset.note);
    if (!n) return null;
    return { title: n.title, items: [
      { ic: "pen", label: t("ctx.open"), fn: () => el.click() },
      { ic: "star", label: t(n.pin ? "ctx.unpin" : "gm.note.pin"), fn: () => MC.request({ t: "note_save", note: { ...n, pin: !n.pin } }).then(() => MC.GM.render()).catch(() => {}) },
      { ic: "trash", label: t("delete"), bad: true, fn: async () => { if (await MC.confirm(t("confirm.delete", { name: n.title }))) { MC.send({ t: "note_del", id: n.id }); } } },
    ] };
  });
})();
