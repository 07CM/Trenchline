// ============ GAME: state, objectives, spawning, player, call-ins, render, HUD ============
import { G, Input, TILE, COLS, ROWS, WW, WH, T, ALLY, AXIS, clamp, lerp, rand, randi, pick, dist, dist2, angDiff, turnTo, initAudio, sfx, setMuted, Audio, startMusic, setMusic, Music } from './core.js';
import { generate, buildTerrain, setNoise, terrain, mini, LINES, OBJ_DEF, tileAtPx, moveCircle, rayDist, los, flowField, flowDir, solidSoldier, trenchTilesOfLine, randomTileNear, placeSandbag, destroyTile, blood, perches, nests, tankOK, idx, inb } from './world.js';
import { Net } from './net.js';
import { WEAPONS, CLASSES, Soldier, makeWeapon, fireWeapon, startReload, updateWeaponTimers, throwGrenade, updateGrenades, explode, damage, damageTank, updateBullets, updateAI, processFieldQueue, Tank, tankDrive, tankFire, tankMG, updateShells, callArtillery, callPlane, updatePlanes, spawnNestGunner, canSee, inSmoke, pointInTank } from './entities.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game'), ctx = canvas.getContext('2d');
const fogC = document.createElement('canvas'), fctx = fogC.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  fogC.width = Math.ceil(W * DPR / 2); fogC.height = Math.ceil(H * DPR / 2);
}
window.addEventListener('resize', resize); resize();
Input.init(canvas);

const DIFFS = {
  recruit: { name: 'Recruit', dmg: 0.4, acc: 1.5, react: 1.35, axisMax: 11, allyMax: 10, tickets: 200 },
  regular: { name: 'Regular', dmg: 0.58, acc: 1, react: 1, axisMax: 15, allyMax: 9, tickets: 160 },
  veteran: { name: 'Veteran', dmg: 0.8, acc: 0.72, react: 0.8, axisMax: 19, allyMax: 8, tickets: 120 },
};
export const CALLINS = [
  { key: 'KeyZ', id: 'arty', name: 'Artillery Barrage', cost: 600, cd: 18 },
  { key: 'KeyX', id: 'plane', name: 'P-47 Air Strike', cost: 900, cd: 25 },
  { key: 'KeyC', id: 'tank', name: 'M4 Sherman', cost: 1500, cd: 40 },
];
G.diff = DIFFS.regular; G.cls = 'rifleman';
// ---- humans: every human-controlled soldier (solo = one local human) ----
function newHuman(pid, name, cls, local) {
  return { pid, name, cls, local, s: null, tank: null, mark: null, healT: 0, abilityReady: 0, bp: 300, callCd: { arty: 0, plane: 0, tank: 0 },
    dead: false, deathT: -99, stats: { kills: 0, deaths: 0, bpEarned: 0 }, inp: null, pressed: new Set(), pe: [], spawnSeq: 0 };
}
let HM = newHuman(0, 'You', 'rifleman', true); // current context human
G.humans = [HM]; G.me = HM;
const withHuman = (h, fn) => { const prev = HM; HM = h; try { return fn(); } finally { HM = prev; } };
const humanByPid = (pid) => G.humans.find((h) => h.pid === pid);
const isClient = () => Net.role === 'client';
const isHostMP = () => Net.role === 'host';
function syncAliases() { G.player = G.me.s; G.playerTank = G.me.tank; G.humanUnits = G.humans.filter((h) => h.s && h.s.alive && !h.tank).map((h) => h.s); }
// focus points of humans (tank or soldier) for spawn distances and enemy targeting
function humanPoints() { const out = []; for (const h of G.humans) { const v = h.tank || (h.s && h.s.alive ? h.s : null); if (v) out.push(v); } return out; }
function nearHuman(x, y, d) { return humanPoints().some((v) => dist2(v.x, v.y, x, y) < d * d); }
// personal feedback routed to the human it belongs to
G.personal = (pid, ev) => { const h = humanByPid(pid); if (h && !h.local) h.pe.push(ev); };
G.noise = []; G.flashes = []; G.wrecks = []; G.artyMarks = []; G.fieldQueue = []; G.fields = {};
let lineTiles = [], fieldTimer = 0, playerFieldTimer = 0, spawnTimerA = 0, spawnTimerX = 0, enemyArtyT = 40, panzerT = 9999, gunnerT = 0, ambientT = 3;
let vis = { ox: 0, oy: 0, n: 0, a0: 0, step: 0, d: null };


// ---------------- SETUP ----------------
let createNoise = null;
async function loadNoise() {
  try { const m = await import('../vendor/simplex-noise.js'); createNoise = m.createNoise2D; setNoise(m.createNoise2D()); } catch (e) { console.warn('simplex fallback'); }
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// deterministic map from a seed so every player in a room builds the same battlefield
function buildMap(seed) {
  const r = mulberry32(seed), real = Math.random;
  if (createNoise) setNoise(createNoise(mulberry32(seed ^ 0x9e3779b9)));
  Math.random = r;
  try { generate(); buildTerrain(); } finally { Math.random = real; }
  lineTiles = LINES.map((_, i) => trenchTilesOfLine(i));
}

function newGame(seed = (Math.random() * 2 ** 31) | 0) {
  G.seed = seed; buildMap(seed); G.tileLog = [];
  Object.assign(G, { time: 0, units: [], bullets: [], grenades: [], particles: [], tanks: [], planes: [], shells: [], corpses: [], smokes: [], crates: [], lasers: [], spotted: [], feed: [], noise: [], flashes: [], wrecks: [], artyMarks: [], fieldQueue: [] });
  G.objectives = OBJ_DEF.map((o, i) => ({ ...o, progress: 0, state: i === 0 ? 'active' : 'locked' }));
  G.active = 0; G.timer = 240; G.tickets = G.diff.tickets + 40 * (G.humans.length - 1); G.caps = 0; G.hurt = 0;
  G.axisMax = G.diff.axisMax + 3 * (G.humans.length - 1); G.allyMax = Math.max(4, G.diff.allyMax - (G.humans.length - 1));
  for (const h of G.humans) Object.assign(h, { s: null, tank: null, mark: null, healT: 0, abilityReady: 0, bp: 300, callCd: { arty: 0, plane: 0, tank: 0 }, dead: false, deathT: -99, stats: { kills: 0, deaths: 0, bpEarned: 0 }, pe: [], pressed: new Set() });
  enemyArtyT = rand(40, 55); panzerT = 9999; gunnerT = 0; spawnTimerA = 0; spawnTimerX = 0;
  recomputeFields();
  for (const h of G.humans) withHuman(h, () => spawnPlayer());
  syncAliases();
  for (let i = 0; i < G.allyMax; i++) spawnAlly(true);
  for (let i = 0; i < G.axisMax; i++) spawnAxis(true);
  const g = spawnNestGunner(0); if (g) G.units.push(g);
  G.mode = 'play';
  gtoast('Capture objective A', 'Push across no man\'s land before time runs out', 'gold');
}

function recomputeFields() {
  const o = G.objectives[G.active]; if (!o) return;
  const tg = [];
  const r = Math.floor(o.r * 0.45 / TILE);
  const cx = Math.floor(o.x / TILE), cy = Math.floor(o.y / TILE);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inb(x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r && !solidSoldier(tileAtPx((x + 0.5) * TILE, (y + 0.5) * TILE))) tg.push([x, y]);
  G.fields.obj = flowField(tg); G.fields.objRev = G.fields.obj;
  G.fields.tankObj = flowField(tg, true);
  G.dirtyFields = false;
}
function recomputePlayerField() {
  const pts = humanPoints(); if (!pts.length) return;
  G.fields.player = flowField(pts.map((p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)]));
}

// ---------------- SPAWNING ----------------
function allySpawnLine() { return G.active; } // line index of last captured objective (0 = base)
function allySpawnPoint(nearY) {
  const tiles = lineTiles[allySpawnLine()].filter((t) => !G.units.some((u) => u.alive && u.team === AXIS && dist2(u.x, u.y, t.x, t.y) < 350 * 350));
  const list = tiles.length ? tiles : lineTiles[allySpawnLine()];
  const ty = nearY !== undefined ? nearY : (G.objectives[G.active] || G.objectives[4]).y;
  const sorted = list.slice().sort((a, b) => Math.abs(a.y - ty) - Math.abs(b.y - ty));
  return pick(sorted.slice(0, Math.max(6, Math.floor(sorted.length * 0.25))));
}
function spawnPlayer() {
  const sp = allySpawnPoint();
  const p = new Soldier(ALLY, sp.x, sp.y, 'player', HM.cls);
  p.angle = 0; p.pid = HM.pid; p.name = HM.name; HM.s = p; G.units.push(p); p.spawnT = G.time;
  HM.dead = false; HM.spawnSeq++; HM.mark = null;
  if (HM.local) { G.cam.x = p.x; G.cam.y = p.y; }
  HM.abilityReady = 0;
  syncAliases(); recomputePlayerField();
}
function spawnAlly(initial = false) {
  const sp = allySpawnPoint(rand(2, ROWS - 2) * TILE);
  const u = new Soldier(ALLY, sp.x + rand(-6, 6), sp.y + rand(-6, 6), 'assault');
  G.units.push(u);
}
function axisSpawnPoint(minPlayerDist = 850) {
  const lines = [Math.min(G.active + 2, 5), Math.min(G.active + 1, 5)];
  for (const li of lines) {
    const tiles = lineTiles[li].filter((t) => !nearHuman(t.x, t.y, minPlayerDist) && !G.units.some((u) => u.alive && u.team === ALLY && dist2(u.x, u.y, t.x, t.y) < 520 * 520));
    if (tiles.length) return pick(tiles);
  }
  return pick(lineTiles[Math.min(G.active + 2, 5)]);
}
function spawnAxis(initial = false) {
  const axis = G.units.filter((u) => u.alive && u.team === AXIS);
  const count = (r) => axis.filter((u) => u.role === r).length;
  let role = 'defender';
  const roll = Math.random();
  if (count('sniper') < (G.diff === DIFFS.veteran ? 3 : 2) && roll < 0.18) role = 'sniper';
  else if (count('stalker') < 3 && roll < 0.38) role = 'stalker';
  else if (count('rusher') < 4 && roll < 0.62) role = 'rusher';
  if (initial && role === 'rusher' && Math.random() < 0.5) role = 'defender';
  let sp;
  if (role === 'sniper') {
    const list = perches[Math.min(G.active, 4)].filter((t) => !nearHuman(t.x, t.y, 700));
    sp = list.length ? pick(list) : axisSpawnPoint();
  } else if (role === 'defender' && initial) {
    const o = G.objectives[G.active];
    sp = randomTileNear(o.x + 60, o.y, o.r * 1.6, (t) => t === T.TRENCH || t === T.FLOOR) || axisSpawnPoint();
  } else sp = axisSpawnPoint();
  if (!sp) return;
  const u = new Soldier(AXIS, sp.x + rand(-5, 5), sp.y + rand(-5, 5), role);
  if (role === 'sniper') { u.ai.perch = { x: sp.x, y: sp.y }; u.ai.perchObj = G.active; }
  G.units.push(u);
}
function spawnPanzer() {
  const li = Math.min(G.active + 2, 5); const L = LINES[li];
  const o = G.objectives[G.active];
  for (let k = 0; k < 80; k++) {
    const y = clamp(Math.floor(o.y / TILE) + randi(-10, 10), 4, ROWS - 5); const x = clamp(L.tx[y] + randi(3, 8), 3, COLS - 4);
    if (tankOK[idx(x, y)] && tileAtPx((x + 0.5) * TILE, (y + 0.5) * TILE) !== T.WALL) {
      const tk = new Tank(AXIS, (x + 0.5) * TILE, (y + 0.5) * TILE, Math.PI); G.tanks.push(tk);
      gtoast('Enemy armor spotted', 'A Panzer IV is moving up. Engineers: AT grenades. Or call in support.', 'red'); gsfx('alarm');
      return;
    }
  }
}

// ---------------- HOOKS ----------------
const ROLE_LABEL = { defender: 'Rifleman', rusher: 'Rusher', stalker: 'Stalker', sniper: 'Sniper', gunner: 'MG Gunner', assault: 'Infantry', player: 'You' };
const ROLE_BP = { defender: 100, rusher: 110, stalker: 160, sniper: 175, gunner: 150 };
// human that owns a unit / tank / owner stub (soldier, playerOwned tank), if any
function ownerHuman(o) { if (!o || o.pid === undefined) return o && (o.isPlayer || o.playerOwned) && !Net.active ? G.me : null; return humanByPid(o.pid) || null; }
G.onKill = (u, killer, kind, playerKill) => {
  const kh = ownerHuman(killer);
  const kName = killer ? (kh ? (killer.playerOwned ? `${kh.name}'s support` : kh.name) : killer.playerOwned ? 'Allied support' : killer.name || 'Enemy') : 'Wire';
  const how = kind === 'explosion' ? 'blast' : kind === 'melee' ? 'bayonet' : kind === 'crush' ? 'crushed' : kind === 'strafe' ? 'strafed' : kind === 'sniper' ? 'sniped' : killer && killer.weapon ? killer.weapon.def.name : 'killed';
  const vh = u.isPlayer ? ownerHuman(u) : null;
  feedNet(kName, how, vh ? vh.name : u.name, killer ? (killer.team === ALLY || killer.isPlayer || killer.playerOwned ? 'ally' : 'axis') : 'axis', u.team === ALLY ? 'ally' : 'axis', kh && !killer.playerOwned ? kh.pid : -1, vh ? vh.pid : -1);
  if (playerKill && u.team === AXIS && kh) withHuman(kh, () => {
    const pts = ROLE_BP[u.role] || 100; addBP(pts); HM.stats.kills++;
    popup(`+${pts}  ${ROLE_LABEL[u.role] || 'Enemy'} eliminated`); psfx('kill');
  });
  if (vh) withHuman(vh, playerDied);
};
G.onTankDestroyed = (tk, owner) => {
  const th = tk.playerOwned ? G.humans.find((h) => h.tank === tk) : null;
  if (th) withHuman(th, () => { exitTank(true); toast('Sherman knocked out', 'You bailed out of the burning tank', 'red'); });
  else if (tk.team === AXIS) {
    const oh = ownerHuman(owner);
    feedNet(oh ? oh.name : 'Allies', 'destroyed', 'Panzer IV', 'ally', 'axis', oh ? oh.pid : -1, -1);
    if (oh) withHuman(oh, () => { addBP(500); popup('+500  Panzer destroyed'); });
    gtoast('Panzer destroyed', 'Enemy armor neutralised', 'gold'); panzerT = rand(100, 140);
  }
};
function addBP(n) { HM.bp += n; HM.stats.bpEarned += n; }
function playerDied() {
  HM.stats.deaths++; HM.dead = true; HM.deathT = G.time; HM.mark = null;
  if (HM.local) { G.mode = 'dead'; showDeath(); }
}

