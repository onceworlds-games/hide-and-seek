import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSys } from '../game/audio.js';

/** Enough of the Web Audio API to run the synth in node: it records what was made. */
function fakeAudioContext(log) {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() { log.targets++; }, cancelScheduledValues() {} });
  const node = (kind) => ({ kind, connect() {}, start() { log[kind] = (log[kind] ?? 0) + 1; }, stop() {}, frequency: param(), gain: param(), type: '', buffer: null });
  return class {
    constructor() {
      this.currentTime = 0;
      this.state = 'suspended';
      this.sampleRate = 8000;
      this.destination = {};
    }
    resume() {
      this.state = 'running';
    }
    createGain() {
      return node('gain');
    }
    createOscillator() {
      return node('osc');
    }
    createBufferSource() {
      return node('noise');
    }
    createBiquadFilter() {
      return node('filter');
    }
    createBuffer(ch, len) {
      return { getChannelData: () => new Float32Array(len) };
    }
  };
}

test('every sound and every mood of the music plays without throwing, and does nothing before the first tap', () => {
  const log = { targets: 0 };
  const a = new AudioSys();
  // before the first tap: silent and safe
  a.setMood('menu');
  for (const name of ['squeak', 'out', 'open', 'nope', 'found', 'tag', 'tick', 'readyOrNot', 'whistle', 'point', 'pop', 'heart', 'bump', 'win', 'lose', 'badge']) a[name](1);
  a.beep(true);
  a.schedule();
  globalThis.window = { AudioContext: fakeAudioContext(log) };
  a.unlock();
  assert.ok(a.ctx);
  assert.ok(a.live, 'the context is running after the tap');
  clearInterval(a.timer);
  for (const name of ['squeak', 'out', 'open', 'nope', 'found', 'tag', 'tick', 'readyOrNot', 'whistle', 'point', 'pop', 'heart', 'bump', 'win', 'lose', 'badge']) a[name](0.5);
  a.beep(false);
  a.beep(true);
  assert.ok(log.osc > 20 && log.noise > 3, 'sounds made oscillators and noise');
  // the music: a mood set before the sound was running still takes effect
  const before = log.osc;
  for (const mood of ['menu', 'hide', 'seek', 'win', 'off', 'menu']) {
    a.setMood(mood);
    for (let i = 0; i < 80; i++) {
      a.ctx.currentTime += 0.05;
      a.schedule();
    }
    assert.equal(a.applied, mood, `the ${mood} mood was applied`);
  }
  assert.ok(log.osc > before + 50, 'the sequencer played notes');
  assert.ok(log.targets >= 6, 'the volume followed the mood');
  assert.equal(a.musicTarget, 0.2);
  // a long stall doesn't make it rush to catch up
  a.ctx.currentTime += 100;
  a.schedule();
  assert.ok(a.next >= a.ctx.currentTime);
  delete globalThis.window;
});

test('audio that cannot start never throws into the game', () => {
  const a = new AudioSys();
  globalThis.window = {};
  a.unlock();
  assert.equal(a.ctx, null);
  a.found(1);
  a.schedule();
  a.setMood('seek');
  delete globalThis.window;
});
