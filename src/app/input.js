// Keyboard, platform touch controls, gamepad and camera gestures, folded into one input
// state the run reads every tick. Every key is cleared on blur and when the tab hides.
import { controls } from '../platform.js';
import { SIGNAL_KEYS } from '../sim/constants.js';

export function createInput(canvas) {
  const keys = new Set();
  const edges = [];
  const st = {
    x: 0,
    y: 0,
    lift: false,
    brace: false,
    cycle: false,
    reset: false,
    wheel: false,
    signal: null,
    orbit: 0,
    pitch: 0,
    zoom: 0,
    anyKey: false,
    touch: false,
    lastGesture: 0,
  };
  let drag = null;
  let pinch = null;
  let gamepadWarned = false;
  let touchCfg = null;

  const code = (e) => e.code || e.key;
  const onKey = (e, down) => {
    const c = code(e);
    if (c === 'Tab' || c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
    if (down) {
      if (!keys.has(c)) {
        keys.add(c);
        edges.push(c);
      }
      st.anyKey = true;
      st.lastGesture = performance.now();
    } else keys.delete(c);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  const clear = () => {
    keys.clear();
    drag = null;
    pinch = null;
  };
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });

  // Camera gestures: drag with the mouse or one finger on the world, two fingers to orbit on touch.
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    st.lastGesture = performance.now();
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2 };
      drag = null;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      st.zoom += (pinch.d - d) * 0.004;
      st.orbit += (cx - pinch.x) * 0.006;
      pinch.d = d;
      pinch.x = cx;
    } else if (drag && drag.id === e.pointerId && (e.pointerType !== 'touch' || !touchCfg)) {
      st.orbit += (e.clientX - drag.x) * 0.006;
      st.pitch += (e.clientY - drag.y) * 0.003;
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (drag && drag.id === e.pointerId) drag = null;
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);
  canvas.addEventListener('wheel', (e) => {
    st.zoom += Math.sign(e.deltaY) * 0.08;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function gamepad() {
    try {
      if (!navigator.getGamepads) return null;
      const pads = navigator.getGamepads();
      for (const p of pads) if (p && p.connected) return p;
    } catch {
      if (!gamepadWarned) gamepadWarned = true;
      return null;
    }
    return null;
  }

  return {
    st,
    keys,
    /** Poll everything into `st`. Call once per frame. */
    poll() {
      const k = keys;
      let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      let lift = k.has('Space');
      let brace = k.has('ShiftLeft') || k.has('ShiftRight');
      st.touch = controls.touch();
      if (st.touch) {
        const s = controls.stick();
        if (Math.abs(s.x) > 0.08 || Math.abs(s.y) > 0.08) {
          x = s.x;
          y = -s.y;
        }
        lift = lift || controls.pressed('lift');
        brace = brace || controls.pressed('brace');
        if (controls.pressed('signal')) st.wheel = true;
      }
      const pad = gamepad();
      if (pad) {
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
          x = ax;
          y = -ay;
        }
        lift = lift || !!pad.buttons[0]?.pressed;
        brace = brace || !!pad.buttons[1]?.pressed;
        if (pad.buttons[3]?.pressed) st.wheel = true;
      }
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      st.x = x;
      st.y = y;
      st.lift = lift;
      st.brace = brace;
      st.cycle = false;
      st.reset = false;
      st.signal = null;
      for (const c of edges) {
        if (c === 'Tab' || c === 'KeyE') st.cycle = true;
        else if (c === 'KeyR') st.reset = true;
        else if (c === 'Enter') st.enter = true;
        else if (c === 'Escape') st.escape = true;
        else if (/^Digit[1-8]$/.test(c)) st.signal = SIGNAL_KEYS[Number(c.slice(5)) - 1];
      }
      edges.length = 0;
      st.wheel = st.wheel || k.has('KeyQ');
      if (k.has('BracketLeft')) st.orbit -= 0.04;
      if (k.has('BracketRight')) st.orbit += 0.04;
    },
    /** Consume the camera deltas accumulated since the last call. */
    takeCamera() {
      const o = { orbit: st.orbit, pitch: st.pitch, zoom: st.zoom };
      st.orbit = st.pitch = st.zoom = 0;
      return o;
    },
    consumeWheel() {
      const w = st.wheel;
      st.wheel = false;
      return w;
    },
    consumeEnter() {
      const v = !!st.enter;
      st.enter = false;
      return v;
    },
    consumeEscape() {
      const v = !!st.escape;
      st.escape = false;
      return v;
    },
    /** The platform's on-screen stick and verb buttons while playing. */
    setTouch(mode) {
      if (mode === touchCfg) return;
      touchCfg = mode;
      if (!mode) {
        controls.set(null);
        return;
      }
      const buttons = [
        { id: 'lift', label: mode === 'pilot' ? 'Take foot' : 'Lift', key: ' ' },
        { id: 'brace', label: 'Brace', key: 'Shift' },
        { id: 'signal', label: 'Signal', key: 'q' },
      ];
      if (mode === 'pilot') buttons.push({ id: 'leg', label: 'Leg', key: 'Tab' });
      controls.set({ stick: 'analog', buttons });
    },
    clear,
  };
}
