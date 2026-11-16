// A. Boot + start flow with REAL input events in Chromium (installed Chrome), Firefox and WebKit,
// with pointer lock allowed and denied. Fails on console errors, page errors, 404s, failed imports,
// or if the start screen is still visible after a real click / Space / Enter.
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep, ART } from './lib.mjs';

await startServer();
const which = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',');

for (const name of which) {
  for (const denyLock of [false, true]) {
    for (const action of ['click', 'Space', 'Enter']) {
      test(`${name} start via ${action} (pointer lock ${denyLock ? 'denied' : 'allowed'})`, async () => {
        const browser = await BROWSERS[name]();
        try {
          const { page, problems } = await openGame(browser, '?title=0', { denyLock });
          await waitReady(page);
          const visibleBefore = await page.locator('#overlay').isVisible();
          assert(visibleBefore, 'start screen should be visible after loading');
          if (action === 'click') await page.mouse.click(640, 360);
          else await page.keyboard.press(action);
          await sleep(2500);
          const st = await page.evaluate(() => ({ overlay: getComputedStyle(document.getElementById('overlay')).display, paused: window.__game.paused, t: window.__game.time, frames: window.__game.frames }));
          await sleep(1000);
          const t2 = await page.evaluate(() => ({ t: window.__game.time, frames: window.__game.frames }));
          await page.screenshot({ path: `${ART}/boot_${name}_${action}_${denyLock ? 'deny' : 'allow'}.png` });
          assert(st.overlay === 'none', `start screen still visible (display=${st.overlay})`);
          assert(!st.paused, 'game still paused after start');
          assert(t2.frames > st.frames, `render loop not running (frames ${st.frames} -> ${t2.frames})`);
          assert(t2.t > st.t, `game time not advancing (${st.t} -> ${t2.t})`);
          assert(problems.length === 0, 'errors:\n' + problems.join('\n'));
        } finally { await browser.close(); }
      });
    }
  }
}
await run('boot');
