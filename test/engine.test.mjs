import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, buildRoster, roleOf } from '../game/rules.js';
import * as engine from '../game/engine.js';
import { getHouse } from '../game/maps.js';
import { distToRect } from '../game/geometry.js';

const house = getHouse('cozy');

function newMatch(humans = 2, settings = { rounds: 3, map: 'cozy' }, seed = 11) {
  const roster = buildRoster(Array.from({ length: humans }, (_, i) => ({ id: `h${i + 1}`, name: `Human ${i + 1}` })), seed);
  return engine.createMatch({ mid: 'm1', by: 'h1', roster, settings, seed });
}

/** A context where everyone stands wherever the test puts them. */
function ctxWith(positions) {
  return { house, pos: (id) => positions[id] ?? null, lastSearch: {} };
}

const near = (spot) => ({ x: house.spots[spot].ax, y: house.spots[spot].ay });

test('a new match starts at round 1 in the hide phase with the seekers picked', () => {
  const G = newMatch(2);
  assert.equal(G.phase, 'idle');
  assert.equal(G.total, 3);
  assert.equal(G.roster.length, 6);
  assert.ok(engine.tick(G, 1000));
  assert.equal(G.n, 1);
  assert.equal(G.rid, 'm1.1');
  assert.equal(G.phase, 'hide');
  assert.equal(G.until, 1000 + 20000);
  assert.deepEqual(G.seek, G.roster.slice(-2).map((r) => r.id), 'round 1: the bots at the end of the roster seek, the humans hide');
  assert.equal(engine.hidersLeft(G).length, 4);
  assert.ok(G.rev > 0);
});

test("everyone's first round is hiding: the bots at the end of the roster seek first, the humans from round 2, nobody twice before everyone", () => {
  for (const humans of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    const G = newMatch(humans, { rounds: 'all', map: 'cozy' }, 20 + humans);
    const n = G.roster.length;
    const k = n >= 6 ? 2 : 1;
    const seekers = [];
    let now = 0;
    for (let guard = 0; guard < 100000 && seekers.length < G.total; guard++) {
      engine.tick(G, now);
      if (G.rid && seekers.length < G.n) seekers.push([...G.seek]);
      now += 250;
    }
    const first = seekers[0];
    assert.equal(first.length, k, `${humans} humans: ${k} seeker(s) in round 1`);
    const bots = G.roster.filter((r) => r.b).map((r) => r.id);
    if (bots.length >= k) assert.ok(first.every((id) => bots.includes(id)), `${humans} humans: round 1 is bots seeking, everyone else hides`);
    else if (bots.length > 0) assert.ok(bots.every((id) => first.includes(id)), `${humans} humans: with fewer bots than seekers, every bot seeks first`);
    else assert.deepEqual(first, G.roster.slice(-k).map((r) => r.id), `${humans} humans and no bots: the last of the roster seek first`);
    // the first human to seek does so in round 2 (when there are bots to seek before them)
    const firstHuman = G.roster.find((r) => !r.b).id;
    if (bots.length >= k) assert.ok(seekers[1].includes(firstHuman), `${humans} humans: the first human seeks in round 2`);
    if (humans <= 5) assert.ok(!first.some((id) => !bots.includes(id) && id === firstHuman), 'the first human never seeks in round 1');
    // within the first ceil(n / k) rounds everybody has sought, and nobody sought twice before the last of them
    const turns = Math.ceil(n / k);
    const counts = Object.fromEntries(G.roster.map((r) => [r.id, 0]));
    seekers.slice(0, turns).forEach((s, r) => {
      for (const id of s) counts[id]++;
      if (r < turns - 1) assert.ok(s.every((id) => counts[id] === 1), `${humans} humans, round ${r + 1}: somebody sought twice too early`);
    });
    assert.ok(G.roster.every((r) => counts[r.id] >= 1), `${humans} humans: everybody sought within ${turns} rounds`);
  }
});

test('the mansion has longer clocks', () => {
  const G = newMatch(1, { rounds: 5, map: 'mansion' });
  assert.equal(G.map, 'mansion');
  assert.equal(G.total, 5);
  assert.equal(G.seekMs, 95000);
  assert.equal(G.hideMs, 25000);
  const cozy = newMatch(1);
  assert.equal(cozy.seekMs, 75000);
  assert.equal(newMatch(1, { rounds: 'all', map: 'cozy' }).total, 6);
  assert.equal(newMatch(1, { rounds: 'x', map: 'y' }).map, 'cozy');
});

