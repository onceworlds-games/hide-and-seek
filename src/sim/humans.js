// Simulated people, for the balance harness and tests: each leg is its own player. They see the
// machine as it is, but act a reaction time after they decide, aim with an unsteady thumb, let go
// a little late, and nobody coordinates (two of them can lift at once). A pilot steers a team of
// bots the same way. Skill scales the noise; nothing here is perfect information on purpose.
import * as C from './constants.js';
import { ST, hipWorld } from './walker.js';
import { computeIntent, pickTarget, marginWithout, barComing, rockComing, boulderComing, gateWait } from './bots.js';
import { sample, baseSurface, isDeadly, staticFeature } from './terrain.js';
import { ventState, geyserState } from './hazards.js';

// react: seconds from deciding to the button going down (mean, spread); aim: landing error (m, sd);
// hold: extra time the foot stays up after it could land (s, range); notice: chance they see another
// foot in the air or a red target before acting; margin: chance they check the tilt before lifting (and
// risk: how far past the edge they dare, knowing a topple takes a second);
// push: stick strength while planted; steer: heading wander (rad); foresight: which hazards they read.
export const HUMAN_SKILLS = [
  { name: 'novice', react: 0.45, reactSd: 0.14, aim: 0.5, hold: [0.05, 0.55], notice: 0.5, margin: 0.3, risk: 0.05, push: 0.72, steer: 0.24, foresight: 0, stride: 1.55, brace: 0.15, think: 0.12 },
  { name: 'average', react: 0.3, reactSd: 0.08, aim: 0.3, hold: [0.03, 0.25], notice: 0.82, margin: 0.72, risk: 0, push: 0.88, steer: 0.12, foresight: 1, stride: 1.85, brace: 0.55, think: 0.1 },
  { name: 'pro', react: 0.2, reactSd: 0.04, aim: 0.14, hold: [0, 0.08], notice: 0.96, margin: 0.94, risk: 0, push: 1, steer: 0.05, foresight: 2, stride: 2.1, brace: 0.9, think: 0.08 },
];

const NO_STICKS = [null, null, null, null];
const hipS = { x: 0, y: 0, z: 0 };
const gS = { h: 0, s: 0, f: -1, platform: -1, conveyor: 0 };
const hz = { state: 0, p: 0 };
const aimS = { tx: 0, tz: 0 };

function gauss(rng) {
  // Irwin-Hall: cheap, bounded, near enough to normal for thumbs and reflexes
  return rng.next() + rng.next() + rng.next() + rng.next() - 2;
}

function brain(skill, rng, i) {
  return {
    skill,
    rng,
    // the bot helpers read their own little team: a view of the route at this player's foresight
    team: { skill: { stride: skill.stride, foresight: skill.foresight, jitter: 0 }, intentF: 1, intentR: 0, turnUntil: -1, helpUntil: -1, rng },
    next: rng.next() * skill.think + i * 0.01,
    liftAt: -1,
    catchAt: -1,
    wantT: 0,
    swinging: false,
    tx: 0,
    tz: 0,
    releaseAt: 0,
    sx: 0,
    sy: 0,
    heading: 0,
    f: 1,
    r: 0,
  };
}

/** Four players of one skill (or a mix: `skills` is an index or a list of four). */
export function createHumanTeam(skills, rng) {
  const list = Array.isArray(skills) ? skills : [skills, skills, skills, skills];
  return list.map((s, i) => brain(HUMAN_SKILLS[Math.max(0, Math.min(2, s | 0))], rng.fork(`h${i}`), i));
}

/** A pilot who steers a team of bots (Pilot mode) with the same hands. */
export function createPilot(skill, rng) {
  return brain(HUMAN_SKILLS[Math.max(0, Math.min(2, skill | 0))], rng.fork('pilot'), 0);
}

/** The direction this player wants to go, in the body frame, with their own wander. */
function updateIntent(b, w, course, dt) {
  const s = b.skill;
  b.heading += gauss(b.rng) * s.steer * Math.sqrt(dt) * 2;
  b.heading = Math.max(-2 * s.steer, Math.min(2 * s.steer, b.heading * (1 - dt * 0.5)));
  computeIntent(b.team, w, course, NO_STICKS, true);
  const c = Math.cos(b.heading);
  const sn = Math.sin(b.heading);
  b.f = b.team.intentF * c - b.team.intentR * sn;
  b.r = b.team.intentF * sn + b.team.intentR * c;
  b.team.intentF = b.f;
  b.team.intentR = b.r;
}

