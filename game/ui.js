// Screens drawn on the canvas: title, HUD, minimap, banners, countdown, the seeker's counting, scoreboard, podium, lobby settings.
// Few words, big shapes, one font. Screen space (CSS pixels, the context already scaled by the pixel ratio).
import { label, drawHead, OUT, FONT, rbox, disc, ellipse } from './draw.js';
import { ease, clamp01 } from './fx.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/** The biggest font size (up to `max`) at which `str` fits in `maxW` pixels. */
export function fit(c, str, maxW, max) {
  c.font = `${max}px ${FONT}`;
  const w = c.measureText(str).width;
  return w > maxW && w > 0 ? Math.max(12, Math.floor((max * maxW) / w)) : max;
}

/** Tap targets, rebuilt every frame while drawing. */
export class Buttons {
  constructor() {
    this.list = [];
  }
  reset() {
    this.list.length = 0;
  }
  add(id, x, y, w, h, fn) {
    this.list.push({ id, x, y, w, h, fn });
  }
  tap(x, y) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        b.fn();
        return true;
      }
    }
    return false;
  }
}

/** A chunky button: offset shadow, outline, label. Returns its rect. */
export function bigButton(c, x, y, w, h, text, fill, t, pressedPulse = true, dx = 0) {
  const k = pressedPulse ? 1 + Math.sin(t * 4) * 0.025 : 1;
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.scale(k, k);
  rbox(c, -w / 2 + 4, -h / 2 + 7, w, h, h * 0.3, 'rgba(10,4,20,0.4)', 0);
  rbox(c, -w / 2, -h / 2, w, h, h * 0.3, fill, 5);
  rbox(c, -w / 2 + 6, -h / 2 + 6, w - 12, h * 0.34, h * 0.16, 'rgba(255,255,255,0.28)', 0);
  label(c, text, dx, 3, h * 0.6);
  c.restore();
}

// ---------------------------------------------------------------- small icons
export function glassesIcon(c, x, y, r) {
  for (const s of [-1, 1]) disc(c, x + s * r * 0.55, y, r * 0.5, 'rgba(255,255,255,0.7)', r * 0.16);
  c.strokeStyle = OUT;
  c.lineWidth = r * 0.14;
  c.beginPath();
  c.moveTo(x - r * 0.1, y);
  c.lineTo(x + r * 0.1, y);
  c.stroke();
}

export function eyesIcon(c, x, y, r) {
  for (const s of [-1, 1]) {
    ellipse(c, x + s * r * 0.5, y, r * 0.42, r * 0.55, '#fff', r * 0.14);
    disc(c, x + s * r * 0.5, y + r * 0.05, r * 0.2, OUT, 0);
  }
}

function star(c, x, y, r, fill) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = Math.max(2, r * 0.18);
  c.strokeStyle = OUT;
  c.lineJoin = 'round';
  c.stroke();
}

function ghostIcon(c, x, y, r) {
  c.beginPath();
  c.arc(x, y - r * 0.1, r * 0.7, Math.PI, 0);
  c.lineTo(x + r * 0.7, y + r * 0.7);
  for (let i = 3; i >= 0; i--) c.quadraticCurveTo(x - r * 0.7 + ((i + 0.5) * r * 1.4) / 4, y + r * (i % 2 ? 0.5 : 0.95), x - r * 0.7 + (i * r * 1.4) / 4, y + r * 0.7);
  c.closePath();
  c.fillStyle = '#f4f7ff';
  c.fill();
  c.lineWidth = r * 0.14;
  c.strokeStyle = OUT;
  c.lineJoin = 'round';
  c.stroke();
  disc(c, x - r * 0.25, y - r * 0.15, r * 0.12, OUT, 0);
  disc(c, x + r * 0.25, y - r * 0.15, r * 0.12, OUT, 0);
}

function magnifier(c, x, y, r) {
  c.strokeStyle = OUT;
  c.lineWidth = r * 0.5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x + r * 0.35, y + r * 0.35);
  c.lineTo(x + r * 0.95, y + r * 0.95);
  c.stroke();
  c.strokeStyle = '#a8693a';
  c.lineWidth = r * 0.28;
  c.beginPath();
  c.moveTo(x + r * 0.35, y + r * 0.35);
  c.lineTo(x + r * 0.95, y + r * 0.95);
  c.stroke();
  c.lineCap = 'butt';
  disc(c, x - r * 0.15, y - r * 0.15, r * 0.62, 'rgba(180,230,255,0.85)', r * 0.2);
}

