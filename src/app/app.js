// The game on the platform: join once as the page loads, then title -> workshop (the lobby)
// -> run -> results -> workshop. The host's page runs the simulation; everyone else draws the
// host's snapshots. Authority follows room.isHost && room.connected, checked every frame.
import { createScene } from '../render/scene.js';
import { createInput } from './input.js';
import { createHud } from '../ui/hud.js';
import { createScreens } from '../ui/screens.js';
import { createAudio } from '../audio/audio.js';
import { createRun, handleEvents } from './run.js';
import { createNet } from '../net/net.js';
import { blankView } from '../net/codec.js';
import { createWorkshopScene } from './workshop.js';
import { joinRoom, player as sdkPlayer, save as sdkSave, badges as sdkBadges, leaderboards, settings, ui, events as sdkEvents, now as platformNow, onPlatform } from '../platform.js';
import { loadSave, applyResult, walkerConfig, unlockedCount, PAINTS, STICKERS, HATS, HORNS } from '../sim/save.js';
import { signalSim } from '../sim/sim.js';
import { SKILLS } from '../sim/bots.js';
import { buildCourse, dailySpec, expeditionId } from '../sim/courses.js';
import { scoreRun } from '../sim/score.js';
import { ST, hipWorld } from '../sim/walker.js';
import * as C from '../sim/constants.js';

const JOIN_OPTS = { private: true, maxPlayers: 4, minPlayers: 1, lobby: 'bar' };
const SURF_SOUND = ['clay', 'ice', 'mud', 'metal', 'spring', 'burn', 'fall', 'platform', 'crumble', 'conveyor', 'shore', 'stone'];

