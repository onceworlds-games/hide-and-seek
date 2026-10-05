// Bots: hiders that run to a spot (or stay out in the open and keep away from flashlights) and seekers that walk the rooms,
// search spots and chase what they see. They walk with the same movement code as players and are run by the host.
// Pure: no window, no document. Everything random comes from ctx.rng, so a seeded match plays the same every time.
//
// ctx (made by host.js): { G, house, nav, rng, now (match ms), others (visible characters, for the soft push),
//   posOf(id), claims: {spot: id}, act: { hide(id, spot), search(id, spot), tag(id, target) } }
import { RULES, roleOf, coneFor, speedFor, isSeeking, has } from './rules.js';
import { distToRect, segmentClear, canSee } from './geometry.js';
import { walk } from './sim.js';
import { findPath, walkable, nearestFree } from './nav.js';
import { startPos, spotOf } from './engine.js';

// How good seeker bots are: never perfect. (Spots to check per room, the chance to follow up a wobble, the chance to open a
// spot walked past, and how long they look around when they walk into a room.)
// Found players (new seekers) are the novices: they look less carefully than the first seeker.
const SKILL = {
  seeker: { roomSpots: 0.25, hint: 0.35, pass: 0.45, lookAround: [0.4, 1.4], start: [0.8, 2.4] },
  found: { roomSpots: 0.12, hint: 0.2, pass: 0.3, lookAround: [0.8, 2.0], start: [0.8, 2.0] },
};

export function makeBot(i, id, house) {
  const bot = { i, id, x: house.spawn.x, y: house.spawn.y, vx: 0, vy: 0, a: 0, hid: -1, inSpot: -1, rid: '' };
  clearPlan(bot);
  return bot;
}

function clearPlan(bot) {
  bot.style = 'spot';
  bot.path = null;
  bot.pi = 0;
  bot.goal = null;
  bot.wait = 0;
  bot.think = 0;
  bot.react = 0;
  bot.stuckT = 0;
  bot.stuckN = 0;
  bot.lx = bot.x ?? 0;
  bot.ly = bot.y ?? 0;
  bot.searchT = 0;
  bot.cool = 0;
  bot.checked = {};
  bot.roll = {};
  bot.hint = {};
  bot.chase = null;
  bot.todo = [];
  bot.ri = -1;
  bot.threat = null;
  bot.fleeT = 0;
  bot.pathT = 0;
  bot.ix = 0;
  bot.iy = 0;
  bot.bad = {};
  bot.rushed = false;
  bot.started = false;
}

/** Puts the bot at its start for the round in G and gives it a plan. */
export function resetBot(bot, ctx) {
  const p = startPos(ctx.G, ctx.house, bot.id);
  bot.x = p.x;
  bot.y = p.y;
  bot.a = p.a;
  bot.vx = 0;
  bot.vy = 0;
  bot.rid = ctx.G.rid;
  bot.hid = -1;
  bot.inSpot = -1;
  clearPlan(bot);
  bot.style = ctx.rng() < 0.3 ? 'open' : 'spot';
  bot.wait = 0.3 + ctx.rng() * 0.9;
  bot.react = 0.3; // reaction time at the start of the seek
}

const rand = (ctx, a, b) => a + ctx.rng() * (b - a);

// ---------------------------------------------------------------- walking
function setGoal(bot, ctx, x, y, kind, extra) {
  bot.path = findPath(ctx.nav, bot.x, bot.y, x, y);
  bot.pi = 0;
  bot.goal = bot.path ? { x, y, kind, ...extra } : null;
  bot.stuckT = 0;
  bot.lx = bot.x;
  bot.ly = bot.y;
  return bot.path !== null;
}

