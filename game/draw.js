// Drawing: the house seen from above at dusk (flat colours, thick dark outlines, solid offset shadows), furniture, characters,
// flashlight beams and the seeker's darkness. Everything takes the canvas context and a plain description of the scene,
// so the title screen, the game and the store posters all use the same renderer. No window or document needed here.

import { hashString } from './rules.js';

export const FONT = "'Chewy', 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
export const OUT = '#2a1830';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the view
/** Pixels per house unit: about 16 x 9 units on a landscape screen, 10 across in portrait. */
export function viewScale(W, H) {
  const s = H > W ? W / 10 : Math.min(W / 16, H / 9);
  return Math.max(22, s);
}

/** A view of the world: camera centre (cx, cy), shake offset (ox, oy) in pixels and the pixel ratio. */
export function makeView(W, H, pr, cam, shake) {
  const scale = viewScale(W, H);
  const v = { W, H, pr, scale, cx: cam.x, cy: cam.y, ox: shake?.x ?? 0, oy: shake?.y ?? 0 };
  v.x0 = v.cx - W / 2 / scale - 1;
  v.x1 = v.cx + W / 2 / scale + 1;
  v.y0 = v.cy - H / 2 / scale - 1;
  v.y1 = v.cy + H / 2 / scale + 1;
  return v;
}

/** Keeps the camera inside the house (centred when the house is smaller than the view). */
export function clampCamera(v, house, cam) {
  const hw = v.W / 2 / v.scale;
  const hh = v.H / 2 / v.scale;
  const m = 0.8;
  cam.x = house.w + 2 * m <= hw * 2 ? house.w / 2 : Math.min(house.w + m - hw, Math.max(-m + hw, cam.x));
  cam.y = house.h + 2 * m <= hh * 2 ? house.h / 2 : Math.min(house.h + m - hh, Math.max(-m + hh, cam.y));
}

export const toScreenX = (v, x) => (x - v.cx) * v.scale + v.W / 2 + v.ox;
export const toScreenY = (v, y) => (y - v.cy) * v.scale + v.H / 2 + v.oy;

export function worldTransform(c, v) {
  c.setTransform(v.pr * v.scale, 0, 0, v.pr * v.scale, v.pr * (v.W / 2 - v.cx * v.scale + v.ox), v.pr * (v.H / 2 - v.cy * v.scale + v.oy));
}
export function screenTransform(c, v) {
  c.setTransform(v.pr, 0, 0, v.pr, 0, 0);
}

const inView = (v, x, y, w, h) => x < v.x1 && x + w > v.x0 && y < v.y1 && y + h > v.y0;

// ---------------------------------------------------------------- shape helpers
function rrPath(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function rbox(c, x, y, w, h, r, fill, lw, stroke = OUT) {
  rrPath(c, x, y, w, h, r);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (lw) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.lineJoin = 'round';
    c.stroke();
  }
}

function disc(c, x, y, r, fill, lw, stroke = OUT) {
  c.beginPath();
  c.arc(x, y, Math.max(0.001, r), 0, TAU);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (lw) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function ellipse(c, x, y, rx, ry, fill, lw, stroke = OUT) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, TAU);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (lw) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
}

/** White text with a thick dark outline (the one text style of the game). */
export function label(c, str, x, y, size, o = {}) {
  c.font = `${size}px ${FONT}`;
  c.textAlign = o.align || 'center';
  c.textBaseline = o.base || 'middle';
  c.lineJoin = 'round';
  c.miterLimit = 2;
  c.lineWidth = o.lw ?? Math.max(3, size * 0.22);
  c.strokeStyle = o.stroke || OUT;
  c.strokeText(str, x, y);
  c.fillStyle = o.fill || '#fff';
  c.fillText(str, x, y);
}

// ---------------------------------------------------------------- floors, rugs, lamp light, walls
const FLOORS = {
  wood: { a: '#c98b52', line: 'rgba(110,62,26,0.38)', kind: 'planks' },
  wood2: { a: '#d8a366', line: 'rgba(110,62,26,0.32)', kind: 'planks' },
  tile: { a: '#bfe6ea', b: '#a6d6dc', kind: 'tile' },
  tile2: { a: '#dde5f7', b: '#c4d0ee', kind: 'tile' },
  check: { a: '#f7e8ca', b: '#e6cd9a', kind: 'check' },
  carpet: { a: '#f7b8cf', line: 'rgba(255,255,255,0.4)', kind: 'carpet' },
  grass: { a: '#7cc65c', b: '#5aa844', kind: 'grass' },
};

