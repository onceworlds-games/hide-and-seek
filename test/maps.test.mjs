import test from 'node:test';
import assert from 'node:assert/strict';
import { getHouse, HOUSE_IDS, roomAt } from '../game/maps.js';
import { navFor, findPath, reachable, isReached, pointClear, walkable } from '../game/nav.js';
import { distToRect } from '../game/geometry.js';
import { makeChar, walk } from '../game/sim.js';
import { walking } from '../game/bots.js';
import { mulberry32 } from '../game/rules.js';

const SPOTS = { cozy: 14, mansion: 22 };
const ROOMS = { cozy: 6, mansion: 9 };

test('both houses have the right size, rooms and hiding spots', () => {
  assert.deepEqual([getHouse('cozy').w, getHouse('cozy').h], [32, 20]);
  assert.deepEqual([getHouse('mansion').w, getHouse('mansion').h], [44, 28]);
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    assert.equal(h.spots.length, SPOTS[id], `${id} spots`);
    assert.equal(h.rooms.length, ROOMS[id], `${id} rooms`);
    assert.equal(getHouse(id), h, 'built once');
    h.spots.forEach((s, i) => assert.equal(s.i, i));
  }
  assert.equal(getHouse('nonsense').id, 'cozy');
});

test('rooms tile the house exactly', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    let area = 0;
    for (const r of h.rooms) area += r.w * r.h;
    assert.equal(area, h.w * h.h);
    for (let x = 0.5; x < h.w; x += 1) for (let y = 0.5; y < h.h; y += 1) assert.ok(roomAt(h, x, y), `${id}: ${x},${y} is in a room`);
  }
});

test('furniture stays in its room and every spot has a free place to step out', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    for (const s of h.spots) {
      assert.ok(pointClear(nav, s.ax, s.ay, 0.5), `${id}: spot ${s.i} ${s.kind} in ${s.room} has no free access point`);
      assert.equal(roomAt(h, s.ax, s.ay).id, s.room, `${id}: spot ${s.i} steps out into another room`);
      assert.ok(s.cx > s.x && s.cx < s.x + s.w);
    }
  }
});

test('no narrow slits between furniture and walls where a character could wedge', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const list = h.blockers;
    const slits = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const gapX = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
        const gapY = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
        // facing each other with a gap: they overlap along the other axis and are apart on this one
        const overlapY = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
        const overlapX = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
        const between = (r) => list.some((c, k) => k !== i && k !== j && c[0] < r[0] + r[2] - 0.01 && c[0] + c[2] > r[0] + 0.01 && c[1] < r[1] + r[3] - 0.01 && c[1] + c[3] > r[1] + 0.01);
        const gx0 = Math.min(a[0] + a[2], b[0] + b[2]);
        const gy0 = Math.max(a[1], b[1]);
        const gy1 = Math.min(a[1] + a[3], b[1] + b[3]);
        if (gapX > 0.3 && gapX < 0.75 && overlapY > 0.3 && !between([gx0, gy0, gapX, gy1 - gy0])) slits.push(`${id}: a ${gapX.toFixed(2)} slit between ${a.map((n) => n.toFixed(1))} and ${b.map((n) => n.toFixed(1))}`);
        const gy0b = Math.min(a[1] + a[3], b[1] + b[3]);
        const gx0b = Math.max(a[0], b[0]);
        const gx1b = Math.min(a[0] + a[2], b[0] + b[2]);
        if (gapY > 0.3 && gapY < 0.75 && overlapX > 0.3 && !between([gx0b, gy0b, gx1b - gx0b, gapY])) slits.push(`${id}: a ${gapY.toFixed(2)} slit between ${a.map((n) => n.toFixed(1))} and ${b.map((n) => n.toFixed(1))}`);
      }
    }
    assert.deepEqual(slits, []);
  }
});

test('doors are open: both sides of every gap are walkable and the gap itself is free', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    for (const d of h.doors) {
      const mx = d.o === 'h' ? d.at + d.len / 2 : d.c;
      const my = d.o === 'h' ? d.c : d.at + d.len / 2;
      assert.ok(pointClear(nav, mx, my, 0.5), `${id}: door at ${mx},${my} is blocked`);
      const ox = d.o === 'h' ? 0 : 1.2;
      const oy = d.o === 'h' ? 1.2 : 0;
      assert.ok(pointClear(nav, mx - ox, my - oy, 0.4), `${id}: nothing in front of the door at ${mx},${my}`);
      assert.ok(pointClear(nav, mx + ox, my + oy, 0.4), `${id}: nothing behind the door at ${mx},${my}`);
      assert.ok(walkable(nav, mx - ox, my - oy, mx + ox, my + oy), `${id}: cannot walk through the door at ${mx},${my}`);
    }
  }
});

