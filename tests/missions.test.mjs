// Missions: every mission starts, steps advance to a pass with payout + save, each fail condition fires,
// retry restores the checkpoint, no double start, and no mission location is inside a school safe zone.
import { startServer, test, run, assert } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { G, T, reset } = H;

/** Start a mission by id from its marker, recording pass/fail events. */
const start = (id) => G((id) => {
  const g = window.__game; window.__ev = [];
  if (!window.__evHooked) { window.__evHooked = true; g.events.on('missionFail', e => window.__ev.push({ k: 'fail', ...e })); g.events.on('missionPass', e => window.__ev.push({ k: 'pass', ...e })); }
  const m = g.missions.markers.find(m => m.def.id === id); if (m) g.player.setPos(m.pos.x + 3, m.pos.z);
  const def = g.missions.getDef(id);
  if (def?.needsVehicle && !g.player.vehicle) { const P = g.player, n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, r => r.type !== 'service'); const v = g.spawnVehicle('sedan', n ? n.px : P.pos.x + 3, n ? n.pz : P.pos.z, n ? Math.atan2(n.dx, n.dz) : 0); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); }
  return window.__test.startMission(id);
}, id);
/** Skip forward until the current step has the given type (completing steps like a player would, but instantly). */
const skipTo = (type) => G((type) => {
  const M = window.__game.missions; for (let k = 0; k < 40 && M.active && M.active.steps[M.active.i]?.type !== type; k++) M.advance();
  return M.active?.steps[M.active.i]?.type;
}, type);
const events = () => G(() => window.__ev || []);
const lastFail = async () => (await events()).filter(e => e.k === 'fail').at(-1)?.reason;

const ids = await T('missionIds');
test(`catalog has story, heist and side missions (${ids.length})`, async () => {
  const kinds = await G(() => window.__game.missions.catalog().map(m => m.type));
  assert(kinds.filter(k => k === 'story').length >= 8, 'fewer than 8 story missions');
  assert(kinds.includes('heist') && kinds.filter(k => k === 'side').length >= 5, JSON.stringify(kinds));
});

for (const id of ids) test(`mission "${id}" starts and its first steps run without errors`, async () => {
  await reset();
  assert(await start(id) === true, 'did not start');
  const s = await H.run(60); assert(s.mission && s.mission.id === id, `not active after 2 s: ${JSON.stringify(s.mission)}`);
  await G(() => window.__game.missions.abort('test'));
});

test('cannot start a second mission while one is active', async () => {
  await reset(); await start('homecoming');
  const second = await T('startMission', 'side_delivery', false);
  const s = await T('state'); assert(!second && s.mission.id === 'homecoming', `second=${second} active=${s.mission?.id}`);
});

test('completing a mission pays out, counts it and writes the save', async () => {
  await reset();
  const before = await G(() => window.__game.player.money);
  await start('side_delivery');
  await G(() => { const M = window.__game.missions; while (M.active) M.advance(); });
  const r = await G(() => { const g = window.__game, raw = JSON.parse(localStorage.getItem('midlothian-save') || '{}'); return { money: g.player.money, done: g.missions.prog.completed.side_delivery, saved: raw.missions?.completed?.side_delivery }; });
  const ev = (await events()).find(e => e.k === 'pass');
  assert(ev && ev.pay >= 600, `pass event ${JSON.stringify(ev)}`);
  assert(r.money === before + ev.pay, `money ${before} -> ${r.money}, pay ${ev.pay}`);
  assert(r.done >= 1 && r.saved >= 1, JSON.stringify(r));
});

test('medals: a fast finish earns gold and a 25% bonus', async () => {
  await reset(); await start('side_repo');
  await G(() => { const M = window.__game.missions; M.active.t = 10; while (M.active) M.advance(); });
  const ev = (await events()).find(e => e.k === 'pass'); assert(ev?.medal === 'gold' && ev.pay === Math.round(700 * 1.25), JSON.stringify(ev));
});

test('fail: player dies -> "You died", retry menu offered', async () => {
  await reset(); await start('homecoming'); await skipTo('deliver');
  await G(() => window.__game.player.damage(999));
  await H.run(150);
  assert(await lastFail() === 'You died', `fail reason ${await lastFail()}`);
});

test('fail: mission vehicle destroyed', async () => {
  await reset(); await start('homecoming'); await skipTo('deliver');
  await G(() => { const M = window.__game.missions; M.active.vars.loaner.explode(); });
  await H.run(10);
  assert(await lastFail() === 'The vehicle was destroyed', `fail reason ${await lastFail()}`);
});

test('fail: chase target escapes', async () => {
  await reset(); await start('snatch'); await skipTo('chase');
  await G(() => {
    const g = window.__game, s = g.missions.active.steps[g.missions.active.i]; s.seen = true; s.alerted = true;
    // stand on a sidewalk at least 500 m from the target
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, sp = g.peds.nearestSidewalk(s.v.pos.x + Math.sin(a) * 700, s.v.pos.z + Math.cos(a) * 700, 200); if (sp && Math.hypot(sp.x - s.v.pos.x, sp.z - s.v.pos.z) > 500) { g.player.setPos(sp.x, sp.z); break; } }
  });
  await H.run(420);
  assert(await lastFail() === 'The target escaped', `fail reason ${await lastFail()}`);
});

test('fail: timer runs out', async () => {
  await reset(); await start('side_delivery'); await skipTo('goto');
  await G(() => { const M = window.__game.missions; M.advance(); M.active.timer = 0.05; });   // second goto has the timer
  await H.run(10);
  // side jobs have no retry menu: the fail ends the job
  assert(await lastFail() === 'Out of time', `fail reason ${await lastFail()}`);
  assert(!(await T('state')).mission, 'side job still active after failing');
});

