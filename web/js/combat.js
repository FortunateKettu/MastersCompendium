// Masters Compendium — бой: порядок инициативы, раунды, чей ход. Мастер ведёт, игроки видят и кидают свою инициативу.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const CB = (MC.Combat = { state: { active: false, round: 0, cur: null, list: [] } });
  const gm = () => MC.isGM();
  const me = () => MC.state.me;
  let lastCur = null;

  const curEntry = () => CB.state.list.find((e) => e.id === CB.state.cur) || null;
  const mineEntry = (e) => !!e && !gm() && e.kind === "pc" && e.owner === me()?.id;
  CB.curToken = () => { const e = curEntry(); return e ? { map: e.map, token: e.token, char: e.char } : null; };

  async function send(obj) {
    try { return await MC.request(obj); } catch (e) { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; }
  }

  // ---------------------------------------------------------------- вкладка «Бой»
  function hpHtml(e) {
    if (e.hp && e.hp.max > 0) {
      const k = MC.clamp(e.hp.cur / e.hp.max, 0, 1);
      return `<div class="cb-hp"><div class="bar"><i class="${k < 0.3 ? "low" : k < 0.6 ? "mid" : ""}" style="width:${k * 100}%"></i></div><span>${e.hp.cur}/${e.hp.max}</span></div>`;
    }
    if (e.state === "bloodied") return `<span class="tag bad">${MC.icon("droplet", "sm")} ${t("map.c.bloodied")}</span>`;
    if (e.state === "dead") return `<span class="tag">${MC.icon("skull", "sm")} ${t("map.c.dead")}</span>`;
    return "";
  }
  // быстрые состояния своего хода: «Отход» (без атак по возможности), «Уклонение», «Полёт»
  const QUICK = [{ cond: "dash", rounds: 1 }, { cond: "disengage", rounds: 1 }, { cond: "dodge", rounds: 1 }, { cond: "ready", rounds: 1, ask: true }, { cond: "flying", rounds: 0 }];
  function row(e, i) {
    const cur = e.id === CB.state.cur;
    const color = e.kind === "pc" ? (MC.state.players.find((p) => p.id === e.owner)?.color || "#8b5cf6") : "#ef4444";
    const conds = (e.conds || []).filter((c) => c !== "bloodied" && c !== "dead").slice(0, 6).map((c) => `<span class="cb-cond" title="${esc(t("map.c." + c) !== "map.c." + c ? t("map.c." + c) : MC.L(MC.R.srd?.cond?.[c]) || c)}" style="--cc:${MC.Map.COND_COLOR[c] || "#64748b"}">${MC.icon(c === "bloodied" ? "droplet" : c === "dead" ? "skull" : "c-" + c, "sm")}</span>`).join("");
    const canRollInit = mineEntry(e) && e.init == null;
    const can = gm() || mineEntry(e);
    const ec = e.econ || {};
    const pip = (k, ic) => `<button class="cb-pip ${ec[k] ? "used" : ""}" ${can ? `data-cbec="${e.id}" data-k="${k}"` : "disabled"} title="${esc(t("act.cost." + k) + (ec[k] ? " · " + t("act.spent") : ""))}">${MC.icon(ic, "sm")}</button>`;
    const sp = MC.int(e.speed, 30), mv = MC.int(ec.mv, 0);
    const extra = (cur || ec.a || ec.b || ec.r || mv || (e.effects || []).length || e.conc) ? `<div class="cb-extra">
        <span class="cb-econ">${pip("a", "sword")}${pip("b", "init")}${pip("r", "refresh")}
          <span class="cb-mv ${mv > sp ? "over" : ""}" title="${esc(t("act.move"))}">${MC.icon("footprints", "sm")} ${Math.max(0, sp - mv)}/${sp}</span></span>
        ${e.conc ? `<span class="cb-ef conc" title="${esc(t("act.conc"))}">${MC.icon("brain", "sm")} ${esc(e.conc)}${can ? `<button data-cbconcx="${e.id}">${MC.icon("x", "sm")}</button>` : ""}</span>` : ""}
        ${(e.effects || []).map((f) => `<span class="cb-ef" style="--cc:${MC.Map?.COND_COLOR?.[f.cond] || "#8b5cf6"}">${f.cond ? MC.icon("c-" + f.cond, "sm") : MC.icon("sparkle", "sm")} ${esc(f.name || condName(f.cond))}${f.dot ? ` <i class="ef-dot ${f.heal ? "h" : ""}">${f.heal ? "+" : "−"}${esc(f.dot)}</i>` : ""}${f.sv_ab ? ` <i class="ef-sv">${esc(MC.R.abName(f.sv_ab, true))} ${f.sv_dc}</i>` : ""}${f.rounds ? ` <b>${f.rounds}</b>` : ""}${can ? `<button data-cbefdel="${e.id}" data-eid="${f.id}">${MC.icon("x", "sm")}</button>` : ""}</span>`).join("")}
        ${can ? `<button class="cb-ef add" data-cbefadd="${e.id}" title="${esc(t("act.effect_add"))}">${MC.icon("plus", "sm")}</button>` : ""}
        ${can && (e.effects || []).some((f) => f.cond === "ready") ? `<button class="cb-ef quick fire" data-cbfire="${e.id}">${MC.icon("init", "sm")} ${t("rule.ready.fire")}</button>` : ""}
        ${can && cur ? QUICK.filter((q) => !(e.effects || []).some((f) => f.cond === q.cond)).map((q) => `<button class="cb-ef quick" data-cbquick="${e.id}" data-qc="${q.cond}" title="${esc(t("rule.q." + q.cond + ".d"))}">${MC.icon("c-" + q.cond, "sm")} ${t("map.c." + q.cond)}</button>`).join("") : ""}
      </div>` : "";
    return `<li class="cb-row ${cur ? "cur" : ""} ${e.hidden ? "hid" : ""} ${e.state === "dead" || (e.hp && e.hp.max && e.hp.cur <= 0) ? "dead" : ""}" data-cb="${e.id}">
      <div class="cb-init">${gm() ? `<input type="number" value="${e.init ?? ""}" data-cbinit="${e.id}" placeholder="—">` : `<b>${e.init ?? "—"}</b>`}</div>
      <i class="cb-dot" style="background:${esc(color)}"></i>
      <div class="cb-main">
        <div class="cb-name"><span class="cb-nm">${esc(e.name)}</span> ${e.hidden ? MC.icon("hidden", "sm") : ""}${mineEntry(e) ? ` <span class="tag">${t("party.you")}</span>` : ""}</div>
        <div class="cb-sub">${hpHtml(e)}${gm() && e.ac != null ? `<span class="tag">${MC.icon("main", "sm")} ${e.ac}</span>` : ""}${conds}</div>
      </div>
      <div class="cb-act">
        ${canRollInit ? `<button class="btn small primary" data-cbrollme="${e.id}">${MC.icon("d20", "sm")} ${t("cb.roll_init")}</button>` : ""}
        ${can && !(e.hp && e.hp.max && e.hp.cur <= 0 && e.kind === "npc") ? `<button class="icon-btn small cb-go" data-cbact="${e.id}" title="${esc(t("act.title"))}">${MC.icon("swords", "sm")}</button>` : ""}
        ${gm() && e.kind === "npc" ? `<button class="icon-btn small ${e.show_hp ? "okc" : ""}" data-cbshowhp="${e.id}" title="${esc(t(e.show_hp ? "hpv.shown" : "hpv.hidden"))}">${MC.icon(e.show_hp ? "eye" : "hidden", "sm")}</button>` : ""}
        ${gm() && MC.int(CB.state.round, 0) <= 1 ? `<button class="icon-btn small ${(e.effects || []).some((f) => f.cond === "surprised") ? "on" : ""}" data-cbsurp="${e.id}" title="${esc(t("rule.surprise"))}">${MC.icon("c-surprised", "sm")}</button>` : ""}
        ${gm() ? `<button class="icon-btn small" data-cbhp="${e.id}" title="${esc(t("cb.hp"))}">${MC.icon("heart", "sm")}</button>
          ${e.mon ? `<button class="icon-btn small" data-cbsb="${e.mon}" title="${esc(t("cb.statblock"))}">${MC.icon("book", "sm")}</button>` : ""}
          <button class="icon-btn small" data-cbhide="${e.id}">${MC.icon(e.hidden ? "eye" : "hidden", "sm")}</button>
          <button class="icon-btn small" data-cbdel="${e.id}">${MC.icon("x", "sm")}</button>` : ""}
      </div>${extra}</li>`;
  }
  const condName = (cd) => (MC.R.srd?.cond?.[cd] ? MC.L(MC.R.srd.cond[cd]) : t("map.c." + cd));

  // ---------------------------------------------------------------- журнал боя
  const AB = (ab) => MC.R.abName(ab);
  CB.logLine = (x) => {
    const b = (s) => `<b>${esc(s)}</b>`;
    switch (x.k) {
      case "start": return t("cbl.start");
      case "turn": return t("cbl.turn", { n: x.rnd, who: b(x.who) });
      case "atk": {
        const res = x.fumble ? t("cbl.fumble") : !x.hit ? t("cbl.miss") : x.crit ? t("cbl.crit", { n: x.dmg }) : t("cbl.hit", { n: x.dmg });
        const vs = x.ac != null ? t("cbl.vs_ac", { ac: x.ac }) : "";
        const mul = x.hit && x.mult !== 1 && x.mult != null ? ` <span class="muted">(${t(x.mult === 0 ? "cbl.imm" : x.mult < 1 ? "cbl.res" : "cbl.vul")})</span>` : "";
        return `${b(x.who)} → ${b(x.tgt)}: ${esc(x.atk)} — ${x.roll}${vs}: <span class="${x.hit ? "ok" : "bad"}">${res}</span>${mul}${hpTail(x)}`;
      }
      case "save": return `${x.who ? b(x.who) + ", " : ""}${esc(x.spell || "")} → ${b(x.tgt)}: ${AB(x.ab)}${x.roll != null ? " " + x.roll : ""} ${t("cbl.vs_dc", { dc: x.dc })} — <span class="${x.ok ? "ok" : "bad"}">${t(x.ok ? "cbl.saved" : "cbl.failed")}</span>${x.dmg ? ", " + t("cbl.dmg", { n: x.dmg }) : ""}${hpTail(x)}`;
      case "heal": return `${b(x.who)} → ${b(x.tgt)}: <span class="ok">+${x.amount}</span> ${t("cbl.hp")}${x.spell ? ` (${esc(x.spell)})` : ""}${hpTail(x)}`;
      case "ef_add": return `${b(x.who)}: ${t("cbl.ef_add", { ef: esc(x.ef) })}${x.rounds ? " " + t("cbl.rounds", { n: x.rounds }) : ""}`;
      case "ef_end": return `${b(x.who)}: ${t("cbl.ef_end", { ef: esc(x.ef) })}`;
      case "ef_tick": return `${b(x.who)}: ${t(x.heal ? "cbl.ef_heal" : "cbl.ef_tick", { ef: esc(x.ef), n: x.dmg })}${x.hp ? ` (${x.hp.cur}/${x.hp.max})` : ""}`;
      case "ef_save": return `${b(x.who)}: ${t(x.ok ? "cbl.ef_save_ok" : "cbl.ef_save_no", { ef: esc(x.ef), roll: x.roll, dc: x.dc })}`;
      case "mnv": return `${b(x.who)}${x.tgt ? " → " + b(x.tgt) : ""}: ${t("mnv." + x.mnv)} — ${x.mnv === "hide" ? t("mnv.hid") : `<span class="${x.ok ? "ok" : "bad"}">${t(x.ok ? "mnv.ok" : "mnv.fail")}</span>`}`;
      case "death": return `${b(x.who)}: ${t("cbl.death", { roll: x.roll, ok: x.ok, fail: x.fail })}${x.res ? ` — <span class="${x.res === "dead" ? "bad" : "ok"}">${t("cbl.death_" + x.res)}</span>` : ""}`;
      case "surprised": return `${b(x.who)}: ${t("cbl.surprised")}`;
      case "conc": return `${b(x.who)}: ${t(x.roll != null ? "cbl.conc" : "cbl.conc_s", { dc: x.dc, roll: x.roll })} — <span class="${x.ok ? "ok" : "bad"}">${t(x.ok ? "cbl.conc_ok" : "cbl.conc_lost")}</span>`;
      default: return esc(x.text || "");
    }
  };
  const hpTail = (x) => (x.hp && x.hp.max ? ` <span class="muted">(${x.hp.cur}/${x.hp.max})</span>` : "");
  CB.logHtml = (n = 40) => {
    const log = (CB.state.log || []).slice(-n).reverse();
    return log.length ? `<ul class="cb-log">${log.map((x) => `<li class="k-${esc(x.k || "")}">${CB.logLine(x)}</li>`).join("")}</ul>` : "";
  };

  /** Рисуем бой во все места сразу: вкладка «Бой», окошко на карте, отдельное окно. */
  CB.render = () => {
    const hosts = [$("#combat-tab"), ...MC.$$(".combat-host")].filter(Boolean);
    if (!hosts.length) return;
    const html = CB.html();
    for (const h of hosts) {
      const ae = document.activeElement;
      if (ae && h.contains(ae) && ae.matches("input[type=number]")) continue;      // не мешаем вводить инициативу
      h.innerHTML = html;
      const row = h.querySelector(".cb-row.cur");
      if (!row) continue;
      const sc = h.closest(".dock-body");
      if (sc) {           // в окошке: прокрутить так, чтобы текущий ход был виден (без рывков, если и так виден)
        const top = row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
        const head = (h.querySelector(".cb-head")?.offsetHeight || 0) + 8;
        if (top < sc.scrollTop + head) sc.scrollTop = Math.max(0, top - head);
        else if (top + row.offsetHeight > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + row.offsetHeight - sc.clientHeight + 8;
      }
      else if (h.closest(".tab")?.classList.contains("active")) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  CB.html = () => {
    const s = CB.state;
    if (!s.active) {
      return `<div class="card glass center cb-empty"><div class="soon-ico">${MC.icon("attacks", "huge")}</div>
        <h2>${t("cb.none")}</h2><p class="muted">${t(gm() ? "cb.none.gm" : "cb.none.d")}</p>
        ${gm() ? `<div class="cb-start">
          <label class="check"><input type="checkbox" data-cbopt="pcs" checked> ${t("cb.opt.pcs")}</label>
          <label class="check"><input type="checkbox" data-cbopt="npcs" checked> ${t("cb.opt.npcs")}</label>
          <label class="check"><input type="checkbox" data-cbopt="roll" checked> ${t("cb.opt.roll")}</label>
          <button class="btn primary" data-cbgo="start">${MC.icon("attacks", "sm")} ${t("cb.start")}</button></div>` : ""}</div>`;
    }
    const cur = curEntry();
    const myTurn = mineEntry(cur);
    const noInit = s.list.filter((e) => e.init == null).length;
    return `<div class="cb-head card glass">
        <div><div class="cb-round">${t("cb.round", { n: s.round || 1 })}</div>
        <div class="muted small">${cur ? t("cb.turn_of", { name: esc(cur.name) }) : s.cur_hidden ? t("cb.turn_hidden") : t(gm() ? "cb.wait_start" : "cb.wait")}</div></div>
        ${MC.canPop() ? `<button class="icon-btn small cb-pop" data-popwin="combat" title="${esc(t("mp.pop"))}">${MC.icon("external", "sm")}</button>` : ""}
        ${gm() ? `<div class="cb-ctl">
          <button class="icon-btn" data-cbgo="prev" title="${esc(t("cb.prev"))}">${MC.icon("back", "sm")}</button>
          <button class="btn primary" data-cbgo="next">${MC.icon("next", "sm")} ${t(s.cur ? "cb.next" : "cb.begin")}</button></div>`
    : myTurn ? (s.end_req === cur.id ? `<button class="btn" disabled>${MC.icon("hourglass", "sm")} ${t("cb.end_wait")}</button>`
      : `<button class="btn primary" data-cbgo="next">${MC.icon("check", "sm")} ${t("cb.end_turn")}</button>`) : ""}
      </div>
      ${gm() && s.end_req && cur && s.end_req === cur.id ? `<div class="cb-endreq">${MC.icon("hourglass", "sm")} <span>${t("cb.end_req", { name: esc(cur.name) })}</span>
        <button class="btn small primary" data-cbgo="next">${MC.icon("check", "sm")} ${t("cb.end_ok")}</button>
        <button class="btn small" data-cbgo="endno">${MC.icon("x", "sm")}</button></div>` : ""}
      ${myTurn && s.end_req !== cur.id ? `<div class="cb-myturn">${MC.icon("crit", "sm")} ${t("cb.your_turn")}</div>` : ""}
      <ul class="cb-list">${s.list.map(row).join("")}</ul>
      ${gm() ? `<div class="row-btns cb-tools">
        ${noInit ? `<button class="btn small" data-cbgo="roll">${MC.icon("d20", "sm")} ${t("cb.roll_npcs")}</button>` : ""}
        <button class="btn small" data-cbgo="add">${MC.icon("plus", "sm")} ${t("cb.add")}</button>
        <button class="btn small danger" data-cbgo="end">${MC.icon("x", "sm")} ${t("cb.end")}</button></div>
        <label class="check cb-rules" title="${esc(t("rule.toggle.d"))}"><input type="checkbox" data-cbrules ${s.rules !== false ? "checked" : ""}> ${t("rule.toggle")}</label>` : ""}
      ${(s.log || []).length ? `<h3 class="cb-log-h">${MC.icon("scroll", "sm")} ${t("cbl.title")}</h3>${CB.logHtml(40)}` : ""}`;
  };

  // ---------------------------------------------------------------- картинки участников
  const entryColor = (e) => (e.kind === "pc" ? (MC.state.players.find((p) => p.id === e.owner)?.color || "#8b5cf6") : "#ef4444");
  /** Картинка участника: фишка на текущей карте → портрет персонажа → картинка монстра. */
  CB.entryPic = (e) => {
    const M = MC.Map;
    const tok = M?.map && e.map === M.map.id ? (M.map.tokens || []).find((x) => x.id === e.token) : null;
    if (tok && M.tokPic) { const p = M.tokPic(tok); if (p) return p; }
    const c = e.char ? MC.state.chars.get(e.char) : null;
    if (c?.portrait) return c.portrait;
    const m = e.mon ? MC.Statblock?.peek?.(e.mon) : null;
    return m?.img ? "/asset/" + m.img : "";
  };
  /** Кружок-аватар: картинка или первая буква на цвете. */
  CB.avatar = (name, pic, color, cls = "") => `<span class="cb-av ${cls}" style="--c:${esc(color || "#8b5cf6")}">${esc((name || "?").trim().charAt(0).toUpperCase())}${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ""}</span>`;

  // ---------------------------------------------------------------- полоска на карте: очередь ходов аватарками
  function renderStrip() {
    const el = $("#map-initiative");
    if (!el) return;
    const s = CB.state;
    const seq = (s.list || []).filter((e) => !(e.hp && e.hp.max && e.hp.cur <= 0 && e.kind === "npc"));
    if (!s.active || !seq.length) { el.hidden = true; return; }
    el.hidden = false;
    const i = Math.max(0, seq.findIndex((e) => e.id === s.cur));
    const view = s.cur ? [...seq.slice(i), ...seq.slice(0, i)].slice(0, 10) : seq.slice(0, 10);
    const cur = s.cur ? view[0] : null;
    el.innerHTML = `<span class="mi-round">${t("cb.round_short", { n: s.round || 1 })}</span>` + view.map((e, k) => {
      const hp = e.hp && e.hp.max ? MC.clamp(e.hp.cur / e.hp.max, 0, 1) : null;
      return `<span class="mi-av ${k === 0 && cur ? "cur" : ""} ${e.kind === "pc" ? "pc" : "npc"}" title="${esc(e.name)}" data-cbe="${e.id}">
        ${CB.avatar(e.name, CB.entryPic(e), entryColor(e))}${hp != null ? `<i class="mi-hp"><b style="width:${hp * 100}%" class="${hp < 0.3 ? "low" : hp < 0.6 ? "mid" : ""}"></b></i>` : ""}
        ${k === 0 && cur ? `<span class="mi-name">${esc(e.name)}</span>` : ""}</span>`;
    }).join(`<span class="mi-arrow">›</span>`) + (seq.length > view.length ? `<span class="mi-more">+${seq.length - view.length}</span>` : "");
  }

  // ---------------------------------------------------------------- боевое действие: атака, спасбросок, лечение
  /**
   * src: {spec, info:{char, mon, name}}; targets: [{key, spec, name, color, sub}]; preset: {action?, tgt?: [keys], kind?}
   */
  CB.actionDialog = async (src, targets, preset = {}) => {
    const srcConds = (() => {
      const e = src.spec?.e ? CB.state.list.find((x) => x.id === src.spec.e) : null;
      const tk = CB.specTok(src.spec);
      return new Set([...(e?.conds || []), ...(tk ? MC.Map.tokConds(tk) : [])]);
    })();
    // «Высвободиться» — только тому, кого схватили
    const actions = (await MC.Actions.list(src.info)).filter((a) => a.mnv !== "escape" || srcConds.has("grappled"));
    const st = { act: null, tg: new Set(preset.tgt || []), mode: "normal", slot: 0, cost: "a",
      custom: Object.assign({ name: "", bonus: 0, n: 1, die: 6, mod: 0, dtype: "slashing", rng: "melee" }, (() => { try { return JSON.parse(MC.store.get("act_custom") || "{}"); } catch { return {}; } })()), save: { ab: "dex", dc: 13, dmg: "", half: true }, amount: "" };
    const pick = (a) => {
      st.act = a;
      st.cost = a.cost || "a";
      st.slot = a.lvl || 0;
      if (a.kind === "save") st.save = { ab: a.ab, dc: a.dc, dmg: a.dmg || "", half: !!a.half };
      if (a.kind === "heal") st.amount = a.amount || "";
      if (!a.multi && st.tg.size > 1) st.tg = new Set([...st.tg].slice(0, 1));
    };
    if (preset.kind === "save") pick(actions.find((a) => a.kind === "save") || { id: "aoe", kind: "save", name: t("act.aoe"), ab: "dex", dc: 13, dmg: "", half: true, multi: true, cost: "a" });
    else if (actions.length) pick(actions.find((a) => a.kind === "attack") || actions[0]);
    if (preset.kind === "save" && !actions.some((a) => a.id === st.act.id)) actions.unshift(st.act);
    if (preset.act) { const a = actions.find((x) => x.id === preset.act); if (a) pick(a); }
    if (preset.cost) st.cost = preset.cost;
    const srcT = CB.specTok(src.spec);
    const distTo = (x) => { const tt = CB.specTok(x.spec); return srcT && tt && tt !== srcT ? MC.Map.gapFt(srcT, tt) : null; };
    const multi = () => st.act && (st.act.kind === "save");
    const groups = [["atk", "act.g.atk"], ["spell", "act.g.spell"], ["mon", "act.g.mon"], ["mnv", "act.g.mnv"], ["other", "act.g.other"]];
    const actHtml = () => groups.map(([g, l]) => {
      const list = actions.filter((a) => (a.group || "other") === g);
      if (!list.length) return "";
      return `<li class="act-gh">${t(l)}</li>${list.map((a) => `<li class="act-row ${st.act?.id === a.id ? "on" : ""}" data-actpick="${esc(a.id)}">
        <span class="act-ic k-${a.kind}">${MC.icon(a.icon || "sword", "sm")}</span><div class="act-i"><b>${esc(a.name)}</b><small>${esc(MC.Actions.label(a))}</small></div>
        ${a.lvl ? `<span class="tag">${a.lvl}</span>` : ""}${a.cost && a.cost !== "a" ? `<span class="tag">${t("act.cost_s." + a.cost)}</span>` : ""}</li>`).join("")}`;
    }).join("");
    const tgtHtml = () => targets.map((x) => {
      const d = distTo(x);
      const far = !preset.oa && d != null && st.act?.rng === "melee" && d > (st.act.reach || 5);
      const sub = [x.sub, d != null ? `${d} ${t("st.ft")}` : ""].filter(Boolean).join(" · ");
      return `<li class="act-row ${st.tg.has(x.key) ? "on" : ""} ${far ? "far" : ""}" data-acttg="${esc(x.key)}">
        ${CB.avatar(x.name, x.pic, x.color || "#ef4444", "sm")}<div class="act-i"><b>${esc(x.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>${far ? `<span class="tag bad">${t("rule.far")}</span>` : ""}
        <span class="tp-check">${MC.icon("check", "sm")}</span></li>`;
    }).join("") || `<li class="muted small">${t("act.no_targets")}</li>`;
    const slotSel = () => {
      const a = st.act;
      if (!a || !a.lvl || !(a.dmgAt || a.amountAt)) return "";
      return `<label class="field sm"><span>${t("act.slot")}</span><select data-ao="slot">${[1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => x >= a.lvl).map((x) => `<option value="${x}" ${st.slot === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
    };
    const optsHtml = () => {
      const a = st.act;
      if (!a) return "";
      const cost = `<label class="field sm"><span>${t("act.spend")}</span><select data-ao="cost">${["a", "b", "r", ""].map((k) => `<option value="${k}" ${st.cost === k ? "selected" : ""}>${t(k ? "act.cost." + k : "act.cost.none")}</option>`).join("")}</select></label>`;
      if (a.kind === "attack") {
        return `<div class="chips act-mode">${["normal", "adv", "dis"].map((m) => `<button type="button" class="chip ${st.mode === m ? "on" : ""} ${m === "adv" ? "ok" : m === "dis" ? "bad" : ""}" data-amode="${m}">${t(m === "normal" ? "act.normal" : "mode." + m)}</button>`).join("")}</div>
          <div class="act-fields">${slotSel()}${cost}</div>`;
      }
      if (a.kind === "save") {
        return `<div class="act-fields"><label class="field sm"><span>${t("act.ability")}</span><select data-ao="ab">${MC.R.ABILS.map((x) => `<option value="${x}" ${st.save.ab === x ? "selected" : ""}>${esc(MC.R.abName(x, false))}</option>`).join("")}</select></label>
          <label class="field sm"><span>${t("act.dc")}</span><input type="number" data-ao="dc" value="${st.save.dc}" min="1" max="40"></label>
          <label class="field sm"><span>${t("act.damage")}</span><input data-ao="dmg" value="${esc(slotDmg())}" placeholder="8d6"></label>
          ${slotSel()}${cost}</div><label class="check"><input type="checkbox" data-ao="half" ${st.save.half ? "checked" : ""}> ${t("act.half")}</label>`;
      }
      if (a.kind === "heal") return `<div class="act-fields"><label class="field sm"><span>${t("act.amount")}</span><input data-ao="amount" value="${esc(slotHeal())}"></label>${slotSel()}${cost}</div>`;
      if (a.kind === "custom") {
        const c = st.custom;
        const dmgTypes = Object.keys(MC.R.srd?.damage || {});
        return `<div class="act-fields cust">
          <label class="field"><span>${t("map.name")}</span><input data-ao="cname" value="${esc(c.name)}" placeholder="${esc(t("act.custom_ph"))}"></label>
          <label class="field sm"><span>${t("act.c.kind")}</span><select data-ao="crng"><option value="melee" ${c.rng === "melee" ? "selected" : ""}>${t("act.c.melee")}</option><option value="ranged" ${c.rng === "ranged" ? "selected" : ""}>${t("act.c.ranged")}</option></select></label>
          <label class="field sm"><span>${t("act.to_hit")}</span><input type="number" data-ao="cbonus" value="${c.bonus}" min="-5" max="20"></label></div>
        <div class="act-fields cust-dmg"><span class="cd-l">${t("act.damage")}</span>
          <select data-ao="cn" title="${esc(t("act.c.count"))}">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${c.n === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          <select data-ao="cdie" title="${esc(t("act.c.die"))}">${[4, 6, 8, 10, 12, 20].map((d) => `<option value="${d}" ${c.die === d ? "selected" : ""}>d${d}</option>`).join("")}</select>
          <span>+</span><input type="number" data-ao="cmod" value="${c.mod}" min="-10" max="30" title="${esc(t("act.c.mod"))}">
          <select data-ao="cdt">${dmgTypes.map((k) => `<option value="${k}" ${c.dtype === k ? "selected" : ""}>${esc(MC.R.dmgType(k))}</option>`).join("")}</select>
          <b class="cd-f">= ${esc(custFormula())}</b></div>
        <div class="act-fields">${cost}</div>
          <div class="chips act-mode">${["normal", "adv", "dis"].map((m) => `<button type="button" class="chip ${st.mode === m ? "on" : ""}" data-amode="${m}">${t(m === "normal" ? "act.normal" : "mode." + m)}</button>`).join("")}</div>
          ${gm() ? "" : `<p class="muted small">${MC.icon("hourglass", "sm")} ${t("act.c.gm")}</p>`}`;
      }
      if (a.kind === "conc") return `<p class="muted small">${t("act.conc_hint")}</p>`;
      return "";
    };
    const custFormula = () => { const c = st.custom; return `${c.n}d${c.die}${c.mod ? (c.mod > 0 ? "+" : "") + c.mod : ""}`; };
    const slotDmg = () => (st.act?.dmgAt && st.slot ? st.act.dmgAt(st.slot) || st.save.dmg : st.save.dmg);
    const slotHeal = () => (st.act?.amountAt && st.slot ? st.act.amountAt(st.slot) || st.amount : st.amount);
    const srcEntry = src.spec?.e ? CB.state.list.find((x) => x.id === src.spec.e) : null;
    const srcTok = !srcEntry && src.spec?.token && MC.Map?.map ? (MC.Map.map.tokens || []).find((x) => x.id === src.spec.token) : null;
    const srcPic = srcEntry ? CB.entryPic(srcEntry) : srcTok ? MC.Map.tokPic(srcTok) : "";
    const srcColor = srcEntry ? entryColor(srcEntry) : srcTok ? MC.Map.tokColor(srcTok) : "#8b5cf6";
    const body = () => `<div class="act-src">${CB.avatar(src.info.name, srcPic, srcColor)} <b>${esc(src.info.name)}</b>${MC.icon("swords", "sm")}</div>
      <div class="act-wrap"><div class="act-col"><ul class="act-list">${actHtml()}</ul></div>
        <div class="act-col"><h4>${t(multi() ? "act.targets_multi" : "act.target")}</h4><ul class="act-list">${tgtHtml()}</ul></div></div>
      <div class="act-opts">${optsHtml()}</div>`;
    const v = await MC.modal({ title: t("act.title"), wide: true, body: `<div class="act-box">${body()}</div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("act.go"), kind: "primary", value: "go" }],
      mount: (box) => {
        const root = box.querySelector(".act-box");
        const re = () => { const sc = [...root.querySelectorAll(".act-list")].map((x) => x.scrollTop); root.innerHTML = body(); root.querySelectorAll(".act-list").forEach((x, i) => { x.scrollTop = sc[i] || 0; }); };
        box.addEventListener("click", (e) => {
          const ap = e.target.closest("[data-actpick]");
          if (ap) { pick(actions.find((a) => a.id === ap.dataset.actpick)); re(); return; }
          const tg = e.target.closest("[data-acttg]");
          if (tg) {
            const k = tg.dataset.acttg;
            if (st.tg.has(k)) st.tg.delete(k); else { if (!multi()) st.tg.clear(); st.tg.add(k); }
            re(); return;
          }
          const am = e.target.closest("[data-amode]");
          if (am) { st.mode = am.dataset.amode; re(); }
        });
        const read = (e) => {
          const k = e.target.dataset.ao;
          if (!k) return;
          const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
          if (k === "slot") { st.slot = MC.int(v, st.slot); if (st.act?.kind === "save") st.save.dmg = st.act.dmgAt(st.slot); if (st.act?.kind === "heal") st.amount = st.act.amountAt(st.slot); re(); return; }
          if (k === "cost") st.cost = v;
          if (k === "ab") st.save.ab = v;
          if (k === "dc") st.save.dc = MC.int(v, 13);
          if (k === "dmg") { st.save.dmg = v; if (st.act) st.act.dmgAt = null; }
          if (k === "half") st.save.half = v;
          if (k === "amount") { st.amount = v; if (st.act) st.act.amountAt = null; }
          if (k === "cname") st.custom.name = v;
          if (k === "cbonus") st.custom.bonus = MC.int(v, 0);
          if (k === "crng") st.custom.rng = v;
          if (k === "cdt") st.custom.dtype = v;
          if (k === "cn" || k === "cdie" || k === "cmod") {
            st.custom[k === "cn" ? "n" : k === "cdie" ? "die" : "mod"] = MC.int(v, 0);
            const f = root.querySelector(".cd-f"); if (f) f.textContent = "= " + custFormula();
          }
        };
        box.addEventListener("input", read);
        box.addEventListener("change", read);
      } });
    if (v !== "go" || !st.act) return;
    const a = st.act;
    const tg = targets.filter((x) => st.tg.has(x.key));
    if (a.kind !== "conc" && !(a.kind === "mnv" && !a.tgt) && !tg.length) { MC.toast(t("act.need_target"), "warn"); return; }
    // ячейка заклинания тратится сама (у мастера — предупреждение, но не запрет)
    if (a.spell && st.slot > 0 && src.info.char) {
      const ok = await spendSlot(src.info.char, st.slot);
      if (!ok) return;
    }
    const common = { src: src.spec, hidden: gm() && MC.Dice.hidden, cost: st.cost || "a", spend: !!st.cost, conc: a.conc ? a.name : "", ...(preset.oa ? { oa: true } : {}) };
    const go = async (obj) => {
      try { const r = await MC.request(obj, 15000); if (r?.pending) MC.toast(t("dec.wait"), "warn", "hourglass"); return r; }
      catch (e) { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; }
    };
    if (a.kind === "mnv") {
      try {
        const r = await MC.request({ t: "cb_maneuver", kind: a.mnv, src: src.spec, tgt: a.tgt ? tg[0].spec : null, cost: st.cost || "a" }, 15000);
        const nm = a.tgt ? tg[0].name : "";
        if (a.mnv === "hide") MC.toast(t(r.a != null ? "mnv.hid_n" : "mnv.hid", { n: r.a }), "ok", "hidden");
        else MC.toast(`${t("mnv." + a.mnv)}${nm ? " → " + nm : ""}: ${t(r.ok ? "mnv.ok" : "mnv.fail")}${r.a != null && r.b != null ? ` (${r.a} / ${r.b})` : ""}`, r.ok ? "ok" : "warn", a.icon);
      } catch (e) { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); }
      return;
    }
    if (a.kind === "attack" || a.kind === "custom") {
      if (a.kind === "custom") try { MC.store.set("act_custom", JSON.stringify(st.custom)); } catch { /* ignore */ }
      const atk = a.kind === "custom" ? { name: st.custom.name || t("act.custom"), bonus: st.custom.bonus, dmg: custFormula(), dtype: MC.R.dmgType(st.custom.dtype),
        custom: true, rng: st.custom.rng, reach: 5, range: st.custom.rng === "ranged" ? [80, 320] : null }
        : { name: a.name, bonus: a.bonus, dmg: a.dmgAt && st.slot ? a.dmgAt(st.slot) : a.dmg, dtype: a.dtype, spell: !!a.spell };
      if (a.rng) Object.assign(atk, { rng: a.rng, reach: a.reach || 5, range: a.range || null });
      if (a.ammo) atk.ammo = a.ammo;
      for (const x of tg) await CB.sendAttack({ t: "cb_attack", ...common, tgt: x.spec, atk, mode: st.mode });
    } else if (a.kind === "save") {
      await go({ t: "cb_save", ...common, tgts: tg.map((x) => x.spec), ab: st.save.ab, dc: st.save.dc, dmg: slotDmg(), half: st.save.half, label: a.name, dtype: a.dtype || "" });
    } else if (a.kind === "heal") {
      for (const x of tg) await go({ t: "cb_heal", ...common, tgt: x.spec, amount: slotHeal(), label: a.name });
    } else if (a.kind === "conc" && src.spec.e) {
      await go({ t: "cb_conc", id: src.spec.e, spell: a.name });
    }
    if (navigator.vibrate) try { navigator.vibrate(20); } catch { /* ignore */ }
  };

  // ---------------------------------------------------------------- ячейки заклинаний
  async function spendSlot(cid, lvl) {
    let doc = MC.state.docs.get(cid);
    if (!doc) { try { doc = (await MC.request({ t: "char_get", id: cid })).char; } catch { doc = null; } }
    if (!doc) return true;
    const R = MC.R;
    const used = doc.spells?.slots_used || [];
    const max = R.slotsMax(doc);
    const pact = R.pact(doc);
    const send2 = (ops) => (MC.state.docs.has(cid) ? MC.patch(cid, ops) : MC.send({ t: "char_patch", id: cid, ops, rid: MC.uid() }));
    if (pact && lvl <= pact.level && MC.int(doc.spells?.pact_used, 0) < pact.count && !(MC.int(used[lvl - 1], 0) < max[lvl - 1])) {
      send2([{ op: "inc", path: ["spells", "pact_used"], value: 1 }]);
      MC.toast(t("slot.pact", { n: pact.count - MC.int(doc.spells?.pact_used, 0) - 1 }), "", "spells");
      return true;
    }
    if (MC.int(used[lvl - 1], 0) < max[lvl - 1]) {
      const arr = Array.from({ length: 9 }, (_, i) => MC.int(used[i], 0));
      arr[lvl - 1] += 1;
      send2([{ op: "set", path: ["spells", "slots_used"], value: arr }]);
      MC.toast(t("slot.spent", { lvl, n: max[lvl - 1] - arr[lvl - 1] }), "", "spells");
      return true;
    }
    if (gm()) { MC.toast(t("slot.none_gm", { lvl }), "warn"); return true; }
    MC.toast(t("slot.none", { lvl }), "warn");
    return false;
  }

  // ---------------------------------------------------------------- атака с учётом правил
  CB.reasons = (r) => {
    const parts = [];
    if ((r.adv || []).length) parts.push(`${t("mode.adv")}: ${r.adv.map((k) => t("rule.r." + k)).join(", ")}`);
    if ((r.dis || []).length) parts.push(`${t("mode.dis")}: ${r.dis.map((k) => t("rule.r." + k)).join(", ")}`);
    return parts.join(" · ");
  };
  CB.sendAttack = async (obj) => {
    try {
      const r = await MC.request(obj, 15000);
      if (r.pending) { MC.toast(t("dec.wait"), "warn", "hourglass"); return r; }
      if (r.far != null) MC.toast(t("rule.far_gm", { n: r.far }), "warn", "ruler");
      if (r.full) MC.toast(t("rule.full_gm"), "warn", "main");
      if (r.cover) MC.toast(t("rule.cover", { n: r.cover }), "", "main");
      if (r.ammo === -1) MC.toast(t("sup.no_ammo"), "warn", "inventory");
      else if (r.ammo != null && r.ammo <= 5) MC.toast(t("sup.ammo_left", { n: r.ammo }), r.ammo <= 2 ? "warn" : "", "inventory");
      const why = CB.reasons(r);
      if (why) MC.toast(why, r.mode === "adv" ? "ok" : r.mode === "dis" ? "warn" : "", r.mode === "dis" ? "dis" : "adv");
      return r;
    } catch (e) {
      MC.toast(t(e.code ? "err." + e.code : e.message === "timeout" ? "err.timeout" : "conn.offline"), "warn");
      return null;
    }
  };
  /** Расстояние (фт) между фишками участника-источника и цели, если обе на текущей карте. */
  CB.specTok = (spec) => {
    const M = MC.Map;
    if (!M?.map || !spec) return null;
    if (spec.token) return spec.map === M.map.id ? (M.map.tokens || []).find((x) => x.id === spec.token) || null : null;
    const e = spec.e ? CB.state.list.find((x) => x.id === spec.e) : null;
    if (!e) return null;
    return (M.map.tokens || []).find((x) => (e.map === M.map.id && x.id === e.token) || (e.char && x.char === e.char)) || null;
  };

  /** Цели из боя (все участники, видимые этому игроку). */
  CB.targetsFromCombat = () => CB.state.list.map((e) => ({ key: "e:" + e.id, spec: { e: e.id }, name: e.name, pic: CB.entryPic(e),
    color: e.kind === "pc" ? (MC.state.players.find((p) => p.id === e.owner)?.color || "#8b5cf6") : "#ef4444",
    sub: e.hp && e.hp.max ? `${e.hp.cur}/${e.hp.max}` : e.state && e.state !== "ok" ? t("map.c." + e.state) : "" }));
  CB.entrySrc = (e) => ({ spec: { e: e.id }, info: MC.Actions.sourceInfo(e) });

  async function effectDialog(en) {
    const v = await MC.modal({ title: `${t("act.effect_add")}: ${en.name}`, body: `<div class="form-grid">
        <label class="field full"><span>${t("map.name")}</span><input name="nm" placeholder="${esc(t("act.effect_ph"))}" autofocus></label>
        <label class="field"><span>${t("act.effect_cond")}</span><select name="cond"><option value="">—</option>${(MC.Map.COND_LIST || []).map((c) => `<option value="${c}">${esc(condName(c))}</option>`).join("")}</select></label>
        <label class="field"><span>${t("act.rounds")}</span><input name="rounds" type="number" min="0" max="999" value="1"></label></div>
        <p class="muted small">${t("act.effect_hint")}</p>
        <details class="ef-more"><summary>${MC.icon("refresh", "sm")} ${t("ef.repeat")}</summary><div class="form-grid">
          <label class="field"><span>${t("ef.dot")}</span><input name="dot" placeholder="1d4"></label>
          <label class="field"><span>${t("ef.dot_kind")}</span><select name="heal"><option value="">${t("ef.dmg")}</option><option value="1">${t("ef.heal")}</option></select></label>
          <label class="field"><span>${t("ef.save")}</span><select name="sv_ab"><option value="">—</option>${MC.R.ABILS.map((a) => `<option value="${a}">${esc(MC.R.abName(a, false))}</option>`).join("")}</select></label>
          <label class="field"><span>${t("act.dc")}</span><input name="sv_dc" type="number" min="1" max="40" value="12"></label></div>
          <p class="muted small">${t("ef.repeat_hint")}</p></details>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => ({
        name: w.querySelector("[name=nm]").value.trim(), cond: w.querySelector("[name=cond]").value, rounds: MC.int(w.querySelector("[name=rounds]").value, 0),
        dot: w.querySelector("[name=dot]").value.trim(), heal: !!w.querySelector("[name=heal]").value,
        sv_ab: w.querySelector("[name=sv_ab]").value, sv_dc: MC.int(w.querySelector("[name=sv_dc]").value, 12) }) }] });
    if (!v || (!v.name && !v.cond)) return;
    send({ t: "cb_effect", id: en.id, op: "add", effect: v });
  }

  // ---------------------------------------------------------------- действия
  document.addEventListener("click", async (e) => {
    const qb = e.target.closest("[data-cbquick]");
    if (qb) {
      const q = QUICK.find((x) => x.cond === qb.dataset.qc);
      if (!q) return;
      let name = "";
      if (q.ask) {           // «Подготовка»: на что реагируем
        const v = await MC.modal({ title: t("rule.ready.title"), body: `<label class="field full"><span>${t("rule.ready.trigger")}</span><input name="trg" placeholder="${esc(t("rule.ready.ph"))}" autofocus></label><p class="muted small">${t("rule.ready.hint")}</p>`,
          buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => w.querySelector("[name=trg]").value.trim() || t("map.c.ready") }] });
        if (!v) return;
        name = v;
      }
      send({ t: "cb_effect", id: qb.dataset.cbquick, op: "add", effect: { name, cond: q.cond, rounds: q.rounds } });
      if (q.cond === "dash" || q.cond === "disengage" || q.cond === "dodge" || q.cond === "ready") send({ t: "cb_econ", id: qb.dataset.cbquick, k: "a", v: true });
      return;
    }
    const rf = e.target.closest("[data-cbfire]");
    if (rf) {               // подготовленное действие сработало: реакция
      const en = CB.state.list.find((x) => x.id === rf.dataset.cbfire);
      const ef = (en?.effects || []).find((f) => f.cond === "ready");
      if (!en) return;
      if (ef) send({ t: "cb_effect", id: en.id, op: "del", eid: ef.id });
      CB.actionDialog(CB.entrySrc(en), CB.targetsFromCombat(), { cost: "r" });
      return;
    }
    const sp = e.target.closest("[data-cbsurp]");
    if (sp) {
      const en = CB.state.list.find((x) => x.id === sp.dataset.cbsurp);
      const ef = (en?.effects || []).find((f) => f.cond === "surprised");
      if (ef) send({ t: "cb_effect", id: en.id, op: "del", eid: ef.id });
      else if (en) send({ t: "cb_effect", id: en.id, op: "add", effect: { name: "", cond: "surprised", rounds: 0 } });
      return;
    }
    const ba = e.target.closest("[data-cbact],[data-cbec],[data-cbefadd],[data-cbefdel],[data-cbconcx],[data-cbshowhp]");
    if (ba) {
      const d = ba.dataset;
      const en = CB.state.list.find((x) => x.id === (d.cbact || d.cbec || d.cbefadd || d.cbefdel || d.cbconcx || d.cbshowhp));
      if (!en) return;
      if (d.cbshowhp) { MC.setShowHp({ char: en.char, map: en.map, token: en.token }, !en.show_hp); return; }
      if (d.cbact) CB.actionDialog(CB.entrySrc(en), CB.targetsFromCombat(), {});
      if (d.cbec) send({ t: "cb_econ", id: en.id, k: d.k, v: !(en.econ || {})[d.k] });
      if (d.cbefadd) effectDialog(en);
      if (d.cbefdel) send({ t: "cb_effect", id: en.id, op: "del", eid: d.eid });
      if (d.cbconcx) send({ t: "cb_conc", id: en.id, spell: "" });
      return;
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cbgo],[data-cbhp],[data-cbsb],[data-cbhide],[data-cbdel],[data-cbrollme]");
    if (!b) return;
    const d = b.dataset;
    if (d.cbrollme) {
      const en = CB.state.list.find((x) => x.id === d.cbrollme);
      const doc = en && MC.state.docs.get(en.char);
      if (!doc) { MC.toast(t("cb.need_sheet"), "warn"); return; }
      const m = MC.R.initiative(doc);
      MC.Dice.roll(`1d20${m >= 0 ? "+" : ""}${m}`, t("st.init"), { kind: "init", char: en.char });
      return;
    }
    if (d.cbgo === "start") {
      const box = b.closest(".cb-empty") || document;
      const opt = (k) => box.querySelector(`[data-cbopt=${k}]`)?.checked ?? true;
      send({ t: "cb_start", map: MC.Map.map?.id || null, pcs: opt("pcs"), npcs: opt("npcs"), roll: opt("roll") });
      return;
    }
    if (d.cbgo === "next") { send({ t: "cb_next" }); return; }
    if (d.cbgo === "prev") { send({ t: "cb_prev" }); return; }
    if (d.cbgo === "endno") { send({ t: "cb_endno" }); return; }
    if (d.cbgo === "roll") { send({ t: "cb_roll" }); return; }
    if (d.cbgo === "end") { if (await MC.confirm(t("cb.end_confirm"))) send({ t: "cb_end" }); return; }
    if (d.cbgo === "add") { addDialog(); return; }
    if (d.cbhide) { const en = CB.state.list.find((x) => x.id === d.cbhide); if (en) send({ t: "cb_set", id: en.id, fields: { hidden: !en.hidden } }); return; }
    if (d.cbdel) { send({ t: "cb_del", id: d.cbdel }); return; }
    if (d.cbsb) { try { MC.Statblock.show(await MC.Statblock.get(d.cbsb)); } catch { MC.toast(t("err.not_found"), "warn"); } return; }
    if (d.cbhp) {
      const en = CB.state.list.find((x) => x.id === d.cbhp);
      if (!en) return;
      const v = await MC.modal({ title: en.name, body: `<p class="muted">${t("cb.hp_hint")}</p><input class="big-num" type="text" inputmode="numeric" autofocus placeholder="-7 / +5 / 20">`,
        buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => w.querySelector("input").value }],
        mount: (m, close) => m.querySelector("input").addEventListener("keydown", (ev) => { if (ev.key === "Enter") close(ev.target.value); }) });
      const s = String(v ?? "").trim().replace("−", "-");
      if (!s) return;
      if (/^[+-]\d+$/.test(s)) send({ t: "cb_hp", id: en.id, delta: MC.int(s) });
      else if (/^\d+$/.test(s)) send({ t: "cb_hp", id: en.id, value: MC.int(s) });
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches?.("[data-cbrules]")) { send({ t: "cb_rules", on: e.target.checked }); return; }
    const id = e.target.dataset?.cbinit;
    if (id) send({ t: "cb_set", id, fields: { init: e.target.value === "" ? null : MC.int(e.target.value) } });
  });

  async function addDialog() {
    const mons = MC.GM?.monsters || [];
    const v = await MC.modal({ title: t("cb.add"), body: `<div class="form-grid">
        <label class="field full"><span>${t("cb.add.mon")}</span><select name="mon"><option value="">— ${t("map.tok.custom")} —</option>${mons.map((m) => `<option value="${m.id}">${esc(m.name)} (${esc(m.cr)})</option>`).join("")}</select></label>
        <label class="field"><span>${t("map.name")}</span><input name="name" autofocus></label>
        <label class="field"><span>${t("st.init")}</span><input name="init" type="number" placeholder="${esc(t("cb.add.auto"))}"></label>
        <label class="field"><span>${t("map.tok.hp")}</span><input name="hp" type="number"></label>
        <label class="check full"><input type="checkbox" name="hidden"> ${t("map.tok.hidden")}</label></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("create"), kind: "primary", value: (w) => {
        const q = (n) => w.querySelector(`[name=${n}]`);
        const mon = mons.find((m) => m.id === q("mon").value);
        const hp = MC.int(q("hp").value, mon?.hp || 0);
        return { name: q("name").value.trim() || mon?.name || "?", init: q("init").value === "" ? null : MC.int(q("init").value),
          mon: mon?.id || "", hp: hp ? { cur: hp, max: hp } : null, ac: mon?.ac ?? null, hidden: q("hidden").checked, kind: "npc" };
      } }] });
    if (v) send({ t: "cb_add", entry: v, roll: v.init == null });
  }

  // ---------------------------------------------------------------- данные
  // ---------------------------------------------------------------- «Бой начался!» у игрока (15 секунд, можно закрыть)
  let wasActive = null, noticeTimer = 0;
  function myInitEntries() { return CB.state.list.filter((e) => mineEntry(e) && e.init == null); }
  function closeNotice() {
    clearTimeout(noticeTimer);
    const el = $("#cb-notice");
    if (!el) return;
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }
  function showNotice() {
    closeNotice();
    $("#cb-notice")?.remove();
    const mine = myInitEntries();
    const el = document.createElement("div");
    el.id = "cb-notice";
    el.className = "cb-notice glass";
    el.innerHTML = `<div class="cbn-ic">${MC.icon("attacks")}</div>
      <div class="cbn-text"><b>${t("cb.n.title")}</b><span class="muted small">${t(mine.length ? "cb.n.roll_hint" : "cb.n.hint")}</span></div>
      <div class="cbn-act">${mine.length ? mine.map((e) => `<button class="btn small primary" data-cbrollme="${e.id}" data-cbn="1">${MC.icon("d20", "sm")} ${mine.length > 1 ? esc(e.name) : t("cb.roll_init")}</button>`).join("")
    : `<button class="btn small" data-cbn="open">${MC.icon("attacks", "sm")} ${t("cb.n.open")}</button>`}</div>
      <button class="icon-btn small cbn-x" data-cbn="x">${MC.icon("x", "sm")}</button><i class="cbn-bar"></i>`;
    document.body.appendChild(el);
    try { navigator.vibrate?.([80, 60, 80]); } catch { /* ignore */ }
    noticeTimer = setTimeout(closeNotice, MC.reactMs(15000));
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cbn]");
    if (!b) return;
    if (b.dataset.cbn === "open") document.querySelector('[data-go="combat"]')?.click();
    setTimeout(closeNotice, 0);     // бросок инициативы обработает общий обработчик data-cbrollme
  });

  // ---------------------------------------------------------------- заметили спрятавшегося, спасбросок от смерти
  MC.on("msg_cb_events", (m) => {
    if (MC.pop) return;
    for (const ev of m.events || []) {
      if (ev.k === "grapple_free") MC.toast(t("rule.grapple_free", { who: ev.who }), "", "c-grappled");
      if (ev.k === "spotted") MC.toast(t("rule.spotted", { who: ev.who, tgt: ev.tgt }), "warn", "eye");
      if (ev.k === "death_save") MC.toast(`${ev.who}: ${t("cbl.death", { roll: ev.roll, ok: ev.ok, fail: ev.fail })}${ev.res ? " — " + t("cbl.death_" + ev.res) : ""}`, ev.res === "dead" ? "bad" : ev.res ? "ok" : "warn", "skull");
    }
  });

  // ---------------------------------------------------------------- мастеру: игрок хочет сделать больше положенного
  CB.decReason = (r) => {
    if (!r) return "";
    if (r.startsWith("atk:")) { const [, n, per] = r.split(":"); return t("dec.r.atk", { n, per }); }
    return t("dec.r." + r);
  };
  MC.on("msg_cb_events", (m) => {
    if (MC.pop) return;
    for (const ev of m.events || []) {
      if (ev.k === "act_no") MC.toast(t("dec.denied"), "bad", "x");
      if (ev.k !== "act_req" || !gm()) continue;
      const el = document.createElement("div");
      el.className = "cb-notice endreq glass";
      el.id = "dec-" + ev.id;
      el.innerHTML = `<div class="cbn-ic">${MC.icon("hourglass")}</div>
        <div class="cbn-text"><b>${t("dec.act_title", { who: esc(ev.who) })}</b><span class="muted small">${esc(CB.decReason(ev.reason))}${ev.what ? " · " + esc(ev.what) : ""}${ev.tgt ? " → " + esc(ev.tgt) : ""}</span></div>
        <div class="cbn-act"><button class="btn small primary" data-dec="ok" data-id="${ev.id}">${MC.icon("check", "sm")} ${t("dec.ok")}</button>
          <button class="btn small" data-dec="no" data-id="${ev.id}">${MC.icon("x", "sm")} ${t("dec.no")}</button></div>`;
      document.body.appendChild(el);
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-dec]");
    if (!b) return;
    const k = b.dataset.dec, id = b.dataset.id;
    document.getElementById("dec-" + id)?.remove();
    if (k === "undo" && !(await MC.confirm(t("dec.undo_q")))) return;
    if (k === "ok" || k === "no" || k === "undo") MC.request({ t: "dec_" + k, id }).catch((er) => MC.toast(t(er.code ? "err." + er.code : "conn.offline"), "warn"));
    if (k === "mok" || k === "mno") MC.send({ t: "tok_req", map: b.dataset.map, id: b.dataset.tok, ok: k === "mok" });
    if (k === "eok") send({ t: "cb_next" });
    if (k === "eno") send({ t: "cb_endno" });
  });

  // ---------------------------------------------------------------- мастеру: «игрок закончил ход»
  MC.on("msg_cb_events", (m) => {
    if (!gm() || MC.pop) return;
    const ev = (m.events || []).find((x) => x.k === "end_req");
    if (!ev) return;
    $("#cb-endpop")?.remove();
    const el = document.createElement("div");
    el.id = "cb-endpop";
    el.className = "cb-notice endreq glass";
    el.innerHTML = `<div class="cbn-ic">${MC.icon("hourglass")}</div>
      <div class="cbn-text"><b>${t("cb.end_req", { name: esc(ev.who) })}</b><span class="muted small">${t("cb.end_req_hint")}</span></div>
      <div class="cbn-act"><button class="btn small primary" data-cbgo="next" data-cbn="1">${MC.icon("check", "sm")} ${t("cb.end_ok")}</button>
        <button class="btn small" data-cbgo="endno" data-cbn="1">${MC.icon("x", "sm")} ${t("cb.end_no")}</button></div>`;
    document.body.appendChild(el);
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
  });
  document.addEventListener("click", (e) => { if (e.target.closest("#cb-endpop [data-cbn]")) setTimeout(() => $("#cb-endpop")?.remove(), 0); });

  MC.on("msg_combat", (m) => {
    const before = wasActive;
    CB.state = m.combat || CB.state;
    wasActive = !!CB.state.active;
    if (!CB.state.end_req) $("#cb-endpop")?.remove();
    if (!gm() && !MC.pop && before === false && CB.state.active) showNotice();
    if (!CB.state.active || (!myInitEntries().length && $("#cb-notice [data-cbrollme]"))) closeNotice();
    const cur = curEntry();
    if (cur && cur.id !== lastCur && mineEntry(cur)) {
      {   // важное — в окно по центру (или где настроено), само уходит
        const el = document.createElement("div");
        el.className = "cb-notice myturn glass";
        el.innerHTML = `<div class="cbn-ic">${MC.icon("crit")}</div><div class="cbn-text"><b>${t("cb.your_turn")}</b><span class="muted small">${esc(cur?.name || "")}</span></div>
          <div class="cbn-act"><button class="btn small" data-close-notice>${MC.icon("check", "sm")} ${t("ok")}</button></div><i class="cbn-bar"></i>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), MC.reactMs(4000));
      }
      try { navigator.vibrate?.([60, 40, 60]); } catch { /* ignore */ }
    }
    lastCur = cur?.id || null;
    CB.render(); renderStrip();
    MC.Map?.redraw?.();
    MC.emit("combat_changed");
  });
  CB.renderStrip = renderStrip;

  // ---------------------------------------------------------------- атака по возможности: предложение потратить реакцию
  MC.on("msg_cb_oa", (m) => {
    if (MC.pop) return;
    const en = CB.state.list.find((x) => x.id === m.src?.e);
    if (!en) return;
    const id = "cb-oa-" + en.id + "-" + (m.tgt?.token || "");
    document.getElementById(id)?.remove();
    const el = document.createElement("div");
    el.id = id;
    el.dataset.oaE = en.id;
    el.dataset.oaRound = String(CB.state.round || 0);
    el.className = "cb-notice oa glass";
    el.innerHTML = `<div class="cbn-ic">${CB.avatar(en.name, CB.entryPic(en), entryColor(en))}</div>
      <div class="cbn-text"><b>${t("rule.oa.title", { who: esc(m.who), tgt: esc(m.tgt_name) })}</b><span class="muted small">${t("rule.oa.hint")}</span></div>
      <div class="cbn-act"><button class="btn small primary" data-oa="go">${MC.icon("swords", "sm")} ${t("rule.oa.go")}</button>
        <button class="btn small" data-oa="x">${t("rule.oa.skip")}</button></div><i class="cbn-bar"></i>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    const timer = setTimeout(close, MC.reactMs(60000));      // сервер ждёт ответа 2 минуты
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-oa]");
      if (!b) return;
      clearTimeout(timer); close();
      if (b.dataset.oa !== "go") return;
      const tg = m.tgt_e ? CB.targetsFromCombat() : MC.Map.mapTargets();
      const key = m.tgt_e ? "e:" + m.tgt_e : "t:" + m.tgt.token;
      CB.actionDialog(CB.entrySrc(en), tg, { tgt: [key], cost: "r", oa: true });
    });
    try { navigator.vibrate?.([60, 40, 60]); } catch { /* ignore */ }
  });
  // предложение атаки по возможности уже не актуально: реакция потрачена, бой кончился, прошёл раунд
  MC.on("combat_changed", () => {
    for (const el of document.querySelectorAll(".cb-notice.oa[data-oa-e]")) {
      const en = CB.state.list.find((x) => x.id === el.dataset.oaE);
      if (!CB.state.active || !en || en.econ?.r || CB.state.cur === en.id) el.remove();
    }
  });
  // ---------------------------------------------------------------- правая кнопка по участнику боя
  const fireBtn = (attrs) => { const b = document.createElement("button"); b.hidden = true; Object.assign(b.dataset, attrs); document.body.appendChild(b); b.click(); b.remove(); };
  MC.ctxAdd(".cb-row[data-cb], [data-cbe]", (el) => {
    const en = CB.state.list.find((x) => x.id === (el.dataset.cb || el.dataset.cbe));
    if (!en) return null;
    const g = gm(), can = g || mineEntry(en);
    const seq = CB.state.list, i = seq.findIndex((x) => x.id === en.id);
    const tok = CB.specTok({ e: en.id });
    const items = [];
    if (can) items.push({ ic: "swords", label: t("ctx.action"), fn: () => CB.actionDialog(CB.entrySrc(en), CB.targetsFromCombat(), {}) });
    if (can) items.push({ ic: "sparkle", label: t("act.effect_add"), fn: () => effectDialog(en) });
    if (en.char && (g || mineEntry(en))) items.push({ ic: "character", label: t("ctx.sheet"), fn: () => MC.emit("open_sheet", { id: en.char }) });
    if (!en.char && en.mon && g) items.push({ ic: "book", label: t("cb.statblock"), fn: () => fireBtn({ cbsb: en.mon }) });
    if (tok) items.push({ ic: "locate", label: t("ctx.center"), fn: () => { MC.go?.("map"); setTimeout(() => { MC.Map.centerOn(tok.x, tok.y); MC.Map.select?.(tok.id); }, 80); } });
    if (g) {
      items.push({ sep: true });
      items.push({ ic: "init", label: t("ctx.cb.cur"), off: CB.state.cur === en.id, fn: () => send({ t: "cb_cur", id: en.id }) });
      items.push({ ic: "back", label: t("ctx.cb.up"), off: i <= 0, fn: () => send({ t: "cb_move", id: en.id, dir: "up" }) });
      items.push({ ic: "next", label: t("ctx.cb.down"), off: i >= seq.length - 1, fn: () => send({ t: "cb_move", id: en.id, dir: "down" }) });
      if (CB.state.cur && CB.state.cur !== en.id) items.push({ ic: "hourglass", label: t("ctx.cb.after"), fn: () => {
        const ci = seq.findIndex((x) => x.id === CB.state.cur);
        send({ t: "cb_move", id: en.id, to: i > ci ? ci + 1 : ci });
      } });
      items.push({ ic: "d20", label: t("ctx.cb.init"), fn: async () => {
        const v = await MC.askNumber(t("st.init"), String(en.init ?? ""));
        if (v != null && v !== "") send({ t: "cb_set", id: en.id, fields: { init: MC.int(v, 0) } });
      } });
      items.push({ sep: true });
      items.push({ ic: "heart", label: t("ctx.cb.hp"), fn: () => fireBtn({ cbhp: en.id }) });
      items.push({ ic: en.hidden ? "eye" : "hidden", label: t(en.hidden ? "ctx.show" : "ctx.hide"), fn: () => send({ t: "cb_set", id: en.id, fields: { hidden: !en.hidden } }) });
      items.push({ ic: "trash", label: t("ctx.cb.del"), bad: true, fn: async () => { if (await MC.confirm(t("ctx.cb.del_q", { name: en.name }))) send({ t: "cb_del", id: en.id }); } });
    }
    return items.length ? { items, title: en.name } : null;
  });
  MC.on("welcome", () => MC.send({ t: "cb_get" }));
  MC.on("chars", () => { if (CB.state.active) CB.render(); });
  MC.on("players", () => { CB.render(); renderStrip(); });
  MC.on("lang", () => { CB.render(); renderStrip(); });
  MC.on("tab", (tab) => { if (tab === "combat") CB.render(); });
})();