// ---------------------------------------------------------------- title
/** The logo: two big eyes peeking over chunky letters. Returns where its second line sits ({ y2, l2 }). */
export function drawLogo(c, W, top, logoH, t) {
  const cx = W / 2;
  const er = logoH * 0.2;
  const ey = top + er * 0.9 + Math.sin(t * 1.3) * 3;
  for (const s of [-1, 1]) {
    ellipse(c, cx + s * er * 1.35, ey, er, er * 1.15, '#fff', 6);
    const lx = Math.cos(t * 0.9) * er * 0.3;
    const ly = Math.sin(t * 1.4) * er * 0.15 + er * 0.2;
    disc(c, cx + s * er * 1.35 + lx, ey + ly, er * 0.46, OUT, 0);
    disc(c, cx + s * er * 1.35 + lx - er * 0.14, ey + ly - er * 0.16, er * 0.14, '#fff', 0);
  }
  const l1 = fit(c, 'HIDE AND', W * 0.86, logoH * 0.52);
  const l2 = fit(c, 'SEEK', W * 0.86, logoH * 0.72);
  const y1 = top + logoH * 0.58;
  const y2 = y1 + l1 * 0.2 + l2 * 0.62;
  c.save();
  c.translate(cx, y1);
  c.rotate(-0.03);
  label(c, 'HIDE AND', 5, 8, l1, { fill: 'rgba(10,4,20,0.4)', stroke: 'rgba(10,4,20,0.4)', lw: l1 * 0.3 });
  label(c, 'HIDE AND', 0, 0, l1, { fill: '#ffd23f', lw: l1 * 0.26 });
  c.restore();
  c.save();
  c.translate(cx, y2);
  c.rotate(0.025);
  label(c, 'SEEK', 6, 10, l2, { fill: 'rgba(10,4,20,0.4)', stroke: 'rgba(10,4,20,0.4)', lw: l2 * 0.28 });
  label(c, 'SEEK', 0, 0, l2, { fill: '#ff8a1f', lw: l2 * 0.24 });
  c.restore();
  return { y2, l2 };
}

/** The logo and one PLAY button, laid out to fit any screen. Returns the button's rect and where the logo ends. */
export function drawTitle(c, W, H, t, touch) {
  const cx = W / 2;
  const bh = Math.max(60, Math.min(80, H * 0.16));
  const bw = Math.min(W * 0.5, 320);
  const bx = cx - bw / 2;
  const by = H - bh - Math.max(18, H * 0.06);
  const top = Math.max(6, H * 0.025);
  const logoH = Math.min(H * 0.34, W * 0.2, (by - 14 - top) / 1.5);
  const { y2, l2 } = drawLogo(c, W, top, logoH, t);
  bigButton(c, bx, by, bw, bh, 'PLAY', '#38c96b', t, true, touch ? 0 : -22);
  if (!touch) {
    const kw = 62;
    const kh = 24;
    rbox(c, bx + bw - kw - 14, by + bh / 2 - kh / 2 + 3, kw, kh, 7, 'rgba(255,255,255,0.92)', 3);
    c.font = `15px ${FONT}`;
    c.fillStyle = OUT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('SPACE', bx + bw - kw / 2 - 14, by + bh / 2 + 4);
  }
  return { x: bx, y: by, w: bw, h: bh, logoBottom: y2 + l2 * 0.5 };
}

