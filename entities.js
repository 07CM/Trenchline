// ============ ENTITIES: weapons, soldiers + AI, projectiles, explosions, tanks, planes ============
import { G, TILE, T, ALLY, AXIS, clamp, lerp, rand, randi, pick, dist, dist2, angNorm, angDiff, turnTo, sfx } from './core.js';
import { tileAtPx, moveCircle, los, flowDir, flowField, solidSoldier, destroyTile, scorch, blood, drawCrater, randomTileNear, perches, nests } from './world.js';

export const WEAPONS = {
  garand: { name: 'M1 Garand', dmg: 50, rof: 0.16, auto: false, mag: 8, reserve: 64, reload: 2.1, spread: 0.022, speed: 1800, range: 1000, snd: 'rifle', kick: 4, len: 26 },
  thompson: { name: 'M1A1 Thompson', dmg: 24, rof: 0.086, auto: true, mag: 30, reserve: 180, reload: 2.4, spread: 0.075, speed: 1400, range: 560, snd: 'smg', kick: 2, len: 19 },
  bar: { name: 'M1918 BAR', dmg: 34, rof: 0.125, auto: true, mag: 20, reserve: 140, reload: 2.8, spread: 0.05, speed: 1700, range: 850, snd: 'lmg', kick: 3, len: 28 },
  springfield: { name: 'M1903A4 Springfield', dmg: 135, rof: 1.3, auto: false, mag: 5, reserve: 40, reload: 3.0, spread: 0.003, speed: 2800, range: 1900, snd: 'sniper', kick: 9, len: 29, bolt: true },
  m97: { name: 'M1897 Trench Gun', dmg: 19, pellets: 8, rof: 0.8, auto: false, mag: 6, reserve: 36, reload: 3.0, spread: 0.16, speed: 1250, range: 380, snd: 'shotgun', kick: 8, len: 22, bolt: true },
  m1911: { name: 'M1911 Pistol', dmg: 30, rof: 0.15, auto: false, mag: 7, reserve: 56, reload: 1.5, spread: 0.04, speed: 1300, range: 600, snd: 'pistol', kick: 2, len: 11 },
  kar98: { name: 'Kar98k', dmg: 55, rof: 1.4, auto: false, mag: 5, reserve: 999, reload: 2.6, spread: 0.01, speed: 1800, range: 1050, snd: 'kar98', kick: 5, len: 27 },
  kar98s: { name: 'Kar98k ZF39', dmg: 110, rof: 2.2, auto: false, mag: 5, reserve: 999, reload: 3, spread: 0.002, speed: 3000, range: 1950, snd: 'sniper', kick: 8, len: 29 },
  mp40: { name: 'MP40', dmg: 20, rof: 0.11, auto: true, mag: 32, reserve: 999, reload: 2.4, spread: 0.08, speed: 1400, range: 540, snd: 'smg', kick: 2, len: 19 },
  mg42: { name: 'MG42', dmg: 22, rof: 0.055, auto: true, mag: 50, reserve: 999, reload: 3.5, spread: 0.085, speed: 1800, range: 980, snd: 'mg42', kick: 2, len: 31 },
};
for (const k in WEAPONS) WEAPONS[k].key = k;

export const CLASSES = {
  rifleman: { name: 'Rifleman', primary: 'garand', grenades: 3, gtype: 'frag', ability: 'bandage', abilityName: 'Field Dressing', abilityCd: 25, hp: 100, speed: 150, blurb: 'Accurate semi-auto at all ranges. Heal yourself in the field.' },
  assault: { name: 'Assault', primary: 'thompson', grenades: 2, gtype: 'frag', ability: 'smoke', abilityName: 'Smoke Grenade', abilityCd: 18, hp: 100, speed: 160, blurb: 'Fast trench clearer. Smoke blinds snipers and MG nests.' },
  support: { name: 'Support', primary: 'bar', grenades: 2, gtype: 'frag', ability: 'ammo', abilityName: 'Ammo Crate', abilityCd: 35, hp: 120, speed: 138, blurb: 'Sustained suppressing fire. Drops ammo for the push.' },
  sniper: { name: 'Marksman', primary: 'springfield', grenades: 1, gtype: 'frag', ability: 'binoc', abilityName: 'Binoculars', abilityCd: 28, hp: 90, speed: 150, blurb: 'One-shot scoped rifle. Hold RMB to scope. Spot hidden enemies.' },
  engineer: { name: 'Engineer', primary: 'm97', grenades: 2, gtype: 'at', ability: 'sandbag', abilityName: 'Sandbag Wall', abilityCd: 22, hp: 105, speed: 148, blurb: 'Trench shotgun and anti-tank grenades. Builds cover.' },
};
const ROLE = {
  assault: { speed: 140, sight: 900, err: 0.075, react: [0.35, 0.8], hp: 100 },
  defender: { speed: 112, sight: 950, err: 0.07, react: [0.45, 0.9], hp: 100 },
  rusher: { speed: 188, sight: 850, err: 0.11, react: [0.2, 0.4], hp: 90 },
  stalker: { speed: 128, sight: 950, err: 0.06, react: [0.15, 0.35], hp: 100 },
  sniper: { speed: 95, sight: 1850, err: 0.004, react: [0.2, 0.3], hp: 80 },
  gunner: { speed: 70, sight: 1000, err: 0.09, react: [0.5, 0.8], hp: 120 },
};
const ALLY_NAMES = ['Miller', 'Kowalski', 'Russo', 'Hayes', 'Brooks', 'Dalton', 'Reyes', 'Hart', 'Sullivan', 'Price', 'Novak', 'Turner', 'Walsh', 'Grant', 'Fisher', 'Doyle', 'Carter', 'Lindqvist'];
const AXIS_NAMES = ['Weber', 'Krause', 'Vogel', 'Brandt', 'Hoffmann', 'Schulz', 'Lange', 'Keller', 'Fuchs', 'Wolf', 'Becker', 'Richter', 'Neumann', 'Bauer', 'Kessler', 'Engel'];
let UID = 1;

export function makeWeapon(key) { const d = WEAPONS[key]; return { key, def: d, mag: d.mag, reserve: d.reserve }; }

