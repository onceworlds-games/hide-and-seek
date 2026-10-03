// Headless balance harness. Teams of simulated people (src/sim/humans.js: reaction times, unsteady
// aim, late releases, nobody coordinating) play every course at three skills, and the table says
// whether the numbers sit in the spec's bands. Solo is measured too: a pilot steering the bots at
// each Mechanic level. Pro bots must finish every course the generator can build.
//   npm run balance              everything (a few minutes)
//   npm run balance -- quick     fewer seeds, no studies
//   npm run balance -- e3-2      one expedition, every run listed
//   npm run balance -- solo      the Pilot table only
//   npm run balance -- feet      the feet upgrade study only
//   npm run balance -- bots      the all-bot table (the helpers in the game)
//   npm run balance -- par       gold/silver times to paste into PAR in courses.js
import { buildCourse, EXPEDITIONS, BIOMES, expeditionId } from '../src/sim/courses.js';
import { createSim, stepSim, setHumanInput, defaultCfg } from '../src/sim/sim.js';
import { scoreRun } from '../src/sim/score.js';
import { SKILLS } from '../src/sim/bots.js';
import { createHumanTeam, humanInputs, createPilot, pilotInput, HUMAN_SKILLS } from '../src/sim/humans.js';
import { makeRng } from '../src/sim/rng.js';
import { DT } from '../src/sim/constants.js';

const arg = process.argv[2] ?? '';
const quick = arg === 'quick';
const SEEDS = Number(process.env.SEEDS ?? (quick ? 4 : 12));
const MAX_T = 420;
const TICKS = Math.round(MAX_T / DT);

function finish(course, sim) {
  return { ...scoreRun(course, sim.w), burns: sim.stats.burns, t: sim.w.t };
}

/** Four people of one skill, one per leg. */
export function playTeam(course, skill, seed, cfg = defaultCfg()) {
  const sim = createSim({ course, cfg, owners: ['p0', 'p1', 'p2', 'p3'], seed: `team-${seed}` });
  const team = createHumanTeam(skill, makeRng(`team-${course.id}-${skill}-${seed}`));
  const out = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, lift: false, brace: false }));
  for (let i = 0; i < TICKS; i++) {
    humanInputs(team, sim.w, course, sim.dyn, out, DT);
    for (let k = 0; k < 4; k++) setHumanInput(sim, k, out[k]);
    stepSim(sim);
    sim.events.length = 0;
    if (sim.w.finished || sim.w.over) break;
  }
  return finish(course, sim);
}

/** Pilot mode: one person steering, the bots stepping at a Mechanic level. */
export function playSolo(course, pilotSkill, botSkill, seed, cfg = defaultCfg()) {
  const sim = createSim({ course, cfg, owners: ['bot', 'bot', 'bot', 'bot'], pilot: 'p0', botSkill, seed: `solo-${seed}` });
  const pilot = createPilot(pilotSkill, makeRng(`solo-${course.id}-${pilotSkill}-${seed}`));
  const inp = { x: 0, y: 0, lift: false, brace: false };
  for (let i = 0; i < TICKS; i++) {
    pilotInput(pilot, sim.w, course, inp, DT);
    setHumanInput(sim, 0, inp);
    stepSim(sim);
    sim.events.length = 0;
    if (sim.w.finished || sim.w.over) break;
  }
  return finish(course, sim);
}

/** Four bots walking the route by themselves (the helpers, and the validation of every course). */
export function playBots(course, skill, seed, cfg = defaultCfg()) {
  const sim = createSim({ course, cfg, owners: ['bot', 'bot', 'bot', 'bot'], botSkill: skill, seed: `bal-${seed}`, autonomous: true });
  for (let i = 0; i < TICKS; i++) {
    stepSim(sim);
    sim.events.length = 0;
    if (sim.w.finished || sim.w.over) break;
  }
  return finish(course, sim);
}

