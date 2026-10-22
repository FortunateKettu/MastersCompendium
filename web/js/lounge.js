// Masters Compendium — «Комната ожидания»: мини-игры для тех, кто ждёт свой ход.
// Здесь — общая часть (вкладки игр, золото, таблица лидеров, лента) и кликер «Драконье золото».
// Остальные игры — lounge_games.js (ставки, дуэли), lounge_dice.js, lounge_mines.js, lounge_board.js.
// Золото считает клиент и сохраняет на сервер; выигрыши сервер присылает сам (lz_gold).
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const L = (MC.Lounge = { on: true, board: [], feed: [], games: [] });

  // улучшения кликера: base — цена первого, k — во сколько дорожает каждый следующий
  const UPS = [
    { id: "click", ic: "sword", base: 15, k: 1.15 },
    { id: "luck", ic: "star", base: 500, k: 6, max: 5 },
    { id: "goblin", ic: "ghost", base: 25, k: 1.15, ps: 0.5 },
    { id: "bard", ic: "volume", base: 250, k: 1.15, ps: 4 },
    { id: "mine", ic: "gem", base: 3000, k: 1.15, ps: 30 },
    { id: "lair", ic: "crown", base: 40000, k: 1.15, ps: 200 },
    { id: "portal", ic: "sparkle", base: 600000, k: 1.15, ps: 1500 },
  ];
  const fresh = () => ({ gold: 0, total: 0, clicks: 0, crits: 0, best: 0, ups: {} });
  let S = fresh();
  let loaded = false, dirty = false, lastFace = 20;
  let sub = MC.store.get("lz_sub") || "clicker";

  const lv = (id) => MC.int(S.ups[id], 0);
  const price = (u) => Math.ceil(u.base * Math.pow(u.k, lv(u.id)));
  const perSec = () => UPS.reduce((a, u) => a + (u.ps ? u.ps * lv(u.id) : 0), 0);
  const perClick = () => 1 + lv("click") + Math.floor(perSec() * 0.05);
  const critFrom = () => 20 - lv("luck");
  const fmt = (n) => {
    n = Math.floor(n);
    if (n < 10000) return String(n);
    const u = [[1e15, "Q"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]].find(([v]) => n >= v);
    const x = n / u[0];
    return (x < 100 ? x.toFixed(1) : Math.floor(x)) + u[1];
  };
  const fmtPs = (n) => (n < 10 && n % 1 ? n.toFixed(1) : fmt(n));

  const gm = () => MC.isGM();
  const myKey = () => (gm() ? "gm" : MC.state.me?.id);
  const curTab = () => document.querySelector(".tab.active")?.dataset.tab;
  const goTab = (tab) => document.querySelector(`.tabbar [data-go="${tab}"]`)?.click();
  const here = () => curTab() === "lounge";

  // ---------------------------------------------------------------- общее для игр
  L.fmt = fmt;
  L.key = myKey;
  L.gm = gm;
  L.here = here;
  L.sub = () => sub;
  L.gold = () => Math.floor(S.gold);
  L.perSec = perSec;
  L.loaded = () => loaded;
  /** Вычесть ставку; возвращает сохранение для отправки на сервер (или null, если золота мало). */
  L.spend = (n) => {
    n = Math.floor(n);
    if (n < 0 || S.gold < n) return null;
    S.gold -= n;
    dirty = false;
    paint();
    return { ...S, ups: { ...S.ups } };
  };
  /** Вернуть ставку, если сервер её не принял. */
  L.unspend = (n) => { S.gold += n; dirty = true; paint(); };
  /** Выигрыш: gold — сколько пришло, total — сколько из этого чистая прибыль (в таблицу лидеров). */
  L.addGold = (gold, total = gold) => { S.gold += gold; S.total += total; dirty = true; paint(); };
  L.register = (g) => { L.games.push(g); };
  L.badge = () => {
    const b = document.querySelector('.tabbar [data-go="lounge"]');
    const any = L.games.some((g) => g.badge?.());
    if (b) b.classList.toggle("has-badge", any && !here());
    for (const c of document.querySelectorAll("[data-lzsub]")) {
      const g = L.games.find((x) => x.id === c.dataset.lzsub);
      c.classList.toggle("has-badge", !!g?.badge?.() && g.id !== sub);
    }
  };
  L.openSub = (id) => { sub = id; MC.store.set("lz_sub", id); if (here()) render(); else goTab("lounge"); };
  L.req = (o) => MC.request(o).catch((e) => { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; });
  L.save = save;

  // ---------------------------------------------------------------- кликер
  function earn(n) { S.gold += n; S.total += n; dirty = true; }
  function roll(ev) {
    const r = 1 + Math.floor(Math.random() * 20);
    const crit = r >= critFrom();
    const fumble = r === 1;
    const gain = Math.max(1, Math.round(perClick() * (crit ? 10 : fumble ? 0.5 : 1)));
    earn(gain);
    S.clicks++;
    if (crit) S.crits++;
    if (gain > S.best) S.best = gain;
    lastFace = r;
    const die = $("#lz-die");
    if (die) {
      die.innerHTML = MC.Dice.dieSvg(20, r);
      die.classList.remove("hit", "crit", "fumble");
      void die.offsetWidth;            // перезапуск анимации
      die.classList.add(crit ? "crit" : fumble ? "fumble" : "hit");
    }
    float(ev, (crit ? t("lz.crit") + " " : fumble ? t("lz.fumble") + " " : "") + "+" + fmt(gain), crit ? "crit" : fumble ? "fumble" : "");
    if (crit) try { navigator.vibrate?.(40); } catch { /* ignore */ }
    paint();
  }
  function float(ev, text, cls) {
    const box = $("#lz-arena");
    if (!box) return;
    const r = box.getBoundingClientRect();
    const x = ev && ev.clientX ? ev.clientX - r.left : r.width / 2;
    const y = ev && ev.clientY ? ev.clientY - r.top : r.height / 2;
    const el = document.createElement("span");
    el.className = "lz-float " + cls;
    el.textContent = text;
    el.style.left = x + (Math.random() * 40 - 20) + "px";
    el.style.top = y - 20 + "px";
    box.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  function buy(id) {
    const u = UPS.find((x) => x.id === id);
    if (!u || (u.max && lv(id) >= u.max)) return;
    const p = price(u);
    if (S.gold < p) return;
    S.gold -= p;
    S.ups[id] = lv(id) + 1;
    dirty = true;
    render();
    save();
  }
  function shopHtml() {
    return UPS.map((u) => {
      const n = lv(u.id), maxed = u.max && n >= u.max;
      const d = u.id === "click" ? t("lz.up.click.d") : u.id === "luck" ? t("lz.up.luck.d", { n: critFrom() - (maxed ? 0 : 1) })
        : t("lz.up.auto.d", { n: fmtPs(u.ps) });
      return `<button class="lz-up" data-lzbuy="${u.id}" ${maxed ? "disabled" : ""}>
        <span class="lz-up-ic">${MC.icon(u.ic)}</span>
        <span class="lz-up-txt"><b>${esc(t("lz.up." + u.id))}</b><small>${esc(d)}</small></span>
        <span class="lz-up-side"><span class="lz-price">${maxed ? t("lz.max") : MC.icon("coins", "sm") + fmt(price(u))}</span><span class="lz-lv">${n || ""}</span></span>
      </button>`;
    }).join("");
  }
  L.register({
    id: "clicker", ic: "d20",
    render: (el) => {
      el.innerHTML = `<div class="lz-cgrid">
        <div class="card glass lz-main">
          <div class="lz-rates muted small"><span id="lz-pc">${t("lz.per_click", { n: fmt(perClick()) })}</span> · <span id="lz-ps">${t("lz.per_s", { n: fmtPs(perSec()) })}</span></div>
          <div class="lz-arena" id="lz-arena"><button class="lz-die" id="lz-die" aria-label="d20">${MC.Dice.dieSvg(20, lastFace)}</button></div>
          <p class="muted small center">${t("lz.tap")}</p>
        </div>
        <div class="card glass lz-shop"><h3>${t("lz.shop")}</h3><div class="lz-ups">${shopHtml()}</div></div></div>`;
    },
  });

  // доход в секунду — только пока страница на экране
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(2, (now - lastTick) / 1000);
    lastTick = now;
    if (!loaded || document.hidden || $("#scr-game")?.hidden || !(L.on || gm())) return;
    const ps = perSec();
    if (ps > 0) { earn(ps * dt); paint(); }
  }, 250);

  // ---------------------------------------------------------------- сохранение
  async function save() {
    if (!dirty || !loaded || !myKey()) return;
    dirty = false;
    try { await MC.request({ t: "lz_save", save: S }); } catch { dirty = true; }
  }
  setInterval(save, 10000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("pagehide", save);

  async function load() {
    try {
      const r = await MC.request({ t: "lz_get" });
      apply(r);
      L.feed = Array.isArray(r.feed) ? r.feed : [];
      const srv = r.save ? { ...fresh(), ...r.save, ups: { ...(r.save.ups || {}) } } : null;
      // после обрыва связи своё (более свежее) не затираем
      if (srv && (!loaded || srv.total > S.total)) S = srv;
      loaded = true;
      MC.emit("lz_loaded", r);
      if (here()) render();
      L.badge();
    } catch { /* сервер старый или нет связи — попробуем при следующем входе */ }
  }

  function apply(m) {
    L.on = m.on !== false;
    L.board = Array.isArray(m.board) ? m.board : [];
    syncTab();
  }
  function syncTab() {
    const b = document.querySelector('.tabbar [data-go="lounge"]');
    const show = !MC.pop && (L.on || gm());
    if (b) b.hidden = !show;
    if (!show && here()) goTab("character");
  }

  // ---------------------------------------------------------------- отрисовка
  function boardHtml() {
    if (!L.board.length) return `<p class="muted small">${t("lz.board_empty")}</p>`;
    const medal = ["#f5c542", "#cbd5e1", "#d97706"];
    return `<ol class="lz-board">${L.board.map((p, i) => `<li class="${p.id === myKey() ? "me" : ""}">
      <span class="lz-place" style="${i < 3 ? `background:${medal[i]};color:#1a1033` : ""}">${i + 1}</span>
      <i style="background:${esc(p.color)}"></i><b>${esc(p.name === "GM" ? t("ds.gm_name") : p.name)}</b>
      <span class="muted small">${t("lz.crits", { n: p.crits || 0 })}</span>
      <span class="lz-bgold">${MC.icon("coins", "sm")}${fmt(p.id === myKey() ? Math.max(p.total, S.total) : p.total)}</span></li>`).join("")}</ol>`;
  }
  const nm = (s) => esc(s === "GM" ? t("ds.gm_name") : s);
  function feedLine(f) {
    if (f.k === "duel") return `${MC.icon("swords", "sm")} ${t("lz.f.duel", { a: nm(f.a), b: nm(f.b), ra: f.ra, rb: f.rb, win: nm(f.win), n: fmt(f.stake * 2) })}`;
    if (f.k === "dice") return `${MC.icon("dice", "sm")} ${t("lz.f.dice", { win: nm(f.win), n: fmt(f.pot) })}`;
    if (f.k === "bet") {
      const who = (f.pays || []).map((p) => `${nm(p.name)} +${fmt(p.won)}`).join(", ");
      return `${MC.icon("coins", "sm")} ${t(f.side === "hit" ? (f.crit ? "lz.f.bet_crit" : "lz.f.bet_hit") : "lz.f.bet_miss", { who: nm(f.who) })}${who ? " · " + who : ""}`;
    }
    return "";
  }
  function feedHtml() {
    const lst = L.feed.slice(-8).reverse();
    return lst.length ? `<ul class="lz-feed">${lst.map((f) => `<li>${feedLine(f)}</li>`).join("")}</ul>` : `<p class="muted small">${t("lz.feed_empty")}</p>`;
  }
  function gmHtml() {
    if (!gm()) return "";
    return `<div class="card glass lz-gm">
      <label class="lz-switch"><input type="checkbox" data-lzgm="on" ${L.on ? "checked" : ""}><span><b>${t("lz.gm.on")}</b><small class="muted">${t("lz.gm.on.d")}</small></span></label>
      <div class="lz-gm-act"><button class="btn small primary" data-lzgm="call">${MC.icon("alert", "sm")} ${t("lz.gm.call")}</button>
      <button class="btn small" data-lzgm="reset">${MC.icon("refresh", "sm")} ${t("lz.gm.reset")}</button></div></div>`;
  }

  let shown = null;
  function render() {
    const el = $("#lounge-tab");
    if (!el) return;
    const game = L.games.find((g) => g.id === sub) || L.games[0];
    sub = game.id;
    if (shown && shown !== game) shown.hide?.();
    el.innerHTML = `${gmHtml()}
      <div class="lz-head"><h2 class="section">${MC.icon("tent")} ${t("lz.title")}</h2>
        <div class="lz-gold"><span class="lz-coin">${MC.icon("coins")}</span><b id="lz-gold">${fmt(S.gold)}</b><span class="muted">${t("lz.gold")}</span></div></div>
      <p class="muted small lz-sub">${t("lz.sub")}</p>
      <div class="lz-nav">${L.games.map((g) => `<button class="chip ${g.id === sub ? "on" : ""}" data-lzsub="${g.id}">${MC.icon(g.ic, "sm")} ${t("lz.g." + g.id)}</button>`).join("")}</div>
      <div class="lz-layout"><div class="lz-body" id="lz-body"></div>
        <aside class="lz-side"><div class="card glass"><h3>${t("lz.board")}</h3><div id="lz-board">${boardHtml()}</div></div>
          <div class="card glass"><h3>${t("lz.feed")}</h3><div id="lz-feedbox">${feedHtml()}</div></div></aside></div>`;
    game.render($("#lz-body"));
    shown = game;
    game.show?.();
    paint();
    L.badge();
  }
  L.render = render;
  /** Частое обновление: цифры и доступность покупок, без перерисовки всего. */
  function paint() {
    if (!here()) return;
    const g = $("#lz-gold");
    if (!g) return;
    g.textContent = fmt(S.gold);
    const pc = $("#lz-pc");
    if (pc) {
      pc.textContent = t("lz.per_click", { n: fmt(perClick()) });
      $("#lz-ps").textContent = t("lz.per_s", { n: fmtPs(perSec()) });
    }
    for (const b of document.querySelectorAll("[data-lzbuy]")) {
      const u = UPS.find((x) => x.id === b.dataset.lzbuy);
      const maxed = u.max && lv(u.id) >= u.max;
      b.classList.toggle("can", !maxed && S.gold >= price(u));
    }
    MC.emit("lz_paint");
  }
  L.paint = paint;

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#lz-die")) { e.preventDefault(); roll(e); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && document.activeElement?.id === "lz-die") { e.preventDefault(); roll(null); }
  });
  document.addEventListener("click", async (e) => {
    const sb = e.target.closest("[data-lzsub]");
    if (sb) { L.openSub(sb.dataset.lzsub); return; }
    const b = e.target.closest("[data-lzbuy]");
    if (b) { buy(b.dataset.lzbuy); return; }
    const g = e.target.closest("[data-lzgm]");
    if (!g || g.tagName === "INPUT") return;
    if (g.dataset.lzgm === "call") {
      if (await L.req({ t: "lz_call" })) MC.toast(t("lz.called"), "ok");
    }
    if (g.dataset.lzgm === "reset" && await MC.confirm(t("lz.gm.reset_q"))) MC.send({ t: "lz_reset" });
  });
  document.addEventListener("change", (e) => {
    const c = e.target.closest('[data-lzgm="on"]');
    if (c) MC.send({ t: "lz_set", on: c.checked });
  });

  // ---------------------------------------------------------------- сообщения
  MC.on("msg_lz_board", (m) => {
    apply(m);
    if (m.reset) {
      S = fresh();
      dirty = false;
      if (!gm()) MC.toast(t("lz.reset_done"), "warn");
      if (here()) render();
      return;
    }
    const b = $("#lz-board");
    if (b) b.innerHTML = boardHtml();
    const sw = document.querySelector('[data-lzgm="on"]');
    if (sw) sw.checked = L.on;
  });
  MC.on("msg_lz_gold", (m) => {
    L.addGold(Number(m.gold) || 0, Number(m.total) || 0);
    if (m.why === "refund" && m.gold > 0) MC.toast(t("lz.refund", { n: fmt(m.gold) }), "", "coins");
    save();
  });
  MC.on("msg_lz_feed", (m) => {
    L.feed.push(m.item);
    if (L.feed.length > 30) L.feed.shift();
    const b = $("#lz-feedbox");
    if (b) b.innerHTML = feedHtml();
  });

  /** Зовут к столу: уходим из комнаты ожидания на карту. */
  function backToTable(textKey) {
    if (gm() || MC.pop) return;
    if (here()) { goTab("map"); MC.toast(t(textKey), "ok", "crit"); }
  }
  MC.on("msg_lz_call", () => {
    if (gm() || MC.pop) return;
    $("#lz-callpop")?.remove();
    const el = document.createElement("div");
    el.id = "lz-callpop";
    el.className = "cb-notice glass";
    el.innerHTML = `<div class="cbn-ic">${MC.icon("alert")}</div>
      <div class="cbn-text"><b>${t("lz.call.title")}</b><span class="muted small">${t("lz.call.hint")}</span></div>
      <button class="icon-btn small cbn-x" data-lzx="1">${MC.icon("x", "sm")}</button><i class="cbn-bar"></i>`;
    document.body.appendChild(el);
    el.addEventListener("click", () => el.remove());
    setTimeout(() => el.remove(), MC.reactMs(10000));
    try { navigator.vibrate?.([120, 80, 120]); } catch { /* ignore */ }
    if (here()) goTab("map");
    save();
  });
  let lastCur = null, wasActive = null;
  MC.on("combat_changed", () => {
    const s = MC.Combat?.state || {};
    const cur = (s.list || []).find((e) => e.id === s.cur);
    const mine = cur && cur.kind === "pc" && cur.owner === MC.state.me?.id;
    if (wasActive === false && s.active) backToTable("lz.fight");
    else if (mine && cur.id !== lastCur) backToTable("lz.to_table");
    lastCur = cur?.id || null;
    wasActive = !!s.active;
  });

  MC.on("welcome", () => { syncTab(); load(); });
  MC.on("tab", (tab) => {
    if (tab === "lounge") render();
    else { if (shown) { shown.hide?.(); shown = null; } save(); }
    L.badge();
  });
  MC.on("lang", () => { if (here()) render(); });
  MC.on("players", () => { const b = $("#lz-board"); if (b) b.innerHTML = boardHtml(); });
})();