function drawFloors(c, v, house) {
  for (const r of house.rooms) {
    if (!inView(v, r.x, r.y, r.w, r.h)) continue;
    const f = FLOORS[r.floor] || FLOORS.wood;
    c.fillStyle = f.a;
    c.fillRect(r.x, r.y, r.w, r.h);
    c.beginPath();
    if (f.kind === 'planks') {
      for (let y = r.y + 0.9; y < r.y + r.h; y += 0.9) {
        c.moveTo(r.x, y);
        c.lineTo(r.x + r.w, y);
      }
      let row = 0;
      for (let y = r.y; y < r.y + r.h - 0.01; y += 0.9, row++) {
        for (let x = r.x + 1.3 + ((row * 1.7) % 3.1); x < r.x + r.w; x += 3.1) {
          c.moveTo(x, y);
          c.lineTo(x, Math.min(y + 0.9, r.y + r.h));
        }
      }
      c.strokeStyle = f.line;
      c.lineWidth = 0.05;
      c.stroke();
    } else if (f.kind === 'tile' || f.kind === 'check') {
      c.fillStyle = f.b;
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) if ((i + j) % 2 === 0) c.rect(r.x + i, r.y + j, 1, 1);
      c.fill();
      if (f.kind === 'tile') {
        c.beginPath();
        for (let i = 1; i < r.w; i++) {
          c.moveTo(r.x + i, r.y);
          c.lineTo(r.x + i, r.y + r.h);
        }
        for (let j = 1; j < r.h; j++) {
          c.moveTo(r.x, r.y + j);
          c.lineTo(r.x + r.w, r.y + j);
        }
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = 0.04;
        c.stroke();
      }
    } else if (f.kind === 'carpet') {
      c.strokeStyle = f.line;
      c.lineWidth = 0.1;
      c.setLineDash([0.25, 0.25]);
      c.strokeRect(r.x + 0.7, r.y + 0.7, r.w - 1.4, r.h - 1.4);
      c.setLineDash([]);
    } else if (f.kind === 'grass') {
      c.strokeStyle = f.b;
      c.lineWidth = 0.07;
      c.lineCap = 'round';
      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) {
          const k = (i * 7 + j * 13) % 5;
          const x = r.x + i + 0.2 + k * 0.15;
          const y = r.y + j + 0.3 + ((i * 3 + j * 5) % 4) * 0.15;
          c.moveTo(x - 0.1, y + 0.1);
          c.lineTo(x, y - 0.1);
          c.lineTo(x + 0.1, y + 0.1);
        }
      }
      c.stroke();
      c.lineCap = 'butt';
    }
  }
}

function drawRugs(c, v, house) {
  const l = 3 / v.scale;
  for (const f of house.decor) {
    if (f.kind !== 'rug' || !inView(v, f.x, f.y, f.w, f.h)) continue;
    const col = f.color || '#e9777d';
    if (f.round) {
      ellipse(c, f.x + f.w / 2, f.y + f.h / 2, f.w / 2, f.h / 2, col, l * 0.8);
      ellipse(c, f.x + f.w / 2, f.y + f.h / 2, f.w / 2 - 0.3, f.h / 2 - 0.3, null, l * 0.5, 'rgba(255,255,255,0.55)');
    } else {
      rbox(c, f.x, f.y, f.w, f.h, 0.25, col, l * 0.8);
      rbox(c, f.x + 0.25, f.y + 0.25, f.w - 0.5, f.h - 0.5, 0.15, null, l * 0.5, 'rgba(255,255,255,0.55)');
    }
  }
}

