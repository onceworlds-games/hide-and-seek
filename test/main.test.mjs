import test from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx, FakeClock, textOutside } from './helpers.mjs';
import { createStubRoom, standaloneOw } from '../game/net.js';
import { BOT_NAMES } from '../game/rules.js';

// main.js runs by itself when it is loaded: give it a browser made of fakes and drive its frame loop by hand.
test('the page boots, shows the title, starts from PLAY, plays a round, shows a closed room and rejoins', async () => {
  const clock = new FakeClock();
  const ctx = mockCtx();
  const handlers = { keydown: [], keyup: [], blur: [], resize: [], pointerdown: [], visibilitychange: [] };
  const on = (type, fn) => (handlers[type] ??= []).push(fn);
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, addEventListener: on };
  const rafs = [];
  const intervals = [];
  const rooms = [];
  const controls = [];
  const ow = {
    ...standaloneOw(),
    now: () => clock.now,
    controls: { set: (x) => controls.push(x), stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    settings: { quality: 'high', reducedMotion: false, scale: 1, pixelRatio: () => 2, on() {} },
    rooms: {
      join: async () => {
        const r = createStubRoom({ now: () => clock.now, later: (fn, ms) => clock.later(fn, ms) });
        r.hideCalls = [];
        const hide = r.hideLobby;
        r.hideLobby = (h = true) => {
          r.hideCalls.push(h);
          hide(h);
        };
        rooms.push(r);
        return r;
      },
    },
  };
  globalThis.window = { onceworlds: ow, innerWidth: 844, innerHeight: 390, devicePixelRatio: 2 };
  globalThis.location = { search: '' };
  globalThis.addEventListener = on;
  globalThis.requestAnimationFrame = (fn) => rafs.push(fn);
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => intervals.push({ fn, ms, next: ms });
  globalThis.document = {
    getElementById: () => canvas,
    addEventListener: on,
    hidden: false,
    body: { style: {}, dataset: {} },
    fonts: { load: async () => {}, ready: Promise.resolve() },
  };
  let t = 1000;
  const frames = (n, dtMs = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      t += dtMs;
      clock.advance(dtMs);
      for (const iv of intervals) {
        iv.next -= dtMs;
        if (iv.next <= 0) {
          iv.next += iv.ms;
          iv.fn();
        }
      }
      const todo = rafs.splice(0);
      for (const fn of todo) fn(t);
    }
  };
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await import('../game/main.js?boot');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(rooms.length, 1, 'joined one room at the start');
    assert.equal(canvas.width, 1688, 'the canvas is the window at the pixel ratio');
    assert.equal(canvas.height, 780);
    // the title
    frames(40);
    assert.ok(ctx.__info.texts.includes('PLAY') && ctx.__info.texts.includes('SEEK'), 'the title is up');
    assert.deepEqual(rooms[0].hideCalls, [true], 'the lobby strip is hidden while the title shows');
    assert.equal(controls[controls.length - 1] ?? null, null, 'no touch controls on the title');
    // keys and taps before PLAY don't do anything but start the sound
    handlers.pointerdown.forEach((f) => f({ clientX: 10, clientY: 10 }));
    frames(3);
    assert.ok(!ctx.__info.texts.includes("Hide before you're found!"), 'a tap off the button stays on the title');
    // PLAY
    handlers.pointerdown.forEach((f) => f({ clientX: 422, clientY: 333 }));
    frames(30);
    assert.deepEqual(rooms[0].hideCalls, [true, false], 'the lobby strip comes back');
    assert.ok(ctx.__info.texts.includes("Hide before you're found!"), 'the lobby arena is up');
    assert.ok(controls.some((c) => c && c.buttons && c.buttons[0].label === 'Hide'), 'the touch button says Hide');
    // ready up (the stand-in room has no platform strip): countdown, then the first round
    rooms[0].setReady(true);
    frames(60 * 4);
    assert.equal(rooms[0].match.phase, 'playing');
    frames(60 * 3);
    assert.ok(ctx.__info.texts.includes('COUNT TO 20!') || ctx.__info.texts.includes('HIDE!'), 'a round banner');
    frames(60 * 30);
    assert.ok(ctx.__info.texts.includes('READY OR NOT!'), 'the seek began');
    assert.deepEqual(ctx.__info.bad, [], 'no NaN reached the canvas');
    // (name tags of characters standing at the very edge of the view may be cut by it; the screens' own text never is)
    const names = new RegExp(`^(${[...BOT_NAMES, 'You', 'YOU', 'FOUND YOU!', 'nope', 'taken!'].join('|')})@`);
    assert.deepEqual(textOutside(ctx, 1688, 780).filter((x) => !names.test(x)), [], 'no text off the screen');
    assert.equal(errors.length, 0, errors.join('\n'));
    // the room closes: one message and one button
    rooms[0]._emit('close', 'kicked');
    frames(10);
    assert.ok(ctx.__info.texts.includes('You were removed') && ctx.__info.texts.includes('Play'));
    assert.equal(controls[controls.length - 1], null, 'controls off');
    // the button joins again and goes straight back in
    handlers.pointerdown.forEach((f) => f({ clientX: 422, clientY: 195 + 30 }));
    await new Promise((r) => setTimeout(r, 20));
    frames(30);
    assert.equal(rooms.length, 2, 'rejoined');
    assert.ok(ctx.__info.texts.filter((x) => x === "Hide before you're found!").length >= 2, 'in the new room, in the lobby');
    assert.equal(errors.length, 0, errors.join('\n'));
    // late joiner: a room that is already mid-match skips the title at the first tap
  } finally {
    console.error = realError;
    globalThis.setInterval = realSetInterval;
    for (const k of ['window', 'location', 'addEventListener', 'requestAnimationFrame', 'document']) delete globalThis[k];
  }
});

