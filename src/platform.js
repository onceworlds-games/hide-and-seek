// The one place that talks to the Onceworlds SDK. `window.onceworlds` is injected on the
// platform; opened on its own (npm run dev, poster mode, tests) the game gets a stand-in with
// a solo room, so the same code runs everywhere. Nothing here ever throws into the game.

function soloRoom(player) {
  const listeners = new Map();
  const me = { id: player.id, name: player.name, presence: null, team: 0, connected: true, ready: false };
  let started = 0;
  let n = 0;
  const emit = (ev, ...args) => {
    for (const fn of listeners.get(ev) ?? []) {
      try {
        fn(...args);
      } catch {}
    }
  };
  const room = {
    id: 'solo',
    kind: 'solo',
    invite: null,
    teams: 0,
    open: true,
    me,
    players: new Map([[me.id, me]]),
    state: {},
    private: {},
    host: me.id,
    connected: true,
    settings: {},
    match: { phase: 'lobby', n: 0, id: '', min: 1, participants: [], seed: 1 },
    spectating: false,
    leftOut: [],
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return room.match.phase === 'playing' ? [me] : [];
    },
    get spectators() {
      return [];
    },
    get notReady() {
      return [];
    },
    get allReady() {
      return true;
    },
    get canStart() {
      return room.match.phase === 'lobby';
    },
    get running() {
      return room.match.phase === 'playing';
    },
    isParticipant: (id) => id === me.id && room.match.phase === 'playing',
    matchNow: () => (started ? Date.now() - started : 0),
    send() {},
    setPresence(d) {
      me.presence = d;
    },
    presenceAt: (id) => (id === me.id ? me.presence : null),
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
    },
    setPrivate(k, v) {
      if (v === null || v === undefined) delete room.private[k];
      else room.private[k] = v;
    },
    setPrivateFor() {},
    privateOf: () => ({}),
    setTeam() {},
    setOpen(o) {
      room.open = !!o;
    },
    setSetting() {},
    hideLobby() {},
    setReady(ready) {
      me.ready = !!ready;
    },
    clearReady() {
      me.ready = false;
    },
    startMatch() {
      if (room.match.phase !== 'lobby') return;
      started = Date.now();
      n++;
      room.match = { phase: 'playing', n, id: `solo${n}-${Date.now().toString(36)}`, min: 1, participants: [me.id], startedAt: started, seed: Math.floor(Math.random() * 1e9) };
      emit('match', room.match);
      emit('matchstart', room.match);
    },
    endMatch() {
      if (room.match.phase !== 'playing') return;
      const prev = room.match;
      started = 0;
      me.ready = false;
      room.match = { phase: 'lobby', n, id: prev.id, min: 1, participants: [], seed: prev.seed };
      emit('match', room.match, prev);
      emit('matchend', room.match, prev);
    },
    pauseMatch() {},
    admit() {},
    kick() {},
    voteKick() {},
    transferHost() {},
    reportResult() {},
    leave() {
      room.closed = true;
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
  };
  return room;
}

function standaloneSdk() {
  const listeners = new Map();
  const key = (k) => `legwork:${k}`;
  const store = {
    get(k) {
      try {
        const v = localStorage.getItem(key(k));
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(key(k), JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem(key(k));
      } catch {}
    },
  };
  let id = store.get('guest-id');
  if (!id) {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    store.set('guest-id', id);
  }
  const player = { id, name: 'You', guest: true };
  const stick = { x: 0, y: 0 };
  const settings = {
    quality: 'high',
    scale: 1,
    choice: 'auto',
    reducedMotion: false,
    pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max),
    on: () => () => {},
  };
  return {
    mode: 'standalone',
    env: {},
    player: { get: async () => player, rename: async () => null, avatarUrl: async () => null },
    save: {
      get: async (k) => store.get(k),
      set: async (k, v) => store.set(k, v),
      delete: async (k) => store.del(k),
      list: async () => [],
    },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async () => soloRoom(player), on: () => () => {}, current: null },
    ratings: { get: async () => null, top: async () => [] },
    ui: { setMenuPosition() {}, requestFullscreen() {}, showInvite() {}, setOrientation() {} },
    controls: { set() {}, stick, pressed: () => false, touch: false },
    settings,
    now: () => Date.now(),
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    fetch: (...args) => fetch(...args),
  };
}

let sdk = null;
export function getSdk() {
  if (!sdk) sdk = (typeof window !== 'undefined' && window.onceworlds) || standaloneSdk();
  return sdk;
}

export const onPlatform = () => getSdk().mode !== 'standalone';

/** Run an SDK call that may be missing on an older platform; never throws. */
function guard(fn, fallback) {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') return v.catch(() => fallback);
    return v;
  } catch {
    return fallback;
  }
}

export const now = () => guard(() => getSdk().now(), Date.now()) || Date.now();

export const settings = {
  quality: () => guard(() => getSdk().settings?.quality, 'high') ?? 'high',
  choice: () => guard(() => getSdk().settings?.choice, 'auto') ?? 'auto',
  reducedMotion: () => guard(() => getSdk().settings?.reducedMotion, false) === true,
  pixelRatio: (max = 2) => {
    const v = guard(() => getSdk().settings?.pixelRatio(max), null);
    const pr = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : Math.min(window.devicePixelRatio || 1, max);
    return Math.max(0.5, Math.min(max, pr));
  },
  onChange: (fn) => guard(() => getSdk().settings?.on('change', fn), null),
};

export const controls = {
  set: (cfg) => guard(() => getSdk().controls?.set(cfg), null),
  stick: () => {
    const s = guard(() => getSdk().controls?.stick, null);
    return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : { x: 0, y: 0 };
  },
  pressed: (id) => guard(() => getSdk().controls?.pressed(id), false) === true,
  touch: () => guard(() => getSdk().controls?.touch, false) === true,
};

export const ui = {
  showInvite: () => guard(() => getSdk().ui?.showInvite(), null),
  setOrientation: (o) => guard(() => getSdk().ui?.setOrientation(o), null),
  requestFullscreen: () => guard(() => getSdk().ui?.requestFullscreen(), null),
  setMenuPosition: (p) => guard(() => getSdk().ui?.setMenuPosition(p), null),
};

export const player = {
  get: () => guard(() => getSdk().player.get(), Promise.resolve({ id: 'me', name: 'You', guest: true })),
  avatarUrl: (id, kind = 'head') => guard(() => getSdk().player.avatarUrl(id, kind), Promise.resolve(null)),
};

export const save = {
  get: (k) => guard(() => getSdk().save.get(k), Promise.resolve(null)),
  set: (k, v) => guard(() => getSdk().save.set(k, v), Promise.resolve(null)),
};

export const badges = {
  award: (id) => guard(() => getSdk().badges.award(id), Promise.resolve(false)),
};

export const leaderboards = {
  submit: (name, score, opts) => guard(() => getSdk().leaderboards.submit(name, score, opts), Promise.resolve(null)),
  top: (name, opts) => guard(() => getSdk().leaderboards.top(name, opts), Promise.resolve({ entries: [], me: null })),
};

export const events = {
  on: (ev, fn) => guard(() => getSdk().on(ev, fn), () => {}),
};

/** Join the room (once, as the page loads). Resolves null when the platform refuses: the game runs solo. */
export async function joinRoom(opts) {
  try {
    const room = await getSdk().rooms.join(opts);
    return room ?? null;
  } catch {
    return null;
  }
}
