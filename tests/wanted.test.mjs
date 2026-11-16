// Wanted system: crime levels, search + evasion, roadblocks (3+), tactical units (4+), helicopter (5),
// arrest -> BUSTED at the police station with fees, death -> WASTED at the EMS station, school zone immunity.
import { startServer, test, run, assert } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { G, T, reset } = H;
/** Put an idle cop with line of sight 8 m in front of the player (a witness). */
const copWitness = () => G(() => { const g = window.__game, P = g.player; const c = g.police.addOfficer(P.pos.x + Math.sin(P.yaw) * 8, P.pos.z + Math.cos(P.yaw) * 8, 0); c.state = 'idle'; c.timer = 1e9; return true; });

const EXPECT = { gunfire: 1, minor: 1, theft: 1, assault: 2, kill: 2, copkill: 3, copcar: 2, explosion: 2 };
for (const [kind, level] of Object.entries(EXPECT)) test(`crime "${kind}" seen by a cop -> ${level} star(s)`, async () => {
  await reset(); await copWitness();
  const w = await T('crime', kind); assert(w === level, `got ${w}`);
});

test('police search the last known position and stars fade when unseen', async () => {
  await reset(); await T('setWanted', 1);
  // get away: move far from where the police last saw you
  await G(() => { const g = window.__game, sp = g.peds.nearestSidewalk(g.player.pos.x + 700, g.player.pos.z, 200) || g.peds.nearestSidewalk(g.player.pos.x - 700, g.player.pos.z, 200); g.player.setPos(sp.x, sp.z); });
  let s = await H.run(90); const st = await G(() => ({ searching: window.__game.police.searching, lk: !!window.__game.police.lastKnown }));
  assert(st.searching && st.lk, `not searching the last known position (${JSON.stringify(st)})`);
  s = await H.run(330); assert(s.wanted === 0, `still wanted (${s.wanted}) after ~14 s unseen`);
});

test('switching cars shortens the evasion timer', async () => {
  await reset(); await T('setWanted', 2);
  await H.run(70);   // become unseen
  const r = await G(() => { const g = window.__game, P = g.player, u0 = g.police.unseen, v = g.spawnVehicle('compact', P.pos.x + 2, P.pos.z, 0); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); return { u0, u1: g.police.unseen, inside: P.vehicle === v }; });
  assert(r.inside && r.u1 >= r.u0 + 4.9, JSON.stringify(r));
});

test('3 stars: roadblock spawns ahead while driving', async () => {
  await reset();
  const n = await G(() => {
    const g = window.__game, P = g.player, r = g.data.roads.filter(r => r.type === 'secondary' && r.D.at(-1) > 300)[0], a = r.pts[0], b = r.pts[1];
    for (const v of g.vehicles.slice()) g.removeVehicle(v);
    const v = g.spawnVehicle('sedan', a[0], a[1], Math.atan2(b[0] - a[0], b[1] - a[1])); P.setPos(v.pos.x + 2, v.pos.z); g.tryEnterExit();
    g.police.setWanted(3); g.police.roadblocks.t = 0; v.vx = Math.sin(v.heading) * 20; v.vz = Math.cos(v.heading) * 20;
    g.update(1 / 30); g.input.endFrame(); return g.police.roadblocks.list.length;
  });
  assert(n >= 1, 'no roadblock');
});

test('4 stars: tactical units join the chase', async () => {
  await reset(); await T('setWanted', 4);
  const r = await G(() => { const g = window.__game; for (let i = 0; i < 4; i++) { g.police.spawnT = 0; g.police.spawnCar(g.police.spawnCount % 2 ? 'swat' : 'police'); } return g.police.cars.map(c => c.type); });
  assert(r.includes('swat'), JSON.stringify(r));
  const offs = await G(() => { const g = window.__game, c = g.police.cars.find(c => c.type === 'swat'); g.police.deploy(c); return g.police.officers.filter(o => o.tactical).length; });
  assert(offs >= 2, `tactical officers ${offs}`);
});

test('5 stars: helicopter with searchlight', async () => {
  await reset(); await T('setWanted', 5);
  await H.run(10);
  const h = await G(() => ({ active: window.__game.police.heli.active, vis: window.__game.police.heli.group.visible }));
  assert(h.active && h.vis, JSON.stringify(h));
  await T('setWanted', 0); await H.run(2);
  const off = await G(() => window.__game.police.heli.active); assert(!off, 'helicopter stayed after stars cleared');
});

test('cop arrests a stationary player at 1 star -> BUSTED, police station respawn, fine, weapons taken', async () => {
  await reset(); await T('giveWeapon', 'smg', 60); await T('setWanted', 1);
  await G(() => { const g = window.__game, P = g.player, o = g.police.addOfficer(P.pos.x + 1, P.pos.z, 0); o.state = 'cop'; });
  let s = await H.run(90); assert(s.state === 'busted', `state ${s.state}`);
  const m0 = s.money;
  s = await H.run(140); assert(s.state === 'play', 'did not respawn');
  const r = await G(() => { const g = window.__game, p = g.places.get('police'); return { d: p ? Math.hypot(g.player.pos.x - p.pos.x, g.player.pos.z - p.pos.z) : -1 }; });
  assert(r.d >= 0 && r.d < 40, `respawned ${r.d} m from the police station`);
  assert(s.money === m0 - 250 && !s.inv.smg && !s.inv.pistol, `fine/weapons: money ${m0}->${s.money}, inv ${Object.keys(s.inv)}`);
});

test('death -> WASTED, EMS station respawn, hospital bill', async () => {
  await reset();
  await G(() => window.__game.player.damage(500));
  let s = await T('state'); assert(s.state === 'wasted', `state ${s.state}`);
  const m0 = s.money; s = await H.run(160); assert(s.state === 'play' && s.health === 100, 'did not respawn healthy');
  const r = await G(() => { const g = window.__game, p = g.places.get('hospital'); return p ? Math.hypot(g.player.pos.x - p.pos.x, g.player.pos.z - p.pos.z) : -1; });
  assert(r >= 0 && r < 40 && s.money === m0 - 200, `dist ${r}, money ${m0}->${s.money}`);
});

test('school zone: wanted player is not shot or arrested', async () => {
  await reset();
  await G(() => { const g = window.__game, z = g.zones.list.find(z => z.name === 'Midlothian High School');
    for (let r = 0; r < 200; r += 5) for (let a = 0; a < 6.28; a += 0.5) { const x = (z.bb.minx + z.bb.maxx) / 2 + Math.cos(a) * r, y = (z.bb.minz + z.bb.maxz) / 2 + Math.sin(a) * r; if (g.zones.inSafeZone(x, y) && g.world.clear(x, y, 0.5)) { g.player.setPos(x, y); return; } } });
  await T('setWanted', 2);
  await G(() => { const g = window.__game, P = g.player, o = g.police.addOfficer(P.pos.x + 6, P.pos.z, 0); o.state = 'cop'; });
  const s = await H.run(240);
  assert(s.state === 'play' && s.health === 100, `state ${s.state} hp ${s.health}`);
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });
await run('wanted');
await H.browser.close();
