// Masters Compendium — окна листа: основная информация, атаки, заклинания, предметы, умения,
// состояния, отдых, повышение уровня, меню персонажа.
(() => {
  "use strict";
  const MC = window.MC;
  const R = MC.R, S = MC.Sheet, ACT = MC.Sheet.ACT;
  const t = MC.t, esc = MC.esc;

  // ---------------------------------------------------------------- формы
  const F = (MC.F = {});
  F.field = (label, html, cls = "") => `<label class="field ${cls}"><span>${esc(label)}</span>${html}</label>`;
  F.input = (name, val = "", attrs = "") => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
  F.num = (name, val = 0, attrs = "") => `<input name="${name}" type="number" inputmode="numeric" data-type="int" value="${esc(val)}" ${attrs}>`;
  F.area = (name, val = "", rows = 4) => `<textarea name="${name}" rows="${rows}">${esc(val)}</textarea>`;
  F.check = (name, on, label) => `<label class="check"><input type="checkbox" name="${name}" data-type="bool" ${on ? "checked" : ""}> ${esc(label)}</label>`;
  F.select = (name, options, val) => `<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  F.read = (root) => {
    const out = {};
    root.querySelectorAll("[name]").forEach((el) => {
      if (el.type === "radio" && !el.checked) return;
      const ty = el.dataset.type;
      out[el.name] = ty === "int" ? MC.int(el.value, 0) : ty === "num" ? MC.num(el.value, 0) : ty === "bool" ? el.checked : el.value.trim();
    });
    return out;
  };
  const abOptions = (extra = []) => [...extra, ...R.ABILS.map((a) => [a, R.abName(a, false)])];
  const dtypeOptions = () => [["", "—"], ...Object.keys(R.srd.damage).map((k) => [k, R.dmgType(k)])];

  // ---------------------------------------------------------------- портрет
  ACT.portrait = async () => {
    if (!S.cur.editing) { ACT.edit(); return; }
    const f = await MC.pickImageCropped(256);
    if (!f) return;
    try { S.set(["portrait"], await MC.imageToDataUrl(f, 256)); } catch { MC.toast(t("err.bad_request"), "bad"); }
  };

  // ---------------------------------------------------------------- основная информация
  ACT.info = async (el, doc) => {
    const raceOpts = [["", "—"], ...R.srd.races.flatMap((r) => [[r.id, MC.L(r)]]), ["_custom", t("wz.race.custom")]];
    const subOpts = (rid) => [["", "—"], ...(R.srd.race[rid]?.subraces || []).map((s) => [s.id, MC.L(s)])];
    const clsRow = (k, i) => {
      const c = R.srd.cls[k.id];
      return `<div class="cls-row" data-i="${i}">
        ${F.field(t("sh.class"), F.select(`c${i}_id`, [...R.srd.classes.map((x) => [x.id, MC.L(x)]), ["_custom", t("wz.class.custom")]], c ? k.id : "_custom"))}
        ${F.field(t("wz.class.custom.ph"), F.input(`c${i}_name`, k.name || ""), c ? "hide-custom" : "")}
        ${F.field(t("sh.subclass"), c && c.subclasses.length ? F.select(`c${i}_sub`, [["", "—"], ...c.subclasses.map((s) => [s.id, MC.L(s)]), ["_custom", t("custom")]], k.sub && c.subclasses.some((s) => s.id === k.sub) ? k.sub : k.sub_name ? "_custom" : "") : "")}
        ${F.field(t("sh.subclass") + " (" + t("custom").toLowerCase() + ")", F.input(`c${i}_subname`, k.sub_name || ""))}
        ${F.field(t("level"), F.num(`c${i}_level`, k.level, 'min="1" max="20"'))}
        ${F.field(t("wz.hd"), F.select(`c${i}_hd`, [6, 8, 10, 12].map((d) => [d, "d" + d]), k.hd || 8))}
        ${F.field(t("sp.ability"), F.select(`c${i}_caster`, [["", t("atk.none")], ["full", "Full"], ["half", "Half"], ["third", "1/3"], ["pact", "Pact"]], k.caster || ""))}
      </div>`;
    };
    const al = R.ALIGNMENTS[MC.lang] || R.ALIGNMENTS.en;
    const v = await MC.modal({
      title: t("sh.name") + " · " + t("sh.race") + " · " + t("sh.class"), wide: true,
      body: `<div class="form-grid">
        ${F.field(t("sh.name"), F.input("name", doc.name, 'maxlength="32"'))}
        ${F.field(t("sh.race"), F.select("race_id", raceOpts, doc.race.name ? "_custom" : doc.race.id))}
        ${F.field(t("wz.subrace"), `<span class="sub-slot">${F.select("race_sub", subOpts(doc.race.id), doc.race.sub)}</span>`)}
        ${F.field(t("wz.race.custom.ph"), F.input("race_name", doc.race.name))}
        ${F.field(t("sh.background"), F.select("bg_id", [["", "—"], ...R.srd.backgrounds.map((b) => [b.id, MC.L(b)]), ["_custom", t("wz.bg.custom")]], doc.background.name ? "_custom" : doc.background.id))}
        ${F.field(t("wz.bg.custom"), F.input("bg_name", doc.background.name))}
        ${F.field(t("sh.alignment"), `<input name="alignment" list="al-list" value="${esc(doc.alignment)}"><datalist id="al-list">${al.map((a) => `<option value="${esc(a)}">`).join("")}</datalist>`)}
        ${F.field(t("sh.xp"), F.num("xp", doc.xp))}
        ${F.field(t("st.speed"), F.num("speed", doc.speed))}
      </div>
      <h3>${t("sh.class")}</h3>
      <div class="cls-rows">${(doc.classes.length ? doc.classes : [{ id: "", level: 1, hd: 8 }]).map(clsRow).join("")}</div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }],
      mount: (m) => m.querySelector('[name="race_id"]').addEventListener("change", (e) => {
        m.querySelector(".sub-slot").innerHTML = F.select("race_sub", subOpts(e.target.value), "");
      }),
    });
    if (!v) return;
    const classes = doc.classes.length ? doc.classes : [{ id: "", level: 1, hd: 8 }];
    const newClasses = classes.map((k, i) => {
      const id = v[`c${i}_id`];
      const c = R.srd.cls[id];
      const sub = v[`c${i}_sub`] || "";
      return {
        ...k, id: c ? id : "", name: c ? "" : v[`c${i}_name`] || k.name || "?",
        sub: sub && sub !== "_custom" ? sub : "", sub_name: sub === "_custom" || !c ? v[`c${i}_subname`] : "",
        level: MC.clamp(MC.int(v[`c${i}_level`], 1), 1, 20), hd: MC.int(v[`c${i}_hd`], 8),
        caster: v[`c${i}_caster`] || null, ability: c?.spell_ability || k.ability || null,
      };
    });
    const isCustomRace = v.race_id === "_custom" || !v.race_id;
    S.patch([
      { op: "set", path: ["name"], value: v.name || doc.name },
      { op: "set", path: ["race"], value: { id: isCustomRace ? "" : v.race_id, sub: isCustomRace ? "" : v.race_sub, name: isCustomRace ? v.race_name : "" } },
      { op: "set", path: ["background"], value: { id: v.bg_id === "_custom" ? "" : v.bg_id, name: v.bg_id === "_custom" ? v.bg_name : "" } },
      { op: "set", path: ["alignment"], value: v.alignment },
      { op: "set", path: ["xp"], value: v.xp },
      { op: "set", path: ["speed"], value: v.speed },
      { op: "set", path: ["classes"], value: newClasses },
    ]);
  };

  // ---------------------------------------------------------------- состояния
  ACT.conditions = async (el, doc) => {
    const on = new Set(doc.conditions || []);
    let ex = MC.int(doc.exhaustion, 0);
    const exText = () => (ex ? R.srd.exhaustion_ru.slice(0, ex).map((x, i) => `${i + 1}. ${x}`).join("<br>") : "");
    const v = await MC.modal({
      title: t("sh.conditions"),
      body: `<div class="cond-pick">${R.srd.conditions.map((c) => `<button class="chip ${on.has(c.id) ? "on bad" : ""}" data-c="${c.id}" title="${esc(c.desc_ru)}">${esc(MC.L(c))}</button>`).join("")}</div>
        <p class="muted small" id="cond-desc"></p>
        <div class="field"><span>${t("sh.exhaustion")}</span><div class="stepper"><button data-ex="-1">−</button><b id="ex-v">${ex}</b><button data-ex="1">+</button></div></div>
        <p class="muted small" id="ex-desc">${exText()}</p>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: () => true }],
      mount: (m) => m.addEventListener("click", (e) => {
        const c = e.target.closest("[data-c]");
        if (c) {
          on.has(c.dataset.c) ? on.delete(c.dataset.c) : on.add(c.dataset.c);
          c.classList.toggle("on"); c.classList.toggle("bad");
          m.querySelector("#cond-desc").textContent = R.srd.cond[c.dataset.c].desc_ru;
        }
        const x = e.target.closest("[data-ex]");
        if (x) { ex = MC.clamp(ex + MC.int(x.dataset.ex), 0, 6); m.querySelector("#ex-v").textContent = ex; m.querySelector("#ex-desc").innerHTML = exText(); }
      }),
    });
    if (v) S.patch([{ op: "set", path: ["conditions"], value: [...on] }, { op: "set", path: ["exhaustion"], value: ex }]);
  };

  // ---------------------------------------------------------------- атаки
  async function attackForm(a, isNew) {
    const v = await MC.modal({
      title: isNew ? t("atk.add") : a.name, wide: true,
      body: `<div class="form-grid">
        ${F.field(t("atk.name"), F.input("name", a.name, "autofocus"))}
        ${F.field(t("atk.ability"), F.select("ab", abOptions([["auto", t("atk.auto")], ["spell", t("atk.spell")], ["none", t("atk.none")]]), a.ab || "auto"))}
        ${F.field(t("atk.bonus"), F.num("bonus", a.bonus || 0))}
        ${F.field(t("atk.dmg"), F.input("dmg", a.dmg, 'placeholder="1d8"'))}
        ${F.field(t("atk.dmg_bonus"), F.num("dmg_bonus", a.dmg_bonus || 0))}
        ${F.field(t("atk.dtype"), F.select("dtype", dtypeOptions(), a.dtype))}
        ${F.field(t("atk.range"), F.input("range", a.range))}
        ${F.field(t("atk.notes"), F.input("notes", a.notes))}
      </div>
      ${F.check("prof", a.prof !== false, t("atk.prof"))} ${F.check("dmg_ab", a.dmg_ab !== false, t("atk.dmg_ab"))}`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "bad", value: "delete" }]), { label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }],
    });
    return v;
  }
  ACT["add-attack"] = async () => {
    const v = await attackForm({ ab: "auto", prof: true, dmg_ab: true }, true);
    if (v && typeof v === "object") S.patch([{ op: "add", path: ["attacks"], value: { id: MC.uid(), ...v } }]);
  };
  ACT["edit-attack"] = async (el, doc) => {
    const a = doc.attacks.find((x) => x.id === el.dataset.id);
    if (!a) return;
    const v = await attackForm(a, false);
    if (v === "delete") S.patch([{ op: "remove", path: ["attacks", a.id] }]);
    else if (v && typeof v === "object") S.patch(Object.entries(v).map(([k, val]) => ({ op: "set", path: ["attacks", a.id, k], value: val })));
  };

  // ---------------------------------------------------------------- заклинания
  function spellDetailHtml(doc, sp) {
    const s = R.spellInfo(sp);
    const lv = MC.int(s.lvl, 0);
    const meta = [
      [t("sp.level", { n: lv }).replace("0 ", "") + (lv === 0 ? t("sp.cantrips") : ""), MC.lang === "ru" ? R.srd.schools[s.school] || s.school || "" : s.school || ""],
      [t("sp.time"), s.time], [t("sp.range"), s.range], [t("sp.comp"), [MC.lang === "ru" ? (s.comp || "").replace(/V/g, "В").replace(/S/g, "С").replace(/M/g, "М").split("").join(", ") : s.comp, s.mat ? `(${s.mat})` : ""].filter(Boolean).join(" ")],
      [t("sp.dur"), (s.conc && !/^Концентрация|^Up to/i.test(s.dur || "") ? t("sp.conc") + ", " : "") + (s.dur || "")],
    ].filter(([, b]) => b);
    const dmg = R.spellDamage(doc, sp, lv), heal = R.spellHeal(doc, sp, lv);
    return `<dl class="sp-meta">${meta.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}
        ${s.save ? `<dt>${t("ab.save")}</dt><dd>${R.abName(s.save)} · ${t("sp.dc")} ${R.spellDC(doc)}</dd>` : ""}
        ${dmg ? `<dt>${t("sp.dmg")}</dt><dd>${esc(dmg)} ${esc(R.dmgType(s.dmg?.type))}</dd>` : ""}
        ${heal ? `<dt>${t("sp.heal")}</dt><dd>${esc(heal)}</dd>` : ""}</dl>
      <div class="sp-desc">${esc(s.desc || "").replace(/\n/g, "<br>")}</div>
      ${s.higher ? `<h4>${t("sp.higher")}</h4><div class="sp-desc">${esc(s.higher)}</div>` : ""}`;
  }

  ACT["spell-info"] = async (el, doc) => {
    const sp = doc.spells.list.find((x) => x.id === el.dataset.id);
    if (!sp) return;
    const v = await MC.modal({ title: R.spellName(sp), wide: true, body: spellDetailHtml(doc, sp),
      buttons: [...(sp.srd ? [] : [{ label: t("edit"), value: "edit" }]), { label: t("close"), value: null }, { label: t("sp.cast"), kind: "primary", value: "cast" }] });
    if (v === "cast") ACT.cast({ dataset: { id: sp.id } }, doc);
    if (v === "edit") customSpell(sp);
  };

  ACT.cast = async (el, doc) => {
    const sp = doc.spells.list.find((x) => x.id === el.dataset.id);
    if (!sp) return;
    const s = R.spellInfo(sp);
    const lv = MC.int(s.lvl, 0);
    let slot = lv;
    if (lv > 0) {
      const max = R.slotsMax(doc), used = doc.spells.slots_used || [];
      const pact = R.pact(doc);
      const opts = [];
      for (let i = lv; i <= 9; i++) if (max[i - 1] - MC.int(used[i - 1], 0) > 0) opts.push({ v: "s" + i, label: t("sp.level", { n: i }) + ` (${max[i - 1] - MC.int(used[i - 1], 0)})` });
      if (pact && pact.level >= lv && pact.count - MC.int(doc.spells.pact_used, 0) > 0) opts.push({ v: "p", label: `${t("sp.pact")} · ${pact.level} (${pact.count - MC.int(doc.spells.pact_used, 0)})` });
      if (sp.ritual || s.ritual) opts.push({ v: "r", label: t("sp.ritual") });
      if (!opts.length) { MC.toast(t("sp.no_slots"), "warn"); return; }
      const pick = opts.length === 1 ? opts[0].v : await MC.modal({ title: t("sp.cast_at"),
        body: `<div class="pick-list">${opts.map((o) => `<button class="btn" data-pick="${o.v}">${esc(o.label)}</button>`).join("")}</div>`,
        mount: (m, close) => m.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) close(b.dataset.pick); }) });
      if (!pick) return;
      if (pick === "p") { slot = pact.level; S.set(["spells", "pact_used"], MC.int(doc.spells.pact_used, 0) + 1); }
      else if (pick !== "r") {
        slot = +pick.slice(1);
        const u = (doc.spells.slots_used || []).slice(0, 9); while (u.length < 9) u.push(0);
        u[slot - 1] = MC.int(u[slot - 1], 0) + 1;
        S.set(["spells", "slots_used"], u);
      }
    }
    const name = R.spellName(sp);
    if (s.atk) await S.roll(`1d20${S.fmtMod(R.spellAtk(doc))}`, `${name}: ${t("atk.hit")}`, "attack");
    const dmg = R.spellDamage(doc, sp, slot);
    if (dmg) await S.roll(dmg.replace(/\s/g, ""), `${name}: ${t("sp.dmg")}${s.save ? ` (${t("sp.dc")} ${R.spellDC(doc)} ${R.abName(s.save)})` : ""}`, "damage");
    const heal = R.spellHeal(doc, sp, slot);
    if (heal) await S.roll(heal.replace(/\s/g, ""), `${name}: ${t("sp.heal")}`, "damage");
    if (!dmg && !heal && !s.atk) MC.toast(`${name}${slot ? " · " + t("sp.level", { n: slot }) : ""}`, "ok", "spells");
  };

  ACT["add-spell"] = async (el, doc) => {
    const myClasses = new Set((doc.classes || []).map((k) => k.id).filter(Boolean));
    let onlyMine = myClasses.size > 0, q = "", lvlF = "";
    const has = () => new Set((S.doc().spells.list || []).map((x) => x.srd).filter(Boolean));
    const list = () => R.srd.spells.filter((s) => (!onlyMine || s.classes.some((c) => myClasses.has(c)))
      && (lvlF === "" || s.lvl === +lvlF) && (!q || s.en.toLowerCase().includes(q) || (s.ru || "").toLowerCase().includes(q)))
      .sort((a, b) => a.lvl - b.lvl || R.srdSpellName(a).localeCompare(R.srdSpellName(b)));
    const rows = () => { const h = has(); return list().slice(0, 150).map((s) => `<li class="pick-row ${h.has(s.id) ? "picked" : ""}" data-sp="${s.id}">
      <span class="pr-check">${MC.icon(h.has(s.id) ? "check" : "plus", "sm")}</span><span class="pr-name">${esc(R.srdSpellName(s))}${MC.lang === "ru" && s.ru ? `<span class="muted small pr-en">${esc(s.en)}</span>` : ""}</span>
      <span class="muted small">${s.lvl ? t("sp.level", { n: s.lvl }) : t("sp.cantrips")} · ${esc(MC.lang === "ru" ? R.srd.schools[s.school] : s.school)}${s.conc ? " · " + t("sp.conc") : ""}</span>
      <button class="icon-btn small" data-info="${s.id}">${MC.icon("info", "sm")}</button></li>`).join(""); };
    await MC.modal({ title: t("sp.add"), wide: true,
      body: `<div class="search-bar"><input type="search" placeholder="${esc(t("search"))}" id="sp-q" autofocus>
        ${F.select("lvl", [["", t("all")], ["0", t("sp.cantrips")], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, t("sp.level", { n })])], "")}</div>
        ${myClasses.size ? `<label class="check"><input type="checkbox" id="sp-mine" ${onlyMine ? "checked" : ""}> ${t("sp.filter_class")}</label>` : ""}
        <ul class="pick-list-v" id="sp-rows">${rows()}</ul>`,
      buttons: [{ label: t("done"), kind: "primary", value: true }],
      mount: (m) => {
        const refresh = () => { m.querySelector("#sp-rows").innerHTML = rows(); };
        m.querySelector("#sp-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); refresh(); });
        m.querySelector('[name="lvl"]').addEventListener("change", (e) => { lvlF = e.target.value; refresh(); });
        m.querySelector("#sp-mine")?.addEventListener("change", (e) => { onlyMine = e.target.checked; refresh(); });
        m.addEventListener("click", async (e) => {
          const info = e.target.closest("[data-info]");
          if (info) { e.stopPropagation(); const s = R.srd.spell[info.dataset.info]; await MC.modal({ title: R.srdSpellName(s), wide: true, body: spellDetailHtml(S.doc(), { srd: s.id }), buttons: [{ label: t("close"), value: null }] }); return; }
          const row = e.target.closest("[data-sp]");
          if (!row) return;
          const d = S.doc();
          const ex = d.spells.list.find((x) => x.srd === row.dataset.sp);
          if (ex) S.patch([{ op: "remove", path: ["spells", "list", ex.id] }]);
          else S.patch([{ op: "add", path: ["spells", "list"], value: R.spellFromSrd(R.srd.spell[row.dataset.sp]) }]);
          refresh();
        });
      } });
  };

  async function customSpell(sp) {
    const isNew = !sp;
    sp = sp || { lvl: 1, prepared: true };
    const v = await MC.modal({ title: isNew ? t("sp.add_custom") : R.spellName(sp), wide: true,
      body: `<div class="form-grid">
        ${F.field(t("atk.name"), F.input("name", sp.name, "autofocus"))}
        ${F.field(t("level"), F.select("lvl", [[0, t("sp.cantrips")], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, t("sp.level", { n })])], sp.lvl))}
        ${F.field(t("sp.time"), F.input("time", sp.time))}${F.field(t("sp.range"), F.input("range", sp.range))}
        ${F.field(t("sp.comp"), F.input("comp", sp.comp))}${F.field(t("sp.dur"), F.input("dur", sp.dur))}
        ${F.field(t("sp.dmg") + " / " + t("sp.heal"), F.input("dmg_formula", sp.dmg_formula, 'placeholder="3d6"'))}
        ${F.field(t("ab.save"), F.select("save", [["", "—"], ...abOptions()], sp.save))}
      </div>${F.check("conc", sp.conc, t("sp.conc"))} ${F.check("ritual", sp.ritual, t("sp.ritual"))} ${F.check("atk", !!sp.atk, t("sp.attack"))}
      ${F.field(t("sp.desc"), F.area("desc", sp.desc, 6))}`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "bad", value: "delete" }]), { label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }] });
    if (!v) return;
    if (v === "delete") { S.patch([{ op: "remove", path: ["spells", "list", sp.id] }]); return; }
    v.lvl = MC.int(v.lvl, 0);
    v.atk = v.atk ? "ranged" : "";
    if (isNew) S.patch([{ op: "add", path: ["spells", "list"], value: { id: MC.uid(), srd: "", prepared: true, always: false, ...v } }]);
    else S.patch(Object.entries(v).map(([k, val]) => ({ op: "set", path: ["spells", "list", sp.id, k], value: val })));
  }
  ACT["custom-spell"] = () => customSpell(null);

  // ---------------------------------------------------------------- предметы
  ACT["add-item"] = async () => {
    let q = "", kind = "";
    const list = () => R.srd.items.filter((s) => (!kind || s.kind === kind || (kind === "armor" && s.kind === "shield"))
      && (!q || s.ru.toLowerCase().includes(q) || s.en.toLowerCase().includes(q)));
    const rows = () => list().slice(0, 120).map((s) => `<li class="pick-row" data-it="${s.id}"><span class="pr-check">${MC.icon("plus", "sm")}</span>
      <span class="pr-name">${esc(MC.L(s))}</span><span class="muted small">${[s.dmg ? `${s.dmg} ${R.dmgType(s.dtype)}` : "", s.kind === "armor" ? `${t("st.ac")} ${s.ac}` : s.kind === "shield" ? `${t("st.ac")} +${s.ac}` : "", s.w ? `${s.w} ${t("inv.lb")}` : "", s.cost].filter(Boolean).join(" · ")}</span></li>`).join("");
    await MC.modal({ title: t("inv.add"), wide: true,
      body: `<div class="search-bar"><input type="search" id="it-q" placeholder="${esc(t("search"))}" autofocus>
        ${F.select("kind", [["", t("all")], ["weapon", t("inv.kind.weapon")], ["armor", t("inv.kind.armor")], ["gear", t("inv.kind.gear")]], "")}</div>
        <ul class="pick-list-v" id="it-rows">${rows()}</ul>`,
      buttons: [{ label: t("done"), kind: "primary", value: true }],
      mount: (m) => {
        const refresh = () => { m.querySelector("#it-rows").innerHTML = rows(); };
        m.querySelector("#it-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); refresh(); });
        m.querySelector('[name="kind"]').addEventListener("change", (e) => { kind = e.target.value; refresh(); });
        m.addEventListener("click", (e) => {
          const row = e.target.closest("[data-it]");
          if (!row) return;
          S.addItems([{ id: row.dataset.it, qty: 1 }]);
          row.classList.add("flash");
          setTimeout(() => row.classList.remove("flash"), 400);
        });
      } });
  };
  /** Добавить предметы из справочника (оружие — сразу с атакой). */
  S.addItems = (list, doc) => {
    const ops = [];
    for (const { id, qty } of list) {
      const s = R.srd.item[id];
      if (!s) continue;
      const it = R.itemFromSrd(s, qty);
      ops.push({ op: "add", path: ["inventory"], value: it });
      if (s.kind === "weapon") ops.push({ op: "add", path: ["attacks"], value: R.attackFromItem(it) });
    }
    if (doc) { for (const op of ops) (op.path[0] === "inventory" ? doc.inventory : doc.attacks).push(op.value); return ops; }
    S.patch(ops);
    return ops;
  };

  async function itemForm(it, isNew) {
    const v = await MC.modal({ title: isNew ? t("inv.add_custom") : R.itemName(it), wide: true,
      body: `<div class="form-grid">
        ${F.field(t("atk.name"), F.input("name", it.name || R.itemName(it), "autofocus"))}
        ${F.field(t("inv.kind"), F.select("kind", ["gear", "consumable", "weapon", "armor", "shield"].map((k) => [k, t("inv.kind." + k)]), it.kind || "gear"))}
        ${F.field(t("inv.qty"), `<input name="qty" type="number" data-type="num" value="${esc(it.qty ?? 1)}">`)}
        ${F.field(t("inv.weight"), `<input name="w" type="number" step="0.1" data-type="num" value="${esc(it.w ?? 0)}">`)}
        ${F.field(t("atk.dmg") + " (" + t("inv.kind.weapon").toLowerCase() + ")", F.input("dmg", it.dmg, 'placeholder="1d8"'))}
        ${F.field(t("atk.dtype"), F.select("dtype", dtypeOptions(), it.dtype))}
        ${F.field(t("inv.ac"), F.num("ac", it.ac ?? 0))}
        ${F.field(t("inv.acat"), F.select("acat", [["light", t("acat.light")], ["medium", t("acat.medium")], ["heavy", t("acat.heavy")]], it.acat || "light"))}
      </div>${F.field(t("inv.notes"), F.area("notes", it.notes, 3))}`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "bad", value: "delete" }]), { label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }] });
    return v;
  }
  ACT.exchange = (el, doc) => MC.Money.exchangeDialog(doc, (ops) => S.patch(ops));
  ACT["custom-item"] = async () => {
    const v = await itemForm({ qty: 1, w: 0, kind: "gear" }, true);
    if (!v || typeof v !== "object") return;
    const it = { id: MC.uid(), srd: "", equipped: false, ...v, dex: v.acat !== "heavy", maxdex: v.acat === "medium" ? 2 : null };
    const ops = [{ op: "add", path: ["inventory"], value: it }];
    if (v.kind === "weapon" && v.dmg) ops.push({ op: "add", path: ["attacks"], value: R.attackFromItem(it) });
    S.patch(ops);
  };
  ACT["edit-item"] = async (el, doc) => {
    const it = doc.inventory.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const v = await itemForm(it, false);
    if (v === "delete") {
      const ops = [{ op: "remove", path: ["inventory", it.id] }];
      for (const a of doc.attacks) if (a.item === it.id) ops.push({ op: "remove", path: ["attacks", a.id] });
      S.patch(ops);
    } else if (v && typeof v === "object") {
      if (it.srd && v.name === MC.L(R.srd.item[it.srd])) delete v.name;
      S.patch(Object.entries(v).map(([k, val]) => ({ op: "set", path: ["inventory", it.id, k], value: val })));
    }
  };

  // ---------------------------------------------------------------- умения и ресурсы
  async function featForm(f, isNew) {
    return MC.modal({ title: isNew ? t("ft.add") : f.name, wide: true,
      body: `${F.field(t("ft.name"), F.input("name", f.name, "autofocus"))}${F.field(t("ft.source"), F.input("src", f.src))}${F.field(t("ft.desc"), F.area("desc", f.desc, 8))}`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }] });
  }
  ACT["add-feat"] = async () => { const v = await featForm({}, true); if (v) S.patch([{ op: "add", path: ["features"], value: { id: MC.uid(), ...v } }]); };
  ACT["edit-feat"] = async (el, doc) => {
    const f = doc.features.find((x) => x.id === el.dataset.id);
    if (!f) return;
    const v = await featForm(f, false);
    if (v) S.patch(Object.entries(v).map(([k, val]) => ({ op: "set", path: ["features", f.id, k], value: val })));
  };
  async function resForm(r, isNew) {
    return MC.modal({ title: isNew ? t("res.add") : r.name,
      body: `${F.field(t("res.name"), F.input("name", r.name, "autofocus"))}${F.field(t("res.max"), F.num("max", r.max ?? 1, 'min="0"'))}
        ${F.field(t("res.reset"), F.select("reset", ["short", "long", "none"].map((k) => [k, t("res.reset." + k)]), r.reset || "long"))}`,
      buttons: [...(isNew ? [] : [{ label: t("delete"), kind: "bad", value: "delete" }]), { label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: (w) => F.read(w) }] });
  }
  ACT["add-res"] = async () => { const v = await resForm({}, true); if (v && typeof v === "object") S.patch([{ op: "add", path: ["resources"], value: { id: MC.uid(), used: 0, ...v } }]); };
  ACT["edit-res"] = async (el, doc) => {
    const r = doc.resources.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const v = await resForm(r, false);
    if (v === "delete") S.patch([{ op: "remove", path: ["resources", r.id] }]);
    else if (v && typeof v === "object") S.patch(Object.entries(v).map(([k, val]) => ({ op: "set", path: ["resources", r.id, k], value: val })));
  };

  // ---------------------------------------------------------------- меню персонажа
  ACT.menu = async (el, doc) => {
    const items = [["short", "short-rest", t("sh.short_rest")], ["long", "long-rest", t("sh.long_rest")], ["levelup", "level-up", t("sh.levelup")],
      ["download", "download", t("sh.download")], ...(MC.isGM() ? [["assign", "user", t("sh.assign")]] : []), ["delete", "trash", t("sh.delete")]];
    const v = await MC.modal({ title: doc.name,
      body: `<div class="pick-list">${items.map(([k, ic, l]) => `<button class="btn menu-btn ${k === "delete" ? "bad" : ""}" data-pick="${k}">${MC.icon(ic)}<span>${esc(l)}</span></button>`).join("")}</div>`,
      mount: (m, close) => m.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) close(b.dataset.pick); }) });
    if (v === "short") shortRest();
    if (v === "long") longRest();
    if (v === "levelup") levelUp();
    if (v === "download") download(doc);
    if (v === "assign") assign(doc);
    if (v === "delete" && await MC.confirm(t("confirm.delete", { name: doc.name }))) {
      MC.send({ t: "char_delete", id: doc.id });
      MC.emit("sheet_closed");
    }
  };

  /** То же, что в меню персонажа, — для правой кнопки по карточке (лист уже открыт). */
  S.charAction = async (k, doc) => {
    if (k === "short") shortRest();
    if (k === "long") longRest();
    if (k === "levelup") levelUp();
    if (k === "download") download(doc);
    if (k === "assign") assign(doc);
    if (k === "delete" && await MC.confirm(t("confirm.delete", { name: doc.name }))) { MC.send({ t: "char_delete", id: doc.id }); MC.emit("sheet_closed"); }
  };
  function download(doc) {
    const clean = MC.clone(doc);
    const data = { format: 1, app: "MastersCompendium", system: "dnd5e_2014", character: clean };
    MC.download(`${(doc.name || "character").replace(/[\\/:*?"<>|]/g, "")}.character`, JSON.stringify(data, null, 1));
  }
  S.download = download;

  ACT.assign = (el, doc) => assign(doc);
  async function assign(doc) {
    const opts = [["", t("chars.npc")], ...MC.state.players.map((p) => [p.id, p.name])];
    const v = await MC.modal({ title: t("sh.assign"), body: F.field(t("chars.owner"), F.select("owner", opts, doc.owner || "")),
      buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => F.read(w) }] });
    if (v) MC.send({ t: "char_assign", id: doc.id, owner: v.owner || null });
  }

  // ---------------------------------------------------------------- отдых
  async function shortRest() {
    const render = () => {
      const doc = S.doc();
      const hd = R.hitDice(doc);
      return `<p class="muted">${t("rest.short.text")}</p>
        <div class="hp-mini">${t("hp.title")}: <b>${doc.hp.cur} / ${doc.hp.max}</b></div>
        <div class="pick-list">${hd.map((h) => `<button class="btn" data-hd="${h.d}" ${h.total - h.used <= 0 ? "disabled" : ""}>${MC.icon("d20", "sm")} d${h.d}${S.fmtMod(R.abMod(doc, "con"))} · ${t("rest.hd_left", { n: h.total - h.used })}</button>`).join("")}</div>`;
    };
    const v = await MC.modal({ title: t("sh.short_rest"), body: `<div id="sr">${render()}</div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("done"), kind: "primary", value: true }],
      mount: (m) => m.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-hd]");
        if (!b) return;
        b.disabled = true;
        const doc = S.doc(), d = +b.dataset.hd;
        const r = await S.roll(`1d${d}${S.fmtMod(R.abMod(doc, "con"))}`, `${t("hd.spend")} d${d}`, "hd");
        if (!r) return;
        const d2 = S.doc();
        S.patch([{ op: "set", path: ["hd_used", String(d)], value: MC.int(d2.hd_used?.[d], 0) + 1 },
          { op: "set", path: ["hp", "cur"], value: Math.min(MC.int(d2.hp.max, 0), MC.int(d2.hp.cur, 0) + Math.max(0, r.total)) }]);
        m.querySelector("#sr").innerHTML = render();
      }) });
    if (!v) return;
    const doc = S.doc();
    const ops = (doc.resources || []).filter((r) => r.reset === "short").map((r) => ({ op: "set", path: ["resources", r.id, "used"], value: 0 }));
    ops.push({ op: "set", path: ["spells", "pact_used"], value: 0 });
    S.patch(ops);
    MC.toast(t("rest.done"), "ok", "short-rest");
  }

  async function longRest() {
    if (!await MC.modal({ title: t("sh.long_rest"), body: `<p>${t("rest.long.text")}</p>`,
      buttons: [{ label: t("cancel"), value: false }, { label: t("sh.long_rest"), kind: "primary", value: true }] })) return;
    const doc = S.doc();
    const hd = R.hitDice(doc);
    let regain = Math.max(1, Math.floor(R.level(doc) / 2));
    const used = { ...(doc.hd_used || {}) };
    for (const h of hd) { const back = Math.min(regain, MC.int(used[h.d], 0)); used[h.d] = MC.int(used[h.d], 0) - back; regain -= back; }
    const ops = [
      { op: "set", path: ["hp", "cur"], value: MC.int(doc.hp.max, 0) }, { op: "set", path: ["hp", "temp"], value: 0 },
      { op: "set", path: ["hd_used"], value: used }, { op: "set", path: ["death"], value: { ok: 0, fail: 0 } },
      { op: "set", path: ["spells", "slots_used"], value: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, { op: "set", path: ["spells", "pact_used"], value: 0 },
      { op: "set", path: ["exhaustion"], value: Math.max(0, MC.int(doc.exhaustion, 0) - 1) },
      ...(doc.resources || []).filter((r) => r.reset !== "none").map((r) => ({ op: "set", path: ["resources", r.id, "used"], value: 0 })),
    ];
    S.patch(ops);
    MC.toast(t("rest.done"), "ok", "long-rest");
  }

  // ---------------------------------------------------------------- повышение уровня
  ACT["xp-add"] = async (el, doc) => {
    const n = await MC.askNumber(t("xp.add_q"));
    if (!n) return;
    S.patch([{ op: "set", path: ["xp"], value: Math.max(0, MC.int(doc.xp, 0) + n) }]);
    setTimeout(() => { if (MC.Xp?.canLevel(S.doc()) && !MC.isGM()) MC.toast(t("xp.can_level", { name: S.doc().name }), "ok", "level-up"); }, 300);
  };
  ACT["lvl-go"] = () => levelUp();

  async function levelUp() {
    const doc = S.doc();
    // игрок повышает уровень, только когда хватает опыта (или мастер разрешил веху)
    if (!MC.isGM() && MC.Xp && !MC.Xp.canLevel(doc)) { MC.toast(MC.Xp.why(doc), "warn", "level-up"); return; }
    if (MC.isGM() && MC.Xp && !MC.Xp.canLevel(doc) && !(await MC.confirm(MC.Xp.why(doc) + ". " + t("xp.force")))) return;
    const existing = doc.classes || [];
    const others = R.srd.classes.filter((c) => !existing.some((k) => k.id === c.id));
    let choice = existing.length ? "0" : "new";
    let newCls = others[0]?.id || "";
    let hpGain = null, rolled = null;
    const target = () => {
      if (choice === "new") return { cls: R.srd.cls[newCls], lv: 1, sub: "" };
      const k = existing[+choice];
      return { cls: R.srd.cls[k.id], lv: MC.int(k.level, 1) + 1, sub: k.sub, entry: k };
    };
    const body = () => {
      const tg = target();
      const hd = tg.cls ? tg.cls.hd : MC.int(tg.entry?.hd, 8);
      const con = R.abMod(S.doc(), "con");
      const avg = R.avgHp(hd) + con;
      const needSub = tg.cls && tg.lv >= tg.cls.sub_level && !tg.sub && !tg.entry?.sub_name && tg.cls.subclasses.length;
      const feats = tg.cls ? R.featuresAt(tg.cls.id, tg.sub, tg.lv) : [];
      return `${F.field(t("lu.class"), `<select id="lu-cls">${existing.map((k, i) => `<option value="${i}" ${choice === String(i) ? "selected" : ""}>${esc(R.className(k))} ${k.level} → ${MC.int(k.level, 1) + 1}</option>`).join("")}
          ${others.length ? `<option value="new" ${choice === "new" ? "selected" : ""}>${t("lu.multiclass")}</option>` : ""}</select>`)}
        ${choice === "new" ? F.field(t("sh.class"), `<select id="lu-new">${others.map((c) => `<option value="${c.id}" ${c.id === newCls ? "selected" : ""}>${esc(MC.L(c))}</option>`).join("")}</select>`) : ""}
        <h3>${t("lu.hp")}</h3>
        <div class="pick-list row">
          <button class="btn ${hpGain === Math.max(1, avg) && rolled == null ? "primary" : ""}" data-hp="avg" data-v="${Math.max(1, avg)}">${t("lu.avg", { n: Math.max(1, avg) })}</button>
          <button class="btn" data-hp="roll" data-d="${hd}">${MC.icon("d20", "sm")} ${t("lu.roll", { d: "d" + hd + S.fmtMod(con) })}</button>
        </div>
        ${rolled != null ? `<p class="ok-text">${t("lu.rolled", { r: rolled, n: hpGain })}</p>` : ""}
        ${needSub ? `<h3>${t("lu.subclass")}</h3>${F.select("sub", [["", "—"], ...tg.cls.subclasses.map((s) => [s.id, MC.L(s)])], "")}` : ""}
        ${tg.cls && R.isAsiLevel(tg.cls.id, tg.lv) ? `<h3>${t("lu.asi")}</h3><p class="muted small">${t("lu.asi.d")}</p>
          <div class="row">${F.select("asi1", [["", "—"], ...abOptions()], "")} ${F.select("asi2", [["", "—"], ...abOptions()], "")}</div>` : ""}
        ${feats.length ? `<h3>${t("lu.features")}</h3><div class="feat-picks">${feats.map((f) => F.check("f_" + f.id, true, f.en)).join("<br>")}</div>` : ""}
        ${tg.cls?.caster ? `<p class="muted small with-ic">${MC.icon("spells", "sm")} ${t("lu.slots")}</p>` : ""}`;
    };
    const v = await MC.modal({ title: t("lu.title"), wide: true, body: `<div id="lu">${body()}</div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("sh.levelup"), kind: "primary", value: (w) => F.read(w) }],
      mount: (m) => {
        const re = () => { m.querySelector("#lu").innerHTML = body(); };
        m.addEventListener("change", (e) => {
          if (e.target.id === "lu-cls") { choice = e.target.value; hpGain = null; rolled = null; re(); }
          if (e.target.id === "lu-new") { newCls = e.target.value; hpGain = null; rolled = null; re(); }
        });
        m.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-hp]");
          if (!b) return;
          if (b.dataset.hp === "avg") { hpGain = MC.int(b.dataset.v); rolled = null; re(); return; }
          b.disabled = true;
          const con = R.abMod(S.doc(), "con");
          const r = await S.roll(`1d${b.dataset.d}${S.fmtMod(con)}`, t("lu.hp"), "hd");
          if (r) { rolled = r.parts[0].rolls[0]; hpGain = Math.max(1, r.total); }
          re();
        });
      } });
    if (!v) return;
    const d = S.doc();
    const tg = target();
    const hd = tg.cls ? tg.cls.hd : MC.int(tg.entry?.hd, 8);
    const gain = hpGain ?? Math.max(1, R.avgHp(hd) + R.abMod(d, "con"));
    const classes = MC.clone(d.classes || []);
    let clsId = tg.cls?.id, sub = tg.sub;
    if (choice === "new") classes.push(R.classEntry(tg.cls, 1));
    else {
      const k = classes[+choice];
      k.level = tg.lv;
      if (v.sub) { k.sub = v.sub; sub = v.sub; }
    }
    const ops = [{ op: "set", path: ["classes"], value: classes },
      { op: "set", path: ["hp", "max"], value: MC.int(d.hp.max, 0) + gain },
      { op: "set", path: ["hp", "cur"], value: MC.int(d.hp.cur, 0) + gain }];
    if (tg.cls) {
      for (const f of R.featuresAt(clsId, sub, tg.lv)) if (v["f_" + f.id]) ops.push({ op: "add", path: ["features"], value: R.featureEntry(f, `${MC.L(tg.cls)} ${tg.lv}`) });
      const abil = { ...d.abilities };
      for (const a of [v.asi1, v.asi2]) if (a) abil[a] = Math.min(20, MC.int(abil[a], 10) + 1);
      if (v.asi1 || v.asi2) ops.push({ op: "set", path: ["abilities"], value: abil });
      ops.push(...R.syncResourceOps(d, clsId, tg.lv));
    }
    if (MC.int(d.lvl_ok, 0) > 0) ops.push({ op: "set", path: ["lvl_ok"], value: MC.int(d.lvl_ok, 0) - 1 });
    S.patch(ops);
    const lvCid = S.doc()?.id;
    if (lvCid) setTimeout(() => MC.send({ t: "chron_lvl", char: lvCid }), 800);   // в хронику кампании
    MC.toast(t("lu.done", { n: R.level(S.doc()) }), "ok", "level-up");
  }
  S.levelUp = levelUp;
})();