// ---------------- PLAYER ----------------
function mouseWorld() { const z = G.cam.zoom; Input.mouse.wx = G.cam.x + (Input.mouse.sx - W / 2) / z; Input.mouse.wy = G.cam.y + (Input.mouse.sy - H / 2) / z; }
// Resolved per-tick controls. Local: built from keyboard/mouse/touch. Remote: built from the client's input packet.
function localControls(p) {
  mouseWorld();
  const touch = Input.touch.enabled;
  let mx = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
  let my = (Input.down('KeyS') || Input.down('ArrowDown') ? 1 : 0) - (Input.down('KeyW') || Input.down('ArrowUp') ? 1 : 0);
  if (touch && (Input.touch.move.x || Input.touch.move.y)) { mx = Input.touch.move.x; my = Input.touch.move.y; }
  const ml = Math.hypot(mx, my);
  const ox = HM.tank ? HM.tank.x : p.x, oy = HM.tank ? HM.tank.y : p.y;
  let ax = Input.mouse.wx, ay = Input.mouse.wy;
  if (touch && Input.touch.aim.active) { ax = ox + Input.touch.aim.x * 300; ay = oy + Input.touch.aim.y * 300; }
  else if (touch && ml > 0.1 && !HM.tank) { ax = ox + mx / ml * 300; ay = oy + my / ml * 300; }
  const space = Input.down('Space'), spaceHit = Input.hit('Space');
  const fireHeld = (touch ? Input.touch.aim.active && Math.hypot(Input.touch.aim.x, Input.touch.aim.y) > 0.6 : Input.mouse.l) || space;
  return { mx, my, ax, ay, touch, ads: Input.mouse.r, sprint: Input.down('ShiftLeft'), fireHeld, firePressed: (touch ? fireHeld : Input.mouse.lPressed) || spaceHit,
    altHeld: Input.mouse.r, confirm: Input.mouse.lPressed || spaceHit || touch, cancel: Input.mouse.rPressed || Input.hit('Escape'),
    wheel: !!Input.wheel, hit: (c) => Input.hit(c) };
}
function remoteControls(h) {
  const i = h.inp || {}; const pr = h.pressed;
  const c = { mx: i.mx || 0, my: i.my || 0, ax: i.ax ?? 0, ay: i.ay ?? 0, touch: !!i.tch, ads: !!i.ads, sprint: !!i.sp, fireHeld: !!i.fh,
    firePressed: pr.has('L') || (!!i.tch && !!i.fh), altHeld: !!i.rh, confirm: pr.has('L') || !!i.tch, cancel: pr.has('R') || pr.has('Escape'),
    wheel: pr.has('Wheel'), hit: (k) => pr.has(k) };
  return c;
}
function updatePlayer(dt) {
  const p = HM.s; if (!p || !p.alive) return;
  const remote = !HM.local;
  const I = remote ? remoteControls(HM) : localControls(p);
  let { mx, my, ax: aimX, ay: aimY, touch } = I;
  // tank control
  if (HM.tank) { updatePlayerTank(dt, mx, my, I); HM.pressed.clear(); return; }
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  p.angle = Math.atan2(aimY - p.y, aimX - p.x);
  p.ads = I.ads && !HM.mark;
  const sprint = I.sprint && ml > 0.1 && p.stamina > 5 && !p.ads;
  if (sprint) p.stamina = Math.max(0, p.stamina - dt * 26); else p.stamina = Math.min(100, p.stamina + dt * 16);
  const t = tileAtPx(p.x, p.y); p.inTrench = t === T.TRENCH || t === T.FLOOR;
  if (t === T.WIRE && Math.random() < dt * 2.5) damage(p, 3, { x: p.x, y: p.y, kind: 'wire', team: -1 });
  if (!p.alive) return;
  if (remote) {
    // client-authoritative movement, clamped to a sane per-tick distance
    const i = HM.inp || {};
    if (typeof i.x === 'number' && typeof i.y === 'number') {
      const dx = i.x - p.x, dy = i.y - p.y, d = Math.hypot(dx, dy), lim = 420 * dt + 40;
      const k = d > lim ? lim / d : 1; const ox = p.x, oy = p.y;
      p.x = clamp(p.x + dx * k, 16, WW - 16); p.y = clamp(p.y + dy * k, 16, WH - 16);
      if (solidSoldier(tileAtPx(p.x, p.y))) { p.x = ox; p.y = oy; }
      p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
    }
    p.moving = !!i.mv || Math.hypot(p.vx, p.vy) > 20; p.walk += Math.hypot(p.vx, p.vy) * dt * 0.08;
  } else {
    const slow = t === T.MUD ? 0.8 : t === T.CRATER ? 0.75 : t === T.WIRE ? 0.38 : 1;
    const sp = p.speedBase * (sprint ? 1.55 : 1) * (p.ads ? 0.55 : 1) * slow * (p.reloadT > 0 ? 0.85 : 1);
    p.vx = lerp(p.vx, mx * sp, Math.min(1, dt * 12)); p.vy = lerp(p.vy, my * sp, Math.min(1, dt * 12));
    moveCircle(p, p.vx * dt, p.vy * dt, p.r);
    p.moving = Math.hypot(p.vx, p.vy) > 20; p.walk += Math.hypot(p.vx, p.vy) * dt * 0.08;
    if (p.moving && Math.floor(p.walk / 3) !== Math.floor((p.walk - Math.hypot(p.vx, p.vy) * dt * 0.08) / 3)) sfx('step', p.x, p.y, 0.5);
  }
  updateWeaponTimers(p, dt);
  p.recoil = Math.max(0, (p.recoil || 0) - dt * 0.6);
  // regen + healing
  if (G.time - p.lastHit > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt * 9);
  if (HM.healT > 0) { HM.healT -= dt; p.hp = Math.min(p.maxHp, p.hp + dt * 20); }
  // ammo crates
  for (const c of G.crates) if (dist2(c.x, c.y, p.x, p.y) < 80 * 80) { c.ticks = c.ticks || {}; c.ticks[HM.pid] = (c.ticks[HM.pid] || 0) - dt; if (c.ticks[HM.pid] <= 0) { c.ticks[HM.pid] = 1; refill(p, false); } }
  // marking mode for call-ins
  if (HM.mark) {
    if (I.confirm) { confirmCallin(HM.mark, touch ? p.x + Math.cos(p.angle) * 520 : aimX, touch ? p.y + Math.sin(p.angle) * 520 : aimY); }
    else if (I.cancel) { HM.mark = null; if (!remote) Input.pressed.Escape = false; }
    HM.pressed.clear(); return;
  }
  // weapon actions
  if (I.hit('Digit1')) swap(p, 0); if (I.hit('Digit2')) swap(p, 1); if (I.hit('KeyQ') || I.wheel) swap(p, 1 - p.wi);
  if (I.hit('KeyR')) startReload(p);
  const w = p.weapon.def;
  const wantsFire = touch ? I.fireHeld : (w.auto ? I.fireHeld : I.firePressed);
  if (wantsFire && !sprint) {
    const extra = (p.moving ? 0.018 : 0) + p.recoil - (p.ads ? w.spread * 0.6 : 0) + (w.key === 'springfield' && !p.ads ? 0.06 : 0);
    fireWeapon(p, p.angle, extra);
  }
  if (I.hit('KeyG') && p.grenades > 0) { throwGrenade(p, aimX, aimY, p.gtype); p.grenades--; }
  if (I.hit('KeyF')) useAbility(p, aimX, aimY);
  for (const c of CALLINS) if (I.hit(c.key)) beginCallin(c.id);
  HM.pressed.clear();
}
function swap(p, i) { if (i === p.wi || !p.weapons[i]) return; p.wi = i; p.swapT = 0.35; p.reloadT = 0; sfx('click', p.x, p.y); }
function refill(p, full) {
  for (const w of p.weapons) { const max = w.def.reserve; w.reserve = full ? max : Math.min(max, w.reserve + w.def.mag); }
  const maxG = CLASSES[p.cls].grenades; if (p.grenades < maxG) p.grenades++;
  sfx('reload', p.x, p.y, 0.6);
}
function useAbility(p, ax, ay) {
  const c = CLASSES[p.cls];
  if (G.time < HM.abilityReady) { psfx('empty'); return; }
  let ok = true;
  switch (c.ability) {
    case 'bandage': HM.healT = 3; sfx('heal', p.x, p.y); popup('Field dressing applied'); break;
    case 'smoke': throwGrenade(p, ax, ay, 'smoke'); break;
    case 'ammo': G.crates.push({ x: p.x + Math.cos(p.angle) * 24, y: p.y + Math.sin(p.angle) * 24, until: G.time + 25 }); refill(p, false); popup('Ammo crate deployed'); break;
    case 'binoc': {
      const until = G.time + 10; let n = 0;
      for (const u of G.units) if (u.alive && u.team === AXIS && dist(p.x, p.y, u.x, u.y) < 1900 && Math.abs(angDiff(p.angle, Math.atan2(u.y - p.y, u.x - p.x))) < 0.6) { G.spotted.push({ u, until }); n++; }
      psfx('radio'); popup(n ? `${n} enemies spotted` : 'No enemies in sight'); break;
    }
    case 'sandbag': {
      const bx = p.x + Math.cos(p.angle) * 58, by = p.y + Math.sin(p.angle) * 58;
      const perp = p.angle + Math.PI / 2; let placed = 0;
      for (let k = -1; k <= 1; k++) {
        const x = bx + Math.cos(perp) * k * TILE, y = by + Math.sin(perp) * k * TILE;
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (G.units.some((u) => u.alive && Math.floor(u.x / TILE) === tx && Math.floor(u.y / TILE) === ty)) continue;
        if (placeSandbag(tx, ty)) placed++;
      }
      if (placed) { G.dirtyFields = true; sfx('thud', p.x, p.y); popup('Sandbags placed'); } else ok = false;
      break;
    }
  }
  if (ok) HM.abilityReady = G.time + c.abilityCd;
}
// ---- call-ins ----
function beginCallin(id) {
  const c = CALLINS.find((k) => k.id === id);
  if (HM.tank || !HM.s || !HM.s.alive) return;
  if (HM.bp < c.cost) { popup(`Need ${c.cost} battle points`); psfx('empty'); return; }
  if (HM.callCd[id] > G.time) { popup(`${c.name} on cooldown`); psfx('empty'); return; }
  if (id === 'tank') { confirmCallin(id); return; }
  HM.mark = id; psfx('radio');
}
function confirmCallin(id, x, y) {
  const c = CALLINS.find((k) => k.id === id); HM.mark = null;
  if (HM.bp < c.cost) return;
  HM.bp -= c.cost; HM.callCd[id] = G.time + c.cd;
  const p = HM.s;
  if (id === 'arty') { callArtillery(x, y, ALLY, p, 9, 170); toast('Artillery inbound', 'Barrage on marked position', 'gold'); psfx('radio'); if (Net.active) feedNet(HM.name, 'called', 'Artillery', 'ally', 'ally', HM.pid, -1); }
  if (id === 'plane') { callPlane(x, y, p); toast('P-47 Thunderbolt inbound', 'Bombing and strafing run on marked position', 'gold'); psfx('radio'); if (Net.active) feedNet(HM.name, 'called', 'P-47 strike', 'ally', 'ally', HM.pid, -1); }
  if (id === 'tank') enterTank();
}
function enterTank() {
  const p = HM.s;
  let x = p.x, y = p.y;
  // find tank-capable tile near player
  let best = null, bd = Infinity;
  for (let yy = Math.floor(y / TILE) - 6; yy <= Math.floor(y / TILE) + 6; yy++) for (let xx = Math.floor(x / TILE) - 6; xx <= Math.floor(x / TILE) + 6; xx++) {
    if (!inb(xx, yy) || !tankOK[idx(xx, yy)]) continue; const d = dist2((xx + 0.5) * TILE, (yy + 0.5) * TILE, x, y); if (d < bd) { bd = d; best = { x: (xx + 0.5) * TILE, y: (yy + 0.5) * TILE }; }
  }
  if (!best) { HM.bp += 1500; HM.callCd.tank = 0; popup('No room to deploy a tank here'); return; }
  const tk = new Tank(ALLY, best.x, best.y, 0, true); tk.life = 60; tk.ta = p.angle; tk.pid = HM.pid;
  G.tanks.push(tk); HM.tank = tk; syncAliases();
  G.units = G.units.filter((u) => u !== p);
  for (let i = 0; i < 16; i++) G.particles.push({ type: 'smoke', x: tk.x + rand(-40, 40), y: tk.y + rand(-30, 30), vx: rand(-40, 40), vy: rand(-40, 40), life: 2, max: 2, size: 14, grow: 20, a: 0.4 });
  toast('M4 Sherman deployed', 'WASD drive · Mouse aims turret · LMB cannon · RMB machine gun', 'gold'); psfx('radio');
  recomputePlayerField();
}
function exitTank(destroyed = false) {
  const tk = HM.tank; if (!tk) return; const p = HM.s;
  HM.tank = null; syncAliases();
  p.x = tk.x + Math.cos(tk.a + Math.PI / 2) * 46; p.y = tk.y + Math.sin(tk.a + Math.PI / 2) * 46;
  moveCircle(p, 0, 0, p.r); if (solidSoldier(tileAtPx(p.x, p.y))) { p.x = tk.x; p.y = tk.y; }
  p.hp = destroyed ? Math.min(p.hp, 50) : p.hp; p.spawnT = G.time - 1;
  G.units.push(p);
  if (!destroyed) {
    tk.alive = false; G.tanks = G.tanks.filter((t) => t !== tk);
    for (let i = 0; i < 16; i++) G.particles.push({ type: 'smoke', x: tk.x + rand(-40, 40), y: tk.y + rand(-30, 30), vx: rand(-40, 40), vy: rand(-40, 40), life: 2, max: 2, size: 14, grow: 20, a: 0.4 });
    toast('Sherman withdrawn', 'Armor support time expired', 'gold');
  }
}
function updatePlayerTank(dt, mx, my, I) {
  const tk = HM.tank, p = HM.s;
  const fwd = -my, turn = mx;
  tankDrive(tk, fwd, turn, dt);
  const ax = I.ax, ay = I.ay;
  if (!I.touch || Math.hypot(ax - tk.x, ay - tk.y) > 1) tk.ta = turnTo(tk.ta, Math.atan2(ay - tk.y, ax - tk.x), dt * 2.6);
  tk.reload -= dt; tk.hitFlash = Math.max(0, tk.hitFlash - dt);
  if (I.fireHeld) tankFire(tk);
  if (I.altHeld) tankMG(tk, dt, tk.ta);
  tk.life -= dt;
  p.x = tk.x; p.y = tk.y; p.angle = tk.ta;
  if (tk.hp < tk.maxHp * 0.5 && Math.random() < dt * 6) G.particles.push({ type: 'smoke', x: tk.x, y: tk.y, vx: rand(-15, 15), vy: rand(-25, -5), life: 2, max: 2, size: 6, grow: 16, a: 0.35, dark: true });
  if (tk.life <= 0) exitTank(false);
}

