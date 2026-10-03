import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, EXPEDITIONS, crossable, pathZ, dailySpec, REPAIR_STRIDE } from '../src/sim/courses.js';
import { staticHeight, staticSurface } from '../src/sim/terrain.js';
import { S } from '../src/sim/constants.js';

const allFinite = (arr) => {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
};

/** Every point of the path has crossable ground within one stride ahead. */
function walkable(course) {
  let x = course.startX;
  while (x < course.goalX) {
    const pz = pathZ(course, x);
    let found = -1;
    for (let d = 0.5; d <= REPAIR_STRIDE && found < 0; d += 0.5) for (const dz of [0, -1.5, 1.5, -3, 3]) if (crossable(course, x + d, pz + dz)) found = d;
    if (found < 0) return false;
    x += found;
  }
  return true;
}

test('all 24 expeditions build, are walkable and need no repair', () => {
  for (let i = 0; i < EXPEDITIONS.length; i++) {
    const c = buildCourse({ kind: 'expedition', biome: Math.floor(i / 4), index: i % 4 });
    assert.ok(c.length > 80 && c.length < 400, `${c.id} length ${c.length}`);
    assert.ok(allFinite(c.terrain.h), `${c.id} heights finite`);
    assert.equal(c.repaired, 0, `${c.id} needed repairs at x=${c.repairs} (segments ${c.segments.map((s) => `${s.tpl}@${s.x0}`).join(' ')})`);
    assert.ok(walkable(c), `${c.id} walkable`);
    assert.ok(c.respawns.length >= 3, `${c.id} respawns`);
    assert.ok(c.checkpoints.length >= 1, `${c.id} checkpoints`);
    assert.ok(c.goalX > c.startX + 50);
    // the start is plain ground for every foot
    for (const dz of [-1.5, 1.5]) for (const dx of [-2.2, 2.2]) assert.equal(staticSurface(c.terrain, c.startX + dx, dz), S.CLAY);
  }
});

test('a thousand endless and daily seeds build and are walkable', () => {
  for (let i = 0; i < 500; i++) {
    const e = buildCourse({ kind: 'endless', seed: `endless-${i}` });
    assert.ok(allFinite(e.terrain.h));
    assert.ok(walkable(e), `endless-${i} walkable (repaired ${e.repaired})`);
    const d = buildCourse({ kind: 'daily', seed: `daily-${i}`, biome: i % 6, mutators: ['gusty'] });
    assert.ok(allFinite(d.terrain.h));
    assert.ok(walkable(d), `daily-${i} walkable`);
    assert.ok(d.respawns.length >= 2);
  }
});

test('the same seed builds the same course', () => {
  const a = buildCourse({ kind: 'daily', seed: 'x', biome: 2 });
  const b = buildCourse({ kind: 'daily', seed: 'x', biome: 2 });
  assert.deepEqual(Array.from(a.terrain.h), Array.from(b.terrain.h));
  assert.deepEqual(Array.from(a.terrain.s), Array.from(b.terrain.s));
  assert.equal(a.vents.length, b.vents.length);
  assert.notDeepEqual(Array.from(buildCourse({ kind: 'daily', seed: 'y', biome: 2 }).terrain.s), Array.from(a.terrain.s));
});

test('height queries beside a pit stay on the ledge; outside the strip is a drop', () => {
  const c = buildCourse({ kind: 'expedition', biome: 3, index: 0 }); // Loose Footing has a gap
  const t = c.terrain;
  let gapX = -1;
  for (let x = 10; x < c.length; x += 0.5) {
    if (staticSurface(t, x, 0) === S.VOID) {
      gapX = x;
      break;
    }
  }
  assert.ok(gapX > 0, 'found the gap');
  assert.ok(staticHeight(t, gapX - 0.6, 0) > -1, 'the ledge keeps its height');
  assert.ok(staticHeight(t, gapX + 0.2, 0) < -3, 'the pit is deep');
  assert.equal(staticSurface(t, 5, 40), S.VOID);
  assert.ok(staticHeight(t, 5, 40) < -3);
  assert.ok(staticHeight(t, -5, 0) < -3);
});

test('the daily spec is stable within a day and uses a known mutator', () => {
  const a = dailySpec(1_800_000_000_000);
  const b = dailySpec(1_800_000_000_000 + 3600_000);
  assert.equal(a.seed, b.seed);
  assert.equal(a.mutators.length, 1);
  assert.ok(a.biome >= 0 && a.biome < 6);
});
