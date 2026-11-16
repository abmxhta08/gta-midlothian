// CPU profile of the running game (Chrome DevTools protocol). Prints the top functions by self time.
// usage: node profile.mjs [query]     e.g. node profile.mjs "&q=1"
import { BROWSERS, openGame, waitReady, startServer, sleep } from './lib.mjs';
await startServer();
const b = await BROWSERS.chromium();
const { page } = await openGame(b, '?test=1&title=0&newgame=1' + (process.argv[2] || ''));
await waitReady(page); await page.evaluate(() => window.__test.start()); await sleep(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await sleep(4000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map(n => [n.id, n]));
const counts = new Map(); for (let i = 0; i < profile.samples.length; i++) counts.set(profile.samples[i], (counts.get(profile.samples[i]) || 0) + (dt[i] || 0));
for (const [id, t] of counts) { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'}  ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + t); }
const total = [...self.values()].reduce((a, c) => a + c, 0);
console.log(`total ${(total / 1000).toFixed(0)} ms sampled`);
for (const [k, t] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(t / total * 100).toFixed(1).padStart(5)}%  ${k}`);
await b.close(); process.exit(0);