// ---------------- ENEMY TANK AI ----------------
function updatePanzer(tk, dt) {
  tk.reload -= dt; tk.hitFlash = Math.max(0, tk.hitFlash - dt); tk.ai.think -= dt;
  const o = G.objectives[G.active];
  if (tk.ai.think <= 0) {
    tk.ai.think = 0.4; let best = null, bd = 1050;
    const cands = G.units.filter((u) => u.alive && u.team === ALLY).concat(G.tanks.filter((t) => t.alive && t.team === ALLY));
    for (const u of cands) { let d = dist(tk.x, tk.y, u.x, u.y); if (u.playerOwned || u.isPlayer) d *= 0.7; if (d < bd && canSee(tk, u.x, u.y, 1100)) { bd = d; best = u; } }
    tk.ai.target = best;
  }
  const tg = tk.ai.target;
  let fwd = 0, turn = 0;
  if (o && dist(tk.x, tk.y, o.x, o.y) > 230) {
    const d = flowDir(G.fields.tankObj, tk.x, tk.y, true);
    if (d && !d.at) { const want = Math.atan2(d.y, d.x); const ad = angDiff(tk.a, want); turn = clamp(ad * 2, -1, 1); fwd = Math.abs(ad) < 0.7 ? 1 : 0.15; }
  }
  if (tg && dist(tk.x, tk.y, tg.x, tg.y) < 420) fwd *= 0.25;
  tankDrive(tk, fwd, turn, dt);
  if (tg) {
    const want = Math.atan2(tg.y - tk.y, tg.x - tk.x); tk.ta = turnTo(tk.ta, want, dt * 1.15);
    const ad = Math.abs(angDiff(tk.ta, want)), d = dist(tk.x, tk.y, tg.x, tg.y);
    if (ad < 0.05 && d < 1050) tankFire(tk);
    if (ad < 0.15 && d < 620) tankMG(tk, dt, tk.ta);
  } else tk.ta = turnTo(tk.ta, tk.a, dt * 0.8);
  if (tk.hp < tk.maxHp * 0.5 && Math.random() < dt * 6) G.particles.push({ type: 'smoke', x: tk.x, y: tk.y, vx: rand(-15, 15), vy: rand(-25, -5), life: 2, max: 2, size: 6, grow: 16, a: 0.35, dark: true });
}

// ---------------- OBJECTIVES ----------------
function updateObjectives(dt) {
  const o = G.objectives[G.active]; if (!o) return;
  let a = 0, x = 0; const inside = new Set();
  for (const u of G.units) { if (!u.alive) continue; if (dist2(u.x, u.y, o.x, o.y) < o.r * o.r) { if (u.team === ALLY) { a++; if (u.isPlayer) inside.add(u.pid); } else x++; } }
  for (const tk of G.tanks) if (tk.alive && dist2(tk.x, tk.y, o.x, o.y) < o.r * o.r) { if (tk.team === ALLY) { a += 2; if (tk.playerOwned) inside.add(tk.pid); } else x += 2; }
  o.allies = a; o.axis = x; o.contested = a > 0 && x > 0; o.playerIn = inside.has(G.me.pid);
  if (a > 0 && x === 0) o.progress += dt / 13 * (1 + 0.35 * Math.min(a - 1, 4));
  else if (a === 0) o.progress = Math.max(0, o.progress - dt / 35);
  if (o.progress >= 1) {
    o.progress = 1; o.state = 'captured'; G.caps++;
    gsfx('capture'); G.active++;
    for (const h of G.humans) withHuman(h, () => { const bonus = inside.has(h.pid) ? 400 : 150; addBP(bonus); popup(`+${bonus}  Objective ${o.name}`); });
    feedNet('Allies', 'captured', 'Objective ' + o.name, 'ally', 'ally', -1, -1);
    if (G.active >= G.objectives.length) { endGame(true); return; }
    G.timer += 150; G.objectives[G.active].state = 'active';
    gtoast(`Objective ${o.name} captured`, `+2:30 added · Push on to objective ${G.objectives[G.active].name}`, 'gold');
    recomputeFields(); gunnerT = 0;
    if (G.active >= 1 && panzerT > 900) panzerT = rand(35, 55);
    const g = spawnNestGunner(G.active); if (g && !nearHuman(g.x, g.y, 600)) G.units.push(g);
  }
}

// ---------------- MAIN UPDATE ----------------
function update(dt) {
  if (isClient()) { clientUpdate(dt); return; }
  if (G.mode !== 'play' && G.mode !== 'dead' && !(isHostMP() && G.mode === 'paused')) return;
  G.time += dt; G.lasers = [];
  for (const h of G.humans) {
    if (h.local && G.mode !== 'play') continue;
    if (!h.s || !h.s.alive) { h.pressed?.clear(); continue; }
    withHuman(h, () => updatePlayer(dt));
  }
  syncAliases();
  for (const u of G.units) if (u.alive && !u.isPlayer) updateAI(u, dt);
  for (const tk of G.tanks) if (tk.alive && tk.team === AXIS) updatePanzer(tk, dt);
  updateBullets(dt); updateGrenades(dt); updateShells(dt); updatePlanes(dt);
  processFieldQueue();
  updateFx(dt);
  G.crates = G.crates.filter((c) => c.until > G.time);
  G.spotted = G.spotted.filter((s) => s.until > G.time && s.u.alive);
  G.artyMarks = G.artyMarks.filter((m) => m.until > G.time);
  G.noise = G.noise.filter((n) => G.time - n.t < 1.5);
  G.units = G.units.filter((u) => u.alive);
  G.tanks = G.tanks.filter((t) => t.alive);
  for (const h of G.humans) for (const k of ['arty', 'plane', 'tank']) if (h.callCd[k] < G.time) h.callCd[k] = 0;
  updateObjectives(dt);
  if (G.mode === 'end') return;
  restOfUpdate(dt);
}
function updateFx(dt) {
  for (const p of G.particles) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
    if (p.grow) p.size += p.grow * dt;
    if (p.rot !== undefined) p.rot += dt * 12;
  }
  G.particles = G.particles.filter((p) => p.life > 0);
  if (G.particles.length > 1800) G.particles.splice(0, G.particles.length - 1800);
  for (const f of G.flashes) f.life -= dt; G.flashes = G.flashes.filter((f) => f.life > 0);
  for (const s of G.smokes) { s.life -= dt; s.r = s.life > 3 ? Math.min(s.max, s.r + dt * 120) : s.r * (1 - dt * 0.3); if (Math.random() < dt * 14) G.particles.push({ type: 'smoke', x: s.x + rand(-s.r, s.r) * 0.6, y: s.y + rand(-s.r, s.r) * 0.6, vx: rand(-10, 10), vy: rand(-10, 10), life: 3, max: 3, size: 30, grow: 20, a: 0.55, smoke: true }); }
  G.smokes = G.smokes.filter((s) => s.life > 0);
  G.cam.shake = Math.max(0, G.cam.shake - dt * 40);
  G.hurt = Math.max(0, (G.hurt || 0) - dt * 0.8);
  G.hitmarker = Math.max(0, (G.hitmarker || 0) - dt);
}
function restOfUpdate(dt) {
  // fields
  fieldTimer -= dt; if (G.dirtyFields && fieldTimer <= 0) { recomputeFields(); fieldTimer = 1; }
  playerFieldTimer -= dt; if (playerFieldTimer <= 0) { recomputePlayerField(); playerFieldTimer = 0.5; }
  // spawning
  const allies = G.units.filter((u) => u.team === ALLY && !u.isPlayer).length;
  const axis = G.units.filter((u) => u.team === AXIS).length;
  spawnTimerA -= dt; if (allies < G.allyMax && spawnTimerA <= 0 && G.tickets > 0) { spawnAlly(); spawnTimerA = 2.4; }
  spawnTimerX -= dt; if (axis < G.axisMax + G.active && spawnTimerX <= 0) { spawnAxis(); spawnTimerX = 1.6; }
  gunnerT -= dt; if (gunnerT <= 0) { gunnerT = 45; if (!G.units.some((u) => u.role === 'gunner')) { const g = spawnNestGunner(G.active); if (g && !nearHuman(g.x, g.y, 650) && !G.units.some((u) => u.team === ALLY && dist2(u.x, u.y, g.x, g.y) < 400 * 400)) G.units.push(g); } }
  // enemy support
  enemyArtyT -= dt;
  if (enemyArtyT <= 0) {
    enemyArtyT = rand(36, 55);
    const al = G.units.filter((u) => u.team === ALLY);
    const hp = humanPoints();
    const tgt = Math.random() < 0.45 && hp.length ? pick(hp) : pick(al);
    if (tgt) { callArtillery(tgt.x + rand(-80, 80), tgt.y + rand(-80, 80), AXIS, null, 6, 160); gtoast('Enemy artillery!', 'Shells incoming — move out of the red zone', 'red'); gsfx('alarm'); }
  }
  panzerT -= dt; if (panzerT <= 0 && !G.tanks.some((t) => t.team === AXIS)) { panzerT = 9999; spawnPanzer(); }
  ambientT -= dt;
  if (ambientT <= 0) {
    ambientT = rand(2.5, 6);
    const c = pick(humanPoints()) || G.cam;
    const a = rand(6.28), r = rand(900, 1600), x = clamp(c.x + Math.cos(a) * r, 200, WW - 200), y = clamp(c.y + Math.sin(a) * r, 100, WH - 100);
    if (!G.objectives.some((o) => dist2(o.x, o.y, x, y) < 300 * 300)) explode(x, y, { r: 90, dmg: 0, team: -1, fxOnly: true, destroy: false });
  }
  // timers / end
  G.timer -= dt;
  if (G.timer <= 0) { G.timer = 0; endGame(false, 'The clock ran out. The assault stalled before the German line broke.'); }
  if (G.tickets <= 0 && (G.humans.every((h) => h.dead) || !G.units.some((u) => u.team === ALLY))) endGame(false, 'Allied reinforcements are exhausted. The push has failed.');
  if (G.mode === 'dead' && G.time - G.me.deathT > 0.5) updateDeathUI();
  if (isHostMP()) hostNetTick(dt);
}

// ---------------- CAMERA + VISION ----------------
function updateCamera(dt) {
  const v = HM.tank || HM.s; if (!v) return;
  const base = clamp(Math.sqrt(W * H) / 1180, 0.42, 1.35);
  const p = HM.s;
  const scoped = p && p.alive && p.ads && p.weapon.def.key === 'springfield' && !HM.tank;
  const targetZoom = base * (HM.tank ? 0.82 : scoped ? 0.74 : 1);
  G.cam.zoom = lerp(G.cam.zoom || targetZoom, targetZoom, Math.min(1, dt * 5));
  let ox = 0, oy = 0;
  if (G.mode === 'play' && !Input.touch.enabled) {
    const k = scoped ? 0.85 : p && p.ads ? 0.5 : 0.28;
    ox = (Input.mouse.sx - W / 2) / G.cam.zoom * k; oy = (Input.mouse.sy - H / 2) / G.cam.zoom * k;
  } else if (Input.touch.enabled && v) { ox = Math.cos(v.angle ?? v.ta) * 140; oy = Math.sin(v.angle ?? v.ta) * 140; }
  const tx = v.x + ox, ty = v.y + oy;
  G.cam.x = lerp(G.cam.x, tx, Math.min(1, dt * 7)); G.cam.y = lerp(G.cam.y, ty, Math.min(1, dt * 7));
  const hw = W / 2 / G.cam.zoom, hh = H / 2 / G.cam.zoom;
  G.cam.x = clamp(G.cam.x, Math.min(hw, WW / 2), Math.max(WW - hw, WW / 2)); G.cam.y = clamp(G.cam.y, Math.min(hh, WH / 2), Math.max(WH - hh, WH / 2));
}
function computeVision() {
  const v = HM.tank || HM.s; if (!v) return;
  const p = HM.s;
  const aim = HM.tank ? HM.tank.ta : p.angle;
  const scoped = p.ads && p.weapon.def.key === 'springfield' && !HM.tank;
  const cone = HM.tank ? 0.85 : scoped ? 0.32 : p.ads ? 0.6 : 0.85;
  const far = HM.tank ? 1250 : scoped ? 2000 : p.ads ? 1350 : 1150;
  const near = HM.tank ? 380 : 230;
  const n = 260; vis.n = n; vis.ox = v.x; vis.oy = v.y; vis.a0 = -Math.PI; vis.step = (Math.PI * 2) / n;
  if (!vis.d || vis.d.length !== n) vis.d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = vis.a0 + i * vis.step; const off = Math.abs(angDiff(aim, a));
    const range = off < cone ? far : off < cone + 0.35 ? lerp(far, near, (off - cone) / 0.35) : near;
    vis.d[i] = rayDist(v.x, v.y, a, range);
  }
}
function visibleToPlayer(x, y, pad = 0) {
  if (!vis.d) return false;
  const a = Math.atan2(y - vis.oy, x - vis.ox); let i = Math.round((a - vis.a0) / vis.step) % vis.n; if (i < 0) i += vis.n;
  const d = dist(vis.ox, vis.oy, x, y);
  return d <= vis.d[i] + pad;
}

// ---------------- RENDER ----------------
const C = { ally: '#5d6640', allyDark: '#3f4529', allyHelm: '#4e5532', axis: '#596262', axisDark: '#3b4141', axisHelm: '#4a5150', stalker: '#3e4836', skin: '#c7a07c' };
let grainC = null;
function makeGrain() { grainC = document.createElement('canvas'); grainC.width = grainC.height = 256; const g = grainC.getContext('2d'); const im = g.createImageData(256, 256); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 22; } g.putImageData(im, 0, 0); }
makeGrain();