// ---------------------------------------------------------------- banners and the countdown
/** A big band across the screen with a few words. b: { text, sub, color, age, dur }. */
export function drawBanner(c, W, H, b) {
  const inP = clamp01(b.age / 0.25);
  const outP = clamp01((b.dur - b.age) / 0.25);
  const e = ease.outBack(inP);
  const cy = H * 0.37;
  const size = fit(c, b.text, W * 0.9, Math.min(H * 0.15, 110));
  const bh = size * 1.5 + (b.sub ? size * 0.4 : 0);
  c.save();
  c.globalAlpha = Math.min(1, outP * 1.3);
  c.translate(0, cy);
  c.scale(1, Math.max(0.01, e));
  c.fillStyle = b.color || '#ff8a1f';
  c.fillRect(0, -bh / 2, W, bh);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(0, -bh / 2, W, bh * 0.2);
  c.fillStyle = OUT;
  c.fillRect(0, -bh / 2 - 4, W, 5);
  c.fillRect(0, bh / 2 - 1, W, 5);
  c.restore();
  c.save();
  c.globalAlpha = Math.min(1, outP * 1.3);
  const k = 0.55 + 0.45 * e;
  label(c, b.text, W / 2, cy - (b.sub ? size * 0.16 : 0), size * k);
  if (b.sub) label(c, b.sub, W / 2, cy + size * 0.6, Math.max(20, size * 0.4) * k, { fill: '#fff6c9' });
  c.restore();
}

/** The big 3, 2, 1, GO!. `age` is the seconds since this number appeared. */
export function drawCountdown(c, W, H, text, age) {
  const k = ease.outBack(clamp01(age / 0.3));
  const size = Math.min(H * 0.55, W * 0.4) * (text === 'GO!' ? 0.7 : 1);
  c.save();
  c.globalAlpha = text === 'GO!' ? clamp01(1.2 - age) : 1;
  label(c, text, W / 2, H * 0.42, size * (0.5 + 0.5 * k), { fill: text === 'GO!' ? '#38ff88' : '#ffe27a', lw: size * 0.12 });
  c.restore();
}

/** What a seeker sees while counting: a big number, "Counting!" and hands over the eyes that part now and then. */
export function drawCounting(c, W, H, t, secs, roleColor) {
  const cx = W / 2;
  const r = Math.min(H * 0.13, W * 0.12);
  const fy = H * 0.26;
  disc(c, cx, fy, r, '#ffd9b3', 6);
  const gap = (0.5 + 0.5 * Math.sin(t * 1.6)) * r * 0.42;
  for (const s of [-1, 1]) {
    ellipse(c, cx + s * r * 0.42, fy - r * 0.08, r * 0.2, r * 0.26, '#fff', 3);
    disc(c, cx + s * r * 0.42 + Math.sin(t) * r * 0.05, fy - r * 0.05, r * 0.1, OUT, 0);
  }
  // a smile
  c.strokeStyle = OUT;
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(cx, fy + r * 0.28, r * 0.28, 0.2, Math.PI - 0.2);
  c.stroke();
  c.lineCap = 'butt';
  // two hands over the eyes that slide apart now and then, fingers and all
  for (const s of [-1, 1]) {
    const hx = cx + s * (r * 0.42 + gap) - r * 0.36;
    const hy = fy - r * 0.46;
    rbox(c, hx, hy, r * 0.72, r * 0.78, r * 0.26, '#f5b88a', 5);
    c.strokeStyle = 'rgba(120,60,20,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    for (let k = 1; k <= 2; k++) {
      c.moveTo(hx + (k * r * 0.72) / 3, hy + r * 0.08);
      c.lineTo(hx + (k * r * 0.72) / 3, hy + r * 0.34);
    }
    c.stroke();
  }
  label(c, String(Math.max(0, secs)), cx, H * 0.58, Math.min(H * 0.36, W * 0.3), { fill: roleColor || '#ffe27a', lw: H * 0.04 });
  label(c, 'Counting!', cx, H * 0.82, Math.min(H * 0.1, 44));
}

// ---------------------------------------------------------------- HUD and minimap
/**
 * The HUD during a round. h: { round: 'Round 2/3', secs: 14, tag: 'HIDE' | 'SEEK', seeker: bool, dots: ['on' | 'off', ...] with colors,
 * score, place }. Top-left stays clear (the platform's buttons).
 */
