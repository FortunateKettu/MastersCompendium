// Masters Compendium — генератор случайных карт для внепланового боя.
// Лес, пещера, подземелье, город, деревня, равнина, болото, пустыня, зима. Карта рисуется прямо в браузере мастера
// (по «зерну» — одинаковое зерно даёт одинаковую карту), загружается как обычная карта с сеткой,
// а трудная местность (кусты, вода, болото, завалы, сугробы…) сразу размечается зонами — движение по ней вдвое дороже.
(() => {
  "use strict";
  const MC = window.MC;
  const { t, esc } = MC;
  const G = (MC.MapGen = {});
  const CELL = 70;

  // ---------------------------------------------------------------- случайность
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  };
  function noiseFn(R) {
    const v = new Float32Array(65536);
    for (let i = 0; i < v.length; i++) v[i] = R();
    const at = (x, y) => v[((y & 255) << 8) | (x & 255)];
    const sm = (q) => q * q * (3 - 2 * q);
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    return (x, y, oct = 3) => { let s = 0, amp = 1, f = 1, tot = 0; for (let o = 0; o < oct; o++) { s += n(x * f + o * 31.7, y * f + o * 17.3) * amp; tot += amp; amp /= 2; f *= 2; } return s / tot; };
  }

  // ---------------------------------------------------------------- виды клеток
  const K = {
    grass: ["#5f7d3a", "#6b8a42"], grass2: ["#4f6c31", "#58763a"], dirt: ["#8a6f47", "#957a50"], road: ["#a08a66", "#ad9873"],
    sand: ["#d9c28c", "#e2cc98"], dune: ["#cfb57a", "#c9ac6e"], water: ["#3d7393", "#4a83a3"], deep: ["#2a5571", "#2f5f7d"],
    mud: ["#5d4b33", "#66543a"], marsh: ["#5b6a39", "#667640"], rock: ["#2b2926", "#33302c"], cfloor: ["#5e554b", "#686055"],
    rubble: ["#6a6156", "#71675b"], floor: ["#77716a", "#827b72"], wall: ["#1e1c1b", "#242120"], cobble: ["#7b776f", "#858178"],
    plaza: ["#948e80", "#9d978a"], field: ["#9c8b3f", "#a69447"], tall: ["#6f8a3c", "#7b9744"], snow: ["#e6edf1", "#f1f5f8"],
    drift: ["#d8e2e9", "#dde7ee"], ice: ["#b4d1e1", "#c3dcea"], stonef: ["#b39a6e", "#a88f63"], bridge: ["#7a5a36", "#7a5a36"],
    yard: ["#64813d", "#6d8a45"], lawn: ["#5a7a37", "#5f7f3b"],
  };
  const DIFF = new Set(["water", "deep", "mud", "rubble", "field", "tall", "drift", "ice", "dune"]);

  function grid(W, H, fill) {
    const g = { W, H, c: new Array(W * H).fill(fill), o: [], diff: new Uint8Array(W * H), block: new Uint8Array(W * H), soft: true };
    g.at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : g.c[y * W + x]);
    g.set = (x, y, k) => { if (x >= 0 && y >= 0 && x < W && y < H) g.c[y * W + x] = k; };
    g.in = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    return g;
  }
  const near = (g, x, y, k, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.at(x + dx, y + dy) === k) return true; return false; };
  /** Извилистая полоса (дорога, ручей) поперёк карты. */
  function meander(g, R, n, kind, width, vertical, avoid) {
    const L = vertical ? g.H : g.W, S = vertical ? g.W : g.H;
    let p = S * (0.25 + R() * 0.5);
    const seed = R() * 100;
    const cells = [];
    for (let i = 0; i < L; i++) {
      p += (n(i / 7 + seed, seed) - 0.5) * 1.6;
      p = Math.max(1, Math.min(S - 2, p));
      for (let w = 0; w < width; w++) {
        const q = Math.round(p) + w - Math.floor(width / 2);
        const [x, y] = vertical ? [q, i] : [i, q];
        if (!g.in(x, y)) continue;
        const cur = g.at(x, y);
        if (avoid && avoid.includes(cur)) { g.set(x, y, "bridge"); continue; }
        g.set(x, y, kind); cells.push([x, y]);
      }
    }
    return cells;
  }
  function blob(g, R, cx, cy, r, kind, inner, onlyOn) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy) + (R() - 0.5) * 0.9;
      if (d > r || !g.in(x, y) || (onlyOn && !onlyOn.includes(g.at(x, y)))) continue;
      g.set(x, y, inner && d < r * 0.5 ? inner : kind);
    }
  }
  const free = (g, x, y) => !g.block[y * g.W + x];
  const obj = (g, o) => { g.o.push(o); if (o.block) for (let y = Math.floor(o.y); y < Math.ceil(o.y + (o.h || 1)); y++) for (let x = Math.floor(o.x); x < Math.ceil(o.x + (o.w || 1)); x++) if (g.in(x, y)) g.block[y * g.W + x] = 1; };

  // ---------------------------------------------------------------- генераторы
  const GEN = {
    forest(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) g.set(x, y, n(x / 6, y / 6) > 0.55 ? "grass2" : "grass");
      if (R() < 0.6) meander(g, R, n, "water", R() < 0.5 ? 1 : 2, R() < 0.5);
      if (R() < 0.75) meander(g, R, n, "dirt", 1, R() < 0.5, ["water"]);
      const cx = g.W / 2 + (R() - 0.5) * g.W * 0.2, cy = g.H / 2 + (R() - 0.5) * g.H * 0.2, cr = Math.min(g.W, g.H) / 4.5;
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if (k !== "grass" && k !== "grass2") continue;
        const d = n(x / 5 + 50, y / 5 + 50), clear = Math.hypot(x - cx, y - cy) < cr;
        if (!clear && d > 0.48 && R() < (d - 0.4) * 1.7) obj(g, { k: R() < 0.25 ? "pine" : "tree", x: x + 0.5 + (R() - 0.5) * 0.5, y: y + 0.5 + (R() - 0.5) * 0.5, r: 0.55 + R() * 0.7, hue: R(), block: 1, w: 1, h: 1, bx: x, by: y });
        else if (!clear && d > 0.58 && R() < 0.7) { g.set(x, y, "tall"); if (R() < 0.5) obj(g, { k: "bush", x: x + 0.5, y: y + 0.5, r: 0.35 + R() * 0.25 }); }
        else if (R() < 0.012) obj(g, { k: "rock", x: x + 0.5, y: y + 0.5, r: 0.3 + R() * 0.3, seed: R() });
        else if (R() < 0.006) { obj(g, { k: "log", x: x + 0.5, y: y + 0.5, len: 1.5 + R() * 1.5, ang: R() * Math.PI }); g.set(x, y, "tall"); }
        else if (R() < 0.03) obj(g, { k: "flower", x: x + R(), y: y + R(), hue: R() });
      }
    },
    cave(g, R, n) {
      g.soft = false;
      let wall;
      for (let tries = 0; tries < 6; tries++) {
        wall = new Uint8Array(g.W * g.H);
        for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) wall[y * g.W + x] = x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1 || R() < 0.46 ? 1 : 0;
        for (let it = 0; it < 5; it++) {
          const nw = new Uint8Array(wall);
          for (let y = 1; y < g.H - 1; y++) for (let x = 1; x < g.W - 1; x++) {
            let c = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += wall[(y + dy) * g.W + x + dx];
            nw[y * g.W + x] = c >= 5 ? 1 : 0;
          }
          wall = nw;
        }
        // оставляем самую большую связную пещеру
        const seen = new Int32Array(g.W * g.H).fill(-1);
        let best = -1, bestN = 0, id = 0;
        for (let i = 0; i < wall.length; i++) {
          if (wall[i] || seen[i] >= 0) continue;
          const st = [i]; seen[i] = id; let cnt = 0;
          while (st.length) { const j = st.pop(); cnt++; const x = j % g.W, y = (j / g.W) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (y + dy) * g.W + x + dx; if (!wall[q] && seen[q] < 0) { seen[q] = id; st.push(q); } } }
          if (cnt > bestN) { bestN = cnt; best = id; }
          id++;
        }
        for (let i = 0; i < wall.length; i++) if (!wall[i] && seen[i] !== best) wall[i] = 1;
        if (bestN > g.W * g.H * 0.36) break;
      }
      for (let i = 0; i < wall.length; i++) g.c[i] = wall[i] ? "rock" : "cfloor";
      const floors = [];
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.at(x, y) === "cfloor") floors.push([x, y]);
      for (const [x, y] of floors) if (n(x / 4, y / 4) > 0.66) g.set(x, y, "rubble");
      if (R() < 0.7 && floors.length) { const [px, py] = floors[Math.floor(R() * floors.length)]; blob(g, R, px, py, 1.5 + R() * 2, "water", "deep", ["cfloor", "rubble"]); }
      for (const [x, y] of floors) {
        const k = g.at(x, y);
        if (k === "water" || k === "deep") continue;
        if (near(g, x, y, "rock") && R() < 0.08) obj(g, { k: "stalag", x: x + 0.5, y: y + 0.5, r: 0.25 + R() * 0.2, block: 1 });
        else if (k === "rubble" && R() < 0.5) obj(g, { k: "pebbles", x: x + 0.5, y: y + 0.5, seed: R() });
        else if (R() < 0.012) obj(g, { k: "shroom", x: x + R(), y: y + R(), hue: R() });
        else if (R() < 0.006) obj(g, { k: "bones", x: x + 0.5, y: y + 0.5, ang: R() * 6 });
      }
    },
    dungeon(g, R) {
      g.soft = false;
      g.c.fill("wall");
      const rooms = [];
      const want = Math.max(4, Math.round((g.W * g.H) / 70));
      for (let i = 0; i < want * 8 && rooms.length < want; i++) {
        const w = 4 + Math.floor(R() * 6), h = 4 + Math.floor(R() * 5);
        const x = 1 + Math.floor(R() * (g.W - w - 2)), y = 1 + Math.floor(R() * (g.H - h - 2));
        if (x < 1 || y < 1) continue;
        if (rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
        rooms.push({ x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
      }
      for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g.set(x, y, "floor");
      const inRoom = (x, y) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      const doors = new Set();
      const dig = (x, y, prevRoom) => {
        const was = g.at(x, y), room = inRoom(x, y);
        if (was === "wall") { g.set(x, y, "floor"); if (prevRoom && !room) doors.add(`${x},${y}`); }
        return room;
      };
      const order = rooms.slice().sort((a, b) => a.cx - b.cx);
      for (let i = 1; i < order.length; i++) {
        const a = order[i];
        let b = order[0], bd = 1e9;
        for (let j = 0; j < i; j++) { const d = Math.abs(order[j].cx - a.cx) + Math.abs(order[j].cy - a.cy); if (d < bd) { bd = d; b = order[j]; } }
        const path = [];
        let x = a.cx, y = a.cy;
        const hFirst = R() < 0.5;
        const stepX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); path.push([x, y]); } };
        const stepY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); path.push([x, y]); } };
        if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
        let prev = true;
        for (const [px, py] of path) { const was = g.at(px, py); const r = inRoom(px, py); if (was === "wall" && prev && !r) doors.add(`${px},${py}`); if (was === "wall") g.set(px, py, "floor"); prev = !!r; }
        // дверь на входе в комнату назначения
        for (let k = path.length - 1; k > 0; k--) { const [px, py] = path[k]; if (!inRoom(px, py)) { if (inRoom(...path[Math.min(path.length - 1, k + 1)])) doors.add(`${px},${py}`); break; } }
        if (R() < 0.15 && i > 2) { const c = order[Math.floor(R() * i)]; let qx = a.cx, qy = a.cy; while (qy !== c.cy) { qy += Math.sign(c.cy - qy); dig(qx, qy, true); } while (qx !== c.cx) { qx += Math.sign(c.cx - qx); dig(qx, qy, true); } }
      }
      for (const d of doors) {
        const [x, y] = d.split(",").map(Number);
        if (R() < 0.55 && g.at(x, y) === "floor") {
          const hor = g.at(x - 1, y) === "wall" && g.at(x + 1, y) === "wall";
          const ver = g.at(x, y - 1) === "wall" && g.at(x, y + 1) === "wall";
          if (hor || ver) obj(g, { k: "door", x, y, vert: hor ? 0 : 1 });
        }
      }
      for (const r of rooms) {
        const roll = R();
        if (r.w >= 6 && r.h >= 6 && roll < 0.35) for (const [px, py] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) obj(g, { k: "pillar", x: px + 0.5, y: py + 0.5, block: 1 });
        else if (roll < 0.55) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { if (R() < 0.35) g.set(x, y, "rubble"); }
        const deco = Math.floor(R() * 3);
        for (let i = 0; i < deco; i++) {
          const x = r.x + Math.floor(R() * r.w), y = r.y + Math.floor(R() * r.h);
          if (!free(g, x, y)) continue;
          const k = ["chest", "barrel", "crate", "bones", "table", "altar"][Math.floor(R() * 6)];
          obj(g, { k, x: x + 0.5, y: y + 0.5, ang: R() * 6, block: k === "table" || k === "altar" ? 1 : 0 });
        }
        if (R() < 0.6) obj(g, { k: "torch", x: r.x + 0.5 + Math.floor(R() * r.w), y: r.y + 0.15 });
      }
      for (let i = 0; i < g.c.length; i++) if (g.c[i] === "rubble") obj(g, { k: "pebbles", x: (i % g.W) + 0.5, y: ((i / g.W) | 0) + 0.5, seed: R() });
    },
    city(g, R) {
      g.soft = false;
      g.c.fill("cobble");
      const roads = [];
      const vx = [], hy = [];
      for (let x = 2 + Math.floor(R() * 4); x < g.W - 3; x += 8 + Math.floor(R() * 6)) vx.push(x);
      for (let y = 2 + Math.floor(R() * 3); y < g.H - 3; y += 7 + Math.floor(R() * 5)) hy.push(y);
      for (const x of vx) for (let y = 0; y < g.H; y++) { g.set(x, y, "road"); g.set(x + 1, y, "road"); }
      for (const y of hy) for (let x = 0; x < g.W; x++) { g.set(x, y, "road"); g.set(x, y + 1, "road"); }
      roads.push(...vx, ...hy);
      // площадь: нет / с фонтаном / рынок (по выбору или случайно)
      let plaza = g.opts.plaza;
      if (plaza === "random") plaza = ["none", "fountain", "market"][Math.floor(R() * 3)];
      if (plaza !== "none") {
        const big = plaza === "market";
        const pw = Math.min(big ? 11 : 8, Math.floor(g.W / (big ? 3 : 4))), ph = Math.min(big ? 9 : 7, Math.floor(g.H / (big ? 3 : 4)));
        const px = Math.floor(g.W / 2 - pw / 2 + (R() - 0.5) * 4), py = Math.floor(g.H / 2 - ph / 2 + (R() - 0.5) * 3);
        for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) g.set(x, y, "plaza");
        if (big) {
          // рынок: ряды прилавков с проходами
          for (let y = py + 1; y < py + ph - 1; y += 3) for (let x = px + 1; x < px + pw - 1; x += 2) {
            if (R() < 0.82) obj(g, { k: "stall", x, y, w: 1, h: 1, hue: R(), block: 1 });
            else if (R() < 0.5) { obj(g, { k: "cart", x: x + 0.5, y: y + 0.5, ang: R() * 6 }); g.diff[y * g.W + x] = 1; }
          }
        } else {
          obj(g, { k: R() < 0.5 ? "well" : "fountain", x: px + pw / 2, y: py + ph / 2, block: 1, w: 1, h: 1 });
          for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
            const sx = px + 1 + Math.floor(R() * (pw - 2)), sy = py + 1 + Math.floor(R() * (ph - 2));
            if (Math.abs(sx - (px + pw / 2)) < 1.5 && Math.abs(sy - (py + ph / 2)) < 1.5) continue;
            obj(g, { k: "stall", x: sx, y: sy, w: 1, h: 1, hue: R(), block: 1 });
          }
        }
      }
      // кварталы → дома
      const isBuildable = (x, y) => g.at(x, y) === "cobble";
      const lots = [];
      const split = (x, y, w, h, depth) => {
        if (w <= 0 || h <= 0) return;
        if ((w <= 6 && h <= 5) || depth > 5) { lots.push({ x, y, w, h }); return; }
        if (w >= h) { const c = 3 + Math.floor(R() * (w - 5)); const alley = R() < 0.35 ? 1 : 0; split(x, y, c, h, depth + 1); split(x + c + alley, y, w - c - alley, h, depth + 1); }
        else { const c = 2 + Math.floor(R() * (h - 4)); const alley = R() < 0.35 ? 1 : 0; split(x, y, w, c, depth + 1); split(x, y + c + alley, w, h - c - alley, depth + 1); }
      };
      const xs = [-2, ...vx, g.W], ys = [-2, ...hy, g.H];
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
        const bx = xs[i] + 2, by = ys[j] + 2, bw = xs[i + 1] - bx, bh = ys[j + 1] - by;
        if (bw > 1 && bh > 1) split(bx, by, bw, bh, 0);
      }
      for (const L of lots) {
        let ok = true;
        for (let y = L.y; y < L.y + L.h && ok; y++) for (let x = L.x; x < L.x + L.w; x++) if (!isBuildable(x, y)) { ok = false; break; }
        if (!ok || L.w < 2 || L.h < 2) continue;
        if (R() < 0.15) {
          for (let y = L.y; y < L.y + L.h; y++) for (let x = L.x; x < L.x + L.w; x++) g.set(x, y, "yard");
          obj(g, { k: "tree", x: L.x + L.w / 2, y: L.y + L.h / 2, r: 0.8, hue: R(), block: 1 });
          continue;
        }
        const pad = L.w > 3 && L.h > 3 && R() < 0.3 ? 0.15 : 0.04;
        const area = L.w * L.h, roll = R();
        const bk = area >= 16 ? (roll < 0.35 ? "tavern" : roll < 0.6 ? "inn" : roll < 0.72 ? "temple" : "house")
          : area >= 6 ? (roll < 0.18 ? "shop" : roll < 0.26 ? "smith" : "house") : "house";
        obj(g, { k: "house", x: L.x + pad, y: L.y + pad, w: L.w - pad * 2, h: L.h - pad * 2, hue: R(), block: 1, bk, seed: R() });
      }
      // решётки канализации на улицах
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.at(x, y) === "road" && R() < 0.025) obj(g, { k: "grate", x: x + 0.5, y: y + 0.5 });
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        if (g.at(x, y) !== "cobble" || !free(g, x, y)) continue;
        if (R() < 0.05) { obj(g, { k: R() < 0.5 ? "crate" : "barrel", x: x + 0.5, y: y + 0.5, ang: R() * 6 }); g.diff[y * g.W + x] = 1; }
      }
    },
    market(g, R) {
      g.soft = false;
      g.c.fill("plaza");
      // по краям — дома с лавками, в середине — ряды прилавков, телеги, ящики, колодец
      for (let x = 0; x < g.W; x++) { g.set(x, 0, "cobble"); g.set(x, g.H - 1, "cobble"); }
      let x = 0;
      while (x < g.W - 2) { const w = 3 + Math.floor(R() * 3); obj(g, { k: "house", x: x + 0.05, y: 0.05, w: Math.min(w, g.W - x) - 0.1, h: 2.4, hue: R(), block: 1, bk: R() < 0.6 ? "shop" : "house", seed: R() }); x += w + (R() < 0.3 ? 1 : 0); }
      x = 0;
      while (x < g.W - 2) { const w = 3 + Math.floor(R() * 3); obj(g, { k: "house", x: x + 0.05, y: g.H - 2.45, w: Math.min(w, g.W - x) - 0.1, h: 2.4, hue: R(), block: 1, bk: R() < 0.4 ? "shop" : R() < 0.3 ? "tavern" : "house", seed: R() }); x += w + (R() < 0.3 ? 1 : 0); }
      const cx = Math.floor(g.W / 2), cy = Math.floor(g.H / 2);
      obj(g, { k: R() < 0.5 ? "fountain" : "well", x: cx, y: cy, block: 1 });
      for (let y = 4; y < g.H - 4; y += 3) for (let xx = 2; xx < g.W - 2; xx += 2) {
        if (Math.abs(xx - cx) < 2 && Math.abs(y - cy) < 2) continue;
        if (R() < 0.7) obj(g, { k: "stall", x: xx, y, w: 1, h: 1, hue: R(), block: 1 });
        else if (R() < 0.4) { obj(g, { k: "cart", x: xx + 0.5, y: y + 0.5, ang: R() * 6 }); g.diff[y * g.W + xx] = 1; }
      }
      for (let i = 0; i < g.W * g.H / 25; i++) {
        const xx = Math.floor(R() * g.W), yy = 3 + Math.floor(R() * (g.H - 6));
        if (!free(g, xx, yy)) continue;
        obj(g, { k: R() < 0.5 ? "crate" : "barrel", x: xx + 0.5, y: yy + 0.5, ang: R() * 6 }); g.diff[yy * g.W + xx] = 1;
      }
    },
    tavern(g, R) {
      // большой зал таверны изнутри: стойка, столы, камин, кухня, лестница; снаружи — улица
      g.soft = false;
      g.opts.roofs = false;
      g.c.fill("cobble");
      const x0 = 1, y0 = 1, x1 = g.W - 2, y1 = g.H - 2;
      obj(g, { k: "house", x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, hue: R(), block: 0, bk: "tavern_hall", seed: R(), hall: 1 });
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, "floor");
      const kw = Math.max(4, Math.floor((x1 - x0) / 4));
      obj(g, { k: "wall", x: x1 - kw, y: y0, w: 0.15, h: Math.floor((y1 - y0) / 2) });                 // стена кухни
      obj(g, { k: "wall", x: x1 - kw, y: y0 + Math.floor((y1 - y0) / 2), w: kw + 1, h: 0.15 });
      obj(g, { k: "counter", x: x1 - kw - 3, y: y0 + 1, w: 1, h: Math.floor((y1 - y0) / 2) - 1, block: 1 });
      obj(g, { k: "barrels", x: x1 - kw - 1.4, y: y0 + 0.6, n: 3 });
      obj(g, { k: "hearth", x: x0 + 0.2, y: Math.floor((y0 + y1) / 2) - 1, w: 0.8, h: 2, block: 1 });
      obj(g, { k: "stairs", x: x0 + 0.3, y: y0 + 0.3, w: 2, h: 3 });
      obj(g, { k: "stove", x: x1 - kw + 1, y: y0 + 0.4, w: 2, h: 1 });
      obj(g, { k: "table_long", x: x1 - kw + 1, y: y0 + 2.5, w: Math.max(2, kw - 2), h: 1 });
      // столы с табуретами
      const tx0 = x0 + 3.5, tx1 = x1 - kw - 4.5;
      for (let y = y0 + 2; y < y1 - 1; y += 3) for (let x = tx0; x < tx1; x += 3.2) {
        if (R() < 0.85) obj(g, { k: "rtable", x: x + R() * 0.6, y: y + R() * 0.6, r: 0.55 + R() * 0.2, seats: 3 + Math.floor(R() * 3), ang: R() * 6, block: 1 });
      }
      // двери на улицу
      obj(g, { k: "door", x: Math.floor((x0 + x1) / 2), y: y1, vert: 0 });
    },
    sewer(g, R) {
      // канализация: тоннели с каналом посередине и мостками по краям, круглые залы с решётками
      g.soft = false;
      g.c.fill("wall");
      const halls = [];
      for (let i = 0; i < 40 && halls.length < Math.max(3, Math.floor(g.W * g.H / 140)); i++) {
        const r = 2 + Math.floor(R() * 2), cx = r + 1 + Math.floor(R() * (g.W - 2 * r - 2)), cy = r + 1 + Math.floor(R() * (g.H - 2 * r - 2));
        if (halls.some((h) => Math.hypot(h.cx - cx, h.cy - cy) < h.r + r + 3)) continue;
        halls.push({ cx, cy, r });
      }
      const carve = (x, y, k) => { if (g.in(x, y) && x > 0 && y > 0 && x < g.W - 1 && y < g.H - 1 && (g.at(x, y) === "wall" || k === "water")) g.set(x, y, k); };
      const sorted = halls.slice().sort((a, b) => a.cx - b.cx);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i], b = sorted[i - 1];
        let x = a.cx, y = a.cy;
        const horizFirst = R() < 0.5;
        const step = (dx, dy) => {
          x += dx; y += dy;
          for (let k = -1; k <= 1; k++) { if (dx) carve(x, y + k, k === 0 ? "water" : "floor"); else carve(x + k, y, k === 0 ? "water" : "floor"); }
        };
        if (horizFirst) { while (x !== b.cx) step(Math.sign(b.cx - x), 0); while (y !== b.cy) step(0, Math.sign(b.cy - y)); }
        else { while (y !== b.cy) step(0, Math.sign(b.cy - y)); while (x !== b.cx) step(Math.sign(b.cx - x), 0); }
      }
      for (const h of halls) {
        for (let y = h.cy - h.r; y <= h.cy + h.r; y++) for (let x = h.cx - h.r; x <= h.cx + h.r; x++) if (Math.hypot(x - h.cx, y - h.cy) <= h.r + 0.3) carve(x, y, "floor");
        if (R() < 0.6) { g.set(h.cx, h.cy, "deep"); obj(g, { k: "grate", x: h.cx + 0.5, y: h.cy + 0.5, big: 1 }); }
        else obj(g, { k: "pipe", x: h.cx + 0.5, y: h.cy - h.r + 0.3 });
      }
      // мостки через канал, завалы, кости, крысиные гнёзда
      for (let y = 1; y < g.H - 1; y++) for (let x = 1; x < g.W - 1; x++) {
        const k = g.at(x, y);
        if (k === "water" && R() < 0.06 && ((g.at(x - 1, y) === "floor" && g.at(x + 1, y) === "floor") || (g.at(x, y - 1) === "floor" && g.at(x, y + 1) === "floor"))) g.set(x, y, "bridge");
        else if (k === "floor" && R() < 0.05) { g.set(x, y, "rubble"); obj(g, { k: "pebbles", x: x + 0.5, y: y + 0.5, seed: R() }); }
        else if (k === "floor" && R() < 0.015) obj(g, { k: "bones", x: x + 0.5, y: y + 0.5, ang: R() * 6 });
        else if (k === "floor" && near(g, x, y, "wall") && R() < 0.02) obj(g, { k: "torch", x: x + 0.5, y: y + 0.5 });
      }
      g.sewer = true;
    },
    village(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) g.set(x, y, n(x / 7, y / 7) > 0.56 ? "grass2" : "grass");
      if (R() < 0.45) blob(g, R, g.W * (0.15 + R() * 0.7), g.H * (0.15 + R() * 0.7), 2 + R() * 2, "water", "deep");
      const road = meander(g, R, n, "dirt", 2, false, ["water", "deep"]);
      if (R() < 0.6) meander(g, R, n, "dirt", 1, true, ["water", "deep"]);
      const taken = (x, y, w, h) => { for (let yy = y - 1; yy < y + h + 1; yy++) for (let xx = x - 1; xx < x + w + 1; xx++) { const k = g.at(xx, yy); if (k === null || k === "dirt" || k === "water" || k === "deep" || k === "field" || !free(g, xx, yy)) return true; } return false; };
      let houses = 0;
      for (let i = 0; i < 300 && houses < 6 + Math.floor((g.W * g.H) / 120); i++) {
        const [rx, ry] = road[Math.floor(R() * road.length)] || [g.W / 2, g.H / 2];
        const w = 3 + Math.floor(R() * 2), h = 2 + Math.floor(R() * 2);
        const side = R() < 0.5 ? -1 : 1;
        const x = Math.round(rx + (R() - 0.5) * 6), y = Math.round(ry + side * (2 + R() * 3)) - (side < 0 ? h : 0);
        if (x < 1 || y < 1 || x + w > g.W - 1 || y + h > g.H - 1 || taken(x, y, w, h)) continue;
        obj(g, { k: "house", x: x + 0.05, y: y + 0.05, w: w - 0.1, h: h - 0.1, hue: 0.05 + R() * 0.2, thatch: 1, block: 1 });
        houses++;
      }
      const wantF = 2 + Math.floor(R() * 3);
      for (let i = 0, made = 0; i < 80 && made < wantF; i++) {
        const w = 4 + Math.floor(R() * 4), h = 3 + Math.floor(R() * 3);
        const x = Math.floor(R() * (g.W - w)), y = Math.floor(R() * (g.H - h));
        if (taken(x, y, w, h)) continue;
        made++;
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g.set(xx, yy, "field");
        obj(g, { k: "fence", x, y, w, h });
      }
      const cx = road[Math.floor(road.length / 2)] || [g.W / 2, g.H / 2];
      for (const [dx, dy] of [[0, -2], [0, 3], [2, -2]]) { const x = cx[0] + dx, y = cx[1] + dy; if (g.in(x, y) && free(g, x, y) && /grass/.test(g.at(x, y))) { obj(g, { k: "well", x: x + 0.5, y: y + 0.5, block: 1 }); break; } }
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if (!/grass/.test(k) || !free(g, x, y)) continue;
        const edge = Math.min(x, y, g.W - 1 - x, g.H - 1 - y);
        if (R() < (edge < 3 ? 0.16 : 0.025)) obj(g, { k: "tree", x: x + 0.5, y: y + 0.5, r: 0.5 + R() * 0.6, hue: R(), block: 1 });
        else if (R() < 0.01) obj(g, { k: "hay", x: x + 0.5, y: y + 0.5 });
        else if (R() < 0.03) obj(g, { k: "flower", x: x + R(), y: y + R(), hue: R() });
      }
    },
    plains(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const v = n(x / 8, y / 8), tg = n(x / 4 + 20, y / 4 + 20);
        g.set(x, y, tg > 0.64 ? "tall" : v > 0.55 ? "grass2" : "grass");
      }
      if (R() < 0.6) meander(g, R, n, "dirt", 1, R() < 0.5);
      if (R() < 0.35) meander(g, R, n, "water", 1, R() < 0.5, ["dirt"]);
      g.hills = true;
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if (k === "dirt" || k === "water" || k === "bridge") continue;
        if (R() < 0.012) obj(g, { k: "rock", x: x + 0.5, y: y + 0.5, r: 0.35 + R() * 0.45, seed: R(), block: R() < 0.5 ? 1 : 0 });
        else if (n(x / 6 + 70, y / 6) > 0.68 && R() < 0.35) obj(g, { k: "tree", x: x + 0.5, y: y + 0.5, r: 0.6 + R() * 0.6, hue: R(), block: 1 });
        else if (R() < 0.04) obj(g, { k: "flower", x: x + R(), y: y + R(), hue: R() });
      }
      if (R() < 0.4) {
        const x = 3 + Math.floor(R() * (g.W - 8)), y = 3 + Math.floor(R() * (g.H - 7));
        for (let i = 0; i < 5; i++) obj(g, { k: "ruin", x: x + R() * 4, y: y + R() * 3, ang: R() * 6, len: 0.8 + R() * 1.6 });
      }
    },
    swamp(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const h = n(x / 6, y / 6, 4);
        g.set(x, y, h < 0.36 ? "deep" : h < 0.45 ? "water" : h < 0.53 ? "mud" : h < 0.6 ? "marsh" : "grass2");
      }
      if (R() < 0.6) {
        const cells = meander(g, R, n, "bridge", 1, R() < 0.5);
        cells.forEach(([x, y]) => { g.set(x, y, "bridge"); });
      }
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if ((k === "water" || k === "mud") && near(g, x, y, "marsh") && R() < 0.35) obj(g, { k: "reeds", x: x + R(), y: y + R(), seed: R() });
        else if (k === "water" && R() < 0.06) obj(g, { k: "lily", x: x + R(), y: y + R(), r: 0.15 + R() * 0.15 });
        else if ((k === "marsh" || k === "grass2") && R() < 0.05) obj(g, { k: "deadtree", x: x + 0.5, y: y + 0.5, seed: R(), block: 1 });
        else if (k === "grass2" && R() < 0.05) obj(g, { k: "tree", x: x + 0.5, y: y + 0.5, r: 0.5 + R() * 0.5, hue: 0.8 + R() * 0.2, block: 1 });
        else if (k === "deep" && R() < 0.005) obj(g, { k: "log", x: x + 0.5, y: y + 0.5, len: 1.5 + R(), ang: R() * Math.PI });
      }
    },
    desert(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const v = n(x / 9, y / 12), r = n(x / 5 + 40, y / 5 + 40);
        g.set(x, y, r > 0.7 ? "stonef" : v > 0.62 ? "dune" : "sand");
      }
      g.dunes = true;
      if (R() < 0.4) {
        const ox = g.W * (0.2 + R() * 0.6), oy = g.H * (0.2 + R() * 0.6), rr = 2 + R() * 2;
        blob(g, R, ox, oy, rr + 2.5, "lawn"); blob(g, R, ox, oy, rr, "water", "deep");
        for (let i = 0; i < 6; i++) { const a = R() * 6.28, d = rr + 0.8 + R() * 1.5; obj(g, { k: "palm", x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d, r: 0.9 + R() * 0.4, seed: R(), block: 1 }); }
      }
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if (!free(g, x, y)) continue;
        if (k === "stonef" && R() < 0.2) obj(g, { k: "rock", x: x + 0.5, y: y + 0.5, r: 0.3 + R() * 0.5, seed: R(), sand: 1, block: R() < 0.5 ? 1 : 0 });
        else if (k === "sand" && R() < 0.012) obj(g, { k: "cactus", x: x + 0.5, y: y + 0.5, seed: R(), block: 1 });
        else if (k === "sand" && R() < 0.004) obj(g, { k: "bones", x: x + 0.5, y: y + 0.5, ang: R() * 6 });
      }
      if (R() < 0.5) {
        const x = 3 + Math.floor(R() * (g.W - 9)), y = 3 + Math.floor(R() * (g.H - 7));
        for (let i = 0; i < 4; i++) obj(g, { k: "pillar", x: x + i * 1.6 + 0.5, y: y + 0.5, block: 1, sand: 1, broken: R() < 0.5 });
        for (let i = 0; i < 4; i++) obj(g, { k: "ruin", x: x + R() * 6, y: y + 1.5 + R() * 2, ang: R() * 6, len: 0.8 + R() * 1.5, sand: 1 });
      }
    },
    winter(g, R, n) {
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) g.set(x, y, n(x / 5, y / 5) > 0.64 ? "drift" : "snow");
      if (R() < 0.6) blob(g, R, g.W * (0.2 + R() * 0.6), g.H * (0.2 + R() * 0.6), 2.5 + R() * 3, "ice");
      if (R() < 0.6) meander(g, R, n, "dirt", 1, R() < 0.5, ["ice"]);
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const k = g.at(x, y);
        if (k === "ice" || k === "dirt" || k === "bridge") continue;
        const d = n(x / 5 + 90, y / 5 + 90);
        if (d > 0.55 && R() < (d - 0.45) * 1.2) obj(g, { k: "pine", x: x + 0.5 + (R() - 0.5) * 0.4, y: y + 0.5 + (R() - 0.5) * 0.4, r: 0.55 + R() * 0.6, snowy: 1, block: 1 });
        else if (R() < 0.012) obj(g, { k: "rock", x: x + 0.5, y: y + 0.5, r: 0.3 + R() * 0.35, seed: R(), snowy: 1 });
      }
    },
  };
  G.TYPES = Object.keys(GEN);

  G.generate = (type, W, H, seed, opts = {}) => {
    const R = rng(seed), n = noiseFn(R);
    const g = grid(W, H, "grass");
    g.opts = { plaza: "random", roofs: true, ...opts };
    (GEN[type] || GEN.forest)(g, R, n);
    g.type = type; g.seed = seed; g.n = n;
    for (let i = 0; i < g.c.length; i++) if (DIFF.has(g.c[i])) g.diff[i] = 1;
    return g;
  };

  /** Клетки трудной местности → прямоугольники (сначала полосы по рядам, потом склеиваем одинаковые соседние). */
  G.zones = (g, s = CELL, max = 190) => {
    const rects = [];
    const open = new Map();
    for (let y = 0; y <= g.H; y++) {
      const runs = [];
      if (y < g.H) for (let x = 0; x < g.W;) { if (!g.diff[y * g.W + x]) { x++; continue; } let e = x; while (e < g.W && g.diff[y * g.W + e]) e++; runs.push([x, e]); x = e; }
      const next = new Map();
      for (const [a, b] of runs) { const key = a + ":" + b; const r = open.get(key); if (r) { r.h++; next.set(key, r); open.delete(key); } else next.set(key, { x: a, y, w: b - a, h: 1 }); }
      for (const r of open.values()) rects.push(r);
      open.clear();
      for (const [k, v] of next) open.set(k, v);
    }
    rects.sort((a, b) => b.w * b.h - a.w * a.h);
    return rects.slice(0, max).map((r) => ({ pts: [[r.x * s, r.y * s], [(r.x + r.w) * s, r.y * s], [(r.x + r.w) * s, (r.y + r.h) * s], [r.x * s, (r.y + r.h) * s]] }));
  };

  // ---------------------------------------------------------------- рисование
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, k) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`; };
  let texCache = null;
  function texture() {
    if (texCache) return texCache;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    const R = rng(7);
    for (let i = 0; i < 2600; i++) { x.fillStyle = R() < 0.5 ? `rgba(0,0,0,${0.05 + R() * 0.12})` : `rgba(255,255,255,${0.03 + R() * 0.08})`; const r = 0.5 + R() * 1.8; x.beginPath(); x.arc(R() * 256, R() * 256, r, 0, 7); x.fill(); }
    texCache = c;
    return c;
  }
  function shadow(x, X, Y, rx, ry) { x.fillStyle = "rgba(0,0,0,.28)"; x.beginPath(); x.ellipse(X + rx * 0.25, Y + ry * 0.3, rx, ry, 0, 0, 7); x.fill(); }

  G.render = (g, s, canvas) => {
    g_cur = g;
    canvas.width = g.W * s; canvas.height = g.H * s;
    const x = canvas.getContext("2d");
    const R = rng(g.seed ^ 0x9e3779b9);
    // 1) основа: по клетке пиксель → растягиваем (мягкие переходы на природе, чёткие — в постройках)
    const lo = document.createElement("canvas"); lo.width = g.W; lo.height = g.H;
    const lx = lo.getContext("2d");
    const im = lx.createImageData(g.W, g.H);
    for (let i = 0; i < g.c.length; i++) {
      const [a, b] = g.sewer && (g.c[i] === "water" || g.c[i] === "deep") ? (g.c[i] === "deep" ? ["#2b3a2a", "#2f3f2d"] : ["#3c4f38", "#445a3f"])
        : g.sewer && g.c[i] === "wall" ? ["#2a2622", "#2e2a25"] : K[g.c[i]] || K.grass;
      const A = hex(a), B = hex(b), k = R();
      for (let j = 0; j < 3; j++) im.data[i * 4 + j] = Math.round(A[j] + (B[j] - A[j]) * k);
      im.data[i * 4 + 3] = 255;
    }
    lx.putImageData(im, 0, 0);
    x.imageSmoothingEnabled = g.soft;
    if (g.soft) x.imageSmoothingQuality = "high";
    x.drawImage(lo, 0, 0, g.W * s, g.H * s);
    x.imageSmoothingEnabled = true;
    // холмы/дюны — светотень по шуму
    if (g.hills || g.dunes) {
      const step = Math.max(4, s / 6);
      for (let py = 0; py < g.H * s; py += step) for (let px = 0; px < g.W * s; px += step) {
        const v = g.n(px / s / 7 + 300, py / s / 7 + 300, 2) - g.n((px + s) / s / 7 + 300, (py + s) / s / 7 + 300, 2);
        x.fillStyle = v > 0 ? `rgba(255,250,230,${Math.min(0.18, v * 1.2)})` : `rgba(40,25,0,${Math.min(0.2, -v * 1.4)})`;
        x.fillRect(px, py, step, step);
      }
    }
    // 2) фактура
    x.save(); x.globalAlpha = 0.9; x.fillStyle = x.createPattern(texture(), "repeat"); x.fillRect(0, 0, canvas.width, canvas.height); x.restore();
    // 3) особые клетки
    for (let cy = 0; cy < g.H; cy++) for (let cx = 0; cx < g.W; cx++) {
      const k = g.at(cx, cy), X = cx * s, Y = cy * s;
      if (k === "cfloor" || k === "rubble" && g.type === "cave") {
        x.fillStyle = mix(K.cfloor[0], K.cfloor[1], R());
        x.beginPath(); x.arc(X + s / 2 + (R() - 0.5) * s * 0.2, Y + s / 2 + (R() - 0.5) * s * 0.2, s * 0.78, 0, 7); x.fill();
      }
    }
    if (g.type === "cave") {
      for (let cy = 0; cy < g.H; cy++) for (let cx = 0; cx < g.W; cx++) {
        const k = g.at(cx, cy);
        if (k === "water" || k === "deep" || k === "rubble") { x.fillStyle = mix(K[k][0], K[k][1], R()); x.beginPath(); x.arc(cx * s + s / 2, cy * s + s / 2, s * 0.68, 0, 7); x.fill(); }
      }
      // тёмная кромка стен
      x.save(); x.globalCompositeOperation = "multiply";
      for (let cy = 0; cy < g.H; cy++) for (let cx = 0; cx < g.W; cx++) if (g.at(cx, cy) === "rock" && (near(g, cx, cy, "cfloor") || near(g, cx, cy, "rubble") || near(g, cx, cy, "water"))) {
        const gr = x.createRadialGradient(cx * s + s / 2, cy * s + s / 2, 0, cx * s + s / 2, cy * s + s / 2, s * 1.1);
        gr.addColorStop(0, "rgba(10,8,6,.9)"); gr.addColorStop(1, "rgba(10,8,6,0)");
        x.fillStyle = gr; x.fillRect(cx * s - s / 2, cy * s - s / 2, s * 2, s * 2);
      }
      x.restore();
    }
    for (let cy = 0; cy < g.H; cy++) for (let cx = 0; cx < g.W; cx++) {
      const k = g.at(cx, cy), X = cx * s, Y = cy * s;
      if (k === "floor" || (k === "rubble" && g.type === "dungeon")) {          // плиты пола
        x.strokeStyle = "rgba(30,25,20,.45)"; x.lineWidth = Math.max(1, s / 40);
        const h = s / 2;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { x.fillStyle = `rgba(${R() < 0.5 ? "255,255,255" : "0,0,0"},${R() * 0.07})`; x.fillRect(X + i * h, Y + j * h, h, h); x.strokeRect(X + i * h + 0.5, Y + j * h + 0.5, h - 1, h - 1); }
      } else if (k === "wall" && g.type === "dungeon") {
        x.strokeStyle = "rgba(255,255,255,.05)"; x.lineWidth = 1;
        for (let i = -s; i < s; i += s / 5) { x.beginPath(); x.moveTo(X + i, Y + s); x.lineTo(X + i + s, Y); x.stroke(); }
      } else if (k === "cobble" || k === "plaza" || k === "road") {
        x.strokeStyle = "rgba(40,35,30,.35)"; x.lineWidth = Math.max(1, s / 50);
        const n = k === "road" ? 3 : 4, h = s / n;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const o = (j % 2) * h / 2; x.beginPath(); x.roundRect?.(X + i * h + o - h / 2 * (j % 2 ? 1 : 0) + 1, Y + j * h + 1, h - 2, h - 2, h / 4); x.stroke(); }
      } else if (k === "field") {
        x.strokeStyle = "rgba(90,70,20,.6)"; x.lineWidth = Math.max(1.5, s / 18);
        for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(X, Y + (i + 0.5) * s / 4); x.lineTo(X + s, Y + (i + 0.5) * s / 4); x.stroke(); }
        x.fillStyle = "rgba(200,180,80,.5)";
        for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(X + R() * s, Y + Math.floor(R() * 4 + 0.5) * s / 4, s / 18, 0, 7); x.fill(); }
      } else if (k === "tall" || k === "marsh") {
        x.strokeStyle = k === "tall" ? "rgba(140,170,70,.7)" : "rgba(120,140,70,.6)"; x.lineWidth = Math.max(1, s / 40);
        for (let i = 0; i < 9; i++) { const bx = X + R() * s, by = Y + R() * s; x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + (R() - 0.5) * s / 6, by - s / 5); x.stroke(); }
      } else if (k === "water" || k === "deep") {
        if (R() < 0.35) { x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = Math.max(1, s / 35); const wx = X + R() * s * 0.6, wy = Y + R() * s; x.beginPath(); x.arc(wx + s / 6, wy, s / 6, Math.PI * 1.15, Math.PI * 1.85); x.stroke(); }
      } else if (k === "mud") {
        if (R() < 0.4) { x.fillStyle = "rgba(30,20,10,.35)"; x.beginPath(); x.ellipse(X + R() * s, Y + R() * s, s / 8, s / 14, R() * 3, 0, 7); x.fill(); }
      } else if (k === "drift") {
        x.fillStyle = "rgba(120,150,180,.18)"; x.beginPath(); x.ellipse(X + s / 2, Y + s * 0.65, s * 0.5, s * 0.18, 0, 0, 7); x.fill();
      } else if (k === "ice") {
        x.strokeStyle = "rgba(255,255,255,.5)"; x.lineWidth = 1;
        if (R() < 0.5) { x.beginPath(); x.moveTo(X + R() * s, Y + R() * s); for (let i = 0; i < 3; i++) x.lineTo(X + R() * s, Y + R() * s); x.stroke(); }
      } else if (k === "bridge") {
        const under = g.type === "swamp" ? "#3d5b57" : K.water[0];
        x.fillStyle = under; x.fillRect(X, Y, s, s);
        x.fillStyle = "#7d5b37"; x.fillRect(X, Y + s * 0.08, s, s * 0.84);
        x.strokeStyle = "rgba(40,25,10,.7)"; x.lineWidth = Math.max(1, s / 30);
        for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(X + i * s / 5, Y + s * 0.08); x.lineTo(X + i * s / 5, Y + s * 0.92); x.stroke(); }
      } else if (k === "dune" && g.type === "desert") {
        x.strokeStyle = "rgba(150,110,50,.25)"; x.lineWidth = Math.max(1, s / 30);
        x.beginPath(); x.moveTo(X, Y + s * 0.5); x.quadraticCurveTo(X + s / 2, Y + s * 0.2, X + s, Y + s * 0.5); x.stroke();
      }
    }
    // стены подземелья: тёмная кромка у пола
    if (g.type === "dungeon") {
      x.fillStyle = "#0f0e0d";
      const e = s * 0.14;
      for (let cy = 0; cy < g.H; cy++) for (let cx = 0; cx < g.W; cx++) {
        if (g.at(cx, cy) !== "wall") continue;
        const X = cx * s, Y = cy * s, fl = (dx, dy) => { const k = g.at(cx + dx, cy + dy); return k && k !== "wall"; };
        if (fl(0, 1)) x.fillRect(X, Y + s - e, s, e);
        if (fl(0, -1)) x.fillRect(X, Y, s, e);
        if (fl(1, 0)) x.fillRect(X + s - e, Y, e, s);
        if (fl(-1, 0)) x.fillRect(X, Y, e, s);
      }
    }
    // 4) предметы — сначала низкие, потом высокие (кроны поверх всего)
    const order = { flower: 0, lily: 0, pebbles: 0, bones: 1, fence: 1, log: 2, rock: 2, reeds: 2, hay: 2, crate: 2, barrel: 2, chest: 2, table: 2, altar: 2, door: 2, torch: 3, ruin: 2, shroom: 2, stall: 3, well: 3, fountain: 3, stalag: 3, pillar: 3, cactus: 3, bush: 3, house: 1, deadtree: 4, tree: 5, pine: 5, palm: 5, grate: 1, cart: 2, wall: 3, counter: 2, barrels: 2, hearth: 2, stairs: 1, stove: 2, table_long: 2, rtable: 2, pipe: 2 };
    g.o.slice().sort((a, b) => (order[a.k] ?? 2) - (order[b.k] ?? 2) || a.y - b.y).forEach((o) => drawObj(x, o, s, R));
    // лёгкая виньетка
    const vg = x.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.35, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, g.type === "winter" ? "rgba(60,80,110,.22)" : "rgba(0,0,0,.28)");
    x.fillStyle = vg; x.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  };

  let g_cur = null;
  const SIGN = { tavern: "🍺", inn: "🛏", shop: "🪙", smith: "⚒", temple: "✦" };
  function sign(x, X, Y, s, bk) {
    const r = s * 0.3;
    x.fillStyle = "#3b2a1a"; x.strokeStyle = "#d9b26a"; x.lineWidth = Math.max(1.5, s / 22);
    x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill(); x.stroke();
    x.fillStyle = "#fde68a"; x.font = `${Math.round(r * 1.25)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(SIGN[bk] || "•", X, Y + r * 0.08);
  }
  /** Дом без крыши: пол, стены, дверь и мебель по назначению здания. */
  function drawInterior(x, o, s, R) {
    const X = o.x * s, Y = o.y * s, w = o.w * s, h = o.h * s;
    const Rr = rng(Math.floor((o.seed || 0.3) * 1e6));
    // пол — доски
    x.fillStyle = o.bk === "temple" ? "#8b8378" : "#7a5a3a"; x.fillRect(X, Y, w, h);
    x.strokeStyle = o.bk === "temple" ? "rgba(40,35,30,.35)" : "rgba(40,25,12,.45)"; x.lineWidth = 1;
    if (o.bk === "temple") { for (let i = s / 2; i < w; i += s / 2) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i, Y + h); x.stroke(); } for (let i = s / 2; i < h; i += s / 2) { x.beginPath(); x.moveTo(X, Y + i); x.lineTo(X + w, Y + i); x.stroke(); } }
    else for (let i = s / 4; i < h; i += s / 4) { x.beginPath(); x.moveTo(X, Y + i); x.lineTo(X + w, Y + i); x.stroke(); }
    // стены и дверь (снизу, где улица)
    const wt = Math.max(3, s * 0.14);
    x.strokeStyle = "#2a211a"; x.lineWidth = wt; x.strokeRect(X + wt / 2, Y + wt / 2, w - wt, h - wt);
    if (!o.hall) {
      const dx = X + w / 2 - s * 0.35;
      x.fillStyle = "#7a5a3a"; x.fillRect(dx, Y + h - wt, s * 0.7, wt);
      x.fillStyle = "#a16207"; x.fillRect(dx, Y + h - wt * 0.6, s * 0.7, wt * 0.25);
      // окна
      x.fillStyle = "#93c5fd"; for (const fx of [0.2, 0.8]) if (w > s * 2.2) x.fillRect(X + w * fx - s * 0.2, Y, s * 0.4, wt * 0.45);
    }
    const put = (k, fx, fy, extra = {}) => drawObj(x, { k, x: o.x + o.w * fx, y: o.y + o.h * fy, ang: Rr() * 6, ...extra }, s, Rr);
    const bk = o.bk || "house";
    if (bk === "house") {
      drawObj(x, { k: "bed", x: o.x + 0.3, y: o.y + 0.3 }, s, Rr);
      if (o.w > 2.5) put("table", 0.62, 0.55);
      if (o.h > 2.5) put("chest", 0.2, 0.8);
      put("barrel", 0.85, 0.25);
    } else if (bk === "tavern") {
      drawObj(x, { k: "counter", x: o.x + o.w - 1.3, y: o.y + 0.3, w: 0.8, h: Math.max(1, o.h - 1.6), block: 1 }, s, Rr);
      for (let i = 0; i < Math.min(4, Math.floor((o.w - 1.8) / 1.6) * Math.floor((o.h - 0.8) / 1.6)); i++) {
        const cols = Math.max(1, Math.floor((o.w - 1.8) / 1.6));
        drawObj(x, { k: "rtable", x: o.x + 0.9 + (i % cols) * 1.6, y: o.y + 0.9 + Math.floor(i / cols) * 1.6, r: 0.4, seats: 3, ang: Rr() * 6 }, s, Rr);
      }
    } else if (bk === "inn") {
      const n = Math.max(2, Math.floor(o.w / 1.5));
      for (let i = 0; i < n; i++) drawObj(x, { k: "bed", x: o.x + 0.25 + i * (o.w - 0.5) / n, y: o.y + 0.3 }, s, Rr);
      x.strokeStyle = "#2a211a"; x.lineWidth = Math.max(2, s * 0.08);
      for (let i = 1; i < n; i++) { const lx = X + (0.25 + i * (o.w - 0.5) / n) * s - s * 0.12; x.beginPath(); x.moveTo(lx, Y); x.lineTo(lx, Y + s * 1.6); x.stroke(); }
      put("table_long", 0.2, 0.7, { w: Math.max(1.5, o.w * 0.5), h: 1 });
    } else if (bk === "shop") {
      for (let i = 0; i < Math.floor(o.w - 0.6); i++) { x.fillStyle = "#5b3f27"; x.fillRect(X + (0.3 + i) * s, Y + wt, s * 0.9, s * 0.35); x.fillStyle = ["#ef4444", "#22c55e", "#3b82f6", "#eab308"][i % 4]; x.fillRect(X + (0.4 + i) * s, Y + wt + s * 0.08, s * 0.25, s * 0.2); }
      drawObj(x, { k: "counter", x: o.x + 0.4, y: o.y + o.h * 0.55, w: Math.max(1, o.w - 0.8), h: 0.5 }, s, Rr);
      put("crate", 0.85, 0.85);
    } else if (bk === "smith") {
      x.fillStyle = "#44403c"; x.fillRect(X + wt, Y + wt, s * 1.1, s * 1.1);
      const gr = x.createRadialGradient(X + wt + s * 0.55, Y + wt + s * 0.55, 0, X + wt + s * 0.55, Y + wt + s * 0.55, s);
      gr.addColorStop(0, "rgba(255,120,30,.8)"); gr.addColorStop(1, "rgba(255,80,20,0)"); x.fillStyle = gr; x.beginPath(); x.arc(X + wt + s * 0.55, Y + wt + s * 0.55, s, 0, 7); x.fill();
      x.fillStyle = "#374151"; const ax = X + w * 0.6, ay = Y + h * 0.55;
      x.beginPath(); x.moveTo(ax - s * 0.4, ay - s * 0.12); x.lineTo(ax + s * 0.45, ay - s * 0.12); x.lineTo(ax + s * 0.2, ay + s * 0.05); x.lineTo(ax + s * 0.12, ay + s * 0.25); x.lineTo(ax - s * 0.12, ay + s * 0.25); x.lineTo(ax - s * 0.2, ay + s * 0.05); x.closePath(); x.fill();
      put("barrel", 0.85, 0.2);
    } else if (bk === "temple") {
      drawObj(x, { k: "altar", x: o.x + o.w / 2, y: o.y + 0.8 }, s, Rr);
      for (let yy = 1.8; yy < o.h - 0.6; yy += 1) for (const side of [0.12, 0.58]) { x.fillStyle = "#6b4426"; x.fillRect(X + o.w * side * s, Y + yy * s, o.w * 0.3 * s, s * 0.3); }
    }
  }
  function drawObj(x, o, s, R) {
    const X = o.x * s, Y = o.y * s;
    switch (o.k) {
      case "tree": {
        const r = o.r * s, hue = 85 + o.hue * 45;
        shadow(x, X, Y, r, r * 0.8);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + o.hue * 3, d = r * 0.45; x.fillStyle = `hsl(${hue},${35 + o.hue * 15}%,${24 + (i % 3) * 3}%)`; x.beginPath(); x.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d, r * 0.62, 0, 7); x.fill(); }
        x.fillStyle = `hsl(${hue},40%,34%)`; x.beginPath(); x.arc(X - r * 0.15, Y - r * 0.18, r * 0.55, 0, 7); x.fill();
        x.fillStyle = "rgba(255,255,220,.12)"; x.beginPath(); x.arc(X - r * 0.3, Y - r * 0.32, r * 0.3, 0, 7); x.fill();
        break;
      }
      case "pine": {
        const r = o.r * s;
        shadow(x, X, Y, r * 0.9, r * 0.7);
        for (let i = 0; i < 3; i++) {
          const rr = r * (1 - i * 0.28);
          x.fillStyle = o.snowy ? (i % 2 ? "#e9f0f4" : "#2f4d3c") : `hsl(${140 + (o.hue || 0) * 20},35%,${18 + i * 5}%)`;
          x.beginPath();
          for (let j = 0; j < 16; j++) { const a = (j / 16) * 6.28, rad = j % 2 ? rr * 0.7 : rr; x.lineTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad - i * r * 0.05); }
          x.closePath(); x.fill();
        }
        if (o.snowy) { x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(X - r * 0.15, Y - r * 0.15, r * 0.25, 0, 7); x.fill(); }
        break;
      }
      case "palm": {
        const r = o.r * s;
        shadow(x, X, Y, r * 0.8, r * 0.5);
        x.strokeStyle = "#3f7a32"; x.lineWidth = s / 9; x.lineCap = "round";
        for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + o.seed * 4; x.beginPath(); x.moveTo(X, Y); x.quadraticCurveTo(X + Math.cos(a) * r * 0.6, Y + Math.sin(a) * r * 0.6 - r * 0.2, X + Math.cos(a) * r, Y + Math.sin(a) * r); x.stroke(); }
        x.fillStyle = "#6a4a26"; x.beginPath(); x.arc(X, Y, s / 9, 0, 7); x.fill();
        x.lineCap = "butt";
        break;
      }
      case "deadtree": {
        x.strokeStyle = "#3b3125"; x.lineCap = "round";
        shadow(x, X, Y, s * 0.3, s * 0.2);
        const br = (bx, by, a, len, w, d) => { if (d > 3) return; const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len; x.lineWidth = w; x.beginPath(); x.moveTo(bx, by); x.lineTo(ex, ey); x.stroke(); br(ex, ey, a - 0.6, len * 0.65, w * 0.6, d + 1); br(ex, ey, a + 0.5, len * 0.6, w * 0.6, d + 1); };
        for (let i = 0; i < 3; i++) br(X, Y, o.seed * 6 + i * 2.1, s * 0.3, s / 10, 1);
        x.fillStyle = "#4a3d2e"; x.beginPath(); x.arc(X, Y, s / 8, 0, 7); x.fill();
        x.lineCap = "butt";
        break;
      }
      case "bush": {
        const r = o.r * s;
        for (let i = 0; i < 4; i++) { x.fillStyle = `hsl(95,35%,${22 + i * 3}%)`; x.beginPath(); x.arc(X + Math.cos(i * 1.7) * r * 0.4, Y + Math.sin(i * 1.7) * r * 0.4, r * 0.6, 0, 7); x.fill(); }
        break;
      }
      case "rock": {
        const r = o.r * s, Rr = rng(Math.floor(o.seed * 1e6));
        shadow(x, X, Y, r, r * 0.75);
        x.fillStyle = o.sand ? "#8a7356" : o.snowy ? "#77808a" : "#7d7a73";
        x.beginPath(); for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28, rad = r * (0.75 + Rr() * 0.35); x.lineTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad); } x.closePath(); x.fill();
        x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = Math.max(1, s / 40); x.stroke();
        x.fillStyle = o.snowy ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.18)"; x.beginPath(); x.arc(X - r * 0.25, Y - r * 0.25, r * 0.38, 0, 7); x.fill();
        break;
      }
      case "pebbles": {
        const Rr = rng(Math.floor(o.seed * 1e6));
        for (let i = 0; i < 5; i++) { x.fillStyle = `rgba(${Rr() < 0.5 ? "40,35,30" : "150,140,125"},.7)`; x.beginPath(); x.ellipse(X + (Rr() - 0.5) * s * 0.8, Y + (Rr() - 0.5) * s * 0.8, s * (0.05 + Rr() * 0.09), s * (0.04 + Rr() * 0.06), Rr() * 3, 0, 7); x.fill(); }
        break;
      }
      case "log": {
        x.save(); x.translate(X, Y); x.rotate(o.ang);
        shadow(x, 0, 0, o.len * s / 2, s * 0.15);
        x.fillStyle = "#5a4128"; x.fillRect(-o.len * s / 2, -s * 0.13, o.len * s, s * 0.26);
        x.fillStyle = "#8d6a43"; x.beginPath(); x.ellipse(o.len * s / 2, 0, s * 0.06, s * 0.13, 0, 0, 7); x.fill();
        x.restore();
        break;
      }
      case "flower": { x.fillStyle = `hsl(${o.hue * 360},70%,70%)`; x.beginPath(); x.arc(X, Y, s / 22, 0, 7); x.fill(); break; }
      case "lily": { x.fillStyle = "#4f8a3f"; x.beginPath(); x.arc(X, Y, o.r * s, 0.3, 6.1); x.lineTo(X, Y); x.fill(); break; }
      case "reeds": {
        const Rr = rng(Math.floor(o.seed * 1e6));
        x.strokeStyle = "#7d8a4a"; x.lineWidth = Math.max(1, s / 35);
        for (let i = 0; i < 6; i++) { const bx = X + (Rr() - 0.5) * s * 0.4; x.beginPath(); x.moveTo(bx, Y + s * 0.15); x.lineTo(bx + (Rr() - 0.5) * s * 0.2, Y - s * 0.25); x.stroke(); }
        x.fillStyle = "#5b3d22"; x.beginPath(); x.ellipse(X, Y - s * 0.2, s * 0.03, s * 0.08, 0, 0, 7); x.fill();
        break;
      }
      case "cactus": {
        shadow(x, X, Y, s * 0.25, s * 0.15);
        x.fillStyle = "#4b7a3a"; x.strokeStyle = "#2f5426"; x.lineWidth = Math.max(1, s / 40);
        x.beginPath(); x.arc(X, Y, s * 0.2, 0, 7); x.fill(); x.stroke();
        for (const a of [o.seed * 6, o.seed * 6 + 2.5]) { x.beginPath(); x.arc(X + Math.cos(a) * s * 0.25, Y + Math.sin(a) * s * 0.25, s * 0.1, 0, 7); x.fill(); x.stroke(); }
        break;
      }
      case "stalag": {
        const r = o.r * s;
        const gr = x.createRadialGradient(X - r * 0.3, Y - r * 0.3, 0, X, Y, r);
        gr.addColorStop(0, "#a49a8c"); gr.addColorStop(1, "#4a443d");
        x.fillStyle = gr; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill();
        break;
      }
      case "shroom": {
        x.fillStyle = `hsla(${180 + o.hue * 120},80%,65%,.25)`; x.beginPath(); x.arc(X, Y, s * 0.22, 0, 7); x.fill();
        x.fillStyle = `hsl(${180 + o.hue * 120},70%,60%)`; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(X + (i - 1) * s * 0.08, Y + (i % 2) * s * 0.06, s * 0.05, 0, 7); x.fill(); }
        break;
      }
      case "bones": {
        x.save(); x.translate(X, Y); x.rotate(o.ang); x.strokeStyle = "#ddd5c0"; x.lineWidth = s / 22; x.lineCap = "round";
        x.beginPath(); x.moveTo(-s * 0.25, 0); x.lineTo(s * 0.25, 0); x.moveTo(-s * 0.1, -s * 0.15); x.lineTo(s * 0.05, s * 0.18); x.stroke();
        x.fillStyle = "#e5dcc6"; x.beginPath(); x.arc(s * 0.3, -s * 0.12, s * 0.09, 0, 7); x.fill();
        x.restore(); x.lineCap = "butt";
        break;
      }
      case "door": {
        const cx = o.x * s, cy = o.y * s;
        x.fillStyle = "#6e4b2a"; x.strokeStyle = "#2b1c0f"; x.lineWidth = Math.max(1, s / 30);
        if (o.vert) { x.fillRect(cx + s * 0.3, cy, s * 0.4, s); x.strokeRect(cx + s * 0.3, cy, s * 0.4, s); }
        else { x.fillRect(cx, cy + s * 0.3, s, s * 0.4); x.strokeRect(cx, cy + s * 0.3, s, s * 0.4); }
        break;
      }
      case "pillar": {
        shadow(x, X, Y, s * 0.35, s * 0.3);
        x.fillStyle = o.sand ? "#c7b38a" : "#8d877d"; x.strokeStyle = "rgba(0,0,0,.4)"; x.lineWidth = Math.max(1, s / 35);
        x.beginPath(); x.arc(X, Y, s * 0.33, 0, 7); x.fill(); x.stroke();
        x.fillStyle = "rgba(255,255,255,.2)"; x.beginPath(); x.arc(X - s * 0.08, Y - s * 0.08, s * 0.15, 0, 7); x.fill();
        if (o.broken) { x.fillStyle = o.sand ? "#b9a27a" : "#7d776d"; x.beginPath(); x.ellipse(X + s * 0.6, Y + s * 0.15, s * 0.45, s * 0.18, 0.3, 0, 7); x.fill(); }
        break;
      }
      case "ruin": {
        x.save(); x.translate(X, Y); x.rotate(o.ang);
        x.fillStyle = o.sand ? "#b8a47e" : "#8a857a"; x.fillRect(-o.len * s / 2, -s * 0.12, o.len * s, s * 0.24);
        x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 1; x.strokeRect(-o.len * s / 2, -s * 0.12, o.len * s, s * 0.24);
        x.restore();
        break;
      }
      case "crate": case "chest": {
        x.save(); x.translate(X, Y); x.rotate(o.k === "crate" ? o.ang : 0);
        const w = o.k === "chest" ? s * 0.55 : s * 0.5, h = o.k === "chest" ? s * 0.38 : s * 0.5;
        shadow(x, 0, 0, w * 0.6, h * 0.6);
        x.fillStyle = o.k === "chest" ? "#7a4d22" : "#9a7746"; x.fillRect(-w / 2, -h / 2, w, h);
        x.strokeStyle = o.k === "chest" ? "#d4a640" : "#5a4122"; x.lineWidth = Math.max(1, s / 28); x.strokeRect(-w / 2, -h / 2, w, h);
        x.beginPath(); if (o.k === "crate") { x.moveTo(-w / 2, -h / 2); x.lineTo(w / 2, h / 2); } else { x.moveTo(-w / 2, 0); x.lineTo(w / 2, 0); } x.stroke();
        x.restore();
        break;
      }
      case "barrel": {
        shadow(x, X, Y, s * 0.25, s * 0.22);
        x.fillStyle = "#7e5a35"; x.beginPath(); x.arc(X, Y, s * 0.24, 0, 7); x.fill();
        x.strokeStyle = "#3d2a17"; x.lineWidth = Math.max(1, s / 30); x.stroke(); x.beginPath(); x.arc(X, Y, s * 0.15, 0, 7); x.stroke();
        break;
      }
      case "table": case "altar": {
        shadow(x, X, Y, s * 0.45, s * 0.3);
        x.fillStyle = o.k === "altar" ? "#6f6a72" : "#7a5634"; x.fillRect(X - s * 0.42, Y - s * 0.28, s * 0.84, s * 0.56);
        x.strokeStyle = "rgba(0,0,0,.45)"; x.lineWidth = Math.max(1, s / 35); x.strokeRect(X - s * 0.42, Y - s * 0.28, s * 0.84, s * 0.56);
        if (o.k === "altar") { x.fillStyle = "#e0c060"; x.beginPath(); x.arc(X, Y, s * 0.07, 0, 7); x.fill(); }
        break;
      }
      case "torch": {
        const gr = x.createRadialGradient(X, Y, 0, X, Y, s * 1.8);
        gr.addColorStop(0, "rgba(255,190,90,.35)"); gr.addColorStop(1, "rgba(255,160,60,0)");
        x.fillStyle = gr; x.beginPath(); x.arc(X, Y, s * 1.8, 0, 7); x.fill();
        x.fillStyle = "#ffcf6a"; x.beginPath(); x.arc(X, Y, s * 0.08, 0, 7); x.fill();
        break;
      }
      case "house": {
        if (g_cur && g_cur.opts && g_cur.opts.roofs === false) { drawInterior(x, o, s, R); break; }
        const w = o.w * s, h = o.h * s;
        x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(X + s * 0.12, Y + s * 0.15, w, h);
        const hue = o.thatch ? 38 + o.hue * 10 : [8, 18, 210, 25][Math.floor(o.hue * 4)];
        const sat = o.thatch ? 45 : hue === 210 ? 12 : 45, lit = o.thatch ? 48 : 34;
        const horiz = w >= h;
        // два ската крыши
        x.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
        if (horiz) { x.fillRect(X, Y, w, h / 2); x.fillStyle = `hsl(${hue},${sat}%,${lit - 9}%)`; x.fillRect(X, Y + h / 2, w, h / 2); }
        else { x.fillRect(X, Y, w / 2, h); x.fillStyle = `hsl(${hue},${sat}%,${lit - 9}%)`; x.fillRect(X + w / 2, Y, w / 2, h); }
        x.strokeStyle = `hsla(${hue},${sat}%,${lit - 22}%,.6)`; x.lineWidth = Math.max(1, s / 35);
        const step = s / (o.thatch ? 7 : 4);
        if (horiz) for (let i = step; i < w; i += step) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i, Y + h); x.stroke(); }
        else for (let i = step; i < h; i += step) { x.beginPath(); x.moveTo(X, Y + i); x.lineTo(X + w, Y + i); x.stroke(); }
        x.strokeStyle = `hsl(${hue},${sat}%,${lit - 28}%)`; x.lineWidth = Math.max(2, s / 14);
        x.beginPath(); if (horiz) { x.moveTo(X, Y + h / 2); x.lineTo(X + w, Y + h / 2); } else { x.moveTo(X + w / 2, Y); x.lineTo(X + w / 2, Y + h); } x.stroke();
        x.lineWidth = Math.max(1, s / 25); x.strokeStyle = "rgba(0,0,0,.55)"; x.strokeRect(X, Y, w, h);
        if (R() < 0.5) { x.fillStyle = "#5a4a3e"; x.fillRect(X + w * (0.2 + R() * 0.5), Y + h * (horiz ? 0.12 : 0.3), s * 0.22, s * 0.22); }  // труба
        if (o.bk && o.bk !== "house") sign(x, X + w / 2, Y + h - s * 0.05, s, o.bk);
        break;
      }
      case "fence": {
        x.strokeStyle = "#6b5233"; x.lineWidth = Math.max(1.5, s / 20);
        x.setLineDash([s * 0.35, s * 0.12]); x.strokeRect(o.x * s + 2, o.y * s + 2, o.w * s - 4, o.h * s - 4); x.setLineDash([]);
        break;
      }
      case "well": case "fountain": {
        const r = o.k === "fountain" ? s * 0.9 : s * 0.4;
        const cx = o.k === "fountain" ? X : X, cy = Y;
        shadow(x, cx, cy, r, r * 0.8);
        x.fillStyle = "#8f8a82"; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
        x.fillStyle = o.k === "fountain" ? "#4d88aa" : "#1b2b36"; x.beginPath(); x.arc(cx, cy, r * 0.72, 0, 7); x.fill();
        if (o.k === "fountain") { x.fillStyle = "#a9a49b"; x.beginPath(); x.arc(cx, cy, r * 0.2, 0, 7); x.fill(); x.strokeStyle = "rgba(255,255,255,.4)"; x.beginPath(); x.arc(cx, cy, r * 0.45, 0, 7); x.stroke(); }
        break;
      }
      case "stall": {
        const cx = o.x * s, cy = o.y * s;
        x.fillStyle = "rgba(0,0,0,.3)"; x.fillRect(cx + s * 0.1, cy + s * 0.12, s * 0.95, s * 0.9);
        const hue = Math.floor(o.hue * 360);
        for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? `hsl(${hue},55%,45%)` : "#e8dfcc"; x.fillRect(cx + i * s / 4, cy, s / 4, s * 0.85); }
        x.strokeStyle = "rgba(0,0,0,.4)"; x.lineWidth = 1; x.strokeRect(cx, cy, s, s * 0.85);
        break;
      }
      case "hay": {
        shadow(x, X, Y, s * 0.35, s * 0.3);
        x.fillStyle = "#c9a54a"; x.beginPath(); x.arc(X, Y, s * 0.33, 0, 7); x.fill();
        x.strokeStyle = "rgba(120,90,30,.6)"; x.lineWidth = 1; for (let r = s * 0.1; r < s * 0.33; r += s * 0.08) { x.beginPath(); x.arc(X, Y, r, 0, 7); x.stroke(); }
        break;
      }
      case "bed": {
        x.fillStyle = "rgba(0,0,0,.3)"; x.fillRect(X + s * 0.06, Y + s * 0.06, s * 0.7, s * 1.2);
        x.fillStyle = "#6b4426"; x.fillRect(X, Y, s * 0.7, s * 1.2);
        x.fillStyle = "#d6d3d1"; x.fillRect(X + s * 0.06, Y + s * 0.06, s * 0.58, s * 1.08);
        x.fillStyle = "#9f1239"; x.fillRect(X + s * 0.06, Y + s * 0.45, s * 0.58, s * 0.69);
        x.fillStyle = "#f5f5f4"; x.fillRect(X + s * 0.12, Y + s * 0.1, s * 0.46, s * 0.25);
        break;
      }
      case "grate": {
        const r = s * (o.big ? 0.42 : 0.28);
        x.fillStyle = "#1c1f22"; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill();
        x.strokeStyle = "#6b7280"; x.lineWidth = Math.max(1.5, s / 24); x.stroke();
        x.save(); x.beginPath(); x.arc(X, Y, r, 0, 7); x.clip();
        for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(X + i * r / 3.5, Y - r); x.lineTo(X + i * r / 3.5, Y + r); x.stroke(); }
        x.restore();
        break;
      }
      case "pipe": {
        x.fillStyle = "#57534e"; x.beginPath(); x.ellipse(X, Y, s * 0.45, s * 0.3, 0, 0, 7); x.fill();
        x.fillStyle = "#1c1917"; x.beginPath(); x.ellipse(X, Y, s * 0.32, s * 0.2, 0, 0, 7); x.fill();
        x.fillStyle = "rgba(90,120,70,.6)"; x.beginPath(); x.ellipse(X, Y + s * 0.45, s * 0.18, s * 0.35, 0, 0, 7); x.fill();
        break;
      }
      case "cart": {
        x.save(); x.translate(X, Y); x.rotate(o.ang);
        shadow(x, 0, 0, s * 0.5, s * 0.35);
        x.fillStyle = "#8a6239"; x.fillRect(-s * 0.45, -s * 0.28, s * 0.9, s * 0.56);
        x.strokeStyle = "#4a321b"; x.lineWidth = Math.max(1, s / 30); x.strokeRect(-s * 0.45, -s * 0.28, s * 0.9, s * 0.56);
        x.fillStyle = "#2b2118"; for (const sx of [-0.3, 0.3]) for (const sy of [-0.34, 0.34]) { x.fillRect(sx * s - s * 0.08, sy * s - s * 0.04, s * 0.16, s * 0.08); }
        x.strokeStyle = "#6b4a2a"; x.beginPath(); x.moveTo(s * 0.45, -s * 0.12); x.lineTo(s * 0.8, -s * 0.05); x.moveTo(s * 0.45, s * 0.12); x.lineTo(s * 0.8, s * 0.05); x.stroke();
        x.fillStyle = ["#c2a35a", "#7c9a3f", "#b45f3a"][Math.floor(Math.abs(o.ang * 10)) % 3]; x.beginPath(); x.ellipse(0, 0, s * 0.3, s * 0.18, 0, 0, 7); x.fill();
        x.restore();
        break;
      }
      case "wall": { x.fillStyle = "#2a211a"; x.fillRect(X, Y, Math.max(o.w * s, s * 0.15), Math.max(o.h * s, s * 0.15)); break; }
      case "counter": {
        x.fillStyle = "rgba(0,0,0,.3)"; x.fillRect(X + s * 0.08, Y + s * 0.08, o.w * s, o.h * s);
        x.fillStyle = "#6b4426"; x.fillRect(X, Y, o.w * s, o.h * s);
        x.fillStyle = "#8a5a33"; x.fillRect(X + s * 0.1, Y + s * 0.05, o.w * s - s * 0.2, o.h * s - s * 0.1);
        for (let i = 0; i < o.h; i += 1.4) { x.fillStyle = "#d9b26a"; x.beginPath(); x.arc(X + o.w * s / 2, Y + (i + 0.6) * s, s * 0.09, 0, 7); x.fill(); }
        break;
      }
      case "barrels": { for (let i = 0; i < o.n; i++) drawObj(x, { k: "barrel", x: o.x, y: o.y + i * 0.6 }, s, R); break; }
      case "hearth": {
        x.fillStyle = "#57534e"; x.fillRect(X, Y, o.w * s, o.h * s);
        const gr = x.createRadialGradient(X + o.w * s, Y + o.h * s / 2, 0, X + o.w * s, Y + o.h * s / 2, s * 2.2);
        gr.addColorStop(0, "rgba(255,170,70,.55)"); gr.addColorStop(1, "rgba(255,120,40,0)");
        x.fillStyle = gr; x.beginPath(); x.arc(X + o.w * s, Y + o.h * s / 2, s * 2.2, 0, 7); x.fill();
        x.fillStyle = "#f97316"; x.beginPath(); x.ellipse(X + o.w * s * 0.6, Y + o.h * s / 2, s * 0.18, s * 0.4, 0, 0, 7); x.fill();
        x.fillStyle = "#fde68a"; x.beginPath(); x.ellipse(X + o.w * s * 0.62, Y + o.h * s / 2, s * 0.08, s * 0.2, 0, 0, 7); x.fill();
        break;
      }
      case "stairs": {
        x.fillStyle = "#5b3f27"; x.fillRect(X, Y, o.w * s, o.h * s);
        x.strokeStyle = "#2e1f12"; x.lineWidth = Math.max(1, s / 25);
        for (let i = 1; i < o.h * 3; i++) { x.beginPath(); x.moveTo(X, Y + i * s / 3); x.lineTo(X + o.w * s, Y + i * s / 3); x.stroke(); }
        x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(X, Y, o.w * s, s * 0.6);
        break;
      }
      case "stove": {
        x.fillStyle = "#44403c"; x.fillRect(X, Y, o.w * s, o.h * s);
        for (let i = 0; i < 2; i++) { x.fillStyle = "#1c1917"; x.beginPath(); x.arc(X + (i + 0.5) * o.w * s / 2, Y + o.h * s / 2, s * 0.25, 0, 7); x.fill(); x.fillStyle = "rgba(249,115,22,.6)"; x.beginPath(); x.arc(X + (i + 0.5) * o.w * s / 2, Y + o.h * s / 2, s * 0.12, 0, 7); x.fill(); }
        break;
      }
      case "table_long": {
        x.fillStyle = "rgba(0,0,0,.3)"; x.fillRect(X + s * 0.08, Y + s * 0.1, o.w * s, o.h * s * 0.7);
        x.fillStyle = "#7a5634"; x.fillRect(X, Y, o.w * s, o.h * s * 0.7);
        x.strokeStyle = "rgba(0,0,0,.4)"; x.lineWidth = 1; x.strokeRect(X, Y, o.w * s, o.h * s * 0.7);
        break;
      }
      case "rtable": {
        const r = o.r * s;
        for (let i = 0; i < o.seats; i++) { const a = o.ang + (i / o.seats) * 6.28; x.fillStyle = "#5b3f27"; x.beginPath(); x.arc(X + Math.cos(a) * r * 1.45, Y + Math.sin(a) * r * 1.45, s * 0.17, 0, 7); x.fill(); }
        shadow(x, X, Y, r, r * 0.8);
        x.fillStyle = "#8a5f37"; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill();
        x.strokeStyle = "#4a321b"; x.lineWidth = Math.max(1, s / 30); x.stroke();
        x.fillStyle = "#e5e7eb"; x.beginPath(); x.arc(X + r * 0.3, Y - r * 0.2, s * 0.07, 0, 7); x.fill();
        x.fillStyle = "#d97706"; x.beginPath(); x.arc(X - r * 0.25, Y + r * 0.25, s * 0.06, 0, 7); x.fill();
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- окно генератора
  const ICONS = { forest: "trees", cave: "mountain", dungeon: "lock", city: "city", village: "tent", plains: "sun", swamp: "droplet", desert: "flask", winter: "snowflake", market: "coins", tavern: "players", sewer: "waves" };
  G.open = async () => {
    let type = MC.store.get("mapgen_type") || "forest", seed = Math.floor(Math.random() * 1e6);
    let cols = MC.int(MC.store.get("mapgen_cols"), 30), rows = MC.int(MC.store.get("mapgen_rows"), 20);
    let g = null;
    const opts = { plaza: MC.store.get("mapgen_plaza") || "random", roofs: MC.store.get("mapgen_roofs") !== "0" };
    const optsHtml = () => (["city", "village", "market"].includes(type) ? `<div class="mg-opts">
        ${type === "city" ? `<label class="field"><span>${t("mg.plaza")}</span><select id="mg-plaza">${["random", "none", "fountain", "market"].map((k) => `<option value="${k}" ${opts.plaza === k ? "selected" : ""}>${t("mg.plaza." + k)}</option>`).join("")}</select></label>` : ""}
        <label class="check"><input type="checkbox" id="mg-roofs" ${opts.roofs ? "checked" : ""}> ${t("mg.roofs")}</label></div>` : "");
    const prev = document.createElement("canvas");
    const redraw = (m) => {
      const oh = m.querySelector("#mg-opts-host");
      if (oh && oh.dataset.type !== type) { oh.innerHTML = optsHtml(); oh.dataset.type = type; }
      g = G.generate(type, cols, rows, seed, opts);
      const s = Math.max(6, Math.floor(Math.min(560 / cols, 360 / rows)));
      G.render(g, s, prev);
      prev.className = "mg-prev";
      const host = m.querySelector("#mg-prev");
      if (!host.contains(prev)) host.appendChild(prev);
      m.querySelector("#mg-seed").value = seed;
      const nd = g.diff.reduce((a, b) => a + b, 0);
      m.querySelector("#mg-info").textContent = t("mg.info", { w: cols * 5, h: rows * 5, n: Math.round((nd / g.diff.length) * 100) });
    };
    const v = await MC.modal({ title: t("mg.title"), wide: true,
      body: `<div class="chips mg-types">${G.TYPES.map((k) => `<button class="chip ${k === type ? "on" : ""}" data-mgt="${k}">${MC.icon(ICONS[k] || "map", "sm")} ${t("mg.t." + k)}</button>`).join("")}</div>
        <div id="mg-prev" class="mg-prev-host"></div>
        <p class="muted small" id="mg-info"></p>
        <div class="form-grid">
          <label class="field"><span>${t("map.blank.cols")}</span><input id="mg-cols" type="number" min="12" max="50" value="${cols}"></label>
          <label class="field"><span>${t("map.blank.rows")}</span><input id="mg-rows" type="number" min="10" max="40" value="${rows}"></label>
          <label class="field"><span>${t("mg.seed")}</span><input id="mg-seed" type="number" min="0" value="${seed}"></label>
          <label class="field"><span>${t("map.name")}</span><input id="mg-name" value=""></label>
        </div>
        <div id="mg-opts-host"></div>
        <label class="check"><input type="checkbox" id="mg-terr" checked> ${t("mg.terr")}</label>
        <div class="row-btns"><button class="btn" id="mg-again">${MC.icon("refresh", "sm")} ${t("mg.again")}</button></div>`,
      buttons: [{ label: t("cancel"), value: null }, { label: t("mg.create"), kind: "primary", value: (w) => ({ name: w.querySelector("#mg-name").value.trim(), terr: w.querySelector("#mg-terr").checked }) }],
      mount: (m) => {
        const setName = () => { m.querySelector("#mg-name").value = `${t("mg.t." + type)} #${seed}`; };
        setName();
        setTimeout(() => redraw(m), 30);
        m.addEventListener("click", (e) => {
          const b = e.target.closest("[data-mgt]");
          if (b) { type = b.dataset.mgt; MC.store.set("mapgen_type", type); m.querySelectorAll("[data-mgt]").forEach((x) => x.classList.toggle("on", x === b)); setName(); redraw(m); }
          if (e.target.closest("#mg-again")) { seed = Math.floor(Math.random() * 1e6); setName(); redraw(m); }
        });
        m.addEventListener("change", (e) => {
          if (e.target.id === "mg-cols") { cols = MC.clamp(MC.int(e.target.value, 30), 12, 50); MC.store.set("mapgen_cols", cols); redraw(m); }
          if (e.target.id === "mg-rows") { rows = MC.clamp(MC.int(e.target.value, 20), 10, 40); MC.store.set("mapgen_rows", rows); redraw(m); }
          if (e.target.id === "mg-seed") { seed = Math.max(0, MC.int(e.target.value, 0)); setName(); redraw(m); }
          if (e.target.id === "mg-plaza") { opts.plaza = e.target.value; MC.store.set("mapgen_plaza", opts.plaza); redraw(m); }
          if (e.target.id === "mg-roofs") { opts.roofs = e.target.checked; MC.store.set("mapgen_roofs", opts.roofs ? "1" : "0"); redraw(m); }
        });
      } });
    if (!v || !g) return;
    await G.create(g, v.name || `${t("mg.t." + type)} #${seed}`, v.terr);
  };

  /** Нарисовать в полном размере, загрузить и создать карту. */
  G.create = async (g, name, withTerr = true) => {
    MC.toast(t("mg.making"), "", "map");
    const c = document.createElement("canvas");
    G.render(g, CELL, c);
    const blob = await new Promise((ok) => c.toBlob((b) => ok(b), "image/webp", 0.88)) || await new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.9));
    let up;
    try { up = await MC.Map.uploadImage(new File([blob], "map.webp", { type: blob.type }), 4096, true); }
    catch { MC.toast(t("map.upload_failed"), "bad"); return null; }
    const k = up.w / c.width;          // если картинку ужали — сетку тоже
    const r = await MC.Map.createMap({ name, img: up.id, img_s: up.thumb, iw: up.w, ih: up.h, grid: { on: true, size: CELL * k, alpha: 0.18 } });
    const mid = r?.map?.id;
    if (mid && withTerr) { const zs = G.zones(g, CELL * k); if (zs.length) MC.send({ t: "terr_add", map: mid, zones: zs }); }
    if (mid) MC.toast(t("mg.done"), "ok", "map");
    return mid;
  };
})();