function worldTransform(c) {
  const z = G.cam.zoom * DPR; const sx = (Math.random() - 0.5) * G.cam.shake, sy = (Math.random() - 0.5) * G.cam.shake;
  c.setTransform(z, 0, 0, z, W * DPR / 2 - G.cam.x * z + sx * DPR, H * DPR / 2 - G.cam.y * z + sy * DPR);
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#17130e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!terrain || !HM.s) return;
  computeVision();
  worldTransform(ctx);
  const z = G.cam.zoom; const hw = W / 2 / z, hh = H / 2 / z;
  const vx0 = Math.max(0, G.cam.x - hw - 40), vy0 = Math.max(0, G.cam.y - hh - 40), vx1 = Math.min(WW, G.cam.x + hw + 40), vy1 = Math.min(WH, G.cam.y + hh + 40);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrain, vx0, vy0, vx1 - vx0, vy1 - vy0, vx0, vy0, vx1 - vx0, vy1 - vy0);
  const onScreen = (x, y, m = 80) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
  // objectives
  G.objectives.forEach((o, i) => drawObjective(o, i));
  for (const w of G.wrecks) if (onScreen(w.x, w.y)) drawTank({ ...w, wreck: true, hp: 0, maxHp: 1, track: 0 });
  for (const c of G.corpses) if (onScreen(c.x, c.y)) drawCorpse(c);
  for (const c of G.crates) drawCrate(c);
  for (const g of G.grenades) drawGrenade(g);
  // units
  for (const u of G.units) {
    if (!u.alive || !onScreen(u.x, u.y)) continue;
    if (u.team === AXIS) {
      const seen = visibleToPlayer(u.x, u.y, 6) && (!inSmoke(u.x, u.y) || dist(vis.ox, vis.oy, u.x, u.y) < 90);
      if (!seen) continue;
    }
    drawSoldier(u);
  }
  for (const tk of G.tanks) if (onScreen(tk.x, tk.y, 120)) { if (tk.team === AXIS && !visibleToPlayer(tk.x, tk.y, 50) && G.time - tk.lastFire > 0.6) continue; drawTank(tk); }
  drawParticles(onScreen, false);
  // fog of war
  drawFog();
  worldTransform(ctx);
  drawParticles(onScreen, true);
  // above-fog: tracers, lasers, marks, planes
  for (const b of G.bullets) {
    const len = b.owner && b.owner.role === 'sniper' ? 0.04 : 0.018;
    const tx = b.x - b.vx * len, ty = b.y - b.vy * len;
    ctx.strokeStyle = b.team === ALLY ? 'rgba(255,226,150,0.85)' : 'rgba(255,170,120,0.85)'; ctx.lineWidth = b.sniper ? 2.2 : 1.5;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const s of G.shells) if (s.kind === 'shell') { ctx.fillStyle = '#ffd38a'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 7); ctx.fill(); }
  for (const l of G.lasers) {
    ctx.strokeStyle = `rgba(255,60,40,${0.12 + l.p * 0.5})`; ctx.lineWidth = l.atPlayer ? 1.4 + l.p * 1.4 : 1;
    ctx.setLineDash(l.p > 0.8 ? [] : [10, 8]); ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.tx, l.ty); ctx.stroke(); ctx.setLineDash([]);
    const gl = 6 + Math.sin(G.time * 30) * 3 + l.p * 10;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, gl * 2); g.addColorStop(0, 'rgba(255,255,230,0.95)'); g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, l.y, gl * 2, 0, 7); ctx.fill();
  }
  // hidden enemy muzzle flashes
  for (const u of G.units) if (u.team === AXIS && G.time - u.lastShot < 0.06 && !visibleToPlayer(u.x, u.y)) {
    const mx = u.x + Math.cos(u.angle) * 24, my = u.y + Math.sin(u.angle) * 24;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, 26); g.addColorStop(0, 'rgba(255,220,140,0.9)'); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill();
  }
  for (const m of G.artyMarks) {
    const pulse = 0.5 + Math.sin(G.time * 8) * 0.25;
    ctx.strokeStyle = m.team === ALLY ? `rgba(230,200,110,${pulse})` : `rgba(230,70,50,${pulse})`; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = m.team === ALLY ? 'rgba(230,200,110,0.07)' : 'rgba(230,70,50,0.1)'; ctx.fill();
  }
  for (const s of G.shells) if (s.kind === 'bomb') { const k = s.t / 0.6; ctx.fillStyle = `rgba(0,0,0,${0.5 - k * 0.3})`; ctx.beginPath(); ctx.ellipse(s.x, s.y, 6 + k * 6, 4 + k * 4, 0, 0, 7); ctx.fill(); }
  for (const s of G.spotted) { const u = s.u; ctx.save(); ctx.translate(u.x, u.y - 26); ctx.rotate(Math.PI / 4); ctx.strokeStyle = '#e8573f'; ctx.lineWidth = 2.5; ctx.strokeRect(-6, -6, 12, 12); ctx.restore(); }
  for (const p of G.planes) drawPlane(p);
  // flashes (additive)
  ctx.globalCompositeOperation = 'lighter';
  for (const f of G.flashes) { const k = f.life / f.max; const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r); g.addColorStop(0, `rgba(255,200,120,${0.5 * k})`); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  // friendly markers
  ctx.font = '600 11px "IBM Plex Sans Condensed", sans-serif'; ctx.textAlign = 'center';
  for (const u of G.units) if (u.team === ALLY && !u.isPlayer && onScreen(u.x, u.y)) { ctx.fillStyle = 'rgba(170,200,110,0.9)'; ctx.beginPath(); ctx.moveTo(u.x - 4, u.y - 24); ctx.lineTo(u.x + 4, u.y - 24); ctx.lineTo(u.x, u.y - 19); ctx.fill(); }
  // reticle / mark
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1; ctx.drawImage(grainC, rand(-128, 0), rand(-128, 0), W + 256, H + 256);
  drawReticle();
}
function drawFog() {
  const f = fctx; const s = DPR / 2;
  f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, fogC.width, fogC.height);
  f.fillStyle = 'rgba(16,12,8,0.8)'; f.fillRect(0, 0, fogC.width, fogC.height);
  const z = G.cam.zoom * s;
  f.setTransform(z, 0, 0, z, fogC.width / 2 - G.cam.x * z, fogC.height / 2 - G.cam.y * z);
  f.globalCompositeOperation = 'destination-out';
  f.fillStyle = '#000'; f.beginPath();
  for (let i = 0; i < vis.n; i++) { const a = vis.a0 + i * vis.step; const x = vis.ox + Math.cos(a) * vis.d[i], y = vis.oy + Math.sin(a) * vis.d[i]; i ? f.lineTo(x, y) : f.moveTo(x, y); }
  f.closePath(); f.fill();
  f.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogC, 0, 0, canvas.width, canvas.height);
}
function drawObjective(o, i) {
  const col = o.state === 'captured' ? '170,190,110' : o.state === 'active' ? '226,190,96' : '200,90,70';
  const pulse = o.state === 'active' ? 0.5 + Math.sin(G.time * 3) * 0.2 : 0.3;
  ctx.fillStyle = `rgba(${col},${o.state === 'active' ? 0.08 : 0.04})`; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(${col},${pulse})`; ctx.lineWidth = 3; ctx.setLineDash(o.state === 'active' ? [18, 10] : [6, 10]); ctx.lineDashOffset = -G.time * 20;
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  if (o.state === 'active' && o.progress > 0) { ctx.strokeStyle = 'rgba(190,210,120,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(o.x, o.y, o.r - 6, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); ctx.stroke(); }
  // flagpole
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(o.x + 3, o.y + 3, 5, 3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2c241a'; ctx.beginPath(); ctx.arc(o.x, o.y, 3.5, 0, 7); ctx.fill();
  const allyFlag = o.state === 'captured' || (o.state === 'active' && o.progress > 0.5);
  const wave = Math.sin(G.time * 4 + i) * 2;
  ctx.save(); ctx.translate(o.x, o.y);
  ctx.fillStyle = allyFlag ? '#56603a' : '#7a3a2c';
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(14, -8 + wave, 30, -2 + wave); ctx.lineTo(30, 16 + wave); ctx.quadraticCurveTo(14, 10 + wave, 0, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8e0c8';
  if (allyFlag) star(ctx, 15, 7 + wave * 0.5, 5.5); else { ctx.fillRect(12, 2 + wave * 0.5, 6, 10); ctx.fillRect(10, 5 + wave * 0.5, 10, 4); ctx.fillStyle = '#1a1a1a'; ctx.fillRect(13.5, 3 + wave * 0.5, 3, 8); ctx.fillRect(11, 6 + wave * 0.5, 8, 2); }
  ctx.restore();
  ctx.font = '700 22px "Big Shoulders Stencil Display", sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(${col},0.9)`; ctx.fillText(o.name, o.x, o.y - o.r - 10);
}
function star(c, x, y, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); }
function drawSoldier(u) {
  const c = ctx; c.save(); c.translate(u.x, u.y);
  let alpha = 1;
  if (u.role === 'stalker' && u.ai && !u.moving && u.ai.still > 0.4) alpha = 0.5;
  c.globalAlpha = alpha;
  c.fillStyle = 'rgba(0,0,0,0.32)'; c.beginPath(); c.ellipse(3, 4, 13, 11, 0, 0, 7); c.fill();
  c.rotate(u.angle);
  const ally = u.team === ALLY;
  const body = ally ? C.ally : u.role === 'stalker' ? C.stalker : C.axis, dark = ally ? C.allyDark : C.axisDark;
  // legs
  if (u.moving) { const s = Math.sin(u.walk) * 6; c.fillStyle = dark; c.beginPath(); c.ellipse(s, -5, 5, 3.5, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(-s, 5, 5, 3.5, 0, 0, 7); c.fill(); }
  // pack
  c.fillStyle = dark; c.beginPath(); c.roundRect(-11, -7, 7, 14, 3); c.fill();
  // body
  c.fillStyle = u.hitFlash > 0 ? '#e9d8c0' : body; c.beginPath(); c.ellipse(0, 0, 8, 12, 0, 0, 7); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
  if (u.role === 'stalker') { c.fillStyle = '#2c3326'; for (const [x, y] of [[-3, -6], [2, 5], [-4, 4], [3, -3]]) { c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); } }
  if (u.role === 'sniper') { c.strokeStyle = '#4d5a3a'; c.lineWidth = 1.5; for (let i = 0; i < 7; i++) { const a = i * 0.9; c.beginPath(); c.moveTo(Math.cos(a) * 6, Math.sin(a) * 8); c.lineTo(Math.cos(a) * 12, Math.sin(a) * 13); c.stroke(); } }
  if (u.role === 'rusher') { c.strokeStyle = '#8d7a52'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, -9); c.lineTo(5, 9); c.stroke(); }
  // weapon + arms
  const w = u.weapon.def; const len = w.len;
  const recoil = G.time - u.lastShot < 0.07 ? -3 : 0;
  c.fillStyle = C.skin; c.beginPath(); c.arc(9 + recoil, 4, 2.6, 0, 7); c.fill();
  c.fillStyle = '#3a2a1b'; c.fillRect(2 + recoil, 1.5, len * 0.55, 4);
  c.fillStyle = '#1f1f1f'; c.fillRect(2 + recoil + len * 0.45, 2.3, len * 0.6, 2.4);
  if (w.key === 'springfield' || w.key === 'kar98s') { c.fillStyle = '#111'; c.fillRect(8 + recoil, 0.5, 10, 2); }
  if (w.key === 'thompson' || w.key === 'mp40') { c.fillStyle = '#1f1f1f'; c.fillRect(10 + recoil, 4, 3, 6); }
  if (w.key === 'bar' || w.key === 'mg42') { c.fillStyle = '#1f1f1f'; c.fillRect(12 + recoil, 4.5, 3, 5); }
  c.fillStyle = C.skin; c.beginPath(); c.arc(len * 0.6 + recoil, 4.5, 2.4, 0, 7); c.fill();
  // muzzle flash
  if (G.time - u.lastShot < 0.05) { c.fillStyle = 'rgba(255,220,130,0.95)'; c.beginPath(); c.moveTo(len + 4, 3.5); c.lineTo(len + 16, 0); c.lineTo(len + 13, 3.5); c.lineTo(len + 16, 7); c.closePath(); c.fill(); }
  // helmet
  if (ally) { c.fillStyle = C.allyHelm; c.beginPath(); c.arc(1, 0, 7.2, 0, 7); c.fill(); c.strokeStyle = 'rgba(30,34,18,0.6)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-5, -4); c.lineTo(6, 4); c.moveTo(-5, 4); c.lineTo(6, -4); c.stroke(); }
  else { c.fillStyle = u.role === 'stalker' ? '#36402e' : C.axisHelm; c.beginPath(); c.ellipse(0, 0, 8.2, 8.6, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.08)'; c.beginPath(); c.arc(1, -1, 5, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1; c.beginPath(); c.ellipse(0, 0, 8.2, 8.6, 0, 0, 7); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.arc(-1, -2, 3, 0, 7); c.fill();
  c.restore();
  if (u.isPlayer && u.pid !== G.me.pid && u.name) {
    c.font = '600 12px "IBM Plex Sans Condensed", sans-serif'; c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillText(u.name, u.x + 1, u.y - 27);
    c.fillStyle = '#9fd0e8'; c.fillText(u.name, u.x, u.y - 28);
    c.strokeStyle = 'rgba(140,200,230,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.arc(u.x, u.y, 17, 0, 7); c.stroke();
  } else if (u.isPlayer) {
    c.strokeStyle = 'rgba(232,210,140,0.75)'; c.lineWidth = 1.5; c.beginPath(); c.arc(u.x, u.y, 17, 0, 7); c.stroke();
    if (G.time - u.spawnT < 2.2) { c.strokeStyle = `rgba(232,210,140,${0.5 + Math.sin(G.time * 12) * 0.3})`; c.beginPath(); c.arc(u.x, u.y, 21, 0, 7); c.stroke(); }
  }
  c.globalAlpha = 1;
}
function drawCorpse(k) {
  const c = ctx; const age = G.time - k.t; const a = age > 50 ? Math.max(0, 1 - (age - 50) / 10) : 1; if (a <= 0) return;
  c.save(); c.globalAlpha = a * 0.9; c.translate(k.x, k.y); c.rotate(k.a);
  const ally = k.team === ALLY;
  c.fillStyle = ally ? '#4a5134' : k.role === 'stalker' ? '#343d2e' : '#4a5252';
  c.beginPath(); c.ellipse(0, 0, 13, 7, 0, 0, 7); c.fill();
  c.fillStyle = ally ? '#3f462a' : '#3c4342'; c.beginPath(); c.ellipse(-8, 6, 9, 3, 0.4, 0, 7); c.fill(); c.beginPath(); c.ellipse(-8, -5, 9, 3, -0.3, 0, 7); c.fill();
  c.fillStyle = ally ? C.allyHelm : C.axisHelm; c.beginPath(); c.arc(14, 2, 6.5, 0, 7); c.fill();
  c.fillStyle = '#2a2018'; c.fillRect(-4, 10, k.wlen || 20, 3);
  c.restore(); c.globalAlpha = 1;
}
function drawCrate(k) { const c = ctx; c.save(); c.translate(k.x, k.y); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-9, -6, 22, 16); c.fillStyle = '#5d5532'; c.fillRect(-11, -8, 22, 16); c.strokeStyle = '#2d2a18'; c.lineWidth = 1.5; c.strokeRect(-11, -8, 22, 16); c.fillStyle = '#d6c48a'; c.font = '700 8px "IBM Plex Sans Condensed"'; c.textAlign = 'center'; c.fillText('AMMO', 0, 3); c.strokeStyle = 'rgba(214,196,138,0.35)'; c.setLineDash([4, 6]); c.beginPath(); c.arc(0, 0, 80, 0, 7); c.stroke(); c.setLineDash([]); c.restore(); }
function drawGrenade(g) {
  const h = Math.max(0, Math.sin(Math.min(1, g.t / 0.75) * Math.PI)) * 10;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(g.x + 2, g.y + 2, 4, 3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = g.type === 'smoke' ? '#8a8a7a' : g.type === 'at' ? '#4d4a30' : '#4b5233';
  ctx.beginPath(); ctx.arc(g.x, g.y - h, g.type === 'at' ? 5.5 : 4.5, 0, 7); ctx.fill();
  if (g.type !== 'smoke' && g.fuse < 0.8 && Math.sin(G.time * 40) > 0) { ctx.fillStyle = 'rgba(255,90,60,0.8)'; ctx.beginPath(); ctx.arc(g.x, g.y - h, 2, 0, 7); ctx.fill(); }
}
function drawTank(tk) {
  const c = ctx; const ally = tk.team === ALLY;
  c.save(); c.translate(tk.x, tk.y);
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.save(); c.rotate(tk.a); c.fillRect(-38, -22, 84, 52); c.restore();
  c.rotate(tk.a);
  const hull = tk.wreck ? '#2e2a24' : tk.hitFlash > 0 ? '#c8bfa8' : ally ? '#5a6239' : '#535a57';
  // tracks
  for (const s of [-1, 1]) {
    c.fillStyle = '#24221e'; c.fillRect(-42, s * 19 - 7, 84, 14);
    c.strokeStyle = '#3a3730'; c.lineWidth = 2;
    const off = (tk.track * (s > 0 ? 1 : 1)) % 7;
    for (let x = -42 + off; x < 42; x += 7) { c.beginPath(); c.moveTo(x, s * 19 - 7); c.lineTo(x, s * 19 + 7); c.stroke(); }
  }
  c.fillStyle = hull; c.beginPath(); c.roundRect(-38, -15, 76, 30, ally ? 7 : 3); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(-36, -13, 72, 5);
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; for (let k = -34; k < -20; k += 3) { c.beginPath(); c.moveTo(k, -10); c.lineTo(k, 10); c.stroke(); }
  if (!ally && !tk.wreck) { c.fillStyle = '#ddd'; c.fillRect(20, -15, 6, 2); c.fillRect(22, -17, 2, 6); c.fillStyle = '#111'; c.fillRect(21, -15, 4, 1); }
  c.rotate((tk.ta ?? tk.a) - tk.a);
  // turret
  c.fillStyle = tk.wreck ? '#25221d' : ally ? '#525a33' : '#4a504e';
  const rec = G.time - (tk.lastFire || -9) < 0.15 ? -6 : 0;
  c.fillRect(8 + rec, -3.5, ally ? 40 : 50, 7);
  c.fillStyle = '#2b2b26'; c.fillRect((ally ? 44 : 54) + rec, -4.5, 6, 9);
  c.fillStyle = tk.wreck ? '#25221d' : ally ? '#5e6739' : '#565d5a';
  if (ally) { c.beginPath(); c.ellipse(-2, 0, 17, 15, 0, 0, 7); c.fill(); } else { c.beginPath(); c.roundRect(-16, -13, 30, 26, 3); c.fill(); }
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(-6, -5, 4.5, 0, 7); c.fill();
  if (ally && !tk.wreck) { c.fillStyle = '#e4dcc4'; star(c, 2, 4, 6); }
  c.restore();
  if (!tk.wreck && tk.playerOwned && tk.pid !== G.me.pid) { const h = humanByPid(tk.pid); if (h) { c.font = '600 12px "IBM Plex Sans Condensed", sans-serif'; c.textAlign = 'center'; c.fillStyle = '#9fd0e8'; c.fillText(h.name, tk.x, tk.y - 44); } }
  if (!tk.wreck && tk.team === AXIS) { const w = 60, k = tk.hp / tk.maxHp; c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(tk.x - w / 2, tk.y - 50, w, 5); c.fillStyle = '#c8553d'; c.fillRect(tk.x - w / 2, tk.y - 50, w * k, 5); }
  if (tk.wreck && Math.random() < 0.15) G.particles.push({ type: 'smoke', x: tk.x + rand(-10, 10), y: tk.y, vx: rand(-10, 10), vy: rand(-30, -10), life: 3, max: 3, size: 8, grow: 18, a: 0.35, dark: true });
}
function drawPlane(p) {
  const c = ctx;
  // shadow
  c.save(); c.translate(p.x + 70, p.y + 110); c.fillStyle = 'rgba(0,0,0,0.28)'; planeShape(c, 1.5); c.fill(); c.restore();
  c.save(); c.translate(p.x, p.y); c.scale(1.9, 1.9);
  c.fillStyle = '#6a6c48'; planeShape(c, 1); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.8; c.stroke();
  // invasion stripes
  c.fillStyle = '#e8e3d2'; c.fillRect(-2, -40, 4, 30); c.fillRect(-2, 10, 4, 30); c.fillRect(6, -40, 4, 30); c.fillRect(6, 10, 4, 30);
  c.fillStyle = '#1b1b1b'; c.fillRect(2, -40, 4, 30); c.fillRect(2, 10, 4, 30);
  c.fillStyle = '#e8e3d2'; star(c, 0, -26, 5); star(c, 0, 26, 5);
  c.fillStyle = '#2d3a44'; c.beginPath(); c.ellipse(14, 0, 6, 3.5, 0, 0, 7); c.fill();
  c.fillStyle = 'rgba(220,220,210,0.25)'; c.beginPath(); c.ellipse(34, 0, 2, 15, 0, 0, 7); c.fill();
  c.restore();
}
function planeShape(c, s) {
  c.beginPath();
  c.moveTo(33 * s, 0); c.quadraticCurveTo(30 * s, -6 * s, 20 * s, -6 * s); c.lineTo(10 * s, -6 * s); c.lineTo(8 * s, -42 * s); c.lineTo(-2 * s, -42 * s); c.lineTo(-6 * s, -6 * s); c.lineTo(-22 * s, -4 * s); c.lineTo(-26 * s, -14 * s); c.lineTo(-32 * s, -14 * s); c.lineTo(-31 * s, 0);
  c.lineTo(-32 * s, 14 * s); c.lineTo(-26 * s, 14 * s); c.lineTo(-22 * s, 4 * s); c.lineTo(-6 * s, 6 * s); c.lineTo(-2 * s, 42 * s); c.lineTo(8 * s, 42 * s); c.lineTo(10 * s, 6 * s); c.lineTo(20 * s, 6 * s); c.quadraticCurveTo(30 * s, 6 * s, 33 * s, 0); c.closePath();
}
function drawParticles(onScreen, above) {
  const c = ctx;
  for (const p of G.particles) {
    const isAbove = p.type === 'fire' || p.type === 'spark' || p.type === 'ring' || (p.type === 'smoke' && p.smoke);
    if (isAbove !== above) continue;
    if (!onScreen(p.x, p.y, p.size + 20)) continue;
    const k = p.life / p.max;
    switch (p.type) {
      case 'smoke': c.fillStyle = p.dark ? `rgba(40,36,32,${p.a * k})` : p.smoke ? `rgba(170,168,156,${p.a * Math.min(1, k * 2)})` : `rgba(120,112,98,${p.a * k})`; c.beginPath(); c.arc(p.x, p.y, p.size, 0, 7); c.fill(); break;
      case 'dust': c.fillStyle = `rgba(140,120,90,${p.a * k})`; c.beginPath(); c.arc(p.x, p.y, p.size, 0, 7); c.fill(); break;
      case 'fire': c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,${Math.floor(140 + 100 * k)},${Math.floor(60 * k)},${k})`; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; break;
      case 'spark': c.fillStyle = `rgba(255,230,160,${k})`; c.fillRect(p.x, p.y, 2, 2); break;
      case 'dirt': c.fillStyle = `rgba(70,56,38,${k})`; c.fillRect(p.x, p.y, p.size, p.size); break;
      case 'blood': c.fillStyle = `rgba(120,20,16,${k})`; c.beginPath(); c.arc(p.x, p.y, p.size, 0, 7); c.fill(); break;
      case 'casing': c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = '#c9a24a'; c.fillRect(-2, -1, 4, 2); c.restore(); break;
      case 'ring': c.strokeStyle = `rgba(255,230,190,${k * 0.6})`; c.lineWidth = 3 * k; c.beginPath(); c.arc(p.x, p.y, p.size * (1 - k), 0, 7); c.stroke(); break;
    }
  }
}
function drawReticle() {
  const p = HM.s; if (!p || !p.alive || G.mode !== 'play' || Input.touch.enabled) return;
  const x = Input.mouse.sx, y = Input.mouse.sy, c = ctx;
  if (HM.mark) {
    c.strokeStyle = 'rgba(232,200,110,0.95)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 34, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(x - 46, y); c.lineTo(x - 20, y); c.moveTo(x + 20, y); c.lineTo(x + 46, y); c.moveTo(x, y - 46); c.lineTo(x, y - 20); c.moveTo(x, y + 20); c.lineTo(x, y + 46); c.stroke();
    return;
  }
  if (HM.tank) { const k = clamp(1 - HM.tank.reload / 1.9, 0, 1); c.strokeStyle = 'rgba(232,220,190,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 16, 0, 7); c.stroke(); c.strokeStyle = 'rgba(200,220,120,0.95)'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke(); return; }
  const w = p.weapon.def; const sp = (w.spread + (p.moving ? 0.018 : 0) + p.recoil - (p.ads ? w.spread * 0.6 : 0) + (w.key === 'springfield' && !p.ads ? 0.06 : 0));
  const dd = dist(p.x, p.y, Input.mouse.wx, Input.mouse.wy) * G.cam.zoom; const gap = clamp(4 + Math.tan(Math.max(0, sp)) * dd, 4, 80);
  c.strokeStyle = 'rgba(240,232,210,0.9)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - gap - 8, y); c.lineTo(x - gap, y); c.moveTo(x + gap, y); c.lineTo(x + gap + 8, y); c.moveTo(x, y - gap - 8); c.lineTo(x, y - gap); c.moveTo(x, y + gap); c.lineTo(x, y + gap + 8); c.stroke();
  c.fillStyle = 'rgba(240,232,210,0.9)'; c.fillRect(x - 1, y - 1, 2, 2);
  if (p.reloadT > 0) { const k = 1 - p.reloadT / w.reload; c.strokeStyle = 'rgba(226,190,96,0.9)'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke(); }
  if (G.hitmarker > 0) { c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 2; const s = 6, o = 10; c.beginPath(); c.moveTo(x - o - s, y - o - s); c.lineTo(x - o, y - o); c.moveTo(x + o + s, y - o - s); c.lineTo(x + o, y - o); c.moveTo(x - o - s, y + o + s); c.lineTo(x - o, y + o); c.moveTo(x + o + s, y + o + s); c.lineTo(x + o, y + o); c.stroke(); }
}

// ---------------- HUD ----------------
const hud = {
  root: $('#hud'), tickets: $('#tickets'), timer: $('#timer'), objLabel: $('#objlabel'), capFill: $('#capfill'), capState: $('#capstate'), pips: [...document.querySelectorAll('.pip')],
  hpFill: $('#hpfill'), hpNum: $('#hpnum'), stam: $('#stamfill'), cls: $('#clsname'), abName: $('#abname'), abFill: $('#abfill'), weap: $('#weapname'), ammo: $('#ammo'), reserve: $('#reserve'), nades: $('#nades'), alt: $('#altweap'),
  bp: $('#bp'), callins: [...document.querySelectorAll('.callin')], feed: $('#feed'), toasts: $('#toasts'), popups: $('#popups'), mm: $('#minimap'), vign: $('#hurt'), tankHud: $('#tankhud'), tankHp: $('#tankhp'), tankTime: $('#tanktime'), markHint: $('#markhint'), infHud: $('#infhud'), axisLeft: $('#axiscount'),
};
const cache = new Map();
function setT(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } }
function fmt(t) { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function updateHUD() {
  if (!HM.s) return;
  const p = HM.s, o = G.objectives[G.active];
  setT(hud.tickets, String(G.tickets));
  setT(hud.timer, fmt(G.timer)); hud.timer.classList.toggle('low', G.timer < 45);
  if (o) {
    setT(hud.objLabel, `Capture ${o.name}`);
    hud.capFill.style.transform = `scaleX(${o.progress})`;
    setT(hud.capState, o.contested ? 'Contested' : o.playerIn ? (o.allies > 0 ? `Capturing ×${o.allies}` : '') : o.progress > 0 ? `${Math.round(o.progress * 100)}%` : `${Math.round(dist(p.x, p.y, o.x, o.y) / 32)} m`);
    hud.capState.classList.toggle('contested', !!o.contested);
  }
  hud.pips.forEach((el, i) => { el.dataset.state = G.objectives[i].state; });
  const hpk = clamp(p.hp / p.maxHp, 0, 1); hud.hpFill.style.transform = `scaleX(${hpk})`; hud.hpFill.classList.toggle('low', hpk < 0.35);
  setT(hud.hpNum, String(Math.ceil(Math.max(0, p.hp))));
  hud.stam.style.transform = `scaleX(${p.stamina / 100})`;
  const cls = CLASSES[p.cls]; setT(hud.cls, cls.name); setT(hud.abName, cls.abilityName);
  const abk = G.time >= HM.abilityReady ? 1 : 1 - (HM.abilityReady - G.time) / cls.abilityCd; hud.abFill.style.transform = `scaleX(${abk})`; hud.abFill.parentElement.parentElement.classList.toggle('ready', abk >= 1);
  const w = p.weapon; setT(hud.weap, w.def.name); setT(hud.ammo, p.reloadT > 0 ? '··' : String(w.mag)); setT(hud.reserve, String(w.reserve));
  hud.ammo.classList.toggle('low', w.mag <= Math.ceil(w.def.mag * 0.25));
  setT(hud.alt, p.weapons[1 - p.wi] ? `${p.wi === 0 ? '2' : '1'} · ${p.weapons[1 - p.wi].def.name}` : '');
  setT(hud.nades, `${p.grenades} × ${p.gtype === 'at' ? 'AT grenade' : 'Frag'}`);
  setT(hud.bp, String(HM.bp));
  hud.callins.forEach((el, i) => {
    const c = CALLINS[i]; const cd = HM.callCd[c.id] > G.time ? HM.callCd[c.id] - G.time : 0;
    el.classList.toggle('afford', HM.bp >= c.cost && !cd && !HM.tank); el.classList.toggle('marking', HM.mark === c.id);
    el.querySelector('.cd').style.transform = `scaleY(${cd ? cd / c.cd : 0})`;
  });
  const tk = HM.tank; hud.tankHud.hidden = !tk; hud.infHud.classList.toggle('dim', !!tk);
  if (tk) { hud.tankHp.style.transform = `scaleX(${tk.hp / tk.maxHp})`; setT(hud.tankTime, fmt(tk.life)); }
  hud.markHint.hidden = !HM.mark;
  hud.vign.style.opacity = String(clamp(G.hurt * 0.9 + (p.hp < 35 && p.alive ? 0.35 + Math.sin(G.time * 5) * 0.1 : 0), 0, 1));
  setT(hud.axisLeft, String(G.units.filter((u) => u.team === AXIS).length));
}
let mmT = 0;
function drawMinimap() {
  const m = hud.mm; if (!m || !mini) return;
  const c = m.getContext('2d'); const sx = m.width / WW, sy = m.height / WH;
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(mini, 0, 0, m.width, m.height);
  c.fillStyle = 'rgba(20,16,10,0.25)'; c.fillRect(0, 0, m.width, m.height);
  for (const o of G.objectives) { c.fillStyle = o.state === 'captured' ? '#a9bd6e' : o.state === 'active' ? '#e2be60' : '#c8553d'; c.beginPath(); c.arc(o.x * sx, o.y * sy, o.state === 'active' ? 5 : 3.5, 0, 7); c.fill(); c.font = '700 10px "IBM Plex Sans Condensed"'; c.fillStyle = '#f0e6cc'; c.textAlign = 'center'; c.fillText(o.name, o.x * sx, o.y * sy - 7); }
  for (const u of G.units) {
    if (u.team === ALLY && !u.isPlayer) { c.fillStyle = '#b5c97a'; c.fillRect(u.x * sx - 1.5, u.y * sy - 1.5, 3, 3); }
    else if (u.isPlayer && u !== HM.s) { c.fillStyle = '#9fd0e8'; c.beginPath(); c.arc(u.x * sx, u.y * sy, 2.6, 0, 7); c.fill(); }
    else if (u.team === AXIS && (G.spotted.some((s) => s.u === u) || visibleToPlayer(u.x, u.y))) { c.fillStyle = '#e8573f'; c.fillRect(u.x * sx - 1.5, u.y * sy - 1.5, 3, 3); }
  }
  for (const tk of G.tanks) { c.fillStyle = tk.team === ALLY ? '#e2be60' : '#e8573f'; c.fillRect(tk.x * sx - 3, tk.y * sy - 3, 6, 6); }
  for (const mk of G.artyMarks) { c.strokeStyle = mk.team === ALLY ? '#e2be60' : '#e8573f'; c.beginPath(); c.arc(mk.x * sx, mk.y * sy, mk.r * sx, 0, 7); c.stroke(); }
  const v = HM.tank || HM.s;
  if (v) { c.fillStyle = '#fff'; c.beginPath(); c.arc(v.x * sx, v.y * sy, 3, 0, 7); c.fill(); }
  const hw = W / 2 / G.cam.zoom, hh = H / 2 / G.cam.zoom; c.strokeStyle = 'rgba(240,230,200,0.5)'; c.lineWidth = 1; c.strokeRect((G.cam.x - hw) * sx, (G.cam.y - hh) * sy, hw * 2 * sx, hh * 2 * sy);
}
function addFeed(a, how, b, ca, cb) {
  const el = document.createElement('div'); el.className = 'feed-item';
  el.innerHTML = `<span class="${ca}">${a}</span><span class="how">${how}</span><span class="${cb}">${b}</span>`;
  hud.feed.prepend(el); while (hud.feed.children.length > 6) hud.feed.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 6000); setTimeout(() => el.remove(), 6600);
}
// ---- feedback routing: personal (current human) vs global (everyone) ----
const ev = (e) => { if (G.ev) G.ev.push(e); };
function toast(title, sub, tone = 'gold') { if (!HM.local) { HM.pe.push(['T', title, sub, tone]); return; } showToast(title, sub, tone); }
function popup(text) { if (!HM.local) { HM.pe.push(['P', text]); return; } showPopup(text); }
function psfx(type) { if (!HM.local) { HM.pe.push(['s', type]); return; } sfx(type); }
function gtoast(title, sub, tone = 'gold') { showToast(title, sub, tone); ev(['T', title, sub, tone]); }
function gsfx(type) { sfx(type); ev(['s', type]); }
function feedNet(a, how, b, ca, cb, apid, bpid) {
  ev(['f', a, how, b, ca, cb, apid, bpid]);
  showFeed(a, how, b, ca, cb, apid, bpid);
}
function showFeed(a, how, b, ca, cb, apid, bpid) {
  const me = G.me.pid; addFeed(apid === me ? 'You' : esc(a), how, bpid === me ? 'You' : esc(b), ca, cb);
}
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function showToast(title, sub, tone = 'gold') {
  const el = document.createElement('div'); el.className = 'toast ' + tone; el.innerHTML = `<strong>${title}</strong><span>${sub}</span>`;
  hud.toasts.innerHTML = ''; hud.toasts.append(el); setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4400);
}
function showPopup(text) {
  const el = document.createElement('div'); el.className = 'popup'; el.textContent = text; hud.popups.append(el);
  while (hud.popups.children.length > 4) hud.popups.firstChild.remove(); setTimeout(() => el.remove(), 1800);
}

// ---------------- SCREENS ----------------
const screens = { title: $('#title'), loadout: $('#loadout'), coop: $('#coop'), lobby: $('#lobby'), pause: $('#pause'), death: $('#death'), end: $('#end') };
function show(name) { for (const [k, el] of Object.entries(screens)) el.hidden = k !== name; hud.root.hidden = !(G.mode === 'play' || G.mode === 'dead' || G.mode === 'paused'); }
function buildLoadoutCards(container, onPick) {
  container.innerHTML = '';
  for (const [key, c] of Object.entries(CLASSES)) {
    const w = WEAPONS[c.primary];
    const card = document.createElement('button'); card.className = 'cls-card'; card.dataset.cls = key; card.type = 'button';
    const bar = (v) => `<span class="bar"><span style="transform:scaleX(${clamp(v, 0.05, 1)})"></span></span>`;
    card.innerHTML = `<span class="cls-name">${c.name}</span><span class="cls-weap">${w.name}</span>
      <span class="stats"><span>Damage</span>${bar((w.dmg * (w.pellets || 1)) / 140)}<span>Rate</span>${bar(0.12 / w.rof)}<span>Range</span>${bar(w.range / 1900)}<span>Speed</span>${bar((c.speed - 110) / 55)}</span>
      <span class="cls-kit">M1911 · ${c.grenades}× ${c.gtype === 'at' ? 'AT grenade' : 'frag'} · <em>F</em> ${c.abilityName}</span>
      <span class="cls-blurb">${c.blurb}</span>`;
    card.classList.toggle('sel', key === G.cls);
    card.addEventListener('click', () => { G.cls = key; container.querySelectorAll('.cls-card').forEach((k) => k.classList.toggle('sel', k.dataset.cls === key)); sfx('click'); onPick && onPick(key); });
    container.append(card);
  }
}
function showDeath() {
  buildLoadoutCards($('#death-cards'));
  $('#death-btn').disabled = true; show('death');
}
function updateDeathUI() {
  const left = Math.max(0, 5 - (G.time - G.me.deathT));
  const btn = $('#death-btn'); btn.disabled = left > 0 || G.tickets <= 0 || CL.respawnSent;
  setT($('#death-timer'), G.tickets <= 0 ? 'No reinforcements left' : left > 0 ? `Reinforcements in ${Math.ceil(left)}` : 'Ready to deploy');
}
function canRespawn(h) { return h.dead && G.time - h.deathT >= 5 && G.tickets > 0; }
function doRespawn(h, cls) {
  if (!canRespawn(h)) return false;
  G.units = G.units.filter((u) => u !== h.s);
  if (CLASSES[cls]) h.cls = cls;
  withHuman(h, spawnPlayer); return true;
}
function respawn() {
  if (G.mode !== 'dead' || !canRespawn(G.me)) return;
  if (isClient()) { if (!CL.respawnSent) { CL.respawnSent = true; Net.send({ t: 'respawn', cls: G.cls }); } return; }
  if (doRespawn(G.me, G.cls)) { G.mode = 'play'; show(null); sfx('radio'); }
}
function endGame(win, reason) {
  if (G.mode === 'end') return;
  G.mode = 'end'; G.me.mark = null;
  if (isHostMP()) {
    flushSnapshot();
    Net.send({ t: 'end', win, reason: reason || '', caps: G.caps, time: G.time, squad: G.humans.map((h) => [h.pid, h.name, h.stats.kills, h.stats.deaths, h.stats.bpEarned]) });
  }
  showEnd(win, reason, G.caps, G.time, G.humans.map((h) => [h.pid, h.name, h.stats.kills, h.stats.deaths, h.stats.bpEarned]));
}
function showEnd(win, reason, caps, time, squad) {
  G.mode = 'end';
  const e = screens.end; e.dataset.win = win ? '1' : '0';
  $('#end-art').src = win ? './assets/victory.jpg' : './assets/defeat.jpg';
  $('#end-title').textContent = win ? 'Line Broken' : 'Push Failed';
  let sub = win ? 'All five objectives taken. The German line has collapsed.' : reason;
  const mine = squad.find((r) => r[0] === G.me.pid) || [0, '', 0, 0, 0];
  if (squad.length > 1) sub += ' Squad: ' + squad.map((r) => `${r[1]} ${r[2]}K/${r[3]}D`).join(' · ') + '.';
  $('#end-sub').textContent = sub;
  $('#st-kills').textContent = mine[2]; $('#st-deaths').textContent = mine[3]; $('#st-caps').textContent = `${caps}/5`; $('#st-bp').textContent = mine[4]; $('#st-time').textContent = fmt(time);
  $('#again-btn').textContent = Net.active ? 'Back to lobby' : 'Fight again';
  show('end'); hud.root.hidden = true;
}
function pause(on) {
  if (on && G.mode === 'play') {
    G.mode = 'paused'; show('pause');
    $('#restart-btn').hidden = Net.active;
    $('#menu-btn').textContent = isHostMP() ? 'Close room' : isClient() ? 'Leave game' : 'Main menu';
    $('#resume-btn').textContent = Net.active ? 'Back to battle' : 'Resume';
  }
  else if (!on && G.mode === 'paused') { G.mode = 'play'; show(null); }
}

// ================= CO-OP =================
const Lobby = { diff: 'regular' };
let netAcc = 0, inAcc = 0;
const CL = { units: new Map(), tanks: new Map(), pending: new Set(), respawnSent: false, lastSeq: -1, name: '' };
function setMe(h) { G.me = h; HM = h; }
function resetSolo() { const h = newHuman(0, 'You', G.cls, true); G.humans = [h]; setMe(h); G.ev = null; G.sfxHook = null; }
function myName() { const v = $('#coop-name').value.trim(); return v || 'Soldier'; }
function coopStatus(msg, err = false) { const el = $('#coop-status'); el.textContent = msg; el.classList.toggle('err', err); }
function toCoop(msg, err = true) { Net.leave(); resetSolo(); G.mode = 'title'; show('coop'); coopStatus(msg, err); setBusy(false); }
function setBusy(b) { $('#host-btn').disabled = b; $('#join-btn').disabled = b; }
function inGame() { return G.mode === 'play' || G.mode === 'dead' || G.mode === 'paused'; }

// ---- lobby UI ----
function lobbyPlayers() { return isClient() ? (Lobby.players || []) : G.humans.map((h) => [h.pid, h.name, h.cls]); }
function renderLobby() {
  setT($('#room-code'), Net.code || '----');
  const pl = lobbyPlayers();
  setT($('#lobby-count'), `${pl.length}/4`);
  $('#lobby-list').innerHTML = pl.map(([pid, name, cls]) => `<li class="${pid === G.me.pid ? 'me' : ''}"><span>${esc(name)}${pid === 0 ? ' · host' : ''}${pid === G.me.pid ? ' (you)' : ''}</span><span class="c">${esc(CLASSES[cls] ? CLASSES[cls].name : cls)}</span></li>`).join('');
  document.querySelectorAll('[data-ldiff]').forEach((k) => k.classList.toggle('sel', k.dataset.ldiff === Lobby.diff));
  $('#lobby-diff').classList.toggle('ro', isClient());
  $('#lobby-start').hidden = !isHostMP();
  setT($('#lobby-status'), isClient() ? 'Waiting for the host to start the battle' : pl.length < 2 ? 'Waiting for friends to join. You can also start now.' : 'Squad ready');
}
function enterLobby() {
  G.mode = 'lobby'; G.ev = null;
  buildLoadoutCards($('#lobby-cards'), (cls) => { if (isClient()) Net.send({ t: 'cls', cls }); else { G.me.cls = cls; broadcastLobby(); } renderLobby(); });
  show('lobby'); renderLobby();
}
function broadcastLobby() { if (isHostMP()) Net.send({ t: 'lobby', players: G.humans.map((h) => [h.pid, h.name, h.cls]), diff: Lobby.diff }); }

// ---- host ----
function hostStart() {
  if (!isHostMP()) return;
  initAudio(); if (Music.on) startMusic();
  G.diff = DIFFS[Lobby.diff]; G.me.cls = G.cls;
  newGame();
  G.ev = []; netAcc = 0;
  for (const h of G.humans) if (!h.local) sendInit(h);
  show(null); sfx('radio');
}
function sendInit(h) {
  Net.send({ t: 'init', seed: G.seed, diff: Lobby.diff, tiles: G.tileLog, you: h.pid, dead: h.dead, corpses: G.corpses.slice(-40).map((c) => [Math.round(c.x), Math.round(c.y), +c.a.toFixed(2), c.team, c.role, c.wlen]) }, h.pid);
}
function removeHuman(pid) {
  const h = humanByPid(pid); if (!h) return;
  if (h.tank) { h.tank.alive = false; G.tanks = G.tanks.filter((t) => t !== h.tank); }
  if (h.s) { h.s.alive = false; G.units = G.units.filter((u) => u !== h.s); }
  G.humans = G.humans.filter((x) => x !== h); syncAliases();
  if (inGame()) { showToast(`${h.name} left`, 'Your squad is one rifle short', 'red'); ev(['T', `${h.name} left`, 'Your squad is one rifle short', 'red']); }
}
const NO_BCAST = new Set(['hitmarker', 'kill', 'explosion', 'bigexp', 'step']);
const hostSfxHook = (type, x, y, vol) => { if (G.ev && !NO_BCAST.has(type)) G.ev.push(['p', type, Math.round(x), Math.round(y), +vol.toFixed(2)]); };
function hostNetTick(dt) { netAcc += dt; if (netAcc >= 0.05) { netAcc = 0; flushSnapshot(); } }
const r1 = (v) => Math.round(v), r2 = (v) => Math.round(v * 100) / 100;
function flushSnapshot() {
  if (!isHostMP() || G.humans.length < 2) { if (G.ev) G.ev.length = 0; return; }
  const t = G.time;
  const c = {
    tm: r2(t), tr: r2(G.timer), tk: G.tickets, ac: G.active,
    ob: G.objectives.map((o) => [Math.round(o.progress * 1000) / 1000, o.state[0], o.contested ? 1 : 0, o.allies || 0, o.axis || 0]),
    u: G.units.filter((u) => u.alive).map((u) => [u.id, u.team, u.role, r1(u.x), r1(u.y), r2(u.angle),
      (u.moving ? 1 : 0) | (u.hitFlash > 0 ? 2 : 0) | (u.ai && u.ai.still > 0.4 && !u.moving ? 4 : 0) | (t - u.spawnT < 2.2 ? 16 : 0),
      u.weapon.key || u.weapon.def.key, t - u.lastShot < 0.12 ? r2(t - u.lastShot) : -1, u.pid ?? -1]),
    t: G.tanks.filter((k) => k.alive).map((k) => [k.id, k.team, r1(k.x), r1(k.y), r2(k.a), r2(k.ta ?? k.a), r1(k.hp), k.maxHp, k.hitFlash > 0 ? 1 : 0, t - (k.lastFire || -9) < 0.3 ? r2(t - k.lastFire) : -1, r1(k.track || 0), k.playerOwned ? 1 : 0, k.pid ?? -1]),
    b: G.bullets.filter((b) => b.alive !== false).slice(-120).map((b) => [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.team, b.sniper || (b.owner && b.owner.role === 'sniper') ? 1 : 0]),
    g: G.grenades.map((g) => [r1(g.x), r1(g.y), r2(g.t), g.type, r2(g.fuse)]),
    sh: G.shells.filter((x) => x.kind === 'bomb' || x.kind === 'shell' || !x.kind).map((x) => [x.kind || 'shell', r1(x.x), r1(x.y), r2(x.t || 0)]),
    pl: G.planes.map((p) => [r1(p.x), r1(p.y)]),
    sm: G.smokes.map((x) => [r1(x.x), r1(x.y), r1(x.r), r2(x.life)]),
    cr: G.crates.map((x) => [r1(x.x), r1(x.y)]),
    am: G.artyMarks.map((m) => [r1(m.x), r1(m.y), r1(m.r), m.team]),
    la: G.lasers.map((l) => [r1(l.x), r1(l.y), r1(l.tx), r1(l.ty), r2(l.p), l.pid ?? -1]),
    sp: G.spotted.map((x) => x.u.id),
    wr: G.wrecks.map((w) => [r1(w.x), r1(w.y), r2(w.a), r2(w.ta ?? w.a), w.team]),
    hu: G.humans.map((h) => [h.pid, h.name, h.cls, h.stats.kills, h.stats.deaths]),
    ev: G.ev || [],
  };
  const common = JSON.stringify(c);
  if (G.ev) G.ev.length = 0;
  for (const h of G.humans) {
    if (h.local) continue;
    const p = h.s;
    const m = { hp: p ? r1(p.hp) : 0, mhp: p ? p.maxHp : 100, st: p ? r1(p.stamina) : 100, cls: h.cls,
      w: p ? p.weapons.map((w) => [w.key || w.def.key, w.mag, w.reserve]) : [], wi: p ? p.wi : 0, rl: p ? r2(p.reloadT) : 0, g: p ? p.grenades : 0, gt: p ? p.gtype : 'frag', ads: p ? !!p.ads : false,
      bp: h.bp, bpe: h.stats.bpEarned, cd: { arty: Math.max(0, r2(h.callCd.arty - t)), plane: Math.max(0, r2(h.callCd.plane - t)), tank: Math.max(0, r2(h.callCd.tank - t)) },
      ab: Math.max(0, r2(h.abilityReady - t)), mk: h.mark, dead: h.dead, dt: h.dead ? r2(t - h.deathT) : 0, seq: h.spawnSeq,
      x: p ? r1(p.x) : 0, y: p ? r1(p.y) : 0, tk: h.tank ? h.tank.id : -1, tl: h.tank ? r1(h.tank.life) : 0, trl: h.tank ? r2(h.tank.reload) : 0, pe: h.pe };
    Net.sendStr(`{"t":"s","c":${common},"m":${JSON.stringify(m)}}`, h.pid);
    h.pe = [];
  }
}
function hostOnMsg(from, d) {
  const h = humanByPid(from); if (!h || !d) return;
  if (d.t === 'in') {
    h.inp = d;
    if (Array.isArray(d.p)) for (const k of d.p.slice(0, 24)) if (typeof k === 'string') h.pressed.add(k);
  } else if (d.t === 'cls' && CLASSES[d.cls]) { h.cls = d.cls; if (G.mode === 'lobby') { broadcastLobby(); renderLobby(); } }
  else if (d.t === 'respawn') { if (inGame() && doRespawn(h, d.cls)) {} }
}

// ---- client ----
function clientStart(d) {
  initAudio(); if (Music.on) startMusic();
  G.diff = DIFFS[d.diff] || DIFFS.regular; Lobby.diff = d.diff;
  buildMap(d.seed);
  Object.assign(G, { time: 0, units: [], bullets: [], grenades: [], particles: [], tanks: [], planes: [], shells: [], corpses: [], smokes: [], crates: [], lasers: [], spotted: [], feed: [], noise: [], flashes: [], wrecks: [], artyMarks: [], fieldQueue: [] });
  for (const [x, y, k] of d.tiles || []) k ? placeSandbag(x, y) : destroyTile(x, y);
  for (const [x, y, a, team, role, wlen] of d.corpses || []) G.corpses.push({ x, y, a, team, role, t: 0, wlen });
  G.objectives = OBJ_DEF.map((o, i) => ({ ...o, progress: 0, state: i === 0 ? 'active' : 'locked' }));
  G.active = 0; G.timer = 240; G.tickets = 0; G.caps = 0; G.hurt = 0;
  const me = newHuman(d.you, CL.name, G.cls, true); G.humans = [me]; setMe(me);
  CL.units.clear(); CL.tanks.clear(); CL.pending.clear(); CL.respawnSent = false; CL.lastSeq = -1; CL.gotSnap = false;
  G.mode = d.dead ? 'dead' : 'play';
  if (d.dead) { me.dead = true; me.deathT = -99; showDeath(); } else show(null);
  hud.root.hidden = false;
  sfx('radio'); showToast('Capture objective ' + G.objectives[0].name, 'Hold the zone with your squad', 'gold');
}
const ST = { a: 'active', l: 'locked', c: 'captured' };
function proxyUnit(a) {
  return { id: a[0], team: a[1], role: a[2], x: a[3], y: a[4], tx: a[3], ty: a[4], angle: a[5], tang: a[5], weapon: { def: WEAPONS[a[7]] || WEAPONS.garand }, weapons: null, lastShot: -9, walk: rand(10), moving: false, hitFlash: 0,
    alive: true, ai: { still: 0 }, isPlayer: a[2] === 'player', pid: a[9], spawnT: -9, r: 11, vx: 0, vy: 0, stamina: 100, reloadT: 0, maxHp: 100, hp: 100, lastHit: -9 };
}
function clientSnapshot(c, m) {
  CL.gotSnap = true;
  const me = G.me;
  // clock
  if (Math.abs(G.time - c.tm) > 0.3) G.time = c.tm; else G.time += (c.tm - G.time) * 0.15;
  const t = G.time;
  G.timer = c.tr; G.tickets = c.tk; G.active = c.ac;
  c.ob.forEach((o, i) => { const ob = G.objectives[i]; if (!ob) return; ob.progress = o[0]; ob.state = ST[o[1]]; ob.contested = !!o[2]; ob.allies = o[3]; ob.axis = o[4]; });
  G.caps = G.objectives.filter((o) => o.state === 'captured').length;
  // humans
  const hu = new Map(c.hu.map((x) => [x[0], x]));
  G.humans = c.hu.map(([pid, name, cls, k, dd]) => { if (pid === me.pid) { me.name = name; me.stats.kills = k; me.stats.deaths = dd; return me; } return { pid, name, cls, local: false, stats: { kills: k, deaths: dd, bpEarned: 0 } }; });
  if (!hu.has(me.pid)) G.humans.push(me);
  // units
  const seen = new Set(); const list = [];
  for (const a of c.u) {
    let u = CL.units.get(a[0]);
    if (!u) { u = proxyUnit(a); CL.units.set(a[0], u); if (u.pid === me.pid) { me.s = u; u.spawnT = t; } }
    seen.add(a[0]);
    u.tx = a[3]; u.ty = a[4]; u.tang = a[5];
    if (u.pid !== me.pid || me.tank) { if (Math.hypot(u.tx - u.x, u.ty - u.y) > 260) { u.x = u.tx; u.y = u.ty; } }
    else if (Math.hypot(u.tx - u.x, u.ty - u.y) > 220) { u.x = u.tx; u.y = u.ty; } // large desync: snap own soldier
    const f = a[6]; u.moving = u.pid === me.pid ? u.moving : !!(f & 1); u.hitFlash = f & 2 ? 0.05 : 0; u.ai.still = f & 4 ? 1 : 0;
    if (f & 16) { if (u.spawnT < t - 2.2) u.spawnT = t; } 
    if (WEAPONS[a[7]] && u.weapon.def !== WEAPONS[a[7]] && u.pid !== me.pid) u.weapon = { def: WEAPONS[a[7]] };
    if (a[8] >= 0) u.lastShot = t - a[8];
    if (u.isPlayer) { const h = hu.get(u.pid); if (h) u.name = h[1]; }
    list.push(u);
  }
  for (const [id, u] of CL.units) if (!seen.has(id)) { CL.units.delete(id); if (u !== me.s) u.alive = false; }
  G.units = list;
  // tanks
  const tseen = new Set(); const tl = [];
  for (const a of c.t) {
    let k = CL.tanks.get(a[0]);
    if (!k) { k = { id: a[0], team: a[1], x: a[2], y: a[3], a: a[4], ta: a[5], track: a[10], alive: true, maxHp: a[7], reload: 0, life: 0 }; CL.tanks.set(a[0], k); }
    tseen.add(a[0]); k.tx = a[2]; k.ty = a[3]; k.tA = a[4]; k.tTa = a[5]; k.hp = a[6]; k.maxHp = a[7]; k.hitFlash = a[8] ? 0.05 : 0; if (a[9] >= 0) k.lastFire = t - a[9]; k.tTrack = a[10]; k.playerOwned = !!a[11]; k.pid = a[12];
    tl.push(k);
  }
  for (const id of [...CL.tanks.keys()]) if (!tseen.has(id)) CL.tanks.delete(id);
  G.tanks = tl;
  G.bullets = c.b.map(([x, y, vx, vy, team, sn]) => ({ x, y, vx, vy, team, sniper: !!sn, owner: sn ? { role: 'sniper' } : null }));
  G.grenades = c.g.map(([x, y, gt, type, fuse]) => ({ x, y, t: gt, type, fuse }));
  G.shells = c.sh.map(([kind, x, y, st]) => ({ kind, x, y, t: st }));
  G.planes = c.pl.map(([x, y], i) => { const old = G.planes[i]; return old ? Object.assign(old, { tx: x, ty: y }) : { x, y, tx: x, ty: y }; });
  G.smokes = c.sm.map(([x, y, r, life]) => ({ x, y, r, max: r, life }));
  G.crates = c.cr.map(([x, y]) => ({ x, y, until: Infinity }));
  G.artyMarks = c.am.map(([x, y, r, team]) => ({ x, y, r, team, until: Infinity }));
  G.lasers = c.la.map(([x, y, tx, ty, p, pid]) => ({ x, y, tx, ty, p, atPlayer: pid === me.pid }));
  G.spotted = c.sp.map((id) => CL.units.get(id)).filter(Boolean).map((u) => ({ u, until: Infinity }));
  G.wrecks = c.wr.map(([x, y, a, ta, team]) => ({ x, y, a, ta, team }));
  for (const e of c.ev) clientEvent(e);
  // me
  me.bp = m.bp; me.stats.bpEarned = m.bpe; me.cls = m.cls;
  me.callCd = { arty: m.cd.arty ? t + m.cd.arty : 0, plane: m.cd.plane ? t + m.cd.plane : 0, tank: m.cd.tank ? t + m.cd.tank : 0 };
  me.abilityReady = t + m.ab; me.mark = m.mk;
  me.tank = m.tk >= 0 ? CL.tanks.get(m.tk) || null : null;
  if (me.tank) { me.tank.life = m.tl; me.tank.reload = m.trl; }
  const p = me.s;
  if (p) {
    p.hp = m.hp; p.maxHp = m.mhp; p.cls = m.cls; p.wi = m.wi; p.reloadT = m.rl; p.grenades = m.g; p.gtype = m.gt; p.speedBase = CLASSES[m.cls] ? CLASSES[m.cls].speed : 140;
    p.weapons = m.w.map(([k, mag, reserve]) => ({ def: WEAPONS[k] || WEAPONS.garand, mag, reserve })); if (p.weapons.length) p.weapon = p.weapons[m.wi] || p.weapons[0];
    if (me.tank) { p.x = me.tank.x; p.y = me.tank.y; }
    p.alive = seen.has(p.id) || (!!me.tank && !m.dead);
  }
  for (const e of m.pe) clientEvent(e, true);
  const wasDead = me.dead;
  me.dead = m.dead; me.deathT = t - m.dt;
  if (m.dead && (G.mode === 'play' || G.mode === 'paused') ) { G.mode = 'dead'; CL.respawnSent = false; showDeath(); }
  if (!m.dead && G.mode === 'dead') { G.mode = 'play'; CL.respawnSent = false; show(null); sfx('radio'); }
  if (wasDead && !m.dead) CL.respawnSent = false;
}
function clientEvent(e, personal = false) {
  switch (e[0]) {
    case 'x': explode(e[1], e[2], { r: e[3], dmg: 0, team: -1, fxOnly: true, big: !!e[4] }); break;
    case 't': e[3] ? placeSandbag(e[1], e[2]) : destroyTile(e[1], e[2]); break;
    case 'b': blood(e[1], e[2], e[3]); break;
    case 'c': G.corpses.push({ x: e[1], y: e[2], a: e[3], team: e[4], role: e[5], t: G.time, wlen: e[6] }); if (G.corpses.length > 90) G.corpses.shift(); break;
    case 'f': showFeed(e[1], e[2], e[3], e[4], e[5], e[6], e[7]); break;
    case 'T': showToast(e[1], e[2], e[3]); break;
    case 'P': showPopup(e[1]); break;
    case 's': sfx(e[1]); if (e[1] === 'kill') {} break;
    case 'p': sfx(e[1], e[2], e[3], e[4]); break;
    case 'h': G.hurt = Math.min(1, (G.hurt || 0) + e[1]); G.hurtT = G.time; break;
    case 'm': G.hitmarker = 0.15; sfx('hitmarker', G.cam.x, G.cam.y, 0.8); break;
  }
}
const SEND_KEYS = ['Digit1', 'Digit2', 'KeyQ', 'KeyR', 'KeyG', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'Escape'];
function clientUpdate(dt) {
  if (!inGame()) return;
  G.time += dt;
  const me = G.me, p = me.s, k = 1 - Math.exp(-dt * 14);
  // interpolate others
  for (const u of G.units) {
    if (u === p && !me.tank) continue;
    const ox = u.x, oy = u.y; u.x += (u.tx - u.x) * k; u.y += (u.ty - u.y) * k; u.angle = turnTo(u.angle, u.tang, dt * 14);
    u.walk += Math.hypot(u.x - ox, u.y - oy) * 0.08;
  }
  for (const t of G.tanks) { t.x += (t.tx - t.x) * k; t.y += (t.ty - t.y) * k; t.a = turnTo(t.a, t.tA, dt * 10); t.ta = turnTo(t.ta, t.tTa, dt * 12); t.track += ((t.tTrack ?? t.track) - t.track) * k; }
  for (const pl of G.planes) { pl.x += (pl.tx - pl.x) * k; pl.y += (pl.ty - pl.y) * k; }
  for (const b of G.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  updateFx(dt);
  // own soldier: local movement prediction
  let ctl = null;
  if (p && p.alive && G.mode === 'play' && CL.gotSnap) {
    ctl = localControls(p);
    if (!me.tank) {
      let { mx, my } = ctl; const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
      p.angle = Math.atan2(ctl.ay - p.y, ctl.ax - p.x);
      p.ads = ctl.ads && !me.mark;
      const sprint = ctl.sprint && ml > 0.1 && p.stamina > 5 && !p.ads;
      if (sprint) p.stamina = Math.max(0, p.stamina - dt * 26); else p.stamina = Math.min(100, p.stamina + dt * 16);
      const tt = tileAtPx(p.x, p.y); p.inTrench = tt === T.TRENCH || tt === T.FLOOR;
      const slow = tt === T.MUD ? 0.8 : tt === T.CRATER ? 0.75 : tt === T.WIRE ? 0.38 : 1;
      const sp = p.speedBase * (sprint ? 1.55 : 1) * (p.ads ? 0.55 : 1) * slow * (p.reloadT > 0 ? 0.85 : 1);
      p.vx = lerp(p.vx, mx * sp, Math.min(1, dt * 12)); p.vy = lerp(p.vy, my * sp, Math.min(1, dt * 12));
      moveCircle(p, p.vx * dt, p.vy * dt, p.r);
      const spd = Math.hypot(p.vx, p.vy); p.moving = spd > 20; const w0 = p.walk; p.walk += spd * dt * 0.08;
      if (p.moving && Math.floor(p.walk / 3) !== Math.floor(w0 / 3)) sfx('step', p.x, p.y, 0.5);
      ctl.sprinting = sprint;
    } else { p.x = me.tank.x; p.y = me.tank.y; }
    for (const key of SEND_KEYS) if (Input.pressed[key]) CL.pending.add(key);
    if (Input.mouse.lPressed || Input.hit('Space')) CL.pending.add('L'); if (Input.mouse.rPressed) CL.pending.add('R'); if (Input.wheel) CL.pending.add('Wheel');
  }
  inAcc += dt;
  if (inAcc >= 1 / 30) {
    inAcc = 0;
    if (ctl) Net.send({ t: 'in', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, mx: r2(ctl.mx), my: r2(ctl.my), ax: r1(ctl.ax), ay: r1(ctl.ay), ads: ctl.ads ? 1 : 0, sp: ctl.sprinting ? 1 : 0, fh: ctl.fireHeld ? 1 : 0, rh: ctl.altHeld ? 1 : 0, tch: ctl.touch ? 1 : 0, mv: p.moving ? 1 : 0, p: [...CL.pending] });
    else Net.send({ t: 'in', mx: 0, my: 0, ax: p ? r1(p.x + Math.cos(p.angle) * 100) : 0, ay: p ? r1(p.y + Math.sin(p.angle) * 100) : 0, fh: 0, rh: 0, x: p ? p.x : undefined, y: p ? p.y : undefined, p: [] });
    CL.pending.clear();
  }
  for (const o of G.objectives) o.playerIn = !!(p && p.alive && dist2((me.tank || p).x, (me.tank || p).y, o.x, o.y) < o.r * o.r);
  if (G.mode === 'dead' && G.time - me.deathT > 0.5) updateDeathUI();
}

// ---- network wiring ----
Net.on('created', (m) => {
  Net.role = 'host'; Net.code = m.code; Net.id = 0;
  const h = newHuman(0, myName(), G.cls, true); G.humans = [h]; setMe(h);
  G.sfxHook = hostSfxHook; setBusy(false); enterLobby();
});
Net.on('joined', (m) => { Net.role = 'client'; Net.code = m.code; Net.id = m.id; CL.name = myName(); const h = newHuman(m.id, CL.name, G.cls, true); G.humans = [h]; setMe(h); Lobby.players = []; setBusy(false); enterLobby(); Net.send({ t: 'cls', cls: G.cls }); });
Net.on('error', (m) => { setBusy(false); if (!Net.role) { coopStatus(m.msg || 'Something went wrong.', true); try { Net.ws && Net.ws.close(); } catch {} } });
Net.on('closed', (m) => toCoop(m.reason || 'The host closed the room.'));
Net.on('disconnect', () => toCoop('Lost connection to the co-op server.'));
Net.on('peer_join', (m) => {
  if (!isHostMP()) return;
  if (G.humans.length >= 4 || humanByPid(m.id)) return;
  const h = newHuman(m.id, m.name, 'rifleman', false);
  G.humans.push(h);
  if (inGame()) { h.dead = true; h.deathT = -99; sendInit(h); const msg = `${h.name} joined the squad`; showToast(msg, 'Reinforcing the push', 'gold'); ev(['T', msg, 'Reinforcing the push', 'gold']); }
  else { broadcastLobby(); if (G.mode === 'lobby') renderLobby(); }
});
Net.on('peer_leave', (m) => { if (!isHostMP()) return; removeHuman(m.id); if (G.mode === 'lobby') { broadcastLobby(); renderLobby(); } });
Net.on('msg', (m) => {
  const d = m.d; if (!d) return;
  if (isHostMP()) { hostOnMsg(m.from, d); return; }
  if (!isClient()) return;
  if (d.t === 'lobby') { Lobby.players = d.players; Lobby.diff = d.diff; if (G.mode !== 'lobby') enterLobby(); else renderLobby(); }
  else if (d.t === 'init') clientStart(d);
  else if (d.t === 's') { if (inGame()) clientSnapshot(d.c, d.m); }
  else if (d.t === 'end') { if (inGame()) showEnd(d.win, d.reason, d.caps, d.time, d.squad); }
});
function leaveRoom() { Net.leave(); resetSolo(); G.mode = 'title'; show('title'); }

// UI wiring
document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { G.diff = DIFFS[b.dataset.diff]; Lobby.diff = b.dataset.diff; document.querySelectorAll('[data-diff]').forEach((k) => k.classList.toggle('sel', k === b)); sfx('click'); }));
document.querySelectorAll('[data-ldiff]').forEach((b) => b.addEventListener('click', () => { if (!isHostMP()) return; Lobby.diff = b.dataset.ldiff; sfx('click'); broadcastLobby(); renderLobby(); }));
$('#play-btn').addEventListener('click', async () => { initAudio(); if (Music.on) startMusic(); buildLoadoutCards($('#loadout-cards')); show('loadout'); });
$('#coop-btn').addEventListener('click', () => { initAudio(); if (Music.on) startMusic(); coopStatus(''); show('coop'); });
$('#coop-back').addEventListener('click', () => { Net.leave(); show('title'); });
$('#host-btn').addEventListener('click', async () => {
  setBusy(true); coopStatus('Connecting…');
  try { await Net.host(myName()); } catch (e) { setBusy(false); coopStatus(e.message, true); }
});
const doJoin = async () => {
  const code = $('#join-code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { coopStatus('Enter the 4-letter room code from your host.', true); return; }
  setBusy(true); coopStatus('Joining…');
  try { await Net.join(code, myName()); } catch (e) { setBusy(false); coopStatus(e.message, true); }
};
$('#join-btn').addEventListener('click', doJoin);
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
$('#lobby-leave').addEventListener('click', () => { leaveRoom(); show('coop'); coopStatus(''); });
$('#lobby-start').addEventListener('click', hostStart);
$('#deploy-btn').addEventListener('click', () => { initAudio(); resetSolo(); newGame(); show(null); sfx('radio'); });
$('#back-btn').addEventListener('click', () => show('title'));
$('#death-btn').addEventListener('click', respawn);
$('#resume-btn').addEventListener('click', () => pause(false));
$('#restart-btn').addEventListener('click', () => { G.mode = 'title'; buildLoadoutCards($('#loadout-cards')); show('loadout'); });
$('#again-btn').addEventListener('click', () => {
  if (isHostMP()) { enterLobby(); broadcastLobby(); return; }
  if (isClient()) { enterLobby(); return; }
  G.mode = 'title'; buildLoadoutCards($('#loadout-cards')); show('loadout');
});
$('#menu-btn').addEventListener('click', () => { if (Net.active) { leaveRoom(); return; } G.mode = 'title'; show('title'); });
$('#music-btn').addEventListener('click', (e) => { setMusic(!Music.on); if (Music.on) startMusic(); e.target.textContent = `Music: ${Music.on ? 'On' : 'Off'}`; });
$('#sound-btn').addEventListener('click', (e) => { setMuted(!Audio.muted); setMusic(Music.on); e.target.textContent = `Sound: ${Audio.muted ? 'Off' : 'On'}`; });
hud.callins.forEach((el, i) => el.addEventListener('click', () => { if (isClient()) CL.pending.add(CALLINS[i].key); else beginCallin(CALLINS[i].id); }));
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.mode === 'play' && !HM.mark) pause(true); else if (G.mode === 'paused') pause(false); }
  if (e.code === 'KeyM') { setMuted(!Audio.muted); setMusic(Music.on); }
  if ((e.code === 'Enter' || e.code === 'Space') && G.mode === 'dead') respawn();
});

// ---------------- TOUCH ----------------
function initTouch() {
  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
  Input.touchCapable = true;
  // Start in touch mode only on touch-first devices (phones/tablets); touchscreen laptops start with mouse controls.
  const touchFirst = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  Input.setTouch(touchFirst);
  const stick = (el, key) => {
    const knob = el.querySelector('.knob'); const st = Input.touch[key];
    el.addEventListener('pointerdown', (e) => { st.id = e.pointerId; const r = el.getBoundingClientRect(); st.ox = r.left + r.width / 2; st.oy = r.top + r.height / 2; if (key === 'aim') st.active = true; el.setPointerCapture(e.pointerId); mv(e); });
    const mv = (e) => { if (st.id !== e.pointerId) return; let dx = (e.clientX - st.ox) / 50, dy = (e.clientY - st.oy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } st.x = dx; st.y = dy; knob.style.transform = `translate(${dx * 36}px,${dy * 36}px)`; };
    el.addEventListener('pointermove', mv);
    const up = (e) => { if (st.id !== e.pointerId) return; st.id = null; st.x = st.y = 0; if (key === 'aim') st.active = false; knob.style.transform = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  stick($('#stick-move'), 'move'); stick($('#stick-aim'), 'aim');
  document.querySelectorAll('[data-tkey]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); Input.pressed[b.dataset.tkey] = true; if (b.dataset.tkey === 'ShiftLeft') { Input.keys.ShiftLeft = !Input.keys.ShiftLeft; b.classList.toggle('on', Input.keys.ShiftLeft); } }));
}
initTouch();

// ---------------- LOOP ----------------
const STEP = 1 / 60; let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; Input.endFrame(); }
  if (G.mode === 'play' || G.mode === 'dead' || G.mode === 'paused') { updateCamera(dt); render(); updateHUD(); mmT -= dt; if (mmT <= 0) { mmT = 0.15; drawMinimap(); } }
  requestAnimationFrame(frame);
}
window.advanceTime = (ms) => { const n = Math.round(ms / (1000 / 60)); for (let i = 0; i < n; i++) { update(STEP); Input.endFrame(); updateCamera(STEP); } render(); updateHUD(); drawMinimap(); };
window.render_game_to_text = () => {
  const p = HM.s, o = G.objectives ? G.objectives[G.active] : null;
  return JSON.stringify({
    note: 'world px, origin top-left, +x east (toward enemy), +y south', mode: G.mode,
    player: p ? { x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), cls: p.cls, weapon: p.weapon.def.name, mag: p.weapon.mag, reserve: p.weapon.reserve, grenades: p.grenades, inTank: !!HM.tank, alive: p.alive } : null,
    objective: o ? { name: o.name, x: Math.round(o.x), y: Math.round(o.y), progress: +o.progress.toFixed(2), contested: !!o.contested } : null,
    timer: Math.round(G.timer), tickets: G.tickets, bp: HM.bp, captured: HM.stats ? G.caps : 0,
    allies: G.units ? G.units.filter((u) => u.team === ALLY && !u.isPlayer).length : 0,
    axis: G.units ? G.units.filter((u) => u.team === AXIS).map((u) => u.role).reduce((a, r) => ((a[r] = (a[r] || 0) + 1), a), {}) : {},
    visibleEnemies: G.units ? G.units.filter((u) => u.team === AXIS && visibleToPlayer(u.x, u.y)).slice(0, 8).map((u) => ({ role: u.role, x: Math.round(u.x), y: Math.round(u.y) })) : [],
    tanks: G.tanks ? G.tanks.map((t) => ({ team: t.team, hp: Math.round(t.hp), x: Math.round(t.x), y: Math.round(t.y) })) : [], planes: G.planes ? G.planes.length : 0, shells: G.shells ? G.shells.length : 0,
  });
};
// Hidden tabs stop requestAnimationFrame, which would freeze the battle for everyone when the host
// switches tabs. A worker timer keeps the host simulation and snapshots running in the background.
(function hostBackgroundTicker() {
  let worker = null;
  try { worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/30)'], { type: 'text/javascript' }))); } catch { return; }
  worker.onmessage = () => {
    if (!document.hidden || !isHostMP()) return;
    const now = performance.now(); const dt = Math.min(0.25, (now - last) / 1000); last = now; acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; Input.endFrame(); }
  };
})();
window.__G = G; window.__debug = { newGame, enterTank, spawnPanzer, beginCallin, confirmCallin, show, Net };

(async () => {
  show('title');
  await loadNoise();
  await document.fonts.ready;
  requestAnimationFrame(frame);
})();
