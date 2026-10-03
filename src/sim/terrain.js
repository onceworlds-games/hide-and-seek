// The course is a strip along +x: a height field with a surface id per cell plus a few
// dynamic features (platforms, crumbling slabs, gates, tides) that depend on time and on
// what the walker has done. Everything here is plain data and pure functions.
import { S, CRUMBLE_REGROW } from './constants.js';

export const CELL = 0.5;
export const HALF_W = 12;
export const NZ = Math.round((HALF_W * 2) / CELL) + 1;
export const VOID_DEPTH = -6;

export function createTerrain(length) {
  const nx = Math.round(length / CELL) + 1;
  const n = nx * NZ;
  const t = {
    length,
    nx,
    nz: NZ,
    h: new Float32Array(n),
    s: new Uint8Array(n),
    f: new Int16Array(n),
  };
  t.f.fill(-1);
  // The strip is a chasm until a template paints ground on it: nothing walkable appears by accident.
  t.s.fill(S.VOID);
  t.h.fill(VOID_DEPTH);
  return t;
}

export const cellIndex = (t, ix, iz) => ix * t.nz + iz;
export const toIx = (x) => Math.round(x / CELL);
export const toIz = (z) => Math.round((z + HALF_W) / CELL);

export function setCell(t, ix, iz, h, s, f = -1) {
  if (ix < 0 || ix >= t.nx || iz < 0 || iz >= t.nz) return;
  const i = ix * t.nz + iz;
  t.h[i] = h;
  t.s[i] = s;
  t.f[i] = f;
}

/** Fill the rectangle [x0,x1] x [z0,z1] (metres) with a surface and a height (or a height function). */
export function fillRect(t, x0, x1, z0, z1, s, h, f = -1) {
  const ix0 = Math.max(0, toIx(x0));
  const ix1 = Math.min(t.nx - 1, toIx(x1));
  const iz0 = Math.max(0, toIz(z0));
  const iz1 = Math.min(t.nz - 1, toIz(z1));
  const fn = typeof h === 'function';
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const i = ix * t.nz + iz;
      t.h[i] = fn ? h(ix * CELL, iz * CELL - HALF_W) : h;
      t.s[i] = s;
      t.f[i] = f;
    }
  }
}

/** Fill a disc: a stepping stone, a mud puddle, a vent. */
export function fillDisc(t, cx, cz, r, s, h, f = -1) {
  const ix0 = Math.max(0, toIx(cx - r));
  const ix1 = Math.min(t.nx - 1, toIx(cx + r));
  const iz0 = Math.max(0, toIz(cz - r));
  const iz1 = Math.min(t.nz - 1, toIz(cz + r));
  const fn = typeof h === 'function';
  const r2 = r * r;
  for (let ix = ix0; ix <= ix1; ix++) {
    const dx = ix * CELL - cx;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = iz * CELL - HALF_W - cz;
      if (dx * dx + dz * dz > r2) continue;
      const i = ix * t.nz + iz;
      t.h[i] = fn ? h(ix * CELL, iz * CELL - HALF_W) : h;
      t.s[i] = s;
      t.f[i] = f;
    }
  }
}

/** Raw stored height, bilinear. Outside the strip: a deep drop. */
export function staticHeight(t, x, z) {
  const fx = x / CELL;
  const fz = (z + HALF_W) / CELL;
  if (fx < 0 || fz < 0 || fx > t.nx - 1 || fz > t.nz - 1) return VOID_DEPTH;
  const ix = Math.min(t.nx - 2, Math.floor(fx));
  const iz = Math.min(t.nz - 2, Math.floor(fz));
  const ax = fx - ix;
  const az = fz - iz;
  const i = ix * t.nz + iz;
  let h00 = t.h[i];
  let h10 = t.h[i + t.nz];
  let h01 = t.h[i + 1];
  let h11 = t.h[i + t.nz + 1];
  // A cell beside a pit keeps its own height: a void corner never drags the ground down.
  const v00 = t.s[i] === S.VOID;
  const v10 = t.s[i + t.nz] === S.VOID;
  const v01 = t.s[i + 1] === S.VOID;
  const v11 = t.s[i + t.nz + 1] === S.VOID;
  if (v00 || v10 || v01 || v11) {
    const ni = Math.round(fx) * t.nz + Math.round(fz);
    if (t.s[ni] === S.VOID) return VOID_DEPTH;
    let top = -Infinity;
    if (!v00) top = Math.max(top, h00);
    if (!v10) top = Math.max(top, h10);
    if (!v01) top = Math.max(top, h01);
    if (!v11) top = Math.max(top, h11);
    if (v00) h00 = top;
    if (v10) h10 = top;
    if (v01) h01 = top;
    if (v11) h11 = top;
  }
  return (h00 * (1 - ax) + h10 * ax) * (1 - az) + (h01 * (1 - ax) + h11 * ax) * az;
}

