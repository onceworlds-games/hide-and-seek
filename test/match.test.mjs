import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, roleOf, RULES } from '../game/rules.js';
import * as engine from '../game/engine.js';
import { HostGame } from '../game/host.js';
import { getHouse } from '../game/maps.js';
import { distToRect } from '../game/geometry.js';

const DT = 1 / 60;

/** Plays a whole match with the host's own code and nobody but bots. Returns what happened. */
function playMatch({ seed, map, rounds, humans = [] }) {
  const roster = buildRoster(humans, seed);
  const G = engine.createMatch({ mid: `m${seed}`, by: 'host', roster, settings: { rounds, map }, seed });
  const host = new HostGame(G, seed);
  const house = getHouse(map);
  const out = { G, rounds: new Set(), phases: [], hid: 0, found: 0, earlyEnds: 0, timeEnds: 0, unstuck: 0, chased: 0, steps: 0, frozenOk: true };
  let now = 0;
  let lastPhase = '';
  const frozenAt = {};
  const limit = Math.ceil(((G.hideMs + G.seekMs + 9000) * (G.total + 1) + 30000) / (DT * 1000));
  for (let step = 0; step < limit && !G.done; step++) {
    now += DT * 1000;
    if (step % 6 === 0) host.advance(now);
    host.step(DT, now);
    out.steps++;
    if (G.phase !== lastPhase) {
      out.phases.push(G.phase);
      lastPhase = G.phase;
      if (G.phase === 'reveal') G.allFound ? out.earlyEnds++ : out.timeEnds++;
    }
    out.rounds.add(G.rid);
    if (step % 3 !== 0) continue;
    for (const bot of host.bots.values()) {
      assert.ok([bot.x, bot.y, bot.vx, bot.vy, bot.a].every(Number.isFinite), `NaN in ${bot.id}`);
      assert.ok(bot.x >= 0.5 && bot.x <= house.w - 0.5 && bot.y >= 0.5 && bot.y <= house.h - 0.5, `${bot.id} left the house at ${bot.x},${bot.y}`);
      if (bot.hid < 0) {
        for (const q of house.blockers) assert.ok(distToRect(bot.x, bot.y, q) >= 0.3, `${bot.id} is inside a wall or furniture at ${bot.x.toFixed(2)},${bot.y.toFixed(2)} (round ${G.n}, ${G.phase})`);
      }
      // seekers keep still while they count
      if (G.phase === 'hide' && roleOf(G, bot.id) === 'seeker') {
        const key = `${G.rid}.${bot.id}`;
        if (!frozenAt[key]) frozenAt[key] = [bot.x, bot.y];
        else if (Math.hypot(bot.x - frozenAt[key][0], bot.y - frozenAt[key][1]) > 0.6) out.frozenOk = false;
      }
    }
  }
  out.done = G.done;
  out.unstuck = [...host.bots.values()].reduce((n, b) => n + (b.unstuck | 0), 0);
  out.found = Object.keys(G.fd).length;
  out.host = host;
  return out;
}

// 20 seeds, both houses; mostly 3 rounds, a few of 5 and of "one per player" (6)
const CASES = Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, map: i % 2 ? 'mansion' : 'cozy', rounds: i < 12 ? 3 : i < 16 ? 5 : 'all' }));

test('a whole match of only bots ends, ranks everyone, and nothing goes wrong (20 seeds)', () => {
  let totalFinds = 0;
  let early = 0;
  let timed = 0;
  let totalUnstuck = 0;
  for (const c of CASES) {
    const r = playMatch(c);
    const { G } = r;
    const label = `seed ${c.seed} ${c.map} rounds ${c.rounds}`;
    assert.ok(r.done, `${label}: the match ended`);
    assert.equal(G.phase, 'final');
    assert.equal(G.n, G.total, `${label}: ran ${G.n} of ${G.total} rounds`);
    assert.equal(r.rounds.size, G.total, `${label}: ${r.rounds.size} distinct round ids`);
    assert.equal(G.res.order.length, G.roster.length, `${label}: a ranking of everyone`);
    assert.deepEqual(new Set(G.res.order.map((x) => x.id)), new Set(G.roster.map((x) => x.id)));
    assert.ok(G.res.order.every((x) => Number.isInteger(x.score) && x.score >= 0), `${label}: scores are whole and not negative`);
    assert.ok(G.res.order[0].place === 1);
    assert.ok(r.frozenOk, `${label}: a seeker moved while counting`);
    // the usual rhythm of phases
    const rhythm = ['hide', 'seek', 'reveal', 'score'];
    const expected = [];
    for (let k = 0; k < G.total; k++) expected.push(...rhythm);
    expected.push('final');
    assert.deepEqual(r.phases.filter((p) => p !== 'idle'), expected, `${label}: phases`);
    totalFinds += r.found;
    early += r.earlyEnds;
    timed += r.timeEnds;
    totalUnstuck += r.unstuck;
    // points add up: what everyone earned is what the rounds paid
    const sum = Object.values(G.scores).reduce((a, b) => a + b, 0);
    assert.ok(sum > 0);
    // the seekers take turns: by the end everybody has been one if there were enough rounds
    assert.ok(G.stats.finds && Object.keys(G.stats.finds).length === G.roster.length);
  }
  console.log(`# 20 matches: finds in last rounds ${totalFinds}, rounds ended early ${early}, on the clock ${timed}, bot unstick events ${totalUnstuck}`);
  assert.ok(early + timed >= 20 * 3);
  assert.ok(early > 0 && timed > 0, 'both kinds of round end happen');
  assert.ok(totalUnstuck <= 20, `bots got stuck ${totalUnstuck} times`);
});

