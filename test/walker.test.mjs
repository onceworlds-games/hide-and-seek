import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, setHumanInput, snapshot, restore, drainEvents, requestReset } from '../src/sim/sim.js';
import { buildCourse } from '../src/sim/courses.js';
import { ST } from '../src/sim/walker.js';
import { fillRect, fillDisc } from '../src/sim/terrain.js';
import { S, DT, TIP_LIMIT } from '../src/sim/constants.js';
import { makeRng } from '../src/sim/rng.js';

const HUMANS = ['h0', 'h1', 'h2', 'h3'];
const flat = () => buildCourse({ kind: 'expedition', biome: 0, index: 0 });

function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn) fn(i * DT, sim);
    stepSim(sim);
  }
}

const finiteWalker = (w) => {
  const vals = [w.x, w.y, w.z, w.yaw, w.pitch, w.roll, w.vx, w.vy, w.vz, w.tip, w.cargo.aF, w.cargo.aR, w.cargo.cond, w.groove];
  for (const l of w.legs) vals.push(l.fx, l.fy, l.fz, l.tx, l.tz, l.sink, l.stun);
  return vals.every(Number.isFinite);
};

test('standing still is stable', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 5);
  const w = sim.w;
  assert.ok(finiteWalker(w));
  assert.equal(w.tip, 0);
  assert.equal(w.tumbles, 0);
  assert.equal(w.planted, 4);
  assert.ok(Math.abs(w.y - 2.1) < 0.1, `height ${w.y}`);
  assert.ok(w.margin > 0.5);
});

test('four humans pushing forward move the walker; lifting all legs sits it on its belly, no NaN', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 1, lift: false, brace: false });
  run(sim, 2);
  assert.ok(sim.w.x > 4.5, 'moved forward');
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: true, brace: false });
  run(sim, 3);
  const w = sim.w;
  assert.ok(finiteWalker(w));
  assert.equal(w.planted, 0);
  assert.ok(w.y < 1.3, `belly ${w.y}`);
  assert.equal(w.tumbles, 0);
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 3);
  assert.equal(w.planted, 4);
  assert.ok(w.y > 1.8, 'stood back up');
});

test('one stick alone turns the machine through the moment arm', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  setHumanInput(sim, 0, { x: 0, y: 1, lift: false, brace: false });
  setHumanInput(sim, 2, { x: 0, y: 1, lift: false, brace: false });
  for (const i of [1, 3]) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 1.5);
  assert.ok(sim.w.yaw > 0.05, `left legs pushing turn right: yaw ${sim.w.yaw}`);
});

test('a foot planted on lava burns and the leg is stunned, then returns', () => {
  const course = flat();
  const sim = createSim({ course, owners: HUMANS });
  const w = sim.w;
  // leg 0 (front left): its hip is at x+2.2, z-1.5. Lava 1.4 m ahead of the planted foot.
  fillDisc(course.terrain, w.x + 2.2 + 1.4, -1.5, 1.0, S.LAVA, -0.4);
  setHumanInput(sim, 0, { x: 0, y: 1.4 / 2.2, lift: true, brace: false });
  for (const i of [1, 2, 3]) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 0.5);
  assert.equal(w.legs[0].st, ST.SWING);
  assert.equal(w.legs[0].valid, false, 'the target reads as invalid');
  setHumanInput(sim, 0, { x: 0, y: 1.4 / 2.2, lift: false, brace: false });
  run(sim, 0.1);
  const ev = drainEvents(sim).map((e) => e.type);
  assert.ok(ev.includes('burn'), `events ${ev}`);
  assert.equal(w.legs[0].st, ST.STUN);
  run(sim, 2.2);
  assert.notEqual(w.legs[0].st, ST.STUN);
  assert.ok(finiteWalker(w));
});

test('mud sinks a planted foot until it pops free', () => {
  const course = flat();
  fillRect(course.terrain, 0, 20, -12, 12, S.MUD, -0.15);
  const sim = createSim({ course, owners: HUMANS });
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 1);
  assert.ok(sim.w.legs[0].sink > 0.1);
  let popped = false;
  run(sim, 5, () => {
    if (drainEvents(sim).some((e) => e.type === 'pop')) popped = true;
  });
  assert.ok(popped, 'a foot popped free');
  assert.ok(finiteWalker(sim.w));
});

