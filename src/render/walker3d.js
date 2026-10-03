// The tin-toy walker: chunky orange chassis with brass trim and rivets, a wind-up key, four
// two-segment legs placed by IK in each player's colour with a shape mark, rubber feet, and the
// cargo riding in a cradle. A thin inverted-hull outline keeps it readable against everything.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { THIGH, SHIN, HIPS, LEG_MARKS, LEG_COLORS, CARGO } from '../sim/constants.js';
import { ST } from '../sim/walker.js';
import { PALETTE, LEG_HEX } from './scene.js';
import { makeMarkTexture } from './textures.js';

const INK = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.BackSide });
const tin = (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.42 });
const brass = () => new THREE.MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.85, roughness: 0.3 });
const rubber = () => new THREE.MeshStandardMaterial({ color: 0x2f2724, metalness: 0.05, roughness: 0.95 });
const cream = () => new THREE.MeshStandardMaterial({ color: PALETTE.cream, metalness: 0.05, roughness: 0.7 });

/** An outlined mesh: the mesh plus a back-face hull pushed out along the normals. */
export function outlined(geometry, material, thickness = 0.045) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  g.add(mesh);
  const hullGeo = geometry.clone();
  const pos = hullGeo.attributes.position;
  const nor = hullGeo.attributes.normal;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * thickness, pos.getY(i) + nor.getY(i) * thickness, pos.getZ(i) + nor.getZ(i) * thickness);
  const hull = new THREE.Mesh(hullGeo, INK);
  g.add(hull);
  g.userData.mesh = mesh;
  g.userData.hull = hull;
  return g;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();

/** Orient a unit-height-along-Y segment from a to b. */
function placeSegment(obj, a, b) {
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  v1.copy(b).sub(a);
  const len = v1.length() || 0.001;
  v1.divideScalar(len);
  q.setFromUnitVectors(up, v1);
  obj.quaternion.copy(q);
}

