// The walker: a kinematic, constraint-based model. Four legs in Stance (planted) or Swing
// (lifted), a chassis pushed by the planted feet and held within their reach, a support
// polygon the centre of mass must stay inside, and a cargo that leans and spills.
import * as C from './constants.js';
import { sample, gradient, platformPose, isDeadly, baseSurface, isWet, flooded, HALF_W } from './terrain.js';
import { ventState, geyserState, rockState, barAngle, gateState, boulderState, windAt } from './hazards.js';
import { lastRespawn, checkpointIndex } from './courses.js';

export const ST = { STANCE: 0, SWING: 1, STUN: 2 };
const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Scratch (no per-tick allocation).
const gS = { h: 0, s: 0, f: -1, platform: -1, conveyor: 0 };
const hipS = { x: 0, y: 0, z: 0 };
const windS = { x: 0, z: 0, gust: 0 };
const gradS = { x: 0, z: 0 };
const hz = { state: 0, p: 0, landed: false, shadow: 0, height: 0, rest: 0, open: true, closing: false, active: false, x: 0, z: 0, roll: 0 };
const poseA = { x: 0, z: 0, angle: 0 };
const poseB = { x: 0, z: 0, angle: 0 };
const pts = new Float64Array(8);
const hullS = new Float64Array(8);

export function makeLeg(i) {
  return {
    i, st: ST.STANCE, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, lx: 0, ly: 0, lz: 0, sw: 0, sink: 0, stun: 0, brace: 0, braceCd: 0,
    platform: -1, surf: 0, grip: 1, pushF: 0, pushR: 0, reach: C.L_MAX, valid: true, snapped: false, sx: 0, sz: 0, hitCd: 0, springT: 0,
    forced: 0, slipping: false, feet: 'std', absent: false, inert: false, burnT: 0, lastWhy: '', slab: -1,
  };
}

/**
 * cfg: { reach, stickRange, gain, tipMult, cargoDamp, gripMult, windMult, feet: [4 ids], missing, inert: [4 bools], giant }
 */
export function createWalker(course, cfg) {
  const w = {
    t: 0, x: course.startX, y: C.HIP_H, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, yawRate: 0, pvx: 0, pvz: 0,
    tip: 0, tipDirX: 1, tipDirZ: 0, tumbling: 0, tumbles: 0, tumbleWhy: '',
    legs: [makeLeg(0), makeLeg(1), makeLeg(2), makeLeg(3)],
    cargo: { aF: 0, aR: 0, wF: 0, wR: 0, cond: 1, spillCd: 0, spills: 0, tiltDeg: 0 },
    planted: 4, margin: 1, comX: 0, comZ: 0, hull: new Float64Array(8), hullN: 0,
    groove: 0, grooveStreak: 0, grooveBest: 0, grooveSum: 0, lastPlantT: -10, lastPlantLeg: -1, lastInterval: 0, steps: 0,
    finished: false, finishT: 0, over: false, overWhy: '', cp: 0, maxX: course.startX, resetCd: 0, belly: 0, airT: 0,
    windX: 0, windZ: 0, gust: 0, gateJam: -1,
    events: [],
    cfg,
  };
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    leg.feet = cfg.feet?.[i] ?? 'std';
    leg.absent = cfg.missing === i;
    leg.inert = !!cfg.inert?.[i];
  }
  placeAt(w, course, { x: course.startX, z: 0, y: 0 }, null);
  return w;
}

export function hipWorld(w, i, out) {
  const f = C.HIPS[i][0];
  const r = C.HIPS[i][1];
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  out.x = w.x + f * cy - r * sy;
  out.z = w.z + f * sy + r * cy;
  out.y = w.y + f * Math.sin(w.pitch) - r * Math.sin(w.roll);
  return out;
}

function placeAt(w, course, spot, dyn) {
  w.x = spot.x;
  w.z = spot.z;
  w.yaw = 0;
  w.pitch = 0;
  w.roll = 0;
  w.vx = w.vy = w.vz = w.yawRate = 0;
  w.pvx = w.pvz = 0;
  w.tip = 0;
  w.belly = 0;
  w.airT = 0;
  w.y = spot.y + C.HIP_H;
  const d = dyn ?? { crumble: new Float32Array(0), gone: new Float32Array(0) };
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    hipWorld(w, i, hipS);
    sample(course, d, w.t, hipS.x, hipS.z, gS);
    leg.st = ST.STANCE;
    leg.fx = hipS.x;
    leg.fz = hipS.z;
    leg.fy = isDeadly(baseSurface(gS.s)) ? spot.y : gS.h;
    leg.tx = leg.fx;
    leg.tz = leg.fz;
    leg.ty = leg.fy;
    leg.sx = leg.fx;
    leg.sz = leg.fz;
    leg.sink = 0;
    leg.stun = 0;
    leg.sw = 0;
    leg.forced = 0;
    leg.platform = -1;
    leg.springT = 0;
    leg.slipping = false;
    leg.slab = -1;
    leg.pushF = leg.pushR = 0;
    leg.reach = w.cfg.reach;
    if (leg.absent) leg.st = ST.STUN;
  }
  w.cargo.aF = w.cargo.aR = w.cargo.wF = w.cargo.wR = 0;
  w.y = spot.y + C.HIP_H;
}

const SURF = C.SURFACES;
function gripOf(w, leg, surf) {
  const base = baseSurface(surf);
  const info = SURF[base] ?? SURF[0];
  let g = info.grip;
  if (isWet(surf) && info.wetGrip) g = info.wetGrip; // the tide is over the beach or the stack
  if (base === C.S.ICE && leg.feet === 'claws') g = C.FEET.claws.iceGrip;
  g *= w.cfg.gripMult;
  if (leg.inert) g *= 0.3;
  if (leg.brace > 0) g *= C.BRACE_MULT;
  return g;
}

/** The foot leaves its slab: the slab heals (a slab only drops under a foot that stays). */
function leaveSlab(w, leg, dyn) {
  if (leg.slab >= 0 && dyn && leg.slab < dyn.crumble.length) {
    let other = false;
    for (let k = 0; k < 4; k++) if (k !== leg.i && w.legs[k].slab === leg.slab && w.legs[k].st === ST.STANCE) other = true;
    if (!other) dyn.crumble[leg.slab] = -1;
  }
  leg.slab = -1;
}

