// The two houses, hand-made as data: rooms tile the house, walls are made along the rooms' edges with door gaps cut out,
// furniture sits in room-local coordinates (from the room's inner top-left corner). Pure: no window, no document.
import { pointFree, distToRect, clamp } from './geometry.js';

const T = 0.4; // wall thickness
const INSET = T / 2; // furniture coordinates start this far inside the room's edge

// F(kind, lx, ly, w, h, options): a piece of furniture. `spot: true` makes it a hiding spot (its front is where you come out).
// `snap: 'nw'` pushes it flush against those walls (n, s, e, w), overriding lx / ly: no slivers of floor between furniture and walls.
const F = (kind, lx, ly, w, h, o = {}) => ({ kind, lx, ly, w, h, ...o });
const S = (kind, lx, ly, w, h, front, snap = '') => F(kind, lx, ly, w, h, { spot: true, front, snap });

const COZY = {
  id: 'cozy',
  name: 'Cozy House',
  w: 32,
  h: 20,
  spawn: { x: 16, y: 14 },
  rooms: [
    { id: 'bedroom', name: 'Bedroom', x: 0, y: 0, w: 10, h: 8, floor: 'wood' },
    { id: 'bath', name: 'Bathroom', x: 10, y: 0, w: 6, h: 8, floor: 'tile' },
    { id: 'kids', name: 'Kids Room', x: 16, y: 0, w: 16, h: 8, floor: 'carpet' },
    { id: 'kitchen', name: 'Kitchen', x: 0, y: 8, w: 10, h: 12, floor: 'check' },
    { id: 'living', name: 'Living Room', x: 10, y: 8, w: 12, h: 12, floor: 'wood2' },
    { id: 'laundry', name: 'Laundry', x: 22, y: 8, w: 10, h: 12, floor: 'tile2' },
  ],
  // o 'h': a wall along x at y = c, the gap spans x from `at`; o 'v': a wall along y at x = c, the gap spans y from `at`.
  doors: [
    { o: 'h', c: 8, at: 4, len: 2 },
    { o: 'v', c: 10, at: 3, len: 2 },
    { o: 'h', c: 8, at: 12, len: 2 },
    { o: 'v', c: 16, at: 3, len: 2 },
    { o: 'h', c: 8, at: 18, len: 2 },
    { o: 'h', c: 8, at: 26, len: 2 },
    { o: 'v', c: 10, at: 12, len: 2 },
    { o: 'v', c: 22, at: 12, len: 2 },
  ],
  furniture: {
    bedroom: [
      F('rug', 3.2, 2.0, 5, 3.4, { color: '#e9777d' }),
      S('bed', 0.8, 0, 3.4, 4.2, 's', 'n'),
      F('bedside', 4.4, 0, 0.9, 0.9, { snap: 'n' }),
      S('wardrobe', 0, 0, 2.6, 1.4, 's', 'ne'),
      S('plant', 0, 0, 1.4, 1.4, 'w', 'se'),
    ],
    bath: [
      S('bathtub', 0, 0, 3.6, 1.8, 's', 'ne'),
      F('toilet', 0, 0, 1.1, 1.3, { snap: 'nw' }),
      F('sink', 0, 0, 1.0, 1.6, { snap: 'sw' }),
      F('rug', 1.4, 3.0, 2.6, 1.6, { color: '#7fd3ff' }),
      S('basket', 0, 0, 1.4, 1.4, 'w', 'se'),
    ],
    kids: [
      F('rug', 1.6, 3.6, 4, 3, { color: '#7fd3ff', round: true }),
      S('box', 0, 0, 1.6, 1.6, 'e', 'nw'),
      S('curtain', 6.2, 0, 3.0, 0.9, 's', 'n'),
      F('table', 5.0, 2.8, 3.0, 1.8),
      F('shelf', 4.4, 0, 3.0, 1.2, { snap: 's' }),
      S('bed', 0, 0, 3.4, 3.8, 's', 'ne'),
    ],
    kitchen: [
      F('counter', 0, 0, 1.4, 6.0, { snap: 'nw' }),
      F('fridge', 0, 0, 1.8, 1.2, { snap: 'ne' }),
      F('table', 3.6, 6.4, 3.2, 2.0),
      S('plant', 0, 0, 1.6, 1.6, 'e', 'sw'),
      S('box', 0, 0, 1.8, 1.8, 'w', 'se'),
    ],
    living: [
      F('rug', 2.8, 3.4, 6.8, 5.2, { color: '#6bb5a6' }),
      F('bookcase', 0, 0, 1.0, 3.0, { snap: 'nw' }),
      S('plant', 0, 0, 1.4, 1.4, 'w', 'ne'),
      F('coffee', 4.4, 7.4, 2.8, 1.2),
      F('sofa', 0, 0, 4.8, 1.8, { snap: 'sw' }),
      S('curtain', 4.8, 0, 2.6, 0.9, 'n', 's'),
      F('piano', 0, 0, 2.7, 1.9, { snap: 'se' }),
    ],
    laundry: [
      S('basket', 0, 0, 1.6, 1.6, 'e', 'nw'),
      F('washer', 6.4, 0, 1.6, 1.6, { snap: 'n' }),
      F('dryer', 8.0, 0, 1.6, 1.6, { snap: 'ne' }),
      F('rack', 3.4, 6.4, 2.6, 1.0),
      S('wardrobe', 0, 0, 3.4, 1.8, 'n', 'se'),
    ],
  },
  lights: [
    [5, 4, 6],
    [13, 4, 4.5],
    [24, 4, 7],
    [5, 14, 6],
    [16, 14, 8],
    [27, 14, 6.5],
  ],
};

