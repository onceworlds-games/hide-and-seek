// The 20 Hz view the host broadcasts: the chassis pose, four feet with their state and target,
// the cargo, the balance readouts. Quantized to centimetres, validated on the way in (any page
// can send anything), and interpolated 100 ms behind on the clients.
import { ST } from '../sim/walker.js';

const q = (v, s = 100) => Math.round(v * s);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function encodeView(sim) {
  const w = sim.w;
  return {
    type: 'snap',
    t: q(w.t, 1000),
    b: [q(w.x), q(w.y), q(w.z), q(w.yaw, 1000), q(w.pitch, 1000), q(w.roll, 1000), q(w.vx), q(w.vz)],
    l: w.legs.map((l) => [l.st, q(l.fx), q(l.fy), q(l.fz), q(l.tx), q(l.ty), q(l.tz), (l.valid ? 1 : 0) | (l.absent ? 2 : 0) | (l.slipping ? 4 : 0), q(l.sink), q(l.brace, 10)]),
    c: [q(w.cargo.aF, 1000), q(w.cargo.aR, 1000), q(w.cargo.cond), q(w.cargo.tiltDeg, 10)],
    k: [q(w.tip, 10), q(w.tipDirX), q(w.tipDirZ), q(w.tumbling, 100), w.tumbles, q(w.groove, 10), q(w.margin), q(w.comX), q(w.comZ), w.hullN, w.planted, q(w.belly), q(w.grooveStreak, 10)],
    h: Array.from(w.hull.subarray(0, w.hullN * 2), (v) => q(v)),
    r: [w.cp, w.finished ? 1 : 0, w.over ? 1 : 0, q(w.maxX), q(w.windX), q(w.windZ), q(w.gust), q(w.resetCd, 10)],
  };
}

export function blankView() {
  return {
    t: 0, x: 4, y: 2.1, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0,
    tip: 0, tipDirX: 1, tipDirZ: 0, tumbling: 0, tumbles: 0, groove: 0, grooveStreak: 0, margin: 1, comX: 4, comZ: 0, hullN: 0, hull: new Float64Array(8), planted: 4, belly: 0,
    legs: [0, 1, 2, 3].map((i) => ({ i, st: ST.STANCE, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, valid: true, absent: false, slipping: false, sink: 0, brace: 0, stun: 0 })),
    cargo: { aF: 0, aR: 0, cond: 1, tiltDeg: 0, wF: 0, wR: 0 },
    cp: 0, finished: false, over: false, maxX: 4, windX: 0, windZ: 0, gust: 0, resetCd: 0,
  };
}

/** Decode into `v` (a blankView-shaped object). Returns false if the message is malformed. */
export function decodeView(m, v, courseLength) {
  if (!m || !Array.isArray(m.b) || m.b.length < 8 || !Array.isArray(m.l) || m.l.length !== 4 || !Array.isArray(m.c) || !Array.isArray(m.k) || !Array.isArray(m.r)) return false;
  const L = courseLength ?? 1000;
  v.t = clamp(num(m.t) / 1000, 0, 36000);
  v.x = clamp(num(m.b[0]) / 100, 0, L);
  v.y = clamp(num(m.b[1]) / 100, -20, 60);
  v.z = clamp(num(m.b[2]) / 100, -12, 12);
  v.yaw = clamp(num(m.b[3]) / 1000, -4, 4);
  v.pitch = clamp(num(m.b[4]) / 1000, -2, 2);
  v.roll = clamp(num(m.b[5]) / 1000, -2, 2);
  v.vx = clamp(num(m.b[6]) / 100, -30, 30);
  v.vz = clamp(num(m.b[7]) / 100, -30, 30);
  for (let i = 0; i < 4; i++) {
    const a = m.l[i];
    const l = v.legs[i];
    if (!Array.isArray(a) || a.length < 10) return false;
    l.st = [0, 1, 2].includes(a[0]) ? a[0] : 0;
    l.fx = clamp(num(a[1]) / 100, 0, L);
    l.fy = clamp(num(a[2]) / 100, -12, 40);
    l.fz = clamp(num(a[3]) / 100, -12, 12);
    l.tx = clamp(num(a[4]) / 100, 0, L);
    l.ty = clamp(num(a[5]) / 100, -12, 40);
    l.tz = clamp(num(a[6]) / 100, -12, 12);
    const flags = num(a[7]) | 0;
    l.valid = (flags & 1) !== 0;
    l.absent = (flags & 2) !== 0;
    l.slipping = (flags & 4) !== 0;
    l.sink = clamp(num(a[8]) / 100, 0, 1);
    l.brace = clamp(num(a[9]) / 10, 0, 2);
  }
  v.cargo.aF = clamp(num(m.c[0]) / 1000, -2, 2);
  v.cargo.aR = clamp(num(m.c[1]) / 1000, -2, 2);
  v.cargo.cond = clamp(num(m.c[2]) / 100, 0, 1);
  v.cargo.tiltDeg = clamp(num(m.c[3]) / 10, 0, 180);
  v.tip = clamp(num(m.k[0]) / 10, 0, 40);
  v.tipDirX = clamp(num(m.k[1]) / 100, -1, 1);
  v.tipDirZ = clamp(num(m.k[2]) / 100, -1, 1);
  v.tumbling = clamp(num(m.k[3]) / 100, 0, 5);
  v.tumbles = clamp(num(m.k[4]) | 0, 0, 999);
  v.groove = clamp(num(m.k[5]) / 10, 0, 100);
  v.margin = clamp(num(m.k[6]) / 100, -20, 20);
  v.comX = clamp(num(m.k[7]) / 100, 0, L);
  v.comZ = clamp(num(m.k[8]) / 100, -12, 12);
  v.hullN = clamp(num(m.k[9]) | 0, 0, 4);
  v.planted = clamp(num(m.k[10]) | 0, 0, 4);
  v.belly = clamp(num(m.k[11]) / 100, 0, 1);
  v.grooveStreak = clamp(num(m.k[12]) / 10, 0, 36000);
  if (Array.isArray(m.h)) for (let i = 0; i < 8; i++) v.hull[i] = i < m.h.length ? clamp(num(m.h[i]) / 100, -20, L + 20) : 0;
  v.cp = clamp(num(m.r[0]) | 0, 0, 99);
  v.finished = m.r[1] === 1;
  v.over = m.r[2] === 1;
  v.maxX = clamp(num(m.r[3]) / 100, 0, L);
  v.windX = clamp(num(m.r[4]) / 100, -10, 10);
  v.windZ = clamp(num(m.r[5]) / 100, -10, 10);
  v.gust = clamp(num(m.r[6]) / 100, 0, 1);
  v.resetCd = clamp(num(m.r[7]) / 10, 0, 10);
  return true;
}