export async function startApp(params) {
  const gl = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');
  const uiRoot = document.getElementById('ui');
  const test = params.get('test');
  const gfx = createScene(gl);
  const input = createInput(gl);
  const hud = createHud(hudCanvas);
  const audio = createAudio();
  const app = {
    gfx, input, hud, audio, screen: 'title', run: null, net: null, room: null, me: null, save: loadSave(null), saveDirty: false, saveT: 0,
    myLeg: -1, pilot: false, hosting: false, watching: false, joinRequested: false, pendingJoins: new Set(), runStartT: 0, bankedMid: '',
    results: null, lastInput: { lift: false, brace: false }, hostFrameT: 0, workshop: null, paused: false, test, quality: 'high', reduced: false,
    sfxCooldown: new Map(), relayEvents: [], frameMs: 16, lastFrame: performance.now(), stuckT: 0, ghostRec: null, ghostPlay: null, hintShown: new Set(), course: null,
  };
  const screens = createScreens(uiRoot, api(app, screens0));
  function screens0() {
    return screens;
  }
  app.screens = screens;
  app.view = blankView();
  // ?quality=low|medium|high pins the graphics tier (store art and smoke runs on a real GPU)
  app.forceQuality = ['low', 'medium', 'high'].includes(params.get('quality')) ? params.get('quality') : null;

  // Join first: a reload must not miss its seat while the scene builds.
  const joined = test === 'run' ? null : await joinRoom(JOIN_OPTS);
  app.me = await sdkPlayer.get();
  app.save = loadSave(await sdkSave.get('save'));
  app.reduced = settings.reducedMotion();
  audio.setReduced(app.reduced);
  attachRoom(app, joined);
  window.addEventListener('resize', () => {
    gfx.resize();
    hud.resize();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSave(app, true);
  });
  settings.onChange(() => {
    app.reduced = settings.reducedMotion();
    audio.setReduced(app.reduced);
    if (app.run) app.run.cam.st.reduced = app.reduced;
  });
  sdkEvents.on('pause', () => {
    if (app.screen === 'play' && app.run && humanCount(app) <= 1 && app.hosting) {
      app.paused = true;
      app.run.paused = true;
    }
  });
  sdkEvents.on('resume', () => {
    // the platform menu closed: solo games resume by themselves
    if (app.paused) {
      app.paused = false;
      if (app.run) app.run.paused = false;
    }
  });
  const unlock = () => audio.unlock();
  gl.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  uiRoot.addEventListener('pointerdown', unlock);

  window.__lw = { info: () => info(app), app, boot: 'starting' };
  app.workshop = createWorkshopScene(gfx, app.save);
  if (test === 'run') startTestRun(app, params);
  else {
    screens.title();
    if (app.room) app.room.hideLobby?.(true);
    restoreAfterReload(app);
    if (test === 'auto') setTimeout(() => api(app, screens0).play(), 600);
  }
  window.__lw = {
    info: () => info(app),
    play: () => api(app, screens0).play(),
    // test hook: the host hands every leg to the bots so a scripted run walks by itself
    botsAll: () => {
      if (!app.run || !app.hosting) return false;
      app.run.sim.owners = ['bot', 'bot', 'bot', 'bot'];
      app.run.sim.pilot = null;
      app.run.sim.autonomous = true;
      app.run.sim.bots.skill = SKILLS[2];
      app.run.pilot = false;
      return true;
    },
    app,
  };
  requestAnimationFrame(function frame(t) {
    try {
      tick(app, t);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  });
}

/** What the DOM screens may call. */
function api(app, screens) {
  return {
    play() {
      app.audio.unlock();
      app.audio.click();
      if (app.room && app.room.match.phase === 'playing' && app.net?.run?.mid === app.room.match.id) {
        enterMatch(app, app.room.match);
        return;
      }
      showWorkshop(app);
    },
    setSetup(setup) {
      if (!app.net || !app.net.isHost) return;
      app.net.setSetup(setup);
      app.audio.click();
      showWorkshop(app);
    },
    claimSeat(leg) {
      app.audio.click();
      app.net?.claim(leg);
      setTimeout(() => showWorkshop(app), 150);
    },
    invite() {
      ui.showInvite();
    },
    avatar: (id) => sdkPlayer.avatarUrl(id, 'head'),
    buyFeet(id) {
      const s = app.save;
      const f = C.FEET[id];
      if (!f) return;
      if (!s.feetOwned.includes(id)) {
        if (s.scrap < f.cost) return;
        s.scrap -= f.cost;
        s.feetOwned.push(id);
      }
      s.feet = id;
      touchSave(app);
      app.audio.click();
      showWorkshop(app);
    },
    buyLevel(key, level) {
      const s = app.save;
      const table = { hips: C.HIPS_LEVELS, cradle: C.CRADLE_LEVELS, mechanic: C.MECHANIC_LEVELS }[key];
      if (!table || level > s[key] + 1 || level < 0) return;
      if (level > s[key]) {
        if (s.scrap < table[level].cost) return;
        s.scrap -= table[level].cost;
      }
      s[key] = level;
      touchSave(app);
      app.audio.click();
      showWorkshop(app);
    },
    buyChassis(id) {
      const s = app.save;
      const ch = C.CHASSIS[id];
      if (!ch) return;
      if (!s.chassisOwned.includes(id)) {
        if (s.scrap < ch.cost) return;
        s.scrap -= ch.cost;
        s.chassisOwned.push(id);
      }
      s.chassis = id;
      touchSave(app);
      app.audio.click();
      showWorkshop(app);
    },
    buyCosmetic(key, id) {
      const s = app.save;
      const item = findCosmetic(key, id);
      if (!item) return;
      if (!s.cosmetics.includes(id)) {
        if (s.scrap < item.cost) return;
        s.scrap -= item.cost;
        s.cosmetics.push(id);
      }
      s[key] = id;
      touchSave(app);
      if (key === 'horn') app.audio.horn(id);
      else app.audio.click();
      app.workshop?.setLook(app.save);
      showWorkshop(app);
    },
    backToWorkshop() {
      if (app.room && app.net?.isHost && app.room.match.phase === 'playing') app.room.endMatch();
      else showWorkshop(app);
    },
    rejoin() {
      rejoin(app);
    },
    requestJoin() {
      if (app.joinRequested) return;
      app.joinRequested = true;
      app.net?.sendJoinRequest();
      screens().watching(true, true);
    },
    resume() {
      app.paused = false;
      if (app.run) app.run.paused = false;
      app.screens.clear();
    },
    start() {
      if (!app.room || !app.net?.isHost || !app.room.canStart) return;
      app.audio.unlock();
      try {
        app.room.startMatch();
      } catch {}
    },
  };
}
function findCosmetic(key, id) {
  const list = key === 'paint' ? PAINTS : key === 'sticker' ? STICKERS : key === 'hat' ? HATS : key === 'horn' ? HORNS : [];
  return list.find((c) => c.id === id) ?? null;
}

function humanCount(app) {
  if (!app.net?.run) return 1;
  return app.net.run.owners.filter((o) => o !== 'bot').length;
}

function touchSave(app) {
  app.saveDirty = true;
}

function flushSave(app, force) {
  if (!app.saveDirty) return;
  const t = performance.now();
  if (!force && t - app.saveT < 3000) return;
  app.saveT = t;
  app.saveDirty = false;
  sdkSave.set('save', app.save);
}

/** Wire a room (or null: solo without a platform) into the app. */
function attachRoom(app, room) {
  app.net?.dispose();
  app.room = room;
  if (!room) {
    app.net = null;
    return;
  }
  app.net = createNet(room, {
    courseLength: () => app.course?.length ?? 1000,
    onSeats: () => refreshWorkshop(app),
    onSetup: () => refreshWorkshop(app),
    onRoster: () => refreshWorkshop(app),
    onJoin: () => {
      if (app.hosting && app.room.match.phase === 'lobby') app.net.tidySeats();
      refreshWorkshop(app);
    },
    onLeave: () => refreshWorkshop(app),
    onRunState: (run) => onRunState(app, run),
    onEvents: (list) => {
      if (app.run && !app.hosting) {
        app.net.mirrorSlabs(list, app.run.sim.dyn);
        handleEvents(app.run, list, { onEvent: (e) => onSimEvent(app, e) });
      }
    },
    onSignal: (kind, leg, from) => {
      app.hud.bubble(leg >= 0 ? leg : 0, kind);
      app.audio.blip(leg >= 0 ? leg : 0, kind);
    },
    onJoinRequest: (id) => app.pendingJoins.add(id),
    onHost: (isHost) => onHostChange(app, isHost),
    onReconnect: () => {
      refreshWorkshop(app);
      onHostChange(app, app.net.isHost);
    },
    onMatchStart: (m) => enterMatch(app, m),
    onMatchEnd: (m, prev) => leaveMatch(app, prev),
    onMatchPause: (paused) => {
      if (app.run) app.run.paused = paused && app.hosting;
      if (paused) app.hud.flash('WAITING FOR PLAYERS', 1500);
    },
    onStarting: () => {
      try {
        app.room.setOpen(true);
      } catch {}
    },
    onClose: (reason) => {
      disposeRun(app);
      app.screen = 'closed';
      app.input.setTouch(null);
      app.screens.closed(reason);
    },
    onResults: (r) => {
      if (app.screen === 'play' && !app.hosting && app.run && r && r.mid === app.run.mid) {
        // the host has posted the results: everyone sees the card while the room winds down
        takeResults(app, r);
        app.screen = 'results';
        app.input.setTouch(null);
        app.screens.results(app.results, { isHost: false, hostName: app.room.players.get(app.room.host)?.name ?? '' });
        app.audio.music.stop();
      } else if (app.screen === 'results' || app.screen === 'workshop') takeResults(app, r);
    },
  });
  app.hosting = app.net.isHost;
}

async function rejoin(app) {
  const room = await joinRoom(JOIN_OPTS);
  attachRoom(app, room);
  app.screens.title();
  app.screen = 'title';
  if (room) room.hideLobby?.(true);
  restoreAfterReload(app);
}

/** A reloaded page lands back where it was: a running match is rejoined straight away. */
function restoreAfterReload(app) {
  const room = app.room;
  if (!room) return;
  if (room.match.phase === 'playing' && app.net.run?.mid === room.match.id) {
    enterMatch(app, room.match);
  }
}

function showWorkshop(app) {
  if (app.screen === 'play') return;
  app.screen = 'workshop';
  app.input.setTouch(null);
  if (app.room) {
    app.room.hideLobby?.(false);
    if (app.net.isHost) app.net.tidySeats();
  }
  refreshWorkshop(app);
}

function refreshWorkshop(app) {
  if (app.screen !== 'workshop') return;
  const room = app.room;
  const seats = app.net?.seats ?? [app.me?.id ?? 'me', null, null, null];
  const players = room ? room.players : new Map([[app.me?.id ?? 'me', { id: app.me?.id ?? 'me', name: app.me?.name ?? 'You' }]]);
  const hostId = room ? room.host : app.me?.id;
  const humans = seats.filter((s) => s && players.get(s)).length || 1;
  app.screens.workshop({
    isHost: app.net ? app.net.isHost : true,
    hostName: room ? players.get(room.host)?.name ?? '' : '',
    host: hostId,
    me: app.me?.id,
    save: app.save,
    setup: app.net?.setup ?? { mode: 'expedition', biome: 0, index: 0, mutators: [], ghost: false },
    seats,
    players,
    humans,
    daily: dailySpec(platformNow()),
    results: app.results,
    standalone: !onPlatform(),
    canStart: !!app.room?.canStart,
  });
  app.workshop?.setLook(app.save);
}

/** Build the run record for a match (host), from the host's workshop, the seats and each leg's feet. */
function buildRunRecord(app, match) {
  const setup = app.net.setup;
  const room = app.room;
  const seats = app.net.seats;
  const participants = new Set(match.participants ?? []);
  const owners = [0, 1, 2, 3].map((i) => (seats[i] && participants.has(seats[i]) && room.players.get(seats[i]) ? seats[i] : 'bot'));
  const humans = owners.filter((o) => o !== 'bot');
  let pilot = null;
  if (humans.length === 1) {
    pilot = humans[0];
    for (let i = 0; i < 4; i++) owners[i] = 'bot';
  }
  const feet = [0, 1, 2, 3].map((i) => {
    const id = owners[i];
    if (id === 'bot') return app.save.feet;
    const p = room.players.get(id)?.presence;
    return p && C.FEET[p.feet] ? p.feet : 'std';
  });
  if (pilot) feet.fill(app.save.feet);
  const seedBase = `${match.seed ?? match.id}`;
  let spec;
  if (setup.mode === 'endless') spec = { kind: 'endless', seed: `endless-${seedBase}`, biome: 0, index: 0, mutators: setup.mutators };
  else if (setup.mode === 'daily') {
    const d = dailySpec(platformNow());
    spec = { kind: 'daily', seed: d.seed, biome: d.biome, index: 0, mutators: d.mutators };
  } else spec = { kind: 'expedition', biome: setup.biome, index: setup.index, seed: expeditionId(setup.biome, setup.index), mutators: setup.mutators };
  const cfg = walkerConfig(app.save, feet, spec.mutators, owners.map((o) => o === 'bot'));
  return { mid: match.id, spec, cfg, owners, pilot, ghost: !!setup.ghost && spec.kind === 'expedition' };
}

/** The match began (or the page reloaded into one). */
function enterMatch(app, match) {
  if (app.screen === 'play' && app.run && app.run.mid === match.id) return;
  disposeRun(app);
  app.results = null;
  app.pendingJoins.clear();
  app.joinRequested = false;
  app.screen = 'play';
  app.screens.clear();
  app.audio.unlock();
  const room = app.room;
  if (!room) return;
  app.hosting = app.net.isHost;
  if (app.hosting && app.net.run?.mid !== match.id) app.net.publishRun(buildRunRecord(app, match));
  const run = app.net.run;
  if (run && run.mid === match.id) startRunFromRecord(app, run, match);
  else app.hud.flash('LOADING', 800); // the run record arrives in a moment (onRunState)
}

function onRunState(app, run) {
  if (!run || !app.room || app.room.match.phase !== 'playing' || run.mid !== app.room.match.id) return;
  if (app.screen !== 'play') return;
  if (!app.run || app.run.mid !== run.mid) startRunFromRecord(app, run, app.room.match);
  else applyOwners(app, run);
}

function applyOwners(app, run) {
  const me = app.me.id;
  const leg = run.owners.indexOf(me);
  app.pilot = run.pilot === me;
  app.myLeg = app.pilot ? app.run.sim.pilotLeg : leg;
  app.watching = !app.pilot && leg < 0;
  app.run.myLeg = app.myLeg;
  app.run.pilot = app.pilot;
  app.run.sim.owners = run.owners.slice();
  app.run.sim.pilot = run.pilot;
  app.hud.st.mine = app.myLeg;
  app.hud.st.watching = app.watching;
  app.hud.st.labels = run.owners.map((o) => (o === 'bot' ? 'Bot' : app.room.players.get(o)?.name ?? ''));
  app.input.setTouch(app.watching ? null : app.pilot ? 'pilot' : 'leg');
  if (app.watching) app.screens.watching(true, app.joinRequested);
  else if (app.screens.name === 'watching') app.screens.clear();
}

function startRunFromRecord(app, run, match) {
  disposeRun(app);
  app.quality = app.forceQuality ?? (settings.choice() === 'auto' ? app.gfx.state.quality : settings.choice());
  app.course = buildCourse(run.spec);
  app.gfx.camera.clearViewOffset();
  const me = app.me.id;
  const look = { paint: PAINTS.find((p) => p.id === app.save.paint)?.color, sticker: app.save.sticker, hat: app.save.hat, number: 1 + (run.owners.indexOf(me) + 4) % 4 };
  const auto = app.test === 'auto';
  app.run = createRun({ gfx: app.gfx, course: app.course, cfg: run.cfg, owners: auto ? ['bot', 'bot', 'bot', 'bot'] : run.owners, pilot: auto ? null : run.pilot, botSkill: run.cfg.mechanic, seed: `${run.mid}`, look, myLeg: Math.max(0, run.owners.indexOf(me)), quality: app.quality, reduced: app.reduced, autonomous: auto, onEvent: (e) => onSimEvent(app, e) });
  app.workshop?.setVisible(false);
  app.run.mid = run.mid;
  app.run.hostMode = app.hosting;
  if (app.hosting) {
    app.net.setHostSim(app.run.sim);
    app.net.adoptCheckpoint(app.run.sim, run.mid);
  } else {
    app.net.setHostSim(null);
    app.run.view = app.view;
    app.net.net.haveA = app.net.net.haveB = false;
  }
  app.runStartT = performance.now();
  app.stuckT = 0;
  applyOwners(app, run);
  app.audio.music.start();
  app.audio.music.setGroove(0);
  app.hud.st.pilot = app.pilot;
  app.ghostPlay = run.ghost && app.save.ghosts[app.course.id] ? { frames: app.save.ghosts[app.course.id].f, t: app.save.ghosts[app.course.id].t } : null;
  if (app.ghostPlay) app.run.setGhost(app.ghostPlay.frames);
  app.ghostRec = app.hosting && app.course.kind === 'expedition' ? [] : null;
  app.run.walker.setCargo(app.course.cargo, app.save.hat);
  app.coachSt = null;
  const touch = app.input.st.touch;
  if (app.pilot) hintOnce(app, 'walk', touch ? 'STICK · WALK TO THE GATE' : 'HOLD W · WALK TO THE GATE');
  else if (!app.watching) hintOnce(app, 'leg', touch ? 'HOLD LIFT · AIM · LET GO' : 'HOLD SPACE · AIM · LET GO');
}

function disposeRun(app) {
  if (app.run) {
    app.run.dispose();
    app.run = null;
  }
  app.workshop?.setVisible(true);
  app.net?.setHostSim(null);
  app.audio.music.stop();
  app.audio.servo(0);
  app.input.setTouch(null);
  app.hud.st.watching = false;
}

/** The match ended: results come from room state (written by the host before endMatch). */
function leaveMatch(app, prev) {
  const r = app.room?.state.results;
  app.net?.clearCheckpoint();
  disposeRun(app);
  app.finishing = false;
  app.screen = 'workshop';
  if (r && r.mid === prev?.id) takeResults(app, r);
  showWorkshop(app);
}

function takeResults(app, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.mid !== 'string' || !raw.r || typeof raw.r !== 'object') return;
  const r = raw.r;
  const clean = {
    mid: raw.mid, finished: r.finished === true, over: r.over === true, why: typeof r.why === 'string' ? r.why.slice(0, 12) : '',
    time: fin(r.time, 0, 36000), tumbles: fin(r.tumbles, 0, 999), cond: fin(r.cond, 0, 1, 1), spills: fin(r.spills, 0, 999), grooveAvg: fin(r.grooveAvg, 0, 100), grooveBest: fin(r.grooveBest, 0, 36000),
    steps: fin(r.steps, 0, 1e6), distance: fin(r.distance, 0, 1e5), progress: fin(r.progress, 0, 100), medal: ['none', 'bronze', 'silver', 'gold'].includes(r.medal) ? r.medal : 'none', score: fin(r.score, 0, 1e7), scrap: fin(r.scrap, 0, 5000),
    kind: ['expedition', 'endless', 'daily'].includes(raw.kind) ? raw.kind : 'expedition', legNames: Array.isArray(raw.legNames) ? raw.legNames.slice(0, 4).map((n) => (typeof n === 'string' ? n.slice(0, 24) : 'Bot')) : null,
    humans: fin(raw.humans, 0, 4, 1), burns: fin(raw.burns, 0, 999), mudPlants: fin(raw.mudPlants, 0, 9999), courseId: typeof raw.courseId === 'string' ? raw.courseId.slice(0, 12) : '', biome: fin(raw.biome, 0, 5),
  };
  app.results = clean;
  if (app.save.bankedMid !== clean.mid) {
    app.save.bankedMid = clean.mid;
    const courseLike = { kind: clean.kind, id: clean.courseId, biome: clean.biome };
    const earned = applyResult(app.save, courseLike, clean, { humans: clean.humans, burns: clean.burns, mudPlants: clean.mudPlants });
    touchSave(app);
    flushSave(app, true);
    for (const id of earned) sdkBadges.award(id);
    submitScores(app, clean);
    selectNext(app, clean);
  }
}

