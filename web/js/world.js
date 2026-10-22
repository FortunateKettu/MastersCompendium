// Masters Compendium — мир кампании: дата и время, погода (в том числе дождь/снег на карте), таймеры,
// тайные броски мастера за всю партию, журнал сессий. Мастеру — раздел «Мир» во вкладке «Мастер»,
// всем — значок с датой, временем и погодой в шапке.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const W = (MC.World = { w: null });
  const gm = () => MC.isGM();
  const WX_IC = { clear: "☀️", cloudy: "⛅", overcast: "☁️", fog: "🌫️", drizzle: "🌦️", rain: "🌧️", storm: "⛈️", snow: "🌨️", blizzard: "❄️", wind: "💨", heat: "🔥", sandstorm: "🏜️" };
  const pad = (n) => String(n).padStart(2, "0");
  const timeStr = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const partOfDay = (m) => (m < 300 ? "night" : m < 420 ? "dawn" : m < 720 ? "morning" : m < 1020 ? "day" : m < 1260 ? "evening" : "night");
  const dateStr = (w) => `${w.date.dom} ${esc(w.date.month_name)} ${w.date.year}`;
  const wxStr = (wx) => (wx ? `${WX_IC[wx.kind] || ""} ${t("wx." + wx.kind)}, ${wx.temp > 0 ? "+" : ""}${wx.temp}°` : t("wx.none"));

  // ---------------------------------------------------------------- значок в шапке
  function renderChip() {
    let el = $("#world-chip");
    const w = W.w;
    if (!w || MC.pop || $("#scr-game")?.hidden) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement("button");
      el.id = "world-chip";
      el.className = "world-chip";
      document.querySelector(".head-right")?.prepend(el);
    }
    el.hidden = false;
    const tm = (w.timers || []).filter((x) => x.kind !== "real" || x.end > Date.now() / 1000);
    el.innerHTML = `<span class="wc-ic">${WX_IC[w.weather?.kind] || "🕯️"}</span><span class="wc-t"><b>${timeStr(w.minute)}</b><small>${w.date.dom} ${esc(w.date.month_name)}</small></span>${tm.length ? `<i class="wc-tm">${tm.length}</i>` : ""}`;
    el.title = `${dateStr(w)} · ${timeStr(w.minute)} · ${wxStr(w.weather)}`;
  }
  async function showInfo() {
    const w = W.w;
    if (!w) return;
    const tm = (w.timers || []);
    await MC.modal({ title: dateStr(w), body: `<div class="wi">
      <p class="wi-time">${MC.icon("hourglass", "sm")} <b>${timeStr(w.minute)}</b> · ${t("tod." + partOfDay(w.minute))} · ${t("w.day_n", { n: w.day })}</p>
      <p class="wi-wx"><span class="wi-big">${WX_IC[w.weather?.kind] || "—"}</span> <b>${wxStr(w.weather)}</b>${w.weather ? ` · ${t("wind." + w.weather.wind)}` : ""}</p>
      ${w.weather ? `<p class="muted small">${t("wxe." + w.weather.kind)}</p>` : ""}
      ${tm.length ? `<h4>${t("tmr.title")}</h4><ul class="tmr-list">${tm.map(timerLi).join("")}</ul>` : ""}</div>`,
      buttons: [{ label: t("close"), kind: "primary", value: null }] });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("#world-chip")) showInfo(); });
  const timerLeft = (x) => (x.kind === "real" ? Math.max(0, Math.round(x.end - Date.now() / 1000)) : x.left);
  const timerLi = (x) => `<li data-tmr="${x.id}"><b>${esc(x.name)}</b><span class="tmr-left" data-tmrk="${x.kind}" data-end="${x.end || ""}">${fmtLeft(x)}</span>
    ${gm() ? `${x.vis ? MC.icon("eye", "sm") : MC.icon("hidden", "sm")}<button class="icon-btn small" data-tmrdel="${x.id}">${MC.icon("x", "sm")}</button>` : ""}</li>`;
  const fmtLeft = (x) => {
    const n = timerLeft(x);
    if (x.kind === "round") return t("tmr.rounds", { n });
    if (x.kind === "min") return n >= 60 ? t("tmr.hm", { h: Math.floor(n / 60), m: n % 60 }) : t("tmr.min", { n });
    return `${Math.floor(n / 60)}:${pad(n % 60)}`;
  };
  // реальные таймеры: обновлять каждую секунду
  setInterval(() => {
    for (const el of document.querySelectorAll('.tmr-left[data-tmrk="real"]')) {
      const n = Math.max(0, Math.round(Number(el.dataset.end) - Date.now() / 1000));
      el.textContent = `${Math.floor(n / 60)}:${pad(n % 60)}`;
    }
    if (W.w) {
      const due = (W.w.timers || []).filter((x) => x.kind === "real" && !x._fired && x.end <= Date.now() / 1000);
      for (const x of due) {
        x._fired = true;
        if (gm() || x.vis) { MC.toast(t("tmr.done", { name: x.name }), "warn", "hourglass"); try { navigator.vibrate?.([100, 60, 100]); } catch { /* */ } }
        if (gm()) MC.send({ t: "tmr_del", id: x.id });
      }
    }
  }, 1000);

  // ---------------------------------------------------------------- погода на карте
  let fxCv = null, fxParts = [], fxRaf = 0, fxKind = "";
  W.refreshFx = () => weatherFx();
  function weatherFx() {
    const w = W.w;
    const kind = w && w.weather_fx && MC.store.get("opt_wxfx") !== "0" ? w.weather?.kind : "";
    const stage = $("#map-stage");
    const on = ["drizzle", "rain", "storm", "snow", "blizzard", "fog", "sandstorm", "wind"].includes(kind) && stage;
    if (!on) { if (fxCv) fxCv.hidden = true; cancelAnimationFrame(fxRaf); fxRaf = 0; fxKind = ""; return; }
    if (!fxCv) { fxCv = document.createElement("canvas"); fxCv.className = "wx-fx"; stage.appendChild(fxCv); }
    fxCv.hidden = false;
    if (fxKind !== kind) { fxKind = kind; fxParts = []; }
    if (!fxRaf) fxRaf = requestAnimationFrame(fxStep);
  }
  const fogCache = {};
  /** Бесшовная текстура клубов (фрактальный шум с периодом 256) — один раз на цвет. */
  function fogTex(col) {
    const key = col.join(",");
    if (fogCache[key]) return fogCache[key];
    const N = 256, c = document.createElement("canvas"); c.width = c.height = N;
    const x = c.getContext("2d"), im = x.createImageData(N, N);
    const oct = [[8, 0.5], [16, 0.28], [32, 0.15], [64, 0.07]];
    const grids = oct.map(([n]) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; });
    const sm = (q) => q * q * (3 - 2 * q);
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      let v = 0;
      oct.forEach(([n, amp], o) => {
        const fx = (px / N) * n, fy = (py / N) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        const gd = grids[o], at = (xx, yy) => gd[((yy + n) % n) * n + ((xx + n) % n)];
        const a = at(x0, y0), b = at(x0 + 1, y0), cc = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        v += (a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty) * amp;
      });
      const al = Math.max(0, Math.min(1, (v - 0.38) * 2.2));
      const i = (py * N + px) * 4;
      im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = Math.round(al * al * 255 * 0.7);
    }
    x.putImageData(im, 0, 0);
    return (fogCache[key] = c);
  }
  let fxLast = 0, flash = 0;
  function fxStep(now) {
    fxRaf = 0;
    const tabOn = document.querySelector(".tab.active")?.dataset.tab === "map";
    if (!fxCv || fxCv.hidden || !fxKind) return;
    if (!tabOn || document.hidden) { fxRaf = requestAnimationFrame(fxStep); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W0 = fxCv.clientWidth, H0 = fxCv.clientHeight;
    if (fxCv.width !== Math.round(W0 * dpr) || fxCv.height !== Math.round(H0 * dpr)) { fxCv.width = Math.round(W0 * dpr); fxCv.height = Math.round(H0 * dpr); }
    const g = fxCv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W0, H0);
    const dt = Math.min(0.05, (now - fxLast) / 1000 || 0.016);
    fxLast = now;
    const k = fxKind;
    const want = { drizzle: 70, rain: 220, storm: 360, snow: 140, blizzard: 420, sandstorm: 260, wind: 40, fog: 0 }[k] * Math.min(1.6, (W0 * H0) / (1280 * 800));
    while (fxParts.length < want) fxParts.push({ x: Math.random() * W0, y: Math.random() * H0, s: 0.6 + Math.random() * 0.8, r: Math.random() });
    if (k === "fog" || k === "blizzard" || k === "sandstorm" || k === "drizzle") {
      // клубы тумана: бесшовная шумовая текстура, два слоя плывут с разной скоростью
      const tt = now / 1000;
      const col = k === "sandstorm" ? [214, 172, 110] : [222, 228, 236];
      const tex = fogTex(col);
      const base = { fog: 0.85, blizzard: 0.55, sandstorm: 0.6, drizzle: 0.3 }[k];
      const sp = k === "fog" ? 1 : 4;
      for (const [sc, vx, vy, a] of [[3.2, 9, 2, 0.75], [2.1, -14, 4, 0.55], [1.4, 22, -3, 0.3]]) {
        const size = 256 * sc;
        const ox = (((tt * vx * sp) % size) + size) % size, oy = (((tt * vy * sp) % size) + size) % size;
        g.globalAlpha = a * base;
        for (let y = -oy; y < H0; y += size) for (let x = -ox; x < W0; x += size) g.drawImage(tex, x, y, size + 1, size + 1);
      }
      g.globalAlpha = 1;
      if (k === "fog") {           // по краям гуще
        const vg = g.createRadialGradient(W0 / 2, H0 / 2, Math.min(W0, H0) * 0.25, W0 / 2, H0 / 2, Math.max(W0, H0) * 0.7);
        vg.addColorStop(0, "rgba(222,228,236,0)"); vg.addColorStop(1, "rgba(222,228,236,.45)");
        g.fillStyle = vg; g.fillRect(0, 0, W0, H0);
      }
    }
    const windX = { storm: 160, blizzard: 260, sandstorm: 420, wind: 520, rain: 60, drizzle: 30, snow: 30 }[k] || 0;
    for (const p of fxParts) {
      if (k === "snow" || k === "blizzard") {
        p.y += (40 + p.s * 50) * dt * (k === "blizzard" ? 2 : 1); p.x += (windX * p.s + Math.sin(now / 700 + p.r * 9) * 20) * dt;
        g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.arc(p.x, p.y, 1.2 + p.s * 1.6, 0, 7); g.fill();
      } else if (k === "sandstorm" || k === "wind") {
        p.x += windX * p.s * dt; p.y += Math.sin(now / 400 + p.r * 7) * 12 * dt;
        g.strokeStyle = k === "wind" ? "rgba(230,235,245,.25)" : "rgba(214,170,100,.45)"; g.lineWidth = k === "wind" ? 1.2 : 1.6;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - (k === "wind" ? 40 : 10) * p.s, p.y); g.stroke();
      } else if (k !== "fog") {
        const vy = (k === "drizzle" ? 380 : 700) * p.s;
        p.y += vy * dt; p.x += windX * dt;
        g.strokeStyle = `rgba(180,200,235,${k === "drizzle" ? 0.35 : 0.5})`; g.lineWidth = k === "drizzle" ? 1 : 1.3;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - windX * 0.02, p.y - vy * 0.025); g.stroke();
      }
      if (p.y > H0 + 20) { p.y = -20; p.x = Math.random() * W0; }
      if (p.x > W0 + 40) { p.x = -40; p.y = Math.random() * H0; }
      if (p.x < -40) p.x = W0 + 40;
    }
    if (k === "storm") {
      if (flash <= 0 && Math.random() < dt * 0.12) flash = 0.35;
      if (flash > 0) { g.fillStyle = `rgba(230,235,255,${flash * 0.6})`; g.fillRect(0, 0, W0, H0); flash -= dt; }
    }
    fxRaf = requestAnimationFrame(fxStep);
  }

  // ---------------------------------------------------------------- мастер: раздел «Мир»
  let sroll = null;          // последний тайный бросок
  let sess = { list: [], cur: null, draft: "" };
  const SKILLS = ["perception", "insight", "investigation", "stealth", "survival", "arcana", "history", "nature", "religion", "medicine", "athletics", "acrobatics"];
  const skName = (s) => (s.startsWith("save_") ? `${t("ab.save")}: ${MC.R.abName(s.slice(5), false)}` : MC.R.srd?.skill?.[s] ? MC.L(MC.R.srd.skill[s]) : MC.R.abName ? MC.R.abName(s, false) : s);
  function worldHtml() {
    const w = W.w;
    if (!w) return `<p class="muted">…</p>`;
    const months = (w.months || []).map((m) => `${m.name}:${m.days}`).join("\n");
    return `<div class="world-grid">
      <section class="card glass"><h3>${MC.icon("hourglass", "sm")} ${t("w.time")}</h3>
        <div class="w-now"><b>${timeStr(w.minute)}</b> · ${t("tod." + partOfDay(w.minute))}<br><span>${dateStr(w)}</span> <span class="muted small">(${t("w.day_n", { n: w.day })})</span></div>
        <div class="w-btns">${[[10, "+10 мин"], [60, "+1 ч"], [480, "+8 ч"], [1440, "+1 д"]].map(([n, l]) => `<button class="btn small" data-wadd="${n}">${t("w.add_" + n)}</button>`).join("")}
          <button class="btn small" data-wadd="-60">${t("w.add_-60")}</button></div>
        <div class="w-set"><label>${t("w.set_time")} <input type="time" id="w-time" value="${timeStr(w.minute)}"></label>
          <label>${t("w.set_day")} <input type="number" id="w-day" min="1" value="${w.day}"></label>
          <button class="btn small" data-wg="settime">${MC.icon("check", "sm")}</button></div>
        <details><summary class="muted small">${t("w.calendar")}</summary>
          <label class="field"><span>${t("w.year")}</span><input type="number" id="w-year" value="${w.year}"></label>
          <label class="field"><span>${t("w.months")}</span><textarea id="w-months" rows="6">${esc(months)}</textarea></label>
          <button class="btn small" data-wg="cal">${MC.icon("save", "sm")} ${t("save")}</button></details></section>
      <section class="card glass"><h3>🌦️ ${t("wx.title")}</h3>
        <p class="w-wx"><span class="wi-big">${WX_IC[w.weather?.kind] || "—"}</span> ${wxStr(w.weather)}${w.weather ? ` · ${t("wind." + w.weather.wind)}` : ""}</p>
        ${w.weather ? `<p class="muted small">${t("wxe." + w.weather.kind)}</p>` : ""}
        <div class="w-btns"><button class="btn small primary" data-wg="roll">🎲 ${t("wx.roll")}</button>
          <select id="wx-kind"><option value="">${t("wx.pick")}</option>${Object.keys(WX_IC).map((k) => `<option value="${k}" ${w.weather?.kind === k ? "selected" : ""}>${WX_IC[k]} ${t("wx." + k)}</option>`).join("")}</select></div>
        <label class="field"><span>${t("wx.climate")}</span><select id="wx-climate">${["temperate", "cold", "hot", "tropic", "sea"].map((k) => `<option value="${k}" ${w.climate === k ? "selected" : ""}>${t("clim." + k)}</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" data-wflag="auto_weather" ${w.auto_weather ? "checked" : ""}> ${t("wx.auto")}</label>
        <label class="check"><input type="checkbox" data-wflag="weather_fx" ${w.weather_fx ? "checked" : ""}> ${t("wx.fx")}</label></section>
      <section class="card glass"><h3>${MC.icon("hourglass", "sm")} ${t("tmr.title")}</h3>
        <ul class="tmr-list">${(w.timers || []).map(timerLi).join("") || `<li class="muted small">${t("tmr.none")}</li>`}</ul>
        <div class="tmr-add"><input id="tmr-name" placeholder="${esc(t("tmr.name_ph"))}"><input id="tmr-n" type="number" min="1" value="3">
          <select id="tmr-kind"><option value="round">${t("tmr.k.round")}</option><option value="min">${t("tmr.k.min")}</option><option value="real">${t("tmr.k.real")}</option></select>
          <label class="check"><input type="checkbox" id="tmr-vis"> ${t("tmr.vis")}</label>
          <button class="btn small primary" data-wg="tmr">${MC.icon("plus", "sm")}</button></div></section>
      <section class="card glass"><h3>${MC.icon("hidden", "sm")} ${t("sr.title")}</h3>
        <p class="muted small">${t("sr.hint")}</p>
        <div class="w-btns"><select id="sr-sk">${[...SKILLS, "save_dex", "save_con", "save_wis"].map((s) => `<option value="${s}">${esc(skName(s))}</option>`).join("")}</select>
          <input id="sr-dc" type="number" min="0" max="40" placeholder="${esc(t("act.dc"))}"><button class="btn small primary" data-wg="sroll">🎲 ${t("sr.go")}</button></div>
        ${sroll ? `<table class="sr-table"><tr><th></th><th>${t("sr.roll")}</th><th>${t("sr.passive")}</th></tr>${sroll.results.map((r) => `<tr><td>${esc(r.name)}</td>
          <td class="${r.ok === true ? "good-text" : r.ok === false ? "bad-text" : ""}"><b>${r.roll}</b></td><td class="${r.pok === true ? "good-text" : r.pok === false ? "bad-text" : ""}">${r.passive}</td></tr>`).join("")}</table>
          <p class="muted small">${esc(skName(sroll.sk))}${sroll.dc ? ` · ${t("act.dc")} ${sroll.dc}` : ""}</p>` : ""}</section>
      <section class="card glass"><h3>${MC.icon("inventory", "sm")} ${t("sup.title")}</h3>
        <label class="check"><input type="checkbox" data-wflag="supplies" ${w.supplies ? "checked" : ""}> ${t("sup.on")}</label>
        <label class="check"><input type="checkbox" data-wflag="ammo" ${w.ammo !== false ? "checked" : ""} ${w.supplies ? "" : "disabled"}> ${t("sup.ammo_on")}</label>
        <p class="muted small">${t("sup.hint")}</p></section>
      <section class="card glass w-sess"><h3>${MC.icon("scroll", "sm")} ${t("ses.title")}</h3>
        <p class="muted small">${t("ses.hint")}</p>
        <div class="w-btns"><button class="btn small primary" data-wg="draft">${MC.icon("wand", "sm")} ${t("ses.draft")}</button></div>
        ${sess.cur ? `<label class="field"><span>${t("gm.ho.title")}</span><input id="ses-title" value="${esc(sess.cur.title || "")}"></label>
          <textarea id="ses-text" rows="10">${esc(sess.cur.text || "")}</textarea>
          <div class="w-btns"><button class="btn small primary" data-wg="ses_save">${MC.icon("save", "sm")} ${t("save")}</button>
          ${sess.cur.id ? `<button class="btn small" data-wg="ses_share">${MC.icon("cast", "sm")} ${t("ses.share")}</button>` : ""}</div>` : ""}
        <ul class="ses-list">${sess.list.slice().reverse().map((s) => `<li data-ses="${s.id}" class="${sess.cur?.id === s.id ? "cur" : ""}">${MC.icon(s.shared ? "eye" : "scroll", "sm")}<span>${esc(s.title)}</span>
          <small class="muted">${new Date(s.ts * 1000).toLocaleDateString()}</small><button class="icon-btn small" data-sesdel="${s.id}">${MC.icon("trash", "sm")}</button></li>`).join("")}</ul></section>
    </div>`;
  }
  const rerender = () => { if (MC.GM?.sub === "world" && document.querySelector(".tab.active")?.dataset.tab === "gm") MC.GM.render(); };
  const req = (o) => MC.request(o).catch((e) => { MC.toast(t(e.code ? "err." + e.code : "conn.offline"), "warn"); return null; });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-wadd]");
    if (a) { req({ t: "w_time", add: MC.int(a.dataset.wadd) }); return; }
    const td = e.target.closest("[data-tmrdel]");
    if (td) { req({ t: "tmr_del", id: td.dataset.tmrdel }); return; }
    const so = e.target.closest("[data-ses]");
    if (so && !e.target.closest("[data-sesdel]")) { sess.cur = sess.list.find((x) => x.id === so.dataset.ses) || null; rerender(); return; }
    const sd = e.target.closest("[data-sesdel]");
    if (sd) { if (await MC.confirm(t("confirm.delete", { name: sess.list.find((x) => x.id === sd.dataset.sesdel)?.title || "" }))) { await req({ t: "sess_del", id: sd.dataset.sesdel }); loadSess(); } return; }
    const g = e.target.closest("[data-wg]");
    if (!g) return;
    const k = g.dataset.wg;
    if (k === "settime") {
      const [h, m] = ($("#w-time")?.value || "0:0").split(":").map((x) => MC.int(x, 0));
      req({ t: "w_set", minute: h * 60 + m, day: MC.int($("#w-day")?.value, W.w.day) });
    }
    if (k === "cal") {
      const months = ($("#w-months")?.value || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [n, d] = l.split(":"); return { name: n.trim(), days: MC.int(d, 30) }; });
      req({ t: "w_set", months, year: MC.int($("#w-year")?.value, W.w.year) });
    }
    if (k === "roll") req({ t: "w_weather", roll: true });
    if (k === "tmr") {
      const name = $("#tmr-name")?.value.trim();
      if (!name) { $("#tmr-name")?.focus(); return; }
      const kind = $("#tmr-kind").value, n = MC.int($("#tmr-n").value, 1);
      req({ t: "tmr_add", name, kind, n: kind === "real" ? n * 60 : n, vis: $("#tmr-vis").checked });
    }
    if (k === "sroll") {
      const r = await req({ t: "sroll", sk: $("#sr-sk").value, dc: MC.int($("#sr-dc").value, 0) });
      if (r) { sroll = r; rerender(); }
    }
    if (k === "draft") {
      const r = await req({ t: "sess_draft" });
      if (r) { sess.cur = { title: t("ses.new_title", { n: sess.list.length + 1 }), text: r.text || t("ses.empty") }; rerender(); }
    }
    if (k === "ses_save" && sess.cur) {
      const r = await req({ t: "sess_save", id: sess.cur.id || "", title: $("#ses-title").value, text: $("#ses-text").value });
      if (r?.session) { sess.cur = r.session; MC.toast(t("ses.saved"), "ok"); loadSess(); }
    }
    if (k === "ses_share" && sess.cur?.id) { if (await req({ t: "sess_share", id: sess.cur.id })) { MC.toast(t("ses.shared"), "ok", "cast"); loadSess(); } }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest("[data-wflag]");
    if (f) { req({ t: "w_set", [f.dataset.wflag]: f.checked }); return; }
    if (e.target.id === "wx-kind" && e.target.value) req({ t: "w_weather", kind: e.target.value, temp: W.w.weather?.temp ?? 15 });
    if (e.target.id === "wx-climate") req({ t: "w_set", climate: e.target.value });
  });
  async function loadSess() {
    const r = await MC.request({ t: "sess_list" }).catch(() => null);
    if (r) { sess.list = r.sessions || []; if (sess.cur?.id) sess.cur = sess.list.find((x) => x.id === sess.cur.id) || sess.cur; rerender(); }
  }
  MC.GM?.addSub({ id: "world", ic: "map-pin", label: "w.tab", html: worldHtml, mount: () => { if (!sess.loaded) { sess.loaded = true; loadSess(); } } });

  // ---------------------------------------------------------------- сообщения
  MC.on("msg_world", (m) => {
    const prev = W.w;
    W.w = m;
    renderChip();
    weatherFx();
    const ae = document.activeElement;
    if (!(ae && ae.closest?.(".world-grid") && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) rerender();
    if (prev && !gm() && prev.weather?.kind !== m.weather?.kind && m.weather) MC.toast(`${t("wx.changed")}: ${wxStr(m.weather)}`, "", "");
  });
  const leftTxt = (m) => (m.kind === "real" ? t("tmr.min", { n: Math.max(1, Math.round((m.end - Date.now() / 1000) / 60)) }) : m.kind === "min" ? t("tmr.min", { n: m.left }) : t("tmr.rounds", { n: m.left }));
  MC.on("msg_w_timer_new", (m) => { if (!gm()) MC.toast(t("tmr.new", { name: m.name, left: leftTxt(m) }), "", "hourglass"); });
  MC.on("msg_w_timer_soon", (m) => {
    MC.toast(t("tmr.soon", { name: m.name, left: leftTxt(m) }), "warn", "hourglass");
    try { navigator.vibrate?.(80); } catch { /* */ }
  });
  MC.on("msg_w_timer", (m) => {
    MC.toast(t("tmr.done", { name: m.name }), "warn", "hourglass");
    try { navigator.vibrate?.([100, 60, 100]); } catch { /* */ }
  });
  MC.on("msg_w_supply", (m) => {
    const me = MC.state.me?.id;
    const mine = (m.short || []).filter((x) => gm() || [...MC.state.chars.values()].some((c) => c.owner === me && c.name === x.name));
    for (const x of mine) MC.toast(t(x.low ? "sup.low" : "sup.out", { name: x.name, what: t("sup.k." + x.kind) }), x.low ? "warn" : "bad", "inventory");
  });
  MC.on("welcome", () => { MC.send({ t: "w_get" }); sess.loaded = false; });
  MC.on("tab", (tab) => { if (tab === "map") weatherFx(); });
  MC.on("lang", () => { renderChip(); rerender(); });
})();
