// The room protocol. Room state (host-written): `setup` (the host's picks), `seats` (leg ->
// player id), `run` (the match's authoritative description, keyed by match id), `snap` (a full
// sim checkpoint every 2 s so a new host adopts the walker), `results` (keyed by match id).
// Presence: every player's stick, lift and brace at up to 20 Hz. Messages: input edges to the
// host, 20 Hz views and event batches from the host, signals from anyone. Every value that comes
// from another page is validated here before the sim sees it.
import { encodeView, decodeView, blankView, lerpView, copyView } from './codec.js';
import { snapshot, restore, setHumanInput, clearHumanInput, signalSim, requestReset } from '../sim/sim.js';
import { FEET, SIGNAL_KEYS } from '../sim/constants.js';
import { MUTATOR_IDS } from '../sim/courses.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const idOk = (v) => typeof v === 'string' && v.length > 0 && v.length < 80;

/** Validate a `setup` record from room state (the host's picks). */
export function cleanSetup(raw) {
  const s = isObj(raw) ? raw : {};
  const mode = ['expedition', 'endless', 'daily'].includes(s.mode) ? s.mode : 'expedition';
  return {
    mode,
    biome: Math.round(num(s.biome, 0, 5)),
    index: Math.round(num(s.index, 0, 3)),
    mutators: Array.isArray(s.mutators) ? [...new Set(s.mutators.filter((m) => MUTATOR_IDS.includes(m)))].slice(0, 7) : [],
    ghost: s.ghost === true,
  };
}

export function cleanSeats(raw) {
  const out = [null, null, null, null];
  if (!isObj(raw)) return out;
  const used = new Set();
  for (let i = 0; i < 4; i++) {
    const id = raw[i];
    if (idOk(id) && !used.has(id)) {
      out[i] = id;
      used.add(id);
    }
  }
  return out;
}

export function cleanRun(raw) {
  if (!isObj(raw) || !idOk(raw.mid) || !isObj(raw.spec)) return null;
  const spec = {
    kind: ['expedition', 'endless', 'daily'].includes(raw.spec.kind) ? raw.spec.kind : 'expedition',
    biome: Math.round(num(raw.spec.biome, 0, 5)),
    index: Math.round(num(raw.spec.index, 0, 3)),
    seed: typeof raw.spec.seed === 'string' ? raw.spec.seed.slice(0, 40) : String(num(raw.spec.seed, 1, 1e12, 1)),
    mutators: Array.isArray(raw.spec.mutators) ? raw.spec.mutators.filter((m) => MUTATOR_IDS.includes(m)).slice(0, 7) : [],
  };
  const cfgRaw = isObj(raw.cfg) ? raw.cfg : {};
  const cfg = {
    reach: num(cfgRaw.reach, 1.5, 5, 3.4),
    stickRange: num(cfgRaw.stickRange, 0.5, 4, 2.2),
    gain: num(cfgRaw.gain, 0.3, 3, 1),
    tipMult: num(cfgRaw.tipMult, 0.2, 3, 1),
    cargoDamp: num(cfgRaw.cargoDamp, 0.3, 10, 1),
    gripMult: num(cfgRaw.gripMult, 0.1, 2, 1),
    windMult: num(cfgRaw.windMult, 0, 4, 1),
    feet: [0, 1, 2, 3].map((i) => (Array.isArray(cfgRaw.feet) && FEET[cfgRaw.feet[i]] ? cfgRaw.feet[i] : 'std')),
    missing: [-1, 0, 1, 2, 3].includes(cfgRaw.missing) ? cfgRaw.missing : -1,
    inert: [0, 1, 2, 3].map((i) => Array.isArray(cfgRaw.inert) && cfgRaw.inert[i] === true),
    giant: cfgRaw.giant === true,
    swap: cfgRaw.swap === true,
    mechanic: Math.round(num(cfgRaw.mechanic, 0, 2)),
  };
  const owners = [0, 1, 2, 3].map((i) => (Array.isArray(raw.owners) && idOk(raw.owners[i]) ? raw.owners[i] : 'bot'));
  return { mid: raw.mid, spec, cfg, owners, pilot: idOk(raw.pilot) ? raw.pilot : null, ghost: raw.ghost === true };
}

