// The run: a course, a walker, four leg owners (humans or bots) and the clock. Pure: no
// DOM, no network. The host steps it; everyone else draws snapshots of it.
import { DT } from './constants.js';
import { buildCourse } from './courses.js';
import { createWalker, stepWalker, resetStance, ST } from './walker.js';
import { createBots, botInputs, botSignal } from './bots.js';
import { makeRng } from './rng.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cleanAxis = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0);

export function blankInput() {
  return { x: 0, y: 0, lift: false, brace: false };
}

/**
 * opts: { spec | course, cfg, owners: ['bot' | playerId] x4, pilot: playerId | null, botSkill, seed, autonomous }
 */
export function createSim(opts) {
  const course = opts.course ?? buildCourse(opts.spec ?? { kind: 'expedition', biome: 0, index: 0 });
  const cfg = opts.cfg ?? defaultCfg();
  const w = createWalker(course, cfg);
  const sim = {
    course,
    cfg,
    w,
    dyn: { crumble: new Float32Array(Math.max(1, course.stoneCount)).fill(-1), gone: new Float32Array(Math.max(1, course.stoneCount)).fill(-1) },
    owners: (opts.owners ?? ['bot', 'bot', 'bot', 'bot']).slice(0, 4),
    pilot: opts.pilot ?? null,
    pilotLeg: 2, // a rear foot first: the one nearest the camera, easiest to watch land
    taken: false,
    bots: createBots(opts.botSkill ?? cfg.mechanic ?? 0, makeRng(`${opts.seed ?? course.seed}-bots`)),
    autonomous: !!opts.autonomous,
    humans: [null, null, null, null],
    inputs: [blankInput(), blankInput(), blankInput(), blankInput()],
    mask: [true, true, true, true],
    lastInputT: [0, 0, 0, 0], // sim time a human's input last changed, per leg
    auto: [false, false, false, false], // a human leg nobody is driving: the bots step for it
    events: [],
    tick: 0,
    stats: { burns: 0, mudPlants: 0, braces: 0, snaps: 0 },
  };
  while (sim.owners.length < 4) sim.owners.push('bot');
  return sim;
}

export function defaultCfg() {
  return { reach: 3.4, stickRange: 2.2, gain: 1, tipMult: 1, cargoDamp: 1, gripMult: 1, windMult: 1, feet: ['std', 'std', 'std', 'std'], missing: -1, inert: [false, false, false, false], giant: false, swap: false, mechanic: 0 };
}

/** A human's input for a leg (validated). In Pilot mode the pilot's stick is the walker's intent. */
export const IDLE_LEG_S = 8;

export function setHumanInput(sim, leg, raw) {
  if (leg < 0 || leg > 3) return;
  const h = sim.humans[leg] ?? (sim.humans[leg] = blankInput());
  const x = cleanAxis(raw?.x);
  const y = cleanAxis(raw?.y);
  const lift = raw?.lift === true;
  const brace = raw?.brace === true;
  if (Math.abs(x - h.x) > 0.05 || Math.abs(y - h.y) > 0.05 || lift !== h.lift || brace !== h.brace || Math.hypot(x, y) > 0.15 || lift) sim.lastInputT[leg] = sim.w.t;
  h.x = x;
  h.y = y;
  h.lift = lift;
  h.brace = brace;
}

export function clearHumanInput(sim, leg) {
  if (leg >= 0 && leg < 4) sim.humans[leg] = null;
}

export function isHumanLeg(sim, leg) {
  return sim.owners[leg] !== 'bot';
}

export function humanCount(sim) {
  return sim.owners.filter((o) => o !== 'bot').length;
}

export function signalSim(sim, kind) {
  botSignal(sim.bots, kind, sim.w.t);
}

export function requestReset(sim) {
  return resetStance(sim.w, sim.course, sim.dyn);
}

/** Pilot mode: the highlighted leg the pilot can take over (Tab cycles it). */
export function setPilotLeg(sim, leg) {
  if (sim.taken) return;
  sim.pilotLeg = ((leg % 4) + 4) % 4;
}

const pilotStick = [null, null, null, null];