/** Walks the bot's path. Returns 'moving', 'arrived' or 'none' (no path). Sets the wanted direction. */
function follow(bot, ctx, dt) {
  if (!bot.path) return 'none';
  let wp = bot.path[bot.pi];
  while (wp) {
    const last = bot.pi === bot.path.length - 1;
    if (Math.hypot(wp.x - bot.x, wp.y - bot.y) < (last ? 0.25 : 0.4)) {
      bot.pi++;
      wp = bot.path[bot.pi];
    } else break;
  }
  if (!wp) {
    bot.path = null;
    return 'arrived';
  }
  const d = Math.hypot(wp.x - bot.x, wp.y - bot.y) || 1;
  bot.ix = (wp.x - bot.x) / d;
  bot.iy = (wp.y - bot.y) / d;
  // Stuck on something? Look again for a way; as a last resort stand on the nearest free spot.
  bot.stuckT += dt;
  if (bot.stuckT >= 0.6) {
    const moved = Math.hypot(bot.x - bot.lx, bot.y - bot.ly);
    bot.stuckT = 0;
    bot.lx = bot.x;
    bot.ly = bot.y;
    if (moved < 0.3) {
      bot.stuckN++;
      if (bot.goal) bot.path = findPath(ctx.nav, bot.x, bot.y, bot.goal.x, bot.goal.y);
      bot.pi = 0;
      if (bot.stuckN >= 3) {
        const p = nearestFree(ctx.nav, bot.x, bot.y);
        bot.x = p.x;
        bot.y = p.y;
        bot.stuckN = 0;
        bot.unstuck = (bot.unstuck | 0) + 1;
      }
    } else bot.stuckN = 0;
  }
  return 'moving';
}

// ---------------------------------------------------------------- looking
const centreOfRect = (s) => [s.x, s.y, s.w, s.h];

function seekingChars(ctx, self) {
  const out = [];
  for (const r of ctx.G.roster) {
    if (r.id === self.id) continue;
    if (isSeeking(roleOf(ctx.G, r.id))) {
      const p = ctx.posOf(r.id);
      if (p) out.push(p);
    }
  }
  return out;
}

function nearestThreat(bot, ctx) {
  let best = null;
  let bd = 6;
  for (const p of seekingChars(ctx, bot)) {
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d < bd && segmentClear(bot.x, bot.y, p.x, p.y, ctx.house.walls)) {
      bd = d;
      best = { x: p.x, y: p.y, d };
    }
  }
  return best;
}

function visibleHider(bot, ctx, cone) {
  let best = null;
  let bd = Infinity;
  for (const r of ctx.G.roster) {
    if (roleOf(ctx.G, r.id) !== 'hider' || spotOf(ctx.G, r.id) >= 0) continue;
    const p = ctx.posOf(r.id);
    if (!p || !canSee(bot.x, bot.y, bot.a, cone, p.x, p.y, ctx.house.walls)) continue;
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d < bd) {
      bd = d;
      best = { id: r.id, d };
    }
  }
  return best;
}

// ---------------------------------------------------------------- hiders
function chooseSpot(bot, ctx, nearest) {
  const { G, house } = ctx;
  const options = [];
  let total = 0;
  for (const s of house.spots) {
    if (has(G.spots, s.i) || (has(ctx.claims, s.i) && ctx.claims[s.i] !== bot.id) || (bot.bad && bot.bad[s.i])) continue;
    const d = Math.hypot(s.ax - bot.x, s.ay - bot.y);
    const w = nearest ? 1 / (1 + d * d) : Math.pow(1 + d, 1.5); // farther rooms are likelier when there's time
    options.push([s, w]);
    total += w;
  }
  while (options.length) {
    let r = ctx.rng() * total;
    let k = 0;
    for (; k < options.length - 1; k++) {
      r -= options[k][1];
      if (r <= 0) break;
    }
    const [s, w] = options[k];
    if (setGoal(bot, ctx, s.ax, s.ay, 'spot', { spot: s.i })) {
      ctx.claims[s.i] = bot.id;
      return true;
    }
    (bot.bad ??= {})[s.i] = true;
    options.splice(k, 1);
    total -= w;
  }
  return false;
}

function releaseClaim(bot, ctx) {
  if (bot.goal && bot.goal.kind === 'spot' && ctx.claims[bot.goal.spot] === bot.id) delete ctx.claims[bot.goal.spot];
}

