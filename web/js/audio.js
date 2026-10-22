// Masters Compendium — звук: атмосфера, эффекты и музыка.
//  • мастер управляет звуком в «Мастер → Звук» и сам решает, слышат ли его игроки («Транслировать игрокам»);
//  • игрок может выключить звук мастера у себя («Настройки → Звук»);
//  • атмосфера — настоящие записи (дождь, гроза, ветер, костёр, лес, море, ночь, ручей, таверна, город;
//    авторы и лицензии — web/sounds/CREDITS.md), пещера и барабаны синтезируются; слои смешиваются;
//  • музыка — свои файлы мастера (хранятся в его браузере); при трансляции файл загружается на сервер,
//    и у игроков трек играет с того же места.
(() => {
  "use strict";
  const MC = window.MC;
  const { $, t, esc } = MC;
  const gm = () => MC.isGM();
  const A = (MC.Audio = {});
  const LS = "mc_audio_v1";
  let cfg = { master: 0.7, vol: {}, music: 0.6, loop: "all", shuffle: false };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(LS) || "{}")); } catch { /* ignore */ }
  const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch { /* ignore */ } };
  const SND_V = "1";

  // общее состояние звука кампании (от сервера)
  let srv = { share: false, layers: {}, master: 0.7, music: null, auto_wx: false };
  let clockOff = 0;                                      // время сервера − время этого устройства, с
  const optOn = () => MC.store.get("opt_au_on") !== "0";
  const optVol = () => MC.num(MC.store.get("opt_au_vol"), 0.8);
  /** Игрок слышит звук мастера? */
  const listening = () => !gm() && srv.share && optOn();

  let ctx = null, master = null, verb = null, noiseW = null, noiseB = null;
  const on = new Map();        // id → {nodes, timers, out}
  const buffers = new Map();   // имя записи → Promise<AudioBuffer|null>
  const rnd = (a, b) => a + Math.random() * (b - a);

  function masterLevel() { return gm() ? cfg.master : srv.master * optVol(); }
  function ac() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = masterLevel();
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 3;
    noiseW = ctx.createBuffer(1, len, ctx.sampleRate);
    noiseB = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = noiseW.getChannelData(0), b = noiseB.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.8, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    verb.buffer = ir;
    const vg = ctx.createGain();
    vg.gain.value = 0.5;
    verb.connect(vg).connect(master);
    return ctx;
  }
  const setMaster = () => { if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.08); };
  /** Запись из web/sounds (кэшируется). */
  function sample(name) {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(`/web/sounds/${name}.mp3?v=${SND_V}`).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab ? new Promise((ok) => ctx.decodeAudioData(ab, ok, () => ok(null))) : null)).catch(() => null));
    }
    return buffers.get(name);
  }
  const noise = (brown, out) => { const s = ctx.createBufferSource(); s.buffer = brown ? noiseB : noiseW; s.loop = true; s.connect(out); s.start(0, Math.random() * 2); return s; };
  const filt = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const lfo = (freq, depth, param, base) => {
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = gain(depth); o.connect(g).connect(param); if (base != null) param.value = base; o.start(); return o;
  };
  function blip(out, { type = "sine", f0, f1, dur, vol = 0.3, at = 0 }) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.01, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function burst(out, { hp = 0, lp = 20000, dur = 0.05, vol = 0.3, brown = false, at = 0, attack = 0.003 }) {
    const t0 = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = brown ? noiseB : noiseW;
    let n = s;
    if (hp) { const f = filt("highpass", hp); n.connect(f); n = f; }
    if (lp < 20000) { const f = filt("lowpass", lp); n.connect(f); n = f; }
    const g = gain(0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    n.connect(g).connect(out); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.1);
  }
  const every = (L, minS, maxS, fn) => {
    const go = () => { if (on.get(L.id) !== L) return; fn(); L.timers.push(setTimeout(go, rnd(minS, maxS) * 1000)); };
    L.timers.push(setTimeout(go, rnd(minS * 0.5, maxS) * 1000));
  };
  /** Зациклить запись (с небольшими полями — у mp3 по краям тишина кодировщика). */
  async function loopSample(L, name, vol = 1, gust = 0) {
    const buf = await sample(name);
    if (!buf || on.get(L.id) !== L) return !!buf;
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.min(0.08, buf.duration / 10); s.loopEnd = buf.duration - Math.min(0.08, buf.duration / 10);
    const g = gain(vol);
    s.connect(g).connect(L.out);
    if (gust) L.nodes.push(lfo(0.07 + Math.random() * 0.05, gust, g.gain, vol));     // порывы — чтобы короткая петля не приедалась
    s.start(0, Math.random() * buf.duration * 0.9);
    L.nodes.push(s);
    return true;
  }

  // ---------------------------------------------------------------- слои атмосферы
  const LAYERS = {
    rain: { ic: "cloud-rain", rec: "rain" },
    storm: { ic: "zap", async make(L) {
      await loopSample(L, "storm", 1);
      every(L, 18, 45, () => SFX.thunder(L.out, rnd(0.5, 0.9)));
    } },
    wind: { ic: "wind", rec: "wind", gust: 0.35 },
    fire: { ic: "flame", rec: "fire" },
    forest: { ic: "trees", rec: "forest" },
    sea: { ic: "waves", rec: "sea" },
    night: { ic: "moon", rec: "night" },
    stream: { ic: "droplet", rec: "stream" },
    tavern: { ic: "players", rec: "tavern" },
    city: { ic: "city", rec: "city" },
    cave: { ic: "mountain", make(L) {         // пещера: низкий гул + капли с эхом
      const lp = filt("lowpass", 90); const g = gain(0.7);
      L.nodes.push(noise(true, lp)); lp.connect(g).connect(L.out);
      L.nodes.push(lfo(0.05, 0.25, g.gain, 0.6));
      const wet = gain(1); wet.connect(L.out); wet.connect(verb);
      every(L, 0.7, 3.2, () => {
        const f = rnd(1100, 2000);
        blip(wet, { f0: f, f1: f * 0.45, dur: rnd(0.04, 0.09), vol: rnd(0.06, 0.18) });
        if (Math.random() < 0.4) blip(wet, { f0: f * 1.3, f1: f * 0.6, dur: 0.05, vol: 0.05, at: rnd(0.08, 0.2) });
      });
    } },
    drums: { ic: "drum", make(L) {
      const bpm = 84, beat = 60 / bpm;
      const pat = [1, 0, 0.5, 0, 1, 0.4, 0.7, 0];
      let step = 0, next = ctx.currentTime + 0.1;
      const tick = () => {
        while (next < ctx.currentTime + 0.3) {
          const v = pat[step % pat.length];
          if (v) {
            const at = next - ctx.currentTime;
            blip(L.out, { f0: v === 1 ? 110 : 160, f1: v === 1 ? 45 : 70, dur: 0.45, vol: 0.7 * v, at });
            burst(L.out, { lp: 900, dur: 0.12, vol: 0.12 * v, at, brown: true });
          }
          step++; next += beat / 2;
        }
      };
      L.timers.push(setInterval(tick, 100));
    } },
  };
  const SFX = {
    async thunder(out = master, k = 1) {
      const buf = await sample("thunder");
      if (buf) {
        const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rnd(0.85, 1.1);
        const g = gain(k * 1.1); s.connect(g).connect(out); s.start();
        return;
      }
      burst(out, { lp: 220, dur: rnd(3, 5), vol: 1.2 * k, brown: true, at: 0.05, attack: 0.08 });
    },
    gong(out = master) {
      for (const [r, v] of [[1, 0.35], [1.48, 0.2], [2.03, 0.15], [2.74, 0.1], [3.9, 0.06]]) { blip(out, { f0: 98 * r, f1: 96 * r, dur: 5, vol: v }); blip(verb, { f0: 98 * r, dur: 4, vol: v / 2 }); }
    },
    bell(out = master) {
      for (const [r, v] of [[1, 0.3], [2.76, 0.15], [5.4, 0.08], [8.93, 0.04]]) { blip(out, { f0: 520 * r, dur: 2.5 / Math.sqrt(r), vol: v }); blip(verb, { f0: 520 * r, dur: 2, vol: v / 3 }); }
    },
    clash(out = master) {
      burst(out, { hp: 2500, dur: 0.25, vol: 0.5 });
      for (const f of [2950, 4110, 5230, 6700]) blip(out, { type: "triangle", f0: f, dur: rnd(0.5, 0.9), vol: 0.06 });
    },
    boom(out = master) {
      blip(out, { f0: 90, f1: 30, dur: 1.4, vol: 0.9 });
      burst(out, { lp: 400, dur: 2.5, vol: 1, brown: true, attack: 0.01 });
      burst(out, { hp: 1500, dur: 0.4, vol: 0.3 });
    },
    horn(out = master) {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(147, t0); o.frequency.linearRampToValueAtTime(220, t0 + 0.25);
      const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = gain(3); vib.connect(vg).connect(o.frequency);
      const lp = filt("lowpass", 900, 2); const g = gain(0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.35, t0 + 0.3); g.gain.setValueAtTime(0.35, t0 + 1.6); g.gain.linearRampToValueAtTime(0, t0 + 2.4);
      o.connect(lp).connect(g); g.connect(out); g.connect(verb);
      o.start(t0); vib.start(t0); o.stop(t0 + 2.5); vib.stop(t0 + 2.5);
    },
    door(out = master) {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(70, t0); o.frequency.linearRampToValueAtTime(140, t0 + 0.9); o.frequency.linearRampToValueAtTime(90, t0 + 1.4);
      const bp = filt("bandpass", 900, 8); const g = gain(0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.25, t0 + 0.1); g.gain.linearRampToValueAtTime(0.18, t0 + 1.2); g.gain.linearRampToValueAtTime(0, t0 + 1.5);
      o.connect(bp).connect(g).connect(out); o.start(t0); o.stop(t0 + 1.6);
      burst(out, { lp: 300, dur: 0.4, vol: 0.6, brown: true, at: 1.45 });
    },
    magic(out = master) {
      for (let i = 0; i < 12; i++) blip(out, { type: "triangle", f0: 800 * Math.pow(1.12, i), dur: 0.6, vol: 0.05, at: i * 0.05 });
      for (let i = 0; i < 12; i++) blip(verb, { f0: 1600 * Math.pow(1.12, i), dur: 0.5, vol: 0.03, at: i * 0.05 });
    },
  };

  async function layerOn(id, vol) {
    if (!LAYERS[id] || !ac() || on.has(id)) return;
    const L = { id, nodes: [], timers: [], out: gain(0) };
    L.out.connect(master);
    on.set(id, L);
    const D = LAYERS[id];
    if (D.rec) await loopSample(L, D.rec, 1, D.gust || 0);
    else await D.make(L);
    if (on.get(id) !== L) return;
    L.out.gain.setValueAtTime(0, ctx.currentTime);
    L.out.gain.linearRampToValueAtTime(vol, ctx.currentTime + 2);   // плавное появление
  }
  function layerOff(id) {
    const L = on.get(id);
    if (!L) return;
    on.delete(id);
    L.timers.forEach((x) => { clearTimeout(x); clearInterval(x); });
    const t0 = ctx.currentTime;
    L.out.gain.cancelScheduledValues(t0); L.out.gain.setValueAtTime(L.out.gain.value, t0); L.out.gain.linearRampToValueAtTime(0, t0 + 1.5);
    setTimeout(() => { L.nodes.forEach((n) => { try { n.stop(); } catch { /* ignore */ } }); try { L.out.disconnect(); } catch { /* ignore */ } }, 1700);
  }
  function layerVol(id, v) {
    const L = on.get(id);
    if (L && ctx) { L.out.gain.cancelScheduledValues(ctx.currentTime); L.out.gain.setTargetAtTime(v, ctx.currentTime, 0.15); }
  }
  /** Привести звучащие слои к списку {id: громкость}. */
  function applyLayers(want) {
    for (const id of [...on.keys()]) if (!(id in want)) layerOff(id);
    for (const [id, v] of Object.entries(want)) { if (on.has(id)) layerVol(id, v); else layerOn(id, v); }
  }
  A.stopAll = () => [...on.keys()].forEach(layerOff);

  // ---------------------------------------------------------------- мастер: что звучит → на сервер
  const gmLayers = () => Object.fromEntries([...on.keys()].map((id) => [id, cfg.vol[id] ?? 0.6]));
  let pushTm = 0;
  function pushState(extra = {}) {
    if (!gm()) return;
    clearTimeout(pushTm);
    pushTm = setTimeout(() => MC.request({ t: "au_set", layers: gmLayers(), master: cfg.master, ...extra }).catch(() => {}), 250);
  }
  const WX_LAYERS = { drizzle: ["rain"], rain: ["rain"], storm: ["storm", "rain"], snow: ["wind"], blizzard: ["wind"], wind: ["wind"], sandstorm: ["wind"], fog: ["wind"] };
  A.byWeather = () => {
    if (!ac()) return;
    const w = MC.World?.w || {};
    const want = new Set(WX_LAYERS[w.weather?.kind] || []);
    const m = MC.int(w.minute, 480) % 1440, night = m < 300 || m > 1260;
    if (!want.size) want.add(night ? "night" : "forest");
    const keep = new Set(["drums", "fire", "tavern", "city", "stream", "cave", "sea"]);
    for (const id of [...on.keys()]) if (!want.has(id) && !keep.has(id)) layerOff(id);
    want.forEach((id) => layerOn(id, cfg.vol[id] ?? 0.6));
    render(); pushState();
  };

  // ---------------------------------------------------------------- музыка мастера (свои файлы)
  let db = null, tracks = [], cur = -1, url = "";
  const audio = new Audio();
  audio.preload = "auto";
  A.el = audio;
  A.playing = () => [...on.keys()];
  audio.volume = cfg.music;
  function idb() {
    if (db) return Promise.resolve(db);
    return new Promise((res) => {
      try {
        const r = indexedDB.open("mc_music", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("tracks", { keyPath: "id" });
        r.onsuccess = () => { db = r.result; res(db); };
        r.onerror = () => res(null);
      } catch { res(null); }
    });
  }
  const idbPut = async (x) => { const d = await idb(); try { d?.transaction("tracks", "readwrite").objectStore("tracks").put(x); } catch { x.mem = true; } };
  async function loadTracks() {
    const d = await idb();
    if (!d) return;
    await new Promise((res) => {
      const rq = d.transaction("tracks").objectStore("tracks").getAll();
      rq.onsuccess = () => { const mem = tracks.filter((x) => x.mem); tracks = [...(rq.result || []).sort((a, b) => a.ord - b.ord), ...mem]; res(); };
      rq.onerror = () => res();
    });
    render();
  }
  async function addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith("audio/") && !/\.(mp3|ogg|wav|m4a|flac|opus|webm)$/i.test(f.name)) continue;
      const x = { id: MC.uid(), name: f.name.replace(/\.[^.]+$/, ""), blob: f, ord: Date.now() + tracks.length };
      tracks.push(x);
      await idbPut(x);
    }
    render();
  }
  async function delTrack(id) {
    const i = tracks.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (i === cur) { audio.pause(); cur = -1; musicPush(); }
    else if (i < cur) cur--;
    tracks.splice(i, 1);
    const d = await idb();
    try { d?.transaction("tracks", "readwrite").objectStore("tracks").delete(id); } catch { /* ignore */ }
    render();
  }
  /** Загрузить трек на сервер (один раз), чтобы его слышали игроки. */
  async function uploadTrack(x) {
    if (x.aid) return x.aid;
    if (x.up) return x.up;
    MC.toast(t("au.uploading", { name: x.name }), "", "upload");
    x.up = fetch("/api/audio", { method: "POST", body: x.blob, headers: { "X-MC-Key": MC.session.get("gm_key") || "" } })
      .then((r) => r.json()).then((j) => {
        if (!j.id) throw new Error(j.error || "upload");
        x.aid = j.id; idbPut(x); return j.id;
      }).catch((e) => { MC.toast(t(e.message === "too_big" ? "au.too_big" : "au.upload_failed"), "warn"); return null; })
      .finally(() => { x.up = null; });
    return x.up;
  }
  /** Сообщить серверу, что играет музыка (игроки подхватят). */
  async function musicPush() {
    if (!gm()) return;
    const x = tracks[cur];
    if (!srv.share || !x) { MC.request({ t: "au_set", music: null }).catch(() => {}); return; }
    const aid = await uploadTrack(x);
    if (!aid || tracks[cur] !== x) return;
    MC.request({ t: "au_set", music: { id: aid, name: x.name, playing: !audio.paused, pos: audio.currentTime || 0, vol: cfg.music, loop: cfg.loop === "one" } }).catch(() => {});
  }
  /** Свои звуки-эффекты: файл сразу уходит на сервер, кнопка появляется у мастера, игроки слышат при трансляции. */
  async function addSfx(files) {
    const list = [...(srv.custom || [])];
    for (const f of files) {
      if (f.size > 15 * 1024 * 1024) { MC.toast(t("au.too_big"), "warn"); continue; }
      try {
        const r = await fetch("/api/audio", { method: "POST", body: f, headers: { "X-MC-Key": MC.session.get("gm_key") || "" } });
        const j = await r.json();
        if (!j.id) throw new Error(j.error || "upload");
        if (!list.some((x) => x.id === j.id)) list.push({ id: j.id, name: f.name.replace(/\.[^.]+$/, "").slice(0, 40) });
      } catch { MC.toast(t("au.upload_failed"), "warn"); }
    }
    MC.request({ t: "au_set", custom: list }).catch(() => {});
  }
  function play(i) {
    if (!tracks.length) return;
    cur = (i + tracks.length) % tracks.length;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(tracks[cur].blob);
    audio.src = url;
    audio.loop = cfg.loop === "one";
    audio.play().catch(() => {});
    render();
  }
  const nextIdx = () => (cfg.shuffle && tracks.length > 1 ? (cur + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length : cur + 1);
  audio.addEventListener("ended", () => {
    if (!gm()) return;
    if (cfg.loop === "none" && !cfg.shuffle && cur >= tracks.length - 1) { render(); musicPush(); return; }
    play(nextIdx());
  });
  audio.addEventListener("play", () => { render(); if (gm()) musicPush(); });
  audio.addEventListener("pause", () => { render(); if (gm() && !audio.ended) musicPush(); });
  audio.addEventListener("seeked", () => { if (gm()) musicPush(); });
  let lastSec = -1;
  audio.addEventListener("timeupdate", () => {
    const s = Math.floor(audio.currentTime);
    if (s === lastSec) return;
    lastSec = s;
    const el = $("#au-pos");
    if (el) el.textContent = `${mmss(audio.currentTime)} / ${mmss(audio.duration)}`;
    const sk = $("#au-seek");
    if (sk && document.activeElement !== sk && audio.duration) { sk.value = String(Math.round((audio.currentTime / audio.duration) * 1000)); MC.fillRange?.(sk); }
  });
  const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");

  // ---------------------------------------------------------------- игрок: слушаем мастера
  let pMusic = "";
  function playerApply() {
    if (gm()) return;
    if (!listening()) {
      if (on.size) A.stopAll();
      if (!audio.paused) audio.pause();
      return;
    }
    if (!ac()) return;
    setMaster();
    applyLayers(srv.layers || {});
    const m = srv.music;
    if (!m || !m.playing) { if (!audio.paused) audio.pause(); if (!m) pMusic = ""; }
    else {
      if (pMusic !== m.id) { pMusic = m.id; audio.src = "/audio/" + m.id; }
      audio.loop = !!m.loop;
      audio.volume = Math.min(1, (m.vol ?? 0.6) * optVol());
      const sync = () => {
        let pos = m.pos + (Date.now() / 1000 + clockOff - m.at);
        if (audio.duration && Number.isFinite(audio.duration)) { if (m.loop) pos %= audio.duration; else if (pos >= audio.duration) { audio.pause(); return; } }
        if (Math.abs(audio.currentTime - pos) > 1.5) { try { audio.currentTime = pos; } catch { /* ещё не загрузилось */ } }
      };
      if (audio.readyState >= 1) sync(); else audio.addEventListener("loadedmetadata", sync, { once: true });
      audio.play().catch(() => needTap());
    }
    if (ctx && ctx.state === "suspended") needTap();
  }
  // телефоны не дают играть звук без касания — просим нажать один раз
  function needTap() {
    if (document.getElementById("au-tap")) return;
    const el = document.createElement("div");
    el.className = "cb-notice glass au-tap";
    el.id = "au-tap";
    el.innerHTML = `<div class="cbn-ic">${MC.icon("volume")}</div><div class="cbn-text"><b>${t("au.tap")}</b><span class="muted small">${t("au.tap_d")}</span></div>
      <div class="cbn-act"><button class="btn small primary" data-au-unlock>${MC.icon("play", "sm")} ${t("au.tap_go")}</button>
        <button class="btn small" data-au-mute>${t("au.tap_no")}</button></div>`;
    document.body.appendChild(el);
  }
  function unlock() {
    document.getElementById("au-tap")?.remove();
    if (ctx) ctx.resume().catch(() => {});
    playerApply();
  }
  document.addEventListener("pointerdown", () => { if (listening() && ((ctx && ctx.state === "suspended") || (srv.music?.playing && audio.paused))) unlock(); }, { capture: true });
  A.refresh = () => { setMaster(); playerApply(); };

  MC.on("msg_au", (m) => {
    clockOff = (m.now || Date.now() / 1000) - Date.now() / 1000;
    const wasShare = srv.share;
    srv = { share: !!m.share, layers: m.layers || {}, master: MC.num(m.master, 0.7), music: m.music || null, auto_wx: !!m.auto_wx, custom: m.custom || [] };
    if (gm()) { render(); return; }
    if (!wasShare && srv.share && optOn()) MC.toast(t("au.shared_on"), "", "volume");
    playerApply();
  });
  /** Свой звук мастера (файл на сервере) — одним проигрыванием. */
  const customBufs = new Map();
  async function playCustom(id) {
    if (!ac()) return;
    if (!customBufs.has(id)) customBufs.set(id, fetch("/audio/" + id).then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => (ab ? new Promise((ok) => ctx.decodeAudioData(ab, ok, () => ok(null))) : null)).catch(() => null));
    const buf = await customBufs.get(id);
    if (!buf) return;
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(master); s.start();
  }
  const playSfx = (k) => { if (k.startsWith("c:")) playCustom(k.slice(2)); else if (SFX[k]) SFX[k](); };
  MC.on("msg_au_sfx", (m) => { if (listening() && ac()) playSfx(m.k); });
  // погода сменилась — мастер с «по погоде сам» подбирает звук
  let lastWx = "";
  MC.on("msg_world", (m) => {
    const k = m.weather?.kind || "";
    if (gm() && srv.auto_wx && lastWx && k !== lastWx) A.byWeather();
    lastWx = k;
  });

  // ---------------------------------------------------------------- интерфейс (раздел мастера «Звук»)
  function html() {
    const playing = cur >= 0 && !audio.paused;
    return `<div class="card glass au-box au-share">
        <label class="opt-row"><span class="opt-l"><b>${MC.icon("cast", "sm")} ${t("au.share")}</b><small class="muted">${t("au.share_d")}</small></span>
          <input type="checkbox" class="switch" data-au-flag="share" ${srv.share ? "checked" : ""}></label>
        <label class="opt-row"><span class="opt-l"><b>${MC.icon("cloud-rain", "sm")} ${t("au.auto_wx")}</b><small class="muted">${t("au.auto_wx_d")}</small></span>
          <input type="checkbox" class="switch" data-au-flag="auto_wx" ${srv.auto_wx ? "checked" : ""}></label></div>
      <div class="card glass au-box">
        <div class="au-head"><h4>${t("au.ambience")}</h4>
          <label class="au-master">${MC.icon("volume", "sm")}<input type="range" min="0" max="1" step="0.01" data-au="master" value="${cfg.master}"></label></div>
        <div class="au-grid">${Object.entries(LAYERS).map(([id, L]) => `<div class="au-layer ${on.has(id) ? "on" : ""}">
            <button class="au-tg" data-aul="${id}">${MC.icon(L.ic)}<span>${t("au.l." + id)}</span></button>
            <input type="range" min="0" max="1" step="0.01" data-auv="${id}" value="${cfg.vol[id] ?? 0.6}"></div>`).join("")}</div>
        <div class="row-btns"><button class="btn small" data-au="weather">${MC.icon("cloud-rain", "sm")} ${t("au.by_weather")}</button>
          <button class="btn small" data-au="stop" ${on.size ? "" : "disabled"}>${MC.icon("volume-off", "sm")} ${t("au.stop")}</button></div>
        <p class="muted small">${t("au.credits")}</p>
      </div>
      <div class="card glass au-box"><h4>${t("au.sfx")}</h4>
        <div class="au-sfx">${Object.keys(SFX).map((k) => `<button class="btn small" data-ausfx="${k}">${t("au.s." + k)}</button>`).join("")}</div>
        <h4 class="au-sub">${t("au.my_sfx")}</h4>
        <div class="au-sfx">${(srv.custom || []).map((x) => `<span class="au-csfx"><button class="btn small" data-ausfx="c:${esc(x.id)}">${MC.icon("play", "sm")} ${esc(x.name)}</button><button class="icon-btn small" data-aucdel="${esc(x.id)}" title="${esc(t("delete"))}">${MC.icon("x", "sm")}</button></span>`).join("")}
          <label class="btn small au-add">${MC.icon("plus", "sm")} ${t("au.add_sfx")}<input type="file" accept="audio/*" multiple hidden id="au-sfx-files"></label></div>
        <p class="muted small">${t("au.my_sfx_hint")}</p></div>
      <div class="card glass au-box">
        <div class="au-head"><h4>${MC.icon("music", "sm")} ${t("au.music")}</h4>
          <label class="au-master">${MC.icon("volume", "sm")}<input type="range" min="0" max="1" step="0.01" data-au="music" value="${cfg.music}"></label></div>
        <div class="au-player">
          <button class="icon-btn" data-au="prev" ${tracks.length ? "" : "disabled"}>${MC.icon("back")}</button>
          <button class="icon-btn au-play" data-au="toggle" ${tracks.length ? "" : "disabled"}>${MC.icon(playing ? "pause" : "play")}</button>
          <button class="icon-btn" data-au="next" ${tracks.length ? "" : "disabled"}>${MC.icon("next")}</button>
          <span class="au-now"><b>${cur >= 0 ? esc(tracks[cur]?.name || "") : t("au.none")}</b><small class="muted" id="au-pos">${cur >= 0 ? `${mmss(audio.currentTime)} / ${mmss(audio.duration)}` : ""}</small></span>
          <button class="icon-btn ${cfg.shuffle ? "on" : ""}" data-au="shuffle" title="${esc(t("au.shuffle"))}">${MC.icon("shuffle")}</button>
          <select data-au="loop" title="${esc(t("au.loop"))}">${["all", "one", "none"].map((k) => `<option value="${k}" ${cfg.loop === k ? "selected" : ""}>${t("au.loop." + k)}</option>`).join("")}</select>
        </div>
        <input type="range" id="au-seek" min="0" max="1000" value="0" ${cur >= 0 ? "" : "disabled"}>
        <ul class="au-tracks">${tracks.map((x, i) => `<li class="${i === cur ? "cur" : ""}"><button class="au-tn" data-aup="${i}">${MC.icon(i === cur && playing ? "volume" : "music", "sm")} ${esc(x.name)}</button>
          ${x.aid ? `<span class="muted small" title="${esc(t("au.on_server"))}">${MC.icon("cast", "sm")}</span>` : ""}
          <button class="icon-btn small" data-aud="${x.id}">${MC.icon("trash", "sm")}</button></li>`).join("") || `<li class="muted small">${t("au.empty")}</li>`}</ul>
        <label class="btn small au-add">${MC.icon("plus", "sm")} ${t("au.add")}<input type="file" accept="audio/*" multiple hidden id="au-files"></label>
        <p class="muted small">${t(srv.share ? "au.files_hint_share" : "au.files_hint")}</p>
      </div>`;
  }
  function render() {
    const box = $("#gm-sub-sound");
    if (box) box.innerHTML = html();
  }
  A.render = render;
  MC.GM?.addSub({ id: "sound", ic: "music", label: "au.tab", html: () => `<div id="gm-sub-sound">${html()}</div>`, mount: () => { if (!tracks.length) loadTracks(); } });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-au-unlock]")) { unlock(); return; }
    if (e.target.closest("[data-au-mute]")) { document.getElementById("au-tap")?.remove(); MC.store.set("opt_au_on", "0"); playerApply(); MC.toast(t("au.muted_hint"), "", "volume-off"); return; }
    if (!gm()) return;
    const l = e.target.closest("[data-aul]");
    if (l) { const id = l.dataset.aul; if (on.has(id)) layerOff(id); else layerOn(id, cfg.vol[id] ?? 0.6); render(); pushState(); return; }
    const s = e.target.closest("[data-ausfx]");
    if (s) { if (ac()) playSfx(s.dataset.ausfx); MC.request({ t: "au_sfx", k: s.dataset.ausfx }).catch(() => {}); return; }
    const cd = e.target.closest("[data-aucdel]");
    if (cd) { MC.request({ t: "au_set", custom: (srv.custom || []).filter((x) => x.id !== cd.dataset.aucdel) }).catch(() => {}); return; }
    const p = e.target.closest("[data-aup]");
    if (p) { const i = +p.dataset.aup; if (i === cur) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); } else play(i); return; }
    const d = e.target.closest("[data-aud]");
    if (d) { delTrack(d.dataset.aud); return; }
    const b = e.target.closest("button[data-au]");
    if (!b) return;
    const k = b.dataset.au;
    if (k === "stop") { A.stopAll(); render(); pushState(); }
    if (k === "weather") A.byWeather();
    if (k === "toggle") { if (cur < 0) play(0); else if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    if (k === "next") play(nextIdx());
    if (k === "prev") play(audio.currentTime > 3 ? cur : cur - 1);
    if (k === "shuffle") { cfg.shuffle = !cfg.shuffle; saveCfg(); render(); }
  });
  document.addEventListener("input", (e) => {
    if (!gm()) return;
    const v = e.target.closest("[data-auv]");
    if (v) { cfg.vol[v.dataset.auv] = +v.value; saveCfg(); layerVol(v.dataset.auv, +v.value); pushState(); return; }
    const m = e.target.closest("input[data-au]");
    if (m?.dataset.au === "master") { cfg.master = +m.value; saveCfg(); setMaster(); pushState(); }
    if (m?.dataset.au === "music") { cfg.music = +m.value; audio.volume = cfg.music; saveCfg(); clearTimeout(A._mv); A._mv = setTimeout(musicPush, 400); }
    if (e.target.id === "au-seek" && audio.duration) audio.currentTime = (+e.target.value / 1000) * audio.duration;
  });
  document.addEventListener("change", (e) => {
    if (!gm()) return;
    if (e.target.id === "au-files") { addFiles([...e.target.files]); e.target.value = ""; }
    if (e.target.id === "au-sfx-files") { addSfx([...e.target.files]); e.target.value = ""; }
    if (e.target.matches('select[data-au="loop"]')) { cfg.loop = e.target.value; audio.loop = cfg.loop === "one"; saveCfg(); musicPush(); }
    const f = e.target.closest("[data-au-flag]");
    if (f) {
      const k = f.dataset.auFlag;
      srv[k] = f.checked;
      MC.request({ t: "au_set", [k]: f.checked, layers: gmLayers(), master: cfg.master }).then(() => { if (k === "share") musicPush(); }).catch(() => {});
      if (k === "share") MC.toast(t(f.checked ? "au.share_on" : "au.share_off"), "ok", "cast");
      render();
    }
  });
  MC.on("welcome", () => MC.request({ t: "au_get" }).then((m) => MC.emit("msg_au", m)).catch(() => {}));
  // мастер, вернувшись, продолжает с того же — восстанавливаем слои из сервера, но звучат они после первого касания
  MC.on("msg_au", () => {
    if (!gm() || A._gmInit) return;
    A._gmInit = true;
    if (srv.music && cur < 0) MC.request({ t: "au_set", music: null }).catch(() => {});   // мастер перезагрузил страницу — его плеер остановлен
    const want = srv.layers || {};
    if (Object.keys(want).length) {
      const go = () => { document.removeEventListener("pointerdown", go, true); if (ac()) { for (const [id, v] of Object.entries(want)) { cfg.vol[id] = v; layerOn(id, v); } render(); } };
      document.addEventListener("pointerdown", go, true);
    }
  });
  // ---------------------------------------------------------------- звуки боя (у каждого свои, выключаются в настройках)
  let fxBus = null;
  const sfxOn = () => MC.store.get("opt_sfx") !== "0";
  function fx() {
    if (!ac()) return null;
    if (!fxBus) { fxBus = ctx.createGain(); fxBus.connect(ctx.destination); }
    fxBus.gain.value = MC.num(MC.store.get("opt_sfx_vol"), 0.5);
    return fxBus;
  }
  /** Свист клинка / стрелы: шум с полосовым фильтром, частота едет вверх-вниз. */
  function whoosh(out, { at = 0, dur = 0.22, f0 = 600, f1 = 2400, vol = 0.35 } = {}) {
    const t0 = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = noiseW;
    const bp = filt("bandpass", f0, 2.5);
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(f0 * 0.8, t0 + dur);
    const g = gain(0); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(bp).connect(g).connect(out); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.05);
  }
  const COMBAT = {
    melee(out, hit, crit) {
      whoosh(out, { dur: 0.2, f0: 500, f1: 1800, vol: 0.4 });
      if (!hit) return;
      blip(out, { f0: 140, f1: 55, dur: 0.18, vol: 0.55, at: 0.16 });                       // удар
      burst(out, { lp: 1200, dur: 0.12, vol: 0.35, at: 0.16, brown: true });
      if (crit) { for (const f of [2700, 3900, 5100]) blip(out, { type: "triangle", f0: f, dur: 0.5, vol: 0.05, at: 0.17 }); burst(out, { hp: 2500, dur: 0.2, vol: 0.25, at: 0.16 }); }
    },
    ranged(out, hit, crit) {
      const t0 = ctx.currentTime;                                                                 // тетива
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(190, t0); o.frequency.exponentialRampToValueAtTime(120, t0 + 0.15);
      const lp = filt("lowpass", 1400, 3); const g = gain(0); g.gain.setValueAtTime(0.3, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      o.connect(lp).connect(g).connect(out); o.start(t0); o.stop(t0 + 0.2);
      whoosh(out, { at: 0.05, dur: 0.3, f0: 1800, f1: 3500, vol: 0.18 });
      if (hit) { blip(out, { f0: 320, f1: 120, dur: 0.1, vol: 0.4, at: 0.33 }); burst(out, { lp: 2500, dur: 0.06, vol: 0.3, at: 0.33 }); }
      if (crit) blip(out, { f0: 900, f1: 300, dur: 0.15, vol: 0.2, at: 0.35 });
    },
    spell(out, hit, crit) {
      for (let i = 0; i < 6; i++) blip(out, { type: "triangle", f0: 660 * Math.pow(1.19, i), dur: 0.35, vol: 0.06, at: i * 0.04 });
      whoosh(out, { at: 0.12, dur: 0.35, f0: 300, f1: 1500, vol: 0.2 });
      if (hit) { burst(out, { lp: 900, dur: 0.45, vol: 0.45, at: 0.38, brown: true, attack: 0.01 }); blip(out, { f0: 220, f1: 70, dur: 0.35, vol: 0.35, at: 0.38 }); }
      if (crit) for (let i = 0; i < 5; i++) blip(verb, { f0: 1320 * Math.pow(1.12, i), dur: 0.5, vol: 0.05, at: 0.4 + i * 0.03 });
    },
    heal(out) { for (let i = 0; i < 5; i++) { blip(out, { f0: [523, 659, 784, 1046, 1318][i], dur: 0.6, vol: 0.08, at: i * 0.07 }); blip(verb, { f0: [523, 659, 784, 1046, 1318][i], dur: 0.6, vol: 0.04, at: i * 0.07 }); } },
    save(out, ok) {
      whoosh(out, { dur: 0.4, f0: 200, f1: 900, vol: 0.25 });
      burst(out, { lp: ok ? 1500 : 700, dur: 0.5, vol: ok ? 0.2 : 0.45, at: 0.25, brown: true, attack: 0.02 });
    },
  };
  let lastFx = 0;
  MC.on("msg_cb_events", (m) => {
    if (!sfxOn() || MC.pop) return;
    const evs = m.events || [];
    const out = evs.length && fx();
    if (!out) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    let n = 0;
    for (const e of evs) {
      if (n >= 3 || performance.now() - lastFx < 60) break;           // не устраивать какофонию на огненном шаре по 10 целям
      const hit = e.k === "hit" || e.k === "crit", crit = e.k === "crit";
      if (["hit", "crit", "miss"].includes(e.k)) { COMBAT[e.rng === "ranged" ? "ranged" : e.rng === "spell" ? "spell" : "melee"](out, hit, crit); n++; }
      else if (e.k === "heal") { COMBAT.heal(out); n++; }
      else if (e.k === "save_ok" || e.k === "save_fail") { if (!n) COMBAT.save(out, e.k === "save_ok"); n++; }
    }
    if (n) lastFx = performance.now();
  });
  A.testSfx = (k) => { const out = fx(); if (out) (k === "heal" ? COMBAT.heal(out) : COMBAT[k](out, true, false)); };

  MC.on("leave", () => { A.stopAll(); audio.pause(); });
})();