export function createWalker3d(scene, look = {}) {
  const root = new THREE.Group();
  root.rotation.order = 'YZX';
  const paint = new THREE.Color(look.paint ?? PALETTE.orange);
  const chassisMat = tin(paint);
  const chassis = outlined(new RoundedBoxGeometry(4.4, 0.9, 3.0, 4, 0.2), chassisMat, 0.05);
  chassis.position.y = -0.1;
  root.add(chassis);
  const deck = outlined(new RoundedBoxGeometry(3.9, 0.18, 2.5, 3, 0.07), brass(), 0.03);
  deck.position.y = 0.42;
  root.add(deck);
  // Cheeks and lamps at the front
  const lampGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.18, 18);
  lampGeo.rotateZ(Math.PI / 2);
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(lampGeo, brass());
    ring.position.set(2.25, 0.05, side * 0.95);
    root.add(ring);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), new THREE.MeshStandardMaterial({ color: PALETTE.cream, emissive: 0xffe9a8, emissiveIntensity: 0.5, roughness: 0.3 }));
    lens.position.set(2.33, 0.05, side * 0.95);
    root.add(lens);
  }
  // Rivets along the deck edge
  const rivetGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const rivets = new THREE.InstancedMesh(rivetGeo, brass(), 28);
  const m4 = new THREE.Matrix4();
  let r = 0;
  for (let i = 0; i < 9; i++) for (const side of [-1, 1]) {
    m4.makeTranslation(-1.9 + i * 0.475, 0.32, side * 1.42);
    rivets.setMatrixAt(r++, m4);
  }
  for (let i = 0; i < 5; i++) for (const end of [-1, 1]) {
    m4.makeTranslation(end * 2.12, 0.32, -1.0 + i * 0.5);
    rivets.setMatrixAt(r++, m4);
  }
  rivets.instanceMatrix.needsUpdate = true;
  root.add(rivets);
  // Wind-up key at the back
  const key = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10), brass());
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -0.3;
  key.add(shaft);
  const bow = outlined(new RoundedBoxGeometry(0.16, 1.4, 0.5, 2, 0.08), brass(), 0.03);
  bow.position.x = -0.68;
  key.add(bow);
  key.position.set(-2.2, 0.05, 0);
  root.add(key);
  // Sticker plate on each side (a canvas decal)
  const sticker = makeStickerTexture(look.sticker ?? 'none', look.number ?? 4);
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: sticker, transparent: true, depthWrite: false }));
    plate.position.set(0.1, -0.05, side * 1.53);
    plate.rotation.y = side > 0 ? 0 : Math.PI;
    root.add(plate);
  }
  // Cradle and cargo
  const cradle = new THREE.Group();
  cradle.position.y = 0.55;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 10, 28), brass());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  cradle.add(ring);
  for (let k = 0; k < 4; k++) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), brass());
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    strut.position.set(Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72);
    cradle.add(strut);
  }
  root.add(cradle);
  const cargoPivot = new THREE.Group();
  cargoPivot.position.y = 0.3;
  cargoPivot.rotation.order = 'YZX';
  cradle.add(cargoPivot);
  const cargo = { kind: null, group: null, parts: [] };
  // Legs
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const color = LEG_HEX[i];
    const hip = outlined(new THREE.SphereGeometry(0.3, 16, 12), brass(), 0.04);
    const thighGeo = new RoundedBoxGeometry(0.36, THIGH, 0.36, 2, 0.1);
    const thigh = outlined(thighGeo, tin(color), 0.04);
    const knee = outlined(new THREE.SphereGeometry(0.25, 14, 10), brass(), 0.04);
    const shin = outlined(new RoundedBoxGeometry(0.27, SHIN, 0.27, 2, 0.08), tin(PALETTE.teal), 0.04);
    const foot = outlined(new RoundedBoxGeometry(0.72, 0.24, 0.52, 2, 0.08), rubber(), 0.04);
    const band = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.1, 0.54, 2, 0.04), tin(color));
    band.position.y = 0.13;
    foot.add(band);
    const markTex = makeMarkTexture(LEG_MARKS[i], LEG_COLORS[i]);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const markHolder = new THREE.Group();
    markHolder.add(mark);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), brass());
    for (const o of [hip, thigh, knee, shin, foot, markHolder, piston]) scene.add(o);
    legs.push({ hip, thigh, knee, shin, foot, markHolder, mark, piston, markTex, glow: 0 });
  }
  scene.add(root);

  const api = {
    root,
    legs,
    key,
    cargoPivot,
    chassisMat,
    cargo,
    idleT: 0,
    setPaint(hex) {
      chassisMat.color.set(hex);
    },
    setCargo(kind, hat) {
      if (cargo.group) {
        cargoPivot.remove(cargo.group);
        disposeGroup(cargo.group);
      }
      cargo.kind = kind;
      cargo.group = makeCargo(kind, hat);
      cargo.parts = cargo.group.userData.parts ?? [];
      cargoPivot.add(cargo.group);
    },
    /** Pose the walker from a view state (the sim's walker or an interpolated snapshot). */
    update(w, dt, time) {
      root.position.set(w.x, w.y, w.z);
      let pitch = w.pitch;
      let roll = w.roll;
      let yaw = w.yaw;
      let extraRoll = 0;
      let extraPitch = 0;
      let lift = 0;
      if (w.tumbling > 0) {
        // Slapstick: topple toward the tip direction, bounce, lie there, then pop back.
        const p = 1 - w.tumbling / 3;
        const over = p < 0.3 ? smooth(p / 0.3) : 1;
        const bounce = p > 0.3 && p < 0.5 ? Math.sin(((p - 0.3) / 0.2) * Math.PI) * 0.08 : 0;
        const ang = over * 1.45 + bounce;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const dF = w.tipDirX * cy + w.tipDirZ * sy;
        const dR = -w.tipDirX * sy + w.tipDirZ * cy;
        extraPitch = -dF * ang;
        extraRoll = dR * ang;
        lift = Math.sin(Math.min(1, p / 0.3) * Math.PI) * 0.6 - over * 0.9;
        if (p > 0.85) {
          const s = 1 - (p - 0.85) / 0.15;
          root.scale.setScalar(Math.max(0.05, s));
        } else root.scale.setScalar(1);
      } else root.scale.setScalar(1);
      root.position.y += lift;
      root.rotation.set(roll + extraRoll, -yaw, pitch + extraPitch);
      // Wind-up key turns while the walker idles, and faster while it tumbles.
      const speed = Math.hypot(w.vx, w.vz);
      api.idleT = speed < 0.15 && w.tumbling <= 0 ? api.idleT + dt : 0;
      const keyRate = w.tumbling > 0 ? 9 : api.idleT > 0.6 ? 1.6 : 0.2 + speed * 0.4;
      key.rotation.x += keyRate * dt;
      // Cargo tilt (relative to the body, as the sim keeps it)
      cargoPivot.rotation.set(w.cargo.aR, 0, -w.cargo.aF);
      for (const part of cargo.parts) part.update?.(time, w);
      // Legs by IK
      for (let i = 0; i < 4; i++) poseLeg(api, i, w, time);
    },
    dispose() {
      scene.remove(root);
      disposeGroup(root);
      for (const l of legs) {
        for (const o of [l.hip, l.thigh, l.knee, l.shin, l.foot, l.markHolder, l.piston]) {
          scene.remove(o);
          disposeGroup(o);
        }
        l.markTex.dispose();
      }
    },
  };
  api.setCargo(look.cargo ?? 'passengers', look.hat ?? 'none');
  return api;
}

