// D. Screenshots at key moments for visual review (tests/artifacts/screens/*.png) + automatic black-frame check.
import fs from 'node:fs';
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep, ART } from './lib.mjs';

await startServer();
const DIR = `${ART}/screens`; fs.mkdirSync(DIR, { recursive: true });
const SIZES = (process.env.SIZES || '1280x720').split(',').map(s => s.split('x').map(Number));
const browser = await BROWSERS.chromium();

/** Mean brightness of the canvas via a screenshot; catches black frames. */
async function shot(page, name) {
  const buf = await page.screenshot({ path: `${DIR}/${name}.png` });
  // render + copy in the same task (the WebGL buffer is cleared once the browser presents it)
  const stats = await page.evaluate(() => {
    const g = window.__game; if (!g.fullmap.open) g.post.render();
    const c2 = document.createElement('canvas'); c2.width = 64; c2.height = 36; const x = c2.getContext('2d'); x.drawImage(document.getElementById('c'), 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3);
  });
  return { bytes: buf.length, mid: stats };
}
async function scene(w, h, query, setup, name, { allowDark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:8792/index.html?test=1&newgame=1${query}`); await waitReady(page);
  if (setup) await page.evaluate(setup); await sleep(1500);
  const s = await shot(page, `${name}_${w}x${h}`);
  await ctx.close();
  assert(!errs.length, errs.join('\n'));
  if (!allowDark) assert(s.mid > 8, `${name}: frame is black (brightness ${s.mid.toFixed(1)})`);
  return s;
}

for (const [w, h] of SIZES) {
  test(`title screen ${w}x${h}`, () => scene(w, h, '', null, 'title', { allowDark: true }));
  test(`spawn ${w}x${h}`, () => scene(w, h, '&title=0', () => window.__test.start(), 'spawn'));
  test(`rain ${w}x${h}`, () => scene(w, h, '&title=0&weather=rain', () => { window.__test.start(); window.__game.weather.set('rain', true); window.__game.weather.k = { ...window.__game.weather.target }; }, 'rain'));
  test(`fog ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); const g = window.__game; g.weather.set('fog', true); g.weather.k = { ...g.weather.target }; }, 'fog'));
  test(`night intersection ${w}x${h}`, () => scene(w, h, '&title=0&t=21.5', () => { window.__test.start(); const g = window.__game, c = g.world.signals.clusters[0]; g.player.setPos(c.x + 12, c.z + 12); g.cam.yaw = Math.atan2(-12, -12); }, 'night'));
  test(`weapon wheel ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); const g = window.__game; g.player.give('smg', 60); g.player.give('sniper', 10); g.wheel.open = true; g.wheel.sel = 'smg'; g.wheel.render(); g.testFrozen = true; }, 'wheel'));
  test(`phone ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); window.__game.phone.show(); }, 'phone'));
  test(`shop menu ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); const g = window.__game; g.places.open(g.places.get('ammo')); }, 'shop'));
  test(`settings ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); window.__game.settingsUI.show(); }, 'settings'));
  test(`full map ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); window.__game.openMap(); }, 'fullmap', { allowDark: true }));
  test(`police chase ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); const g = window.__game; g.police.setWanted(3); for (let i = 0; i < 3; i++) g.police.spawnCar(); for (let i = 0; i < 200; i++) { g.update(1 / 30); g.input.endFrame(); } }, 'chase'));
  test(`explosion ${w}x${h}`, () => scene(w, h, '&title=0', () => { window.__test.start(); const g = window.__game, P = g.player; g.explosion(P.pos.clone().add(new window.__test.THREE.Vector3(Math.sin(P.yaw) * 12, 0, Math.cos(P.yaw) * 12)), 'test'); for (let i = 0; i < 6; i++) { g.update(1 / 30); g.input.endFrame(); } g.testFrozen = true; }, 'explosion'));
}
await run('screens');
await browser.close();
