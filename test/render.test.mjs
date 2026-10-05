import test from 'node:test';
import assert from 'node:assert/strict';
import { mockCtx, textOutside } from './helpers.mjs';
import { getHouse, HOUSE_IDS } from '../game/maps.js';
import { makeView, clampCamera, renderScene, renderLabels, drawHead, viewScale, screenTransform } from '../game/draw.js';
import * as ui from '../game/ui.js';
import { Fx } from '../game/fx.js';
import { CONES, COLORS } from '../game/rules.js';
import { visibility } from '../game/geometry.js';
import { runPoster } from '../game/poster.js';

const spots = (h) => h.spots.map(() => ({ occ: null, open: 0, wob: 0, hot: false, mine: false, label: '', fill: '' }));
const char = (i, x, y, o = {}) => ({ id: `c${i}`, name: `Name${i}`, x, y, vx: 0, vy: 0, a: 0, color: COLORS[i], role: 'hider', bot: i % 2 === 0, face: i * 977, img: null, you: false, ready: false, alpha: 1, sq: 0, pop: 1, walk: i, phase: i, emote: '', draw: true, peek: -1, arrow: false, bubble: '', cheer: false, ...o });

function clean(ctx, label) {
  assert.deepEqual(ctx.__info.bad, [], `${label}: a drawing call got NaN or Infinity`);
  assert.ok(ctx.__info.calls > 20, `${label}: it drew something`);
}

test('the view scale is about 16 by 9 units and never tiny', () => {
  assert.ok(Math.abs(viewScale(1280, 720) - 80) < 1e-9);
  assert.ok(viewScale(844, 390) >= 40 && viewScale(844, 390) < 44);
  assert.equal(viewScale(300, 200), 22);
  assert.ok(viewScale(390, 844) === 39);
});

test('the camera stays inside the house, and centres on a house smaller than the view', () => {
  const h = getHouse('cozy');
  const cam = { x: -50, y: 99 };
  const v = makeView(1280, 720, 1, cam, null);
  clampCamera(v, h, cam);
  assert.ok(cam.x >= 0 && cam.x <= h.w && cam.y >= 0 && cam.y <= h.h);
  const tiny = { w: 5, h: 4 };
  const c2 = { x: 3, y: 3 };
  clampCamera(makeView(1280, 720, 1, c2, null), tiny, c2);
  assert.deepEqual([c2.x, c2.y], [2.5, 2], 'a house smaller than the view is centred');
});

test('the world draws in both houses with every kind of character state, nothing NaN', () => {
  for (const id of HOUSE_IDS) {
    const house = getHouse(id);
    const ctx = mockCtx();
    const st = spots(house);
    st[0].open = 0.7;
    st[1].wob = 1;
    st[2].hot = true;
    st[2].label = 'Hide';
    st[3].label = 'shhh';
    st[3].fill = '#bfe3ff';
    const fx = new Fx();
    fx.confetti(10, 10, 40);
    fx.sparks(10, 10);
    fx.puff(11, 10);
    fx.dust(12, 10);
    fx.ring(10, 10);
    fx.text(10, 10, 'FOUND YOU!');
    fx.addTrauma(1);
    fx.update(0.05);
    const chars = [
      char(0, 8, 8, { you: true, arrow: true, vx: 3, vy: 1 }),
      char(1, 9, 8, { role: 'seeker', a: 1 }),
      char(2, 10, 8, { role: 'found', a: -2, emote: 'surprised' }),
      char(3, 11, 8, { emote: 'laugh', cheer: true, pop: 1.3, sq: 0.2 }),
      char(4, 12, 8, { ready: true, alpha: 0.5, bubble: 'zzz' }),
      char(5, 0, 0, { peek: 0 }),
      char(6, 14, 8, { draw: false }),
      char(7, 15, 8, { emote: 'weird' }),
    ];
    const cone = CONES.seeker;
    const poly = [];
    visibility(9, 8, 1, cone, house.walls, poly);
    for (const dim of [null, { x: 9, y: 8, cone, poly, alpha: 0.84 }]) {
      for (const blind of [false, true]) {
        const v = makeView(1280, 720, 2, { x: 10, y: 8 }, fx.shake(1));
        renderScene(ctx, v, { house, t: 1.5, spots: st, chars, beams: [{ x: 9, y: 8, a: 1, cone, poly, alpha: 1 }], dim, blind, fx });
        renderLabels(ctx, v, { house, t: 1.5, spots: st, chars, fx });
      }
    }
    clean(ctx, `${id} world`);
    assert.ok(ctx.__info.texts.includes('Name0') && ctx.__info.texts.includes('Hide') && ctx.__info.texts.includes('YOU'));
    assert.ok(!ctx.__info.texts.includes('Name6'), 'a character left out has no name tag');
  }
});