export class Soldier {
  constructor(team, x, y, role, cls) {
    this.id = UID++; this.team = team; this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.r = 11;
    this.angle = team === ALLY ? 0 : Math.PI; this.role = role; this.alive = true; this.isPlayer = role === 'player';
    this.cd = 0; this.reloadT = 0; this.swapT = 0; this.lastShot = -9; this.lastHit = -9; this.walk = rand(10); this.moving = false;
    this.inTrench = false; this.spawnT = G.time; this.hitFlash = 0;
    if (this.isPlayer) {
      const c = CLASSES[cls]; this.cls = cls; this.maxHp = this.hp = c.hp; this.speedBase = c.speed;
      this.weapons = [makeWeapon(c.primary), makeWeapon('m1911')]; this.wi = 0; this.grenades = c.grenades; this.gtype = c.gtype;
      this.abilityT = 0; this.stamina = 100; this.name = 'You';
    } else {
      const R = ROLE[role]; this.maxHp = this.hp = R.hp; this.speedBase = R.speed * rand(0.92, 1.08);
      let wk;
      if (team === ALLY) wk = pick(['garand', 'garand', 'thompson', 'bar']);
      else wk = { defender: Math.random() < 0.7 ? 'kar98' : 'mp40', rusher: 'mp40', stalker: 'mp40', sniper: 'kar98s', gunner: 'mg42' }[role];
      this.weapons = [makeWeapon(wk)]; this.wi = 0; this.grenades = role === 'stalker' ? 2 : role === 'defender' || role === 'assault' ? 1 : 0; this.gtype = 'frag';
      const ranks = team === ALLY ? ['Pvt.', 'Pfc.', 'Cpl.', 'Sgt.'] : ['Schtz.', 'Gefr.', 'Obgfr.', 'Uffz.'];
      this.name = pick(ranks) + ' ' + pick(team === ALLY ? ALLY_NAMES : AXIS_NAMES);
      this.ai = { target: null, think: rand(0.3), react: 0, anchor: null, field: null, fieldReq: false, wander: 0, stuckT: 0, lastPos: { x, y }, nudge: null, nudgeT: 0,
        aimT: 0, shots: 0, burst: 0, burstPause: 0, gCd: rand(4, 10), state: 'move', stateT: 0, zig: rand(10), flank: rand() < 0.5 ? -1 : 1, observed: false, still: 0, meleeCd: 0 };
    }
  }
  get weapon() { return this.weapons[this.wi]; }
}

// ---------------- WEAPON FIRING ----------------
export function fireWeapon(u, ang, extraSpread = 0) {
  const w = u.weapon; const d = w.def;
  if (u.cd > 0 || u.reloadT > 0 || u.swapT > 0) return false;
  if (w.mag <= 0) { if (u.isPlayer) { sfx('empty', u.x, u.y); u.cd = 0.25; startReload(u); } else startReload(u); return false; }
  w.mag--; u.cd = d.rof; u.lastShot = G.time;
  const n = d.pellets || 1;
  const mx = u.x + Math.cos(u.angle) * (d.len + 4), my = u.y + Math.sin(u.angle) * (d.len + 4);
  for (let i = 0; i < n; i++) {
    const a = ang + (Math.random() - 0.5) * 2 * (d.spread + extraSpread);
    const sp = d.speed * rand(0.95, 1.05);
    G.bullets.push({ x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: d.dmg, team: u.team, owner: u, trav: (d.len + 4), range: d.range, sniper: d.snd === 'sniper', alive: true, life: 0 });
  }
  // muzzle flash + casing
  for (let i = 0; i < 3; i++) G.particles.push({ type: 'fire', x: mx, y: my, vx: Math.cos(ang) * rand(60, 220) + rand(-30, 30), vy: Math.sin(ang) * rand(60, 220) + rand(-30, 30), life: 0.07, max: 0.07, size: rand(3, 6) });
  G.particles.push({ type: 'smoke', x: mx, y: my, vx: Math.cos(ang) * 30, vy: Math.sin(ang) * 30, life: 0.6, max: 0.6, size: rand(5, 8), grow: 18, a: 0.25 });
  if (d.snd !== 'shotgun' || true) G.particles.push({ type: 'casing', x: u.x, y: u.y, vx: Math.cos(ang + Math.PI / 2) * rand(60, 110), vy: Math.sin(ang + Math.PI / 2) * rand(60, 110), life: 0.5, max: 0.5, size: 2, rot: rand(6) });
  sfx(d.snd, u.x, u.y, u.isPlayer ? 1 : 0.8);
  if (d.bolt) setTimeout(() => sfx('bolt', u.x, u.y, 0.6), 380);
  if (u.isPlayer) { if (u === G.player) G.cam.shake = Math.max(G.cam.shake, d.kick * 0.9); u.recoil = (u.recoil || 0) + d.kick * 0.012; if (w.mag === 0 && d.key !== 'springfield') sfx('ping', u.x, u.y); }
  else u.ai.lastFire = G.time;
  G.noise.push({ x: u.x, y: u.y, team: u.team, t: G.time, r: 520 });
  if (w.mag === 0 && !u.isPlayer) startReload(u);
  return true;
}
export function startReload(u) {
  const w = u.weapon; if (u.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
  u.reloadT = w.def.reload; if (u.isPlayer) sfx('reload', u.x, u.y);
}
export function updateWeaponTimers(u, dt) {
  u.cd = Math.max(0, u.cd - dt); u.swapT = Math.max(0, u.swapT - dt);
  if (u.reloadT > 0) {
    u.reloadT -= dt;
    if (u.reloadT <= 0) { u.reloadT = 0; const w = u.weapon; const need = w.def.mag - w.mag; const take = Math.min(need, w.reserve); w.mag += take; if (w.def.reserve < 999) w.reserve -= take; }
  }
}

// ---------------- GRENADES ----------------
export function throwGrenade(u, tx, ty, type = 'frag') {
  const a = Math.atan2(ty - u.y, tx - u.x); const d = clamp(dist(u.x, u.y, tx, ty), 60, 430);
  const k = 2.4; const v0 = d * k;
  G.grenades.push({ x: u.x + Math.cos(a) * 14, y: u.y + Math.sin(a) * 14, vx: Math.cos(a) * v0, vy: Math.sin(a) * v0, k, fuse: type === 'smoke' ? 1.4 : 2.1, t: 0, team: u.team, owner: u, type, spin: rand(6) });
  sfx('pin', u.x, u.y);
}
export function updateGrenades(dt) {
  for (const g of G.grenades) {
    g.t += dt; g.fuse -= dt; g.spin += dt * 10;
    const f = Math.exp(-g.k * dt); g.vx *= f; g.vy *= f;
    const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
    if (solidSoldier(tileAtPx(nx, g.y))) g.vx *= -0.4; else g.x = nx;
    if (solidSoldier(tileAtPx(g.x, ny))) g.vy *= -0.4; else g.y = ny;
    // stick to tanks (AT)
    if (g.fuse <= 0) {
      g.dead = true;
      if (g.type === 'smoke') {
        G.smokes.push({ x: g.x, y: g.y, r: 10, max: 150, life: 15 }); sfx('crush', g.x, g.y);
      } else if (g.type === 'at') explode(g.x, g.y, { r: 95, dmg: 120, team: g.team, owner: g.owner, tankMul: 4.5, destroy: true });
      else explode(g.x, g.y, { r: 125, dmg: 135, team: g.team, owner: g.owner, tankMul: 0.6, destroy: true });
    }
  }
  G.grenades = G.grenades.filter((g) => !g.dead);
}

// ---------------- EXPLOSIONS ----------------
export function explode(x, y, o) {
  const { r, dmg, team, owner, tankMul = 1, destroy = false, big = false, fxOnly = false } = o;
  if (G.ev) G.ev.push(['x', Math.round(x), Math.round(y), Math.round(r), big ? 1 : 0]);
  if (!fxOnly) for (const u of G.units) {
    if (!u.alive || u.team === team) continue;
    const d = dist(x, y, u.x, u.y); if (d > r) continue;
    if (!los(x, y, u.x, u.y)) continue;
    let f = Math.pow(1 - d / r, 0.6); if (u.inTrench && d > r * 0.35) f *= 0.55;
    damage(u, dmg * f, { owner, team, x, y, kind: 'explosion' });
  }
  if (!fxOnly) for (const tk of G.tanks) {
    if (!tk.alive || tk.team === team) continue;
    const d = dist(x, y, tk.x, tk.y); if (d > r + 30) continue;
    damageTank(tk, dmg * tankMul * (1 - (d / (r + 30)) * 0.5), owner);
  }
  if (destroy) {
    const tr = Math.max(1, Math.round(r * 0.32 / TILE));
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    for (let yy = cy - tr; yy <= cy + tr; yy++) for (let xx = cx - tr; xx <= cx + tr; xx++) if ((xx - cx) ** 2 + (yy - cy) ** 2 <= tr * tr + 1) if (destroyTile(xx, yy)) G.dirtyFields = true;
  }
  scorch(x, y, r * 0.55);
  if (big) drawCrater(x, y, r * 0.38);
  const n = big ? 34 : 20;
  for (let i = 0; i < n; i++) { const a = rand(6.28), s = rand(40, big ? 420 : 300); G.particles.push({ type: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.15, 0.45), max: 0.45, size: rand(8, big ? 26 : 18), drag: 4 }); }
  for (let i = 0; i < n; i++) { const a = rand(6.28), s = rand(20, 160); G.particles.push({ type: 'smoke', x: x + rand(-10, 10), y: y + rand(-10, 10), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1.5, 3.8), max: 3.8, size: rand(12, 26), grow: rand(14, 30), a: rand(0.35, 0.6), drag: 1.6, dark: Math.random() < 0.5 }); }
  for (let i = 0; i < 22; i++) { const a = rand(6.28), s = rand(150, 520); G.particles.push({ type: 'dirt', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, size: rand(2, 5), drag: 3 }); }
  G.particles.push({ type: 'ring', x, y, life: 0.35, max: 0.35, size: r * 1.1 });
  G.flashes.push({ x, y, r: r * 2.2, life: 0.18, max: 0.18 });
  const pd = G.player ? dist(G.cam.x, G.cam.y, x, y) : 9999;
  G.cam.shake = Math.max(G.cam.shake, clamp((big ? 26 : 16) * (1 - pd / 900), 0, 26));
  sfx(big ? 'bigexp' : 'explosion', x, y);
  G.noise.push({ x, y, team, t: G.time, r: 700 });
}

