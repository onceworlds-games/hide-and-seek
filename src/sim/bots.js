// Bot legs: every 0.1 s a bot decides whether its leg should lift, where it should land
// and how hard to push. Three skills (the Mechanic upgrade buys the higher ones). Bots
// follow the humans' intent; alone, they walk the course's path.
import * as C from './constants.js';
import { ST, hipWorld } from './walker.js';
import { sample, isDeadly, baseSurface, isWet, waterLevel, staticFeature } from './terrain.js';
import { ventState, geyserState, barAngle, rockState, boulderState, gateState } from './hazards.js';
import { pathZ } from './courses.js';

export const SKILLS = [
  { name: 'novice', react: 0.34, stride: 1.5, speed: 0.6, err: 0.15, foresight: 0, trot: false, think: 0.15, safety: 0.15 },
  { name: 'average', react: 0.2, stride: 1.85, speed: 0.82, err: 0.05, foresight: 1, trot: false, think: 0.1, safety: 0.25 },
  { name: 'pro', react: 0.1, stride: 2.15, speed: 1, err: 0, foresight: 2, trot: true, think: 0.1, safety: 0.3 },
];

const gS = { h: 0, s: 0, f: -1, platform: -1, conveyor: 0 };
const hipS = { x: 0, y: 0, z: 0 };
const hz = { state: 0, p: 0, landed: false, shadow: 0, height: 0, rest: 0, active: false, x: 0, z: 0, roll: 0, open: true, closing: false };
const ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35];
const RADII = [1, 0.7, 0.45];

export function createBots(skill, rng) {
  return {
    skill: SKILLS[Math.max(0, Math.min(2, skill | 0))],
    rng,
    think: 0,
    lastLift: -10,
    lastLeg: -1,
    waitUntil: -1,
    goUntil: -1,
    turnUntil: -1,
    turnDir: 0,
    helpUntil: -1,
    stuckT: 0,
    lastMaxX: 0,
    wantReset: false,
    intentF: 0,
    intentR: 0,
    legs: [0, 1, 2, 3].map(() => ({ plan: 'hold', t: 0, tx: 0, tz: 0, sx: 0, sy: 0, brace: false, speedMul: 1 })),
  };
}

/** A signal from a human: bots obey for a few seconds. */
export function botSignal(team, kind, t) {
  if (kind === 'wait') team.waitUntil = t + 2;
  else if (kind === 'go') team.goUntil = t + 3;
  else if (kind === 'left' || kind === 'right') {
    team.turnUntil = t + 2;
    team.turnDir = kind === 'left' ? -1 : 1;
  } else if (kind === 'help') team.helpUntil = t + 3;
  else if (kind === 'lift' || kind === 'plant') team.lastLift = -10; // step at once
}

/** The team's intent in the body frame from the humans' sticks (or the path when alone). */
function computeIntent(team, w, course, humans, autonomous) {
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  // Course guidance: aim a little ahead along the path.
  const ax = w.x + 5;
  let az = pathZ(course, ax);
  if (team.skill.foresight >= 2) az -= Math.max(-1.5, Math.min(1.5, w.windZ * 1.2)); // lean upwind
  let gx = ax - w.x;
  let gz = (az - w.z) * 1.6;
  const gl = Math.hypot(gx, gz) || 1;
  gx /= gl;
  gz /= gl;
  const gF = gx * cy + gz * sy;
  const gR = -gx * sy + gz * cy;
  let hF = 0;
  let hR = 0;
  let hn = 0;
  for (let i = 0; i < humans.length; i++) {
    const h = humans[i];
    if (!h) continue;
    const m = Math.hypot(h.x, h.y);
    if (m < 0.15) continue;
    hF += h.y;
    hR += h.x;
    hn++;
  }
  let f;
  let r;
  if (hn > 0) {
    hF /= hn;
    hR /= hn;
    const m = Math.min(1, Math.hypot(hF, hR));
    f = (hF * 0.7 + gF * 0.3 * m) * 1;
    r = (hR * 0.7 + gR * 0.3 * m) * 1;
  } else if (autonomous) {
    f = gF;
    r = gR;
  } else {
    f = 0;
    r = 0;
  }
  if (team.turnUntil > w.t) {
    const a = team.turnDir * 0.7;
    const nf = f * Math.cos(a) - r * Math.sin(a);
    const nr = f * Math.sin(a) + r * Math.cos(a);
    f = nf;
    r = nr;
  }
  const m = Math.hypot(f, r);
  if (m > 1) {
    f /= m;
    r /= m;
  }
  team.intentF = f;
  team.intentR = r;
  return m;
}

