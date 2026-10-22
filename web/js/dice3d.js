// Masters Compendium — 3D-кубики поверх экрана.
// Результат всегда решает сервер мастера. Здесь кубики честно катятся по физике (cannon-es),
// а когда известно, какой гранью кубик лёг, грани перенумеровываются так, чтобы сверху оказалось
// выпавшее на сервере число. Перенумерация делается до показа — на экране всё выглядит как обычный бросок.
import * as THREE from "./vendor/three-0.170.0.module.min.js";
import * as CANNON from "./vendor/cannon-es-0.20.0.min.js";

const MAX_DICE = 14;          // больше на экран не выкидываем — остальное видно в карточке броска
const STEP = 1 / 60;
const MAX_STEPS = 60 * 5;
const HOLD_MS = 2000;         // сколько кубики лежат после остановки
const FADE_MS = 700;

// ---------------------------------------------------------------- геометрия
const PHI = (1 + Math.sqrt(5)) / 2;

function d10Verts() {
  // пятиугольный трапецоэдр: вершины-полюса и кольцо из 10 вершин на разной высоте.
  // Высоту кольца подбираем так, чтобы грани-«воздушные змеи» были плоскими.
  const ring = (h) => Array.from({ length: 10 }, (_, k) => [Math.cos(k * Math.PI / 5), Math.sin(k * Math.PI / 5), k % 2 ? -h : h]);
  const apex = 1;
  const off = (h) => {
    const r = ring(h), top = [0, 0, apex];
    const a = new THREE.Vector3(...r[0]), b = new THREE.Vector3(...r[2]), t = new THREE.Vector3(...top), c = new THREE.Vector3(...r[1]);
    const n = new THREE.Vector3().subVectors(a, t).cross(new THREE.Vector3().subVectors(b, t)).normalize();
    return n.dot(new THREE.Vector3().subVectors(c, t));
  };
  let lo = 0.001, hi = 0.9;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Math.sign(off(m)) === Math.sign(off(lo))) lo = m; else hi = m; }
  const h = (lo + hi) / 2;
  // ось кубика — Y (как у остальных)
  return [[0, apex, 0], [0, -apex, 0], ...ring(h).map(([x, y, z]) => [x, z, y])];
}

const SHAPES = {
  4: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  6: () => { const v = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]); return v; },
  8: () => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  10: d10Verts,
  12: () => {
    const v = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a / PHI, b * PHI]); v.push([a / PHI, b * PHI, 0]); v.push([a * PHI, 0, b / PHI]); }
    return v;
  },
  20: () => {
    const v = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a, b * PHI]); v.push([a, b * PHI, 0]); v.push([a * PHI, 0, b]); }
    return v;
  },
};
const RADIUS = { 4: 1.35, 6: 1.12, 8: 1.18, 10: 1.12, 12: 1.15, 20: 1.18 };

/** Грани выпуклого многогранника по его вершинам (все вершины лежат на оболочке). */
function hullFaces(verts) {
  const n = verts.length, eps = 1e-6, seen = new Set(), faces = [];
  const V = verts.map((p) => new THREE.Vector3(...p));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const nrm = new THREE.Vector3().subVectors(V[j], V[i]).cross(new THREE.Vector3().subVectors(V[k], V[i]));
    if (nrm.lengthSq() < eps) continue;
    nrm.normalize();
    let d = nrm.dot(V[i]), pos = 0, neg = 0;
    const on = [];
    for (let m = 0; m < n; m++) {
      const s = nrm.dot(V[m]) - d;
      if (s > 1e-5) pos++; else if (s < -1e-5) neg++; else on.push(m);
    }
    if (pos && neg) continue;
    if (pos) { nrm.negate(); d = -d; }
    const key = on.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const c = new THREE.Vector3();
    on.forEach((m) => c.add(V[m]));
    c.divideScalar(on.length);
    const u = new THREE.Vector3().subVectors(V[on[0]], c).normalize();
    const w = new THREE.Vector3().crossVectors(nrm, u);
    on.sort((a, b) => {
      const pa = new THREE.Vector3().subVectors(V[a], c), pb = new THREE.Vector3().subVectors(V[b], c);
      return Math.atan2(pa.dot(w), pa.dot(u)) - Math.atan2(pb.dot(w), pb.dot(u));
    });
    faces.push({ idx: on, normal: nrm, center: c });
  }
  return { V, faces };
}

const shapeCache = {};
function shape(sides) {
  if (shapeCache[sides]) return shapeCache[sides];
  const raw = SHAPES[sides]();
  const maxR = Math.max(...raw.map((p) => Math.hypot(...p)));
  const scaled = raw.map((p) => p.map((x) => x / maxR * RADIUS[sides]));
  const { V, faces } = hullFaces(scaled);
  // для d10 первой ставим верхнюю половину — порядок чисел на гранях будет привычным
  const s = { sides, V, faces };
  s.cannon = new CANNON.ConvexPolyhedron({ vertices: V.map((v) => new CANNON.Vec3(v.x, v.y, v.z)), faces: faces.map((f) => f.idx.slice()) });
  return (shapeCache[sides] = s);
}

