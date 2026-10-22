// Masters Compendium — правила D&D 5e (2014): справочник SRD и всё, что лист считает сам.
(() => {
  "use strict";
  const MC = window.MC;
  const R = (MC.R = {});

  R.ABILS = ["str", "dex", "con", "int", "wis", "cha"];
  R.ASI_LEVELS = { _: [4, 8, 12, 16, 19], fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };
  // Таблица ячеек полного заклинателя (для мультикласса). Индекс = уровень заклинателя.
  R.FULL_SLOTS = [[], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
  R.POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  R.STD_ARRAY = [15, 14, 13, 12, 10, 8];
  R.ALIGNMENTS = {
    ru: ["Законно-добрый", "Нейтрально-добрый", "Хаотично-добрый", "Законно-нейтральный", "Нейтральный",
      "Хаотично-нейтральный", "Законно-злой", "Нейтрально-злой", "Хаотично-злой"],
    en: ["Lawful good", "Neutral good", "Chaotic good", "Lawful neutral", "True neutral", "Chaotic neutral",
      "Lawful evil", "Neutral evil", "Chaotic evil"],
  };

  // ---------------------------------------------------------------- справочник
  R.srd = null;
  let loading = null;
  R.load = () => {
    if (R.srd) return Promise.resolve(R.srd);
    if (!loading) {
      loading = fetch("/web/data/srd2014.json?v=0.7").then((r) => r.json()).then((d) => {
        const by = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
        d.cls = by(d.classes); d.race = by(d.races); d.item = by(d.items); d.spell = by(d.spells);
        d.bg = by(d.backgrounds); d.skill = by(d.skills); d.abil = by(d.abilities); d.cond = by(d.conditions);
        d.subrace = {};
        d.races.forEach((r) => r.subraces.forEach((s) => { d.subrace[s.id] = s; }));
        d.subclass = {};
        d.classes.forEach((c) => c.subclasses.forEach((s) => { d.subclass[s.id] = { ...s, cls: c.id }; }));
        R.srd = d;
        return d;
      }).catch((e) => { loading = null; throw e; });
    }
    return loading;
  };

  R.abName = (ab, short = true) => {
    const a = R.srd?.abil[ab];
    if (!a) return ab.toUpperCase();
    return MC.lang === "ru" ? (short ? a.ru_s : a.ru) : (short ? a.en_s : a.en);
  };
  R.skillName = (id) => MC.L(R.srd?.skill[id]) || id;
  R.className = (k) => k.name || MC.L(R.srd?.cls[k.id]) || "?";
  R.subclassName = (k) => k.sub_name || MC.L(R.srd?.subclass[k.sub]) || "";
  R.raceName = (doc) => {
    const r = doc.race || {};
    if (r.name) return r.name;
    const sub = R.srd?.subrace[r.sub];
    return sub ? MC.L(sub) : MC.L(R.srd?.race[r.id]);
  };
  R.bgName = (doc) => doc.background?.name || MC.L(R.srd?.bg[doc.background?.id]) || "";
  R.itemName = (it) => it.name || MC.L(R.srd?.item[it.srd]) || "?";
  /** Имя заклинания: своё (если игрок переименовал) или из справочника на языке интерфейса. */
  R.srdSpellName = (s) => (s ? (MC.lang === "ru" && s.ru) || s.en : "");
  R.spellName = (sp) => {
    const s = R.srd?.spell[sp.srd];
    return (sp.name && (!s || sp.name !== s.en) ? sp.name : R.srdSpellName(s)) || sp.name || "?";
  };
  R.dmgType = (t) => (MC.lang === "ru" ? R.srd?.damage[t] : t) || t || "";

  // ---------------------------------------------------------------- новый лист
  R.newCharacter = () => ({
    name: "", portrait: "",
    race: { id: "", sub: "", name: "" },
    classes: [],
    background: { id: "", name: "" }, alignment: "", xp: 0, size: "Medium",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: [], skills: {}, jack: false,
    profs: { armor: "", weapons: "", tools: "", languages: "" },
    ac: { mode: "auto", manual: 10, bonus: 0, unarmored: "none" },
    init_bonus: 0, speed: 30,
    hp: { max: 0, cur: 0, temp: 0 }, hd_used: {}, death: { ok: 0, fail: 0 }, inspiration: false,
    attacks: [],
    spells: { ability: "auto", slots_used: [0, 0, 0, 0, 0, 0, 0, 0, 0], slots_adj: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      pact_used: 0, dc_bonus: 0, atk_bonus: 0, list: [] },
    resources: [], inventory: [], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    features: [], conditions: [], exhaustion: 0,
    persona: { personality: "", ideals: "", bonds: "", flaws: "", appearance: "", backstory: "", allies: "" },
    notes: "",
  });

  // ---------------------------------------------------------------- базовые числа
  R.mod = (score) => Math.floor((MC.int(score, 10) - 10) / 2);
  R.score = (doc, ab) => MC.int(doc.abilities?.[ab], 10);
  R.abMod = (doc, ab) => R.mod(R.score(doc, ab));
  R.level = (doc) => Math.max(1, (doc.classes || []).reduce((s, k) => s + MC.int(k.level, 0), 0));
  R.prof = (doc) => 2 + Math.floor((R.level(doc) - 1) / 4);

  R.saveBonus = (doc, ab) => R.abMod(doc, ab) + ((doc.saves || []).includes(ab) ? R.prof(doc) : 0);
  R.skillProf = (doc, sk) => MC.int(doc.skills?.[sk], 0);           // 0 / 1 / 2
  R.skillBonus = (doc, sk) => {
    const s = R.srd?.skill[sk];
    const ab = s ? s.ab : "int";
    const p = R.skillProf(doc, sk);
    let b = R.abMod(doc, ab) + p * R.prof(doc);
    if (!p && doc.jack) b += Math.floor(R.prof(doc) / 2);
    return b;
  };
  R.passive = (doc, sk) => 10 + R.skillBonus(doc, sk);
  R.initiative = (doc) => R.abMod(doc, "dex") + MC.int(doc.init_bonus, 0) + (doc.jack ? Math.floor(R.prof(doc) / 2) : 0);

  // ---------------------------------------------------------------- КД
  R.ac = (doc) => {
    const ac = doc.ac || {};
    if (ac.mode === "manual") return MC.int(ac.manual, 10) + MC.int(ac.bonus, 0);
    const inv = doc.inventory || [];
    const armor = inv.find((i) => i.equipped && i.kind === "armor");
    const shield = inv.find((i) => i.equipped && i.kind === "shield");
    const dex = R.abMod(doc, "dex");
    let v;
    if (armor) {
      const base = MC.int(armor.ac, 10);
      if (armor.acat === "heavy" || armor.dex === false) v = base;
      else if (armor.acat === "medium") v = base + Math.min(dex, armor.maxdex != null ? MC.int(armor.maxdex, 2) : 2);
      else v = base + dex;
    } else if (ac.unarmored === "barb") v = 10 + dex + R.abMod(doc, "con");
    else if (ac.unarmored === "monk" && !shield) v = 10 + dex + R.abMod(doc, "wis");
    else v = 10 + dex;
    if (shield) v += MC.int(shield.ac, 2);
    return v + MC.int(ac.bonus, 0);
  };

  // ---------------------------------------------------------------- заклинания
  R.casterClasses = (doc) => (doc.classes || []).filter((k) => k.caster);
  R.spellAbility = (doc) => {
    const s = doc.spells || {};
    if (s.ability && s.ability !== "auto") return s.ability;
    const k = R.casterClasses(doc)[0];
    return k ? k.ability || R.srd?.cls[k.id]?.spell_ability || "int" : null;
  };
  R.spellDC = (doc) => { const ab = R.spellAbility(doc) || "int"; return 8 + R.prof(doc) + R.abMod(doc, ab) + MC.int(doc.spells?.dc_bonus, 0); };
  R.spellAtk = (doc) => { const ab = R.spellAbility(doc) || "int"; return R.prof(doc) + R.abMod(doc, ab) + MC.int(doc.spells?.atk_bonus, 0); };

  /** Максимум ячеек 1–9 круга (без договора колдуна). */
  R.slotsMax = (doc) => {
    const casters = R.casterClasses(doc).filter((k) => k.caster !== "pact");
    let base = [];
    if (casters.length === 1) {
      const k = casters[0];
      const lv = MC.clamp(MC.int(k.level, 1), 1, 20);
      const row = R.srd?.cls[k.id]?.levels?.[lv - 1];
      if (row && row.slots && R.srd.cls[k.id].caster === k.caster) base = row.slots.slice();
      else {
        const cl = k.caster === "full" ? lv : k.caster === "half" ? (lv >= 2 ? Math.ceil(lv / 2) : 0) : k.caster === "third" ? (lv >= 3 ? Math.ceil(lv / 3) : 0) : 0;
        base = (R.FULL_SLOTS[cl] || []).slice();
      }
    } else if (casters.length > 1) {
      let cl = 0;
      for (const k of casters) {
        const lv = MC.int(k.level, 0);
        cl += k.caster === "full" ? lv : k.caster === "half" ? Math.floor(lv / 2) : k.caster === "third" ? Math.floor(lv / 3) : 0;
      }
      base = (R.FULL_SLOTS[MC.clamp(cl, 0, 20)] || []).slice();
    }
    const adj = doc.spells?.slots_adj || [];
    return Array.from({ length: 9 }, (_, i) => Math.max(0, (base[i] || 0) + MC.int(adj[i], 0)));
  };
  R.pact = (doc) => {
    const k = (doc.classes || []).find((c) => c.caster === "pact");
    if (!k) return null;
    const lv = MC.clamp(MC.int(k.level, 1), 1, 20);
    const count = lv >= 17 ? 4 : lv >= 11 ? 3 : lv >= 2 ? 2 : 1;
    return { count: count + MC.int(doc.spells?.pact_adj, 0), level: Math.min(5, Math.ceil(lv / 2)) };
  };
  R.knownInfo = (doc) => {
    const out = [];
    for (const k of R.casterClasses(doc)) {
      const row = R.srd?.cls[k.id]?.levels?.[MC.clamp(MC.int(k.level, 1), 1, 20) - 1];
      if (row) out.push({ cls: R.className(k), cantrips: row.cantrips || 0, known: row.known || 0 });
    }
    return out;
  };

  // ---------------------------------------------------------------- кости хитов, нагрузка
  R.hitDice = (doc) => {
    const by = {};
    for (const k of doc.classes || []) {
      const d = MC.int(k.hd, 8);
      by[d] = (by[d] || 0) + MC.int(k.level, 0);
    }
    return Object.keys(by).map(Number).sort((a, b) => b - a)
      .map((d) => ({ d, total: by[d], used: MC.clamp(MC.int(doc.hd_used?.[d], 0), 0, by[d]) }));
  };
  R.carry = (doc) => {
    const w = (doc.inventory || []).reduce((s, i) => s + MC.num(i.w, 0) * MC.num(i.qty, 1), 0);
    const coins = Object.values(doc.coins || {}).reduce((s, n) => s + MC.int(n, 0), 0) / 50;
    const mult = doc.size === "Small" || doc.size === "Tiny" ? 15 : 15;
    return { w: Math.round((w + coins) * 10) / 10, cap: R.score(doc, "str") * mult };
  };
  R.avgHp = (hd) => Math.floor(hd / 2) + 1;

  // ---------------------------------------------------------------- атаки
  R.attackAbility = (doc, a) => {
    if (a.ab && a.ab !== "auto") return a.ab === "spell" ? R.spellAbility(doc) || "int" : a.ab;
    const it = a.item ? (doc.inventory || []).find((i) => i.id === a.item) : null;
    const props = it?.props || a.props || [];
    const ranged = (it?.range || a.rangeType) === "ranged";
    if (props.includes("finesse")) return R.abMod(doc, "dex") >= R.abMod(doc, "str") ? "dex" : "str";
    return ranged ? "dex" : "str";
  };
  R.attackBonus = (doc, a) => {
    if (a.ab === "none") return MC.int(a.bonus, 0) + (a.prof ? R.prof(doc) : 0);
    const ab = R.attackAbility(doc, a);
    return R.abMod(doc, ab) + (a.prof !== false ? R.prof(doc) : 0) + MC.int(a.bonus, 0)
      + (a.ab === "spell" ? MC.int(doc.spells?.atk_bonus, 0) : 0);
  };
  R.damageFormula = (doc, a, crit = false) => {
    let dice = String(a.dmg || "").trim();
    if (!dice) return "";
    if (crit) dice = dice.replace(/(\d*)[dDкК](\d+)/g, (_, n, s) => `${(MC.int(n, 1)) * 2}d${s}`);
    let bonus = MC.int(a.dmg_bonus, 0);
    if (a.dmg_ab !== false && a.ab !== "none") bonus += R.abMod(doc, R.attackAbility(doc, a));
    return bonus ? `${dice}${bonus > 0 ? "+" : "-"}${Math.abs(bonus)}` : dice;
  };

  /** Атака из оружия инвентаря. */
  R.attackFromItem = (it) => ({
    id: MC.uid(), name: R.itemName(it), item: it.id, ab: "auto", prof: true, bonus: 0,
    dmg: it.dmg || "1d4", dmg2: it.dmg2 || "", dmg_ab: true, dmg_bonus: 0, dtype: it.dtype || "",
    range: it.dist || "", props: it.props || [], rangeType: it.range || "melee", notes: "",
  });
  /** Предмет инвентаря из справочника. */
  R.itemFromSrd = (s, qty = 1) => {
    const it = { id: MC.uid(), srd: s.id, name: MC.L(s), qty, w: s.w || 0, kind: s.kind || "gear", equipped: false, notes: "" };
    if (s.kind === "weapon") Object.assign(it, { dmg: s.dmg, dmg2: s.dmg2 || "", dtype: s.dtype, props: s.props || [], range: s.range, dist: s.dist || "", cat: s.cat });
    if (s.kind === "armor" || s.kind === "shield") Object.assign(it, { ac: s.ac, acat: s.acat, dex: s.dex, maxdex: s.maxdex ?? null, strmin: s.strmin || 0, stealth: !!s.stealth });
    return it;
  };
  /** Заклинание в лист из справочника. */
  R.spellFromSrd = (s) => ({ id: MC.uid(), srd: s.id, lvl: s.lvl, prepared: s.lvl === 0, always: false,
    conc: s.conc, ritual: s.ritual });
  R.spellInfo = (sp) => {
    let base = R.srd?.spell[sp.srd] || {};
    if (MC.lang === "ru" && base.ru) {
      base = { ...base, desc: base.desc_ru || base.desc, higher: base.higher_ru ?? base.higher, mat: base.mat_ru ?? base.mat,
        time: base.time_ru || base.time, range: base.range_ru || base.range, dur: base.dur_ru || base.dur };
    }
    const own = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v !== "" && v != null && !(k === "name" && v === R.srd?.spell[sp.srd]?.en)));
    return { ...base, ...own, name: R.spellName(sp) };
  };

  /** Урон заклинания по уровню ячейки / персонажа. */
  R.spellDamage = (doc, sp, slot) => {
    const s = R.srd?.spell[sp.srd];
    if (sp.dmg_formula) return sp.dmg_formula;
    if (!s || !s.dmg) return "";
    if (s.dmg.slot) {
      const keys = Object.keys(s.dmg.slot).map(Number).sort((a, b) => a - b);
      const k = keys.filter((x) => x <= (slot || s.lvl)).pop() ?? keys[0];
      return String(s.dmg.slot[k]).replace(/\s*\+\s*MOD/i, "+" + R.abMod(doc, R.spellAbility(doc) || "int"));
    }
    if (s.dmg.char) {
      const lv = R.level(doc);
      const keys = Object.keys(s.dmg.char).map(Number).sort((a, b) => a - b);
      const k = keys.filter((x) => x <= lv).pop() ?? keys[0];
      return String(s.dmg.char[k]);
    }
    return "";
  };
  R.spellHeal = (doc, sp, slot) => {
    const s = R.srd?.spell[sp.srd];
    if (!s || !s.heal) return "";
    const keys = Object.keys(s.heal).map(Number).sort((a, b) => a - b);
    const k = keys.filter((x) => x <= (slot || s.lvl)).pop() ?? keys[0];
    return String(s.heal[k]).replace(/\s*\+\s*MOD/i, "+" + R.abMod(doc, R.spellAbility(doc) || "wis"));
  };

  // ---------------------------------------------------------------- классы и уровни
  R.classEntry = (cls, level = 1) => ({
    id: cls.id, name: "", sub: "", sub_name: "", level, hd: cls.hd, caster: cls.caster || null,
    ability: cls.spell_ability || null,
  });
  /** Умения класса (и подкласса) на уровне lv. */
  R.featuresAt = (clsId, subId, lv) => {
    const c = R.srd?.cls[clsId];
    if (!c) return [];
    const ids = [...(c.levels[lv - 1]?.f || [])];
    const sub = c.subclasses.find((s) => s.id === subId);
    if (sub && sub.levels[lv]) ids.push(...sub.levels[lv]);
    return ids.map((id) => R.srd.features[id] ? { id, ...R.srd.features[id] } : null).filter(Boolean);
  };
  R.featureEntry = (f, src) => ({ id: MC.uid(), name: f.en, src, desc: f.desc || "" });
  R.isAsiLevel = (clsId, lv) => (R.ASI_LEVELS[clsId] || R.ASI_LEVELS._).includes(lv);
  R.classResources = (clsId, lv) => {
    const cs = R.srd?.cls[clsId]?.levels?.[lv - 1]?.cs || {};
    const out = [];
    if (clsId === "barbarian" && cs.rage_count) out.push({ key: "rage", name: MC.lang === "ru" ? "Ярость" : "Rage", max: cs.rage_count >= 99 ? 99 : cs.rage_count, reset: "long" });
    if (clsId === "monk" && cs.ki_points) out.push({ key: "ki", name: MC.lang === "ru" ? "Очки ци" : "Ki points", max: cs.ki_points, reset: "short" });
    if (clsId === "sorcerer" && cs.sorcery_points) out.push({ key: "sorcery", name: MC.lang === "ru" ? "Единицы чародейства" : "Sorcery points", max: cs.sorcery_points, reset: "long" });
    if (clsId === "cleric" && cs.channel_divinity_charges) out.push({ key: "channel", name: MC.lang === "ru" ? "Божественный канал" : "Channel Divinity", max: cs.channel_divinity_charges, reset: "short" });
    if (clsId === "paladin" && lv >= 3) out.push({ key: "channel", name: MC.lang === "ru" ? "Божественный канал" : "Channel Divinity", max: 1, reset: "short" });
    if (clsId === "fighter") {
      out.push({ key: "second-wind", name: MC.lang === "ru" ? "Второе дыхание" : "Second Wind", max: 1, reset: "short" });
      if (cs.action_surges) out.push({ key: "action-surge", name: MC.lang === "ru" ? "Всплеск действий" : "Action Surge", max: cs.action_surges, reset: "short" });
      if (cs.indomitable_uses) out.push({ key: "indomitable", name: MC.lang === "ru" ? "Упорный" : "Indomitable", max: cs.indomitable_uses, reset: "long" });
    }
    if (clsId === "bard") out.push({ key: "bardic", name: MC.lang === "ru" ? "Вдохновение барда" : "Bardic Inspiration", max: -1, reset: lv >= 5 ? "short" : "long", note: cs.bardic_inspiration_die ? "d" + cs.bardic_inspiration_die : "" });
    if (clsId === "paladin") out.push({ key: "lay-on-hands", name: MC.lang === "ru" ? "Наложение рук" : "Lay on Hands", max: lv * 5, reset: "long" });
    if (clsId === "wizard") out.push({ key: "arcane-recovery", name: MC.lang === "ru" ? "Магическое восстановление" : "Arcane Recovery", max: 1, reset: "long" });
    if (clsId === "druid" && lv >= 2) out.push({ key: "wild-shape", name: MC.lang === "ru" ? "Дикий облик" : "Wild Shape", max: 2, reset: "short" });
    return out;
  };
  /** Добавить / обновить ресурсы класса в листе (операции). */
  R.syncResourceOps = (doc, clsId, lv) => {
    const ops = [];
    for (const r of R.classResources(clsId, lv)) {
      const key = clsId + ":" + r.key;
      let max = r.max;
      if (max === -1) max = Math.max(1, R.abMod(doc, "cha"));
      const ex = (doc.resources || []).find((x) => x.key === key);
      if (ex) {
        if (MC.int(ex.max, 0) !== max) ops.push({ op: "set", path: ["resources", ex.id, "max"], value: max });
        if (ex.reset !== r.reset) ops.push({ op: "set", path: ["resources", ex.id, "reset"], value: r.reset });
      } else {
        ops.push({ op: "add", path: ["resources"], value: { id: MC.uid(), key, name: r.name + (r.note ? ` (${r.note})` : ""), max, used: 0, reset: r.reset } });
      }
    }
    return ops;
  };
})();
