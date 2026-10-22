// Masters Compendium — общий склад партии, лавка и припасы.
//  • склад: добыча, которую ещё не разобрали; игроки кладут свои вещи и берут себе, деньги кладут/берут,
//    мастер добавляет и делит деньги поровну;
//  • лавка: мастер открывает лавку с товарами и ценами, игроки покупают сами, продают — только с разрешения мастера;
//  • припасы: у кого сколько еды, воды, факелов и боеприпасов (если учёт включён в «Мире»).
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const T = (MC.Trade = { stash: { items: [], coins: {} }, shop: { open: false } });
  const gm = () => MC.isGM();
  const R = () => MC.R;
  const req = (o) => MC.request(o, 12000).catch((e) => { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; });
  const Money = () => MC.Money;
  const DEF_RATE = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

  /** Цена из справочника «15 gp» → в самых мелких монетах. */
  T.srdPrice = (s) => {
    const m = String(s?.cost || "").match(/([\d.,]+)\s*(pp|gp|ep|sp|cp)/i);
    if (!m) return 0;
    return Math.round(parseFloat(m[1].replace(",", ".")) * DEF_RATE[m[2].toLowerCase()]);
  };
  /** Цена (в мелких) → «2 зм 5 см». */
  T.fmt = (base) => {
    const units = Money().units();
    let rest = Math.max(0, Math.round(base));
    const parts = [];
    for (const u of units.slice().sort((a, b) => b.rate - a.rate)) {
      const n = Math.floor(rest / u.rate);
      if (n) { parts.push(`${n} ${Money().short(u)}`); rest -= n * u.rate; }
    }
    return parts.join(" ") || `0 ${Money().short(units[units.length - 1])}`;
  };
  const myChars = () => [...MC.state.chars.values()].filter((c) => gm() || c.owner === MC.state.me?.id);
  async function docOf(id) {
    let d = MC.state.docs.get(id);
    if (!d) { try { d = (await MC.request({ t: "char_get", id })).char; } catch { d = null; } }
    return d;
  }
  async function pickChar(titleKey) {
    const list = myChars();
    if (!list.length) { MC.toast(t("give.no_chars"), "warn"); return null; }
    if (list.length === 1) return list[0];
    const v = await MC.modal({ title: t(titleKey), body: `<div class="pick-list">${list.map((c) => `<button class="btn menu-btn" data-pick="${c.id}">${MC.icon("user")}<span>${esc(c.name)}</span></button>`).join("")}</div>`,
      mount: (m, close) => m.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) close(b.dataset.pick); }) });
    return list.find((c) => c.id === v) || null;
  }
  const attackFor = (it) => (it.kind === "weapon" && it.dmg ? R().attackFromItem(it) : null);
  const itemLine = (it) => [it.kind === "weapon" && it.dmg ? `${it.dmg} ${R().dmgType(it.dtype)}` : "", it.kind === "armor" || it.kind === "shield" ? `${t("st.ac")} ${it.kind === "shield" ? "+" : ""}${it.ac}` : "", it.notes].filter(Boolean).join(" · ");

  // ---------------------------------------------------------------- склад (в «Партии»)
  function stashHtml() {
    const s = T.stash;
    const coins = Money().units().filter((u) => MC.int(s.coins?.[u.id], 0)).map((u) => `${MC.int(s.coins[u.id], 0)} ${esc(Money().short(u))}`).join(", ");
    return `<h2 class="section with-act">${MC.icon("inventory", "sm")} ${t("st.title")}
        <span class="row-btns">${gm() ? `<button class="btn small" data-tr="st_add">${MC.icon("plus", "sm")} ${t("st.add")}</button>` : ""}
        <button class="btn small" data-tr="st_put">${MC.icon("upload", "sm")} ${t("st.put")}</button></span></h2>
      <div class="card glass st-box">
        <div class="st-coins">${MC.icon("coins", "sm")} <b>${coins || t("st.no_coins")}</b>
          <span class="row-btns"><button class="btn small" data-tr="st_coin_in">${t("st.coin_in")}</button><button class="btn small" data-tr="st_coin_out" ${coins ? "" : "disabled"}>${t("st.coin_out")}</button>
          ${gm() && coins ? `<button class="btn small" data-tr="st_split">${t("st.split")}</button>` : ""}</span></div>
        <ul class="st-items">${(s.items || []).map((it) => `<li><span class="st-n"><b>${esc(it.name)}</b>${it.qty !== 1 ? ` ×${it.qty}` : ""}<small class="muted">${esc(itemLine(it))}${it.by ? ` · ${esc(it.by)}` : ""}</small></span>
          <button class="btn small" data-trtake="${it.id}">${t("st.take")}</button>${gm() ? `<button class="icon-btn small" data-trdel="${it.id}">${MC.icon("trash", "sm")}</button>` : ""}</li>`).join("")
        || `<li class="muted small">${t("st.empty")}</li>`}</ul></div>`;
  }
  // ---------------------------------------------------------------- лавка (в «Партии» — когда открыта)
  function shopHtml() {
    const s = T.shop;
    if (!s.open) return "";
    const rate = MC.int(s.rate, 50);
    return `<h2 class="section with-act">${MC.icon("coins", "sm")} ${esc(s.name || t("shop.title"))}
        <button class="btn small" data-tr="sell">${MC.icon("upload", "sm")} ${t("shop.sell")}</button></h2>
      <div class="card glass shop-box"><p class="muted small">${t("shop.hint", { n: rate })}</p>
        <ul class="st-items">${(s.items || []).map((it) => `<li><span class="st-n"><b>${esc(it.name)}</b><small class="muted">${esc(itemLine(it))}${it.stock >= 0 ? ` · ${t("shop.stock", { n: it.stock })}` : ""}</small></span>
          <span class="shop-price">${esc(T.fmt(it.price))}</span><button class="btn small primary" data-trbuy="${it.id}" ${it.stock === 0 ? "disabled" : ""}>${t("shop.buy")}</button></li>`).join("")
        || `<li class="muted small">${t("shop.empty")}</li>`}</ul></div>`;
  }
  // ---------------------------------------------------------------- припасы
  const SUP = { ration: /рацион|паёк|паек|ration/i, water: /бурдюк|вода|waterskin|water/i, torch: /факел|torch/i, ammo: /стрел|arrow|болт|bolt|снаряд|bullet|игл|needle/i };
  function suppliesHtml() {
    if (!MC.World?.w?.supplies) return "";
    const pids = new Set(MC.state.players.map((p) => p.id));
    const chars = [...MC.state.chars.values()].filter((c) => pids.has(c.owner) && (gm() || c.owner === MC.state.me?.id));
    const rows = chars.map((c) => {
      const d = MC.state.docs.get(c.id);
      if (!d) { MC.send({ t: "char_get", id: c.id }); return `<tr><td>${esc(c.name)}</td><td colspan="4" class="muted">…</td></tr>`; }
      const cnt = (rx) => (d.inventory || []).filter((it) => rx.test(it.name || it.srd || "")).reduce((s, it) => s + MC.num(it.qty, 1), 0);
      const cell = (n, warn) => `<td class="${n <= 0 ? "bad-text" : n <= warn ? "warn-text" : ""}">${n}</td>`;
      return `<tr><td>${esc(c.name)}</td>${cell(cnt(SUP.ration), 2)}${cell(cnt(SUP.water), 1)}${cell(cnt(SUP.torch), 1)}${cell(cnt(SUP.ammo), 5)}</tr>`;
    }).join("");
    return chars.length ? `<h2 class="section">${MC.icon("tent", "sm")} ${t("sup.title")}</h2>
      <div class="card glass"><table class="sup-table"><tr><th></th><th>${t("sup.k.ration")}</th><th>${t("sup.k.water")}</th><th>${t("sup.k.torch")}</th><th>${t("sup.k.ammo")}</th></tr>${rows}</table>
      <p class="muted small">${t("sup.party_hint")}</p></div>` : "";
  }
  function renderParty() {
    const box = $("#trade");
    if (!box) return;
    box.innerHTML = suppliesHtml() + shopHtml() + stashHtml();
  }
  T.renderParty = renderParty;

  // ---------------------------------------------------------------- мастер: раздел «Торговля»
  let q = "";
  function gmHtml() {
    const s = T.shop;
    return `<div class="card glass trade-gm">
      <div class="row-btns"><label class="check"><input type="checkbox" data-shop="open" ${s.open ? "checked" : ""}> <b>${t("shop.open")}</b></label>
        <input id="shop-name" value="${esc(s.name || "")}" placeholder="${esc(t("shop.name_ph"))}">
        <label class="shop-rate">${t("shop.rate")} <input id="shop-rate" type="number" min="0" max="100" value="${MC.int(s.rate, 50)}">%</label></div>
      <p class="muted small">${t("shop.gm_hint")}</p>
      <div class="search-bar"><input type="search" id="shop-q" value="${esc(q)}" placeholder="${esc(t("give.search"))}"></div>
      <ul class="pick-list-v" id="shop-found">${foundHtml()}</ul>
      <div class="row-btns"><button class="btn small" data-tr="shop_custom">${MC.icon("pen", "sm")} ${t("give.custom")}</button>
        <button class="btn small" data-tr="shop_kit">${MC.icon("inventory", "sm")} ${t("shop.kit")}</button></div>
      <h4>${t("shop.goods")} (${(s.items || []).length})</h4>
      <ul class="shop-edit">${(s.items || []).map((it) => `<li data-sid="${it.id}"><b>${esc(it.name)}</b>
        <label>${t("shop.price")} <input type="number" min="0" data-sp="price" value="${(it.price / 100).toFixed(2).replace(/\.00$/, "")}"> ${esc(Money().short(Money().units().find((u) => u.rate === 100) || Money().units()[0]))}</label>
        <label>${t("shop.stock_l")} <input type="number" min="-1" data-sp="stock" value="${it.stock}"></label>
        <button class="icon-btn small" data-spdel="${it.id}">${MC.icon("trash", "sm")}</button></li>`).join("") || `<li class="muted small">${t("shop.empty")}</li>`}</ul>
      <p class="muted small">${t("shop.stock_hint")}</p></div>`;
  }
  function foundHtml() {
    const qq = q.trim().toLowerCase();
    if (qq.length < 2) return "";
    return R().srd.items.filter((s) => s.ru.toLowerCase().includes(qq) || s.en.toLowerCase().includes(qq)).slice(0, 12)
      .map((s) => `<li class="pick-row" data-shopadd="${s.id}"><span class="pr-check">${MC.icon("plus", "sm")}</span><span class="pr-name">${esc(MC.L(s))}</span><span class="muted small">${esc(T.fmt(T.srdPrice(s)))}</span></li>`).join("");
  }
  const shopSave = (patch) => req({ t: "shop_set", ...patch });
  function addToShop(list) {
    const items = [...(T.shop.items || []), ...list];
    T.shop.items = items;
    shopSave({ items });
  }
  // набор «снаряжение для похода» одной кнопкой
  const KIT = ["rations-1-day", "waterskin", "torch", "arrow", "crossbow-bolt", "rope-hempen-50-feet", "healers-kit", "bedroll", "tinderbox", "backpack", "dagger", "shortsword", "longsword", "shortbow", "longbow", "crossbow-light", "leather-armor", "chain-shirt", "shield"];
  MC.GM?.addSub({ id: "trade", ic: "coins", label: "shop.tab", html: gmHtml });

  // ---------------------------------------------------------------- клики
  document.addEventListener("click", async (e) => {
    const sa = e.target.closest("[data-shopadd]");
    if (sa) {
      const s = R().srd.item[sa.dataset.shopadd];
      if (s) { const it = R().itemFromSrd(s, 1); delete it.id; addToShop([{ ...it, id: MC.uid(), price: T.srdPrice(s), stock: -1 }]); }
      return;
    }
    const sd = e.target.closest("[data-spdel]");
    if (sd) { const items = (T.shop.items || []).filter((x) => x.id !== sd.dataset.spdel); T.shop.items = items; shopSave({ items }); return; }
    const tb = e.target.closest("[data-trbuy]");
    if (tb) { buy(tb.dataset.trbuy); return; }
    const tk = e.target.closest("[data-trtake]");
    if (tk) { take(tk.dataset.trtake); return; }
    const td = e.target.closest("[data-trdel]");
    if (td) { if (await MC.confirm(t("st.del_q"))) req({ t: "stash_del", sid: td.dataset.trdel }); return; }
    const b = e.target.closest("[data-tr]");
    if (!b) return;
    const k = b.dataset.tr;
    if (k === "st_put") put();
    if (k === "st_coin_in" || k === "st_coin_out") coinMove(k === "st_coin_in");
    if (k === "st_split" && await MC.confirm(t("st.split_q"))) req({ t: "stash_split" });
    if (k === "st_add") stashAdd();
    if (k === "sell") sell();
    if (k === "shop_custom") customShop();
    if (k === "shop_kit") {
      const have = new Set((T.shop.items || []).map((x) => x.srd));
      addToShop(KIT.map((id) => R().srd.item[id]).filter((s) => s && !have.has(s.id)).map((s) => { const it = R().itemFromSrd(s, 1); return { ...it, id: MC.uid(), price: T.srdPrice(s), stock: -1 }; }));
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches('[data-shop="open"]')) shopSave({ open: e.target.checked, name: $("#shop-name")?.value || "" });
    if (e.target.id === "shop-name") shopSave({ name: e.target.value });
    if (e.target.id === "shop-rate") shopSave({ rate: MC.int(e.target.value, 50) });
    const sp = e.target.closest("[data-sp]");
    if (sp) {
      const id = sp.closest("[data-sid]").dataset.sid;
      const items = (T.shop.items || []).map((x) => (x.id !== id ? x : { ...x, [sp.dataset.sp]: sp.dataset.sp === "price" ? Math.round(MC.num(sp.value, 0) * 100) : MC.int(sp.value, -1) }));
      T.shop.items = items;
      shopSave({ items });
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "shop-q") return;
    q = e.target.value;
    const f = $("#shop-found"); if (f) f.innerHTML = foundHtml();
  });

  async function buy(id) {
    const it = (T.shop.items || []).find((x) => x.id === id);
    const c = it && await pickChar("shop.who_buys");
    if (!c) return;
    const d = await docOf(c.id);
    const v = await MC.modal({ title: it.name, body: `<p>${t("shop.price")}: <b>${esc(T.fmt(it.price))}</b></p>
      <label class="field"><span>${t("inv.qty")}</span><input name="n" type="number" min="1" value="1"></label>
      <p class="muted small">${t("shop.have", { m: esc(Money().fmt(d?.coins || {}) || "—") })}</p>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("shop.buy"), kind: "primary", value: (w) => MC.int(w.querySelector("[name=n]").value, 1) }] });
    if (!v) return;
    const r = await req({ t: "shop_buy", char: c.id, id, qty: v, attack: attackFor(it) });
    if (r) MC.toast(t("shop.bought", { what: it.name, price: T.fmt(r.paid) }), "ok", "coins");
  }
  async function sell() {
    const c = await pickChar("shop.who_sells");
    if (!c) return;
    const d = await docOf(c.id);
    const inv = (d?.inventory || []).filter((x) => MC.num(x.qty, 1) > 0);
    if (!inv.length) { MC.toast(t("inv.empty"), "warn"); return; }
    const rate = MC.int(T.shop.rate, 50) / 100;
    const est = (it) => Math.round((it.srd ? T.srdPrice(R().srd.item[it.srd]) : 0) * rate);
    const v = await MC.modal({ title: t("shop.sell"), body: `<label class="field full"><span>${t("shop.what")}</span><select name="it">${inv.map((it) => `<option value="${it.id}">${esc(R().itemName(it))}${MC.num(it.qty, 1) !== 1 ? " ×" + it.qty : ""}</option>`).join("")}</select></label>
      <div class="form-grid"><label class="field"><span>${t("inv.qty")}</span><input name="n" type="number" min="1" value="1"></label>
      <label class="field"><span>${t("shop.ask")}</span><input name="p" type="number" min="0" step="0.01" value="${(est(inv[0]) / 100).toFixed(2).replace(/\.00$/, "")}"></label></div>
      <p class="muted small">${t("shop.sell_hint")}</p>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("shop.offer"), kind: "primary", value: (w) => ({ item: w.querySelector("[name=it]").value, qty: MC.int(w.querySelector("[name=n]").value, 1), price: Math.round(MC.num(w.querySelector("[name=p]").value, 0) * 100) }) }],
      mount: (m) => m.querySelector("[name=it]").addEventListener("change", (e) => { const it = inv.find((x) => x.id === e.target.value); m.querySelector("[name=p]").value = (est(it) / 100).toFixed(2).replace(/\.00$/, ""); }) });
    if (!v) return;
    const r = await req({ t: "shop_sell", char: c.id, ...v });
    if (r?.pending) MC.toast(t("dec.wait"), "warn", "hourglass");
  }
  async function take(sid) {
    const it = (T.stash.items || []).find((x) => x.id === sid);
    const c = it && await pickChar("st.who_takes");
    if (!c) return;
    let n = it.qty;
    if (it.qty > 1) {
      n = await MC.askNumber(t("st.how_many", { n: it.qty }), String(it.qty));
      if (!n) return;
    }
    const r = await req({ t: "stash_take", char: c.id, sid, qty: n, attack: attackFor(it) });
    if (r) MC.toast(t("st.taken", { what: it.name }), "ok", "inventory");
  }
  async function put() {
    const c = await pickChar("st.who_puts");
    if (!c) return;
    const d = await docOf(c.id);
    const inv = (d?.inventory || []).filter((x) => MC.num(x.qty, 1) > 0);
    if (!inv.length) { MC.toast(t("inv.empty"), "warn"); return; }
    const v = await MC.modal({ title: t("st.put"), body: `<label class="field full"><span>${t("shop.what")}</span><select name="it">${inv.map((it) => `<option value="${it.id}">${esc(R().itemName(it))}${MC.num(it.qty, 1) !== 1 ? " ×" + it.qty : ""}</option>`).join("")}</select></label>
      <label class="field"><span>${t("inv.qty")}</span><input name="n" type="number" min="1" value="1"></label>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("st.put"), kind: "primary", value: (w) => ({ item: w.querySelector("[name=it]").value, qty: MC.num(w.querySelector("[name=n]").value, 1) }) }] });
    if (!v) return;
    if (await req({ t: "stash_put", char: c.id, ...v })) MC.toast(t("st.put_done"), "ok", "inventory");
  }
  async function coinMove(deposit) {
    const c = await pickChar(deposit ? "st.who_puts" : "st.who_takes");
    if (!c) return;
    const units = Money().units();
    const v = await MC.modal({ title: t(deposit ? "st.coin_in" : "st.coin_out"), body: `<div class="form-grid"><label class="field"><span>${t("money.amount")}</span><input name="n" type="number" min="1" value="1"></label>
      <label class="field"><span>${t("money.give")}</span><select name="u">${units.map((u) => `<option value="${u.id}" ${u.rate === 100 ? "selected" : ""}>${esc(Money().full(u))}</option>`).join("")}</select></label></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("ok"), kind: "primary", value: (w) => ({ n: MC.int(w.querySelector("[name=n]").value, 0), unit: w.querySelector("[name=u]").value }) }] });
    if (!v || !v.n) return;
    req({ t: "stash_coin", char: c.id, unit: v.unit, n: deposit ? v.n : -v.n });
  }
  async function stashAdd() {
    const v = await MC.modal({ title: t("st.add"), body: `<div class="form-grid">
        <label class="field"><span>${t("atk.name")}</span><input name="nm" autofocus></label>
        <label class="field"><span>${t("inv.kind")}</span><select name="kind">${["gear", "consumable", "weapon", "armor", "shield"].map((k) => `<option value="${k}">${t("inv.kind." + k)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("inv.qty")}</span><input name="qty" type="number" min="1" value="1"></label>
        <label class="field"><span>${t("atk.dmg")}</span><input name="dmg" placeholder="1d8"></label>
        <label class="field full"><span>${t("inv.notes")}</span><input name="notes"></label></div>
        <h4>${t("give.money")}</h4><div class="coins">${Money().units().map((u) => `<label class="coin"><span>${esc(Money().short(u))}</span><input type="number" data-sc="${u.id}" value="0"></label>`).join("")}</div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("st.add"), kind: "primary", value: (w) => ({
        item: w.querySelector("[name=nm]").value.trim() ? { name: w.querySelector("[name=nm]").value.trim(), kind: w.querySelector("[name=kind]").value, qty: MC.int(w.querySelector("[name=qty]").value, 1),
          dmg: w.querySelector("[name=dmg]").value.trim(), notes: w.querySelector("[name=notes]").value.trim() } : null,
        coins: Object.fromEntries([...w.querySelectorAll("[data-sc]")].map((x) => [x.dataset.sc, MC.int(x.value, 0)]).filter(([, n]) => n > 0)) }) }] });
    if (!v || (!v.item && !Object.keys(v.coins).length)) return;
    req({ t: "stash_add", item: v.item, coins: v.coins });
  }
  async function customShop() {
    const v = await MC.modal({ title: t("give.custom"), body: `<div class="form-grid">
        <label class="field"><span>${t("atk.name")}</span><input name="nm" autofocus></label>
        <label class="field"><span>${t("inv.kind")}</span><select name="kind">${["gear", "consumable", "weapon", "armor", "shield"].map((k) => `<option value="${k}">${t("inv.kind." + k)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("shop.price")} (${esc(Money().short(Money().units().find((u) => u.rate === 100) || Money().units()[0]))})</span><input name="p" type="number" min="0" step="0.01" value="1"></label>
        <label class="field"><span>${t("atk.dmg")}</span><input name="dmg" placeholder="1d8"></label>
        <label class="field full"><span>${t("inv.notes")}</span><input name="notes"></label></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("give.add"), kind: "primary", value: (w) => ({ name: w.querySelector("[name=nm]").value.trim(), kind: w.querySelector("[name=kind]").value,
        price: Math.round(MC.num(w.querySelector("[name=p]").value, 0) * 100), dmg: w.querySelector("[name=dmg]").value.trim(), notes: w.querySelector("[name=notes]").value.trim() }) }] });
    if (!v || !v.name) return;
    addToShop([{ id: MC.uid(), name: v.name, kind: v.kind, qty: 1, w: 0, notes: v.notes, ...(v.kind === "weapon" ? { dmg: v.dmg || "1d4", dtype: "", props: [], range: "melee" } : {}), price: v.price, stock: -1 }]);
  }

  // ---------------------------------------------------------------- сообщения
  MC.on("msg_stash", (m) => { T.stash = m.stash || T.stash; renderParty(); });
  MC.on("msg_shop", (m) => {
    const was = T.shop.open;
    T.shop = m.shop || { open: false };
    renderParty();
    if (MC.GM?.sub === "trade" && document.querySelector(".tab.active")?.dataset.tab === "gm" && !document.activeElement?.closest?.(".trade-gm")) MC.GM.render();
    if (!gm() && !was && T.shop.open) MC.toast(t("shop.opened", { name: T.shop.name || t("shop.title") }), "ok", "coins");
  });
  MC.on("msg_shop_sell_req", (m) => {
    if (!gm() || MC.pop) return;
    const el = document.createElement("div");
    el.className = "cb-notice endreq glass";
    el.id = "dec-" + m.id;
    el.innerHTML = `<div class="cbn-ic">${MC.icon("coins")}</div>
      <div class="cbn-text"><b>${t("shop.sell_req", { who: esc(m.who) })}</b><span class="muted small">${esc(m.what)}${m.qty > 1 ? " ×" + m.qty : ""} → ${esc(T.fmt(m.price))}</span></div>
      <div class="cbn-act"><button class="btn small primary" data-dec="ok" data-id="${m.id}">${MC.icon("check", "sm")} ${t("dec.ok")}</button>
        <button class="btn small" data-dec="no" data-id="${m.id}">${MC.icon("x", "sm")} ${t("dec.no")}</button></div>`;
    document.body.appendChild(el);
  });
  MC.on("msg_shop_sell_res", (m) => MC.toast(m.ok ? t("shop.sold", { what: m.what, price: T.fmt(m.price) }) : t("shop.sell_no", { what: m.what }), m.ok ? "ok" : "warn", "coins"));
  MC.on("welcome", () => {
    MC.request({ t: "stash_get" }).then((r) => { T.stash = r.stash; renderParty(); }).catch(() => {});
    MC.request({ t: "shop_get" }).then((r) => { T.shop = r.shop || { open: false }; renderParty(); }).catch(() => {});
  });
  MC.on("chars", renderParty);
  MC.on("doc", renderParty);
  MC.on("currency", renderParty);
  MC.on("msg_world", renderParty);
  MC.on("lang", renderParty);
})();
