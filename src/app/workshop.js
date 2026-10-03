// The workshop diorama behind the title and the hub: the walker idling on a round clay bench in a
// ring of paper-cut mesas, its key turning, in the player's own paint. The camera orbits slowly and
// frames the machine where the screen has room for it (beside the hub on a wide screen, above it on
// an upright phone, under the title word on the title).
import * as THREE from 'three';
import { createWalker3d } from '../render/walker3d.js';
import { blankView } from '../net/codec.js';
import { PALETTE } from '../render/scene.js';
import { PAINTS } from '../sim/save.js';
import { HIPS } from '../sim/constants.js';
import { makeRng } from '../sim/rng.js';

/** A ring of flat-topped mesas: an open cylinder whose top edge is a stepped skyline. */
function mesaRing(radius, base, height, color, seed) {
  const seg = 120;
  const geo = new THREE.CylinderGeometry(radius, radius, 1, seg, 1, true);
  const pos = geo.attributes.position;
  const rng = makeRng(seed);
  const tops = [];
  let h = height * rng.range(0.4, 1);
  for (let i = 0; i <= seg; i++) {
    if (i % 4 === 0) h = rng.chance(0.35) ? height * rng.range(0.15, 0.35) : height * rng.range(0.55, 1); // flat tops, sudden drops
    tops.push(h);
  }
  tops[seg] = tops[0];
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v);
    const ang = Math.atan2(pos.getZ(v), pos.getX(v));
    const i = Math.round(((ang + Math.PI) / (Math.PI * 2)) * seg) % (seg + 1);
    pos.setY(v, y > 0 ? base + tops[i] : base - 4);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }));
  return mesh;
}

