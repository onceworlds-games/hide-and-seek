// Segment templates: each writes a stretch of the strip (ground, surfaces, dynamic
// features) from x0 to x0 + its length and returns the length. `ctx` carries the
// terrain, the running elevation, the path and the lists of features.
import { S } from './constants.js';
import { fillRect, fillDisc, VOID_DEPTH } from './terrain.js';
import { wobble } from './rng.js';

const terr = (h) => Math.round(h * 2) / 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function corridor(ctx, x0, x1, halfW, s = S.CLAY, hfn = null) {
  const elev = ctx.elev;
  fillRect(ctx.t, x0, x1, -halfW, halfW, s, hfn ?? elev);
}

function setPath(ctx, x0, x1, fn) {
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(ctx.path.length - 1, Math.ceil(x1)); x++) ctx.path[x] = clamp(fn(x), -9, 9);
}

/** A soft lateral wander for the path. */
const wander = (ctx, x, amp) => amp * wobble(x * 0.35, ctx.seed);

export const TEMPLATES = {
  // ---------- shared ----------
  flat(ctx, x0, tier, rng) {
    const len = 10;
    corridor(ctx, x0, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  check(ctx, x0) {
    const len = 8;
    corridor(ctx, x0, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    ctx.checkpoints.push({ x: x0 + 4, z: 0, y: ctx.elev });
    return len;
  },
  hills(ctx, x0, tier, rng) {
    const len = 22;
    const base = ctx.elev;
    const amp = 0.6 + tier * 0.45;
    const f1 = rng.range(0.25, 0.4);
    const ph = rng.range(0, 6.28);
    const hfn = (x) => base + amp * (0.5 + 0.5 * Math.sin((x - x0) * f1 + ph)); // smooth: a jolting pitch spills cargo
    corridor(ctx, x0, x0 + len, 7, S.CLAY, hfn);
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 1.5));
    ctx.elev = hfn(x0 + len);
    return len;
  },
  mud(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 7);
    const n = 3 + tier * 2;
    for (let i = 0; i < n; i++) {
      const cx = x0 + 3 + ((i + 0.5) * (len - 6)) / n;
      const cz = rng.range(-4.5, 4.5);
      fillDisc(ctx.t, cx, cz, rng.range(1.6, 2.4 + tier * 0.4), S.MUD, ctx.elev - 0.15);
    }
    if (tier >= 2) fillRect(ctx.t, x0 + len - 8, x0 + len - 4, -7, 7, S.MUD, ctx.elev - 0.15); // an unavoidable band
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2.5));
    return len;
  },
  stones(ctx, x0, tier, rng) {
    // Stepping stones over mud (tier 1) or void (tiers 2-3). Two rows for the left and right feet.
    const len = 22;
    const between = tier === 1 ? S.MUD : S.VOID;
    corridor(ctx, x0, x0 + len, 7, between, between === S.VOID ? VOID_DEPTH : ctx.elev - 0.3);
    corridor(ctx, x0, x0 + 3, 7);
    const spacing = 2.4 + tier * 0.25;
    const r = tier === 1 ? 1.8 : 1.35 - (tier - 2) * 0.15;
    let x = x0 + 3 + spacing * 0.6;
    const z0 = rng.range(-2, 2);
    setPath(ctx, x0, x0 + len, (xx) => z0 + wander(ctx, xx, 1.2));
    while (x < x0 + len - 2.5) {
      const pz = ctx.path[Math.min(ctx.path.length - 1, Math.round(x))];
      if (tier === 1) fillDisc(ctx.t, x, pz + rng.range(-0.4, 0.4), r, S.STONE, ctx.elev + 0.1);
      else {
        fillDisc(ctx.t, x, pz - 1.5 + rng.range(-0.3, 0.3), r, S.STONE, ctx.elev + 0.1);
        fillDisc(ctx.t, x + rng.range(-0.6, 0.6), pz + 1.5 + rng.range(-0.3, 0.3), r, S.STONE, ctx.elev + 0.1);
      }
      x += spacing;
    }
    corridor(ctx, x0 + len - 2.5, x0 + len, 7);
    return len;
  },
  ridge(ctx, x0, tier, rng) {
    const len = 24;
    const half = tier === 1 ? 4.5 : tier === 2 ? 3.6 : 3;
    const z0 = rng.range(-1, 1);
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    for (let x = x0; x <= x0 + len; x += 0.5) {
      const pz = z0 + 2.5 * Math.sin((x - x0) * 0.22) * (tier >= 2 ? 1 : 0.4);
      fillRect(ctx.t, x, x + 0.5, pz - half, pz + half, S.CLAY, ctx.elev);
    }
    setPath(ctx, x0, x0 + len, (x) => z0 + 2.5 * Math.sin((x - x0) * 0.22) * (tier >= 2 ? 1 : 0.4));
    corridor(ctx, x0 + len - 2, x0 + len, 7);
    return len;
  },
  // ---------- Salt Pans ----------
  ice(ctx, x0, tier, rng) {
    const len = 22;
    corridor(ctx, x0, x0 + len, 7, S.ICE, ctx.elev);
    corridor(ctx, x0, x0 + 3, 7);
    const islands = 4 - tier;
    for (let i = 0; i < islands; i++) fillDisc(ctx.t, x0 + 6 + i * ((len - 10) / Math.max(1, islands)), rng.range(-3, 3), 1.7, S.CLAY, ctx.elev + 0.05);
    corridor(ctx, x0 + len - 2, x0 + len, 7);
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 1));
    return len;
  },
  wind(ctx, x0, tier, rng) {
    const len = 20;
    const half = 5.5 - tier * 0.7;
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + len, half);
    const side = rng.sign();
    ctx.winds.push({ x0: x0 + 2, x1: x0 + len - 2, z0: -12, z1: 12, dx: tier >= 3 ? -0.4 : 0, dz: side, base: 0.4 + tier * 0.25, gust: 1.1 + tier * 0.5, period: 4.5, phase: rng.range(0, 6.28) });
    setPath(ctx, x0, x0 + len, () => -side * 0.8);
    return len;
  },
  iceridge(ctx, x0, tier, rng) {
    const len = 20;
    const half = 4.2 - tier * 0.4;
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + len, half, S.ICE);
    corridor(ctx, x0, x0 + 2.5, 7);
    corridor(ctx, x0 + len - 2.5, x0 + len, 7);
    if (tier >= 2) ctx.winds.push({ x0: x0 + 4, x1: x0 + len - 4, z0: -12, z1: 12, dx: 0, dz: rng.sign(), base: 0.2, gust: 0.5 + tier * 0.2, period: 5, phase: rng.range(0, 6.28) });
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  // ---------- Foundry ----------
  grates(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 7, S.GRATE, ctx.elev);
    const pools = 1 + tier;
    for (let i = 0; i < pools; i++) fillDisc(ctx.t, x0 + 5 + ((i + 0.5) * (len - 8)) / pools, rng.range(-4, 4), rng.range(1.3, 1.4 + tier * 0.3), S.LAVA, ctx.elev - 0.4);
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2.5));
    return len;
  },
  vents(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 7, S.GRATE, ctx.elev);
    const n = 3 + tier * 2;
    for (let i = 0; i < n; i++) {
      const id = ctx.vents.length;
      const vx = x0 + 4 + ((i + 0.5) * (len - 7)) / n;
      const vz = rng.range(-4.5, 4.5);
      ctx.vents.push({ id, kind: 'vent', x: vx, z: vz, r: 1.3, period: 5.5 - tier * 0.5, phase: rng.range(0, 6.28), on: 1 });
      fillDisc(ctx.t, vx, vz, 1.3, S.GRATE, ctx.elev + 0.05, 1000 + id);
    }
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2));
    return len;
  },
  platforms(ctx, x0, tier, rng) {
    const len = 22;
    corridor(ctx, x0, x0 + len, 7, S.LAVA, ctx.elev - 0.5);
    corridor(ctx, x0, x0 + 3.5, 7, S.GRATE);
    const n = tier === 1 ? 2 : 3;
    const span = len - 7;
    for (let i = 0; i < n; i++) {
      const id = ctx.platforms.length;
      const px = x0 + 3.5 + ((i + 0.5) * span) / n;
      const lateral = i % 2 === 0;
      ctx.platforms.push({ id, kind: 'platform', x: px, z: 0, y: ctx.elev, hl: span / n / 2 - 0.3, hw: 2.8 - tier * 0.25, ax: lateral ? 0 : 0.8 + tier * 0.3, az: lateral ? 1 + tier * 0.3 : 0, speed: 0.35 + tier * 0.1, phase: rng.range(0, 6.28), rot: 0 });
    }
    corridor(ctx, x0 + len - 3.5, x0 + len, 7, S.GRATE);
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  conveyor(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 7, S.GRATE);
    const bands = 2 + tier;
    for (let i = 0; i < bands; i++) {
      const id = ctx.conveyors.length;
      const dir = i % 2 === 0 ? -1 : 1;
      ctx.conveyors.push({ id, dir: dir * (0.45 + tier * 0.2) });
      const bx = x0 + 3 + i * ((len - 6) / bands);
      fillRect(ctx.t, bx, bx + (len - 6) / bands - 0.5, -6, 6, S.CONVEYOR, ctx.elev, id);
    }
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  pistons(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 7, S.GRATE);
    const n = 3 + tier;
    for (let i = 0; i < n; i++) {
      const id = ctx.geysers.length;
      const gx = x0 + 4 + ((i + 0.5) * (len - 7)) / n;
      const gz = rng.range(-3.5, 3.5);
      ctx.geysers.push({ id, kind: 'geyser', x: gx, z: gz, r: 1.4, period: 3.6 - tier * 0.3, phase: rng.range(0, 6.28), hop: true });
      fillDisc(ctx.t, gx, gz, 1.4, S.GRATE, ctx.elev + 0.1, 2000 + id);
    }
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2));
    return len;
  },
  // ---------- Ravine ----------
  crumble(ctx, x0, tier, rng) {
    const len = 22;
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + 3, 7);
    // Two rows of slabs, one per foot track, so a slab only ever carries one foot's timer.
    const pitch = tier === 3 ? 2.2 : 2;
    const slabW = tier === 1 ? 2.0 : tier === 2 ? 1.7 : 1.45;
    for (let x = x0 + 3; x < x0 + len - 3; x += pitch) {
      for (const zc of [-1.5, 1.5]) {
        const id = ctx.stones++;
        fillRect(ctx.t, x, Math.min(x0 + len - 3, x + pitch - 0.5), zc - slabW / 2, zc + slabW / 2, S.CRUMBLE, ctx.elev, id);
      }
    }
    corridor(ctx, x0 + len - 3, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  gap(ctx, x0, tier, rng) {
    const len = 14;
    const g = 2.3 + tier * 0.4;
    corridor(ctx, x0, x0 + len, 7);
    const gx = x0 + 6;
    fillRect(ctx.t, gx, gx + g - 0.5, -12, 12, S.VOID, VOID_DEPTH); // cells are inclusive: exactly g metres of void
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  springs(ctx, x0, tier, rng) {
    const len = 18;
    corridor(ctx, x0, x0 + len, 7);
    const n = 4 + tier * 2;
    for (let i = 0; i < n; i++) fillDisc(ctx.t, x0 + 3 + rng.range(0, len - 6), rng.range(-5, 5), 1.1, S.SPRING, ctx.elev + 0.1);
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2));
    return len;
  },
  rockfall(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 6);
    const n = 1 + tier + (tier > 3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const id = ctx.rocks.length;
      ctx.rocks.push({ id, kind: 'rock', x: x0 + 4 + ((i + 0.5) * (len - 6)) / n, z: rng.range(-3, 3), r: 2.0, period: tier > 3 ? 2.6 : 4.2 - tier * 0.4, phase: rng.range(0, 6.28), lead: tier > 3 ? 1.0 : 1.4 });
    }
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2));
    return len;
  },
  rails(ctx, x0, tier, rng) {
    const len = 20;
    const w = tier === 1 ? 1.7 : tier === 2 ? 1.4 : 1.15;
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + 3, 7);
    fillRect(ctx.t, x0 + 3, x0 + len - 3, -1.5 - w / 2, -1.5 + w / 2, S.STONE, ctx.elev + 0.05);
    fillRect(ctx.t, x0 + 3, x0 + len - 3, 1.5 - w / 2, 1.5 + w / 2, S.STONE, ctx.elev + 0.05);
    corridor(ctx, x0 + len - 3, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  // ---------- Clockwork Hills ----------
  gears(ctx, x0, tier, rng) {
    const len = 24;
    corridor(ctx, x0, x0 + len, 7, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + 3, 7);
    const n = tier === 1 ? 2 : 3;
    const span = len - 6;
    let dir = rng.sign();
    for (let i = 0; i < n; i++) {
      const id = ctx.platforms.length;
      const r = span / n / 2 + 0.6;
      ctx.platforms.push({ id, kind: 'platform', x: x0 + 3 + ((i + 0.5) * span) / n, z: 0, y: ctx.elev, hl: r, hw: r, ax: 0, az: 0, speed: 0, phase: 0, rot: dir * (0.18 + tier * 0.06) });
      dir = -dir;
    }
    corridor(ctx, x0 + len - 3, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  bars(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 6.5);
    const n = Math.min(2, tier);
    for (let i = 0; i < n; i++) {
      const id = ctx.bars.length;
      ctx.bars.push({ id, kind: 'bar', x: x0 + 5 + ((i + 0.5) * (len - 8)) / n, z: 0, len: 5, speed: (0.45 + tier * 0.18) * rng.sign(), phase: rng.range(0, 6.28), swing: false, h: 0.3 });
    }
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  swingbars(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 6.5);
    const n = Math.min(2, tier);
    for (let i = 0; i < n; i++) {
      const id = ctx.bars.length;
      const side = rng.sign();
      ctx.bars.push({ id, kind: 'bar', x: x0 + 5 + ((i + 0.5) * (len - 8)) / n, z: side * 7, len: 9, speed: 0.65 + tier * 0.15, phase: rng.range(0, 6.28), swing: true, h: 0.3 });
    }
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  gates(ctx, x0, tier, rng) {
    const len = 20;
    corridor(ctx, x0, x0 + len, 6);
    // A green wave: every gate in the segment opens one beat after the one before it.
    const n = tier;
    const period = 8.5 - tier * 0.5;
    const base = rng.range(0, 6.28);
    for (let i = 0; i < n; i++) {
      const id = ctx.gates.length;
      ctx.gates.push({ id, kind: 'gate', x: x0 + 5 + i * ((len - 6) / n), period, phase: base - i * period * 0.2, open: 0.5 });
    }
    setPath(ctx, x0, x0 + len, () => 0);
    return len;
  },
  // ---------- Storm Coast ----------
  shore(ctx, x0, tier, rng) {
    const len = 22;
    const base = ctx.elev;
    // A beach that slopes down to the right; the tide covers the low side.
    corridor(ctx, x0, x0 + len, 9, S.SHORE, (x, z) => terr(base - Math.max(0, z + 1) * 0.28));
    corridor(ctx, x0, x0 + 2.5, 7);
    if (!ctx.water) ctx.water = { base: base - 1.1, amp: 0.9 + tier * 0.2, speed: 0.45, phase: rng.range(0, 6.28) };
    ctx.winds.push({ x0: x0 + 2, x1: x0 + len - 2, z0: -12, z1: 12, dx: -0.2, dz: 1, base: 0.3 + tier * 0.2, gust: 0.9 + tier * 0.45, period: 5, phase: rng.range(0, 6.28) });
    setPath(ctx, x0, x0 + len, () => -3);
    return len;
  },
  boulders(ctx, x0, tier, rng) {
    const len = 24;
    corridor(ctx, x0, x0 + len, 6.5);
    const n = 1 + tier;
    for (let i = 0; i < n; i++) {
      const id = ctx.boulders.length;
      ctx.boulders.push({ id, kind: 'boulder', x0: x0 + 1, x1: x0 + len - 1, z: rng.range(-3.5, 3.5), r: 1.2, speed: 4 + tier, phase: rng.range(0, 20), period: 11 - tier });
    }
    setPath(ctx, x0, x0 + len, (x) => wander(ctx, x, 2.5));
    return len;
  },
  stride(ctx, x0, tier, rng) {
    // The Great Stride: pillars over the sea, wind, rising tide. The finale.
    const len = 30;
    corridor(ctx, x0, x0 + len, 9, S.VOID, VOID_DEPTH);
    corridor(ctx, x0, x0 + 3, 7);
    const spacing = 2.6 + Math.min(3, tier) * 0.35 + (tier > 3 ? 0.7 : 0);
    const r = 1.5 - Math.min(3, tier) * 0.15 - (tier > 3 ? 0.35 : 0);
    let x = x0 + 3 + spacing * 0.6;
    setPath(ctx, x0, x0 + len, (xx) => wander(ctx, xx, tier > 3 ? 0 : 1)); // the last stride: two straight rows
    while (x < x0 + len - 3) {
      const pz = ctx.path[Math.min(ctx.path.length - 1, Math.round(x))];
      // sea stacks: the high tide washes over the last ones and makes them slippery (brace on them)
      const top = ctx.elev + (tier >= 4 ? 0.15 : 0.3);
      fillDisc(ctx.t, x, pz - 1.5, r, S.STONE, top);
      fillDisc(ctx.t, x + rng.range(-0.5, 0.5), pz + 1.5, r, S.STONE, top);
      x += spacing;
    }
    corridor(ctx, x0 + len - 3, x0 + len, 7);
    if (!ctx.water) ctx.water = { base: ctx.elev - 0.9, amp: 0.8 + tier * 0.15, speed: 0.5, phase: rng.range(0, 6.28) };
    const wt = Math.min(3, tier);
    ctx.winds.push({ x0: x0 + 3, x1: x0 + len - 3, z0: -12, z1: 12, dx: 0, dz: rng.sign(), base: 0.2 + wt * 0.1, gust: 0.6 + wt * 0.3 + (tier > 3 ? 0.8 : 0), period: 4, phase: rng.range(0, 6.28) });
    return len;
  },
  goal(ctx, x0) {
    const len = 12;
    corridor(ctx, x0, x0 + len, 7);
    setPath(ctx, x0, x0 + len, () => 0);
    ctx.goalX = x0 + 5;
    return len;
  },
};
