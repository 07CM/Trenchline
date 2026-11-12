// ============ WORLD: map generation, collision, raycasts, flowfields, terrain art ============
import { G, TILE, COLS, ROWS, WW, WH, T, ALLY, AXIS, clamp, rand, randi, pick } from './core.js';

export const grid = new Uint8Array(COLS * ROWS);
export const wallKind = new Uint8Array(COLS * ROWS); // 0 concrete, 1 brick
export const tankOK = new Uint8Array(COLS * ROWS);
export const idx = (x, y) => y * COLS + x;
export const inb = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
export const tileAtPx = (px, py) => { const x = Math.floor(px / TILE), y = Math.floor(py / TILE); return inb(x, y) ? grid[idx(x, y)] : T.WALL; };

export const LINES = [];      // trench lines {x, team, tx:[] per row}
export const OBJ_DEF = [];    // objective definitions
export const craters = [];
export const perches = [];    // per objective: sniper perches [ [ {x,y} ], ... ]
export const nests = [];      // per objective: MG nests
export const decor = [];      // trees/stumps/crosses

export const solidSoldier = (t) => t === T.SANDBAG || t === T.WALL || t === T.SLIT;
export const solidTank = (t) => t === T.WALL || t === T.SLIT;
export const blocksSight = (t) => t === T.WALL;

let noise2D = (x, y) => Math.sin(x * 1.7 + y * 2.3) * Math.cos(x * 0.7 - y * 1.1);
export function setNoise(fn) { noise2D = fn; }
const fbm = (x, y) => noise2D(x, y) * 0.6 + noise2D(x * 2.1, y * 2.1) * 0.28 + noise2D(x * 4.3, y * 4.3) * 0.12;

const set = (x, y, t) => { if (inb(x, y)) grid[idx(x, y)] = t; };
const get = (x, y) => (inb(x, y) ? grid[idx(x, y)] : T.WALL);

