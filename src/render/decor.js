// Set dressing: puffy low-poly clouds, paper-cut mesas on the horizon and a few props along
// the strip's edges per biome. Instanced, seeded, cheap.
import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';
import { PALETTE } from './scene.js';

const MESA_COLORS = [
  [0xd9a978, 0xc8905c, 0xb87b4c],
  [0xe8dcc4, 0xd4c4a4, 0xbfa98a],
  [0xa0836f, 0x8a6f5c, 0x735b4b],
  [0xc9a583, 0xa88566, 0x8a6a50],
  [0xb8ab8a, 0x9d9174, 0x7f7560],
  [0x8f9e9a, 0x74857f, 0x5c6b66],
];

export function createDecor(scene, course, biome, quality) {
  const group = new THREE.Group();
  scene.add(group);
  const rng = makeRng(`decor-${course.seed}`);
  const len = course.length;
  // Clouds: clusters of flat-shaded icosahedra, instanced
  const cloudCount = quality === 'low' ? 10 : 22;
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount * 4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const cloudBase = [];
  let ci = 0;
  for (let c = 0; c < cloudCount; c++) {
    const cx = rng.range(-20, len + 30);
    const cz = rng.range(-70, 70) + (rng.chance(0.5) ? -30 : 30);
    const cy = rng.range(22, 38);
    for (let k = 0; k < 4; k++) {
      const s = rng.range(2.2, 5);
      const px = cx + rng.range(-4, 4);
      const pz = cz + rng.range(-2, 2);
      const py = cy + rng.range(-0.8, 1.2) - (k ? 0.6 : 0);
      m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(s * 1.4, s * 0.8, s));
      clouds.setMatrixAt(ci, m);
      cloudBase.push([px, py, pz, s]);
      ci++;
    }
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  group.add(clouds);
  // Mesas: three layers of extruded paper shapes beyond the strip edges
  const colors = MESA_COLORS[Math.max(0, Math.min(5, biome))];
  for (let layer = 0; layer < 3; layer++) {
    const shape = new THREE.Shape();
    const dist = 38 + layer * 18;
    const h0 = 3 + layer * 5;
    shape.moveTo(-40, -8);
    for (let x = -40; x <= len + 60; x += 7 + layer * 4) {
      const h = h0 + rng.range(0, 6 + layer * 3);
      shape.lineTo(x, h);
      shape.lineTo(x + rng.range(2, 5), h + rng.range(-1, 1));
    }
    shape.lineTo(len + 70, -8);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshLambertMaterial({ color: colors[layer], side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, -7, side * dist);
      mesh.rotation.y = side > 0 ? Math.PI : 0;
      group.add(mesh);
    }
  }
  // Props per biome along the edges
  const propCount = quality === 'low' ? 24 : 60;
  const geo = propGeometry(biome);
  const mat = new THREE.MeshLambertMaterial({ color: propColor(biome), flatShading: true });
  const props = new THREE.InstancedMesh(geo, mat, propCount);
  const e = new THREE.Euler();
  for (let i = 0; i < propCount; i++) {
    const x = rng.range(0, len);
    const side = rng.sign();
    const z = side * rng.range(14, 30);
    const s = rng.range(1.4, 3.2);
    e.set(0, rng.range(0, 6.28), 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, -7 + s * 0.9, z), q, new THREE.Vector3(s, s, s));
    props.setMatrixAt(i, m);
  }
  props.instanceMatrix.needsUpdate = true;
  props.castShadow = false;
  group.add(props);

  return {
    group,
    update(time, camX) {
      // clouds drift slowly
      for (let i = 0; i < cloudBase.length; i++) {
        const [px, py, pz, s] = cloudBase[i];
        m.compose(new THREE.Vector3(px + Math.sin(time * 0.05 + i) * 1.5, py, pz), q.identity(), new THREE.Vector3(s * 1.4, s * 0.8, s));
        clouds.setMatrixAt(i, m);
      }
      clouds.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}

function propGeometry(biome) {
  if (biome === 0 || biome === 3) {
    // paper cactus: a cylinder with two arms, merged by hand
    const g = new THREE.CylinderGeometry(0.35, 0.45, 2.4, 7);
    return g;
  }
  if (biome === 1) return new THREE.OctahedronGeometry(0.9, 0); // salt crystals
  if (biome === 2) return new THREE.CylinderGeometry(0.5, 0.7, 4, 8); // chimneys
  if (biome === 4) return new THREE.TorusGeometry(1, 0.3, 6, 10); // cogs on the ground
  return new THREE.ConeGeometry(0.9, 2.2, 6); // sea stacks
}

function propColor(biome) {
  return [0x6e9a5c, 0xf4efe6, 0x5d4a44, 0x7f9c62, 0xb48a3c, 0x5c6b66][Math.max(0, Math.min(5, biome))];
}

export { PALETTE };