const FOOT_R = 0.25; // the rubber pad's half-width: a foot whose pad still covers ground holds
const padS = { h: 0, s: 0, f: -1, platform: -1, conveyor: 0 };
const PAD_DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4) * FOOT_R, Math.sin((k * Math.PI) / 4) * FOOT_R]);

/**
 * The ground under a foot at (x, z), into gS: its centre, or, when that is over a drop, the nearest
 * edge its pad still covers. Returns 0 when the centre holds, 1..8 for the pad direction that holds
 * (the foot settles onto that edge), -1 when nothing does.
 */
function footing(course, dyn, t, x, z) {
  sample(course, dyn, t, x, z, gS);
  if (!isDeadly(baseSurface(gS.s))) return 0;
  for (let k = 0; k < 8; k++) {
    sample(course, dyn, t, x + PAD_DIRS[k][0], z + PAD_DIRS[k][1], padS);
    const b = baseSurface(padS.s);
    if (!isDeadly(b) && b !== C.S.CRUMBLE) { // a loose slab never takes half a foot
      gS.h = padS.h;
      gS.s = padS.s;
      gS.f = padS.f;
      gS.platform = padS.platform;
      gS.conveyor = padS.conveyor;
      return k + 1;
    }
  }
  return -1;
}

function burn(w, leg, why, dyn) {
  leaveSlab(w, leg, dyn);
  if (why !== 'hit' && leg.st === ST.STANCE) {
    // the machine lurches away from a foot that just lost its footing
    const dx = w.x - leg.fx;
    const dz = w.z - leg.fz;
    const l = Math.hypot(dx, dz) || 1;
    nudgeTip(w, dx / l, dz / l, 5);
    w.cargo.wF += 0.8;
  }
  leg.st = ST.STUN;
  leg.stun = (why === 'hit' ? C.HIT_STUN : C.BURN_STUN) * (why === 'burn' && leg.feet === 'springs' ? C.FEET.springs.stunMult : 1);
  leg.platform = -1;
  leg.sink = 0;
  leg.springT = 0;
  leg.pushF = leg.pushR = 0;
  leg.lastWhy = why;
  w.events.push({ type: why, leg: leg.i, x: leg.fx, y: leg.fy, z: leg.fz });
}

function liftLeg(w, leg, forced, why, dyn) {
  leaveSlab(w, leg, dyn);
  leg.st = ST.SWING;
  leg.sw = 0;
  leg.lx = leg.fx;
  leg.ly = leg.fy;
  leg.lz = leg.fz;
  leg.forced = forced;
  leg.platform = -1;
  leg.sink = 0;
  leg.springT = 0;
  leg.snapped = false;
  leg.pushF = leg.pushR = 0;
  if (why) w.events.push({ type: why, leg: leg.i, x: leg.fx, y: leg.fy, z: leg.fz });
}

function knock(w, leg, dx, dz, dist, why, dyn) {
  if (leg.st === ST.STUN || leg.absent) return;
  const wasPlanted = leg.st === ST.STANCE;
  liftLeg(w, leg, 0.5, why, dyn);
  if (!wasPlanted) {
    leg.lx = leg.fx;
    leg.ly = leg.fy;
    leg.lz = leg.fz;
  }
  leg.tx = leg.fx + dx * dist;
  leg.tz = leg.fz + dz * dist;
  leg.hitCd = 0.8;
}

function registerStep(w, i) {
  const now = w.t;
  const interval = now - w.lastPlantT;
  if (w.lastPlantLeg >= 0 && i !== w.lastPlantLeg && interval >= 0.22 && interval <= 1.7) {
    const steady = w.lastInterval > 0 && Math.abs(interval - w.lastInterval) < 0.3 * w.lastInterval;
    w.groove = Math.min(100, w.groove + (steady ? 9 : 4));
  } else if (i === w.lastPlantLeg) w.groove = Math.max(0, w.groove - 6);
  w.lastInterval = interval;
  w.lastPlantT = now;
  w.lastPlantLeg = i;
  w.steps++;
}

function plant(w, leg, course, dyn) {
  hipWorld(w, leg.i, hipS);
  // Overstretched on release: snap the target in toward the hip until it is within reach.
  let k = 1;
  let dx = leg.tx - hipS.x;
  let dz = leg.tz - hipS.z;
  sample(course, dyn, w.t, leg.tx, leg.tz, gS);
  let dy = gS.h - hipS.y;
  if (dx * dx + dy * dy + dz * dz > leg.reach * leg.reach) {
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 7; it++) {
      const mid = (lo + hi) / 2;
      const px = hipS.x + dx * mid;
      const pz = hipS.z + dz * mid;
      sample(course, dyn, w.t, px, pz, gS);
      const ddy = gS.h - hipS.y;
      if ((dx * mid) ** 2 + ddy * ddy + (dz * mid) ** 2 <= leg.reach * leg.reach) lo = mid;
      else hi = mid;
    }
    k = lo;
    leg.tx = hipS.x + dx * k;
    leg.tz = hipS.z + dz * k;
    sample(course, dyn, w.t, leg.tx, leg.tz, gS);
    // A snap-in never ends in a pit: keep coming in toward the hip until the ground holds.
    let tries = 0;
    while (isDeadly(baseSurface(gS.s)) && tries < 10 && k > 0.05) {
      k = Math.max(0, k - 0.1);
      leg.tx = hipS.x + dx * k;
      leg.tz = hipS.z + dz * k;
      sample(course, dyn, w.t, leg.tx, leg.tz, gS);
      tries++;
    }
    if (isDeadly(baseSurface(gS.s))) {
      // nothing within reach holds a foot: the leg stays up (the target shows as bad)
      leg.tx = hipS.x + dx;
      leg.tz = hipS.z + dz;
      leg.valid = false;
      w.events.push({ type: 'nofoot', leg: leg.i });
      return;
    }
    leg.snapped = true;
    w.events.push({ type: 'snap', leg: leg.i, x: leg.tx, y: gS.h, z: leg.tz });
  }
  // the pad catches an edge the centre missed: the foot settles onto it
  const pad = footing(course, dyn, w.t, leg.tx, leg.tz);
  if (pad > 0) {
    leg.tx += PAD_DIRS[pad - 1][0];
    leg.tz += PAD_DIRS[pad - 1][1];
  }
  const base = baseSurface(gS.s);
  leg.fx = leg.tx;
  leg.fz = leg.tz;
  leg.fy = gS.h;
  if (isDeadly(base)) return burn(w, leg, base === C.S.LAVA ? 'burn' : 'fall', dyn);
  if (flooded(course, w.t, gS.s, gS.h)) return burn(w, leg, 'soak', dyn);
  leg.st = ST.STANCE;
  leg.platform = gS.platform;
  leg.surf = gS.s;
  leg.sink = 0;
  leg.springT = 0;
  leg.slipping = false;
  leg.sw = 0;
  leg.forced = 0;
  if (base === C.S.CRUMBLE && gS.f >= 0 && gS.f < dyn.crumble.length) {
    leg.slab = gS.f;
    if (dyn.crumble[gS.f] < 0) dyn.crumble[gS.f] = w.t;
    w.events.push({ type: 'crack', leg: leg.i, x: leg.fx, y: leg.fy, z: leg.fz, slab: gS.f });
  }
  if (SURF[base]?.safe && base !== C.S.CRUMBLE && gS.platform < 0 && gS.f < 1000) {
    leg.sx = leg.fx;
    leg.sz = leg.fz;
  }
  registerStep(w, leg.i);
  w.events.push({ type: 'plant', leg: leg.i, surf: base, wet: isWet(gS.s), x: leg.fx, y: leg.fy, z: leg.fz });
}

