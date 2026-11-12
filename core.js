// ============ CORE: constants, utils, input, audio ============
export const TILE = 32, COLS = 172, ROWS = 56;
export const WW = COLS * TILE, WH = ROWS * TILE;
export const T = { GROUND: 0, MUD: 1, TRENCH: 2, SANDBAG: 3, WALL: 4, WIRE: 5, CRATER: 6, FLOOR: 7, SLIT: 8 };
export const ALLY = 0, AXIS = 1;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => (bx - ax) ** 2 + (by - ay) ** 2;
export const angNorm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const angDiff = (a, b) => angNorm(b - a);
export const turnTo = (cur, target, maxStep) => { const d = angDiff(cur, target); return cur + clamp(d, -maxStep, maxStep); };

// Global mutable game state (filled in game.js)
export const G = {
  time: 0, mode: 'title', units: [], bullets: [], grenades: [], particles: [], tanks: [], planes: [], shells: [],
  corpses: [], smokes: [], crates: [], lasers: [], player: null, cam: { x: 0, y: 0, zoom: 1, shake: 0 },
  feed: [], bp: 0, tickets: 0, timer: 0, active: 0, objectives: [], spotted: [], stats: { kills: 0, deaths: 0, caps: 0, bpEarned: 0 },
};

// ---------------- INPUT ----------------
export const Input = {
  keys: {}, pressed: {}, mouse: { sx: 0, sy: 0, wx: 0, wy: 0, l: false, r: false, lPressed: false, rPressed: false }, wheel: 0,
  touch: { enabled: false, move: { x: 0, y: 0, id: null, ox: 0, oy: 0 }, aim: { x: 0, y: 0, id: null, ox: 0, oy: 0, active: false } },
  init(canvas) {
    window.addEventListener('keydown', (e) => {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (typing) return; // let players type names/codes (including spaces)
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.l = this.mouse.r = false; });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') this.setTouch(false); else if (e.pointerType === 'touch') this.setTouch(true); }, true);
    window.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) this.setTouch(false); }, { passive: true });
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); this.mouse.sx = e.clientX - r.left; this.mouse.sy = e.clientY - r.top; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.l = true; this.mouse.lPressed = true; }
      if (e.button === 2) { this.mouse.r = true; this.mouse.rPressed = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  },
  endFrame() { this.pressed = {}; this.mouse.lPressed = false; this.mouse.rPressed = false; this.wheel = 0; },
  down(c) { return !!this.keys[c]; },
  hit(c) { return !!this.pressed[c]; },
  // Switch between touch controls and mouse/keyboard based on the last input used,
  // so touchscreen laptops still shoot with the mouse.
  touchCapable: false,
  setTouch(on) {
    if (!this.touchCapable) on = false;
    if (this.touch.enabled === on) return;
    this.touch.enabled = on;
    document.body.classList.toggle('touch', on);
    const tz = document.getElementById('touch'); if (tz) tz.hidden = !on;
    if (!on) { this.touch.move.x = this.touch.move.y = 0; this.touch.aim.x = this.touch.aim.y = 0; this.touch.aim.active = false; this.touch.move.id = this.touch.aim.id = null; }
  },
};

// ---------------- AUDIO (Web Audio procedural SFX) ----------------
let ac = null, master = null, noiseBuf = null, voices = 0;
export const Audio = { muted: false, sfxVol: 0.8, ready: false };
export function initAudio() {
  if (ac) { ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.55;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    Audio.ready = true;
  } catch (e) { console.warn('audio off', e); }
}
export function setMuted(m) { Audio.muted = m; if (master) master.gain.value = m ? 0 : 0.55; }

