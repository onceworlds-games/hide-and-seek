// Synthesized sound (Web Audio, no files): a short sound for every action and a small step-sequencer for the music.
// The platform applies volume and mute to everything here. Every call is safe to make before the first tap (it does nothing).

const A4 = 440;
const hz = (semi) => A4 * Math.pow(2, (semi - 9) / 12); // semitones above C4... 0 = C4
// C major pentatonic-ish scale degrees in semitones
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const deg = (d, oct = 0) => MAJOR[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);

const BPM = 116;
const STEP = 60 / BPM / 4; // a sixteenth, in seconds

// One bar of 16 steps per pattern. Bass notes are scale degrees (null = rest), chords are degree stacks per bar.
const BASS = [0, null, null, 0, 4, null, 2, null, 5, null, null, 5, 4, null, 2, null];
const BASS2 = [3, null, null, 3, 5, null, 4, null, 0, null, null, 0, 4, null, 1, null];
const CHORDS = [[0, 2, 4], [3, 5, 7], [4, 6, 8], [0, 2, 4]];
const ARP = [7, 9, 11, 9, 7, 9, 11, 14, 12, 11, 9, 11, 7, 9, 4, 7];

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.mood = 'off'; // off, menu, hide, seek, win
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.noiseBuf = null;
    this.musicGain = null;
    this.musicTarget = 0;
    this.bar = 0;
  }

  /** Call from a tap in the game (iPhones only start sound from one). */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.master);
        const len = this.ctx.sampleRate * 0.6;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.timer) {
        this.next = this.ctx.currentTime + 0.1;
        this.timer = setInterval(() => this.schedule(), 40);
      }
    } catch {
      this.ctx = null;
    }
  }

  get live() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------ building blocks
  tone(freq, dur, type = 'sine', vol = 0.2, slideTo = 0, delay = 0, dest = null) {
    if (!this.live) return;
    try {
      const c = this.ctx;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(dest || this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch {
      // never throw into the game
    }
  }

  noise(dur, vol = 0.15, filter = 2000, delay = 0, type = 'lowpass', dest = null) {
    if (!this.live || !this.noiseBuf) return;
    try {
      const c = this.ctx;
      const t = c.currentTime + delay;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = filter;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f);
      f.connect(g);
      g.connect(dest || this.master);
      s.start(t);
      s.stop(t + dur + 0.05);
    } catch {
      // never throw into the game
    }
  }

  // ------------------------------------------------------------ sounds (v: 0..1 loudness, for far-away things)
  squeak(v = 1) {
    this.tone(900, 0.09, 'triangle', 0.16 * v, 1500);
    this.tone(1300, 0.1, 'triangle', 0.13 * v, 800, 0.08);
  }
  out(v = 1) {
    this.tone(520, 0.1, 'sine', 0.15 * v, 260);
  }
  open(v = 1) {
    this.noise(0.28, 0.12 * v, 700);
    this.tone(180, 0.3, 'sawtooth', 0.07 * v, 320);
  }
  nope(v = 1) {
    this.tone(420, 0.1, 'triangle', 0.14 * v, 380);
    this.tone(300, 0.16, 'triangle', 0.14 * v, 240, 0.1);
    this.noise(0.12, 0.05 * v, 1200, 0.02);
  }
  found(v = 1) {
    // a party horn
    this.tone(392, 0.16, 'sawtooth', 0.15 * v, 0, 0);
    this.tone(523, 0.16, 'sawtooth', 0.15 * v, 0, 0.14);
    this.tone(659, 0.34, 'sawtooth', 0.16 * v, 700, 0.28);
    this.tone(784, 0.34, 'square', 0.07 * v, 0, 0.28);
    this.noise(0.12, 0.08 * v, 3000, 0.28, 'highpass');
  }
  tag(v = 1) {
    this.tone(220, 0.12, 'square', 0.16 * v, 90);
    this.noise(0.1, 0.1 * v, 900);
  }
  tick(v = 1) {
    this.tone(1000, 0.05, 'square', 0.07 * v);
  }
  beep(high = false) {
    this.tone(high ? 880 : 520, high ? 0.45 : 0.18, 'square', high ? 0.16 : 0.12);
  }
  readyOrNot() {
    // "ready or not": a rising whoosh and a bell
    this.noise(0.45, 0.1, 500, 0, 'bandpass');
    this.tone(660, 0.5, 'sine', 0.14, 1320);
    this.tone(990, 0.6, 'triangle', 0.1, 0, 0.12);
  }
  whistle() {
    this.tone(1200, 0.12, 'sine', 0.12, 1700);
    this.tone(1700, 0.2, 'sine', 0.12, 1400, 0.12);
  }
  point() {
    this.tone(988, 0.07, 'square', 0.09);
    this.tone(1319, 0.14, 'square', 0.09, 0, 0.07);
  }
  pop() {
    this.tone(500, 0.08, 'sine', 0.14, 900);
  }
  heart(v = 1) {
    this.tone(70, 0.14, 'sine', 0.28 * v, 45);
    this.tone(60, 0.14, 'sine', 0.2 * v, 40, 0.17);
  }
  bump() {
    this.tone(160, 0.07, 'sine', 0.1, 100);
  }
  win() {
    const seq = [523, 659, 784, 1047, 784, 1047, 1319];
    seq.forEach((f, i) => {
      this.tone(f, 0.22, 'square', 0.1, 0, i * 0.11);
      this.tone(f / 2, 0.22, 'triangle', 0.12, 0, i * 0.11);
    });
    this.noise(0.4, 0.06, 4000, 0.7, 'highpass');
  }
  lose() {
    [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.12, 0, i * 0.2));
  }
  badge() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.1, 0, i * 0.07));
  }

  // ------------------------------------------------------------ music
  /** off | menu (soft) | hide (sneaky, quiet) | seek (busy) | win. */
  setMood(mood) {
    if (this.mood === mood) return;
    this.mood = mood;
    this.musicTarget = mood === 'off' ? 0 : mood === 'menu' ? 0.2 : mood === 'hide' ? 0.17 : mood === 'seek' ? 0.3 : 0.28;
    if (this.live && this.musicGain) {
      const t = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setTargetAtTime(this.musicTarget, t, 0.25);
    }
  }

  schedule() {
    if (!this.live) return;
    try {
      const c = this.ctx;
      if (this.next < c.currentTime - 0.5) this.next = c.currentTime + 0.05; // after a long stall, don't rush to catch up
      while (this.next < c.currentTime + 0.14) {
        if (this.mood !== 'off') this.play(this.step, this.next);
        this.next += STEP;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar = (this.bar + 1) % 4;
      }
    } catch {
      // keep the timer alive
    }
  }

  note(freq, t, dur, type, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hat(t, vol) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    s.start(t);
    s.stop(t + 0.07);
  }

  kick(t, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(t);
    o.stop(t + 0.2);
  }

  snare(t, vol) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    s.start(t);
    s.stop(t + 0.15);
  }

  play(step, t) {
    const mood = this.mood;
    const root = -12; // C3 as the bass root (semitones from C4)
    const bassLine = this.bar % 2 === 0 ? BASS : BASS2;
    const b = bassLine[step];
    if (b !== null) {
      const sneaky = mood === 'hide';
      this.note(hz(root + deg(b)), t, sneaky ? 0.12 : 0.2, sneaky ? 'triangle' : 'triangle', sneaky ? 0.5 : 0.6);
    }
    if (mood === 'menu' || mood === 'win') {
      if (step % 8 === 0) {
        const chord = CHORDS[this.bar];
        for (const d of chord) this.note(hz(deg(d)), t, STEP * 7, 'sine', 0.16);
      }
    }
    if (mood === 'hide') {
      if (step % 4 === 2) this.hat(t, 0.1);
      if (step === 0 || step === 10) this.note(hz(deg(7)), t, 0.08, 'square', 0.07); // tiptoe plinks
    }
    if (mood === 'seek' || mood === 'win') {
      if (step % 4 === 0) this.kick(t, 0.5);
      if (step === 4 || step === 12) this.snare(t, 0.22);
      if (step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.16 : 0.09);
      const a = ARP[step];
      if (a !== null && a !== undefined && (this.bar % 2 === 1 || mood === 'win')) this.note(hz(a), t, 0.1, 'square', 0.09);
      if (step % 8 === 0) {
        const chord = CHORDS[this.bar];
        for (const d of chord) this.note(hz(deg(d)), t, STEP * 3, 'triangle', 0.1);
      }
    }
  }
}