test('phone and portrait sizes draw too', () => {
  const house = getHouse('mansion');
  for (const [W, H] of [[844, 390], [667, 375], [390, 844], [320, 480], [2000, 1200]]) {
    const ctx = mockCtx();
    const cam = { x: 22, y: 14 };
    const v = makeView(W, H, 2, cam, null);
    clampCamera(v, house, cam);
    v.cx = cam.x;
    v.cy = cam.y;
    renderScene(ctx, v, { house, t: 0, spots: spots(house), chars: [char(0, 22, 14, { you: true })], beams: [], dim: null, blind: false, fx: null });
    clean(ctx, `${W}x${H}`);
  }
});

test('heads draw as avatars (when loaded) and as generated faces', () => {
  const ctx = mockCtx();
  const loaded = { complete: true, naturalWidth: 120, naturalHeight: 88 };
  drawHead(ctx, char(1, 0, 0, { img: loaded }), 50, 50, 20);
  drawHead(ctx, char(2, 0, 0, { img: { complete: false, naturalWidth: 0 } }), 50, 50, 20);
  for (const emote of ['', 'surprised', 'laugh', 'cheer']) for (let i = 0; i < 8; i++) drawHead(ctx, char(i, 0, 0, { emote, bot: i % 2 === 0 }), 50, 50, 20, { t: i });
  clean(ctx, 'heads');
});