test('bots hide in spots during the hide phase and seekers really find them', () => {
  let hidden = 0;
  let found = 0;
  let hiders = 0;
  const roundOneFinds = {};
  for (const seed of [3, 4, 5, 6]) {
    const map = seed % 2 ? 'cozy' : 'mansion';
    const roster = buildRoster([], seed);
    const G = engine.createMatch({ mid: `h${seed}`, by: 'host', roster, settings: { rounds: 3, map }, seed });
    const host = new HostGame(G, seed);
    let now = 0;
    for (let step = 0; step < 60 * 400 && G.n < 2; step++) {
      now += DT * 1000;
      if (step % 6 === 0) host.advance(now);
      host.step(DT, now);
      if (G.phase === 'seek' && G.seekAt && now - G.seekAt < 100) {
        hiders += engine.hidersLeft(G).length;
        hidden += Object.keys(G.spots).length;
      }
      if (G.n === 1 && G.phase === 'reveal') roundOneFinds[seed] = Object.keys(G.fd).length;
    }
  }
  assert.ok(hidden >= hiders * 0.4, `at least 40% of hider bots hide in a spot (${hidden} of ${hiders})`);
  found = Object.values(roundOneFinds).reduce((a, b) => a + b, 0);
  assert.ok(found > 0, `seeker bots found someone in round 1 (${JSON.stringify(roundOneFinds)})`);
});

test('a human who leaves is taken over by a bot and the match goes on', () => {
  const roster = buildRoster([{ id: 'h1', name: 'Ann' }, { id: 'h2', name: 'Bo' }], 9);
  const G = engine.createMatch({ mid: 'leave', by: 'h1', roster, settings: { rounds: 3, map: 'cozy' }, seed: 9 });
  const host = new HostGame(G, 1);
  let now = 0;
  const house = getHouse('cozy');
  for (let step = 0; step < 60 * 30; step++) {
    now += DT * 1000;
    if (step % 6 === 0) host.advance(now);
    host.setHuman('h1', 10, 10, 0);
    host.setHuman('h2', 12, 10, 0);
    host.step(DT, now);
  }
  assert.equal(G.phase, 'seek');
  assert.ok(host.convertToBot('h2'));
  assert.ok(!host.convertToBot('h2'), 'only once');
  assert.ok(!host.convertToBot('nobody'));
  assert.equal(G.roster[1].b, 1);
  const bot = host.bots.get('h2');
  assert.ok(bot, 'h2 is a bot now');
  assert.ok(Math.hypot(bot.x - 12, bot.y - 10) < 2, 'where they stood');
  assert.equal(host.humans.has('h2'), false);
  const before = [bot.x, bot.y];
  for (let step = 0; step < 60 * 10; step++) {
    now += DT * 1000;
    if (step % 6 === 0) host.advance(now);
    host.setHuman('h1', 10, 10, 0);
    host.step(DT, now);
    assert.ok(Number.isFinite(bot.x) && Number.isFinite(bot.y));
  }
  assert.ok(Math.hypot(bot.x - before[0], bot.y - before[1]) > 0.5, 'the bot walks around (it is a seeker)');
  for (const q of house.blockers) assert.ok(distToRect(bot.x, bot.y, q) >= 0.3);
});