test('an overstretched release snaps in', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  sim.w.cfg.stickRange = 4; // let the target go beyond reach
  setHumanInput(sim, 0, { x: 0, y: 1, lift: true, brace: false });
  for (const i of [1, 2, 3]) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 0.6);
  setHumanInput(sim, 0, { x: 0, y: 1, lift: false, brace: false });
  run(sim, 0.1);
  const ev = drainEvents(sim).map((e) => e.type);
  assert.ok(ev.includes('snap'), `events ${ev}`);
  const l = sim.w.legs[0];
  assert.equal(l.st, ST.STANCE);
  const hipDist = Math.hypot(l.fx - (sim.w.x + 2.2), l.fz - (sim.w.z - 1.5), l.fy - sim.w.y);
  assert.ok(hipDist <= 3.45, `within reach: ${hipDist}`);
});

test('three legs lifted with the body unsupported tumbles, then respawns at a safe spot', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  const w = sim.w;
  for (const i of [0, 1, 2]) setHumanInput(sim, i, { x: 0, y: 1, lift: true, brace: false });
  setHumanInput(sim, 3, { x: 0, y: 0, lift: false, brace: false });
  let tumbled = false;
  run(sim, 4, () => {
    if (tumbled) return;
    if (drainEvents(sim).some((e) => e.type === 'tumble')) {
      tumbled = true;
      for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
    }
  });
  assert.ok(tumbled, 'tumbled');
  assert.ok(w.tip <= TIP_LIMIT + 1);
  run(sim, 4);
  assert.equal(w.tumbling, 0);
  assert.equal(w.tumbles, 1);
  assert.equal(w.planted, 4);
  assert.ok(finiteWalker(w));
});

test('a crumbling slab drops under a foot that stays on it, and heals when the foot leaves', () => {
  const course = buildCourse({ kind: 'expedition', biome: 3, index: 0 }); // Loose Footing: crumble bridge
  const seg = course.segments.find((s) => s.tpl === 'crumble');
  const sim = createSim({ course, owners: HUMANS });
  const w = sim.w;
  // Put the walker on the first slab with every foot on it.
  const x0 = seg.x0 + 4.5;
  w.x = x0;
  for (let i = 0; i < 4; i++) {
    w.legs[i].fx = x0 + (i < 2 ? 1 : -1);
    w.legs[i].fz = i % 2 ? 1.2 : -1.2;
  }
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  // Replant one foot: its slab timer starts.
  setHumanInput(sim, 0, { x: 0, y: 0, lift: true, brace: false });
  run(sim, 0.4);
  setHumanInput(sim, 0, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 0.1);
  assert.ok(drainEvents(sim).some((e) => e.type === 'crack'));
  const slab = w.legs[0].slab;
  assert.ok(slab >= 0);
  // Lift it again before the drop: the slab heals.
  run(sim, 1);
  setHumanInput(sim, 0, { x: 0, y: 0, lift: true, brace: false });
  run(sim, 0.2);
  assert.equal(sim.dyn.crumble[slab], -1, 'healed');
  setHumanInput(sim, 0, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 0.1);
  let fell = false;
  run(sim, 3.5, () => {
    if (drainEvents(sim).some((e) => e.type === 'fall')) fell = true;
  });
  assert.ok(fell, 'the slab gave way under a foot that stayed');
  assert.ok(sim.dyn.gone[slab] >= 0, 'the slab is gone');
  assert.ok(finiteWalker(w));
});

test('a moving platform carries planted feet', () => {
  const course = buildCourse({ kind: 'expedition', biome: 2, index: 1 }); // Steam Shift: platforms
  const p = course.platforms[0];
  const sim = createSim({ course, owners: HUMANS });
  const w = sim.w;
  w.x = p.x;
  w.z = p.z;
  for (let i = 0; i < 4; i++) {
    w.legs[i].fx = p.x + (i < 2 ? 1 : -1);
    w.legs[i].fz = p.z + (i % 2 ? 1 : -1);
  }
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 0.1);
  assert.equal(w.legs[0].platform, p.id);
  const z0 = w.legs[0].fz;
  run(sim, 1.5);
  assert.notEqual(Math.round(z0 * 100), Math.round(w.legs[0].fz * 100), 'the foot moved with the platform');
  assert.equal(w.tumbles, 0);
});

