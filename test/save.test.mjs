import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSave, defaultSave, applyResult, walkerConfig, unlockedCount, BADGE_IDS } from '../src/sim/save.js';
import { scoreRun, fmtTime } from '../src/sim/score.js';
import { buildCourse } from '../src/sim/courses.js';
import { createSim } from '../src/sim/sim.js';

test('loadSave accepts anything', () => {
  for (const raw of [null, undefined, {}, [], 'x', 42, { v: 99, scrap: 'lots' }, { v: 0 }, { scrap: NaN, feet: 'wings', medals: { 'e9-9': 'gold', 'e1-1': 'platinum' }, hints: { 'bad key!': 2 } }]) {
    const s = loadSave(raw);
    assert.equal(s.v, 1);
    assert.equal(typeof s.scrap, 'number');
    assert.equal(s.feet, 'std');
    assert.deepEqual(Object.keys(s.medals).filter((k) => k === 'e9-9'), []);
  }
  const s = loadSave({ scrap: 1e12, feetOwned: ['claws', 'nope'], feet: 'claws', hips: 9, cradle: -2, medals: { 'e1-1': 'gold' }, best: { 'e1-1': 70 }, ghosts: { 'e1-1': { t: 70, f: [1, 2, 3, 4, NaN] }, 'e2-1': { f: [] } } });
  assert.equal(s.scrap, 1e7);
  assert.deepEqual(s.feetOwned, ['claws', 'std']);
  assert.equal(s.feet, 'claws');
  assert.equal(s.hips, 2);
  assert.equal(s.cradle, 0);
  assert.equal(s.medals['e1-1'], 'gold');
  assert.deepEqual(s.ghosts['e1-1'].f, [1, 2, 3, 4]);
  assert.equal(s.ghosts['e2-1'], undefined);
});

test('a run result updates medals, scrap and badges once', () => {
  const save = defaultSave();
  const course = buildCourse({ kind: 'expedition', biome: 0, index: 0 });
  const sim = createSim({ course });
  const w = sim.w;
  w.finished = true;
  w.finishT = 50;
  w.t = 50;
  w.maxX = course.goalX;
  w.cargo.cond = 1;
  const r = scoreRun(course, w);
  assert.equal(r.medal, 'gold');
  assert.ok(r.scrap > 40);
  const earned = applyResult(save, course, r, { humans: 1, burns: 0, mudPlants: 20 });
  assert.ok(earned.includes('first-step') && earned.includes('solo-stride') && earned.includes('nothing-spilled') && earned.includes('mud-lover'));
  assert.equal(save.medals['e1-1'], 'gold');
  assert.equal(unlockedCount(save), 2);
  const again = applyResult(save, course, r, { humans: 1, burns: 0, mudPlants: 20 });
  assert.deepEqual(again, []);
  for (const id of save.badges) assert.ok(BADGE_IDS.includes(id));
  // a worse medal never replaces a better one
  w.finishT = 400;
  w.t = 400;
  applyResult(save, course, scoreRun(course, w), { humans: 2, burns: 1, mudPlants: 0 });
  assert.equal(save.medals['e1-1'], 'gold');
});

test('scores reward time and cargo; endless scores distance', () => {
  const course = buildCourse({ kind: 'expedition', biome: 0, index: 1 });
  const sim = createSim({ course });
  const w = sim.w;
  w.finished = true;
  w.maxX = course.goalX;
  w.finishT = 60;
  w.t = 60;
  const fast = scoreRun(course, w).score;
  w.finishT = 160;
  w.t = 160;
  const slow = scoreRun(course, w).score;
  assert.ok(fast > slow);
  w.cargo.cond = 0.2;
  assert.ok(scoreRun(course, w).score < slow);
  assert.equal(scoreRun(course, w).medal, 'bronze');
  const e = buildCourse({ kind: 'endless', seed: 'e' });
  const es = createSim({ course: e });
  es.w.maxX = 321.6;
  assert.equal(scoreRun(e, es.w).score, 322);
  assert.equal(fmtTime(75.26), '1:15.3');
  assert.equal(fmtTime(NaN), '0:00.0');
});

test('walker config follows the workshop and mutators', () => {
  const s = defaultSave();
  s.hips = 2;
  s.chassis = 'heavy';
  s.cradle = 3;
  const c = walkerConfig(s, ['claws', 'bogus', null, 'pads'], ['tiny', 'swap', 'three']);
  assert.ok(Math.abs(c.reach - 3.4) < 1e-9);
  assert.ok(Math.abs(c.stickRange - 2.2) < 1e-9);
  assert.deepEqual(c.feet, ['claws', 'std', 'std', 'pads']);
  assert.equal(c.missing, 3);
  assert.equal(c.swap, true);
  assert.ok(c.tipMult < 1 && c.cargoDamp > 3);
});
