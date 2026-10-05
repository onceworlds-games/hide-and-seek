import test from 'node:test';
import assert from 'node:assert/strict';
import { parseG, parseB, Net, createStubRoom } from '../game/net.js';
import * as engine from '../game/engine.js';
import { buildRoster } from '../game/rules.js';
import { HostGame } from '../game/host.js';

function record() {
  const roster = buildRoster([{ id: 'h1', name: 'Ann' }, { id: 'h2', name: 'Bo' }], 4);
  const G = engine.createMatch({ mid: 'm9', by: 'h1', roster, settings: { rounds: 3, map: 'mansion' }, seed: 4 });
  const host = new HostGame(G, 1);
  host.advance(0);
  host.setHuman('h1', 20, 12, 0);
  host.setHuman('h2', 21, 12, 0);
  const s = host.house.spots[1];
  // make some history: a bot hides, a seeker finds it
  const bot = host.bots.get('bot3');
  bot.x = s.ax;
  bot.y = s.ay;
  assert.ok(engine.hide(G, 'bot3', 1, host.ectx));
  host.advance(26000);
  host.setHuman('h1', s.ax, s.ay, 0);
  host.now = 30000;
  assert.equal(engine.search(G, 'h1', 1, 30000, host.ectx), 'found');
  return G;
}

test('a record read back from the room is the same record', () => {
  const G = record();
  const back = parseG(JSON.parse(JSON.stringify(G)));
  assert.ok(back);
  for (const k of ['mid', 'by', 'map', 'n', 'rid', 'phase', 't0', 'until', 'seekAt', 'hideMs', 'seekMs', 'total', 'seq', 'rev', 'allFound', 'done']) assert.deepEqual(back[k], G[k], k);
  assert.deepEqual(back.roster, G.roster);
  assert.deepEqual(back.seek, G.seek);
  assert.deepEqual(back.found, G.found);
  assert.deepEqual(back.fd, G.fd);
  assert.deepEqual(back.scores, G.scores);
  assert.deepEqual(back.ev, G.ev.map((e) => ({ ...e, w: e.w, f: e.f, h: e.h ?? 'search' })));
  assert.ok(Object.keys(back.found).length === 1);
  // a finished one with results
  G.n = G.total;
  G.phase = 'score';
  G.until = 1;
  engine.tick(G, 2);
  const fin = parseG(JSON.parse(JSON.stringify(G)));
  assert.equal(fin.phase, 'final');
  assert.deepEqual(fin.res, G.res);
});

test('garbage from another player never gets through or throws', () => {
  const G = record();
  const raw = JSON.parse(JSON.stringify(G));
  const bad = [
    null,
    undefined,
    0,
    'g',
    [],
    {},
    { v: 1 },
    { ...raw, v: 2 },
    { ...raw, by: 12 },
    { ...raw, mid: '' },
    { ...raw, phase: 'cheat' },
    { ...raw, roster: 'x' },
    { ...raw, roster: [] },
    { ...raw, roster: [{ id: 'a' }, { id: 'a' }] },
    { ...raw, roster: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })) },
    { ...raw, roster: [{ id: 'x'.repeat(200) }, { id: 'b' }] },
  ];
  for (const b of bad) assert.equal(parseG(b), null, JSON.stringify(b)?.slice(0, 60));
  // odd values inside an otherwise fine record are cleaned
  const weird = parseG({
    ...raw,
    n: 'NaN',
    total: 1e9,
    until: -5,
    seek: ['nobody', 'h1', 5, null],
    found: { h2: 'x', nobody: 5, h1: 1e12 },
    scores: { h1: Infinity, h2: -4, nobody: 1 },
    spots: { 3: 'h1', 999: 'h2', x: 'h1', 4: 'nobody' },
    ev: [null, 'x', { k: 'cheat', i: 1 }, { k: 'found', i: 2, s: 9999, w: 'h2', f: 'nobody' }, { k: 'hide', i: 'x' }],
    res: { order: [{ id: 'h1', score: 'x', place: -3 }, null, { id: 'zzz' }], awards: [{ k: 'ghost', id: 'h2', v: 5 }, { k: 'evil', id: 'h2' }] },
    roster: raw.roster.map((r, i) => ({ ...r, n: i === 0 ? 'x'.repeat(100) + '\u0000' : r.n, c: i === 1 ? 'x' : r.c })),
  });
  assert.ok(weird);
  assert.equal(weird.n, 0);
  assert.equal(weird.total, 20);
  assert.equal(weird.until, 0);
  assert.deepEqual(weird.seek, ['h1']);
  assert.equal(Object.keys(weird.found).length, 1);
  assert.equal(weird.found.h1, 1e8);
  assert.ok(weird.scores.h1 === 0 && weird.scores.h2 === 0, 'impossible numbers are dropped');
  assert.deepEqual(Object.keys(weird.spots), ['3']);
  assert.equal(weird.ev.length, 1);
  assert.equal(weird.ev[0].s, -1);
  assert.equal(weird.ev[0].f, undefined);
  assert.equal(weird.res.order.length, 1);
  assert.equal(weird.res.order[0].score, 0);
  assert.equal(weird.res.order[0].place, 1);
  assert.equal(weird.res.awards.length, 1);
  assert.ok(weird.roster[0].n.length <= 16 && !weird.roster[0].n.includes('\u0000'));
  assert.ok(Number.isInteger(weird.roster[1].c));
  // prototype tricks
  const proto = parseG({ ...raw, found: JSON.parse('{"__proto__": 5, "constructor": 1}'), spots: JSON.parse('{"__proto__": "h1"}') });
  assert.ok(proto);
  assert.deepEqual(Object.keys(proto.found), []);
});

