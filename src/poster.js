// Poster mode (?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>): deterministic, finished
// scenes from the game's own renderer for the store art. No SDK, no network. Sets
// window.__posterReady = true when the frame is on screen.
import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createRun } from './app/run.js';
import { buildCourse } from './sim/courses.js';
import { stepSim, setHumanInput } from './sim/sim.js';
import { createWorkshopScene } from './app/workshop.js';
import { defaultSave } from './sim/save.js';
import { LEG_COLORS, LEG_MARKS } from './sim/constants.js';

const INK = '#2a1e1a';
const CREAM = '#fff3dc';
const BRASS = '#d9a441';
const SAND = '#e8c98a';
const ORANGE = '#f0702a';
const TEAL = '#1f8a8a';

export async function renderPoster(kind) {
  const gl = document.getElementById('gl');
  const hud = document.getElementById('hud');
  document.getElementById('ui').remove();
  if (kind === 'icon' || kind.startsWith('badge-')) {
    gl.remove();
    await drawFlat(hud, kind);
    window.__posterReady = true;
    return;
  }
  hud.remove();
  const gfx = createScene(gl);
  gfx.applyQuality('high');
  gfx.resize();
  const scene = SCENES[kind] ?? SCENES.thumb1;
  await scene(gfx);
  window.__posterReady = true;
}

/** Run a course with bots for `seconds`, deterministic, then hand the run over for posing. */
function playedRun(gfx, spec, seconds, opts = {}) {
  const course = buildCourse(spec);
  const run = createRun({ gfx, course, owners: ['bot', 'bot', 'bot', 'bot'], botSkill: 2, seed: 'poster', look: opts.look ?? {}, myLeg: 0, quality: 'high', autonomous: true });
  const sim = run.sim;
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) stepSim(sim);
  sim.events.length = 0;
  return { run, sim, course };
}

function frame(gfx, run, w, dtSteps = 2) {
  for (let i = 0; i < dtSteps; i++) run.render(1 / 30);
  gfx.render();
}

