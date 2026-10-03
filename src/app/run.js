// A run on screen: the course and walker rendered, the fixed-step clock, inputs fed to the
// sim (host) or to the network (client), and the sim's events turned into dust, sparks,
// shakes and sounds. The sim itself never knows any of this exists.
import { DT, CARGO } from '../sim/constants.js';
import { createSim, stepSim, setHumanInput, drainEvents, setPilotLeg, requestReset, signalSim } from '../sim/sim.js';
import { ST } from '../sim/walker.js';
import { buildTerrain } from '../render/terrain3d.js';
import { createWalker3d } from '../render/walker3d.js';
import { createHud3d } from '../render/hud3d.js';
import { createHazards3d } from '../render/hazards3d.js';
import { createDecor } from '../render/decor.js';
import { createFx } from '../render/fx.js';
import { createChaseCamera } from '../render/camera.js';
import { LEG_HEX, PALETTE } from '../render/scene.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SURF_FX = { 0: 'dust', 1: 'salt', 2: 'mud', 3: 'spark', 4: 'dust', 7: 'spark', 8: 'debris', 9: 'spark', 10: 'splash', 11: 'dust' };

/**
 * opts: { gfx, course, cfg, owners, pilot, botSkill, seed, look, myLeg, audio, quality, reduced, onEvent }
 */