function drawLamps(c, v, house) {
  for (const [x, y, r] of house.lights) {
    if (!inView(v, x - r, y - r, r * 2, r * 2)) continue;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,214,120,0.34)');
    g.addColorStop(0.6, 'rgba(255,214,120,0.12)');
    g.addColorStop(1, 'rgba(255,214,120,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function drawWalls(c, v, house) {
  const l = 3.5 / v.scale;
  for (const w of house.walls) {
    if (!inView(v, w[0], w[1], w[2], w[3])) continue;
    c.fillStyle = 'rgba(20,8,30,0.3)';
    c.fillRect(w[0] + 0.1, w[1] + 0.2, w[2], w[3]);
  }
  for (const w of house.walls) {
    if (!inView(v, w[0], w[1], w[2], w[3])) continue;
    if (w[2] > w[3]) {
      c.fillStyle = '#3d2849'; // the wall's face toward us
      c.fillRect(w[0], w[1] + w[3] - 0.04, w[2], 0.3);
    }
    c.fillStyle = '#7a5694';
    c.fillRect(w[0], w[1], w[2], w[3]);
    c.lineWidth = l;
    c.strokeStyle = OUT;
    c.lineJoin = 'round';
    c.strokeRect(w[0], w[1], w[2], w[3]);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    if (w[2] > w[3]) c.fillRect(w[0] + 0.05, w[1] + 0.04, w[2] - 0.1, 0.07);
  }
  for (const d of house.doors) {
    if (!inView(v, d.x, d.y, d.w, d.h)) continue;
    c.fillStyle = '#ecd0a2';
    c.fillRect(d.x, d.y, d.w, d.h);
    c.fillStyle = 'rgba(80,45,20,0.25)';
    if (d.o === 'h') {
      c.fillRect(d.x, d.y + d.h / 2 - 0.02, d.w, 0.04);
    } else {
      c.fillRect(d.x + d.w / 2 - 0.02, d.y, 0.04, d.h);
    }
  }
}

// ---------------------------------------------------------------- furniture
const BLANKETS = { kids: '#4da3ff', playroom: '#4da3ff', bedroom: '#e0655a', master: '#8e63d6' };

const DRAW = {
  bed(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.2, '#9a6a3c', l);
    rbox(c, -w / 2 + 0.14, -h / 2 + 0.14, w - 0.28, h - 0.28, 0.14, '#fbf3e4', l * 0.6);
    const pw = (w - 0.28 - 0.3) / 2;
    rbox(c, -w / 2 + 0.22, -h / 2 + 0.22, pw, 0.5, 0.18, '#fff', l * 0.6);
    rbox(c, 0.08, -h / 2 + 0.22, pw, 0.5, 0.18, '#fff', l * 0.6);
    const by = -h / 2 + h * 0.34;
    rbox(c, -w / 2 + 0.14, by, w - 0.28, h / 2 - 0.14 - by, 0.14, BLANKETS[o.f.room] || '#e0655a', l * 0.8);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(-w / 2 + 0.2, by + 0.2, w - 0.4, 0.13);
    c.fillStyle = 'rgba(20,8,30,0.4)';
    c.fillRect(-w / 2 + 0.14, h / 2 - 0.3, w - 0.28, 0.16);
  },
  wardrobe(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#b9763f', l);
    rbox(c, -w / 2 + 0.1, -h / 2 + 0.1, w - 0.2, h - 0.2, 0.07, '#d19558', l * 0.5);
    const dh = Math.min(0.5, h * 0.42);
    const dy = h / 2 - 0.1 - dh;
    c.fillStyle = '#8c5a2e';
    c.fillRect(-w / 2 + 0.1, dy, w - 0.2, dh);
    c.strokeStyle = OUT;
    c.lineWidth = l * 0.6;
    c.beginPath();
    c.moveTo(0, dy);
    c.lineTo(0, dy + dh);
    c.stroke();
    disc(c, -0.12, dy + dh / 2, 0.055, '#ffe27a', l * 0.4);
    disc(c, 0.12, dy + dh / 2, 0.055, '#ffe27a', l * 0.4);
  },
  box(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.08, '#d9a867', l);
    c.fillStyle = '#f3dcae';
    c.fillRect(-0.12, -h / 2 + 0.02, 0.24, h - 0.04);
    c.strokeStyle = 'rgba(90,50,20,0.45)';
    c.lineWidth = l * 0.5;
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    c.lineTo(-0.12, -0.12);
    c.moveTo(w / 2, -h / 2);
    c.lineTo(0.12, -0.12);
    c.moveTo(-w / 2, h / 2);
    c.lineTo(-0.12, 0.12);
    c.moveTo(w / 2, h / 2);
    c.lineTo(0.12, 0.12);
    c.stroke();
  },
  curtain(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#ff8fab', l);
    const n = Math.max(3, Math.round(w / 0.45));
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = l * 0.7;
    c.beginPath();
    for (let i = 1; i < n; i++) {
      const x = -w / 2 + (i * w) / n;
      c.moveTo(x, -h / 2 + 0.05);
      c.lineTo(x, h / 2 - 0.05);
    }
    c.stroke();
    c.fillStyle = '#6b4a2a';
    c.fillRect(-w / 2, -h / 2, w, 0.1);
  },
  bathtub(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, Math.min(0.5, h / 2), '#f6f9ff', l);
    rbox(c, -w / 2 + 0.2, -h / 2 + 0.2, w - 0.4, h - 0.55, Math.min(0.4, h / 2), '#8fd3ff', l * 0.6);
    disc(c, 0, -h / 2 + 0.2, 0.09, '#cfd8e3', l * 0.5);
    c.fillStyle = '#7fe0c9';
    c.fillRect(-w / 2 + 0.05, h / 2 - 0.24, w - 0.1, 0.18);
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = l * 0.5;
    c.beginPath();
    for (let x = -w / 2 + 0.3; x < w / 2; x += 0.3) {
      c.moveTo(x, h / 2 - 0.24);
      c.lineTo(x, h / 2 - 0.06);
    }
    c.stroke();
  },
  basket(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.3, '#e2b274', l);
    c.strokeStyle = 'rgba(120,70,25,0.4)';
    c.lineWidth = l * 0.5;
    c.beginPath();
    for (let k = -2; k <= 2; k++) {
      c.moveTo(-w / 2 + 0.1, k * 0.25);
      c.lineTo(w / 2 - 0.1, k * 0.25);
    }
    c.stroke();
    const r = Math.min(w, h) * 0.2;
    disc(c, -w * 0.15, -h * 0.1, r, '#ff6b8b', l * 0.6);
    disc(c, w * 0.15, h * 0.08, r * 0.9, '#4da3ff', l * 0.6);
  },
  plant(c, w, h, o) {
    const l = o.l;
    const r = Math.min(w, h) / 2;
    disc(c, 0, 0, r * 0.95, '#c4693b', l);
    const sway = Math.sin(o.t * 3.1) * 0.02 * (1 + o.wob * 4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.3;
      disc(c, Math.cos(a) * r * 0.5 + sway, Math.sin(a) * r * 0.5, r * 0.5, i % 2 ? '#3fa34d' : '#59c25e', l * 0.7);
    }
    disc(c, sway, 0, r * 0.42, '#7bd96f', l * 0.7);
  },
  sofa(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.25, o.color || '#e0655a', l);
    rbox(c, -w / 2 + 0.08, -h / 2 + 0.08, w - 0.16, h * 0.38, 0.18, 'rgba(0,0,0,0.18)', 0);
    const n = Math.max(2, Math.round(w / 1.5));
    for (let i = 0; i < n; i++) rbox(c, -w / 2 + 0.28 + (i * (w - 0.56)) / n, -h / 2 + h * 0.4, (w - 0.56) / n - 0.06, h * 0.5, 0.14, 'rgba(255,255,255,0.22)', l * 0.5);
    rbox(c, -w / 2, -h / 2 + 0.12, 0.26, h - 0.12, 0.12, 'rgba(0,0,0,0.12)', l * 0.6);
    rbox(c, w / 2 - 0.26, -h / 2 + 0.12, 0.26, h - 0.12, 0.12, 'rgba(0,0,0,0.12)', l * 0.6);
  },
  table(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.15, o.color || '#b9803f', l);
    rbox(c, -w / 2 + 0.12, -h / 2 + 0.12, w - 0.24, h - 0.24, 0.1, 'rgba(255,255,255,0.18)', l * 0.4);
  },
  piano(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.2, '#34344a', l);
    rbox(c, -w / 2 + 0.12, -h / 2 + 0.12, w - 0.24, h - 0.62, 0.15, '#4a4a66', l * 0.4);
    c.fillStyle = '#fff';
    c.fillRect(-w / 2 + 0.1, h / 2 - 0.46, w - 0.2, 0.34);
    c.strokeStyle = OUT;
    c.lineWidth = l * 0.4;
    c.beginPath();
    for (let x = -w / 2 + 0.1; x <= w / 2 - 0.09; x += 0.22) {
      c.moveTo(x, h / 2 - 0.46);
      c.lineTo(x, h / 2 - 0.12);
    }
    c.stroke();
    c.fillStyle = '#1c1c2a';
    for (let x = -w / 2 + 0.2; x < w / 2 - 0.2; x += 0.44) c.fillRect(x, h / 2 - 0.46, 0.13, 0.2);
  },
  counter(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#e9e4da', l);
    rbox(c, -w / 2 + 0.1, -h / 2 + 0.1, w - 0.2, h - 0.2, 0.06, '#d3cdc0', l * 0.4);
    const long = Math.max(w, h) > 1.6;
    if (long) disc(c, 0, 0, Math.min(w, h) * 0.3, '#b8c9d9', l * 0.5);
  },
  fridge(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#e3ebf2', l);
    c.strokeStyle = OUT;
    c.lineWidth = l * 0.5;
    c.beginPath();
    c.moveTo(-w / 2 + 0.05, h * 0.1);
    c.lineTo(w / 2 - 0.05, h * 0.1);
    c.stroke();
    rbox(c, w / 2 - 0.35, h * 0.2, 0.14, 0.34, 0.05, '#9aa8b8', l * 0.4);
  },
  toilet(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h * 0.34, 0.1, '#fff', l);
    ellipse(c, 0, h * 0.14, w * 0.42, h * 0.36, '#fff', l);
    ellipse(c, 0, h * 0.16, w * 0.26, h * 0.22, '#dff0ff', l * 0.4);
  },
  sink(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.12, '#fff', l);
    ellipse(c, 0, h * 0.05, w * 0.3, h * 0.28, '#bfe6ff', l * 0.5);
    disc(c, 0, -h / 2 + 0.14, 0.06, '#9aa8b8', l * 0.4);
  },
  washer(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#f2f4f8', l);
    disc(c, 0, h * 0.08, Math.min(w, h) * 0.32, '#8ec5ee', l);
    disc(c, 0, h * 0.08, Math.min(w, h) * 0.18, 'rgba(255,255,255,0.4)', 0);
    disc(c, w * 0.3, -h * 0.34, 0.06, '#ff6b8b', l * 0.4);
  },
  bookcase(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.06, '#8d5a32', l);
    const cols = ['#e0655a', '#4da3ff', '#ffd23f', '#38c96b', '#a45cff', '#ff8a1f'];
    const long = w > h;
    const n = Math.max(3, Math.round((long ? w : h) / 0.28));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * (long ? w - 0.16 : h - 0.16) - (long ? w : h) / 2 + 0.08;
      c.fillStyle = cols[i % cols.length];
      if (long) c.fillRect(t - 0.1, -h / 2 + 0.12, 0.2, h - 0.24);
      else c.fillRect(-w / 2 + 0.12, t - 0.1, w - 0.24, 0.2);
    }
  },
  desk(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#a9743f', l);
    rbox(c, -0.5, -0.4, 1.0, 0.65, 0.06, '#c8d0da', l * 0.5);
    disc(c, w / 2 - 0.4, -h / 2 + 0.4, 0.2, '#ffd23f', l * 0.5);
  },
  dresser(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.1, '#b57a42', l);
    c.strokeStyle = OUT;
    c.lineWidth = l * 0.5;
    c.beginPath();
    const n = Math.max(2, Math.round(w / 0.9));
    for (let i = 1; i < n; i++) {
      c.moveTo(-w / 2 + (i * w) / n, -h / 2 + 0.05);
      c.lineTo(-w / 2 + (i * w) / n, h / 2 - 0.05);
    }
    c.stroke();
    for (let i = 0; i < n; i++) disc(c, -w / 2 + ((i + 0.5) * w) / n, 0, 0.05, '#ffe27a', l * 0.3);
  },
  rack(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.08, null, l * 0.8, '#7b8798');
    const cols = ['#ff6b8b', '#4da3ff', '#ffd23f', '#38c96b'];
    const n = Math.max(3, Math.round(w / 0.45));
    for (let i = 0; i < n; i++) rbox(c, -w / 2 + 0.12 + (i * (w - 0.3)) / n, -h / 2 + 0.1, (w - 0.3) / n - 0.05, h - 0.2, 0.05, cols[i % 4], l * 0.4);
  },
  bench(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.08, '#b9803f', l);
    c.strokeStyle = 'rgba(70,35,10,0.5)';
    c.lineWidth = l * 0.5;
    c.beginPath();
    for (let x = -w / 2 + 0.45; x < w / 2; x += 0.45) {
      c.moveTo(x, -h / 2 + 0.05);
      c.lineTo(x, h / 2 - 0.05);
    }
    c.stroke();
  },
  pond(c, w, h, o) {
    const l = o.l;
    ellipse(c, 0, 0, w / 2, h / 2, '#6ec6f0', l);
    ellipse(c, 0, 0, w / 2 - 0.25, h / 2 - 0.25, null, l * 0.4, 'rgba(255,255,255,0.6)');
    disc(c, -w * 0.15, -h * 0.05, 0.22, '#59c25e', l * 0.5);
    disc(c, w * 0.18, h * 0.1, 0.18, '#59c25e', l * 0.5);
  },
  bedside(c, w, h, o) {
    const l = o.l;
    rbox(c, -w / 2, -h / 2, w, h, 0.08, '#b57a42', l);
    disc(c, 0, 0, Math.min(w, h) * 0.28, '#ffd23f', l * 0.5);
  },
};
DRAW.armchair = (c, w, h, o) => DRAW.sofa(c, w, h, { ...o, color: '#c4693b' });
DRAW.couch = (c, w, h, o) => DRAW.sofa(c, w, h, { ...o, color: '#4da3a8' });
DRAW.coffee = DRAW.table;
DRAW.island = (c, w, h, o) => DRAW.table(c, w, h, { ...o, color: '#e6e1d6' });
DRAW.dryer = DRAW.washer;
DRAW.shelf = DRAW.bookcase;
DRAW.cabinet = DRAW.dresser;