function stepLeg(w, i, course, dyn, inp, dt) {
  const leg = w.legs[i];
  if (leg.absent) return;
  hipWorld(w, i, hipS);
  leg.braceCd = Math.max(0, leg.braceCd - dt);
  if (leg.brace > 0) leg.brace -= dt;
  if (leg.hitCd > 0) leg.hitCd -= dt;
  if (inp.brace && leg.braceCd <= 0 && leg.brace <= 0 && leg.st !== ST.STUN) {
    leg.brace = C.BRACE_T;
    leg.braceCd = C.BRACE_T + C.BRACE_CD;
    w.events.push({ type: 'brace', leg: i });
  }
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  let tf = inp.y;
  let tr = inp.x;
  const m = Math.hypot(tf, tr);
  if (m > 1) {
    tf /= m;
    tr /= m;
  }
  if (leg.st === ST.STUN) {
    leg.stun -= dt;
    // The foot is pulled back under the hip while the leg smokes.
    const e = 1 - Math.exp(-6 * dt);
    leg.fx += (hipS.x - leg.fx) * e;
    leg.fz += (hipS.z - leg.fz) * e;
    leg.fy += (hipS.y - 1.2 - leg.fy) * e;
    if (leg.stun <= 0) {
      leg.st = ST.SWING;
      leg.sw = C.SWING_T;
      leg.forced = 0;
      leg.lx = leg.fx;
      leg.ly = leg.fy;
      leg.lz = leg.fz;
      leg.tx = leg.fx;
      leg.tz = leg.fz;
    }
    return;
  }
  const range = w.cfg.stickRange;
  const dtx = hipS.x + (cy * tf - sy * tr) * range;
  const dtz = hipS.z + (sy * tf + cy * tr) * range;
  if (leg.st === ST.STANCE) {
    // (a slab that gave way drops its foot: the pad only catches edges a foot slides to)
    const dropped = leg.slab >= 0 && leg.slab < dyn.gone.length && dyn.gone[leg.slab] >= 0;
    const pad = dropped ? -1 : footing(course, dyn, w.t, leg.fx, leg.fz);
    if (dropped) sample(course, dyn, w.t, leg.fx, leg.fz, gS);
    if (pad > 0) {
      leg.fx += PAD_DIRS[pad - 1][0];
      leg.fz += PAD_DIRS[pad - 1][1];
    }
    const base = baseSurface(gS.s);
    if (isDeadly(base)) return burn(w, leg, base === C.S.LAVA ? 'burn' : 'fall', dyn);
    // a wave over the beach knocks a standing foot off; a sea stack under the tide only gets slippery
    if (base === C.S.SHORE && flooded(course, w.t, gS.s, gS.h)) return burn(w, leg, 'soak', dyn);
    leg.surf = gS.s;
    leg.platform = gS.platform;
    leg.fy = gS.h;
    leg.grip = gripOf(w, leg, gS.s);
    if (base === C.S.MUD) leg.sink = Math.min(1, leg.sink + dt * C.MUD_SINK_RATE * (leg.feet === 'pads' ? C.FEET.pads.sinkMult : 1));
    else leg.sink = Math.max(0, leg.sink - dt * 0.5);
    leg.reach = Math.max(C.L_MIN + 0.2, w.cfg.reach * (1 - leg.sink));
    if (leg.reach <= C.MUD_POP_REACH) {
      liftLeg(w, leg, 0.4, 'pop', dyn);
      leg.tx = hipS.x;
      leg.tz = hipS.z;
      return;
    }
    if (base === C.S.SPRING) {
      leg.springT += dt;
      if (leg.springT >= C.SPRING_DELAY) {
        w.vy += C.SPRING_HOP;
        liftLeg(w, leg, C.SPRING_FLY, 'spring', dyn);
        leg.tx = leg.fx + cy * 1.2;
        leg.tz = leg.fz + sy * 1.2;
        return;
      }
    } else leg.springT = 0;
    if (gS.conveyor !== 0) {
      leg.fx += gS.conveyor * C.CONVEYOR_SPEED * dt;
    }
    leg.pushF = leg.inert ? 0 : tf;
    leg.pushR = leg.inert ? 0 : tr;
    if (inp.lift && !leg.inert) {
      liftLeg(w, leg, 0, 'lift', dyn);
      leg.tx = dtx;
      leg.tz = dtz;
    }
    return;
  }
  // Swing: the target follows the stick, the foot flies to it, release plants.
  leg.sw += dt;
  if (leg.forced > 0) leg.forced -= dt;
  // Release plants at the target as it was shown when the button went up (last tick's), never one
  // the body's own motion just moved somewhere else.
  if (leg.sw >= 0.08 && leg.forced <= 0 && ((!inp.lift && !leg.inert) || (leg.inert && leg.sw >= 0.3))) return plant(w, leg, course, dyn);
  const e = 1 - Math.exp(-14 * dt);
  if (leg.forced <= 0) {
    leg.tx += (dtx - leg.tx) * e;
    leg.tz += (dtz - leg.tz) * e;
  }
  // Clamp the target to the stick range around the hip.
  let ox = leg.tx - hipS.x;
  let oz = leg.tz - hipS.z;
  const od = Math.hypot(ox, oz);
  if (od > range) {
    ox *= range / od;
    oz *= range / od;
    leg.tx = hipS.x + ox;
    leg.tz = hipS.z + oz;
  }
  footing(course, dyn, w.t, leg.tx, leg.tz);
  leg.ty = gS.h;
  const tb = baseSurface(gS.s);
  const dyT = gS.h - hipS.y;
  const reachable = od * od + dyT * dyT <= (leg.reach + 0.1) * (leg.reach + 0.1);
  leg.valid = reachable && !isDeadly(tb) && !flooded(course, w.t, gS.s, gS.h);
  const swingT = C.SWING_T * (leg.feet === 'springs' ? C.FEET.springs.swingMult : 1);
  const p = Math.min(1, leg.sw / swingT);
  const s = p * p * (3 - 2 * p);
  leg.fx = leg.lx + (leg.tx - leg.lx) * s;
  leg.fz = leg.lz + (leg.tz - leg.lz) * s;
  const groundTarget = leg.valid ? leg.ty : Math.min(leg.ty, hipS.y - 1.6);
  const baseY = leg.ly + (groundTarget - leg.ly) * s;
  leg.fy = baseY + C.HOVER_H * s + (C.SWING_ARC - C.HOVER_H) * Math.sin(Math.PI * p);
  if (leg.fy > hipS.y - 0.4) leg.fy = hipS.y - 0.4;
}

