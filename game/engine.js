// The rules of a match as plain functions over one JSON record (`G`, what the host writes to the room as state `g`).
// Phases: hide -> seek -> reveal -> score -> (next round) ... -> final. All times are match milliseconds (room.matchNow()).
// Pure: the host's page, a new host after a hand-over and the tests all run this same code.
import {
  RULES,
  has,
  roleOf,
  isSeeking,
  hideMsFor,
  seekMsFor,
  roundsFor,
  seekerCount,
  seekersForRound,
  surviveGain,
  rankScores,
  pickAwards,
} from './rules.js';
import { distToRect } from './geometry.js';

const bump = (G) => {
  G.rev = (G.rev | 0) + 1;
};
/** Marks G as changed (the host writes it to the room when `rev` moves). */
export const touch = bump;

function emit(G, ev) {
  G.seq += 1;
  ev.i = G.seq;
  G.ev.push(ev);
  if (G.ev.length > 12) G.ev.shift();
  bump(G);
}

/** A fresh match record. `roster` is [{ id, n, b, c }] (see rules.buildRoster); `settings` is room.settings. */
export function createMatch({ mid, by, roster, settings, seed }) {
  const map = settings?.map === 'mansion' ? 'mansion' : 'cozy';
  const G = {
    v: 1,
    rev: 0,
    mid,
    by,
    map,
    roster,
    total: roundsFor(settings?.rounds, roster.length),
    n: 0,
    rid: '',
    phase: 'idle',
    t0: 0,
    until: 0,
    seekAt: 0,
    hideMs: hideMsFor(map),
    seekMs: seekMsFor(map),
    seek: [],
    found: {},
    fd: {},
    spots: {},
    ev: [],
    seq: 0,
    scores: {},
    gain: {},
    stats: { finds: {}, unf: {} },
    survived: [],
    allFound: false,
    res: null,
    done: false,
    seed: seed >>> 0,
  };
  for (const r of roster) {
    G.scores[r.id] = 0;
    G.stats.finds[r.id] = 0;
    G.stats.unf[r.id] = 0;
  }
  return G;
}

/** Everyone who is hiding (not a seeker, not found) right now. */
export function hidersLeft(G) {
  return G.roster.filter((r) => roleOf(G, r.id) === 'hider').map((r) => r.id);
}

/** Which spot a player is hidden in (-1 for none). */
export function spotOf(G, id) {
  for (const k of Object.keys(G.spots)) if (G.spots[k] === id) return Number(k);
  return -1;
}

/** Where a character starts a round: seekers in the middle of the living room, hiders in a ring around them. */
export function startPos(G, house, id) {
  const role = roleOf(G, id);
  if (role === 'seeker') {
    const slot = Math.max(0, G.seek.indexOf(id)) % house.seekerStarts.length;
    const s = house.seekerStarts[slot];
    return { x: s.x, y: s.y, a: s.a };
  }
  const hiders = G.roster.filter((r) => !G.seek.includes(r.id));
  const slot = Math.max(0, hiders.findIndex((r) => r.id === id)) % house.hiderStarts.length;
  const s = house.hiderStarts[slot];
  return { x: s.x, y: s.y, a: Math.atan2(house.spawn.y - s.y, house.spawn.x - s.x) + Math.PI };
}

/** Begins round G.n + 1 at match time `base`. */
export function startRound(G, base) {
  G.n += 1;
  G.rid = `${G.mid}.${G.n}`;
  const order = G.roster.map((r) => r.id);
  G.seek = seekersForRound(order, seekerCount(order.length), G.n - 1);
  G.found = {};
  G.fd = {};
  G.spots = {};
  G.gain = {};
  G.survived = [];
  G.allFound = false;
  G.phase = 'hide';
  G.t0 = base;
  G.until = base + G.hideMs;
  G.seekAt = 0;
  bump(G);
}

/** Scores the round that ended at match time `end`. */
function endRound(G, end) {
  const gain = {};
  for (const r of G.roster) gain[r.id] = 0;
  const survived = [];
  for (const r of G.roster) {
    if (G.seek.includes(r.id)) continue;
    if (has(G.found, r.id)) {
      gain[r.id] += surviveGain(G.found[r.id]);
      G.stats.unf[r.id] += G.found[r.id];
    } else {
      gain[r.id] += surviveGain(G.seekMs) + RULES.wholeBonus;
      G.stats.unf[r.id] += G.seekMs;
      survived.push(r.id);
    }
  }
  for (const w of Object.keys(G.fd)) {
    const f = G.fd[w];
    if (has(gain, f)) gain[f] += RULES.findGain;
  }
  for (const r of G.roster) G.scores[r.id] += gain[r.id];
  G.gain = gain;
  G.survived = survived;
  G.allFound = survived.length === 0;
  G.phase = 'reveal';
  G.t0 = end;
  G.until = end + RULES.revealMs;
  bump(G);
}