test('bot snapshots are checked and interpolated between two moments', () => {
  assert.equal(parseB(null), null);
  assert.equal(parseB({ rid: 5, p: [], t: 1 }), null);
  assert.equal(parseB({ rid: 'r', p: 'x', t: 1 }), null);
  assert.equal(parseB({ rid: 'r', p: [], t: NaN }), null);
  const b = parseB({ rid: 'r', t: 100, p: [[0, 1, 2, 0, 0, 0], [99, 1, 1, 1, 1, 1], [1, NaN, 1, 1, 1, 1], 'x', [2, 1e9, -1e9, 1e9, 0, 99]] }, 6);
  assert.deepEqual(b.rows.map((r) => r.i), [0, 2]);
  assert.ok(b.rows[1].x <= 60 && b.rows[1].y >= -5 && b.rows[1].vx <= 20 && b.rows[1].a <= 10);
  const room = createStubRoom();
  const net = new Net(room, { now: () => 0 });
  net.snaps.push(parseB({ rid: 'r', t: 1000, p: [[0, 0, 0, 1, 0, 0], [1, 5, 5, 0, 0, 3.0]] }));
  net.snaps.push(parseB({ rid: 'r', t: 1100, p: [[0, 1, 0, 1, 0, 0], [1, 5, 5, 0, 0, -3.0]] }));
  net.snaps.push(parseB({ rid: 'other', t: 1050, p: [[0, 99, 99, 0, 0, 0]] }));
  const out = [];
  assert.ok(net.botsAt('r', 1180, out), 'between the two (130 ms behind)');
  assert.ok(Math.abs(out[0].x - 0.5) < 1e-9, `halfway: ${out[0].x}`);
  assert.ok(Math.abs(Math.abs(out[1].a) - Math.PI) < 0.2 + 0.1, 'angles turn the short way round');
  assert.ok(net.botsAt('r', 5000, out), 'later than the newest: hold the last');
  assert.equal(out[0].x, 1);
  assert.ok(!net.botsAt('nope', 1000, out), 'nothing for another round');
  net.snaps.push(parseB({ rid: 'r', t: 1200, p: [[0, 20, 0, 1, 0, 0]] }));
  net.botsAt('r', 1330, out);
  assert.equal(out[0].x, 20, 'a jump (out of a spot) is a teleport, not a slide');
});

test('messages from players are checked before the host acts', () => {
  const room = createStubRoom();
  const net = new Net(room, { now: () => 0 });
  // not the authority yet: everything is ignored
  net.onMessage({ t: 'hide', rid: 'x', spot: 1 }, { id: 'me' }, 0);
  const G = record();
  net.host = new HostGame(G, 1);
  net.hosting = true;
  room.match = { ...room.match, phase: 'playing', id: 'm9', participants: ['me'] };
  assert.ok(room.running);
  room.me.id = 'h1';
  room.host = 'h1';
  assert.ok(net.authority);
  for (const msg of [null, 5, 'x', {}, { t: 'hide' }, { t: 'hide', rid: 5 }, { t: 'hide', rid: G.rid, spot: 'a' }, { t: 'hide', rid: G.rid, spot: 1.5 }, { t: 'search', rid: G.rid }, { t: 'tag', rid: G.rid, id: 5 }, { t: 'tag', rid: G.rid, id: 'x'.repeat(100) }, { t: 'zzz', rid: G.rid }]) {
    net.onMessage(msg, { id: 'h2' }, 0);
    net.onMessage(msg, null, 0);
    net.onMessage(msg, { id: 7 }, 0);
  }
  assert.ok(true, 'nothing threw');
});
