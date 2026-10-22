// Masters Compendium — статблок монстра: красивый вид и броски по клику
// («+4 к попаданию» → 1d20+4, «1к6 + 2» → урон). Используют бестиарий, бой и карта.
(() => {
  "use strict";
  const MC = window.MC;
  const { t, esc } = MC;
  const SB = (MC.Statblock = {});
  const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
  const cache = new Map();       // id → полный монстр (у мастера)

  const mod = (v) => Math.floor((MC.int(v, 10) - 10) / 2);
  const norm = (f) => f.replace(/[кК]/g, "d").replace(/[−–]/g, "-").replace(/\s+/g, "");

  /** Текст действия → HTML с кнопками бросков. */
  SB.rollify = (text, label) => {
    let s = esc(text || "");
    const chip = (formula, shown, kind, extra = "") =>
      `<button type="button" class="roll-chip ${kind}" data-roll="${esc(formula)}" data-label="${esc(label + extra)}" data-kind="${kind}">${shown}</button>`;
    // атака: «+4 к попаданию» / «+4 to hit»
    s = s.replace(/([+−-]\s?\d+)(\s+(?:к попаданию|to hit))/gi, (m, b, rest) =>
      chip("1d20" + norm(b).replace(/^([^+-])/, "+$1"), b, "attack", ": " + t("atk.hit")) + rest);
    // кости: «2к6 + 3», «1d8», «к20» — не трогаем то, что уже стало кнопкой
    s = s.replace(/(<button[^>]*>.*?<\/button>)|(\b\d{0,3}\s?[кКdD]\s?\d{1,3}(?:\s?[+−–-]\s?\d{1,3})?)(?![\d])/g, (m, btn, dice) => {
      if (btn) return btn;
      const f = norm(dice);
      if (!/^\d*d\d+([+-]\d+)?$/.test(f)) return m;
      return chip(f.startsWith("d") ? "1" + f : f, dice, "damage", ": " + t("sp.dmg"));
    });
    return s.replace(/\n/g, "<br>");
  };

  function block(title, items, name) {
    if (!items?.length) return "";
    return `<h4 class="sb-h">${esc(title)}</h4>${items.map((x) => `<p class="sb-p">${x.name ? `<b class="sb-n">${esc(x.name)}.</b> ` : ""}${SB.rollify(x.text, `${name}: ${x.name || title}`)}</p>`).join("")}`;
  }
  const line = (k, v) => (v ? `<div class="sb-l"><b>${esc(t(k))}</b> ${esc(v)}</div>` : "");

  SB.html = (m) => {
    const ab = m.abil || {};
    const hpBtn = m.hp_formula && /\d\s?[кd]\s?\d/i.test(m.hp_formula)
      ? SB.rollify(m.hp_formula, `${m.name}: ${t("sb.hp")}`) : esc(m.hp_formula || "");
    return `<div class="statblock">
      <div class="sb-top">
        ${m.img ? `<img class="sb-img" src="/asset/${esc(m.img)}" alt="" onerror="this.remove()">` : ""}
        <div><div class="sb-name">${esc(m.name)}</div>
        <div class="sb-type">${esc([m.type, m.alignment].filter(Boolean).join(", "))}${m.name_en ? ` · <span class="muted">${esc(m.name_en)}</span>` : ""}</div></div>
      </div>
      <div class="sb-rule"></div>
      <div class="sb-l"><b>${t("sb.ac")}</b> ${m.ac}${m.ac_text ? ` (${esc(m.ac_text)})` : ""}</div>
      <div class="sb-l"><b>${t("sb.hp")}</b> ${m.hp}${m.hp_formula ? ` (${hpBtn})` : ""}</div>
      ${line("sb.speed", m.speed)}
      <div class="sb-rule"></div>
      <div class="sb-abil">${ABILS.map((a) => `<button type="button" class="sb-ab roll-chip plain" data-roll="1d20${MC.sign(mod(ab[a])).replace("−", "-")}" data-label="${esc(m.name)}: ${esc(MC.R.abName(a))}" data-kind="check">
        <span>${esc(MC.R.abName(a, true))}</span><b>${ab[a] ?? 10}</b><small>${MC.sign(mod(ab[a]))}</small></button>`).join("")}</div>
      <div class="sb-rule"></div>
      ${line("sb.saves", m.saves)}${line("sb.skills", m.skills)}${line("sb.vul", m.dmg_vul)}${line("sb.res", m.dmg_res)}
      ${line("sb.imm", m.dmg_imm)}${line("sb.cimm", m.cond_imm)}${line("sb.senses", m.senses)}${line("sb.langs", m.languages)}
      <div class="sb-l"><b>${t("sb.cr")}</b> ${esc(m.cr)}${m.xp ? ` (${m.xp} ${t("sb.xp")})` : ""}${m.pb ? ` · ${t("sb.pb")} +${m.pb}` : ""}</div>
      <div class="sb-rule"></div>
      ${block("", m.traits, m.name)}
      ${block(t("sb.actions"), m.actions, m.name)}
      ${block(t("sb.bonus"), m.bonus, m.name)}
      ${block(t("sb.reactions"), m.reactions, m.name)}
      ${m.legendary?.length ? `<h4 class="sb-h">${t("sb.legendary")}</h4>${m.legendary_text ? `<p class="sb-p">${esc(m.legendary_text)}</p>` : ""}${block("", m.legendary, m.name).replace(/^<h4 class="sb-h"><\/h4>/, "")}` : ""}
      ${m.lair ? `<h4 class="sb-h">${t("sb.lair")}</h4><p class="sb-p">${SB.rollify(m.lair, m.name)}</p>` : ""}
      ${m.desc ? `<details class="sb-desc"><summary>${t("sb.desc")}</summary><p class="sb-p">${esc(m.desc).replace(/\n/g, "<br>")}</p></details>` : ""}
      ${m.src && m.src !== "custom" ? `<div class="muted small sb-src">${esc(m.src)}${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">ttg.club</a>` : ""}</div>` : ""}
    </div>`;
  };

  /** Получить полный статблок (мастер). */
  SB.get = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const r = await MC.request({ t: "mon_get", id });
    cache.set(id, r.monster);
    return r.monster;
  };
  SB.put = (m) => cache.set(m.id, m);
  SB.peek = (id) => cache.get(id) || null;
  SB.forget = (id) => cache.delete(id);

  /** Показать статблок в окне. extraButtons: [{label, value, kind}] → возвращает выбранное value. */
  SB.show = async (m, extraButtons = []) => MC.modal({ wide: true, body: SB.html(m),
    buttons: [...extraButtons, { label: t("close"), value: null }] });

  // клики по броскам — где бы ни был статблок
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-roll]");
    if (!b || !b.closest(".statblock, .cb-list, .map-panel")) return;
    e.preventDefault();
    MC.Dice.roll(b.dataset.roll, b.dataset.label || b.dataset.roll, { kind: b.dataset.kind || "free", char: b.dataset.char || "" });
  });
})();