export function createWorkshopScene(gfx, save) {
  const group = new THREE.Group();
  const bench = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 1.2, 28), new THREE.MeshLambertMaterial({ color: PALETTE.sand, flatShading: true }));
  bench.position.y = -0.6;
  bench.receiveShadow = true;
  group.add(bench);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.25, 8, 36), new THREE.MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.8, roughness: 0.35 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.02;
  group.add(rim);
  // painted stripes on the bench
  for (let k = 0; k < 6; k++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 13.6), new THREE.MeshBasicMaterial({ color: k % 2 ? PALETTE.terracotta : PALETTE.cream, transparent: true, opacity: 0.35, depthWrite: false }));
    stripe.rotation.x = -Math.PI / 2;
    stripe.rotation.z = (k / 6) * Math.PI;
    stripe.position.y = 0.03;
    group.add(stripe);
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(110, 48), new THREE.MeshLambertMaterial({ color: 0xd8b57a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.3;
  floor.receiveShadow = true;
  group.add(floor);
  // the land around: three rings of mesas, warm near and hazy far
  group.add(mesaRing(46, -1.3, 9, 0xc8905c, 'ws-a'), mesaRing(64, -1.3, 15, 0xd9a978, 'ws-b'), mesaRing(88, -1.3, 22, 0xe6c9a0, 'ws-c'));
  // a few puffy clouds
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a8070, flatShading: true });
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 24);
  const rng = makeRng('ws-clouds');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let c = 0, k = 0; c < 6; c++) {
    const a = (c / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(40, 70);
    for (let j = 0; j < 4; j++, k++) {
      const s = rng.range(2.4, 5);
      v.set(Math.cos(a) * r + rng.range(-4, 4), rng.range(20, 30), Math.sin(a) * r + rng.range(-3, 3));
      sc.set(s * 1.4, s * 0.8, s);
      m4.compose(v, q, sc);
      clouds.setMatrixAt(k, m4);
    }
  }
  clouds.instanceMatrix.needsUpdate = true;
  group.add(clouds);
  // a few tool crates and a paint can
  const crateMat = new THREE.MeshLambertMaterial({ color: 0xb3773f, flatShading: true });
  for (const [x, z, s] of [[-9, 4, 1.6], [9, -3, 1.2], [-8, -6, 1]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(x, -1.3 + s / 2, z);
    c.castShadow = true;
    group.add(c);
  }
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 14), new THREE.MeshStandardMaterial({ color: PALETTE.teal, metalness: 0.5, roughness: 0.5 }));
  can.position.set(8.4, -0.75, 3.5);
  group.add(can);
  // the scene's rim light, from behind the machine wherever the camera is: its outline glows
  const rimLight = gfx.rim;
  gfx.scene.add(group);

  const view = blankView();
  view.x = 0;
  view.z = 0;
  view.y = 2.1;
  for (let i = 0; i < 4; i++) {
    const l = view.legs[i];
    l.fx = HIPS[i][0] * 1.08;
    l.fz = HIPS[i][1] * 1.15;
    l.fy = 0;
    l.tx = l.fx;
    l.tz = l.fz;
  }
  view.comX = 0;
  let walker = null;
  let angle = 0.6;
  let lookSig = '';
  let offset = false;

  const api = {
    group,
    visible: true,
    setLook(s) {
      const sig = `${s.paint}|${s.sticker}|${s.hat}`;
      if (sig === lookSig && walker) return;
      lookSig = sig;
      if (walker) walker.dispose();
      walker = createWalker3d(gfx.scene, { paint: PAINTS.find((p) => p.id === s.paint)?.color ?? PALETTE.orange, sticker: s.sticker, hat: s.hat, cargo: 'passengers', number: 1 });
    },
    setVisible(show) {
      group.visible = show;
      if (!walker) api.setLook(save);
      walker.root.visible = show;
      for (const L of walker.legs) for (const o of [L.hip, L.thigh, L.knee, L.shin, L.foot, L.markHolder, L.piston]) o.visible = show;
      if (!show && offset) {
        gfx.camera.clearViewOffset();
        offset = false;
      }
    },
    update(dt, g, screen) {
      const show = screen !== 'play';
      api.setVisible(show);
      if (!show) return;
      angle += dt * 0.12;
      view.t += dt;
      // a gentle breathing bob and the key turning
      view.y = 2.1 + Math.sin(view.t * 1.2) * 0.04;
      view.pitch = Math.sin(view.t * 0.8) * 0.01;
      walker.update(view, dt, view.t);
      walker.key.rotation.x += dt * 1.2;
      // framing: where on the screen the machine has room
      const W = window.innerWidth || 1;
      const H = window.innerHeight || 1;
      const upright = H > W;
      let ox = 0;
      let oy = 0;
      let radius = screen === 'title' ? 12.5 : 11;
      if (screen === 'workshop' || screen === 'results') {
        if (!upright) ox = -(Math.min(420, 0.47 * W) + 14) / 2;
        else {
          oy = H * 0.27;
          radius = 20;
        }
      } else if (screen === 'title') {
        oy = -H * (upright ? 0.02 : 0.05);
        if (upright) radius = 17;
      }
      // a short landscape screen: the hub sits right of the platform's buttons, the machine further right
      if ((screen === 'workshop' || screen === 'results') && !upright && H < 520) ox = -(146 + Math.min(400, 0.47 * W)) / 2;
      if (ox || oy) g.camera.setViewOffset(W, H, ox, oy, W, H);
      else g.camera.clearViewOffset();
      offset = !!(ox || oy);
      g.camera.position.set(Math.cos(angle) * radius, 4.6 + Math.sin(view.t * 0.5) * 0.3, Math.sin(angle) * radius);
      g.camera.lookAt(0, 1.3, 0);
      rimLight.intensity = 0.8;
      rimLight.position.set(-Math.cos(angle) * 20, 4, -Math.sin(angle) * 20);
      rimLight.target.position.set(0, 1, 0);
      rimLight.target.updateMatrixWorld();
      g.followSun(0, 0);
      g.sky.follow(g.camera.position.x, 0, g.camera.position.z);
    },
    dispose() {
      gfx.scene.remove(group);
      walker?.dispose();
    },
  };
  api.setLook(save);
  return api;
}