/** Host: a finished expedition moves the workshop on to the next one (the arrows go back). */
function selectNext(app, r) {
  const m = /^e([1-6])-([1-4])$/.exec(r.courseId);
  if (!m || r.kind !== 'expedition' || !r.finished || !app.net?.isHost) return;
  const setup = app.net.setup;
  const done = (Number(m[1]) - 1) * 4 + Number(m[2]) - 1;
  if (setup.mode !== 'expedition' || setup.biome * 4 + setup.index !== done) return;
  const next = done + 1;
  if (next >= 24 || unlockedCount(app.save) <= next) return;
  app.net.setSetup({ ...setup, biome: Math.floor(next / 4), index: next % 4, ghost: false });
}
const fin = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

function submitScores(app, r) {
  if (r.kind === 'endless') leaderboards.submit('endless-stride', r.distance);
  if (r.grooveBest >= 5) leaderboards.submit('groove-best', Math.round(r.grooveBest * 10) / 10);
  if (r.kind === 'expedition' && r.finished) {
    const b = r.biome;
    let total = 0;
    let all = true;
    for (let i = 0; i < 4; i++) {
      const t = app.save.best[expeditionId(b, i)];
      if (!t) all = false;
      else total += t;
    }
    if (all) leaderboards.submit(`biome-${b + 1}`, Math.round(total * 10) / 10, { lowerIsBetter: true });
  }
}