const FRONT_ROT = { s: 0, n: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };

/** One piece of furniture. `st` is the spot's live state ({ open, wob, hot, occ }) for spots. */
function drawFurniture(c, v, f, st, t, sofaColor) {
  if (!inView(v, f.x, f.y, f.w, f.h)) return;
  const l = 3.2 / v.scale;
  const wob = st ? st.wob : 0;
  const open = st ? st.open : 0;
  // the shadow: an offset darker shape
  rbox(c, f.x + 0.12, f.y + 0.18, f.w, f.h, f.kind === 'plant' || f.kind === 'pond' ? Math.min(f.w, f.h) / 2 : 0.15, 'rgba(20,8,30,0.28)', 0);
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  c.save();
  c.translate(cx, cy);
  if (wob > 0) {
    c.rotate(Math.sin(t * 41) * 0.05 * wob);
    c.translate(Math.sin(t * 37) * 0.04 * wob, 0);
  }
  const rot = FRONT_ROT[f.front] ?? 0;
  c.rotate(rot);
  const swap = f.front === 'e' || f.front === 'w';
  const w = swap ? f.h : f.w;
  const h = swap ? f.w : f.h;
  const draw = DRAW[f.kind] || ((cc, ww, hh, oo) => rbox(cc, -ww / 2, -hh / 2, ww, hh, 0.1, '#a9a9b8', oo.l));
  draw(c, w, h, { l, t, wob, open, f, color: f.color || sofaColor });
  if (open > 0) {
    c.fillStyle = `rgba(14,6,24,${0.85 * Math.min(1, open * 1.4)})`;
    const oh = Math.min(h * 0.6, 0.6) * open;
    c.fillRect(-w / 2 + 0.16, h / 2 - 0.1 - oh, w - 0.32, oh);
  }
  c.restore();
}