// ---------------- DAMAGE ----------------
function hitmark(owner) {
  if (owner.pid === undefined || (G.me && owner.pid === G.me.pid)) { G.hitmarker = 0.15; sfx('hitmarker', G.cam.x, G.cam.y, 0.8); }
  else G.personal && G.personal(owner.pid, ['m']);
}
export function damage(u, amt, src) {
  if (!u.alive) return;
  if (u.isPlayer) {
    if (G.time - u.spawnT < 2.2 || G.godMode) return;
    if (src.kind !== 'sniper' && src.kind !== 'explosion') amt *= G.diff.dmg; else if (src.kind === 'explosion') amt *= G.diff.dmg * 1.2;
    if (u === G.player) { G.hurt = Math.min(1, (G.hurt || 0) + amt / 60); G.hurtDir = Math.atan2(src.y - u.y, src.x - u.x); G.hurtT = G.time; }
    else G.personal && G.personal(u.pid, ['h', +(amt / 60).toFixed(2)]);
    sfx('hit', u.x, u.y, 1.2);
  }
  u.hp -= amt; u.lastHit = G.time; u.hitFlash = 0.12;
  if (!u.isPlayer && u.ai && src.owner && src.owner.alive) { u.ai.target = u.ai.target || src.owner; if (u.role === 'stalker') u.ai.state = 'strike', u.ai.stateT = 2.5; }
  if (src.owner && (src.owner.isPlayer || src.owner.playerOwned) && !u.isPlayer && u.team !== ALLY) hitmark(src.owner);
  for (let i = 0; i < 4; i++) G.particles.push({ type: 'blood', x: u.x, y: u.y, vx: rand(-90, 90), vy: rand(-90, 90), life: 0.4, max: 0.4, size: rand(2, 4), drag: 5 });
  if (u.hp <= 0) killUnit(u, src);
}
function killUnit(u, src) {
  u.alive = false; u.hp = 0;
  const corpse = { x: u.x, y: u.y, a: rand(6.28), team: u.team, role: u.role, t: G.time, wlen: u.weapon.def.len };
  G.corpses.push(corpse); if (G.ev) G.ev.push(['c', Math.round(u.x), Math.round(u.y), +corpse.a.toFixed(2), u.team, u.role, corpse.wlen]);
  if (G.corpses.length > 90) G.corpses.shift();
  const ba = Math.atan2(u.y - src.y, u.x - src.x); blood(u.x, u.y, ba); if (G.ev) G.ev.push(['b', Math.round(u.x), Math.round(u.y), +ba.toFixed(2)]);
  const killer = src.owner;
  if (u.team === ALLY) G.tickets = Math.max(0, G.tickets - 1);
  const playerKill = killer && (killer.isPlayer || killer.playerOwned);
  G.onKill && G.onKill(u, killer, src.kind, playerKill);
}
export function damageTank(tk, amt, owner) {
  if (!tk.alive) return;
  tk.hp -= amt; tk.hitFlash = 0.1;
  if (owner && (owner.isPlayer || owner.playerOwned) && tk.team !== ALLY) hitmark(owner);
  if (tk.hp <= 0) {
    tk.alive = false;
    explode(tk.x, tk.y, { r: 150, dmg: 160, team: tk.team, owner: tk, big: true, destroy: false });
    G.wrecks.push({ x: tk.x, y: tk.y, a: tk.a, ta: tk.ta, team: tk.team, t: G.time });
    G.onTankDestroyed && G.onTankDestroyed(tk, owner);
  }
}

