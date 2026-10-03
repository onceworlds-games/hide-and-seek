// The 2D HUD on a canvas over the scene: a brass dashboard at the top right (clock, tumbles,
// cargo tilt gauge, groove needle), checkpoint pips, leg badges with owners, signal bubbles.
// Stays out of the top-left platform corner and the lower corners (touch controls).
import { settings } from '../platform.js';
import { LEG_COLORS, LEG_MARKS, LEG_NAMES, CARGO, SIGNALS, SIGNAL_KEYS } from '../sim/constants.js';
import { ST } from '../sim/walker.js';
import { fmtTime } from '../sim/score.js';

const INK = '#2a1e1a';
const CREAM = '#fff3dc';
const BRASS = '#d9a441';
const PAPER = '#fbf1dc';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  const st = { w: 1, h: 1, pr: 1, bubbles: [], flash: null, flashT: 0, hint: '', hintT: 0, labels: ['', '', '', ''], mine: -1, pilot: false, watching: false, reduced: false };

  function resize() {
    const pr = settings.pixelRatio(2);
    st.w = canvas.clientWidth || window.innerWidth;
    st.h = canvas.clientHeight || window.innerHeight;
    st.pr = pr;
    canvas.width = Math.max(1, Math.round(st.w * pr));
    canvas.height = Math.max(1, Math.round(st.h * pr));
  }
  resize();

  const drawMark = (x, y, r, mark, color) => {
    ctx.beginPath();
    if (mark === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (mark === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (mark === 'triangle') {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.85);
      ctx.lineTo(x - r, y + r * 0.85);
      ctx.closePath();
    } else {
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? r * 0.45 : r;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };

  const plate = (x, y, w, h, fill = PAPER) => {
    ctx.fillStyle = INK;
    roundRect(ctx, x + 3, y + 4, w, h, 10);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };

  return {
    st,
    resize,
    flash(text, ms = 1400) {
      st.flash = text;
      st.flashT = ms / 1000;
    },
    hint(text, ms = 2600) {
      st.hint = text;
      st.hintT = ms / 1000;
    },
    bubble(leg, kind) {
      st.bubbles.push({ leg, text: SIGNALS[SIGNAL_KEYS.indexOf(kind)] ?? kind, t: 1.6 });
      if (st.bubbles.length > 6) st.bubbles.shift();
    },
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    /** Draw for a view state `w` and the course. */
    draw(w, course, dt, touch) {
      const { pr } = st;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      ctx.clearRect(0, 0, st.w, st.h);
      const W = st.w;
      const compact = W < 560;
      ctx.font = `700 ${compact ? 13 : 15}px Rubik, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      // Dashboard at the top right
      const dw = compact ? 190 : 236;
      const dh = compact ? 64 : 76;
      const dx = W - dw - 12;
      const dy = 12;
      plate(dx, dy, dw, dh, BRASS);
      // clock
      ctx.fillStyle = INK;
      ctx.font = `${compact ? 20 : 24}px Bungee, Impact, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(fmtTime(w.t), dx + 12, dy + 22);
      ctx.font = `700 ${compact ? 11 : 12}px Rubik, system-ui, sans-serif`;
      ctx.fillStyle = INK;
      ctx.fillText(course.kind === 'endless' ? `${Math.round(w.maxX)} m` : `CP ${Math.min(w.cp, course.checkpoints.length)}/${course.checkpoints.length}`, dx + 12, dy + dh - 16);
      // tumbles
      ctx.font = `${compact ? 18 : 22}px Bungee, Impact, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`${w.tumbles}`, dx + dw - 58, dy + 22);
      ctx.font = `700 ${compact ? 10 : 11}px Rubik, system-ui, sans-serif`;
      ctx.fillText('TUMBLES', dx + dw - 58, dy + dh - 16);
      // tilt gauge: a bubble level
      const gx = dx + dw - 30;
      const gy = dy + dh / 2;
      const gr = compact ? 18 : 22;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = CREAM;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const cargo = CARGO[course.cargo] ?? CARGO.boulder;
      const limit = cargo.limit;
      const tilt = Math.min(1.2, w.cargo.tiltDeg / limit);
      ctx.beginPath();
      ctx.arc(gx, gy, gr * 0.86, 0, Math.PI * 2);
      ctx.strokeStyle = tilt > 1 ? '#c8643c' : tilt > 0.7 ? '#b0841a' : '#1f8a8a';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const lvx = gx + Math.sin(w.cargo.aR + w.roll) * gr * 2.2;
      const lvy = gy - Math.sin(w.cargo.aF + w.pitch) * gr * 2.2;
      const bxx = gx + Math.max(-gr * 0.8, Math.min(gr * 0.8, lvx - gx));
      const byy = gy + Math.max(-gr * 0.8, Math.min(gr * 0.8, lvy - gy));
      ctx.beginPath();
      ctx.arc(bxx, byy, gr * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = tilt > 1 ? '#f0702a' : tilt > 0.7 ? '#f2c53d' : '#3fcf9a';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      // cargo condition bar under the gauge
      const cw = gr * 2;
      ctx.fillStyle = INK;
      ctx.fillRect(gx - gr, dy + dh - 9, cw, 5);
      ctx.fillStyle = w.cargo.cond > 0.5 ? '#3fcf9a' : w.cargo.cond > 0.25 ? '#f2c53d' : '#f0702a';
      ctx.fillRect(gx - gr, dy + dh - 9, cw * w.cargo.cond, 5);
      // groove meter: a needle plate under the dashboard
      const mw = dw;
      const mh = 22;
      const my = dy + dh + 10;
      plate(dx, my, mw, mh);
      const inGroove = w.groove >= 60;
      ctx.fillStyle = inGroove ? '#1f8a8a' : '#d9a441';
      ctx.fillRect(dx + 6, my + 6, (mw - 12) * (w.groove / 100), mh - 12);
      ctx.fillStyle = INK;
      ctx.font = `700 10px Rubik, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(inGroove ? 'IN THE GROOVE' : 'GROOVE', dx + 10, my + mh / 2 + 1);
      if (w.grooveStreak >= 1) {
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.floor(w.grooveStreak)} s`, dx + mw - 10, my + mh / 2 + 1);
      }
      // Leg badges along the right edge (above the touch buttons' corner)
      const bx0 = W - 12 - (compact ? 38 : 44);
      const by0 = my + mh + 14;
      for (let i = 0; i < 4; i++) {
        const leg = w.legs[i];
        const y = by0 + i * (compact ? 42 : 48);
        const size = compact ? 38 : 44;
        plate(bx0, y, size, size, leg.st === ST.STUN ? '#f0702a' : leg.st === ST.SWING ? CREAM : PAPER);
        drawMark(bx0 + size / 2, y + size / 2, size * 0.28, LEG_MARKS[i], LEG_COLORS[i]);
        if (st.mine === i) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#f0702a';
          roundRect(ctx, bx0 - 3, y - 3, size + 6, size + 6, 12);
          ctx.stroke();
        }
        if (leg.sink > 0.1) {
          ctx.fillStyle = '#6b4a2e';
          ctx.fillRect(bx0 + 4, y + size - 7, (size - 8) * leg.sink, 4);
        }
        if (leg.brace > 0) {
          ctx.fillStyle = '#1f8a8a';
          ctx.fillRect(bx0 + 4, y + 3, (size - 8) * Math.min(1, leg.brace), 4);
        }
        const label = st.labels[i];
        if (label && !compact) {
          ctx.font = `700 12px Rubik, system-ui, sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillStyle = INK;
          ctx.fillText(label.slice(0, 14), bx0 - 8, y + size / 2);
        }
      }
      // Flash (checkpoint, tumble reasons) at the top centre, below the platform's notice band
      if (st.flashT > 0) {
        st.flashT -= dt;
        const a = Math.min(1, st.flashT * 3);
        ctx.globalAlpha = a;
        ctx.font = `${compact ? 26 : 38}px Bungee, Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.strokeStyle = INK;
        ctx.strokeText(st.flash, W / 2, 112);
        ctx.fillStyle = CREAM;
        ctx.fillText(st.flash, W / 2, 112);
        ctx.globalAlpha = 1;
      }
      if (st.hintT > 0) {
        st.hintT -= dt;
        ctx.font = `${compact ? 18 : 24}px Bungee, Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = INK;
        ctx.strokeText(st.hint, W / 2, st.h * 0.3);
        ctx.fillStyle = '#f2c53d';
        ctx.fillText(st.hint, W / 2, st.h * 0.3);
      }
      // Signal bubbles, stacked at the top centre under the flash
      let by = 150;
      for (let i = st.bubbles.length - 1; i >= 0; i--) {
        const b = st.bubbles[i];
        b.t -= dt;
        if (b.t <= 0) {
          st.bubbles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(1, b.t * 2);
        ctx.font = `${compact ? 16 : 20}px Bungee, Impact, sans-serif`;
        const tw = ctx.measureText(b.text).width + 46;
        plate(W / 2 - tw / 2, by, tw, 34, CREAM);
        drawMark(W / 2 - tw / 2 + 18, by + 17, 8, LEG_MARKS[b.leg] ?? 'circle', LEG_COLORS[b.leg] ?? CREAM);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.fillText(b.text, W / 2 - tw / 2 + 32, by + 18);
        ctx.globalAlpha = 1;
        by += 40;
      }
      if (st.watching) {
        ctx.font = `${compact ? 16 : 20}px Bungee, Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = INK;
        ctx.fillStyle = CREAM;
        ctx.strokeText('WATCHING', W / 2, st.h - (touch ? 150 : 60));
        ctx.fillText('WATCHING', W / 2, st.h - (touch ? 150 : 60));
      }
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export { LEG_NAMES };
