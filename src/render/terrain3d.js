// The course as clay and paper-cut mesas. Every ground sample of the height field is a flat
// 0.5 m top with vertical walls wherever a neighbour is lower (a terrace, a stone's rim, the
// edge of the strip), in 40 m chunks with a pattern per surface, painted checkpoint stripes,
// a goal arch, the canyon floor and a water plane for the tides.
import * as THREE from 'three';
import { S } from '../sim/constants.js';
import { CELL, HALF_W, NZ, VOID_DEPTH } from '../sim/terrain.js';
import { PALETTE } from './scene.js';
import { makeSurfaceTexture } from './textures.js';

const CHUNK = 40;
const SURF_COLOR = {
  [S.CLAY]: new THREE.Color(PALETTE.sand),
  [S.ICE]: new THREE.Color(PALETTE.ice),
  [S.MUD]: new THREE.Color(PALETTE.mud),
  [S.GRATE]: new THREE.Color(PALETTE.metal),
  [S.SPRING]: new THREE.Color(PALETTE.spring),
  [S.LAVA]: new THREE.Color(PALETTE.lava),
  [S.PLATFORM]: new THREE.Color(PALETTE.metal),
  [S.CONVEYOR]: new THREE.Color(0x5a6168),
  [S.SHORE]: new THREE.Color(PALETTE.shore),
  [S.STONE]: new THREE.Color(PALETTE.stone),
};
const WALL = new THREE.Color(PALETTE.terracotta);
const LAVA_WALL = new THREE.Color(0x6b2a1a);
const tmpC = new THREE.Color();
const HALF = CELL / 2;
const TERRACE = 0.6; // a drop this big is a paper-cut step; less is a slope

export function buildTerrain(course, quality) {
  const group = new THREE.Group();
  const tex = makeSurfaceTexture();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, flatShading: true, side: THREE.DoubleSide });
  const chunks = [];
  const n = Math.ceil(course.length / CHUNK);
  for (let c = 0; c < n; c++) {
    const geo = chunkGeometry(course, c * CHUNK, Math.min(course.length, (c + 1) * CHUNK));
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = quality !== 'low';
    mesh.castShadow = quality === 'high';
    group.add(mesh);
    chunks.push(mesh);
  }
  // The canyon floor far below the strip.
  const floorGeo = new THREE.PlaneGeometry(course.length + 200, 240, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: 0x8a5a3c }));
  floor.position.set(course.length / 2, VOID_DEPTH - 1, 0);
  group.add(floor);
  // Checkpoint arches and the goal.
  for (const cp of course.checkpoints) group.add(makeArch(cp.x, cp.z, cp.y, false));
  group.add(makeArch(course.goalX, 0, elevAt(course, course.goalX, 0), true));
  let water = null;
  if (course.water) {
    const wg = new THREE.PlaneGeometry(course.length + 40, 60, 1, 1);
    wg.rotateX(-Math.PI / 2);
    const wm = new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.72, depthWrite: false });
    water = new THREE.Mesh(wg, wm);
    water.position.set(course.length / 2, course.water.base, 0);
    water.renderOrder = 2;
    group.add(water);
  }
  return {
    group,
    water,
    dispose() {
      for (const m of chunks) m.geometry.dispose();
      mat.dispose();
      tex.dispose();
      floorGeo.dispose();
      group.traverse((o) => {
        if (o.geometry && !chunks.includes(o) && o !== floor) o.geometry.dispose();
      });
    },
  };
}

function elevAt(course, x, z) {
  const t = course.terrain;
  const ix = Math.max(0, Math.min(t.nx - 1, Math.round(x / CELL)));
  const iz = Math.max(0, Math.min(t.nz - 1, Math.round((z + HALF_W) / CELL)));
  return t.h[ix * t.nz + iz];
}

/** A growable triangle list. */
function makeBuffer() {
  const b = { pos: [], col: [], uv: [] };
  b.push = (x, y, z, c, u, v) => {
    b.pos.push(x, y, z);
    b.col.push(c.r, c.g, c.b);
    b.uv.push(u, v);
  };
  return b;
}

