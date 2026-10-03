import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../src/net/net.js';
import { createSim, stepSim } from '../src/sim/sim.js';
import { buildCourse } from '../src/sim/courses.js';

const spec = { kind: 'expedition', biome: 0, index: 0, seed: 'e1-1', mutators: [] };
const run = { mid: 'match-1', spec, cfg: {}, owners: ['bot', 'bot', 'bot', 'bot'], pilot: null, ghost: false };

/** Just enough of a room for the net layer: listeners, state, private values, players. */
function fakeRoom(me, host, shared) {
  const listeners = new Map();
  const room = {
    me: { id: me },
    host,
    connected: true,
    get isHost() {
      return room.host === me;
    },
    state: shared.state,
    private: {},
    players: new Map(['A', 'B', 'C'].map((id) => [id, { id, presence: null }])),
    match: { phase: 'playing', id: 'match-1' },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    emit(ev, ...args) {
      for (const fn of listeners.get(ev) ?? []) fn(...args);
    },
    setState(k, v) {
      shared.writes.push(k);
      if (v === null) delete shared.state[k];
      else shared.state[k] = v;
    },
    setPrivate(k, v) {
      if (v === null) delete room.private[k];
      else room.private[k] = v;
      shared.priv[me] = room.private;
    },
    privateOf: (id) => (room.isHost || id === me ? shared.priv[id] ?? {} : {}),
    send() {},
    setPresence() {},
  };
  return room;
}

function walkedSim(seconds) {
  const sim = createSim({ course: buildCourse(spec), owners: ['bot', 'bot', 'bot', 'bot'], botSkill: 2, seed: 'net', autonomous: true });
  for (let i = 0; i < seconds * 60; i++) stepSim(sim);
  return sim;
}

test('the checkpoint lives in the host\'s private values, never in shared state, and a new host adopts it', () => {
  const shared = { state: { run }, priv: {}, writes: [] };
  const roomA = fakeRoom('A', 'A', shared);
  const roomB = fakeRoom('B', 'A', shared);
  const netA = createNet(roomA, {});
  const simA = walkedSim(6);
  netA.hostTick(simA, [], 10000);
  assert.ok(roomA.private.snap, 'the host wrote its checkpoint');
  assert.equal(roomA.private.snap.mid, 'match-1');
  assert.ok(!('snap' in shared.state) && !shared.writes.includes('snap'), 'nothing churns shared room state');
  assert.ok(JSON.stringify(roomA.private.snap).length < 4096, 'a private value holds it');
  // a third player writes a fake checkpoint far down the course: the next host ignores it
  shared.priv.C = { snap: { mid: 'match-1', s: { ...roomA.private.snap.s, t: 9999, b: [90, 2, 0, 0, 0, 0, 0, 0, 0, 0] } } };
  let promoted = null;
  const netB = createNet(roomB, { onHost: (isHost) => (promoted = isHost) });
  const simB = createSim({ course: buildCourse(spec), owners: ['bot', 'bot', 'bot', 'bot'], botSkill: 2, seed: 'net' });
  roomA.host = roomB.host = 'B';
  roomB.emit('host', 'B');
  assert.equal(promoted, true);
  assert.equal(netB.adoptCheckpoint(simB, 'match-1'), true);
  assert.ok(Math.abs(simB.w.x - simA.w.x) < 0.01, `walker adopted at ${simB.w.x} (host had ${simA.w.x})`);
  assert.ok(simB.w.x < 80, 'not the forged one');
  for (let i = 0; i < 4; i++) assert.equal(simB.w.legs[i].st, simA.w.legs[i].st);
  // a checkpoint from another match is never adopted
  const simC = createSim({ course: buildCourse(spec), seed: 'net' });
  assert.equal(netB.adoptCheckpoint(simC, 'match-2'), false);
  // the match ends: the host's checkpoint is cleared
  netA.clearCheckpoint();
  assert.equal(roomA.private.snap, undefined);
  netA.dispose();
  netB.dispose();
});

test('a reloaded host with nobody else adopts its own checkpoint', () => {
  const shared = { state: { run }, priv: {}, writes: [] };
  const roomA = fakeRoom('A', 'A', shared);
  const netA = createNet(roomA, {});
  const simA = walkedSim(4);
  netA.hostTick(simA, [], 5000);
  // the page reloads: a new net layer, the room hands back the private values
  const roomA2 = fakeRoom('A', 'A', shared);
  roomA2.private = shared.priv.A;
  const netA2 = createNet(roomA2, {});
  const sim2 = createSim({ course: buildCourse(spec), seed: 'net' });
  assert.equal(netA2.adoptCheckpoint(sim2, 'match-1'), true);
  assert.ok(Math.abs(sim2.w.x - simA.w.x) < 0.01);
  netA.dispose();
  netA2.dispose();
});
