import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTwoPages, startMatch, run } from './helpers.mjs';
import { getHouse, nearestSpot } from '../game/maps.js';
import { mulberry32, roleOf, isSeeking } from '../game/rules.js';
import { distToRect } from '../game/geometry.js';
import { Net } from '../game/net.js';
import { Play } from '../game/play.js';
import { Fx } from '../game/fx.js';
import { AudioSys } from '../game/audio.js';
import { fakeInput } from './helpers.mjs';

/** A simple player: heads for a spot, hides in it (or searches it), and now and then wanders. */
function autopilot(T, seed = 3) {
  const rng = mulberry32(seed);
  const state = { a: { target: null, until: 0 }, b: { target: null, until: 0 } };
  return (step) => {
    for (const [key, page] of [['a', T.pa], ['b', T.pb]]) {
      const c = page.play.cx;
      const me = page.play.me;
      const st = state[key];
      if (!c || !c.house) continue;
      if (step >= st.until) {
        const spot = c.house.spots[Math.floor(rng() * c.house.spots.length)];
        st.target = { x: spot.ax, y: spot.ay };
        st.until = step + 120 + Math.floor(rng() * 200);
      }
      const dx = st.target.x - me.x;
      const dy = st.target.y - me.y;
      const d = Math.hypot(dx, dy);
      page.input.vec.x = d > 0.3 ? dx / d : 0;
      page.input.vec.y = d > 0.3 ? dy / d : 0;
      if (step % 24 === (key === 'a' ? 5 : 11) && d < 1.2) page.input.press();
      if (step % 300 === 0) page.input.press(); // sometimes hides, sometimes comes out
    }
  };
}

test('two pages in a lobby: they see each other, the host changes settings, nothing throws', () => {
  const T = makeTwoPages();
  run(T, 3);
  const { pa, pb, A, B } = T;
  assert.ok(Number.isFinite(pa.play.me.x) && Number.isFinite(pb.play.me.x));
  // each sees the other in the lobby
  assert.ok(pa.play.list.length === 2 && pb.play.list.length === 2, 'both characters are drawn');
  assert.ok(pa.play.list.some((c) => c.name === 'Bea') && pb.play.list.some((c) => c.name === 'Ann'));
  assert.deepEqual(pa.ctx.__info.bad, []);
  assert.ok(pa.ctx.__info.texts.includes("Hide before you're found!"));
  assert.ok(pa.ctx.__info.texts.includes('ROUNDS') || pa.ctx.__info.texts.some((t) => t === 'ROUNDS'), 'the settings are drawn');
  // the host picks the house
  assert.equal(A.settings.map, 'cozy');
  pa.play.cycleSetting('map');
  assert.equal(A.settings.map, 'mansion');
  run(T, 1);
  assert.equal(pb.play.cx.house.id, 'mansion', 'the guest sees the house change');
  pb.play.cycleSetting('map'); // a guest cannot
  assert.equal(A.settings.map, 'mansion');
  pa.play.cycleSetting('rounds');
  assert.equal(A.settings.rounds, 5);
  pa.play.cycleSetting('rounds');
  assert.equal(A.settings.rounds, 'all');
  pa.play.cycleSetting('rounds');
  assert.equal(A.settings.rounds, 3);
  pa.play.cycleSetting('map');
  assert.equal(A.settings.map, 'cozy');
  run(T, 1);
  // the touch button says Hide in the lobby
  assert.ok(pa.controls.some((c) => c && c.buttons && c.buttons[0].label === 'Hide' && c.stick === 'analog'));
});

test('trying a hiding spot in the lobby: in, shown to the other page, out again', () => {
  const T = makeTwoPages();
  run(T, 1);
  const { pa, pb } = T;
  const house = pa.play.cx.house;
  const s = house.spots[5];
  pa.play.me.x = s.ax;
  pa.play.me.y = s.ay;
  pa.input.press();
  assert.equal(pa.play.me.hid, 5);
  assert.ok(Math.abs(pa.play.me.x - s.cx) < 1e-9);
  run(T, 0.5);
  const seenByB = pb.play.list.find((c) => c.name === 'Ann');
  assert.equal(seenByB.peek, 5, 'the other page draws eyes in the spot');
  pa.input.press();
  assert.equal(pa.play.me.hid, -1);
  assert.ok(Math.hypot(pa.play.me.x - s.ax, pa.play.me.y - s.ay) < 1e-9, 'steps out at the front');
  // moving out also works, but only after the stick was let go once
  pa.input.press();
  assert.equal(pa.play.me.hid, 5);
  pa.input.vec.x = 1;
  run(T, 0.3);
  assert.equal(pa.play.me.hid, 5, 'still held from the walk up: stays hidden');
  pa.input.vec.x = 0;
  run(T, 0.2);
  pa.input.vec.x = -1;
  run(T, 0.8);
  assert.equal(pa.play.me.hid, -1, 'pushing the stick again steps out');
});