function bodyDynamics(w, course, dyn, dt) {
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  let sumF = 0;
  let sumR = 0;
  let sumGrip = 0;
  let torque = 0;
  let n = 0;
  let gx = 0;
  let gz = 0;
  let resist = 0;
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (leg.st !== ST.STANCE) continue;
    const g = Math.min(1.3, leg.grip);
    // A foot pushes hardest from under or ahead of its hip; one trailing far behind is at the end of its stroke.
    let gp = g;
    const pm = Math.hypot(leg.pushF, leg.pushR);
    if (pm > 0.01) {
      hipWorld(w, i, hipS);
      const along = ((leg.fx - hipS.x) * (cy * leg.pushF - sy * leg.pushR) + (leg.fz - hipS.z) * (sy * leg.pushF + cy * leg.pushR)) / pm;
      gp *= clamp(1 + along / C.PUSH_STROKE, C.PUSH_MIN, 1);
    }
    sumF += leg.pushF * gp;
    sumR += leg.pushR * gp;
    torque += (C.HIPS[i][0] * leg.pushR - C.HIPS[i][1] * leg.pushF) * gp;
    sumGrip += g;
    resist += g * (leg.feet === 'suction' ? C.FEET.suction.windHold : 1);
    n++;
    // Low-grip feet slide backward under a push.
    const slide = (1 - Math.min(1, g)) * C.SLIDE_RATE * dt;
    if (slide > 0) {
      leg.fx -= (cy * leg.pushF - sy * leg.pushR) * slide;
      leg.fz -= (sy * leg.pushF + cy * leg.pushR) * slide;
      leg.slipping = slide > 0.002;
    } else leg.slipping = false;
    gradient(course.terrain, leg.fx, leg.fz, gradS);
    const slopeMult = (leg.feet === 'suction' ? C.FEET.suction.slopeMult : 1) * (1 - Math.min(1, g));
    gx += -gradS.x * slopeMult;
    gz += -gradS.z * slopeMult;
    // and slide downhill too
    leg.fx += -gradS.x * slopeMult * 0.6 * dt;
    leg.fz += -gradS.z * slopeMult * 0.6 * dt;
  }
  const gain = C.PUSH_GAIN * w.cfg.gain;
  const dF = (sumF * gain) / 4;
  const dR = (sumR * gain) / 4;
  let dvx = cy * dF - sy * dR;
  let dvz = sy * dF + cy * dR;
  windAt(course, w.t, w.x, w.z, windS);
  const windRes = 1 - 0.92 * Math.min(1, resist / 2); // four clay feet barely move; ice drifts; braced ice holds
  w.windX = windS.x * w.cfg.windMult;
  w.windZ = windS.z * w.cfg.windMult;
  w.gust = windS.gust;
  dvx += w.windX * C.WIND_GAIN * windRes;
  dvz += w.windZ * C.WIND_GAIN * windRes;
  if (n > 0) {
    dvx += (gx / n) * C.SLOPE_FORCE;
    dvz += (gz / n) * C.SLOPE_FORCE;
  }
  const k = Math.min(1, C.VEL_DAMP * dt);
  w.vx += (dvx - w.vx) * k;
  w.vz += (dvz - w.vz) * k;
  let dYaw = (torque * C.YAW_GAIN) / 4;
  // Heading follows motion: four people all pushing toward the goal turn the machine toward it (a pure
  // sideways shuffle is slow and awkward), and walking backwards never spins it round.
  const sp = Math.hypot(w.vx, w.vz);
  if (sp > 0.3 && n > 0) {
    let err = Math.atan2(w.vz, w.vx) - w.yaw;
    if (err > Math.PI) err -= 2 * Math.PI;
    else if (err < -Math.PI) err += 2 * Math.PI;
    if (Math.abs(err) < 2.2) dYaw += clamp(err, -1, 1) * C.YAW_ALIGN * Math.min(1, sp);
  }
  w.yawRate += (dYaw - w.yawRate) * Math.min(1, C.YAW_DAMP * dt);
  if (n === 0) {
    w.vx *= 0.9;
    w.vz *= 0.9;
    w.yawRate *= 0.9;
  }
  w.x += w.vx * dt;
  w.z += w.vz * dt;
  w.yaw += w.yawRate * dt;
  if (w.yaw > Math.PI) w.yaw -= 2 * Math.PI;
  else if (w.yaw < -Math.PI) w.yaw += 2 * Math.PI;
  return n;
}