function goFarRoom(bot, ctx) {
  const rooms = ctx.house.rooms;
  const opts = rooms.map((r) => [r, Math.hypot(r.ax - bot.x, r.ay - bot.y) + rand(ctx, 0, 6)]);
  opts.sort((a, b) => b[1] - a[1]);
  const pick = opts[Math.floor(ctx.rng() * Math.min(3, opts.length))][0];
  const spread = 1.2;
  const p = nearestFree(ctx.nav, pick.ax + rand(ctx, -spread, spread), pick.ay + rand(ctx, -spread, spread));
  return setGoal(bot, ctx, p.x, p.y, 'point', {});
}

function hiderHide(bot, ctx, dt) {
  const left = (ctx.G.until - ctx.now) / 1000;
  if (bot.wait > 0) {
    bot.wait -= dt;
    return;
  }
  if (bot.style === 'spot') {
    if (!bot.goal || bot.goal.kind !== 'spot') {
      if (!chooseSpot(bot, ctx, left < 3)) bot.style = 'open';
    } else if (left < 2.5 && !bot.rushed) {
      // Out of time: the nearest free spot will do.
      bot.rushed = true;
      releaseClaim(bot, ctx);
      if (!chooseSpot(bot, ctx, true)) bot.style = 'open';
    }
    if (bot.style === 'spot') {
      const st = follow(bot, ctx, dt);
      if (st === 'arrived' || st === 'none') {
        const spot = bot.goal.spot;
        if (ctx.act.hide(bot.id, spot)) {
          bot.goal = null;
        } else {
          (bot.bad ??= {})[spot] = true;
          releaseClaim(bot, ctx);
          bot.goal = null;
        }
      }
      return;
    }
  }
  // Staying out in the open: wander to a far room and wait there.
  if (!bot.goal && !goFarRoom(bot, ctx)) return;
  if (follow(bot, ctx, dt) === 'arrived') bot.goal = { kind: 'idle', x: bot.x, y: bot.y };
}

/** Keep away from flashlights: head for somewhere far from the nearest seeker, away from it. */
function flee(bot, ctx) {
  const t = bot.threat;
  let best = null;
  let bs = -Infinity;
  const consider = (x, y) => {
    const dx = x - bot.x;
    const dy = y - bot.y;
    if (dx * (t.x - bot.x) + dy * (t.y - bot.y) > 0) return; // not toward the seeker
    const score = Math.hypot(x - t.x, y - t.y) - 0.7 * Math.hypot(dx, dy) + rand(ctx, 0, 2);
    if (score > bs) {
      bs = score;
      best = { x, y };
    }
  };
  for (const r of ctx.house.rooms) consider(r.ax, r.ay);
  for (const s of ctx.house.spots) consider(s.ax, s.ay);
  if (best) setGoal(bot, ctx, best.x, best.y, 'flee', {});
}

function hiderSeek(bot, ctx, dt) {
  if (bot.style === 'spot') bot.style = 'open'; // it never got into a spot: it stays out here
  bot.think -= dt;
  if (bot.think <= 0) {
    bot.think = rand(ctx, 0.2, 0.3);
    bot.threat = nearestThreat(bot, ctx);
  }
  bot.fleeT -= dt;
  if (bot.threat) {
    if (bot.fleeT <= 0 || !bot.path) {
      bot.fleeT = 0.6;
      flee(bot, ctx);
    }
  }
  if (bot.path) {
    if (follow(bot, ctx, dt) === 'arrived') bot.goal = null;
  } else if (!bot.threat && !bot.goal) {
    // Nothing near: wait here, or drift to another quiet corner now and then.
    if (ctx.rng() < dt * 0.15) goFarRoom(bot, ctx);
  }
}

// ---------------------------------------------------------------- seekers
function startSearch(bot, ctx, spot) {
  const r = ctx.act.search(bot.id, spot);
  bot.checked[spot] = ctx.now;
  if (r) {
    bot.searchT = RULES.openMs / 1000;
    bot.cool = RULES.coolMs / 1000;
  }
  return r;
}

