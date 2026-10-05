// What the host's page runs: the match record G, the bots, and the checks on what players ask for. Pure (no window, no
// document), so the tests play whole matches with it. The page feeds it the humans' positions (from presence) and the
// clock (room.matchNow()), writes G to the room when G.rev changes, and publishes snapshot() about 12 times a second.
import { mulberry32, has } from './rules.js';
import * as engine from './engine.js';
import { makeBot, stepBot } from './bots.js';
import { navFor } from './nav.js';
import { getHouse } from './maps.js';

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

export class HostGame {
  /** G: the match record (engine.createMatch, or one read back from the room by a new host). salt: varies the bots' dice. */
  constructor(G, salt = 0) {
    this.G = G;
    this.house = getHouse(G.map);
    this.nav = navFor(this.house);
    this.rng = mulberry32(((G.seed >>> 0) ^ 0x5bd1e995) + Math.imul(salt | 0, 7919) + Math.imul(G.n | 0, 104729));
    this.now = 0;
    this.bots = new Map(); // roster id -> bot
    this.humans = new Map(); // roster id -> { x, y, vx, vy, a } from presence
    this.others = []; // visible characters, for the soft push
    this.claims = {};
    this.lastSearch = {};
    this.rid = G.rid;
    this.ectx = { house: this.house, pos: (id) => this.posOf(id), lastSearch: this.lastSearch };
    this.act = {
      hide: (id, spot) => engine.hide(this.G, id, spot, this.ectx),
      search: (id, spot) => engine.search(this.G, id, spot, this.now, this.ectx),
      tag: (id, target) => engine.tag(this.G, id, target, this.now, this.ectx),
    };
    this.occ = {}; // player id -> spot they hide in (rebuilt each step)
    this.syncBots();
  }

  syncBots() {
    this.G.roster.forEach((r, i) => {
      if (r.b && !this.bots.has(r.id)) this.bots.set(r.id, makeBot(i, r.id, this.house));
    });
  }

  /** A human's latest position, from presence. */
  setHuman(id, x, y, a, vx = 0, vy = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let p = this.humans.get(id);
    if (!p) this.humans.set(id, (p = { x, y, vx: 0, vy: 0, a: 0 }));
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.a = Number.isFinite(a) ? a : p.a;
  }

  posOf(id) {
    const b = this.bots.get(id);
    return b ?? this.humans.get(id) ?? null;
  }

  /** A human who left for good becomes a bot where they stood (they keep their points and their name). */
  convertToBot(id) {
    const i = this.G.roster.findIndex((r) => r.id === id);
    if (i < 0 || this.G.roster[i].b) return false;
    this.G.roster[i].b = 1;
    engine.touch(this.G);
    this.syncBots();
    const bot = this.bots.get(id);
    const p = this.humans.get(id);
    if (bot && p) {
      bot.x = p.x;
      bot.y = p.y;
      bot.a = p.a;
      bot.rid = this.G.rid; // carries on from here, no restart
      const s = engine.spotOf(this.G, id);
      bot.hid = s;
      bot.inSpot = s;
    }
    this.humans.delete(id);
    return true;
  }

  // ------------------------------------------------------------ what humans ask for (the page validated the shapes)
  isHuman(id, rid) {
    if (rid !== this.G.rid) return false;
    const r = this.G.roster.find((x) => x.id === id);
    return Boolean(r) && !r.b;
  }
  onHide(id, rid, spot) {
    return this.isHuman(id, rid) && engine.hide(this.G, id, spot, this.ectx);
  }
  onUnhide(id, rid) {
    return this.isHuman(id, rid) && engine.unhide(this.G, id) >= 0;
  }
  onSearch(id, rid, spot) {
    return this.isHuman(id, rid) && engine.search(this.G, id, spot, this.now, this.ectx);
  }
  onTag(id, rid, target) {
    return this.isHuman(id, rid) && engine.tag(this.G, id, target, this.now, this.ectx);
  }

  // ------------------------------------------------------------ the clock
  /** Moves the match on if a clock ran out (call about every 100 ms). Returns true when G changed. */
  advance(now) {
    this.now = now;
    const changed = engine.tick(this.G, now);
    if (this.G.rid !== this.rid) {
      this.rid = this.G.rid;
      this.claims = {};
      this.lastSearch = {};
      this.ectx.lastSearch = this.lastSearch;
    }
    return changed;
  }

  /** One fixed step of every bot (dt in seconds). */
  step(dt, now) {
    this.now = now;
    const G = this.G;
    if (G.phase === 'idle') return;
    this.occ = {};
    for (const k of Object.keys(G.spots)) this.occ[G.spots[k]] = Number(k);
    const others = this.others;
    others.length = 0;
    for (const r of G.roster) {
      const p = this.posOf(r.id);
      if (p && !has(this.occ, r.id)) others.push(p);
    }
    for (const bot of this.bots.values()) {
      bot.hid = has(this.occ, bot.id) ? this.occ[bot.id] : -1;
      stepBot(bot, this, dt);
    }
  }

  // ------------------------------------------------------------ what the room hears
  /** The bots' positions as one compact state value ({ rid, t, p: [[roster index, x, y, vx, vy, a], ...] }). */
  snapshot(now) {
    const p = [];
    this.G.roster.forEach((r, i) => {
      const b = this.bots.get(r.id);
      if (b) p.push([i, r2(b.x), r2(b.y), r1(b.vx), r1(b.vy), r2(b.a)]);
    });
    return { rid: this.G.rid, t: Math.round(now), p };
  }

  /** A new host picks the bots up where the last snapshot left them (same round only). */
  restore(snap) {
    if (!snap || snap.rid !== this.G.rid || !Array.isArray(snap.p)) return;
    for (const row of snap.p) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const r = this.G.roster[row[0]];
      const bot = r ? this.bots.get(r.id) : null;
      if (!bot) continue;
      const [, x, y, vx, vy, a] = row;
      if (![x, y, vx, vy, a].every(Number.isFinite)) continue;
      bot.x = x;
      bot.y = y;
      bot.vx = vx;
      bot.vy = vy;
      bot.a = a;
      bot.rid = this.G.rid;
      const s = engine.spotOf(this.G, bot.id);
      bot.hid = s;
      bot.inSpot = s;
    }
  }
}