function constraints(w, n) {
  if (n === 0) return;
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < 4; i++) {
      const leg = w.legs[i];
      if (leg.st !== ST.STANCE) continue;
      hipWorld(w, i, hipS);
      const dx = leg.fx - hipS.x;
      const dy = leg.fy - hipS.y;
      const dz = leg.fz - hipS.z;
      const hd = Math.hypot(dx, dz);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (hd < 1e-4) continue;
      const nx = dx / hd;
      const nz = dz / hd;
      const share = clamp(leg.grip, 0.12, 1);
      if (d > leg.reach) {
        // How far the horizontal distance must shrink for the 3D distance to fit.
        const fit = Math.sqrt(Math.max(0, leg.reach * leg.reach - dy * dy));
        const excess = Math.max(0, hd - fit);
        if (excess <= 0) continue;
        w.x += nx * excess * share;
        w.z += nz * excess * share;
        leg.fx -= nx * excess * (1 - share);
        leg.fz -= nz * excess * (1 - share);
        // A hip dragged toward its foot also swings the chassis a little (the body aligns to its feet).
        const cy = Math.cos(w.yaw);
        const sy = Math.sin(w.yaw);
        const dF = nx * cy + nz * sy;
        const dR = -nx * sy + nz * cy;
        w.yaw += (C.HIPS[i][0] * dR - C.HIPS[i][1] * dF) * excess * share * 0.08;
        if (1 - share > 0.05) leg.slipping = true;
        const away = -(w.vx * nx + w.vz * nz);
        if (away > 0) {
          w.vx += nx * away * share * 0.6;
          w.vz += nz * away * share * 0.6;
        }
      } else if (hd < C.L_MIN * 0.5) {
        const excess = C.L_MIN * 0.5 - hd;
        w.x -= nx * excess * share;
        w.z -= nz * excess * share;
        leg.fx += nx * excess * (1 - share);
        leg.fz += nz * excess * (1 - share);
      }
    }
  }
}

function attitude(w, course, dyn, dt) {
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  let n = 0;
  for (let i = 0; i < 4; i++) if (w.legs[i].st === ST.STANCE) n++;
  let targetY;
  let tPitch = 0;
  let tRoll = 0;
  if (n === 0) {
    sample(course, dyn, w.t, w.x, w.z, gS);
    if (isDeadly(baseSurface(gS.s))) {
      w.airT += dt;
      if (w.airT > 0.6) return tumble(w, course, 'fell');
      targetY = w.y - 3 * dt * 6;
    } else {
      w.airT = 0;
      targetY = gS.h + C.BELLY_H;
      w.belly = Math.min(1, w.belly + dt * 3);
    }
  } else {
    w.airT = 0;
    w.belly = Math.max(0, w.belly - dt * 2);
    let avg = 0;
    for (let i = 0; i < 4; i++) if (w.legs[i].st === ST.STANCE) avg += w.legs[i].fy;
    avg /= n;
    targetY = avg + C.HIP_H - (n === 2 ? 0.3 : n === 1 ? 0.8 : 0);
    if (n >= 3) {
      // Fit the plane through the planted feet (body frame).
      let sf = 0;
      let sr = 0;
      let sy2 = 0;
      let sff = 0;
      let srr = 0;
      let sfy = 0;
      let sry = 0;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st !== ST.STANCE) continue;
        const dx = leg.fx - w.x;
        const dz = leg.fz - w.z;
        const f = dx * cy + dz * sy;
        const r = -dx * sy + dz * cy;
        sf += f;
        sr += r;
        sy2 += leg.fy;
        sff += f * f;
        srr += r * r;
        sfy += f * leg.fy;
        sry += r * leg.fy;
      }
      const vf = sff - (sf * sf) / n;
      const vr = srr - (sr * sr) / n;
      const b = vf > 0.3 ? (sfy - (sf * sy2) / n) / vf : 0;
      const c = vr > 0.3 ? (sry - (sr * sy2) / n) / vr : 0;
      tPitch = Math.atan(clamp(b, -1, 1));
      tRoll = Math.atan(clamp(-c, -1, 1));
    } else {
      // Sag toward the unsupported side.
      let px;
      let pz;
      if (n === 2) {
        let a = -1;
        let b = -1;
        for (let i = 0; i < 4; i++) if (w.legs[i].st === ST.STANCE) (a < 0 ? (a = i) : (b = i));
        const la = w.legs[a];
        const lb = w.legs[b];
        const lx = lb.fx - la.fx;
        const lz = lb.fz - la.fz;
        const ll = Math.hypot(lx, lz) || 1;
        // perpendicular toward the COM
        let qx = -lz / ll;
        let qz = lx / ll;
        const side = qx * (w.comX - la.fx) + qz * (w.comZ - la.fz);
        if (side < 0) {
          qx = -qx;
          qz = -qz;
        }
        px = qx;
        pz = qz;
      } else {
        let a = 0;
        for (let i = 0; i < 4; i++) if (w.legs[i].st === ST.STANCE) a = i;
        const la = w.legs[a];
        const l = Math.hypot(w.x - la.fx, w.z - la.fz) || 1;
        px = (w.x - la.fx) / l;
        pz = (w.z - la.fz) / l;
      }
      const ang = C.SAG_ANGLE[n];
      tPitch = -(px * cy + pz * sy) * ang;
      tRoll = (-px * sy + pz * cy) * ang;
    }
  }
  // Lean with the tip angle toward the direction the COM is escaping.
  const tipRad = w.tip / DEG;
  tPitch += -(w.tipDirX * cy + w.tipDirZ * sy) * tipRad;
  tRoll += (-w.tipDirX * sy + w.tipDirZ * cy) * tipRad;
  w.vy += ((targetY - w.y) * C.HEIGHT_K - w.vy * C.HEIGHT_C) * dt;
  w.vy = clamp(w.vy, -25, 25);
  w.y += w.vy * dt;
  // Never through the floor under the body (continuous: the ground is a height field).
  sample(course, dyn, w.t, w.x, w.z, gS);
  if (!isDeadly(baseSurface(gS.s)) && w.y < gS.h + 0.7) {
    w.y = gS.h + 0.7;
    if (w.vy < 0) w.vy = 0;
  }
  const k = Math.min(1, C.TILT_EASE * dt);
  w.pitch += (clamp(tPitch, -1.2, 1.2) - w.pitch) * k;
  w.roll += (clamp(tRoll, -1.2, 1.2) - w.roll) * k;
  return false;
}

