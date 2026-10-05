// Pure geometry: circle against rectangles (walls, furniture), rays, line of sight, flashlight cones.
// Rectangles are [x, y, w, h] in house units. Nothing here touches the window or the document.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** b - a, wrapped to [-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Distance from a point to a rectangle (0 inside). */
export function distToRect(x, y, q) {
  const nx = clamp(x, q[0], q[0] + q[2]);
  const ny = clamp(y, q[1], q[1] + q[3]);
  return Math.hypot(x - nx, y - ny);
}

/** Pushes the circle `p` ({x, y}, radius r) out of every rectangle, in place. Returns true if it moved. */
export function resolveCircle(p, r, rects) {
  let moved = false;
  for (let it = 0; it < 3; it++) {
    let any = false;
    for (let k = 0; k < rects.length; k++) {
      const q = rects[k];
      const nx = clamp(p.x, q[0], q[0] + q[2]);
      const ny = clamp(p.y, q[1], q[1] + q[3]);
      const dx = p.x - nx;
      const dy = p.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        p.x += dx * push;
        p.y += dy * push;
      } else {
        // The centre is inside the rectangle: leave by the nearest side.
        const left = p.x - q[0];
        const right = q[0] + q[2] - p.x;
        const top = p.y - q[1];
        const bottom = q[1] + q[3] - p.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) p.x = q[0] - r;
        else if (m === right) p.x = q[0] + q[2] + r;
        else if (m === top) p.y = q[1] - r;
        else p.y = q[1] + q[3] + r;
      }
      any = true;
      moved = true;
    }
    if (!any) break;
  }
  return moved;
}

/** Distance along the unit ray (dx, dy) from (ox, oy) to the rectangle, or Infinity. */
export function rayRect(ox, oy, dx, dy, q) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < q[0] || ox > q[0] + q[2]) return Infinity;
  } else {
    let t1 = (q[0] - ox) / dx;
    let t2 = (q[0] + q[2] - ox) / dx;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < q[1] || oy > q[1] + q[3]) return Infinity;
  } else {
    let t1 = (q[1] - oy) / dy;
    let t2 = (q[1] + q[3] - oy) / dy;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** How far the unit ray gets before it hits a wall (at most maxD). */
export function rayWalls(ox, oy, dx, dy, walls, maxD) {
  let best = maxD;
  for (let k = 0; k < walls.length; k++) {
    const t = rayRect(ox, oy, dx, dy, walls[k]);
    if (t < best) best = t;
  }
  return best;
}

/** True when the segment crosses no wall. */
export function segmentClear(x0, y0, x1, y1, walls) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  return rayWalls(x0, y0, dx / d, dy / d, walls, d) >= d - 1e-6;
}

/** True when no rectangle is closer than `pad` to the point. */
export function pointFree(rects, x, y, pad) {
  for (let k = 0; k < rects.length; k++) if (distToRect(x, y, rects[k]) < pad) return false;
  return true;
}

/**
 * Can a flashlight holder at (ox, oy) facing `a` see the point (tx, ty)? Inside the cone (angle, range) or the small circle
 * around the holder, with no wall between. `cone` is { ang, range, near }.
 */
export function canSee(ox, oy, a, cone, tx, ty, walls) {
  const dx = tx - ox;
  const dy = ty - oy;
  const d = Math.hypot(dx, dy);
  if (d > cone.range) return false;
  if (d > cone.near && Math.abs(angleDiff(a, Math.atan2(dy, dx))) > cone.ang / 2) return false;
  return segmentClear(ox, oy, tx, ty, walls);
}

/**
 * The lit area as one polygon: the cone out to its range plus the near circle, both cut short by walls. Fills `out` with
 * x, y pairs (reused between calls) and returns the number of points.
 */
export function visibility(ox, oy, a, cone, walls, out) {
  out.length = 0;
  const half = cone.ang / 2;
  const cast = (ang, lim) => {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const d = rayWalls(ox, oy, dx, dy, walls, lim);
    out.push(ox + dx * d, oy + dy * d);
  };
  const nCone = Math.max(6, Math.ceil(cone.ang / (Math.PI / 90)));
  for (let i = 0; i <= nCone; i++) cast(a - half + (cone.ang * i) / nCone, cone.range);
  cast(a + half, cone.near);
  const rest = TAU - cone.ang;
  const nNear = Math.max(8, Math.ceil(rest / (Math.PI / 15)));
  for (let i = 1; i < nNear; i++) cast(a + half + (rest * i) / nNear, cone.near);
  cast(a - half, cone.near);
  return out.length / 2;
}

/** Is the point inside the polygon (flat x, y array)? Used by tests and the minimap. */
export function inPolygon(poly, x, y) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
