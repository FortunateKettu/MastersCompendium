// Masters Compendium — ядро клиента: утилиты, язык, соединение, синхронизация листов, окна.
(() => {
  "use strict";
  const MC = (window.MC = window.MC || {});

  // ---------------------------------------------------------------- утилиты
  MC.$ = (s, root = document) => root.querySelector(s);
  MC.$$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  MC.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  MC.uid = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
  MC.clone = (o) => JSON.parse(JSON.stringify(o));
  MC.int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  MC.num = (v, d = 0) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : d; };
  MC.sign = (n) => (n >= 0 ? "+" + n : "−" + Math.abs(n));
  MC.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- отдельное окно (?pop=sheet&id=…): лист, статблок, лог, бой
  (() => {
    const q = new URLSearchParams(location.search);
    const k = q.get("pop");
    MC.pop = ["sheet", "mon", "log", "combat"].includes(k) ? { kind: k, id: (q.get("id") || "").slice(0, 60) } : null;
  })();
  MC.popPath = () => (MC.pop ? `/?pop=${MC.pop.kind}${MC.pop.id ? "&id=" + encodeURIComponent(MC.pop.id) : ""}` : "/");
  /** Можно ли открывать отдельные окна (на телефоне — нет: там всё во вкладках). */
  MC.canPop = () => !MC.pop && window.innerWidth >= 900 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  MC.popOut = (kind, id = "") => {
    const q = new URLSearchParams({ pop: kind });
    if (id) q.set("id", id);
    const gk = MC.session.get("gm_key");
    if (gk) q.set("gm", gk);
    q.set("lang", MC.lang);
    const [w, h] = { sheet: [1120, 900], mon: [580, 860], log: [460, 780], combat: [560, 780] }[kind] || [800, 800];
    const win = window.open("/?" + q, "mc_" + kind + (id ? "_" + id : ""), `popup=yes,width=${w},height=${h}`);
    if (!win) { MC.toast(MC.t("pop.blocked"), "warn"); return false; }
    try { win.focus(); } catch { /* ignore */ }
    return true;
  };

  // ---------------------------------------------------------------- хранилище (может быть недоступно)
  const KEY = "mc_" + location.host;
  MC.store = {
    get(k, d = null) { try { const v = localStorage.getItem(KEY + "_" + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + "_" + k, v); } catch { /* без хранилища */ } },
    del(k) { try { localStorage.removeItem(KEY + "_" + k); } catch { /* ignore */ } },
  };
  MC.session = {
    get(k) { try { return sessionStorage.getItem(KEY + "_" + k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(KEY + "_" + k, v); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(KEY + "_" + k); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------- язык
  MC.lang = (() => { try { return localStorage.getItem("mc_lang"); } catch { return null; } })()
    || ((navigator.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en");
  MC.t = (k, vars) => {
    let s = (window.MC_I18N[MC.lang] && window.MC_I18N[MC.lang][k]) || window.MC_I18N.ru[k] || k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split("{" + a + "}").join(b);
    return s;
  };
  /** Название из справочника: {ru, en} */
  MC.L = (o) => (o ? (MC.lang === "ru" ? o.ru || o.en : o.en || o.ru) || "" : "");
  MC.setLang = (l) => {
    MC.lang = l;
    try { localStorage.setItem("mc_lang", l); } catch { /* ignore */ }
    MC.emit("lang");
  };

  // ---------------------------------------------------------------- события
  const handlers = {};
  MC.on = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
  MC.emit = (type, data) => { (handlers[type] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---------------------------------------------------------------- состояние
  MC.state = {
    role: "player", me: null, campaign: null, players: [],
    chars: new Map(),       // id → сводка (видят все)
    docs: new Map(),        // id → полный лист (свои; мастеру — все открытые)
    log: [],
    conn: "off",
  };
  MC.isGM = () => MC.state.role === "gm";

  // ---------------------------------------------------------------- соединение
  const conn = { ws: null, retry: 0, timer: null, ping: null, stopped: false, first: null };
  const pending = new Map();      // rid → {resolve, reject, timer}
  const docPending = new Map();   // char id → число неподтверждённых правок
  const docStale = new Set();

  MC.wsUrl = () => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";

  MC.connect = (firstMsg) => {
    clearTimeout(conn.timer);
    if (conn.ws) { try { conn.ws.onclose = null; conn.ws.close(); } catch { /* ignore */ } }
    conn.first = firstMsg;
    conn.stopped = false;
    let ws;
    try { ws = new WebSocket(MC.wsUrl()); } catch { drop(); return; }
    conn.ws = ws;
    let welcomed = false;
    ws.onopen = () => ws.send(JSON.stringify(firstMsg));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "welcome") { welcomed = true; onWelcome(m); return; }
      route(m);
    };
    ws.onclose = () => {
      clearInterval(conn.ping);
      if (conn.ws !== ws) return;
      conn.ws = null;
      for (const [rid, p] of pending) { clearTimeout(p.timer); p.reject(new Error("closed")); pending.delete(rid); }
      if (!welcomed && firstMsg.t === "join") { MC.emit("join_failed"); return; }
      drop();
    };
  };

  MC.stopConnection = () => {
    conn.stopped = true;
    clearTimeout(conn.timer);
    if (conn.ws) { conn.ws.onclose = null; conn.ws.close(); conn.ws = null; }
  };

  function drop() {
    const next = MC.reconnectMessage();
    if (conn.stopped || !next) { setConn("off"); return; }
    setConn("wait");
    const delay = Math.min(10000, 1000 * Math.pow(2, conn.retry++));
    conn.timer = setTimeout(() => MC.connect(next), delay);
  }

  MC.reconnectMessage = () => {
    const gm = MC.session.get("gm_key");
    if (gm) return { t: "gm", key: gm };
    const tok = MC.store.get("token");
    return tok ? { t: "hello", token: tok } : null;
  };

  MC.wake = () => {
    if (conn.stopped || conn.ws) return;
    const m = MC.reconnectMessage();
    if (!m) return;
    conn.retry = 0;
    MC.connect(m);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) MC.wake(); });
  window.addEventListener("online", () => MC.wake());

  function setConn(c) { MC.state.conn = c; MC.emit("conn", c); }

  function onWelcome(m) {
    if (m.token) MC.store.set("token", m.token);
    const s = MC.state;
    s.role = m.role || "player";
    s.me = m.me; s.campaign = m.campaign; s.players = m.players || [];
    conn.retry = 0;
    setConn("on");
    clearInterval(conn.ping);
    // пинг каждые 10 с: показываем задержку, а если ответа нет 25 с — соединение «зависло», переподключаемся
    conn.pongAt = performance.now();
    const ping = () => {
      if (conn.ws && performance.now() - conn.pongAt > 25000) { try { conn.ws.close(); } catch { /* ignore */ } return; }
      conn.pingAt = performance.now();
      MC.send({ t: "ping" });
    };
    conn.ping = setInterval(ping, 10000);
    setTimeout(ping, 500);
    MC.send({ t: "chars" });
    MC.send({ t: "log" });
    MC.send({ t: "map_get" });
    // листы, открытые до обрыва связи, перезапрашиваем — вдруг их меняли
    for (const id of s.docs.keys()) MC.send({ t: "char_get", id });
    MC.emit("welcome", m);
  }

  MC.send = (obj) => {
    if (conn.ws && conn.ws.readyState === 1) { conn.ws.send(JSON.stringify(obj)); return true; }
    return false;
  };

  /** Запрос с ответом: ждём сообщение с тем же rid (rolled / char / char_ack / error). */
  MC.request = (obj, timeout = 8000) => new Promise((resolve, reject) => {
    const rid = MC.uid();
    obj.rid = rid;
    const timer = setTimeout(() => { pending.delete(rid); reject(new Error("timeout")); }, timeout);
    pending.set(rid, { resolve, reject, timer });
    if (!MC.send(obj)) { clearTimeout(timer); pending.delete(rid); reject(new Error("offline")); }
  });

  function settle(m) {
    if (!m.rid || !pending.has(m.rid)) return;
    const p = pending.get(m.rid);
    pending.delete(m.rid);
    clearTimeout(p.timer);
    if (m.t === "error") p.reject(Object.assign(new Error(m.code), { code: m.code }));
    else p.resolve(m);
  }

  function route(m) {
    const s = MC.state;
    switch (m.t) {
      case "players": s.players = m.players || []; MC.emit("players"); break;
      case "campaign": s.campaign = m.campaign; MC.emit("campaign"); break;
      case "chars":
        s.chars = new Map((m.chars || []).map((c) => [c.id, c]));
        for (const id of [...s.docs.keys()]) if (!s.chars.has(id)) s.docs.delete(id);
        // свои листы игрок держит у себя целиком
        if (!MC.isGM()) for (const c of s.chars.values()) if (c.owner === s.me?.id && !s.docs.has(c.id)) MC.send({ t: "char_get", id: c.id });
        MC.emit("chars");
        break;
      case "char_summary": s.chars.set(m.char.id, m.char); MC.emit("chars"); break;
      case "char": s.docs.set(m.char.id, m.char); docStale.delete(m.char.id); MC.emit("doc", m.char.id); break;
      case "char_removed": s.docs.delete(m.id); MC.emit("doc_removed", m.id); break;
      case "char_ack": {
        const d = s.docs.get(m.id);
        if (d) d.version = m.version;
        const n = (docPending.get(m.id) || 1) - 1;
        docPending.set(m.id, n);
        if (n <= 0 && docStale.has(m.id)) MC.send({ t: "char_get", id: m.id });
        break;
      }
      case "char_patched": {
        const d = s.docs.get(m.id);
        if (!d) break;
        if ((docPending.get(m.id) || 0) > 0) { docStale.add(m.id); break; }
        if (m.version === (d.version || 0) + 1) {
          try { MC.applyOps(d, m.ops); d.version = m.version; MC.emit("doc", m.id); }
          catch { MC.send({ t: "char_get", id: m.id }); }
        } else {
          MC.send({ t: "char_get", id: m.id });
        }
        break;
      }
      case "pong":
        conn.pongAt = performance.now();
        if (conn.pingAt) { s.rtt = Math.round(conn.pongAt - conn.pingAt); MC.emit("rtt", s.rtt); }
        break;
      case "rolled": s.log.push(m.roll); if (s.log.length > 300) s.log.shift(); MC.emit("rolled", m.roll); break;
      case "log": s.log = m.entries || []; MC.emit("log"); break;
      case "kicked": conn.stopped = true; MC.store.del("token"); MC.emit("kicked"); break;
      case "bye": setConn("off"); MC.emit("bye"); break;
      case "error":
        if (m.code === "bad_token" || m.code === "bad_gm_key") {
          conn.stopped = true;
          if (m.code === "bad_token") MC.store.del("token"); else MC.session.del("gm_key");
          MC.emit("auth_failed", m.code);
        } else if (!m.rid) {
          MC.emit("join_error", m.code);
        }
        if (m.id && m.code !== "no_access") { docPending.set(m.id, 0); MC.send({ t: "char_get", id: m.id }); MC.toast(MC.t("err.sync"), "warn"); }
        break;
      default: MC.emit("msg_" + m.t, m); break;     // карты и прочее — модули подписываются сами
    }
    settle(m);
  }

  // ---------------------------------------------------------------- правки листа
  /** Применить операции к документу (та же логика, что на сервере). */
  MC.applyOps = (doc, ops) => {
    const step = (node, key, create) => {
      if (Array.isArray(node)) {
        if (typeof key === "number") return [node, key];
        const i = node.findIndex((x) => x && x.id === key);
        if (i < 0) throw new Error("no_item");
        return [node, i];
      }
      if (node && typeof node === "object") {
        if (create && !(key in node)) node[key] = {};
        return [node, key];
      }
      throw new Error("bad_path");
    };
    for (const op of ops) {
      let node = doc;
      const path = op.path;
      for (let i = 0; i < path.length - 1; i++) {
        const [c, k] = step(node, path[i], true);
        node = c[k];
      }
      const last = path[path.length - 1];
      if (op.op === "set") { const [c, k] = step(node, last, false); c[k] = op.value; }
      else if (op.op === "add") {
        const [c, k] = step(node, last, false);
        if (!Array.isArray(c[k])) c[k] = [];
        if (op.value && typeof op.value === "object" && !op.value.id) op.value.id = MC.uid();
        c[k].push(op.value);
      } else if (op.op === "inc") {
        const [c, k] = step(node, last, false);
        const r = (Number(c[k]) || 0) + (Number(op.value) || 0);
        c[k] = r;
      } else if (op.op === "remove") {
        const [c, k] = step(node, last, false);
        if (Array.isArray(c)) c.splice(k, 1); else delete c[k];
      }
    }
  };

  /** Изменить лист: сразу у себя + отправить мастеру. */
  MC.patch = (id, ops) => {
    const d = MC.state.docs.get(id);
    if (!d || !ops.length) return;
    try { MC.applyOps(d, ops); } catch (e) { console.error(e); MC.send({ t: "char_get", id }); return; }
    docPending.set(id, (docPending.get(id) || 0) + 1);
    if (!MC.send({ t: "char_patch", id, ops, rid: MC.uid() })) {
      docPending.set(id, 0);
      MC.toast(MC.t("conn.offline"), "warn");
    }
    MC.emit("doc", id);
  };
  MC.set = (id, path, value) => MC.patch(id, [{ op: "set", path, value }]);

  // ---------------------------------------------------------------- тосты
  /** Общая колонка уведомлений справа сверху: сообщения, броски и запросы идут списком, а не друг на друга. */
  MC.notifyBox = () => {
    let box = MC.$("#notify");
    if (!box) { box = document.createElement("div"); box.id = "notify"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    box.dataset.pos = MC.store.get("opt_notify_pos") || "tr";
    return box;
  };
  /** Важное (атака по возможности, «твой ход», запросы игроку) — отдельно: по центру или слева, его можно двигать. */
  MC.impBox = () => {
    let box = MC.$("#notify-imp");
    if (!box) {
      box = document.createElement("div");
      box.id = "notify-imp";
      box.innerHTML = `<div class="imp-grip" title="${MC.esc(MC.t("opt.imp_drag"))}"><i></i></div><div class="imp-list"></div>`;
      document.body.appendChild(box);
      const grip = box.querySelector(".imp-grip");
      let drag = null;
      grip.addEventListener("pointerdown", (e) => {
        const r = box.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const x = MC.clamp(e.clientX - drag.dx, 0, innerWidth - 120), y = MC.clamp(e.clientY - drag.dy, 0, innerHeight - 40);
        box.style.left = x + "px"; box.style.top = y + "px"; box.style.transform = "none"; box.dataset.pos = "free";
      });
      grip.addEventListener("pointerup", () => {
        if (!drag) return;
        drag = null;
        MC.store.set("opt_imp_xy", JSON.stringify([parseFloat(box.style.left) / innerWidth, parseFloat(box.style.top) / innerHeight]));
      });
      grip.addEventListener("dblclick", () => { MC.store.del("opt_imp_xy"); MC.impPlace(); });
    }
    return box;
  };
  MC.impPlace = () => {
    const box = MC.impBox();
    let xy = null;
    try { xy = JSON.parse(MC.store.get("opt_imp_xy") || "null"); } catch { xy = null; }
    box.style.left = box.style.top = box.style.transform = "";
    if (xy && innerWidth > 700) { box.dataset.pos = "free"; box.style.left = Math.round(xy[0] * innerWidth) + "px"; box.style.top = Math.round(xy[1] * innerHeight) + "px"; }
    else box.dataset.pos = MC.store.get("opt_imp_pos") || "center";
  };
  /** Сколько держать сообщение (настройка «Уведомления»): по умолчанию на 15 секунд дольше, чем раньше. */
  MC.toastMs = () => ({ short: 6000, normal: 19000, long: 30000 }[MC.store.get("opt_toast_ms") || "normal"] || 19000);
  /** Сколько ждать ответа на запрос (атака по возможности, «твой ход»…) — +15 с к прежнему. */
  MC.reactMs = (base) => base + 15000;
  const trimBox = (box) => {
    // не больше 8 строк: сначала уходят старые простые сообщения
    const items = [...box.children];
    let extra = items.length - 8;
    for (const el of items.slice().reverse()) { if (extra <= 0) break; if (el.classList.contains("toast") || el.classList.contains("roll-card")) { el.remove(); extra--; } }
  };
  MC.toast = (text, kind = "", icon = "") => {
    const box = MC.notifyBox();
    // одинаковое сообщение подряд — не дублируем, а подсвечиваем со счётчиком
    const last = box.querySelector(".toast:not(.out)");
    if (last && last.dataset.text === text) {
      const n = MC.int(last.dataset.n, 1) + 1;
      last.dataset.n = n;
      last.querySelector(".t-n")?.remove();
      last.insertAdjacentHTML("beforeend", `<b class="t-n">×${n}</b>`);
      clearTimeout(last._tm);
      last._tm = setTimeout(() => { last.classList.add("out"); setTimeout(() => last.remove(), 300); }, MC.toastMs());
      return;
    }
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.dataset.text = text;
    el.innerHTML = (icon && MC.icon ? MC.icon(icon, "sm") + " " : "") + `<span>${MC.esc(text)}</span>`;
    el.addEventListener("click", () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); });
    box.prepend(el);
    trimBox(box);
    el._tm = setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, MC.toastMs());
  };
  MC.notifyTrim = () => trimBox(MC.notifyBox());
  // запросы и предупреждения (.cb-notice) создаются в разных модулях прямо в body — переносим их в колонку
  if (document.body) new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1 || !n.classList.contains("cb-notice")) continue;
      const imp = (n.classList.contains("oa") || (!MC.isGM?.() && (n.classList.contains("myturn") || n.id === "cb-notice" || n.classList.contains("au-tap")))) && MC.store.get("opt_imp_pos") !== "list";
      if (imp) { const b = MC.impBox(); if (!b.dataset.pos) MC.impPlace(); b.querySelector(".imp-list").prepend(n); }
      else MC.notifyBox().prepend(n);
    }
  }).observe(document.body, { childList: true });

  // ползунки: закрашенная часть дорожки (--fill) — для всех input[type=range] в программе
  const fillRange = (el) => { const a = MC.num(el.min, 0), b = MC.num(el.max, 100); el.style.setProperty("--fill", `${((MC.num(el.value, 0) - a) / ((b - a) || 1)) * 100}%`); };
  MC.fillRange = fillRange;
  document.addEventListener("input", (e) => { if (e.target.type === "range") fillRange(e.target); }, true);
  if (document.body) new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.type === "range") fillRange(n);
      else n.querySelectorAll?.("input[type=range]").forEach(fillRange);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ---------------------------------------------------------------- меню по правой кнопке (по всей программе)
  // Модули регистрируют: MC.ctxAdd(".селектор", (el, e) => [{ ic, label, fn, bad, sep, off }]).
  // Где своего меню нет — показываем короткое общее (настройки, обновить, во весь экран), а в полях ввода
  // и при выделенном тексте остаётся обычное меню браузера (копировать/вставить).
  const ctxProviders = [];
  MC.ctxAdd = (sel, fn) => ctxProviders.push({ sel, fn });
  MC.ctxClose = () => MC.$("#app-ctx")?.remove();
  MC.ctxMenu = (x, y, items, title = "") => {
    MC.ctxClose();
    MC.$("#tok-ctx")?.remove();
    const list = items.filter(Boolean);
    if (!list.length) return;
    const el = document.createElement("div");
    el.id = "app-ctx";
    el.className = "tok-ctx glass";
    el.innerHTML = (title ? `<div class="ctx-h">${MC.esc(title)}</div>` : "") + list.map((it, i) => (it.sep ? '<i class="ctx-sep"></i>'
      : `<button class="ctx-it ${it.bad ? "bad" : ""}" data-ci="${i}" ${it.off ? "disabled" : ""}>${MC.icon(it.ic || "next", "sm")}<span>${MC.esc(it.label)}</span></button>`)).join("");
    document.body.appendChild(el);
    el.style.left = MC.clamp(x, 6, innerWidth - el.offsetWidth - 6) + "px";
    el.style.top = MC.clamp(y, 6, innerHeight - el.offsetHeight - 6) + "px";
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ci]");
      if (!b) return;
      MC.ctxClose();
      try { list[+b.dataset.ci].fn?.(); } catch (er) { console.error(er); }
    });
  };
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.("#app-ctx")) MC.ctxClose(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") MC.ctxClose(); });
  window.addEventListener("blur", () => MC.ctxClose());
  document.addEventListener("contextmenu", (e) => {
    const tg = e.target;
    if (!tg.closest || tg.closest(".map-canvas")) return;                        // у карты своё меню
    if (tg.closest("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable=true], .note-ed")) return;
    if (String(window.getSelection?.() || "").trim()) return;
    for (const p of ctxProviders) {
      const el = tg.closest(p.sel);
      if (!el) continue;
      const r = p.fn(el, e);
      if (!r) continue;
      e.preventDefault();
      const [items, title] = Array.isArray(r) ? [r, ""] : [r.items, r.title];
      MC.ctxMenu(e.clientX, e.clientY, items, title);
      return;
    }
    e.preventDefault();
    MC.ctxMenu(e.clientX, e.clientY, [
      { ic: "settings", label: MC.t("opt.title"), fn: () => MC.Settings?.open() },
      { ic: "refresh", label: MC.t("ctx.reload"), fn: () => location.reload() },
      { ic: "maximize", label: MC.t(document.fullscreenElement ? "ctx.fs_off" : "ctx.fs_on"), fn: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch?.(() => {}) },
    ]);
  });

  // ---------------------------------------------------------------- модальные окна
  /** MC.modal({title, body(html), buttons:[{label, kind, value}], wide}) → Promise(value|null). */
  MC.modal = (opts) => new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-wrap";
    wrap.innerHTML = `<div class="modal glass${opts.wide ? " wide" : ""}" role="dialog">
      ${opts.title ? `<div class="modal-head"><h2>${MC.esc(opts.title)}</h2><button class="x" data-close>${MC.icon("x")}</button></div>` : ""}
      <div class="modal-body">${opts.body || ""}</div>
      ${opts.buttons ? `<div class="modal-foot">${opts.buttons.map((b, i) =>
        `<button class="btn ${b.kind || ""}" data-btn="${i}">${MC.esc(b.label)}</button>`).join("")}</div>` : ""}
    </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("modal-open");
    const close = (v) => {
      wrap.classList.add("out");
      setTimeout(() => { wrap.remove(); if (!MC.$(".modal-wrap")) document.body.classList.remove("modal-open"); }, 160);
      resolve(v);
    };
    // закрываем по щелчку мимо окна, только если и нажали мимо окна: при выделении текста в поле
    // мышь часто отпускают уже снаружи — окно от этого закрываться не должно
    let downOut = false;
    wrap.addEventListener("pointerdown", (e) => { downOut = e.target === wrap; });
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]") || (e.target === wrap && downOut)) { close(null); return; }
      const b = e.target.closest("[data-btn]");
      if (b) {
        const def = opts.buttons[+b.dataset.btn];
        if (def.validate && !def.validate(wrap)) return;
        close(def.value !== undefined ? (typeof def.value === "function" ? def.value(wrap) : def.value) : true);
      }
    });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(null); });
    wrap.close = close;
    if (opts.mount) opts.mount(wrap.querySelector(".modal"), close);
    const first = wrap.querySelector("[autofocus]");
    if (first) setTimeout(() => first.focus(), 50);
  });

  MC.confirm = (text) => MC.modal({ body: `<p>${MC.esc(text)}</p>`,
    buttons: [{ label: MC.t("cancel"), value: false }, { label: MC.t("ok"), kind: "danger", value: true }] });

  /** Спросить число (урон, лечение…). */
  MC.askNumber = (title, def = "") => MC.modal({
    title,
    body: `<input class="big-num" type="number" inputmode="numeric" value="${MC.esc(def)}" autofocus>`,
    buttons: [{ label: MC.t("cancel"), value: null }, { label: MC.t("ok"), kind: "primary",
      value: (w) => { const v = MC.int(w.querySelector("input").value, NaN); return Number.isFinite(v) ? v : null; } }],
    mount: (m, close) => m.querySelector("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const v = MC.int(e.target.value, NaN); close(Number.isFinite(v) ? v : null); }
    }),
  });

  // ---------------------------------------------------------------- файлы
  MC.download = (name, text, type = "application/json") => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  MC.pickFile = (accept) => new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });

  /** Картинка → квадратный JPEG ≤ size px в data URL (для портрета). */
  MC.imageToDataUrl = (file, size = 256) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = Math.min(size, s);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
})();
