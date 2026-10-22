// Masters Compendium — журнал действий игроков (раздел «Мастер → Журнал»).
// Что делал каждый игрок: правки листа, перемещения, бой, броски, торговля. Фильтр по игроку и виду,
// поиск, и кнопка «Откатить» — вернуть как было (лист, место фишки, хиты целей).
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const L = (MC.ActLog = { list: [], loaded: false, who: "", kind: "", q: "", unread: 0 });
  const gm = () => MC.isGM();
  const KINDS = [["", "al.k.all", "history"], ["sheet", "al.k.sheet", "character"], ["move", "al.k.move", "move"], ["combat", "al.k.combat", "swords"],
    ["roll", "al.k.roll", "d20"], ["trade", "al.k.trade", "coins"]];
  const IC = Object.fromEntries(KINDS.map(([k, , ic]) => [k, ic]));

  const tm = (ts) => {
    const d = new Date(ts * 1000), now = new Date();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${hm}`;
  };
  function rows() {
    const q = L.q.trim().toLowerCase();
    return L.list.filter((e) => (!L.who || e.pid === L.who) && (!L.kind || e.kind === L.kind) && (!q || (e.text + " " + e.who).toLowerCase().includes(q)))
      .slice().reverse().slice(0, 300);
  }
  function html() {
    const players = [...new Map(L.list.map((e) => [e.pid, { id: e.pid, name: e.who, color: e.color }])).values()];
    MC.state.players.forEach((p) => { if (!players.some((x) => x.id === p.id)) players.push({ id: p.id, name: p.name, color: p.color }); });
    const list = rows();
    return `<div class="card glass al-box">
      <div class="al-top"><select id="al-who"><option value="">${t("al.all_players")}</option>${players.map((p) => `<option value="${esc(p.id)}" ${L.who === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <input type="search" id="al-q" value="${esc(L.q)}" placeholder="${esc(t("search"))}">
        <button class="icon-btn small" data-al="refresh" title="${esc(t("al.refresh"))}">${MC.icon("refresh", "sm")}</button>
        <button class="icon-btn small" data-al="clear" title="${esc(t("al.clear"))}">${MC.icon("trash", "sm")}</button></div>
      <div class="chips al-kinds">${KINDS.map(([k, l, ic]) => `<button class="chip ${L.kind === k ? "on" : ""}" data-alk="${k}">${MC.icon(ic, "sm")} ${t(l)}</button>`).join("")}</div>
      <p class="muted small">${t("al.hint")}</p>
      <ul class="al-list">${list.map((e) => `<li class="al-row st-${esc(e.state)}" data-alid="${esc(e.id)}">
          <span class="al-ic" style="--c:${esc(e.color || "#888")}">${MC.icon(IC[e.kind] || "history", "sm")}</span>
          <div class="al-main"><div class="al-h"><b>${esc(e.who)}</b><span class="muted small">${tm(e.ts)}${e.n > 1 ? ` · ×${e.n}` : ""}</span>${e.state === "undone" ? `<span class="tag">${t("al.undone")}</span>` : ""}</div>
            <div class="al-t">${esc(e.text)}</div></div>
          ${e.can_undo ? `<button class="btn small" data-alundo="${esc(e.id)}" title="${esc(t("al.undo_d"))}">${MC.icon("undo", "sm")} ${t("al.undo")}</button>` : ""}</li>`).join("")
        || `<li class="muted small center">${t(L.loaded ? "al.empty" : "al.loading")}</li>`}</ul></div>`;
  }
  function render() {
    const box = $("#gm-sub-actlog");
    if (!box) return;
    const ae = document.activeElement;
    const keep = ae && ae.id === "al-q" ? ae.selectionStart : null;
    box.innerHTML = html();
    if (keep != null) { const q = $("#al-q"); q.focus(); q.setSelectionRange(keep, keep); }
  }
  async function load() {
    try { const r = await MC.request({ t: "actlog_get" }); L.list = r.list || []; L.loaded = true; } catch { /* ignore */ }
    render();
  }
  MC.GM?.addSub({ id: "actlog", ic: "history", label: "al.tab", html: () => `<div id="gm-sub-actlog">${html()}</div>`, mount: () => { L.unread = 0; load(); } });

  document.addEventListener("click", async (e) => {
    if (!gm()) return;
    const k = e.target.closest("[data-alk]");
    if (k) { L.kind = k.dataset.alk; render(); return; }
    const u = e.target.closest("[data-alundo]");
    if (u) {
      const en = L.list.find((x) => x.id === u.dataset.alundo);
      if (!en || !(await MC.confirm(t("al.undo_q", { text: en.text.slice(0, 120) })))) return;
      try { await MC.request({ t: "actlog_undo", id: en.id }); MC.toast(t("al.undone_ok"), "ok", "undo"); }
      catch (er) { MC.toast(t(er.code ? "err." + er.code : "conn.offline"), "warn"); }
      return;
    }
    const b = e.target.closest("[data-al]");
    if (!b) return;
    if (b.dataset.al === "refresh") load();
    if (b.dataset.al === "clear" && await MC.confirm(t("al.clear_q"))) { try { await MC.request({ t: "actlog_clear" }); L.list = []; render(); } catch { /* ignore */ } }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "al-who") { L.who = e.target.value; render(); } });
  document.addEventListener("input", (e) => { if (e.target.id === "al-q") { L.q = e.target.value; render(); } });
  MC.on("msg_actlog_new", (m) => {
    if (!m.e) return;
    const i = L.list.findIndex((x) => x.id === m.e.id);
    if (i >= 0) L.list[i] = m.e; else L.list.push(m.e);
    if (L.list.length > 500) L.list.splice(0, L.list.length - 500);
    if ($("#gm-sub-actlog") && !document.activeElement?.closest?.(".al-box select")) render();
  });
  MC.on("welcome", () => { L.loaded = false; L.list = []; if (gm()) load(); });
})();
