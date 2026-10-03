// Courses: 24 expeditions (6 biomes x 4), Endless Stride, the Daily and time trials, all
// built from segment templates by a seeded generator, then checked and repaired so no
// course has an uncrossable gap.
import { S, CHECKPOINT_EVERY, TUMBLE_BUDGET, ENDLESS_BUDGET, HIPS } from './constants.js';
import { createTerrain, fillDisc, staticSurface, staticFeature, toIx, toIz } from './terrain.js';
import { TEMPLATES } from './segments.js';
import { makeRng, hashString } from './rng.js';

export const BIOMES = [
  { id: 'clay', name: 'Clay Flats', sky: 0, pool: ['hills', 'mud', 'stones', 'ridge'] },
  { id: 'salt', name: 'Salt Pans', sky: 1, pool: ['ice', 'wind', 'iceridge', 'ridge'] },
  { id: 'foundry', name: 'Foundry', sky: 2, pool: ['grates', 'vents', 'platforms', 'conveyor', 'pistons'] },
  { id: 'ravine', name: 'Ravine', sky: 3, pool: ['crumble', 'gap', 'springs', 'rockfall', 'rails'] },
  { id: 'clockwork', name: 'Clockwork Hills', sky: 4, pool: ['gears', 'bars', 'gates', 'swingbars', 'hills'] },
  { id: 'storm', name: 'Storm Coast', sky: 5, pool: ['shore', 'boulders', 'rockfall', 'stride'] },
];

const CARGO_BY_INDEX = (biome, index) => ['passengers', 'lanterns', biome % 2 === 0 ? 'soup' : 'boulder', 'egg'][index];

// Hand-authored recipes: [template, tier] in order. Checkpoints are inserted by the builder.
export const EXPEDITIONS = [
  // Clay Flats
  { name: 'First Steps', segs: [['hills', 1], ['mud', 1], ['stones', 1]] },
  { name: 'Puddle Run', segs: [['hills', 1], ['mud', 2], ['stones', 1], ['ridge', 1]] },
  { name: 'Stone Hop', segs: [['stones', 1], ['hills', 2], ['stones', 2], ['ridge', 1]] },
  { name: 'Clay Crown', segs: [['ridge', 2], ['stones', 2], ['hills', 2], ['mud', 3]] },
  // Salt Pans
  { name: 'Thin Ice', segs: [['ice', 1], ['hills', 1], ['wind', 1], ['ice', 1]] },
  { name: 'Crosswind', segs: [['wind', 1], ['iceridge', 1], ['ice', 2], ['ridge', 2]] },
  { name: 'White Out', segs: [['ice', 2], ['iceridge', 2], ['wind', 2], ['stones', 2]] },
  { name: 'Salt Crust', segs: [['iceridge', 2], ['wind', 2], ['ice', 3], ['iceridge', 3]] },
  // Foundry
  { name: 'Grate Expectations', segs: [['grates', 1], ['vents', 1], ['conveyor', 1], ['grates', 1]] },
  { name: 'Steam Shift', segs: [['vents', 2], ['platforms', 1], ['pistons', 1], ['grates', 2]] },
  { name: 'Belt Line', segs: [['conveyor', 2], ['platforms', 2], ['vents', 2], ['pistons', 2]] },
  { name: 'Full Furnace', segs: [['platforms', 3], ['vents', 3], ['conveyor', 3], ['pistons', 3], ['grates', 3]] },
  // Ravine
  { name: 'Loose Footing', segs: [['springs', 1], ['crumble', 1], ['gap', 1], ['rockfall', 1]] },
  { name: 'Two Across', segs: [['gap', 2], ['crumble', 2], ['rails', 1], ['springs', 2]] },
  { name: 'Narrow Rails', segs: [['rails', 2], ['rockfall', 2], ['gap', 2], ['crumble', 2]] },
  { name: 'Last Bridge', segs: [['crumble', 3], ['rails', 3], ['gap', 3], ['rockfall', 3], ['crumble', 3]] },
  // Clockwork Hills
  { name: 'Cogs', segs: [['hills', 2], ['gears', 1], ['bars', 1], ['gates', 1]] },
  { name: 'Pendulums', segs: [['swingbars', 1], ['gears', 2], ['hills', 2], ['gates', 2]] },
  { name: 'Tick Tock', segs: [['gates', 2], ['bars', 2], ['gears', 2], ['swingbars', 2]] },
  { name: 'Mainspring', segs: [['gears', 3], ['bars', 3], ['gates', 3], ['swingbars', 3]] },
  // Storm Coast
  { name: 'High Tide', segs: [['shore', 1], ['rockfall', 1], ['boulders', 1], ['shore', 2]] },
  { name: 'Rolling Stones', segs: [['boulders', 2], ['shore', 2], ['wind', 2], ['rockfall', 2]] },
  { name: 'Sea Spray', segs: [['shore', 3], ['boulders', 2], ['stones', 2], ['rockfall', 3]] },
  { name: 'The Great Stride', segs: [['shore', 3], ['boulders', 3], ['stride', 3], ['rockfall', 3], ['stride', 4]] },
];