/** Is there something under this planted foot the player has learned to read? */
function footInDanger(b, w, course, dyn, leg, t) {
  const fs = b.skill.foresight;
  // a cracked slab: everyone sees the cracks spread; the better they read it, the earlier they step off
  sample(course, dyn, t, leg.fx, leg.fz, gS);
  if (baseSurface(gS.s) === C.S.CRUMBLE && gS.f >= 0 && gS.f < dyn.crumble.length) {
    const t0 = dyn.crumble[gS.f];
    if (t0 >= 0 && t - t0 > C.CRUMBLE_T - (fs >= 2 ? 1.4 : fs >= 1 ? 1.1 : 0.6)) return true;
  }
  if (fs < 1) {
    // a novice only moves a foot that is already in trouble: steam on it, a bar on top of it
    return (course.bars.length && barComing(course, leg.fx, leg.fz, t, 0.12)) || (course.boulders.length && boulderComing(course, leg.fx, leg.fz, t, 0.3));
  }
  const lead = fs >= 2 ? 1 : 0.6;
  if (course.bars.length && barComing(course, leg.fx, leg.fz, t, 0.25 + lead * 0.3)) return true;
  if (course.rocks.length && rockComing(course, leg.fx, leg.fz, t, lead)) return true;
  if (course.boulders.length && boulderComing(course, leg.fx, leg.fz, t, 0.4 + lead * 0.5)) return true;
  const f = staticFeature(course.terrain, leg.fx, leg.fz);
  if (f >= 1000) {
    const v = f < 2000 ? course.vents[f - 1000] : course.geysers[f - 2000];
    if (v) {
      (f < 2000 ? ventState : geyserState)(v, t, hz);
      if (hz.state === 1 || (fs >= 2 && hz.state === 0 && hz.p > 0.8)) return true;
    }
  }
  return false;
}

function stickToward(b, w, i, tx, tz, dt) {
  hipWorld(w, i, hipS);
  const cy = Math.cos(w.yaw);
  const sy = Math.sin(w.yaw);
  const dx = tx - hipS.x;
  const dz = tz - hipS.z;
  const range = w.cfg.stickRange;
  const wantY = Math.max(-1, Math.min(1, (dx * cy + dz * sy) / range));
  const wantX = Math.max(-1, Math.min(1, (-dx * sy + dz * cy) / range));
  const k = 1 - Math.exp(-dt / (0.05 + b.skill.react * 0.3));
  b.sy += (wantY - b.sy) * k;
  b.sx += (wantX - b.sx) * k;
}

function chooseLanding(b, w, course, dyn, i) {
  pickTarget(b.team, w, course, dyn, i, aimS);
  const a = b.rng.next() * Math.PI * 2;
  const d = Math.abs(gauss(b.rng)) * b.skill.aim;
  b.tx = aimS.tx + Math.cos(a) * d;
  b.tz = aimS.tz + Math.sin(a) * d;
}

/**
 * One tick of four players: writes `out[i] = { x, y, lift, brace }` (body-frame stick, like a
 * real player's). `w` is the walker as everyone sees it.
 */
