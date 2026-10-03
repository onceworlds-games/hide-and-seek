// The 2D HUD on a canvas over the scene, all of it in the top right: a brass dashboard (clock,
// checkpoints, tumble pips, cargo bubble level), the groove meter, the stance gauge (the machine
// from above: its four feet, the polygon they hold up and the weight dot, with a lift light on
// your own foot) and the leg badges. Flashes and hints at the top centre, signal bubbles under them.
// Stays out of the top-left platform corner and, with touch controls on, the lower corners.
import { settings } from '../platform.js';
import { LEG_COLORS, LEG_MARKS, LEG_NAMES, CARGO, SIGNALS, SIGNAL_KEYS, COM_MARGIN, CHASSIS_L, CHASSIS_W } from '../sim/constants.js';
import { ST } from '../sim/walker.js';
import { marginWithout } from '../sim/bots.js';
import { fmtTime } from '../sim/score.js';

const INK = '#2a1e1a';
const CREAM = '#fff3dc';
const BRASS = '#d9a441';
const PAPER = '#fbf1dc';
const GOOD = '#3fcf9a';
const WARN = '#f2c53d';
const BAD = '#f0702a';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  const st = { w: 1, h: 1, pr: 1, bubbles: [], flash: null, flashT: 0, hint: '', hintT: 0, labels: ['', '', '', ''], mine: -1, pilot: false, watching: false, reduced: false, auto: null };

  function resize() {
    const pr = settings.pixelRatio(2);
    st.w = canvas.clientWidth || window.innerWidth;
    st.h = canvas.clientHeight || window.innerHeight;
    st.pr = pr;
    canvas.width = Math.max(1, Math.round(st.w * pr));
    canvas.height = Math.max(1, Math.round(st.h * pr));
  }
  resize();

  const shape = (x, y, r, mark) => {
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
  };
  const drawMark = (x, y, r, mark, color, hollow = false) => {
    shape(x, y, r, mark);
    if (hollow) {
      ctx.fillStyle = CREAM;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
      return;
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };
  const cross = (x, y, r, color) => {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineCap = 'butt';
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
  /** Display text that fits the screen: shrinks rather than running off the edges. */
  const fitFont = (text, px, maxW) => {
    let size = px;
    ctx.font = `${size}px Bungee, Impact, sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > maxW) {
      size = Math.max(11, Math.floor((px * maxW) / tw));
      ctx.font = `${size}px Bungee, Impact, sans-serif`;
    }
    return size;
  };

  /** The machine from above, forward up: feet, polygon, weight, and your foot's lift light. */
  function stanceGauge(w, x0, y0, S) {
    plate(x0, y0, S, S, PAPER);
    const cx = x0 + S / 2;
    const cy0 = y0 + S / 2 + 2;
    const k = (S - 14) / 8.4; // pixels per metre: 8.4 m across
    const cyaw = Math.cos(w.yaw);
    const syaw = Math.sin(w.yaw);
    const toX = (wx, wz) => cx + (-(wx - w.x) * syaw + (wz - w.z) * cyaw) * k;
    const toY = (wx, wz) => cy0 - ((wx - w.x) * cyaw + (wz - w.z) * syaw) * k;
    // the chassis, faint
    ctx.strokeStyle = 'rgba(42, 30, 26, 0.28)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx - (CHASSIS_W / 2) * k, cy0 - (CHASSIS_L / 2) * k, CHASSIS_W * k, CHASSIS_L * k, 4);
    ctx.stroke();
    // what holds it up: red only when it is really going over, amber near the edge of what it tolerates
    const bad = w.tip > 2;
    const good = !bad && w.margin > -0.25;
    const warn = !bad;
    const col = good ? GOOD : warn ? WARN : BAD;
    const n = w.hullN;
    if (n >= 2) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = toX(w.hull[i * 2], w.hull[i * 2 + 1]);
        const py = toY(w.hull[i * 2], w.hull[i * 2 + 1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      if (n >= 3) ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = good ? '#1f8a8a' : warn ? '#b0841a' : '#c8643c';
      ctx.stroke();
    }
    // feet: planted solid, lifted hollow with a line to where it lands, stunned crossed
    const r = Math.max(5, S * 0.07);
    for (let i = 0; i < 4; i++) {
      const leg = w.legs[i];
      if (leg.absent) continue;
      const fx = toX(leg.fx, leg.fz);
      const fy = toY(leg.fx, leg.fz);
      if (leg.st === ST.SWING) {
        const tx = toX(leg.tx, leg.tz);
        const ty = toY(leg.tx, leg.tz);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = LEG_COLORS[i];
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        if (leg.valid) {
          ctx.beginPath();
          ctx.arc(tx, ty, r * 0.6, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.stroke();
        } else cross(tx, ty, r * 0.55, '#c8643c');
        drawMark(fx, fy, r, LEG_MARKS[i], LEG_COLORS[i], true);
      } else if (leg.st === ST.STUN) {
        drawMark(fx, fy, r, LEG_MARKS[i], LEG_COLORS[i], true);
        cross(fx, fy, r * 0.8, '#c8643c');
      } else drawMark(fx, fy, r, LEG_MARKS[i], LEG_COLORS[i]);
      if (st.mine === i && !st.watching) {
        ctx.beginPath();
        ctx.arc(fx, fy, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // the lift light: would the machine stay up with this foot in the air?
        if (leg.st === ST.STANCE) {
          const safe = marginWithout(w, i) + COM_MARGIN > 0;
          ctx.beginPath();
          ctx.moveTo(fx, fy - r - 14);
          ctx.lineTo(fx + 6, fy - r - 6);
          ctx.lineTo(fx - 6, fy - r - 6);
          ctx.closePath();
          ctx.fillStyle = safe ? GOOD : BAD;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = INK;
          ctx.stroke();
        }
      }
    }
    // the weight
    if (w.tumbling <= 0) {
      const mx = Math.max(x0 + 6, Math.min(x0 + S - 6, toX(w.comX, w.comZ)));
      const my = Math.max(y0 + 6, Math.min(y0 + S - 6, toY(w.comX, w.comZ)));
      ctx.beginPath();
      ctx.arc(mx, my, good ? 5 : 6.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }

  /** One leg's badge: its mark; lifted, stunned, braced, sinking, handed to the bots. */
  function badge(w, i, x, y, size) {
    const leg = w.legs[i];
    plate(x, y, size, size, leg.st === ST.STUN ? BAD : leg.st === ST.SWING ? CREAM : PAPER);
    const lifted = leg.st === ST.SWING;
    drawMark(x + size / 2, y + size / 2 + (lifted ? -3 : 0), size * 0.27, LEG_MARKS[i], LEG_COLORS[i]);
    if (lifted) {
      // a little arrow under a lifted foot
      ctx.beginPath();
      ctx.moveTo(x + size / 2, y + size - 12);
      ctx.lineTo(x + size / 2 + 5, y + size - 6);
      ctx.lineTo(x + size / 2 - 5, y + size - 6);
      ctx.closePath();
      ctx.fillStyle = INK;
      ctx.fill();
    }
    if (st.mine === i) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = BAD;
      roundRect(ctx, x - 3, y - 3, size + 6, size + 6, 12);
      ctx.stroke();
    }
    if (leg.auto || (st.auto && st.auto[i])) {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (leg.sink > 0.1) {
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(x + 4, y + size - 7, (size - 8) * leg.sink, 4);
    }
    if (leg.brace > 0) {
      ctx.fillStyle = '#1f8a8a';
      ctx.fillRect(x + 4, y + 3, (size - 8) * Math.min(1, leg.brace), 4);
    }
  }

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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    /** Draw for a view state `w` and the course. `touch`: the platform's controls are on screen. */
    draw(w, course, dt, touch) {
      const { pr } = st;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      ctx.clearRect(0, 0, st.w, st.h);
      const W = st.w;
      const H = st.h;
      // phones and short windows: one compact block that ends well above the touch buttons
      const compact = W < 560 || H < 520 || touch;
      ctx.textBaseline = 'middle';
      // Dashboard at the top right
      const dw = compact ? 196 : 240;
      const dh = compact ? 62 : 76;
      const dx = W - dw - 12;
      const dy = 12;
      plate(dx, dy, dw, dh, BRASS);
      ctx.fillStyle = INK;
      ctx.font = `${compact ? 19 : 24}px Bungee, Impact, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(fmtTime(w.t), dx + 12, dy + (compact ? 20 : 23));
      ctx.font = `700 ${compact ? 11 : 12}px Rubik, system-ui, sans-serif`;
      ctx.fillText(course.kind === 'endless' ? `${Math.round(w.maxX)} m` : `CP ${Math.min(w.cp, course.checkpoints.length)}/${course.checkpoints.length}`, dx + 12, dy + dh - 15);
      // tumbles: pips for the course's budget, filled as they are spent (the last one ends the run)
      const budget = Math.max(1, Math.min(9, course.budget | 0 || 6));
      const pipR = compact ? 4.5 : 5.5;
      const pipGap = pipR * 2 + 4;
      const pipX0 = dx + dw - 62 - (budget - 1) * pipGap;
      for (let i = 0; i < budget; i++) {
        ctx.beginPath();
        ctx.arc(pipX0 + i * pipGap, dy + dh - 15, pipR, 0, Math.PI * 2);
        ctx.fillStyle = i < w.tumbles ? BAD : CREAM;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
      ctx.font = `700 ${compact ? 10 : 11}px Rubik, system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = INK;
      ctx.fillText('TUMBLES', dx + dw - 56, dy + (compact ? 20 : 23));
      // cargo: a bubble level and its condition
      const gx = dx + dw - 28;
      const gy = dy + dh / 2 - 3;
      const gr = compact ? 17 : 21;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = CREAM;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const cargo = CARGO[course.cargo] ?? CARGO.boulder;
      const tilt = Math.min(1.2, w.cargo.tiltDeg / cargo.limit);
      ctx.beginPath();
      ctx.arc(gx, gy, gr * 0.86, 0, Math.PI * 2);
      ctx.strokeStyle = tilt > 1 ? '#c8643c' : tilt > 0.7 ? '#b0841a' : '#1f8a8a';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const bxx = gx + Math.max(-gr * 0.8, Math.min(gr * 0.8, Math.sin(w.cargo.aR + w.roll) * gr * 2.2));
      const byy = gy + Math.max(-gr * 0.8, Math.min(gr * 0.8, -Math.sin(w.cargo.aF + w.pitch) * gr * 2.2));
      ctx.beginPath();
      ctx.arc(bxx, byy, gr * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = tilt > 1 ? BAD : tilt > 0.7 ? WARN : GOOD;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(gx - gr, dy + dh - 9, gr * 2, 5);
      ctx.fillStyle = w.cargo.cond > 0.5 ? GOOD : w.cargo.cond > 0.25 ? WARN : BAD;
      ctx.fillRect(gx - gr, dy + dh - 9, gr * 2 * w.cargo.cond, 5);
      // groove meter
      const mh = 22;
      const my = dy + dh + 10;
      plate(dx, my, dw, mh);
      const inGroove = w.groove >= 60;
      ctx.fillStyle = inGroove ? '#1f8a8a' : BRASS;
      ctx.fillRect(dx + 6, my + 6, (dw - 12) * (w.groove / 100), mh - 12);
      ctx.fillStyle = INK;
      ctx.font = `700 10px Rubik, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(inGroove ? 'IN THE GROOVE' : 'GROOVE', dx + 10, my + mh / 2 + 1);
      if (w.grooveStreak >= 1) {
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.floor(w.grooveStreak)} s`, dx + dw - 10, my + mh / 2 + 1);
      }
      // Stance gauge and leg badges under it
      const gy0 = my + mh + 12;
      if (compact) {
        // [2 x 2 badges][gauge], one row: ends near y 200, above any thumb
        const S = 88;
        stanceGauge(w, W - 12 - S, gy0, S);
        const bs = 40;
        const bx = W - 12 - S - 12 - bs * 2 - 8;
        for (let i = 0; i < 4; i++) badge(w, i, bx + (i % 2) * (bs + 8), gy0 + Math.floor(i / 2) * (bs + 8), bs);
      } else {
        const S = 112;
        stanceGauge(w, W - 12 - S, gy0, S);
        const size = 40;
        const bx0 = W - 12 - size;
        const by0 = gy0 + S + 16;
        for (let i = 0; i < 4; i++) {
          const y = by0 + i * (size + 8);
          badge(w, i, bx0, y, size);
          const label = st.labels[i];
          if (label) {
            ctx.font = `700 12px Rubik, system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillStyle = INK;
            ctx.fillText(label.slice(0, 14), bx0 - 10, y + size / 2);
          }
        }
      }
      // Flash (checkpoint, tumble reasons) at the top centre, below the platform's notice band
      const textW = W - 32;
      if (st.flashT > 0) {
        st.flashT -= dt;
        ctx.globalAlpha = Math.min(1, st.flashT * 3);
        fitFont(st.flash, compact ? 26 : 38, textW);
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
        ctx.globalAlpha = Math.min(1, st.hintT * 2);
        // under the HUD block on a phone, so it never runs into it
        const hy = compact ? Math.max(gy0 + 112, H * 0.3) : H * 0.3;
        fitFont(st.hint, compact ? 18 : 24, textW);
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = INK;
        ctx.strokeText(st.hint, W / 2, hy);
        ctx.fillStyle = WARN;
        ctx.fillText(st.hint, W / 2, hy);
        ctx.globalAlpha = 1;
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