test('a player who opens the game while a match is running skips the title at the first tap and watches', async () => {
  const clock = new FakeClock();
  const ctx = mockCtx();
  const handlers = {};
  const on = (type, fn) => (handlers[type] ??= []).push(fn);
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, addEventListener: on };
  const rafs = [];
  let room = null;
  const ow = {
    ...standaloneOw(),
    now: () => clock.now,
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: true },
    settings: { quality: 'low', reducedMotion: true, scale: 1, pixelRatio: () => 1, on() {} },
    rooms: {
      join: async () => {
        room = createStubRoom({ now: () => clock.now, later: (fn, ms) => clock.later(fn, ms) });
        // somebody else's match is already playing
        room.match = { ...room.match, phase: 'playing', id: 'theirs', participants: ['someone'], seed: 9 };
        room.isHost = false;
        room.host = 'someone';
        return room;
      },
    },
  };
  globalThis.window = { onceworlds: ow, innerWidth: 667, innerHeight: 375, devicePixelRatio: 1 };
  globalThis.location = { search: '' };
  globalThis.addEventListener = on;
  globalThis.requestAnimationFrame = (fn) => rafs.push(fn);
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.document = { getElementById: () => canvas, addEventListener: on, hidden: false, body: { style: {}, dataset: {} }, fonts: { load: async () => {}, ready: Promise.resolve() } };
  let t = 0;
  const frames = (n) => {
    for (let i = 0; i < n; i++) {
      t += 16.7;
      clock.advance(16.7);
      for (const fn of rafs.splice(0)) fn(t);
    }
  };
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await import('../game/main.js?late');
    await new Promise((r) => setTimeout(r, 20));
    frames(20);
    assert.ok(ctx.__info.texts.includes('PLAY'), 'the title first');
    assert.ok(!ctx.__info.texts.includes('SPACE'), 'on a touch device the title shows no key');
    handlers.pointerdown.forEach((f) => f({ clientX: 5, clientY: 5 }));
    frames(30);
    assert.ok(ctx.__info.texts.includes('Watching'), 'they watch');
    assert.equal(errors.length, 0, errors.join('\n'));
  } finally {
    console.error = realError;
    globalThis.setInterval = realSetInterval;
    for (const k of ['window', 'location', 'addEventListener', 'requestAnimationFrame', 'document']) delete globalThis[k];
  }
});
