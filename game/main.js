// Hide and Seek: boot, the frame loop and the screens that aren't the game itself (the title, a closed room).
// Opened with ?poster=<name> it draws one still picture for the store instead (no room, no platform).
import { RULES, SETTINGS, COLORS, mulberry32 } from './rules.js';
import { getHouse } from './maps.js';
import { navFor } from './nav.js';
import { stepWander } from './bots.js';
import { visibility } from './geometry.js';
import { STEP } from './sim.js';
import { AudioSys } from './audio.js';
import { Fx } from './fx.js';
import { createInput } from './input.js';
import { createAvatars } from './avatars.js';
import { Net, createStubRoom, standaloneOw } from './net.js';
import { Play } from './play.js';
import { makeView, clampCamera, renderScene, screenTransform, hashOf, label, FONT } from './draw.js';
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
  const demo = makeDemo();
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

  /** Builds the game around a room. `skipTitle`: a rejoin after the room closed goes straight back in. */
  function wire(r, skipTitle) {
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
    input.onAction(() => {
      if (app.play.screen === 'title') goPlay();
    });
    input.onTap((x, y) => {
      if (app.closed) {
        buttons.tap(x, y);
        return;
      }
      if (app.play.screen !== 'title') return;
      audio.unlock(); // any tap on the title starts the sound
      audio.setMood('menu');
      if (app.room.match.phase === 'playing' || titleButton.hit(x, y)) goPlay();
    });
    if (skipTitle) {
      play.screen = 'play';
      r.hideLobby?.(false);
    } else {
      r.hideLobby?.(true);
      play.clearControls();
    }
    setInterval(() => {
      if (app && app.room === r) app.net.tick();
    }, 100);
  }

  const titleButton = {
    rect: null,
    hit(x, y) {
      const b = this.rect;
      return Boolean(b) && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    },
  };

  function goPlay() {
    audio.unlock();
    audio.setMood('menu');
    app.room.hideLobby?.(false);
    app.play.screen = 'play';
  }

  wire(room, false);

  async function rejoin() {
    const r = await joinRoom(ow);
    wire(r, true);
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
        if (app.play.screen === 'play') app.play.update(STEP);
        else stepDemo(demo, STEP);
        app.net.stepBots(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      c2.setTransform(1, 0, 0, 1, 0, 0);
      if (app.play.screen === 'play') app.play.draw(c2, W, H, pr, dt);
      else drawTitle(dt);
    } catch (e) {
      if (frameErrors++ < 5) console.error(e);
    }
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ the title: the house alive behind a logo and one button
  let titleT = 0;
  function drawTitle(dt) {
    titleT += dt;
    app.play.clearControls();
    const house = demo.house;
    const lead = demo.bots[0];
    demo.cam.x += (lead.x - demo.cam.x) * (1 - Math.exp(-dt * 2));
    demo.cam.y += (lead.y - demo.cam.y) * (1 - Math.exp(-dt * 2));
    const v = makeView(W, H, pr, demo.cam, null);
    clampCamera(v, house, demo.cam);
    v.cx = demo.cam.x;
    v.cy = demo.cam.y;
    v.x0 = v.cx - W / 2 / v.scale - 1;
    v.x1 = v.cx + W / 2 / v.scale + 1;
    v.y0 = v.cy - H / 2 / v.scale - 1;
    v.y1 = v.cy + H / 2 / v.scale + 1;
    visibility(lead.x, lead.y, lead.a, demo.cone, house.walls, demo.poly);
    for (const b of demo.bots) b.walk = (b.walk + Math.hypot(b.vx, b.vy) * dt * 1.7) % 6283;
    renderScene(c2, v, { house, t: titleT, spots: demo.spots, chars: demo.bots, beams: [{ x: lead.x, y: lead.y, a: lead.a, cone: demo.cone, poly: demo.poly, alpha: 1 }], dim: null, blind: false, fx: null });
    screenTransform(c2, v);
    c2.fillStyle = 'rgba(14,8,28,0.4)';
    c2.fillRect(0, 0, W, H);
    titleButton.rect = ui.drawTitle(c2, W, H, titleT, Boolean(ow.controls?.touch));
  }

  // ------------------------------------------------------------ a closed room: one message and one button
  function drawClosed(dt) {
    titleT += dt;
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
    ui.bigButton(c2, bx, by, bw, bh, button, '#38c96b', titleT);
    buttons.reset();
    buttons.add('rejoin', bx, by, bw, bh, () => {
      buttons.reset();
      rejoin();
    });
    audio.setMood('off');
  }
}

/** The bots that wander behind the title screen (one of them carries a flashlight). */
function makeDemo() {
  const house = getHouse('cozy');
  const nav = navFor(house);
  const rng = mulberry32(2026);
  const bots = [];
  for (let k = 0; k < 6; k++) {
    const room = house.rooms[(k * 5 + 1) % house.rooms.length];
    const id = `title${k}`;
    bots.push({
      i: k,
      id,
      x: room.ax,
      y: room.ay,
      vx: 0,
      vy: 0,
      a: 0,
      wait: rng() * 2,
      speed: k === 0 ? 3.8 : 3.2 + rng() * 0.8,
      color: COLORS[(k * 3) % COLORS.length],
      role: k === 0 ? 'seeker' : 'lobby',
      bot: true,
      face: hashOf(id),
      img: null,
      you: false,
      walk: 0,
      phase: k,
      pop: 1,
      sq: 0,
      alpha: 1,
      peek: -1,
      draw: true,
      name: '',
    });
  }
  return {
    house,
    nav,
    rng,
    bots,
    cam: { x: bots[0].x, y: bots[0].y },
    cone: { ang: (70 * Math.PI) / 180, range: 7, near: 1.5 },
    poly: [],
    spots: house.spots.map(() => ({ occ: null, open: 0, wob: 0, hot: false, mine: false, label: '', fill: '' })),
  };
}

function stepDemo(demo, dt) {
  for (const b of demo.bots) stepWander(b, { house: demo.house, nav: demo.nav, rng: demo.rng, others: demo.bots }, dt);
}