/** Геометрия: каждая грань — своя группа материалов, UV вписывает грань в квадрат текстуры. */
function buildGeometry(s) {
  const pos = [], nor = [], uv = [], groups = [];
  s.faces.forEach((f, fi) => {
    const pts = f.idx.map((i) => s.V[i]);
    const up = s.sides === 4 ? new THREE.Vector3().subVectors(pts[0], f.center).normalize() : new THREE.Vector3().subVectors(pts[0], f.center).normalize();
    const right = new THREE.Vector3().crossVectors(up, f.normal);
    let R = 0;
    pts.forEach((p) => { R = Math.max(R, p.distanceTo(f.center)); });
    if (s.sides === 10) R *= 0.92;
    const toUV = (p) => { const d = new THREE.Vector3().subVectors(p, f.center); return [0.5 + d.dot(right) / (2 * R), 0.5 + d.dot(up) / (2 * R)]; };
    f.R = R; f.up = up; f.right = right;
    f.cornerUV = pts.map(toUV);
    const start = pos.length / 3;
    for (let t = 1; t < pts.length - 1; t++) {
      for (const p of [pts[0], pts[t], pts[t + 1]]) {
        pos.push(p.x, p.y, p.z); nor.push(f.normal.x, f.normal.y, f.normal.z); uv.push(...toUV(p));
      }
    }
    groups.push([start, pos.length / 3 - start, fi]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  groups.forEach(([a, c, m]) => g.addGroup(a, c, m));
  return g;
}

// ---------------------------------------------------------------- текстуры граней
const texCache = new Map();
function mix(hex, k, base = "#15121f") {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(base), b = p(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#8b5cf6");
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(",")})`;
}

function faceTexture(key, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  draw(cv.getContext("2d"));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (texCache.size > 600) texCache.clear();
  texCache.set(key, t);
  return t;
}

function textStyle(ctx, size, light = false) {
  ctx.font = `800 ${size}px "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = light ? "rgba(30,10,70,.95)" : "rgba(0,0,0,.55)";
  ctx.shadowBlur = light ? 9 : 6;
}

/** Фон грани: один цвет — тёмное «стекло» с подсветкой в центре; два цвета — перелив по диагонали. */
function faceBg(ctx, color, color2) {
  if (color2) {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, mix(color, 0.85));
    g.addColorStop(0.45, mix(color, 0.72));
    g.addColorStop(1, mix(color2, 0.9));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const h = ctx.createRadialGradient(46, 40, 4, 46, 40, 70);       // блик
    h.addColorStop(0, "rgba(255,255,255,.28)"); h.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, 128, 128);
    return;
  }
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 90);
  g.addColorStop(0, mix(color, 0.42));
  g.addColorStop(1, mix(color, 0.2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
}

function labelTex(label, color, sides, color2 = "") {
  return faceTexture(`${color}|${color2}|${sides}|${label}`, (ctx) => {
    faceBg(ctx, color, color2);
    const len = String(label).length;
    const light = !!color2;
    const size = sides === 10 ? (len > 1 ? 34 : 44) : sides === 20 ? (len > 1 ? 36 : 42) : sides === 6 ? 60 : sides === 8 ? 48 : 46;
    textStyle(ctx, size, light);
    if (light) { ctx.lineWidth = Math.max(3, size * 0.09); ctx.strokeStyle = "rgba(40,16,90,.75)"; }
    const y = sides === 10 ? 74 : sides === 8 || sides === 20 ? 72 : 66;
    if (light) ctx.strokeText(String(label), 64, y);
    ctx.fillText(String(label), 64, y);
    if ((label === "6" || label === "9") && sides !== 6) { ctx.shadowBlur = 0; ctx.fillRect(64 - size * 0.24, y + size * 0.42, size * 0.48, Math.max(3, size * 0.07)); }
  });
}

/** d4: на каждой грани три числа у углов, каждое «смотрит» в свой угол. Выпало то, что у верхней вершины. */
function d4Tex(face, vals, color, color2 = "") {
  const key = `${color}|${color2}|4|${vals.join(",")}`;
  return faceTexture(key, (ctx) => {
    faceBg(ctx, color, color2);
    textStyle(ctx, 36, !!color2);
    face.cornerUV.forEach(([u, v], i) => {
      const x = 64 + (u * 128 - 64) * 0.52, y = 64 + ((1 - v) * 128 - 64) * 0.52;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(x - 64, -(y - 64)));
      ctx.fillText(String(vals[i]), 0, 0);
      ctx.restore();
    });
  });
}

// ---------------------------------------------------------------- сцена
let renderer, scene, camera, floorMesh, light, canvas, view = { w: 0, h: 0, hw: 0, hh: 0 };

