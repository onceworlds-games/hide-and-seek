// The save schema (versioned, parsed defensively) and the workshop's catalogue.
import * as C from './constants.js';
import { expeditionCount } from './courses.js';
import { betterMedal } from './score.js';

export const SAVE_VERSION = 1;

export const PAINTS = [
  { id: 'orange', name: 'Workshop Orange', cost: 0, color: '#f0702a' },
  { id: 'teal', name: 'Tide Teal', cost: 60, color: '#1f8a8a' },
  { id: 'brass', name: 'Brass', cost: 80, color: '#d9a441' },
  { id: 'cream', name: 'Paper Cream', cost: 80, color: '#fff3dc' },
  { id: 'terracotta', name: 'Terracotta', cost: 100, color: '#c8643c' },
  { id: 'ink', name: 'Ink', cost: 140, color: '#2a1e1a' },
];
export const STICKERS = [
  { id: 'none', name: 'Plain', cost: 0 },
  { id: 'stripes', name: 'Racing Stripes', cost: 50 },
  { id: 'number', name: 'Big Number', cost: 50 },
  { id: 'rivets', name: 'Extra Rivets', cost: 70 },
  { id: 'flames', name: 'Paper Flames', cost: 90 },
];
export const HATS = [
  { id: 'none', name: 'No Hat', cost: 0 },
  { id: 'bowler', name: 'Bowler', cost: 60 },
  { id: 'cone', name: 'Party Cone', cost: 60 },
  { id: 'crown', name: 'Tin Crown', cost: 120 },
  { id: 'umbrella', name: 'Umbrella', cost: 90 },
];
export const HORNS = [
  { id: 'honk', name: 'Honk', cost: 0 },
  { id: 'toot', name: 'Toot', cost: 40 },
  { id: 'whistle', name: 'Steam Whistle', cost: 70 },
  { id: 'bell', name: 'Bicycle Bell', cost: 70 },
];

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    scrap: 0,
    earned: 0,
    feet: 'std',
    feetOwned: ['std'],
    hips: 0,
    chassis: 'std',
    chassisOwned: ['std'],
    cradle: 0,
    mechanic: 0,
    paint: 'orange',
    sticker: 'none',
    hat: 'none',
    horn: 'honk',
    cosmetics: ['orange', 'none', 'honk'],
    leg: -1,
    medals: {},
    best: {},
    endlessBest: 0,
    grooveBest: 0,
    dailyDone: 0,
    hints: {},
    stats: { runs: 0, finishes: 0, tumbles: 0, golds: 0, spills: 0, steps: 0, playSeconds: 0, fourHumans: 0, solos: 0, dailies: 0 },
    badges: [],
    ghosts: {},
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v, allowed, d) => (typeof v === 'string' && allowed.includes(v) ? v : d);
const list = (v, allowed, must) => {
  const out = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && allowed.includes(x)) : [];
  for (const m of must) if (!out.includes(m)) out.push(m);
  return [...new Set(out)];
};

/** Parse anything into a valid save: missing, empty, corrupt, older or newer versions all load. */
export function loadSave(raw) {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const s = raw;
  const feetIds = Object.keys(C.FEET);
  const chassisIds = Object.keys(C.CHASSIS);
  const cosmeticIds = [...PAINTS, ...STICKERS, ...HATS, ...HORNS].map((c) => c.id);
  d.scrap = Math.round(num(s.scrap, 0, 1e7));
  d.earned = Math.round(num(s.earned, 0, 1e8));
  d.feetOwned = list(s.feetOwned, feetIds, ['std']);
  d.feet = str(s.feet, d.feetOwned, 'std');
  d.hips = Math.round(num(s.hips, 0, C.HIPS_LEVELS.length - 1));
  d.chassisOwned = list(s.chassisOwned, chassisIds, ['std']);
  d.chassis = str(s.chassis, d.chassisOwned, 'std');
  d.cradle = Math.round(num(s.cradle, 0, C.CRADLE_LEVELS.length - 1));
  d.mechanic = Math.round(num(s.mechanic, 0, C.MECHANIC_LEVELS.length - 1));
  d.cosmetics = list(s.cosmetics, cosmeticIds, ['orange', 'none', 'honk']);
  d.paint = str(s.paint, d.cosmetics, 'orange');
  d.sticker = str(s.sticker, d.cosmetics, 'none');
  d.hat = str(s.hat, d.cosmetics, 'none');
  d.horn = str(s.horn, d.cosmetics, 'honk');
  d.leg = Math.round(num(s.leg, -1, 3, -1));
  if (isObj(s.medals)) for (const [k, v] of Object.entries(s.medals)) if (/^e[1-6]-[1-4]$/.test(k)) d.medals[k] = str(v, ['bronze', 'silver', 'gold'], 'bronze');
  if (isObj(s.best)) for (const [k, v] of Object.entries(s.best)) if (/^e[1-6]-[1-4]$/.test(k)) d.best[k] = num(v, 1, 3600, 3600);
  d.endlessBest = Math.round(num(s.endlessBest, 0, 1e6));
  d.grooveBest = num(s.grooveBest, 0, 36000);
  d.dailyDone = Math.round(num(s.dailyDone, 0, 1e6));
  if (isObj(s.hints)) for (const [k, v] of Object.entries(s.hints)) if (/^[a-z-]{1,24}$/.test(k)) d.hints[k] = Math.round(num(v, 0, 99));
  if (isObj(s.stats)) for (const k of Object.keys(d.stats)) d.stats[k] = Math.round(num(s.stats[k], 0, 1e9));
  d.badges = list(s.badges, BADGE_IDS, []);
  if (isObj(s.ghosts)) {
    for (const [k, v] of Object.entries(s.ghosts)) {
      if (!/^e[1-6]-[1-4]$/.test(k) || !isObj(v) || !Array.isArray(v.f) || v.f.length > 4000) continue;
      const frames = v.f.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, 4000);
      if (frames.length >= 4) d.ghosts[k] = { t: num(v.t, 1, 3600, 3600), f: frames.map((x) => Math.round(x)) };
    }
  }
  return d;
}