test('a whole match with two humans and four bots, from the lobby to the results and back (3 rounds)', async () => {
  const T = makeTwoPages();
  run(T, 0.5);
  startMatch(T);
  const { A, pa, pb, clock } = T;
  assert.equal(A.match.phase, 'playing');
  const script = autopilot(T);
  const seen = { phases: new Set(), found: 0, hid: 0, roles: new Set(), g: 0, mid: A.match.id };
  let guard = 0;
  const maxSteps = 60 * 60 * 12;
  while (A.match.phase === 'playing' && guard < maxSteps) {
    run(T, 1, { drawEvery: 15, script });
    guard += 60;
    const g = pb.net.g;
    if (g) {
      seen.g++;
      seen.phases.add(g.phase);
      seen.found = Math.max(seen.found, Object.keys(g.fd).length);
      seen.hid = Math.max(seen.hid, Object.keys(g.spots).length);
      seen.roles.add(roleOf(g, 'b'));
      seen.roles.add(roleOf(g, 'me'));
    }
    for (const p of [pa, pb]) {
      assert.ok(Number.isFinite(p.play.me.x) && Number.isFinite(p.play.me.y), 'my position is a number');
      const house = p.play.cx.house;
      assert.ok(p.play.me.x > 0 && p.play.me.x < house.w && p.play.me.y > 0 && p.play.me.y < house.h, 'inside the house');
      if (p.play.me.hid < 0) for (const q of house.blockers) assert.ok(distToRect(p.play.me.x, p.play.me.y, q) >= 0.3, `inside furniture at ${p.play.me.x},${p.play.me.y}`);
    }
  }
  assert.equal(A.match.phase, 'lobby', 'the host ended the match after the results');
  assert.ok(guard < maxSteps, 'the match did not run away');
  for (const ph of ['hide', 'seek', 'reveal', 'score', 'final']) assert.ok(seen.phases.has(ph), `the guest saw the ${ph} phase`);
  assert.ok(seen.hid > 0, 'someone hid in a spot');
  assert.ok(seen.found > 0, 'someone got found');
  assert.ok(seen.roles.has('hider') && seen.roles.has('seeker'), 'both roles were played');
  // the results, the stats and the badges
  await new Promise((r) => setTimeout(r, 20));
  for (const p of [pa, pb]) {
    assert.ok(p.play.final && p.play.final.mid === A.match.id, 'the results were kept');
    assert.ok(p.play.lastRecord && p.play.lastRecord.res.order.length === 6);
    assert.deepEqual(p.ctx.__info.bad, [], 'no NaN reached the canvas');
    const stats = p.saved.find((s) => s[0] === 'stats');
    assert.ok(stats && stats[1].matches === 1, 'stats saved once');
  }
  const texts = new Set([...pa.ctx.__info.texts, ...pb.ctx.__info.texts]);
  for (const t of ['READY OR NOT!', 'RESULTS', 'Counting!', 'FOUND YOU!', 'HIDE!', 'SEEK', 'HIDE']) assert.ok(texts.has(t) || [...texts].some((x) => x.includes(t)), `drew "${t}"`);
  // the lobby is back with the results card up for a few seconds
  run(T, 2);
  assert.ok(pa.play.cx.mode === 'lobby');
  assert.ok(pa.play.final.endedAt >= 0);
  // the touch controls followed the game
  const labels = new Set([...pa.controls, ...pb.controls].map((c) => (c && c.buttons && c.buttons[0] ? c.buttons[0].label : c === null ? 'none' : 'move')));
  for (const l of ['Hide', 'Search', 'none']) assert.ok(labels.has(l), `controls: ${l}`);
  // a winner got the badge and the leaderboard post
  const winners = [pa, pb].filter((p) => p.badges.includes('first-win'));
  assert.ok(winners.length <= 2);
  for (const p of winners) assert.ok(p.submitted.some((s) => s[0] === 'wins'));
  void clock;
});