// ---------------- GENERATION ----------------
export function generate() {
  grid.fill(T.GROUND); wallKind.fill(0);
  LINES.length = 0; OBJ_DEF.length = 0; craters.length = 0; perches.length = 0; nests.length = 0; decor.length = 0;
  // mud patches
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (fbm(x * 0.06, y * 0.06) > 0.32) set(x, y, T.MUD);
  // craters in no man's land
  for (let i = 0; i < 300; i++) {
    const cx = rand(14, COLS - 6), cy = rand(2, ROWS - 2), r = rand(0.9, 2.6);
    craters.push({ x: cx * TILE, y: cy * TILE, r: r * TILE, water: Math.random() < 0.25 });
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < (r * 0.7) ** 2) set(x, y, T.CRATER);
    }
  }
  const lineX = [8, 38, 68, 98, 127, 157];
  const objY = [28, 15, 40, 22, 28];
  lineX.forEach((lx, i) => {
    const team = i === 0 ? ALLY : AXIS;
    const tx = [];
    for (let y = 0; y < ROWS; y++) tx[y] = lx + Math.round(noise2D(lx * 0.37, y * 0.11) * 2) + (Math.floor((y + lx) / 6) % 2 ? 1 : 0);
    LINES.push({ x: lx, team, tx });
  });
  // ruins (before trenches so trenches carve through)
  for (let i = 0; i < 26; i++) {
    let x0 = randi(14, COLS - 10), y0 = randi(3, ROWS - 6);
    if (LINES.some((l) => Math.abs(l.x - x0) < 7)) continue;
    const kind = randi(0, 3);
    const k = 1;
    const put = (x, y) => { if (get(x, y) !== T.WALL || true) { set(x, y, T.WALL); wallKind[idx(x, y)] = k; } };
    if (kind === 0) { const len = randi(3, 6); for (let j = 0; j < len; j++) put(x0 + j, y0); for (let j = 1; j < randi(2, 4); j++) put(x0, y0 + j); }
    else if (kind === 1) { const len = randi(3, 6); for (let j = 0; j < len; j++) put(x0, y0 + j); }
    else if (kind === 2) { // broken house
      const w = randi(4, 6), h = randi(4, 5);
      for (let x = 0; x < w; x++) { if (Math.random() < 0.75) put(x0 + x, y0); if (Math.random() < 0.6) put(x0 + x, y0 + h); }
      for (let y = 0; y <= h; y++) { if (Math.random() < 0.7) put(x0, y0 + y); if (Math.random() < 0.5) put(x0 + w, y0 + y); }
      for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) set(x0 + x, y0 + y, T.FLOOR);
    } else { for (let j = 0; j < 3; j++) put(x0 + j, y0 + j); }
  }
  // trench lines
  LINES.forEach((L, i) => {
    const front = L.team === ALLY ? 1 : -1;
    for (let y = 1; y < ROWS - 1; y++) {
      const cx = L.tx[y];
      for (let d = -1; d <= 1; d++) set(cx + d, y, T.TRENCH);
      // clear ruins near trench
      for (let d = -4; d <= 4; d++) if (Math.abs(d) > 1 && get(cx + d, y) === T.WALL) set(cx + d, y, T.GROUND);
      const gap = (y + i * 3) % 9 < 2;
      if (!gap) set(cx + 2 * front, y, T.SANDBAG);
      else set(cx + 2 * front, y, T.TRENCH);
      // rear lip
      if (get(cx - 2 * front, y) === T.WALL) set(cx - 2 * front, y, T.GROUND);
      if (L.team === AXIS) {
        const wireGap = (y + i * 5) % 12 < 3;
        if (!wireGap) for (const wx of [cx - 6, cx - 5]) { const t = get(wx, y); if (t === T.GROUND || t === T.MUD || t === T.CRATER) set(wx, y, T.WIRE); }
      } else {
        const wireGap = (y + 2) % 10 < 3;
        if (!wireGap) for (const wx of [cx + 6]) { const t = get(wx, y); if (t === T.GROUND || t === T.MUD || t === T.CRATER) set(wx, y, T.WIRE); }
      }
    }
  });
  // communication trenches linking lines
  for (let i = 1; i < LINES.length - 1; i++) {
    const rows = [randi(6, 18), randi(34, 48)];
    for (const ry of rows) {
      const x0 = LINES[i].tx[ry] + 2, x1 = LINES[i + 1].tx[ry] - 2;
      let y = ry;
      for (let x = x0; x <= x1; x++) {
        if (x % 7 === 0) y = clamp(y + randi(-1, 1), 3, ROWS - 4);
        set(x, y, T.TRENCH); set(x, y + 1, T.TRENCH);
        if (get(x, y - 1) === T.WALL) set(x, y - 1, T.GROUND);
        if (get(x, y + 2) === T.WALL) set(x, y + 2, T.GROUND);
      }
    }
  }
  // bunkers + objectives
  for (let i = 0; i < 5; i++) {
    const L = LINES[i + 1];
    const oy = objY[i];
    const ox = L.tx[oy];
    const isHQ = i === 4;
    // bunker
    const by = isHQ ? oy : (oy > ROWS / 2 ? oy - 8 : oy + 8);
    const w = isHQ ? 8 : 6, h = isHQ ? 8 : 5;
    const top = by - Math.floor(h / 2);
    let maxTx = -1; for (let y = top; y <= top + h; y++) maxTx = Math.max(maxTx, L.tx[clamp(y, 0, ROWS - 1)]);
    const bx = isHQ ? L.tx[by] - 3 : maxTx + 3;
    for (let y = top; y <= top + h; y++) for (let x = bx; x <= bx + w; x++) {
      const edge = y === top || y === top + h || x === bx || x === bx + w;
      set(x, y, edge ? T.WALL : T.FLOOR); wallKind[idx(x, y)] = 0;
    }
    const midY = top + Math.floor(h / 2);
    // firing slits (west)
    for (let y = top + 1; y < top + h; y++) if ((y - top) % 2 === 1) set(bx, y, T.SLIT);
    // doors
    if (isHQ) {
      set(bx, midY, T.FLOOR); set(bx, midY + 1, T.FLOOR); set(bx - 1, midY, T.TRENCH); set(bx - 1, midY + 1, T.TRENCH);
      set(bx + w, midY, T.FLOOR); set(bx + w, midY - 1, T.FLOOR);
      set(bx + 3, top, T.FLOOR); set(bx + 4, top, T.FLOOR); set(bx + 3, top + h, T.FLOOR); set(bx + 4, top + h, T.FLOOR);
    } else {
      set(bx + w, midY, T.FLOOR); set(bx + w, midY + 1, T.FLOOR);
      set(bx + 2, top, T.FLOOR); set(bx + 3, top, T.FLOOR);
      for (let x = bx + w + 1; x <= bx + w + 2; x++) { set(x, midY, T.TRENCH); set(x, midY + 1, T.TRENCH); }
    }
    nests.push([{ x: (bx + 1.5) * TILE, y: (top + 1.5 + (h > 5 ? 2 : 1)) * TILE, a: Math.PI }]);
    const cx = isHQ ? (bx + w / 2 + 0.5) * TILE : (ox + 0.5) * TILE;
    const cy = (oy + 0.5) * TILE;
    // clear objective center
    for (let y = oy - 1; y <= oy + 1; y++) for (let x = Math.floor(cx / TILE) - 1; x <= Math.floor(cx / TILE) + 1; x++) {
      if (get(x, y) === T.WALL || get(x, y) === T.SANDBAG || get(x, y) === T.SLIT) set(x, y, isHQ ? T.FLOOR : T.TRENCH);
    }
    OBJ_DEF.push({ name: 'ABCDE'[i], x: cx, y: cy, r: isHQ ? 150 : 125, line: i + 1 });
  }
  // sniper perches: trench tiles of each line & next line far from objective center
  for (let i = 0; i < 5; i++) {
    const list = [];
    for (const li of [i + 1, Math.min(i + 2, 5)]) {
      const L = LINES[li];
      for (let k = 0; k < 6; k++) {
        const y = randi(3, ROWS - 4); const x = L.tx[y];
        if (get(x, y) === T.TRENCH) list.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
      }
    }
    perches.push(list);
  }
  // decor
  for (let i = 0; i < 70; i++) {
    const x = rand(2, COLS - 2) * TILE, y = rand(2, ROWS - 2) * TILE;
    const t = tileAtPx(x, y);
    if (t === T.GROUND || t === T.MUD) decor.push({ x, y, type: Math.random() < 0.6 ? 'stump' : (x < 400 ? 'crate' : 'cross'), a: rand(Math.PI * 2), s: rand(0.7, 1.3) });
  }
  // borders
  for (let x = 0; x < COLS; x++) { set(x, 0, T.WALL); set(x, ROWS - 1, T.WALL); }
  for (let y = 0; y < ROWS; y++) { set(0, y, T.WALL); set(COLS - 1, y, T.WALL); }
  computeTankOK();
}