function onHostChange(app, isHost) {
  const was = app.hosting;
  app.hosting = isHost;
  if (app.screen !== 'play' || !app.run) return;
  if (isHost && !was) {
    // Promote: adopt the room's checkpoint of the walker and carry on.
    const run = app.net.run;
    app.run.hostMode = true;
    app.net.setHostSim(app.run.sim);
    if (run) app.net.adoptCheckpoint(app.run.sim, run.mid);
    app.run.view = app.run.sim.w;
    app.hud.flash('YOU ARE THE HOST', 1200);
  } else if (!isHost && was) {
    app.run.hostMode = false;
    app.net.setHostSim(null);
    app.run.view = app.view;
    app.net.net.haveA = app.net.net.haveB = false;
  }
}

/**
 * The first runs teach in context: one short line at the moment it matters (each at most three runs,
 * remembered in the save). Pilots learn to walk, to take a foot, to aim it and to pick another; leg
 * players learn to push and to step a trailing foot; everyone learns to keep the dot inside.
 */
function coach(app, w, touch, dt) {
  const c = app.coachSt ?? (app.coachSt = { t: 0, took: false, tookT: -1, plantT: -1, still: 0, trail: 0, stepped: false });
  c.t += dt;
  if (app.watching || w.tumbling > 0 || w.finished) return;
  const lift = app.input.st.lift;
  // what the player has done is tracked every frame; a hint waits for the one on screen to clear
  if (app.pilot) {
    if (lift && !c.took) {
      c.took = true;
      c.tookT = c.t;
      // the follow-up to what they just did replaces the prompt that asked for it
      hintOnce(app, 'aim', 'AIM · LET GO TO PLANT');
    }
    if (c.took && !lift && c.plantT < 0) c.plantT = c.t;
  } else if (lift) c.stepped = true;
  if (app.hud.st.hintT > 0) return;
  if (app.pilot) {
    if (c.t > 10 && !c.took) hintOnce(app, 'take', touch ? 'HOLD TAKE FOOT' : 'HOLD SPACE · TAKE A FOOT');
    if (c.plantT >= 0 && c.t - c.plantT > 4) hintOnce(app, 'cycle', touch ? 'LEG PICKS ANOTHER FOOT' : 'TAB PICKS ANOTHER FOOT');
  } else if (app.myLeg >= 0 && app.myLeg < 4) {
    const leg = w.legs[app.myLeg];
    const pushing = Math.hypot(app.input.st.x, app.input.st.y) > 0.3;
    c.still = leg.st === ST.STANCE && !pushing && !lift ? c.still + dt : 0;
    if (c.still > 5 && c.t > 6) hintOnce(app, 'push', touch ? 'STICK PUSHES THE BODY' : 'W PUSHES THE BODY');
    // your planted foot trails far behind its hip: it has no push left, step it forward
    hipWorld(w, app.myLeg, coachHip);
    const along = (leg.fx - coachHip.x) * Math.cos(w.yaw) + (leg.fz - coachHip.z) * Math.sin(w.yaw);
    c.trail = leg.st === ST.STANCE && along < -1.4 ? c.trail + dt : 0;
    if (c.trail > 1.5) hintOnce(app, 'step', touch ? 'LIFT · STEP IT FORWARD' : 'SPACE · STEP IT FORWARD');
  }
  // the dot only means something to someone stepping a foot
  const stepping = app.pilot ? c.took : c.stepped;
  if (stepping && w.margin < -0.3 && w.planted >= 2 && c.t > 4) hintOnce(app, 'dot', 'KEEP THE DOT INSIDE');
}
const coachHip = { x: 0, y: 0, z: 0 };

