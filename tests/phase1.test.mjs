// Phase 1 checks: error overlays, F3 debug panel, witness-based wanted level.
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep } from './lib.mjs';

await startServer();
let browser, page;
async function fresh(query = '?test=1') {
  if (page) await page.context().close();
  ({ page } = await openGame(browser, query));
  await waitReady(page);
  await page.evaluate(() => { window.__test.start(); window.__test.setDensity(0); window.__test.clearPeds(); });
}
const T = (fn, ...a) => page.evaluate(([f, a]) => window.__test[f](...a), [fn, a]);

test('startup exception shows the error overlay', async () => {
  const { page: p } = await openGame(browser, '?test=1&crash');
  await p.waitForSelector('#fatal.show', { timeout: 60000 });
  const msg = await p.textContent('#fatal .msg');
  assert(/Test crash during startup/.test(msg), 'overlay message: ' + msg);
  await p.context().close();
});

test('runtime exception shows a banner and the game keeps running', async () => {
  await fresh();
  const f0 = await page.evaluate(() => window.__game.frames);
  await T('throwInUpdate');
  await sleep(1500);
  const bar = await page.evaluate(() => ({ cls: document.getElementById('errbar').className, text: document.getElementById('errbar').textContent }));
  const f1 = await page.evaluate(() => window.__game.frames);
  assert(bar.cls.includes('show') && /Test exception/.test(bar.text), 'banner not shown: ' + JSON.stringify(bar));
  assert(f1 > f0 + 10, `loop stopped after the exception (${f0} -> ${f1})`);
});

test('F3 toggles the debug panel with FPS, draws and build stamp', async () => {
  await fresh();
  await page.keyboard.press('F3'); await sleep(800);
  const txt = await page.textContent('#debug');
  assert(await page.locator('#debug').isVisible(), 'panel not visible');
  for (const k of ['FPS', 'Draw calls', 'Triangles', 'JS heap', 'Build', 'Peds']) assert(txt.includes(k), `panel missing "${k}"`);
  await page.keyboard.press('F3'); await sleep(200);
  assert(!(await page.locator('#debug').isVisible()), 'panel did not close');
});

test('gunfire with no witnesses gives no wanted level', async () => {
  await fresh();
  await T('crime', 'gunfire');
  const st = await T('run', 300);   // 10 s of game time
  assert(st.wanted === 0, `wanted=${st.wanted} with nobody around`);
  assert((await T('pendingCalls')) === 0, 'a call was queued with no witness');
});

test('pedestrian witness phones the police after a delay', async () => {
  await fresh();
  await T('spawnPed', 6);
  await T('crime', 'gunfire');
  assert((await T('pendingCalls')) === 1, 'witness call not queued');
  let st = await T('run', 60);      // 2 s: still waiting
  assert(st.wanted === 0, 'wanted rose before the call went through');
  st = await T('run', 150);         // +5 s
  assert(st.wanted >= 1, `call did not raise wanted (wanted=${st.wanted})`);
});

test('knocking the witness down before the call cancels it', async () => {
  await fresh();
  await T('spawnPed', 6);
  await T('crime', 'gunfire');
  await T('knockAllPeds');
  const st = await T('run', 300);
  assert(st.wanted === 0, `wanted=${st.wanted} even though the witness was knocked down`);
});

test('a cop with line of sight reacts immediately', async () => {
  await fresh();
  await T('spawnPed', 8, { cop: true, state: 'idle' });
  await page.evaluate(() => { const g = window.__game, c = g.peds.list.at(-1); c.state = 'idle'; g.police.officers.push(c); });
  await T('crime', 'gunfire');
  const st = await T('state');
  assert(st.wanted >= 1, `wanted=${st.wanted} with a cop watching`);
});

browser = await BROWSERS.chromium();
await run('phase1');
await browser.close();
