// Seeded randomness. Everything built from a seed (courses, hazard phases, bot jitter)
// comes from one of these so a seed replays exactly.

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function toSeed(seed) {
  if (typeof seed === 'string') return hashString(seed);
  const n = Number(seed);
  if (!Number.isFinite(n)) return 1;
  return (Math.floor(Math.abs(n)) >>> 0) || 1;
}

export function makeRng(seed) {
  let a = toSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    fork: (label) => makeRng(hashString(`${a}:${label}`)),
  };
}

// A smooth, repeatable 1D noise (sum of sines) for terrain wobble: no tables, no allocation.
export function wobble(x, seed) {
  const s = (seed % 1000) * 0.137;
  return 0.5 * Math.sin(x * 0.31 + s) + 0.3 * Math.sin(x * 0.77 + s * 2.1) + 0.2 * Math.sin(x * 1.93 + s * 3.7);
}
