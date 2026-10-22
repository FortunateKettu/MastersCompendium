// Masters Compendium — опыт и уровни.
//  • в листе: полоска опыта до следующего уровня, «+ опыт», кнопка «Повысить уровень», когда можно;
//  • режим кампании: по опыту (D&D 5e), вехи (мастер разрешает повышение) или свободно;
//  • мастер выдаёт опыт персонажам («Партия» → «Выдать опыт»), после боя программа сама предлагает
//    раздать опыт за побеждённых монстров.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const X = (MC.Xp = { mode: "xp" });
  // опыт, нужный для уровня N (индекс N-1)
  X.TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
  const R = () => MC.R;
  const gm = () => MC.isGM();

  X.info = (doc) => {
    const lvl = R().level(doc), xp = Math.max(0, MC.int(doc.xp, 0));
    const prev = X.TABLE[Math.min(lvl, 20) - 1] || 0, next = lvl >= 20 ? null : X.TABLE[lvl];
    const byXp = X.TABLE.filter((v) => xp >= v).length;      // уровень, положенный по опыту
    return { lvl, xp, prev, next, byXp, ok: MC.int(doc.lvl_ok, 0) };
  };
  /** Можно ли повысить уровень сейчас. Игрок — только с разрешения мастера (кроме режима «Свободно»); мастер — всегда. */
  X.canLevel = (doc) => {
    const i = X.info(doc);
    if (i.lvl >= 20) return false;
    if (X.mode === "free") return true;
    if (gm()) return X.mode === "milestone" ? i.ok > 0 : i.byXp > i.lvl || i.ok > 0;
    return i.ok > 0;
  };
  /** Опыта по таблице хватает, но мастер ещё не разрешил. */
  X.waiting = (doc) => { const i = X.info(doc); return X.mode === "xp" && i.lvl < 20 && i.byXp > i.lvl && i.ok <= 0; };
  X.why = (doc) => {
    const i = X.info(doc);
    if (i.lvl >= 20) return t("xp.max");
    if (X.mode === "milestone") return t("xp.need_gm");
    if (i.byXp > i.lvl) return t("xp.wait_gm");
    return t("xp.need", { n: (i.next - i.xp).toLocaleString() });
  };
  /** Мастер разрешает повышение уровня. */
  X.allow = async (id) => {
    try { await MC.request({ t: "xp_award", chars: [id], each: 0, lvl: true }); } catch (e) { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); }
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-xpallow]");
    if (!b || !gm()) return;
    document.getElementById("xpn-" + b.dataset.xpallow)?.remove();
    X.allow(b.dataset.xpallow);
  });
  function gmLevelNotice(d) {
    if (!gm() || MC.pop || !d || document.getElementById("xpn-" + d.id)) return;
    const el = document.createElement("div");
    el.className = "cb-notice endreq glass";
    el.id = "xpn-" + d.id;
    el.innerHTML = `<div class="cbn-ic">${MC.icon("level-up")}</div>
      <div class="cbn-text"><b>${t("xp.gm_ready", { name: esc(d.name) })}</b><span class="muted small">${t("xp.gm_ready_d", { n: X.info(d).byXp })}</span></div>
      <div class="cbn-act"><button class="btn small primary" data-xpallow="${d.id}">${MC.icon("check", "sm")} ${t("xp.allow")}</button>
        <button class="btn small" data-close-notice>${MC.icon("x", "sm")}</button></div>`;
    document.body.appendChild(el);
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-close-notice]"); if (b) b.closest(".cb-notice")?.remove(); });
  X.gmLevelNotice = gmLevelNotice;

  X.headerHtml = (doc) => {
    const i = X.info(doc);
    const mine = gm() || doc.owner === MC.state.me?.id;
    const can = X.canLevel(doc);
    const pct = i.next ? MC.clamp((i.xp - i.prev) / (i.next - i.prev) * 100, 0, 100) : 100;
    const txt = X.mode !== "free" && i.ok > 0 ? t("xp.ms_ready", { n: i.ok }) : X.mode === "milestone" ? t("xp.ms")
      : i.next ? t("xp.of", { xp: i.xp.toLocaleString(), next: i.next.toLocaleString(), lvl: i.lvl + 1 }) : t("xp.max_xp", { xp: i.xp.toLocaleString() });
    return `<div class="sh-xp ${can ? "ready" : ""}">
      <span class="sh-lvl" title="${esc(t("mp.level"))}">${MC.icon("level-up", "sm")} ${i.lvl}</span>
      <div class="sh-xp-bar" title="${esc(txt)}">${X.mode !== "milestone" ? `<i style="width:${pct}%"></i>` : ""}<span>${esc(txt)}</span></div>
      ${(gm() || X.mode === "free") && X.mode !== "milestone" ? `<button class="icon-btn small" data-act="xp-add" title="${esc(t("xp.add"))}">${MC.icon("plus", "sm")}</button>` : ""}
      ${gm() && doc.owner && MC.state.players.some((p) => p.id === doc.owner) && X.mode !== "free" && i.ok <= 0 && i.lvl < 20 ? `<button class="btn small ${X.waiting(doc) ? "primary" : ""}" data-xpallow="${doc.id}" title="${esc(t("xp.allow_d"))}">${MC.icon("check", "sm")} ${t("xp.allow")}</button>` : ""}
      ${mine && can ? `<button class="btn small primary sh-lvlup" data-act="lvl-go">${MC.icon("level-up", "sm")} ${t("sh.levelup")}</button>` : ""}
      ${!gm() && mine && !can && X.waiting(doc) ? `<span class="muted small sh-wait">${t("xp.wait_gm")}</span>` : ""}
    </div>`;
  };

  // ---------------------------------------------------------------- мастер: выдать опыт
  X.award = async (pre = {}) => {
    const chars = [...MC.state.chars.values()];
    const pids = new Set(MC.state.players.map((p) => p.id));
    if (!chars.length) { MC.toast(t("give.no_chars"), "warn"); return; }
    const sel = new Set(pre.pcs?.length ? pre.pcs : chars.filter((c) => pids.has(c.owner)).map((c) => c.id));
    const ms = X.mode === "milestone";
    const v = await MC.modal({ title: t("xp.award"), wide: true, body: `
        ${pre.defeated?.length ? `<p class="muted small">${t("xp.defeated", { list: esc(pre.defeated.join(", ")) })}</p>` : ""}
        <h4>${t("give.to")}</h4>
        <div class="give-chars">${chars.map((c) => `<label class="check"><input type="checkbox" name="xc" value="${c.id}" ${sel.has(c.id) ? "checked" : ""}> <b>${esc(c.name)}</b>
          <span class="muted small">${pids.has(c.owner) ? esc(MC.state.players.find((p) => p.id === c.owner)?.name || "") : t("chars.npc")}</span></label>`).join("")}</div>
        <div class="form-grid">
          <label class="field"><span>${t("xp.amount")}</span><input name="amt" type="number" value="${MC.int(pre.xp, 0) || ""}" placeholder="300"></label>
          <label class="field"><span>${t("xp.how")}</span><select name="how"><option value="split" ${pre.xp ? "selected" : ""}>${t("xp.split")}</option><option value="each" ${pre.xp ? "" : "selected"}>${t("xp.each")}</option></select></label>
          <label class="field full"><span>${t("xp.reason")}</span><input name="why" value="${esc(pre.reason || "")}" placeholder="${esc(t("xp.reason_ph"))}"></label></div>
        <p class="muted small" id="xp-prev"></p>
        ${ms ? `<label class="check"><input type="checkbox" name="lvl" checked> ${t("xp.grant_lvl")}</label>` : `<label class="check"><input type="checkbox" name="lvl"> ${t("xp.grant_lvl_xp")}</label>`}`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("xp.go"), kind: "primary", value: (w) => ({
        ids: [...w.querySelectorAll("[name=xc]:checked")].map((x) => x.value), amt: MC.int(w.querySelector("[name=amt]").value, 0),
        how: w.querySelector("[name=how]").value, why: w.querySelector("[name=why]").value.trim(), lvl: !!w.querySelector("[name=lvl]")?.checked }) }],
      mount: (m) => {
        const upd = () => {
          const n = m.querySelectorAll("[name=xc]:checked").length, a = MC.int(m.querySelector("[name=amt]").value, 0);
          const each = m.querySelector("[name=how]").value === "split" ? Math.floor(a / Math.max(1, n)) : a;
          m.querySelector("#xp-prev").textContent = n && a ? t("xp.preview", { n, each }) : "";
        };
        m.addEventListener("input", upd); m.addEventListener("change", upd); upd();
      } });
    if (!v || !v.ids.length || (!v.amt && !v.lvl)) return;
    const each = v.how === "split" ? Math.floor(v.amt / v.ids.length) : v.amt;
    try { await MC.request({ t: "xp_award", chars: v.ids, each, lvl: v.lvl, reason: v.why }); } catch (e) { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); }
  };

  // ---------------------------------------------------------------- «Партия»: опыт и режим уровней (мастеру)
  function renderGmBox() {
    const box = $("#xp-gm");
    if (!box) return;
    box.hidden = !gm();
    if (!gm()) return;
    box.innerHTML = `<div class="card glass xp-gm"><div class="xp-gm-row">
        <button class="btn small primary" data-xpgm="award">${MC.icon("level-up", "sm")} ${t("xp.award")}</button>
        <label class="xp-mode"><span class="muted small">${t("xp.mode")}</span><select data-xpgm="mode">${["xp", "milestone", "free"].map((k) => `<option value="${k}" ${X.mode === k ? "selected" : ""}>${t("xp.mode." + k)}</option>`).join("")}</select></label></div>
      <p class="muted small">${t("xp.mode." + X.mode + ".d")}</p></div>`;
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-xpgm=award]")) X.award(); });
  document.addEventListener("change", (e) => {
    const s = e.target.closest("[data-xpgm=mode]");
    if (s) MC.request({ t: "cfg_set", lvl_mode: s.value }).catch(() => {});
  });

  // ---------------------------------------------------------------- сообщения
  MC.on("msg_camp_cfg", (m) => { X.mode = m.lvl_mode || "xp"; renderGmBox(); if (MC.Sheet?.cur?.id) MC.Sheet.render(); });
  MC.on("msg_cb_xp", (m) => {
    if (!gm() || MC.pop || !m.pcs?.length) return;
    X.award({ xp: m.xp, pcs: m.pcs, defeated: m.defeated, reason: m.defeated?.length ? t("xp.win_reason", { list: m.defeated.slice(0, 4).join(", ") }) : "" });
  });
  MC.on("msg_xp_note", (m) => {
    if (gm()) {
      if (m.each) MC.toast(t("xp.given", { n: (m.names || []).length }), "ok", "level-up");
      else if (m.lvl) MC.toast(t("xp.allowed", { names: (m.names || []).join(", ") }), "ok", "level-up");
      // кому опыта уже хватает на новый уровень — предложить разрешить
      if (m.each > 0 && X.mode === "xp" && !m.lvl) for (const id of m.ids || []) {
        MC.request({ t: "char_get", id }).then((r) => { if (r?.char && X.waiting(r.char) && MC.state.players.some((p) => p.id === r.char.owner)) gmLevelNotice(r.char); }).catch(() => {});
      }
      return;
    }
    const me = MC.state.me?.id;
    const mine = (m.ids || []).filter((id) => MC.state.chars.get(id)?.owner === me);
    if (!mine.length) return;
    if (m.each) MC.toast(`${m.each > 0 ? "+" : ""}${m.each} ${t("xp.short")}${m.reason ? " · " + m.reason : ""}`, "ok", "level-up");
    setTimeout(() => {
      for (const id of mine) {
        const d = MC.state.docs.get(id);
        if (d && X.canLevel(d)) MC.toast(t("xp.can_level", { name: d.name }), "ok", "level-up");
      }
    }, 600);
  });
  MC.on("welcome", () => { MC.send({ t: "cfg_get" }); renderGmBox(); });
  MC.on("lang", renderGmBox);
})();