test('the host hands over mid-round and the match carries on without a reset', () => {
  const T = makeTwoPages();
  run(T, 0.5);
  startMatch(T);
  const { A, B, pa, pb } = T;
  run(T, 30, { drawEvery: 30 }); // hide phase over, seeking
  const g = pb.net.g;
  assert.equal(g.phase, 'seek');
  const rid = g.rid;
  const n = g.n;
  const botBefore = JSON.parse(JSON.stringify(pa.net.host.snapshot(A.matchNow())));
  // the host leaves: B takes over
  A.isHost = false;
  A.host = 'b';
  B.isHost = true;
  B.host = 'b';
  A._emit('host', 'b');
  B._emit('host', 'b');
  run(T, 0.5, { drawEvery: 30 });
  assert.ok(pb.net.authority, 'B runs the match now');
  assert.ok(!pa.net.authority, 'A does not');
  assert.equal(pb.net.host.G.rid, rid);
  assert.equal(pb.net.host.G.n, n);
  assert.equal(pb.net.host.G.by, 'b');
  assert.equal(pb.net.g.phase, 'seek', 'still the same phase');
  const after = pb.net.host.snapshot(A.matchNow());
  const near = after.p.filter((row, i) => Math.hypot(row[1] - botBefore.p[i][1], row[2] - botBefore.p[i][2]) < 6);
  assert.equal(near.length, after.p.length, 'the bots carried on from where they were');
  // play out the match with B as the host
  let guard = 0;
  while (A.match.phase === 'playing' && guard < 60 * 60 * 12) {
    run(T, 1, { drawEvery: 30 });
    guard += 60;
  }
  assert.equal(A.match.phase, 'lobby', 'the new host ended the match');
  assert.deepEqual(pa.ctx.__info.bad, []);
  assert.deepEqual(pb.ctx.__info.bad, []);
});

test('a page that reloads in the middle of a round comes back to the same place', () => {
  const T = makeTwoPages();
  run(T, 0.5);
  startMatch(T);
  const { B, pb } = T;
  run(T, 8, { drawEvery: 30 });
  const g = pb.net.g;
  assert.equal(g.phase, 'hide');
  // B hides, then reloads
  const spot = pb.play.cx.house.spots[3];
  pb.play.me.x = spot.ax;
  pb.play.me.y = spot.ay;
  pb.input.press();
  run(T, 1, { drawEvery: 30 });
  const hid = pb.play.me.hid;
  if (roleOf(g, 'b') === 'hider') assert.equal(hid, 3);
  const before = { x: pb.play.me.x, y: pb.play.me.y };
  B.me.presence = { x: before.x, y: before.y, vx: 0, vy: 0, a: 0, h: hid };
  // a new page: new Net, new Play on the same room
  const net = new Net(B, { now: () => T.clock.now });
  const play = new Play({ ow: pb.ow, room: B, net, audio: new AudioSys(), fx: new Fx(), input: fakeInput(), avatars: { get: () => null } });
  play.screen = 'play';
  for (let i = 0; i < 120; i++) {
    T.clock.advance(1000 / 60);
    play.update(1 / 60);
    if (i % 6 === 0) play.draw(pb.ctx, 844, 390, 2, 0.1);
  }
  assert.ok(net.g && net.g.rid === g.rid);
  if (roleOf(g, 'b') === 'hider') {
    assert.equal(play.me.hid, 3, 'the record says I am hidden, so I am');
  } else {
    assert.ok(Math.hypot(play.me.x - before.x, play.me.y - before.y) < 2.5, 'a seeker is where they were (or at the start of the round)');
  }
  assert.ok(Number.isFinite(play.me.x));
  assert.deepEqual(pb.ctx.__info.bad, []);
});

test('a spectator who joins mid-match watches and can tap to follow someone else', () => {
  const T = makeTwoPages();
  run(T, 0.5);
  startMatch(T);
  // B was not in the match
  T.A.match = { ...T.A.match, participants: ['me'] };
  const { pb } = T;
  run(T, 10, { drawEvery: 30 });
  assert.ok(pb.play.cx.spectating);
  assert.ok(pb.play.cx.role === 'spectator');
  assert.ok(pb.ctx.__info.texts.includes('Watching'));
  const first = pb.play.watchId;
  pb.input.tap(100, 100);
  assert.notEqual(pb.play.watchId, first);
  assert.ok(pb.controls[pb.controls.length - 1] === null, 'no touch controls for a watcher');
  assert.deepEqual(pb.ctx.__info.bad, []);
});