export const MUTATORS = {
  slippery: { name: 'Slippery', grip: 0.5 },
  gusty: { name: 'Gusty', wind: 1.8 },
  tiny: { name: 'Tiny Legs', reach: -0.6 },
  three: { name: 'Three Legs', missing: 3 },
  giant: { name: 'Giant Cargo', cargoMass: 2, cargoHeight: 1.5 },
  nobots: { name: 'No Bots', inertBots: true },
  swap: { name: 'Back To Front', swap: true },
};
export const MUTATOR_IDS = Object.keys(MUTATORS);

export const expeditionId = (biome, index) => `e${biome + 1}-${index + 1}`;
export const expeditionCount = EXPEDITIONS.length;

/** The day number for the Daily (UTC), from the platform clock. */
export const dayNumber = (nowMs) => Math.floor(nowMs / 86400000);

export function dailySpec(nowMs) {
  const day = dayNumber(nowMs);
  const rng = makeRng(`daily-${day}`);
  return { kind: 'daily', seed: `daily-${day}`, day, mutators: [rng.pick(MUTATOR_IDS)], biome: rng.int(6) };
}

/**
 * Build a course from a spec:
 *  { kind: 'expedition', biome, index, seed?, mutators? }
 *  { kind: 'endless', seed }
 *  { kind: 'daily', seed, biome, mutators }
 */
export function buildCourse(spec) {
  const kind = spec.kind ?? 'expedition';
  const mutators = (spec.mutators ?? []).filter((m) => MUTATORS[m]);
  let segs;
  let biome = Math.max(0, Math.min(5, spec.biome | 0));
  let name;
  let cargo;
  let seed;
  let budget = TUMBLE_BUDGET;
  if (kind === 'expedition') {
    const index = Math.max(0, Math.min(3, spec.index | 0));
    const e = EXPEDITIONS[biome * 4 + index];
    segs = e.segs;
    name = e.name;
    cargo = CARGO_BY_INDEX(biome, index);
    seed = spec.seed ?? `${expeditionId(biome, index)}`;
  } else if (kind === 'endless') {
    seed = spec.seed ?? 'endless';
    const rng = makeRng(`${seed}-plan`);
    segs = [];
    for (let i = 0; i < 22; i++) {
      const b = i < 2 ? 0 : rng.int(6);
      const pool = BIOMES[b].pool.filter((t) => t !== 'stride');
      segs.push([rng.pick(pool), Math.min(3, 1 + Math.floor(i / 6))]);
    }
    segs.push(['stride', 3]);
    name = 'Endless Stride';
    cargo = 'boulder';
    biome = 0;
    budget = ENDLESS_BUDGET;
  } else {
    // daily: a mix of one biome's pool, five segments, tiers 1-3
    seed = spec.seed ?? 'daily';
    const rng = makeRng(`${seed}-plan`);
    const pool = BIOMES[biome].pool.filter((t) => t !== 'stride');
    segs = [];
    for (let i = 0; i < 5; i++) segs.push([rng.pick(pool), 1 + Math.min(2, Math.floor(rng.next() * 3))]);
    name = 'Daily Stride';
    cargo = rng.pick(['egg', 'soup', 'lanterns', 'passengers', 'boulder']);
  }

  // Lay the segments out: start, checkpoints every ~55 m, goal.
  const plan = [['flat', 1]];
  let sinceCheck = 10;
  for (let i = 0; i < segs.length; i++) {
    const len = lengthOf(segs[i][0]);
    if (sinceCheck + len > CHECKPOINT_EVERY && i < segs.length) {
      plan.push(['check', 1]);
      sinceCheck = 8;
    }
    plan.push(segs[i]);
    sinceCheck += len;
  }
  plan.push(['goal', 1]);
  const total = plan.reduce((a, [t]) => a + lengthOf(t), 0) + 2;

  const rng = makeRng(`${seed}-build`);
  const ctx = {
    seed: hashString(String(seed)),
    t: createTerrain(total),
    elev: 0,
    path: new Float32Array(Math.ceil(total) + 1),
    checkpoints: [],
    platforms: [],
    vents: [],
    geysers: [],
    rocks: [],
    bars: [],
    gates: [],
    boulders: [],
    winds: [],
    conveyors: [],
    stones: 0,
    water: null,
    goalX: total - 6,
  };
  let x = 0;
  const segments = [];
  for (const [tpl, tier] of plan) {
    const len = TEMPLATES[tpl](ctx, x, tier, rng.fork(`${tpl}${x}`));
    segments.push({ tpl, tier, x0: x, x1: x + len, biome: biomeOf(tpl, biome) });
    x += len;
  }
  const course = {
    kind,
    name,
    seed: String(seed),
    biome,
    index: spec.index ?? 0,
    id: kind === 'expedition' ? expeditionId(biome, spec.index | 0) : kind,
    cargo,
    mutators,
    budget,
    length: total,
    terrain: ctx.t,
    path: ctx.path,
    segments,
    checkpoints: ctx.checkpoints,
    platforms: ctx.platforms,
    vents: ctx.vents,
    geysers: ctx.geysers,
    rocks: ctx.rocks,
    bars: ctx.bars,
    gates: ctx.gates,
    boulders: ctx.boulders,
    winds: ctx.winds,
    conveyors: ctx.conveyors,
    stoneCount: ctx.stones,
    water: ctx.water,
    startX: 4,
    goalX: ctx.goalX,
    respawns: [],
    dynIndex: [],
    par: parOf(kind, biome, spec.index | 0, total),
  };
  if (mutators.includes('gusty')) for (const w of course.winds) w.base *= 1.5;
  repairCourse(course);
  course.respawns = findRespawns(course);
  course.dynIndex = buildDynIndex(course);
  return course;
}