test('brace has a cooldown and doubles grip', () => {
  const course = flat();
  fillRect(course.terrain, 0, 30, -12, 12, S.ICE, 0);
  const sim = createSim({ course, owners: HUMANS });
  for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: 0, y: 0, lift: false, brace: true });
  run(sim, 0.2);
  assert.ok(sim.w.legs[0].brace > 0.5);
  assert.ok(sim.w.legs[0].grip > 0.4, `braced ice grip ${sim.w.legs[0].grip}`);
  run(sim, 1.2);
  assert.ok(sim.w.legs[0].brace <= 0);
  assert.ok(sim.w.legs[0].braceCd > 0, 'cooling down');
  assert.ok(sim.w.legs[0].grip < 0.3, `plain ice grip ${sim.w.legs[0].grip}`);
});

test('reset stance re-plants every foot under its hip', () => {
  const sim = createSim({ course: flat(), owners: HUMANS });
  for (let i = 0; i < 4; i++) sim.w.legs[i].fx -= 1.5;
  assert.ok(requestReset(sim));
  assert.ok(!requestReset(sim), 'cooldown');
  for (const l of sim.w.legs) assert.ok(Math.abs(l.fx - (sim.w.x + (l.i < 2 ? 2.2 : -2.2))) < 0.01);
});

test('fuzz: random inputs on random courses for 40k ticks never break the numbers', () => {
  const rng = makeRng('fuzz');
  for (let round = 0; round < 6; round++) {
    const spec = round % 2 ? { kind: 'daily', seed: `fz${round}`, biome: round % 6, mutators: [['slippery', 'gusty', 'tiny', 'three', 'giant', 'swap'][round]] } : { kind: 'expedition', biome: round % 6, index: 3 };
    const course = buildCourse(spec);
    const sim = createSim({ course, owners: round % 3 === 0 ? HUMANS : ['h0', 'bot', 'h2', 'bot'], botSkill: round % 3 });
    const w = sim.w;
    for (let t = 0; t < 7000; t++) {
      if (t % 7 === 0) for (let i = 0; i < 4; i++) setHumanInput(sim, i, { x: rng.range(-1.5, 1.5), y: rng.range(-1.5, 1.5), lift: rng.chance(0.3), brace: rng.chance(0.1) });
      if (t % 97 === 0) setHumanInput(sim, 1, { x: NaN, y: Infinity, lift: 'yes', brace: 1 });
      stepSim(sim);
      assert.ok(finiteWalker(w), `round ${round} tick ${t}`);
      assert.ok(w.x >= 0 && w.x <= course.length && Math.abs(w.z) <= 12, `in the strip (${w.x}, ${w.z})`);
      assert.ok(w.tip <= TIP_LIMIT + 1.5);
      assert.ok(w.cargo.cond >= 0 && w.cargo.cond <= 1);
      assert.ok(w.groove >= 0 && w.groove <= 100);
      for (const l of w.legs) assert.ok(l.fy > -12.5 && l.fy < 41 && Math.abs(l.fz) <= 12);
      if (t % 500 === 0) drainEvents(sim);
    }
  }
});

test('a snapshot restored into a fresh sim continues identically', () => {
  const course = buildCourse({ kind: 'expedition', biome: 1, index: 2 });
  const a = createSim({ course, owners: ['h0', 'bot', 'bot', 'bot'], botSkill: 2, seed: 's' });
  setHumanInput(a, 0, { x: 0.1, y: 0.9, lift: false, brace: false });
  run(a, 8);
  const snap = JSON.parse(JSON.stringify(snapshot(a)));
  assert.ok(JSON.stringify(snap).length < 4000, 'small');
  const b = createSim({ course, owners: ['h0', 'bot', 'bot', 'bot'], botSkill: 2, seed: 's' });
  assert.ok(restore(b, snap));
  setHumanInput(b, 0, { x: 0.1, y: 0.9, lift: false, brace: false });
  // the bots' memory is not part of a snapshot, so compare the walker alone, right after the restore
  assert.ok(Math.abs(a.w.x - b.w.x) < 1e-3 && Math.abs(a.w.y - b.w.y) < 1e-3);
  assert.deepEqual(a.w.legs.map((l) => l.st), b.w.legs.map((l) => l.st));
  // a lying host: garbage is rejected or clamped
  assert.equal(restore(b, null), false);
  assert.equal(restore(b, { b: 'no' }), false);
  const bad = JSON.parse(JSON.stringify(snap));
  bad.b[0] = NaN;
  bad.b[1] = 1e9;
  bad.legs[2][1] = -50;
  bad.cargo[4] = 7;
  assert.ok(restore(b, bad));
  assert.ok(Number.isFinite(b.w.x) && b.w.y <= 60 && b.w.legs[2].fx >= 0 && b.w.cargo.cond <= 1);
});

