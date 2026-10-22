// Masters Compendium — комната ожидания: «Кости лжеца» (перудо) для 2–6 игроков.
// У каждого 5 скрытых костей. Ход — поднять ставку «на столе не меньше N костей с гранью F» или сказать «Лжец!».
// Единицы — джокеры. Проигравший вскрытие теряет кость; последний с костями забирает банк.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const L = MC.Lounge;
  const fmt = (n) => L.fmt(n);
  const nm = (s) => esc(s === "GM" ? t("ds.gm_name") : s);

  let g = null;            // состояние стола от сервера
  let dl = 0;              // когда истекает ход (локальное время)
  let pick = { q: 1, f: 2 };
  let fee = MC.int(MC.store.get("lzd_fee"), 0);

  const face = (v, cls = "") => `<span class="lzd-die ${cls}">${MC.Dice.dieSvg(6, v)}</span>`;
  const me = () => L.key();
  const mySeat = () => g?.seats.find((s) => s.key === me());
  const minBid = () => {
    const b = g?.bid;
    if (!b) return { q: 1, f: 2 };
    return b.f < 6 ? { q: b.q, f: b.f + 1 } : { q: b.q + 1, f: 2 };
  };
  const valid = (q, f) => {
    const b = g?.bid;
    return f >= 2 && f <= 6 && q >= 1 && q <= (g?.total || 0) && (!b || q > b.q || (q === b.q && f > b.f));
  };

  function html() {
    const rules = `<details class="lz-rules"><summary>${t("lz.rules")}</summary><p class="muted small">${t("lzd.rules")}</p></details>`;
    if (!g) return `<div class="card glass"><p class="muted">…</p></div>`;
    const seat = mySeat();
    const seats = `<ul class="lzd-seats">${g.seats.map((s) => {
      const reveal = g.phase === "reveal" && g.last ? g.last.all[s.key] : null;
      const dice = reveal || s.dice;
      const f = g.last?.f;
      return `<li class="${s.key === g.turn && g.phase === "play" ? "turn" : ""} ${g.last?.loser === s.key && g.phase === "reveal" ? "lose" : ""} ${s.key === me() ? "me" : ""}">
        <div class="lzd-who"><i style="background:${esc(s.color)}"></i><b>${nm(s.name)}</b>${s.key === g.host && g.phase === "lobby" ? ` <span class="tag">${t("lzd.host")}</span>` : ""}
          ${s.key === g.turn && g.phase === "play" ? `<span class="lzd-turn">${MC.icon("hourglass", "sm")} <span data-lzdleft>${Math.max(0, Math.round((dl - Date.now()) / 1000))}</span></span>` : ""}</div>
        <div class="lzd-dice">${g.phase === "lobby" ? "" : dice ? dice.map((v) => face(v, g.phase === "reveal" && (v === f || v === 1) ? "match" : "")).join("")
    : Array.from({ length: s.n }, () => `<span class="lzd-die hid">?</span>`).join("")}</div></li>`;
    }).join("")}</ul>`;

    let center = "";
    if (g.phase === "lobby") {
      center = `<p>${t("lzd.lobby", { n: g.seats.length })}${g.fee ? " · " + t("lzd.fee_is", { n: fmt(g.fee) }) : ""}</p>
        ${seat ? `<div class="lz-row">${g.host === me() ? `<button class="btn primary" data-lzd="start" ${g.seats.length < 2 ? "disabled" : ""}>${MC.icon("play", "sm")} ${t("lzd.start")}</button>` : `<span class="muted small">${t("lzd.wait_host")}</span>`}
          <button class="btn" data-lzd="leave">${t("lzd.leave")}</button></div>`
    : g.seats.length >= 6 ? `<p class="muted">${t("lzd.full")}</p>`
      : `<div class="lz-row">${!g.seats.length ? `<label class="lzd-fee">${t("lzd.fee")} <span class="lz-stake-in">${MC.icon("coins", "sm")}<input type="number" min="0" id="lzd-fee" value="${fee}" inputmode="numeric"></span></label>` : ""}
          <button class="btn primary" data-lzd="join">${MC.icon("user-plus", "sm")} ${t("lzd.join")}${g.fee ? ` · ${fmt(g.fee)}` : ""}</button></div>`}`;
    } else if (g.phase === "play") {
      const b = g.bid;
      const myTurn = g.turn === me() && seat;
      center = `<div class="lzd-bid">${b ? `${t("lzd.bid_by", { name: nm(b.name) })}<div class="lzd-bigbid"><b>${b.q} ×</b>${face(b.f)}</div>${b.auto ? `<span class="muted small">${t("lzd.auto")}</span>` : ""}` : `<span class="muted">${t("lzd.no_bid")}</span>`}</div>
        <p class="muted small center">${t("lzd.total", { n: g.total })} · ${t("lzd.pot", { n: fmt(g.pot) })}</p>
        ${myTurn ? `<div class="lzd-pick">
          <div class="lzd-q"><button class="icon-btn" data-lzdq="-1">${MC.icon("minus", "sm")}</button><b id="lzd-q">${pick.q}</b><button class="icon-btn" data-lzdq="1">${MC.icon("plus", "sm")}</button></div>
          <div class="lzd-faces">${[2, 3, 4, 5, 6].map((f) => `<button class="lzd-face ${pick.f === f ? "on" : ""}" data-lzdf="${f}">${face(f)}</button>`).join("")}</div>
          <div class="lz-row"><button class="btn primary" data-lzd="bid" ${valid(pick.q, pick.f) ? "" : "disabled"}>${t("lzd.raise", { q: pick.q })} ×${face(pick.f, "sm")}</button>
          ${b && b.by !== me() ? `<button class="btn danger" data-lzd="call">${MC.icon("alert", "sm")} ${t("lzd.call")}</button>` : ""}</div></div>`
    : seat ? `<p class="center muted">${t("lzd.wait_turn", { name: nm(g.seats.find((s) => s.key === g.turn)?.name || "") })}</p>` : `<p class="center muted">${t("lzd.watching")}</p>`}`;
    } else if (g.phase === "reveal" && g.last) {
      const x = g.last;
      center = `<div class="lzd-reveal"><b>${t("lzd.called", { name: nm(x.caller), bidder: nm(x.bidder) })}</b>
        <div class="lzd-bigbid">${t("lzd.found", { n: x.count, q: x.q })} ${face(x.f)}</div>
        <p class="bad-text">${t("lzd.loses", { name: nm(x.loser_name) })}</p></div>`;
    } else if (g.phase === "over" && g.win) {
      center = `<div class="lzd-reveal won">${MC.icon("crown", "huge")}<b>${t("lzd.winner", { name: nm(g.win.name), n: fmt(g.win.pot) })}</b></div>`;
    }
    return `<div class="card glass lzd">${seat && g.phase === "play" ? `<div class="lz-row lzd-mine"><span class="muted small">${t("lzd.my_dice")}</span>${(seat.dice || []).map((v) => face(v)).join("")}
      <button class="btn small" data-lzd="leave">${t("lzd.leave")}</button></div>` : ""}
      <div class="lzd-center">${center}</div>${seats}${rules}</div>`;
  }
  function paint() { if (L.here() && L.sub() === "dice") $("#lz-body").innerHTML = html(); else L.badge(); }

  setInterval(() => {
    const el = document.querySelector("[data-lzdleft]");
    if (el) el.textContent = Math.max(0, Math.round((dl - Date.now()) / 1000));
  }, 500);

  document.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-lzdq]");
    if (q) { pick.q = MC.clamp(pick.q + Number(q.dataset.lzdq), 1, g?.total || 1); paint(); return; }
    const f = e.target.closest("[data-lzdf]");
    if (f) { pick.f = Number(f.dataset.lzdf); paint(); return; }
    const b = e.target.closest("[data-lzd]");
    if (!b) return;
    const k = b.dataset.lzd;
    if (k === "join") {
      const fe = g.seats.length ? g.fee : Math.max(0, Math.floor(Number($("#lzd-fee")?.value) || 0));
      const save = L.spend(fe);
      if (!save) { MC.toast(t("lz.no_gold"), "warn"); return; }
      if (!g.seats.length) { fee = fe; MC.store.set("lzd_fee", fe); }
      if (!(await L.req({ t: "lzd_join", fee: fe, save }))) L.unspend(fe);
    }
    if (k === "leave") L.req({ t: "lzd_leave" });
    if (k === "start") L.req({ t: "lzd_start" });
    if (k === "bid") L.req({ t: "lzd_bid", q: pick.q, f: pick.f });
    if (k === "call") L.req({ t: "lzd_call" });
  });

  function apply(d) {
    const was = g;
    g = d || null;
    if (!g) return;
    dl = Date.now() + (g.left || 0) * 1000;
    // новый ход — подставляем минимальную допустимую ставку
    if (!was || was.turn !== g.turn || JSON.stringify(was.bid) !== JSON.stringify(g.bid)) pick = minBid();
    if (g.turn === me() && g.phase === "play" && (!was || was.turn !== me()) && L.here()) {
      try { navigator.vibrate?.(50); } catch { /* ignore */ }
    }
  }
  L.register({
    id: "dice", ic: "dice",
    render: (el) => { el.innerHTML = html(); },
    badge: () => !!(g && g.phase === "play" && g.turn === me()),
  });
  MC.on("lz_loaded", (r) => apply(r.dice));
  MC.on("msg_lz_dice", (m) => { apply(m.dice); paint(); });
})();