function targetBad(w, course, dyn, x, z, skill, t, allowMud) {
  sample(course, dyn, t, x, z, gS);
  const b = baseSurface(gS.s);
  if (isDeadly(b)) return 100;
  if (b === C.S.SHORE && course.water && waterLevel(course, t) - gS.h > 0.9) return 100;
  if (b === C.S.SHORE && course.water && skill.foresight >= 2 && waterLevel(course, t + 1.5) - gS.h > 0.9) return 100;
  let bad = 0;
  if (b === C.S.CRUMBLE) {
    const t0 = gS.f >= 0 && gS.f < dyn.crumble.length ? dyn.crumble[gS.f] : -1;
    if (t0 >= 0 && t - t0 > C.CRUMBLE_T * 0.5) bad += 100;
    else bad += 0.3;
  }
  if (b === C.S.MUD) bad += allowMud ? 0.8 : 2;
  if (b === C.S.SPRING) bad += 2.5;
  if (b === C.S.ICE && skill.foresight >= 1) bad += 0.6;
  if (b === C.S.SHORE && isWet(gS.s)) bad += 0.7;
  if (b === C.S.LAVA) bad += 100;
  if (gS.f >= 1000 && gS.f < 2000 && skill.foresight >= 1) {
    const v = course.vents[gS.f - 1000];
    if (v) {
      ventState(v, t, hz);
      if (hz.state >= 1) bad += 100;
      else if (hz.p > 0.6) bad += 3;
    }
  }
  if (gS.f >= 2000 && skill.foresight >= 1) {
    const g = course.geysers[gS.f - 2000];
    if (g) {
      geyserState(g, t, hz);
      if (hz.state >= 1) bad += 100;
    }
  }
  if (Math.abs(z) > 10.5) bad += 5;
  if (skill.foresight >= 1) {
    if (rockComing(course, x, z, t, 0.4)) bad += 100;
    if (boulderComing(course, x, z, t, 2.5)) bad += 100;
  }
  // Keep away from edges: a foot beside a drop slides into it on ice or in wind.
  if (skill.foresight >= 1) {
    const h0 = gS.h;
    for (let k = 0; k < 4; k++) {
      const ex = x + (k === 0 ? 0.7 : k === 1 ? -0.7 : 0);
      const ez = z + (k === 2 ? 0.7 : k === 3 ? -0.7 : 0);
      sample(course, dyn, t, ex, ez, gS);
      if (isDeadly(baseSurface(gS.s)) || gS.h < h0 - 1.5) bad += 1.2;
    }
  }
  return bad;
}