const SCENES = {
  // The cover: the four-colour walker mid-stride over stepping stones, cargo wobbling, dust up.
  async thumb1(gfx) {
    const { run, sim } = playedRun(gfx, { kind: 'expedition', biome: 0, index: 2 }, 18);
    const w = sim.w;
    // one leg in the air, cargo leaning: a stride caught mid-step
    const l = w.legs[1];
    l.st = 1;
    l.sw = 0.14;
    l.lx = l.fx;
    l.ly = l.fy;
    l.lz = l.fz;
    l.tx = l.fx + 1.6;
    l.tz = l.fz + 0.2;
    l.ty = l.fy;
    l.fx += 0.8;
    l.fy += 0.6;
    l.valid = true;
    w.cargo.aF = -0.18;
    w.cargo.aR = 0.1;
    w.vx = 1.6;
    run.fx.spawn('dust', w.legs[0].fx, w.legs[0].fy + 0.1, w.legs[0].fz, 24, { radius: 0.6, spread: 1.6 });
    run.fx.spawn('mud', w.legs[2].fx, w.legs[2].fy + 0.1, w.legs[2].fz, 14, { radius: 0.5 });
    run.fx.update(0.25, gfx.camera);
    l.fy += 0.35;
    run.walker.update(w, 0.016, 3.1);
    run.hud3d.update(w, 3.1, 1);
    run.render(0.016);
    gfx.camera.position.set(w.x - 6.2, w.y + 2.6, w.z + 6.4);
    gfx.camera.lookAt(w.x + 1.2, w.y - 0.4, w.z - 0.2);
    gfx.camera.fov = 42;
    gfx.camera.updateProjectionMatrix();
    gfx.render();
  },
  // A tumble in slow motion: the walker tipping, feet and dust in the air.
  async thumb2(gfx) {
    const { run, sim } = playedRun(gfx, { kind: 'expedition', biome: 1, index: 1 }, 12);
    const w = sim.w;
    w.tumbling = 2.55;
    w.tumbles = 1;
    w.tipDirX = 0.3;
    w.tipDirZ = 0.95;
    w.tip = 28;
    for (let i = 0; i < 4; i++) w.legs[i].st = 1;
    run.fx.spawn('dust', w.x, w.y - 1.2, w.z + 1, 60, { radius: 2.5, spread: 3 });
    run.fx.spawn('salt', w.x, w.y - 1, w.z, 30, { radius: 2, spread: 2 });
    run.fx.update(0.35, gfx.camera);
    run.walker.update(w, 0.016, 5);
    run.hud3d.update(w, 5, 2);
    run.render(0.016);
    gfx.camera.position.set(w.x + 7, w.y + 3.2, w.z + 9.5);
    gfx.camera.lookAt(w.x, w.y + 0.3, w.z + 0.5);
    gfx.camera.fov = 46;
    gfx.camera.updateProjectionMatrix();
    gfx.render();
  },
  // The foundry: vents firing, sparks, the walker crossing grates.
  async thumb3(gfx) {
    const { run, sim, course } = playedRun(gfx, { kind: 'expedition', biome: 2, index: 1 }, 22);
    const w = sim.w;
    // push the clock so vents near the walker fire
    const near = course.vents.filter((v) => Math.abs(v.x - w.x) < 14);
    if (near.length) {
      const v = near[0];
      w.t = Math.ceil((w.t + v.phase) / v.period) * v.period - v.phase - v.on * 0.5;
    }
    w.vx = 1.3;
    run.fx.spawn('spark', w.legs[0].fx, w.legs[0].fy + 0.2, w.legs[0].fz, 20, { radius: 0.4, spread: 3 });
    run.fx.spawn('spark', w.legs[3].fx, w.legs[3].fy + 0.2, w.legs[3].fz, 14, { radius: 0.4, spread: 3 });
    for (const v of near) run.fx.spawn('lava', v.x, 0.6, v.z, 18, { radius: v.r });
    run.fx.update(0.2, gfx.camera);
    run.walker.update(w, 0.016, 7);
    run.hud3d.update(w, 7, 0);
    run.render(0.016);
    gfx.camera.position.set(w.x - 8, w.y + 5, w.z - 9);
    gfx.camera.lookAt(w.x + 2, w.y - 0.5, w.z + 0.5);
    gfx.camera.fov = 46;
    gfx.camera.updateProjectionMatrix();
    gfx.render();
  },
  // The workshop: the walker on the bench, in teal paint with a crown.
  async thumb4(gfx) {
    const save = defaultSave();
    save.paint = 'teal';
    save.hat = 'crown';
    save.sticker = 'number';
    const ws = createWorkshopScene(gfx, save);
    ws.setLook(save);
    gfx.setBiome(0);
    for (let i = 0; i < 20; i++) ws.update(1 / 30, gfx, 'workshop');
    gfx.camera.position.set(7.5, 4.2, 6.5);
    gfx.camera.lookAt(0, 1.3, 0);
    gfx.camera.fov = 44;
    gfx.camera.updateProjectionMatrix();
    gfx.render();
  },
};

/** Flat art on a 2D canvas: the icon (four feet from above) and the badge icons. */
async function drawFlat(canvas, kind) {
  const size = kind === 'icon' ? 512 : 256;
  canvas.width = canvas.height = size;
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.style.position = 'fixed';
  canvas.style.left = canvas.style.top = '0';
  const g = canvas.getContext('2d');
  await document.fonts?.ready?.catch?.(() => {});
  if (kind === 'icon') return drawIcon(g, size);
  const id = kind.slice(6);
  drawBadge(g, size, id);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function foot(g, x, y, w, h, angle, color, mark) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.lineWidth = w * 0.12;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  roundRect(g, -w / 2 + w * 0.06, -h / 2 + h * 0.08, w, h, w * 0.3);
  g.fill();
  g.fillStyle = color;
  roundRect(g, -w / 2, -h / 2, w, h, w * 0.3);
  g.fill();
  g.stroke();
  drawMark(g, 0, 0, w * 0.26, mark, CREAM);
  g.restore();
}

