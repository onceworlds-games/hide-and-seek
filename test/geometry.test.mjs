import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCircle, rayWalls, segmentClear, canSee, visibility, inPolygon, angleDiff, distToRect } from '../game/geometry.js';
import { stepChar, makeChar, separate } from '../game/sim.js';
import { getHouse } from '../game/maps.js';

const walls = [
  [4, 0, 0.4, 10], // a vertical wall at x = 4..4.4
  [0, 9.6, 10, 0.4], // a floor-level wall
];

test('angleDiff wraps the short way round', () => {
  assert.ok(Math.abs(angleDiff(3, -3) - (2 * Math.PI - 6)) < 1e-9);
  assert.ok(Math.abs(angleDiff(0, 1) - 1) < 1e-9);
  assert.ok(Math.abs(angleDiff(0.1, -0.1) + 0.2) < 1e-9);
});

test('a circle is pushed out of a wall and slides along it', () => {
  const p = { x: 3.8, y: 5 };
  assert.ok(resolveCircle(p, 0.35, walls));
  assert.ok(p.x <= 4 - 0.35 + 1e-9, 'pushed to the left of the wall');
  assert.equal(p.y, 5);
  // walking into the wall at an angle keeps the tangential motion
  const c = makeChar(3.5, 2, 0);
  const rects = walls;
  for (let i = 0; i < 120; i++) stepChar(c, 1, 0.5, 1 / 60, 5, rects, 40, 40);
  assert.ok(c.x <= 4 - 0.35 + 1e-6, 'never through the wall');
  assert.ok(c.y > 4, 'slid down along it');
});

test('a character inside a rectangle is put outside it, not stuck', () => {
  const p = { x: 4.2, y: 5 };
  resolveCircle(p, 0.35, walls);
  assert.ok(distToRect(p.x, p.y, walls[0]) >= 0.35 - 1e-9);
});

test('nothing walks through any wall of either house', () => {
  for (const id of ['cozy', 'mansion']) {
    const h = getHouse(id);
    for (const wall of h.walls) {
      // Try to cross each wall from both sides at full speed, in 8 directions.
      const cx = wall[0] + wall[2] / 2;
      const cy = wall[1] + wall[3] / 2;
      const horizontal = wall[2] > wall[3];
      for (const side of [-1, 1]) {
        const c = makeChar(horizontal ? cx : cx + side * 1, horizontal ? cy + side * 1 : cy, 0);
        // Only start in the open, inside the house.
        if (c.x < 0.7 || c.y < 0.7 || c.x > h.w - 0.7 || c.y > h.h - 0.7) continue;
        if (h.blockers.some((q) => distToRect(c.x, c.y, q) < 0.4)) continue;
        for (let i = 0; i < 90; i++) {
          stepChar(c, horizontal ? 0.2 : -side, horizontal ? -side : 0.2, 1 / 60, 5.4, h.blockers, h.w, h.h);
          for (const q of h.blockers) assert.ok(distToRect(c.x, c.y, q) >= 0.35 - 0.02, `${id}: clipped into a wall at ${c.x.toFixed(2)},${c.y.toFixed(2)}`);
        }
      }
    }
  }
});

test('characters are kept inside the house even if pushed out', () => {
  const h = getHouse('cozy');
  const c = makeChar(0.1, 0.1, 0);
  stepChar(c, -1, -1, 1 / 60, 5, h.blockers, h.w, h.h);
  assert.ok(c.x >= 0.6 && c.y >= 0.6);
});

test('soft push separates overlapping characters', () => {
  const a = { x: 5, y: 5 };
  const b = { x: 5.2, y: 5 };
  for (let i = 0; i < 10; i++) separate(a, [b, a], 0);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 0.69);
  const same = { x: 3, y: 3 };
  separate(same, [{ x: 3, y: 3 }], 1);
  assert.ok(Number.isFinite(same.x) && (same.x !== 3 || same.y !== 3));
});