// ---------------- BULLETS ----------------
function smokeBlocks(ax, ay, bx, by) {
  for (const s of G.smokes) {
    if (s.r < 50) continue;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((s.x - ax) * dx + (s.y - ay) * dy) / L2, 0, 1);
    if (dist2(ax + dx * t, ay + dy * t, s.x, s.y) < (s.r * 0.75) ** 2) return true;
  }
  return false;
}
export function canSee(a, bx, by, range) {
  if (dist2(a.x, a.y, bx, by) > range * range) return false;
  return los(a.x, a.y, bx, by) && !smokeBlocks(a.x, a.y, bx, by);
}
export function inSmoke(x, y) { return G.smokes.some((s) => dist2(x, y, s.x, s.y) < (s.r * 0.7) ** 2); }

export function updateBullets(dt) {
  for (const b of G.bullets) {
    b.life += dt; b.px = b.x; b.py = b.y;
    const sp = Math.hypot(b.vx, b.vy) * dt; const steps = Math.ceil(sp / 9);
    const sx = b.vx * dt / steps, sy = b.vy * dt / steps;
    for (let s = 0; s < steps && b.alive; s++) {
      b.x += sx; b.y += sy; b.trav += sp / steps;
      if (b.trav > b.range) { b.alive = false; G.particles.push({ type: 'dust', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 4, grow: 10, a: 0.3 }); break; }
      const t = tileAtPx(b.x, b.y);
      if (t === T.WALL || ((t === T.SANDBAG || t === T.SLIT) && b.trav > 70)) {
        b.alive = false;
        for (let i = 0; i < 3; i++) G.particles.push({ type: t === T.WALL ? 'spark' : 'dirt', x: b.x - sx, y: b.y - sy, vx: -sx * rand(5, 20) + rand(-60, 60), vy: -sy * rand(5, 20) + rand(-60, 60), life: 0.25, max: 0.25, size: 2, drag: 5 });
        G.particles.push({ type: 'dust', x: b.x - sx, y: b.y - sy, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 4, grow: 14, a: 0.35 });
        if (Math.random() < 0.15) sfx('ric', b.x, b.y, 0.6);
        break;
      }
      for (const u of G.units) {
        if (!u.alive || u.team === b.team) continue;
        if (dist2(b.x, b.y, u.x, u.y) > (u.r + 2) ** 2) continue;
        b.alive = false;
        // trench protection: far shots from outside a trench often pass overhead
        const shooter = b.owner;
        if (u.inTrench && shooter && !shooter.inTrench && b.trav > 280 && Math.random() < 0.35) { b.alive = true; continue; }
        let amt = b.dmg;
        if (u.isPlayer && shooter && shooter.role === 'sniper') { amt = 72; damage(u, amt, { owner: shooter, team: b.team, x: shooter.x, y: shooter.y, kind: 'sniper' }); }
        else damage(u, amt, { owner: shooter, team: b.team, x: shooter ? shooter.x : b.x, y: shooter ? shooter.y : b.y, kind: 'bullet' });
        break;
      }
      if (!b.alive) break;
      for (const tk of G.tanks) {
        if (!tk.alive || tk.team === b.team) continue;
        if (pointInTank(tk, b.x, b.y)) {
          b.alive = false; damageTank(tk, b.dmg * 0.06, b.owner);
          for (let i = 0; i < 2; i++) G.particles.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.2, max: 0.2, size: 2, drag: 4 });
          if (Math.random() < 0.3) sfx('ric', b.x, b.y, 0.5);
          break;
        }
      }
    }
  }
  G.bullets = G.bullets.filter((b) => b.alive);
}
export function pointInTank(tk, x, y) {
  const dx = x - tk.x, dy = y - tk.y; const c = Math.cos(-tk.a), s = Math.sin(-tk.a);
  const lx = dx * c - dy * s, ly = dx * s + dy * c; return Math.abs(lx) < 40 && Math.abs(ly) < 25;
}

