// The workshop diorama behind the title and the lobby: the walker idling on a round clay bench
// under a slow orbiting camera, its key turning, in the player's own paint.
import * as THREE from 'three';
import { createWalker3d } from '../render/walker3d.js';
import { blankView } from '../net/codec.js';
import { PALETTE } from '../render/scene.js';
import { PAINTS } from '../sim/save.js';
import { HIPS } from '../sim/constants.js';

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
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshLambertMaterial({ color: 0xd8b57a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.3;
  floor.receiveShadow = true;
  group.add(floor);
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
      const radius = screen === 'title' ? 11 : 10;
      g.camera.position.set(Math.cos(angle) * radius, 4.8 + Math.sin(view.t * 0.5) * 0.3, Math.sin(angle) * radius);
      g.camera.lookAt(0, 1.3, 0);
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
