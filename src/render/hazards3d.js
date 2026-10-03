// Everything on the course that moves or tells the time: platforms and gears, crumbling slabs,
// vents and pistons, falling rocks and their shadows, bars, gates, boulders and the tide.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { platformPose, waterLevel, CELL, toIx, toIz } from '../sim/terrain.js';
import { ventState, geyserState, rockState, barAngle, gateState, boulderState } from '../sim/hazards.js';
import { S, CRUMBLE_T } from '../sim/constants.js';
import { PALETTE } from './scene.js';
import { outlined } from './walker3d.js';

const metal = () => new THREE.MeshStandardMaterial({ color: PALETTE.metal, metalness: 0.6, roughness: 0.5 });
const brass = () => new THREE.MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.85, roughness: 0.35 });
const hz = { state: 0, p: 0, landed: false, shadow: 0, height: 0, rest: 0, open: true, closing: false, active: false, x: 0, z: 0, roll: 0 };
const pose = { x: 0, z: 0, angle: 0 };

export function createHazards3d(scene, course, quality, fx) {
  const group = new THREE.Group();
  scene.add(group);
  const items = [];

  // Platforms and gears
  for (const p of course.platforms) {
    let mesh;
    if (p.rot !== 0) {
      const gear = new THREE.Group();
      const disc = outlined(new THREE.CylinderGeometry(p.hl, p.hl, 0.5, 24), metal(), 0.05);
      gear.add(disc);
      const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), brass(), 16);
      const m = new THREE.Matrix4();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        m.makeRotationY(-a);
        m.setPosition(Math.cos(a) * (p.hl + 0.25), 0, Math.sin(a) * (p.hl + 0.25));
        teeth.setMatrixAt(k, m);
      }
      gear.add(teeth);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 12), brass());
      gear.add(hub);
      mesh = gear;
    } else {
      mesh = outlined(new RoundedBoxGeometry(p.hl * 2, 0.5, p.hw * 2, 2, 0.1), metal(), 0.05);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(p.hl * 2 + 0.2, 0.12, 0.2), brass());
      rail.position.set(0, 0.3, p.hw - 0.1);
      mesh.add(rail);
      const rail2 = rail.clone();
      rail2.position.z = -p.hw + 0.1;
      mesh.add(rail2);
    }
    mesh.position.set(p.x, p.y - 0.25, p.z);
    mesh.traverse((o) => {
      if (o.isMesh) o.receiveShadow = quality !== 'low';
    });
    group.add(mesh);
    items.push({ kind: 'platform', p, mesh });
  }
  // Crumble slabs: one mesh per slab (the terrain under them is drawn as the pit).
  const slabMat = new THREE.MeshStandardMaterial({ color: PALETTE.crumble, roughness: 0.85 });
  const slabs = [];
  if (course.stoneCount > 0) {
    const t = course.terrain;
    const bounds = new Map();
    for (let ix = 0; ix < t.nx; ix++) for (let iz = 0; iz < t.nz; iz++) {
      const i = ix * t.nz + iz;
      if (t.s[i] !== S.CRUMBLE) continue;
      const id = t.f[i];
      const b = bounds.get(id) ?? { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y: t.h[i] };
      b.x0 = Math.min(b.x0, ix * CELL);
      b.x1 = Math.max(b.x1, ix * CELL);
      b.z0 = Math.min(b.z0, iz * CELL - 12);
      b.z1 = Math.max(b.z1, iz * CELL - 12);
      bounds.set(id, b);
    }
    for (const [id, b] of bounds) {
      const w = b.x1 - b.x0 + CELL;
      const d = b.z1 - b.z0 + CELL;
      const mesh = outlined(new RoundedBoxGeometry(w, 0.5, d, 2, 0.06), slabMat.clone(), 0.04);
      mesh.position.set((b.x0 + b.x1) / 2, b.y - 0.25, (b.z0 + b.z1) / 2);
      mesh.userData.mesh.receiveShadow = quality !== 'low';
      group.add(mesh);
      slabs[id] = { mesh, baseY: b.y - 0.25, gone: false, cracked: 0 };
    }
  }
  // Vents and geysers
  const ventMat = () => new THREE.MeshStandardMaterial({ color: 0x4a3a30, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 0.8 });
  for (const v of course.vents) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(v.r, 0.18, 10, 24), brass());
    ring.rotation.x = Math.PI / 2;
    ring.position.set(v.x, elevAt(course, v.x, v.z) + 0.1, v.z);
    const core = new THREE.Mesh(new THREE.CircleGeometry(v.r - 0.15, 20), ventMat());
    core.rotation.x = -Math.PI / 2;
    core.position.set(v.x, ring.position.y + 0.02, v.z);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(v.r * 0.8, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    flame.position.set(v.x, ring.position.y + 1.6, v.z);
    flame.visible = false;
    group.add(ring, core, flame);
    items.push({ kind: 'vent', v, core, flame, lastState: 0 });
  }
  for (const g of course.geysers) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(g.r, 0.2, 10, 24), metal());
    ring.rotation.x = Math.PI / 2;
    ring.position.set(g.x, elevAt(course, g.x, g.z) + 0.1, g.z);
    const piston = outlined(new THREE.CylinderGeometry(g.r - 0.3, g.r - 0.3, 2.4, 16), brass(), 0.05);
    piston.position.set(g.x, ring.position.y - 2.2, g.z);
    group.add(ring, piston);
    items.push({ kind: 'geyser', g, piston, baseY: ring.position.y - 2.2, lastState: 0 });
  }
  // Rocks
  for (const r of course.rocks) {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(r.r, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    const y = elevAt(course, r.x, r.z);
    shadow.position.set(r.x, y + 0.04, r.z);
    shadow.renderOrder = 4;
    const rock = outlined(new THREE.DodecahedronGeometry(r.r * 0.55, 0), new THREE.MeshStandardMaterial({ color: 0x6f6258, roughness: 0.9, flatShading: true }), 0.05);
    rock.position.set(r.x, y + 20, r.z);
    group.add(shadow, rock);
    items.push({ kind: 'rock', r, shadow, rock, y, wasLanded: false });
  }
  // Bars: a low arm sweeping from a post
  for (const b of course.bars) {
    const y = elevAt(course, b.x, b.z);
    const post = outlined(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 12), brass(), 0.05);
    post.position.set(b.x, y + 0.8, b.z);
    const arm = outlined(new RoundedBoxGeometry(b.len, 0.3, 0.3, 2, 0.08), new THREE.MeshStandardMaterial({ color: PALETTE.terracotta, roughness: 0.5, metalness: 0.3 }), 0.04);
    arm.position.set(b.len / 2, 0, 0);
    const pivot = new THREE.Group();
    pivot.position.set(b.x, y + b.h, b.z);
    pivot.add(arm);
    group.add(post, pivot);
    items.push({ kind: 'bar', b, pivot });
  }
  // Gates: two posts and a striped bar that drops
  for (const g of course.gates) {
    const y = elevAt(course, g.x, 0);
    for (const side of [-1, 1]) {
      const post = outlined(new RoundedBoxGeometry(0.6, 5, 0.6, 2, 0.1), brass(), 0.04);
      post.position.set(g.x, y + 2.5, side * 6.3);
      group.add(post);
    }
    const bar = new THREE.Group();
    const beam = outlined(new RoundedBoxGeometry(0.4, 0.5, 12.2, 2, 0.1), new THREE.MeshStandardMaterial({ color: PALETTE.terracotta, roughness: 0.5 }), 0.04);
    bar.add(beam);
    for (let k = 0; k < 6; k++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.54, 0.8), new THREE.MeshStandardMaterial({ color: PALETTE.cream }));
      stripe.position.z = -5 + k * 2;
      bar.add(stripe);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0x3fcf9a, emissiveIntensity: 1 }));
    lamp.position.set(g.x, y + 5.3, 0);
    bar.position.set(g.x, y + 4.4, 0);
    group.add(bar, lamp);
    items.push({ kind: 'gate', g, bar, lamp, y });
  }
  // Boulders
  for (const b of course.boulders) {
    const rock = outlined(new THREE.DodecahedronGeometry(b.r, 1), new THREE.MeshStandardMaterial({ color: 0x7a6a5c, roughness: 0.9, flatShading: true }), 0.05);
    rock.userData.mesh.castShadow = quality !== 'low';
    group.add(rock);
    items.push({ kind: 'boulder', b, rock, y: elevAt(course, b.x1 - 2, b.z) });
  }

  return {
    group,
    update(time, dyn, water) {
      for (const it of items) {
        if (it.kind === 'platform') {
          platformPose(it.p, time, dyn, pose);
          it.mesh.position.x = pose.x;
          it.mesh.position.z = pose.z;
          if (it.p.rot !== 0) it.mesh.rotation.y = -pose.angle;
        } else if (it.kind === 'vent') {
          ventState(it.v, time, hz);
          const core = it.core.material;
          core.emissiveIntensity = hz.state === 2 ? 2.2 : hz.state === 1 ? 0.3 + hz.p * 1.2 : 0.05;
          it.flame.visible = hz.state === 2;
          if (hz.state === 2) {
            it.flame.scale.set(1, 0.7 + 0.3 * Math.sin(time * 30), 1);
            if (fx && Math.random() < 0.5) fx.spawn('lava', it.v.x, it.core.position.y + 0.5, it.v.z, 2, { radius: it.v.r });
          } else if (hz.state === 1 && fx && Math.random() < 0.25) fx.spawn('steam', it.v.x, it.core.position.y + 0.3, it.v.z, 1, { radius: it.v.r, up: 0.7 });
          it.lastState = hz.state;
        } else if (it.kind === 'geyser') {
          geyserState(it.g, time, hz);
          const rise = hz.state === 2 ? 2.4 * Math.sin(hz.p * Math.PI) : hz.state === 1 ? hz.p * 0.4 : 0;
          it.piston.position.y = it.baseY + rise;
          if (hz.state === 2 && fx && Math.random() < 0.7) fx.spawn('steam', it.g.x, it.baseY + 2.4 + rise, it.g.z, 2, { radius: it.g.r, up: 1.4 });
          if (hz.state === 1 && fx && Math.random() < 0.2) fx.spawn('steam', it.g.x, it.baseY + 2.4, it.g.z, 1, { radius: it.g.r * 0.6, up: 0.5 });
        } else if (it.kind === 'rock') {
          rockState(it.r, time, 1 / 60, hz);
          it.shadow.visible = hz.shadow > 0 || hz.rest > 0;
          it.shadow.scale.setScalar(hz.shadow > 0 ? 0.3 + hz.shadow * 0.9 : 1);
          it.shadow.material.opacity = hz.shadow > 0 ? 0.15 + hz.shadow * 0.4 : 0.35;
          if (hz.shadow > 0) {
            it.rock.visible = true;
            it.rock.position.y = it.y + hz.height + it.r.r * 0.5;
            it.rock.rotation.x += 0.08;
          } else if (hz.rest > 0) {
            it.rock.visible = true;
            it.rock.position.y = it.y + it.r.r * 0.5;
            if (hz.rest > 0.98 && fx) fx.spawn('dust', it.r.x, it.y + 0.2, it.r.z, 14, { radius: it.r.r, spread: 2 });
          } else it.rock.visible = false;
        } else if (it.kind === 'bar') {
          it.pivot.rotation.y = -barAngle(it.b, time);
        } else if (it.kind === 'gate') {
          gateState(it.g, time, hz);
          const closed = !hz.open;
          const drop = closed ? Math.min(1, hz.p * 8) : hz.closing ? 0.15 : Math.max(0, 1 - hz.p * 8);
          it.bar.position.y = it.y + 4.4 - drop * 3.2;
          it.lamp.material.emissive.set(closed ? 0xf0702a : hz.closing ? 0xf2c53d : 0x3fcf9a);
        } else if (it.kind === 'boulder') {
          boulderState(it.b, time, hz);
          it.rock.visible = hz.active;
          if (hz.active) {
            it.rock.position.set(hz.x, it.y + it.b.r, hz.z);
            it.rock.rotation.z = hz.roll;
            if (fx && Math.random() < 0.3) fx.spawn('dust', hz.x + 0.8, it.y + 0.2, hz.z, 2, { radius: 0.8 });
          }
        }
      }
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        if (!s) continue;
        const gone = dyn.gone[i] >= 0;
        const t0 = dyn.crumble[i];
        if (gone) {
          const age = time - dyn.gone[i];
          if (!s.gone) {
            s.gone = true;
            if (fx) fx.spawn('debris', s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 16, { radius: 1.2, spread: 1.5 });
          }
          s.mesh.visible = age < 0.6;
          s.mesh.position.y = s.baseY - age * age * 12;
          s.mesh.rotation.z = age * 1.5;
        } else {
          if (s.gone) {
            s.gone = false;
            s.mesh.rotation.z = 0;
          }
          s.mesh.visible = true;
          s.mesh.position.y = s.baseY;
          const frac = t0 >= 0 ? Math.min(1, (time - t0) / CRUMBLE_T) : 0;
          const m = s.mesh.userData.mesh.material;
          m.color.setHex(PALETTE.crumble).lerp(new THREE.Color(0x4a3f38), frac * 0.8);
          if (frac > 0.6) s.mesh.position.y = s.baseY + Math.sin(time * 40) * 0.03 * frac;
        }
      }
      if (water && course.water) water.position.y = waterLevel(course, time);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && o.material.side !== THREE.BackSide) o.material.dispose();
      });
    },
  };
}

function elevAt(course, x, z) {
  const t = course.terrain;
  const ix = Math.max(0, Math.min(t.nx - 1, toIx(x)));
  const iz = Math.max(0, Math.min(t.nz - 1, toIz(z)));
  return t.h[ix * t.nz + iz];
}
