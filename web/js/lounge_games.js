// Masters Compendium — комната ожидания: ставки на бой и дуэли на костях.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const L = MC.Lounge;
  const fmt = (n) => L.fmt(n);
  const nm = (s) => esc(s === "GM" ? t("ds.gm_name") : s);

  /** Поле суммы с быстрыми кнопками. */
  const stakeHtml = (id, val) => `<div class="lz-stake">
      <span class="lz-stake-in">${MC.icon("coins", "sm")}<input type="number" min="0" step="1" id="${id}" value="${val}" inputmode="numeric"></span>
      ${[[0.1, "10%"], [0.25, "25%"], [0.5, "50%"], [1, t("lz.all")]].map(([k, l]) => `<button class="chip" data-lzpct="${k}" data-for="${id}">${l}</button>`).join("")}
    </div>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lzpct]");
    if (!b) return;
    const inp = document.getElementById(b.dataset.for);
    if (inp) inp.value = Math.floor(L.gold() * Number(b.dataset.lzpct));
  });
  const stakeVal = (id) => Math.max(0, Math.floor(Number(document.getElementById(id)?.value) || 0));

  // ================================================================ ставки на бой
  let market = null;
  let lastStake = MC.int(MC.store.get("lz_bet"), 10);

  function betsHtml() {
    const m = market;
    const rules = `<details class="lz-rules"><summary>${t("lz.rules")}</summary><p class="muted small">${t("lz.bet.rules")}</p></details>`;
    if (!m) return `<div class="card glass lz-empty">${MC.icon("attacks", "huge")}<p>${t("lz.bet.none")}</p>${rules}</div>`;
    const mine = m.bets.find((b) => b.key === L.key());
    const total = m.pools.hit + m.pools.miss;
    const pct = (s) => (total ? Math.round(m.pools[s] / total * 100) : 50);
    const side = (s) => `<button class="lz-side-btn ${s} ${mine?.side === s ? "mine" : ""}" data-lzbet="${s}" ${!m.open || L.gm() || (mine && mine.side !== s) ? "disabled" : ""}>
        <span class="lz-side-ic">${MC.icon(s === "hit" ? "target" : "x")}</span><b>${t("lz.bet." + s)}</b>
        <span class="lz-pool">${MC.icon("coins", "sm")}${fmt(m.pools[s])}</span><span class="muted small">${pct(s)}%</span></button>`;
    let res = "";
    if (m.res) {
      res = m.res.hidden ? `<div class="lz-res">${t("lz.bet.hidden")}</div>`
        : `<div class="lz-res ${m.res.side}">${MC.icon(m.res.side === "hit" ? "target" : "x")} <b>${t(m.res.side === "hit" ? (m.res.crit ? "lz.bet.res_crit" : "lz.bet.res_hit") : "lz.bet.res_miss")}</b>
          ${m.res.pays?.length ? `<div class="small">${m.res.pays.map((p) => `${nm(p.name)} <b class="good-text">+${fmt(p.won)}</b>`).join(" · ")}</div>` : ""}</div>`;
    }
    return `<div class="card glass lz-bet">
      <div class="lz-bet-q">${MC.icon("attacks")} <span>${t("lz.bet.q", { name: `<b>${nm(m.name)}</b>` })}</span></div>
      <div class="lz-sides">${side("hit")}${side("miss")}</div>
      <div class="lz-bar"><i style="width:${pct("hit")}%"></i></div>
      ${m.open && !L.gm() ? stakeHtml("lz-bet-amt", lastStake) : ""}
      ${mine ? `<p class="small center">${t("lz.bet.mine", { n: fmt(mine.amt), side: t("lz.bet." + mine.side) })}</p>` : ""}
      ${res}
      ${m.bets.length ? `<ul class="lz-bets">${m.bets.map((b) => `<li><i style="background:${esc(b.color)}"></i>${nm(b.name)}<span class="${b.side === "hit" ? "good-text" : "bad-text"}">${t("lz.bet." + b.side)}</span><b>${fmt(b.amt)}</b></li>`).join("")}</ul>` : ""}
      ${!m.open ? `<p class="muted small center">${t("lz.bet.next")}</p>` : ""}
      ${rules}</div>`;
  }
  async function placeBet(side) {
    const amt = stakeVal("lz-bet-amt");
    if (amt < 1) { MC.toast(t("lz.need_stake"), "warn"); return; }
    const save = L.spend(amt);
    if (!save) { MC.toast(t("lz.no_gold"), "warn"); return; }
    lastStake = amt;
    MC.store.set("lz_bet", amt);
    if (!(await L.req({ t: "lz_bet", side, amt, save }))) L.unspend(amt);
  }
  L.register({
    id: "bets", ic: "coins",
    render: (el) => { el.innerHTML = betsHtml(); },
    badge: () => !!(market && market.open && !L.gm() && !market.bets.some((b) => b.key === L.key())),
  });
  MC.on("lz_loaded", (r) => { market = r.market || null; });
  MC.on("msg_lz_market", (m) => {
    market = m.market || null;
    if (L.here() && L.sub() === "bets") L.render(); else L.badge();
  });

  // ================================================================ дуэли
  let duels = [];
  let duelRes = null;      // последний результат: показываем кубики
  let duelStake = MC.int(MC.store.get("lz_duel"), 50);

  function duelsHtml() {
    const me = L.key();
    const inc = duels.filter((d) => d.b === me), out = duels.find((d) => d.a === me);
    const left = (d) => Math.max(0, Math.round(d.ts + d.ttl - Date.now() / 1000));
    const others = MC.state.players.filter((p) => p.online && p.id !== me);
    let res = "";
    if (duelRes) {
      const d = duelRes.duel, [ra, rb] = duelRes.rolls[duelRes.rolls.length - 1];
      const iWon = duelRes.win === me;
      res = `<div class="card glass lz-duel-res ${iWon ? "won" : "lost"}">
        <div class="lz-duel-dice"><div><span class="lz-dd" style="--c:${esc(d.ac)}">${MC.Dice.dieSvg(20, ra, { color: d.ac })}</span><b>${nm(d.an)}</b></div>
          <span class="lz-vs">VS</span><div><span class="lz-dd" style="--c:${esc(d.bc)}">${MC.Dice.dieSvg(20, rb, { color: d.bc })}</span><b>${nm(d.bn)}</b></div></div>
        ${duelRes.rolls.length > 1 ? `<p class="muted small center">${t("lz.duel.tie", { n: duelRes.rolls.length - 1 })}</p>` : ""}
        <p class="center lz-duel-verdict">${t(iWon ? "lz.duel.won" : "lz.duel.lost", { n: fmt(d.stake * (iWon ? 2 : 1)) })}</p></div>`;
    }
    return `${res}
      ${inc.map((d) => `<div class="card glass lz-duel-in"><div>${MC.icon("swords")} ${t("lz.duel.in", { name: `<b>${nm(d.an)}</b>`, n: fmt(d.stake) })}
        <span class="muted small" data-lzleft="${d.ts + d.ttl}">${left(d)} ${t("lz.sec")}</span></div>
        <div class="lz-row"><button class="btn small primary" data-lzduel="ok" data-id="${d.id}" ${L.gold() < d.stake ? "disabled" : ""}>${MC.icon("check", "sm")} ${t("lz.duel.accept")}</button>
        <button class="btn small" data-lzduel="no" data-id="${d.id}">${MC.icon("x", "sm")} ${t("lz.duel.decline")}</button></div>
        ${L.gold() < d.stake ? `<p class="small bad-text">${t("lz.no_gold")}</p>` : ""}</div>`).join("")}
      ${out ? `<div class="card glass lz-duel-out">${MC.icon("hourglass")} <span>${t("lz.duel.wait", { name: `<b>${nm(out.bn)}</b>`, n: fmt(out.stake) })}</span>
        <span class="muted small" data-lzleft="${out.ts + out.ttl}">${left(out)} ${t("lz.sec")}</span>
        <button class="btn small" data-lzduel="cancel" data-id="${out.id}">${t("cancel")}</button></div>` : ""}
      <div class="card glass"><h3>${t("lz.duel.call")}</h3><p class="muted small">${t("lz.duel.rules")}</p>
        ${L.gm() ? `<p class="muted small">${t("lz.gm_watch")}</p>` : `${stakeHtml("lz-duel-amt", duelStake)}
        ${others.length ? `<ul class="lz-opps">${others.map((p) => `<li><i style="background:${esc(p.color)}"></i><b>${esc(p.name)}</b>
          <button class="btn small" data-lzduel="go" data-to="${esc(p.id)}" ${out ? "disabled" : ""}>${MC.icon("swords", "sm")} ${t("lz.duel.go")}</button></li>`).join("")}</ul>`
    : `<p class="muted small">${t("lz.duel.nobody")}</p>`}`}</div>`;
  }
  function renderDuels() { if (L.here() && L.sub() === "duels") $("#lz-body").innerHTML = duelsHtml(); else L.badge(); }
  setInterval(() => {
    for (const el of document.querySelectorAll("[data-lzleft]")) el.textContent = Math.max(0, Math.round(Number(el.dataset.lzleft) - Date.now() / 1000)) + " " + t("lz.sec");
  }, 1000);

  document.addEventListener("click", async (e) => {
    const bb = e.target.closest("[data-lzbet]");
    if (bb) { placeBet(bb.dataset.lzbet); return; }
    const b = e.target.closest("[data-lzduel]");
    if (!b) return;
    const k = b.dataset.lzduel;
    if (k === "go") {
      const amt = stakeVal("lz-duel-amt");
      const save = L.spend(amt);
      if (!save) { MC.toast(t("lz.no_gold"), "warn"); return; }
      duelStake = amt; MC.store.set("lz_duel", amt);
      duelRes = null;
      if (!(await L.req({ t: "lz_duel", to: b.dataset.to, stake: amt, save }))) L.unspend(amt);
    }
    if (k === "ok") {
      const d = duels.find((x) => x.id === b.dataset.id);
      const save = d && L.spend(d.stake);
      if (!save) { MC.toast(t("lz.no_gold"), "warn"); return; }
      if (!(await L.req({ t: "lz_duel_ans", id: d.id, ok: true, save }))) L.unspend(d.stake);
    }
    if (k === "no") L.req({ t: "lz_duel_ans", id: b.dataset.id, ok: false });
    if (k === "cancel") L.req({ t: "lz_duel_cancel", id: b.dataset.id });
  });

  L.register({
    id: "duels", ic: "swords",
    render: (el) => { el.innerHTML = duelsHtml(); },
    badge: () => duels.some((d) => d.b === L.key()),
  });
  MC.on("lz_loaded", (r) => { duels = Array.isArray(r.duels) ? r.duels : []; });
  MC.on("msg_lz_duels", (m) => {
    const had = new Set(duels.map((d) => d.id));
    duels = m.duels || [];
    const fresh = duels.find((d) => d.b === L.key() && !had.has(d.id));
    if (fresh && L.here()) MC.toast(t("lz.duel.in_toast", { name: fresh.an }), "", "swords");
    renderDuels();
  });
  MC.on("msg_lz_duel_res", (m) => {
    if (m.declined) {
      if (m.duel.a === L.key()) MC.toast(t(m.expired ? "lz.duel.expired" : "lz.duel.declined", { name: m.duel.bn }), "warn");
      renderDuels();
      return;
    }
    duelRes = m;
    if (L.here()) L.openSub("duels");
    renderDuels();
  });
  MC.on("players", () => { if (L.here() && L.sub() === "duels") renderDuels(); });
})();