// ---------------- AI ----------------
function enemiesOf(u) { return G.units.filter((o) => o.alive && o.team !== u.team); }
// living human soldiers on foot (host keeps G.humanUnits fresh each tick)
export function humansOnFoot() { return (G.humanUnits || (G.player ? [G.player] : [])).filter((p) => p.alive && !p.inTank); }
export function nearestHuman(u, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const p of humansOnFoot()) { const d = dist(u.x, u.y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
export function isObservedByPlayer(u) {
  for (const p of humansOnFoot()) {
    const d = dist(p.x, p.y, u.x, u.y); if (d > 1050) continue;
    const a = Math.atan2(u.y - p.y, u.x - p.x); if (Math.abs(angDiff(p.angle, a)) > 0.75 && d > 200) continue;
    if (los(p.x, p.y, u.x, u.y) && !inSmoke(u.x, u.y)) return p;
  }
  return null;
}
function requestField(u, tx, ty) {
  u.ai.goal = { x: tx, y: ty }; if (!u.ai.fieldReq) { u.ai.fieldReq = true; G.fieldQueue.push(u); }
}
export function processFieldQueue() {
  for (let k = 0; k < 2 && G.fieldQueue.length; k++) {
    const u = G.fieldQueue.shift(); if (!u.alive || !u.ai.goal) { if (u.ai) u.ai.fieldReq = false; continue; }
    u.ai.field = flowField([[Math.floor(u.ai.goal.x / TILE), Math.floor(u.ai.goal.y / TILE)]]); u.ai.fieldReq = false;
  }
}
function pickTarget(u) {
  const R = ROLE[u.role]; let best = null, bd = Infinity;
  const recentNoise = G.noise.filter((n) => n.team !== u.team && G.time - n.t < 1.2 && dist2(n.x, n.y, u.x, u.y) < n.r * n.r);
  for (const o of G.units) {
    if (!o.alive || o.team === u.team) continue;
    const d = dist(u.x, u.y, o.x, o.y); if (d > R.sight) continue;
    let w = d;
    if (o.isPlayer) w *= u.role === 'sniper' || u.role === 'stalker' || u.role === 'rusher' ? 0.45 : 0.8;
    if (inSmoke(o.x, o.y) && d > 90) continue;
    if (w >= bd) continue;
    // facing check: units notice targets in front or nearby or that made noise nearby
    const a = Math.atan2(o.y - u.y, o.x - u.x);
    const facing = Math.abs(angDiff(u.angle, a)) < 1.4 || d < 260 || recentNoise.length > 0 || u.role === 'sniper';
    if (!facing) continue;
    if (!canSee(u, o.x, o.y, R.sight)) continue;
    best = o; bd = w;
  }
  for (const tk of G.tanks) {
    if (!tk.alive || tk.team === u.team) continue;
    const d = dist(u.x, u.y, tk.x, tk.y); if (d > R.sight || d * 1.3 >= bd) continue;
    if (!canSee(u, tk.x, tk.y, R.sight)) continue; best = tk; bd = d * 1.3;
  }
  return best;
}
function steerMove(u, dirx, diry, speed, dt) {
  // separation
  let sx = 0, sy = 0;
  for (const o of G.units) {
    if (o === u || !o.alive) continue;
    const dx = u.x - o.x, dy = u.y - o.y, d2 = dx * dx + dy * dy;
    if (d2 < 900 && d2 > 0.01) { const d = Math.sqrt(d2); sx += (dx / d) * (30 - d) / 30; sy += (dy / d) * (30 - d) / 30; }
  }
  let vx = dirx * speed + sx * 90, vy = diry * speed + sy * 90;
  const t = tileAtPx(u.x, u.y);
  const slow = t === T.MUD ? 0.78 : t === T.CRATER ? 0.72 : t === T.WIRE ? 0.35 : 1;
  vx *= slow; vy *= slow;
  u.vx = lerp(u.vx, vx, Math.min(1, dt * 10)); u.vy = lerp(u.vy, vy, Math.min(1, dt * 10));
  moveCircle(u, u.vx * dt, u.vy * dt, u.r);
  u.moving = Math.hypot(u.vx, u.vy) > 20;
}
function followField(u, field, speed, dt) {
  const d = flowDir(field, u.x, u.y);
  if (!d) { steerMove(u, 0, 0, 0, dt); return false; }
  if (u.ai.nudgeT > 0) { u.ai.nudgeT -= dt; steerMove(u, u.ai.nudge.x, u.ai.nudge.y, speed, dt); return true; }
  steerMove(u, d.x, d.y, speed, dt);
  return !d.at;
}
function stuckCheck(u, dt, wantsMove) {
  u.ai.stuckT += dt;
  if (u.ai.stuckT > 1.5) {
    const moved = dist(u.x, u.y, u.ai.lastPos.x, u.ai.lastPos.y);
    if (wantsMove && moved < 14) { const a = rand(6.28); u.ai.nudge = { x: Math.cos(a), y: Math.sin(a) }; u.ai.nudgeT = 0.6; }
    u.ai.lastPos = { x: u.x, y: u.y }; u.ai.stuckT = 0;
  }
}
function aimAndShoot(u, tgt, dt, opts = {}) {
  const tx = tgt.x, ty = tgt.y;
  const want = Math.atan2(ty - u.y, tx - u.x);
  u.angle = turnTo(u.angle, want, dt * (opts.turn || 6));
  const d = dist(u.x, u.y, tx, ty);
  if (u.ai.react > 0) return;
  if (d > u.weapon.def.range * 0.95) return;
  if (Math.abs(angDiff(u.angle, want)) > 0.16) return;
  if (opts.burst !== undefined && !opts.burst) return;
  const tspeed = tgt.vx !== undefined ? Math.hypot(tgt.vx, tgt.vy) : 0;
  let err = ROLE[u.role].err * G.diff.acc * (1 + tspeed / 260) * (tgt.inTrench ? 1.25 : 1) * (d < 150 ? 0.7 : 1);
  if (tgt.isPlayer && tgt.ads) err *= 0.95;
  const ok = fireWeapon(u, want + (Math.random() - 0.5) * 2 * err, 0);
  if (ok && u.role === 'gunner') u.ai.burst--;
}
export function updateAI(u, dt) {
  const ai = u.ai, R = ROLE[u.role];
  updateWeaponTimers(u, dt);
  ai.think -= dt; ai.react = Math.max(0, ai.react - dt); ai.gCd -= dt; ai.meleeCd -= dt; ai.stateT -= dt;
  if (ai.think <= 0) {
    ai.think = rand(0.18, 0.3);
    const prev = ai.target;
    if (ai.target && (!ai.target.alive || !canSee(u, ai.target.x, ai.target.y, R.sight * 1.1))) ai.target = null;
    const t = pickTarget(u);
    if (t && (!ai.target || t !== ai.target)) ai.target = t;
    if (ai.target && ai.target !== prev) ai.react = rand(...R.react) * (G.diff.react || 1);
  }
  const tgt = ai.target;
  const tile = tileAtPx(u.x, u.y); u.inTrench = tile === T.TRENCH || tile === T.FLOOR;
  if (tile === T.WIRE && Math.random() < dt * 2) damage(u, 2, { x: u.x, y: u.y, kind: 'wire', team: -1 });
  const obj = G.objectives[G.active];
  const sp = u.speedBase;
  let wants = true;
  switch (u.role) {
    case 'assault': {
      const inZone = obj && dist(u.x, u.y, obj.x, obj.y) < obj.r * 0.75;
      if (tgt) {
        const d = dist(u.x, u.y, tgt.x, tgt.y);
        aimAndShoot(u, tgt, dt);
        const auto = u.weapon.def.auto;
        if (d < u.weapon.def.range * (auto ? 0.4 : 0.65) && !inZone && Math.random() > 0.003) {
          // hold & strafe
          const a = Math.atan2(tgt.y - u.y, tgt.x - u.x) + Math.PI / 2 * ai.flank;
          steerMove(u, Math.cos(a) * 0.3, Math.sin(a) * 0.3, sp * 0.6, dt); wants = false;
          if (Math.random() < dt * 0.3) ai.flank *= -1;
        } else if (inZone) { steerMove(u, 0, 0, 0, dt); wants = false; }
        else followField(u, G.fields.obj, sp * 0.8, dt);
        if (tgt.alive !== undefined && ai.gCd <= 0 && u.grenades > 0 && d > 160 && d < 400 && Math.random() < 0.02) { throwGrenade(u, tgt.x, tgt.y); u.grenades--; ai.gCd = 12; }
      } else {
        if (inZone) {
          ai.wander -= dt;
          if (ai.wander <= 0 || !ai.wp) { ai.wander = rand(2, 4); ai.wp = randomTileNear(obj.x, obj.y, obj.r * 0.6); }
          if (ai.wp && dist(u.x, u.y, ai.wp.x, ai.wp.y) > 20) { const a = Math.atan2(ai.wp.y - u.y, ai.wp.x - u.x); steerMove(u, Math.cos(a), Math.sin(a), sp * 0.5, dt); u.angle = turnTo(u.angle, a, dt * 4); }
          else { steerMove(u, 0, 0, 0, dt); wants = false; u.angle = turnTo(u.angle, 0, dt * 2); }
        } else {
          followField(u, G.fields.obj, sp, dt);
          if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 5);
        }
      }
      break;
    }
    case 'defender': {
      if (!ai.anchor || ai.anchorObj !== G.active) {
        ai.anchorObj = G.active;
        ai.anchor = obj ? randomTileNear(obj.x + rand(-60, 160), obj.y, obj.r * 1.3, (t) => t === T.TRENCH || t === T.FLOOR || Math.random() < 0.25) : null;
        if (ai.anchor) requestField(u, ai.anchor.x, ai.anchor.y);
      }
      if (tgt) {
        aimAndShoot(u, tgt, dt);
        const d = dist(u.x, u.y, tgt.x, tgt.y);
        if (d < 520) { steerMove(u, 0, 0, 0, dt); wants = false; }
        else if (ai.field) followField(u, ai.field, sp * 0.7, dt);
        if (ai.gCd <= 0 && u.grenades > 0 && d > 150 && d < 400 && Math.random() < 0.015) { throwGrenade(u, tgt.x + rand(-30, 30), tgt.y + rand(-30, 30)); u.grenades--; ai.gCd = 14; }
      } else if (ai.anchor && dist(u.x, u.y, ai.anchor.x, ai.anchor.y) > 26) {
        if (ai.field) followField(u, ai.field, sp, dt); else followField(u, G.fields.obj, sp, dt);
        if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 5);
      } else {
        steerMove(u, 0, 0, 0, dt); wants = false;
        u.angle = turnTo(u.angle, Math.PI + Math.sin(G.time * 0.4 + u.id) * 0.6, dt * 1.5);
      }
      break;
    }
    case 'rusher': {
      const prey = tgt && tgt.alive && tgt.r ? tgt : null;
      const chasePlayer = !!nearestHuman(u, 1700);
      ai.zig += dt * 5;
      if (prey) {
        const d = dist(u.x, u.y, prey.x, prey.y);
        const a = Math.atan2(prey.y - u.y, prey.x - u.x);
        if (d < u.r + prey.r + 8 && ai.meleeCd <= 0 && prey.team !== undefined) {
          ai.meleeCd = 0.8; damage(prey, 45, { owner: u, team: u.team, x: u.x, y: u.y, kind: 'melee' }); sfx('thud', u.x, u.y);
        }
        const z = Math.sin(ai.zig) * 0.55;
        steerMove(u, Math.cos(a + z), Math.sin(a + z), sp, dt);
        aimAndShoot(u, prey, dt, { turn: 8, burst: d < 360 });
      } else if (chasePlayer) {
        followField(u, G.fields.player, sp, dt);
        if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 6);
      } else {
        followField(u, G.fields.objRev, sp * 0.9, dt);
        if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 6);
      }
      break;
    }
    case 'stalker': {
      const p = nearestHuman(u);
      const alive = !!p;
      ai.observed = isObservedByPlayer(u);
      const d = alive ? dist(u.x, u.y, p.x, p.y) : 9999;
      if (alive && d < 230 && ai.state !== 'strike') { ai.state = 'strike'; ai.stateT = 3; }
      if (ai.state === 'strike' && ai.stateT <= 0) { ai.state = 'move'; }
      if (!alive) {
        if (tgt) { aimAndShoot(u, tgt, dt); steerMove(u, 0, 0, 0, dt); } else followField(u, G.fields.objRev, sp, dt);
        break;
      }
      if (ai.state === 'strike') {
        const a = Math.atan2(p.y - u.y, p.x - u.x);
        if (d > 70) steerMove(u, Math.cos(a), Math.sin(a), sp * 1.35, dt); else steerMove(u, Math.cos(a + 1.6 * ai.flank), Math.sin(a + 1.6 * ai.flank), sp, dt);
        if (canSee(u, p.x, p.y, 700)) { if (ai.react > 0.2) ai.react = 0.2; aimAndShoot(u, p, dt, { turn: 9 }); }
      } else if (ai.observed && d > 230) {
        // break line of sight or freeze
        if (!ai.hide || G.time - ai.hideT > 2) {
          ai.hideT = G.time; ai.hide = null;
          for (let k = 0; k < 10; k++) {
            const a = rand(6.28), r = rand(60, 120), hx = u.x + Math.cos(a) * r, hy = u.y + Math.sin(a) * r;
            if (!solidSoldier(tileAtPx(hx, hy)) && los(u.x, u.y, hx, hy) && !los(ai.observed.x, ai.observed.y, hx, hy)) { ai.hide = { x: hx, y: hy }; break; }
          }
        }
        if (ai.hide && dist(u.x, u.y, ai.hide.x, ai.hide.y) > 12) { const a = Math.atan2(ai.hide.y - u.y, ai.hide.x - u.x); steerMove(u, Math.cos(a), Math.sin(a), sp * 1.2, dt); }
        else { steerMove(u, 0, 0, 0, dt); wants = false; }
        u.angle = turnTo(u.angle, Math.atan2(p.y - u.y, p.x - u.x), dt * 3);
        // opportunistic shot if player looks right at them close
        if (d < 420 && canSee(u, p.x, p.y, 500)) aimAndShoot(u, p, dt);
        if (ai.gCd <= 0 && u.grenades > 0 && d > 200 && d < 420 && Math.random() < 0.04) { throwGrenade(u, p.x, p.y); u.grenades--; ai.gCd = 10; }
      } else {
        followField(u, G.fields.player, sp, dt);
        if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 5);
        if (ai.gCd <= 0 && u.grenades > 0 && d > 200 && d < 420 && canSee(u, p.x, p.y, 450) && Math.random() < 0.03) { throwGrenade(u, p.x, p.y); u.grenades--; ai.gCd = 10; }
        if (tgt && !tgt.isPlayer && dist(u.x, u.y, tgt.x, tgt.y) < 300) aimAndShoot(u, tgt, dt);
      }
      ai.still = u.moving ? 0 : ai.still + dt;
      break;
    }
    case 'sniper': {
      if (!ai.perch || ai.perchObj !== G.active) {
        ai.perchObj = G.active; const list = perches[Math.min(G.active, perches.length - 1)] || [];
        ai.perch = list.length ? pick(list) : { x: u.x, y: u.y }; requestField(u, ai.perch.x, ai.perch.y);
      }
      const atPerch = dist(u.x, u.y, ai.perch.x, ai.perch.y) < 30;
      if (tgt && tgt.r) {
        const d = dist(u.x, u.y, tgt.x, tgt.y);
        u.angle = turnTo(u.angle, Math.atan2(tgt.y - u.y, tgt.x - u.x), dt * 3);
        steerMove(u, 0, 0, 0, dt); wants = false;
        if (u.cd <= 0 && u.reloadT <= 0 && d < u.weapon.def.range) {
          if (ai.aimT === 0 && tgt.isPlayer) sfx('glint', u.x, u.y, 2.5);
          ai.aimT += dt;
          G.lasers.push({ x: u.x, y: u.y, tx: tgt.x, ty: tgt.y, p: Math.min(1, ai.aimT / 1.7), atPlayer: tgt === G.player, pid: tgt.isPlayer ? tgt.pid : -1 });
          if (ai.aimT >= 1.7) {
            const a = Math.atan2(tgt.y - u.y, tgt.x - u.x); u.angle = a;
            fireWeapon(u, a + (Math.random() - 0.5) * 2 * ROLE.sniper.err * G.diff.acc);
            ai.aimT = 0; ai.shots++;
            if (ai.shots >= 2) { ai.shots = 0; const list = perches[Math.min(G.active, perches.length - 1)] || []; if (list.length) { ai.perch = pick(list); requestField(u, ai.perch.x, ai.perch.y); } }
          }
        }
      } else {
        ai.aimT = Math.max(0, ai.aimT - dt * 2);
        if (!atPerch && ai.field) { followField(u, ai.field, sp, dt); if (u.moving) u.angle = turnTo(u.angle, Math.atan2(u.vy, u.vx), dt * 4); }
        else { steerMove(u, 0, 0, 0, dt); wants = false; u.angle = turnTo(u.angle, Math.PI + Math.sin(G.time * 0.3 + u.id) * 0.5, dt); }
      }
      break;
    }
    case 'gunner': {
      if (!ai.anchor) ai.anchor = { x: u.x, y: u.y };
      steerMove(u, 0, 0, 0, dt); wants = false;
      if (dist(u.x, u.y, ai.anchor.x, ai.anchor.y) > 20) { const a = Math.atan2(ai.anchor.y - u.y, ai.anchor.x - u.x); steerMove(u, Math.cos(a), Math.sin(a), sp, dt); }
      if (tgt) {
        if (ai.burst <= 0) { ai.burstPause -= dt; if (ai.burstPause <= 0) { ai.burst = randi(8, 16); ai.burstPause = rand(0.6, 1.1); } }
        aimAndShoot(u, tgt, dt, { turn: 2.5, burst: ai.burst > 0 });
      } else u.angle = turnTo(u.angle, Math.PI + Math.sin(G.time * 0.6 + u.id) * 0.7, dt * 1.2);
      break;
    }
  }
  stuckCheck(u, dt, wants);
  u.walk += Math.hypot(u.vx, u.vy) * dt * 0.08;
  u.hitFlash = Math.max(0, u.hitFlash - dt);
}

