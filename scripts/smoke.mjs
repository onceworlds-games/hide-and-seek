// Drives the built game (dist/) through its public screens in headless Chrome with no platform:
// title -> Play -> workshop -> Start -> a run on autopilot, screenshots along the way, and the
// console errors. Exit code 1 on any uncaught error.
//   node scripts/smoke.mjs [seconds] [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const secs = Number(process.argv[2] ?? 150);
const outDir = process.argv[3] ?? 'smoke';
mkdirSync(outDir, { recursive: true });
const { server, port } = await serve('dist');
const b = await launch({ width: 1100, height: 760 });
const errors = [];
b.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) errors.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`LOG ${msg.params.entry.text}`);
});
const shot = async (name) => {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const info = async () => JSON.parse((await b.evaluate('JSON.stringify(window.__lw ? window.__lw.info() : null)')) ?? 'null');
await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=auto&quality=low` });
await sleep(3000);
await shot('1-title');
console.log('title', JSON.stringify(await info()));
await b.evaluate(`document.querySelector('.btn.big')?.click()`);
await sleep(1500);
await shot('2-workshop');
console.log('workshop', JSON.stringify(await info()));
await b.evaluate(`document.querySelector('#start')?.click()`);
await sleep(2500);
console.log('play', JSON.stringify(await info()));
console.log('bots take every leg:', await b.evaluate('window.__lw.botsAll()'));
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < secs * 1000) {
  await sleep(2000);
  const i = await info();
  const line = i ? `${i.screen} x=${i.x} t=${i.t} tumbles=${i.tumbles} cond=${i.cond} groove=${i.groove} fps=${Math.round(1000 / Math.max(1, i.frameMs))} calls=${i.drawCalls}` : 'no info';
  if (line !== last) console.log(`${Math.round((Date.now() - t0) / 1000)}s  ${line}`);
  last = line;
  if (i && (i.screen === 'results' || i.screen === 'workshop')) break;
}
await shot('3-play');
const i2 = await info();
if (i2 && (i2.screen === 'results' || i2.screen === 'workshop')) {
  await shot('4-results');
  console.log('results', JSON.stringify(i2));
}
await sleep(500);
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 20).join('\n')}` : 'no errors');
b.close();
server.close();
process.exit(errors.some((e) => e.startsWith('EXC') || e.startsWith('ERROR')) ? 1 : 0);
