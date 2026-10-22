// Masters Compendium — пошаговое создание персонажа (D&D 5e 2014) и пустой лист.
(() => {
  "use strict";
  const MC = window.MC;
  const R = MC.R, F = () => MC.F;
  const t = MC.t, esc = MC.esc;
  const W = (MC.Wizard = {});

  const STEPS = ["name", "race", "class", "abilities", "background", "equipment", "done"];
  let st = null;

  function fresh() {
    return {
      step: 0, name: "", portrait: "",
      race: "", sub: "", raceCustom: "", speedCustom: 30, asiPick: [], customAsi: {},
      cls: "", clsCustom: "", hd: 8, level: 1, subcls: "",
      method: "array", base: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      assign: { str: "", dex: "", con: "", int: "", wis: "", cha: "" }, rolls: [],
      bg: "", bgCustom: "", skills: [], equip: {}, noEquip: false,
    };
  }

  /** Пустой лист: сразу создаём и открываем. */
  W.blank = async () => {
    await R.load();
    const doc = R.newCharacter();
    doc.name = MC.lang === "ru" ? "Новый персонаж" : "New character";
    doc.hp = { max: 10, cur: 10, temp: 0 };
    await create(doc, true);
  };

  W.start = async () => {
    await R.load();
    st = fresh();
    render();
  };

  async function create(doc, editing = false) {
    try {
      const res = await MC.request({ t: "char_create", doc });
      MC.emit("open_sheet", { id: res.char.id, editing });
    } catch (e) {
      MC.toast(MC.t("err." + (e.code || "timeout")), "bad");
    }
  }

  // ---------------------------------------------------------------- вычисления
  const race = () => R.srd.race[st.race];
  const subrace = () => R.srd.subrace[st.sub];
  const cls = () => R.srd.cls[st.cls];
  const bg = () => R.srd.bg[st.bg];
  function raceBonus() {
    const b = {};
    const add = (o) => { for (const [k, v] of Object.entries(o || {})) b[k] = (b[k] || 0) + v; };
    if (race()) { add(race().asi); add(subrace()?.asi); for (const a of st.asiPick) b[a] = (b[a] || 0) + 1; }
    else add(st.customAsi);
    return b;
  }
  function baseScores() {
    if (st.method === "array" || st.method === "roll") {
      const o = {};
      for (const a of R.ABILS) o[a] = st.assign[a] === "" ? 0 : MC.int(st.assign[a].split(":")[1] ?? st.assign[a], 0);
      return o;
    }
    return { ...st.base };
  }
  const finalScores = () => { const b = baseScores(), r = raceBonus(); return Object.fromEntries(R.ABILS.map((a) => [a, Math.min(20, (b[a] || 0) + (r[a] || 0))])); };
  const buyLeft = () => 27 - R.ABILS.reduce((s, a) => s + (R.POINT_COST[st.base[a]] ?? 0), 0);
  const bgSkills = () => (bg() ? bg().skills : []);

  // ---------------------------------------------------------------- проверки шагов
  function problem() {
    switch (STEPS[st.step]) {
      case "name": return st.name.trim() ? "" : t("wz.warn.name");
      case "race": return race() || st.raceCustom.trim() ? (race()?.asi_choice && st.asiPick.length !== race().asi_choice ? t("wz.race.asi_choice") : "") : t("wz.s_race");
      case "class": return cls() || st.clsCustom.trim() ? "" : t("wz.warn.class");
      case "abilities":
        if (st.method === "array" || st.method === "roll") return R.ABILS.every((a) => st.assign[a] !== "") ? "" : t("wz.warn.array");
        if (st.method === "buy") return buyLeft() >= 0 ? "" : t("wz.buy.left", { n: buyLeft() });
        return "";
      case "background": {
        const need = cls()?.skills.n || 0;
        const chosen = st.skills.length;
        return chosen < need ? t("wz.warn.skills", { n: need }) : "";
      }
      default: return "";
    }
  }

  // ---------------------------------------------------------------- отрисовка
  function render() {
    const root = MC.$("#sheet-root");
    if (!root) return;
    const step = STEPS[st.step];
    root.innerHTML = `<div class="wizard">
      <div class="wz-head"><button class="icon-btn" data-wz="cancel">${MC.icon("x")}</button>
        <div><h1>${t("wz.title")}</h1><div class="muted small">${t("wz.step", { n: st.step + 1, m: STEPS.length })} · ${t("wz.s_" + step)}</div></div></div>
      <div class="wz-progress">${STEPS.map((s, i) => `<i class="${i < st.step ? "done" : i === st.step ? "cur" : ""}"></i>`).join("")}</div>
      <div class="card glass wz-body">${BODY[step]()}</div>
      <div class="wz-warn" id="wz-warn"></div>
      <div class="wz-foot">
        ${st.step ? `<button class="btn" data-wz="back">${MC.icon("back", "sm")} ${t("back")}</button>` : "<span></span>"}
        ${step === "done" ? `<button class="btn primary" data-wz="create">${MC.icon("spells", "sm")} ${t("wz.create")}</button>` : `<button class="btn primary" data-wz="next">${t("next")} ${MC.icon("next", "sm")}</button>`}
      </div></div>`;
  }

  const BODY = {};
  BODY.name = () => `${F().field(t("sh.name"), `<input data-w="name" maxlength="32" value="${esc(st.name)}" placeholder="${esc(t("wz.name.ph"))}" autofocus>`)}
    <div class="wz-portrait"><button class="portrait big" data-wz="portrait">${st.portrait ? `<img src="${esc(st.portrait)}" alt="">` : MC.icon("camera", "big")}</button>
      <span class="muted">${t("wz.portrait")}</span></div>`;

  BODY.race = () => {
    const r = race();
    const cards = R.srd.races.map((x) => `<button class="opt ${st.race === x.id ? "on" : ""}" data-pick-race="${x.id}">
      <b>${esc(MC.L(x))}</b><span class="muted small">${Object.entries(x.asi).map(([a, v]) => `${R.abName(a)} +${v}`).join(", ")}${x.asi_choice ? ` · +1 ×${x.asi_choice}` : ""} · ${x.speed} ${t("st.ft")}</span></button>`).join("");
    let extra = "";
    if (r) {
      if (r.subraces.length) extra += `<h3>${t("wz.subrace")}</h3><div class="opts">${r.subraces.map((s) => `<button class="opt ${st.sub === s.id ? "on" : ""}" data-pick-sub="${s.id}"><b>${esc(MC.L(s))}</b><span class="muted small">${Object.entries(s.asi).map(([a, v]) => `${R.abName(a)} +${v}`).join(", ")}</span></button>`).join("")}</div>`;
      if (r.asi_choice) extra += `<h3>${t("wz.race.asi_choice")}</h3><div class="chips">${R.ABILS.filter((a) => !r.asi[a]).map((a) => `<button class="chip ${st.asiPick.includes(a) ? "on ok" : ""}" data-asi="${a}">${R.abName(a, false)}</button>`).join("")}</div>`;
      const traits = [...r.traits, ...(subrace()?.traits || [])].map((id) => R.srd.traits[id]).filter(Boolean);
      extra += `<div class="muted small wz-traits">${traits.map((x) => `<b>${esc(x.en)}</b>`).join(" · ")}${r.langs.length ? "<br>" + esc(r.langs.join(", ")) : ""}</div>`;
    }
    return `<div class="opts">${cards}<button class="opt ${st.race === "_custom" ? "on" : ""}" data-pick-race="_custom"><b>${t("wz.race.custom")}</b><span class="muted small">PHB, Volo, ${t("custom").toLowerCase()}…</span></button></div>
      ${st.race === "_custom" ? `<div class="form-grid">${F().field(t("wz.race.custom.ph"), `<input data-w="raceCustom" value="${esc(st.raceCustom)}">`)}
        ${F().field(t("wz.speed"), `<input type="number" data-w="speedCustom" value="${st.speedCustom}">`)}</div>
        <h3>${t("wz.race.asi")}</h3><div class="form-grid six">${R.ABILS.map((a) => F().field(R.abName(a), `<input type="number" data-casi="${a}" value="${MC.int(st.customAsi[a], 0)}">`)).join("")}</div>` : extra}`;
  };

  BODY.class = () => {
    const c = cls();
    const cards = R.srd.classes.map((x) => `<button class="opt ${st.cls === x.id ? "on" : ""}" data-pick-cls="${x.id}">
      <b>${esc(MC.L(x))}</b><span class="muted small">d${x.hd} · ${x.saves.map((s) => R.abName(s)).join(", ")}${x.caster ? " · " + MC.icon("sparkle", "sm") : ""}</span></button>`).join("");
    let extra = F().field(t("wz.start_level"), `<input type="number" min="1" max="20" data-w="level" value="${st.level}">`);
    if (c && c.subclasses.length && st.level >= c.sub_level) {
      extra += F().field(t("sh.subclass"), `<select data-w="subcls"><option value="">—</option>${c.subclasses.map((s) => `<option value="${s.id}" ${st.subcls === s.id ? "selected" : ""}>${esc(MC.L(s))}</option>`).join("")}</select>`);
    }
    if (c) extra += `<p class="muted small">${esc(c.profs.join(", "))}</p>`;
    return `<div class="opts">${cards}<button class="opt ${st.cls === "_custom" ? "on" : ""}" data-pick-cls="_custom"><b>${t("wz.class.custom")}</b><span class="muted small">${t("custom")}</span></button></div>
      ${st.cls === "_custom" ? `<div class="form-grid">${F().field(t("wz.class.custom.ph"), `<input data-w="clsCustom" value="${esc(st.clsCustom)}">`)}
        ${F().field(t("wz.hd"), `<select data-w="hd">${[6, 8, 10, 12].map((d) => `<option value="${d}" ${st.hd === d ? "selected" : ""}>d${d}</option>`).join("")}</select>`)}</div>` : ""}
      <div class="form-grid">${extra}</div>`;
  };

  BODY.abilities = () => {
    const methods = ["array", "buy", "roll", "manual"].map((m) => `<button class="chip ${st.method === m ? "on" : ""}" data-method="${m}">${t("wz.m." + m)}</button>`).join("");
    const rb = raceBonus(), fin = finalScores(), base = baseScores();
    let pool = [];
    if (st.method === "array") pool = R.STD_ARRAY.map((v, i) => `${i}:${v}`);
    if (st.method === "roll") pool = st.rolls.map((v, i) => `${i}:${v}`);
    const used = new Set(Object.values(st.assign).filter(Boolean));
    const cell = (a) => {
      if (st.method === "array" || st.method === "roll") {
        const cur = st.assign[a];
        const free = pool.filter((p) => !used.has(p) || p === cur);
        const pop = st.asOpen === a ? `<div class="as-pop">${free.map((p) => `<button class="as-opt ${p === cur ? "on" : ""}" data-as-pick="${a}" data-v="${p}">${p.split(":")[1]}</button>`).join("")}${cur ? `<button class="as-opt clear" data-as-pick="${a}" data-v="">${MC.icon("x", "sm")}</button>` : ""}</div>` : "";
        return `<div class="as-cell"><button class="as-btn ${cur ? "set" : ""} ${st.asOpen === a ? "open" : ""}" data-as-open="${a}">${cur ? cur.split(":")[1] : "—"}</button>${pop}</div>`;
      }
      if (st.method === "buy") return `<div class="stepper"><button data-buy="${a}" data-d="-1">−</button><b>${st.base[a]}</b><button data-buy="${a}" data-d="1">+</button></div>`;
      return `<input class="as-num" type="number" min="1" max="30" data-base="${a}" value="${st.base[a]}">`;
    };
    return `<div class="chips">${methods}</div>
      ${st.method === "array" ? `<p class="muted small">${t("wz.array.hint")}</p>` : ""}
      ${st.method === "buy" ? `<p class="${buyLeft() < 0 ? "bad-text" : "muted"}">${t("wz.buy.left", { n: buyLeft() })}</p>` : ""}
      ${st.method === "roll" ? `<p class="muted small">${t("wz.roll.hint")}</p><button class="btn" data-wz="roll">${MC.icon("dice", "sm")} ${t("wz.roll.go")}</button>
        ${st.rolls.length ? `<div class="rolled">${st.rolls.map((v) => `<span class="hd-chip">${v}</span>`).join(" ")}</div>` : ""}` : ""}
      <table class="ab-table"><thead><tr><th></th><th>${t("wz.base")}</th><th>${t("wz.bonus")}</th><th>${t("wz.final")}</th></tr></thead>
        <tbody>${R.ABILS.map((a) => `<tr><th>${R.abName(a, false)}</th><td>${cell(a)}</td><td class="muted">${rb[a] ? "+" + rb[a] : ""}</td>
          <td><b>${base[a] ? fin[a] : "—"}</b> <span class="muted">${base[a] ? MC.sign(R.mod(fin[a])) : ""}</span></td></tr>`).join("")}</tbody></table>`;
  };

  BODY.background = () => {
    const c = cls();
    const bgs = R.srd.backgrounds.map((b) => `<button class="opt ${st.bg === b.id ? "on" : ""}" data-pick-bg="${b.id}"><b>${esc(MC.L(b))}</b>
      <span class="muted small">${b.skills.map((s) => R.skillName(s)).join(", ")}</span></button>`).join("");
    const bgS = bgSkills();
    const skills = c ? `<h3>${t("wz.skills.choose", { n: c.skills.n })}</h3><div class="chips">${c.skills.from.map((s) => {
      const fromBg = bgS.includes(s);
      return `<button class="chip ${st.skills.includes(s) ? "on ok" : ""} ${fromBg ? "dim" : ""}" data-skill="${s}" ${fromBg ? "disabled" : ""}>${esc(R.skillName(s))}</button>`;
    }).join("")}</div>` : "";
    return `<div class="opts">${bgs}<button class="opt ${st.bg === "_custom" ? "on" : ""}" data-pick-bg="_custom"><b>${t("wz.bg.custom")}</b></button></div>
      ${st.bg === "_custom" ? F().field(t("wz.bg.custom"), `<input data-w="bgCustom" value="${esc(st.bgCustom)}">`) : ""}
      ${bgS.length ? `<p class="muted small">${t("wz.skills.bg")}: ${bgS.map((s) => R.skillName(s)).join(", ")}</p>` : ""}
      ${skills}`;
  };

  const itemLabel = (x) => `${MC.L(R.srd.item[x.id]) || x.id}${x.qty > 1 ? " ×" + x.qty : ""}`;
  BODY.equipment = () => {
    const c = cls();
    if (!c) return `<p class="muted">${t("wz.equip.manual")}</p>`;
    const fixed = c.start.length ? `<h3>${t("wz.equip.fixed")}</h3><p>${c.start.map((x) => esc(itemLabel(x))).join(", ")}</p>` : "";
    const choices = c.start_choices.map((ch, i) => {
      if (!ch.variants) return `<div class="eq-choice"><p class="muted small">${esc(ch.desc)}</p><p class="small warn-text">↳ ${t("wz.equip.manual")}</p></div>`;
      return `<div class="eq-choice"><div class="chips">${ch.variants.map((v, j) =>
        `<button class="chip ${MC.int(st.equip[i], 0) === j ? "on ok" : ""}" data-eq="${i}" data-v="${j}">${esc(v.map(itemLabel).join(" + "))}</button>`).join("")}</div></div>`;
    }).join("");
    return `<label class="check"><input type="checkbox" data-w="noEquip" ${st.noEquip ? "checked" : ""}> ${t("wz.equip.none")}</label>
      ${st.noEquip ? "" : fixed + (choices ? `<h3>${t("wz.equip.choose")}</h3>${choices}` : "")}`;
  };

  BODY.done = () => {
    const doc = build();
    const fin = doc.abilities;
    return `<h3>${t("wz.summary")}</h3>
      <div class="wz-sum"><div class="portrait big">${doc.portrait ? `<img src="${esc(doc.portrait)}" alt="">` : esc(doc.name.charAt(0))}</div>
        <div><h2>${esc(doc.name)}</h2><div>${esc(R.raceName(doc))} · ${doc.classes.map((k) => `${esc(R.className(k))} ${k.level}`).join(" / ")}</div>
        <div class="muted">${esc(R.bgName(doc))} · ${t("hp.title")}: ${doc.hp.max} · ${t("st.ac")}: ${R.ac(doc)}</div></div></div>
      <div class="sum-abs">${R.ABILS.map((a) => `<div><span class="muted small">${R.abName(a)}</span><b>${fin[a]}</b><span class="muted small">${MC.sign(R.mod(fin[a]))}</span></div>`).join("")}</div>
      <p class="muted small">${Object.entries(doc.skills).map(([s]) => R.skillName(s)).join(", ")}</p>
      <p class="muted small">${doc.inventory.map((i) => esc(R.itemName(i) + (i.qty > 1 ? " ×" + i.qty : ""))).join(", ")}</p>`;
  };

  // ---------------------------------------------------------------- сборка листа
  function build() {
    const doc = R.newCharacter();
    doc.name = st.name.trim() || "?";
    doc.portrait = st.portrait;
    const r = race(), c = cls();
    if (r) { doc.race = { id: r.id, sub: st.sub, name: "" }; doc.speed = r.speed; doc.size = r.size; }
    else { doc.race = { id: "", sub: "", name: st.raceCustom.trim() }; doc.speed = MC.int(st.speedCustom, 30); }
    doc.abilities = finalScores();
    for (const a of R.ABILS) if (!doc.abilities[a]) doc.abilities[a] = 10;
    const level = MC.clamp(MC.int(st.level, 1), 1, 20);
    if (c) {
      const e = R.classEntry(c, level);
      if (st.subcls && level >= c.sub_level) e.sub = st.subcls;
      doc.classes = [e];
      doc.saves = c.saves.slice();
      const armor = [], weapons = [];
      for (const p of c.profs) (/(доспех|armor|щит|shield)/i.test(p) ? armor : weapons).push(p);
      doc.profs.armor = armor.join(", ");
      doc.profs.weapons = weapons.join(", ");
      for (let lv = 1; lv <= level; lv++) for (const f of R.featuresAt(c.id, e.sub, lv)) doc.features.push(R.featureEntry(f, `${MC.L(c)} ${lv}`));
      if (c.id === "barbarian") doc.ac.unarmored = "barb";
      if (c.id === "monk") doc.ac.unarmored = "monk";
    } else {
      doc.classes = [{ id: "", name: st.clsCustom.trim() || "?", sub: "", sub_name: "", level, hd: MC.int(st.hd, 8), caster: null, ability: null }];
    }
    if (r) {
      doc.profs.languages = r.langs.join(", ");
      for (const id of [...r.traits, ...(subrace()?.traits || [])]) {
        const tr = R.srd.traits[id];
        if (tr) doc.features.push({ id: MC.uid(), name: tr.en, src: R.raceName(doc), desc: tr.desc });
      }
    }
    if (bg()) doc.background = { id: bg().id, name: "" };
    else if (st.bg === "_custom") doc.background = { id: "", name: st.bgCustom.trim() };
    for (const s of [...bgSkills(), ...st.skills]) doc.skills[s] = 1;
    // хиты: максимум кости на 1 уровне + среднее дальше
    const hd = doc.classes[0].hd, con = R.mod(doc.abilities.con);
    const max = Math.max(1, hd + con + (level - 1) * Math.max(1, R.avgHp(hd) + con));
    doc.hp = { max, cur: max, temp: 0 };
    if (c) for (const op of R.syncResourceOps(doc, c.id, level)) doc.resources.push(op.value);
    // снаряжение
    if (c && !st.noEquip) {
      const items = [...c.start];
      c.start_choices.forEach((ch, i) => { if (ch.variants) items.push(...ch.variants[MC.int(st.equip[i], 0)]); });
      const merged = {};
      for (const x of items) merged[x.id] = (merged[x.id] || 0) + x.qty;
      MC.Sheet.addItems(Object.entries(merged).map(([id, qty]) => ({ id, qty })), doc);
      // первый доспех и щит сразу надеты
      const armor = doc.inventory.find((i) => i.kind === "armor");
      if (armor) armor.equipped = true;
      const shield = doc.inventory.find((i) => i.kind === "shield");
      if (shield) shield.equipped = true;
      for (const w of doc.inventory) if (w.kind === "weapon") w.equipped = true;
    }
    return doc;
  }
  W._build = () => build();
  W._state = () => st;

  // ---------------------------------------------------------------- ввод
  const inWizard = (e) => MC.$("#sheet-root")?.contains(e.target) && MC.$(".wizard");
  document.addEventListener("input", (e) => {
    if (!st || !inWizard(e)) return;
    const w = e.target.dataset.w;
    if (w && e.target.type !== "checkbox") st[w] = ["level", "speedCustom", "hd"].includes(w) ? MC.int(e.target.value, 1) : e.target.value;
    if (e.target.dataset.casi) st.customAsi[e.target.dataset.casi] = MC.int(e.target.value, 0);
    if (e.target.dataset.base) st.base[e.target.dataset.base] = MC.clamp(MC.int(e.target.value, 10), 1, 30);
  });
  document.addEventListener("change", (e) => {
    if (!st || !inWizard(e)) return;
    const w = e.target.dataset.w;
    if (w === "noEquip") { st.noEquip = e.target.checked; render(); }
    if (w === "subcls" || w === "hd") st[w] = w === "hd" ? MC.int(e.target.value, 8) : e.target.value;
    if (w === "level") { st.level = MC.clamp(MC.int(e.target.value, 1), 1, 20); render(); }
    if (e.target.dataset.base) render();
  });
  document.addEventListener("click", async (e) => {
    if (!st) return;
    if (st.asOpen && !e.target.closest(".as-cell")) { st.asOpen = null; if (inWizard(e)) render(); }
    if (!inWizard(e)) return;
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.asOpen) { st.asOpen = st.asOpen === d.asOpen ? null : d.asOpen; render(); return; }
    if (d.asPick) {
      const v = d.v;
      if (v) for (const k of R.ABILS) if (st.assign[k] === v) st.assign[k] = "";
      st.assign[d.asPick] = v; st.asOpen = null;
      render(); return;
    }
    if (d.pickRace) { st.race = d.pickRace; st.sub = R.srd.race[st.race]?.subraces[0]?.id || ""; st.asiPick = []; render(); return; }
    if (d.pickSub) { st.sub = d.pickSub; render(); return; }
    if (d.asi) {
      const lim = race()?.asi_choice || 0;
      st.asiPick = st.asiPick.includes(d.asi) ? st.asiPick.filter((x) => x !== d.asi) : [...st.asiPick, d.asi].slice(-lim);
      render(); return;
    }
    if (d.pickCls) { st.cls = d.pickCls; st.subcls = ""; st.skills = []; st.equip = {}; render(); return; }
    if (d.pickBg) {
      st.bg = d.pickBg;
      st.skills = st.skills.filter((s) => !bgSkills().includes(s));
      render(); return;
    }
    if (d.skill) {
      const n = cls()?.skills.n || 0;
      st.skills = st.skills.includes(d.skill) ? st.skills.filter((x) => x !== d.skill) : [...st.skills, d.skill].slice(-n);
      render(); return;
    }
    if (d.method) { st.method = d.method; st.assign = { str: "", dex: "", con: "", int: "", wis: "", cha: "" }; if (d.method === "buy") st.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }; if (d.method === "manual") st.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }; render(); return; }
    if (d.buy) { st.base[d.buy] = MC.clamp(st.base[d.buy] + MC.int(d.d), 8, 15); render(); return; }
    if (d.eq != null) { st.equip[d.eq] = MC.int(d.v); render(); return; }
    switch (d.wz) {
      case "cancel": {          // спросим, если что-то уже выбрано, и уберём мастер со страницы
        if (st.step > 0 && !await MC.confirm(t("wz.cancel_confirm"))) return;
        st = null;
        const root = MC.$("#sheet-root");
        if (root) root.innerHTML = "";
        MC.emit("sheet_closed");
        break;
      }
      case "back": st.step = Math.max(0, st.step - 1); render(); break;
      case "next": {
        const p = problem();
        if (p) { const w = MC.$("#wz-warn"); w.textContent = p; w.classList.add("show"); return; }
        st.step = Math.min(STEPS.length - 1, st.step + 1); render(); MC.$(".tabs-body").scrollTop = 0; break;
      }
      case "portrait": {
        const f = await MC.pickImageCropped(256);
        if (f) { st.portrait = await MC.imageToDataUrl(f, 256); render(); }
        break;
      }
      case "roll": {
        b.disabled = true;
        const out = [];
        for (let i = 0; i < 6; i++) {
          const r = await MC.Dice.roll("4d6kh3", `${st.name || "?"}: ${t("ab.scores")} ${i + 1}/6`, { kind: "free", hidden: false });
          if (!r) { b.disabled = false; return; }
          out.push(r.total);
        }
        st.rolls = out; st.assign = { str: "", dex: "", con: "", int: "", wis: "", cha: "" }; render();
        break;
      }
      case "create": {
        b.disabled = true;
        const doc = build();
        st = null;
        await create(doc);
        break;
      }
      default: break;
    }
  });
})();
