// Performance: FPS, frame time, draw calls, triangles and heap per quality level, standing and driving.
// Budget: Medium must average >= MIN_FPS. Results go to tests/artifacts/perf.json.
import fs from 'node:fs';
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep, ART } from './lib.mjs';

await startServer();
const MIN_FPS = +(process.env.MIN_FPS || 50);   // headless timing is noisy; 60 is the target, 50 the hard floor
const DPR = +(process.env.DPR || 1);
const results = {};

for (const q of [0, 1, 2, 3]) {
  test(`perf quality ${q}`, async () => {
    const browser = await BROWSERS.chromium();
    try {
      const { page, problems } = await openGame(browser, `?test=1&q=${q}`, { viewport: { width: 1280, height: 720 } });
      await waitReady(page);
      await page.evaluate(() => window.__test.start());
      await sleep(2500);                                   // let shaders compile
      const sample = async (label) => { await sleep(5000); return page.evaluate(() => window.__test.stats()); };
      const stand = await sample('standing');
      await page.evaluate(() => window.__test.spawnVehicle('sedan', true));
      await page.keyboard.down('KeyW'); const drive = await sample('driving'); await page.keyboard.up('KeyW');
      results[q] = { stand, drive };
      console.log(`      q${q}: stand ${stand.fps.toFixed(0)} fps (1% ${stand.low1.toFixed(0)}), ${stand.calls} draws, ${(stand.tris / 1e6).toFixed(2)}M tris, heap ${stand.heapMB?.toFixed(0)}MB | drive ${drive.fps.toFixed(0)} fps, ${drive.calls} draws`);
      assert(problems.length === 0, problems.join('\n'));
      if (q === 1) assert(Math.min(stand.fps, drive.fps) >= MIN_FPS, `Medium below budget: ${Math.min(stand.fps, drive.fps).toFixed(0)} < ${MIN_FPS} fps`);
    } finally { await browser.close(); }
  });
}
await run('perf');
fs.writeFileSync(`${ART}/perf.json`, JSON.stringify({ dpr: DPR, when: new Date().toISOString(), results }, null, 2));