function drawSpotMarks(c, v, house, spots, t) {
  const l2 = 2.5 / v.scale;
  c.lineCap = 'round';
  for (const s of house.spots) {
    if (!inView(v, s.x, s.y, s.w, s.h)) continue;
    const st = spots[s.i];
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + s.i);
    c.setLineDash([0.16, 0.14]);
    c.strokeStyle = `rgba(255,246,190,${0.4 + 0.2 * pulse})`;
    c.lineWidth = l2;
    rrPath(c, s.x - 0.07, s.y - 0.07, s.w + 0.14, s.h + 0.14, 0.14);
    c.stroke();
    c.setLineDash([]);
    if (st && st.hot) {
      c.strokeStyle = `rgba(255,236,110,${0.7 + 0.3 * pulse})`;
      c.lineWidth = 5.5 / v.scale;
      rrPath(c, s.x - 0.12, s.y - 0.12, s.w + 0.24, s.h + 0.24, 0.18);
      c.stroke();
    }
  }
  c.lineCap = 'butt';
}

// ---------------------------------------------------------------- faces and characters
const SKINS = ['#ffd9b3', '#f3c08f', '#e0a877', '#c58b5c', '#ffe6cc', '#f1b9a0'];

export const hashOf = (s) => hashString(String(s));

/** Two eyes (blinking, looking at `look`: -1..1 sideways). */
function eyes(c, x, y, r, o) {
  const blink = o.blink ?? 1;
  const ex = r * 0.38;
  const er = r * (o.big ? 0.34 : 0.27);
  for (const s of [-1, 1]) {
    ellipse(c, x + s * ex, y, er, er * (o.laugh ? 0.5 : 1.15) * blink + 0.0001, '#fff', o.lw * 0.7);
    if (blink > 0.4) disc(c, x + s * ex + (o.look || 0) * er * 0.4, y + er * 0.08, er * 0.5, OUT, 0);
  }
}

function blinkOf(t, phase) {
  const k = (t * 0.7 + phase) % 3.1;
  return k > 2.95 ? 0.15 : 1;
}