test('starts and the spawn are free and everything is reachable from the middle of the house', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    assert.ok(h.hiderStarts.length >= 10);
    for (const p of [...h.hiderStarts, ...h.seekerStarts, h.spawn]) assert.ok(pointClear(nav, p.x, p.y, 0.5), `${id}: start ${p.x},${p.y} is not free`);
    const seen = reachable(nav, h.spawn.x, h.spawn.y);
    for (const r of h.rooms) assert.ok(isReached(nav, seen, r.ax, r.ay), `${id}: ${r.id} unreachable`);
    // every free cell is in the one connected area: no pockets a bot could be dropped into
    for (let i = 0; i < nav.blocked.length; i++) assert.ok(nav.blocked[i] || seen[i], `${id}: a free pocket at cell ${i}`);
  }
});

/** Walks the bots' own way from a to b with the real movement code. Returns the seconds it took, or Infinity. */
function walkIt(h, nav, a, b, limit = 90) {
  const bot = { x: a.x, y: a.y, vx: 0, vy: 0, a: 0, ix: 0, iy: 0 };
  const ctx = { nav, house: h, rng: mulberry32(1) };
  const ok = walking.setGoal(bot, ctx, b.x, b.y, 'point', {});
  if (!ok) return Infinity;
  let t = 0;
  while (t < limit) {
    bot.ix = 0;
    bot.iy = 0;
    const st = walking.follow(bot, ctx, 1 / 60);
    if (st === 'arrived') return { t, unstuck: bot.unstuck | 0 };
    if (st === 'none') return Infinity;
    walk(bot, bot.ix, bot.iy, 1 / 60, 5, h, [], 0);
    for (const q of h.blockers) assert.ok(distToRect(bot.x, bot.y, q) >= 0.35 - 0.02, `walked into a wall at ${bot.x.toFixed(2)},${bot.y.toFixed(2)}`);
    t += 1 / 60;
  }
  return Infinity;
}

test('bots can walk between every pair of rooms of both houses, with no getting stuck', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    let pairs = 0;
    for (const A of h.rooms) {
      for (const B of h.rooms) {
        if (A === B) continue;
        const r = walkIt(h, nav, { x: A.ax, y: A.ay }, { x: B.ax, y: B.ay });
        assert.ok(r !== Infinity, `${id}: no walk from ${A.id} to ${B.id}`);
        assert.equal(r.unstuck, 0, `${id}: got stuck going ${A.id} to ${B.id}`);
        assert.ok(r.t < 45, `${id}: ${A.id} to ${B.id} took ${r.t.toFixed(1)} s`);
        pairs++;
      }
    }
    assert.equal(pairs, h.rooms.length * (h.rooms.length - 1));
  }
});

test('bots can walk from the middle of the house to every hiding spot and back', () => {
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    for (const s of h.spots) {
      const there = walkIt(h, nav, h.spawn, { x: s.ax, y: s.ay });
      assert.ok(there !== Infinity && there.unstuck === 0, `${id}: spot ${s.i} ${s.kind} in ${s.room} unreachable or stuck`);
      const back = walkIt(h, nav, { x: s.ax, y: s.ay }, h.spawn);
      assert.ok(back !== Infinity && back.unstuck === 0, `${id}: no way back from spot ${s.i}`);
    }
  }
});

test('paths between random points are found and stay clear of walls', () => {
  const rng = mulberry32(7);
  for (const id of HOUSE_IDS) {
    const h = getHouse(id);
    const nav = navFor(h);
    let n = 0;
    while (n < 60) {
      const a = { x: 1 + rng() * (h.w - 2), y: 1 + rng() * (h.h - 2) };
      const b = { x: 1 + rng() * (h.w - 2), y: 1 + rng() * (h.h - 2) };
      if (!pointClear(nav, a.x, a.y, 0.5) || !pointClear(nav, b.x, b.y, 0.5)) continue;
      const path = findPath(nav, a.x, a.y, b.x, b.y);
      assert.ok(path && path.length >= 1, `${id}: no path ${a.x},${a.y} -> ${b.x},${b.y}`);
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - b.x, end.y - b.y) < 0.6);
      n++;
    }
  }
});