export function createRun(opts) {
  const { gfx, course } = opts;
  const quality = opts.quality ?? 'high';
  const sim = createSim({ course, cfg: opts.cfg, owners: opts.owners, pilot: opts.pilot, botSkill: opts.botSkill, seed: opts.seed, autonomous: opts.autonomous });
  const terrain = buildTerrain(course, quality);
  gfx.scene.add(terrain.group);
  const fx = createFx(gfx.scene, quality === 'low' ? 250 : 700);
  fx.setBudget(quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1);
  const hazards = createHazards3d(gfx.scene, course, quality, fx);
  const decor = createDecor(gfx.scene, course, course.biome, quality);
  const walker = createWalker3d(gfx.scene, { ...opts.look, cargo: course.cargo });
  const hud3d = createHud3d(gfx.scene);
  hud3d.setBlob(quality === 'low');
  const cam = createChaseCamera(gfx.camera);
  cam.st.reduced = !!opts.reduced;
  cam.snap(sim.w);
  gfx.setBiome(course.biome);
  // a warm rim light from beyond the machine, wherever the camera is: its outline lifts off the ground
  const rim = gfx.rim;
  const placeRim = (w) => {
    rim.intensity = quality === 'low' ? 0.45 : 0.6;
    const dx = w.x - gfx.camera.position.x;
    const dz = w.z - gfx.camera.position.z;
    const l = Math.hypot(dx, dz) || 1;
    rim.position.set(w.x + (dx / l) * 18, w.y + 1.5, w.z + (dz / l) * 18); // low and grazing: edges, not the deck
    rim.target.position.set(w.x, w.y, w.z);
  };

  const run = {
    sim,
    walker,
    cam,
    fx,
    hud3d,
    accumulator: 0,
    time: 0,
    view: sim.w, // what the renderer draws: the sim's walker (host) or an interpolated snapshot (client)
    hostMode: true,
    myLeg: opts.myLeg ?? 0,
    pilot: !!opts.pilot,
    paused: false,
    slowMo: 0,
    events: [],
    stepsSinceLift: 0,
    lastEventT: {},
    /** Advance the clock. Host: steps the sim. Client: the net layer sets `view` itself. */
    update(dtRaw, input) {
      const dt = Math.min(dtRaw, 0.25); // a hidden tab comes back calm, not ten seconds at once
      run.time += dt;
      // a tumble's first moments play slowly: the machine going over is the big moment
      let simDt = dt;
      if (run.slowMo > 0) {
        run.slowMo -= dt;
        if (!cam.st.reduced) simDt *= 0.35;
      }
      if (run.hostMode && !run.paused) {
        run.accumulator += simDt;
        let steps = 0;
        while (run.accumulator >= DT && steps < 15) {
          if (input) feedInput(run, input);
          stepSim(sim);
          run.accumulator -= DT;
          steps++;
        }
        if (run.accumulator > DT) run.accumulator = 0; // slow-motion catch-up is worse than a skip
        handleEvents(run, drainEvents(sim), opts);
      }
    },
    render(dt, hudInfo) {
      const w = run.view;
      walker.update(w, dt, run.time);
      run.updateGhost(w.t);
      hud3d.update(w, run.time, run.myLeg);
      hazards.update(w.t, sim.dyn, terrain.water, w);
      decor.update(run.time, w.x);
      fx.update(dt, gfx.camera);
      fx.setHeight(gfx.state.height);
      cam.update(w, course, dt, sim.dyn);
      placeRim(w);
      gfx.followSun(w.x, w.z);
      gfx.sky.follow(gfx.camera.position.x, 0, gfx.camera.position.z);
    },
    /** The results: the finished machine where it stopped, the camera circling it, the world still moving. */
    celebrate(dt) {
      const w = run.view;
      run.time += dt;
      run.celebT = (run.celebT ?? 0) + dt;
      // start in front of the machine (the goal gate behind it) and turn slowly
      if (run.celebAngle === undefined) run.celebAngle = w.yaw + 0.55;
      run.celebAngle += dt * (cam.st.reduced ? 0.03 : 0.1);
      walker.update(w, dt, run.time);
      hud3d.setVisible(false);
      hazards.update(w.t + run.celebT, sim.dyn, terrain.water, w);
      decor.update(run.time, w.x);
      fx.update(dt, gfx.camera);
      cam.orbitAround(w.x, w.y - 0.6, w.z, 12.5, run.celebAngle, 5.6); // above the goal gate's posts
      placeRim(w);
      const W = window.innerWidth || 1;
      const H = window.innerHeight || 1;
      // the receipt sits low on an upright screen (the machine above it), on the left on a wide one
      if (H > W) gfx.camera.setViewOffset(W, H, 0, H * 0.17, W, H);
      else gfx.camera.setViewOffset(W, H, -Math.min(260, W * 0.27), 0, W, H);
      gfx.followSun(w.x, w.z);
      gfx.sky.follow(gfx.camera.position.x, 0, gfx.camera.position.z);
    },
    /** Aim the rim light from wherever the camera now is (posters move the camera themselves). */
    aimRim() {
      placeRim(run.view);
    },
    setQuality(q) {
      fx.setBudget(q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1);
      hud3d.setBlob(q === 'low');
    },
    /** A translucent chassis replaying a saved best run (x, y, z, yaw samples at 4 Hz). */
    setGhost(frames) {
      if (run.ghost) {
        gfx.scene.remove(run.ghost.mesh);
        run.ghost.mesh.geometry.dispose();
        run.ghost.mesh.material.dispose();
        run.ghost = null;
      }
      if (!frames || frames.length < 8) return;
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.9, 3.0, 3, 0.2), new THREE.MeshBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.32, depthWrite: false }));
      mesh.rotation.order = 'YZX';
      mesh.renderOrder = 4;
      gfx.scene.add(mesh);
      run.ghost = { mesh, frames };
    },
    updateGhost(t) {
      const g = run.ghost;
      if (!g) return;
      const n = g.frames.length / 4;
      const f = Math.max(0, Math.min(n - 1.001, t * 4));
      const i = Math.floor(f);
      const k = f - i;
      const at = (j, c) => g.frames[Math.min(n - 1, j) * 4 + c];
      const x = (at(i, 0) * (1 - k) + at(i + 1, 0) * k) / 10;
      const y = (at(i, 1) * (1 - k) + at(i + 1, 1) * k) / 10;
      const z = (at(i, 2) * (1 - k) + at(i + 1, 2) * k) / 10;
      const yaw = (at(i, 3) * (1 - k) + at(i + 1, 3) * k) / 100;
      g.mesh.position.set(x, y - 0.1, z);
      g.mesh.rotation.set(0, -yaw, 0);
      g.mesh.visible = t < n / 4 + 1;
    },
    dispose() {
      gfx.camera.clearViewOffset();
      run.setGhost(null);
      gfx.scene.remove(terrain.group);
      terrain.dispose();
      hazards.dispose();
      decor.dispose();
      walker.dispose();
      hud3d.dispose();
      fx.dispose();
    },
  };
  return run;
}