const LENGTHS = { flat: 10, check: 8, hills: 22, mud: 20, stones: 22, ridge: 24, ice: 22, wind: 20, iceridge: 20, grates: 20, vents: 20, platforms: 22, conveyor: 20, pistons: 20, crumble: 22, gap: 14, springs: 18, rockfall: 20, rails: 20, gears: 24, bars: 20, swingbars: 20, gates: 20, shore: 22, boulders: 24, stride: 30, goal: 12 };
export const lengthOf = (tpl) => LENGTHS[tpl] ?? 20;

function biomeOf(tpl, fallback) {
  for (let b = 0; b < BIOMES.length; b++) if (BIOMES[b].pool.includes(tpl)) return b;
  return fallback;
}

// Gold and silver times (seconds) by course: measured with the balance harness (pro bots x 1.25, average x 1.15).
const PAR = {
  'e1-1': [62, 85], 'e1-2': [92, 125], 'e1-3': [100, 135], 'e1-4': [108, 150],
  'e2-1': [84, 115], 'e2-2': [92, 125], 'e2-3': [108, 150], 'e2-4': [116, 160],
  'e3-1': [86, 118], 'e3-2': [90, 125], 'e3-3': [92, 128], 'e3-4': [112, 155],
  'e4-1': [80, 110], 'e4-2': [84, 115], 'e4-3': [100, 140], 'e4-4': [112, 155],
  'e5-1': [86, 118], 'e5-2': [86, 118], 'e5-3': [86, 118], 'e5-4': [112, 155],
  'e6-1': [92, 128], 'e6-2': [94, 130], 'e6-3': [94, 130], 'e6-4': [112, 155],
};
function parOf(kind, biome, index, total) {
  if (kind === 'expedition') return PAR[expeditionId(biome, index)] ?? [total / 1.8, total / 1.3];
  return [total / 1.8, total / 1.3];
}

const SAFE_STATIC = new Set([S.CLAY, S.GRATE, S.STONE, S.SHORE, S.ICE, S.MUD, S.CONVEYOR]);
const RESPAWN_OK = new Set([S.CLAY, S.GRATE, S.STONE, S.ICE]);

/** Static ground a foot can stand on (crossable features count: platforms move, slabs hold for a while). */
export function crossable(course, x, z) {
  const s = staticSurface(course.terrain, x, z);
  if (SAFE_STATIC.has(s) || s === S.CRUMBLE || s === S.SPRING) return true;
  if (s === S.LAVA || s === S.VOID) return platformCovers(course, x, z);
  return false;
}

function platformCovers(course, x, z) {
  for (const p of course.platforms) {
    if (p.rot !== 0) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.hl * p.hl) return true;
    } else if (x >= p.x - p.hl - Math.abs(p.ax) && x <= p.x + p.hl + Math.abs(p.ax) && z >= p.z - p.hw - Math.abs(p.az) && z <= p.z + p.hw + Math.abs(p.az)) return true;
  }
  return false;
}

/**
 * Walk the path from start to goal: from every point there must be crossable ground within
 * one stride ahead, else a stone is added. A generated course is never uncrossable.
 */
export const REPAIR_STRIDE = 4; // the chassis bridges a gap: rear feet on one edge, front targets 2.2 m past the front hips

