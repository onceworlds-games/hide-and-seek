// Walking paths for bots: a coarse grid over the walls and furniture, A*, and string-pulling so bots cut straight lines
// where the way is clear. Pure: no window, no document.
import { distToRect, segmentClear } from './geometry.js';

const CELL = 0.5;
const PAD = 0.5; // a cell is walkable when its centre is this far from every wall and piece of furniture
const SMOOTH_PAD = 0.36; // a straight stretch is fine when this clear (the character's radius is 0.35)

const navCache = new WeakMap();

/** The navigation grid for a house (built once per house). */
export function navFor(house) {
  let nav = navCache.get(house);
  if (!nav) {
    nav = buildNav(house);
    navCache.set(house, nav);
  }
  return nav;
}

function buildNav(house) {
  const cols = Math.ceil(house.w / CELL);
  const rows = Math.ceil(house.h / CELL);
  const blocked = new Uint8Array(cols * rows);
  const near = new Array(cols * rows);
  const rects = house.blockers;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * CELL;
      const cy = (r + 0.5) * CELL;
      const list = [];
      let b = 0;
      for (let k = 0; k < rects.length; k++) {
        const d = distToRect(cx, cy, rects[k]);
        if (d < PAD) b = 1;
        if (d < PAD + CELL) list.push(rects[k]);
      }
      blocked[r * cols + c] = b;
      near[r * cols + c] = list;
    }
  }
  return { cols, rows, cell: CELL, blocked, near, w: house.w, h: house.h, walls: house.walls };
}

const cellIndex = (nav, x, y) => {
  const c = Math.min(nav.cols - 1, Math.max(0, Math.floor(x / nav.cell)));
  const r = Math.min(nav.rows - 1, Math.max(0, Math.floor(y / nav.cell)));
  return r * nav.cols + c;
};

const centerOf = (nav, i) => ({ x: ((i % nav.cols) + 0.5) * nav.cell, y: (Math.floor(i / nav.cols) + 0.5) * nav.cell });

/** Is a point at least `pad` from every wall and piece of furniture? (Uses the grid's per-cell lists.) */
export function pointClear(nav, x, y, pad) {
  if (x < pad || y < pad || x > nav.w - pad || y > nav.h - pad) return false;
  const list = nav.near[cellIndex(nav, x, y)];
  for (let k = 0; k < list.length; k++) if (distToRect(x, y, list[k]) < pad) return false;
  return true;
}

/** Can a character walk the straight line between two points? */
export function walkable(nav, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 0.15));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!pointClear(nav, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, SMOOTH_PAD)) return false;
  }
  return true;
}

/** The index of the free cell nearest the point (searching outwards), or -1. */
function nearestFreeCell(nav, x, y, maxRing = 8) {
  const c0 = Math.min(nav.cols - 1, Math.max(0, Math.floor(x / nav.cell)));
  const r0 = Math.min(nav.rows - 1, Math.max(0, Math.floor(y / nav.cell)));
  if (!nav.blocked[r0 * nav.cols + c0]) return r0 * nav.cols + c0;
  let best = -1;
  let bd = Infinity;
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= nav.rows || c >= nav.cols || nav.blocked[r * nav.cols + c]) continue;
        const p = centerOf(nav, r * nav.cols + c);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = r * nav.cols + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** A free point near (x, y): the point itself if it's clear, else the centre of the nearest free cell. */
export function nearestFree(nav, x, y) {
  if (pointClear(nav, x, y, SMOOTH_PAD + 0.04)) return { x, y };
  const i = nearestFreeCell(nav, x, y);
  return i < 0 ? { x, y } : centerOf(nav, i);
}

// A small binary heap of [f, index] pairs.
class Heap {
  constructor() {
    this.f = [];
    this.v = [];
  }
  get size() {
    return this.f.length;
  }
  push(f, v) {
    const F = this.f;
    const V = this.v;
    let i = F.length;
    F.push(f);
    V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [F[p], F[i]] = [F[i], F[p]];
      [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop() {
    const F = this.f;
    const V = this.v;
    const top = V[0];
    const lf = F.pop();
    const lv = V.pop();
    if (F.length) {
      F[0] = lf;
      V[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < F.length && F[l] < F[m]) m = l;
        if (r < F.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [F[m], F[i]] = [F[i], F[m]];
        [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A walking path from (sx, sy) to (tx, ty): a list of points to walk through in order (the last is the target), or null when
 * there's no way. Straight stretches are kept straight.
 */
export function findPath(nav, sx, sy, tx, ty) {
  const s = nearestFreeCell(nav, sx, sy);
  const g = nearestFreeCell(nav, tx, ty);
  if (s < 0 || g < 0) return null;
  const { cols, rows, blocked } = nav;
  const gc = g % cols;
  const gr = Math.floor(g / cols);
  const cost = new Float32Array(cols * rows).fill(Infinity);
  const from = new Int32Array(cols * rows).fill(-1);
  const heap = new Heap();
  const h = (c, r) => {
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  cost[s] = 0;
  heap.push(h(s % cols, Math.floor(s / cols)), s);
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === g) {
      found = true;
      break;
    }
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    for (let k = 0; k < 8; k++) {
      const d = DIRS[k];
      const nc = c + d[0];
      const nr = r + d[1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (blocked[ni]) continue;
      if (d[0] !== 0 && d[1] !== 0 && (blocked[r * cols + nc] || blocked[nr * cols + c])) continue;
      const nc2 = cost[cur] + d[2];
      if (nc2 < cost[ni]) {
        cost[ni] = nc2;
        from[ni] = cur;
        heap.push(nc2 + h(nc, nr), ni);
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = g; i !== -1; i = from[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => centerOf(nav, i));
  pts[0] = { x: sx, y: sy };
  const last = { x: tx, y: ty };
  // The target replaces the last cell centre when it is actually free; otherwise the path ends at the cell.
  if (pointClear(nav, tx, ty, SMOOTH_PAD)) pts[pts.length - 1] = last;
  // String-pulling: from each anchor, jump to the farthest point that can be walked to in a straight line.
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !walkable(nav, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    i = j;
  }
  if (out.length === 0) out.push(pts[pts.length - 1]);
  return out;
}

/** Walls between two points? (Same as geometry's segmentClear against the house's walls, for callers holding a nav.) */
export function lineOfSight(nav, x0, y0, x1, y1) {
  return segmentClear(x0, y0, x1, y1, nav.walls);
}

/** Flood fill over free cells from a point: a Uint8Array marking every cell it can reach. */
export function reachable(nav, x, y) {
  const start = nearestFreeCell(nav, x, y);
  const seen = new Uint8Array(nav.cols * nav.rows);
  if (start < 0) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop();
    const c = cur % nav.cols;
    const r = Math.floor(cur / nav.cols);
    for (let k = 0; k < 4; k++) {
      const nc = c + DIRS[k][0];
      const nr = r + DIRS[k][1];
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      const ni = nr * nav.cols + nc;
      if (!seen[ni] && !nav.blocked[ni]) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return seen;
}

export function isReached(nav, seen, x, y) {
  return seen[cellIndex(nav, x, y)] === 1;
}
