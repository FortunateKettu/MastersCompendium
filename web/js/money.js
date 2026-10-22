// Masters Compendium — деньги и выдача предметов.
//  • валюта кампании: мастер задаёт монеты (название, полное имя, курс в самых мелких единицах);
//  • в листе персонажа — монеты по этой валюте и обмен одной монеты на другую;
//  • мастер выдаёт персонажам предметы, оружие, расходники и деньги — они сразу попадают в инвентарь,
//    а игрок получает раздатку «Получено: …».
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const R = MC.R;
  const Money = (MC.Money = {});
  const DEFAULT = [{ id: "pp", rate: 1000 }, { id: "gp", rate: 100 }, { id: "ep", rate: 50 }, { id: "sp", rate: 10 }, { id: "cp", rate: 1 }];
  let units = DEFAULT.map((u) => ({ ...u, name: "", full: "" }));

  Money.units = () => units;
  Money.short = (u) => u.name || (["pp", "gp", "ep", "sp", "cp"].includes(u.id) ? t("coin." + u.id) : u.id.toUpperCase());
  Money.full = (u) => u.full || (["pp", "gp", "ep", "sp", "cp"].includes(u.id) ? t("coin." + u.id + ".full") : Money.short(u));
  /** Всего в самых мелких единицах. */
  Money.total = (coins) => units.reduce((s, u) => s + MC.int(coins?.[u.id], 0) * u.rate, 0);
  Money.fmt = (coins) => units.filter((u) => MC.int(coins?.[u.id], 0)).map((u) => `${MC.int(coins[u.id], 0)} ${Money.short(u)}`).join(", ");

  // ---------------------------------------------------------------- монеты в листе
  Money.coinsHtml = (doc) => {
    const known = new Set(units.map((u) => u.id));
    // монеты старой валюты (мастер переименовал/удалил) — тоже показываем, чтобы не потерялись
    const extra = Object.keys(doc.coins || {}).filter((k) => !known.has(k) && MC.int(doc.coins[k], 0));
    return units.map((u, i) => `<label class="coin c-${esc(u.id)} cn-${i}" title="${esc(Money.full(u))}"><span>${esc(Money.short(u))}</span>
        <input type="number" inputmode="numeric" data-set="coins.${esc(u.id)}" data-type="int" value="${MC.int(doc.coins?.[u.id], 0)}"></label>`).join("")
      + extra.map((k) => `<label class="coin"><span>${esc(k)}</span><input type="number" data-set="coins.${esc(k)}" data-type="int" value="${MC.int(doc.coins[k], 0)}"></label>`).join("");
  };

  /** Обмен: n монет «from» → столько «to», сколько получится; остаток раскладываем по мелким монетам. */
  Money.exchange = (coins, from, to, n) => {
    const uf = units.find((u) => u.id === from), ut = units.find((u) => u.id === to);
    if (!uf || !ut || from === to) return null;
    n = MC.clamp(MC.int(n, 0), 0, MC.int(coins?.[from], 0));
    if (!n) return null;
    let base = n * uf.rate;
    const got = Math.floor(base / ut.rate);
    base -= got * ut.rate;
    const delta = { [from]: -n, [to]: got };
    for (const u of units.filter((x) => x.rate < ut.rate).sort((a, b) => b.rate - a.rate)) {
      const k = Math.floor(base / u.rate);
      if (k) { delta[u.id] = (delta[u.id] || 0) + k; base -= k * u.rate; }
    }
    return { delta, got };
  };
  Money.exchangeDialog = async (doc, patch) => {
    const opt = (sel) => units.map((u) => `<option value="${esc(u.id)}" ${u.id === sel ? "selected" : ""}>${esc(Money.full(u))} (${esc(Money.short(u))})</option>`).join("");
    const firstHave = units.find((u) => MC.int(doc.coins?.[u.id], 0) > 0)?.id || units[0].id;
    const v = await MC.modal({ title: t("money.exchange"), body: `<div class="form-grid">
        <label class="field"><span>${t("money.give")}</span><select name="from">${opt(firstHave)}</select></label>
        <label class="field"><span>${t("money.amount")}</span><input name="n" type="number" min="1" value="1"></label>
        <label class="field full"><span>${t("money.get")}</span><select name="to">${opt(units[units.length > 1 ? 1 : 0].id)}</select></label></div>
        <p class="money-prev" id="mx-prev"></p><p class="muted small">${t("money.rates")}: ${units.map((u) => `1 ${esc(Money.short(u))} = ${u.rate}`).join(" · ")} ${esc(Money.short(units[units.length - 1]))}</p>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("money.do"), kind: "primary", value: (w) => ({ from: w.querySelector("[name=from]").value, to: w.querySelector("[name=to]").value, n: w.querySelector("[name=n]").value }) }],
      mount: (m) => {
        const upd = () => {
          const from = m.querySelector("[name=from]").value, to = m.querySelector("[name=to]").value, n = m.querySelector("[name=n]").value;
          const r = Money.exchange(doc.coins, from, to, n);
          const have = MC.int(doc.coins?.[from], 0);
          m.querySelector("#mx-prev").innerHTML = r ? `${MC.icon("refresh", "sm")} ${Object.entries(r.delta).map(([k, d]) => `<b class="${d < 0 ? "bad-text" : "good-text"}">${d > 0 ? "+" : ""}${d} ${esc(Money.short(units.find((u) => u.id === k)))}</b>`).join(" ")}`
            : `<span class="muted">${t("money.have", { n: have })}</span>`;
        };
        m.addEventListener("input", upd); m.addEventListener("change", upd); upd();
      } });
    if (!v) return;
    const r = Money.exchange(doc.coins, v.from, v.to, v.n);
    if (!r) { MC.toast(t("money.nothing"), "warn"); return; }
    patch(Object.entries(r.delta).map(([k, d]) => ({ op: "inc", path: ["coins", k], value: d })));
  };

  // ---------------------------------------------------------------- мастер: валюта
  Money.editor = async () => {
    let rows = units.map((u) => ({ ...u, name: u.name || Money.short(u), full: u.full || Money.full(u) }));
    const html = () => rows.map((u, i) => `<div class="cur-row" data-i="${i}">
        <input data-k="name" value="${esc(u.name)}" placeholder="${esc(t("money.short"))}" maxlength="12">
        <input data-k="full" value="${esc(u.full)}" placeholder="${esc(t("money.full"))}" maxlength="30">
        <label class="cur-rate"><span>=</span><input data-k="rate" type="number" min="1" value="${u.rate}"></label>
        <button type="button" class="icon-btn small" data-curdel="${i}" ${rows.length < 2 ? "disabled" : ""}>${MC.icon("trash", "sm")}</button></div>`).join("");
    const v = await MC.modal({ title: t("money.cur_title"), wide: true, body: `<p class="muted small">${t("money.cur_hint")}</p>
        <div class="cur-head muted small"><span>${t("money.short")}</span><span>${t("money.full")}</span><span>${t("money.rate")}</span></div>
        <div id="cur-rows">${html()}</div>
        <div class="row-btns"><button type="button" class="btn small" data-curadd>${MC.icon("plus", "sm")} ${t("money.add")}</button>
          <button type="button" class="btn small" data-curreset>${MC.icon("refresh", "sm")} ${t("money.reset")}</button></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("save"), kind: "primary", value: () => rows }],
      mount: (m) => {
        const box = m.querySelector("#cur-rows");
        m.addEventListener("input", (e) => {
          const r = e.target.closest(".cur-row");
          if (!r) return;
          const u = rows[+r.dataset.i], k = e.target.dataset.k;
          u[k] = k === "rate" ? Math.max(1, MC.int(e.target.value, 1)) : e.target.value;
        });
        m.addEventListener("click", (e) => {
          const d = e.target.closest("[data-curdel]");
          if (d) { rows.splice(+d.dataset.curdel, 1); box.innerHTML = html(); }
          if (e.target.closest("[data-curadd]") && rows.length < 8) { rows.push({ id: "", name: "", full: "", rate: 1 }); box.innerHTML = html(); }
          if (e.target.closest("[data-curreset]")) { rows = DEFAULT.map((u) => ({ ...u, name: t("coin." + u.id), full: t("coin." + u.id + ".full") })); box.innerHTML = html(); }
        });
      } });
    if (!v) return;
    try { await MC.request({ t: "cur_set", units: v.filter((u) => u.name.trim()) }); MC.toast(t("money.saved"), "ok", "coins"); } catch { MC.toast(t("conn.offline"), "warn"); }
  };

  // ---------------------------------------------------------------- мастер: выдать предметы и деньги
  Money.giveDialog = async (pre = []) => {
    await R.load();
    const chars = [...MC.state.chars.values()];
    if (!chars.length) { MC.toast(t("give.no_chars"), "warn"); return; }
    const players = MC.state.players;
    const cart = [];        // {srd?, name, kind, qty, w, notes, dmg, dtype}
    let q = "";
    const ownerName = (c) => players.find((p) => p.id === c.owner)?.name || t("chars.npc");
    const found = () => (q.length < 2 ? [] : R.srd.items.filter((s) => s.ru.toLowerCase().includes(q) || s.en.toLowerCase().includes(q)).slice(0, 12));
    const cartHtml = () => cart.map((it, i) => `<li class="give-it"><span>${MC.icon(it.kind === "weapon" ? "sword" : it.kind === "armor" || it.kind === "shield" ? "armor" : it.kind === "consumable" ? "flask" : "inventory", "sm")}</span>
        <b>${esc(it.name)}</b><input type="number" min="1" value="${it.qty}" data-gq="${i}"><button type="button" class="icon-btn small" data-gdel="${i}">${MC.icon("x", "sm")}</button></li>`).join("")
      || `<li class="muted small">${t("give.cart_empty")}</li>`;
    const v = await MC.modal({ title: t("give.title"), wide: true, body: `
        <h4>${t("give.to")}</h4>
        <div class="give-chars">${chars.map((c) => `<label class="check"><input type="checkbox" name="gc" value="${c.id}" ${pre.includes(c.id) ? "checked" : ""}> <b>${esc(c.name)}</b> <span class="muted small">${esc(ownerName(c))}</span></label>`).join("")}</div>
        <h4>${t("give.items")}</h4>
        <div class="search-bar"><input type="search" id="give-q" placeholder="${esc(t("give.search"))}"></div>
        <ul class="pick-list-v give-found" id="give-found"></ul>
        <details class="give-custom"><summary>${MC.icon("pen", "sm")} ${t("give.custom")}</summary><div class="form-grid">
          <label class="field"><span>${t("atk.name")}</span><input id="gcu-name"></label>
          <label class="field"><span>${t("inv.kind")}</span><select id="gcu-kind">${["gear", "consumable", "weapon", "armor", "shield"].map((k) => `<option value="${k}">${t("inv.kind." + k)}</option>`).join("")}</select></label>
          <label class="field"><span>${t("inv.qty")}</span><input id="gcu-qty" type="number" min="1" value="1"></label>
          <label class="field"><span>${t("inv.weight")}</span><input id="gcu-w" type="number" step="0.1" min="0" value="0"></label>
          <label class="field"><span>${t("atk.dmg")}</span><input id="gcu-dmg" placeholder="1d8"></label>
          <label class="field full"><span>${t("inv.notes")}</span><input id="gcu-notes"></label></div>
          <button type="button" class="btn small" id="gcu-add">${MC.icon("plus", "sm")} ${t("give.add")}</button></details>
        <ul class="give-cart" id="give-cart">${cartHtml()}</ul>
        <h4>${t("give.money")}</h4>
        <div class="coins give-coins">${units.map((u) => `<label class="coin"><span>${esc(Money.short(u))}</span><input type="number" data-gcoin="${esc(u.id)}" value="0"></label>`).join("")}</div>
        <label class="field full"><span>${t("give.note")}</span><input id="give-note" placeholder="${esc(t("give.note_ph"))}"></label>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("give.go"), kind: "primary", value: (w) => ({
        chars: [...w.querySelectorAll("[name=gc]:checked")].map((x) => x.value),
        coins: Object.fromEntries([...w.querySelectorAll("[data-gcoin]")].map((x) => [x.dataset.gcoin, MC.int(x.value, 0)]).filter(([, n]) => n)),
        note: w.querySelector("#give-note").value.trim() }) }],
      mount: (m) => {
        const refresh = () => {
          m.querySelector("#give-found").innerHTML = found().map((s) => `<li class="pick-row" data-gsrd="${s.id}"><span class="pr-check">${MC.icon("plus", "sm")}</span>
            <span class="pr-name">${esc(MC.L(s))}</span><span class="muted small">${[s.dmg ? `${s.dmg} ${R.dmgType(s.dtype)}` : "", s.ac ? `${t("st.ac")} ${s.ac}` : "", s.cost].filter(Boolean).join(" · ")}</span></li>`).join("");
          m.querySelector("#give-cart").innerHTML = cartHtml();
        };
        m.querySelector("#give-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); refresh(); });
        m.addEventListener("input", (e) => { const qi = e.target.dataset.gq; if (qi != null) cart[+qi].qty = Math.max(1, MC.int(e.target.value, 1)); });
        m.addEventListener("click", (e) => {
          const s = e.target.closest("[data-gsrd]");
          if (s) { const it = R.srd.item[s.dataset.gsrd]; const was = cart.find((x) => x.srd === it.id); if (was) was.qty++; else cart.push({ srd: it.id, name: MC.L(it), kind: it.kind, qty: 1 }); refresh(); return; }
          const d = e.target.closest("[data-gdel]");
          if (d) { cart.splice(+d.dataset.gdel, 1); refresh(); return; }
          if (e.target.closest("#gcu-add")) {
            const g = (id) => m.querySelector(id).value;
            if (!g("#gcu-name").trim()) { m.querySelector("#gcu-name").focus(); return; }
            cart.push({ name: g("#gcu-name").trim(), kind: g("#gcu-kind"), qty: Math.max(1, MC.int(g("#gcu-qty"), 1)), w: MC.num(g("#gcu-w"), 0), dmg: g("#gcu-dmg").trim(), notes: g("#gcu-notes").trim() });
            m.querySelector("#gcu-name").value = ""; m.querySelector("#gcu-dmg").value = ""; m.querySelector("#gcu-notes").value = "";
            refresh();
          }
        });
      } });
    if (!v) return;
    if (!v.chars.length) { MC.toast(t("give.need_char"), "warn"); return; }
    if (!cart.length && !Object.keys(v.coins).length) { MC.toast(t("give.nothing"), "warn"); return; }
    for (const cid of v.chars) {
      const ops = [];
      for (const c of cart) {
        let it;
        if (c.srd) it = R.itemFromSrd(R.srd.item[c.srd], c.qty);
        else it = { id: MC.uid(), srd: "", name: c.name, qty: c.qty, w: c.w || 0, kind: c.kind, equipped: false, notes: c.notes || "",
          ...(c.kind === "weapon" ? { dmg: c.dmg || "1d4", dtype: "", props: [], range: "melee" } : {}),
          ...(c.kind === "armor" || c.kind === "shield" ? { ac: c.kind === "shield" ? 2 : 11, acat: "light", dex: true, maxdex: null } : {}) };
        ops.push({ op: "add", path: ["inventory"], value: it });
        if (it.kind === "weapon" && it.dmg) ops.push({ op: "add", path: ["attacks"], value: R.attackFromItem(it) });
      }
      for (const [k, n] of Object.entries(v.coins)) ops.push({ op: "inc", path: ["coins", k], value: n });
      MC.send({ t: "char_patch", id: cid, ops, rid: MC.uid() });
    }
    // раздатка «Получено» — игроку приходит уведомление, остаётся в истории
    const what = [...cart.map((c) => `${c.name}${c.qty > 1 ? " ×" + c.qty : ""}`), Money.fmt(v.coins)].filter(Boolean);
    const names = v.chars.map((id) => MC.state.chars.get(id)?.name).filter(Boolean);
    const owners = [...new Set(v.chars.map((id) => MC.state.chars.get(id)?.owner).filter((o) => o && players.some((p) => p.id === o)))];
    const id = MC.uid();
    try {
      await MC.request({ t: "ho_save", handout: { id, title: t("give.ho_title", { what: what.join(", ").slice(0, 80) }),
        text: `${t("give.ho_to", { names: names.join(", ") })}\n\n${what.map((x) => "• " + x).join("\n")}${v.note ? "\n\n" + v.note : ""}` } });
      if (owners.length) await MC.request({ t: "ho_share", id, to: owners });
    } catch { /* выдача уже прошла — раздатка не критична */ }
    MC.send({ t: "chron_add", k: "give", text: `${names.join(", ")}: ${what.join(", ")}`.slice(0, 300) });
    MC.toast(t("give.done", { n: v.chars.length }), "ok", "inventory");
  };

  MC.on("msg_currency", (m) => {
    if (Array.isArray(m.units) && m.units.length) units = m.units;
    MC.emit("currency");
  });
  MC.on("welcome", () => MC.send({ t: "cur_get" }));
})();