export const BADGE_IDS = ['first-step', 'in-step', 'four-legs-good', 'nothing-spilled', 'mud-lover', 'ice-skater', 'hot-foot', 'tumble-king', 'solo-stride', 'great-stride', 'gold-rush'];

/** Record a finished or failed run into the save; returns the list of newly earned badge ids. */
export function applyResult(save, course, result, ctx) {
  const earned = [];
  const give = (id) => {
    if (!save.badges.includes(id)) {
      save.badges.push(id);
      earned.push(id);
    }
  };
  save.scrap += result.scrap;
  save.earned += result.scrap;
  save.stats.runs++;
  save.stats.tumbles += result.tumbles;
  save.stats.spills += result.spills;
  save.stats.steps += result.steps;
  save.stats.playSeconds += Math.round(result.time);
  if (result.grooveBest > save.grooveBest) save.grooveBest = result.grooveBest;
  if (result.grooveBest >= 30) give('in-step');
  if (result.tumbles >= 10) give('tumble-king');
  if (course.kind === 'endless') {
    if (result.distance > save.endlessBest) save.endlessBest = result.distance;
  }
  if (course.kind === 'daily' && result.finished) {
    save.dailyDone++;
    save.stats.dailies++;
  }
  if (!result.finished) return earned;
  save.stats.finishes++;
  if (course.kind === 'expedition') {
    const id = course.id;
    save.medals[id] = betterMedal(save.medals[id] ?? 'none', result.medal);
    if (save.medals[id] === 'none') delete save.medals[id];
    if (!save.best[id] || result.time < save.best[id]) save.best[id] = result.time;
    if (result.medal === 'gold') save.stats.golds = Object.values(save.medals).filter((m) => m === 'gold').length;
    if (id === 'e1-1') give('first-step');
    if (id === 'e6-4') give('great-stride');
    if (course.biome === 1 && result.tumbles === 0) give('ice-skater');
    if (course.biome === 0 && result.tumbles === 0 && ctx.mudPlants >= 12) give('mud-lover');
    if (course.biome === 2 && ctx.burns === 0) give('hot-foot');
    if (save.stats.golds >= 10) give('gold-rush');
  }
  if (result.cond >= 0.999 && result.spills === 0) give('nothing-spilled');
  if (ctx.humans === 1) {
    save.stats.solos++;
    give('solo-stride');
  }
  if (ctx.humans >= 4) {
    save.stats.fourHumans++;
    give('four-legs-good');
  }
  return earned;
}

/** How many expeditions are open: finishing one opens the next; a biome opens when the previous has two finishes. */
export function unlockedCount(save) {
  let n = 1;
  for (let i = 0; i < expeditionCount; i++) {
    const id = `e${Math.floor(i / 4) + 1}-${(i % 4) + 1}`;
    if (save.medals[id]) n = Math.max(n, i + 2);
  }
  return Math.min(expeditionCount, n);
}

/** The walker configuration from the host's workshop, each leg's feet, and the course's mutators. */
export function walkerConfig(save, feetPerLeg, mutators, inertMask) {
  const hips = C.HIPS_LEVELS[save.hips] ?? C.HIPS_LEVELS[0];
  const chassis = C.CHASSIS[save.chassis] ?? C.CHASSIS.std;
  const cradle = C.CRADLE_LEVELS[save.cradle] ?? C.CRADLE_LEVELS[0];
  const mut = new Set(mutators ?? []);
  const tiny = mut.has('tiny') ? -0.6 : 0;
  return {
    reach: C.L_MAX + hips.reach + tiny,
    stickRange: C.NEUTRAL_R + hips.reach + tiny,
    gain: chassis.gain,
    tipMult: chassis.tip,
    cargoDamp: cradle.damp * chassis.damp,
    gripMult: mut.has('slippery') ? 0.5 : 1,
    windMult: mut.has('gusty') ? 1.8 : 1,
    feet: [0, 1, 2, 3].map((i) => (C.FEET[feetPerLeg?.[i]] ? feetPerLeg[i] : save.feet)),
    missing: mut.has('three') ? 3 : -1,
    inert: mut.has('nobots') ? inertMask ?? [false, false, false, false] : [false, false, false, false],
    giant: mut.has('giant'),
    swap: mut.has('swap'),
    mechanic: save.mechanic,
  };
}

export function canAfford(save, cost) {
  return save.scrap >= cost;
}