function hazardsOnBody(w, course, dyn, dt) {
  const bucket = course.dynIndex[clamp(Math.floor(w.x / 10), 0, course.dynIndex.length - 1)];
  if (!bucket) return;
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  for (let k = 0; k < bucket.length; k++) {
    const o = bucket[k];
    if (o.kind === 'vent') {
      ventState(o, w.t, hz);
      if (hz.state !== 2) continue;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st === ST.STANCE && Math.hypot(leg.fx - o.x, leg.fz - o.z) < o.r) burn(w, leg, 'burn', dyn);
      }
      if (Math.hypot(w.x - o.x, w.z - o.z) < o.r + 0.6 && hz.p < 0.1) {
        w.cargo.wF += 1.5;
        w.vy += 1.5;
      }
    } else if (o.kind === 'geyser') {
      geyserState(o, w.t, hz);
      if (hz.state !== 2) continue;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st === ST.STANCE && Math.hypot(leg.fx - o.x, leg.fz - o.z) < o.r) {
          knock(w, leg, 0, 0, 0, 'geyser', dyn);
          leg.ly = leg.fy;
        }
      }
      if (o.hop && hz.p < 0.1 && Math.hypot(w.x - o.x, w.z - o.z) < o.r + 1) {
        w.vy += 2.5;
        w.cargo.wR += 1;
      }
    } else if (o.kind === 'rock') {
      rockState(o, w.t, dt, hz);
      if (!hz.landed) continue;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st === ST.STANCE && Math.hypot(leg.fx - o.x, leg.fz - o.z) < o.r) burn(w, leg, 'hit', dyn);
      }
      const d = Math.hypot(w.x - o.x, w.z - o.z);
      if (d < o.r + 1.5) {
        const ax = (w.x - o.x) / (d || 1);
        const az = (w.z - o.z) / (d || 1);
        nudgeTip(w, ax, az, 9);
        w.cargo.wF += (ax * cy + az * sy) * 2;
        w.cargo.wR += (-ax * sy + az * cy) * 2;
        w.events.push({ type: 'rockhit', x: o.x, z: o.z });
      }
    } else if (o.kind === 'bar') {
      // A low bar sweeps the ground: it hits planted feet only. Lift the leg as it passes.
      const a = barAngle(o, w.t);
      const bx = Math.cos(a);
      const bz = Math.sin(a);
      const dir = Math.sign(o.swing ? Math.cos(w.t * o.speed + o.phase) : o.speed || 1);
      const tx = -bz * dir;
      const tz = bx * dir;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st !== ST.STANCE || leg.hitCd > 0 || leg.absent) continue;
        const rx = leg.fx - o.x;
        const rz = leg.fz - o.z;
        const along = rx * bx + rz * bz;
        if (along < 0 || along > o.len) continue;
        const perp = Math.abs(rx * bz - rz * bx);
        if (perp < 0.55) {
          knock(w, leg, tx, tz, 1.2, 'bar', dyn);
          leg.forced = 0.35;
          w.vx += tx * 1.0;
          w.vz += tz * 1.0;
          nudgeTip(w, tx, tz, 3);
          w.events.push({ type: 'barhit', leg: i, x: leg.fx, z: leg.fz });
        }
      }
    } else if (o.kind === 'gate') {
      gateState(o, w.t, hz);
      const half = C.CHASSIS_L / 2 + 0.1;
      if (hz.open) continue;
      const front = w.x + half;
      if (front > o.x && front - o.x < 0.7 && w.vx >= -0.01) {
        // A closed gate is a wall for a walker arriving at it (or one that had barely crossed): it holds the front.
        w.x = o.x - half;
        if (w.vx > 0) w.vx = 0;
      } else if (front > o.x && w.x - half < o.x) {
        // It closed on the chassis: the bar rests on the deck (a jolt for the cargo), the walker keeps moving.
        if (w.gateJam !== o.id) {
          w.gateJam = o.id;
          w.cargo.wF += 2.2;
          w.events.push({ type: 'gate', x: o.x, z: 0 });
        }
        continue;
      }
      if (w.gateJam === o.id && (w.x - half > o.x || front < o.x)) w.gateJam = -1;
    } else if (o.kind === 'boulder') {
      boulderState(o, w.t, hz);
      if (!hz.active) continue;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (leg.st === ST.STANCE && leg.hitCd <= 0 && Math.hypot(leg.fx - hz.x, leg.fz - hz.z) < o.r + 0.3) {
          knock(w, leg, -1, 0, 1.4, 'boulder', dyn);
          leg.forced = 0.35;
        }
      }
      const d = Math.hypot(w.x - hz.x, w.z - hz.z);
      if (d < o.r + 1.4 && Math.abs(w.z - hz.z) < o.r + 1.2 && w.boulderCd <= 0) {
        w.vx -= 2;
        nudgeTip(w, -1, 0, 6);
        w.cargo.wF -= 1.5;
        w.boulderCd = 1;
        w.events.push({ type: 'boulderhit', x: hz.x, z: hz.z });
      }
    }
  }
}

function nudgeTip(w, dx, dz, deg) {
  const l = Math.hypot(dx, dz) || 1;
  w.tipDirX = dx / l;
  w.tipDirZ = dz / l;
  w.tip = Math.min(C.TIP_LIMIT + 1, w.tip + deg * w.cfg.tipMult);
}

