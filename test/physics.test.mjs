import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, setHumanInput, drainEvents } from '../src/sim/sim.js';
import { buildCourse } from '../src/sim/courses.js';
import { ST } from '../src/sim/walker.js';
import { fillRect, flooded } from '../src/sim/terrain.js';
import { S, DT } from '../src/sim/constants.js';
import { createHumanTeam, humanInputs } from '../src/sim/humans.js';
import { makeRng } from '../src/sim/rng.js';

const HUMANS = ['h0', 'h1', 'h2', 'h3'];
const flat = () => buildCourse({ kind: 'expedition', biome: 0, index: 0 });
const still = { x: 0, y: 0, lift: false, brace: false };

function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(i * DT, sim) === false) return;
    stepSim(sim);
  }
}

test('however bad the stance, a topple takes over a second: there is time to put a foot down', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  for (const i of [0, 1, 2]) setHumanInput(sim, i, { x: 0, y: 1, lift: true, brace: false });
  setHumanInput(sim, 3, still);
  let at = -1;
  run(sim, 4, (t) => {
    if (drainEvents(sim).some((e) => e.type === 'tumble')) {
      at = t;
      return false;
    }
  });
  assert.ok(at > 1.1, `toppled after ${at.toFixed(2)} s`);
  // the same mistake caught after 0.7 s: no tumble
  const sim2 = createSim({ course: flat(), owners: HUMANS });
  for (const i of [0, 1, 2]) setHumanInput(sim2, i, { x: 0, y: 1, lift: true, brace: false });
  setHumanInput(sim2, 3, still);
  run(sim2, 0.7);
  assert.ok(sim2.w.tip > 3, 'it was going over');
  for (let i = 0; i < 4; i++) setHumanInput(sim2, i, still);
  run(sim2, 2);
  assert.equal(sim2.w.tumbles, 0);
  assert.equal(sim2.w.tip, 0);
});

test('a foot trailing far behind its hip pushes less than one under it', () => {
  const speedWith = (trail) => {
    const course = flat();
    fillRect(course.terrain, 0, 40, -12, 12, S.CLAY, 0);
    const sim = createSim({ course, owners: HUMANS });
    sim.w.x += 12;
    for (const l of sim.w.legs) l.fx += 12 - trail;
    for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 1, lift: false, brace: false });
    run(sim, 0.25);
    return Math.hypot(sim.w.vx, sim.w.vz);
  };
  const under = speedWith(0);
  const behind = speedWith(1.8);
  assert.ok(behind < under * 0.5, `trailing ${behind.toFixed(2)} vs under ${under.toFixed(2)}`);
});

test("a foot's pad holds an edge its centre misses, and only by its own width", () => {
  const plantAt = (x) => {
    const course = flat();
    fillRect(course.terrain, 7.5, 14, -12, 12, S.LAVA, 0); // the ground ends at x = 7.25: lava beyond
    const sim = createSim({ course, owners: HUMANS });
    for (const i of [1, 2, 3]) setHumanInput(sim, i, still);
    const hipX = sim.w.x + 2.2;
    setHumanInput(sim, 0, { x: 0, y: (x - hipX) / 2.2, lift: true, brace: false });
    run(sim, 0.5);
    setHumanInput(sim, 0, { x: 0, y: (x - hipX) / 2.2, lift: false, brace: false });
    run(sim, 0.3);
    return { leg: sim.w.legs[0], events: drainEvents(sim).map((e) => e.type) };
  };
  const edge = plantAt(7.4);
  assert.equal(edge.leg.st, ST.STANCE, `the pad caught the edge (${edge.events})`);
  assert.ok(edge.leg.fx <= 7.25, `and the foot settled onto it (${edge.leg.fx.toFixed(2)})`);
  const off = plantAt(7.75);
  assert.notEqual(off.leg.st, ST.STANCE, 'half a metre out is in the lava');
  assert.ok(off.events.includes('burn'));
});

test('the tide: a beach takes a foot until a wave is 0.9 m over it, a sea stack until 0.3 m', () => {
  const course = buildCourse({ kind: 'expedition', biome: 5, index: 0 });
  assert.ok(course.water, 'Storm Coast has a tide');
  const at = (time) => course.water.base + course.water.amp * Math.sin(time * course.water.speed + course.water.phase);
  const t = 3;
  const level = at(t);
  assert.equal(flooded(course, t, S.STONE, level - 0.2), false);
  assert.equal(flooded(course, t, S.STONE, level - 0.4), true);
  assert.equal(flooded(course, t, S.SHORE, level - 0.4), false);
  assert.equal(flooded(course, t, S.SHORE, level - 1), true);
  assert.equal(flooded(course, t, S.CLAY, level - 3), false);
  assert.equal(flooded(flat(), t, S.STONE, -100), false, 'no sea, no tide');
});

test('simulated players are deterministic, never break the numbers, and a novice team walks First Steps', () => {
  const play = (course, skill, seed, seconds) => {
    const sim = createSim({ course, owners: HUMANS, seed: `p${seed}` });
    const team = createHumanTeam(skill, makeRng(`t${seed}`));
    const out = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, lift: false, brace: false }));
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n && !sim.w.finished && !sim.w.over; i++) {
      humanInputs(team, sim.w, course, sim.dyn, out, DT);
      for (let k = 0; k < 4; k++) setHumanInput(sim, k, out[k]);
      stepSim(sim);
      sim.events.length = 0;
    }
    return sim.w;
  };
  const a = play(flat(), 0, 1, 40);
  const b = play(flat(), 0, 1, 40);
  assert.equal(a.x, b.x);
  assert.equal(a.tumbles, b.tumbles);
  for (let k = 0; k < 6; k++) {
    const course = buildCourse({ kind: 'daily', seed: `fuzz-${k}`, biome: k, mutators: [] });
    const w = play(course, k % 3, k, 50);
    for (const v of [w.x, w.y, w.z, w.yaw, w.vx, w.vz, w.tip, w.cargo.cond]) assert.ok(Number.isFinite(v));
    for (const l of w.legs) assert.ok(Number.isFinite(l.fx + l.fy + l.fz));
  }
  const first = play(flat(), 0, 3, 300);
  assert.ok(first.finished, `a novice team finished First Steps (x ${first.x.toFixed(0)}, ${first.tumbles} tumbles)`);
});