function ensureScene() {
  if (renderer) return true;
  try {
    canvas = document.createElement("canvas");
    canvas.id = "dice3d";
    document.body.appendChild(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    console.warn("WebGL недоступен — 3D-кубики выключены", e);
    canvas?.remove();
    renderer = null;
    return false;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
  scene.add(new THREE.HemisphereLight(0xd8ccff, 0x1a1530, 1.4));
  light = new THREE.DirectionalLight(0xffffff, 2.1);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0015;
  scene.add(light, light.target);
  const rim = new THREE.DirectionalLight(0x7c9cff, 0.9);
  rim.position.set(-8, 6, 10);
  scene.add(rim);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  return true;
}

function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  // размер кубика на экране — от размера окна, в разумных пределах
  const diePx = Math.max(62, Math.min(112, Math.min(w, h) * 0.16));
  const pxPerUnit = diePx / 2.2;
  const visH = h / pxPerUnit, visW = w / pxPerUnit;
  const dist = (visH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.aspect = w / h;
  camera.position.set(0, dist, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  view = { w, h, hw: visW / 2, hh: visH / 2, dist };
  light.position.set(visW * 0.25, dist * 0.8, -visH * 0.35);
  const sc = light.shadow.camera;
  sc.left = -view.hw - 4; sc.right = view.hw + 4; sc.top = view.hh + 4; sc.bottom = -view.hh - 4; sc.near = 1; sc.far = dist * 2;
  sc.updateProjectionMatrix();
  const px = pointPx();
  for (const th of throws) if (th.trail) for (const L of [th.trail.parts, th.trail.marks, th.trail.smoke, th.trail.embers]) if (L) L.mat.uniforms.uPx.value = px;
}

// ---------------------------------------------------------------- звук
// Классический «клак» пластикового кубика по деревянному столу: синтез по модам (затухающие синусы
// резонансов кубика + глухой стук столешницы + короткий щелчок удара). Банк вариантов готовится
// один раз, потом удары только проигрываются — дёшево даже на слабом телефоне.
let actx = null, master = null, bank = null;
let VOL = 0.6, SIZE = 1;             // громкость стука и размер кубиков (настройки игрока)
/** Личные настройки: громкость 0..1, размер 0.6..1.6. */
export function setOpts({ vol, size } = {}) {
  if (vol != null) { VOL = Math.max(0, Math.min(1, vol)); if (master) master.gain.value = 0.85 * VOL; }
  if (size != null) SIZE = Math.max(0.5, Math.min(1.8, size));
}

function makeHit(kind) {
  const sr = actx.sampleRate, len = Math.ceil(sr * (kind === "wall" ? 0.16 : 0.11));
  const buf = actx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const modes = [];
  // резонансы самого кубика (пластик/смола): негармоничные, быстро затухают
  const f1 = kind === "die" ? rnd(3300, 4300) : rnd(2300, 3100);
  const dieAmp = kind === "wall" ? 0.45 : 1;
  modes.push([f1, 0.020, 1 * dieAmp], [f1 * rnd(1.55, 1.68), 0.013, 0.55 * dieAmp], [f1 * rnd(2.3, 2.5), 0.008, 0.3 * dieAmp], [f1 * rnd(0.56, 0.62), 0.028, 0.35 * dieAmp]);
  // столешница / бортик лотка — глухой деревянный стук
  if (kind === "floor") modes.push([rnd(160, 240), 0.035, 0.9], [rnd(420, 560), 0.018, 0.45]);
  if (kind === "wall") modes.push([rnd(110, 150), 0.06, 1.2], [rnd(300, 380), 0.03, 0.6]);
  const phase = modes.map(() => Math.random() * Math.PI * 2);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let v = 0;
    modes.forEach(([f, dec, amp], k) => { v += amp * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t + phase[k]); });
    // щелчок удара: 1–2 мс белого шума через простейший фильтр высоких частот
    const n = Math.random() * 2 - 1, hp = n - prev; prev = n;
    v += hp * 0.5 * Math.exp(-t / 0.0012);
    // мягкая атака (без цифрового щелчка в первом сэмпле)
    d[i] = v * Math.min(1, i / (sr * 0.0004));
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  return buf;
}

function ensureBank() {
  if (bank || !actx) return;
  // один характер звука на все удары — «клак» кубика о деревянный стол (так попросили)
  bank = { floor: [] };
  for (let i = 0; i < 10; i++) bank.floor.push(makeHit("floor"));
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
  master = actx.createGain();
  master.gain.value = 0.85 * VOL;
  master.connect(comp).connect(actx.destination);
}

// Настоящая запись броска (web/sounds/dice_hits.wav): целиком «roll» — первый удар о стол
// с раскатом, и вырезанные из неё одиночные стуки «hit» — для последующих ударов по физике.
const SHEET = [[0.0, 0.77, "roll"], [0.82, 0.097, "big"], [0.967, 0.052, "hit"], [1.069, 0.049, "hit"], [1.168, 0.034, "hit"],
  [1.252, 0.034, "hit"], [1.336, 0.108, "hit"], [1.494, 0.031, "hit"], [1.575, 0.062, "hit"]];
let sheetBuf = null, sheetLoading = null;
let bus = null;   // громкость текущего броска — при прерывании броска его звук плавно гасим
function loadSheet() {
  if (sheetBuf || sheetLoading || !actx) return;
  sheetLoading = fetch(new URL("../sounds/dice_hits.wav", import.meta.url))
    .then((r) => r.arrayBuffer())
    .then((ab) => new Promise((ok, bad) => actx.decodeAudioData(ab, ok, bad)))
    .then((b) => { sheetBuf = b; })
    .catch((e) => { console.warn("звук кубиков не загрузился, будет синтез", e); });
}

function playPiece(kind, gain, when, rate = 1) {
  const list = SHEET.filter((x) => x[2] === kind);
  const [off, dur] = list[Math.floor(Math.random() * list.length)];
  const src = actx.createBufferSource();
  src.buffer = sheetBuf;
  src.playbackRate.value = rate;
  const g = actx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(bus || master);
  src.start(actx.currentTime + 0.03 + Math.max(0, when), off, dur);
}

function synthClack(kind, strength, when) {
  const src = actx.createBufferSource();
  src.buffer = bank.floor[Math.floor(Math.random() * bank.floor.length)];
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const g = actx.createGain();
  g.gain.value = Math.min(0.9, 0.05 + 0.75 * Math.pow(strength, 1.3)) * (kind === "die" ? 0.8 : 1);
  src.connect(g).connect(bus || master);
  src.start(actx.currentTime + 0.03 + Math.max(0, when));
}

/** Озвучить бросок по списку ударов из симуляции: [[шаг, сила 0..1, вид], ...]. */
function playHits(hits) {
  if (!actx) return null;
  ensureBank();
  bus = actx.createGain();
  bus.connect(master);
  if (!sheetBuf) { hits.forEach(([f, st, kind]) => synthClack(kind, st, f * STEP)); return bus; }
  if (!hits.length) return bus;
  const t0 = hits[0][0] * STEP;
  // первый удар — вся запись целиком: в ней уже есть живой раскат кубиков по столу
  playPiece("roll", 0.55 + 0.45 * Math.min(1, hits[0][1] * 1.3), t0, 0.97 + Math.random() * 0.06);
  hits.slice(1).forEach(([f, st, kind]) => {
    const t = f * STEP;
    if (t - t0 < 0.42 && st < 0.6) return;              // пока звучит раскат, мелкие стуки в нём уже есть
    const gain = Math.min(1, 0.08 + 0.85 * Math.pow(st, 1.2)) * (kind === "die" ? 0.8 : 1);
    playPiece(st > 0.6 ? "big" : "hit", gain, t, 0.93 + Math.random() * 0.14);
  });
  return bus;
}
export function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    ensureBank();
    loadSheet();
  } catch { actx = null; }
}