/** Cell-centred samples: a flat top per ground sample, walls down to lower neighbours. */
function chunkGeometry(course, x0, x1) {
  const t = course.terrain;
  const ix0 = Math.round(x0 / CELL);
  const ix1 = Math.min(t.nx, Math.round(x1 / CELL));
  const b = makeBuffer();
  const seed = t.nx;
  const ground = (ix, iz) => {
    if (ix < 0 || iz < 0 || ix >= t.nx || iz >= t.nz) return VOID_DEPTH - 1;
    const i = ix * t.nz + iz;
    const s = t.s[i];
    if (s === S.VOID || s === S.CRUMBLE) return VOID_DEPTH - 1;
    return t.h[i];
  };
  for (let ix = ix0; ix < ix1; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      const i = ix * t.nz + iz;
      const s = t.s[i];
      if (s === S.VOID || s === S.CRUMBLE) continue;
      const h = t.h[i];
      const x = ix * CELL;
      const z = iz * CELL - HALF_W;
      const base = SURF_COLOR[s] ?? SURF_COLOR[S.CLAY];
      const v = ((Math.sin(ix * 12.9898 + iz * 78.233 + seed) * 43758.5453) % 1 + 1) % 1;
      tmpC.copy(base).multiplyScalar(0.95 + v * 0.08);
      const tile = Math.min(14, s);
      const tu = (tile % 4) / 4;
      const tv = Math.floor(tile / 4) / 4;
      // Corners blend with gently different neighbours (smooth hills) and stay flat at a terrace or a rim.
      const corner = (dx, dz) => {
        const a = ground(ix, iz);
        const bb = ground(ix + dx, iz);
        const c = ground(ix, iz + dz);
        const d = ground(ix + dx, iz + dz);
        const lo = Math.min(a, bb, c, d);
        const hi = Math.max(a, bb, c, d);
        if (lo <= VOID_DEPTH || hi - lo > TERRACE) return h;
        return (a + bb + c + d) / 4;
      };
      const hmm = corner(-1, -1);
      const hpm = corner(1, -1);
      const hpp = corner(1, 1);
      const hmp = corner(-1, 1);
      // top (counter-clockwise seen from above)
      b.push(x - HALF, hmm, z - HALF, tmpC, tu, tv);
      b.push(x + HALF, hpp, z + HALF, tmpC, tu + 0.25, tv + 0.25);
      b.push(x + HALF, hpm, z - HALF, tmpC, tu + 0.25, tv);
      b.push(x - HALF, hmm, z - HALF, tmpC, tu, tv);
      b.push(x - HALF, hmp, z + HALF, tmpC, tu, tv + 0.25);
      b.push(x + HALF, hpp, z + HALF, tmpC, tu + 0.25, tv + 0.25);
      // walls toward neighbours that are a terrace lower or missing
      const wallColor = s === S.LAVA ? LAVA_WALL : WALL;
      const sides = [
        [ix + 1, iz, x + HALF, z - HALF, x + HALF, z + HALF, hpm, hpp],
        [ix - 1, iz, x - HALF, z + HALF, x - HALF, z - HALF, hmp, hmm],
        [ix, iz + 1, x + HALF, z + HALF, x - HALF, z + HALF, hpp, hmp],
        [ix, iz - 1, x - HALF, z - HALF, x + HALF, z - HALF, hmm, hpm],
      ];
      for (const [nx, nz, ax, az, bx, bz, ha, hb] of sides) {
        const nh = ground(nx, nz);
        if (nh > VOID_DEPTH && h - nh <= TERRACE) continue;
        const bottom = Math.max(VOID_DEPTH - 1, nh);
        const shade = 0.86 + v * 0.14;
        tmpC.copy(wallColor).multiplyScalar(shade);
        const wv = (hh) => 0.75 + 0.02 + 0.21 * Math.max(0, Math.min(1, (hh - (VOID_DEPTH - 1)) / 8));
        const wu0 = 0.75 + 0.02 + 0.21 * ((((ax + az) / 3) % 1) + 1) % 1;
        const wu1 = wu0 + 0.1;
        b.push(ax, ha, az, tmpC, wu0, wv(ha));
        b.push(ax, bottom, az, tmpC, wu0, wv(bottom));
        b.push(bx, bottom, bz, tmpC, wu1, wv(bottom));
        b.push(ax, ha, az, tmpC, wu0, wv(ha));
        b.push(bx, bottom, bz, tmpC, wu1, wv(bottom));
        b.push(bx, hb, bz, tmpC, wu1, wv(hb));
      }
    }
  }
  if (!b.pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A striped gate arch: two posts and a lintel, painted in brass and ink stripes. */
function makeArch(x, z, y, goal) {
  const g = new THREE.Group();
  const post = new THREE.BoxGeometry(0.5, 5.2, 0.5);
  const postMat = new THREE.MeshLambertMaterial({ color: goal ? PALETTE.orange : PALETTE.brass });
  const inkMat = new THREE.MeshLambertMaterial({ color: PALETTE.ink });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, postMat);
    m.position.set(0, 2.6, side * 6.5);
    m.castShadow = true;
    g.add(m);
    for (let k = 0; k < 5; k++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.56), inkMat);
      band.position.set(0, 0.6 + k * 1.0, side * 6.5);
      g.add(band);
    }
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 13.6), postMat);
  lintel.position.set(0, 5.5, 0);
  lintel.castShadow = true;
  g.add(lintel);
  if (goal) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 12.8), new THREE.MeshLambertMaterial({ color: PALETTE.cream }));
    banner.position.set(0, 4.2, 0);
    g.add(banner);
    for (let k = 0; k < 8; k++) {
      const tri = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 3), new THREE.MeshLambertMaterial({ color: k % 2 ? PALETTE.teal : PALETTE.orange }));
      tri.rotation.z = Math.PI;
      tri.rotation.y = Math.PI / 2;
      tri.position.set(-0.12, 3.9, -5.6 + k * 1.6);
      g.add(tri);
    }
  }
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 13), new THREE.MeshBasicMaterial({ color: goal ? PALETTE.orange : PALETTE.ink, transparent: true, opacity: 0.55, depthWrite: false }));
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.03, 0);
  g.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.material = new THREE.MeshBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.7, depthWrite: false });
  stripe2.position.set(-0.9, 0.03, 0);
  g.add(stripe2);
  g.position.set(x, y, z);
  return g;
}

export { CHUNK, VOID_DEPTH };