test('fail: leaving the defend area', async () => {
  await reset(); await start('hold'); await skipTo('defend');
  await G(() => { const g = window.__game, s = g.missions.active.steps[g.missions.active.i], sp = g.peds.nearestSidewalk(s.pos.x + 200, s.pos.z, 150) || g.peds.nearestSidewalk(s.pos.x - 200, s.pos.z, 150); g.player.setPos(sp.x, sp.z); });
  await H.run(210);
  assert(await lastFail() === 'You left the area', `fail reason ${await lastFail()}`);
});

test('fail: spotted in a fail-on-detect stealth section', async () => {
  await reset(); await start('paper'); await skipTo('stealth');
  await G(() => { const g = window.__game, s = g.missions.active.steps[g.missions.active.i]; s.grace = 0; const q = s.guards[0]; g.player.setPos(q.pos.x + Math.sin(q.yaw) * 5, q.pos.z + Math.cos(q.yaw) * 5); for (const o of s.guards) o.guard.wait = 99; });
  await H.run(90);
  assert(await lastFail() === 'You were spotted', `fail reason ${await lastFail()}`);
});

test('stealth takedown from behind is silent', async () => {
  await reset(); await start('paper'); await skipTo('stealth');
  const r = await G(() => {
    const g = window.__game, s = g.missions.active.steps[g.missions.active.i], q = s.guards[0];
    for (const o of s.guards) { o.guard.wait = 99; if (o !== q) o.setPos?.(o.pos.x + 200, o.pos.z); if (o !== q) { o.pos.x += 200; } }
    g.player.setPos(q.pos.x - Math.sin(q.yaw) * 1.2, q.pos.z - Math.cos(q.yaw) * 1.2); s.grace = 0;
    window.__test.run(2); g.input.simPressed.add('KeyE'); window.__test.run(1);
    return { state: q.state, loud: s.loud, meter: s.meter, takedowns: g.missions.active.vars.takedowns };
  });
  assert(r.state === 'out' && !r.loud && r.takedowns === 1, JSON.stringify(r));
});

test('retry restarts from the checkpoint with the mission vehicle restored', async () => {
  await reset(); await start('homecoming'); await skipTo('enter');
  // get in the loaner like a player would, then reach the delivery checkpoint
  await G(() => { const g = window.__game, M = g.missions, v = M.active.vars.loaner; g.player.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); });
  await skipTo('deliver');
  const cpI = await G(() => window.__game.missions.active.i);
  await G(() => window.__game.missions.active.vars.loaner.explode());
  await H.run(5);
  const r = await G(() => { const g = window.__game, M = g.missions; clearTimeout(M.failTimer); M.failShow(); const i = g.menu.items.findIndex(x => /Retry/.test(x.label)); g.menu.choose(i); const v = M.active?.vars.loaner; return { active: M.active?.def.id, i: M.active?.i, alive: v && !v.dead, inIt: g.player.vehicle === v }; });
  assert(r.active === 'homecoming' && r.i === cpI && r.alive && r.inIt, JSON.stringify(r));
});

test('quitting from the fail menu ends the mission cleanly (no stale menu state)', async () => {
  await reset(); await start('homecoming'); await skipTo('deliver');
  await G(() => window.__game.missions.active.vars.loaner.explode()); await H.run(5);
  await G(() => { const g = window.__game, M = g.missions; clearTimeout(M.failTimer); M.failShow(); g.menu.choose(g.menu.items.findIndex(x => /Quit/.test(x.label))); });
  const s = await T('state'); assert(!s.mission, 'mission still active');
  assert(await start('side_delivery'), 'could not start another mission afterwards');
  const s2 = await H.run(30); assert(s2.mission?.id === 'side_delivery', 'new mission did not run');
});

test('mission sites, markers and combat spots are never in a school safe zone', async () => {
  const bad = await G(() => {
    const g = window.__game, M = g.missions, out = [];
    for (const [k, s] of Object.entries(M.sites)) if (g.zones.nearSafeZone(s.x, s.z, 40)) out.push('site ' + k);
    for (const m of M.markers) if (g.zones.inSafeZone(m.pos.x, m.pos.z)) out.push('marker ' + m.def.id);
    for (let i = 0; i < 60; i++) { const l = M.loc({ random: { min: 200, max: 900, combat: true } }); if (g.zones.nearSafeZone(l.x, l.z, 100)) out.push(`combat loc ${l.x.toFixed(0)},${l.z.toFixed(0)}`); }
    return out;
  });
  assert(!bad.length, bad.join('; '));
});

test('mission sites are reachable on foot (not inside buildings or water)', async () => {
  const bad = await G(() => { const g = window.__game, out = []; for (const [k, s] of Object.entries(g.missions.sites)) if (!g.world.clear(s.x, s.z, 0.5) || g.map.inWater(s.x, s.z)) out.push(k); return out; });
  assert(!bad.length, 'blocked sites: ' + bad.join(', '));
});

test('wanted level is suppressed during story missions that say so', async () => {
  await reset(); await start('tail');
  await G(() => { const g = window.__game; g.police.setWanted(2); });
  const s = await H.run(5); assert(s.wanted === 0, `wanted ${s.wanted} during a suppressed mission`);
});

test('heist crew choice changes the payout', async () => {
  const r = await G(() => {
    const def = window.__game.missions.getDef('heist');
    return { cheap: def.payout({ cut: 0.05 + 0.08, approach: 'loud' }), pricey: def.payout({ cut: 0.15 + 0.15, approach: 'loud' }), clean: def.payout({ cut: 0.13, approach: 'stealth', loud: false }) };
  });
  assert(r.cheap > r.pricey && r.clean > r.cheap, JSON.stringify(r));
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });
await run('missions');
await H.browser.close();
