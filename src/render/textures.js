// Procedural canvas textures: a 4x4 tile atlas with one pattern per surface, drawn once.
import * as THREE from 'three';
import { S } from '../sim/constants.js';

export function makeSurfaceTexture() {
  const size = 512;
  const tile = size / 4;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const at = (i, fn) => {
    const x = (i % 4) * tile;
    const y = Math.floor(i / 4) * tile;
    g.save();
    g.beginPath();
    g.rect(x, y, tile, tile);
    g.clip();
    g.translate(x, y);
    fn(tile);
    g.restore();
  };
  const rnd = seeded(7);
  const speckle = (n, alpha, size2) => {
    for (let k = 0; k < n; k++) {
      g.fillStyle = `rgba(0,0,0,${alpha})`;
      g.fillRect(rnd() * tile, rnd() * tile, size2, size2);
    }
  };
  // clay: soft brush speckle
  at(S.CLAY, (s) => {
    speckle(90, 0.05, 3);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k < 20; k++) g.fillRect(rnd() * s, rnd() * s, 8, 2);
  });
  // ice: sparkles and faint cracks
  at(S.ICE, (s) => {
    g.strokeStyle = 'rgba(40,90,110,0.18)';
    g.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.moveTo(rnd() * s, rnd() * s);
      g.lineTo(rnd() * s, rnd() * s);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 14; k++) g.fillRect(rnd() * s, rnd() * s, 3, 3);
  });
  // mud: ripples
  at(S.MUD, (s) => {
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 3;
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, 10 + rnd() * 30, 0, Math.PI * 2);
      g.stroke();
    }
  });
  // grate: a grid of holes
  at(S.GRATE, (s) => {
    g.fillStyle = 'rgba(0,0,0,0.42)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(i * (s / 4) + 6, j * (s / 4) + 6, s / 4 - 12, s / 4 - 12);
  });
  // spring pad: concentric rings
  at(S.SPRING, (s) => {
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 6;
    for (let r = s * 0.12; r < s * 0.5; r += s * 0.13) {
      g.beginPath();
      g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
  // lava: bright cells with dark crust lines
  at(S.LAVA, (s) => {
    g.fillStyle = 'rgba(255,230,120,0.5)';
    for (let k = 0; k < 12; k++) {
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, 8 + rnd() * 16, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(40,0,0,0.5)';
    g.lineWidth = 4;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.moveTo(rnd() * s, rnd() * s);
      g.lineTo(rnd() * s, rnd() * s);
      g.stroke();
    }
  });
  // void: dark with faint strata
  at(S.VOID, (s) => {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 6; k++) g.fillRect(0, (k / 6) * s, s, 4);
  });
  // platform: riveted plate
  at(S.PLATFORM, (s) => {
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(4, 4, s - 8, s - 8);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  });
  // crumble: cracks
  at(S.CRUMBLE, (s) => {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(10, 20);
    g.lineTo(s * 0.4, s * 0.5);
    g.lineTo(s * 0.3, s - 10);
    g.moveTo(s * 0.4, s * 0.5);
    g.lineTo(s - 12, s * 0.3);
    g.stroke();
  });
  // conveyor: chevrons
  at(S.CONVEYOR, (s) => {
    g.strokeStyle = 'rgba(255,220,80,0.7)';
    g.lineWidth = 8;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(k * (s / 4), 10);
      g.lineTo(k * (s / 4) + s / 8, s / 2);
      g.lineTo(k * (s / 4), s - 10);
      g.stroke();
    }
  });
  // shore: wet sand ripples
  at(S.SHORE, (s) => {
    g.strokeStyle = 'rgba(40,80,90,0.18)';
    g.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.moveTo(0, k * (s / 6) + 8);
      g.bezierCurveTo(s * 0.3, k * (s / 6) - 6, s * 0.7, k * (s / 6) + 20, s, k * (s / 6) + 8);
      g.stroke();
    }
  });
  // stone: bevelled slab
  at(S.STONE, (s) => {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 6;
    g.strokeRect(8, 8, s - 16, s - 16);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.strokeRect(16, 16, s - 32, s - 32);
  });
  // 15: cliff wall: three broad paper layers, darker toward the bottom (v=0 is the bottom)
  at(15, (s) => {
    const bands = [[0, 0.3, 'rgba(0,0,0,0.3)'], [0.3, 0.62, 'rgba(0,0,0,0.14)'], [0.62, 0.9, 'rgba(0,0,0,0.02)'], [0.9, 1, 'rgba(255,255,255,0.18)']];
    for (const [a, b, c] of bands) {
      g.fillStyle = c;
      g.fillRect(0, s * (1 - b), s, s * (b - a));
    }
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(0, s * (1 - 0.3), s, 3);
    g.fillRect(0, s * (1 - 0.62), s, 3);
    g.fillRect(0, s * (1 - 0.9), s, 3);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round particle sprite. */
export function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Leg marks: circle, square, triangle, star, drawn in ink on a transparent canvas. */
export function makeMarkTexture(mark, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.strokeStyle = '#2a1e1a';
  g.lineWidth = 10;
  g.lineJoin = 'round';
  g.beginPath();
  if (mark === 'circle') g.arc(64, 64, 42, 0, Math.PI * 2);
  else if (mark === 'square') g.rect(26, 26, 76, 76);
  else if (mark === 'triangle') {
    g.moveTo(64, 18);
    g.lineTo(110, 104);
    g.lineTo(18, 104);
    g.closePath();
  } else {
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 20 : 48;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
  }
  g.fill();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
