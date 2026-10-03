// Pooled particles in one Points draw call: dust on clay, mud splats, steam, sparks on metal,
// smoke from burns, splashes, slab debris, salt on ice and wind streaks.
import * as THREE from 'three';
import { makeDotTexture } from './textures.js';

const KINDS = {
  dust: { color: [0.93, 0.8, 0.55], size: 0.9, life: 0.9, gravity: -1.5, drag: 2.5, spread: 1.2, up: 1.8 },
  mud: { color: [0.42, 0.29, 0.18], size: 0.6, life: 1.1, gravity: -9, drag: 0.5, spread: 2.2, up: 3.5 },
  steam: { color: [0.97, 0.97, 0.95], size: 1.6, life: 1.6, gravity: 2.2, drag: 1.2, spread: 0.6, up: 2.5 },
  spark: { color: [1, 0.82, 0.3], size: 0.28, life: 0.5, gravity: -12, drag: 0.4, spread: 3, up: 3 },
  smoke: { color: [0.25, 0.2, 0.18], size: 1.3, life: 1.4, gravity: 1.4, drag: 1.5, spread: 0.8, up: 1.5 },
  splash: { color: [0.6, 0.85, 0.9], size: 0.5, life: 0.8, gravity: -9, drag: 0.6, spread: 2.4, up: 4 },
  debris: { color: [0.62, 0.57, 0.5], size: 0.45, life: 1.3, gravity: -11, drag: 0.3, spread: 1.6, up: 2 },
  salt: { color: [1, 1, 1], size: 0.35, life: 0.7, gravity: -3, drag: 1.5, spread: 1.5, up: 1.2 },
  wind: { color: [1, 1, 1], size: 0.5, life: 0.9, gravity: 0, drag: 0.1, spread: 0.4, up: 0 },
  lava: { color: [1, 0.45, 0.15], size: 0.5, life: 0.8, gravity: -8, drag: 0.3, spread: 2.5, up: 4 },
  star: { color: [1, 0.95, 0.6], size: 0.7, life: 1.2, gravity: -2, drag: 1, spread: 3, up: 3 },
};

export function createFx(scene, maxParticles = 700) {
  const N = maxParticles;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1));
  const tex = makeDotTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, scaleY: { value: 400 } },
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    vertexShader: `attribute float psize; attribute float palpha; varying float vA; varying vec3 vC; uniform float scaleY;
      void main(){ vC = color; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = psize * scaleY / max(1.0, -mv.z); }`,
    fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.02) discard; }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 20;
  scene.add(points);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const grav = new Float32Array(N);
  const drag = new Float32Array(N);
  const base = new Float32Array(N);
  let next = 0;
  let budget = 1;
  let rnd = 12345;
  const rand = () => {
    rnd = (rnd * 1664525 + 1013904223) >>> 0;
    return rnd / 4294967296;
  };

  function spawn(kind, x, y, z, count, opt = {}) {
    const k = KINDS[kind] ?? KINDS.dust;
    const n = Math.max(1, Math.round(count * budget));
    for (let c = 0; c < n; c++) {
      const i = next;
      next = (next + 1) % N;
      pos[i * 3] = x + (rand() - 0.5) * (opt.radius ?? 0.3);
      pos[i * 3 + 1] = y + (rand() - 0.5) * 0.2;
      pos[i * 3 + 2] = z + (rand() - 0.5) * (opt.radius ?? 0.3);
      const sp = k.spread * (opt.spread ?? 1);
      vel[i * 3] = (rand() - 0.5) * sp + (opt.vx ?? 0);
      vel[i * 3 + 1] = k.up * (0.5 + rand()) * (opt.up ?? 1) + (opt.vy ?? 0);
      vel[i * 3 + 2] = (rand() - 0.5) * sp + (opt.vz ?? 0);
      life[i] = maxLife[i] = k.life * (0.7 + rand() * 0.6) * (opt.life ?? 1);
      grav[i] = k.gravity;
      drag[i] = k.drag;
      base[i] = k.size * (0.7 + rand() * 0.6) * (opt.size ?? 1);
      const tint = opt.color ?? k.color;
      col[i * 3] = tint[0];
      col[i * 3 + 1] = tint[1];
      col[i * 3 + 2] = tint[2];
      size[i] = base[i];
      alpha[i] = 1;
    }
  }

  function update(dt, camera) {
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 2] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = Math.max(0, life[i] / maxLife[i]);
      alpha[i] = Math.min(1, f * 1.6) * 0.9;
      size[i] = base[i] * (1.3 - f * 0.5);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.psize.needsUpdate = true;
    geo.attributes.palpha.needsUpdate = true;
    if (camera) mat.uniforms.scaleY.value = (camera.projectionMatrix.elements[5] * (points.userData.height ?? 720)) / 2;
  }

  return {
    spawn,
    update,
    setHeight(h) {
      points.userData.height = h;
    },
    setBudget(b) {
      budget = b;
    },
    dispose() {
      scene.remove(points);
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