const PROFILES = {
  rifle: { f: 1900, q: 0.8, dec: 0.22, vol: 0.55, thump: 110 },
  kar98: { f: 1600, q: 0.8, dec: 0.26, vol: 0.55, thump: 95 },
  smg: { f: 2600, q: 1.0, dec: 0.09, vol: 0.32, thump: 140 },
  lmg: { f: 1700, q: 0.9, dec: 0.14, vol: 0.42, thump: 100 },
  mg42: { f: 2200, q: 0.8, dec: 0.07, vol: 0.32, thump: 120 },
  sniper: { f: 1300, q: 0.7, dec: 0.45, vol: 0.75, thump: 70 },
  shotgun: { f: 1100, q: 0.6, dec: 0.32, vol: 0.7, thump: 70 },
  pistol: { f: 2800, q: 1.0, dec: 0.1, vol: 0.32, thump: 160 },
  cannon: { f: 500, q: 0.6, dec: 0.9, vol: 1.0, thump: 50 },
  explosion: { f: 450, q: 0.5, dec: 1.3, vol: 1.0, thump: 45 },
  bigexp: { f: 320, q: 0.5, dec: 2.0, vol: 1.2, thump: 35 },
};
function pan(x) {
  const c = G.cam; if (!ac) return 0;
  return clamp((x - c.x) / 900, -0.9, 0.9);
}
function atten(x, y) {
  const c = G.cam; const d = Math.hypot(x - c.x, y - c.y);
  return 1 / (1 + (d / 520) ** 1.6);
}
export function sfx(type, x = G.cam.x, y = G.cam.y, vol = 1) {
  if (G.sfxHook && arguments.length > 1 && G.sfxHook(type, x, y, vol) === false) return;
  if (!ac || Audio.muted || voices > 28) return;
  const t = ac.currentTime;
  const a = atten(x, y) * vol * Audio.sfxVol; if (a < 0.015) return;
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null; if (p) p.pan.value = pan(x);
  const out = p || master; if (p) p.connect(master);
  voices++; setTimeout(() => voices--, 600);
  const pr = PROFILES[type];
  if (pr) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(pr.f * (1 + Math.random() * 0.2), t); fl.frequency.exponentialRampToValueAtTime(Math.max(80, pr.f * 0.15), t + pr.dec); fl.Q.value = pr.q;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pr.vol * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + pr.dec);
    src.connect(fl).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + pr.dec + 0.05);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(pr.thump * 1.6, t); o.frequency.exponentialRampToValueAtTime(pr.thump * 0.4, t + pr.dec * 0.6);
    const og = ac.createGain(); og.gain.setValueAtTime(pr.vol * a * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + pr.dec * 0.7);
    o.connect(og).connect(out); o.start(t); o.stop(t + pr.dec);
    return;
  }
  const tone = (type0, f0, f1, dur, v, delay = 0) => {
    const o = ac.createOscillator(); o.type = type0; o.frequency.setValueAtTime(f0, t + delay); o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(v * a, t + delay + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    o.connect(g).connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.02);
  };
  const noise = (f, dur, v, type0 = 'bandpass', delay = 0) => {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter(); fl.type = type0; fl.frequency.value = f; fl.Q.value = 2;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(v * a, t + delay + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    src.connect(fl).connect(g).connect(out); src.start(t + delay, Math.random()); src.stop(t + delay + dur + 0.05);
  };
  switch (type) {
    case 'whistle': tone('sine', 1900, 500, 1.7, 0.12); break;
    case 'hit': noise(900, 0.06, 0.4); break;
    case 'hitmarker': tone('square', 1800, 1400, 0.05, 0.12); break;
    case 'kill': tone('triangle', 900, 1300, 0.12, 0.2); tone('triangle', 1300, 1700, 0.12, 0.15, 0.08); break;
    case 'ric': tone('sine', 3200, 900, 0.18, 0.08); break;
    case 'reload': noise(3000, 0.04, 0.3); noise(2200, 0.05, 0.3, 'bandpass', 0.25); break;
    case 'click': noise(4000, 0.02, 0.25); break;
    case 'empty': tone('square', 600, 500, 0.03, 0.1); break;
    case 'bolt': noise(2500, 0.05, 0.3); noise(1800, 0.06, 0.3, 'bandpass', 0.18); break;
    case 'capture': tone('triangle', 523, 523, 0.25, 0.25); tone('triangle', 659, 659, 0.25, 0.25, 0.18); tone('triangle', 784, 784, 0.5, 0.28, 0.36); break;
    case 'lost': tone('sawtooth', 300, 150, 0.6, 0.12); break;
    case 'alarm': tone('square', 700, 700, 0.15, 0.12); tone('square', 520, 520, 0.15, 0.12, 0.2); break;
    case 'glint': tone('sine', 2600, 2400, 0.25, 0.07); break;
    case 'radio': noise(1800, 0.25, 0.18); tone('square', 1000, 1000, 0.08, 0.06, 0.28); tone('square', 1000, 1000, 0.08, 0.06, 0.42); break;
    case 'plane': {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 1.6); o.frequency.linearRampToValueAtTime(60, t + 3.6);
      const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
      o.connect(fl).connect(g).connect(master); o.start(t); o.stop(t + 4);
      break;
    }
    case 'tankmove': noise(160, 0.25, 0.12, 'lowpass'); break;
    case 'thud': tone('sine', 140, 50, 0.15, 0.3); break;
    case 'step': noise(500, 0.05, 0.1); break;
    case 'ping': tone('sine', 2900, 2850, 0.35, 0.12); tone('sine', 4300, 4250, 0.25, 0.05); break;
    case 'pin': tone('sine', 4000, 3800, 0.05, 0.08); break;
    case 'heal': tone('sine', 600, 900, 0.3, 0.12); break;
    case 'crush': noise(700, 0.2, 0.3); break;
  }
}