/** A head: the player's avatar when it's loaded, else a generated cute face. Works in any coordinates (r in the same units). */
export function drawHead(c, ch, x, y, r, o = {}) {
  const lw = o.lw ?? r * 0.16;
  const t = o.t ?? 0;
  const h = ch.face ?? hashOf(ch.id);
  const img = ch.img;
  if (img && img.complete && img.naturalWidth > 0) {
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.clip();
    c.fillStyle = '#ffe3c2';
    c.fillRect(x - r, y - r, r * 2, r * 2);
    const w = r * 2.5;
    const hh = (w * img.naturalHeight) / img.naturalWidth;
    c.drawImage(img, x - w / 2, y - hh / 2 + r * 0.08, w, hh);
    c.restore();
    disc(c, x, y, r, null, lw);
    return;
  }
  const bot = Boolean(ch.bot);
  disc(c, x, y, r, bot ? `hsl(${(h % 360) | 0}, 75%, 80%)` : SKINS[h % SKINS.length], lw);
  const emote = ch.emote || '';
  const look = o.look ?? 0;
  const blink = emote ? 1 : blinkOf(t, (h % 97) / 31);
  eyes(c, x, y - r * 0.08, r, { blink, look, big: emote === 'surprised', laugh: emote === 'laugh' || emote === 'cheer', lw });
  // cheeks
  disc(c, x - r * 0.62, y + r * 0.2, r * 0.13, 'rgba(255,100,130,0.45)', 0);
  disc(c, x + r * 0.62, y + r * 0.2, r * 0.13, 'rgba(255,100,130,0.45)', 0);
  c.strokeStyle = OUT;
  c.lineWidth = lw * 0.8;
  c.lineCap = 'round';
  c.beginPath();
  if (emote === 'surprised') {
    c.ellipse(x, y + r * 0.45, r * 0.16, r * 0.22, 0, 0, TAU);
    c.fillStyle = '#5a2030';
    c.fill();
  } else if (emote === 'laugh' || emote === 'cheer') {
    c.arc(x, y + r * 0.22, r * 0.34, 0.1, Math.PI - 0.1);
    c.fillStyle = '#5a2030';
    c.fill();
  } else {
    const m = (h >> 4) % 3;
    if (m === 0) c.arc(x, y + r * 0.2, r * 0.3, 0.25, Math.PI - 0.25);
    else if (m === 1) {
      c.moveTo(x - r * 0.22, y + r * 0.42);
      c.quadraticCurveTo(x, y + r * 0.62, x + r * 0.22, y + r * 0.42);
    } else c.arc(x, y + r * 0.35, r * 0.18, 0, Math.PI);
  }
  c.stroke();
  c.lineCap = 'butt';
}

/** Just a pair of eyes, peeking out of a hiding place. */
export function drawPeek(c, x, y, r, t, phase, look = 0, l = 0.04) {
  const blink = blinkOf(t, phase);
  ellipse(c, x, y, r * 1.5, r * 0.85, 'rgba(10,4,18,0.75)', 0);
  for (const s of [-1, 1]) {
    ellipse(c, x + s * r * 0.55, y, r * 0.42, r * 0.5 * blink + 0.001, '#fff', l);
    if (blink > 0.4) disc(c, x + s * r * 0.55 + look * r * 0.12, y, r * 0.2, OUT, 0);
  }
}

/** A flashlight in the hand, pointing along `a`. */
function flashlight(c, x, y, a, big, l) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  const len = big ? 0.62 : 0.46;
  const th = big ? 0.2 : 0.15;
  rbox(c, 0.12, -th / 2, len, th, th * 0.35, '#5b6577', l);
  rbox(c, 0.12 + len - 0.14, -th * 0.75, 0.2, th * 1.5, th * 0.4, '#ffd23f', l);
  c.restore();
}

function glasses(c, x, y, r, l) {
  const gr = r * 0.46;
  for (const s of [-1, 1]) disc(c, x + s * r * 0.45, y - r * 0.05, gr, 'rgba(255,255,255,0.35)', l * 1.1, '#2a1830');
  c.strokeStyle = '#2a1830';
  c.lineWidth = l;
  c.beginPath();
  c.moveTo(x - r * 0.45 + gr, y - r * 0.05);
  c.lineTo(x + r * 0.45 - gr, y - r * 0.05);
  c.stroke();
}

/**
 * A character in the world. ch: { x, y, vx, vy, a, color, role, you, face, img, bot, walk, sq, pop, alpha, emote, phase, cheer }.
 * role 'seeker' / 'found' draws glasses and a flashlight.
 */
