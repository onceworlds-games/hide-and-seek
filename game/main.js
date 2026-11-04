// Hide and Seek: boot, the frame loop and the screen that isn't the game itself (a closed room).
// Opened with ?poster=<name> it draws one still picture for the store instead (no room, no platform).
import { RULES, SETTINGS } from './rules.js';
import { STEP } from './sim.js';
import { AudioSys } from './audio.js';
import { Fx } from './fx.js';
import { createInput } from './input.js';
import { createAvatars } from './avatars.js';
import { Net, createStubRoom, standaloneOw } from './net.js';
import { Play } from './play.js';
import { label, FONT } from './draw.js';
import * as ui from './ui.js';

const posterName = new URLSearchParams(location.search).get('poster');
if (posterName) {
  import('./poster.js').then((m) => m.runPoster(posterName));
} else {
  start();
}

async function joinRoom(ow) {
  try {
    return await ow.rooms.join({ maxPlayers: RULES.maxPlayers, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
  } catch (e) {
    console.warn('could not join a room, playing on my own', e);
    return createStubRoom();
  }
}

async function start() {
  const ow = window.onceworlds ?? standaloneOw();
  // Join first, before building anything: a reload must not miss its seat.
  let room = await joinRoom(ow);
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // desktop ignores it
  }
  const canvas = document.getElementById('c');
  const c2 = canvas.getContext('2d', { alpha: false });
  try {
    document.fonts?.load(`40px ${FONT.split(',')[0]}`);
  } catch {
    // the fallback font is fine
  }
  const audio = new AudioSys();
  const fx = new Fx();
  const input = createInput(ow, canvas);
  const avatars = createAvatars(ow);
  const buttons = new ui.Buttons();
  let app = null;
  let W = 0;
  let H = 0;
  let pr = 1;

  const syncFx = () => {
    fx.setQuality(ow.settings.quality);
    fx.reduced = Boolean(ow.settings.reducedMotion);
  };
  const resize = () => {
    pr = ow.settings.pixelRatio(2);
    W = Math.max(200, window.innerWidth);
    H = Math.max(160, window.innerHeight);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * pr);
    canvas.height = Math.round(H * pr);
  };
  syncFx();
  resize();
  addEventListener('resize', resize);
  try {
    ow.settings.on('change', () => {
      syncFx();
      resize();
    });
  } catch {
    // no settings events outside the platform
  }

  /** Builds the game around a room. */
  function wire(r) {
    room = r;
    input.clear();
    const net = new Net(r);
    const play = new Play({ ow, room: r, net, audio, fx, input, avatars });
    app = { room: r, net, play, closed: null };
    r.on('close', (reason) => {
      if (app && app.room === r) {
        app.closed = reason;
        play.clearControls();
        audio.setMood('off');
      }
    });
    input.onAny(() => audio.unlock()); // browsers let the sound start at the first key or tap
    input.onTap((x, y) => {
      if (app.closed) buttons.tap(x, y);
    });
    setInterval(() => {
      if (app && app.room === r) app.net.tick();
    }, 100);
  }

  wire(room);

  async function rejoin() {
    wire(await joinRoom(ow));
  }

  // ------------------------------------------------------------ the frame loop
  let last = performance.now();
  let acc = 0;
  let frameErrors = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      const dt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000));
      last = now;
      if (app.closed) {
        drawClosed(dt);
        return;
      }
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        app.play.update(STEP);
        app.net.stepBots(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      c2.setTransform(1, 0, 0, 1, 0, 0);
      app.play.draw(c2, W, H, pr, dt);
    } catch (e) {
      if (frameErrors++ < 5) console.error(e);
    }
  }
  requestAnimationFrame(frame);

  let closedT = 0;
  // ------------------------------------------------------------ a closed room: one message and one button
  function drawClosed(dt) {
    closedT += dt;
    c2.setTransform(pr, 0, 0, pr, 0, 0);
    c2.fillStyle = '#1c2d40';
    c2.fillRect(0, 0, W, H);
    const reason = app.closed;
    const text = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : reason === 'disconnected' ? 'Disconnected' : 'You left';
    const button = reason === 'disconnected' ? 'Rejoin' : reason === 'replaced' ? 'Play here' : 'Play';
    label(c2, text, W / 2, H * 0.34, Math.min(54, W * 0.09));
    const bw = Math.min(280, W * 0.6);
    const bh = 76;
    const bx = (W - bw) / 2;
    const by = H * 0.5;
    ui.bigButton(c2, bx, by, bw, bh, button, '#38c96b', closedT);
    buttons.reset();
    buttons.add('rejoin', bx, by, bw, bh, () => {
      buttons.reset();
      rejoin();
    });
    audio.setMood('off');
  }
}