function hintOnce(app, key, text) {
  const n = app.save.hints[key] ?? 0;
  if (n >= 3 || app.hintShown.has(key)) return;
  app.hintShown.add(key);
  app.save.hints[key] = n + 1;
  touchSave(app);
  app.hud.hint(text, 3200);
}

/** Sim events (from the local sim or the host's batches): sound, HUD, admits, ghost recording. */
const RELAY = new Set(['plant', 'lift', 'snap', 'burn', 'fall', 'soak', 'hit', 'spring', 'pop', 'crack', 'collapse', 'geyser', 'bar', 'boulder', 'gate', 'brace', 'slosh', 'spill', 'tumble', 'respawn', 'checkpoint', 'finish', 'over', 'rockhit', 'barhit', 'boulderhit', 'reset']);

function onSimEvent(app, e) {
  const a = app.audio;
  if (app.hosting && app.net && RELAY.has(e.type) && app.relayEvents.length < 40) app.relayEvents.push(e);
  switch (e.type) {
    case 'plant': {
      const legMine = e.leg === app.myLeg;
      if (!throttle(app, 'plant', legMine ? 0 : 90)) a.plant(SURF_SOUND[e.surf] ?? 'clay', e.wet);
      if (e.surf === C.S.ICE) hintOnce(app, 'ice', 'ICE: BRACE TO GRIP');
      if (e.surf === C.S.MUD) hintOnce(app, 'mud', 'MUD SINKS · KEEP STEPPING');
      if (e.surf === C.S.CRUMBLE) hintOnce(app, 'crumble', 'CRACKED · MOVE THAT FOOT');
      break;
    }
    case 'lift':
      if (!throttle(app, 'lift', 60)) a.lift();
      break;
    case 'snap':
      a.snap();
      break;
    case 'nofoot':
      a.snap();
      app.hud.flash('NO FOOTING', 700);
      break;
    case 'burn':
      a.burn();
      app.hud.flash(e.why === 'burn' ? 'HOT FOOT' : 'HOT FOOT', 900);
      break;
    case 'fall':
      a.fall();
      app.hud.flash('FOOT LOST', 900);
      break;
    case 'soak':
      a.fall();
      app.hud.flash('SOAKED', 900);
      break;
    case 'hit':
      a.hit();
      break;
    case 'spring':
      a.spring();
      break;
    case 'pop':
      a.pop();
      break;
    case 'crack':
      a.crack();
      break;
    case 'collapse':
      a.collapse();
      break;
    case 'geyser':
      a.steam();
      break;
    case 'brace':
      a.brace(e.leg ?? 0);
      break;
    case 'slosh':
      if (!throttle(app, 'slosh', 400)) a.slosh();
      break;
    case 'spill':
      a.spill(e.mode);
      if (e.mode === 'drop' && app.course?.cargo === 'passengers') a.squeal();
      app.hud.flash(e.mode === 'crack' ? 'CRACKED' : 'SPILLED', 900);
      break;
    case 'tumble':
      a.tumble();
      app.hud.flash(e.why === 'fell' ? 'FELL IN' : 'TUMBLE', 1500);
      break;
    case 'respawn':
      a.respawn();
      break;
    case 'checkpoint':
      a.checkpoint();
      app.hud.flash('CHECKPOINT', 1200);
      if (app.hosting) admitPending(app);
      break;
    case 'finish':
      a.finish();
      app.hud.flash('MADE IT', 2000);
      break;
    case 'over':
      a.over();
      break;
    case 'rockhit':
      a.rock();
      break;
    case 'barhit':
      a.bar();
      break;
    case 'boulderhit':
      a.rock();
      break;
    case 'gate':
      a.gate();
      break;
    case 'reset':
      a.snap();
      app.hud.flash('RESET', 700);
      break;
    case 'signal':
      app.hud.bubble(e.leg ?? 0, e.kind);
      a.blip(e.leg ?? 0, e.kind);
      app.net?.sendSignal(e.kind);
      break;
    case 'cycle':
      a.tick();
      app.hud.st.mine = e.leg;
      app.myLeg = e.leg;
      break;
    default:
      break;
  }
}