function finalize(G, base) {
  const rows = rankScores(G.roster, G.scores);
  G.res = {
    order: rows.map((r) => ({ id: r.id, score: r.score, place: r.place })),
    awards: pickAwards(G.roster, G.stats),
  };
  G.phase = 'final';
  G.t0 = base;
  G.until = base + RULES.finalMs;
  bump(G);
}

/**
 * Moves the match on when a clock runs out (or the last hider is found). Returns true when something changed. Call it every
 * 100 ms or so with room.matchNow(): a late call catches up one phase at a time.
 */
export function tick(G, now) {
  switch (G.phase) {
    case 'idle':
      startRound(G, now);
      return true;
    case 'hide':
      if (now < G.until) return false;
      G.phase = 'seek';
      G.seekAt = G.until;
      G.t0 = G.until;
      G.until = G.until + G.seekMs;
      bump(G);
      return true;
    case 'seek': {
      const left = hidersLeft(G).length;
      if (left > 0 && now < G.until) return false;
      endRound(G, left > 0 ? G.until : Math.min(now, G.until));
      return true;
    }
    case 'reveal':
      if (now < G.until) return false;
      G.phase = 'score';
      G.t0 = G.until;
      G.until = G.until + RULES.scoreMs;
      bump(G);
      return true;
    case 'score':
      if (now < G.until) return false;
      if (G.n >= G.total) finalize(G, G.until);
      else startRound(G, G.until);
      return true;
    case 'final':
      if (G.done || now < G.until) return false;
      G.done = true;
      bump(G);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- what players do (the host checks every one)
// ctx: { house, pos(id) -> {x, y} | null, lastSearch: {} (host memory of each seeker's last search time) }

const spotRect = (house, i) => {
  const s = house.spots[i];
  return s ? [s.x, s.y, s.w, s.h] : null;
};

/** A hider hides in a spot. Refused when it's taken, too far, or the player isn't a hider right now. */
export function hide(G, id, spot, ctx) {
  if (G.phase !== 'hide' && G.phase !== 'seek') return false;
  if (!Number.isInteger(spot) || roleOf(G, id) !== 'hider') return false;
  const rect = spotRect(ctx.house, spot);
  if (!rect) return false;
  if (has(G.spots, spot)) return G.spots[spot] === id;
  const p = ctx.pos(id);
  if (!p || distToRect(p.x, p.y, rect) > RULES.hideTol) return false;
  const old = spotOf(G, id);
  if (old >= 0) delete G.spots[old];
  G.spots[spot] = id;
  emit(G, { k: 'hide', s: spot, w: id });
  return true;
}

/** A hider comes out of their spot. Returns the spot they left (-1 when they weren't in one). */
export function unhide(G, id) {
  const s = spotOf(G, id);
  if (s < 0) return -1;
  delete G.spots[s];
  emit(G, { k: 'out', s, w: id });
  return s;
}

function markFound(G, hider, finder, now, spot, how) {
  G.found[hider] = Math.max(0, Math.round(now - G.seekAt));
  G.fd[hider] = finder;
  if (spot >= 0) delete G.spots[spot];
  G.stats.finds[finder] = (G.stats.finds[finder] ?? 0) + 1;
  emit(G, { k: 'found', s: spot, w: hider, f: finder, h: how });
}

/** A seeker opens a spot. 'found' (a hider was inside), 'nope' (empty), or false (refused). */
export function search(G, id, spot, now, ctx) {
  if (G.phase !== 'seek' || !Number.isInteger(spot) || !isSeeking(roleOf(G, id))) return false;
  const rect = spotRect(ctx.house, spot);
  if (!rect) return false;
  const last = has(ctx.lastSearch, id) ? ctx.lastSearch[id] : -1e9;
  if (now - last < RULES.coolMs - 200) return false;
  const p = ctx.pos(id);
  if (!p || distToRect(p.x, p.y, rect) > RULES.searchTol) return false;
  ctx.lastSearch[id] = now;
  const occupant = has(G.spots, spot) ? G.spots[spot] : undefined;
  if (occupant !== undefined && roleOf(G, occupant) === 'hider') {
    markFound(G, occupant, id, now, spot, 'search');
    return 'found';
  }
  emit(G, { k: 'nope', s: spot, f: id });
  return 'nope';
}

/** A seeker touches a hider who is out in the open. */
export function tag(G, id, target, now, ctx) {
  if (G.phase !== 'seek' || id === target || !isSeeking(roleOf(G, id))) return false;
  if (!G.roster.some((r) => r.id === target) || roleOf(G, target) !== 'hider' || spotOf(G, target) >= 0) return false;
  const a = ctx.pos(id);
  const b = ctx.pos(target);
  if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > RULES.tagTol) return false;
  markFound(G, target, id, now, -1, 'tag');
  return true;
}
