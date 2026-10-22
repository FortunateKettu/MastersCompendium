// Masters Compendium — интерактивный лист персонажа D&D 5e (2014).
// Клик по числу — бросок. «Редактировать» — поля становятся редактируемыми.
(() => {
  "use strict";
  const MC = window.MC;
  const R = MC.R;
  const S = (MC.Sheet = {});
  const t = MC.t, esc = MC.esc;

  S.cur = { id: null, tab: MC.store.get("sheet_tab", "main"), editing: false };
  S.doc = () => MC.state.docs.get(S.cur.id);
  S.canEdit = () => !!S.doc();
  const TABS = ["main", "attacks", "spells", "inventory", "features", "persona"];
  const TAB_ICON = { main: "main", attacks: "attacks", spells: "spells", inventory: "inventory", features: "features", persona: "persona" };

  // ---------------------------------------------------------------- нормализация старых/импортированных листов
  S.normalize = (doc) => {
    const def = R.newCharacter();
    const ops = [];
    for (const [k, v] of Object.entries(def)) {
      if (doc[k] === undefined || doc[k] === null || typeof doc[k] !== typeof v || Array.isArray(v) !== Array.isArray(doc[k])) {
        ops.push({ op: "set", path: [k], value: MC.clone(v) });
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          if (doc[k][k2] === undefined || (Array.isArray(v2) && !Array.isArray(doc[k][k2]))) ops.push({ op: "set", path: [k, k2], value: MC.clone(v2) });
        }
      }
    }
    if (ops.length) MC.patch(doc.id, ops);
  };

  // ---------------------------------------------------------------- открыть / закрыть
  S.open = async (id) => {
    S.cur.id = id;
    S.cur.editing = false;
    await R.load();
    if (!MC.state.docs.has(id)) MC.send({ t: "char_get", id });
    S.render();
  };
  S.close = () => { S.cur.id = null; };

  const patch = (ops) => MC.patch(S.cur.id, ops);
  const set = (path, value) => MC.set(S.cur.id, path, value);
  const roll = (formula, label, kind) => MC.Dice.roll(formula, label, { kind, char: S.cur.id });
  S.patch = patch; S.set = set; S.roll = roll;

  // ---------------------------------------------------------------- отрисовка
  let pendingRender = false;
  S.render = () => {
    const root = MC.$("#sheet-root");
    if (!root || !S.cur.id) return;
    const ae = document.activeElement;
    if (ae && root.contains(ae) && ae.matches("input, textarea, select") && !ae.dataset.live) { pendingRender = true; return; }
    pendingRender = false;
    const doc = S.doc();
    if (!doc) { root.innerHTML = `<div class="loading">…</div>`; return; }
    if (!doc.__norm) { Object.defineProperty(doc, "__norm", { value: true, enumerable: false }); S.normalize(doc); }
    const scroll = MC.$(".tabs-body")?.scrollTop;
    root.innerHTML = `<div class="sheet ${S.cur.editing ? "editing" : ""}">
      ${header(doc)}
      <div class="sheet-tools">${MC.Dice.modeBarHtml()}</div>
      <nav class="subtabs">${TABS.map((x) => `<button class="${S.cur.tab === x ? "active" : ""}" data-subtab="${x}">${MC.icon(TAB_ICON[x], "sm")}${t("st." + x)}</button>`).join("")}</nav>
      <div class="sheet-body">${(BODY[S.cur.tab] || BODY.main)(doc)}</div>
    </div>`;
    if (scroll != null) MC.$(".tabs-body").scrollTop = scroll;
  };
  document.addEventListener("focusout", () => { if (pendingRender) setTimeout(() => { if (pendingRender) S.render(); }, 0); });
  MC.on("doc", (id) => { if (id === S.cur.id) S.render(); });
  MC.on("lang", () => S.render());
  MC.on("currency", () => { if (S.cur.id) S.render(); });
  MC.on("dice_mode", () => {});

  // ---------------------------------------------------------------- шапка
  function header(doc) {
    const cls = (doc.classes || []).map((k) => `${esc(R.className(k))} ${k.level}${R.subclassName(k) ? ` <span class="muted">(${esc(R.subclassName(k))})</span>` : ""}`).join(" / ");
    const owner = MC.state.players.find((p) => p.id === doc.owner);
    const pic = doc.portrait
      ? `<img src="${esc(doc.portrait)}" alt="">`
      : `<span>${esc((doc.name || "?").trim().charAt(0).toUpperCase())}</span>`;
    return `<header class="sh-head card glass">
      <button class="portrait" data-act="portrait" title="${esc(t("sh.portrait.change"))}" style="--c:${esc(owner?.color || "#8b5cf6")}">${pic}</button>
      <div class="sh-title">
        <h1>${esc(doc.name || "?")}</h1>
        <div class="sh-sub">${esc(R.raceName(doc))}${cls ? " · " + cls : ""}</div>
        <div class="sh-sub muted">${[R.bgName(doc), doc.alignment].filter(Boolean).map(esc).join(" · ")}
          ${MC.isGM() ? `<button class="owner-chip ${owner ? "" : "npc"}" data-act="assign" title="${esc(t("sh.assign"))}">${MC.icon(owner ? "user" : "ghost", "sm")} ${esc(owner ? owner.name : t("chars.npc"))}</button>` : ""}</div>
      </div>
      <div class="sh-actions">
        <button class="icon-btn ${doc.inspiration ? "on" : ""}" data-act="inspiration" title="${esc(t("sh.inspiration"))}">${MC.icon("star", "")}</button>
        <button class="icon-btn ${S.cur.editing ? "on" : ""}" data-act="edit" title="${esc(t("sh.edit"))}">${MC.icon("edit", "")}</button>
        ${MC.canPop() ? `<button class="icon-btn" data-popsheet="${esc(doc.id)}" title="${esc(t("mp.pop"))}">${MC.icon("external", "")}</button>` : ""}
        <button class="icon-btn" data-act="menu" title="${esc(t("sh.menu"))}">${MC.icon("more", "")}</button>
      </div>
      ${MC.Xp ? MC.Xp.headerHtml(doc) : ""}
      ${S.cur.editing ? `<button class="btn small edit-info" data-act="info">${MC.icon("edit", "sm")} ${t("sh.name")}, ${t("sh.race").toLowerCase()}, ${t("sh.class").toLowerCase()}…</button>` : ""}
    </header>`;
  }

  // ---------------------------------------------------------------- маленькие помощники разметки
  const num = (path, val, cls = "") => `<input class="num ${cls}" type="number" inputmode="numeric" data-set="${path}" data-type="int" value="${esc(val)}">`;
  const txtIn = (path, val, ph = "") => `<input data-set="${path}" data-type="str" value="${esc(val)}" placeholder="${esc(ph)}">`;
  const area = (path, val, ph = "", rows = 3) => `<textarea data-set="${path}" data-type="str" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
  const pips = (n, filled, act, extra = "") => Array.from({ length: n }, (_, i) =>
    `<button class="pip ${i < filled ? "on" : ""}" data-act="${act}" data-i="${i}" ${extra}></button>`).join("");

  // ---------------------------------------------------------------- вкладки
  const BODY = {};

  BODY.main = (doc) => {
    const prof = R.prof(doc);
    const statBox = (label, value, act, extra = "") => `<div class="stat ${act ? "click" : ""}" ${act ? `data-act="${act}"` : ""} ${extra}><div class="v">${value}</div><div class="l">${label}</div></div>`;
    const editStats = S.cur.editing ? `<div class="card glass edit-stats">
        <label>${t("st.ac")}<select data-set="ac.mode" data-type="str"><option value="auto" ${doc.ac.mode !== "manual" ? "selected" : ""}>${t("atk.auto")}</option><option value="manual" ${doc.ac.mode === "manual" ? "selected" : ""}>${t("st.ac.manual")}</option></select></label>
        ${doc.ac.mode === "manual" ? `<label>${t("st.ac")}${num("ac.manual", doc.ac.manual)}</label>` : `<label>${t("st.ac.unarmored")}<select data-set="ac.unarmored" data-type="str">${["none", "barb", "monk"].map((v) => `<option value="${v}" ${doc.ac.unarmored === v ? "selected" : ""}>${t("st.ac." + v)}</option>`).join("")}</select></label>`}
        <label>${t("st.ac.bonus")}${num("ac.bonus", doc.ac.bonus)}</label>
        <label>${t("st.init.bonus")}${num("init_bonus", doc.init_bonus)}</label>
        <label>${t("st.speed")}${num("speed", doc.speed)}</label>
      </div>` : "";
    return `<div class="main-grid">
      <section class="stats-row">
        ${statBox(t("st.ac"), R.ac(doc), "", `title="${esc(t("st.ac.auto"))}"`)}
        ${statBox(t("st.init"), MC.sign(R.initiative(doc)), "roll-init")}
        ${statBox(t("st.speed"), `${doc.speed}<small>${t("st.ft")}</small>`, "")}
        ${statBox(t("st.prof"), MC.sign(prof), "")}
        ${statBox(t("st.passive"), R.passive(doc, "perception"), "")}
      </section>
      ${editStats}
      <div class="side">${hpCard(doc)}${conditionsCard(doc)}</div>
      <section class="abilities card glass">
        <h3>${t("ab.scores")}</h3>
        <div class="ab-grid">${R.ABILS.map((ab) => abilityCard(doc, ab)).join("")}</div>
      </section>
      <section class="skills card glass">
        <h3>${t("ab.skills")}</h3>
        <div class="skill-groups">${R.ABILS.map((ab) => {
          const list = R.srd.skills.filter((x) => x.ab === ab).sort((a, b) => MC.L(a).localeCompare(MC.L(b)));
          if (!list.length) return "";
          return `<div class="sk-group"><div class="sk-gh"><b>${esc(R.abName(ab, false))}</b><span>${MC.sign(R.abMod(doc, ab))}</span></div>
            <ul class="skill-list">${list.map((x) => skillRow(doc, x)).join("")}</ul></div>`;
        }).join("")}</div>
        ${S.cur.editing ? `<label class="check"><input type="checkbox" data-set="jack" data-type="bool" ${doc.jack ? "checked" : ""}> ${t("sk.jack")}</label>` : ""}
        <div class="passives muted">${t("st.passive_inv")}: <b>${R.passive(doc, "investigation")}</b> · ${t("st.passive_ins")}: <b>${R.passive(doc, "insight")}</b></div>
      </section>
    </div>`;
  };

  function abilityCard(doc, ab) {
    const sc = R.score(doc, ab), m = R.mod(sc);
    const saveP = (doc.saves || []).includes(ab);
    return `<div class="ab-card">
      <div class="ab-name">${R.abName(ab, false)}</div>
      <button class="ab-mod" data-act="roll-check" data-ab="${ab}">${MC.sign(m)}</button>
      ${S.cur.editing ? num("abilities." + ab, sc, "ab-score-in") : `<div class="ab-score">${sc}</div>`}
      <div class="ab-save">
        <button class="dot ${saveP ? "p1" : ""}" data-act="toggle-save" data-ab="${ab}" ${S.cur.editing ? "" : "disabled"}></button>
        <button class="link" data-act="roll-save" data-ab="${ab}">${t("ab.save")} ${MC.sign(R.saveBonus(doc, ab))}</button>
      </div>
    </div>`;
  }

  function skillRow(doc, s) {
    const p = R.skillProf(doc, s.id);
    return `<li class="skill p${p}">
      <button class="dot p${p}" data-act="cycle-skill" data-sk="${s.id}" ${S.cur.editing ? "" : "disabled"} title="${esc(p === 2 ? t("sk.expert") : p ? t("sk.prof") : "")}"></button>
      <button class="sk-main" data-act="roll-skill" data-sk="${s.id}">
        <span class="sk-name">${esc(MC.L(s))}</span>
        <span class="sk-val">${MC.sign(R.skillBonus(doc, s.id))}</span></button>
    </li>`;
  }

  function hpCard(doc) {
    const hp = doc.hp, max = MC.int(hp.max, 0), cur = MC.int(hp.cur, 0), tmp = MC.int(hp.temp, 0);
    const pct = max ? MC.clamp(cur / max * 100, 0, 100) : 0;
    const dying = max > 0 && cur <= 0;
    const hd = R.hitDice(doc);
    return `<section class="hp card glass ${dying ? "dying" : ""}">
      <div class="hp-top">
        <h3>${t("hp.title")}</h3>
        <div class="hp-nums">
          ${S.cur.editing ? `<label>${t("hp.cur")}${num("hp.cur", cur)}</label><label>${t("hp.max")}${num("hp.max", max)}</label><label>${t("hp.temp")}${num("hp.temp", tmp)}</label>`
    : `<span class="hp-cur">${cur}</span><span class="hp-max">/ ${max}</span>${tmp ? `<span class="hp-temp">+${tmp}</span>` : ""}`}
        </div>
      </div>
      <div class="bar"><i style="width:${pct}%" class="${pct < 30 ? "low" : pct < 60 ? "mid" : ""}"></i>${tmp ? `<em style="width:${MC.clamp(tmp / Math.max(max, 1) * 100, 0, 100)}%"></em>` : ""}</div>
      <div class="hp-btns">
        <button class="btn bad" data-act="damage">− ${t("hp.damage")}</button>
        <button class="btn ok" data-act="heal">+ ${t("hp.heal")}</button>
        <button class="btn" data-act="temp">${t("hp.set_temp")}</button>
      </div>
      ${dying ? `<div class="death">
        <div class="muted">${t("hp.dying")}</div>
        <div class="death-row"><span>${t("hp.success")}</span>${pips(3, doc.death.ok, "death-ok")}</div>
        <div class="death-row"><span>${t("hp.fail")}</span>${pips(3, doc.death.fail, "death-fail", 'data-bad="1"')}</div>
        <button class="btn" data-act="roll-death">${MC.icon("d20", "sm")} ${t("hp.roll_death")}</button>
      </div>` : ""}
      ${hd.length ? `<div class="hd-row"><span class="muted">${t("hd.title")}:</span> ${hd.map((h) => `<span class="hd-chip">${h.total - h.used}/${h.total} d${h.d}</span>`).join(" ")}</div>` : ""}
    </section>`;
  }

  function conditionsCard(doc) {
    const list = (doc.conditions || []).map((c) => R.srd.cond[c]).filter(Boolean);
    const ex = MC.int(doc.exhaustion, 0);
    return `<section class="conds card glass click" data-act="conditions">
      <h3>${t("sh.conditions")}</h3>
      <div class="cond-chips">${list.length || ex ? "" : `<span class="muted">${t("sh.no_conditions")}</span>`}
        ${list.map((c) => `<span class="chip on bad" title="${esc(c.desc_ru)}">${esc(MC.L(c))}</span>`).join("")}
        ${ex ? `<span class="chip on bad">${t("sh.exhaustion")} ${ex}</span>` : ""}</div>
    </section>`;
  }

  BODY.attacks = (doc) => {
    const rows = (doc.attacks || []).map((a) => {
      const bonus = R.attackBonus(doc, a);
      const crit = MC.Dice.lastCrit && MC.Dice.lastCrit.atk === a.id && Date.now() - MC.Dice.lastCrit.ts < 120000;
      return `<li class="atk card glass">
        <div class="atk-main">
          <div class="atk-name" data-act="${S.cur.editing ? "edit-attack" : ""}" data-id="${a.id}">${esc(a.name || "?")}${S.cur.editing ? " " + MC.icon("edit", "sm") : ""}</div>
          <div class="atk-meta muted">${[R.dmgType(a.dtype), a.range, a.notes].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
        <button class="btn atk-hit" data-act="roll-attack" data-id="${a.id}">${MC.sign(bonus)}</button>
        <button class="btn atk-dmg ${crit ? "crit" : ""}" data-act="roll-damage" data-id="${a.id}">${esc(R.damageFormula(doc, a, crit) || "—")}${crit ? " " + MC.icon("crit", "sm") : ""}</button>
      </li>`;
    }).join("");
    return `<ul class="atk-list">${rows || `<p class="muted center">${t("atk.empty")}</p>`}</ul>
      <button class="btn add" data-act="add-attack">${MC.icon("plus", "sm")} ${t("atk.add")}</button>`;
  };

  BODY.spells = (doc) => {
    const ab = R.spellAbility(doc);
    const max = R.slotsMax(doc);
    const used = doc.spells.slots_used || [];
    const pact = R.pact(doc);
    const info = R.knownInfo(doc).map((k) => `${esc(k.cls)}: ${k.cantrips ? t("sp.cantrips_known", { n: k.cantrips }) : ""}${k.known ? " · " + t("sp.known", { n: k.known }) : ""}`).join("<br>");
    const slots = max.map((n, i) => n || S.cur.editing ? `<div class="slot-row"><span class="slot-lvl">${i + 1}</span>
        <div class="pips">${pips(n, n - MC.clamp(MC.int(used[i], 0), 0, n), "slot", `data-lvl="${i}"`)}</div>
        ${S.cur.editing ? `<span class="adj"><button data-act="slot-adj" data-lvl="${i}" data-d="-1">−</button><button data-act="slot-adj" data-lvl="${i}" data-d="1">+</button></span>` : ""}</div>` : "").join("");
    const byLvl = {};
    for (const sp of doc.spells.list || []) (byLvl[MC.int(sp.lvl, 0)] = byLvl[MC.int(sp.lvl, 0)] || []).push(sp);
    const groups = Object.keys(byLvl).map(Number).sort((a, b) => a - b).map((lv) => `
      <h3 class="section">${lv === 0 ? t("sp.cantrips") : t("sp.level", { n: lv })}</h3>
      <ul class="spell-list">${byLvl[lv].sort((a, b) => R.spellName(a).localeCompare(R.spellName(b))).map((sp) => spellRow(sp)).join("")}</ul>`).join("");
    return `<section class="card glass sp-head">
        <div class="stats-row compact">
          <div class="stat">${S.cur.editing ? `<select data-set="spells.ability" data-type="str"><option value="auto">${t("atk.auto")}</option>${R.ABILS.map((a) => `<option value="${a}" ${doc.spells.ability === a ? "selected" : ""}>${R.abName(a)}</option>`).join("")}</select>` : `<div class="v">${ab ? R.abName(ab) : "—"}</div>`}<div class="l">${t("sp.ability")}</div></div>
          <div class="stat"><div class="v">${R.spellDC(doc)}</div><div class="l">${t("sp.dc")}</div></div>
          <div class="stat click" data-act="roll-spell-atk"><div class="v">${MC.sign(R.spellAtk(doc))}</div><div class="l">${t("sp.attack")}</div></div>
        </div>
        ${info ? `<p class="muted small">${info}</p>` : !ab ? `<p class="muted small">${t("sp.no_caster")}</p>` : ""}
        ${slots ? `<h3>${t("sp.slots")}</h3><div class="slots">${slots}</div>` : ""}
        ${pact ? `<h3>${t("sp.pact")} · ${t("sp.level", { n: pact.level })}</h3><div class="slots"><div class="slot-row"><span class="slot-lvl">${MC.icon("sparkle", "sm")}</span><div class="pips">${pips(pact.count, pact.count - MC.clamp(MC.int(doc.spells.pact_used, 0), 0, pact.count), "pact")}</div></div></div>` : ""}
      </section>
      ${groups || `<p class="muted center">${t("sp.empty")}</p>`}
      <div class="row-btns"><button class="btn add" data-act="add-spell">${MC.icon("plus", "sm")} ${t("sp.add")}</button><button class="btn" data-act="custom-spell">${MC.icon("pen", "sm")} ${t("sp.add_custom")}</button></div>`;
  };

  function spellRow(sp) {
    const lv = MC.int(sp.lvl, 0);
    const prepared = sp.prepared || sp.always || lv === 0;
    return `<li class="spell ${prepared ? "" : "unprep"}">
      ${lv > 0 ? `<button class="dot ${sp.always ? "p2" : sp.prepared ? "p1" : ""}" data-act="prep-spell" data-id="${sp.id}" title="${esc(t("sp.prepared"))}"></button>` : `<span class="dot-sp"></span>`}
      <button class="sp-main" data-act="spell-info" data-id="${sp.id}"><span class="sp-name">${esc(R.spellName(sp))}</span>
        ${sp.conc ? `<span class="tag">${t("sp.conc")}</span>` : ""}${sp.ritual ? `<span class="tag">${t("sp.ritual")}</span>` : ""}</button>
      ${S.cur.editing ? `<button class="icon-btn small" data-act="del-spell" data-id="${sp.id}">${MC.icon("trash", "sm")}</button>` : `<button class="btn small" data-act="cast" data-id="${sp.id}">${t("sp.cast")}</button>`}
    </li>`;
  }

  BODY.inventory = (doc) => {
    const c = R.carry(doc);
    const over = c.w > c.cap;
    const rows = (doc.inventory || []).map((it) => {
      const equip = ["armor", "shield", "weapon"].includes(it.kind);
      const meta = [it.kind === "weapon" ? `${it.dmg || ""} ${R.dmgType(it.dtype)}` : "", (it.kind === "armor" || it.kind === "shield") ? `${t("st.ac")} ${it.kind === "shield" ? "+" : ""}${it.ac}` : "", it.notes].filter((x) => x && x.trim()).map(esc).join(" · ");
      return `<li class="item ${it.equipped ? "eq" : ""}">
        ${equip ? `<button class="eq-btn ${it.equipped ? "on" : ""}" data-act="equip" data-id="${it.id}" title="${esc(it.equipped ? t("inv.unequip") : t("inv.equip"))}">${MC.icon(it.kind === "weapon" ? "sword" : it.kind === "shield" ? "main" : "armor")}</button>` : `<span class="eq-btn ghost">•</span>`}
        <button class="it-main" data-act="edit-item" data-id="${it.id}"><span class="it-name">${esc(R.itemName(it))}</span><span class="it-meta muted">${meta}</span></button>
        <div class="stepper small"><button data-act="qty" data-id="${it.id}" data-d="-1">−</button><b>${MC.num(it.qty, 1)}</b><button data-act="qty" data-id="${it.id}" data-d="1">+</button></div>
        <span class="it-w muted">${Math.round(MC.num(it.w, 0) * MC.num(it.qty, 1) * 10) / 10}</span>
      </li>`;
    }).join("");
    const coins = MC.Money ? MC.Money.coinsHtml(doc) : "";
    return `<section class="card glass">
        <h3 class="with-act">${t("inv.coins")}<button class="btn small" data-act="exchange">${MC.icon("refresh", "sm")} ${t("money.exchange")}</button></h3><div class="coins">${coins}</div>
        <div class="carry ${over ? "over" : ""}"><div class="bar"><i style="width:${MC.clamp(c.w / Math.max(c.cap, 1) * 100, 0, 100)}%"></i></div><span>${t("inv.total", { w: c.w, cap: c.cap })}</span></div>
      </section>
      <ul class="inv-list">${rows || `<p class="muted center">${t("inv.empty")}</p>`}</ul>
      <div class="row-btns"><button class="btn add" data-act="add-item">${MC.icon("plus", "sm")} ${t("inv.add")}</button><button class="btn" data-act="custom-item">${MC.icon("pen", "sm")} ${t("inv.add_custom")}</button></div>`;
  };

  BODY.features = (doc) => {
    const res = (doc.resources || []).map((r) => {
      const max = MC.int(r.max, 0), used = MC.clamp(MC.int(r.used, 0), 0, max);
      const big = max > 10;
      return `<li class="res card glass">
        <div class="res-name" data-act="edit-res" data-id="${r.id}">${esc(r.name)} <span class="muted small">· ${t("res.reset." + (r.reset || "long"))}</span></div>
        ${big ? `<div class="stepper"><button data-act="res-use" data-id="${r.id}" data-d="1">−</button><b>${max - used} / ${max}</b><button data-act="res-use" data-id="${r.id}" data-d="-1">+</button></div>`
    : `<div class="pips">${pips(max, max - used, "res-pip", `data-id="${r.id}"`)}</div>`}
      </li>`;
    }).join("");
    const feats = (doc.features || []).map((f) => `<li class="feat card glass">
        <details><summary><b>${esc(f.name)}</b>${f.src ? ` <span class="muted small">· ${esc(f.src)}</span>` : ""}</summary>
        <div class="feat-desc">${esc(f.desc).replace(/\n/g, "<br>")}</div>
        ${S.cur.editing ? `<div class="row-btns"><button class="btn small" data-act="edit-feat" data-id="${f.id}">${MC.icon("edit", "sm")} ${t("edit")}</button><button class="btn small bad" data-act="del-feat" data-id="${f.id}">${MC.icon("trash", "sm")} ${t("delete")}</button></div>` : ""}
        </details></li>`).join("");
    const pr = doc.profs;
    return `<h3 class="section">${t("res.title")}</h3>
      <ul class="res-list">${res || `<p class="muted small">${t("ft.empty")}</p>`}</ul>
      <button class="btn add" data-act="add-res">${MC.icon("plus", "sm")} ${t("res.add")}</button>
      <h3 class="section">${t("ft.title")}</h3>
      <ul class="feat-list">${feats || `<p class="muted small">${t("ft.empty")}</p>`}</ul>
      <button class="btn add" data-act="add-feat">${MC.icon("plus", "sm")} ${t("ft.add")}</button>
      <section class="card glass profs">
        <h3>${t("prof.title")}</h3>
        ${["armor", "weapons", "tools", "languages"].map((k) => `<label>${t("prof." + k)}${area("profs." + k, pr[k], "", 2)}</label>`).join("")}
      </section>`;
  };

  BODY.persona = (doc) => {
    const p = doc.persona;
    return `<section class="card glass persona">
      ${["personality", "ideals", "bonds", "flaws", "appearance", "backstory", "allies"].map((k) =>
    `<label>${t("ps." + k)}${area("persona." + k, p[k], "", k === "backstory" ? 6 : 2)}</label>`).join("")}
      <label>${t("ps.notes")}${area("notes", doc.notes, "", 6)}</label>
    </section>`;
  };

  // ---------------------------------------------------------------- ввод в полях
  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-set]");
    if (!el || !MC.$("#sheet-root")?.contains(el) || !S.doc()) return;
    const path = el.dataset.set.split(".");
    let v;
    switch (el.dataset.type) {
      case "int": v = MC.int(el.value, 0); break;
      case "num": v = MC.num(el.value, 0); break;
      case "bool": v = el.checked; break;
      default: v = el.value;
    }
    if (path[0] === "abilities") v = MC.clamp(v, 1, 30);
    set(path, v);
  });

  // ---------------------------------------------------------------- клики
  const ACT = (S.ACT = {});
  document.addEventListener("click", (e) => {
    const root = MC.$("#sheet-root");
    if (!root || !root.contains(e.target)) return;
    const st = e.target.closest("[data-subtab]");
    if (st) { S.cur.tab = st.dataset.subtab; MC.store.set("sheet_tab", S.cur.tab); S.render(); MC.$(".tabs-body").scrollTop = 0; return; }
    const el = e.target.closest("[data-act]");
    if (!el || !el.dataset.act) return;
    const fn = ACT[el.dataset.act];
    const doc = S.doc();
    if (fn && doc) { e.preventDefault(); fn(el, doc); }
  });

  ACT.edit = () => { S.cur.editing = !S.cur.editing; S.render(); };
  ACT.inspiration = (el, doc) => set(["inspiration"], !doc.inspiration);
  ACT["roll-init"] = (el, doc) => roll(`1d20${fmtMod(R.initiative(doc))}`, t("st.init"), "init");
  ACT["roll-check"] = (el, doc) => roll(`1d20${fmtMod(R.abMod(doc, el.dataset.ab))}`, `${t("ab.check")}: ${R.abName(el.dataset.ab, false)}`, "check");
  ACT["roll-save"] = (el, doc) => roll(`1d20${fmtMod(R.saveBonus(doc, el.dataset.ab))}`, `${t("ab.save")}: ${R.abName(el.dataset.ab, false)}`, "save");
  ACT["roll-skill"] = (el, doc) => roll(`1d20${fmtMod(R.skillBonus(doc, el.dataset.sk))}`, R.skillName(el.dataset.sk), "check");
  ACT["toggle-save"] = (el, doc) => {
    if (!S.cur.editing) return;
    const s = new Set(doc.saves || []);
    s.has(el.dataset.ab) ? s.delete(el.dataset.ab) : s.add(el.dataset.ab);
    set(["saves"], [...s]);
  };
  ACT["cycle-skill"] = (el, doc) => {
    if (!S.cur.editing) return;
    const p = (R.skillProf(doc, el.dataset.sk) + 1) % 3;
    set(["skills", el.dataset.sk], p);
  };
  const fmtMod = (n) => (n ? (n > 0 ? "+" + n : "-" + Math.abs(n)) : "");
  S.fmtMod = fmtMod;

  // хиты
  ACT.damage = async (el, doc) => {
    const n = await MC.askNumber(t("hp.damage") + " — " + t("hp.amount"));
    if (n == null || n <= 0) return;
    const hp = doc.hp;
    let tmp = MC.int(hp.temp, 0), cur = MC.int(hp.cur, 0), rest = n;
    const fromTmp = Math.min(tmp, rest); tmp -= fromTmp; rest -= fromTmp;
    const wasDown = cur <= 0;
    cur = Math.max(0, cur - rest);
    const ops = [{ op: "set", path: ["hp", "temp"], value: tmp }, { op: "set", path: ["hp", "cur"], value: cur }];
    if (wasDown && rest > 0 && MC.int(hp.max, 0) > 0) ops.push({ op: "set", path: ["death", "fail"], value: Math.min(3, MC.int(doc.death.fail, 0) + 1) });
    patch(ops);
  };
  ACT.heal = async (el, doc) => {
    const n = await MC.askNumber(t("hp.heal") + " — " + t("hp.amount"));
    if (n == null || n <= 0) return;
    const ops = [{ op: "set", path: ["hp", "cur"], value: Math.min(MC.int(doc.hp.max, 0), Math.max(0, MC.int(doc.hp.cur, 0)) + n) }];
    if (MC.int(doc.hp.cur, 0) <= 0) ops.push({ op: "set", path: ["death"], value: { ok: 0, fail: 0 } });
    patch(ops);
  };
  ACT.temp = async (el, doc) => {
    const n = await MC.askNumber(t("hp.set_temp"), doc.hp.temp || "");
    if (n == null || n < 0) return;
    set(["hp", "temp"], n);
  };
  ACT["death-ok"] = (el, doc) => set(["death", "ok"], +el.dataset.i + 1 === MC.int(doc.death.ok, 0) ? +el.dataset.i : +el.dataset.i + 1);
  ACT["death-fail"] = (el, doc) => set(["death", "fail"], +el.dataset.i + 1 === MC.int(doc.death.fail, 0) ? +el.dataset.i : +el.dataset.i + 1);
  ACT["roll-death"] = async (el, doc) => {
    const r = await roll("1d20", t("hp.roll_death"), "death");
    if (!r) return;
    const nat = r.parts[0].rolls[r.parts[0].kept[0]];
    let ok = MC.int(doc.death.ok, 0), fail = MC.int(doc.death.fail, 0);
    if (nat === 20) { patch([{ op: "set", path: ["hp", "cur"], value: 1 }, { op: "set", path: ["death"], value: { ok: 0, fail: 0 } }]); MC.toast(t("hp.nat20"), "ok"); return; }
    if (nat === 1) fail += 2; else if (r.total >= 10) ok += 1; else fail += 1;
    ok = Math.min(3, ok); fail = Math.min(3, fail);
    set(["death"], { ok, fail });
    if (ok >= 3) MC.toast(t("hp.stable"), "ok");
    if (fail >= 3) MC.toast(t("hp.dead"), "bad");
  };

  // атаки
  ACT["roll-attack"] = async (el, doc) => {
    const a = doc.attacks.find((x) => x.id === el.dataset.id);
    if (!a) return;
    const r = await roll(`1d20${fmtMod(R.attackBonus(doc, a))}`, `${a.name}: ${t("atk.hit")}`, "attack");
    MC.Dice.lastCrit = r && r.crit ? { atk: a.id, ts: Date.now() } : null;
    if (S.cur.tab === "attacks") S.render();
  };
  ACT["roll-damage"] = async (el, doc) => {
    const a = doc.attacks.find((x) => x.id === el.dataset.id);
    if (!a || !a.dmg) return;
    const crit = MC.Dice.lastCrit && MC.Dice.lastCrit.atk === a.id && Date.now() - MC.Dice.lastCrit.ts < 120000;
    await roll(R.damageFormula(doc, a, crit), `${a.name}: ${t("atk.damage")}${crit ? " ×2" : ""}${a.dtype ? " (" + R.dmgType(a.dtype) + ")" : ""}`, "damage");
    if (crit) { MC.Dice.lastCrit = null; S.render(); }
  };

  // заклинания
  ACT["roll-spell-atk"] = (el, doc) => roll(`1d20${fmtMod(R.spellAtk(doc))}`, t("sp.attack"), "attack");
  ACT.slot = (el, doc) => {
    const lvl = +el.dataset.lvl, max = R.slotsMax(doc)[lvl];
    const used = (doc.spells.slots_used || []).slice(0, 9);
    while (used.length < 9) used.push(0);
    const avail = max - MC.int(used[lvl], 0);
    // клик по последней «живой» пипке — потратить, по погасшей — вернуть
    const i = +el.dataset.i;
    used[lvl] = MC.clamp(i < avail ? max - i : max - i - 1, 0, max);
    set(["spells", "slots_used"], used);
  };
  ACT["slot-adj"] = (el, doc) => {
    const adj = (doc.spells.slots_adj || []).slice(0, 9);
    while (adj.length < 9) adj.push(0);
    adj[+el.dataset.lvl] = MC.int(adj[+el.dataset.lvl], 0) + MC.int(el.dataset.d);
    set(["spells", "slots_adj"], adj);
  };
  ACT.pact = (el, doc) => {
    const p = R.pact(doc), i = +el.dataset.i, avail = p.count - MC.int(doc.spells.pact_used, 0);
    set(["spells", "pact_used"], MC.clamp(i < avail ? p.count - i : p.count - i - 1, 0, p.count));
  };
  ACT["prep-spell"] = (el, doc) => {
    const sp = doc.spells.list.find((x) => x.id === el.dataset.id);
    if (!sp) return;
    if (S.cur.editing) {
      // в режиме правки: не подготовлено → подготовлено → всегда подготовлено
      const st = sp.always ? 0 : sp.prepared ? 2 : 1;
      patch([{ op: "set", path: ["spells", "list", sp.id, "prepared"], value: st >= 1 }, { op: "set", path: ["spells", "list", sp.id, "always"], value: st === 2 }]);
    } else if (!sp.always) set(["spells", "list", sp.id, "prepared"], !sp.prepared);
  };
  ACT["del-spell"] = async (el, doc) => {
    const sp = doc.spells.list.find((x) => x.id === el.dataset.id);
    if (sp && await MC.confirm(t("confirm.delete", { name: R.spellName(sp) }))) patch([{ op: "remove", path: ["spells", "list", sp.id] }]);
  };

  // снаряжение
  ACT.equip = (el, doc) => {
    const it = doc.inventory.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const ops = [{ op: "set", path: ["inventory", it.id, "equipped"], value: !it.equipped }];
    // надеваем доспех/щит — снимаем другой такой же
    if (!it.equipped && (it.kind === "armor" || it.kind === "shield")) {
      for (const o of doc.inventory) if (o.id !== it.id && o.kind === it.kind && o.equipped) ops.push({ op: "set", path: ["inventory", o.id, "equipped"], value: false });
    }
    patch(ops);
  };
  ACT.qty = (el, doc) => {
    const it = doc.inventory.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const q = Math.max(0, MC.num(it.qty, 1) + MC.int(el.dataset.d));
    set(["inventory", it.id, "qty"], q);
  };

  // ресурсы
  ACT["res-pip"] = (el, doc) => {
    const r = doc.resources.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const max = MC.int(r.max, 0), i = +el.dataset.i, avail = max - MC.int(r.used, 0);
    set(["resources", r.id, "used"], MC.clamp(i < avail ? max - i : max - i - 1, 0, max));
  };
  ACT["res-use"] = (el, doc) => {
    const r = doc.resources.find((x) => x.id === el.dataset.id);
    if (r) set(["resources", r.id, "used"], MC.clamp(MC.int(r.used, 0) + MC.int(el.dataset.d), 0, MC.int(r.max, 0)));
  };
  ACT["del-feat"] = async (el, doc) => {
    const f = doc.features.find((x) => x.id === el.dataset.id);
    if (f && await MC.confirm(t("confirm.delete", { name: f.name }))) patch([{ op: "remove", path: ["features", f.id] }]);
  };
})();