// Convex hull of up to 4 points (monotone chain). Writes into `out` (x,z pairs), returns the count.
function hull(n, out) {
  if (n <= 2) {
    for (let i = 0; i < n * 2; i++) out[i] = pts[i];
    return n;
  }
  const idx = [0, 1, 2, 3].slice(0, n);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const h = [];
  for (const i of idx) {
    while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  const lower = h.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (h.length >= lower && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  h.pop();
  for (let k = 0; k < h.length; k++) {
    out[k * 2] = pts[h[k] * 2];
    out[k * 2 + 1] = pts[h[k] * 2 + 1];
  }
  return h.length;
}

const near = { x: 0, z: 0 };
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  near.x = ax + vx * t;
  near.z = az + vz * t;
  return Math.hypot(px - near.x, pz - near.z);
}

/** Signed distance of the COM inside the hull (negative outside); sets `near` to the closest boundary point. */
function marginOf(w, n) {
  const cx = w.comX;
  const cz = w.comZ;
  if (n === 1) {
    near.x = hullS[0];
    near.z = hullS[1];
    return -Math.hypot(cx - hullS[0], cz - hullS[1]);
  }
  if (n === 2) return -segDist(cx, cz, hullS[0], hullS[1], hullS[2], hullS[3]);
  let inside = true;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = hullS[i * 2];
    const az = hullS[i * 2 + 1];
    const ex = hullS[j * 2];
    const ez = hullS[j * 2 + 1];
    const cr = (ex - ax) * (cz - az) - (ez - az) * (cx - ax);
    if (cr < 0) inside = false;
    const d = segDist(cx, cz, ax, az, ex, ez);
    if (d < best) {
      best = d;
      bx = near.x;
      bz = near.z;
    }
  }
  near.x = bx;
  near.z = bz;
  return inside ? best : -best;
}

function balance(w, course, dt) {
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  const cargo = C.CARGO[course.cargo] ?? C.CARGO.boulder;
  const mass = cargo.mass * (w.cfg.giant ? 2 : 1);
  const h = cargo.height * (w.cfg.giant ? 1.5 : 1);
  const share = mass / (1 + mass);
  const cF = h * Math.sin(w.cargo.aF + w.pitch) * share;
  const cR = h * Math.sin(w.cargo.aR + w.roll) * share;
  const lean = w.tip * C.TIP_COM_LEAN;
  w.comX = w.x + cy * cF - sy * cR + w.tipDirX * lean;
  w.comZ = w.z + sy * cF + cy * cR + w.tipDirZ * lean;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (leg.st !== ST.STANCE) continue;
    pts[n * 2] = leg.fx;
    pts[n * 2 + 1] = leg.fz;
    n++;
  }
  w.hullN = hull(n, hullS);
  for (let i = 0; i < 8; i++) w.hull[i] = hullS[i];
  w.planted = n;
  let margin = n === 0 ? 1 : marginOf(w, w.hullN);
  w.margin = margin;
  const excess = Math.max(0, -margin - C.COM_MARGIN);
  if (excess > 0 && n > 0) {
    const dx = w.comX - near.x;
    const dz = w.comZ - near.z;
    const l = Math.hypot(dx, dz) || 1;
    w.tipDirX = dx / l;
    w.tipDirZ = dz / l;
    w.tip += Math.min(excess, C.TIP_EXCESS_CAP) * C.TIP_RATE * w.cfg.tipMult * dt;
  } else w.tip = Math.max(0, w.tip - C.TIP_RECOVER * dt);
  if (w.tip > C.TIP_LIMIT) w.tip = C.TIP_LIMIT;
  if (w.tip >= C.TIP_LIMIT) return tumble(w, course, 'tipped');
  return false;
}

function cargoStep(w, course, dt) {
  const cargo = C.CARGO[course.cargo] ?? C.CARGO.boulder;
  const c = w.cargo;
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  const ax = (w.vx - w.pvx) / dt;
  const az = (w.vz - w.pvz) / dt;
  w.pvx = w.vx;
  w.pvz = w.vz;
  const accF = clamp(ax * cy + az * sy, -30, 30);
  const accR = clamp(-ax * sy + az * cy, -30, 30);
  const damp = C.CARGO_C * w.cfg.cargoDamp;
  const massMult = w.cfg.giant ? 1.6 : 1;
  // The cradle levels the cargo against the world (with a lag), gravity nudges it over, accelerations lean it.
  c.wF += (-C.CARGO_K * (c.aF + w.pitch) - damp * c.wF + C.CARGO_INSTAB * massMult * (c.aF + w.pitch) - C.CARGO_LEAN * accF * C.CARGO_K) * dt;
  c.wR += (-C.CARGO_K * (c.aR + w.roll) - damp * c.wR + C.CARGO_INSTAB * massMult * (c.aR + w.roll) - C.CARGO_LEAN * accR * C.CARGO_K) * dt;
  c.wF = clamp(c.wF, -12, 12);
  c.wR = clamp(c.wR, -12, 12);
  c.aF = clamp(c.aF + c.wF * dt, -1.2, 1.2);
  c.aR = clamp(c.aR + c.wR * dt, -1.2, 1.2);
  const tilt = Math.hypot(c.aF + w.pitch, c.aR + w.roll) * DEG;
  c.tiltDeg = tilt;
  c.spillCd = Math.max(0, c.spillCd - dt);
  if (tilt > cargo.limit && c.cond > 0) {
    if (cargo.mode === 'slosh') {
      c.cond = Math.max(0, c.cond - cargo.loss * dt * Math.min(3, tilt / cargo.limit));
      if (c.spillCd <= 0) {
        c.spillCd = 0.6;
        c.spills++;
        w.events.push({ type: 'slosh' });
      }
    } else if (cargo.mode !== 'shift' && c.spillCd <= 0) {
      c.cond = Math.max(0, c.cond - cargo.loss);
      c.spillCd = C.SPILL_COOLDOWN;
      c.spills++;
      w.events.push({ type: 'spill', mode: cargo.mode, cond: c.cond });
    }
  }
}