// ---------------- TANKS ----------------
export class Tank {
  constructor(team, x, y, a, playerOwned = false) {
    this.team = team; this.x = x; this.y = y; this.a = a; this.ta = a; this.vx = 0; this.vy = 0; this.speed = 0;
    this.maxHp = this.hp = team === ALLY ? 1300 : 1400; this.alive = true; this.reload = 0; this.mgCd = 0; this.track = 0; this.hitFlash = 0;
    this.playerOwned = playerOwned; this.isPlayer = false; this.r = 30; this.name = team === ALLY ? 'M4 Sherman' : 'Panzer IV';
    this.ai = { target: null, think: 0 }; this.engine = 0; this.lastFire = -9; this.id = UID++;
  }
}
export function tankDrive(tk, fwd, turn, dt) {
  const maxSp = tk.team === ALLY ? 155 : 105;
  tk.a += turn * dt * (tk.team === ALLY ? 1.7 : 1.1);
  tk.speed = lerp(tk.speed, fwd * maxSp, Math.min(1, dt * 2.2));
  const t = tileAtPx(tk.x, tk.y); const slow = t === T.MUD || t === T.CRATER ? 0.8 : t === T.TRENCH ? 0.7 : 1;
  const dx = Math.cos(tk.a) * tk.speed * slow * dt, dy = Math.sin(tk.a) * tk.speed * slow * dt;
  moveCircle(tk, dx, dy, 28, true);
  tk.track += Math.abs(tk.speed) * dt * 0.15 + Math.abs(turn) * dt * 3;
  // crush sandbags/wire
  if (Math.abs(tk.speed) > 10) {
    const cx = Math.floor(tk.x / TILE), cy = Math.floor(tk.y / TILE);
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
      const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE;
      if (dist2(px, py, tk.x, tk.y) < 34 * 34) { if (destroyTile(xx, yy)) { G.dirtyFields = true; sfx('crush', px, py, 0.6); } }
    }
    tk.engine -= dt; if (tk.engine <= 0) { tk.engine = 0.25; sfx('tankmove', tk.x, tk.y, 0.8); }
    if (Math.random() < dt * 8) G.particles.push({ type: 'dust', x: tk.x - Math.cos(tk.a) * 38 + rand(-14, 14), y: tk.y - Math.sin(tk.a) * 38 + rand(-14, 14), vx: rand(-10, 10), vy: rand(-10, 10), life: 1.2, max: 1.2, size: 6, grow: 20, a: 0.25 });
  }
  // push / crush soldiers
  for (const u of G.units) {
    if (!u.alive) continue;
    const d = dist(u.x, u.y, tk.x, tk.y);
    if (d < 40) {
      if (u.team !== tk.team && Math.abs(tk.speed) > 50 && pointInTank(tk, u.x + Math.cos(tk.a) * 8 * Math.sign(tk.speed), u.y + Math.sin(tk.a) * 8 * Math.sign(tk.speed))) { damage(u, 200, { owner: tk, team: tk.team, x: tk.x, y: tk.y, kind: 'crush' }); continue; }
      const a = Math.atan2(u.y - tk.y, u.x - tk.x); moveCircle(u, Math.cos(a) * (40 - d), Math.sin(a) * (40 - d), u.r);
    }
  }
  // tank-tank collision
  for (const o of G.tanks) if (o !== tk && o.alive) { const d = dist(o.x, o.y, tk.x, tk.y); if (d < 64) { const a = Math.atan2(tk.y - o.y, tk.x - o.x); moveCircle(tk, Math.cos(a) * (64 - d) * 0.5, Math.sin(a) * (64 - d) * 0.5, 28, true); tk.speed *= 0.5; } }
  for (const w of G.wrecks) { const d = dist(w.x, w.y, tk.x, tk.y); if (d < 60) { const a = Math.atan2(tk.y - w.y, tk.x - w.x); moveCircle(tk, Math.cos(a) * (60 - d), Math.sin(a) * (60 - d), 28, true); } }
}
export function tankFire(tk) {
  if (tk.reload > 0) return false;
  tk.reload = tk.team === ALLY ? 1.9 : 4.2; tk.lastFire = G.time;
  const mx = tk.x + Math.cos(tk.ta) * 52, my = tk.y + Math.sin(tk.ta) * 52;
  G.shells.push({ x: mx, y: my, vx: Math.cos(tk.ta) * 1500, vy: Math.sin(tk.ta) * 1500, team: tk.team, owner: tk.playerOwned ? { playerOwned: true, isPlayer: false, pid: tk.pid, x: tk.x, y: tk.y } : tk, trav: 0, range: 1300, kind: 'shell' });
  for (let i = 0; i < 10; i++) G.particles.push({ type: 'smoke', x: mx, y: my, vx: Math.cos(tk.ta + rand(-0.6, 0.6)) * rand(40, 200), vy: Math.sin(tk.ta + rand(-0.6, 0.6)) * rand(40, 200), life: 1.4, max: 1.4, size: 10, grow: 26, a: 0.45, drag: 2 });
  for (let i = 0; i < 6; i++) G.particles.push({ type: 'fire', x: mx, y: my, vx: Math.cos(tk.ta) * rand(100, 400), vy: Math.sin(tk.ta) * rand(100, 400), life: 0.12, max: 0.12, size: rand(8, 16) });
  G.flashes.push({ x: mx, y: my, r: 180, life: 0.12, max: 0.12 });
  sfx('cannon', tk.x, tk.y);
  if (tk.playerOwned && tk === G.playerTank) G.cam.shake = Math.max(G.cam.shake, 14);
  G.noise.push({ x: tk.x, y: tk.y, team: tk.team, t: G.time, r: 900 });
  return true;
}
export function tankMG(tk, dt, ang) {
  tk.mgCd -= dt; if (tk.mgCd > 0) return;
  tk.mgCd = tk.team === ALLY ? 0.075 : 0.11;
  const mx = tk.x + Math.cos(tk.ta) * 30, my = tk.y + Math.sin(tk.ta) * 30;
  const a = ang + rand(-0.06, 0.06);
  const owner = tk.playerOwned ? { playerOwned: true, isPlayer: false, pid: tk.pid, x: tk.x, y: tk.y, inTrench: false, role: 'tank', alive: true } : { x: tk.x, y: tk.y, inTrench: false, role: 'tank', alive: true };
  G.bullets.push({ x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * 1600, vy: Math.sin(a) * 1600, dmg: tk.team === ALLY ? 22 : 15, team: tk.team, owner, trav: 80, range: 800, alive: true, life: 0 });
  G.particles.push({ type: 'fire', x: mx, y: my, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, life: 0.06, max: 0.06, size: 5 });
  sfx('mg42', tk.x, tk.y, 0.7);
}
export function updateShells(dt) {
  for (const s of G.shells) {
    if (s.kind === 'shell') {
      const sp = Math.hypot(s.vx, s.vy) * dt; const steps = Math.ceil(sp / 10);
      for (let k = 0; k < steps && !s.dead; k++) {
        s.x += s.vx * dt / steps; s.y += s.vy * dt / steps; s.trav += sp / steps;
        const t = tileAtPx(s.x, s.y);
        let hit = s.trav > s.range || t === T.WALL || ((t === T.SANDBAG || t === T.SLIT) && s.trav > 90);
        if (!hit) for (const u of G.units) if (u.alive && u.team !== s.team && dist2(u.x, u.y, s.x, s.y) < 18 * 18) { hit = true; break; }
        if (!hit) for (const tk of G.tanks) if (tk.alive && tk.team !== s.team && pointInTank(tk, s.x, s.y)) { hit = true; damageTank(tk, 260, s.owner); break; }
        if (hit) { s.dead = true; explode(s.x, s.y, { r: 105, dmg: 190, team: s.team, owner: s.owner, tankMul: 0.8, destroy: true }); }
      }
      if (Math.random() < 0.6) G.particles.push({ type: 'smoke', x: s.x, y: s.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 3, grow: 8, a: 0.3 });
    } else if (s.kind === 'arty' || s.kind === 'bomb') {
      s.t -= dt;
      if (s.kind === 'arty' && !s.whistled && s.t < 1.75) { s.whistled = true; sfx('whistle', s.x, s.y, 1.4); }
      if (s.t <= 0) { s.dead = true; explode(s.x, s.y, { r: s.r, dmg: s.dmg, team: s.team, owner: s.owner, tankMul: s.kind === 'bomb' ? 2.2 : 1.2, destroy: true, big: true }); }
    } else if (s.kind === 'strafe') {
      s.t -= dt;
      if (s.t <= 0) {
        s.dead = true;
        for (const u of G.units) if (u.alive && u.team !== s.team && dist2(u.x, u.y, s.x, s.y) < 34 * 34) damage(u, 60, { owner: s.owner, team: s.team, x: s.x, y: s.y - 50, kind: 'strafe' });
        for (const tk of G.tanks) if (tk.alive && tk.team !== s.team && dist2(tk.x, tk.y, s.x, s.y) < 50 * 50) damageTank(tk, 30, s.owner);
        for (let i = 0; i < 4; i++) G.particles.push({ type: 'dirt', x: s.x, y: s.y, vx: rand(-140, 140), vy: rand(-140, 140), life: 0.4, max: 0.4, size: 3, drag: 4 });
        G.particles.push({ type: 'dust', x: s.x, y: s.y, vx: 0, vy: 0, life: 0.8, max: 0.8, size: 6, grow: 22, a: 0.4 });
        scorch(s.x, s.y, 8);
      }
    }
  }
  G.shells = G.shells.filter((s) => !s.dead);
}
export function callArtillery(x, y, team, owner, n = 8, spread = 170) {
  for (let i = 0; i < n; i++) {
    const a = rand(6.28), r = Math.sqrt(Math.random()) * spread;
    G.shells.push({ kind: 'arty', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, t: 2.2 + i * rand(0.25, 0.45), team, owner, r: 120, dmg: 170, total: 2.2 + i * 0.4 });
  }
  G.artyMarks.push({ x, y, r: spread, team, until: G.time + 2.2 + n * 0.45 });
}
export function callPlane(x, y, owner) {
  const p = { x: x - 2200, y, tx: x, ty: y, vx: 820, team: ALLY, owner, dropped: 0, strafeNext: 0, done: false, t: 0 };
  G.planes.push(p); setTimeout(() => sfx('plane', x, y, 1.2), 900);
  G.artyMarks.push({ x, y, r: 230, team: ALLY, until: G.time + 4.2, plane: true });
}
export function updatePlanes(dt) {
  for (const p of G.planes) {
    p.t += dt; p.x += p.vx * dt;
    const rel = p.x - p.tx;
    if (rel > -760 && rel < -280) { p.strafeNext -= dt; if (p.strafeNext <= 0) { p.strafeNext = 0.035; G.shells.push({ kind: 'strafe', x: p.x + 160 + rand(-20, 60), y: p.y + rand(-38, 38) + (Math.random() < 0.5 ? -26 : 26), t: 0.08, team: p.team, owner: p.owner }); if (Math.random() < 0.5) sfx('mg42', p.x, p.y, 0.6); } }
    if (rel > -260 && p.dropped < 7) { const want = Math.floor((rel + 260) / 75); while (p.dropped < 7 && p.dropped <= want) { G.shells.push({ kind: 'bomb', x: p.x + 40, y: p.y + rand(-60, 60), t: 0.6, team: p.team, owner: p.owner, r: 135, dmg: 240 }); p.dropped++; } }
    if (p.x > p.tx + 2400) p.done = true;
  }
  G.planes = G.planes.filter((p) => !p.done);
}

// spawn helpers for Axis special units
export function spawnNestGunner(i) {
  const n = nests[i]; if (!n) return null; const s = n[0];
  const u = new Soldier(AXIS, s.x, s.y, 'gunner'); u.angle = Math.PI; u.ai.anchor = { x: s.x, y: s.y }; return u;
}
