// A chase camera that never fights the player: it follows the walker with look-ahead, lets the
// player orbit (drag, two fingers, or [ ]) and zoom a little, recentres by itself, and keeps
// out of the ground. No pointer lock.
import * as THREE from 'three';
import { sample } from '../sim/terrain.js';

const gS = { h: 0, s: 0, f: -1, platform: -1, conveyor: 0 };
const dynNone = { crumble: new Float32Array(0), gone: new Float32Array(0) };

export function createChaseCamera(camera) {
  const st = {
    orbit: 0, // extra yaw around the walker (radians)
    orbitVel: 0,
    pitch: 0.42,
    dist: 13.5,
    zoom: 1,
    idle: 0,
    target: new THREE.Vector3(),
    pos: new THREE.Vector3(0, 8, -14),
    lookAt: new THREE.Vector3(),
    shake: 0,
    shakeT: 0,
    free: false,
    reduced: false,
  };
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();

  return {
    st,
    /** Nudge the orbit (keys, drag). */
    orbitBy(d) {
      st.orbit += d;
      st.idle = 0;
    },
    zoomBy(d) {
      st.zoom = Math.max(0.7, Math.min(1.5, st.zoom + d));
    },
    pitchBy(d) {
      st.pitch = Math.max(0.18, Math.min(0.95, st.pitch + d));
      st.idle = 0;
    },
    shake(amount) {
      if (st.reduced) return;
      st.shake = Math.max(st.shake, amount);
    },
    snap(w) {
      const yaw = w.yaw + st.orbit;
      st.pos.set(w.x - Math.cos(yaw) * st.dist, w.y + st.dist * st.pitch + 2, w.z - Math.sin(yaw) * st.dist);
      st.lookAt.set(w.x, w.y, w.z);
    },
    /** Follow the walker (w: a view state). `course` for the ground, `dt` seconds. */
    update(w, course, dt, dyn = dynNone) {
      st.idle += dt;
      // recentre behind the walker after a few seconds without input
      if (st.idle > 3.5 && Math.abs(st.orbit) > 0.001) st.orbit *= Math.exp(-1.2 * dt);
      const speed = Math.hypot(w.vx, w.vz);
      const aheadX = w.vx * 0.9;
      const aheadZ = w.vz * 0.9;
      const yaw = w.yaw + st.orbit;
      const portrait = camera.aspect < 1 ? 0.82 : 1; // a phone held upright sits closer
      const dist = st.dist * st.zoom * portrait * (1 + Math.min(0.25, speed * 0.05));
      want.set(w.x - Math.cos(yaw) * dist + aheadX * 0.3, w.y + dist * st.pitch + 1.5, w.z - Math.sin(yaw) * dist + aheadZ * 0.3);
      // stay above the ground
      sample(course, dyn, 0, want.x, want.z, gS);
      const floor = (gS.h > -5 ? gS.h : w.y - 4) + 1.6;
      if (want.y < floor) want.y = floor;
      look.set(w.x + aheadX, w.y + 0.6, w.z + aheadZ);
      const k = 1 - Math.exp(-(st.reduced ? 10 : 5.5) * dt);
      st.pos.lerp(want, k);
      st.lookAt.lerp(look, 1 - Math.exp(-7 * dt));
      camera.position.copy(st.pos);
      if (st.shake > 0.001) {
        st.shakeT += dt * 40;
        camera.position.x += Math.sin(st.shakeT * 1.3) * st.shake * 0.25;
        camera.position.y += Math.sin(st.shakeT * 1.7 + 1) * st.shake * 0.2;
        st.shake *= Math.exp(-6 * dt);
      }
      camera.lookAt(st.lookAt);
    },
    /** A slow sweep for the workshop and posters. */
    orbitAround(cx, cy, cz, radius, angle, height) {
      camera.position.set(cx + Math.cos(angle) * radius, cy + height, cz + Math.sin(angle) * radius);
      camera.lookAt(cx, cy, cz);
    },
  };
}