// ---------------------------------------------------------------- что кидаем
/** Разложить результат сервера на кубики: [{sides, value, kept}]. d% = два d10 (десятки + единицы). */
function diceFromRoll(r) {
  const out = [];
  for (const p of r.parts || []) {
    if (p.const != null || !p.rolls) continue;
    p.rolls.forEach((v, j) => {
      const kept = p.kept ? p.kept.includes(j) : true;
      if (p.sides === 100) {
        const tens = Math.floor((v % 100) / 10), units = v % 10;
        out.push({ sides: 10, labels: ["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"], target: tens, kept });
        out.push({ sides: 10, labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], target: units, kept });
      } else if (SHAPES[p.sides]) {
        const labels = Array.from({ length: p.sides }, (_, i) => String(i + 1));
        out.push({ sides: p.sides, labels, target: v - 1, kept, nat: p.sides === 20 ? v : 0 });
      }
    });
  }
  return out.slice(0, MAX_DICE);
}

// ---------------------------------------------------------------- симуляция
function simulate(dice) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -70, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 14;
  const mDie = new CANNON.Material("die"), mFloor = new CANNON.Material("floor"), mWall = new CANNON.Material("wall");
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mFloor, { friction: 0.28, restitution: 0.38 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mWall, { friction: 0.05, restitution: 0.6 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mDie, { friction: 0.12, restitution: 0.42 }));
  const plane = (pos, axis, angle, mat) => {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
    b.position.set(...pos);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(...axis), angle);
    world.addBody(b);
  };
  const m = 1.2, hw = Math.max(3, view.hw - m), hh = Math.max(3, view.hh - m);
  plane([0, 0, 0], [1, 0, 0], -Math.PI / 2, mFloor);
  plane([-hw, 0, 0], [0, 1, 0], Math.PI / 2, mWall);
  plane([hw, 0, 0], [0, 1, 0], -Math.PI / 2, mWall);
  plane([0, 0, -hh], [0, 1, 0], 0, mWall);
  plane([0, 0, hh], [0, 1, 0], Math.PI, mWall);

  // кидаем от нижнего края экрана (от игрока) или сбоку — чуть разнообразия
  const side = Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2;
  const bodies = dice.map((d, i) => {
    const b = new CANNON.Body({ mass: 1, material: mDie, shape: shape(d.sides).cannon,
      sleepSpeedLimit: 0.25, sleepTimeLimit: 0.25, linearDamping: 0.08, angularDamping: 0.12 });
    const spread = (i - (dice.length - 1) / 2) * 1.9 + (Math.random() - 0.5);
    const speed = (side === 0 ? hh : hw) * (0.85 + Math.random() * 0.4) + 5;   // долетает примерно до середины-дальней трети
    if (side === 0) { b.position.set(spread * 0.8, 3 + Math.random() * 2, hh - 1.2); b.velocity.set((Math.random() - 0.5) * 8, 4 + Math.random() * 4, -speed); }
    else {
      const s = side === 1 ? -1 : 1;
      b.position.set(s * (hw - 1.2), 3 + Math.random() * 2, spread * 0.6);
      b.velocity.set(-s * speed, 4 + Math.random() * 4, (Math.random() - 0.5) * 10);
    }
    b.quaternion.setFromEuler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
    b.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    world.addBody(b);
    return b;
  });

  const frames = [], hits = [];
  const lastHit = new Map();
  bodies.forEach((b) => b.addEventListener("collide", (e) => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const other = e.body;
    const kind = other.mass > 0 ? "die" : other.material === mWall ? "wall" : "floor";
    const key = b.id + kind, step = frames.length;
    // пара «кубик–кубик» приходит дважды (по событию на каждом) — второй раз пропускаем
    if (kind === "die" && b.id > other.id) return;
    if (v < (kind === "floor" ? 1.6 : 2.2) || step - (lastHit.get(key) ?? -99) < 4 || hits.length > 90) return;
    lastHit.set(key, step);
    hits.push([step, Math.min(1, v / 28), kind]);
  }));
  let calm = 0;
  for (let s = 0; s < MAX_STEPS; s++) {
    if (s === 150) bodies.forEach((b) => { b.angularDamping = 0.45; b.linearDamping = 0.3; });  // долго качается — помогаем улечься
    world.step(STEP);
    const f = new Float32Array(bodies.length * 7);
    bodies.forEach((b, i) => {
      f.set([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 7);
    });
    frames.push(f);
    const still = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.lengthSquared() < 0.05 && b.angularVelocity.lengthSquared() < 0.1));
    calm = still ? calm + 1 : 0;
    if (s > 20 && calm > 12) break;
  }
  return { frames, hits, bodies };
}

/** Какой гранью вверх (индекс грани; для d4 — индекс верхней вершины). */
function topOf(sides, q) {
  const s = shape(sides), quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  if (sides === 4) {
    let best = 0, by = -Infinity;
    s.V.forEach((v, i) => { const y = v.clone().applyQuaternion(quat).y; if (y > by) { by = y; best = i; } });
    return best;
  }
  let best = 0, by = -Infinity;
  s.faces.forEach((f, i) => { const y = f.normal.clone().applyQuaternion(quat).y; if (y > by) { by = y; best = i; } });
  return best;
}

// ---------------------------------------------------------------- построение кубиков
function makeDie(d, top, color, color2 = "") {
  const s = shape(d.sides);
  const geo = buildGeometry(s);
  const n = d.sides === 4 ? 4 : s.faces.length;
  // случайная раскладка чисел, затем меняем местами так, чтобы на «верхнем» месте было нужное
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const at = order.indexOf(d.target);
  [order[at], order[top]] = [order[top], order[at]];
  const label = (slot) => d.labels[order[slot]];
  const mats = s.faces.map((f, fi) => {
    const map = d.sides === 4 ? d4Tex(f, f.idx.map((vi) => label(vi)), color, color2) : labelTex(label(fi), color, d.sides, color2);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.15, transparent: true });
  });
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color2 ? mix(color2, 0.9, "#ffffff") : mix(color, 0.85, "#ffffff")), transparent: true, opacity: 0.9 }));
  mesh.add(edges);
  mesh.userData = { edges, mats };
  return mesh;
}

