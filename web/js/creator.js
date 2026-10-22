// Masters Compendium — «Создатель персонажа» одним файлом.
// Кнопка в списке персонажей собирает отдельную страницу (.html): тот же пошаговый мастер создания, справочник
// D&D 5e внутри, без интернета и без сервера. Игрок открывает файл в браузере, создаёт героя и сохраняет
// «.character», а мастер загружает его кнопкой «Загрузить .character».
(() => {
  "use strict";
  const MC = window.MC;
  const t = MC.t;
  const C = (MC.Creator = {});
  const V = () => document.querySelector('script[src*="/web/js/core.js"]')?.src.split("?v=")[1] || "1";
  const FILES = ["/web/i18n.js", "/web/js/icons.js", "/web/js/core.js", "/web/js/crop.js", "/web/js/rules.js", "/web/js/wizard.js"];
  const esc = (s) => s.replace(/<\/(script)/gi, "<\\/$1");

  // Работает внутри собранной страницы: заменяет сервер, кубики и лист персонажа.
  const PRE = `(() => {
  const _f = window.fetch;
  window.fetch = (u, o) => String(u).includes("srd2014.json")
    ? Promise.resolve(new Response(document.getElementById("srd").textContent, { headers: { "Content-Type": "application/json" } }))
    : _f(u, o);
})();`;
  const POST = `(() => {
  const MC = window.MC;
  const esc = MC.esc;
  MC.state.role = "player";
  const F = (MC.F = {});
  F.field = (label, html, cls = "") => \`<label class="field \${cls}"><span>\${esc(label)}</span>\${html}</label>\`;
  F.input = (name, val = "", attrs = "") => \`<input name="\${name}" value="\${esc(val)}" \${attrs}>\`;
  MC.Sheet = {
    addItems(list, doc) {
      const R = MC.R;
      for (const { id, qty } of list) {
        const s = R.srd.item[id];
        if (!s) continue;
        const it = R.itemFromSrd(s, qty);
        doc.inventory.push(it);
        if (s.kind === "weapon") doc.attacks.push(R.attackFromItem(it));
      }
    },
  };
  // кубики для «бросить характеристики»: 4d6, лучшие 3
  MC.Dice = {
    roll: async (formula) => {
      const m = /^(\\d+)d(\\d+)(?:kh(\\d+))?$/i.exec(String(formula).trim());
      if (!m) return { total: 0 };
      const n = +m[1], s = +m[2], k = m[3] ? +m[3] : n;
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s));
      const kept = rolls.slice().sort((a, b) => b - a).slice(0, k);
      return { total: kept.reduce((a, b) => a + b, 0), formula, parts: [{ sides: s, rolls }] };
    },
  };
  let made = null;
  MC.request = async (o) => {
    if (o.t === "char_create") { made = o.doc; made.id = made.id || MC.uid(); return { char: { id: made.id } }; }
    throw Object.assign(new Error("offline"), { code: "offline" });
  };
  MC.send = () => false;
  const T = (ru, en) => (MC.lang === "ru" ? ru : en);
  function done() {
    const d = made, R = MC.R;
    const cls = (d.classes || []).map((c) => \`\${MC.L(R.srd.cls[c.id]) || c.name || ""} \${c.level || 1}\`).join(" / ");
    const race = MC.L(R.srd.race[d.race]) || d.race_custom || "";
    document.getElementById("sheet-root").innerHTML = \`<div class="card glass cr-done">
      \${d.portrait ? \`<img class="cr-pic" src="\${esc(d.portrait)}" alt="">\` : ""}
      <h1>\${esc(d.name || "?")}</h1><p class="muted">\${esc([race, cls].filter(Boolean).join(" · "))}</p>
      <div class="cr-ab">\${R.ABILS.map((a) => \`<div><small>\${esc(R.abName(a, true))}</small><b>\${d.abilities[a]}</b></div>\`).join("")}</div>
      <p class="muted small">\${T("Хиты", "HP")}: \${d.hp?.max ?? "?"} · \${T("Снаряжение", "Gear")}: \${(d.inventory || []).length}</p>
      <button class="btn primary" id="cr-save">\${MC.icon("download", "sm")} \${T("Сохранить файл персонажа", "Save character file")}</button>
      <p class="muted small">\${T("Отправьте файл мастеру — он загрузит его в игру кнопкой «Загрузить .character».", "Send the file to your GM — they load it with \\"Upload .character\\".")}</p>
      <button class="btn ghost" id="cr-again">\${T("Создать ещё одного", "Create another")}</button></div>\`;
  }
  MC.on("open_sheet", done);
  MC.on("sheet_closed", () => MC.Wizard.start());
  document.addEventListener("click", (e) => {
    if (e.target.closest("#cr-save") && made) {
      const data = { format: 1, app: "MastersCompendium", system: "dnd5e_2014", character: made };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      a.download = (made.name || "character").replace(/[\\\\/:*?"<>|]+/g, "_") + ".character";
      document.body.appendChild(a); a.click(); a.remove();
    }
    if (e.target.closest("#cr-again")) { made = null; MC.Wizard.start(); }
    if (e.target.closest("#cr-lang")) { MC.setLang(MC.lang === "ru" ? "en" : "ru"); location.reload(); }
  });
  document.getElementById("cr-lang").textContent = MC.lang === "ru" ? "EN" : "RU";
  MC.applyI18n?.();
  MC.Wizard.start();
})();`;

  C.build = async () => {
    MC.toast(t("cr.building"), "", "download");
    const v = V();
    const get = (u) => fetch(u + "?v=" + v).then((r) => { if (!r.ok) throw new Error(u); return r.text(); });
    let css, srd, js;
    try { [css, srd, ...js] = await Promise.all([get("/web/style.css"), get("/web/data/srd2014.json"), ...FILES.map(get)]); }
    catch { MC.toast(t("conn.offline"), "bad"); return; }
    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Masters Compendium — создатель персонажа</title>
<style>${css}
body { background: #0f1015; min-height: 100vh; }
.cr-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; max-width: 900px; margin: 0 auto; }
.cr-top b { font-size: 17px; } .cr-main { max-width: 900px; margin: 0 auto; padding: 0 12px 40px; }
.cr-done { padding: 20px; display: grid; gap: 10px; justify-items: center; text-align: center; margin-top: 20px; }
.cr-done h1 { margin: 0; } .cr-pic { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; }
.cr-ab { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; width: 100%; max-width: 480px; }
.cr-ab div { background: rgba(255,255,255,.05); border-radius: 10px; padding: 6px; display: grid; } .cr-ab b { font-size: 20px; }
</style></head>
<body class="creator">
<div class="cr-top"><b>⚔ Masters Compendium</b><button class="lang" id="cr-lang">EN</button></div>
<main class="cr-main tabs-body"><div id="sheet-root"></div></main>
<script type="application/json" id="srd">${srd.replace(/<\//g, "<\\/")}</script>
<script>${esc(PRE)}</script>
${js.map((x) => `<script>${esc(x)}</script>`).join("\n")}
<script>${esc(POST)}</script>
</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = t("cr.file") + ".html";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    MC.toast(t("cr.done"), "ok", "download");
  };
})();
