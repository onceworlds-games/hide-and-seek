// Hide and Seek: the numbers and the small pure rules (roster, who seeks, scoring, places). No window, no document.

export const SETTINGS = [
  { id: 'rounds', label: 'Rounds', options: [3, 5, { value: 'all', label: 'Everyone' }], default: 3 },
  {
    id: 'map',
    label: 'House',
    options: [
      { value: 'cozy', label: 'Cozy House' },
      { value: 'mansion', label: 'Big Mansion' },
    ],
    default: 'cozy',
  },
];

export const RULES = {
  maxPlayers: 10,
  table: 6, // bots fill the match up to this many characters
  hideMs: { cozy: 20000, mansion: 25000 },
  seekMs: { cozy: 75000, mansion: 95000 },
  revealMs: 4000,
  scoreMs: 4000,
  finalMs: 9000,
  bannerMs: 1500,
  speed: { hider: 5, seeker: 5.4, found: 5 },
  radius: 0.35,
  reach: 1.2, // how close to a hiding spot (to its edge) you have to be to hide in it or search it
  hideTol: 2.0, // the host's slack on that (presence lags a little behind the player's own page)
  searchTol: 1.7,
  tagTouch: 0.85, // a seeker touches a hider at this distance (centres)
  tagTol: 2.0,
  hint: 2, // a seeker this close to an occupied spot makes it wobble
  openMs: 500,
  coolMs: 1000,
  surviveEvery: 15000,
  surviveGain: 2,
  wholeBonus: 5,
  findGain: 3,
};

const DEG = Math.PI / 180;
/** Flashlights: the first seeker's is big, a found player's is smaller. `near` is the little circle around the holder. */
export const CONES = {
  seeker: { ang: 70 * DEG, range: 7, near: 1.5 },
  found: { ang: 60 * DEG, range: 5, near: 1.2 },
};

export const COLORS = ['#ff5d8f', '#3d8bff', '#38c96b', '#a45cff', '#14c7c0', '#b4de1f', '#e03bd0', '#7fd3ff', '#a8693a', '#8a94a8'];
export const SEEKER_COLOR = '#ff8a1f';
export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export { has };

// ---------------------------------------------------------------- randomness
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A match seed from whatever the room gives (a number or a string). */
export function seedOf(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return Math.floor(Math.abs(x)) >>> 0;
  return hashString(String(x ?? '0'));
}

export function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

// ---------------------------------------------------------------- roster and roles
export function cleanName(name) {
  let s = '';
  for (const ch of String(name ?? '')) {
    const c = ch.codePointAt(0);
    if (c < 32 || (c >= 127 && c <= 159) || c === 0x2028 || c === 0x2029) continue; // no control or line-separator characters
    s += ch;
  }
  s = s.trim().slice(0, 16);
  return s || 'Player';
}

/** Everyone in the match: the humans (in the order given), then bots up to the table size. */
export function buildRoster(humans, seed) {
  const rng = mulberry32(seedOf(seed) ^ 0x9e3779b9);
  const names = shuffle(BOT_NAMES.slice(), rng);
  const list = humans.slice(0, RULES.maxPlayers).map((h, i) => ({ id: String(h.id), n: cleanName(h.name), b: 0, c: i % COLORS.length }));
  const bots = Math.max(0, RULES.table - list.length);
  for (let k = 0; k < bots; k++) list.push({ id: `bot${k + 1}`, n: names[k % names.length], b: 1, c: (list.length) % COLORS.length });
  return list;
}

/** One seeker at a table of up to 5, two from 6. At least one hider always remains. */
export function seekerCount(n) {
  return Math.max(1, Math.min(n >= 6 ? 2 : 1, n - 1));
}

export function roundsFor(setting, n) {
  if (setting === 'all') return Math.max(1, n);
  return setting === 5 ? 5 : 3;
}

/** Round r (0-based): the seekers go through the roster in turn, so nobody seeks twice before everyone has. */
export function seekersForRound(order, k, r) {
  const n = order.length;
  const out = [];
  for (let j = 0; j < k && out.length < n - 1; j++) {
    const id = order[(r * k + j) % n];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 'seeker' (started as one), 'found' (a hider who was found: seeks now) or 'hider'. */
export function roleOf(G, id) {
  if (!G) return 'none';
  if (G.seek.includes(id)) return 'seeker';
  if (has(G.found, id)) return 'found';
  return 'hider';
}
export const isSeeking = (role) => role === 'seeker' || role === 'found';

export function coneFor(role) {
  return role === 'seeker' ? CONES.seeker : role === 'found' ? CONES.found : null;
}

export function speedFor(role) {
  return role === 'seeker' ? RULES.speed.seeker : role === 'found' ? RULES.speed.found : RULES.speed.hider;
}

export function hideMsFor(map) {
  return RULES.hideMs[map] ?? RULES.hideMs.cozy;
}
export function seekMsFor(map) {
  return RULES.seekMs[map] ?? RULES.seekMs.cozy;
}

// ---------------------------------------------------------------- scoring
/** +2 for every full 15 s a hider stayed unfound (ms of the seek phase). */
export function surviveGain(ms) {
  return RULES.surviveGain * Math.floor(Math.max(0, ms) / RULES.surviveEvery);
}

/** Places with ties sharing one (1, 1, 3). Sorted by score, then by roster order. */
export function rankScores(roster, scores) {
  const rows = roster.map((r, i) => ({ id: r.id, score: has(scores, r.id) ? scores[r.id] : 0, i }));
  rows.sort((a, b) => b.score - a.score || a.i - b.i);
  let place = 0;
  let prev = null;
  rows.forEach((row, k) => {
    if (row.score !== prev) {
      place = k + 1;
      prev = row.score;
    }
    row.place = place;
  });
  return rows;
}

/** Fun awards from the match's numbers: Ghost (longest unfound), Bloodhound (most finds). Only when someone earned one. */
export function pickAwards(roster, stats) {
  const best = (map) => {
    let id = null;
    let v = 0;
    for (const r of roster) {
      const x = has(map, r.id) ? map[r.id] : 0;
      if (x > v) {
        v = x;
        id = r.id;
      }
    }
    return id === null ? null : { id, v };
  };
  const out = [];
  const g = best(stats.unf);
  if (g) out.push({ k: 'ghost', id: g.id, v: Math.round(g.v / 1000) });
  const h = best(stats.finds);
  if (h) out.push({ k: 'hound', id: h.id, v: h.v });
  return out;
}

export const placeWord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