// правая кнопка внутри листа: предмет, атака, заклинание
(() => {
  const MC = window.MC;
  const t = MC.t;
  const S = MC.Sheet;
  const click = (sel) => () => document.querySelector(sel)?.click();
  MC.ctxAdd?.(".inv-list .item", (el) => {
    const b = el.querySelector("[data-act=edit-item]");
    const doc = S.doc();
    const it = doc && (doc.inventory || []).find((x) => x.id === b?.dataset.id);
    if (!it) return null;
    const id = it.id, eq = el.querySelector("[data-act=equip]");
    const items = [{ ic: "edit", label: t("edit"), fn: click(`.inv-list [data-act=edit-item][data-id="${id}"]`) }];
    if (eq) items.push({ ic: it.equipped ? "x" : "armor", label: t(it.equipped ? "inv.unequip" : "inv.equip"), fn: click(`.inv-list [data-act=equip][data-id="${id}"]`) });
    items.push({ ic: "plus", label: "+1", fn: click(`.inv-list [data-act=qty][data-id="${id}"][data-d="1"]`) }, { ic: "minus", label: "−1", fn: click(`.inv-list [data-act=qty][data-id="${id}"][data-d="-1"]`) });
    if (MC.Trade) items.push({ ic: "upload", label: t("ctx.to_stash"), fn: () => MC.request({ t: "stash_put", char: doc.id, item: id, qty: MC.num(it.qty, 1) }).then(() => MC.toast(t("st.put_done"), "ok", "inventory")).catch((e) => MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn")) });
    items.push({ ic: "trash", label: t("delete"), bad: true, fn: async () => { if (await MC.confirm(t("confirm.delete", { name: it.name || "" }))) S.patch([{ op: "remove", path: ["inventory", id] }, ...(doc.attacks || []).filter((a) => a.item === id).map((a) => ({ op: "remove", path: ["attacks", a.id] }))]); } });
    return { title: it.name, items };
  });
  MC.ctxAdd?.("[data-act=roll-attack], [data-act=roll-damage]", (el) => {
    const id = el.dataset.id;
    return [
      { ic: "d20", label: t("ctx.atk_roll"), fn: click(`[data-act=roll-attack][data-id="${id}"]`) },
      { ic: "attacks", label: t("ctx.dmg_roll"), fn: click(`[data-act=roll-damage][data-id="${id}"]`) },
      ...(MC.Combat?.state?.active ? [{ ic: "swords", label: t("ctx.action"), fn: () => document.querySelector("[data-cbact]")?.click() }] : []),
    ];
  });
  MC.ctxAdd?.("[data-act=spell-info]", (el) => [
    { ic: "info", label: t("ctx.info"), fn: () => el.click() },
    ...(el.closest("li")?.querySelector("[data-act=cast]") ? [{ ic: "wand", label: t("ctx.cast"), fn: () => el.closest("li").querySelector("[data-act=cast]").click() }] : []),
  ]);
})();