const hipW = new THREE.Vector3();
const footW = new THREE.Vector3();
const kneeW = new THREE.Vector3();
const dir = new THREE.Vector3();
const pole = new THREE.Vector3();
const perp = new THREE.Vector3();

function poseLeg(api, i, w, time) {
  const L = api.legs[i];
  const leg = w.legs[i];
  const f = HIPS[i][0];
  const r = HIPS[i][1];
  // hip in world space (through the root's transform so the tumble animation carries the hips)
  hipW.set(f, -0.15, r);
  api.root.localToWorld(hipW);
  if (leg.absent) {
    L.hip.position.copy(hipW);
    for (const o of [L.thigh, L.knee, L.shin, L.foot, L.markHolder, L.piston]) o.visible = false;
    L.hip.visible = true;
    return;
  }
  for (const o of [L.thigh, L.knee, L.shin, L.foot, L.markHolder, L.piston]) o.visible = true;
  footW.set(leg.fx, leg.fy, leg.fz);
  if (w.tumbling > 0) {
    // flail: feet follow the body loosely
    const p = 1 - w.tumbling / 3;
    footW.set(f * 1.1, -1.4 + Math.sin(time * 9 + i) * 0.4 * (1 - p), r * 1.3);
    api.root.localToWorld(footW);
  }
  L.hip.position.copy(hipW);
  L.foot.position.copy(footW).add(up.clone().multiplyScalar(0.12));
  // two-bone IK: the knee bends outward and slightly forward
  dir.copy(footW).sub(hipW);
  let d = dir.length();
  const maxD = THIGH + SHIN - 0.02;
  if (d > maxD) {
    dir.multiplyScalar(maxD / d);
    d = maxD;
    footW.copy(hipW).add(dir);
  }
  if (d < 0.3) d = 0.3;
  dir.normalize();
  // pole: outward (side) in the body's frame plus a little forward
  pole.set(f > 0 ? 0.45 : -0.3, -0.35, r > 0 ? 1 : -1);
  api.root.localToWorld(pole).sub(api.root.position).normalize();
  perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-4) perp.set(0, 0, r > 0 ? 1 : -1);
  perp.normalize();
  const a = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
  kneeW.copy(hipW).addScaledVector(dir, a).addScaledVector(perp, h);
  L.knee.position.copy(kneeW);
  placeSegment(L.thigh, hipW, kneeW);
  placeSegment(L.shin, kneeW, footW);
  // the foot keeps flat-ish on the ground, pointing along the shin's yaw
  L.foot.rotation.set(0, -w.yaw, 0);
  if (leg.st === ST.SWING) L.foot.rotation.x = -0.25;
  // mark on the outside of the thigh, facing out
  L.markHolder.position.copy(hipW).lerp(kneeW, 0.45);
  L.markHolder.lookAt(L.markHolder.position.clone().addScaledVector(perp, 1));
  L.mark.position.set(0, 0, 0.26);
  // a brass piston rod between hip and knee suggests the servo
  v2.copy(hipW).lerp(kneeW, 0.5);
  v3.copy(perp).multiplyScalar(-0.22);
  v2.add(v3);
  placeSegment(L.piston, hipW.clone().add(v3), kneeW.clone().add(v3));
  L.piston.scale.set(1, Math.max(0.2, hipW.distanceTo(kneeW) * 0.9), 1);
  // stunned legs glow red at the foot (handled through the band colour)
  const band = L.foot.children[2];
  if (band) {
    const stunned = leg.st === ST.STUN;
    band.material.emissive.set(stunned ? 0xff3300 : 0x000000);
    band.material.emissiveIntensity = stunned ? 0.6 + 0.4 * Math.sin(time * 20) : 0;
  }
}