/** Pick a landing point for leg i around the intent, on good ground, within reach. */
function pickTarget(team, w, course, dyn, i, out) {
  const skill = team.skill;
  const leg = w.legs[i];
  hipWorld(w, i, hipS);
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  let f = team.intentF;
  let r = team.intentR;
  const m = Math.hypot(f, r);
  if (m < 0.1) {
    f = 1;
    r = 0;
  } else {
    f /= m;
    r /= m;
  }
  // Rear legs aim a bit shorter so the body keeps its shape.
  const stride = Math.min(w.cfg.stickRange, skill.stride * (C.HIPS[i][0] < 0 ? 0.85 : 1)) * (team.helpUntil > w.t ? 0.6 : 1);
  let best = Infinity;
  let bx = hipS.x;
  let bz = hipS.z;
  let found = false;
  for (let a = 0; a < ANGLES.length; a++) {
    const ang = ANGLES[a];
    const df = f * Math.cos(ang) - r * Math.sin(ang);
    const dr = f * Math.sin(ang) + r * Math.cos(ang);
    for (let k = 0; k < RADII.length; k++) {
      const rad = stride * RADII[k];
      const px = hipS.x + (cy * df - sy * dr) * rad;
      const pz = hipS.z + (sy * df + cy * dr) * rad;
      const bad = targetBad(w, course, dyn, px, pz, skill, w.t, k > 0);
      if (bad >= 100) continue;
      sample(course, dyn, w.t, px, pz, gS);
      const dy = gS.h - hipS.y;
      if (rad * rad + dy * dy > (leg.reach - 0.25) * (leg.reach - 0.25)) continue;
      const cost = -rad * Math.cos(ang) + bad + Math.abs(ang) * 0.4;
      if (cost < best) {
        best = cost;
        bx = px;
        bz = pz;
        found = true;
      }
    }
  }
  if (!found) {
    // Under the hip, or the last safe spot.
    if (targetBad(w, course, dyn, hipS.x, hipS.z, skill, w.t, true) < 100) {
      bx = hipS.x;
      bz = hipS.z;
    } else {
      bx = leg.sx;
      bz = leg.sz;
    }
  }
  out.tx = bx;
  out.tz = bz;
  return found;
}

/** Would the COM still be supported if leg `skip` lifted? Returns the margin. */
export function marginWithout(w, skip) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (i === skip || leg.st !== ST.STANCE) continue;
    pts.push(leg.fx, leg.fz);
  }
  const n = pts.length / 2;
  const cx = w.comX;
  const cz = w.comZ;
  if (n === 0) return -5;
  if (n === 1) return -Math.hypot(cx - pts[0], cz - pts[1]);
  if (n === 2) return -segDist(cx, cz, pts[0], pts[1], pts[2], pts[3]);
  // Three points: signed distance inside the triangle, whatever its winding.
  const area = (pts[2] - pts[0]) * (pts[5] - pts[1]) - (pts[3] - pts[1]) * (pts[4] - pts[0]);
  const o = Math.sign(area) || 1;
  let inside = true;
  let minD = Infinity;
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const cr = (pts[j * 2] - pts[i * 2]) * (cz - pts[i * 2 + 1]) - (pts[j * 2 + 1] - pts[i * 2 + 1]) * (cx - pts[i * 2]);
    if (cr * o < 0) inside = false;
    minD = Math.min(minD, segDist(cx, cz, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]));
  }
  if (Math.abs(area) < 0.05) inside = false; // three feet in a line hold nothing up
  return inside ? minD : -minD;
}

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** A rock's shadow is over this point (it lands within `lead` seconds): move the foot. */
export function rockComing(course, fx, fz, t, lead) {
  const bucket = course.dynIndex[Math.max(0, Math.min(course.dynIndex.length - 1, Math.floor(fx / 10)))];
  if (!bucket) return false;
  for (let k = 0; k < bucket.length; k++) {
    const r = bucket[k];
    if (r.kind !== 'rock') continue;
    if (Math.hypot(fx - r.x, fz - r.z) > r.r + 0.4) continue;
    rockState(r, t, 1 / 60, hz);
    if (hz.shadow > 0 && (1 - hz.shadow) * (r.lead ?? 1.4) <= lead) return true;
    if (hz.rest > 0 && lead > 1) return true; // the rock still lies there
  }
  return false;
}

/** A boulder will roll over this point within `lead` seconds. */
export function boulderComing(course, fx, fz, t, lead) {
  const bucket = course.dynIndex[Math.max(0, Math.min(course.dynIndex.length - 1, Math.floor(fx / 10)))];
  if (!bucket) return false;
  for (let k = 0; k < bucket.length; k++) {
    const b = bucket[k];
    if (b.kind !== 'boulder') continue;
    if (Math.abs(fz - b.z) > b.r + 0.8) continue;
    boulderState(b, t, hz);
    if (!hz.active) continue;
    const ahead = hz.x - fx; // the boulder rolls toward -x
    if (ahead > -0.8 && ahead < b.speed * lead + 1) return true;
  }
  return false;
}

