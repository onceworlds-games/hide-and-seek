// Store art, drawn by the game itself: open the game with ?poster=<name> and it draws one still picture with the real
// renderer (a fixed seed, characters caught mid-action) and sets document.body.dataset.ready = '1'. No room, no platform.
//   cover (1280x720)  action (1280x720)  win (1280x720)  icon (512x512)  badge-<id> (256x256)
import { COLORS, CONES, mulberry32 } from './rules.js';
import { getHouse } from './maps.js';
import { visibility } from './geometry.js';
import { Fx } from './fx.js';
import { makeView, renderScene, screenTransform, label, hashOf, rbox, disc, ellipse, rrPath, OUT, FONT } from './draw.js';
import { drawLogo } from './ui.js';

const BADGES = {
  'first-win': { bg: '#3d8bff', draw: crown },
  'master-hider': { bg: '#a45cff', draw: sleepMask },
  'eagle-eye': { bg: '#14c7c0', draw: magnifier },
  sleepover: { bg: '#ff5d8f', draw: pillow },
};

export async function runPoster(name) {
  const canvas = document.getElementById('c');
  const badge = name.startsWith('badge-') ? name.slice(6) : null;
  const [W, H] = name === 'icon' ? [512, 512] : badge ? [256, 256] : [1280, 720];
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const c = canvas.getContext('2d');
  try {
    await Promise.race([document.fonts.load(`40px ${FONT.split(',')[0]}`), new Promise((r) => setTimeout(r, 2500))]);
    await document.fonts.ready;
  } catch {
    // the fallback font is fine
  }
  if (name === 'cover') cover(c, W, H);
  else if (name === 'action') action(c, W, H);
  else if (name === 'win') win(c, W, H);
  else if (name === 'icon') icon(c, W, H);
  else if (badge && BADGES[badge]) badgeArt(c, W, H, BADGES[badge]);
  else {
    c.fillStyle = '#1c2d40';
    c.fillRect(0, 0, W, H);
  }
  document.body.dataset.ready = '1';
}

// ---------------------------------------------------------------- helpers
const char = (i, x, y, o = {}) => ({
  id: `p${i}`,
  name: '',
  noName: true,
  x,
  y,
  vx: 0,
  vy: 0,
  a: 0,
  color: COLORS[i % COLORS.length],
  role: 'hider',
  bot: true,
  face: hashOf(`p${i}`) + i * 7,
  img: null,
  you: false,
  ready: false,
  alpha: 1,
  sq: 0,
  pop: 1,
  walk: 0,
  phase: i * 1.3,
  emote: '',
  draw: true,
  peek: -1,
  arrow: false,
  bubble: '',
  cheer: false,
  ...o,
});

const spotStates = (house) => house.spots.map(() => ({ occ: null, open: 0, wob: 0, hot: false, mine: false, label: '', fill: '' }));
const spotOf = (house, kind, room) => house.spots.find((s) => s.kind === kind && s.room === room);

function view(W, H, cx, cy, scale) {
  const v = makeView(W, H, 1, { x: cx, y: cy }, null);
  v.scale = scale;
  v.x0 = cx - W / 2 / scale - 1;
  v.x1 = cx + W / 2 / scale + 1;
  v.y0 = cy - H / 2 / scale - 1;
  v.y1 = cy + H / 2 / scale + 1;
  return v;
}

