// Renderer, lights, sky and quality. One sunlit diorama: warm key light, cool fill, soft long
// shadows on medium/high, none on low. Handles resize, pixel ratio and WebGL context loss.
import * as THREE from 'three';
import { settings } from '../platform.js';

export const PALETTE = {
  sand: 0xe8c98a,
  terracotta: 0xc8643c,
  orange: 0xf0702a,
  teal: 0x1f8a8a,
  brass: 0xd9a441,
  cream: 0xfff3dc,
  ink: 0x2a1e1a,
  mud: 0x6b4a2e,
  ice: 0xcfeff5,
  metal: 0x7c8590,
  lava: 0xff5a1f,
  spring: 0x7cc243,
  crumble: 0xa89b8c,
  stone: 0xd6b48c,
  shore: 0xe6d3a3,
  water: 0x3fa7b5,
  skyTop: 0xbfe3ea,
  skyBottom: 0xfff3dc,
};
export const LEG_HEX = [0xf0702a, 0x22a0a0, 0xf2c53d, 0xf07aa8];

const SKY_BY_BIOME = [
  [0xbfe3ea, 0xfff3dc], // clay flats
  [0xd8ecf2, 0xfff8ea], // salt pans: bleached
  [0xd9b8a0, 0xffd9b0], // foundry: warm haze
  [0xb9d9d6, 0xf3ead6], // ravine
  [0xc7dfe0, 0xf7eacc], // clockwork
  [0x9fc3cf, 0xe4e9e4], // storm coast
];

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBottom);
  scene.fog = new THREE.Fog(PALETTE.skyBottom, 60, 160);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 320);

  const hemi = new THREE.HemisphereLight(0xe8f4ff, 0xc99a6a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(-18, 34, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  const sky = makeSky();
  scene.add(sky.mesh);

  const state = {
    renderer,
    scene,
    camera,
    sun,
    hemi,
    sky,
    quality: 'high',
    width: 1,
    height: 1,
    lost: false,
    frameMs: 16,
    governor: { level: 2, slowFrames: 0, fastFrames: 0 },
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state.lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    state.lost = false;
  });

  function applyQuality(level) {
    state.quality = level;
    const high = level === 'high';
    const medium = level === 'medium';
    renderer.shadowMap.enabled = high || medium;
    sun.castShadow = high || medium;
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    sun.shadow.needsUpdate = true;
    const pr = settings.pixelRatio(high ? 2 : medium ? 1.5 : 1);
    renderer.setPixelRatio(Math.max(0.5, pr));
    scene.fog.far = high ? 170 : medium ? 140 : 110;
    scene.fog.near = scene.fog.far * 0.4;
    camera.far = scene.fog.far * 1.8;
    camera.updateProjectionMatrix();
    resize();
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
    state.width = w;
    state.height = h;
    // the window may have moved to a screen with another pixel ratio
    const q = state.quality;
    renderer.setPixelRatio(Math.max(0.5, settings.pixelRatio(q === 'high' ? 2 : q === 'medium' ? 1.5 : 1)));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 50;
    camera.updateProjectionMatrix();
  }

  /** Choose the quality: the player's fixed choice is a ceiling; with Auto a tiny governor steps down on slow frames. */
  function governQuality(choice, frameMs) {
    const g = state.governor;
    const levels = ['low', 'medium', 'high'];
    if (choice !== 'auto') {
      const want = levels.indexOf(choice) >= 0 ? choice : 'high';
      if (want !== state.quality) applyQuality(want);
      return;
    }
    if (frameMs > 26) {
      g.slowFrames++;
      g.fastFrames = 0;
    } else if (frameMs < 14) {
      g.fastFrames++;
      g.slowFrames = 0;
    } else {
      g.slowFrames = Math.max(0, g.slowFrames - 1);
    }
    if (g.slowFrames > 45 && g.level > 0) {
      g.level--;
      g.slowFrames = 0;
      applyQuality(levels[g.level]);
    } else if (g.fastFrames > 900 && g.level < 2) {
      g.level++;
      g.fastFrames = 0;
      applyQuality(levels[g.level]);
    }
  }

  function setBiome(biome) {
    const [top, bottom] = SKY_BY_BIOME[Math.max(0, Math.min(5, biome | 0))];
    sky.setColors(top, bottom);
    scene.background.set(bottom);
    scene.fog.color.set(bottom);
  }

  function render() {
    if (state.lost) return;
    // The sun's shadow box follows the camera's target so shadows are crisp where the walker is.
    renderer.render(scene, camera);
  }

  function followSun(x, z) {
    sun.position.set(x - 18, 34, z + 22);
    sun.target.position.set(x, 0, z);
    sun.target.updateMatrixWorld();
  }

  applyQuality('high');
  return { ...state, state, applyQuality, governQuality, resize, render, setBiome, followSun };
}

function makeSky() {
  const geo = new THREE.SphereGeometry(280, 24, 12);
  const uniforms = {
    top: { value: new THREE.Color(PALETTE.skyTop) },
    bottom: { value: new THREE.Color(PALETTE.skyBottom) },
    sunDir: { value: new THREE.Vector3(-0.4, 0.7, 0.5).normalize() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y * 1.6 + 0.15, 0.0, 1.0); vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, h));
      float s = max(0.0, dot(normalize(vDir), sunDir)); c += vec3(1.0, 0.93, 0.7) * (pow(s, 48.0) * 0.9 + pow(s, 6.0) * 0.08);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    setColors(top, bottom) {
      uniforms.top.value.set(top);
      uniforms.bottom.value.set(bottom);
    },
    follow(x, y, z) {
      mesh.position.set(x, y, z);
    },
  };
}