/** A gate just ahead is closed or closing and the walker is not yet through: wait. */
export function gateWait(course, w, t) {
  for (let k = 0; k < course.gates.length; k++) {
    const g = course.gates[k];
    if (g.x < w.x + 2.4 || g.x > w.x + 9) continue;
    gateState(g, t, hz);
    const timeToCross = (g.x + 2.6 - w.x) / 1.3;
    if (!hz.open) return true;
    const openLeft = (1 - hz.p) * g.period * g.open;
    if (openLeft < timeToCross) return true;
  }
  return false;
}

/** Will a low bar sweep through this foot within half a second? (The jump-rope rule: lift it.) */
export function barComing(course, fx, fz, t) {
  const bucket = course.dynIndex[Math.max(0, Math.min(course.dynIndex.length - 1, Math.floor(fx / 10)))];
  if (!bucket) return false;
  for (let k = 0; k < bucket.length; k++) {
    const b = bucket[k];
    if (b.kind !== 'bar') continue;
    const rx = fx - b.x;
    const rz = fz - b.z;
    const d = Math.hypot(rx, rz);
    if (d > b.len + 0.6 || d < 0.3) continue;
    for (let s = 0.05; s <= 0.5; s += 0.05) {
      const a = barAngle(b, t + s);
      const bx = Math.cos(a);
      const bz = Math.sin(a);
      const along = rx * bx + rz * bz;
      if (along < 0 || along > b.len) continue;
      if (Math.abs(rx * bz - rz * bx) < 0.9) return true;
    }
  }
  return false;
}

/**
 * Fill `inputs[i]` for every bot leg (mask[i] true). `humans[i]` are the human sticks (body frame)
 * for intent. `autonomous`: no humans at all, walk the path.
 */