function planNextRoom(bot, ctx, skill) {
  const rooms = ctx.house.rooms;
  const dir = bot.i % 2 === 0 ? 1 : -1;
  bot.ri = bot.ri < 0 ? (bot.i * 3 + 1) % rooms.length : (bot.ri + dir + rooms.length) % rooms.length;
  const room = rooms[bot.ri];
  bot.todo = ctx.house.spots
    .filter((s) => s.room === room.id)
    .map((s) => s.i)
    .filter(() => ctx.rng() < skill.roomSpots)
    .sort(() => ctx.rng() - 0.5);
  setGoal(bot, ctx, room.ax, room.ay, 'room', { room: room.id });
}

function seekerSeek(bot, ctx, dt, role) {
  const cone = coneFor(role);
  const skill = SKILL[role];
  const now = ctx.now / 1000;
  bot.cool -= dt;
  if (bot.react > 0) {
    bot.react -= dt;
    return;
  }
  if (!bot.started) {
    // "Ready or not": a moment to look around before setting off.
    bot.started = true;
    bot.searchT = rand(ctx, skill.start[0], skill.start[1]);
    return;
  }
  if (bot.searchT > 0) {
    bot.searchT -= dt;
    return; // standing there opening the spot
  }
  bot.think -= dt;
  if (bot.think <= 0) {
    bot.think = 0.1;
    const see = visibleHider(bot, ctx, cone);
    if (see) {
      if (!bot.chase || bot.chase.id !== see.id) bot.chase = { id: see.id, since: now, last: now };
      bot.chase.last = now;
    } else if (bot.chase && now - bot.chase.last > 1.2) bot.chase = null;
    // Spots that wobble (a hider inside, a seeker close) are worth a look.
    if (!bot.chase) {
      for (const k of Object.keys(ctx.G.spots)) {
        const s = ctx.house.spots[Number(k)];
        if (!s || distToRect(bot.x, bot.y, centreOfRect(s)) > RULES.hint) continue;
        if (has(bot.hint, s.i) && now - bot.hint[s.i] < 8) continue;
        bot.hint[s.i] = now;
        if (ctx.rng() < skill.hint && (!bot.goal || bot.goal.kind !== 'spot' || bot.goal.spot !== s.i)) {
          setGoal(bot, ctx, s.ax, s.ay, 'spot', { spot: s.i });
        }
      }
    }
    // Passing a spot: a 60% chance to open it, once in a while.
    if (!bot.chase && bot.cool <= 0) {
      for (const s of ctx.house.spots) {
        if (distToRect(bot.x, bot.y, centreOfRect(s)) > RULES.reach - 0.2) continue;
        if (has(bot.checked, s.i) && ctx.now - bot.checked[s.i] < 25000) continue;
        if (has(bot.roll, s.i) && ctx.now - bot.roll[s.i] < 25000) continue;
        bot.roll[s.i] = ctx.now;
        if (ctx.rng() < skill.pass && startSearch(bot, ctx, s.i)) return;
      }
    }
  }
  if (bot.chase) {
    if (now - bot.chase.since < 0.3) return; // reaction time
    const id = bot.chase.id;
    const p = ctx.posOf(id);
    if (!p || roleOf(ctx.G, id) !== 'hider' || spotOf(ctx.G, id) >= 0) {
      bot.chase = null;
      return;
    }
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d <= RULES.tagTouch - 0.1) {
      ctx.act.tag(bot.id, id);
      bot.chase = null;
      return;
    }
    if (walkable(ctx.nav, bot.x, bot.y, p.x, p.y)) {
      bot.path = null;
      bot.ix = (p.x - bot.x) / d;
      bot.iy = (p.y - bot.y) / d;
    } else {
      bot.pathT -= dt;
      if (bot.pathT <= 0 || !bot.path) {
        bot.pathT = 0.4;
        setGoal(bot, ctx, p.x, p.y, 'chase', {});
      }
      follow(bot, ctx, dt);
    }
    return;
  }
  // Patrol: rooms in a loop, a few spots in each.
  if (!bot.goal) {
    if (bot.todo.length) {
      const i = bot.todo.pop();
      const s = ctx.house.spots[i];
      const recent = has(bot.checked, i) && ctx.now - bot.checked[i] < 25000;
      if (!recent) setGoal(bot, ctx, s.ax, s.ay, 'spot', { spot: i });
    } else planNextRoom(bot, ctx, skill);
    if (!bot.goal) return;
  }
  const st = follow(bot, ctx, dt);
  if (st === 'moving') return;
  const g = bot.goal;
  bot.goal = null;
  bot.path = null;
  if (g.kind === 'spot' && bot.cool <= 0) startSearch(bot, ctx, g.spot);
  else if (g.kind === 'room') bot.searchT = rand(ctx, skill.lookAround[0], skill.lookAround[1]); // a look around
}