test('every screen draws: title, HUD, minimap, banners, countdown, counting, scoreboard, podium, lobby bits', () => {
  const house = getHouse('cozy');
  const all = mockCtx();
  for (const [W, H] of [[1280, 720], [844, 390], [667, 375], [390, 844]]) {
    const ctx = mockCtx();
    const r = ui.drawTitle(ctx, W, H, 1.2, false);
    assert.ok(r.w > 100 && r.h >= 60 && r.x >= 0 && r.x + r.w <= W && r.y + r.h <= H, `PLAY fits at ${W}x${H}: ${JSON.stringify(r)}`);
    assert.ok(r.logoBottom < r.y, `the logo ends (${r.logoBottom}) above the PLAY button (${r.y}) at ${W}x${H}`);
    assert.deepEqual(textOutside(ctx, W, H), [], `title text inside the screen at ${W}x${H}`);
    ui.drawTitle(ctx, W, H, 2, true);
    ui.drawHud(ctx, W, H, { round: 'Round 2/3', secs: 4, tag: 'HIDE', seeker: false, dots: [{ color: '#f00', found: false }, { color: '#0f0', found: true }], score: 12, place: '2nd' }, 1);
    ui.drawHud(ctx, W, H, { round: 'Round 1/3', secs: 60, tag: 'SEEK', seeker: true, dots: [], score: 0, place: '' }, 1);
    ui.drawMinimap(ctx, { house, me: { x: 10, y: 10, color: '#f0f' }, seekers: [{ x: 5, y: 5, found: false }, { x: 6, y: 6, found: true }], x: W - 180, y: 80, w: 150 }, 1);
    for (const age of [0, 0.1, 1, 1.7]) ui.drawBanner(ctx, W, H, { text: 'READY OR NOT!', sub: 'Here I come!', color: '#ff8a1f', age, dur: 1.9 });
    ui.drawBanner(ctx, W, H, { text: 'HIDE!', sub: '', color: '#38c96b', age: 0.5, dur: 1.5 });
    for (const t of ['3', '2', '1', 'GO!']) ui.drawCountdown(ctx, W, H, t, 0.2);
    ui.drawCounting(ctx, W, H, 2, 14, '#ffe27a');
    ui.drawChips(ctx, W, H, [{ id: 'rounds', label: 'Rounds', value: '3' }, { id: 'map', label: 'House', value: 'Big Mansion' }], true, 1, new ui.Buttons(), () => {});
    ui.drawChips(ctx, W, H, [{ id: 'rounds', label: 'Rounds', value: 'Everyone' }], false, 1, new ui.Buttons(), () => {});
    ui.drawHint(ctx, W, H, "Hide before you're found!", 1);
    ui.drawWatching(ctx, W, H, 1);
    const rows = Array.from({ length: 10 }, (_, i) => ({ ch: char(i, 0, 0), name: `Player${i}`, score: 20 - i * 2, gain: i % 3 === 0 ? 7 : 0, you: i === 3 }));
    for (const age of [0, 1, 2, 4]) ui.drawScoreboard(ctx, W, H, { rows, title: 'Round 2', age }, 1);
    ui.drawScoreboard(ctx, W, H, { rows: rows.slice(0, 6), title: 'Final round', age: 3 }, 1);
    const order = Array.from({ length: 6 }, (_, i) => ({ ch: char(i, 0, 0), name: `P${i}`, score: 30 - i, place: i < 2 ? 1 : i + 1 }));
    const awards = [{ k: 'ghost', ch: char(1, 0, 0), name: 'P1', v: 40 }, { k: 'hound', ch: char(2, 0, 0), name: 'P2', v: 5 }];
    for (const age of [0, 0.5, 2, 9]) ui.drawPodium(ctx, W, H, { order, awards, you: { place: 5, text: '5th' }, age }, 1);
    ui.drawPodium(ctx, W, H, { order: order.slice(0, 2), awards: [], you: null, age: 9 }, 1, true);
    ui.drawPodium(ctx, W, H, { order: [], awards: [], you: null, age: 9 }, 1);
    assert.deepEqual(textOutside(ctx, W, H), [], `text inside the screen at ${W}x${H}`);
    all.__info.calls += ctx.__info.calls;
    all.__info.bad.push(...ctx.__info.bad);
    all.__info.texts.push(...ctx.__info.texts);
  }
  clean(all, 'screens');
  assert.ok(all.__info.texts.includes('PLAY') && all.__info.texts.includes('Counting!'));
});

test('buttons find what was tapped', () => {
  const b = new ui.Buttons();
  let hit = '';
  b.add('a', 10, 10, 50, 50, () => (hit = 'a'));
  b.add('b', 40, 40, 50, 50, () => (hit = 'b'));
  assert.ok(b.tap(20, 20));
  assert.equal(hit, 'a');
  assert.ok(b.tap(50, 50));
  assert.equal(hit, 'b', 'the one drawn last is on top');
  assert.ok(!b.tap(200, 200));
  b.reset();
  assert.ok(!b.tap(20, 20));
});

test('every store poster draws and says it is ready', async () => {
  for (const name of ['cover', 'action', 'win', 'icon', 'badge-first-win', 'badge-master-hider', 'badge-eagle-eye', 'badge-sleepover', 'badge-nonsense', 'nonsense']) {
    const ctx = mockCtx();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
    globalThis.document = { getElementById: () => canvas, body: { style: {}, dataset: {} }, fonts: { load: async () => {}, ready: Promise.resolve() } };
    await runPoster(name);
    assert.equal(document.body.dataset.ready, '1', `${name} ready`);
    const size = name === 'icon' ? 512 : name.startsWith('badge-') ? 256 : 1280;
    assert.equal(canvas.width, size, `${name} size`);
    assert.equal(canvas.height, name === 'icon' ? 512 : name.startsWith('badge-') ? 256 : 720);
    assert.deepEqual(ctx.__info.bad, [], `${name}: NaN in a drawing call`);
    if (name === 'cover') assert.ok(ctx.__info.texts.includes('SEEK') && ctx.__info.texts.includes('HIDE AND'));
    if (name === 'win') assert.deepEqual(ctx.__info.texts.filter((t) => !['1', '2', '3'].includes(t)), [], 'win has only the place numbers');
    if (name === 'action' || name === 'icon' || name.startsWith('badge-')) assert.deepEqual(ctx.__info.texts, [], `${name} has no text`);
  }
  delete globalThis.document;
});