export function staticSurface(t, x, z) {
  const ix = toIx(x);
  const iz = toIz(z);
  if (ix < 0 || iz < 0 || ix >= t.nx || iz >= t.nz) return S.VOID;
  return t.s[ix * t.nz + iz];
}

export function staticFeature(t, x, z) {
  const ix = toIx(x);
  const iz = toIz(z);
  if (ix < 0 || iz < 0 || ix >= t.nx || iz >= t.nz) return -1;
  return t.f[ix * t.nz + iz];
}

/**
 * Sample the ground at (x, z) at time `t` given the run's dynamic state (`dyn`).
 * Writes { h, s, f, platform } into `out` and returns it. No allocation.
 */
export function sample(course, dyn, time, x, z, out) {
  const t = course.terrain;
  let s = staticSurface(t, x, z);
  let h = staticHeight(t, x, z);
  let f = staticFeature(t, x, z);
  out.platform = -1;
  out.conveyor = 0;
  // Moving platforms cover void: a point inside one stands on it.
  const bucket = course.dynIndex[Math.max(0, Math.min(course.dynIndex.length - 1, Math.floor(x / 10)))];
  if (bucket) {
    for (let k = 0; k < bucket.length; k++) {
      const p = bucket[k];
      if (p.kind !== 'platform') continue;
      const pos = platformPose(p, time, dyn);
      if (p.rot === 0) {
        if (x >= pos.x - p.hl && x <= pos.x + p.hl && z >= pos.z - p.hw && z <= pos.z + p.hw) {
          out.platform = p.id;
          out.h = p.y;
          out.s = S.PLATFORM;
          out.f = p.id;
          return out;
        }
      } else {
        const dx = x - pos.x;
        const dz = z - pos.z;
        if (dx * dx + dz * dz <= p.hl * p.hl) {
          out.platform = p.id;
          out.h = p.y;
          out.s = S.PLATFORM;
          out.f = p.id;
          return out;
        }
      }
    }
  }
  if (s === S.CRUMBLE && f >= 0 && f < dyn.gone.length) {
    const g = dyn.gone[f];
    if (g >= 0 && time - g < CRUMBLE_REGROW) {
      s = S.VOID;
      h = VOID_DEPTH;
    }
  } else if ((s === S.SHORE || s === S.STONE) && course.water) {
    if (h < waterLevel(course, time)) s |= 0x80; // wet: the tide is over it
  } else if (s === S.CONVEYOR && f >= 0) {
    out.conveyor = course.conveyors[f] ? course.conveyors[f].dir : 0;
  }
  out.h = h;
  out.s = s;
  out.f = f;
  return out;
}

const poseScratch = { x: 0, z: 0, angle: 0 };
/** Where a moving platform is at `time` (deterministic from the clock). */
export function platformPose(p, time, dyn, out = poseScratch) {
  const ph = p.phase + time * p.speed;
  if (p.rot !== 0) {
    out.x = p.x;
    out.z = p.z;
    out.angle = time * p.rot;
    return out;
  }
  const w = Math.sin(ph);
  out.x = p.x + p.ax * w;
  out.z = p.z + p.az * w;
  out.angle = 0;
  return out;
}

export function waterLevel(course, time) {
  const w = course.water;
  if (!w) return VOID_DEPTH;
  return w.base + w.amp * Math.sin(time * w.speed + w.phase);
}

/** Height-field gradient (d h / d x, d h / d z) at a point: slopes push low-grip feet downhill. */
export function gradient(t, x, z, out) {
  const e = 0.35;
  const hx1 = staticHeight(t, x + e, z);
  const hx0 = staticHeight(t, x - e, z);
  const hz1 = staticHeight(t, x, z + e);
  const hz0 = staticHeight(t, x, z - e);
  out.x = Math.max(-3, Math.min(3, (hx1 - hx0) / (2 * e)));
  out.z = Math.max(-3, Math.min(3, (hz1 - hz0) / (2 * e)));
  return out;
}

export const isDeadly = (s) => s === S.LAVA || s === S.VOID;

/**
 * The sea is over this ground deeper than a foot can stand in at `time`: a beach under a wave
 * (0.9 m), a sea stack under the tide (0.3 m). Nothing plants there until it surfaces.
 */
export function flooded(course, time, s, h) {
  if (!course.water) return false;
  const b = s & 0x7f;
  if (b !== S.SHORE && b !== S.STONE) return false;
  return waterLevel(course, time) - h > (b === S.SHORE ? 0.9 : 0.3);
}
export const baseSurface = (s) => s & 0x7f;
export const isWet = (s) => (s & 0x80) !== 0;
