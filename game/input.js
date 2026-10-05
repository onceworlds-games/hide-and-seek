// Keyboard and the platform's on-screen stick, combined into one move vector, plus the Space / button action.
// (The platform's touch button presses the key we give it, so Space handles both.)

const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, 'Space', 'Enter']);

export function createInput(ow, canvas) {
  const keys = new Set();
  const listeners = { action: [], tap: [], any: [] };
  let lastMove = 0; // performance.now() of the last time the player asked to move (for the hide "arm" check)

  const held = (list) => list.some((k) => keys.has(k));

  addEventListener('keydown', (e) => {
    const code = e.code;
    if (GAME_KEYS.has(code)) {
      // Keep the page from scrolling; the game uses these keys.
      if (e.preventDefault) e.preventDefault();
    }
    for (const fn of listeners.any) fn();
    if (e.repeat) return;
    keys.add(code);
    if (code === 'Space') for (const fn of listeners.action) fn('Space');
    else if (code === 'Enter') for (const fn of listeners.action) fn('Enter');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });
  canvas.addEventListener('pointerdown', (e) => {
    for (const fn of listeners.any) fn();
    for (const fn of listeners.tap) fn(e.clientX, e.clientY, e);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    /** The wanted direction, length 0 to 1, y pointing down. */
    move(out) {
      let x = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
      let y = (held(DOWN) ? 1 : 0) - (held(UP) ? 1 : 0);
      const s = ow?.controls?.stick;
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
        x += s.x;
        y += s.y;
      }
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      out.x = x;
      out.y = y;
      if (len > 0.2) lastMove = performance.now();
      return len;
    },
    onAction(fn) {
      listeners.action.push(fn);
    },
    onTap(fn) {
      listeners.tap.push(fn);
    },
    /** Any key or tap (the title screen's "skip" when a match is already running). */
    onAny(fn) {
      listeners.any.push(fn);
    },
    /** Forget every handler (a new Play after a rejoin registers its own). */
    clear() {
      listeners.action.length = 0;
      listeners.tap.length = 0;
      listeners.any.length = 0;
    },
    get lastMove() {
      return lastMove;
    },
  };
}