export function drawHud(c, W, H, h, t) {
  const cx = W / 2;
  // row one: the clock, big, with who you are (glasses or eyes) and what to do
  if (h.secs !== null) {
    const urgent = h.secs <= 5 && !h.seeker;
    const sz = 42 + (urgent ? Math.sin(t * 12) * 3 : 0);
    label(c, String(Math.max(0, h.secs)), cx, 27, sz, { fill: urgent ? '#ff7a7a' : '#fff' });
    if (h.seeker) glassesIcon(c, cx - 60, 26, 14);
    else eyesIcon(c, cx - 60, 26, 14);
    label(c, h.tag, cx + 56, 28, 19, { fill: h.seeker ? '#ffb347' : '#8cf0a8' });
  }
  // row two: the round, and the hiders still out there
  const n = h.dots.length;
  const gap = 22;
  c.font = `16px ${FONT}`;
  const rw = c.measureText(h.round).width;
  const dw = Math.max(0, (n - 1) * gap) + 18;
  const total = rw + 16 + dw;
  const y2 = h.secs !== null ? 61 : 24;
  label(c, h.round, cx - total / 2 + rw / 2, y2, 16, { fill: '#fff6c9' });
  let x = cx - total / 2 + rw + 16 + 9;
  for (const d of h.dots) {
    if (d.found) {
      disc(c, x, y2, 8, '#6a6478', 3);
      c.strokeStyle = '#fff';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x - 3.5, y2 - 3.5);
      c.lineTo(x + 3.5, y2 + 3.5);
      c.moveTo(x + 3.5, y2 - 3.5);
      c.lineTo(x - 3.5, y2 + 3.5);
      c.stroke();
    } else disc(c, x, y2, 8, d.color, 3);
    x += gap;
  }
  // your score (top right)
  star(c, W - 104, 26, 14, '#ffd23f');
  label(c, String(h.score), W - 18, 26, 32, { align: 'right' });
  if (h.place) label(c, h.place, W - 18, 54, 20, { align: 'right', fill: '#fff6c9' });
}

/** The little map: rooms, you (a blinking dot) and the seekers. m: { house, me: {x, y, color}, seekers: [{x, y, found}], x, y, w }. */
export function drawMinimap(c, m, t) {
  const { house } = m;
  const w = m.w;
  const k = w / house.w;
  const h = house.h * k;
  const x = m.x;
  const y = m.y;
  rbox(c, x - 5, y - 5, w + 10, h + 10, 10, 'rgba(18,10,32,0.82)', 3);
  const colors = { wood: '#c98b52', wood2: '#d8a366', tile: '#bfe6ea', tile2: '#c4d0ee', check: '#f0dcb0', carpet: '#f3b0c8', grass: '#7cc65c' };
  for (const r of house.rooms) {
    c.fillStyle = colors[r.floor] || '#ccc';
    c.fillRect(x + r.x * k, y + r.y * k, r.w * k, r.h * k);
  }
  c.fillStyle = '#4a3358';
  for (const wl of house.walls) c.fillRect(x + wl[0] * k, y + wl[1] * k, Math.max(1.5, wl[2] * k), Math.max(1.5, wl[3] * k));
  for (const s of m.seekers) disc(c, x + s.x * k, y + s.y * k, 3.6, s.found ? '#ffb347' : '#ff8a1f', 1.5);
  if (m.me) {
    const r = 4.4 + Math.sin(t * 6) * 0.8;
    disc(c, x + m.me.x * k, y + m.me.y * k, r, m.me.color || '#fff', 2, '#fff');
  }
  return h;
}