const MANSION = {
  id: 'mansion',
  name: 'Big Mansion',
  w: 44,
  h: 28,
  spawn: { x: 22, y: 14 },
  rooms: [
    { id: 'library', name: 'Library', x: 0, y: 0, w: 14, h: 9, floor: 'wood' },
    { id: 'master', name: 'Master Bedroom', x: 14, y: 0, w: 16, h: 9, floor: 'carpet' },
    { id: 'bath', name: 'Bathroom', x: 30, y: 0, w: 14, h: 9, floor: 'tile' },
    { id: 'kitchen', name: 'Kitchen', x: 0, y: 9, w: 14, h: 10, floor: 'check' },
    { id: 'living', name: 'Living Room', x: 14, y: 9, w: 16, h: 10, floor: 'wood2' },
    { id: 'music', name: 'Music Room', x: 30, y: 9, w: 14, h: 10, floor: 'wood' },
    { id: 'laundry', name: 'Laundry', x: 0, y: 19, w: 14, h: 9, floor: 'tile2' },
    { id: 'playroom', name: 'Playroom', x: 14, y: 19, w: 16, h: 9, floor: 'carpet' },
    { id: 'garden', name: 'Garden Room', x: 30, y: 19, w: 14, h: 9, floor: 'grass' },
  ],
  doors: [
    { o: 'v', c: 14, at: 4, len: 2 },
    { o: 'v', c: 14, at: 13, len: 2 },
    { o: 'v', c: 14, at: 22, len: 2 },
    { o: 'v', c: 30, at: 4, len: 2 },
    { o: 'v', c: 30, at: 13, len: 2 },
    { o: 'v', c: 30, at: 22, len: 2 },
    { o: 'h', c: 9, at: 5, len: 2 },
    { o: 'h', c: 9, at: 21, len: 2 },
    { o: 'h', c: 9, at: 36, len: 2 },
    { o: 'h', c: 19, at: 5, len: 2 },
    { o: 'h', c: 19, at: 21, len: 2 },
    { o: 'h', c: 19, at: 36, len: 2 },
  ],
  furniture: {
    library: [
      F('rug', 3.4, 2.6, 5.6, 4, { color: '#c9484d' }),
      F('bookcase', 0, 0, 4.6, 1.0, { snap: 'nw' }),
      S('wardrobe', 5.4, 0, 3.2, 1.3, 's', 'n'),
      F('bookcase', 0, 0, 5.0, 1.0, { snap: 'ne' }),
      S('curtain', 0, 2.0, 0.9, 3.0, 'e', 'w'),
      F('desk', 6.4, 3.6, 3.6, 1.8),
      F('armchair', 0, 0, 2.0, 2.0, { snap: 'sw' }),
      S('box', 0, 0, 1.8, 1.8, 'w', 'se'),
    ],
    master: [
      F('rug', 4.0, 4.4, 7, 3.6, { color: '#a45cff' }),
      S('wardrobe', 0, 0, 3.4, 1.4, 's', 'nw'),
      F('bedside', 4.2, 0, 1.2, 1.2, { snap: 'n' }),
      S('bed', 5.6, 0, 4.4, 4.6, 's', 'n'),
      F('bedside', 10.2, 0, 1.2, 1.2, { snap: 'n' }),
      S('curtain', 0, 0, 3.2, 0.9, 's', 'ne'),
      F('dresser', 0, 0, 3.6, 1.4, { snap: 'se' }),
    ],
    bath: [
      F('rug', 1.4, 3.2, 3.2, 2, { color: '#ffd23f' }),
      S('bathtub', 4.4, 0, 5.0, 2.2, 's', 'n'),
      F('toilet', 10.8, 0, 1.2, 1.4, { snap: 'n' }),
      F('sink', 0, 0, 1.4, 1.2, { snap: 'ne' }),
      F('cabinet', 0, 0, 2.2, 1.6, { snap: 'sw' }),
      S('basket', 0, 0, 1.8, 1.8, 'w', 'se'),
    ],
    kitchen: [
      F('counter', 0, 0, 1.4, 6.0, { snap: 'nw' }),
      F('fridge', 0, 0, 2.0, 1.4, { snap: 'ne' }),
      F('island', 4.4, 3.2, 4.4, 2.0),
      S('plant', 0, 0, 1.6, 1.8, 'e', 'sw'),
      S('box', 0, 0, 2.0, 1.8, 'w', 'se'),
    ],
    living: [
      F('rug', 3.6, 2.6, 8.4, 5, { color: '#6bb5a6' }),
      S('plant', 0, 0, 1.5, 1.5, 'e', 'nw'),
      S('curtain', 0, 1.2, 0.9, 2.4, 'w', 'e'),
      F('sofa', 0, 0, 5.2, 2.0, { snap: 'sw' }),
      F('piano', 0, 0, 3.6, 2.4, { snap: 'se' }),
    ],
    music: [
      F('rug', 3.6, 1.8, 6, 5.4, { color: '#ff8a8a', round: true }),
      F('piano', 1.8, 3.6, 3.8, 2.6),
      S('curtain', 0, 2.0, 0.9, 3.0, 'w', 'e'),
      F('couch', 0, 0, 4.2, 2.0, { snap: 'sw' }),
      S('wardrobe', 0, 0, 3.4, 1.6, 'n', 'se'),
    ],
    laundry: [
      F('washer', 0, 0, 1.6, 1.6, { snap: 'nw' }),
      F('dryer', 1.6, 0, 1.6, 1.6, { snap: 'n' }),
      S('wardrobe', 0, 0, 3.4, 1.8, 's', 'ne'),
      F('rack', 4.0, 3.6, 3.0, 1.2),
      S('basket', 0, 0, 1.6, 1.6, 'e', 'sw'),
    ],
    playroom: [
      F('rug', 4.6, 3.6, 6, 4, { color: '#ffd23f', round: true }),
      F('table', 3.0, 3.4, 3.0, 2.0),
      S('bed', 9.2, 0, 3.4, 3.6, 's', 'n'),
      S('box', 0, 0, 1.8, 1.8, 'e', 'sw'),
      S('curtain', 0, 0, 3.4, 0.9, 'n', 'se'),
    ],
    garden: [
      F('pond', 5.6, 3.0, 3.2, 2.4),
      S('plant', 0, 0, 2.0, 2.0, 's', 'nw'),
      F('bench', 0, 0, 3.6, 1.0, { snap: 'ne' }),
      S('box', 5.2, 0, 1.8, 1.6, 'n', 's'),
      S('plant', 0, 0, 2.0, 2.0, 'w', 'se'),
    ],
  },
  lights: [
    [7, 4.5, 7],
    [22, 4.5, 8],
    [37, 4.5, 7],
    [7, 14, 7],
    [22, 14, 9],
    [37, 14, 7],
    [7, 23.5, 7],
    [22, 23.5, 8],
    [37, 23.5, 7],
  ],
};