function throttle(app, key, ms) {
  const t = performance.now();
  const last = app.sfxCooldown.get(key) ?? 0;
  if (t - last < ms) return true;
  app.sfxCooldown.set(key, t);
  return false;
}

/** Host: watchers who asked to join take bot legs at this checkpoint. */
function admitPending(app) {
  if (!app.hosting || !app.run) return;
  let admitted = false;
  for (const id of app.pendingJoins) {
    if (!app.room.players.get(id)) continue;
    const leg = app.net.admitPlayer(id, app.run.sim);
    if (leg >= 0) {
      admitted = true;
      app.hud.flash('A LEG JOINS', 900);
    }
  }
  app.pendingJoins.clear();
  // the host's own state writes are not echoed back: take the new owners (and the end of pilot mode) here
  if (admitted && app.net.run) applyOwners(app, app.net.run);
}

/** Host: the run is over -> results into room state, then the room goes back to the lobby. */
function finishRun(app) {
  const sim = app.run.sim;
  const w = sim.w;
  const r = scoreRun(app.course, w, !!app.net.run?.pilot);
  const run = app.net.run;
  const legNames = run.owners.map((o) => (o === 'bot' ? 'Bot' : app.room.players.get(o)?.name ?? 'Player'));
  const humans = run.pilot ? 1 : run.owners.filter((o) => o !== 'bot').length;
  const results = { mid: run.mid, r, kind: app.course.kind, legNames, humans, burns: sim.stats.burns, mudPlants: sim.stats.mudPlants, courseId: app.course.id, biome: app.course.biome };
  app.net.publishResults(results);
  if (r.finished && app.ghostRec && app.ghostRec.length >= 8 && app.course.kind === 'expedition') {
    const prev = app.save.ghosts[app.course.id];
    if (!prev || r.time < prev.t) {
      app.save.ghosts[app.course.id] = { t: r.time, f: app.ghostRec.slice(0, 4000) };
      touchSave(app);
    }
  }
  takeResults(app, results);
  app.screen = 'results';
  app.input.setTouch(null);
  app.screens.results(app.results, { isHost: true, hostName: '' });
  app.audio.music.stop();
  setTimeout(() => {
    try {
      app.room.endMatch();
    } catch {}
  }, app.test ? 1500 : 6000);
}