export function humanInputs(team, w, course, dyn, out, dt) {
  const t = w.t;
  let air = 0;
  for (let i = 0; i < 4; i++) if (w.legs[i].st !== ST.STANCE && !w.legs[i].absent) air++;
  for (let i = 0; i < 4; i++) {
    const b = team[i];
    const s = b.skill;
    const leg = w.legs[i];
    const o = out[i];
    o.brace = false;
    const think = t >= b.next;
    if (think) {
      b.next = t + s.think;
      updateIntent(b, w, course, s.think);
    }
    if (leg.absent || leg.st === ST.STUN || w.tumbling > 0) {
      b.swinging = false;
      b.liftAt = -1;
      b.catchAt = -1;
      o.x = o.y = 0;
      o.lift = false;
      continue;
    }
    if (leg.st === ST.SWING) {
      if (!b.swinging) {
        // a foot that was knocked or popped up: they notice a moment later and aim it
        b.swinging = true;
        chooseLanding(b, w, course, dyn, i);
        b.releaseAt = t + s.react + s.hold[0] + b.rng.next() * (s.hold[1] - s.hold[0]);
      }
      stickToward(b, w, i, b.tx, b.tz, dt);
      o.x = b.sx;
      o.y = b.sy;
      // The machine lurches (it leans, the dot goes red, it creaks): put the foot down, a reaction later.
      if (think && b.catchAt < 0 && w.tip > 3 && b.rng.next() < 0.55 + 0.45 * s.notice) b.catchAt = t + Math.max(0.06, s.react + gauss(b.rng) * s.reactSd);
      const swingT = C.SWING_T * (leg.feet === 'springs' ? C.FEET.springs.swingMult : 1);
      const catching = b.catchAt >= 0 && t >= b.catchAt && leg.valid && leg.sw >= 0.08;
      let hold = !catching && (leg.sw < swingT || t < b.releaseAt || leg.forced > 0);
      if (catching) hold = false;
      else if (!hold && !think) hold = true; // they let go on their own beat
      else if (!hold) {
        // the target shows red, or something is about to land there: a player who sees it re-aims
        const bad = !leg.valid || (s.foresight >= 1 && ((course.bars.length && barComing(course, b.tx, b.tz, t, 0.3)) || (course.rocks.length && rockComing(course, b.tx, b.tz, t, 0.6)) || (course.boulders.length && boulderComing(course, b.tx, b.tz, t, 1))));
        if (bad && b.rng.next() < s.notice && leg.sw < 4) {
          chooseLanding(b, w, course, dyn, i);
          b.releaseAt = t + s.react * 0.6;
          hold = true;
        }
      }
      o.lift = hold;
      if (!hold) b.swinging = false;
      continue;
    }
    b.swinging = false;
    b.catchAt = -1;
    // Planted: push the way they want to go (gently on ice once they know better), brace when it slides.
    let push = s.push;
    if (s.foresight >= 1 && leg.grip < 0.6 && leg.brace <= 0) push *= 0.45;
    o.y = b.f * push;
    o.x = b.r * push;
    if (leg.braceCd <= 0 && (leg.slipping || leg.grip < 0.6) && b.rng.next() < s.brace * dt * 4) o.brace = true;
    o.lift = false;
    if (b.liftAt >= 0) {
      if (t >= b.liftAt) {
        b.liftAt = -1;
        // a careful player looks once more before the foot goes up
        if (air > 0 && b.rng.next() < s.notice * s.notice * 0.8) continue;
        o.lift = true;
        chooseLanding(b, w, course, dyn, i);
        b.swinging = true;
        b.releaseAt = t + C.SWING_T + s.hold[0] + b.rng.next() * (s.hold[1] - s.hold[0]);
        stickToward(b, w, i, b.tx, b.tz, 1);
        o.x = b.sx;
        o.y = b.sy;
        air++;
      }
      continue;
    }
    if (!think || w.finished) continue;
    // a closed gate ahead: stop pushing and stepping forward, but still pull a foot out of trouble
    const waiting = s.foresight >= 1 && course.gates.length > 0 && gateWait(course, w, t) && b.rng.next() < s.notice;
    if (waiting) o.x = o.y = 0;
    // Do they want to step? The foot trails the hip, it is stretched, it is sinking or about to be hit.
    hipWorld(w, i, hipS);
    const cy = Math.cos(w.yaw);
    const sy = Math.sin(w.yaw);
    const rx = leg.fx - hipS.x;
    const rz = leg.fz - hipS.z;
    const along = (rx * cy + rz * sy) * b.f + (-rx * sy + rz * cy) * b.r;
    const d = Math.hypot(rx, rz);
    const danger = footInDanger(b, w, course, dyn, leg, t);
    sample(course, dyn, t, leg.fx, leg.fz, gS);
    const sinking = baseSurface(gS.s) === C.S.MUD && leg.sink > (s.foresight >= 1 ? 0.3 : 0.5);
    const wants = danger || (!waiting && (sinking || along < -s.stride * 0.35 || d > w.cfg.stickRange * 0.9));
    if (!wants) {
      b.wantT = 0;
      continue;
    }
    b.wantT = (b.wantT ?? 0) + s.think;
    // after a while of wanting to step and holding back, anyone just goes
    const impatient = b.wantT > 1.2 + s.margin * 1.5;
    if (!danger && !impatient) {
      if (air > 0 && b.rng.next() < s.notice) continue;
      if (b.rng.next() < s.margin) {
        const seen = marginWithout(w, i) + C.COM_MARGIN + gauss(b.rng) * (1 - s.margin) * 0.6;
        if (seen < s.risk) continue;
      }
    }
    b.wantT = 0;
    b.liftAt = t + Math.max(0.08, s.react + gauss(b.rng) * s.reactSd);
  }
}

/** The pilot's stick in Pilot mode: the way ahead, with their own wander and the odd pause. */
export function pilotInput(b, w, course, out, dt) {
  const t = w.t;
  if (t >= b.next) {
    b.next = t + b.skill.think;
    updateIntent(b, w, course, b.skill.think);
  }
  const m = 0.85 + 0.15 * b.skill.push;
  out.y = b.f * m;
  out.x = b.r * m;
  out.lift = false;
  out.brace = false;
  return out;
}

/** True when a deadly cell is under this world point (for tests). */
export function deadlyAt(course, dyn, t, x, z) {
  sample(course, dyn, t, x, z, gS);
  return isDeadly(baseSurface(gS.s));
}