export function cleanPresence(raw) {
  if (!isObj(raw)) return null;
  return {
    st: ['title', 'ws', 'play', 'watch', 'join', 'results'].includes(raw.st) ? raw.st : 'title',
    leg: [-1, 0, 1, 2, 3].includes(raw.leg) ? raw.leg : -1,
    feet: FEET[raw.feet] ? raw.feet : 'std',
    x: num(Array.isArray(raw.s) ? raw.s[0] : 0, -1, 1),
    y: num(Array.isArray(raw.s) ? raw.s[1] : 0, -1, 1),
    lift: raw.l === 1,
    brace: raw.b === 1,
    paint: typeof raw.paint === 'string' ? raw.paint.slice(0, 16) : 'orange',
  };
}

/**
 * Create the net layer. `app` provides: me (id), getSave(), onRunState(run), onSnap(view, t),
 * onEvents(list), onSeats(seats), onSetup(setup), onResults(results), onHost(isHost), onSignal(kind, leg).
 */
export function createNet(room, app) {
  const me = room.me.id;
  const net = {
    room,
    sim: null, // the host's sim while hosting
    hosting: false,
    viewA: blankView(),
    viewB: blankView(),
    view: blankView(),
    haveA: false,
    haveB: false,
    renderT: 0,
    lastSnapT: 0,
    lastStateT: 0,
    lastPresenceT: 0,
    pendingEvents: [],
    inputMsgT: new Map(), // player id -> wall time of their last input edge message
    liftByMsg: new Map(), // player id -> { lift, brace }
    offs: [],
    seats: cleanSeats(room.state.seats),
    setup: cleanSetup(room.state.setup),
    run: cleanRun(room.state.run),
    presence: { st: 'title', leg: -1, feet: 'std', s: [0, 0], l: 0, b: 0, paint: 'orange' },
  };

  const on = (ev, fn) => net.offs.push(room.on(ev, fn));

  on('state', (key, value) => {
    if (key === 'seats') {
      net.seats = cleanSeats(value);
      app.onSeats?.(net.seats);
    } else if (key === 'setup') {
      net.setup = cleanSetup(value);
      app.onSetup?.(net.setup);
    } else if (key === 'run') {
      net.run = cleanRun(value);
      app.onRunState?.(net.run);
    } else if (key === 'results') {
      app.onResults?.(value);
    } else if (key === 'snap') {
      app.onCheckpoint?.(value);
    }
  });
  on('message', (data, from, at, matchTime) => {
    if (!isObj(data) || typeof data.type !== 'string') return;
    const fromId = from?.id;
    if (data.type === 'snap') {
      if (fromId !== room.host || net.hosting) return;
      takeSnap(data);
      if (Array.isArray(data.e) && data.e.length <= 40) app.onEvents?.(data.e.filter((e) => isObj(e) && typeof e.type === 'string').map(cleanEvent));
    } else if (data.type === 'ev') {
      if (fromId !== room.host || net.hosting) return;
      if (Array.isArray(data.e) && data.e.length <= 40) app.onEvents?.(data.e.filter((e) => isObj(e) && typeof e.type === 'string').map(cleanEvent));
    } else if (data.type === 'in') {
      if (!net.hosting || !net.sim) return;
      const leg = legOf(fromId);
      if (leg < 0) return;
      net.liftByMsg.set(fromId, { lift: data.l === 1, brace: data.b === 1 });
      net.inputMsgT.set(fromId, performance.now());
      applyInput(fromId, leg);
    } else if (data.type === 'sig') {
      const kind = SIGNAL_KEYS.includes(data.k) ? data.k : null;
      if (!kind) return;
      const leg = legOf(fromId);
      app.onSignal?.(kind, leg, fromId);
      if (net.hosting && net.sim) signalSim(net.sim, kind);
    } else if (data.type === 'claim') {
      if (net.hosting) claim(fromId, data.leg);
    } else if (data.type === 'reset') {
      if (net.hosting && net.sim) requestReset(net.sim);
    } else if (data.type === 'joinreq') {
      if (net.hosting) app.onJoinRequest?.(fromId);
    }
  });
  on('presence', (p) => {
    if (!net.hosting || !net.sim || p.id === me) return;
    const leg = legOf(p.id);
    if (leg >= 0) applyInput(p.id, leg);
  });
  on('leave', (p) => {
    net.liftByMsg.delete(p.id);
    net.inputMsgT.delete(p.id);
    if (net.hosting) {
      const leg = legOf(p.id);
      if (leg >= 0) freeSeat(leg);
    }
    app.onLeave?.(p);
  });
  on('join', (p) => app.onJoin?.(p));
  on('host', () => app.onHost?.(room.isHost && room.connected));
  on('disconnect', () => app.onHost?.(false));
  on('reconnect', () => {
    net.seats = cleanSeats(room.state.seats);
    net.setup = cleanSetup(room.state.setup);
    net.run = cleanRun(room.state.run);
    app.onReconnect?.();
  });
  on('matchstart', (m) => app.onMatchStart?.(m));
  on('matchend', (m, prev) => app.onMatchEnd?.(m, prev));
  on('matchpause', () => app.onMatchPause?.(true));
  on('matchresume', () => app.onMatchPause?.(false));
  on('starting', () => app.onStarting?.());
  on('close', (reason) => app.onClose?.(reason));
  on('rename', () => app.onRoster?.());
  on('ready', () => app.onRoster?.());
  on('away', () => app.onRoster?.());
  on('back', () => app.onRoster?.());

  function legOf(id) {
    if (!idOk(id)) return -1;
    if (net.run) return net.run.owners.indexOf(id);
    return net.seats.indexOf(id);
  }

  /** Feed a player's latest stick/lift/brace into the host's sim. */
  function applyInput(id, leg) {
    const pl = room.players.get(id);
    const p = cleanPresence(pl?.presence);
    if (!p) return;
    const msg = net.liftByMsg.get(id);
    const fresh = msg && performance.now() - (net.inputMsgT.get(id) ?? 0) < 250;
    const lift = fresh ? msg.lift : p.lift;
    const brace = fresh ? msg.brace : p.brace;
    if (net.run?.pilot === id) setHumanInput(net.sim, 0, { x: p.x, y: p.y, lift, brace });
    else setHumanInput(net.sim, leg, { x: p.x, y: p.y, lift, brace });
  }

  function claim(id, legRaw) {
    const leg = [0, 1, 2, 3].includes(legRaw) ? legRaw : -1;
    if (leg < 0 || !idOk(id)) return;
    if (room.match.phase !== 'lobby') return; // seats are fixed while a match runs; latecomers are admitted at checkpoints
    const seats = net.seats.slice();
    if (seats[leg] && seats[leg] !== id && room.players.get(seats[leg])) return; // taken: the later claimant waits
    for (let i = 0; i < 4; i++) if (seats[i] === id) seats[i] = null;
    seats[leg] = id;
    writeSeats(seats);
  }

  function freeSeat(leg) {
    const seats = net.seats.slice();
    seats[leg] = null;
    writeSeats(seats);
    if (net.run && net.sim) {
      // a leaver's leg is planted safely and handed to a bot
      net.run.owners[leg] = 'bot';
      net.sim.owners[leg] = 'bot';
      clearHumanInput(net.sim, leg);
      room.setState('run', { ...room.state.run, owners: net.run.owners.slice() });
    }
  }

  function writeSeats(seats) {
    net.seats = seats;
    room.setState('seats', { 0: seats[0], 1: seats[1], 2: seats[2], 3: seats[3] });
    app.onSeats?.(seats);
  }

  /** Host: give everyone who is here and seatless a seat; drop seats of players who left. */
  function tidySeats() {
    const seats = net.seats.slice();
    let changed = false;
    for (let i = 0; i < 4; i++) if (seats[i] && !room.players.get(seats[i])) {
      seats[i] = null;
      changed = true;
    }
    for (const p of room.players.values()) {
      if (seats.includes(p.id)) continue;
      const free = seats.indexOf(null);
      if (free < 0) break;
      seats[free] = p.id;
      changed = true;
    }
    if (changed) writeSeats(seats);
  }

  function takeSnap(data) {
    const L = app.courseLength?.() ?? 1000;
    if (!net.haveA) {
      if (!decodeView(data, net.viewA, L)) return;
      net.haveA = true;
      copyView(net.viewA, net.view);
      net.renderT = net.viewA.t;
      return;
    }
    const target = net.haveB ? net.viewA : net.viewB;
    if (net.haveB) copyView(net.viewB, net.viewA);
    if (!decodeView(data, net.viewB, L)) {
      if (net.haveB) copyView(net.viewA, net.viewB);
      return;
    }
    net.haveB = true;
    net.lastSnapT = performance.now();
    void target;
  }

  const cleanEvent = (e) => ({ type: e.type.slice(0, 16), leg: [0, 1, 2, 3].includes(e.leg) ? e.leg : undefined, x: num(e.x, -50, 2000), y: num(e.y, -20, 60), z: num(e.z, -20, 20), surf: num(e.surf, 0, 15), wet: e.wet === true, why: typeof e.why === 'string' ? e.why.slice(0, 12) : undefined, mode: typeof e.mode === 'string' ? e.mode.slice(0, 8) : undefined, n: num(e.n, 0, 99), slab: num(e.slab, -1, 999, -1), kind: typeof e.kind === 'string' ? e.kind.slice(0, 8) : undefined, cond: num(e.cond, 0, 1, 1) });

  return {
    net,
    get seats() {
      return net.seats;
    },
    get setup() {
      return net.setup;
    },
    get run() {
      return net.run;
    },
    get hosting() {
      return net.hosting;
    },
    get isHost() {
      return room.isHost && room.connected;
    },
    legOf,
    tidySeats,
    claim: (leg) => {
      if (net.hosting) claim(me, leg);
      else room.send({ type: 'claim', leg }, { to: room.host });
    },
    setSetup(setup) {
      net.setup = cleanSetup(setup);
      room.setState('setup', net.setup);
      app.onSetup?.(net.setup);
    },
    /** Host: publish the run record for this match. */
    publishRun(run) {
      net.run = cleanRun(run);
      room.setState('run', net.run);
    },
    setHostSim(sim) {
      net.sim = sim;
      net.hosting = !!sim;
      net.haveA = net.haveB = false;
    },
    /** Host, each frame: broadcast at 20 Hz, checkpoint the sim every 2 s. */
    hostTick(sim, events, nowMs) {
      if (events.length) for (const e of events) if (net.pendingEvents.length < 40) net.pendingEvents.push(e);
      if (nowMs - net.lastSnapT >= 50) {
        net.lastSnapT = nowMs;
        const msg = encodeView(sim);
        if (net.pendingEvents.length) {
          msg.e = net.pendingEvents.slice(0, 40);
          net.pendingEvents.length = 0;
        }
        room.send(msg);
      }
      if (nowMs - net.lastStateT >= 2000) {
        net.lastStateT = nowMs;
        room.setState('snap', { mid: net.run?.mid ?? '', s: snapshot(sim) });
      }
    },
    /** A new host adopts the room's checkpoint (if it is for this match). */
    adoptCheckpoint(sim, mid) {
      const s = room.state.snap;
      if (isObj(s) && s.mid === mid && isObj(s.s)) return restore(sim, s.s);
      return false;
    },
    /** Client: the interpolated view for drawing, 100 ms behind the newest snapshot. */
    clientView(dtSeconds) {
      if (!net.haveB) return net.haveA ? net.view : null;
      const a = net.viewA;
      const b = net.viewB;
      // advance the render clock toward (newest - 0.1 s) at real speed, catching up gently
      const goal = b.t - 0.1;
      net.renderT += dtSeconds;
      if (net.renderT < goal - 0.25 || net.renderT > b.t) net.renderT = goal;
      if (net.renderT < a.t) net.renderT = a.t;
      const span = Math.max(1e-3, b.t - a.t);
      const k = (net.renderT - a.t) / span;
      return lerpView(a, b, k, net.view);
    },
    /** Everyone: my presence (stick, lift, brace, screen) at up to 20 Hz, only when it changed or 400 ms passed. */
    sendPresence(p, nowMs) {
      const cur = net.presence;
      const changed = cur.st !== p.st || cur.leg !== p.leg || cur.feet !== p.feet || cur.l !== p.l || cur.b !== p.b || Math.abs(cur.s[0] - p.s[0]) > 0.02 || Math.abs(cur.s[1] - p.s[1]) > 0.02 || cur.paint !== p.paint;
      if (!changed && nowMs - net.lastPresenceT < 400) return;
      if (nowMs - net.lastPresenceT < 45 && !(cur.st !== p.st || cur.leg !== p.leg)) return;
      net.lastPresenceT = nowMs;
      net.presence = { st: p.st, leg: p.leg, feet: p.feet, s: [Math.round(p.s[0] * 100) / 100, Math.round(p.s[1] * 100) / 100], l: p.l, b: p.b, paint: p.paint };
      room.setPresence(net.presence);
    },
    /** A client's lift/brace edge goes straight to the host. */
    sendInputEdge(lift, brace) {
      room.send({ type: 'in', l: lift ? 1 : 0, b: brace ? 1 : 0 }, { to: room.host });
    },
    sendSignal(kind) {
      room.send({ type: 'sig', k: kind });
    },
    sendReset() {
      room.send({ type: 'reset' }, { to: room.host });
    },
    sendJoinRequest() {
      room.send({ type: 'joinreq' }, { to: room.host });
    },
    /** Host: a watcher takes a bot's leg at a checkpoint. */
    admitPlayer(id, sim) {
      if (!net.run || !net.hosting) return -1;
      let leg = net.run.owners.indexOf('bot');
      if (leg < 0) return -1;
      net.run.owners[leg] = id;
      sim.owners[leg] = id;
      if (net.run.pilot) {
        // a second human ends pilot mode: the pilot takes their seat as a plain leg
        const pilotLeg = net.seats.indexOf(net.run.pilot);
        net.run.owners[pilotLeg >= 0 ? pilotLeg : 0] = net.run.pilot;
        sim.owners[pilotLeg >= 0 ? pilotLeg : 0] = net.run.pilot;
        net.run.pilot = null;
        sim.pilot = null;
        sim.taken = false;
        if (leg === (pilotLeg >= 0 ? pilotLeg : 0)) {
          leg = net.run.owners.indexOf('bot');
          if (leg < 0) return -1;
          net.run.owners[leg] = id;
          sim.owners[leg] = id;
        }
      }
      const seats = net.seats.slice();
      for (let i = 0; i < 4; i++) if (seats[i] === id) seats[i] = null;
      seats[leg] = id;
      writeSeats(seats);
      room.setState('run', { ...room.state.run, owners: net.run.owners.slice(), pilot: net.run.pilot });
      try {
        room.admit([id]);
      } catch {}
      return leg;
    },
    publishResults(results) {
      room.setState('results', results);
    },
    mirrorSlabs(events, dyn) {
      for (const e of events) {
        if (e.type === 'crack' && e.slab >= 0 && e.slab < dyn.crumble.length) dyn.crumble[e.slab] = e.t ?? net.viewB.t;
        else if (e.type === 'collapse' && e.slab >= 0 && e.slab < dyn.gone.length) {
          dyn.gone[e.slab] = net.viewB.t;
          dyn.crumble[e.slab] = -1;
        } else if (e.type === 'respawn') {
          dyn.crumble.fill(-1);
          dyn.gone.fill(-1);
        }
      }
    },
    dispose() {
      for (const off of net.offs) {
        try {
          off();
        } catch {}
      }
      net.offs = [];
    },
  };
}