test('the same seed and inputs replay exactly', () => {
  const mk = () => createSim({ spec: { kind: 'expedition', biome: 2, index: 2 }, owners: ['bot', 'h1', 'bot', 'bot'], botSkill: 1, seed: 'det' });
  const a = mk();
  const b = mk();
  const rng1 = makeRng(7);
  const rng2 = makeRng(7);
  for (let t = 0; t < 3000; t++) {
    if (t % 11 === 0) {
      setHumanInput(a, 1, { x: rng1.range(-1, 1), y: rng1.range(-1, 1), lift: rng1.chance(0.3), brace: false });
      setHumanInput(b, 1, { x: rng2.range(-1, 1), y: rng2.range(-1, 1), lift: rng2.chance(0.3), brace: false });
    }
    stepSim(a);
    stepSim(b);
  }
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('pilot mode: the stick steers the bots, holding Lift takes the highlighted foot, and pilot mode can end mid-run', () => {
  const sim = createSim({ course: flat(), owners: ['bot', 'bot', 'bot', 'bot'], pilot: 'me', botSkill: 2, seed: 'pilot' });
  const w = sim.w;
  setHumanInput(sim, 0, { x: 0, y: 1, lift: false, brace: false });
  run(sim, 6);
  assert.ok(w.x > 7, `the bots walked on the pilot's intent: x=${w.x}`);
  const x1 = w.x;
  setHumanInput(sim, 0, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 3);
  assert.ok(w.x - x1 < 1.5, 'no intent, no walking');
  // take the highlighted foot
  setHumanInput(sim, 0, { x: 0, y: 1, lift: true, brace: false });
  run(sim, 0.4);
  assert.equal(sim.taken, true);
  assert.equal(w.legs[sim.pilotLeg].st, ST.SWING, 'the taken foot is up');
  setHumanInput(sim, 0, { x: 0, y: 1, lift: false, brace: false });
  run(sim, 0.5);
  assert.equal(sim.taken, false, 'released: the bots have it back');
  // a second human arrives: pilot mode ends, the former pilot drives leg 1 directly
  sim.pilot = null;
  sim.taken = false;
  sim.owners = ['bot', 'me', 'bot', 'h2'];
  setHumanInput(sim, 1, { x: 0, y: 1, lift: false, brace: false });
  setHumanInput(sim, 3, { x: 0, y: 1, lift: false, brace: false });
  run(sim, 4);
  assert.ok(finiteWalker(w));
  assert.equal(w.tumbles, 0);
});

test('a human leg nobody drives goes to the bots after a while, and comes back on the first touch', () => {
  const sim = createSim({ course: flat(), owners: ['h0', 'bot', 'bot', 'bot'], botSkill: 2, seed: 'idle', autonomous: true });
  setHumanInput(sim, 0, { x: 0, y: 0, lift: false, brace: false });
  run(sim, 3);
  assert.equal(sim.auto[0], false);
  run(sim, 7);
  assert.equal(sim.auto[0], true, 'quiet for ten seconds: autopilot');
  const x0 = sim.w.x;
  run(sim, 6);
  assert.ok(sim.w.x > x0 + 2, `the team kept walking: ${sim.w.x - x0}`);
  setHumanInput(sim, 0, { x: 0, y: 1, lift: false, brace: false });
  stepSim(sim);
  assert.equal(sim.auto[0], false, 'the player is back on the stick');
});