function drawChar(c, v, ch, t) {
  const l = 3.4 / v.scale;
  const speed = Math.hypot(ch.vx || 0, ch.vy || 0);
  const moving = Math.min(1, speed / 3);
  const walk = ch.walk || 0;
  const bob = Math.abs(Math.sin(walk)) * moving * 0.08 + Math.sin(t * 3 + (ch.phase || 0)) * 0.012 + (ch.cheer ? Math.abs(Math.sin(t * 9 + (ch.phase || 0))) * 0.25 : 0);
  const pop = ch.pop ?? 1;
  const sq = ch.sq || 0;
  const x = ch.x;
  const y = ch.y;
  const seeker = ch.role === 'seeker' || ch.role === 'found';
  const body = ch.role === 'seeker' ? '#ff8a1f' : ch.role === 'found' ? '#ffb347' : ch.color;
  c.globalAlpha = ch.alpha ?? 1;
  // ground shadow
  ellipse(c, x + 0.08, y + 0.36, 0.4 * pop, 0.2 * pop, 'rgba(20,8,30,0.3)', 0);
  if (ch.you) {
    const k = 0.5 + 0.5 * Math.sin(t * 4);
    ellipse(c, x, y + 0.34, 0.6 + k * 0.04, 0.34 + k * 0.02, null, 4 / v.scale, 'rgba(255,255,255,0.8)');
  }
  c.save();
  c.translate(x, y + 0.36);
  c.scale((1 + sq) * pop, (1 - sq) * pop);
  c.translate(-x, -(y + 0.36));
  const ly = y - bob;
  // feet
  const step = Math.sin(walk * 1.0) * 0.09 * moving;
  ellipse(c, x - 0.14, y + 0.3 + step, 0.1, 0.075, '#3a2a40', l * 0.6);
  ellipse(c, x + 0.14, y + 0.3 - step, 0.1, 0.075, '#3a2a40', l * 0.6);
  // arms
  const sw = Math.sin(walk) * 0.1 * moving;
  const cheerY = ch.cheer ? -0.32 - Math.abs(Math.sin(t * 9 + (ch.phase || 0))) * 0.1 : 0;
  disc(c, x - 0.37, ly + 0.1 + sw + cheerY, 0.1, body, l * 0.7);
  if (!seeker) disc(c, x + 0.37, ly + 0.1 - sw + cheerY, 0.1, body, l * 0.7);
  // body
  rbox(c, x - 0.3, ly - 0.08, 0.6, 0.5, 0.22, body, l);
  c.fillStyle = 'rgba(255,255,255,0.22)';
  c.fillRect(x - 0.2, ly - 0.02, 0.4, 0.07);
  // flashlight in the right hand, pointing where the player faces
  if (seeker) {
    flashlight(c, x + 0.3, ly + 0.14, ch.a || 0, ch.role === 'seeker', l * 0.7);
    disc(c, x + 0.34, ly + 0.14, 0.1, body, l * 0.7);
  }
  // bots have a little antenna
  if (ch.bot) {
    c.strokeStyle = OUT;
    c.lineWidth = l * 0.8;
    c.beginPath();
    c.moveTo(x, ly - 0.55);
    c.lineTo(x + Math.sin(t * 4 + (ch.phase || 0)) * 0.05, ly - 0.74);
    c.stroke();
    disc(c, x + Math.sin(t * 4 + (ch.phase || 0)) * 0.05, ly - 0.76, 0.07, '#ff4f6d', l * 0.6);
  }
  // head
  drawHead(c, ch, x, ly - 0.3, 0.33, { lw: l, t, look: Math.cos(ch.a || 0) * 0.8 });
  if (seeker) glasses(c, x, ly - 0.3, 0.33, l * 0.8);
  c.restore();
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- flashlight beams and darkness
function beamPath(c, poly) {
  c.beginPath();
  c.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) c.lineTo(poly[i], poly[i + 1]);
  c.closePath();
}

function drawBeam(c, b) {
  if (!b.poly || b.poly.length < 6) return;
  beamPath(c, b.poly);
  const g = c.createRadialGradient(b.x, b.y, 0.2, b.x, b.y, b.cone.range);
  const a = b.alpha ?? 1;
  g.addColorStop(0, `rgba(255,244,180,${0.55 * a})`);
  g.addColorStop(1, `rgba(255,236,150,${0.1 * a})`);
  c.fillStyle = g;
  c.fill();
}

/** The seeker's own sight: everything outside the lit polygon goes dark. Screen space. */
function drawDarkness(c, v, dim, house) {
  screenTransform(c, v);
  c.beginPath();
  c.rect(-10, -10, v.W + 20, v.H + 20);
  const p = dim.poly;
  if (p && p.length >= 6) {
    c.moveTo(toScreenX(v, p[0]), toScreenY(v, p[1]));
    for (let i = 2; i < p.length; i += 2) c.lineTo(toScreenX(v, p[i]), toScreenY(v, p[i + 1]));
    c.closePath();
  }
  c.fillStyle = `rgba(8,6,26,${dim.alpha ?? 0.84})`;
  c.fill('evenodd');
  if (p && p.length >= 6) {
    // a warm glow where the light falls
    const sx = toScreenX(v, dim.x);
    const sy = toScreenY(v, dim.y);
    const g = c.createRadialGradient(sx, sy, 4, sx, sy, dim.cone.range * v.scale);
    g.addColorStop(0, 'rgba(255,225,140,0.22)');
    g.addColorStop(1, 'rgba(255,225,140,0.04)');
    c.beginPath();
    c.moveTo(toScreenX(v, p[0]), toScreenY(v, p[1]));
    for (let i = 2; i < p.length; i += 2) c.lineTo(toScreenX(v, p[i]), toScreenY(v, p[i + 1]));
    c.closePath();
    c.fillStyle = g;
    c.fill();
  }
  worldTransform(c, v);
}

// ---------------------------------------------------------------- the whole scene
/**
 * Draws the world. scene: { house, t, spots: [{ occ, open, wob, hot, label }], chars: [...], beams: [{ x, y, a, cone, poly, alpha }],
 * dim: { x, y, cone, poly, alpha } | null, blind: bool, fx }. chars: see drawChar; `peek` (a spot index) draws only eyes at
 * that spot (hiders who hide); `draw: false` leaves a character out.
 */