export function computeTankOK() {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    let ok = 1;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (solidTank(get(x + dx, y + dy))) { ok = 0; break; }
    tankOK[idx(x, y)] = ok;
  }
}

// ---------------- COLLISION ----------------
export function moveCircle(e, dx, dy, r, isTank = false) {
  const solid = isTank ? solidTank : solidSoldier;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.8)));
  for (let s = 0; s < steps; s++) {
    e.x += dx / steps; e.y += dy / steps;
    for (let it = 0; it < 2; it++) {
      const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
      const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!solid(get(tx, ty))) continue;
        const nx = clamp(e.x, tx * TILE, tx * TILE + TILE), ny = clamp(e.y, ty * TILE, ty * TILE + TILE);
        let ddx = e.x - nx, ddy = e.y - ny; const d2 = ddx * ddx + ddy * ddy;
        if (d2 < r * r) {
          if (d2 < 0.0001) { ddx = e.x - (tx * TILE + 16); ddy = e.y - (ty * TILE + 16); }
          const d = Math.hypot(ddx, ddy) || 1; const push = r - Math.sqrt(d2);
          e.x += (ddx / d) * push; e.y += (ddy / d) * push;
        }
      }
    }
  }
  e.x = clamp(e.x, TILE + r, WW - TILE - r); e.y = clamp(e.y, TILE + r, WH - TILE - r);
}

