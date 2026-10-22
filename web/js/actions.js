// Masters Compendium — что участник боя умеет делать: атаки и заклинания из листа персонажа,
// действия из статблока монстра, своя атака. Используют вкладка «Бой» и карта.
(() => {
  "use strict";
  const MC = window.MC;
  const { t } = MC;
  const A = (MC.Actions = {});
  const R = () => MC.R;

  const AB_STEMS = { str: ["сил", "strength"], dex: ["лов", "dexterity"], con: ["тел", "constitution"],
    int: ["инт", "intelligence"], wis: ["мудр", "мдр", "wisdom"], cha: ["хар", "charisma"] };
  const norm = (f) => String(f || "").replace(/[кК]/g, "d").replace(/[−–]/g, "-").replace(/\s+/g, "");
  const costOf = (time) => (/бонусн|bonus/i.test(time || "") ? "b" : /реакц|reaction/i.test(time || "") ? "r" : "a");
  const abFromWord = (w) => {
    const s = String(w || "").toLowerCase();
    return Object.keys(AB_STEMS).find((k) => AB_STEMS[k].some((x) => s.startsWith(x))) || "dex";
  };

  /** «80/320», «дистанция 150/600 фт», «120 feet» → [обычная, предельная] */
  A.parseRange = (txt) => {
    const s = String(txt || "");
    const two = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (two) return [MC.int(two[1]), MC.int(two[2])];
    const one = s.match(/(\d+)\s*(?:фут|фт|ft|feet|foot)/i);
    return one ? [MC.int(one[1]), MC.int(one[1])] : null;
  };
  /** Приёмы, доступные всем: захват, толчок, высвободиться, спрятаться, стабилизировать. */
  A.MANEUVERS = [
    { id: "x:grapple", kind: "mnv", mnv: "grapple", icon: "hand", tgt: true },
    { id: "x:shove", kind: "mnv", mnv: "shove", icon: "c-prone", tgt: true },
    { id: "x:escape", kind: "mnv", mnv: "escape", icon: "c-grappled" },
    { id: "x:hide", kind: "mnv", mnv: "hide", icon: "hidden" },
    { id: "x:stabilize", kind: "mnv", mnv: "stabilize", icon: "heart-pulse", tgt: true },
  ];

  /** Участник боя / фишка → откуда брать действия: {char} | {mon} | {} */
  A.sourceInfo = (e) => ({ char: e.char || "", mon: e.mon || "", name: e.name || "" });

  async function docOf(cid) {
    let d = MC.state.docs.get(cid);
    if (!d) {
      try { d = (await MC.request({ t: "char_get", id: cid })).char; } catch { d = null; }
    }
    return d;
  }

  /** Какие боеприпасы тратит оружие: стрелы, болты, снаряды, иглы (или "" — не тратит). */
  A.ammoOf = (it, a) => {
    const props = it?.props || a?.props || [];
    if (!props.includes("ammunition")) return "";
    const key = `${it?.srd || ""} ${it?.name || ""} ${a?.name || ""}`.toLowerCase();
    if (/crossbow|арбалет/.test(key)) return "bolt";
    if (/sling|праща|пращ/.test(key)) return "bullet";
    if (/blowgun|трубк/.test(key)) return "needle";
    return "arrow";
  };
  // ---------------------------------------------------------------- из листа персонажа
  function fromDoc(doc) {
    const out = [];
    for (const a of doc.attacks || []) {
      const it = a.item ? (doc.inventory || []).find((x) => x.id === a.item) : null;
      const ranged = (it?.range || a.rangeType) === "ranged";
      out.push({ id: "a:" + a.id, kind: "attack", group: "atk", name: a.name || "?", bonus: R().attackBonus(doc, a),
        dmg: R().damageFormula(doc, a), dtype: R().dmgType(a.dtype), cost: "a", icon: "sword",
        rng: ranged ? "ranged" : "melee", reach: (a.props || it?.props || []).includes("reach") ? 10 : 5,
        range: ranged ? A.parseRange(it?.dist || a.range || (it?.srd ? R().srd?.item[it.srd]?.dist : "")) : null,
        ammo: A.ammoOf(it, a) });
    }
    const list = (doc.spells?.list || []).filter((sp) => sp.lvl === 0 || sp.prepared || sp.always);
    for (const sp of list) {
      const s = R().srd?.spell[sp.srd];
      const info = R().spellInfo(sp);
      const lvl = MC.int(sp.lvl ?? s?.lvl, 0);
      const base = { group: "spell", name: info.name, lvl, cost: costOf(info.time), conc: !!(s?.conc ?? sp.conc), icon: "spells", spell: sp.id };
      const dmgAt = (slot) => R().spellDamage(doc, sp, slot);
      const dtype = R().dmgType(s?.dmg?.type || sp.dtype || "");
      if (s?.atk || sp.atk) {
        const touch = /touch|касан|self|на себя/i.test(String(s?.range || sp.range || ""));
        out.push({ ...base, id: "s:" + sp.id, kind: "attack", bonus: R().spellAtk(doc), dmg: dmgAt(lvl), dmgAt, dtype, rng: touch ? "melee" : "ranged", reach: 5,
          range: touch ? null : A.parseRange(s?.range || sp.range) });
      } else if (s?.save || sp.save) {
        out.push({ ...base, id: "s:" + sp.id, kind: "save", ab: s?.save || sp.save, dc: R().spellDC(doc), dmg: dmgAt(lvl), dmgAt, dtype,
          half: lvl > 0, multi: true });
      } else if (s?.heal || sp.heal) {
        out.push({ ...base, id: "s:" + sp.id, kind: "heal", amount: R().spellHeal(doc, sp, lvl), amountAt: (slot) => R().spellHeal(doc, sp, slot), icon: "heart-pulse" });
      } else if (base.conc) {
        out.push({ ...base, id: "s:" + sp.id, kind: "conc" });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- из статблока
  /** «+4 к попаданию … 5 (1к6 + 2) рубящего урона», «спасбросок Ловкости Сл 13 … 14 (4к6) урона огнём, или половину». */
  A.parseMonsterAction = (x, group) => {
    const text = String(x.text || "");
    const name = x.name || "?";
    const dm = text.match(/\d+\s*\((\d+\s*[кdD]\s*\d+(?:\s*[+−–-]\s*\d+)?)\)\s*([а-яёa-z]+)?/i) || text.match(/(\d+\s*[кdD]\s*\d+(?:\s*[+−–-]\s*\d+)?)/);
    const dmg = dm ? norm(dm[1]) : "";
    const dtype = dm && dm[2] ? dm[2] : "";
    const hit = text.match(/([+−-]\s?\d+)\s+(?:к попаданию|to hit)/i);
    const cost = group === "bonus" ? "b" : group === "reactions" ? "r" : "a";
    const melee = /рукопашн|melee/i.test(text), ranged = /дальнобойн|ranged/i.test(text);
    const reachM = text.match(/(?:досягаемост[а-яё]*|reach)\s*(\d+)/i);
    const rng = melee && !ranged ? "melee" : ranged && !melee ? "ranged" : "";
    const rngM = text.match(/(?:дистанци[а-яё]*|range)\s*(\d+\s*\/\s*\d+|\d+)/i);
    if (hit) return { kind: "attack", group: "mon", name, rng, reach: reachM ? MC.int(reachM[1], 5) : 5, range: rngM ? A.parseRange(rngM[1] + " фт") : null, bonus: MC.int(hit[1].replace(/[−\s]/g, (c) => (c === "−" ? "-" : ""))), dmg, dtype, cost, icon: "sword" };
    const sv = text.match(/спасброс[а-яё]*\s+([А-ЯЁа-яё]+)[^.]{0,40}?(?:Сл|СЛ|DC)\s*(\d+)/i) || text.match(/DC\s*(\d+)\s+([A-Za-z]+)\s+saving/i);
    if (sv) {
      const en = /^\d+$/.test(sv[1]);
      return { kind: "save", group: "mon", name, ab: abFromWord(en ? sv[2] : sv[1]), dc: MC.int(en ? sv[1] : sv[2], 10), dmg, dtype,
        half: /половин|half/i.test(text), multi: true, cost, icon: "target" };
    }
    return null;
  };
  function fromMonster(m) {
    const out = [];
    for (const g of ["actions", "bonus", "reactions", "legendary"]) {
      (m[g] || []).forEach((x, i) => {
        const a = A.parseMonsterAction(x, g);
        if (a) out.push({ ...a, id: `m:${g}:${i}` });
      });
    }
    return out;
  }

  /** Все действия источника. */
  A.list = async (src) => {
    let out = [];
    if (src.char) {
      await R().load();
      const doc = await docOf(src.char);
      if (doc) out = fromDoc(doc);
    } else if (src.mon) {
      try { out = fromMonster(await MC.Statblock.get(src.mon)); } catch { out = []; }
    }
    out.push({ id: "custom", kind: "custom", group: "other", name: t("act.custom"), cost: "a", icon: "edit" });
    for (const x of A.MANEUVERS) out.push({ ...x, group: "mnv", name: t("mnv." + x.mnv), cost: "a" });
    return out;
  };

  A.label = (a) => {
    if (a.kind === "attack") return `${MC.sign(a.bonus)} · ${a.dmg || "—"}`;
    if (a.kind === "save") return `${R().abName(a.ab)} ${t("act.dc")} ${a.dc}${a.dmg ? " · " + a.dmg : ""}`;
    if (a.kind === "heal") return `+${a.amount || "?"}`;
    if (a.kind === "conc") return t("act.conc_only");
    if (a.kind === "mnv") return t("mnv." + a.mnv + ".d");
    return "";
  };
  A.COST = { a: "act.cost.a", b: "act.cost.b", r: "act.cost.r" };
})();
