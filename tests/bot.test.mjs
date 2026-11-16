// Bot playthrough.
//  A) Fast (frozen loop, 30 Hz steps): the TestBot plays every story, heist and side mission through the real
//     input path. Each mission must pass; teleports/assists are logged as bugs (tests/artifacts/bot.json).
//  B) Live (real render loop): the bot plays a mission tour for BOT_MINUTES (default 10) on Medium while FPS,
//     1% low, draw calls, heap and entity counts are sampled each second, then shorter runs per quality level.
import fs from 'node:fs';
import { startServer, test, run, assert, sleep, ART } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { G, T, reset } = H;
await T('bot');
const report = { missions: [], perf: [], teleports: [], assists: [] };
const save = () => fs.writeFileSync(`${ART}/bot.json`, JSON.stringify(report, null, 2));

const IDS = (process.env.BOT_IDS || '').split(',').filter(Boolean);
const ids = process.env.LIVE_ONLY ? [] : IDS.length ? IDS : await T('missionIds');
const BUDGET = { heist: 1500, finale: 1500, side_race: 900, streetrace_challenge: 600 };

await G(() => { const g = window.__game; window.__R = []; g.events.on('missionFail', e => window.__R.push({ k: 'fail', ...e })); g.events.on('missionPass', e => window.__R.push({ k: 'pass', ...e })); });
for (const id of ids) test(`bot completes "${id}"`, async () => {
  await reset();
  await G(() => { window.__R = []; window.__test._bot.log = { teleports: [], assists: [], fails: [] }; });
  const started = await T('placeAndStart', id); assert(started, 'did not start');
  const budget = BUDGET[id] || 900; let frames = 0, r;
  while (frames < budget * 30) { r = await T('botRun', 900); frames += r.frames; if (!r.state.mission) break; }
  const ev = await G(() => window.__R);
  const passed = ev.some(e => e.k === 'pass'), fails = ev.filter(e => e.k === 'fail').map(e => e.reason);
  const entry = { id, passed, gameSec: Math.round(frames / 30), fails, teleports: r.log.teleports.length, assists: r.log.assists.length, medal: ev.find(e => e.k === 'pass')?.medal };
  report.missions.push(entry); report.teleports.push(...r.log.teleports); report.assists.push(...r.log.assists); save();
  if (r.state.mission) await G(() => window.__game.missions.abort('bot test'));
  // a race you lose is a legitimate ending for the bot; everything else must pass
  const lostRace = /race/.test(id) && fails.some(f => /lost the race/.test(f));
  assert(passed || lostRace, `not passed after ${entry.gameSec}s game time; fails: ${fails.join(', ') || 'none'}${r.state.mission ? `; stuck at step ${r.state.mission.step} (${r.state.mission.type})` : ''}`);
});

/** Run the live bot tour for `sec` real seconds at `quality`, sampling perf once a second. */
async function liveRun(quality, sec, tourIds) {
  await reset();
  await G((q) => { const g = window.__game; g.post.set(q); g.settings.density = 1; window.__test._bot.log = { teleports: [], assists: [], fails: [] }; }, quality);
  await T('botTour', tourIds, 600);
  const samples = [];
  for (let s = 0; s < sec; s++) {
    await sleep(1000);
    samples.push(await G(() => { const g = window.__game, f = g.perf.frames.slice(-60), m = performance.memory; return { ft: f, calls: g.perf.calls, tris: g.perf.tris, heap: m ? m.usedJSHeapSize / 1048576 : null, peds: g.peds.list.length, traffic: g.traffic.list.length, police: g.police.cars.length + g.police.officers.length, vehicles: g.vehicles.length, t: g.time }; }));
  }
  const st = await T('botTourState'); await T('botTourStop');
  const ft = samples.flatMap(s => s.ft).filter(x => x > 0 && x < 1000), sorted = [...ft].sort((a, b) => b - a);
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length, low1 = 1000 / sorted[Math.max(0, Math.floor(ft.length * 0.01) - 1)];
  const heaps = samples.map(s => s.heap).filter(x => x != null);
  const out = { quality: ['Low', 'Medium', 'High', 'Ultra'][quality], seconds: sec, gameSec: Math.round(samples.at(-1).t - samples[0].t), fps: +(1000 / avg).toFixed(1), low1: +low1.toFixed(1), maxFrameMs: +sorted[0].toFixed(1),
    drawCalls: Math.max(...samples.map(s => s.calls)), trisM: +(Math.max(...samples.map(s => s.tris)) / 1e6).toFixed(2),
    heapStartMB: heaps.length ? Math.round(heaps[Math.min(5, heaps.length - 1)]) : null, heapEndMB: heaps.length ? Math.round(heaps.at(-1)) : null, heapMaxMB: heaps.length ? Math.round(Math.max(...heaps)) : null,
    maxPeds: Math.max(...samples.map(s => s.peds)), maxTraffic: Math.max(...samples.map(s => s.traffic)), maxPolice: Math.max(...samples.map(s => s.police)), maxVehicles: Math.max(...samples.map(s => s.vehicles)),
    missions: st.results, teleports: st.log.teleports.length };
  report.perf.push(out); save(); return out;
}

const MIN = +(process.env.BOT_MINUTES || 10);
const TOUR = ['homecoming', 'side_delivery', 'repo', 'side_heat', 'tail', 'hold', 'side_repo', 'snatch', 'escort', 'side_taxi', 'heist_setup', 'paper'];
if (!process.env.MISSIONS_ONLY) test(`live bot tour: ${MIN} min on Medium stays >= 50 FPS average with no heap leak`, async () => {
  const r = await liveRun(1, MIN * 60, TOUR);
  console.log('      ' + JSON.stringify(r));
  assert(r.gameSec >= MIN * 60 * 0.9, `only ${r.gameSec}s of game time`);
  assert(r.fps >= 50, `avg ${r.fps} FPS`);
  if (r.heapStartMB) assert(r.heapEndMB - r.heapStartMB < 150, `heap grew ${r.heapStartMB} -> ${r.heapEndMB} MB`);
});
if (!process.env.MISSIONS_ONLY) for (const q of [0, 2, 3]) test(`live bot 90 s on ${['Low', 'Medium', 'High', 'Ultra'][q]} (perf sample)`, async () => {
  const r = await liveRun(q, 90, TOUR.slice(0, 4)); console.log('      ' + JSON.stringify(r));
  assert(r.fps > (q === 3 ? 10 : 30), `avg ${r.fps} FPS`);
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });
await run('bot');
save();
await H.browser.close();