// ---------------------------------------------------------------- lobby
/** The settings as big values at the top. The host's chips can be tapped. chips: [{ id, label, value }]. */
export function drawChips(c, W, H, chips, host, t, buttons, onTap) {
  const n = chips.length;
  const cw = Math.min(176, (W - 60 - 14 * (n - 1)) / n);
  const ch = 56;
  const total = n * cw + (n - 1) * 14;
  let x = (W - total) / 2;
  const y = 60;
  for (const chip of chips) {
    rbox(c, x + 3, y + 5, cw, ch, 16, 'rgba(10,4,20,0.4)', 0);
    rbox(c, x, y, cw, ch, 16, host ? '#ffd23f' : '#eadff7', 4);
    c.font = `16px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#5a3d1a';
    c.fillText(chip.label.toUpperCase(), x + cw / 2, y + 15);
    const size = fit(c, chip.value, cw - 24, 27);
    label(c, chip.value, x + cw / 2, y + 38, size, { lw: size * 0.2 });
    if (host) {
      // a little arrow shows it can be tapped
      c.fillStyle = OUT;
      c.beginPath();
      const ax = x + cw - 14 + Math.sin(t * 5) * 2;
      c.moveTo(ax - 4, y + 10);
      c.lineTo(ax + 4, y + 16);
      c.lineTo(ax - 4, y + 22);
      c.closePath();
      c.fill();
      buttons.add(`chip-${chip.id}`, x, y, cw, ch, () => onTap(chip.id));
    }
    x += cw + 14;
  }
}

/** A short line near the bottom (three to five words). */
export function drawHint(c, W, H, text, t) {
  const size = fit(c, text, W * 0.86, 30);
  c.globalAlpha = 0.85 + Math.sin(t * 3) * 0.15;
  label(c, text, W / 2, H - 118, size);
  c.globalAlpha = 1;
}

/** A small "Watching" at the bottom middle for someone who came after the match began. */
export function drawWatching(c, W, H, t) {
  const y = H - 112 + Math.sin(t * 3) * 2;
  eyesIcon(c, W / 2 - 62, y, 15);
  label(c, 'Watching', W / 2 + 10, y, 26);
}

// ---------------------------------------------------------------- scoreboard between rounds
/**
 * rows: [{ ch, name, score (after the round), gain, you }] in roster order. p: seconds into the scoreboard. total: its length.
 */
export function drawScoreboard(c, W, H, sb, t) {
  const rows = sb.rows;
  const n = rows.length;
  const prog = clamp01((sb.age - 0.5) / 2.2); // the points fly in, then the order settles
  const e = ease.inOutQuad(prog);
  const old = rows.map((r) => ({ r, old: r.score - r.gain }));
  const byOld = old.slice().sort((a, b) => b.old - a.old || rows.indexOf(a.r) - rows.indexOf(b.r));
  const byNew = rows.slice().sort((a, b) => b.score - a.score || rows.indexOf(a) - rows.indexOf(b));
  const two = n > 6;
  const per = two ? Math.ceil(n / 2) : n;
  const colW = two ? Math.min(W * 0.46, 380) : Math.min(W * 0.84, 520);
  const top = 70;
  const rowH = Math.max(34, Math.min(58, (H - top - 24) / per));
  const left = two ? W / 2 - colW - 8 : (W - colW) / 2;
  const maxScore = Math.max(1, ...rows.map((r) => r.score));
  label(c, sb.title, W / 2, 34, 36);
  const rowPos = (i) => {
    const col = two && i >= per ? 1 : 0;
    const idx = col ? i - per : i;
    return { x: left + col * (colW + 16), y: top + idx * rowH };
  };
  const drawRow = (r) => {
    // slide from the place before the round to the place after it
    const p0 = rowPos(byOld.findIndex((o) => o.r === r));
    const p1 = rowPos(byNew.indexOf(r));
    const px = lerp(p0.x, p1.x, e);
    const py = lerp(p0.y, p1.y, e);
    const shown = Math.round(r.score - r.gain + r.gain * e);
    const bar = Math.max(0.06, shown / maxScore);
    rbox(c, px, py + 3, colW, rowH - 6, 12, 'rgba(18,10,32,0.55)', 0);
    rbox(c, px, py + 3, Math.max(rowH, colW * bar), rowH - 6, 12, r.ch.color, r.you ? 4 : 3);
    drawHead(c, r.ch, px + rowH * 0.5, py + rowH / 2, rowH * 0.36, { lw: 3, t });
    const size = Math.min(26, rowH * 0.5);
    label(c, r.name, px + rowH + 6, py + rowH / 2, size, { align: 'left', fill: r.you ? '#fff7b0' : '#fff' });
    label(c, String(shown), px + colW - 12, py + rowH / 2, Math.min(34, rowH * 0.7), { align: 'right' });
    if (r.gain > 0 && prog < 1) {
      const fly = ease.outCubic(clamp01(sb.age / 1.2));
      c.globalAlpha = 1 - prog;
      label(c, `+${r.gain}`, px + colW - 70 - (1 - fly) * 40, py + rowH / 2 - fly * 10, Math.min(26, rowH * 0.5), { align: 'right', fill: '#8cf0a8' });
      c.globalAlpha = 1;
    }
  };
  rows.forEach(drawRow);
}

// ---------------------------------------------------------------- results
/**
 * pod: { order: [{ ch, name, score, place }] (best first), awards: [{ k, ch, name, v }], you: { place, text } | null, age }.
 * Three blocks with the winners' heads on top, laid out from the screen's height so it fits a phone held sideways.
 * `compact`: the small version shown over the lobby for a few seconds after the match.
 */
export function drawPodium(c, W, H, pod, t, compact = false) {
  const top3 = pod.order.slice(0, 3);
  const k = Math.min(1.6, H / 390);
  const kk = Math.min(1.3, k);
  const baseY = H * (compact ? 0.3 : 0.62);
  const unit = H * (compact ? 0.05 : 0.075);
  const bw = Math.min(compact ? 96 : 150 * kk, W * 0.22);
  const hrMax = H * (compact ? 0.045 : 0.06);
  const heights = [3, 2, 1.4].map((n) => n * unit);
  const slots = [W / 2, W / 2 - bw * 1.08, W / 2 + bw * 1.08];
  for (let i = 0; i < 3; i++) {
    const row = top3[i];
    if (!row) continue;
    const grow = ease.outBack(clamp01((pod.age - i * 0.15 - 0.1) / 0.5));
    const h = Math.max(0.01, heights[i] * grow);
    const x = slots[i];
    const colors = ['#ffd23f', '#cfd8e3', '#e39a5a'];
    rbox(c, x - bw / 2 + 4, baseY - h + 6, bw, h, 10, 'rgba(10,4,20,0.4)', 0);
    rbox(c, x - bw / 2, baseY - h, bw, h, 10, colors[i], 4);
    label(c, String(row.place), x, baseY - h / 2, Math.min(h * 0.7, bw * 0.5), { fill: '#fff' });
    const hr = Math.min(bw * 0.36, hrMax) * (0.6 + 0.4 * grow);
    const hy = baseY - h - hr - 6 - Math.abs(Math.sin(t * 5 + i)) * (i === 0 ? 8 : 3);
    drawHead(c, row.ch, x, hy, hr, { lw: 4, t });
    if (compact) {
      label(c, row.name, x, baseY + 15, fit(c, row.name, bw * 1.3, 17));
    } else {
      const nameSize = 22 * kk;
      label(c, row.name, x, hy - hr - nameSize * 0.7, fit(c, row.name, bw * 1.4, nameSize));
      label(c, String(row.score), x, baseY + 20 * kk, 24 * kk, { fill: '#fff6c9' });
      if (i === 0 && pod.age > 0.6) star(c, x, hy - hr - nameSize * 0.7 - 30, 16 * kk, '#ffd23f');
    }
  }
  const you = pod.you && pod.you.place > 3 ? pod.you : null;
  if (you) label(c, `You: ${you.text}`, W / 2, baseY + (compact ? 38 : 54 * kk), compact ? 21 : 28 * kk, { fill: '#fff7b0' });
  if (!compact && pod.awards.length) {
    const n = pod.awards.length;
    const aw = Math.min(250, (W - 40) / n - 10);
    const ay = H - 56;
    pod.awards.forEach((a, i) => {
      const ax = W / 2 + (i - (n - 1) / 2) * (aw + 14);
      const appear = ease.outBack(clamp01((pod.age - 1.2 - i * 0.3) / 0.4));
      c.save();
      c.translate(ax, ay);
      c.scale(Math.max(0.01, appear), Math.max(0.01, appear));
      rbox(c, -aw / 2, -26, aw, 52, 14, '#2c1f45', 3);
      if (a.k === 'ghost') ghostIcon(c, -aw / 2 + 28, 2, 17);
      else magnifier(c, -aw / 2 + 24, -2, 15);
      drawHead(c, a.ch, aw / 2 - 28, 0, 17, { lw: 3, t });
      label(c, a.k === 'ghost' ? 'Ghost' : 'Bloodhound', -aw / 2 + 52, -9, 21, { align: 'left', fill: '#ffe27a' });
      label(c, a.name, -aw / 2 + 52, 13, fit(c, a.name, aw - 110, 17), { align: 'left' });
      c.restore();
    });
  }
}

export { TAU, star };
