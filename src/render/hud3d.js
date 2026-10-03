// The readable body, drawn on the ground: the support polygon, the centre-of-mass dot and
// each leg's landing target in its colour (an X when the ground is bad). Colour is never the
// only cue: the COM dot also grows and the polygon pulses when the margin is poor.
import * as THREE from 'three';
import { ST } from '../sim/walker.js';
import { COM_MARGIN } from '../sim/constants.js';
import { LEG_HEX, PALETTE } from './scene.js';
import { makeMarkTexture } from './textures.js';
import { LEG_MARKS, LEG_COLORS } from '../sim/constants.js';

export function createHud3d(scene) {
  const group = new THREE.Group();
  scene.add(group);
  // Support polygon: a filled fan (up to 4 points) and an outline.
  const polyGeo = new THREE.BufferGeometry();
  const polyPos = new Float32Array(4 * 3 * 3);
  polyGeo.setAttribute('position', new THREE.BufferAttribute(polyPos, 3));
  const polyMat = new THREE.MeshBasicMaterial({ color: 0x3fcf9a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const poly = new THREE.Mesh(polyGeo, polyMat);
  poly.renderOrder = 5;
  group.add(poly);
  const linePos = new Float32Array(5 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1f8a8a, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(lineGeo, lineMat);
  line.renderOrder = 6;
  group.add(line);
  // COM dot: a disc with a dark ring
  const comGeo = new THREE.CircleGeometry(0.32, 24);
  const comMat = new THREE.MeshBasicMaterial({ color: 0x3fcf9a, depthWrite: false, transparent: true, opacity: 0.95 });
  const com = new THREE.Mesh(comGeo, comMat);
  com.rotation.x = -Math.PI / 2;
  com.renderOrder = 7;
  group.add(com);
  const comRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 24), new THREE.MeshBasicMaterial({ color: PALETTE.ink, depthWrite: false, transparent: true, opacity: 0.9 }));
  comRing.rotation.x = -Math.PI / 2;
  comRing.renderOrder = 7;
  group.add(comRing);
  // Targets per leg: a ring in the leg colour with the mark inside; an X when invalid.
  const targets = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28), new THREE.MeshBasicMaterial({ color: LEG_HEX[i], depthWrite: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 8;
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: makeMarkTexture(LEG_MARKS[i], LEG_COLORS[i]), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mark.rotation.x = -Math.PI / 2;
    mark.renderOrder = 9;
    const x = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: makeXTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    x.rotation.x = -Math.PI / 2;
    x.renderOrder = 9;
    group.add(ring, mark, x);
    targets.push({ ring, mark, x });
  }
  // Shadow blob under the body (cheap contact shadow on low quality)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 3;
  group.add(blob);

  const tmp = new THREE.Vector3();
  return {
    group,
    setVisible(v) {
      group.visible = v;
    },
    setBlob(v) {
      blob.visible = v;
    },
    update(w, time, mine) {
      // polygon
      const n = w.hullN;
      const hull = w.hull;
      let fy = 0;
      let cnt = 0;
      for (let i = 0; i < 4; i++) if (w.legs[i].st === ST.STANCE) {
        fy += w.legs[i].fy;
        cnt++;
      }
      const groundY = (cnt ? fy / cnt : w.y - 2.1) + 0.06;
      const good = w.margin > 0.15;
      const warn = w.margin > -COM_MARGIN;
      const col = good ? 0x3fcf9a : warn ? 0xf2c53d : 0xf0702a;
      polyMat.color.set(col);
      lineMat.color.set(good ? 0x1f8a8a : warn ? 0xb0841a : 0xc8643c);
      const pulse = good ? 0.2 : warn ? 0.28 + Math.sin(time * 8) * 0.06 : 0.36 + Math.sin(time * 14) * 0.1;
      polyMat.opacity = pulse;
      if (n >= 3) {
        poly.visible = true;
        let k = 0;
        for (let i = 1; i < n - 1; i++) {
          const tri = [0, i, i + 1];
          for (const j of tri) {
            polyPos[k++] = hull[j * 2];
            polyPos[k++] = groundY;
            polyPos[k++] = hull[j * 2 + 1];
          }
        }
        polyGeo.setDrawRange(0, (n - 2) * 3);
        polyGeo.attributes.position.needsUpdate = true;
        polyGeo.computeBoundingSphere();
      } else poly.visible = false;
      if (n >= 2) {
        line.visible = true;
        for (let i = 0; i <= n; i++) {
          const j = i % n;
          linePos[i * 3] = hull[j * 2];
          linePos[i * 3 + 1] = groundY + 0.01;
          linePos[i * 3 + 2] = hull[j * 2 + 1];
        }
        lineGeo.setDrawRange(0, n + 1);
        lineGeo.attributes.position.needsUpdate = true;
        lineGeo.computeBoundingSphere();
      } else line.visible = false;
      // COM
      const s = good ? 1 : warn ? 1.25 : 1.5 + Math.sin(time * 12) * 0.15;
      com.position.set(w.comX, groundY + 0.02, w.comZ);
      com.scale.setScalar(s);
      comMat.color.set(col);
      comRing.position.copy(com.position);
      comRing.scale.setScalar(s);
      com.visible = comRing.visible = w.tumbling <= 0;
      // targets
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        const t = targets[i];
        const show = leg.st === ST.SWING && w.tumbling <= 0 && !leg.absent;
        t.ring.visible = show;
        t.mark.visible = show && leg.valid;
        t.x.visible = show && !leg.valid;
        if (!show) continue;
        const y = leg.valid ? leg.ty + 0.05 : Math.max(leg.ty, leg.fy - 0.4) + 0.05;
        t.ring.position.set(leg.tx, y, leg.tz);
        t.mark.position.set(leg.tx, y + 0.01, leg.tz);
        t.x.position.set(leg.tx, y + 0.01, leg.tz);
        const own = mine === i;
        const sc = own ? 1.15 + Math.sin(time * 10) * 0.06 : 0.9;
        t.ring.scale.setScalar(sc);
        t.mark.scale.setScalar(sc);
        t.x.scale.setScalar(sc);
        t.ring.material.opacity = own ? 1 : 0.6;
      }
      blob.position.set(w.x, groundY + 0.01, w.z);
      blob.scale.setScalar(Math.max(0.3, 1 - (w.y - groundY - 2.1) * 0.15));
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    },
  };
}

function makeXTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.strokeStyle = '#c8643c';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(18, 18);
  g.lineTo(78, 78);
  g.moveTo(78, 18);
  g.lineTo(18, 78);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
