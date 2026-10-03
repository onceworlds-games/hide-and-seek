// Scoring, medals and scrap: numbers tuned with scripts/balance.mjs.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Summarise a run (the walker as it stands) into results everyone can show. */
export function scoreRun(course, w) {
  const time = w.finished ? w.finishT : w.t;
  const progress = clamp((w.maxX - course.startX) / (course.goalX - course.startX), 0, 1);
  const cond = clamp(w.cargo.cond, 0, 1);
  const grooveAvg = w.t > 0 ? clamp(w.grooveSum / w.t, 0, 100) : 0;
  const [gold, silver] = course.par;
  let medal = 'none';
  if (w.finished) medal = time <= gold && cond >= 0.5 ? 'gold' : time <= silver && cond >= 0.25 ? 'silver' : 'bronze';
  let score;
  if (course.kind === 'endless') score = Math.round(w.maxX);
  else if (w.finished) {
    const timeShare = clamp((silver * 1.3 - time) / (silver * 1.3 - gold * 0.8), 0, 1);
    score = Math.round((1000 + 2000 * timeShare + 1000 * cond) * (1 + grooveAvg / 200));
  } else score = Math.round(600 * progress);
  let scrap;
  if (course.kind === 'endless') scrap = Math.round(w.maxX / 6);
  else if (w.finished) scrap = 40 + Math.round(score / 60) + (medal === 'gold' ? 40 : medal === 'silver' ? 20 : 0);
  else scrap = Math.round(progress * 30);
  if (course.kind === 'daily') scrap = Math.round(scrap * 1.5);
  return {
    finished: w.finished,
    over: w.over,
    why: w.finished ? 'finish' : w.overWhy || 'quit',
    time: Math.round(time * 10) / 10,
    tumbles: w.tumbles,
    cond: Math.round(cond * 100) / 100,
    spills: w.cargo.spills,
    grooveAvg: Math.round(grooveAvg),
    grooveBest: Math.round(w.grooveBest * 10) / 10,
    steps: w.steps,
    distance: Math.round(w.maxX),
    progress: Math.round(progress * 100),
    medal,
    score,
    scrap: Math.max(0, scrap),
  };
}

export const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };
export const betterMedal = (a, b) => (MEDAL_RANK[a] ?? 0) >= (MEDAL_RANK[b] ?? 0) ? a : b;

export const fmtTime = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return '0:00.0';
  const m = Math.floor(n / 60);
  const r = n - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};