function tumble(w, course, why) {
  if (w.tumbling > 0) return true;
  w.tumbling = C.TUMBLE_T;
  w.tumbles++;
  w.tumbleWhy = why;
  w.groove = 0;
  w.grooveStreak = 0;
  const cargo = C.CARGO[course.cargo] ?? C.CARGO.boulder;
  w.cargo.cond = Math.max(0, w.cargo.cond - (cargo.mode === 'slosh' ? cargo.loss * 2 : cargo.loss));
  w.cargo.spills++;
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (!leg.absent) leg.st = ST.SWING;
    leg.pushF = leg.pushR = 0;
    leg.slab = -1;
  }
  w.events.push({ type: 'tumble', why, x: w.x, z: w.z });
  return true;
}

export function respawn(w, course, dyn) {
  const spot = lastRespawn(course, w.maxX);
  w.tumbling = 0;
  placeAt(w, course, spot, dyn);
  dyn.crumble.fill(-1);
  dyn.gone.fill(-1);
  w.events.push({ type: 'respawn', x: spot.x, z: spot.z });
  if (w.tumbles >= course.budget && !w.finished) {
    w.over = true;
    w.overWhy = 'tumbles';
    w.events.push({ type: 'over', why: 'tumbles' });
  }
}

/** Anyone may ask: every foot re-planted under its hip (a way out of a locked stance). */
export function resetStance(w, course, dyn) {
  if (w.resetCd > 0 || w.tumbling > 0 || w.over) return false;
  w.resetCd = 3;
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (leg.absent) continue;
    hipWorld(w, i, hipS);
    sample(course, dyn, w.t, hipS.x, hipS.z, gS);
    if (isDeadly(baseSurface(gS.s))) continue;
    leg.st = ST.STANCE;
    leg.fx = hipS.x;
    leg.fz = hipS.z;
    leg.fy = gS.h;
    leg.sink = 0;
    leg.stun = 0;
    leg.platform = gS.platform;
    leg.surf = gS.s;
    leg.forced = 0;
    leg.slab = baseSurface(gS.s) === C.S.CRUMBLE ? gS.f : -1;
  }
  w.events.push({ type: 'reset' });
  return true;
}

function carry(w, course, dyn, dt) {
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (leg.st !== ST.STANCE || leg.platform < 0) continue;
    const p = course.platforms[leg.platform];
    if (!p) {
      leg.platform = -1;
      continue;
    }
    if (p.rot !== 0) {
      const a = p.rot * dt;
      const dx = leg.fx - p.x;
      const dz = leg.fz - p.z;
      leg.fx = p.x + dx * Math.cos(a) - dz * Math.sin(a);
      leg.fz = p.z + dx * Math.sin(a) + dz * Math.cos(a);
    } else {
      platformPose(p, w.t, dyn, poseA);
      platformPose(p, w.t - dt, dyn, poseB);
      leg.fx += poseA.x - poseB.x;
      leg.fz += poseA.z - poseB.z;
    }
  }
}

/** One fixed step. `inputs[i] = { x, y, lift, brace }` per leg, already validated. */
export function stepWalker(w, course, dyn, inputs, dt) {
  w.t += dt;
  w.resetCd = Math.max(0, w.resetCd - dt);
  w.boulderCd = Math.max(0, (w.boulderCd ?? 0) - dt);
  w.gateShove = Math.max(0, (w.gateShove ?? 0) - dt);
  if (w.tumbling > 0) {
    w.tumbling -= dt;
    if (w.tumbling <= 0) respawn(w, course, dyn);
    return;
  }
  if (w.over || w.finished) return;
  carry(w, course, dyn, dt);
  // A slab drops under a foot that stays on it too long, and grows back later.
  for (let i = 0; i < dyn.crumble.length; i++) {
    if (dyn.crumble[i] >= 0 && w.t - dyn.crumble[i] > C.CRUMBLE_T) {
      dyn.crumble[i] = -1;
      dyn.gone[i] = w.t;
      w.events.push({ type: 'collapse', slab: i });
    }
    if (dyn.gone[i] >= 0 && w.t - dyn.gone[i] > C.CRUMBLE_REGROW) dyn.gone[i] = -1;
  }
  for (let i = 0; i < 4; i++) stepLeg(w, i, course, dyn, inputs[i], dt);
  const n = bodyDynamics(w, course, dyn, dt);
  constraints(w, n);
  hazardsOnBody(w, course, dyn, dt);
  if (attitude(w, course, dyn, dt)) return;
  if (balance(w, course, dt)) return;
  cargoStep(w, course, dt);
  // Bounds: the strip, and feet inside it.
  w.x = clamp(w.x, 0.5, course.length - 0.5);
  w.z = clamp(w.z, -HALF_W + 0.5, HALF_W - 0.5);
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    leg.fx = clamp(leg.fx, 0, course.length);
    leg.fz = clamp(leg.fz, -HALF_W, HALF_W);
    leg.fy = clamp(leg.fy, -12, 40);
  }
  if (w.x > w.maxX) w.maxX = w.x;
  const cp = checkpointIndex(course, w.x);
  if (cp > w.cp) {
    w.cp = cp;
    w.events.push({ type: 'checkpoint', n: cp });
  }
  if (w.x >= course.goalX) {
    w.finished = true;
    w.finishT = w.t;
    w.events.push({ type: 'finish' });
  }
  // Groove decay and streaks.
  if (w.t - w.lastPlantT > 1.5) w.groove = Math.max(0, w.groove - 5 * dt);
  if (w.groove >= 60) {
    w.grooveStreak += dt;
    if (w.grooveStreak > w.grooveBest) w.grooveBest = w.grooveStreak;
  } else w.grooveStreak = 0;
  w.grooveSum += w.groove * dt;
  // Defensive: a number that went bad resets the walker instead of poisoning everything.
  if (!Number.isFinite(w.x + w.y + w.z + w.yaw + w.pitch + w.roll + w.vx + w.vy + w.vz)) {
    w.events.push({ type: 'nan' });
    placeAt(w, course, lastRespawn(course, Number.isFinite(w.maxX) ? w.maxX : 0), dyn);
  }
}
