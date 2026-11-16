// Shared page harness for gameplay suites: one loaded game per suite, reset between tests.
import { BROWSERS, openGame, waitReady } from './lib.mjs';

export async function gamePage(query = '', opts = {}) {
  const browser = await BROWSERS[process.env.BROWSER || 'chromium']();
  const { page, problems, ctx } = await openGame(browser, `?test=1&title=0&newgame=1${query}`, opts);
  await waitReady(page);
  await page.evaluate(() => window.__test.start());
  const G = (fn, arg) => page.evaluate(fn, arg);
  const T = (name, ...a) => page.evaluate(([n, a]) => window.__test[n](...a), [name, a]);
  /** Put the player back at spawn on foot with a clean state. */
  const reset = () => G(() => {
    const g = window.__game, P = g.player;
    if (P.vehicle) g.exitVehicle(true);
    g.police.clearAll(); g.state = 'play'; g.paused = false; g.menu.open && g.menu.close(); g.phone.open && g.phone.close();
    if (g.missions.active) g.missions.abort?.('test reset');
    P.held = false; P.cool = 0; P.reloadT = 0; P.health = 100; P.armor = 0; P.stamina = 100; P.staminaLock = false; P.ragdoll = 0; P.cover = null; P.vault = null; P.h.dead = 0;
    P.money = 5000; P.inv = { fists: {}, pistol: { ammo: 12, reserve: 48 } }; P.equip('pistol');
    g.spawnPlayer(false); g.weather.set('clear', true); g.settings.density = 0;
    for (const p of g.peds.list) p.dispose(); g.peds.list.length = 0;
    g.testFrozen = true;
    return true;
  });
  const run = (n, opts = {}) => T('run', n, opts);
  return { browser, ctx, page, problems, glNoise: page.glNoise, G, T, reset, run };
}