const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
};
const lerp = (a, b, k) => a + (b - a) * k;

/** v = a + (b - a) * k for everything that moves; states come from the newer view. */
export function lerpView(a, b, k, v) {
  k = clamp(k, 0, 1);
  const teleport = Math.hypot(a.x - b.x, a.z - b.z) > 6; // a respawn: never glide across the map
  const kk = teleport ? 1 : k;
  v.t = lerp(a.t, b.t, k);
  v.x = lerp(a.x, b.x, kk);
  v.y = lerp(a.y, b.y, kk);
  v.z = lerp(a.z, b.z, kk);
  v.yaw = lerpAngle(a.yaw, b.yaw, kk);
  v.pitch = lerp(a.pitch, b.pitch, kk);
  v.roll = lerp(a.roll, b.roll, kk);
  v.vx = b.vx;
  v.vz = b.vz;
  for (let i = 0; i < 4; i++) {
    const la = a.legs[i];
    const lb = b.legs[i];
    const l = v.legs[i];
    const jump = Math.hypot(la.fx - lb.fx, la.fz - lb.fz) > 3;
    const kl = teleport || jump ? 1 : k;
    l.st = lb.st;
    l.fx = lerp(la.fx, lb.fx, kl);
    l.fy = lerp(la.fy, lb.fy, kl);
    l.fz = lerp(la.fz, lb.fz, kl);
    l.tx = lerp(la.tx, lb.tx, kl);
    l.ty = lerp(la.ty, lb.ty, kl);
    l.tz = lerp(la.tz, lb.tz, kl);
    l.valid = lb.valid;
    l.absent = lb.absent;
    l.slipping = lb.slipping;
    l.sink = lb.sink;
    l.brace = lb.brace;
  }
  v.cargo.aF = lerp(a.cargo.aF, b.cargo.aF, k);
  v.cargo.aR = lerp(a.cargo.aR, b.cargo.aR, k);
  v.cargo.cond = b.cargo.cond;
  v.cargo.tiltDeg = b.cargo.tiltDeg;
  v.tip = lerp(a.tip, b.tip, k);
  v.tipDirX = b.tipDirX;
  v.tipDirZ = b.tipDirZ;
  v.tumbling = b.tumbling;
  v.tumbles = b.tumbles;
  v.groove = b.groove;
  v.grooveStreak = b.grooveStreak;
  v.margin = b.margin;
  v.comX = lerp(a.comX, b.comX, kk);
  v.comZ = lerp(a.comZ, b.comZ, kk);
  v.hullN = b.hullN;
  for (let i = 0; i < 8; i++) v.hull[i] = b.hull[i];
  v.planted = b.planted;
  v.belly = b.belly;
  v.cp = b.cp;
  v.finished = b.finished;
  v.over = b.over;
  v.maxX = b.maxX;
  v.windX = b.windX;
  v.windZ = b.windZ;
  v.gust = b.gust;
  v.resetCd = b.resetCd;
  return v;
}

export function copyView(from, to) {
  return lerpView(from, from, 1, to);
}