test('phases follow the clocks: hide, seek, reveal, score, next round', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  assert.ok(!engine.tick(G, 19999));
  assert.ok(engine.tick(G, 20000));
  assert.equal(G.phase, 'seek');
  assert.equal(G.seekAt, 20000);
  assert.equal(G.until, 20000 + 75000);
  assert.ok(!engine.tick(G, 94999));
  assert.ok(engine.tick(G, 95000));
  assert.equal(G.phase, 'reveal');
  assert.equal(G.until, 95000 + 4000);
  assert.ok(engine.tick(G, 99000));
  assert.equal(G.phase, 'score');
  assert.equal(G.until, 99000 + 4000);
  assert.ok(engine.tick(G, 103000));
  assert.equal(G.phase, 'hide');
  assert.equal(G.n, 2);
  assert.equal(G.rid, 'm1.2');
  assert.deepEqual(G.found, {});
  assert.deepEqual(G.spots, {});
  assert.deepEqual(G.seek, ['h1', 'h2'], 'round 2: the humans seek');
});

test('a late tick catches up one phase at a time and never skips a clock', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  let now = 500000;
  const seen = [G.phase];
  for (let i = 0; i < 30 && !G.done; i++) {
    engine.tick(G, now);
    if (seen[seen.length - 1] !== G.phase) seen.push(G.phase);
  }
  assert.ok(G.done);
  assert.deepEqual(seen.slice(0, 5), ['hide', 'seek', 'reveal', 'score', 'hide']);
  assert.equal(seen[seen.length - 1], 'final');
});

test('hiding: one hider per spot, only hiders, only near the spot, only while hiding', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  // round 1: the two bots at the end of the roster seek, everyone else hides
  const [seeker] = G.seek;
  const [a, b, c] = engine.hidersLeft(G);
  const ctx = ctxWith({ [a]: near(0), [b]: near(0), [seeker]: near(0), [c]: { x: 30, y: 19 } });
  assert.ok(engine.hide(G, a, 0, ctx));
  assert.equal(G.spots[0], a);
  assert.ok(!engine.hide(G, b, 0, ctx), 'the spot is taken');
  assert.ok(engine.hide(G, a, 0, ctx), 'asking again for your own spot is fine');
  assert.ok(!engine.hide(G, seeker, 1, ctx), 'a seeker cannot hide');
  assert.ok(!engine.hide(G, c, 1, ctx), 'too far away');
  assert.ok(!engine.hide(G, b, 99, ctx), 'no such spot');
  assert.ok(!engine.hide(G, b, 1.5, ctx), 'not a whole number');
  assert.ok(!engine.hide(G, b, -1, ctx));
  assert.ok(!engine.hide(G, 'nobody', 1, ctx));
  assert.equal(engine.spotOf(G, a), 0);
  assert.equal(engine.spotOf(G, b), -1);
  const evs = G.ev.filter((e) => e.k === 'hide');
  assert.equal(evs.length, 1);
  // moving to another spot frees the first
  ctx.pos = (id) => (id === a ? near(1) : null);
  assert.ok(engine.hide(G, a, 1, ctx));
  assert.equal(G.spots[0], undefined);
  assert.equal(G.spots[1], a);
  // coming out
  assert.equal(engine.unhide(G, a), 1);
  assert.equal(engine.unhide(G, a), -1);
  assert.deepEqual(G.spots, {});
  // not before or after the hide and seek phases
  G.phase = 'reveal';
  assert.ok(!engine.hide(G, a, 1, ctx));
});