const NON_SOLID = new Set(['rug']);
const FRONT = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/** Walls as rectangles along the rooms' edges (unit pieces merged into runs), with the doors cut out. */
function buildWalls(def) {
  const hs = new Set(); // horizontal unit edges "y,x": from (x, y) to (x + 1, y)
  const vs = new Set(); // vertical unit edges "x,y"
  for (const r of def.rooms) {
    for (let x = r.x; x < r.x + r.w; x++) {
      hs.add(`${r.y},${x}`);
      hs.add(`${r.y + r.h},${x}`);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      vs.add(`${r.x},${y}`);
      vs.add(`${r.x + r.w},${y}`);
    }
  }
  for (const d of def.doors) {
    const set = d.o === 'h' ? hs : vs;
    for (let k = d.at; k < d.at + d.len; k++) {
      const key = `${d.c},${k}`;
      if (!set.has(key)) throw new Error(`${def.id}: a door at ${d.o} ${d.c} ${k} has no wall to open`);
      set.delete(key);
    }
  }
  const doorEnd = (o, c, pos) => def.doors.some((d) => d.o === o && d.c === c && (d.at === pos || d.at + d.len === pos));
  const walls = [];
  const runs = (set, o) => {
    const lines = new Map();
    for (const key of set) {
      const [c, k] = key.split(',').map(Number);
      if (!lines.has(c)) lines.set(c, []);
      lines.get(c).push(k);
    }
    for (const [c, ks] of lines) {
      ks.sort((a, b) => a - b);
      let start = ks[0];
      let prev = ks[0];
      const flush = (a, b) => {
        const e0 = doorEnd(o, c, a) ? 0 : INSET;
        const e1 = doorEnd(o, c, b) ? 0 : INSET;
        if (o === 'h') walls.push([a - e0, c - INSET, b - a + e0 + e1, T]);
        else walls.push([c - INSET, a - e0, T, b - a + e0 + e1]);
      };
      for (let i = 1; i < ks.length; i++) {
        if (ks[i] !== prev + 1) {
          flush(start, prev + 1);
          start = ks[i];
        }
        prev = ks[i];
      }
      flush(start, prev + 1);
    }
  };
  runs(hs, 'h');
  runs(vs, 'v');
  return walls;
}