function disposeDie(m) {
  m.geometry.dispose();
  m.userData.mats.forEach((x) => x.dispose());   // текстуры в кэше — не трогаем
  m.userData.edges.geometry.dispose();
  m.userData.edges.material.dispose();
}

// ---------------------------------------------------------------- след кубика (огонь, лёд, яд…)
// Частицы летят за кубиком, а там, где он касается стола, остаются следы (иней, подпалины, лужицы).
// Камера смотрит сверху, поэтому «точки» выглядят как плоские пятна на столе. Следы тают вместе с кубиками.
const TRAIL = {
  //        цвета частиц                      цвет следа            тип спрайта  подъём  жизнь  частота следов
  fire:      { c: ["#ffffff", "#fff3b0", "#ffc53d", "#ff7a1a", "#e8380d", "#7a1405"], m: "#2a1408", ma: 0.42, spr: "flame", up: 6, life: 0.7, size: 2.3, mark: 0.06, rate: 2.4,
               smoke: "#4a4038", embers: ["#fff7c2", "#ffb347", "#ff6a00"], flicker: true },
  ice:       { c: ["#e0f7ff", "#9ad9ff", "#5ab8ff"], m: "#bfe9ff", ma: 0.55, spr: "flake", up: 0.6, life: 0.9, size: 1.05, mark: 0.05, markGlow: true },
  poison:    { c: ["#d9f99d", "#84cc16", "#22c55e"], m: "#3f6212", ma: 0.5, spr: "bubble", up: 2.6, life: 0.95, size: 1.0, mark: 0.08 },
  lightning: { c: ["#ffffff", "#bfdbfe", "#3b82f6"], m: "#93c5fd", ma: 0.4, spr: "spark", up: 0, life: 0.4, size: 1.7, mark: 0.1, spread: 12, rate: 2.2, markGlow: true },
  arcane:    { c: ["#f5d0fe", "#c084fc", "#7c3aed"], m: "#a855f7", ma: 0.35, spr: "star", up: 1.6, life: 0.8, size: 1.15, mark: 0.1, markGlow: true, swirl: true },
  shadow:    { c: ["#3b3552", "#1e1b2e", "#0b0a12"], m: "#0b0a12", ma: 0.55, spr: "smoke", up: 1.2, life: 1.0, size: 2.1, mark: 0.09, normal: true },
  holy:      { c: ["#fffbeb", "#fde68a", "#fbbf24"], m: "#fde68a", ma: 0.4, spr: "star", up: 3.2, life: 0.75, size: 1.1, mark: 0.1, markGlow: true },
  blood:     { c: ["#fca5a5", "#dc2626", "#7f1d1d"], m: "#7f1d1d", ma: 0.75, spr: "drop", up: -6, life: 0.6, size: 0.75, mark: 0.06, normal: true },
  nature:    { c: ["#bef264", "#65a30d", "#3f6212"], m: "#365314", ma: 0.45, spr: "leaf", up: 1.2, life: 1.3, size: 1.25, mark: 0.09, normal: true, swirl: true, rate: 0.8 },
  water:     { c: ["#e0f2fe", "#7dd3fc", "#0284c7"], m: "#0ea5e9", ma: 0.35, spr: "drop", up: 3.5, life: 0.7, size: 0.7, mark: 0.05, spread: 4, rate: 1.6, markGlow: true },
  earth:     { c: ["#d6c4a8", "#a8875c", "#6b4f2c"], m: "#4a3820", ma: 0.55, spr: "blot", up: 1.4, life: 0.9, size: 0.8, mark: 0.07, normal: true, spread: 3 },
  wind:      { c: ["#ffffff", "#e2e8f0", "#cbd5e1"], m: "#e2e8f0", ma: 0.12, spr: "streak", up: 0.4, life: 0.55, size: 2.2, mark: 0.2, swirl: true, rate: 1.4 },
  petals:    { c: ["#ffe4ef", "#f9a8d4", "#ec4899"], m: "#f472b6", ma: 0.4, spr: "petal", up: 0.8, life: 1.5, size: 1.0, mark: 0.08, normal: true, swirl: true, rate: 0.9 },
  cosmos:    { c: ["#ffffff", "#a5b4fc", "#6366f1", "#1e1b4b"], m: "#312e81", ma: 0.45, spr: "star", up: 0.5, life: 1.1, size: 0.9, mark: 0.08, markGlow: true, swirl: true, rate: 1.5 },
};
const spriteCache = new Map();
function sprite(kind) {
  if (spriteCache.has(kind)) return spriteCache.get(kind);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const soft = (a = 1) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.4, `rgba(255,255,255,${a * 0.55})`); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); };
  if (kind === "glow" || kind === "smoke") soft(kind === "smoke" ? 0.8 : 1);
  else if (kind === "flame") {
    // язычок пламени: мягкое ядро, вытянутое вверх
    const g = x.createRadialGradient(32, 40, 0, 32, 36, 30);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.7)"); g.addColorStop(0.7, "rgba(255,255,255,.18)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.moveTo(32, 2);
    x.bezierCurveTo(48, 20, 60, 38, 50, 52); x.bezierCurveTo(44, 62, 20, 62, 14, 52); x.bezierCurveTo(4, 38, 16, 20, 32, 2); x.fill();
  }
  else if (kind === "bubble") { soft(0.35); x.strokeStyle = "rgba(255,255,255,.95)"; x.lineWidth = 4; x.beginPath(); x.arc(32, 32, 20, 0, 7); x.stroke(); }
  else if (kind === "drop") { x.fillStyle = "#fff"; x.beginPath(); x.arc(32, 34, 18, 0, 7); x.fill(); x.beginPath(); x.arc(44, 22, 6, 0, 7); x.fill(); }
  else if (kind === "flake") {
    soft(0.4); x.strokeStyle = "#fff"; x.lineWidth = 3.5; x.lineCap = "round";
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26);
      x.moveTo(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15); x.lineTo(32 + Math.cos(a + 0.5) * 21, 32 + Math.sin(a + 0.5) * 21); x.stroke(); }
  } else if (kind === "star" || kind === "spark") {
    soft(kind === "spark" ? 0.7 : 0.45); x.fillStyle = "#fff"; x.beginPath();
    const n = kind === "spark" ? 4 : 5, ro = 30, ri = kind === "spark" ? 4 : 9;
    for (let i = 0; i < n * 2; i++) { const a = (i * Math.PI) / n - Math.PI / 2, r = i % 2 ? ri : ro; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
  } else if (kind === "leaf") {
    x.fillStyle = "#fff"; x.beginPath(); x.moveTo(32, 4); x.bezierCurveTo(56, 18, 54, 46, 32, 60); x.bezierCurveTo(10, 46, 8, 18, 32, 4); x.fill();
    x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 2.5; x.beginPath(); x.moveTo(32, 8); x.lineTo(32, 58); x.stroke();
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(32, 20 + i * 12); x.lineTo(20, 14 + i * 12); x.moveTo(32, 20 + i * 12); x.lineTo(44, 14 + i * 12); x.stroke(); }
  } else if (kind === "petal") {
    const g = x.createRadialGradient(32, 40, 2, 32, 34, 30); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,.75)");
    x.fillStyle = g; x.beginPath(); x.moveTo(32, 60); x.bezierCurveTo(6, 40, 14, 8, 28, 8); x.lineTo(32, 16); x.lineTo(36, 8); x.bezierCurveTo(50, 8, 58, 40, 32, 60); x.fill();
  } else if (kind === "streak") {
    const g = x.createLinearGradient(0, 32, 64, 32); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.ellipse(32, 32, 30, 4, 0, 0, 7); x.fill();
  } else if (kind === "blot") {
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 31); g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.7, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2, r = 22 + Math.random() * 9; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(kind, t);
  return t;
}
const PT_VERT = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aRot;
  uniform float uPx; varying float vA; varying vec3 vC; varying float vR;
  void main() { vA = aAlpha; vC = aColor; vR = aRot; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx / -mv.z; }`;
const PT_FRAG = `uniform sampler2D uTex; uniform float uFade; varying float vA; varying vec3 vC; varying float vR;
  void main() { vec2 p = gl_PointCoord - 0.5; float s = sin(vR), c = cos(vR); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    vec4 t = texture2D(uTex, p); float a = t.a * vA * uFade; if (a < 0.004) discard; gl_FragColor = vec4(vC * t.rgb, a); }`;

function pointsLayer(cap, tex, additive) {
  const g = new THREE.BufferGeometry();
  const mk = (n) => new THREE.BufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("position", mk(3)); g.setAttribute("aSize", mk(1)); g.setAttribute("aAlpha", mk(1)); g.setAttribute("aColor", mk(3)); g.setAttribute("aRot", mk(1));
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({ vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTex: { value: tex }, uPx: { value: pointPx() }, uFade: { value: 1 } } });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 3 : 1;
  return { pts, g, mat, cap, list: [] };
}
function pointPx() { return (renderer ? renderer.domElement.height : 800) / (2 * Math.tan(THREE.MathUtils.degToRad(camera ? camera.fov : 32) / 2)); }
function flushLayer(L) {
  const a = L.g.attributes, n = Math.min(L.list.length, L.cap);
  for (let i = 0; i < n; i++) {
    const p = L.list[i];
    a.position.array.set([p.x, p.y, p.z], i * 3);
    a.aSize.array[i] = p.size; a.aAlpha.array[i] = p.alphaNow ?? p.alpha; a.aRot.array[i] = p.rot || 0;
    a.aColor.array.set([p.col.r, p.col.g, p.col.b], i * 3);
  }
  for (const k of ["position", "aSize", "aAlpha", "aColor", "aRot"]) a[k].needsUpdate = true;
  L.g.setDrawRange(0, n);
}

function makeTrail(kind) {
  const def = TRAIL[kind];
  if (!def) return null;
  const parts = pointsLayer(900, sprite(def.spr), !def.normal);
  const marks = pointsLayer(260, sprite("blot"), !!def.markGlow);
  scene.add(parts.pts, marks.pts);
  const tr = { def, parts, marks, cols: def.c.map((h) => new THREE.Color(h)), mcol: new THREE.Color(def.m), last: [], markT: [] };
  if (def.smoke) { tr.smoke = pointsLayer(320, sprite("smoke"), false); tr.smokeCol = new THREE.Color(def.smoke); scene.add(tr.smoke.pts); }
  if (def.embers) { tr.embers = pointsLayer(260, sprite("spark"), true); tr.emberCols = def.embers.map((h) => new THREE.Color(h)); scene.add(tr.embers.pts); }
  return tr;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
function stepTrail(tr, meshes, dt, active) {
  const d = tr.def;
  // новые частицы — за летящими кубиками
  meshes.forEach((m, i) => {
    const p = m.position, prev = tr.last[i];
    tr.last[i] = p.clone();
    if (!prev || !active) return;
    const dist = p.distanceTo(prev);
    const speed = dist / Math.max(dt, 1e-3);
    if (speed < 0.6) return;
    const n = Math.min(10, Math.ceil(dist * 2.2 * (d.rate || 1)));
    if (tr.smoke && Math.random() < 0.55 && tr.smoke.list.length < tr.smoke.cap) {
      tr.smoke.list.push({ x: p.x + rnd(-0.4, 0.4), y: p.y + 0.5, z: p.z + rnd(-0.4, 0.4), vx: rnd(-0.6, 0.6), vy: rnd(2.5, 4), vz: rnd(-0.6, 0.6),
        age: 0, life: rnd(0.9, 1.6), size0: rnd(2.2, 3.4), rot: rnd(0, 6.28), vr: rnd(-1, 1), col: tr.smokeCol });
    }
    if (tr.embers) for (let k = 0; k < 2 && tr.embers.list.length < tr.embers.cap; k++) {
      if (Math.random() > 0.6) continue;
      tr.embers.list.push({ x: p.x + rnd(-0.3, 0.3), y: p.y + rnd(0, 0.4), z: p.z + rnd(-0.3, 0.3), vx: rnd(-3, 3), vy: rnd(4, 9), vz: rnd(-3, 3),
        age: 0, life: rnd(0.6, 1.2), size0: rnd(0.25, 0.5), rot: rnd(0, 6.28), vr: rnd(-8, 8), col: tr.emberCols[Math.floor(Math.random() * tr.emberCols.length)].clone(), ph: rnd(0, 6.28) });
    }
    for (let k = 0; k < n && tr.parts.list.length < tr.parts.cap; k++) {
      const f = Math.random();
      const sp = d.spread || 2;
      tr.parts.list.push({ x: prev.x + (p.x - prev.x) * f + rnd(-0.5, 0.5), y: prev.y + (p.y - prev.y) * f + rnd(-0.3, 0.4), z: prev.z + (p.z - prev.z) * f + rnd(-0.5, 0.5),
        vx: rnd(-sp, sp), vy: d.up + rnd(-1, 1), vz: rnd(-sp, sp), age: 0, life: d.life * rnd(0.6, 1.3), size0: d.size * rnd(0.7, 1.3),
        ci: Math.random(), rot: rnd(0, 6.28), vr: rnd(-6, 6), col: new THREE.Color() });
    }
    // след на столе — когда кубик касается стола
    tr.markT[i] = (tr.markT[i] || 0) - dt;
    if (p.y < 1.5 && tr.markT[i] <= 0 && tr.marks.list.length < tr.marks.cap) {
      tr.markT[i] = d.mark;
      tr.marks.list.push({ x: p.x + rnd(-0.3, 0.3), y: 0.03, z: p.z + rnd(-0.3, 0.3), size: rnd(1.5, 2.6) * (kind2size(d)), alpha: d.ma * rnd(0.7, 1), rot: rnd(0, 6.28), col: tr.mcol, age: 0 });
    }
  });
  // движение и затухание частиц
  const out = [];
  for (const q of tr.parts.list) {
    q.age += dt;
    if (q.age >= q.life) continue;
    const k = q.age / q.life;
    if (d.swirl) { const a = 5 * dt, vx = q.vx; q.vx = vx * Math.cos(a) - q.vz * Math.sin(a); q.vz = vx * Math.sin(a) + q.vz * Math.cos(a); }
    q.x += q.vx * dt; q.y = Math.max(0.05, q.y + q.vy * dt); q.z += q.vz * dt;
    q.vx *= 0.94; q.vz *= 0.94;
    q.rot += q.vr * dt;
    q.size = q.size0 * (d.spr === "smoke" ? 0.8 + k * 1.2 : d.spr === "glow" ? 1.1 - k * 0.7 : d.spr === "flame" ? (1.15 - k * 0.85) : 1 - k * 0.4);
    if (d.flicker) q.size *= 0.85 + 0.3 * Math.abs(Math.sin(q.age * 23 + q.rot * 3));
    q.alpha = (d.spr === "spark" ? 1 : Math.min(1, k * 6)) * (1 - k) * (d.normal ? 0.8 : 1);
    if (d.spr === "flame") q.rot = Math.atan2(-q.vx, 6) * 0.6;          // язычки тянутся вверх, а не крутятся
    // цвет по возрасту: от первого к последнему (огонь — белый → жёлтый → оранжевый → красный)
    const nc = tr.cols.length - 1;
    const t3 = Math.min(nc - 0.001, (q.ci * 0.25 + k) * nc), i0 = Math.floor(t3);
    q.col.copy(tr.cols[i0]).lerp(tr.cols[i0 + 1] || tr.cols[i0], t3 - i0);
    out.push(q);
  }
  tr.parts.list = out;
  const sideLayer = (L, fn) => {
    if (!L) return;
    const keep = [];
    for (const q of L.list) { q.age += dt; if (q.age >= q.life) continue; fn(q, q.age / q.life); keep.push(q); }
    L.list = keep;
    flushLayer(L);
  };
  sideLayer(tr.smoke, (q, k) => {
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vy *= 0.98; q.rot += q.vr * dt;
    q.size = q.size0 * (0.7 + k * 1.6); q.alpha = Math.min(1, k * 4) * (1 - k) * 0.32;
  });
  sideLayer(tr.embers, (q, k) => {
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vx *= 0.97; q.vz *= 0.97; q.vy -= 3 * dt;
    q.vx += Math.sin(q.age * 9 + q.ph) * 4 * dt;
    q.size = q.size0 * (1 - k * 0.6); q.alpha = (0.6 + 0.4 * Math.sin(q.age * 30 + q.ph)) * (1 - k);
  });
  for (const mk of tr.marks.list) { mk.age += dt; mk.alphaNow = mk.alpha * Math.min(1, mk.age * 8); }
  flushLayer(tr.parts);
  flushLayer(tr.marks);
}
function kind2size(d) { return d.spr === "smoke" ? 1.3 : d.spr === "drop" ? 0.8 : 1; }
function fadeTrail(tr, k) { for (const L of [tr.parts, tr.marks, tr.smoke, tr.embers]) if (L) L.mat.uniforms.uFade.value = k; }
function disposeTrail(tr) {
  for (const L of [tr.parts, tr.marks, tr.smoke, tr.embers]) if (L) { scene.remove(L.pts); L.g.dispose(); L.mat.dispose(); }
}

// ---------------------------------------------------------------- проигрывание
// Несколько бросков могут быть на экране одновременно: новый не ждёт старый.
// Каждый бросок после остановки лежит HOLD_MS и плавно тает (прозрачность + чуть уменьшается).
const throws = [];
let raf = 0;
const MAX_THROWS = 4;

function fadeBus(b) {
  if (!b || !actx) return;
  const now = actx.currentTime;
  b.gain.cancelScheduledValues(now);
  b.gain.setValueAtTime(b.gain.value, now);
  b.gain.linearRampToValueAtTime(0, now + 0.25);
  setTimeout(() => b.disconnect(), 500);
}

function removeThrow(th) {
  const i = throws.indexOf(th);
  if (i >= 0) throws.splice(i, 1);
  th.meshes.forEach((m) => { scene.remove(m); disposeDie(m); });
  if (th.trail) disposeTrail(th.trail);
  th.finish();
  if (!throws.length) { cancelAnimationFrame(raf); raf = 0; canvas.classList.remove("on", "out"); }
}

function setFade(th, k) {          // k: 1 — видно полностью, 0 — исчез
  th.meshes.forEach((m) => {
    m.userData.mats.forEach((x) => { x.opacity = x.userData.base * k; });
    m.userData.edges.material.opacity = m.userData.edges.userData.base * k;
    m.scale.setScalar((0.85 + 0.15 * k) * SIZE);
    m.castShadow = k > 0.45;
  });
  if (th.trail) fadeTrail(th.trail, k);
}

function frame(now) {
  for (const th of throws.slice()) {
    const n = th.sim.frames.length;
    // время кадра rAF бывает чуть раньше t0 — не уходим в отрицательный индекс
    const fi = Math.max(0, Math.min(n - 1, Math.floor((now - th.t0) / 1000 / STEP)));
    if (fi !== th.fi) {
      th.fi = fi;
      const f = th.sim.frames[fi];
      th.meshes.forEach((m, i) => {
        m.position.set(f[i * 7], f[i * 7 + 1], f[i * 7 + 2]);
        m.quaternion.set(f[i * 7 + 3], f[i * 7 + 4], f[i * 7 + 5], f[i * 7 + 6]);
      });
    }
    if (th.trail) {
      const dt = Math.min(0.1, Math.max(0.001, (now - (th.lastNow || now - 16)) / 1000));
      th.lastNow = now;
      stepTrail(th.trail, th.meshes, dt, fi < n - 1);
    }
    if (fi >= n - 1 && !th.landedAt) {
      th.landedAt = now;
      // легли: отброшенные (преимущество/помеха) тускнеют, натуральные 20/1 подсвечиваются
      th.dice.forEach((d, i) => {
        const m = th.meshes[i];
        if (!d.kept) { m.userData.mats.forEach((x) => { x.userData.base = 0.35; }); m.userData.edges.userData.base = 0.25; setFade(th, 1); }
        else if (d.nat === 20) m.userData.edges.material.color.set("#ffd166");
        else if (d.nat === 1) m.userData.edges.material.color.set("#ff5d73");
      });
      th.finish();
    }
    if (th.landedAt || th.fadeFrom) {
      const start = th.fadeFrom || th.landedAt + HOLD_MS;
      const dur = th.fadeFrom ? 350 : FADE_MS;
      if (now >= start) {
        const k = 1 - Math.min(1, (now - start) / dur);
        setFade(th, k);
        if (k <= 0) removeThrow(th);
      }
    }
  }
  renderer.render(scene, camera);
  raf = throws.length ? requestAnimationFrame(frame) : 0;
}

/** Убрать всё сразу (например, вкладку свернули). */
function stop() {
  for (const th of throws.slice()) { fadeBus(th.bus); removeThrow(th); }
}

/**
 * Показать бросок. Возвращает Promise, который разрешается, когда кубики легли
 * (тогда уже можно показывать карточку с результатом); сами кубики ещё немного полежат и растают.
 */
export function play(roll, { color = "#8b5cf6", color2 = "", trail = "", sound = true } = {}) {
  const dice = diceFromRoll(roll);
  if (!dice.length || !ensureScene()) return Promise.resolve(false);
  if (!throws.length) layout();
  // слишком много бросков на экране — самые старые быстро гасим
  while (throws.filter((t) => !t.fadeFrom).length >= MAX_THROWS) {
    const old = throws.find((t) => !t.fadeFrom);
    old.fadeFrom = performance.now();
    old.finish();
  }
  if (sound) unlockAudio();
  const sim = simulate(dice);
  const last = sim.frames[sim.frames.length - 1];
  const meshes = dice.map((d, i) => {
    const m = makeDie(d, topOf(d.sides, last.subarray(i * 7 + 3, i * 7 + 7)), color, color2);
    m.userData.mats.forEach((x) => { x.userData.base = 1; });
    if (SIZE !== 1) m.scale.setScalar(SIZE);
    m.userData.edges.userData.base = 0.9;
    m.visible = true;
    scene.add(m);
    return m;
  });
  const bus = sound && actx ? playHits(sim.hits) : null;
  canvas.classList.remove("out");
  canvas.classList.add("on");
  return new Promise((resolveLanded) => {
    let sent = false;
    const th = { dice, sim, meshes, bus, t0: performance.now(), fi: -1, landedAt: 0, fadeFrom: 0, trail: trail ? makeTrail(trail) : null,
      finish: () => { if (!sent) { sent = true; resolveLanded(true); } } };
    throws.push(th);
    if (!raf) raf = requestAnimationFrame(frame);
  });
}

/** Бросить «вхолостую» для теста/скриншотов (без звука). */
export function demo(sides = [20, 6, 8], style = {}) {
  return play({ parts: [{ sides: 0, rolls: [] }, ...sides.map((s) => ({ sides: s, rolls: [Math.ceil(Math.random() * s)], kept: [0] }))] }, { sound: false, ...style });
}

export const supported = (() => {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
})();

window.addEventListener("resize", () => { if (renderer && !throws.length) layout(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
export { stop, diceFromRoll };

/** Для тестов: прогнать физику без отрисовки. */
export function _debugSim(sides) {
  view = { w: 390, h: 844, hw: 8, hh: 17 };
  const r = simulate(sides.map((s) => ({ sides: s })));
  return { ...r, faces: sides.map((s) => shape(s).faces.length) };
}