export function repairCourse(course) {
  const repairs = [];
  let x = course.startX;
  for (;;) {
    const gap = firstGap(course, x);
    if (gap < 0) break;
    const pz = pathZ(course, gap);
    fillDisc(course.terrain, gap + 1.6, pz, 1.2, S.STONE, elevNear(course, gap, pz) + 0.1);
    repairs.push(Math.round(gap * 10) / 10);
    x = gap;
    if (repairs.length > 200) break;
  }
  course.repaired = repairs.length;
  course.repairs = repairs;
  return repairs.length;
}

/** Walk the path from `fromX`: the first x with no crossable ground within one stride ahead, or -1. */
export function firstGap(course, fromX) {
  let x = fromX;
  while (x < course.goalX) {
    const pz = pathZ(course, x);
    let found = -1;
    for (let d = 0.5; d <= REPAIR_STRIDE && found < 0; d += 0.5) {
      for (const dz of [0, -1.5, 1.5, -3, 3]) {
        if (crossable(course, x + d, pz + dz)) {
          found = d;
          break;
        }
      }
    }
    if (found < 0) return x;
    x += found;
  }
  return -1;
}

function elevNear(course, x, z) {
  for (let d = 0; d < 12; d += 0.5) {
    for (const sx of [x - d, x + d]) {
      const s = staticSurface(course.terrain, sx, z);
      if (SAFE_STATIC.has(s) || s === S.CRUMBLE) {
        const ix = toIx(sx);
        const iz = toIz(z);
        return course.terrain.h[ix * course.terrain.nz + iz];
      }
    }
  }
  return 0;
}

export function pathZ(course, x) {
  const p = course.path;
  const i = Math.max(0, Math.min(p.length - 1, Math.floor(x)));
  const j = Math.min(p.length - 1, i + 1);
  const a = x - i;
  return p[i] * (1 - a) + p[j] * a;
}

/** Spots where the whole walker can stand on plain safe ground: tumbles reset here. */
export function findRespawns(course) {
  const out = [];
  const t = course.terrain;
  for (let x = course.startX; x < course.goalX; x += 2) {
    const z = pathZ(course, x);
    let ok = true;
    for (let k = 0; k < HIPS.length && ok; k++) {
      for (const [fx, fz] of [[0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]]) {
        const px = x + HIPS[k][0] + fx;
        const pz = z + HIPS[k][1] + fz;
        const s = staticSurface(t, px, pz);
        const f = staticFeature(t, px, pz);
        if (!RESPAWN_OK.has(s) || f >= 1000 || Math.abs(pz) > 11) {
          ok = false;
          break;
        }
      }
    }
    // never under a gate or inside a bar's sweep: a respawn there is a trap
    if (ok) for (const g of course.gates) if (Math.abs(x - g.x) < 5.5) ok = false;
    if (ok) for (const b of course.bars) if (Math.hypot(x - b.x, z - b.z) < b.len + 2.5) ok = false;
    if (ok) for (const r of course.rocks) if (Math.hypot(x - r.x, z - r.z) < r.r + 2.5) ok = false;
    if (ok) {
      const ix = toIx(x);
      const iz = toIz(z);
      out.push({ x, z, y: t.h[ix * t.nz + iz] });
    }
  }
  if (!out.length) out.push({ x: course.startX, z: 0, y: 0 });
  return out;
}

function buildDynIndex(course) {
  const n = Math.ceil(course.length / 10) + 1;
  const buckets = new Array(n).fill(null);
  const add = (o, x0, x1) => {
    for (let b = Math.max(0, Math.floor(x0 / 10)); b <= Math.min(n - 1, Math.floor(x1 / 10)); b++) (buckets[b] ??= []).push(o);
  };
  for (const p of course.platforms) add(p, p.x - p.hl - Math.abs(p.ax) - 1, p.x + p.hl + Math.abs(p.ax) + 1);
  for (const v of course.vents) add(v, v.x - 3, v.x + 3);
  for (const g of course.geysers) add(g, g.x - 3, g.x + 3);
  for (const r of course.rocks) add(r, r.x - 4, r.x + 4);
  for (const b of course.bars) add(b, b.x - b.len - 2, b.x + b.len + 2);
  for (const g of course.gates) add(g, g.x - 4, g.x + 4);
  for (const b of course.boulders) add(b, b.x0 - 2, b.x1 + 2);
  return buckets;
}

/** Pick the right checkpoint/respawn for a position (the last one passed). */
export function lastRespawn(course, x) {
  const r = course.respawns;
  let best = r[0];
  for (let i = 0; i < r.length; i++) {
    if (r[i].x <= x) best = r[i];
    else break;
  }
  return best;
}

export function checkpointIndex(course, x) {
  let n = 0;
  for (const c of course.checkpoints) if (x >= c.x) n++;
  return n;
}
