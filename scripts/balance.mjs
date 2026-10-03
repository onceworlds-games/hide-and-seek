// Headless balance harness: bot teams of three skills play every course and the table
// says whether the numbers sit in the target bands.
//   npm run balance            every expedition, 4 seeds per skill (a few minutes)
//   npm run balance -- quick   2 seeds, no feet study
//   npm run balance -- feet    the feet upgrade study only
//   npm run balance -- e3-2    one expedition, verbose
import { buildCourse, EXPEDITIONS, BIOMES, expeditionId } from '../src/sim/courses.js';
import { createSim, stepSim } from '../src/sim/sim.js';
import { defaultCfg } from '../src/sim/sim.js';
import { scoreRun } from '../src/sim/score.js';
import { SKILLS } from '../src/sim/bots.js';
import { DT, FEET } from '../src/sim/constants.js';

const arg = process.argv[2] ?? '';
const quick = arg === 'quick';
const SEEDS = quick ? 2 : 4;
const MAX_T = 420;

function playRun(course, skill, seed, cfg) {
  const sim = createSim({ course, cfg, owners: ['bot', 'bot', 'bot', 'bot'], botSkill: skill, seed: `bal-${seed}`, autonomous: true });
  const ticks = Math.round(MAX_T / DT);
  for (let i = 0; i < ticks; i++) {
    stepSim(sim);
    if (sim.w.finished || sim.w.over) break;
    if (sim.events.length) sim.events.length = 0;
  }
  const r = scoreRun(course, sim.w);
  return { ...r, burns: sim.stats.burns, t: sim.w.t };
}

function stats(runs) {
  const fin = runs.filter((r) => r.finished);
  const avg = (arr, k) => (arr.length ? arr.reduce((a, r) => a + r[k], 0) / arr.length : 0);
  return { n: runs.length, success: fin.length / runs.length, time: avg(fin, 't'), tumbles: avg(runs, 'tumbles'), cond: avg(runs, 'cond'), burns: avg(runs, 'burns') };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(5);
const f1 = (v) => v.toFixed(1).padStart(6);

function table(only) {
  const rows = [];
  console.log('course         name                | novice: ok   time  tumb cond | average: ok   time  tumb cond | pro: ok   time  tumb cond');
  for (let i = 0; i < EXPEDITIONS.length; i++) {
    const id = expeditionId(Math.floor(i / 4), i % 4);
    if (only && id !== only) continue;
    const course = buildCourse({ kind: 'expedition', biome: Math.floor(i / 4), index: i % 4 });
    const cells = [];
    const row = { id, name: EXPEDITIONS[i].name, len: course.length };
    for (let s = 0; s < 3; s++) {
      const runs = [];
      for (let k = 0; k < SEEDS; k++) runs.push(playRun(course, s, k, defaultCfg()));
      const st = stats(runs);
      row[SKILLS[s].name] = st;
      cells.push(`${pct(st.success)} ${f1(st.time)} ${f1(st.tumbles)} ${st.cond.toFixed(2)}`);
      if (only) for (const r of runs) console.log(`  ${SKILLS[s].name}: ${r.finished ? 'finished' : r.why} t=${r.t.toFixed(1)} tumbles=${r.tumbles} cond=${r.cond} burns=${r.burns} groove=${r.grooveAvg} progress=${r.progress}%`);
    }
    rows.push(row);
    console.log(`${id.padEnd(6)} ${String(Math.round(course.length)).padStart(4)}m  ${EXPEDITIONS[i].name.padEnd(20)}| ${cells.join(' | ')}`);
  }
  return rows;
}

function checkTargets(rows) {
  const problems = [];
  const by = (id) => rows.find((r) => r.id === id);
  const e1 = by('e1-1');
  const e12 = by('e3-4');
  const e24 = by('e6-4');
  if (e1 && e1.novice.success < 0.9) problems.push(`e1-1 novice ${pct(e1.novice.success)} < 90%`);
  if (e12 && e12.average.success < 0.7) problems.push(`e3-4 average ${pct(e12.average.success)} < 70%`);
  if (e12 && (e12.novice.success < 0.25 || e12.novice.success > 0.45)) problems.push(`e3-4 novice ${pct(e12.novice.success)} outside 25-45%`);
  if (e24 && e24.pro.success < 0.8) problems.push(`e6-4 pro ${pct(e24.pro.success)} < 80%`);
  if (e24 && (e24.average.success < 0.35 || e24.average.success > 0.5)) problems.push(`e6-4 average ${pct(e24.average.success)} outside 35-50%`);
  if (e24 && e24.novice.success > 0.1) problems.push(`e6-4 novice ${pct(e24.novice.success)} > 10%`);
  for (const r of rows) {
    if (r.pro.success < 1) problems.push(`${r.id} pro bots failed ${pct(1 - r.pro.success)}`);
    if (r.average.time && (r.average.time < 80 || r.average.time > 160)) problems.push(`${r.id} average time ${r.average.time.toFixed(0)} s outside 90-150`);
  }
  console.log(problems.length ? `\nOUT OF BAND:\n  ${problems.join('\n  ')}` : '\nAll targets in band.');
}

function feetStudy() {
  console.log('\nFeet study (average bots, success rate vs rubber feet): biome | claws pads suction springs');
  const seeds = quick ? 2 : 3;
  for (let b = 0; b < BIOMES.length; b++) {
    const cells = [];
    const base = [];
    const courses = [buildCourse({ kind: 'expedition', biome: b, index: 1 }), buildCourse({ kind: 'expedition', biome: b, index: 2 })];
    for (const course of courses) for (let k = 0; k < seeds; k++) base.push(playRun(course, 1, k, defaultCfg()));
    const baseRate = stats(base).success;
    for (const feet of ['claws', 'pads', 'suction', 'springs']) {
      const runs = [];
      const cfg = defaultCfg();
      cfg.feet = [feet, feet, feet, feet];
      for (const course of courses) for (let k = 0; k < seeds; k++) runs.push(playRun(course, 1, k, cfg));
      const d = stats(runs).success - baseRate;
      cells.push(`${feet}:${(d >= 0 ? '+' : '') + Math.round(d * 100)}`.padEnd(12));
    }
    console.log(`  ${BIOMES[b].name.padEnd(16)} base ${pct(baseRate)} | ${cells.join(' ')}`);
  }
}

function seedsStudy() {
  console.log('\nGenerated courses with pro bots (must all finish):');
  let fails = 0;
  const N = quick ? 6 : 20;
  for (let i = 0; i < N; i++) {
    const d = buildCourse({ kind: 'daily', seed: `study-${i}`, biome: i % 6, mutators: [] });
    const r = playRun(d, 2, i, defaultCfg());
    if (!r.finished) {
      fails++;
      console.log(`  daily study-${i} (${BIOMES[i % 6].name}) not finished: ${r.why} progress ${r.progress}% tumbles ${r.tumbles}`);
    }
  }
  const e = buildCourse({ kind: 'endless', seed: 'endless' });
  const er = playRun(e, 2, 1, defaultCfg());
  console.log(`  endless pro distance ${er.distance} m of ${Math.round(e.length)} (${er.finished ? 'finished' : er.why}), tumbles ${er.tumbles}`);
  console.log(fails ? `  ${fails} generated courses failed` : `  all ${N} generated courses finished`);
}

const t0 = Date.now();
if (/^e\d-\d$/.test(arg)) table(arg);
else if (arg === 'feet') feetStudy();
else {
  const rows = table();
  checkTargets(rows);
  if (!quick) feetStudy();
  seedsStudy();
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