test('posters are the same every time (a fixed seed)', async () => {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const log = [];
    const ctx = new Proxy({ canvas: {}, __info: { calls: 0, texts: [], bad: [] } }, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * 11 });
        if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...a) => log.push(`${String(p)}(${a.map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(',')})`);
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    });
    const canvas = { style: {}, getContext: () => ctx };
    globalThis.document = { getElementById: () => canvas, body: { style: {}, dataset: {} }, fonts: { load: async () => {}, ready: Promise.resolve() } };
    await runPoster('win');
    runs.push(log.join('|'));
  }
  delete globalThis.document;
  assert.equal(runs[0], runs[1]);
  assert.ok(runs[0].length > 1000);
});

test('screenTransform exists for the poster and the game', () => {
  const ctx = mockCtx();
  screenTransform(ctx, { pr: 2 });
  assert.ok(ctx.__info.calls >= 1);
});

test('nothing important is drawn in the top-left 130 x 56 (the platform buttons) or in the bottom corners during play', () => {
  const house = getHouse('cozy');
  for (const [W, H] of [[1280, 720], [844, 390], [667, 375]]) {
    const ctx = mockCtx();
    ui.drawHud(ctx, W, H, { round: 'Round 2/3', secs: 44, tag: 'HIDE', seeker: false, dots: [{ color: '#f00', found: false }, { color: '#0f0', found: true }], score: 12, place: '2nd' }, 1);
    ui.drawMinimap(ctx, { house, me: { x: 10, y: 10, color: '#f0f' }, seekers: [], x: W - 176, y: 82, w: 160 }, 1);
    ui.drawChips(ctx, W, H, [{ id: 'rounds', label: 'Rounds', value: '3' }, { id: 'map', label: 'House', value: 'Big Mansion' }], true, 1, new ui.Buttons(), () => {});
    ui.drawBanner(ctx, W, H, { text: 'READY OR NOT!', sub: 'Here I come!', color: '#ff8a1f', age: 0.6, dur: 1.9 });
    ui.drawCounting(ctx, W, H, 2, 14, '#ffe27a');
    for (const t of ctx.__info.at) {
      const w = t.text.length * t.size * 0.5;
      const left = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
      assert.ok(!(left < 130 && t.y - t.size / 2 < 56), `"${t.text}" sits in the platform's corner at ${W}x${H}`);
      assert.ok(!(t.y + t.size / 2 > H - 90 && (left < 190 || left + w > W - 190)) || t.text === 'Counting!', `"${t.text}" sits in a bottom corner (${Math.round(t.x)},${Math.round(t.y)}) at ${W}x${H}`);
    }
  }
});

test('zoomed out so that every room and every piece of furniture is drawn (all kinds, all four fronts, open and wobbling)', () => {
  for (const id of HOUSE_IDS) {
    const house = getHouse(id);
    const ctx = mockCtx();
    const st = spots(house);
    st.forEach((s, i) => {
      s.open = (i % 3) / 2;
      s.wob = (i % 2) * 0.8;
      s.hot = i % 4 === 0;
      s.label = i % 5 === 0 ? 'Search' : '';
    });
    const chars = house.spots.slice(0, 6).map((s, i) => char(i, 0, 0, { peek: s.i }));
    const v = makeView(1000, 700, 1, { x: house.w / 2, y: house.h / 2 }, null);
    v.scale = 16;
    v.x0 = -50;
    v.y0 = -50;
    v.x1 = 100;
    v.y1 = 100;
    renderScene(ctx, v, { house, t: 2.2, spots: st, chars, beams: [], dim: null, blind: false, fx: null });
    assert.deepEqual(ctx.__info.bad, [], `${id}: NaN while drawing everything`);
    assert.ok(ctx.__info.calls > 1500, `${id}: the whole house was drawn (${ctx.__info.calls} calls)`);
    const kinds = new Set(house.decor.map((f) => f.kind));
    assert.ok(kinds.size >= 12, `${id}: a good mix of furniture (${[...kinds].join(',')})`);
  }
});