function feedInput(run, input) {
  const sim = run.sim;
  const leg = run.pilot ? 0 : run.myLeg;
  if (leg < 0) return;
  setHumanInput(sim, leg, { x: input.st.x, y: input.st.y, lift: input.st.lift, brace: input.st.brace });
  if (input.st.cycle && run.pilot) {
    setPilotLeg(sim, sim.pilotLeg + 1);
    input.st.cycle = false;
    run.events.push({ type: 'cycle', leg: sim.pilotLeg });
  }
  if (input.st.reset) {
    input.st.reset = false;
    if (requestReset(sim)) run.events.push({ type: 'resetDone' });
  }
  if (input.st.signal) {
    signalSim(sim, input.st.signal);
    run.events.push({ type: 'signal', kind: input.st.signal, leg });
    input.st.signal = null;
  }
  run.myLeg = run.pilot ? sim.pilotLeg : run.myLeg;
}

/** Turn sim events into particles, camera shake and a call to the app (sound, hints, hud). */
export function handleEvents(run, events, opts) {
  const { fx, cam } = run;
  for (const e of events) {
    switch (e.type) {
      case 'plant': {
        const kind = SURF_FX[e.surf] ?? 'dust';
        fx.spawn(e.wet ? 'splash' : kind, e.x, e.y + 0.1, e.z, kind === 'spark' ? 6 : 8, { radius: 0.5 });
        break;
      }
      case 'lift':
        fx.spawn('dust', e.x, e.y + 0.05, e.z, 3, { radius: 0.3, up: 0.6 });
        break;
      case 'burn':
        fx.spawn('smoke', e.x, e.y + 0.3, e.z, 14, { radius: 0.5 });
        fx.spawn('lava', e.x, e.y + 0.3, e.z, 10, { radius: 0.4 });
        cam.shake(0.5);
        break;
      case 'fall':
      case 'soak':
        fx.spawn(e.type === 'soak' ? 'splash' : 'dust', e.x, e.y + 0.3, e.z, 12, { radius: 0.6 });
        cam.shake(0.4);
        break;
      case 'hit':
        fx.spawn('dust', e.x, e.y + 0.2, e.z, 10, { radius: 0.6 });
        cam.shake(0.6);
        break;
      case 'snap':
        fx.spawn('spark', e.x, e.y + 0.2, e.z, 5, { radius: 0.3 });
        break;
      case 'spring':
        fx.spawn('dust', e.x, e.y + 0.1, e.z, 16, { radius: 0.8, up: 2 });
        cam.shake(0.3);
        break;
      case 'pop':
        fx.spawn('mud', e.x, e.y + 0.1, e.z, 14, { radius: 0.5 });
        break;
      case 'crack':
        fx.spawn('debris', e.x, e.y + 0.1, e.z, 4, { radius: 0.5, up: 0.5 });
        break;
      case 'tumble':
        cam.shake(1.4);
        fx.spawn('dust', e.x, run.view.y - 1, e.z, 40, { radius: 2.5, spread: 2.5 });
        run.slowMo = 0.45;
        break;
      case 'respawn':
        fx.spawn('star', e.x, 2, e.z, 24, { radius: 2, spread: 2 });
        break;
      case 'rockhit':
      case 'boulderhit':
        cam.shake(0.9);
        break;
      case 'barhit':
        cam.shake(0.5);
        break;
      case 'spill':
        fx.spawn(e.mode === 'crack' ? 'splash' : 'star', run.view.x, run.view.y + 1.5, run.view.z, 16, { radius: 0.8, spread: 2, color: e.mode === 'crack' ? [1, 0.9, 0.5] : [1, 0.6, 0.3] });
        cam.shake(0.3);
        break;
      case 'checkpoint':
        fx.spawn('star', run.view.x, run.view.y + 2, run.view.z, 30, { radius: 3, spread: 3 });
        break;
      case 'finish':
        fx.spawn('star', run.view.x, run.view.y + 2, run.view.z, 80, { radius: 4, spread: 4, life: 1.6 });
        break;
      default:
        break;
    }
    if (opts.onEvent) {
      try {
        opts.onEvent(e);
      } catch {}
    }
  }
}

export { ST, CARGO, LEG_HEX };