// ---------------------------------------------------------------- one step
/** Runs one fixed step of a bot (dt in seconds). */
export function stepBot(bot, ctx, dt) {
  const G = ctx.G;
  if (bot.rid !== G.rid) resetBot(bot, ctx);
  const role = roleOf(G, bot.id);
  bot.ix = 0;
  bot.iy = 0;
  // Into a spot: sit at its middle. Out of one (found, or told out): step out at its front.
  if (bot.hid >= 0 && bot.inSpot < 0) {
    const s = ctx.house.spots[bot.hid];
    if (s) {
      bot.x = s.cx;
      bot.y = s.cy;
    }
    bot.path = null;
    bot.goal = null;
  } else if (bot.hid < 0 && bot.inSpot >= 0) {
    const s = ctx.house.spots[bot.inSpot];
    if (s) {
      bot.x = s.ax;
      bot.y = s.ay;
    }
    bot.path = null;
    bot.goal = null;
    bot.react = 0.3;
  }
  bot.inSpot = bot.hid;
  if (bot.hid >= 0) {
    bot.vx = 0;
    bot.vy = 0;
    return;
  }
  if (G.phase === 'hide') {
    if (role === 'hider') hiderHide(bot, ctx, dt);
  } else if (G.phase === 'seek') {
    if (role === 'hider') hiderSeek(bot, ctx, dt);
    else seekerSeek(bot, ctx, dt, role);
  }
  if (G.phase === 'hide' && role !== 'hider') {
    // Seekers count with their eyes covered: they stand perfectly still (nobody pushes them either).
    bot.vx = 0;
    bot.vy = 0;
    return;
  }
  // Seeker bots are a touch slower than the people they chase (a hider who runs can get away).
  const speed = speedFor(role) * (role === 'hider' ? 1 : 0.92);
  walk(bot, bot.ix, bot.iy, dt, speed, ctx.house, ctx.others, bot.i);
}

// ---------------------------------------------------------------- the title screen's wandering crowd
/** A bot that just walks between rooms and spots (the title screen and the lobby's life). ctx: { house, nav, rng, others }. */
export function stepWander(bot, ctx, dt) {
  bot.ix = 0;
  bot.iy = 0;
  if (bot.wait > 0) {
    bot.wait -= dt;
  } else {
    if (!bot.path) {
      const pool = ctx.rng() < 0.5 ? ctx.house.rooms : ctx.house.spots;
      const t = pool[Math.floor(ctx.rng() * pool.length)];
      if (!setGoal(bot, ctx, t.ax, t.ay, 'point', {})) bot.wait = 0.5;
    }
    if (follow(bot, ctx, dt) === 'arrived') bot.wait = 0.6 + ctx.rng() * 1.8;
  }
  walk(bot, bot.ix, bot.iy, dt, bot.speed ?? 3.6, ctx.house, ctx.others, bot.i);
}

/** Exposed for the tests: set a walking goal and follow its path. */
export const walking = { setGoal, follow };