test('rays and lines of sight stop at walls', () => {
  assert.equal(rayWalls(0, 5, 1, 0, walls, 100), 4);
  assert.equal(rayWalls(0, 5, -1, 0, walls, 100), 100);
  assert.ok(!segmentClear(0, 5, 8, 5, walls));
  assert.ok(segmentClear(0, 5, 3.9, 5, walls));
  // along the face of a wall without entering it
  assert.ok(segmentClear(3.9, 0, 3.9, 9, walls));
});

const cone = { ang: (70 * Math.PI) / 180, range: 7, near: 1.5 };

test('the flashlight sees inside its cone and range, and the little circle all round', () => {
  const none = [];
  assert.ok(canSee(0, 0, 0, cone, 5, 0, none));
  assert.ok(canSee(0, 0, 0, cone, 6.9, 0, none));
  assert.ok(!canSee(0, 0, 0, cone, 7.2, 0, none), 'beyond range');
  assert.ok(!canSee(0, 0, 0, cone, 0, 5, none), 'off to the side');
  assert.ok(canSee(0, 0, 0, cone, 5, 5 * Math.tan((30 * Math.PI) / 180), none), '30 degrees off axis is inside 35');
  assert.ok(!canSee(0, 0, 0, cone, 5, 5 * Math.tan((40 * Math.PI) / 180), none), '40 degrees is outside');
  assert.ok(canSee(0, 0, 0, cone, -1.4, 0, none), 'behind but inside the near circle');
  assert.ok(!canSee(0, 0, 0, cone, -1.6, 0, none));
});

test('walls block the flashlight and the near circle', () => {
  const w = [[2, -3, 0.4, 6]];
  assert.ok(!canSee(0, 0, 0, cone, 4, 0, w));
  assert.ok(!canSee(0, 0, 0, cone, 2.8, 0, w), 'just behind the wall');
  assert.ok(canSee(0, 0, 0, cone, 1.5, 0, w));
  const near = [[1.0, -3, 0.4, 6]];
  assert.ok(!canSee(0, 0, 0, cone, 1.4 + 0.2, 0, near), 'even inside the near circle');
});

test('the visibility polygon covers what canSee says is visible and nothing behind walls', () => {
  const w = [[3, -2, 0.4, 4]]; // a wall across the beam at x 3..3.4
  const out = [];
  const n = visibility(0, 0, 0, cone, w, out);
  assert.ok(n > 20);
  assert.ok(out.every(Number.isFinite));
  assert.ok(inPolygon(out, 2, 0), 'in front of the wall is lit');
  assert.ok(!inPolygon(out, 5, 0), 'behind the wall is dark');
  assert.ok(inPolygon(out, -1, 0), 'the near circle is lit behind the holder');
  assert.ok(!inPolygon(out, -2.5, 0));
  // sample a grid: whatever canSee accepts well inside the cone is in the polygon
  let checked = 0;
  for (let x = -3; x <= 8; x += 0.5) {
    for (let y = -4; y <= 4; y += 0.5) {
      if (canSee(0, 0, 0, cone, x, y, w)) {
        // allow a polygon edge approximation of one ray step
        const d = Math.hypot(x, y);
        const off = Math.abs(Math.atan2(y, x));
        if (d < 6.5 && d > 0.4 && Math.abs(d - 1.5) > 0.25 && Math.abs(off - cone.ang / 2) > 0.12 && (x < 2.7 || x > 3.7)) {
          checked++;
          assert.ok(inPolygon(out, x, y), `canSee but not lit at ${x},${y}`);
        }
      }
    }
  }
  assert.ok(checked > 8);
  const behind = canSee(0, 0, 0, cone, 5, 0, w);
  assert.equal(behind, false);
});

test('the polygon works with the cone pointing any way and in a real room', () => {
  const h = getHouse('cozy');
  const out = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 - Math.PI;
    visibility(16, 14, a, cone, h.walls, out);
    assert.ok(out.length >= 100 && out.every(Number.isFinite));
    for (let i = 0; i < out.length; i += 2) {
      assert.ok(Math.hypot(out[i] - 16, out[i + 1] - 14) <= 7 + 1e-6, 'never past the range');
    }
  }
});