function startTestRun(app, params) {
  const m = /^e(\d)-(\d)$/.exec(params.get('course') ?? 'e1-1');
  const spec = m ? { kind: 'expedition', biome: Number(m[1]) - 1, index: Number(m[2]) - 1 } : { kind: params.get('course') ?? 'endless', seed: 'test', biome: 0 };
  app.course = buildCourse(spec);
  app.gfx.camera.clearViewOffset();
  app.quality = params.get('quality') ?? 'low';
  app.run = createRun({ gfx: app.gfx, course: app.course, owners: ['bot', 'bot', 'bot', 'bot'], pilot: null, botSkill: Number(params.get('skill') ?? 2), seed: 'test', look: {}, myLeg: 0, quality: app.quality, autonomous: true, onEvent: (e) => onSimEvent(app, e) });
  app.gfx.applyQuality(app.quality);
  app.workshop?.setVisible(false);
  app.run.hostMode = true;
  app.hosting = true;
  app.screen = 'play';
  app.hud.st.labels = ['Bot', 'Bot', 'Bot', 'Bot'];
  app.hud.st.mine = 0;
  app.runStartT = performance.now();
}

function info(app) {
  const w = app.run?.view ?? app.run?.sim?.w;
  return {
    screen: app.screen, hosting: app.hosting, myLeg: app.myLeg, pilot: app.pilot, watching: app.watching, quality: app.gfx.state.quality, frameMs: Math.round(app.frameMs * 10) / 10,
    x: w ? Math.round(w.x * 10) / 10 : null, t: w ? Math.round(w.t) : null, tumbles: w?.tumbles ?? null, finished: w?.finished ?? null, over: w?.over ?? null, cond: w ? Math.round(w.cargo.cond * 100) / 100 : null,
    groove: w ? Math.round(w.groove) : null, phase: app.room?.match?.phase ?? 'none', players: app.room?.players?.size ?? 1, scrap: app.save.scrap, drawCalls: app.gfx.renderer.info.render.calls, triangles: app.gfx.renderer.info.render.triangles,
  };
}

/** One frame. */
function tick(app, tMs) {
  const dtRaw = Math.min(0.25, Math.max(0, (tMs - app.lastFrame) / 1000));
  app.lastFrame = tMs;
  app.frameMs = app.frameMs * 0.9 + dtRaw * 1000 * 0.1;
  const dt = dtRaw;
  const { input, gfx, hud } = app;
  input.poll();
  if (document.hidden) return;
  if (app.screen === 'play' && app.run) {
    playFrame(app, dt);
  } else if (app.screen === 'results' && app.run) {
    // the receipt over the finished run, not over the workshop
    app.run.celebrate(dt);
    hud.clear();
    if (app.net && app.room) app.net.sendPresence({ st: 'results', leg: app.myLeg, feet: app.save.feet, s: [0, 0], l: 0, b: 0, paint: app.save.paint }, tMs);
  } else {
    app.workshop?.update(dt, gfx, app.screen);
    hud.clear();
    if (app.net && app.room) app.net.sendPresence({ st: app.screen === 'workshop' ? 'ws' : app.screen === 'results' ? 'results' : 'title', leg: app.net.seats.indexOf(app.me.id), feet: app.save.feet, s: [0, 0], l: 0, b: 0, paint: app.save.paint }, tMs);
    if (app.screen === 'workshop' && input.consumeEnter() && app.net?.isHost && app.room?.canStart) {
      try {
        app.room.startMatch();
      } catch {}
    }
  }
  gfx.governQuality(app.forceQuality ?? settings.choice(), app.frameMs);
  if (app.run && gfx.state.quality !== app.quality) {
    app.quality = gfx.state.quality;
    app.run.setQuality(app.quality);
  }
  gfx.render();
  flushSave(app, false);
}

