// Masters Compendium — заметки игрока (вкладка «Партия»): свои записи, можно привязать к НИП или противнику —
// тем, кого видели в диалогах, НИП-персонажам и фишкам на карте. Видит только сам игрок.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const N = (MC.Notes = { list: [] });
  const gm = () => MC.isGM();
  let filter = "";

  const av = (a) => (a ? `<span class="sc-av sm" style="--c:${esc(a.color || "#94a3b8")}">${esc((a.name || "?").charAt(0).toUpperCase())}${a.img ? `<img src="${esc(a.img)}" alt="" onerror="this.remove()">` : ""}</span>`
    : `<span class="sc-av sm" style="--c:#475569">${MC.icon("pen", "sm")}</span>`);

  /** О ком можно писать: из диалогов, НИП-персонажи, чужие фишки на карте (без повторов по имени). */
  function subjects() {
    const out = [], seen = new Set();
    const add = (x) => { const k = (x.name || "").toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(x); };
    (MC.Scene?.met || []).forEach(add);
    (MC.Scene?.members || []).filter((m) => m.side !== "pc").forEach((m) => add({ key: m.key, name: m.name, img: m.img && !m.img.startsWith("data:") ? m.img : "", color: m.color }));
    const pids = new Set(MC.state.players.map((p) => p.id));
    for (const c of MC.state.chars.values()) if (!pids.has(c.owner)) add({ key: "c:" + c.id, name: c.name, img: "", color: "#f5c542" });
    for (const x of MC.Map?.map?.tokens || []) if (!x.char && !x.hidden) add({ key: "t:" + x.id, name: x.name, img: x.img ? "/asset/" + x.img : "", color: x.color || "#ef4444" });
    return out;
  }

  function html() {
    const q = filter.toLowerCase();
    const list = N.list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .filter((n) => !q || (n.title + " " + n.text + " " + (n.about?.name || "")).toLowerCase().includes(q));
    return `<h2 class="section with-act">${MC.icon("pen", "sm")} ${t("pn.title")}<button class="btn small primary" data-pn="new">${MC.icon("plus", "sm")} ${t("pn.new")}</button></h2>
      ${N.list.length > 4 ? `<div class="search-bar"><input type="search" id="pn-q" value="${esc(filter)}" placeholder="${esc(t("search"))}"></div>` : ""}
      <ul class="pn-list">${list.map((n) => `<li class="pn-row" data-pnid="${n.id}">${av(n.about)}
        <div class="pn-i"><b>${esc(n.about?.name || n.title || t("pn.untitled"))}</b>${n.about && n.title ? `<span class="small">${esc(n.title)}</span>` : ""}
          <span class="muted small">${esc((n.text || "").slice(0, 120))}</span></div></li>`).join("")
      || `<li class="muted small">${t("pn.empty")}</li>`}</ul>`;
  }
  function render() {
    const box = $("#pnotes");
    if (!box) return;
    box.hidden = gm();
    if (gm()) return;
    const ae = document.activeElement;
    if (ae?.id === "pn-q") return;
    box.innerHTML = html();
  }

  N.edit = async (note, about) => {
    const isNew = !note;
    note = note || { title: "", text: "", about: about ? { key: about.key, name: about.name, img: about.img && !about.img.startsWith("data:") ? about.img : "", color: about.color } : null };
    if (isNew && about) {
      // уже есть заметка о нём — открываем её
      const was = N.list.find((x) => x.about && (x.about.key === about.key || x.about.name === about.name));
      if (was) note = was;
    }
    const subs = subjects();
    let ab = note.about;
    const v = await MC.modal({ title: note.id ? t("pn.edit") : t("pn.new"), wide: true, body: `<div class="form-grid">
        <label class="field full"><span>${t("pn.about")}</span><select name="about"><option value="">— ${t("pn.nobody")} —</option>
          ${(ab && !subs.some((s) => s.name === ab.name) ? [ab, ...subs] : subs).map((s, i) => `<option value="${i}" ${ab && s.name === ab.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        <label class="field full"><span>${t("pn.ttl")}</span><input name="title" value="${esc(note.title || "")}" placeholder="${esc(t("pn.ttl_ph"))}" maxlength="80"></label>
        <label class="field full"><span>${t("pn.text")}</span><textarea name="text" rows="8" placeholder="${esc(t("pn.text_ph"))}">${esc(note.text || "")}</textarea></label></div>`,
      buttons: [...(note.id ? [{ label: t("delete"), kind: "danger", value: "del" }] : []), { label: t("cancel"), value: null },
        { label: t("save"), kind: "primary", value: (w) => {
          const all = ab && !subs.some((s) => s.name === ab.name) ? [ab, ...subs] : subs;
          const i = w.querySelector("[name=about]").value;
          return { id: note.id, about: i === "" ? null : all[+i], title: w.querySelector("[name=title]").value.trim(), text: w.querySelector("[name=text]").value };
        } }] });
    if (v === "del") {
      if (await MC.confirm(t("confirm.delete", { name: note.about?.name || note.title || t("pn.untitled") }))) MC.send({ t: "pn_del", id: note.id });
      return;
    }
    if (!v) return;
    if (!v.text.trim() && !v.title && !v.about) return;
    try { await MC.request({ t: "pn_save", note: v }); MC.toast(t("pn.saved"), "ok", "pen"); } catch { MC.toast(t("conn.offline"), "warn"); }
  };

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pn=new]")) { N.edit(null); return; }
    const r = e.target.closest("[data-pnid]");
    if (r) { const n = N.list.find((x) => x.id === r.dataset.pnid); if (n) N.edit(n); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "pn-q") return;
    filter = e.target.value;
    const box = $("#pnotes"), pos = e.target.selectionStart;
    box.innerHTML = html();
    const el = $("#pn-q"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });
  MC.on("msg_pnotes", (m) => { N.list = m.notes || []; render(); });
  MC.on("welcome", () => { if (!gm()) MC.send({ t: "pn_list" }); render(); });
  MC.on("lang", render);
})();
