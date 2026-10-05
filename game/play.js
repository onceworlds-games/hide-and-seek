// Everything a page does while the lobby or a match is on screen: my own character (simulated here, published as presence),
// reading the match record `g`, turning events into juice, and drawing the world and the screens for each phase.
import { RULES, SETTINGS, COLORS, roleOf, isSeeking, coneFor, speedFor, rankScores, placeWord, has, cleanName } from './rules.js';
import { getHouse, nearestSpot, clampToHouse } from './maps.js';
import { walk } from './sim.js';
import { canSee, visibility, distToRect } from './geometry.js';
import { startPos, spotOf } from './engine.js';
import { ease, clamp01 } from './fx.js';
import { makeView, clampCamera, renderScene, renderLabels, hashOf, screenTransform, worldTransform } from './draw.js';
import * as ui from './ui.js';

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const FRONTS = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
const newSpotState = () => ({ occ: null, open: 0, wob: 0, hot: false, mine: false, label: '', fill: '' });

export class Play {
  /** deps: { ow, room, net, audio, fx, input, avatars } */
  constructor(deps) {
    Object.assign(this, deps);
    this.settingDefs = SETTINGS;
    this.t = 0; // seconds of drawing, for animation
    this.house = getHouse(this.room.settings.map);
    this.me = { x: this.house.spawn.x, y: this.house.spawn.y, vx: 0, vy: 0, a: 0, hid: -1, hidAt: 0, armed: true, confirmed: false, sq: 0, coolUntil: 0, step: 0 };
    this.R = this.freshRound(null, this.house);
    this.cam = { x: this.me.x, y: this.me.y };
    this.chars = new Map();
    this.list = [];
    this.sep = [];
    this.spotStates = this.house.spots.map(newSpotState);
    this.poly = [];
    this.beamPolys = new Map();
    this.botBuf = [];
    this.in = { x: 0, y: 0 };
    this.cx = { mode: 'lobby', g: null, role: 'lobby', spectating: false, house: this.house, matchNow: 0, counting: false, starting: false };
    this.banner = null;
    this.countN = -1;
    this.countAt = 0;
    this.goUntil = 0;
    this.final = null; // the last results, kept on screen a few seconds after the match
    this.lastRecord = null;
    this.finishedFor = '';
    this.stats = { matches: 0, wins: 0, finds: 0, survived: 0 };
    this.ctrlKey = 'x';
    this.watchId = null;
    this.emote = new Map();
    this.popAt = new Map();
    this.heartAt = 0;
    this.screen = 'title';
    this.btn = new ui.Buttons();
    this.room.on('starting', () => {
      this.countN = -1;
    });
    this.room.on('matchstart', () => {
      this.goUntil = this.t + 0.8;
    });
    this.room.on('matchend', (m, prev) => {
      if (prev && prev.phase === 'playing' && this.final && this.final.mid === prev.id) this.final.endedAt = this.t;
    });
    this.room.on('settings', () => this.audio.pop());
    this.input.onAction((code) => code === 'Space' && this.act());
    this.input.onTap((x, y) => this.tap(x, y));
    // Saved stats: a few numbers, written once after each match.
    this.statsReady = Promise.resolve(this.ow.save.get('stats'))
      .then((s) => {
        if (s && typeof s === 'object') for (const k of Object.keys(this.stats)) if (Number.isFinite(s[k])) this.stats[k] = s[k];
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------ what's going on
  /** Fills this.cx: the mode (lobby, wait, hide, seek, reveal, score, final), the record, my role and the house. */
  context() {
    const room = this.room;
    const m = room.match;
    const g = this.net.g;
    const c = this.cx;
    c.g = g;
    c.spectating = Boolean(room.spectating) || (m.phase === 'playing' && !room.isParticipant(room.me.id));
    c.mode = m.phase !== 'playing' ? 'lobby' : g && g.phase !== 'idle' ? g.phase : 'wait';
    c.house = getHouse(g ? g.map : room.settings.map);
    c.role = g && !c.spectating ? roleOf(g, room.me.id) : c.spectating ? 'spectator' : 'lobby';
    c.matchNow = room.matchNow();
    c.counting = c.mode === 'hide' && isSeeking(c.role);
    return c;
  }

  freshRound(g, house) {
    return {
      rid: g ? g.rid : `lobby:${house.id}`,
      seen: g ? g.seq : 0,
      phase: '',
      usedSpot: false,
      tagAt: {},
      anim: {},
      unhideAt: -1e9,
      startedAt: this.t,
      mark: 0,
      lastTick: -1,
      rewarded: false,
    };
  }

  /** A new round (or the lobby again, or another house): forget what a page remembered about the last, put my character at its start. */
  syncRound(c) {
    const g = c.g;
    const rid = g ? g.rid : `lobby:${c.house.id}`;
    if (rid === this.R.rid) return;
    const me = this.me;
    this.house = c.house;
    if (this.spotStates.length !== c.house.spots.length) this.spotStates = c.house.spots.map(newSpotState);
    this.R = this.freshRound(g, c.house);
    this.fx.clear();
    this.emote.clear();
    this.popAt.clear();
    this.sep.length = 0;
    me.hid = -1;
    me.coolUntil = 0;
    me.confirmed = false;
    me.vx = 0;
    me.vy = 0;
    const pres = this.room.me.presence;
    if (g && !c.spectating) {
      const fresh = c.matchNow - g.t0 < 4000 && g.phase === 'hide';
      if (fresh || !pres || !Number.isFinite(pres.x) || !Number.isFinite(pres.y)) {
        const p = startPos(g, c.house, this.room.me.id);
        me.x = p.x;
        me.y = p.y;
        me.a = p.a;
      } else {
        // a reload in the middle of a round: carry on from where the room last saw me
        me.x = pres.x;
        me.y = pres.y;
        me.a = Number.isFinite(pres.a) ? pres.a : 0;
        clampToHouse(c.house, me);
      }
    } else if (!g) {
      // the lobby: somewhere in the living room, not on top of the others
      const h = hashOf(this.room.me.id);
      const a = (h % 628) / 100;
      const r = 1.2 + ((h >> 8) % 30) / 10;
      const p = clampToHouse(c.house, { x: c.house.spawn.x + Math.cos(a) * r, y: c.house.spawn.y + Math.sin(a) * r * 0.7 });
      me.x = p.x;
      me.y = p.y;
    }
    this.cam.x = me.x;
    this.cam.y = me.y;
    this.banner = null;
  }

  // ------------------------------------------------------------ actions (Space, or the touch button)
  act() {
    if (this.screen !== 'play') return;
    const c = this.cx;
    const me = this.me;
    if (c.spectating) return;
    if (me.hid >= 0) {
      this.unhide(c);
      return;
    }
    const house = c.house;
    if (c.mode === 'lobby') {
      const s = nearestSpot(house, me.x, me.y, RULES.reach);
      if (s) this.enter(s, c);
      else this.nothingNear();
      return;
    }
    const g = c.g;
    if (!g || (g.phase !== 'hide' && g.phase !== 'seek')) return;
    if (c.role === 'hider') {
      const s = nearestSpot(house, me.x, me.y, RULES.reach, (i) => !has(g.spots, i));
      if (s) this.enter(s, c);
      else this.nothingNear();
    } else if (g.phase === 'seek') {
      this.search(c);
    }
  }

  /** The button was pressed with no spot within reach: a soft thud and two words, at most every couple of seconds. */
  nothingNear() {
    this.audio.bump();
    if (this.t - (this.hintAt ?? -9) > 2) {
      this.hintAt = this.t;
      this.fx.text(this.me.x, this.me.y - 0.9, 'Get closer!', '#fff6c9', 22, 1);
    }
  }

  enter(s, c) {
    const me = this.me;
    me.hid = s.i;
    me.x = s.cx;
    me.y = s.cy;
    me.vx = 0;
    me.vy = 0;
    me.hidAt = this.t;
    me.armed = false;
    me.confirmed = false;
    me.sq = 0.28;
    if (c.g) this.R.usedSpot = true;
    this.R.anim[s.i] = { kind: 'wob', t0: this.t };
    this.audio.squeak(1);
    const f = FRONTS[s.front];
    this.fx.puff(s.ax - f[0] * 0.2, s.ay - f[1] * 0.2, 5);
    if (c.g) this.net.ask({ t: 'hide', spot: s.i });
  }

  /** Step out at the front of the spot (`tell`: the host should hear it; false when the host already knows). */
  unhide(c, tell = true) {
    const me = this.me;
    const s = c.house.spots[me.hid];
    me.hid = -1;
    if (s) {
      me.x = s.ax;
      me.y = s.ay;
    }
    me.vx = 0;
    me.vy = 0;
    me.sq = 0.3;
    if (tell) this.audio.out(1);
    if (s) this.fx.puff(s.ax, s.ay, 4);
    this.R.unhideAt = this.t;
    if (tell && c.g) this.net.ask({ t: 'unhide' });
  }

  search(c) {
    const me = this.me;
    if (this.t < me.coolUntil) return;
    const s = nearestSpot(c.house, me.x, me.y, RULES.reach);
    if (!s) {
      this.nothingNear();
      return;
    }
    me.coolUntil = this.t + RULES.coolMs / 1000;
    this.R.anim[s.i] = { kind: 'open', t0: this.t, mine: true };
    this.audio.open(1);
    this.net.ask({ t: 'search', spot: s.i });
  }

  tap(x, y) {
    if (this.screen !== 'play') return;
    if (this.btn.tap(x, y)) return;
    if (this.cx.spectating) this.cycleWatch();
  }

  cycleWatch() {
    const ids = this.list.filter((ch) => !ch.you && ch.draw !== false).map((ch) => ch.id);
    if (ids.length === 0) return;
    const i = ids.indexOf(this.watchId);
    this.watchId = ids[(i + 1) % ids.length];
    this.audio.pop();
  }

  /** The host picks a setting by tapping its chip (the next choice). */
  cycleSetting(id) {
    const room = this.room;
    if (!room.isHost || room.match.phase !== 'lobby') return;
    const def = this.settingDefs.find((s) => s.id === id);
    if (!def) return;
    const opts = def.options.map((o) => (typeof o === 'object' ? o.value : o));
    const next = opts[(Math.max(0, opts.indexOf(room.settings[id])) + 1) % opts.length];
    room.setSetting(id, next);
    this.audio.pop();
  }

  // ------------------------------------------------------------ fixed step (60 Hz): my own character
  update(dt) {
    if (this.screen !== 'play') return;
    const c = this.context();
    this.syncRound(c);
    const room = this.room;
    const me = this.me;
    const g = c.g;
    if (room.match.phase === 'playing' && !room.running) return; // a paused match stands still
    if (c.spectating) return;
    const playing = g && (g.phase === 'hide' || g.phase === 'seek');
    const lobby = c.mode === 'lobby';
    if (g) this.checkHidden(c);
    const len = this.input.move(this.in);
    if (me.hid >= 0) {
      // hidden: sit still, and step out when asked (after the move input has been let go once)
      me.vx = 0;
      me.vy = 0;
      if (len < 0.2) me.armed = true;
      else if (me.armed && len > 0.4 && this.t - me.hidAt > 0.4) this.unhide(c);
    } else if (lobby || (playing && !c.counting)) {
      const speed = lobby ? RULES.speed.hider : speedFor(c.role);
      const px = me.x;
      const py = me.y;
      walk(me, this.in.x, this.in.y, dt, speed, c.house, this.sep, 1.3);
      me.step += Math.hypot(me.x - px, me.y - py);
      if (me.step > 1.25) {
        me.step = 0;
        this.fx.dust(me.x, me.y);
      }
    } else {
      me.vx = 0;
      me.vy = 0;
    }
    me.sq *= Math.exp(-dt * 12);
    if (playing && g.phase === 'seek' && isSeeking(c.role)) this.detectTags(c);
    this.net.setMe(me.x, me.y, me.a, me.vx, me.vy);
    room.setPresence({ x: r2(me.x), y: r2(me.y), vx: r1(me.vx), vy: r1(me.vy), a: r2(me.a), h: me.hid });
  }

  /** Is the host's record what I think? A hide the host refused, or being found, pops me out of the spot. */
  checkHidden(c) {
    const me = this.me;
    const g = c.g;
    const mine = spotOf(g, this.room.me.id);
    if (me.hid >= 0) {
      if (mine === me.hid) me.confirmed = true;
      else if (me.confirmed || this.t - me.hidAt > 1.5) {
        const refused = !me.confirmed;
        this.unhide(c, false);
        if (refused) {
          // The host didn't give me the spot (or its answer is very late): tell it I'm out so we agree, and say so.
          this.net.ask({ t: 'unhide' });
          this.audio.nope(1);
          this.fx.text(me.x, me.y - 0.8, 'taken!', '#ffb0b0', 22, 0.9);
        }
      }
    } else if (mine >= 0 && this.t - this.R.unhideAt > 1.5) {
      // reloaded while hidden: the record says where I am
      const s = c.house.spots[mine];
      if (s) {
        me.hid = mine;
        me.x = s.cx;
        me.y = s.cy;
        me.confirmed = true;
        me.hidAt = this.t;
        me.armed = false;
      }
    }
  }

  /** A seeker touching a hider out in the open (that they can see) tells the host. */
  detectTags(c) {
    const me = this.me;
    const cone = coneFor(c.role);
    if (!cone || me.hid >= 0) return;
    for (const ch of this.list) {
      if (ch.you || ch.role !== 'hider' || ch.peek >= 0 || ch.away) continue;
      if (Math.hypot(ch.x - me.x, ch.y - me.y) > RULES.tagTouch) continue;
      if (this.t - (this.R.tagAt[ch.id] ?? -9) < 0.6) continue;
      if (!canSee(me.x, me.y, me.a, cone, ch.x, ch.y, c.house.walls)) continue;
      this.R.tagAt[ch.id] = this.t;
      this.audio.tag(0.6);
      this.net.ask({ t: 'tag', id: ch.id });
    }
  }

  // ------------------------------------------------------------ events from the host's record
  processEvents(c) {
    const g = c.g;
    if (!g) return;
    const R = this.R;
    const house = c.house;
    const meId = this.room.me.id;
    for (const e of g.ev) {
      if (e.i <= R.seen) continue;
      R.seen = e.i;
      const s = e.s >= 0 ? house.spots[e.s] : null;
      const who = e.w ? this.chars.get(e.w) : null;
      const px = s ? s.ax : who ? who.x : this.me.x;
      const py = s ? s.ay : who ? who.y : this.me.y;
      const vol = Math.max(0.15, 1 / (1 + Math.hypot(px - this.me.x, py - this.me.y) / 5));
      const mineOpen = s && R.anim[e.s] && R.anim[e.s].mine && e.f === meId;
      if (e.k === 'hide') {
        if (e.w === meId) continue;
        R.anim[e.s] = { kind: 'wob', t0: this.t };
        this.audio.squeak(vol * 0.7);
      } else if (e.k === 'out') {
        if (e.w === meId) continue;
        this.audio.out(vol * 0.7);
        if (s) this.fx.puff(s.ax, s.ay, 4);
      } else if (e.k === 'nope') {
        if (s && !mineOpen) {
          R.anim[e.s] = { kind: 'open', t0: this.t };
          this.audio.open(vol * 0.6);
        }
        if (s) {
          this.fx.puff(s.ax, s.ay, 6);
          this.fx.text(s.cx, s.y - 0.2, 'nope', '#dfe6f2', 20, 0.8);
        }
        this.audio.nope(vol);
      } else if (e.k === 'found') {
        if (s && !mineOpen) R.anim[e.s] = { kind: 'open', t0: this.t };
        if (e.w) {
          this.emote.set(e.w, { kind: 'surprised', until: this.t + 1.6 });
          this.popAt.set(e.w, this.t);
        }
        if (e.f) this.emote.set(e.f, { kind: 'laugh', until: this.t + 1.4 });
        const x = s ? s.cx : px;
        const y = s ? s.y : py;
        this.fx.text(x, y - 0.5, 'FOUND YOU!', '#ffe27a', 34, 1.3);
        this.fx.sparks(x, y, '#ffe066', 14, 4.5);
        this.fx.ring(x, y, '#fff', 1.4, 0.5);
        this.audio.found(Math.max(0.35, vol));
        const mine = e.w === meId || e.f === meId;
        this.fx.addTrauma(mine ? 0.55 : 0.18 * vol);
        if (mine) this.fx.hit(0.08);
        if (e.f === meId) {
          this.fx.text(x, y - 1.2, `+${RULES.findGain}`, '#8cf0a8', 32, 1.2);
          this.audio.point();
        }
        if (e.w === meId) this.banner = { text: 'FOUND!', sub: 'Now you seek!', color: '#ff8a1f', t0: this.t, dur: 1.8 };
      }
    }
  }

  // ------------------------------------------------------------ phase changes
  onPhase(c) {
    const g = c.g;
    const R = this.R;
    if (!g || R.phase === g.phase || g.phase === 'idle') return;
    R.phase = g.phase;
    const seeker = isSeeking(c.role);
    if (g.phase === 'hide') {
      R.startedAt = this.t;
      this.banner = c.spectating
        ? null
        : { text: seeker ? `COUNT TO ${Math.round(g.hideMs / 1000)}!` : 'HIDE!', sub: seeker ? '' : 'Find a spot', color: seeker ? '#ff8a1f' : '#38c96b', t0: this.t, dur: RULES.bannerMs / 1000 };
      this.audio.whistle();
    } else if (g.phase === 'seek') {
      this.banner = { text: 'READY OR NOT!', sub: 'Here I come!', color: '#ff8a1f', t0: this.t, dur: 1.9 };
      this.audio.readyOrNot();
      this.fx.addTrauma(0.25);
      R.mark = 0;
    } else if (g.phase === 'reveal') {
      this.banner = { text: g.allFound ? 'ALL FOUND!' : "TIME'S UP!", sub: '', color: g.allFound ? '#ff8a1f' : '#38c96b', t0: this.t, dur: 1.8 };
      this.audio.found(0.8);
      this.roundDone(c);
    } else if (g.phase === 'score') {
      this.audio.point();
    } else if (g.phase === 'final') {
      this.finalDone(c);
    }
  }

  /** Badges and a "+N" for the round that just ended. */
  roundDone(c) {
    const g = c.g;
    const R = this.R;
    if (R.rewarded || c.spectating) return;
    R.rewarded = true;
    const id = this.room.me.id;
    const gain = g.gain[id] ?? 0;
    if (gain > 0) {
      this.fx.text(this.me.x, this.me.y - 1.1, `+${gain}`, '#8cf0a8', 34, 1.6);
      this.audio.point();
    }
    const role = roleOf(g, id);
    const award = (badge) => {
      try {
        Promise.resolve(this.ow.badges.award(badge)).catch(() => {});
      } catch {
        // badges are a bonus
      }
    };
    if (role === 'hider' && g.survived.includes(id) && !R.usedSpot) award('master-hider');
    if (role === 'seeker' && g.allFound && Object.values(g.fd).includes(id)) award('eagle-eye');
    if (role === 'hider' && g.survived.includes(id)) this.stats.survived++;
  }

  /** The results are in: fanfare, confetti, and (for a player) stats, badges and the leaderboard, once. */
  finalDone(c) {
    const g = c.g;
    if (!g.res) return;
    const id = this.room.me.id;
    const row = g.res.order.find((o) => o.id === id);
    this.final = { mid: g.mid, endedAt: -1 };
    this.lastRecord = g;
    this.fx.confetti(this.cam.x, this.cam.y + 1, 90, 12, 9);
    if (c.spectating || !row) return;
    if (row.place === 1) this.audio.win();
    else this.audio.lose();
    if (this.finishedFor === g.mid) return;
    this.finishedFor = g.mid;
    this.stats.matches++;
    if (row.place === 1) this.stats.wins++;
    this.stats.finds += g.stats.finds[id] ?? 0;
    const stats = { ...this.stats };
    this.statsReady = this.statsReady
      .then(async () => {
        await this.ow.save.set('stats', stats);
        if (row.place === 1) {
          if (await this.ow.badges.award('first-win')) this.audio.badge();
          await this.ow.leaderboards.submit('wins', stats.wins);
        }
        if (stats.matches >= 10) await this.ow.badges.award('sleepover');
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------ the characters, as this page should see them
  charFor(id) {
    let ch = this.chars.get(id);
    if (!ch) {
      const h = hashOf(id);
      ch = { id, name: '', x: 0, y: 0, vx: 0, vy: 0, a: 0, color: COLORS[h % COLORS.length], role: 'lobby', bot: false, face: h, img: null, you: false, ready: false, alpha: 1, sq: 0, pop: 1, walk: 0, phase: (h % 628) / 100, emote: '', draw: true, peek: -1, arrow: false, bubble: '', cheer: false, away: false, stepAcc: 0 };
      this.chars.set(id, ch);
    }
    return ch;
  }

  /** The bots: the host's own simulation (a Map), or the room's snapshots (an array by roster index) drawn between two of them. */
  botPositions(g) {
    if (this.net.authority) return this.net.host.bots;
    return this.net.botsAt(g.rid, this.cx.matchNow, this.botBuf) ? this.botBuf : null;
  }

  /** Builds this.list (every character as it should be drawn) from the room, for the lobby or the match. */
  buildChars(c, dt) {
    const room = this.room;
    const me = this.me;
    const list = this.list;
    const sep = this.sep;
    list.length = 0;
    sep.length = 0;
    const g = c.g;
    const house = c.house;
    const myId = room.me.id;
    if (!g) {
      // the lobby: the humans here
      for (const p of room.players.values()) {
        const ch = this.charFor(p.id);
        const isMe = p.id === myId;
        ch.name = cleanName(p.name);
        ch.you = isMe;
        ch.bot = false;
        ch.color = COLORS[hashOf(p.id) % COLORS.length];
        ch.img = this.avatars.get(p.id);
        ch.role = 'lobby';
        ch.ready = Boolean(p.ready);
        ch.away = p.connected === false;
        ch.alpha = ch.away ? 0.5 : 1;
        ch.arrow = false;
        ch.bubble = '';
        ch.emote = '';
        ch.cheer = false;
        ch.pop = 1;
        let hid = -1;
        if (isMe) {
          ch.x = me.x;
          ch.y = me.y;
          ch.vx = me.vx;
          ch.vy = me.vy;
          ch.a = me.a;
          hid = me.hid;
        } else {
          const pr = room.presenceAt(p.id, { angles: ['a'], snap: 1.5 });
          if (!pr || !Number.isFinite(pr.x) || !Number.isFinite(pr.y)) {
            ch.draw = false;
            continue;
          }
          ch.x = Math.min(house.w - 0.5, Math.max(0.5, pr.x));
          ch.y = Math.min(house.h - 0.5, Math.max(0.5, pr.y));
          ch.vx = Number.isFinite(pr.vx) ? pr.vx : 0;
          ch.vy = Number.isFinite(pr.vy) ? pr.vy : 0;
          ch.a = Number.isFinite(pr.a) ? pr.a : 0;
          hid = Number.isInteger(pr.h) && pr.h >= 0 && pr.h < house.spots.length ? pr.h : -1;
        }
        ch.draw = true;
        ch.peek = hid;
        ch.sq = isMe ? me.sq : 0;
        if (hid < 0 && !isMe) sep.push(ch);
        this.animate(ch, dt);
        list.push(ch);
      }
      return;
    }
    const viewerCone = c.mode === 'seek' && !c.spectating ? coneFor(c.role) : null;
    const reveal = c.mode === 'reveal' || c.mode === 'score' || c.mode === 'final';
    const showArrow = this.t < this.R.startedAt + 3 && (g.phase === 'hide' || g.phase === 'seek') && !c.spectating;
    const occ = {};
    for (const k of Object.keys(g.spots)) occ[g.spots[k]] = Number(k);
    const bots = this.botPositions(g);
    g.roster.forEach((r, i) => {
      const ch = this.charFor(r.id);
      const isMe = r.id === myId;
      const role = roleOf(g, r.id);
      const human = room.players.get(r.id);
      ch.name = cleanName(human?.name ?? r.n);
      ch.you = isMe;
      ch.bot = Boolean(r.b);
      ch.color = COLORS[r.c % COLORS.length];
      ch.img = r.b ? null : this.avatars.get(r.id);
      ch.role = role;
      ch.ready = false;
      ch.bubble = '';
      ch.arrow = isMe && showArrow;
      const hidSpot = isMe && me.hid >= 0 ? me.hid : has(occ, r.id) ? occ[r.id] : -1;
      const em = this.emote.get(r.id);
      ch.emote = em && em.until > this.t ? em.kind : reveal && role === 'hider' && hidSpot >= 0 ? 'laugh' : '';
      ch.cheer = reveal && g.survived.includes(r.id);
      const pa = this.popAt.get(r.id);
      ch.pop = pa !== undefined && this.t - pa < 0.45 ? 1 + 0.35 * (1 - ease.outCubic(clamp01((this.t - pa) / 0.45))) : 1;
      ch.away = !r.b && human ? human.connected === false : false;
      ch.alpha = ch.away ? 0.5 : 1;
      let x = ch.x;
      let y = ch.y;
      let a = ch.a;
      let vx = 0;
      let vy = 0;
      if (isMe) {
        x = me.x;
        y = me.y;
        a = me.a;
        vx = me.vx;
        vy = me.vy;
      } else if (r.b) {
        const b = bots ? (bots instanceof Map ? bots.get(r.id) : bots[i]) : null;
        if (b) {
          x = b.x;
          y = b.y;
          a = b.a;
          vx = b.vx;
          vy = b.vy;
        } else {
          const p = startPos(g, house, r.id);
          x = p.x;
          y = p.y;
          a = p.a;
        }
      } else {
        const pr = room.presenceAt(r.id, { angles: ['a'], snap: 1.5 });
        if (pr && Number.isFinite(pr.x) && Number.isFinite(pr.y)) {
          x = pr.x;
          y = pr.y;
          a = Number.isFinite(pr.a) ? pr.a : a;
          vx = Number.isFinite(pr.vx) ? pr.vx : 0;
          vy = Number.isFinite(pr.vy) ? pr.vy : 0;
        } else {
          const p = startPos(g, house, r.id);
          x = p.x;
          y = p.y;
          a = p.a;
        }
      }
      ch.x = Math.min(house.w - 0.5, Math.max(0.5, x));
      ch.y = Math.min(house.h - 0.5, Math.max(0.5, y));
      ch.a = a;
      ch.vx = vx;
      ch.vy = vy;
      ch.sq = isMe ? me.sq : 0;
      ch.draw = true;
      ch.peek = -1;
      if (hidSpot >= 0 && hidSpot < house.spots.length) {
        const s = house.spots[hidSpot];
        if (reveal) {
          // the reveal: popped out at the front of the spot, every spot open
          ch.x = s.ax;
          ch.y = s.ay;
          ch.vx = 0;
          ch.vy = 0;
        } else {
          ch.peek = hidSpot;
          // a seeker never sees anyone who is hidden; hiders (and watchers) see the eyes
          if (viewerCone && !isMe) ch.draw = false;
        }
      } else if (viewerCone && !isMe && role === 'hider') {
        // a hider in the open is seen only inside the flashlight (or the little circle around the seeker)
        ch.draw = canSee(me.x, me.y, me.a, viewerCone, ch.x, ch.y, house.walls);
      }
      if (c.counting) ch.draw = false; // a seeker counting sees nothing
      if (ch.peek < 0 && !isMe) sep.push(ch);
      this.animate(ch, dt);
      list.push(ch);
    });
  }

  animate(ch, dt) {
    const speed = Math.hypot(ch.vx, ch.vy);
    ch.walk = (ch.walk + speed * dt * 1.7) % 6283;
    if (!ch.you && ch.draw !== false && ch.peek < 0 && speed > 2.5) {
      ch.stepAcc += speed * dt;
      if (ch.stepAcc > 1.25) {
        ch.stepAcc = 0;
        if (Math.abs(ch.x - this.cam.x) < 14 && Math.abs(ch.y - this.cam.y) < 9) this.fx.dust(ch.x, ch.y);
      }
    }
  }

  // ------------------------------------------------------------ the frame
  /** Draws one frame. (W, H) in CSS pixels, pr the pixel ratio; dt in seconds. */
  draw(c2, W, H, pr, dt) {
    this.t += dt;
    const c = this.context();
    this.syncRound(c);
    const g = c.g;
    const house = c.house;
    const fx = this.fx;
    this.onPhase(c);
    this.processEvents(c);
    this.buildChars(c, dt);
    this.updateControls(c);
    this.audioMood(c);
    this.liveCues(c);
    // the camera follows me (or what a watcher chose)
    let target = this.me;
    if (c.spectating) {
      const watch = this.list.find((ch) => ch.id === this.watchId && ch.draw !== false) ?? this.list.find((ch) => isSeeking(ch.role) && ch.draw !== false) ?? this.list.find((ch) => ch.draw !== false);
      if (watch) {
        this.watchId = watch.id;
        target = watch;
      }
    }
    const k = 1 - Math.exp(-dt * 9);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    const v = makeView(W, H, pr, this.cam, fx.shake(this.t));
    clampCamera(v, house, this.cam);
    v.cx = this.cam.x;
    v.cy = this.cam.y;
    v.x0 = v.cx - W / 2 / v.scale - 1;
    v.x1 = v.cx + W / 2 / v.scale + 1;
    v.y0 = v.cy - H / 2 / v.scale - 1;
    v.y1 = v.cy + H / 2 / v.scale + 1;
    this.spotsNow(c);
    const late = c.mode === 'score' || c.mode === 'final'; // the particles go over the dimmed backdrop of these screens
    const scene = { house, t: this.t, spots: this.spotStates, chars: this.list, beams: this.beams(c), dim: null, blind: c.counting, fx, skipParticles: late };
    if (g && c.mode === 'seek' && isSeeking(c.role) && !c.spectating) {
      const cone = coneFor(c.role);
      visibility(this.me.x, this.me.y, this.me.a, cone, house.walls, this.poly);
      scene.dim = { x: this.me.x, y: this.me.y, cone, poly: this.poly, alpha: 0.84 };
    }
    renderScene(c2, v, scene);
    if (!late) renderLabels(c2, v, scene);
    screenTransform(c2, v);
    if (c.mode === 'final' && this.t - (this.confettiAt ?? 0) > 0.14) {
      // a steady rain of confetti on the results
      this.confettiAt = this.t;
      fx.confetti(this.cam.x + (Math.sin(this.t * 7.3) * 0.5 + (this.t % 1) - 0.5) * 12, this.cam.y - 5, 4, 6, 1.5);
    }
    this.drawScreens(c2, c, W, H, v);
    // a tiny freeze on the biggest hits: the effects hold still for a moment (the clock and the input never do)
    if (fx.freeze > 0) fx.freeze -= dt;
    else fx.update(dt);
  }

  /** Flashlight beams of the seekers this viewer may see (a hider sees them all; a seeker the others'). */
  beams(c) {
    const out = [];
    if (!c.g || c.mode !== 'seek') return out;
    for (const ch of this.list) {
      if (!isSeeking(ch.role) || ch.draw === false) continue;
      if (ch.you && isSeeking(c.role)) continue;
      const cone = coneFor(ch.role);
      let poly = this.beamPolys.get(ch.id);
      if (!poly) this.beamPolys.set(ch.id, (poly = []));
      visibility(ch.x, ch.y, ch.a, cone, c.house.walls, poly);
      out.push({ x: ch.x, y: ch.y, a: ch.a, cone, poly, alpha: ch.role === 'found' ? 0.7 : 1 });
    }
    return out;
  }

  /** Live state of each spot: who's inside (for eyes), the open animation, wobbling, and which one my button would use. */
  spotsNow(c) {
    const house = c.house;
    const g = c.g;
    const states = this.spotStates;
    const me = this.me;
    for (const s of states) {
      s.occ = null;
      s.open = 0;
      s.wob = 0;
      s.hot = false;
      s.mine = false;
      s.label = '';
      s.fill = '';
    }
    const reveal = c.mode === 'reveal' || c.mode === 'score' || c.mode === 'final';
    if (g) for (const k of Object.keys(g.spots)) if (states[k]) states[k].occ = g.spots[k];
    const R = this.R;
    for (const k of Object.keys(R.anim)) {
      const a = R.anim[k];
      const st = states[k];
      if (!st) {
        delete R.anim[k];
        continue;
      }
      const age = this.t - a.t0;
      if (a.kind === 'open') {
        const dur = RULES.openMs / 1000 + 0.35;
        if (age > dur) delete R.anim[k];
        else st.open = Math.sin(Math.PI * Math.min(1, age / dur));
      } else if (age > 0.55) delete R.anim[k];
      else st.wob = Math.max(st.wob, 1 - age / 0.55);
    }
    if (reveal) for (const s of states) if (s.occ) s.open = Math.max(s.open, 0.9);
    // a seeker close to a spot with someone in it makes it wobble (the hint)
    if (g && c.mode === 'seek') {
      for (const ch of this.list) {
        if (!isSeeking(ch.role)) continue;
        for (const k of Object.keys(g.spots)) {
          const s = house.spots[k];
          if (s && distToRect(ch.x, ch.y, [s.x, s.y, s.w, s.h]) <= RULES.hint) states[k].wob = Math.max(states[k].wob, 0.45 + 0.1 * Math.sin(this.t * 9));
        }
      }
    }
    if (!g) for (const ch of this.list) if (ch.peek >= 0 && states[ch.peek]) states[ch.peek].occ = ch.id;
    // my prompt, over the spot my button would use
    if (!c.spectating && !c.counting && me.hid < 0) {
      let s = null;
      let text = '';
      if (c.mode === 'lobby') {
        s = nearestSpot(house, me.x, me.y, RULES.reach);
        text = 'Hide';
      } else if (g && (g.phase === 'hide' || g.phase === 'seek')) {
        if (c.role === 'hider') {
          s = nearestSpot(house, me.x, me.y, RULES.reach, (i) => !has(g.spots, i));
          text = 'Hide';
        } else if (g.phase === 'seek') {
          s = nearestSpot(house, me.x, me.y, RULES.reach);
          text = this.t < me.coolUntil ? '' : 'Search';
        }
      }
      if (s) {
        states[s.i].hot = text !== '';
        states[s.i].label = text;
      }
    } else if (me.hid >= 0 && states[me.hid]) {
      // where I am: the spot is outlined; the first moments say how to step out, and a seeker close by makes me hold my breath
      const st = states[me.hid];
      st.mine = true;
      if (this.t - me.hidAt < 2.5) {
        st.label = 'Out';
        st.fill = '#8cf0a8';
      }
      if (g && c.mode === 'seek') {
        const s = house.spots[me.hid];
        let near = false;
        for (const ch of this.list) if (isSeeking(ch.role) && s && distToRect(ch.x, ch.y, [s.x, s.y, s.w, s.h]) <= RULES.hint) near = true;
        if (near) {
          st.label = 'shhh';
          st.fill = '#bfe3ff';
        }
      }
    }
  }

  /** Sounds and floating numbers that follow what's happening to me. */
  liveCues(c) {
    const g = c.g;
    const me = this.me;
    if (!g || c.spectating) return;
    // a heartbeat while a seeker is right by my hiding spot
    if (me.hid >= 0 && c.mode === 'seek') {
      const st = this.spotStates[me.hid];
      if (st && st.label === 'shhh' && this.t - this.heartAt > 0.75) {
        this.heartAt = this.t;
        this.audio.heart(1);
        this.fx.addTrauma(0.04);
      }
    }
    // +2 for every 15 s a hider stays unfound
    if (c.mode === 'seek' && c.role === 'hider') {
      const k = Math.floor(Math.max(0, c.matchNow - g.seekAt) / RULES.surviveEvery);
      if (k > this.R.mark) {
        this.R.mark = k;
        this.fx.text(me.x, me.y - 1.3, `+${RULES.surviveGain}`, '#8cf0a8', 30, 1.1);
        this.audio.point();
      }
    }
    // tick, tick for the last seconds of the hiding time
    if (c.mode === 'hide') {
      const left = Math.ceil((g.until - c.matchNow) / 1000);
      if (left !== this.R.lastTick && left <= 5 && left > 0) {
        this.R.lastTick = left;
        this.audio.tick();
      }
    }
  }

  audioMood(c) {
    const mode = c.mode;
    this.audio.setMood(mode === 'hide' ? 'hide' : mode === 'seek' ? 'seek' : mode === 'final' ? 'win' : 'menu');
  }

  /** The platform's stick and a button whose label follows what Space would do now. */
  updateControls(c) {
    let key = 'none';
    let name = '';
    if (!c.spectating) {
      const hidden = this.me.hid >= 0;
      if (c.mode === 'lobby' || (c.mode === 'hide' && c.role === 'hider') || (c.mode === 'seek' && c.role === 'hider')) name = hidden ? 'Out' : 'Hide';
      else if (c.mode === 'seek') name = 'Search';
      if (name) key = name;
    }
    if (key === this.ctrlKey) return;
    this.ctrlKey = key;
    this.setControls(name);
  }

  setControls(name) {
    try {
      if (!name) this.ow.controls.set(null);
      else this.ow.controls.set({ stick: 'analog', buttons: [{ id: 'act', label: name, key: ' ' }] });
    } catch {
      // controls are a bonus on devices that have them
    }
  }

  /** The title screen has no controls. */
  clearControls() {
    if (this.ctrlKey === 'none') return;
    this.ctrlKey = 'none';
    this.setControls('');
  }

  // ------------------------------------------------------------ the screens on top of the world
  drawScreens(c2, c, W, H, v) {
    const g = c.g;
    const t = this.t;
    const room = this.room;
    this.btn.reset();
    if (this.t < this.goUntil) ui.drawCountdown(c2, W, H, 'GO!', 0.8 - (this.goUntil - this.t));
    if (c.mode === 'lobby') {
      const results = this.final && this.final.endedAt >= 0 && t - this.final.endedAt < 7 && room.match.phase === 'lobby';
      if (results) this.drawResultsCard(c2, W, H);
      else ui.drawChips(c2, W, H, this.chips(), room.isHost && room.match.phase === 'lobby', t, this.btn, (id) => this.cycleSetting(id));
      if (room.match.phase === 'starting') this.drawCountdown(c2, W, H);
      else if (!results) ui.drawHint(c2, W, H, "Hide before you're found!", t);
      return;
    }
    if (c.spectating) ui.drawWatching(c2, W, H, t);
    if (!g) return;
    if (c.mode === 'hide' || c.mode === 'seek') {
      const left = Math.max(0, Math.ceil((g.until - c.matchNow) / 1000));
      if (c.counting) ui.drawCounting(c2, W, H, t, left, '#ffe27a');
      else this.drawHud(c2, W, g, c, left);
      this.drawBanner(c2, W, H);
    } else if (c.mode === 'reveal') {
      this.drawHud(c2, W, g, c, 0, true);
      this.drawBanner(c2, W, H);
    } else if (c.mode === 'score') {
      c2.fillStyle = 'rgba(14,8,28,0.72)';
      c2.fillRect(0, 0, W, H);
      this.particlesOver(c2, v);
      const rows = g.roster.map((r) => ({ ch: this.charFor(r.id), name: this.charFor(r.id).name, score: g.scores[r.id] ?? 0, gain: g.gain[r.id] ?? 0, you: r.id === room.me.id }));
      ui.drawScoreboard(c2, W, H, { rows, title: g.n >= g.total ? 'Final round' : `Round ${g.n}`, age: Math.max(0, (c.matchNow - g.t0) / 1000) }, t);
    } else if (c.mode === 'final') {
      c2.fillStyle = 'rgba(14,8,28,0.72)';
      c2.fillRect(0, 0, W, H);
      this.particlesOver(c2, v);
      ui.drawPodium(c2, W, H, this.podium(g, Math.max(0, (c.matchNow - g.t0) / 1000)), t);
    }
  }

  /** The particles again, over a dimmed screen (confetti must not be dimmed). */
  particlesOver(c2, v) {
    worldTransform(c2, v);
    this.fx.draw(c2);
    screenTransform(c2, v);
  }

  drawBanner(c2, W, H) {
    const b = this.banner;
    if (!b) return;
    const age = this.t - b.t0;
    if (age >= b.dur) {
      this.banner = null;
      return;
    }
    ui.drawBanner(c2, W, H, { text: b.text, sub: b.sub, color: b.color, age, dur: b.dur });
  }

  chips() {
    const out = [];
    for (const def of this.settingDefs) {
      const cur = this.room.settings[def.id];
      const opt = def.options.find((o) => (typeof o === 'object' ? o.value : o) === cur) ?? def.options[0];
      out.push({ id: def.id, label: def.label, value: typeof opt === 'object' ? opt.label ?? String(opt.value) : String(opt) });
    }
    return out;
  }

  drawCountdown(c2, W, H) {
    const left = (this.room.match.startsAt - this.ow.now()) / 1000;
    const n = Math.ceil(left);
    if (n !== this.countN) {
      this.countN = n;
      this.countAt = this.t;
      this.audio.beep(n <= 0);
    }
    ui.drawCountdown(c2, W, H, n > 0 ? String(Math.min(n, 9)) : 'GO!', this.t - this.countAt);
  }

  drawHud(c2, W, g, c, left, reveal = false) {
    const id = this.room.me.id;
    const dots = g.roster.filter((r) => !g.seek.includes(r.id)).map((r) => ({ color: COLORS[r.c % COLORS.length], found: has(g.found, r.id) }));
    const mine = rankScores(g.roster, g.scores).find((r) => r.id === id);
    const seeker = isSeeking(c.role);
    ui.drawHud(c2, W, 0, { round: `Round ${g.n}/${g.total}`, secs: reveal ? null : left, tag: seeker ? 'SEEK' : 'HIDE', seeker, dots, score: g.scores[id] ?? 0, place: mine && !c.spectating ? placeWord(mine.place) : '' }, this.t);
    const mw = Math.max(110, Math.min(160, W * 0.16));
    const seekers = this.list.filter((ch) => isSeeking(ch.role) && !ch.you).map((ch) => ({ x: ch.x, y: ch.y, found: ch.role === 'found' }));
    const meDot = c.spectating ? null : { x: this.me.x, y: this.me.y, color: seeker ? '#ff8a1f' : this.charFor(id).color };
    ui.drawMinimap(c2, { house: c.house, me: meDot, seekers, x: W - mw - 16, y: 82, w: mw }, this.t);
  }

  /** The three on the podium, the awards and (when I'm lower) my place. */
  podium(g, age) {
    const id = this.room.me.id;
    const res = g.res ?? { order: [], awards: [] };
    const order = res.order.map((o) => ({ ch: this.charFor(o.id), name: this.charFor(o.id).name, score: o.score, place: o.place }));
    const mine = res.order.find((o) => o.id === id);
    const awards = res.awards.map((a) => ({ k: a.k, ch: this.charFor(a.id), name: this.charFor(a.id).name, v: a.v }));
    return { order, awards, you: mine && !this.cx.spectating ? { place: mine.place, text: placeWord(mine.place) } : null, age };
  }

  /** The results stay up a few seconds in the lobby after the match (a compact podium from the last record). */
  drawResultsCard(c2, W, H) {
    if (this.lastRecord && this.lastRecord.res) ui.drawPodium(c2, W, H, this.podium(this.lastRecord, 9), this.t, true);
  }
}
