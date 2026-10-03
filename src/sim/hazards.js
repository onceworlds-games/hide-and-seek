// Hazards are pure functions of the course and the clock, so every page agrees on them
// without sending a byte: vents, geysers, falling rocks, bars, gates, boulders, wind, tides.

const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;

/** Vents and geysers: 0 off, 1 telegraph (steam, light), 2 firing. `out.p` is the phase 0..1 inside the state. */
export function ventState(v, t, out) {
  const ph = mod(t + v.phase, v.period);
  const on = v.on ?? 1.1;
  const lead = 0.8;
  if (ph >= v.period - on) {
    out.state = 2;
    out.p = (ph - (v.period - on)) / on;
  } else if (ph >= v.period - on - lead) {
    out.state = 1;
    out.p = (ph - (v.period - on - lead)) / lead;
  } else {
    out.state = 0;
    out.p = ph / (v.period - on - lead);
  }
  return out;
}

export function geyserState(g, t, out) {
  const ph = mod(t + g.phase, g.period);
  const on = 0.35;
  const lead = 1;
  if (ph >= g.period - on) {
    out.state = 2;
    out.p = (ph - (g.period - on)) / on;
  } else if (ph >= g.period - on - lead) {
    out.state = 1;
    out.p = (ph - (g.period - on - lead)) / lead;
  } else {
    out.state = 0;
    out.p = 0;
  }
  return out;
}

/** Falling rocks: a shadow grows for `lead` seconds, then the rock lands. `landed` is true on the tick it hits. */
export function rockState(r, t, dt, out) {
  const ph = mod(t + r.phase, r.period);
  const prev = mod(t - dt + r.phase, r.period);
  out.landed = ph < prev; // the phase wrapped: impact at phase 0
  const lead = r.lead ?? 1.4;
  // Shadow in the last `lead` seconds of the period; the rock is visible falling then.
  if (ph >= r.period - lead) {
    out.shadow = (ph - (r.period - lead)) / lead;
    out.height = 14 * (1 - out.shadow) * (1 - out.shadow) + 0.5;
  } else {
    out.shadow = 0;
    out.height = -1;
  }
  out.rest = ph < 1.2 ? 1 - ph / 1.2 : 0; // the rock lies there briefly after impact
  return out;
}

export function barAngle(b, t) {
  if (b.swing) return Math.sin(t * b.speed + b.phase) * 1.1 + Math.PI / 2; // hangs from the side, sweeps the path
  return mod(t * b.speed + b.phase, TAU);
}

/** Gates: true while open. `out.p` is 0..1 inside the open or closed phase, `out.closing` the last 0.8 s of open. */
export function gateState(g, t, out) {
  const ph = mod(t + g.phase, g.period);
  const openFor = g.period * g.open;
  if (ph < openFor) {
    out.open = true;
    out.p = ph / openFor;
    out.closing = openFor - ph < 0.8;
  } else {
    out.open = false;
    out.p = (ph - openFor) / (g.period - openFor);
    out.closing = false;
  }
  return out;
}

/** Rolling boulders: roll from x1 down to x0 (toward the walker) then rest until the next period. Returns false when away. */
export function boulderState(b, t, out) {
  const ph = mod(t + b.phase, b.period);
  const travel = (b.x1 - b.x0) / b.speed;
  if (ph > travel) {
    out.active = false;
    out.x = b.x0 - 5;
    out.z = b.z;
    out.roll = 0;
    return out;
  }
  out.active = true;
  out.x = b.x1 - ph * b.speed;
  out.z = b.z;
  out.roll = (ph * b.speed) / b.r;
  return out;
}

/** The wind at a point: sum of every zone the point is in (gusts on a sine). */
export function windAt(course, t, x, z, out) {
  out.x = 0;
  out.z = 0;
  out.gust = 0;
  const ws = course.winds;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
    const g = Math.max(0, Math.sin(t * (TAU / w.period) + w.phase));
    const str = w.base + w.gust * g * g;
    out.x += w.dx * str;
    out.z += w.dz * str;
    out.gust = Math.max(out.gust, g);
  }
  return out;
}