// DDA raycast against tiles; returns distance to hit or maxD
export function rayDist(x0, y0, ang, maxD, blockFn = blocksSight) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = Math.abs(TILE / (dx || 1e-9)), tDeltaY = Math.abs(TILE / (dy || 1e-9));
  let tMaxX = dx > 0 ? ((tx + 1) * TILE - x0) / dx : dx < 0 ? (tx * TILE - x0) / dx : Infinity;
  let tMaxY = dy > 0 ? ((ty + 1) * TILE - y0) / dy : dy < 0 ? (ty * TILE - y0) / dy : Infinity;
  let t = 0;
  while (t < maxD) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; } else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t >= maxD) break;
    if (!inb(tx, ty) || blockFn(grid[idx(tx, ty)])) return t;
  }
  return maxD;
}
export function los(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1) return true;
  return rayDist(ax, ay, Math.atan2(by - ay, bx - ax), d) >= d - 1;
}

// ---------------- FLOWFIELDS (Dijkstra) ----------------
const INF = 0xffffffff;
const heapI = new Int32Array(COLS * ROWS * 4), heapD = new Uint32Array(COLS * ROWS * 4);
function soldierCost(t) { switch (t) { case T.SANDBAG: case T.WALL: case T.SLIT: return 0; case T.MUD: return 13; case T.CRATER: return 14; case T.WIRE: return 60; default: return 10; } }
function tankCost(t, i) { if (!tankOK[i]) return 0; switch (t) { case T.SANDBAG: return 30; case T.WIRE: return 14; case T.MUD: return 13; case T.CRATER: return 16; case T.TRENCH: return 18; default: return 10; } }
export function flowField(targets, forTank = false) {
  const field = new Uint32Array(COLS * ROWS).fill(INF);
  let n = 0;
  const push = (i, d) => { let k = n++; heapI[k] = i; heapD[k] = d; while (k > 0) { const p = (k - 1) >> 1; if (heapD[p] <= heapD[k]) break; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; [heapD[p], heapD[k]] = [heapD[k], heapD[p]]; k = p; } };
  const pop = () => { const i = heapI[0], d = heapD[0]; n--; heapI[0] = heapI[n]; heapD[0] = heapD[n]; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < n && heapD[l] < heapD[m]) m = l; if (r < n && heapD[r] < heapD[m]) m = r; if (m === k) break; [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; [heapD[m], heapD[k]] = [heapD[k], heapD[m]]; k = m; } return [i, d]; };
  for (const [tx, ty] of targets) { if (!inb(tx, ty)) continue; const i = idx(tx, ty); field[i] = 0; push(i, 0); }
  const N8 = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
  while (n > 0) {
    const [i, d] = pop(); if (d > field[i]) continue;
    const x = i % COLS, y = (i / COLS) | 0;
    for (const [ox, oy, w] of N8) {
      const nx = x + ox, ny = y + oy; if (!inb(nx, ny)) continue;
      const ni = idx(nx, ny); const t = grid[ni];
      const c = forTank ? tankCost(t, ni) : soldierCost(t); if (!c) continue;
      if (ox && oy) { const a = idx(x + ox, y), b = idx(x, y + oy); if ((forTank ? !tankCost(grid[a], a) : !soldierCost(grid[a])) || (forTank ? !tankCost(grid[b], b) : !soldierCost(grid[b]))) continue; }
      const nd = d + (c * w) / 10;
      if (nd < field[ni]) { field[ni] = nd; push(ni, nd); }
    }
  }
  return field;
}
export function flowDir(field, px, py, forTank = false) {
  if (!field) return null;
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (!inb(x, y)) return null;
  let best = field[idx(x, y)], bx = -1, by = -1;
  const passable = (i) => (forTank ? tankCost(grid[i], i) : soldierCost(grid[i]));
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const nx = x + ox, ny = y + oy; if (!inb(nx, ny)) continue;
    const ni = idx(nx, ny);
    if (ox && oy && (!passable(idx(x + ox, y)) || !passable(idx(x, y + oy)))) continue;
    if (field[ni] < best) { best = field[ni]; bx = nx; by = ny; }
  }
  if (bx < 0) return field[idx(x, y)] === 0 ? { x: 0, y: 0, at: true } : null;
  const dx = (bx + 0.5) * TILE - px, dy = (by + 0.5) * TILE - py, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d, cost: field[idx(x, y)] };
}
export function fieldCost(field, px, py) { const x = Math.floor(px / TILE), y = Math.floor(py / TILE); return inb(x, y) ? field[idx(x, y)] : INF; }