/** One fixed step. */
export function stepSim(sim, dt = DT) {
  const { w, course, dyn, inputs } = sim;
  const swap = sim.cfg.swap;
  // Which legs the bots drive this tick, and what the humans are saying.
  if (sim.pilot) {
    // Pilot: every leg is a bot leg, except the highlighted one while its foot is taken.
    const h = sim.humans[0];
    const leg = sim.pilotLeg;
    const wl = w.legs[leg];
    if (h && h.lift && wl.st !== ST.STUN) sim.taken = true;
    if (sim.taken && wl.st === ST.STANCE && !(h && h.lift)) sim.taken = false;
    for (let i = 0; i < 4; i++) sim.mask[i] = !(sim.taken && i === leg);
    pilotStick[0] = h ? { x: swap ? -h.x : h.x, y: swap ? -h.y : h.y } : null;
    pilotStick[1] = pilotStick[2] = pilotStick[3] = null;
    botInputs(sim.bots, w, course, dyn, sim.mask, pilotStick, inputs, dt, sim.autonomous);
    if (sim.taken && h) {
      const inp = inputs[leg];
      inp.x = swap ? -h.x : h.x;
      inp.y = swap ? -h.y : h.y;
      inp.lift = h.lift;
      inp.brace = h.brace;
    } else if (h && h.brace) inputs[leg].brace = true;
  } else {
    let anyHuman = false;
    for (let i = 0; i < 4; i++) {
      // A leg whose player has gone quiet is stepped by the bots until they touch the controls again.
      sim.auto[i] = sim.owners[i] !== 'bot' && w.t - sim.lastInputT[i] > IDLE_LEG_S;
      const human = sim.owners[i] !== 'bot' && !sim.auto[i];
      sim.mask[i] = !human;
      const h = human ? sim.humans[i] : null;
      pilotStick[i] = h ? { x: swap ? -h.x : h.x, y: swap ? -h.y : h.y } : null;
      if (human) {
        anyHuman = true;
        const inp = inputs[i];
        inp.x = h ? (swap ? -h.x : h.x) : 0;
        inp.y = h ? (swap ? -h.y : h.y) : 0;
        inp.lift = !!h?.lift;
        inp.brace = !!h?.brace;
      }
    }
    botInputs(sim.bots, w, course, dyn, sim.mask, pilotStick, inputs, dt, sim.autonomous || !anyHuman);
  }
  if (sim.bots.wantReset) {
    sim.bots.wantReset = false;
    resetStance(w, course, dyn);
  }
  stepWalker(w, course, dyn, inputs, dt);
  sim.tick++;
  if (w.events.length) {
    for (const e of w.events) {
      if (e.type === 'burn' || e.type === 'fall' || e.type === 'soak') sim.stats.burns++;
      else if (e.type === 'plant' && e.surf === 2) sim.stats.mudPlants++;
      else if (e.type === 'brace') sim.stats.braces++;
      else if (e.type === 'snap') sim.stats.snaps++;
      sim.events.push(e);
    }
    w.events.length = 0;
    if (sim.events.length > 200) sim.events.splice(0, sim.events.length - 200);
  }
}

export function drainEvents(sim) {
  const e = sim.events;
  sim.events = [];
  return e;
}

/** Everything a new host needs to carry on exactly (compact JSON, well under 16 KB). */
export function snapshot(sim) {
  const w = sim.w;
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    t: r(w.t),
    b: [r(w.x), r(w.y), r(w.z), r(w.yaw), r(w.pitch), r(w.roll), r(w.vx), r(w.vy), r(w.vz), r(w.yawRate)],
    tip: [r(w.tip), r(w.tipDirX), r(w.tipDirZ)],
    tum: [r(w.tumbling), w.tumbles],
    legs: w.legs.map((l) => [l.st, r(l.fx), r(l.fy), r(l.fz), r(l.tx), r(l.tz), r(l.sw), r(l.sink), r(l.stun), r(l.brace), r(l.braceCd), l.platform, r(l.forced), r(l.sx), r(l.sz), r(l.lx), r(l.ly), r(l.lz), r(l.reach)]),
    cargo: [r(w.cargo.aF), r(w.cargo.aR), r(w.cargo.wF), r(w.cargo.wR), r(w.cargo.cond), w.cargo.spills],
    g: [r(w.groove), r(w.grooveBest), r(w.grooveSum), w.steps, r(w.lastPlantT), w.lastPlantLeg, r(w.lastInterval), r(w.grooveStreak)],
    run: [w.finished ? 1 : 0, r(w.finishT), w.over ? 1 : 0, w.overWhy, w.cp, r(w.maxX)],
    crumble: Array.from(sim.dyn.crumble, (v) => (v < 0 ? -1 : r(v))),
    gone: Array.from(sim.dyn.gone, (v) => (v < 0 ? -1 : r(v))),
    slabs: w.legs.map((l) => l.slab),
    stats: [sim.stats.burns, sim.stats.mudPlants, sim.stats.braces, sim.stats.snaps],
  };
}

