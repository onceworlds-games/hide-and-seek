// The course as clay and paper-cut mesas: a flat-shaded height-field mesh in 40 m chunks with a
// procedural pattern per surface, painted checkpoint stripes, a goal arch and a water plane.
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
  [S.VOID]: new THREE.Color(0x3a2a24),
  [S.PLATFORM]: new THREE.Color(PALETTE.metal),
  [S.CRUMBLE]: new THREE.Color(PALETTE.crumble),
  [S.CONVEYOR]: new THREE.Color(0x5a6168),
  [S.SHORE]: new THREE.Color(PALETTE.shore),
  [S.STONE]: new THREE.Color(PALETTE.stone),
};
const WALL = new THREE.Color(PALETTE.terracotta);
const tmpC = new THREE.Color();

/** Build the course's static meshes. Returns a group plus per-frame hooks. */
export function buildTerrain(course, quality) {
  const group = new THREE.Group();
  const t = course.terrain;
  const tex = makeSurfaceTexture();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, flatShading: true });
  const chunks = [];
  const n = Math.ceil(course.length / CHUNK);
  for (let c = 0; c < n; c++) {
    const geo = chunkGeometry(course, c * CHUNK, Math.min(course.length, (c + 1) * CHUNK));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = quality !== 'low';
    mesh.castShadow = false;
    group.add(mesh);
    chunks.push(mesh);
  }
  // The canyon floor far below the strip.
  const floorGeo = new THREE.PlaneGeometry(course.length + 200, 240, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: 0x8a5a3c }));
  floor.position.set(course.length / 2, VOID_DEPTH - 1, 0);
  floor.receiveShadow = false;
  group.add(floor);
  // Checkpoint arches and the goal.
  for (const cp of course.checkpoints) group.add(makeArch(cp.x, cp.z, cp.y, false));
  group.add(makeArch(course.goalX, 0, elevAt(course, course.goalX, 0), true));
  // Water (tides) if the course has a shore.
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
      group.traverse((o) => {
        if (o.geometry && !chunks.includes(o)) o.geometry.dispose();
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

/** Non-indexed, per-cell colours and tile UVs: flat shading and a pattern per surface. */
function chunkGeometry(course, x0, x1) {
  const t = course.terrain;
  const ix0 = Math.round(x0 / CELL);
  const ix1 = Math.min(t.nx - 1, Math.round(x1 / CELL));
  const cells = (ix1 - ix0) * (NZ - 1);
  const pos = new Float32Array(cells * 18);
  const col = new Float32Array(cells * 18);
  const uv = new Float32Array(cells * 12);
  let p = 0;
  let u = 0;
  const seed = course.terrain.nx;
  for (let ix = ix0; ix < ix1; ix++) {
    for (let iz = 0; iz < NZ - 1; iz++) {
      const i00 = ix * t.nz + iz;
      const i10 = i00 + t.nz;
      const i01 = i00 + 1;
      const i11 = i10 + 1;
      let s = t.s[i00];
      let h00 = t.h[i00];
      let h10 = t.h[i10];
      let h01 = t.h[i01];
      let h11 = t.h[i11];
      // Crumbling slabs are separate meshes: the ground under them is the pit.
      if (s === S.CRUMBLE) {
        s = S.VOID;
        h00 = h10 = h01 = h11 = VOID_DEPTH;
      }
      // the cell's own surface decides its colour; a step down to a pit is painted as a wall
      const base = SURF_COLOR[s] ?? SURF_COLOR[S.CLAY];
      const x = ix * CELL;
      const z = iz * CELL - HALF_W;
      const drop = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
      const wall = drop > 1.2;
      tmpC.copy(wall ? WALL : base);
      // subtle hand-painted variation
      const v = ((Math.sin(ix * 12.9898 + iz * 78.233 + seed) * 43758.5453) % 1 + 1) % 1;
      const k = 0.92 + v * 0.14;
      if (s === S.VOID) tmpC.multiplyScalar(0.55 + v * 0.1);
      else tmpC.multiplyScalar(k);
      const tile = wall ? 15 : Math.min(15, s);
      const tu = (tile % 4) / 4;
      const tv = Math.floor(tile / 4) / 4;
      // two triangles: (x,z0) (x+1,z0) (x+1,z1) and (x,z0) (x+1,z1) (x,z1)
      const quad = [
        [x, h00, z, tu, tv],
        [x + CELL, h10, z, tu + 0.25, tv],
        [x + CELL, h11, z + CELL, tu + 0.25, tv + 0.25],
        [x, h00, z, tu, tv],
        [x + CELL, h11, z + CELL, tu + 0.25, tv + 0.25],
        [x, h01, z + CELL, tu, tv + 0.25],
      ];
      for (const [vx, vy, vz, a, b] of quad) {
        pos[p] = vx;
        pos[p + 1] = vy;
        pos[p + 2] = vz;
        col[p] = tmpC.r;
        col[p + 1] = tmpC.g;
        col[p + 2] = tmpC.b;
        p += 3;
        uv[u] = a;
        uv[u + 1] = b;
        u += 2;
      }
    }
  }
  // Skirts: the strip is a raised mesa, so both long edges drop to the canyon floor.
  const skirtCols = ix1 - ix0;
  const spos = new Float32Array(skirtCols * 2 * 18);
  const scol = new Float32Array(skirtCols * 2 * 18);
  const suv = new Float32Array(skirtCols * 2 * 12);
  let sp = 0;
  let su = 0;
  for (let ix = ix0; ix < ix1; ix++) {
    for (const side of [0, NZ - 1]) {
      const i0 = ix * t.nz + side;
      const i1 = i0 + t.nz;
      const x = ix * CELL;
      const z = side * CELL - HALF_W;
      const top0 = t.s[i0] === S.VOID || t.s[i0] === S.CRUMBLE ? VOID_DEPTH : t.h[i0];
      const top1 = t.s[i1] === S.VOID || t.s[i1] === S.CRUMBLE ? VOID_DEPTH : t.h[i1];
      const v = ((Math.sin(ix * 7.13 + side * 3.1 + seed) * 43758.5453) % 1 + 1) % 1;
      tmpC.copy(WALL).multiplyScalar(0.8 + v * 0.2);
      const tu = 3 / 4;
      const tv = 3 / 4;
      const a = [x, top0, z];
      const b = [x + CELL, top1, z];
      const c = [x + CELL, VOID_DEPTH - 1, z];
      const d = [x, VOID_DEPTH - 1, z];
      const tri = side === 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
      const uvs = [[tu, tv], [tu + 0.25, tv + 0.25], [tu + 0.25, tv], [tu, tv], [tu, tv + 0.25], [tu + 0.25, tv + 0.25]];
      for (let k = 0; k < 6; k++) {
        spos[sp] = tri[k][0];
        spos[sp + 1] = tri[k][1];
        spos[sp + 2] = tri[k][2];
        scol[sp] = tmpC.r;
        scol[sp + 1] = tmpC.g;
        scol[sp + 2] = tmpC.b;
        sp += 3;
        suv[su] = uvs[k][0];
        suv[su + 1] = uvs[k][1];
        su += 2;
      }
    }
  }
  const allPos = new Float32Array(pos.length + spos.length);
  allPos.set(pos);
  allPos.set(spos, pos.length);
  const allCol = new Float32Array(col.length + scol.length);
  allCol.set(col);
  allCol.set(scol, col.length);
  const allUv = new Float32Array(uv.length + suv.length);
  allUv.set(uv);
  allUv.set(suv, uv.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(allCol, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A striped gate arch: two posts and a lintel, painted in brass and ink stripes. */
function makeArch(x, z, y, goal) {
  const g = new THREE.Group();
  const post = new THREE.BoxGeometry(0.5, 5.2, 0.5);
  const postMat = new THREE.MeshLambertMaterial({ color: goal ? PALETTE.orange : PALETTE.brass });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, postMat);
    m.position.set(0, 2.6, side * 6.5);
    m.castShadow = true;
    g.add(m);
    // stripes
    for (let k = 0; k < 5; k++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.56), new THREE.MeshLambertMaterial({ color: PALETTE.ink }));
      band.position.set(0, 0.6 + k * 1.0, side * 6.5);
      g.add(band);
    }
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 13.6), new THREE.MeshLambertMaterial({ color: goal ? PALETTE.orange : PALETTE.brass }));
  lintel.position.set(0, 5.5, 0);
  lintel.castShadow = true;
  g.add(lintel);
  if (goal) {
    // a paper banner with painted triangles
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
  // stripes painted on the ground across the gate
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