function vignette(c, W, H, strength = 0.5) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, 'rgba(10,4,24,0)');
  g.addColorStop(1, `rgba(10,4,24,${strength})`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

function beamOf(ch, cone, house) {
  const poly = [];
  visibility(ch.x, ch.y, ch.a, cone, house.walls, poly);
  return { x: ch.x, y: ch.y, a: ch.a, cone, poly, alpha: 1 };
}

function newFx(seed) {
  const fx = new Fx();
  fx.rand = mulberry32(seed);
  fx.quality = 1;
  return fx;
}

// ---------------------------------------------------------------- cover: the house at dusk, a flashlight sweeping the bedroom
function cover(c, W, H) {
  const house = getHouse('cozy');
  const spots = spotStates(house);
  const bed = spotOf(house, 'bed', 'bedroom');
  const wardrobe = spotOf(house, 'wardrobe', 'bedroom');
  const plant = spotOf(house, 'plant', 'bedroom');
  const tub = spotOf(house, 'bathtub', 'bath');
  spots[wardrobe.i].open = 0.9;
  spots[bed.i].wob = 0.4;
  const seeker = char(0, 5.6, 6.0, { role: 'seeker', a: -2.3, emote: 'laugh', bot: true });
  const peeker = char(1, wardrobe.ax, wardrobe.ay - 0.55, { emote: 'surprised', a: Math.PI / 2, pop: 1.1 });
  const chars = [
    seeker,
    peeker,
    char(2, 12.6, 5.0, { vx: 4.6, a: 0, walk: 1.3, emote: 'surprised' }),
    char(3, 14.3, 6.7, { vx: -4.2, vy: 1.4, a: 2.8, walk: 2.6 }),
    char(4, 0, 0, { peek: bed.i }),
    char(5, 0, 0, { peek: plant.i }),
    char(6, 0, 0, { peek: tub.i }),
  ];
  const fx = newFx(11);
  fx.dust(12.0, 5.0);
  fx.dust(11.6, 5.0);
  fx.dust(14.8, 6.7);
  const cone = CONES.seeker;
  const v = view(W, H, 10.5, 2.4, 56);
  renderScene(c, v, { house, t: 3.1, spots, chars, beams: [beamOf(seeker, cone, house)], dim: null, blind: false, fx });
  screenTransform(c, v);
  vignette(c, W, H, 0.55);
  // the name, chunky, in the top third (the only text)
  drawLogo(c, W, 4, 142, 0.6);
}

// ---------------------------------------------------------------- action: a seeker opens a box, a hider inside, both surprised
function action(c, W, H) {
  const house = getHouse('cozy');
  const spots = spotStates(house);
  const box = spotOf(house, 'box', 'kitchen');
  spots[box.i].open = 1;
  const seeker = char(0, box.ax - 0.55, box.ay + 0.1, { role: 'seeker', a: 0, emote: 'surprised', sq: 0.08 });
  const hider = char(3, box.cx - 0.1, box.cy - 0.55, { a: Math.PI, emote: 'surprised', pop: 1.25 });
  const fx = newFx(5);
  fx.sparks(box.cx, box.cy - 0.9, '#ffe066', 22, 5);
  fx.sparks(box.cx, box.cy - 0.9, '#ffffff', 10, 3);
  fx.ring(box.cx, box.cy - 0.6, '#fff', 1.6, 0.9);
  for (let i = 0; i < 6; i++) fx.update(0.04);
  const v = view(W, H, box.cx - 1.9, box.cy - 0.45, 140);
  renderScene(c, v, { house, t: 4.2, spots, chars: [seeker, hider], beams: [beamOf(seeker, CONES.seeker, house)], dim: null, blind: false, fx });
  screenTransform(c, v);
  vignette(c, W, H, 0.5);
}

// ---------------------------------------------------------------- win: the living room, a podium, confetti, everyone cheering
function win(c, W, H) {
  const house = getHouse('cozy');
  const spots = spotStates(house);
  const blocks = [
    { x: 14.9, top: 12.4, n: '1', col: '#ffd23f' },
    { x: 12.6, top: 13.2, n: '2', col: '#cfd8e3' },
    { x: 17.2, top: 13.7, n: '3', col: '#e39a5a' },
  ];
  const chars = [
    char(0, 16, 12.0, { cheer: true, emote: 'cheer', a: Math.PI / 2, pop: 1.1, phase: 0.2 }),
    char(1, 13.7, 12.8, { cheer: true, emote: 'cheer', a: Math.PI / 2, phase: 1.1 }),
    char(2, 18.3, 13.3, { cheer: true, emote: 'cheer', a: Math.PI / 2, phase: 2.0 }),
    char(3, 10.6, 14.4, { cheer: true, emote: 'cheer', a: 0, phase: 2.9 }),
    char(4, 21.2, 14.6, { cheer: true, emote: 'cheer', a: Math.PI, phase: 3.7 }),
    char(5, 9.8, 11.4, { cheer: true, emote: 'cheer', a: 0.3, phase: 4.4 }),
    char(7, 21.6, 11.8, { role: 'seeker', emote: 'laugh', a: Math.PI * 0.85 }),
  ];
  const fx = newFx(21);
  for (const [x, y] of [[12, 10.5], [16, 9.2], [20, 10.5], [9.5, 12], [22.5, 12.5]]) fx.confetti(x, y, 36, 9, 8);
  for (let i = 0; i < 14; i++) fx.update(0.045);
  const under = (cc, v) => {
    const l = 3.5 / v.scale;
    for (const b of blocks) {
      rbox(cc, b.x + 0.14, b.top + 0.2, 2.2, 14.8 - b.top, 0.2, 'rgba(15,6,25,0.35)', 0);
      rbox(cc, b.x, b.top, 2.2, 14.8 - b.top, 0.2, b.col, l);
      rbox(cc, b.x + 0.12, b.top + 0.1, 1.96, 0.22, 0.1, 'rgba(255,255,255,0.45)', 0);
    }
  };
  const v = view(W, H, 16, 12.4, 80);
  renderScene(c, v, { house, t: 2.4, spots, chars, beams: [], dim: null, blind: false, fx, under });
  screenTransform(c, v);
  // the place numbers on the podium (the only text)
  for (const b of blocks) {
    const sx = (b.x + 1.1 - v.cx) * v.scale + W / 2;
    const sy = (b.top + (14.8 - b.top) / 2 + 0.1 - v.cy) * v.scale + H / 2;
    label(c, b.n, sx, sy, 66, { lw: 11 });
  }
  vignette(c, W, H, 0.45);
}

// ---------------------------------------------------------------- icon: a pair of eyes in a slightly open wardrobe
function icon(c, W, H) {
  const g = c.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, '#ffb36b');
  g.addColorStop(0.55, '#c8587a');
  g.addColorStop(1, '#4a2a6a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // the floor
  c.fillStyle = 'rgba(40,16,50,0.35)';
  c.fillRect(0, H * 0.82, W, H * 0.18);
  const x = W * 0.2;
  const y = H * 0.1;
  const w = W * 0.6;
  const h = H * 0.74;
  // shadow
  ellipse(c, W / 2, y + h + 8, w * 0.62, 20, 'rgba(30,10,40,0.5)', 0);
  // the body
  rbox(c, x, y, w, h, 26, '#b9763f', 10);
  rbox(c, x + 16, y + 16, w - 32, h - 32, 18, '#d19558', 5);
  // the dark gap and the eyes inside
  const dw = 88;
  const dx = x + w / 2 - 10;
  c.fillStyle = '#14081e';
  c.fillRect(dx, y + 32, dw, h - 64);
  for (const s of [0, 1]) {
    const ex = dx + dw / 2 - 20 + s * 40;
    ellipse(c, ex, y + h * 0.4, 16, 24, '#fff', 4);
    disc(c, ex + 3, y + h * 0.4 + 4, 8.5, OUT, 0);
    disc(c, ex - 1, y + h * 0.4 - 3, 3, '#fff', 0);
  }
  // the doors: the left one shut, the right one swung open
  rbox(c, x + 22, y + 34, dx - x - 22, h - 68, 10, '#a86a3a', 6);
  disc(c, dx - 16, y + h / 2, 7, '#ffe27a', 3);
  c.save();
  c.beginPath();
  c.moveTo(dx + dw, y + 34);
  c.lineTo(x + w - 14, y + 18);
  c.lineTo(x + w - 14, y + h - 18);
  c.lineTo(dx + dw, y + h - 34);
  c.closePath();
  c.fillStyle = '#8c5a2e';
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = OUT;
  c.lineJoin = 'round';
  c.stroke();
  c.restore();
  disc(c, x + w - 34, y + h / 2, 7, '#ffe27a', 3);
  // feet
  rbox(c, x + 20, y + h - 4, 44, 22, 8, '#8c5a2e', 5);
  rbox(c, x + w - 64, y + h - 4, 44, 22, 8, '#8c5a2e', 5);
}

// ---------------------------------------------------------------- badges: a bold symbol on a coloured circle
function badgeArt(c, W, H, b) {
  c.clearRect(0, 0, W, H);
  const r = W / 2 - 8;
  disc(c, W / 2, H / 2, r, b.bg, 10);
  disc(c, W / 2, H / 2, r - 16, null, 4, 'rgba(255,255,255,0.45)');
  c.save();
  c.translate(W / 2, H / 2);
  b.draw(c, r);
  c.restore();
}

function crown(c, r) {
  const w = r * 1.15;
  const h = r * 0.8;
  c.beginPath();
  c.moveTo(-w / 2, h / 2);
  c.lineTo(-w / 2, -h * 0.15);
  c.lineTo(-w / 4, h * 0.15);
  c.lineTo(0, -h / 2);
  c.lineTo(w / 4, h * 0.15);
  c.lineTo(w / 2, -h * 0.15);
  c.lineTo(w / 2, h / 2);
  c.closePath();
  c.fillStyle = '#ffd23f';
  c.fill();
  c.lineWidth = 9;
  c.strokeStyle = OUT;
  c.lineJoin = 'round';
  c.stroke();
  rbox(c, -w / 2, h * 0.28, w, h * 0.22, 4, '#ff8a1f', 6);
  disc(c, 0, -h / 2 - 2, 9, '#ff5d8f', 5);
  disc(c, -w / 2, -h * 0.15, 8, '#ff5d8f', 5);
  disc(c, w / 2, -h * 0.15, 8, '#ff5d8f', 5);
}

function sleepMask(c, r) {
  const w = r * 1.3;
  const h = r * 0.62;
  c.strokeStyle = OUT;
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(-w / 2, 0);
  c.quadraticCurveTo(-w * 0.62, -h * 0.7, -w * 0.4, -h * 0.85);
  c.moveTo(w / 2, 0);
  c.quadraticCurveTo(w * 0.62, -h * 0.7, w * 0.4, -h * 0.85);
  c.stroke();
  rrPath(c, -w / 2, -h / 2, w, h, h * 0.45);
  c.fillStyle = '#ffe27a';
  c.fill();
  c.lineWidth = 9;
  c.stroke();
  c.lineWidth = 7;
  c.lineCap = 'round';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.arc(s * w * 0.22, -h * 0.05, h * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  }
  c.lineCap = 'butt';
}

function magnifier(c, r) {
  c.strokeStyle = OUT;
  c.lineWidth = r * 0.34;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(r * 0.2, r * 0.2);
  c.lineTo(r * 0.62, r * 0.62);
  c.stroke();
  c.strokeStyle = '#a8693a';
  c.lineWidth = r * 0.2;
  c.beginPath();
  c.moveTo(r * 0.2, r * 0.2);
  c.lineTo(r * 0.62, r * 0.62);
  c.stroke();
  c.lineCap = 'butt';
  disc(c, -r * 0.1, -r * 0.1, r * 0.46, 'rgba(210,240,255,0.95)', 12);
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 7;
  c.beginPath();
  c.arc(-r * 0.1, -r * 0.1, r * 0.3, 3.6, 4.5);
  c.stroke();
}

function pillow(c, r) {
  const w = r * 1.3;
  const h = r * 0.95;
  rbox(c, -w / 2, -h / 2, w, h, h * 0.3, '#fff', 9);
  c.strokeStyle = 'rgba(120,120,160,0.55)';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(-w / 2 + 12, -h * 0.12);
  c.quadraticCurveTo(0, h * 0.1, w / 2 - 12, -h * 0.12);
  c.stroke();
  disc(c, -w / 2 + 6, -h / 2 + 6, 7, '#ffd23f', 4);
  disc(c, w / 2 - 6, -h / 2 + 6, 7, '#ffd23f', 4);
  disc(c, -w / 2 + 6, h / 2 - 6, 7, '#ffd23f', 4);
  disc(c, w / 2 - 6, h / 2 - 6, 7, '#ffd23f', 4);
}
