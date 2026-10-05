// Juice: particles (dust, sparks, confetti), floating text, camera trauma and eased tweens. World units for positions.
// No window or document needed; the drawing is done by whoever calls `draw`.

export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
  },
};
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A pop: 0 -> 1 with an overshoot (scale 1.3 -> 1 feel) over `dur` seconds after `age` 0. */
export const pop = (age, dur = 0.35) => (age <= 0 ? 0 : age >= dur ? 1 : ease.outBack(age / dur));

const MAX = 360;
const MAX_FLOATS = 24;

export class Fx {
  constructor() {
    this.n = 0;
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.rot = new Float32Array(MAX);
    this.vr = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX); // 0 dot, 1 confetti, 2 ring, 3 dust
    this.col = new Array(MAX).fill('#fff');
    this.floats = [];
    this.trauma = 0;
    this.freeze = 0;
    this.flash = 0;
    this.rand = Math.random; // posters swap in a seeded one so the picture is the same every time
    this.reduced = false;
    this.quality = 1; // share of the particles to make (low 0.4, medium 0.7, high 1)
  }

  setQuality(q) {
    this.quality = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
  }

  clear() {
    this.n = 0;
    this.floats.length = 0;
    this.trauma = 0;
    this.freeze = 0;
    this.flash = 0;
  }

  add(kind, x, y, vx, vy, life, size, col, grav = 0, rot = 0, vr = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.col[i] = col;
    this.grav[i] = grav;
    this.rot[i] = rot;
    this.vr[i] = vr;
  }

  count(n) {
    const k = this.quality * (this.reduced ? 0.5 : 1);
    return Math.max(1, Math.round(n * k));
  }

  /** A little cloud of dust where a foot came down. */
  dust(x, y, dirX = 0, dirY = 0) {
    const n = this.count(2);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.add(3, x + Math.cos(a) * 0.1, y + 0.25 + Math.sin(a) * 0.05, -dirX * 0.4 + Math.cos(a) * 0.4, -dirY * 0.4 - 0.3 + Math.sin(a) * 0.2, 0.35 + this.rand() * 0.15, 0.12 + this.rand() * 0.08, 'rgba(255,240,215,0.7)', 0);
    }
  }

  /** A bigger puff (an empty spot, a landing). */
  puff(x, y, n = 8) {
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + this.rand() * 0.4;
      const s = 0.8 + this.rand() * 1.2;
      this.add(3, x, y, Math.cos(a) * s, Math.sin(a) * s * 0.7 - 0.2, 0.5 + this.rand() * 0.25, 0.2 + this.rand() * 0.15, 'rgba(255,244,225,0.8)', 0);
    }
  }

  sparks(x, y, col = '#ffe066', n = 10, speed = 3.5) {
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + this.rand() * 0.5;
      const s = speed * (0.5 + this.rand() * 0.7) * (this.reduced ? 0.6 : 1);
      this.add(0, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + this.rand() * 0.25, 0.07 + this.rand() * 0.05, col, 6);
    }
  }

  ring(x, y, col = '#fff', size = 0.9, life = 0.4) {
    this.add(2, x, y, 0, 0, life, size, col);
  }

  confetti(x, y, n = 40, spread = 6, up = 7) {
    const colors = ['#ff5d8f', '#ffd23f', '#3d8bff', '#38c96b', '#a45cff', '#ff8a1f', '#14c7c0'];
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = -Math.PI / 2 + (this.rand() - 0.5) * 2.2;
      const s = (up * (0.4 + this.rand() * 0.8)) * (this.reduced ? 0.6 : 1);
      this.add(1, x + (this.rand() - 0.5) * spread * 0.3, y, Math.cos(a) * s * (spread / 6), Math.sin(a) * s, 1.6 + this.rand() * 1.2, 0.12 + this.rand() * 0.1, colors[i % colors.length], 7, this.rand() * 6, (this.rand() - 0.5) * 12);
    }
  }

  /** Floating text in world units ("+3", "FOUND!"). */
  text(x, y, text, col = '#fff', size = 22, dur = 1.1) {
    if (this.floats.length >= MAX_FLOATS) this.floats.shift();
    this.floats.push({ x, y, text, col, size, t: 0, dur });
  }

  addTrauma(v) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** A short freeze of the game (seconds) for the biggest moments. */
  hit(seconds = 0.07) {
    if (this.reduced) return;
    this.freeze = Math.max(this.freeze, seconds);
  }

  /** Smooth sine offsets in pixels (never fresh random jitter): shake = trauma squared. */
  shake(t, maxPx = 14) {
    const s = this.trauma * this.trauma * maxPx;
    return { x: Math.sin(t * 47.3) * s, y: Math.sin(t * 53.9 + 1.3) * s };
  }

  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 3);
    for (let i = 0; i < this.n; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          this.x[i] = this.x[j];
          this.y[i] = this.y[j];
          this.vx[i] = this.vx[j];
          this.vy[i] = this.vy[j];
          this.life[i] = this.life[j];
          this.max[i] = this.max[j];
          this.size[i] = this.size[j];
          this.rot[i] = this.rot[j];
          this.vr[i] = this.vr[j];
          this.grav[i] = this.grav[j];
          this.kind[i] = this.kind[j];
          this.col[i] = this.col[j];
        }
        continue;
      }
      this.vy[i] += this.grav[i] * dt;
      if (this.kind[i] === 1) {
        this.vx[i] *= 1 - dt * 1.2;
        this.vy[i] = Math.min(this.vy[i], 3.2);
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      i++;
    }
    for (let k = this.floats.length - 1; k >= 0; k--) {
      const f = this.floats[k];
      f.t += dt;
      if (f.t >= f.dur) this.floats.splice(k, 1);
    }
  }

  /** Draws the particles in world space (the context must already have the world transform). */
  draw(ctx) {
    for (let i = 0; i < this.n; i++) {
      const p = this.life[i] / this.max[i];
      const k = this.kind[i];
      ctx.globalAlpha = k === 1 ? Math.min(1, p * 2) : p;
      ctx.fillStyle = this.col[i];
      if (k === 2) {
        ctx.globalAlpha = p * 0.8;
        ctx.strokeStyle = this.col[i];
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.size[i] * (1 - p) + 0.1, 0, 6.283);
        ctx.stroke();
      } else if (k === 1) {
        ctx.save();
        ctx.translate(this.x[i], this.y[i]);
        ctx.rotate(this.rot[i]);
        ctx.fillRect(-this.size[i], -this.size[i] * 0.5, this.size[i] * 2, this.size[i]);
        ctx.restore();
      } else if (k === 3) {
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.size[i] * (1.6 - p * 0.6), 0, 6.283);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.size[i], 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