test('searching a spot finds the hider inside, who becomes a seeker; an empty spot says nope', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [s1, s2] = G.seek;
  const [a, b] = engine.hidersLeft(G);
  const pos = { [a]: near(2), [s1]: near(2), [s2]: near(3) };
  const ctx = ctxWith(pos);
  engine.hide(G, a, 2, ctx);
  assert.ok(!engine.search(G, s1, 2, 5000, ctx), 'not during the hide phase');
  engine.tick(G, 20000);
  assert.equal(G.phase, 'seek');
  const found = engine.search(G, s1, 2, 30000, ctx);
  assert.equal(found, 'found');
  assert.equal(G.found[a], 10000, 'found 10 s into the seek');
  assert.equal(G.fd[a], s1);
  assert.equal(G.spots[2], undefined, 'the spot is empty again');
  assert.equal(roleOf(G, a), 'found');
  assert.equal(G.stats.finds[s1], 1);
  const ev = G.ev[G.ev.length - 1];
  assert.deepEqual([ev.k, ev.s, ev.w, ev.f], ['found', 2, a, s1]);
  // an empty spot
  assert.equal(engine.search(G, s2, 3, 31000, ctx), 'nope');
  assert.equal(G.ev[G.ev.length - 1].k, 'nope');
  // a cooldown: the same seeker again within a second is refused
  assert.equal(engine.search(G, s2, 3, 31400, ctx), false);
  assert.equal(engine.search(G, s2, 3, 32100, ctx), 'nope');
  // a hider cannot search, and far away does not count
  assert.equal(engine.search(G, b, 3, 40000, ctx), false);
  assert.equal(engine.search(G, s1, 8, 40000, ctx), false, 'too far from spot 8');
});

test('a found player can search too, with their smaller flashlight rules', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [s1] = G.seek;
  const [a, b] = engine.hidersLeft(G);
  const pos = { [a]: near(2), [b]: near(4), [s1]: near(2) };
  const ctx = ctxWith(pos);
  engine.hide(G, a, 2, ctx);
  engine.hide(G, b, 4, ctx);
  engine.tick(G, 20000);
  assert.equal(engine.search(G, s1, 2, 21000, ctx), 'found');
  pos[a] = near(4);
  assert.equal(engine.search(G, a, 4, 23000, ctx), 'found');
  assert.equal(G.fd[b], a);
  assert.equal(G.stats.finds[a], 1);
});

test('tagging finds a hider out in the open, not one who is hidden or far away', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [s1, s2] = G.seek;
  const [a, b, c] = engine.hidersLeft(G);
  const pos = { [s1]: { x: 10, y: 10 }, [a]: { x: 10.5, y: 10 }, [b]: near(4), [c]: { x: 25, y: 15 } };
  const ctx = ctxWith(pos);
  engine.hide(G, b, 4, ctx);
  engine.tick(G, 20000);
  assert.ok(!engine.tag(G, s1, b, 25000, ctx), 'a hidden player cannot be tagged');
  assert.ok(!engine.tag(G, s1, c, 25000, ctx), 'too far');
  assert.ok(!engine.tag(G, a, c, 25000, ctx), 'a hider cannot tag');
  assert.ok(!engine.tag(G, s1, s2, 25000, ctx), 'a seeker cannot be tagged');
  assert.ok(!engine.tag(G, s1, s1, 25000, ctx));
  assert.ok(!engine.tag(G, s1, 'ghost', 25000, ctx));
  assert.ok(engine.tag(G, s1, a, 25000, ctx));
  assert.equal(G.found[a], 5000);
  assert.ok(!engine.tag(G, s2, a, 25100, ctx), 'found once only: the first claim wins');
  assert.equal(G.fd[a], s1);
  assert.equal(G.stats.finds[s1], 1);
});

test('the round ends early when the last hider is found, and the seekers score their finds', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [s1, s2] = G.seek;
  const hiders = engine.hidersLeft(G);
  assert.equal(hiders.length, 4);
  const pos = { [s1]: { x: 10, y: 10 } };
  for (const id of hiders) pos[id] = { x: 10.4, y: 10 };
  const ctx = ctxWith(pos);
  engine.tick(G, 20000);
  let t = 30000;
  for (const id of hiders) {
    assert.equal(G.phase, 'seek');
    assert.ok(engine.tag(G, s1, id, t, ctx));
    t += 1000;
    engine.tick(G, t);
  }
  assert.equal(G.phase, 'reveal');
  assert.equal(G.allFound, true);
  assert.equal(G.t0, t);
  assert.deepEqual(G.survived, []);
  assert.equal(G.gain[s1], 12, 'four finds, 3 each');
  assert.equal(G.gain[s2], 0);
  // found at 10, 11, 12, 13 s into the seek: nothing for under 15 s
  for (const id of hiders) assert.equal(G.gain[id], 0);
  assert.equal(G.scores[s1], 12);
  assert.equal(G.stats.finds[s1], 4);
});