function drawMark(g, x, y, r, mark, color) {
  g.beginPath();
  if (mark === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
  else if (mark === 'square') g.rect(x - r, y - r, r * 2, r * 2);
  else if (mark === 'triangle') {
    g.moveTo(x, y - r);
    g.lineTo(x + r, y + r * 0.85);
    g.lineTo(x - r, y + r * 0.85);
    g.closePath();
  } else {
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  }
  g.fillStyle = color;
  g.fill();
  g.lineWidth = r * 0.28;
  g.strokeStyle = INK;
  g.stroke();
}

function drawIcon(g, s) {
  // sand ground with a soft warm shade
  const grad = g.createRadialGradient(s * 0.5, s * 0.45, s * 0.1, s * 0.5, s * 0.5, s * 0.75);
  grad.addColorStop(0, '#f3dba6');
  grad.addColorStop(1, SAND);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  // the chassis seen from above: an orange rounded slab with brass deck
  g.save();
  g.translate(s / 2, s / 2);
  g.fillStyle = INK;
  roundRect(g, -s * 0.26 + 6, -s * 0.19 + 8, s * 0.52, s * 0.38, s * 0.06);
  g.fill();
  g.fillStyle = ORANGE;
  roundRect(g, -s * 0.26, -s * 0.19, s * 0.52, s * 0.38, s * 0.06);
  g.fill();
  g.lineWidth = s * 0.016;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = BRASS;
  roundRect(g, -s * 0.21, -s * 0.14, s * 0.42, s * 0.28, s * 0.04);
  g.fill();
  g.stroke();
  // cradle ring
  g.beginPath();
  g.arc(0, 0, s * 0.075, 0, Math.PI * 2);
  g.fillStyle = CREAM;
  g.fill();
  g.stroke();
  g.restore();
  // four feet at the corners, each in its colour with its mark
  const fw = s * 0.17;
  const fh = s * 0.22;
  foot(g, s * 0.2, s * 0.22, fw, fh, -0.25, LEG_COLORS[0], LEG_MARKS[0]);
  foot(g, s * 0.8, s * 0.22, fw, fh, 0.25, LEG_COLORS[1], LEG_MARKS[1]);
  foot(g, s * 0.2, s * 0.78, fw, fh, 0.25, LEG_COLORS[2], LEG_MARKS[2]);
  foot(g, s * 0.8, s * 0.78, fw, fh, -0.25, LEG_COLORS[3], LEG_MARKS[3]);
}

function plate(g, s, color = CREAM) {
  g.fillStyle = INK;
  roundRect(g, s * 0.08 + 6, s * 0.08 + 8, s * 0.84, s * 0.84, s * 0.16);
  g.fill();
  g.fillStyle = color;
  roundRect(g, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.16);
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = INK;
  g.stroke();
}

function label(g, s, text) {
  g.font = `${s * 0.095}px Bungee, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = s * 0.025;
  g.strokeStyle = INK;
  g.strokeText(text, s / 2, s * 0.82);
  g.fillStyle = CREAM;
  g.fillText(text, s / 2, s * 0.82);
}

function drawBadge(g, s, id) {
  g.clearRect(0, 0, s, s);
  const c = s / 2;
  switch (id) {
    case 'first-step':
      plate(g, s, SAND);
      foot(g, c, c - s * 0.04, s * 0.3, s * 0.4, -0.15, LEG_COLORS[0], LEG_MARKS[0]);
      label(g, s, 'FIRST');
      break;
    case 'in-step':
      plate(g, s, TEAL);
      // a metronome: a triangle with a needle
      g.fillStyle = BRASS;
      g.beginPath();
      g.moveTo(c, s * 0.2);
      g.lineTo(c + s * 0.22, s * 0.7);
      g.lineTo(c - s * 0.22, s * 0.7);
      g.closePath();
      g.fill();
      g.lineWidth = s * 0.025;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.moveTo(c, s * 0.66);
      g.lineTo(c + s * 0.14, s * 0.3);
      g.lineWidth = s * 0.04;
      g.stroke();
      label(g, s, 'GROOVE');
      break;
    case 'four-legs-good':
      plate(g, s, SAND);
      for (let i = 0; i < 4; i++) foot(g, s * (0.3 + (i % 2) * 0.4), s * (0.32 + Math.floor(i / 2) * 0.3), s * 0.17, s * 0.22, i % 2 ? 0.2 : -0.2, LEG_COLORS[i], LEG_MARKS[i]);
      label(g, s, 'FOUR');
      break;
    case 'nothing-spilled': {
      plate(g, s, '#bfe3ea');
      g.save();
      g.translate(c, c - s * 0.05);
      g.scale(1, 1.3);
      g.beginPath();
      g.arc(0, 0, s * 0.2, 0, Math.PI * 2);
      g.fillStyle = '#fff6e2';
      g.fill();
      g.lineWidth = s * 0.028;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
      label(g, s, 'INTACT');
      break;
    }
    case 'mud-lover':
      plate(g, s, '#6b4a2e');
      g.fillStyle = '#4a3220';
      for (const [x, y, r] of [[0.4, 0.42, 0.14], [0.6, 0.5, 0.12], [0.48, 0.6, 0.1], [0.33, 0.6, 0.07], [0.66, 0.34, 0.06]]) {
        g.beginPath();
        g.arc(s * x, s * y, s * r, 0, Math.PI * 2);
        g.fill();
      }
      foot(g, c, c - s * 0.04, s * 0.22, s * 0.3, 0.3, LEG_COLORS[2], LEG_MARKS[2]);
      label(g, s, 'MUD');
      break;
    case 'ice-skater':
      plate(g, s, '#cfeff5');
      foot(g, c, c - s * 0.08, s * 0.26, s * 0.34, 0.9, LEG_COLORS[1], LEG_MARKS[1]);
      g.strokeStyle = INK;
      g.lineWidth = s * 0.03;
      g.beginPath();
      g.moveTo(s * 0.22, s * 0.66);
      g.quadraticCurveTo(s * 0.5, s * 0.74, s * 0.78, s * 0.62);
      g.stroke();
      label(g, s, 'SKATER');
      break;
    case 'hot-foot':
      plate(g, s, '#ff5a1f');
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.moveTo(c, s * 0.2);
      g.quadraticCurveTo(c + s * 0.22, s * 0.45, c + s * 0.06, s * 0.66);
      g.quadraticCurveTo(c - s * 0.25, s * 0.5, c, s * 0.2);
      g.fill();
      g.lineWidth = s * 0.025;
      g.strokeStyle = INK;
      g.stroke();
      foot(g, c, s * 0.62, s * 0.2, s * 0.26, 0, LEG_COLORS[0], LEG_MARKS[0]);
      label(g, s, 'HOT');
      break;
    case 'tumble-king':
      plate(g, s, LEG_COLORS[3]);
      g.save();
      g.translate(c, c - s * 0.04);
      g.rotate(0.6);
      g.fillStyle = BRASS;
      g.beginPath();
      g.moveTo(-s * 0.2, s * 0.1);
      g.lineTo(-s * 0.22, -s * 0.14);
      g.lineTo(-s * 0.1, -s * 0.02);
      g.lineTo(0, -s * 0.18);
      g.lineTo(s * 0.1, -s * 0.02);
      g.lineTo(s * 0.22, -s * 0.14);
      g.lineTo(s * 0.2, s * 0.1);
      g.closePath();
      g.fill();
      g.lineWidth = s * 0.025;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
      label(g, s, 'TUMBLE');
      break;
    case 'solo-stride':
      plate(g, s, SAND);
      foot(g, c, c - s * 0.05, s * 0.28, s * 0.38, 0, ORANGE, 'circle');
      g.fillStyle = INK;
      g.font = `${s * 0.16}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.fillText('1', c, s * 0.26);
      label(g, s, 'SOLO');
      break;
    case 'great-stride':
      plate(g, s, '#9fc3cf');
      // an arch with flags
      g.fillStyle = BRASS;
      g.fillRect(s * 0.24, s * 0.28, s * 0.07, s * 0.4);
      g.fillRect(s * 0.69, s * 0.28, s * 0.07, s * 0.4);
      g.fillRect(s * 0.22, s * 0.24, s * 0.56, s * 0.08);
      g.lineWidth = s * 0.02;
      g.strokeStyle = INK;
      g.strokeRect(s * 0.24, s * 0.28, s * 0.07, s * 0.4);
      g.strokeRect(s * 0.69, s * 0.28, s * 0.07, s * 0.4);
      g.strokeRect(s * 0.22, s * 0.24, s * 0.56, s * 0.08);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? TEAL : ORANGE;
        g.beginPath();
        g.moveTo(s * (0.32 + k * 0.1), s * 0.33);
        g.lineTo(s * (0.4 + k * 0.1), s * 0.33);
        g.lineTo(s * (0.36 + k * 0.1), s * 0.44);
        g.closePath();
        g.fill();
        g.stroke();
      }
      label(g, s, 'STRIDE');
      break;
    case 'gold-rush':
      plate(g, s, BRASS);
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(c + (k - 1) * s * 0.17, c - s * 0.04 + (k === 1 ? -s * 0.06 : 0), s * 0.13, 0, Math.PI * 2);
        g.fillStyle = '#ffe28a';
        g.fill();
        g.lineWidth = s * 0.025;
        g.strokeStyle = INK;
        g.stroke();
        drawMark(g, c + (k - 1) * s * 0.17, c - s * 0.04 + (k === 1 ? -s * 0.06 : 0), s * 0.06, 'star', BRASS);
      }
      label(g, s, 'GOLD');
      break;
    default:
      plate(g, s, SAND);
      label(g, s, '?');
  }
}

export { THREE };
