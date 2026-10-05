// One fixed step of walking, shared by the player's own page and by the host's bots. Pure.
import { RULES } from './rules.js';
import { resolveCircle, angleDiff, clamp, TAU } from './geometry.js';

export const STEP = 1 / 60;

export const wrapAngle = (a) => {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
};

export function makeChar(x, y, a = 0) {
  return { x, y, vx: 0, vy: 0, a };
}

/**
 * Moves a character one step. (ix, iy) is the wanted direction (length 0 to 1), `speed` in units a second. The character slides
 * along walls and furniture, its velocity follows the input smoothly, and it turns to face where it goes (the flashlight points
 * there). Returns the distance walked.
 */
export function stepChar(c, ix, iy, dt, speed, blockers, w, h) {
  const len = Math.hypot(ix, iy);
  if (len > 1) {
    ix /= len;
    iy /= len;
  }
  const k = 1 - Math.exp(-dt * 16);
  c.vx += (ix * speed - c.vx) * k;
  c.vy += (iy * speed - c.vy) * k;
  if (len > 0.12) c.a = wrapAngle(c.a + angleDiff(c.a, Math.atan2(iy, ix)) * (1 - Math.exp(-dt * 14)));
  const px = c.x;
  const py = c.y;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  resolveCircle(c, RULES.radius, blockers);
  c.x = clamp(c.x, 0.6, w - 0.6);
  c.y = clamp(c.y, 0.6, h - 0.6);
  // The speed that was really walked: running into a wall doesn't wind velocity up.
  const moved = Math.hypot(c.x - px, c.y - py);
  c.vx = (c.x - px) / dt;
  c.vy = (c.y - py) / dt;
  return moved;
}

/** Gently pushes a character out of overlap with the others (each page does it for itself, so it looks even). */
export function separate(c, others, ang = 0) {
  const min = RULES.radius * 2;
  for (let k = 0; k < others.length; k++) {
    const o = others[k];
    if (o === c) continue;
    let dx = c.x - o.x;
    let dy = c.y - o.y;
    let d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 1e-4) {
      dx = Math.cos(ang);
      dy = Math.sin(ang);
      d = 1;
    }
    const push = (min - d) * 0.5;
    c.x += (dx / d) * push;
    c.y += (dy / d) * push;
  }
}

/** stepChar, then the soft push away from `others` (a list of {x, y}), then back out of any wall that push leaned on. */
export function walk(c, ix, iy, dt, speed, house, others, ang = 0) {
  const moved = stepChar(c, ix, iy, dt, speed, house.blockers, house.w, house.h);
  if (others && others.length) {
    separate(c, others, ang);
    resolveCircle(c, RULES.radius, house.blockers);
  }
  return moved;
}