function build(def) {
  const walls = buildWalls(def);
  const doors = def.doors.map((d) => ({
    ...d,
    // The gap itself, as a rectangle (for drawing a threshold and for tests).
    x: d.o === 'h' ? d.at : d.c - INSET,
    y: d.o === 'h' ? d.c - INSET : d.at,
    w: d.o === 'h' ? d.len : T,
    h: d.o === 'h' ? T : d.len,
  }));
  const decor = [];
  const spots = [];
  const solids = [];
  for (const room of def.rooms) {
    for (const f of def.furniture[room.id] ?? []) {
      const innerW = room.w - T;
      const innerH = room.h - T;
      const snap = f.snap ?? '';
      const lx = snap.includes('w') ? 0 : snap.includes('e') ? innerW - f.w : f.lx;
      const ly = snap.includes('n') ? 0 : snap.includes('s') ? innerH - f.h : f.ly;
      const x = room.x + INSET + lx;
      const y = room.y + INSET + ly;
      const item = { kind: f.kind, x, y, w: f.w, h: f.h, front: f.front ?? 's', color: f.color ?? null, round: Boolean(f.round), room: room.id, spot: -1 };
      if (item.x < room.x + INSET - 1e-6 || item.y < room.y + INSET - 1e-6 || item.x + item.w > room.x + room.w - INSET + 1e-6 || item.y + item.h > room.y + room.h - INSET + 1e-6) {
        throw new Error(`${def.id}: ${f.kind} in ${room.id} sticks out of the room`);
      }
      if (f.spot) {
        const [fx, fy] = FRONT[item.front];
        const cx = x + f.w / 2;
        const cy = y + f.h / 2;
        // The spot's own numbers: hide point (inside), where eyes peek out, and where you step out / walk up to it.
        const edgeX = cx + (fx * f.w) / 2;
        const edgeY = cy + (fy * f.h) / 2;
        item.spot = spots.length;
        spots.push({
          i: spots.length,
          kind: f.kind,
          room: room.id,
          x,
          y,
          w: f.w,
          h: f.h,
          front: item.front,
          cx,
          cy,
          ex: edgeX - fx * 0.3,
          ey: edgeY - fy * 0.3,
          ax: edgeX + fx * 0.75,
          ay: edgeY + fy * 0.75,
        });
      }
      if (!NON_SOLID.has(f.kind)) solids.push([x, y, f.w, f.h]);
      decor.push(item);
    }
  }
  // Rugs are drawn first, under everything.
  decor.sort((a, b) => Number(NON_SOLID.has(b.kind)) - Number(NON_SOLID.has(a.kind)));
  const blockers = walls.concat(solids);

  // A free point near each room's middle, and ring starts around the spawn for the hiders (all checked free).
  const free = (x, y, pad) => pointFree(blockers, x, y, pad);
  const nearFree = (x, y, pad = 0.7) => {
    for (let r = 0; r < 8; r += 0.5) {
      const steps = Math.max(1, Math.round(r * 8));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (px > 0.8 && py > 0.8 && px < def.w - 0.8 && py < def.h - 0.8 && free(px, py, pad)) return { x: px, y: py };
      }
    }
    return { x, y };
  };
  const rooms = def.rooms.map((r) => {
    const p = nearFree(r.x + r.w / 2, r.y + r.h / 2);
    return { ...r, ax: p.x, ay: p.y };
  });
  const hiderStarts = [];
  for (let k = 0; k < 12; k++) {
    const a = 0.35 + (k / 12) * Math.PI * 2;
    let r = 2.4 + (k % 2) * 1.5;
    let p = { x: def.spawn.x + Math.cos(a) * r, y: def.spawn.y + Math.sin(a) * r };
    while (!free(p.x, p.y, 0.7) && r > 0.6) {
      r -= 0.4;
      p = { x: def.spawn.x + Math.cos(a) * r, y: def.spawn.y + Math.sin(a) * r };
    }
    hiderStarts.push({ x: p.x, y: p.y });
  }
  const seekerStarts = [
    { x: def.spawn.x - 1, y: def.spawn.y, a: Math.PI / 2 },
    { x: def.spawn.x + 1, y: def.spawn.y, a: Math.PI / 2 },
  ];
  return {
    id: def.id,
    name: def.name,
    w: def.w,
    h: def.h,
    rooms,
    walls,
    doors,
    decor,
    spots,
    solids,
    blockers,
    lights: def.lights,
    spawn: def.spawn,
    hiderStarts,
    seekerStarts,
  };
}