const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Adopt a snapshot (validated: a lying host can't put NaN into the sim). Returns false if unusable. */
export function restore(sim, s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.b) || !Array.isArray(s.legs) || s.legs.length !== 4) return false;
  const w = sim.w;
  const L = sim.course.length;
  w.t = clamp(n(s.t), 0, 36000);
  w.x = clamp(n(s.b[0]), 0, L);
  w.y = clamp(n(s.b[1], 2), -20, 60);
  w.z = clamp(n(s.b[2]), -12, 12);
  w.yaw = clamp(n(s.b[3]), -4, 4);
  w.pitch = clamp(n(s.b[4]), -1.5, 1.5);
  w.roll = clamp(n(s.b[5]), -1.5, 1.5);
  w.vx = clamp(n(s.b[6]), -30, 30);
  w.vy = clamp(n(s.b[7]), -30, 30);
  w.vz = clamp(n(s.b[8]), -30, 30);
  w.yawRate = clamp(n(s.b[9]), -10, 10);
  w.pvx = w.vx;
  w.pvz = w.vz;
  if (Array.isArray(s.tip)) {
    w.tip = clamp(n(s.tip[0]), 0, 30);
    w.tipDirX = clamp(n(s.tip[1], 1), -1, 1);
    w.tipDirZ = clamp(n(s.tip[2]), -1, 1);
  }
  if (Array.isArray(s.tum)) {
    w.tumbling = clamp(n(s.tum[0]), 0, 5);
    w.tumbles = clamp(Math.round(n(s.tum[1])), 0, 999);
  }
  for (let i = 0; i < 4; i++) {
    const a = s.legs[i];
    const l = w.legs[i];
    if (!Array.isArray(a)) continue;
    l.st = [0, 1, 2].includes(a[0]) ? a[0] : 0;
    l.fx = clamp(n(a[1]), 0, L);
    l.fy = clamp(n(a[2]), -12, 40);
    l.fz = clamp(n(a[3]), -12, 12);
    l.tx = clamp(n(a[4]), 0, L);
    l.tz = clamp(n(a[5]), -12, 12);
    l.sw = clamp(n(a[6]), 0, 100);
    l.sink = clamp(n(a[7]), 0, 1);
    l.stun = clamp(n(a[8]), 0, 5);
    l.brace = clamp(n(a[9]), 0, 2);
    l.braceCd = clamp(n(a[10]), 0, 5);
    l.platform = Number.isInteger(a[11]) && a[11] >= -1 && a[11] < sim.course.platforms.length ? a[11] : -1;
    l.forced = clamp(n(a[12]), 0, 2);
    l.sx = clamp(n(a[13]), 0, L);
    l.sz = clamp(n(a[14]), -12, 12);
    l.lx = clamp(n(a[15]), 0, L);
    l.ly = clamp(n(a[16]), -12, 40);
    l.lz = clamp(n(a[17]), -12, 12);
    l.reach = clamp(n(a[18], sim.cfg.reach), 1, 5);
    if (l.absent) l.st = ST.STUN;
  }
  if (Array.isArray(s.cargo)) {
    w.cargo.aF = clamp(n(s.cargo[0]), -1.2, 1.2);
    w.cargo.aR = clamp(n(s.cargo[1]), -1.2, 1.2);
    w.cargo.wF = clamp(n(s.cargo[2]), -12, 12);
    w.cargo.wR = clamp(n(s.cargo[3]), -12, 12);
    w.cargo.cond = clamp(n(s.cargo[4], 1), 0, 1);
    w.cargo.spills = clamp(Math.round(n(s.cargo[5])), 0, 9999);
  }
  if (Array.isArray(s.g)) {
    w.groove = clamp(n(s.g[0]), 0, 100);
    w.grooveBest = clamp(n(s.g[1]), 0, 36000);
    w.grooveSum = clamp(n(s.g[2]), 0, 1e7);
    w.steps = clamp(Math.round(n(s.g[3])), 0, 1e6);
    w.lastPlantT = clamp(n(s.g[4], -10), -10, 36000);
    w.lastPlantLeg = Number.isInteger(s.g[5]) && s.g[5] >= -1 && s.g[5] <= 3 ? s.g[5] : -1;
    w.lastInterval = clamp(n(s.g[6]), 0, 100);
    w.grooveStreak = clamp(n(s.g[7]), 0, 36000);
  }
  if (Array.isArray(s.run)) {
    w.finished = s.run[0] === 1;
    w.finishT = clamp(n(s.run[1]), 0, 36000);
    w.over = s.run[2] === 1;
    w.overWhy = typeof s.run[3] === 'string' ? s.run[3].slice(0, 16) : '';
    w.cp = clamp(Math.round(n(s.run[4])), 0, 99);
    w.maxX = clamp(n(s.run[5]), 0, L);
  }
  if (Array.isArray(s.crumble)) {
    for (let i = 0; i < sim.dyn.crumble.length; i++) sim.dyn.crumble[i] = i < s.crumble.length ? clamp(n(s.crumble[i], -1), -1, 36000) : -1;
  }
  if (Array.isArray(s.gone)) {
    for (let i = 0; i < sim.dyn.gone.length; i++) sim.dyn.gone[i] = i < s.gone.length ? clamp(n(s.gone[i], -1), -1, 36000) : -1;
  }
  if (Array.isArray(s.slabs)) for (let i = 0; i < 4; i++) w.legs[i].slab = Number.isInteger(s.slabs[i]) && s.slabs[i] >= -1 && s.slabs[i] < sim.dyn.crumble.length ? s.slabs[i] : -1;
  if (Array.isArray(s.stats)) {
    sim.stats.burns = clamp(Math.round(n(s.stats[0])), 0, 1e6);
    sim.stats.mudPlants = clamp(Math.round(n(s.stats[1])), 0, 1e6);
    sim.stats.braces = clamp(Math.round(n(s.stats[2])), 0, 1e6);
    sim.stats.snaps = clamp(Math.round(n(s.stats[3])), 0, 1e6);
  }
  return true;
}
