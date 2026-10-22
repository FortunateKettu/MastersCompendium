// Masters Compendium — «Настройки» (шестерёнка в шапке): всё, что раньше было разбросано по вкладкам, в одном месте.
//  • общее: язык, меньше анимаций, вибрация;
//  • кубики: 3D, звук, чьи кубики показывать, итоги бросков в уведомлениях;
//  • уведомления: сколько держать;
//  • карта: имена фишек, эффекты, погода, окна справа;
//  • мастеру — настройки кампании: правила боя, перемещение фишек, уровни, мир.
// Личные настройки хранятся в этом браузере, настройки кампании — на сервере (их меняет только мастер).
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const ST = (MC.Settings = {});
  const gm = () => MC.isGM();
  const get = (k, d) => { const v = MC.store.get("opt_" + k); return v == null ? d : v; };
  const set = (k, v) => MC.store.set("opt_" + k, String(v));

  // ---------------------------------------------------------------- применить личные настройки при запуске
  function apply() {
    document.body.classList.toggle("reduce-motion", get("motion", "1") === "0");
    if (get("vibrate", "1") === "0") { try { navigator.vibrate = () => false; } catch { /* ignore */ } }
  }
  apply();

  const chk = (key, on, label, hint = "", extra = "") => `<label class="opt-row"><span class="opt-l"><b>${label}</b>${hint ? `<small class="muted">${hint}</small>` : ""}</span>
    <input type="checkbox" class="switch" data-opt="${key}" ${on ? "checked" : ""} ${extra}></label>`;
  const rng = (key, val, label) => `<label class="opt-row"><span class="opt-l"><b>${label}</b></span>
    <input type="range" min="0" max="1" step="0.05" data-opt="${key}" value="${esc(val)}"></label>`;
  const sel = (key, val, label, opts, hint = "") => `<label class="opt-row"><span class="opt-l"><b>${label}</b>${hint ? `<small class="muted">${hint}</small>` : ""}</span>
    <select data-opt="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;

  function body(tab) {
    const D = MC.Dice?.opts || {};
    const M = MC.Map || {};
    const muted = (() => { try { return JSON.parse(get("dice_mute", "[]")); } catch { return []; } })();
    const players = MC.state.players.filter((p) => p.id !== MC.state.me?.id);
    const tabs = [["general", "settings", "opt.t.general"], ["dice", "d20", "opt.t.dice"], ["sound", "volume", "opt.t.sound"], ["notify", "alert", "opt.t.notify"], ["map", "map", "opt.t.map"],
      ...(gm() ? [["campaign", "crown", "opt.t.campaign"]] : [])];
    let h = `<div class="chips opt-tabs">${tabs.map(([k, ic, l]) => `<button class="chip ${tab === k ? "on" : ""}" data-optab="${k}">${MC.icon(ic, "sm")} ${t(l)}</button>`).join("")}</div><div class="opt-body">`;
    if (tab === "general") {
      h += sel("lang", MC.lang, t("opt.lang"), [["ru", "Русский"], ["en", "English"]])
        + chk("motion", get("motion", "1") !== "0", t("opt.motion"), t("opt.motion_d"))
        + chk("vibrate", get("vibrate", "1") !== "0", t("opt.vibrate"), t("opt.vibrate_d"));
    }
    if (tab === "dice") {
      h += chk("d3_on", D.on, t("dice.3d"), t("opt.d3_d"))
        + sel("d3_size", get("d3_size", "1"), t("opt.d3_size"), [["0.7", t("opt.sz.s")], ["1", t("opt.sz.m")], ["1.3", t("opt.sz.l")], ["1.6", t("opt.sz.xl")]], t("opt.d3_size_d"))
        + chk("d3_sound", D.sound, t("dice.sound"), "", D.on ? "" : "disabled")
        + rng("d3_vol", get("d3_vol", "0.6"), t("opt.d3_vol"))
        + chk("d3_others", D.others, t("opt.d3_others"), t("opt.d3_others_d"), D.on ? "" : "disabled")
        + (players.length ? `<div class="opt-sub"><b>${t("opt.d3_whose")}</b><div class="opt-players">${players.map((p) => `<label class="check"><input type="checkbox" data-optmute="${esc(p.id)}" ${muted.includes(p.id) ? "" : "checked"}>
            <i class="opt-dot" style="background:${esc(p.color || "#888")}"></i>${esc(p.name)}</label>`).join("")}
            ${MC.state.me?.id !== "gm" ? `<label class="check"><input type="checkbox" data-optmute="gm" ${muted.includes("gm") ? "" : "checked"}><i class="opt-dot" style="background:#f5c542"></i>${t("ds.gm_name")}</label>` : ""}</div>
            <small class="muted">${t("opt.d3_whose_d")}</small></div>` : "")
        + sel("rollcards", get("rollcards", "all"), t("opt.rollcards"), [["all", t("opt.rc.all")], ["mine", t("opt.rc.mine")], ["off", t("opt.rc.off")]], t("opt.rollcards_d"));
    }
    if (tab === "sound") {
      h += chk("sfx", get("sfx", "1") !== "0", t("opt.sfx"), t("opt.sfx_d")) + rng("sfx_vol", get("sfx_vol", "0.5"), t("opt.sfx_vol"))
        + `<div class="row-btns opt-test">${["melee", "ranged", "spell", "heal"].map((k) => `<button type="button" class="btn small" data-sfxtest="${k}">${MC.icon("play", "sm")} ${t("opt.sfx." + k)}</button>`).join("")}</div>`
        + `<h4 class="opt-h">${t("opt.au_gm_h")}</h4>`
        + (gm() ? `<p class="muted small">${t("opt.au_gm")}</p>` : chk("au_on", MC.store.get("opt_au_on") !== "0", t("opt.au_on"), t("opt.au_on_d")))
        + `<label class="opt-row"><span class="opt-l"><b>${t("opt.au_vol")}</b></span>
          <input type="range" min="0" max="1" step="0.05" data-opt="au_vol" value="${esc(MC.store.get("opt_au_vol") || "0.8")}" ${gm() ? "disabled" : ""}></label>`;
    }
    if (tab === "notify") {
      h += sel("notify_pos", get("notify_pos", "tr"), t("opt.notify_pos"), ["tr", "tl", "tc", "br", "bl"].map((k) => [k, t("opt.pos." + k)]), t("opt.notify_pos_d"))
        + (sel("imp_pos", get("imp_pos", "center"), t("opt.imp_pos"), ["center", "left", "bottom", "list"].map((k) => [k, t("opt.imp." + k)]), t("opt.imp_pos_d")))
        + sel("toast_ms", get("toast_ms", "normal"), t("opt.toast_ms"), [["short", t("opt.ms.short")], ["normal", t("opt.ms.normal")], ["long", t("opt.ms.long")]], t("opt.toast_ms_d"))
        + `<div class="row-btns"><button type="button" class="btn small" data-opttest="1">${MC.icon("alert", "sm")} ${t("opt.notify_test")}</button></div>`
        + `<p class="muted small">${t("opt.notify_d")}</p>`;
    }
    if (tab === "map") {
      h += sel("names", get("names", "always"), t("opt.names"), [["always", t("opt.names.always")], ["hover", t("opt.names.hover")]], t("opt.names_d"))
        + chk("mfx_hover", M.fx?.hover !== false, t("mfx.hover")) + chk("mfx_move", M.fx?.move !== false, t("mfx.move"))
        + chk("mfx_conds", M.fx?.conds !== false, t("mfx.conds")) + chk("mfx_reach", M.fx?.reach !== false, t("mfx.reach"))
        + chk("wxfx", get("wxfx", "1") !== "0", t("opt.wxfx"), t("opt.wxfx_d"))
        + chk("dock_combat", !!M.dock?.combat, t("mp.dock_combat")) + chk("dock_log", !!M.dock?.log, t("mp.dock_log"));
    }
    if (tab === "campaign" && gm()) {
      const cb = MC.Combat?.state || {};
      const w = MC.World?.w || {};
      h += `<p class="muted small">${t("opt.camp_d")}</p>`
        + chk("c_rules", cb.rules !== false, t("rule.toggle"), t("rule.toggle.d"))
        + sel("c_move", M.mode || "own", t("opt.move"), [["own", t("map.mode.own")], ["approve", t("map.mode.approve")], ["gm", t("map.mode.gm")]])
        + chk("c_limit", !!M.limit, t("map.mode.limit"))
        + sel("c_lvl", MC.Xp?.mode || "xp", t("xp.mode"), ["xp", "milestone", "free"].map((k) => [k, t("xp.mode." + k)]), t("xp.mode." + (MC.Xp?.mode || "xp") + ".d"))
        + chk("c_supplies", !!w.supplies, t("sup.on"))
        + chk("c_ammo", w.ammo !== false, t("sup.ammo_on"), t("sup.ammo_on_d"), w.supplies ? "" : "disabled")
        + chk("c_autowx", !!w.auto_weather, t("wx.auto"))
        + chk("c_wxfx", !!w.weather_fx, t("wx.fx"));
    }
    return h + "</div>";
  }

  ST.open = async (tab = "general") => {
    let cur = tab;
    await MC.modal({ title: t("opt.title"), wide: true, body: `<div id="opt-root">${body(cur)}</div>`,
      buttons: [{ label: t("close"), kind: "primary", value: null }],
      mount: (m) => {
        const root = m.querySelector("#opt-root");
        const re = () => { root.innerHTML = body(cur); };
        m.addEventListener("click", (e) => { const b = e.target.closest("[data-optab]"); if (b) { cur = b.dataset.optab; re(); } });
        m.addEventListener("input", (e) => { if (["au_vol", "d3_vol", "sfx_vol"].includes(e.target.dataset.opt)) change(e.target.dataset.opt, e.target.value); });
        m.addEventListener("click", (e) => {
          const b = e.target.closest("[data-sfxtest]"); if (b) MC.Audio?.testSfx(b.dataset.sfxtest);
          if (e.target.closest("[data-opttest]")) {
            MC.toast(t("opt.notify_sample"), "", "info");
            if (!gm()) {
              const el = document.createElement("div"); el.className = "cb-notice oa glass";
              el.innerHTML = `<div class="cbn-ic">${MC.icon("swords")}</div><div class="cbn-text"><b>${t("opt.imp_sample")}</b><span class="muted small">${t("opt.imp_drag")}</span></div>
                <div class="cbn-act"><button class="btn small" data-close-notice>${MC.icon("x", "sm")}</button></div>`;
              document.body.appendChild(el); setTimeout(() => el.remove(), 8000);
            }
          }
        });
        m.addEventListener("change", (e) => {
          const mu = e.target.closest("[data-optmute]");
          if (mu) {
            let list; try { list = JSON.parse(get("dice_mute", "[]")); } catch { list = []; }
            list = list.filter((x) => x !== mu.dataset.optmute);
            if (!mu.checked) list.push(mu.dataset.optmute);
            set("dice_mute", JSON.stringify(list));
            return;
          }
          const el = e.target.closest("[data-opt]");
          if (!el) return;
          const k = el.dataset.opt, v = el.type === "checkbox" ? el.checked : el.value;
          change(k, v);
          if (["d3_on", "lang", "c_lvl"].includes(k)) setTimeout(re, 60);
        });
      } });
  };

  function change(k, v) {
    const M = MC.Map;
    if (k === "lang") { MC.setLang(v); return; }
    if (k === "motion") { set("motion", v ? "1" : "0"); apply(); return; }
    if (k === "vibrate") { set("vibrate", v ? "1" : "0"); if (v) MC.toast(t("opt.reload_hint"), "", "refresh"); apply(); return; }
    if (k === "d3_size" || k === "d3_vol" || k === "sfx_vol") { set(k, v); return; }
    if (k === "sfx") { set("sfx", v ? "1" : "0"); return; }
    if (k.startsWith("d3_")) { MC.Dice?.setOpt(k.slice(3), !!v); MC.Dice?.renderTab?.(); return; }
    if (k === "rollcards" || k === "toast_ms") { set(k, v); return; }
    if (k === "notify_pos") { set(k, v); MC.notifyBox(); return; }
    if (k === "imp_pos") { set(k, v); MC.store.del("opt_imp_xy"); MC.impPlace(); return; }
    if (k === "au_on") { set("au_on", v ? "1" : "0"); MC.Audio?.refresh(); return; }
    if (k === "au_vol") { set("au_vol", v); MC.Audio?.refresh(); return; }
    if (k === "names") { set("names", v); if (M) { M.fx.names = v; M.redraw?.(); } return; }
    if (k.startsWith("mfx_")) {
      const f = k.slice(4);
      MC.store.set(k, v ? "1" : "0");
      if (M?.fx) { M.fx[f] = !!v; M.redraw?.(); }
      return;
    }
    if (k === "wxfx") { set("wxfx", v ? "1" : "0"); MC.World?.refreshFx?.(); return; }
    if (k === "dock_combat" || k === "dock_log") { M?.setDock?.(k.slice(5), !!v); return; }
    // кампания — на сервер
    const req = (o) => MC.request(o).catch((e) => MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"));
    if (k === "c_rules") req({ t: "cb_rules", on: !!v });
    if (k === "c_move") req({ t: "map_mode", mode: v });
    if (k === "c_limit") req({ t: "map_mode", limit: !!v });
    if (k === "c_lvl") req({ t: "cfg_set", lvl_mode: v });
    if (k === "c_supplies") req({ t: "w_set", supplies: !!v });
    if (k === "c_ammo") req({ t: "w_set", ammo: !!v });
    if (k === "c_autowx") req({ t: "w_set", auto_weather: !!v });
    if (k === "c_wxfx") req({ t: "w_set", weather_fx: !!v });
  }

  // ---------------------------------------------------------------- шестерёнка в шапке
  function addBtn() {
    const host = document.querySelector("#scr-game .head-right");
    if (!host || host.querySelector("#btn-opts")) return;
    const b = document.createElement("button");
    b.id = "btn-opts";
    b.className = "icon-btn head-opts";
    b.title = t("opt.title");
    b.innerHTML = MC.icon("settings");
    b.addEventListener("click", () => ST.open());
    host.insertBefore(b, host.querySelector("[data-lang-toggle]"));
  }
  addBtn();
  MC.on("welcome", addBtn);
  MC.on("lang", () => { const b = $("#btn-opts"); if (b) b.title = t("opt.title"); });
})();