function playFrame(app, dt) {
  const { input, hud, run, audio } = app;
  const touch = input.st.touch;
  const now = performance.now();
  // Signal wheel: hold Q (or the Signal button) to open, 1-8 or tap to send.
  if (input.consumeWheel() && app.screens.name !== 'wheel' && !app.watching) {
    app.screens.wheel((kind) => {
      app.screens.clear();
      onSimEvent(app, { type: 'signal', kind, leg: app.myLeg });
      if (app.hosting && run.sim) signalSim(run.sim, kind);
    });
  } else if (app.screens.name === 'wheel' && !input.keys.has('KeyQ') && !touch) app.screens.clear();
  if (input.consumeEscape() && app.screens.name === 'wheel') app.screens.clear();
  if (app.hosting) {
    app.hosting = app.net ? app.net.isHost : true;
    if (!app.hosting && app.net) onHostChange(app, false);
  }
  if (app.hosting) {
    const sim = run.sim;
    run.update(dt, app.watching ? null : input);
    // input-side events (signals, leg cycling, resets) go through the same handler as sim events
    for (const e of run.events.splice(0, run.events.length)) onSimEvent(app, e);
    if (app.net) {
      app.net.hostTick(sim, app.relayEvents, now);
      app.relayEvents.length = 0;
    }
    if (app.ghostRec && now - (app.ghostLastT ?? 0) > 250 && !sim.w.finished) {
      app.ghostLastT = now;
      app.ghostRec.push(Math.round(sim.w.x * 10), Math.round(sim.w.y * 10), Math.round(sim.w.z * 10), Math.round(sim.w.yaw * 100));
    }
    if ((sim.w.finished || sim.w.over) && app.room && !app.finishing) {
      app.finishing = true;
      setTimeout(() => {
        app.finishing = false;
        if (app.screen === 'play' && app.run) finishRun(app);
      }, 1200);
    }
  } else {
    const v = app.net.clientView(dt);
    if (v) run.view = v;
    if (!app.watching) {
      const edge = input.st.lift !== app.lastInput.lift || input.st.brace !== app.lastInput.brace;
      if (edge) {
        app.net.sendInputEdge(input.st.lift, input.st.brace);
        app.lastInput = { lift: input.st.lift, brace: input.st.brace };
      }
      if (input.st.signal) {
        onSimEvent(app, { type: 'signal', kind: input.st.signal, leg: app.myLeg });
        input.st.signal = null;
      }
      if (input.st.reset) {
        input.st.reset = false;
        app.net.sendReset();
      }
    }
  }
  if (app.net && app.room) {
    app.net.sendPresence({ st: app.watching ? (app.joinRequested ? 'join' : 'watch') : 'play', leg: app.myLeg, feet: app.save.feet, s: [input.st.x, input.st.y], l: input.st.lift ? 1 : 0, b: input.st.brace ? 1 : 0, paint: app.save.paint }, now);
  }
  const w = run.view;
  // Servo whir follows how fast the legs move; music follows the groove; wind bed follows gusts.
  let legSpeed = 0;
  for (const l of w.legs) if (l.st === ST.SWING) legSpeed += 1;
  audio.servo(Math.min(1, legSpeed * 0.35 + Math.hypot(w.vx, w.vz) * 0.12));
  audio.music.setGroove(w.groove);
  audio.wind(w.gust);
  if (w.cargo.tiltDeg > 8 && !throttle(app, 'rattle', 350)) audio.rattle(Math.min(1, w.cargo.tiltDeg / 25));
  coach(app, w, touch, dt);
  // Stuck hint: everything planted, no progress
  // (only while the player is trying to go somewhere: standing still on purpose is not being stuck)
  const trying = Math.hypot(input.st.x, input.st.y) > 0.3;
  if (trying && w.planted === 4 && Math.hypot(w.vx, w.vz) < 0.05 && !w.finished && w.tumbling <= 0) {
    app.stuckT += dt;
    if (app.stuckT > 6) {
      app.stuckT = 0;
      hud.hint(touch ? 'STUCK? LIFT A REAR FOOT' : 'STUCK? R RESETS THE STANCE', 3000);
    }
  } else app.stuckT = 0;
  const camIn = input.takeCamera();
  if (camIn.orbit) run.cam.orbitBy(camIn.orbit);
  if (camIn.pitch) run.cam.pitchBy(camIn.pitch);
  if (camIn.zoom) run.cam.zoomBy(camIn.zoom);
  hud.st.auto = app.hosting ? run.sim.auto : null;
  run.render(dt);
  hud.draw(w, app.course, dt, touch);
}
