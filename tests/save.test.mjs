// Save/load: round trip through a real reload, migration of an old (v1) save, corrupt save recovery,
// story progress unlocking the next mission after a reload.
import { BROWSERS, openGame, waitReady, startServer, test, run, assert } from './lib.mjs';

await startServer();
const browser = await BROWSERS[process.env.BROWSER || 'chromium']();
const KEY = 'midlothian-save';

/** One page per test; `pre` runs before the game script so it can seed localStorage. */
async function open(query, pre) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (pre) await ctx.addInitScript(pre);
  const page = await ctx.newPage(); const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  await page.goto(`http://localhost:8792/index.html?test=1&title=0${query}`); await waitReady(page);
  return { page, ctx, problems };
}

test('round trip: money, weapons, progress, collectibles and time survive a reload', async () => {
  const a = await open('&newgame=1');
  const want = await a.page.evaluate(() => {
    const g = window.__game, P = g.player; window.__test.start();
    P.money = 31337; P.give('smg', 90); P.give('bat'); P.equip('smg'); P.armor = 50;
    g.missions.prog.completed.homecoming = 1; g.missions.prog.story = 1; g.missions.prog.medals.homecoming = 'gold';
    g.collectibles.found.add(g.collectibles.items[0].id); g.hour = 9.25;
    g.persist(); return { money: P.money, smg: P.inv.smg.ammo + P.inv.smg.reserve, found: g.collectibles.found.size };
  });
  const saved = await a.page.evaluate((k) => localStorage.getItem(k), KEY);
  await a.ctx.close();
  // new context = fresh page; carry the save over like the same browser would
  const b = await open('', `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(saved)})`);
  const got = await b.page.evaluate(() => { const g = window.__game, P = g.player; return { money: P.money, smg: P.inv.smg ? P.inv.smg.ammo + P.inv.smg.reserve : -1, bat: !!P.inv.bat, cur: P.current, armor: P.armor, done: g.missions.prog.completed.homecoming, medal: g.missions.prog.medals.homecoming, found: g.collectibles.found.size, hour: +g.hour.toFixed(2) }; });
  await b.ctx.close();
  assert(got.money === want.money && got.smg === want.smg && got.bat && got.cur === 'smg' && got.armor === 50, JSON.stringify(got));
  assert(got.done === 1 && got.medal === 'gold' && got.found === want.found && Math.abs(got.hour - 9.25) < 0.05, JSON.stringify(got));
  assert(!a.problems.length && !b.problems.length, [...a.problems, ...b.problems].join('\n'));
});

test('migration: a v1 save loads as v2 with money, hour and mission counts kept', async () => {
  const v1 = JSON.stringify({ money: 777, hour: 8, missions: { delivery: 2, race: 1 }, quality: 2 });
  const b = await open('', `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(v1)})`);
  const r = await b.page.evaluate(() => { const g = window.__game; return { v: g.save.version, from: g.save.migratedFrom, money: g.player.money, hour: Math.round(g.hour), delivery: g.missions.prog.completed.delivery, weapons: Object.keys(g.player.inv) }; });
  await b.ctx.close();
  assert(r.v === 2 && r.from === 1 && r.money === 777 && r.hour === 8 && r.delivery === 2 && r.weapons.includes('pistol'), JSON.stringify(r));
  assert(!b.problems.length, b.problems.join('\n'));
});

test('a corrupt save starts a fresh game instead of crashing', async () => {
  const b = await open('', `localStorage.setItem(${JSON.stringify(KEY)}, '{not json')`);
  const r = await b.page.evaluate(() => ({ money: window.__game.player.money, ok: !!window.__game.world }));
  await b.ctx.close();
  assert(r.ok && r.money === 250, JSON.stringify(r));
  assert(!b.problems.filter(p => !/save unreadable/.test(p)).length, b.problems.join('\n'));
});

test('story progress persists: finishing Homecoming unlocks Repo Man after a reload', async () => {
  const a = await open('&newgame=1');
  await a.page.evaluate(() => { const g = window.__game, M = g.missions; window.__test.start(); g.player.setPos(M.sites.quill.x + 3, M.sites.quill.z); M.startById('homecoming', { force: true }); while (M.active) M.advance(); });
  const saved = await a.page.evaluate((k) => localStorage.getItem(k), KEY); await a.ctx.close();
  const b = await open('', `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(saved)})`);
  const r = await b.page.evaluate(() => { const M = window.__game.missions; return { repo: M.available(M.getDef('repo')), tail: M.available(M.getDef('tail')), story: M.prog.story }; });
  await b.ctx.close();
  assert(r.repo && !r.tail && r.story === 1, JSON.stringify(r));
});

test('save carries a version number', async () => {
  const a = await open('&newgame=1');
  const v = await a.page.evaluate((k) => { window.__game.persist(); return JSON.parse(localStorage.getItem(k)).version; }, KEY);
  await a.ctx.close(); assert(v === 2, `version ${v}`);
});

await run('save');
await browser.close();