// ---------------- MUSIC (Tone.js, loaded lazily) ----------------
export const Music = { on: true, started: false, Tone: null, vol: null };
export async function startMusic() {
  if (Music.started) return; Music.started = true;
  try {
    const Tone = window.Tone || await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = new URL('../vendor/Tone.js', import.meta.url).href; sc.onload = () => res(window.Tone); sc.onerror = rej; document.head.append(sc); });
    if (!Tone) throw new Error('Tone unavailable');
    Music.Tone = Tone; await Tone.start();
    const vol = new Tone.Volume(-20).toDestination(); Music.vol = vol;
    const rev = new Tone.Reverb({ decay: 6, wet: 0.45 }).connect(vol);
    const pad = new Tone.PolySynth(Tone.AMSynth, { harmonicity: 1.5, envelope: { attack: 1.8, decay: 0.5, sustain: 0.8, release: 3 }, oscillator: { type: 'fatsawtooth' } }).connect(new Tone.Filter(900, 'lowpass').connect(rev));
    pad.volume.value = -14;
    const horn = new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { Q: 1, type: 'lowpass' }, filterEnvelope: { attack: 0.2, baseFrequency: 300, octaves: 2 }, envelope: { attack: 0.3, decay: 0.3, sustain: 0.7, release: 1.5 } }).connect(rev);
    horn.volume.value = -16;
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(new Tone.Filter(2500, 'bandpass').connect(rev));
    snare.volume.value = -22;
    const timp = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 1.2, sustain: 0 } }).connect(rev);
    timp.volume.value = -10;
    const chords = [['A2', 'E3', 'C4'], ['F2', 'C3', 'A3'], ['D2', 'A2', 'F3'], ['E2', 'B2', 'G#3']];
    const melody = ['E4', null, 'C4', 'D4', 'E4', null, 'A3', null, 'F4', null, 'E4', 'D4', 'C4', null, 'B3', null];
    Tone.Transport.bpm.value = 72;
    let bar = 0;
    new Tone.Loop((time) => { pad.triggerAttackRelease(chords[bar % 4], '1m', time); timp.triggerAttackRelease('A1', '8n', time); bar++; }, '1m').start(0);
    new Tone.Sequence((time, n) => { if (n && Math.random() < 0.8) horn.triggerAttackRelease(n, '4n', time); }, melody, '4n').start('2m');
    new Tone.Sequence((time, v) => { if (v) snare.triggerAttackRelease('16n', time, v); }, [0.9, 0, 0.3, 0.4, 0.6, 0, 0.3, 0.3, 0.8, 0, 0.3, 0.4, 0.6, 0.3, 0.5, 0.7], '8n').start('4m');
    Tone.Transport.start();
    if (!Music.on || Audio.muted) vol.mute = true;
  } catch (e) { console.warn('music unavailable', e); }
}
export function setMusic(on) { Music.on = on; if (Music.vol) Music.vol.mute = !on || Audio.muted; }
