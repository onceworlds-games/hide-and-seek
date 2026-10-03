// Opens the built game (dist/) in headless Chrome with a query string, waits, and saves a
// screenshot plus the console errors.
//   node scripts/shot.mjs "?test=run&course=e1-1" out.png [seconds] [width] [height]
import { writeFileSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const query = process.argv[2] ?? '';
const out = process.argv[3] ?? 'shot.png';
const secs = Number(process.argv[4] ?? 6);
const width = Number(process.argv[5] ?? 1100);
const height = Number(process.argv[6] ?? 760);
const { server, port } = await serve('dist');
const b = await launch({ width, height });
const errors = [];
b.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) errors.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`LOG ${msg.params.entry.text}`);
});
await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html${query}` });
await sleep(secs * 1000);
const info = await b.evaluate('JSON.stringify(window.__lw ? window.__lw.info() : null)');
console.log('info', info);
const r = await b.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(r.result.data, 'base64'));
console.log('saved', out);
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 20).join('\n')}` : 'no errors');
b.close();
server.close();
process.exit(errors.some((e) => e.startsWith('EXC') || e.startsWith('ERROR')) ? 1 : 0);
