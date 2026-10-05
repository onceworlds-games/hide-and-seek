// The room: joining (or a local stand-in when the page is opened on its own), the match record `g` the host writes and every
// page reads, the bots' snapshots, and the host's ticker. Follows templates/party: one record per match keyed by match.id, the
// host's page acts only while `room.isHost && room.running && g.by === me`, and `adopt()` carries on after any hand-over.
import { HostGame } from './host.js';
import * as engine from './engine.js';
import { buildRoster, seedOf, SETTINGS, RULES, cleanName, COLORS } from './rules.js';

const MAX_ID = 64;
const PHASES = ['idle', 'hide', 'seek', 'reveal', 'score', 'final'];
const EVENTS = ['hide', 'out', 'found', 'nope'];

const num = (x, lo, hi, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const isId = (x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;

/** Another player can write any state, so what comes out of the room is checked and copied before use. Null if it isn't a match record. */
export function parseG(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
  if (!isId(raw.by) || typeof raw.mid !== 'string' || raw.mid.length === 0 || raw.mid.length > 80 || typeof raw.rid !== 'string' || raw.rid.length > 100) return null;
  if (!PHASES.includes(raw.phase) || !Array.isArray(raw.roster) || raw.roster.length < 2 || raw.roster.length > 12) return null;
  const roster = [];
  for (const r of raw.roster) {
    if (!r || !isId(r.id) || roster.some((x) => x.id === r.id)) return null;
    roster.push({ id: r.id, n: cleanName(r.n), b: r.b ? 1 : 0, c: Math.floor(num(r.c, 0, 99)) % COLORS.length });
  }
  const ids = new Set(roster.map((r) => r.id));
  const idsOnly = (list, max = 12) => (Array.isArray(list) ? list.filter((x) => ids.has(x)).slice(0, max) : []);
  const map = raw.map === 'mansion' ? 'mansion' : 'cozy';
  const G = {
    v: 1,
    rev: num(raw.rev, 0, 1e9),
    mid: raw.mid,
    by: raw.by,
    map,
    roster,
    total: Math.floor(num(raw.total, 1, 20, 3)),
    n: Math.floor(num(raw.n, 0, 40)),
    rid: raw.rid,
    phase: raw.phase,
    t0: num(raw.t0, 0, 1e10),
    until: num(raw.until, 0, 1e10),
    seekAt: num(raw.seekAt, 0, 1e10),
    hideMs: num(raw.hideMs, 1000, 120000, 20000),
    seekMs: num(raw.seekMs, 1000, 600000, 75000),
    seek: idsOnly(raw.seek),
    found: {},
    fd: {},
    spots: {},
    ev: [],
    seq: Math.floor(num(raw.seq, 0, 1e9)),
    scores: {},
    gain: {},
    stats: { finds: {}, unf: {} },
    survived: idsOnly(raw.survived),
    allFound: Boolean(raw.allFound),
    res: null,
    done: Boolean(raw.done),
    seed: num(raw.seed, 0, 4294967295) >>> 0,
  };
  const copyNums = (from, into, hi) => {
    if (!from || typeof from !== 'object') return;
    for (const id of ids) if (Object.prototype.hasOwnProperty.call(from, id) && typeof from[id] === 'number' && Number.isFinite(from[id])) into[id] = num(from[id], 0, hi);
  };
  copyNums(raw.found, G.found, 1e8);
  copyNums(raw.scores, G.scores, 99999);
  copyNums(raw.gain, G.gain, 99999);
  if (raw.stats && typeof raw.stats === 'object') {
    copyNums(raw.stats.finds, G.stats.finds, 9999);
    copyNums(raw.stats.unf, G.stats.unf, 1e9);
  }
  for (const id of ids) if (!Object.prototype.hasOwnProperty.call(G.scores, id)) G.scores[id] = 0;
  if (raw.fd && typeof raw.fd === 'object') for (const id of ids) if (Object.prototype.hasOwnProperty.call(raw.fd, id) && ids.has(raw.fd[id])) G.fd[id] = raw.fd[id];
  if (raw.spots && typeof raw.spots === 'object') {
    for (const k of Object.keys(raw.spots)) {
      const s = Number(k);
      if (Number.isInteger(s) && s >= 0 && s < 64 && ids.has(raw.spots[k])) G.spots[s] = raw.spots[k];
    }
  }
  if (Array.isArray(raw.ev)) {
    for (const e of raw.ev.slice(-12)) {
      if (!e || !EVENTS.includes(e.k) || !Number.isInteger(e.i)) continue;
      G.ev.push({
        i: e.i,
        k: e.k,
        s: Number.isInteger(e.s) && e.s >= -1 && e.s < 64 ? e.s : -1,
        w: ids.has(e.w) ? e.w : undefined,
        f: ids.has(e.f) ? e.f : undefined,
        h: e.h === 'tag' ? 'tag' : 'search',
      });
    }
  }
  if (raw.res && typeof raw.res === 'object' && Array.isArray(raw.res.order)) {
    const order = [];
    for (const o of raw.res.order.slice(0, 12)) if (o && ids.has(o.id)) order.push({ id: o.id, score: num(o.score, 0, 99999), place: Math.floor(num(o.place, 1, 12, 1)) });
    const awards = [];
    if (Array.isArray(raw.res.awards)) for (const a of raw.res.awards.slice(0, 4)) if (a && (a.k === 'ghost' || a.k === 'hound') && ids.has(a.id)) awards.push({ k: a.k, id: a.id, v: num(a.v, 0, 99999) });
    G.res = { order, awards };
  }
  return G;
}

/** The bots' snapshot: { rid, t, p: [[roster index, x, y, vx, vy, a], ...] }. Null if it doesn't look like one. */
export function parseB(raw, size = 12) {
  if (!raw || typeof raw !== 'object' || typeof raw.rid !== 'string' || raw.rid.length > 100 || !Array.isArray(raw.p) || !Number.isFinite(raw.t)) return null;
  const rows = [];
  for (const r of raw.p.slice(0, 12)) {
    if (!Array.isArray(r) || r.length < 6 || !r.slice(0, 6).every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    if (!Number.isInteger(r[0]) || r[0] < 0 || r[0] >= size) continue;
    rows.push({ i: r[0], x: num(r[1], -5, 60), y: num(r[2], -5, 40), vx: num(r[3], -20, 20), vy: num(r[4], -20, 20), a: num(r[5], -10, 10) });
  }
  return { rid: raw.rid, t: raw.t, rows };
}

// ---------------------------------------------------------------- stand-ins for opening the file on its own
/** The pieces of window.onceworlds the game uses, for a page that isn't on the platform. */
export function standaloneOw() {
  const noop = () => {};
  return {
    mode: 'standalone',
    now: () => performance.now(),
    ready: async () => {},
    on: noop,
    player: { get: async () => ({ id: 'me', name: 'You', guest: true }), avatarUrl: async () => null, rename: async () => null },
    save: { get: async () => null, set: async () => {}, delete: async () => {}, list: async () => [] },
    badges: { award: async () => false },
    leaderboards: { submit: async () => null },
    controls: { set: noop, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    ui: { setOrientation: noop, showInvite: noop },
    settings: { quality: 'high', reducedMotion: false, scale: 1, pixelRatio: (m = 2) => Math.min(window.devicePixelRatio || 1, m), on: noop },
    rooms: { join: async () => createStubRoom() },
  };
}

/**
 * A room for one player with the same calls the game uses, so the game runs (solo, as host) when opened on its own: ready starts a
 * 3 second countdown, then the match plays until the game ends it.
 */
export function createStubRoom(opts = {}) {
  const clock = opts.now ?? (() => performance.now());
  const later = opts.later ?? ((fn, ms) => setTimeout(fn, ms));
  const listeners = new Map();
  const emit = (name, ...args) => {
    for (const fn of listeners.get(name) ?? []) {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const me = { id: 'me', name: 'You', presence: null, ready: false, connected: true, team: 0 };
  let playingSince = 0;
  let started = 0;
  const room = {
    me,
    players: new Map([['me', me]]),
    host: 'me',
    isHost: true,
    connected: true,
    kind: 'solo',
    state: {},
    settings: { rounds: 3, map: 'cozy' },
    match: { phase: 'lobby', n: 0, min: 1, id: '', seed: 1, participants: [], startsAt: 0, startedAt: 0 },
    spectating: false,
    get running() {
      return room.match.phase === 'playing';
    },
    get participants() {
      return room.match.phase === 'lobby' ? [] : room.match.participants.map((id) => room.players.get(id)).filter(Boolean);
    },
    get online() {
      return [me];
    },
    allReady: true,
    canStart: true,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    matchNow: () => (room.match.phase === 'playing' ? clock() - playingSince : 0),
    isParticipant: (id = me.id) => room.match.phase !== 'lobby' && room.match.participants.includes(id),
    setPresence: (p) => {
      me.presence = p;
    },
    presenceAt: () => me.presence,
    setState: (k, v) => {
      if (v === null) delete room.state[k];
      else room.state[k] = v;
    },
    send: () => {},
    hideLobby: () => {},
    setSetting(id, value) {
      if (room.match.phase !== 'lobby') return;
      room.settings = { ...room.settings, [id]: value };
      me.ready = false;
      emit('settings', room.settings);
    },
    setReady(ready = true) {
      me.ready = Boolean(ready);
      if (me.ready && room.match.phase === 'lobby') {
        const n = ++started;
        room.match = { ...room.match, phase: 'starting', startsAt: clock() + 3000, id: `solo${n}`, seed: (n * 7919) & 0xffff, participants: ['me'] };
        emit('starting', room.match);
        later(() => {
          if (room.match.phase !== 'starting') return;
          playingSince = clock();
          me.ready = false;
          room.match = { ...room.match, phase: 'playing', startedAt: playingSince };
          emit('matchstart', room.match);
        }, 3000);
      }
    },
    startMatch: () => room.setReady(true),
    endMatch() {
      const previous = room.match;
      room.match = { ...room.match, phase: 'lobby', participants: [] };
      emit('matchend', room.match, previous);
    },
    leave: () => {},
    _emit: emit, // for tests that play two pages against each other
  };
  return room;
}

// ---------------------------------------------------------------- the match, as the room sees it
export class Net {
  /** opts.now: a clock in ms for pacing the writes (tests pass a fake one). */
  constructor(room, opts = {}) {
    this.room = room;
    this.clock = opts.now ?? (() => performance.now());
    this.host = null; // a HostGame while this page runs the match
    this.hosting = false;
    this.salt = 0;
    this.lastRev = -1;
    this.lastWrite = 0;
    this.lastB = 0;
    this.endedFor = '';
    this._raw = null;
    this._rev = -1;
    this._g = null;
    this.snaps = []; // the bots' last snapshots from the room, for drawing them smoothly
    this._braw = null;
    room.on('message', (d, from, at) => this.onMessage(d, from, at));
    room.on('state', (key, value) => {
      if (key === 'b') this.takeSnapshot(value);
    });
    room.on('matchstart', () => this.adopt());
    room.on('host', () => this.adopt());
    room.on('reconnect', () => this.adopt());
    room.on('disconnect', () => {
      this.hosting = false;
    });
    room.on('matchend', () => this.reset());
  }

  reset() {
    this.host = null;
    this.hosting = false;
    this.snaps.length = 0;
    this._braw = null;
    this.lastRev = -1;
  }

  /** The page of the host that runs this match right now. */
  get authority() {
    const room = this.room;
    return Boolean(this.hosting && this.host && room.isHost && room.running && this.host.G.by === room.me.id && this.host.G.mid === room.match.id);
  }

  /** The match record for the match that's playing (null in a lobby, before the host has written it, or for an old match). */
  get g() {
    const room = this.room;
    const m = room.match;
    if (m.phase !== 'playing') return null;
    if (this.host && this.hosting && this.host.G.mid === m.id) return this.host.G;
    const raw = room.state.g;
    if (raw !== this._raw || (raw && raw.rev !== this._rev)) {
      this._raw = raw;
      this._rev = raw && typeof raw === 'object' ? raw.rev : -1;
      this._g = parseG(raw);
    }
    return this._g && this._g.mid === m.id ? this._g : null;
  }

  // ------------------------------------------------------------ the host's side
  /** Takes the match over (from nothing, or from the room's copy) when this page is the host. Safe to call again and again. */
  adopt() {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    const m = room.match;
    const rebuild = !this.hosting || !this.host || this.host.G.mid !== m.id;
    if (rebuild) {
      const raw = parseG(room.state.g);
      if (raw && raw.mid === m.id) {
        raw.by = room.me.id;
        engine.touch(raw);
        this.host = new HostGame(raw, ++this.salt);
        this.host.restore(parseB(room.state.b, raw.roster.length));
      } else {
        const humans = m.participants.map((id) => ({ id, name: room.players.get(id)?.name }));
        const roster = buildRoster(humans, m.seed);
        const G = engine.createMatch({ mid: m.id, by: room.me.id, roster, settings: room.settings, seed: seedOf(m.seed) });
        this.host = new HostGame(G, ++this.salt);
      }
      this.hosting = true;
      this.lastRev = -1;
    } else if (this.host.G.by !== room.me.id) {
      this.host.G.by = room.me.id;
      engine.touch(this.host.G);
    }
    this.flush(true);
  }

  /** Every 100 ms: only the host acts. */
  tick() {
    const room = this.room;
    if (!room.isHost) {
      this.hosting = false;
      return;
    }
    if (!room.running) return;
    if (!this.hosting || !this.host || this.host.G.mid !== room.match.id) {
      this.adopt();
      if (!this.hosting) return;
    }
    const host = this.host;
    const G = host.G;
    if (G.by !== room.me.id) {
      G.by = room.me.id;
      engine.touch(G);
    }
    for (const r of G.roster) {
      if (r.b || r.id === room.me.id) continue;
      const p = room.players.get(r.id);
      if (!p) {
        host.convertToBot(r.id); // they left for good: a bot carries on where they stood
        continue;
      }
      const pr = p.presence;
      if (pr && typeof pr === 'object') host.setHuman(r.id, Number(pr.x), Number(pr.y), Number(pr.a), Number(pr.vx) || 0, Number(pr.vy) || 0);
    }
    host.advance(room.matchNow());
    if (G.done && this.endedFor !== G.mid) {
      this.endedFor = G.mid;
      room.endMatch(); // results are in the room state; everyone is back in the lobby with them still on screen
    }
    this.flush();
  }

  /** Writes the record when it changed (at most about 10 times a second). */
  flush(force = false) {
    const host = this.host;
    if (!host || !this.hosting) return;
    const G = host.G;
    const now = this.clock();
    if (G.rev !== this.lastRev && (force || now - this.lastWrite >= 90)) {
      this.lastRev = G.rev;
      this.lastWrite = now;
      this.room.setState('g', JSON.parse(JSON.stringify(G)));
    }
  }

  /** The host's own character, every frame (it isn't in anyone's presence but its own). */
  setMe(x, y, a, vx, vy) {
    if (this.host && this.hosting) this.host.setHuman(this.room.me.id, x, y, a, vx, vy);
  }

  /** The bots, one fixed step; their snapshot goes out about 12 times a second. */
  stepBots(dt) {
    if (!this.authority) return;
    const now = this.room.matchNow();
    this.host.step(dt, now);
    const t = this.clock();
    if (t - this.lastB >= 80 && this.host.bots.size > 0 && this.host.G.phase !== 'idle') {
      this.lastB = t;
      this.room.setState('b', this.host.snapshot(now));
    }
  }

  // ------------------------------------------------------------ what players ask for
  onMessage(d, from, at) {
    void at;
    if (!this.authority || !d || typeof d !== 'object' || typeof d.rid !== 'string' || !from || typeof from.id !== 'string') return;
    const host = this.host;
    if (d.t === 'hide' && Number.isInteger(d.spot)) host.onHide(from.id, d.rid, d.spot);
    else if (d.t === 'unhide') host.onUnhide(from.id, d.rid);
    else if (d.t === 'search' && Number.isInteger(d.spot)) host.onSearch(from.id, d.rid, d.spot);
    else if (d.t === 'tag' && isId(d.id)) host.onTag(from.id, d.rid, d.id);
    else return;
    this.flush();
  }

  /** Me hiding, coming out, searching or tagging: the host page decides directly, everyone else asks the host. */
  ask(msg) {
    const g = this.g;
    if (!g) return;
    msg.rid = g.rid;
    if (this.authority) {
      const host = this.host;
      const me = this.room.me.id;
      if (msg.t === 'hide') host.onHide(me, g.rid, msg.spot);
      else if (msg.t === 'unhide') host.onUnhide(me, g.rid);
      else if (msg.t === 'search') host.onSearch(me, g.rid, msg.spot);
      else if (msg.t === 'tag') host.onTag(me, g.rid, msg.id);
      this.flush();
    } else if (this.room.host) {
      this.room.send(msg, { to: this.room.host });
    }
  }

  // ------------------------------------------------------------ bots, as seen by a page
  takeSnapshot(value) {
    if (this.authority) return;
    const g = this.g;
    const b = parseB(value, g ? g.roster.length : 12);
    if (!b) return;
    this.snaps.push(b);
    if (this.snaps.length > 5) this.snaps.shift();
  }

  /**
   * Fills `out[i]` ({x, y, vx, vy, a}) for the bots of round `rid` at match time `t` ms: between the two snapshots around t - 130 ms.
   * Returns false when there's nothing for this round yet.
   */
  botsAt(rid, t, out) {
    const room = this.room;
    if (this.snaps.length === 0 && room.state.b !== this._braw) {
      this._braw = room.state.b;
      const first = parseB(room.state.b);
      if (first) this.snaps.push(first);
    }
    const list = this.snaps.filter((s) => s.rid === rid);
    if (list.length === 0) return false;
    const target = t - 130;
    let a = list[0];
    let b = list[list.length - 1];
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].t <= target && list[i + 1].t >= target) {
        a = list[i];
        b = list[i + 1];
        break;
      }
    }
    const k = a === b || b.t <= a.t ? 1 : Math.min(1, Math.max(0, (target - a.t) / (b.t - a.t)));
    const byI = new Map(a.rows.map((r) => [r.i, r]));
    for (const rb of b.rows) {
      const ra = byI.get(rb.i) ?? rb;
      const da = ((((rb.a - ra.a) % 6.2832) + 9.4248) % 6.2832) - 3.1416;
      const o = out[rb.i] ?? (out[rb.i] = {});
      const jump = Math.hypot(rb.x - ra.x, rb.y - ra.y) > 3; // a teleport (out of a spot, a new round): no sliding across
      o.x = jump ? rb.x : ra.x + (rb.x - ra.x) * k;
      o.y = jump ? rb.y : ra.y + (rb.y - ra.y) * k;
      o.vx = rb.vx;
      o.vy = rb.vy;
      o.a = ra.a + da * k;
    }
    return true;
  }
}

export { SETTINGS, RULES };