const smooth = (p) => p * p * (3 - 2 * p);

function makeStickerTexture(kind, number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  if (kind === 'stripes') {
    g.fillStyle = '#fff3dc';
    for (let k = 0; k < 3; k++) g.fillRect(20 + k * 60, 20, 24, 56);
  } else if (kind === 'number') {
    g.fillStyle = '#fff3dc';
    g.beginPath();
    g.arc(128, 48, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1e1a';
    g.font = 'bold 56px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(number), 128, 50);
  } else if (kind === 'rivets') {
    g.fillStyle = '#d9a441';
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.arc(30 + k * 40, 48, 9, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'flames') {
    g.fillStyle = '#f2c53d';
    g.beginPath();
    g.moveTo(10, 80);
    for (let k = 0; k < 6; k++) {
      g.lineTo(30 + k * 40, 14 + (k % 2) * 20);
      g.lineTo(50 + k * 40, 80);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The cargo models. Each returns a group with `userData.parts` that animate. */
function makeCargo(kind, hat) {
  const g = new THREE.Group();
  const parts = [];
  if (kind === 'egg') {
    const geo = new THREE.SphereGeometry(0.62, 20, 16);
    geo.scale(1, 1.3, 1);
    const egg = outlined(geo, new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.6 }), 0.04);
    egg.position.y = 0.7;
    g.add(egg);
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: makeCrackTexture(), transparent: true, depthWrite: false }));
    crack.position.set(0.55, 0.9, 0.2);
    crack.lookAt(2, 1, 0.6);
    crack.visible = false;
    g.add(crack);
    parts.push({ update: (t, w) => (crack.visible = w.cargo.cond < 0.99) });
  } else if (kind === 'soup') {
    const pot = outlined(new THREE.CylinderGeometry(0.72, 0.6, 0.8, 22), tin(0xc8643c), 0.04);
    pot.position.y = 0.4;
    g.add(pot);
    const soup = new THREE.Mesh(new THREE.CircleGeometry(0.66, 22), new THREE.MeshStandardMaterial({ color: 0xf2a33d, roughness: 0.3 }));
    soup.rotation.x = -Math.PI / 2;
    soup.position.y = 0.72;
    g.add(soup);
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 14, Math.PI), brass());
      handle.position.set(side * 0.78, 0.5, 0);
      handle.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(handle);
    }
    parts.push({ update: (t, w) => {
      soup.rotation.set(-Math.PI / 2 - w.cargo.aR * 0.8, 0, w.cargo.aF * 0.8);
      soup.position.y = 0.72 - (1 - w.cargo.cond) * 0.5;
    } });
  } else if (kind === 'lanterns') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), brass());
    pole.position.y = 1.1;
    g.add(pole);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 8), brass());
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 2.1;
    g.add(bar);
    const lanterns = [];
    for (let k = 0; k < 3; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(-0.8 + k * 0.8, 2.1, 0);
      const body = outlined(new THREE.CylinderGeometry(0.2, 0.24, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffc860, emissiveIntensity: 0.8, roughness: 0.6 }), 0.03);
      body.position.y = -0.5;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.18, 10), brass());
      cap.position.y = -0.22;
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4), rubber());
      string.position.y = -0.1;
      pivot.add(body, cap, string);
      g.add(pivot);
      lanterns.push({ pivot, body });
    }
    parts.push({ update: (t, w) => {
      lanterns.forEach((l, k) => {
        l.pivot.rotation.z = -w.cargo.aF * 1.4 + Math.sin(t * 2.3 + k) * 0.12;
        l.pivot.rotation.x = w.cargo.aR * 1.4;
        const lit = w.cargo.cond > (k + 0.5) / 3.5;
        l.body.userData.mesh.material.emissiveIntensity = lit ? 0.8 + Math.sin(t * 7 + k) * 0.15 : 0;
      });
    } });
  } else if (kind === 'boulder') {
    const rock = outlined(new THREE.DodecahedronGeometry(0.85, 0), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.9, flatShading: true }), 0.05);
    rock.position.y = 0.85;
    g.add(rock);
    parts.push({ update: (t, w) => rock.position.set(w.cargo.aR * 0.3, 0.85, -w.cargo.aF * 0.3) });
  } else {
    // passengers: three little riders with hats
    const riders = [];
    for (let k = 0; k < 3; k++) {
      const rider = new THREE.Group();
      const body = outlined(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), tin([0x22a0a0, 0xf2c53d, 0xf07aa8][k]), 0.03);
      body.position.y = 0.42;
      const head = outlined(new THREE.SphereGeometry(0.17, 12, 10), cream(), 0.03);
      head.position.y = 0.8;
      const eyeGeo = new THREE.SphereGeometry(0.03, 6, 6);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, rubber());
        eye.position.set(0.14, 0.84, s * 0.06);
        rider.add(eye);
      }
      const riderHat = makeHat(k === 1 ? hat : ['bowler', 'none', 'cone'][k]);
      if (riderHat) {
        riderHat.position.y = 0.95;
        rider.add(riderHat);
      }
      rider.add(body, head);
      rider.position.set(-0.55 + k * 0.55, 0.15, 0);
      g.add(rider);
      riders.push(rider);
    }
    parts.push({ update: (t, w) => {
      riders.forEach((rd, k) => {
        const gone = w.cargo.cond < (2 - k + 0.5) / 3.5;
        rd.visible = !gone;
        rd.rotation.z = -w.cargo.aF * 2.2 + Math.sin(t * 3 + k * 2) * 0.08;
        rd.rotation.x = w.cargo.aR * 2.2;
      });
    } });
  }
  if (kind !== 'passengers') {
    const h = makeHat(hat);
    if (h) {
      h.position.y = kind === 'lanterns' ? 2.25 : kind === 'egg' ? 1.5 : kind === 'boulder' ? 1.75 : 0.95;
      h.scale.setScalar(kind === 'egg' || kind === 'boulder' ? 2.2 : 1.6);
      g.add(h);
    }
  }
  g.userData.parts = parts;
  return g;
}

function makeHat(kind) {
  if (!kind || kind === 'none') return null;
  const g = new THREE.Group();
  if (kind === 'bowler') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 14), rubber());
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), rubber());
    g.add(brim, top);
  } else if (kind === 'cone') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 12), tin(0xf07aa8));
    cone.position.y = 0.2;
    g.add(cone);
  } else if (kind === 'crown') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.16, 8), brass());
    g.add(band);
    for (let k = 0; k < 5; k++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), brass());
      const a = (k / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.18, 0.14, Math.sin(a) * 0.18);
      g.add(spike);
    }
  } else if (kind === 'umbrella') {
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), tin(0x1f8a8a));
    canopy.position.y = 0.3;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), brass());
    stick.position.y = 0.1;
    g.add(canopy, stick);
  }
  return g;
}

function makeCrackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#2a1e1a';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(10, 60);
  g.lineTo(40, 50);
  g.lineTo(60, 75);
  g.lineTo(85, 55);
  g.lineTo(118, 70);
  g.moveTo(60, 75);
  g.lineTo(55, 110);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function disposeGroup(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material !== INK) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

export { CARGO };