const cache = new Map();
const DEFS = { cozy: COZY, mansion: MANSION };

/** The house for a map id ('cozy' or 'mansion'; anything else is the cozy one). Built once. */
export function getHouse(id) {
  const key = Object.prototype.hasOwnProperty.call(DEFS, id) ? id : 'cozy';
  if (!cache.has(key)) cache.set(key, build(DEFS[key]));
  return cache.get(key);
}
export const HOUSE_IDS = ['cozy', 'mansion'];

/** Which room a point is in (or null). */
export function roomAt(house, x, y) {
  for (const r of house.rooms) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  return null;
}

/** The nearest spot within `reach` of the point (distance to its edge), preferring ones `ok` accepts; or null. */
export function nearestSpot(house, x, y, reach, ok) {
  let best = null;
  let bd = reach;
  for (const s of house.spots) {
    if (ok && !ok(s.i)) continue;
    const d = distToRect(x, y, [s.x, s.y, s.w, s.h]);
    if (d <= bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Keeps a point inside the house (safety net for anything positional that arrived from outside). */
export function clampToHouse(house, p) {
  p.x = clamp(Number.isFinite(p.x) ? p.x : house.spawn.x, 0.5, house.w - 0.5);
  p.y = clamp(Number.isFinite(p.y) ? p.y : house.spawn.y, 0.5, house.h - 0.5);
  return p;
}