test('a hider who is never found earns 2 per 15 s and 5 more for the whole round; one found late earns by the clock', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [s1, s2] = G.seek;
  const hiders = engine.hidersLeft(G);
  const pos = { [s1]: { x: 10, y: 10 } };
  for (const id of hiders) pos[id] = { x: 10.4, y: 10 };
  const ctx = ctxWith(pos);
  engine.tick(G, 20000);
  assert.ok(engine.tag(G, s1, hiders[0], 20000 + 40000, ctx)); // found 40 s in
  engine.tick(G, 20000 + 75000);
  assert.equal(G.phase, 'reveal');
  assert.equal(G.allFound, false);
  assert.deepEqual(G.survived, hiders.slice(1));
  assert.equal(G.gain[hiders[0]], 4, '40 s is two 15 s marks');
  assert.equal(G.gain[hiders[1]], 15, '5 marks and the whole-round bonus');
  assert.equal(G.gain[s1], 3);
  assert.equal(G.gain[s2], 0);
  assert.equal(G.stats.unf[hiders[0]], 40000);
  assert.equal(G.stats.unf[hiders[1]], 75000);
});

test('the match ends with a ranking, awards and a done flag', () => {
  const G = newMatch(1, { rounds: 3, map: 'cozy' });
  let now = 0;
  for (let i = 0; i < 100000 && !G.done; i++) {
    engine.tick(G, now);
    now += 100;
  }
  assert.ok(G.done);
  assert.equal(G.phase, 'final');
  assert.equal(G.n, 3);
  assert.equal(G.res.order.length, 6);
  assert.ok(G.res.order.every((r, i, a) => i === 0 || a[i - 1].score >= r.score));
  assert.equal(G.res.order[0].place, 1);
  // everyone hid and nobody searched: every round the hiders survive
  for (const r of G.roster) assert.ok(Number.isFinite(G.scores[r.id]));
  assert.ok(G.res.awards.some((a) => a.k === 'ghost'));
  assert.ok(!engine.tick(G, now + 99999), 'nothing more happens after done');
});

test('the final results of a tie share first place', () => {
  const G = newMatch(1);
  G.scores = { h1: 9, bot1: 9, bot2: 4, bot3: 4, bot4: 1, bot5: 0 };
  // finish through the normal path
  G.n = G.total;
  G.phase = 'score';
  G.until = 100;
  engine.tick(G, 100);
  assert.equal(G.phase, 'final');
  assert.deepEqual(G.res.order.slice(0, 4).map((r) => r.place), [1, 1, 3, 3]);
  assert.equal(G.res.order[5].place, 6);
});

test('every round has a new id and a clean slate', () => {
  const G = newMatch(2);
  engine.tick(G, 0);
  const [hider] = engine.hidersLeft(G);
  const ctx = ctxWith({ [hider]: near(0) });
  assert.ok(engine.hide(G, hider, 0, ctx));
  const ids = new Set([G.rid]);
  let now = 0;
  while (!G.done) {
    now += 500;
    const before = G.rid;
    engine.tick(G, now);
    if (G.rid !== before) {
      ids.add(G.rid);
      assert.deepEqual(G.found, {});
      assert.deepEqual(G.spots, {});
      assert.deepEqual(G.fd, {});
      assert.equal(G.allFound, false);
    }
  }
  assert.equal(ids.size, 3);
});

test('start positions are free and different for everyone', () => {
  for (const mapId of ['cozy', 'mansion']) {
    const h = getHouse(mapId);
    const G = engine.createMatch({ mid: 'm', by: 'h1', roster: buildRoster([{ id: 'h1', name: 'A' }], 3), settings: { rounds: 3, map: mapId }, seed: 3 });
    engine.tick(G, 0);
    const seen = new Set();
    for (const r of G.roster) {
      const p = engine.startPos(G, h, r.id);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.a));
      for (const q of h.blockers) assert.ok(distToRect(p.x, p.y, q) >= 0.4, `${r.id} starts inside something`);
      seen.add(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    assert.equal(seen.size, G.roster.length, 'nobody starts on top of someone');
  }
});
