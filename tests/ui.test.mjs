// UI: layout at 1280x720 and 1920x1080 (everything on screen, HUD panels don't overlap), title flow
// (Continue / New Game confirm), settings persist (keybind, quality, reduced violence, brand mode),
// menus open/close, map waypoint, and gamepad navigation through a simulated controller.
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep } from './lib.mjs';

await startServer();
const browser = await BROWSERS[process.env.BROWSER || 'chromium']();
const SIZES = [[1280, 720], [1920, 1080]];

/** Visible elements must sit inside the viewport; listed HUD panels must not overlap each other. */
const layoutCheck = (ids) => {
  const W = innerWidth, H = innerHeight, out = [], rects = [];
  for (const id of ids) {
    const el = document.getElementById(id); if (!el) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${id} off-screen (${r.left.toFixed(0)},${r.top.toFixed(0)},${r.right.toFixed(0)},${r.bottom.toFixed(0)}) in ${W}x${H}`);
    rects.push([id, r, el]);
  }
  const hud = new Set(['mmwrap', 'topright', 'objective', 'timer', 'radio', 'checklist', 'bars', 'loc', 'subs']);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra, ea] = rects[i], [b, rb, eb] = rects[j]; if (!hud.has(a) || !hud.has(b) || ea.contains(eb) || eb.contains(ea)) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 4 && oy > 4) out.push(`${a} overlaps ${b}`);
  }
  return out;
};
const ALL_IDS = ['mmwrap', 'topright', 'objective', 'timer', 'radio', 'checklist', 'bars', 'loc', 'subs', 'toast', 'big', 'wheel', 'menu', 'phone', 'settings', 'title', 'overlay', 'debug'];

async function page(w, h, query = '&title=0') {
  const { page, problems } = await openGame(browser, `?test=1&newgame=1${query}`, { viewport: { width: w, height: h } });
  await waitReady(page); return { page, problems };
}

for (const [w, h] of SIZES) {
  test(`HUD during a mission with timer, meter and subtitles fits at ${w}x${h}`, async () => {
    const { page: p, problems } = await page(w, h);
    await p.evaluate(() => { const T = window.__test, g = window.__game; T.start(); g.player.setPos(-180, -955); T.startMission('side_delivery', true); const M = g.missions; M.advance(); M.active.timer = 99; M.meter('t', 0.5, 'Detection'); M.say([['Rosa', 'A fairly long subtitle line to make sure it wraps instead of running off the screen edge at any size.']]);  window.__test.run(10); });
    await sleep(300);
    const bad = await p.evaluate(layoutCheck, ALL_IDS); await p.context().close();
    assert(!bad.length && !problems.length, [...bad, ...problems].join('\n'));
  });
  for (const [name, open] of [
    ['title', null],
    ['settings', () => { window.__test.start(); window.__game.settingsUI.show(); }],
    ['phone', () => { window.__test.start(); window.__game.phone.show(); }],
    ['pause', () => { window.__test.start(); window.__game.pause(true); }],
    ['weapon wheel', () => { const g = window.__game; window.__test.start(); g.player.give('smg', 60); g.player.give('sniper', 10); g.player.give('bat'); g.player.give('stun', 3); g.wheel.open = true; g.wheel.render(); }],
    ['fail menu', () => { const g = window.__game; window.__test.start(); g.menu.show('Mission failed', [{ label: 'Retry from checkpoint', action() {} }, { label: 'Quit mission', action() {} }], { subtitle: 'You died' }); }],
    ['debug panel', () => { window.__test.start(); const d = window.__game.debug; if (!d.open) d.toggle(); }],
  ]) test(`${name} fits on screen at ${w}x${h}`, async () => {
    const { page: p, problems } = await page(w, h, name === 'title' ? '' : '&title=0');
    if (open) await p.evaluate(open); await sleep(300);
    const bad = await p.evaluate(layoutCheck, ALL_IDS); await p.context().close();
    assert(!bad.length && !problems.length, [...bad, ...problems].join('\n'));
  });
}

test('title: Continue appears with a save; New Game asks to confirm first', async () => {
  const { page: p } = await page(1280, 720, '');
  const r = await p.evaluate(() => {
    const g = window.__game; localStorage.setItem('midlothian-save', JSON.stringify({ version: 2, money: 1234, missions: { completed: {}, medals: {}, story: 3 } }));
    g.title.show(); const labels = g.title.items().map(i => i.id);
    const i = g.title.items().findIndex(x => x.id === 'new'); g.title.i = i; g.title.choose(i);
    return { labels, confirm: g.title.items().map(x => x.id), state: g.state };
  });
  await p.context().close();
  assert(r.labels[0] === 'continue' && r.labels.includes('new') && r.labels.includes('settings'), JSON.stringify(r.labels));
  assert(r.confirm.includes('confirm') && r.confirm.includes('cancel') && r.state === 'title', JSON.stringify(r));
});

test('settings persist across reloads (keybind, quality, reduced violence, brand mode)', async () => {
  const { page: p } = await page(1280, 720);
  await p.evaluate(() => { window.__test.start(); const g = window.__game; g.settingsUI.show(); });
  // rebind "horn" through the real UI: click its button, then press a key
  await p.click('[data-bind="horn"]'); await p.keyboard.press('KeyJ');
  await p.click('[data-q="0"]'); await p.click('[data-t="reducedViolence"]'); await p.click('[data-b="parody"]');
  await p.reload(); await waitReady(p);
  const s = await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('midlothian-settings') || '{}'); return { horn: r.binds?.horn, q: r.quality, rv: r.reducedViolence, brand: r.brandMode, level: window.__game.post.level }; });
  await p.evaluate(() => localStorage.removeItem('midlothian-settings'));
  await p.context().close();
  assert(s.horn === 'KeyJ' && s.q === 0 && s.level === 0 && s.rv === false && s.brand === 'parody', JSON.stringify(s));
});

test('menus open and close: map (M), phone (P), pause (Esc)', async () => {
  const { page: p, problems } = await page(1280, 720);
  await p.evaluate(() => window.__test.start());
  const st = async () => p.evaluate(() => ({ map: window.__game.fullmap.open, phone: window.__game.phone.open }));
  await p.keyboard.press('KeyM'); await sleep(200); const a = await st();
  await p.keyboard.press('KeyM'); await sleep(200); const b = await st();
  await p.keyboard.press('KeyP'); await sleep(200); const c = await st();
  await p.keyboard.press('Escape'); await sleep(200); const d = await st();
  await p.context().close();
  assert(a.map && !b.map && c.phone && !d.phone && !problems.length, JSON.stringify({ a, b, c, d, problems }));
});

test('map: clicking sets a GPS waypoint and route', async () => {
  const { page: p } = await page(1280, 720);
  await p.evaluate(() => { window.__test.start(); window.__game.fullmap.toggle(true); });
  await p.mouse.click(900, 300); await sleep(200);
  const r = await p.evaluate(() => ({ wp: !!window.__game.waypoint, route: (window.__game.route || []).length }));
  await p.context().close();
  assert(r.wp && r.route > 1, JSON.stringify(r));
});

test('gamepad: D-pad/A navigate the pause menu and phone, Start pauses, B backs out', async () => {
  const { page: p, problems } = await page(1280, 720);
  const r = await p.evaluate(async () => {
    const g = window.__game, wait = (ms) => new Promise(r => setTimeout(r, ms));
    const pad = { connected: true, id: 'Test pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [pad];
    const tap = async (i) => { pad.buttons[i].pressed = true; await wait(80); pad.buttons[i].pressed = false; await wait(80); };
    window.__test.start(); g.paused = false; g.state = 'play';
    await tap(9); const paused = g.paused;                     // Start -> pause
    await tap(0); const resumed = !g.paused;                    // A -> resume
    g.phone.show(); const i0 = g.phone.i;
    await tap(13); const moved = g.phone.i !== i0;              // D-pad down moves the phone selection
    await tap(1); await tap(1); const closed = !g.phone.open;   // B backs out to closed
    return { paused, resumed, moved, closed };
  });
  await p.context().close();
  assert(r.paused && r.resumed && r.moved && r.closed && !problems.length, JSON.stringify({ r, problems }));
});

test('gamepad drives the player: left stick walks, triggers aim and fire', async () => {
  const { page: p } = await page(1280, 720);
  const r = await p.evaluate(() => {
    const g = window.__game, T = window.__test; T.start(); T.freeze?.(true); g.testFrozen = true;
    g.input.simPad = { lx: 0, ly: -1, rx: 0, ry: 0, lt: true, rt: false };
    const a = g.player.pos.clone(); T.run(30); const moved = g.player.pos.distanceTo(a);
    const aim = g.input.aim; g.input.simPad = null; return { moved, aim };
  });
  await p.context().close();
  assert(r.moved > 1 && r.aim, JSON.stringify(r));
});

test('minimap blips match targets: mission destination, waypoint, police', async () => {
  const { page: p } = await page(1280, 720);
  const r = await p.evaluate(() => {
    const g = window.__game, T = window.__test; T.start(); T.freeze(true);
    g.player.setPos(-180, -955); T.startMission('side_delivery', true); T.run(3);
    const d = g.missions.dest, P = g.player; g.setWaypoint(P.pos.x + 150, P.pos.z + 40);
    g.police.setWanted(2); T.run(240);
    const near = (b, x, z) => Math.hypot(b.x - x, b.z - z) < 0.5, bl = g.hud.blipsDrawn;
    const cops = g.police.cars.filter(v => !v.dead && v.pos.distanceTo(g.focus) < 120);
    return { dest: !!d && bl.some(b => near(b, d.x, d.z)), wp: bl.some(b => near(b, g.waypoint.x, g.waypoint.z)), cops: cops.length, copBlips: cops.filter(v => bl.some(b => near(b, v.pos.x, v.pos.z))).length };
  });
  await p.context().close();
  assert(r.dest && r.wp && r.copBlips === r.cops, JSON.stringify(r));
});

await run('ui');
await browser.close();