export function randomTileNear(px, py, rad, pred) {
  for (let k = 0; k < 60; k++) {
    const a = rand(Math.PI * 2), r = rand(rad);
    const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
    const t = tileAtPx(x, y);
    if (!solidSoldier(t) && t !== T.WIRE && (!pred || pred(t, x, y))) return { x: (Math.floor(x / TILE) + 0.5) * TILE, y: (Math.floor(y / TILE) + 0.5) * TILE };
  }
  return null;
}
export function trenchTilesOfLine(li, yMin = 2, yMax = ROWS - 3) {
  const L = LINES[li], out = [];
  for (let y = yMin; y <= yMax; y++) for (let d = -1; d <= 1; d++) { const x = L.tx[y] + d; if (get(x, y) === T.TRENCH) out.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }); }
  return out;
}

// ---------------- TERRAIN ART ----------------
export let terrain = null, tctx = null, groundNoise = null, mini = null;
export function buildTerrain() {
  terrain = document.createElement('canvas'); terrain.width = WW; terrain.height = WH;
  tctx = terrain.getContext('2d');
  // low-res ground noise
  const NW = COLS * 3, NH = ROWS * 3;
  groundNoise = document.createElement('canvas'); groundNoise.width = NW; groundNoise.height = NH;
  const gctx = groundNoise.getContext('2d'); const img = gctx.createImageData(NW, NH);
  for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
    const n = fbm(x * 0.045, y * 0.045), m = fbm(x * 0.012 + 40, y * 0.012 - 20), k = (y * NW + x) * 4;
    const rear = clamp(1 - x / (NW * 0.12), 0, 1); // greener in rear
    const r = 88 + n * 22 - m * 10 - rear * 14, g = 78 + n * 18 + m * 8 + rear * 6, b = 56 + n * 12 - rear * 10;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  gctx.putImageData(img, 0, 0);
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(groundNoise, 0, 0, WW, WH);
  // speckle + grass
  for (let i = 0; i < 42000; i++) {
    const x = rand(WW), y = rand(WH);
    tctx.fillStyle = Math.random() < 0.5 ? `rgba(40,32,22,${rand(0.08, 0.22)})` : `rgba(150,135,100,${rand(0.05, 0.14)})`;
    tctx.fillRect(x, y, rand(1, 3.5), rand(1, 3.5));
  }
  for (let i = 0; i < 2600; i++) {
    const x = rand(WW), y = rand(WH);
    const rear = x < 600 ? 1 : x > WW - 200 ? 0.5 : 0.25;
    if (Math.random() > rear) continue;
    tctx.strokeStyle = `rgba(${randi(90, 120)},${randi(95, 115)},${randi(50, 65)},0.6)`; tctx.lineWidth = 1;
    for (let j = 0; j < 5; j++) { tctx.beginPath(); tctx.moveTo(x, y); tctx.lineTo(x + rand(-5, 5), y - rand(3, 8)); tctx.stroke(); }
  }
  // mud blobs
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[idx(x, y)] === T.MUD) {
    tctx.fillStyle = `rgba(48,38,26,${rand(0.18, 0.3)})`;
    tctx.beginPath(); tctx.ellipse((x + 0.5) * TILE + rand(-6, 6), (y + 0.5) * TILE + rand(-6, 6), rand(18, 28), rand(14, 24), rand(3), 0, Math.PI * 2); tctx.fill();
  }
  for (const c of craters) drawCrater(c.x, c.y, c.r, c.water);
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(x, y, pass);
  for (const d of decor) drawDecor(d);
  buildMini();
}
export function drawCrater(x, y, r, water = false) {
  const g = tctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(30,24,16,0.85)'); g.addColorStop(0.55, 'rgba(48,38,26,0.7)'); g.addColorStop(0.8, 'rgba(70,58,40,0.5)'); g.addColorStop(0.92, 'rgba(130,112,82,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  tctx.fillStyle = g; tctx.beginPath(); tctx.arc(x, y, r, 0, Math.PI * 2); tctx.fill();
  if (water) {
    tctx.fillStyle = 'rgba(70,82,84,0.75)'; tctx.beginPath(); tctx.ellipse(x, y, r * 0.38, r * 0.3, rand(3), 0, Math.PI * 2); tctx.fill();
    tctx.strokeStyle = 'rgba(160,170,165,0.25)'; tctx.lineWidth = 1.5; tctx.beginPath(); tctx.ellipse(x - r * 0.08, y - r * 0.06, r * 0.22, r * 0.12, 0.3, 3.4, 5.4); tctx.stroke();
  }
}
const isTrenchLike = (t) => t === T.TRENCH || t === T.SANDBAG || t === T.FLOOR || t === T.WALL || t === T.SLIT;
function drawTile(x, y, pass) {
  const t = grid[idx(x, y)], px = x * TILE, py = y * TILE;
  const c = tctx;
  if (pass === 0) {
    if (t === T.TRENCH) {
      c.fillStyle = '#3b3023'; c.fillRect(px, py, TILE, TILE);
      const horiz = get(x - 1, y) === T.TRENCH && get(x + 1, y) === T.TRENCH && !(get(x, y - 1) === T.TRENCH && get(x, y + 1) === T.TRENCH);
      c.fillStyle = '#5e4a32';
      if (horiz) for (let k = 2; k < TILE; k += 8) c.fillRect(px + k, py + 5, 5, TILE - 10);
      else for (let k = 2; k < TILE; k += 8) c.fillRect(px + 5, py + k, TILE - 10, 5);
      c.fillStyle = 'rgba(20,14,8,0.35)';
      for (let k = 0; k < 3; k++) c.fillRect(px + rand(TILE), py + rand(TILE), 3, 2);
    } else if (t === T.FLOOR) {
      c.fillStyle = '#5a5850'; c.fillRect(px, py, TILE, TILE);
      c.strokeStyle = 'rgba(30,30,26,0.35)'; c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      if (Math.random() < 0.3) { c.fillStyle = 'rgba(40,34,26,0.4)'; c.beginPath(); c.arc(px + rand(TILE), py + rand(TILE), rand(3, 8), 0, 7); c.fill(); }
    } else if (t === T.SANDBAG) {
      c.fillStyle = '#3b3023'; c.fillRect(px, py, TILE, TILE);
    }
    // trench edge shading
    if (t === T.TRENCH || t === T.FLOOR) {
      const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [ox, oy] of sides) {
        const n = get(x + ox, y + oy);
        if (isTrenchLike(n) && n !== T.WALL) continue;
        if (n === T.WALL) continue;
        const g = ox ? c.createLinearGradient(ox < 0 ? px : px + TILE, 0, ox < 0 ? px + 9 : px + TILE - 9, 0) : c.createLinearGradient(0, oy < 0 ? py : py + TILE, 0, oy < 0 ? py + 9 : py + TILE - 9);
        g.addColorStop(0, 'rgba(10,6,2,0.65)'); g.addColorStop(1, 'rgba(10,6,2,0)');
        c.fillStyle = g; c.fillRect(px, py, TILE, TILE);
        // revetment posts
        c.fillStyle = '#4a3a26';
        for (let k = 6; k < TILE; k += 13) {
          if (ox) c.fillRect(ox < 0 ? px : px + TILE - 4, py + k, 4, 4); else c.fillRect(px + k, oy < 0 ? py : py + TILE - 4, 4, 4);
        }
        // lip on ground side
        c.fillStyle = 'rgba(120,100,70,0.45)';
        if (ox) c.fillRect(ox < 0 ? px - 3 : px + TILE, py, 3, TILE); else c.fillRect(px, oy < 0 ? py - 3 : py + TILE, TILE, 3);
      }
    }
  } else {
    if (t === T.SANDBAG) drawSandbag(px, py);
    else if (t === T.WALL || t === T.SLIT) drawWall(x, y, px, py, t);
    else if (t === T.WIRE) drawWire(px, py);
  }
}
function drawSandbag(px, py) {
  const c = tctx;
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(px + 3, py + 4, TILE, TILE);
  for (let row = 0; row < 3; row++) for (let k = -1; k < 3; k++) {
    const bx = px + k * 14 + (row % 2) * 7, by = py + row * 10 + 1;
    if (bx + 14 < px || bx > px + TILE) continue;
    const shade = randi(-12, 12);
    c.fillStyle = `rgb(${148 + shade},${126 + shade},${86 + shade})`;
    c.strokeStyle = 'rgba(46,34,20,0.75)'; c.lineWidth = 1.2;
    c.beginPath(); c.roundRect(Math.max(bx, px), by, Math.min(14, px + TILE - Math.max(bx, px)), 10, 4); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,240,200,0.15)'; c.fillRect(Math.max(bx, px) + 2, by + 2, 6, 2);
  }
}
function drawWall(x, y, px, py, t) {
  const c = tctx, brick = wallKind[idx(x, y)] === 1;
  // drop shadow
  c.fillStyle = 'rgba(0,0,0,0.35)';
  if (get(x + 1, y) !== T.WALL) c.fillRect(px + TILE, py + 5, 6, TILE);
  if (get(x, y + 1) !== T.WALL) c.fillRect(px + 5, py + TILE, TILE, 6);
  if (brick) {
    c.fillStyle = '#7b4e3c'; c.fillRect(px, py, TILE, TILE);
    c.strokeStyle = 'rgba(40,22,14,0.55)'; c.lineWidth = 1;
    for (let r = 0; r < 4; r++) {
      c.beginPath(); c.moveTo(px, py + r * 8); c.lineTo(px + TILE, py + r * 8); c.stroke();
      for (let k = 0; k < 3; k++) { const bx = px + k * 12 + (r % 2) * 6; c.beginPath(); c.moveTo(bx, py + r * 8); c.lineTo(bx, py + r * 8 + 8); c.stroke(); }
    }
    c.fillStyle = 'rgba(200,170,140,0.12)'; c.fillRect(px, py, TILE, 3);
    if (Math.random() < 0.4) { c.fillStyle = 'rgba(30,24,18,0.4)'; c.beginPath(); c.arc(px + rand(TILE), py + rand(TILE), rand(3, 7), 0, 7); c.fill(); }
  } else {
    c.fillStyle = '#7d7a70'; c.fillRect(px, py, TILE, TILE);
    c.fillStyle = 'rgba(255,255,240,0.12)'; c.fillRect(px, py, TILE, 4); c.fillRect(px, py, 4, TILE);
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(px, py + TILE - 4, TILE, 4);
    c.strokeStyle = 'rgba(40,40,36,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(px + rand(TILE), py); c.lineTo(px + rand(TILE), py + rand(TILE)); c.stroke();
    if (t === T.SLIT) { c.fillStyle = '#111'; c.fillRect(px + 10, py + 6, 12, TILE - 12); c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(px + 10, py + 6, 12, 2); }
  }
}
function drawWire(px, py) {
  const c = tctx;
  c.strokeStyle = 'rgba(30,26,22,0.95)'; c.lineWidth = 2.5;
  for (const [sx, sy] of [[6, 8], [24, 22]]) { c.beginPath(); c.moveTo(px + sx - 4, py + sy - 4); c.lineTo(px + sx + 4, py + sy + 4); c.moveTo(px + sx + 4, py + sy - 4); c.lineTo(px + sx - 4, py + sy + 4); c.stroke(); }
  c.strokeStyle = 'rgba(55,52,48,0.85)'; c.lineWidth = 1.1;
  for (let k = 0; k < 3; k++) {
    c.beginPath(); const oy = 6 + k * 10;
    for (let s = 0; s <= TILE; s += 2) { const yy = py + oy + Math.sin((s + k * 7) * 0.5) * 4; s === 0 ? c.moveTo(px + s, yy) : c.lineTo(px + s, yy); }
    c.stroke();
  }
  c.fillStyle = 'rgba(20,20,20,0.9)';
  for (let k = 0; k < 6; k++) c.fillRect(px + rand(TILE), py + rand(TILE), 2, 2);
}
function drawDecor(d) {
  const c = tctx; c.save(); c.translate(d.x, d.y); c.rotate(d.a); c.scale(d.s, d.s);
  if (d.type === 'stump') {
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(4, 4, 11, 9, 0, 0, 7); c.fill();
    c.fillStyle = '#4b3a28'; c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fill();
    c.strokeStyle = '#6d5638'; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 2, 0, 7); c.stroke();
    c.strokeStyle = '#3a2c1e'; c.lineWidth = 3; c.beginPath(); c.moveTo(6, 0); c.lineTo(26, 4); c.moveTo(-5, 5); c.lineTo(-18, 16); c.stroke();
  } else if (d.type === 'cross') {
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-2, -10, 6, 24);
    c.fillStyle = '#8a7656'; c.fillRect(-3, -12, 5, 24); c.fillRect(-9, -6, 17, 5);
  } else {
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-9, -7, 22, 18);
    c.fillStyle = '#6a5636'; c.fillRect(-11, -9, 22, 18); c.strokeStyle = '#3e3120'; c.lineWidth = 1.5; c.strokeRect(-11, -9, 22, 18); c.beginPath(); c.moveTo(-11, -9); c.lineTo(11, 9); c.stroke();
  }
  c.restore();
}
// redraw a tile after destruction (sandbag/wire -> crater)
export function destroyTile(x, y) {
  const t = get(x, y);
  if (t !== T.SANDBAG && t !== T.WIRE) return false;
  const under = LINES.some((L) => Math.abs(L.tx[y] - x) <= 2) && t === T.SANDBAG ? T.TRENCH : T.CRATER;
  set(x, y, under);
  const px = x * TILE, py = y * TILE;
  tctx.save(); tctx.beginPath(); tctx.rect(px - 4, py - 4, TILE + 10, TILE + 10); tctx.clip();
  tctx.drawImage(groundNoise, (px - 4) / TILE * 3, (py - 4) / TILE * 3, (TILE + 10) / TILE * 3, (TILE + 10) / TILE * 3, px - 4, py - 4, TILE + 10, TILE + 10);
  tctx.restore();
  if (under === T.TRENCH) drawTile(x, y, 0); else drawCrater(px + 16, py + 16, 22);
  for (let k = 0; k < 4; k++) { tctx.fillStyle = 'rgba(150,126,86,0.7)'; tctx.fillRect(px + rand(TILE), py + rand(TILE), 6, 4); }
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; const nt = get(x + ox, y + oy); if (nt === T.SANDBAG || nt === T.WIRE || nt === T.WALL) drawTile(x + ox, y + oy, 1); }
  drawMiniTile(x, y);
  logTile(x, y, 0);
  return true;
}
export function placeSandbag(x, y) {
  const t = get(x, y);
  if (t === T.WALL || t === T.SANDBAG || t === T.SLIT || t === T.FLOOR) return false;
  set(x, y, T.SANDBAG); drawTile(x, y, 0); drawTile(x, y, 1); drawMiniTile(x, y); logTile(x, y, 1); return true;
}
// tile change log, replayed by co-op clients
function logTile(x, y, k) { if (G.tileLog) G.tileLog.push([x, y, k]); if (G.ev) G.ev.push(['t', x, y, k]); }
export function scorch(x, y, r) {
  const g = tctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(18,14,10,0.55)'); g.addColorStop(0.6, 'rgba(30,24,16,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  tctx.fillStyle = g; tctx.beginPath(); tctx.arc(x, y, r, 0, 7); tctx.fill();
}
export function blood(x, y, a = 0) {
  for (let k = 0; k < 5; k++) {
    tctx.fillStyle = `rgba(${randi(70, 100)},12,10,${rand(0.35, 0.6)})`;
    tctx.beginPath(); tctx.ellipse(x + Math.cos(a) * k * 3 + rand(-5, 5), y + Math.sin(a) * k * 3 + rand(-5, 5), rand(2, 7), rand(2, 5), rand(3), 0, 7); tctx.fill();
  }
}
// minimap base
const MS = 2; // pixels per tile
function buildMini() {
  mini = document.createElement('canvas'); mini.width = COLS * MS; mini.height = ROWS * MS;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawMiniTile(x, y);
}
function drawMiniTile(x, y) {
  if (!mini) return; const m = mini.getContext('2d');
  const t = grid[idx(x, y)];
  m.fillStyle = { [T.GROUND]: '#5a4e3a', [T.MUD]: '#4a3e2c', [T.TRENCH]: '#2b2218', [T.SANDBAG]: '#9c845c', [T.WALL]: '#8b887c', [T.WIRE]: '#3a3a36', [T.CRATER]: '#43372a', [T.FLOOR]: '#55534c', [T.SLIT]: '#8b887c' }[t];
  m.fillRect(x * MS, y * MS, MS, MS);
}