export function renderScene(c, v, scene) {
  const { house, t } = scene;
  // the dusk outside
  screenTransform(c, v);
  c.fillStyle = '#1c2d40';
  c.fillRect(0, 0, v.W, v.H);
  worldTransform(c, v);
  // the lawn around the house
  c.fillStyle = '#25473f';
  c.fillRect(-3, -3, house.w + 6, house.h + 6);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0.3, 0.45, house.w, house.h);
  drawFloors(c, v, house);
  drawRugs(c, v, house);
  c.fillStyle = 'rgba(40,24,100,0.13)';
  c.fillRect(0, 0, house.w, house.h);
  drawLamps(c, v, house);
  drawWalls(c, v, house);
  // furniture (spots carry live state)
  for (const f of house.decor) {
    if (f.kind === 'rug') continue;
    drawFurniture(c, v, f, f.spot >= 0 ? scene.spots[f.spot] : null, t, null);
  }
  drawSpotMarks(c, v, house, scene.spots, t);
  // beams of the seekers the viewer can see (hiders, spectators)
  if (!scene.dim) for (const b of scene.beams) drawBeam(c, b);
  if (scene.dim) {
    drawDarkness(c, v, scene.dim, house);
    for (const b of scene.beams) drawBeam(c, b);
  }
  // eyes of hiders in their spots (those the viewer is allowed to know about)
  for (const ch of scene.chars) {
    if (ch.draw === false || ch.peek === undefined || ch.peek < 0) continue;
    const s = house.spots[ch.peek];
    if (!s) continue;
    const front = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[s.front];
    drawPeek(c, s.ex - front[0] * 0.05, s.ey - front[1] * 0.05, 0.2, t, (ch.phase || 0), 0, 3 / v.scale);
  }
  if (scene.under) scene.under(c, v); // posters put a podium under the characters
  // characters, back to front
  const list = scene.chars.filter((ch) => ch.draw !== false && (ch.peek === undefined || ch.peek < 0));
  list.sort((a, b) => a.y - b.y);
  for (const ch of list) drawChar(c, v, ch, t);
  if (scene.fx) scene.fx.draw(c);
  if (scene.blind) {
    screenTransform(c, v);
    c.fillStyle = 'rgba(8,6,26,0.93)';
    c.fillRect(0, 0, v.W, v.H);
    worldTransform(c, v);
  }
  screenTransform(c, v);
}

/** Labels over the world (names, ready checks, prompts, floating text): screen space, call after renderScene. */
export function renderLabels(c, v, scene) {
  const t = scene.t;
  const size = Math.max(14, Math.min(19, v.scale * 0.34));
  // floating prompts over spots
  for (const s of scene.house.spots) {
    const st = scene.spots[s.i];
    if (!st || !st.label) continue;
    const x = toScreenX(v, s.x + s.w / 2);
    const y = toScreenY(v, s.y) - 18 - Math.sin(t * 6) * 3;
    if (x < -50 || x > v.W + 50 || y < -50 || y > v.H + 50) continue;
    label(c, st.label, x, y, Math.max(18, size + 3), { fill: st.fill || '#ffe27a' });
  }
  for (const ch of scene.chars) {
    if (ch.draw === false || (ch.peek !== undefined && ch.peek >= 0)) continue;
    const x = toScreenX(v, ch.x);
    const y = toScreenY(v, ch.y);
    if (x < -80 || x > v.W + 80 || y < -80 || y > v.H + 80) continue;
    const top = y - 1.05 * v.scale;
    if (ch.name && !ch.noName) {
      label(c, ch.name, x, top, size, { fill: ch.you ? '#fff7b0' : '#fff' });
    }
    if (ch.ready) {
      const r = Math.max(13, v.scale * 0.28);
      c.beginPath();
      c.arc(x, top - r - 4, r, 0, TAU);
      c.fillStyle = '#38c96b';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = OUT;
      c.stroke();
      c.strokeStyle = '#fff';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(x - r * 0.45, top - r - 3);
      c.lineTo(x - r * 0.1, top - r + r * 0.3);
      c.lineTo(x + r * 0.5, top - r - r * 0.35 - 3);
      c.stroke();
      c.lineCap = 'butt';
    }
    if (ch.bubble) label(c, ch.bubble, x, top - 22, size + 2, { fill: '#cfe9ff' });
    if (ch.arrow) {
      // the bouncing arrow over you for the first seconds of a round
      const by = top - 24 - Math.abs(Math.sin(t * 5)) * 10;
      c.beginPath();
      c.moveTo(x, by + 14);
      c.lineTo(x - 12, by - 6);
      c.lineTo(x + 12, by - 6);
      c.closePath();
      c.fillStyle = '#ffe27a';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = OUT;
      c.lineJoin = 'round';
      c.stroke();
      label(c, 'YOU', x, by - 20, size + 2, { fill: '#ffe27a' });
    }
  }
  if (scene.fx) {
    for (const f of scene.fx.floats) {
      const p = f.t / f.dur;
      const e = 1 - Math.pow(1 - Math.min(1, p * 3), 3);
      const x = toScreenX(v, f.x);
      const y = toScreenY(v, f.y) - e * 40 - p * 20;
      c.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      label(c, f.text, x, y, f.size * (0.7 + 0.3 * Math.min(1, p * 5) + (p < 0.15 ? 0.25 * (1 - p / 0.15) : 0)), { fill: f.col });
      c.globalAlpha = 1;
    }
  }
}

export { rbox, rrPath, disc, ellipse };