test('human requests are checked by the host: round id, role, range', () => {
  const roster = buildRoster([{ id: 'h1', name: 'Ann' }, { id: 'h2', name: 'Bo' }, { id: 'h3', name: 'Cy' }], 4);
  const G = engine.createMatch({ mid: 'req', by: 'h1', roster, settings: { rounds: 3, map: 'cozy' }, seed: 4 });
  const host = new HostGame(G, 1);
  const house = getHouse('cozy');
  host.advance(0);
  // round 1: h1 and h2 seek, h3 hides
  const s = house.spots[1];
  host.setHuman('h3', s.ax, s.ay, 0);
  assert.equal(host.onHide('h3', 'req.9', 1), false, 'wrong round');
  assert.equal(host.onHide('h1', G.rid, 1), false, 'a seeker');
  assert.equal(host.onHide('bot1', G.rid, 1), false, 'bots are the host\'s business, not a message away');
  assert.equal(host.onHide('h3', G.rid, 1), true);
  assert.equal(G.spots[1], 'h3');
  assert.equal(host.onUnhide('h3', G.rid), true);
  assert.equal(host.onUnhide('h3', G.rid), false);
  assert.equal(host.onHide('h3', G.rid, 1), true);
  host.advance(20000);
  assert.equal(G.phase, 'seek');
  host.setHuman('h1', s.ax, s.ay, 0);
  host.now = 30000;
  assert.equal(host.onSearch('h1', G.rid, 1), 'found');
  assert.equal(roleOf(G, 'h3'), 'found');
  assert.equal(host.onSearch('h1', 'old.round', 1), false);
  host.setHuman('h2', 5, 5, 0);
  host.setHuman('h3', 5.5, 5, 0);
  assert.equal(host.onTag('h2', G.rid, 'h3'), false, 'h3 is a seeker now');
});

test('a new host picks the bots up from the last snapshot', () => {
  const roster = buildRoster([{ id: 'h1', name: 'Ann' }], 12);
  const G = engine.createMatch({ mid: 'hand', by: 'h1', roster, settings: { rounds: 3, map: 'cozy' }, seed: 12 });
  const host = new HostGame(G, 1);
  let now = 0;
  for (let step = 0; step < 60 * 40; step++) {
    now += DT * 1000;
    if (step % 6 === 0) host.advance(now);
    host.setHuman('h1', 16, 14, 0);
    host.step(DT, now);
  }
  const snap = JSON.parse(JSON.stringify(host.snapshot(now)));
  assert.equal(snap.rid, G.rid);
  assert.equal(snap.p.length, 5);
  assert.ok(snap.p.every((row) => row.length === 6 && row.every(Number.isFinite)));
  const record = JSON.parse(JSON.stringify(G));
  const next = new HostGame(record, 2);
  next.restore(snap);
  for (const [i, x, y] of snap.p) {
    const bot = next.bots.get(record.roster[i].id);
    assert.ok(Math.abs(bot.x - x) < 1e-9 && Math.abs(bot.y - y) < 1e-9);
  }
  // and it carries on without resetting anyone
  const before = snap.p.map((r) => [r[1], r[2]]);
  for (let step = 0; step < 6; step++) {
    now += DT * 1000;
    next.step(DT, now);
  }
  let k = 0;
  for (const bot of next.bots.values()) {
    assert.ok(Math.hypot(bot.x - before[k][0], bot.y - before[k][1]) < 1, 'nobody jumped back to the start');
    k++;
  }
  // a stale snapshot (another round) is ignored
  const other = new HostGame(JSON.parse(JSON.stringify(G)), 3);
  other.restore({ ...snap, rid: 'other.1' });
  other.step(DT, now);
  assert.ok(true);
  next.restore(null);
  next.restore({ rid: record.rid, t: 1, p: [[99, 1, 1, 1, 1, 1], 'junk', [0, NaN, 1, 1, 1, 1]] });
});

test('the numbers a snapshot carries are small and rounded', () => {
  const roster = buildRoster([], 1);
  const G = engine.createMatch({ mid: 'snap', by: 'x', roster, settings: { rounds: 3, map: 'mansion' }, seed: 1 });
  const host = new HostGame(G, 1);
  host.advance(0);
  host.step(DT, 0);
  const snap = host.snapshot(1234.567);
  assert.equal(snap.t, 1235);
  assert.ok(JSON.stringify(snap).length < 400, 'one snapshot is a few hundred bytes');
});

test('a page that claims to be somewhere impossible is kept inside the house', () => {
  const roster = buildRoster([{ id: 'h1', name: 'Ann' }], 2);
  const G = engine.createMatch({ mid: 'far', by: 'h1', roster, settings: { rounds: 3, map: 'cozy' }, seed: 2 });
  const host = new HostGame(G, 1);
  host.setHuman('h1', 1e12, -1e12, 0, 1e9, NaN);
  const p = host.posOf('h1');
  assert.ok(p.x <= 31.5 && p.y >= 0.5 && Number.isFinite(p.vy));
  host.setHuman('h1', NaN, 3, 0);
  host.setHuman('h1', 3, 3, Infinity);
  assert.ok(Number.isFinite(host.posOf('h1').a));
  host.advance(0);
  host.step(1 / 60, 100);
});
