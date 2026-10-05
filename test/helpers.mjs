// Test scaffolding (not a test file): a canvas context that records calls and flags NaN, a fake clock, and two pages of the
// game talking through a shared room, so the whole browser side can be exercised in node.
import { createStubRoom, Net, standaloneOw } from '../game/net.js';
import { Play } from '../game/play.js';
import { Fx } from '../game/fx.js';
import { AudioSys } from '../game/audio.js';
import { STEP } from '../game/sim.js';

export function mockCtx() {
  const info = { calls: 0, texts: [], bad: [] };
  const grad = { addColorStop() {} };
  const target = { canvas: { width: 1280, height: 720 }, __info: info };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 11 });
      if (p === 'createRadialGradient' || p === 'createLinearGradient') {
        return (...a) => {
          if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) info.bad.push(`${String(p)}(${a})`);
          return grad;
        };
      }
      return (...a) => {
        info.calls++;
        if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) info.bad.push(`${String(p)}(${a.join(',')})`);
        if (p === 'fillText' || p === 'strokeText') info.texts.push(String(a[0]));
      };
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}

export class FakeClock {
  constructor() {
    this.now = 0;
    this.timers = [];
  }
  later(fn, ms) {
    this.timers.push({ at: this.now + ms, fn });
  }
  advance(ms) {
    this.now += ms;
    for (const t of this.timers.filter((x) => x.at <= this.now)) {
      this.timers.splice(this.timers.indexOf(t), 1);
      t.fn();
    }
  }
}

export function fakeInput() {
  const handlers = { action: [], tap: [] };
  const input = {
    vec: { x: 0, y: 0 },
    move(out) {
      out.x = input.vec.x;
      out.y = input.vec.y;
      return Math.hypot(out.x, out.y);
    },
    onAction: (fn) => handlers.action.push(fn),
    onTap: (fn) => handlers.tap.push(fn),
    onAny() {},
    clear() {
      handlers.action.length = 0;
      handlers.tap.length = 0;
    },
    press: () => handlers.action.forEach((f) => f('Space')),
    tap: (x, y) => handlers.tap.forEach((f) => f(x, y)),
    lastMove: 0,
  };
  return input;
}

/** One page: a room, a Net and a Play. */
function makePage(room, clock, id) {
  const ow = { ...standaloneOw(), now: () => clock.now };
  const saved = [];
  ow.save = { get: async () => null, set: async (k, v) => saved.push([k, v]), delete: async () => {}, list: async () => [] };
  const badges = [];
  ow.badges = { award: async (b) => (badges.push(b), true) };
  const submitted = [];
  ow.leaderboards = { submit: async (n, v) => (submitted.push([n, v]), null) };
  const controls = [];
  ow.controls = { set: (x) => controls.push(x), stick: { x: 0, y: 0 }, pressed: () => false, touch: false };
  const net = new Net(room, { now: () => clock.now });
  const input = fakeInput();
  const fx = new Fx();
  const audio = new AudioSys();
  const avatars = { get: () => null };
  const play = new Play({ ow, room, net, audio, fx, input, avatars });
  play.screen = 'play';
  const ctx = mockCtx();
  return { id, room, net, play, input, fx, audio, ctx, saved, badges, submitted, controls, ow };
}

/** Two humans in one room: page A is the host, page B is a guest, bots fill the table. */
export function makeTwoPages() {
  const clock = new FakeClock();
  const opts = { now: () => clock.now, later: (fn, ms) => clock.later(fn, ms) };
  const A = createStubRoom(opts);
  const B = createStubRoom(opts);
  B.me.id = 'b';
  B.me.name = 'Bea';
  B.isHost = false;
  B.host = 'me';
  A.me.name = 'Ann';
  A.players.set('b', B.me);
  B.players = new Map([['me', A.me], ['b', B.me]]);
  B.state = A.state;
  Object.defineProperty(B, 'match', { get: () => A.match, configurable: true });
  Object.defineProperty(B, 'settings', { get: () => A.settings, configurable: true });
  Object.defineProperty(B, 'running', { get: () => A.match.phase === 'playing', configurable: true });
  Object.defineProperty(B, 'participants', { get: () => A.participants, configurable: true });
  B.matchNow = () => A.matchNow();
  B.presenceAt = (id) => (id === 'b' ? B.me.presence : A.me.presence);
  A.presenceAt = (id) => (id === 'me' ? A.me.presence : B.me.presence);
  B.send = (msg) => A._emit('message', msg, B.me, clock.now, A.matchNow());
  A.send = (msg) => B._emit('message', msg, A.me, clock.now, A.matchNow());
  B.endMatch = () => A.endMatch();
  const setStateB = B.setState;
  B.setState = (k, v) => {
    setStateB(k, v);
    A._emit('state', k, v, 'b');
  };
  const setState = A.setState;
  A.setState = (k, v) => {
    setState(k, v);
    B._emit('state', k, v, 'me');
  };
  for (const ev of ['starting', 'matchstart', 'matchend', 'settings']) A.on(ev, (...a) => B._emit(ev, ...a));
  const pa = makePage(A, clock, 'me');
  const pb = makePage(B, clock, 'b');
  return { clock, A, B, pa, pb };
}

/** Starts a match from the lobby: both ready, the countdown, play begins. */
export function startMatch(T) {
  const { A, clock } = T;
  A.match = { ...A.match, participants: ['me', 'b'] };
  A.setReady(true);
  A.match = { ...A.match, participants: ['me', 'b'] };
  clock.advance(3001);
  A.match = { ...A.match, participants: ['me', 'b'] };
}

/** Runs `seconds` of the game at 60 Hz: both pages update, the host ticks, and a frame is drawn every `drawEvery` steps. */
export function run(T, seconds, { drawEvery = 6, script } = {}) {
  const { pa, pb, clock } = T;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    clock.advance(1000 / 60);
    T.step = (T.step ?? 0) + 1;
    if (script) script(T.step, T);
    pa.play.update(STEP);
    pb.play.update(STEP);
    pa.net.stepBots(STEP);
    pb.net.stepBots(STEP);
    if (T.step % 6 === 0) {
      pa.net.tick();
      pb.net.tick();
    }
    if (T.step % drawEvery === 0) {
      pa.play.draw(pa.ctx, 1280, 720, 1, drawEvery / 60);
      pb.play.draw(pb.ctx, 844, 390, 2, drawEvery / 60);
    }
  }
}