function stats(runs) {
  const fin = runs.filter((r) => r.finished);
  const avg = (arr, k) => (arr.length ? arr.reduce((a, r) => a + r[k], 0) / arr.length : 0);
  return { n: runs.length, success: fin.length / runs.length, time: avg(fin, 't'), tumbles: avg(runs, 'tumbles'), cond: avg(runs, 'cond'), progress: avg(runs, 'progress') };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(5);
const f0 = (v) => (v ? v.toFixed(0) : '-').padStart(4);
const f1 = (v) => v.toFixed(1).padStart(4);
const cell = (st) => `${pct(st.success)} ${f0(st.time)}s ${f1(st.tumbles)} ${st.cond.toFixed(2)}`;
const courseOf = (i) => buildCourse({ kind: 'expedition', biome: Math.floor(i / 4), index: i % 4 });

function table(play, labels, only, seeds = SEEDS) {
  const rows = [];
  console.log(`course  len   name                | ${labels.map((l) => `${l}: ok  time  tmb cond`.padStart(27)).join(' | ')}`);
  for (let i = 0; i < EXPEDITIONS.length; i++) {
    const id = expeditionId(Math.floor(i / 4), i % 4);
    if (only && id !== only) continue;
    const course = courseOf(i);
    const row = { id, name: EXPEDITIONS[i].name, len: course.length, cols: [] };
    for (let s = 0; s < labels.length; s++) {
      const runs = [];
      for (let k = 0; k < seeds; k++) runs.push(play(course, s, k));
      row.cols.push(stats(runs));
      if (only) for (const r of runs) console.log(`  ${labels[s]}: ${r.finished ? 'finished' : r.why} t=${r.t.toFixed(1)} tumbles=${r.tumbles} cond=${r.cond} burns=${r.burns} groove=${r.grooveAvg} progress=${r.progress}%`);
    }
    rows.push(row);
    console.log(`${id.padEnd(6)} ${String(Math.round(course.length)).padStart(4)}m  ${EXPEDITIONS[i].name.padEnd(20)}| ${row.cols.map(cell).join(' | ')}`);
  }
  return rows;
}

function checkTeams(rows) {
  const problems = [];
  const by = (id) => rows.find((r) => r.id === id);
  const [nov, avg, pro] = [0, 1, 2];
  const e1 = by('e1-1');
  const e12 = by('e3-4');
  const e24 = by('e6-4');
  if (e1 && e1.cols[nov].success < 0.9) problems.push(`e1-1 novice ${pct(e1.cols[nov].success)} < 90%`);
  if (e12 && e12.cols[avg].success < 0.7) problems.push(`e3-4 average ${pct(e12.cols[avg].success)} < 70%`);
  if (e12 && (e12.cols[nov].success < 0.25 || e12.cols[nov].success > 0.45)) problems.push(`e3-4 novice ${pct(e12.cols[nov].success)} outside 25-45%`);
  if (e24 && e24.cols[pro].success < 0.8) problems.push(`e6-4 pro ${pct(e24.cols[pro].success)} < 80%`);
  if (e24 && (e24.cols[avg].success < 0.35 || e24.cols[avg].success > 0.5)) problems.push(`e6-4 average ${pct(e24.cols[avg].success)} outside 35-50%`);
  if (e24 && e24.cols[nov].success > 0.1) problems.push(`e6-4 novice ${pct(e24.cols[nov].success)} > 10%`);
  for (const r of rows) {
    if (r.cols[pro].success < 0.8) problems.push(`${r.id} pro team ${pct(r.cols[pro].success)} < 80%`);
    const t = r.cols[avg].time;
    if (t && (t < 90 || t > 150)) problems.push(`${r.id} average time ${t.toFixed(0)} s outside 90-150`);
    const early = r.id < 'e3';
    const late = r.id >= 'e6';
    const tb = r.cols[avg].tumbles;
    if (early && tb > 2) problems.push(`${r.id} average tumbles ${tb.toFixed(1)} > 2 (early)`);
    if (late && (tb < 2 || tb > 5) && r.id !== 'e6-4') problems.push(`${r.id} average tumbles ${tb.toFixed(1)} outside 2-5 (late)`);
  }
  console.log(problems.length ? `\nOUT OF BAND:\n  ${problems.join('\n  ')}` : '\nAll team targets in band.');
}

function checkSolo(rows) {
  const problems = [];
  const e1 = rows.find((r) => r.id === 'e1-1');
  if (e1 && e1.cols[0].success < 0.9) problems.push(`solo e1-1 with the Apprentice ${pct(e1.cols[0].success)} < 90%`);
  for (const r of rows) if (r.cols[2].success < 0.6) problems.push(`solo ${r.id} with the Master ${pct(r.cols[2].success)}: a wall for a lone player`);
  console.log(problems.length ? `\nSOLO:\n  ${problems.join('\n  ')}` : '\nSolo: no walls.');
}

function feetStudy() {
  console.log('\nFeet study (average teams on expeditions 3-4 of each biome; success and time vs rubber feet):');
  console.log('  biome            base        | claws          pads           suction        springs');
  const seeds = quick ? 4 : 8;
  for (let b = 0; b < BIOMES.length; b++) {
    const courses = [buildCourse({ kind: 'expedition', biome: b, index: 2 }), buildCourse({ kind: 'expedition', biome: b, index: 3 })];
    const base = [];
    for (const course of courses) for (let k = 0; k < seeds; k++) base.push(playTeam(course, 1, k));
    const bs = stats(base);
    const cells = [];
    for (const feet of ['claws', 'pads', 'suction', 'springs']) {
      const cfg = defaultCfg();
      cfg.feet = [feet, feet, feet, feet];
      const runs = [];
      for (const course of courses) for (let k = 0; k < seeds; k++) runs.push(playTeam(course, 1, k, cfg));
      const st = stats(runs);
      const d = st.success - bs.success;
      const dt = bs.time && st.time ? st.time - bs.time : 0;
      cells.push(`${(d >= 0 ? '+' : '') + Math.round(d * 100)}pt ${(dt >= 0 ? '+' : '') + Math.round(dt)}s`.padEnd(14));
    }
    console.log(`  ${BIOMES[b].name.padEnd(16)} ${pct(bs.success)} ${f0(bs.time)}s | ${cells.join(' ')}`);
  }
}

function validate() {
  console.log('\nEvery built course with pro bots (must all finish):');
  let fails = 0;
  const N = quick ? 8 : 30;
  for (let i = 0; i < EXPEDITIONS.length; i++) {
    const r = playBots(courseOf(i), 2, 1);
    if (!r.finished) {
      fails++;
      console.log(`  ${expeditionId(Math.floor(i / 4), i % 4)} not finished: ${r.why} progress ${r.progress}%`);
    }
  }
  for (let i = 0; i < N; i++) {
    const d = buildCourse({ kind: 'daily', seed: `study-${i}`, biome: i % 6, mutators: [] });
    const r = playBots(d, 2, i);
    if (!r.finished) {
      fails++;
      console.log(`  daily study-${i} (${BIOMES[i % 6].name}) not finished: ${r.why} progress ${r.progress}% tumbles ${r.tumbles}`);
    }
  }
  const e = buildCourse({ kind: 'endless', seed: 'endless' });
  const er = playBots(e, 2, 1);
  console.log(`  endless: pro bots reach ${er.distance} m of ${Math.round(e.length)} (${er.finished ? 'finished' : er.why}), ${er.tumbles} tumbles`);
  console.log(fails ? `  ${fails} courses failed` : `  all ${EXPEDITIONS.length + N} courses finished`);
}

function parMode() {
  // Co-op: gold is a team of good players (+10%), silver an average team (+5%). Solo: gold is a steady
  // pilot with the Master's bots (+8%), silver with the Journeyman's (+8%).
  const coop = {};
  const solo = {};
  const mean = (runs) => stats(runs).time || Math.max(...runs.map((r) => r.t));
  for (let i = 0; i < EXPEDITIONS.length; i++) {
    const course = courseOf(i);
    const id = expeditionId(Math.floor(i / 4), i % 4);
    const n = Number(process.env.SEEDS ?? 16);
    const runs = (fn) => Array.from({ length: n }, (_, k) => fn(k));
    const pro = mean(runs((k) => playTeam(course, 2, k)));
    const avg = mean(runs((k) => playTeam(course, 1, k)));
    const master = mean(runs((k) => playSolo(course, 1, 2, k)));
    const journey = mean(runs((k) => playSolo(course, 1, 1, k)));
    const gold = Math.round(pro * 1.1);
    coop[id] = [gold, Math.round(Math.max(gold * 1.15, avg * 1.05))];
    const sg = Math.round(master * 1.08);
    solo[id] = [sg, Math.round(Math.max(sg * 1.15, journey * 1.08))];
  }
  const fmt = (o) => Object.entries(o).map(([k, v]) => `'${k}': [${v.join(', ')}]`).join(', ');
  console.log(`const PAR = { ${fmt(coop)} };`);
  console.log(`const PAR_SOLO = { ${fmt(solo)} };`);
}

// Run as a script (the play* functions above are also imported by experiments and tests).
if (process.argv[1]?.endsWith('balance.mjs')) {
  const t0 = Date.now();
  const TEAM_LABELS = HUMAN_SKILLS.map((s) => s.name);
  const SOLO_LABELS = ['apprentice', 'journeyman', 'master'];
  if (arg === 'par') parMode();
  else if (/^e\d-\d$/.test(arg)) {
    console.log('Teams of four people:');
    table(playTeam, TEAM_LABELS, arg);
    console.log('\nPilot mode (an average pilot, bots at each Mechanic level):');
    table((c, s, k) => playSolo(c, 1, s, k), SOLO_LABELS, arg);
  } else if (arg === 'feet') feetStudy();
  else if (arg === 'solo') checkSolo(table((c, s, k) => playSolo(c, 1, s, k), SOLO_LABELS));
  else if (arg === 'bots') table(playBots, SKILLS.map((s) => s.name));
  else {
    console.log(`Teams of four people (${SEEDS} runs each):`);
    checkTeams(table(playTeam, TEAM_LABELS));
    console.log(`\nPilot mode: one novice-to-average pilot steering, the bots at each Mechanic level (${SEEDS} runs each):`);
    checkSolo(table((c, s, k) => playSolo(c, k % 2, s, k), SOLO_LABELS));
    if (!quick) feetStudy();
    validate();
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