export function botInputs(team, w, course, dyn, mask, humans, inputs, dt, autonomous) {
  const skill = team.skill;
  team.think -= dt;
  const t = w.t;
  const intentMag = computeIntent(team, w, course, humans, autonomous);
  const going = intentMag > 0.1 && team.waitUntil < t && !(skill.foresight >= 1 && course.gates.length && gateWait(course, w, t));
  const speed = skill.speed * (team.goUntil > t ? 1.25 : 1) * (going ? Math.max(0.35, intentMag) : 0);
  // Stuck watch: no progress for a while with everything planted -> ask for a stance reset.
  if (w.maxX > team.lastMaxX + 0.2) {
    team.lastMaxX = w.maxX;
    team.stuckT = 0;
  } else if (going && w.tumbling <= 0) team.stuckT += dt;
  team.wantReset = team.stuckT > 7 && w.planted === 4;
  if (team.wantReset) team.stuckT = 2;

  let air = 0;
  let airLeg = -1;
  let onCrumble = false;
  for (let i = 0; i < 4; i++) {
    const leg = w.legs[i];
    if (leg.absent) continue;
    if (leg.st !== ST.STANCE) {
      air++;
      airLeg = i;
    } else if (baseSurface(leg.surf) === C.S.CRUMBLE) onCrumble = true;
  }
  const decide = team.think <= 0;
  if (decide) team.think = skill.think;
  nCand = 0;
  for (let i = 0; i < 4; i++) {
    if (!mask[i]) continue;
    const leg = w.legs[i];
    const b = team.legs[i];
    const inp = inputs[i];
    inp.brace = false;
    if (leg.absent || leg.inert) {
      inp.x = inp.y = 0;
      inp.lift = false;
      continue;
    }
    if (leg.st === ST.STUN) {
      b.plan = 'hold';
      inp.lift = false;
      inp.x = inp.y = 0;
      continue;
    }
    if (leg.st === ST.SWING) {
      if (b.plan !== 'fly' && b.plan !== 'plant') {
        // Lifted by something else (a geyser, a bar, a pop): choose where to land.
        b.plan = 'fly';
        b.t = t + skill.react;
        pickTarget(team, w, course, dyn, i, b);
      }
      if (decide && leg.forced <= 0 && targetBad(w, course, dyn, b.tx, b.tz, skill, t, true) >= 100) pickTarget(team, w, course, dyn, i, b);
      hipWorld(w, i, hipS);
      const cy = Math.cos(w.yaw);
      const sy = Math.sin(w.yaw);
      const dx = b.tx - hipS.x;
      const dz = b.tz - hipS.z;
      inp.y = Math.max(-1, Math.min(1, (dx * cy + dz * sy) / w.cfg.stickRange));
      inp.x = Math.max(-1, Math.min(1, (-dx * sy + dz * cy) / w.cfg.stickRange));
      const swingT = C.SWING_T * (leg.feet === 'springs' ? C.FEET.springs.swingMult : 1);
      const ready = leg.sw >= swingT && t >= b.t && leg.forced <= 0;
      const valid = leg.valid;
      inp.lift = !(ready && valid);
      if (!inp.lift) b.plan = 'hold';
      continue;
    }
    // Stance: push (less when the foot is already behind its hip), maybe brace, maybe want to lift.
    b.plan = 'hold';
    hipWorld(w, i, hipS);
    const cy = Math.cos(w.yaw);
    const sy = Math.sin(w.yaw);
    const rx = leg.fx - hipS.x;
    const rz = leg.fz - hipS.z;
    const along = (rx * cy + rz * sy) * team.intentF + (-rx * sy + rz * cy) * team.intentR; // positive: foot ahead
    const d = Math.hypot(rx, rz);
    const fresh = Math.max(0.1, Math.min(1, 1 + along / Math.max(0.5, skill.stride)));
    // Steer: the nose turns toward the intent when front and rear legs push opposite ways.
    const heading = Math.atan2(team.intentR, team.intentF);
    const steer = Math.max(-1, Math.min(1, heading / 0.5)) * 0.55 * (C.HIPS[i][0] > 0 ? 1 : -1);
    const straight = Math.abs(heading) > 1.2 ? 0.25 : 1;
    inp.y = team.intentF * speed * fresh * straight;
    inp.x = team.intentR * speed * fresh * straight + steer * speed;
    const mag = Math.hypot(inp.x, inp.y);
    if (mag > 1) {
      inp.x /= mag;
      inp.y /= mag;
    }
    inp.lift = false;
    const base = baseSurface(leg.surf);
    if (skill.foresight >= 1 && leg.braceCd <= 0 && (base === C.S.ICE || (base === C.S.SHORE && isWet(leg.surf)) || w.gust > 0.7 || w.margin < -0.25)) inp.brace = true;
    if (!decide || !going) continue;
    // Prefer a crawl gait: rear legs first, then the other side.
    const rear = C.HIPS[i][0] < 0;
    const otherSide = team.lastLeg >= 0 && (team.lastLeg % 2) !== (i % 2);
    const diagonal = skill.trot && !onCrumble && air === 1 && airLeg + i === 3;
    let score = -along + d * 0.6 + (rear ? 0.35 : 0) + (otherSide ? 0.3 : 0) + (diagonal ? 1.2 : 0);
    if (base === C.S.MUD && leg.sink > 0.25) score += 2 + leg.sink * 4;
    if (base === C.S.CRUMBLE && skill.foresight >= 1) {
      const f = staticFeature(course.terrain, leg.fx, leg.fz);
      const t0 = f >= 0 && f < dyn.crumble.length ? dyn.crumble[f] : -1;
      if (t0 >= 0 && t - t0 > C.CRUMBLE_T - 0.9) score += 50;
      else if (t0 >= 0 && t - t0 > 0.4) score += 4;
    }
    if (skill.foresight >= 1 && course.bars.length && barComing(course, leg.fx, leg.fz, t)) score += 50;
    if (skill.foresight >= 1 && course.rocks.length && rockComing(course, leg.fx, leg.fz, t, 0.5)) score += 50;
    if (skill.foresight >= 1 && course.boulders.length && boulderComing(course, leg.fx, leg.fz, t, 0.9)) score += 50;
    if (base === C.S.SPRING) score += 3;
    if (skill.foresight >= 1 && staticFeature(course.terrain, leg.fx, leg.fz) >= 1000) {
      const f = staticFeature(course.terrain, leg.fx, leg.fz);
      const v = f < 2000 ? course.vents[f - 1000] : course.geysers[f - 2000];
      if (v) {
        (f < 2000 ? ventState : geyserState)(v, t, hz);
        if (hz.state === 1) score += 5;
      }
    }
    if (team.helpUntil > t && d > 1.2) score += 2;
    const wants = along < -skill.stride * 0.3 || (along < 0 && d > w.cfg.stickRange * 0.8) || d > w.cfg.stickRange * 0.98 || score > 2.5;
    if (wants) {
      candScore[nCand] = score;
      candLeg[nCand] = i;
      nCand++;
    }
  }
  if (nCand > 0 && decide && w.tumbling <= 0 && t - team.lastLift > skill.react * 0.8) {
    // Try the legs most in need first, but lift the first one that leaves the body supported:
    // with a stance that trails the hips, rear legs are safe to lift and front legs are not.
    for (let n = 0; n < nCand; n++) {
      let best = n;
      for (let k = n + 1; k < nCand; k++) if (candScore[k] > candScore[best]) best = k;
      if (best !== n) {
        const s = candScore[n];
        candScore[n] = candScore[best];
        candScore[best] = s;
        const l = candLeg[n];
        candLeg[n] = candLeg[best];
        candLeg[best] = l;
      }
      const leg = candLeg[n];
      const diagonal = airLeg >= 0 && airLeg + leg === 3;
      const urgent = candScore[n] >= 50;
      const airOk = air === 0 || (urgent && air <= 1) || (skill.trot && !onCrumble && air === 1 && diagonal && !(team.helpUntil > t));
      if (!airOk) continue;
      let safe = true;
      if (candScore[n] >= 50) safe = true; // the ground is about to go: falling is worse than a tip
      else if (!(skill.err > 0 && team.rng.next() < skill.err)) {
        // The body tolerates the COM up to COM_MARGIN outside the polygon before it starts to tip.
        const m = marginWithout(w, leg) + C.COM_MARGIN;
        safe = m > skill.safety - (air === 1 ? 0.1 : 0);
        if (!safe && w.planted >= 3 && candScore[n] > 3.5) safe = m > 0.05; // a leg in trouble lifts anyway
      }
      if (!safe) continue;
      liftNow(team, w, course, dyn, leg, inputs, t);
      return;
    }
    // Every leg in need is unsafe to lift: walk a safe leg forward first so the polygon
    // moves under the body and frees the stuck one (what a person does without thinking).
    if (air === 0) {
      let helper = -1;
      let helperAlong = Infinity;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        if (!mask[i] || leg.st !== ST.STANCE || leg.absent || leg.inert) continue;
        let isCand = false;
        for (let n = 0; n < nCand; n++) if (candLeg[n] === i) isCand = true;
        if (isCand) continue;
        hipWorld(w, i, hipS);
        const cy = Math.cos(w.yaw);
        const sy = Math.sin(w.yaw);
        const rx = leg.fx - hipS.x;
        const rz = leg.fz - hipS.z;
        const along = (rx * cy + rz * sy) * team.intentF + (-rx * sy + rz * cy) * team.intentR;
        if (along > skill.stride * 0.5) continue;
        if (marginWithout(w, i) + C.COM_MARGIN <= skill.safety) continue;
        if (along < helperAlong) {
          helperAlong = along;
          helper = i;
        }
      }
      if (helper >= 0) liftNow(team, w, course, dyn, helper, inputs, t);
    }
  }
}

function liftNow(team, w, course, dyn, leg, inputs, t) {
  const b = team.legs[leg];
  pickTarget(team, w, course, dyn, leg, b);
  b.plan = 'fly';
  b.t = t + team.skill.react;
  inputs[leg].lift = true;
  team.lastLift = t;
  team.lastLeg = leg;
}
const candScore = new Float64Array(4);
const candLeg = new Int32Array(4);
let nCand = 0;
