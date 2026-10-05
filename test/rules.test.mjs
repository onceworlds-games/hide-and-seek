import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES,
  SETTINGS,
  buildRoster,
  cleanName,
  seekerCount,
  roundsFor,
  seekersForRound,
  surviveGain,
  rankScores,
  pickAwards,
  roleOf,
  mulberry32,
  seedOf,
  placeWord,
  BOT_NAMES,
  COLORS,
} from '../game/rules.js';

test('settings are what the spec says', () => {
  assert.equal(SETTINGS.length, 2);
  const rounds = SETTINGS.find((s) => s.id === 'rounds');
  assert.deepEqual(rounds.options.map((o) => (typeof o === 'object' ? o.value : o)), [3, 5, 'all']);
  assert.equal(rounds.default, 3);
  const map = SETTINGS.find((s) => s.id === 'map');
  assert.deepEqual(map.options.map((o) => o.value), ['cozy', 'mansion']);
  assert.equal(map.default, 'cozy');
  assert.equal(RULES.maxPlayers, 10);
  assert.equal(RULES.table, 6);
});

test('the roster is the humans first, then bots up to six, with unique ids, names and colours', () => {
  const r = buildRoster([{ id: 'a', name: 'Ann' }], 5);
  assert.equal(r.length, 6);
  assert.deepEqual(r.map((x) => x.b), [0, 1, 1, 1, 1, 1]);
  assert.deepEqual(r.map((x) => x.id), ['a', 'bot1', 'bot2', 'bot3', 'bot4', 'bot5']);
  assert.equal(new Set(r.map((x) => x.n)).size, 6, 'unique names');
  assert.ok(r.slice(1).every((x) => BOT_NAMES.includes(x.n)));
  assert.equal(new Set(r.map((x) => x.c)).size, 6);
  const same = buildRoster([{ id: 'a', name: 'Ann' }], 5);
  assert.deepEqual(r, same, 'the same seed gives the same roster');
  const many = buildRoster(Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), 1);
  assert.equal(many.length, 8);
  assert.ok(many.every((x) => !x.b), 'more humans than the table: no bots');
  const ten = buildRoster(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: 'x' })), 1);
  assert.equal(ten.length, 10, 'never more than the room seats');
  assert.equal(new Set(ten.map((x) => x.c)).size, 10);
  assert.ok(COLORS.length >= 10);
});

test('names are cleaned', () => {
  assert.equal(cleanName('  Bo\u0000b\n  '), 'Bob');
  assert.equal(cleanName('a'.repeat(40)).length, 16);
  assert.equal(cleanName(''), 'Player');
  assert.equal(cleanName(null), 'Player');
  assert.equal(cleanName('x y'), 'xy');
});

test('one seeker for a table of up to five, two from six, and always a hider left', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 10].map(seekerCount), [1, 1, 1, 1, 2, 2, 2]);
  assert.equal(seekerCount(1), 1);
});

test('rounds: 3, 5 or one per player', () => {
  assert.equal(roundsFor(3, 6), 3);
  assert.equal(roundsFor(5, 6), 5);
  assert.equal(roundsFor('all', 6), 6);
  assert.equal(roundsFor('all', 9), 9);
  assert.equal(roundsFor('junk', 6), 3);
  assert.equal(roundsFor(undefined, 6), 3);
});

test('everyone seeks once before anyone seeks twice', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const order = Array.from({ length: n }, (_, i) => `p${i}`);
    const k = seekerCount(n);
    const turns = Math.ceil(n / k);
    const counts = Object.fromEntries(order.map((id) => [id, 0]));
    for (let r = 0; r < turns; r++) {
      const s = seekersForRound(order, k, r);
      assert.equal(new Set(s).size, s.length);
      assert.ok(s.length >= 1 && s.length < n, 'at least one hider');
      for (const id of s) counts[id]++;
      if (r < turns - 1 || n % k === 0) assert.ok(s.every((id) => counts[id] === 1), `n=${n} round ${r}: someone sought twice too early`);
    }
    assert.ok(order.every((id) => counts[id] >= 1), `n=${n}: everyone sought within ${turns} rounds`);
  }
  // humans first: the first seeker is the first of the roster
  const roster = buildRoster([{ id: 'h', name: 'H' }], 1);
  assert.equal(seekersForRound(roster.map((r) => r.id), 2, 0)[0], 'h');
});

test('hiders earn 2 for every 15 seconds they stay unfound, finders earn 3', () => {
  assert.equal(surviveGain(0), 0);
  assert.equal(surviveGain(14999), 0);
  assert.equal(surviveGain(15000), 2);
  assert.equal(surviveGain(40000), 4);
  assert.equal(surviveGain(75000), 10);
  assert.equal(surviveGain(95000), 12);
  assert.equal(surviveGain(-5), 0);
  assert.equal(RULES.wholeBonus, 5);
  assert.equal(RULES.findGain, 3);
});

test('places: ties share a place and the next one skips', () => {
  const roster = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, n: id, b: 0, c: i }));
  const rows = rankScores(roster, { a: 5, b: 9, c: 9, d: 2, e: 5 });
  assert.deepEqual(rows.map((r) => [r.id, r.place]), [['b', 1], ['c', 1], ['a', 3], ['e', 3], ['d', 5]]);
  const zero = rankScores(roster, {});
  assert.ok(zero.every((r) => r.place === 1));
  assert.equal(rankScores(roster, { a: 1 })[0].id, 'a');
});

test('awards: Ghost is the longest unfound, Bloodhound the most finds, none when nobody earned one', () => {
  const roster = ['a', 'b', 'c'].map((id, i) => ({ id, n: id, b: 0, c: i }));
  const awards = pickAwards(roster, { unf: { a: 10000, b: 90000, c: 0 }, finds: { a: 2, b: 0, c: 5 } });
  assert.deepEqual(awards, [{ k: 'ghost', id: 'b', v: 90 }, { k: 'hound', id: 'c', v: 5 }]);
  assert.deepEqual(pickAwards(roster, { unf: { a: 0, b: 0, c: 0 }, finds: { a: 0, b: 0, c: 0 } }), []);
  const tie = pickAwards(roster, { unf: { a: 5000, b: 5000, c: 0 }, finds: {} });
  assert.equal(tie[0].id, 'a', 'a tie goes to the earlier in the roster');
});

test('roles come from the record', () => {
  const G = { seek: ['s'], found: { f: 1000 } };
  assert.equal(roleOf(G, 's'), 'seeker');
  assert.equal(roleOf(G, 'f'), 'found');
  assert.equal(roleOf(G, 'h'), 'hider');
  assert.equal(roleOf(G, '__proto__'), 'hider');
  assert.equal(roleOf(G, 'constructor'), 'hider');
  assert.equal(roleOf(null, 'x'), 'none');
});

test('seeded randomness repeats', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
  assert.equal(seedOf(7), 7);
  assert.equal(seedOf('abc'), seedOf('abc'));
  assert.ok(Number.isInteger(seedOf(undefined)));
});

test('place words', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(placeWord), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
