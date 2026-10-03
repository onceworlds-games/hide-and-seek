// Procedural sound: mechanical foley with character (servo whirs, a plant sound per surface,
// steam, wind-up ticks, cargo rattles, a blip per leg colour) and a jaunty marimba waltz whose
// tempo and swing follow the groove meter. Everything goes through a compressor as a limiter;
// the platform owns volume and mute. The context starts on the first gesture in the game.

const LEG_PITCH = [392, 494, 587, 740]; // G4 B4 D5 F#5: one blip per leg colour
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // pentatonic-ish, cheerful

export function createAudio() {
  let ctx = null;
  let master = null;
  let steps = null; // footsteps: the most frequent sound, kept under the music
  let limiter = null;
  let music = null;
  let servo = null;
  let unlocked = false;
  let lastPlant = { kind: '', t: 0, var: 0 };
  let reduced = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 14;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(limiter);
      steps = ctx.createGain();
      steps.gain.value = 0.5;
      steps.connect(master);
      limiter.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    unlocked = true;
    if (!servo) servo = makeServo();
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  function osc(type, freq, t0, dur, gain, dest = master, slideTo = null) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  let noiseBuf = null;
  function noise(t0, dur, gain, filterHz, q = 1, type = 'bandpass', dest = master) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterHz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
    return f;
  }

  /** A little pitch variation so no two plants sound alike, never the same twice in a row. */
  function vary(kind) {
    let v = Math.random() * 0.16 - 0.08;
    if (lastPlant.kind === kind && Math.abs(v - lastPlant.var) < 0.03) v += v > 0 ? -0.06 : 0.06;
    lastPlant = { kind, t: now(), var: v };
    return 1 + v;
  }

  const sfx = {
    plant(surface, wet) {
      const t = now();
      const v = vary(surface);
      if (wet || surface === 'shore') {
        noise(t, 0.25, 0.25, 1800 * v, 0.8, 'bandpass', steps);
        osc('sine', 300 * v, t, 0.12, 0.2, steps, 120);
        return;
      }
      switch (surface) {
        case 'ice':
          osc('sine', 1900 * v, t, 0.09, 0.14, steps, 2600 * v);
          osc('triangle', 3200 * v, t + 0.03, 0.12, 0.08, steps);
          noise(t, 0.08, 0.12, 5000, 2, 'highpass', steps);
          break;
        case 'mud':
          noise(t, 0.28, 0.35, 420 * v, 1.2, 'lowpass', steps);
          osc('sine', 160 * v, t, 0.2, 0.3, steps, 70);
          break;
        case 'metal':
        case 'grate':
        case 'platform':
        case 'conveyor':
          osc('triangle', 820 * v, t, 0.35, 0.2, steps, 780 * v);
          osc('sine', 1230 * v, t, 0.25, 0.1, steps);
          noise(t, 0.05, 0.2, 3000, 1, 'bandpass', steps);
          break;
        case 'stone':
        case 'crumble':
          osc('sine', 140 * v, t, 0.14, 0.4, steps, 60);
          noise(t, 0.12, 0.2, 900, 1, 'bandpass', steps);
          break;
        case 'spring':
          osc('sine', 300 * v, t, 0.25, 0.3, steps, 900 * v);
          break;
        default:
          osc('sine', 120 * v, t, 0.16, 0.45, steps, 55);
          noise(t, 0.1, 0.18, 700, 0.8, 'lowpass', steps);
      }
    },
    lift() {
      const t = now();
      noise(t, 0.09, 0.08, 2400, 1.5);
      osc('sawtooth', 260 * vary('lift'), t, 0.1, 0.03, master, 420);
    },
    snap() {
      const t = now();
      osc('square', 900, t, 0.06, 0.12, master, 300);
      noise(t, 0.05, 0.12, 4000, 1);
    },
    burn() {
      const t = now();
      noise(t, 0.6, 0.35, 1200, 0.6);
      osc('sawtooth', 220, t, 0.5, 0.12, master, 60);
      osc('sine', 1600, t, 0.08, 0.15, master, 2400);
    },
    fall() {
      const t = now();
      osc('sine', 500, t, 0.5, 0.2, master, 90);
    },
    hit() {
      const t = now();
      osc('sine', 90, t, 0.3, 0.36, master, 40);
      noise(t, 0.2, 0.22, 500, 1, 'lowpass');
    },
    spring() {
      const t = now();
      osc('sine', 220 * vary('spring'), t, 0.4, 0.3, master, 1100);
      osc('triangle', 440, t + 0.05, 0.3, 0.12, master, 1800);
    },
    pop() {
      const t = now();
      noise(t, 0.2, 0.3, 600, 1.5, 'lowpass');
      osc('sine', 400, t, 0.12, 0.25, master, 160);
    },
    crack() {
      const t = now();
      noise(t, 0.15, 0.18, 2200, 1.4);
      osc('square', 180, t, 0.05, 0.08, master, 120);
    },
    collapse() {
      const t = now();
      noise(t, 0.5, 0.3, 300, 1, 'lowpass');
      osc('sine', 120, t, 0.5, 0.3, master, 40);
    },
    steam() {
      const t = now();
      noise(t, 0.5, 0.2, 3500, 0.5, 'highpass');
    },
    slosh() {
      const t = now();
      noise(t, 0.22, 0.14, 900, 1.5, 'lowpass');
      osc('sine', 420 * vary('slosh'), t, 0.15, 0.1, master, 300);
    },
    spill(mode) {
      const t = now();
      if (mode === 'crack') {
        osc('square', 1400, t, 0.06, 0.15, master, 900);
        noise(t, 0.2, 0.25, 2800, 1.2);
      } else if (mode === 'drop') {
        osc('sine', 700, t, 0.3, 0.25, master, 200);
        osc('sine', 1050, t + 0.08, 0.25, 0.15, master, 260);
      } else sfx.slosh();
    },
    squeal() {
      const t = now();
      osc('sawtooth', 900, t, 0.25, 0.06, master, 1300);
    },
    rattle(level) {
      const t = now();
      noise(t, 0.08, 0.05 + level * 0.12, 2500, 2);
    },
    brace(leg) {
      const t = now();
      osc('square', LEG_PITCH[leg] / 2, t, 0.12, 0.1, master, LEG_PITCH[leg] / 2.5);
      noise(t, 0.1, 0.1, 1500, 2);
    },
    blip(leg, kind) {
      const t = now();
      const f = LEG_PITCH[Math.max(0, Math.min(3, leg))];
      const up = kind === 'go' || kind === 'nice' || kind === 'lift';
      osc('square', f, t, 0.08, 0.12, master, up ? f * 1.5 : f * 0.75);
      osc('square', up ? f * 1.5 : f * 0.75, t + 0.09, 0.1, 0.1);
    },
    tick() {
      const t = now();
      osc('square', 2200, t, 0.015, 0.05);
    },
    tumble() {
      const t = now();
      noise(t, 0.8, 0.4, 500, 0.8, 'lowpass');
      osc('sawtooth', 150, t, 0.7, 0.2, master, 40);
      for (let k = 0; k < 4; k++) osc('triangle', 900 - k * 200, t + 0.12 + k * 0.12, 0.1, 0.1);
    },
    respawn() {
      const t = now();
      [0, 4, 7, 12].forEach((s, k) => osc('sine', 440 * Math.pow(2, s / 12), t + k * 0.07, 0.25, 0.14));
    },
    checkpoint() {
      const t = now();
      [0, 4, 7].forEach((s, k) => osc('triangle', 523 * Math.pow(2, s / 12), t + k * 0.09, 0.3, 0.16));
      noise(t, 0.3, 0.12, 2600, 1);
    },
    finish() {
      const t = now();
      [0, 4, 7, 12, 16, 19, 24].forEach((s, k) => osc('triangle', 392 * Math.pow(2, s / 12), t + k * 0.08, 0.5, 0.16));
      noise(t + 0.5, 0.6, 0.15, 3000, 1);
    },
    over() {
      const t = now();
      [12, 7, 3, 0].forEach((s, k) => osc('sawtooth', 220 * Math.pow(2, s / 12), t + k * 0.18, 0.35, 0.1));
    },
    rock() {
      const t = now();
      osc('sine', 70, t, 0.4, 0.42, master, 35);
      noise(t, 0.3, 0.25, 400, 1, 'lowpass');
    },
    bar() {
      const t = now();
      osc('triangle', 300, t, 0.2, 0.2, master, 120);
      noise(t, 0.1, 0.2, 1800, 1.5);
    },
    gate() {
      const t = now();
      osc('square', 520, t, 0.15, 0.12, master, 380);
      osc('sine', 110, t + 0.1, 0.3, 0.3, master, 50);
    },
    horn(kind) {
      const t = now();
      if (kind === 'toot') osc('square', 660, t, 0.25, 0.14, master, 640);
      else if (kind === 'whistle') {
        osc('sine', 1500, t, 0.5, 0.14, master, 2200);
        noise(t, 0.5, 0.15, 3000, 2);
      } else if (kind === 'bell') {
        osc('sine', 2093, t, 0.4, 0.14, master, 2080);
        osc('sine', 2637, t + 0.1, 0.4, 0.1);
      } else {
        osc('sawtooth', 220, t, 0.3, 0.12, master, 200);
        osc('sawtooth', 277, t, 0.3, 0.08, master, 260);
      }
    },
    click() {
      const t = now();
      osc('square', 1800, t, 0.03, 0.08, master, 1200);
    },
    wind(level) {
      if (servo) servo.wind(level);
    },
  };

  /** Servo whir: a sawtooth through a filter whose pitch follows leg speed, plus a wind bed. */
  function makeServo() {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 80;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start();
    const windSrc = noise(now(), 1e6, 0.0001, 600, 0.4, 'bandpass');
    return {
      set(level) {
        const l = Math.max(0, Math.min(1, level));
        g.gain.setTargetAtTime(l * 0.05, ctx.currentTime, 0.05);
        o.frequency.setTargetAtTime(70 + l * 260, ctx.currentTime, 0.08);
      },
      wind(level) {
        const l = Math.max(0, Math.min(1, level));
        windSrc.frequency.setTargetAtTime(400 + l * 900, ctx.currentTime, 0.3);
      },
    };
  }

  /** The waltz: marimba (sine with quick partials) and a kazoo-ish lead (sawtooth through a formant), in 3/4. */
  function makeMusic() {
    const bus = ctx.createGain();
    bus.gain.value = 0.0;
    bus.connect(master);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 900;
    formant.Q.value = 3;
    formant.connect(bus);
    const state = { groove: 0, playing: false, beat: 0, nextT: 0, root: 0, bar: 0, kazoo: false };
    const marimba = (freq, t, dur, gain) => {
      osc('sine', freq, t, dur, gain, bus);
      osc('sine', freq * 4, t, dur * 0.25, gain * 0.25, bus);
      osc('triangle', freq * 2.01, t, dur * 0.5, gain * 0.12, bus);
    };
    const kazoo = (freq, t, dur, gain) => osc('sawtooth', freq, t, dur, gain, formant, freq * 1.01);
    const schedule = () => {
      if (!state.playing || !ctx) return;
      const t = ctx.currentTime;
      const tempo = 108 + state.groove * 0.5; // 108..158 bpm
      const beatLen = 60 / tempo;
      while (state.nextT < t + 0.3) {
        const beat = state.beat % 3;
        const swing = (state.groove / 100) * 0.08 * beatLen;
        const tt = state.nextT + (beat === 1 ? swing : 0);
        const base = 196 * Math.pow(2, ([0, 0, 5, 7][state.bar % 4]) / 12);
        if (beat === 0) marimba(base / 2, tt, 0.5, 0.22);
        else marimba(base * Math.pow(2, SCALE[(state.bar + beat) % 5] / 12), tt, 0.3, 0.12);
        if (state.groove > 55 && beat !== 0) marimba(base * Math.pow(2, SCALE[(state.bar * 2 + beat + 3) % 8] / 12), tt + beatLen * 0.5, 0.2, 0.08);
        if (state.groove > 75 && beat === 0 && state.bar % 2 === 0) kazoo(base * 2 * Math.pow(2, SCALE[(state.bar / 2) % 8] / 12), tt, beatLen * 1.5, 0.06);
        state.beat++;
        if (state.beat % 3 === 0) state.bar++;
        state.nextT += beatLen;
      }
    };
    let timer = null;
    return {
      state,
      start() {
        if (state.playing) return;
        state.playing = true;
        state.nextT = ctx.currentTime + 0.1;
        bus.gain.setTargetAtTime(0.7, ctx.currentTime, 0.5);
        timer = setInterval(schedule, 100);
      },
      stop() {
        state.playing = false;
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        if (timer) clearInterval(timer);
        timer = null;
      },
      setGroove(g) {
        state.groove = Math.max(0, Math.min(100, g));
      },
      setLevel(l) {
        if (state.playing) bus.gain.setTargetAtTime(0.7 * l, ctx.currentTime, 0.4);
      },
    };
  }

  const guard = (fn) => (...args) => {
    if (!ctx || !unlocked) return;
    try {
      fn(...args);
    } catch {}
  };
  const api = {};
  for (const [k, fn] of Object.entries(sfx)) api[k] = guard(fn);
  return {
    ...api,
    unlock,
    get ready() {
      return !!ctx && unlocked;
    },
    setReduced(v) {
      reduced = !!v;
    },
    servo(level) {
      if (ctx && servo && unlocked) servo.set(reduced ? level * 0.5 : level);
    },
    music: {
      start() {
        if (!ctx || !unlocked) return;
        if (!music) music = makeMusic();
        music.start();
      },
      stop() {
        music?.stop();
      },
      setGroove(g) {
        music?.setGroove(g);
      },
      setLevel(l) {
        music?.setLevel(l);
      },
    },
  };
}
