// Every vehicle type: spawn, enter, drive, exit. Damage -> smoke -> fire -> explode. Flip + recovery,
// radio, paint shop clearing stars, bike crash ejection, spike strips, stunt ramp.
import { startServer, test, run, assert } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { G, T, reset } = H;
const TYPES = await G(() => Object.keys(window.__game.player.constructor && window.__test.eval(g => Object.keys(g.vehicles.constructor === Array ? {} : {}))) || []);
const ALL = ['sedan', 'compact', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'muscle', 'bus', 'police', 'swat', 'motorcycle', 'bicycle'];
void TYPES;

/** Put the player on a long straight road, then spawn+enter a vehicle facing along it. */
const onRoad = (type) => G((type) => {
  const g = window.__game, P = g.player;
  const r = g.data.roads.filter(r => r.type === 'secondary' && r.D.at(-1) > 200)[0];
  const i = Math.floor(r.pts.length / 2), a = r.pts[i], b = r.pts[i + 1] || r.pts[i - 1], h = Math.atan2(b[0] - a[0], b[1] - a[1]);
  if (P.vehicle) g.exitVehicle(true);
  for (const v of g.vehicles.slice()) if (!v.persistent) g.removeVehicle(v);   // clear cars left by earlier tests
  g.traffic.list.length = 0;
  P.setPos(a[0] + 3, a[1]);
  const v = g.spawnVehicle(type, a[0], a[1], h); P.setPos(v.pos.x + Math.cos(h) * 2.5, v.pos.z - Math.sin(h) * 2.5); g.tryEnterExit();
  for (const t of g.traffic.list.slice()) g.removeVehicle(t); g.traffic.list.length = 0;
  return { inside: P.vehicle === v, type: v.type };
}, type);

for (const type of ALL) test(`vehicle ${type}: spawn, enter, drive, exit`, async () => {
  await reset();
  const e = await onRoad(type); assert(e.inside, `could not enter the ${type}`);
  const s = await H.run(75, { keys: ['KeyW'] });
  assert(s.vehicle.speed > (type === 'bicycle' ? 2 : type === 'bus' ? 4 : 6), `${type} speed ${s.vehicle.speed.toFixed(1)}`);
  await H.run(90, { keys: ['Space'] }); await H.run(30, { press: ['KeyF'] });
  const after = await T('state'); assert(!after.inVehicle, 'could not exit');
});

test('damage: smoke, fire, then explosion', async () => {
  await reset(); await onRoad('sedan');
  const r = await G(() => { const g = window.__game, v = g.player.vehicle; g.exitVehicle(true); g.player.setPos(v.pos.x + 30, v.pos.z); v.damage(v.maxHealth * 0.7); return v.health / v.maxHealth; });
  assert(r < 0.45, 'should be in the smoking range');
  await G(() => { const g = window.__game, v = g.vehicles.at(-1); v.damage(10000); });
  const burning = await G(() => window.__game.vehicles.at(-1).burn > 0);
  await H.run(180);
  const dead = await G(() => window.__game.vehicles.find(v => v.burn === 0 && v.dead) != null);
  assert(burning && dead, `burning=${burning} exploded=${dead}`);
});

test('flip and recover with R', async () => {
  await reset(); await onRoad('sedan');
  await G(() => window.__game.player.vehicle.flip());
  let s = await H.run(30); assert(s.vehicle.flipped, 'not flipped');
  s = await H.run(5, { press: ['KeyR'] }); assert(!s.vehicle.flipped, 'still flipped after R');
});

test('radio cycles stations and shows the popup', async () => {
  await reset(); await onRoad('sedan');
  const r = await G(() => { const g = window.__game, i0 = g.audio.radio.index; g.input.simPressed.add('KeyN'); g.update(1 / 30); g.input.endFrame(); return { i0, i1: g.audio.radio.index, pop: document.getElementById('radio').textContent }; });
  assert(r.i1 !== r.i0 && r.pop.length > 2, JSON.stringify(r));
});

test('paint shop: respray costs money and clears up to 2 stars', async () => {
  await reset(); await onRoad('sedan');
  const r = await G(() => {
    const g = window.__game, p = g.places.get('paint'); if (!p) return null;
    g.player.vehicle.setPose(p.pos.x, p.pos.z, 0); g.police.setWanted(2); const m0 = g.player.money, c0 = g.player.vehicle.color;
    g.places.open(p); g.menu.choose(2); return { m0, m1: g.player.money, w: g.police.wanted, c0, c1: g.player.vehicle.color };
  });
  assert(r, 'no paint shop on the map');
  assert(r.m1 === r.m0 - 250 && r.w === 0 && r.c1 !== r.c0, JSON.stringify(r));
});

test('motorcycle crash throws the rider off', async () => {
  await reset(); await onRoad('motorcycle');
  await G(() => { const g = window.__game, v = g.player.vehicle; v.vx = Math.sin(v.heading) * 25; v.vz = Math.cos(v.heading) * 25; g.onVehicleImpact(v, 15); });
  const s = await T('state'); const rag = await G(() => window.__game.player.ragdoll);
  assert(!s.inVehicle && rag > 0, `inVehicle=${s.inVehicle} ragdoll=${rag}`);
});

test('spike strip pops tyres and slows the car', async () => {
  await reset(); await onRoad('sedan');
  await T('setWanted', 3);
  const rb = await G(() => { const g = window.__game, v = g.player.vehicle; v.vx = Math.sin(v.heading) * 20; v.vz = Math.cos(v.heading) * 20; return g.police.roadblocks.spawn() ? true : false; });
  assert(rb, 'roadblock did not spawn');
  const r = await G(() => { const g = window.__game, v = g.player.vehicle, b = g.police.roadblocks.list[0]; v.setPose(b.x - b.dx * 6, b.z - b.dz * 6, Math.atan2(b.dx, b.dz)); v.vx = b.dx * 15; v.vz = b.dz * 15;
    for (let i = 0; i < 40; i++) { g.update(1 / 30); g.input.endFrame(); } return v.tiresPopped; });
  assert(r, 'tyres not popped after crossing the spike strip');
});

test('stunt ramp launches and pays out once', async () => {
  await reset(); await onRoad('sedan');
  const r = await G(() => {
    const g = window.__game, v = g.player.vehicle, ramp = g.stunts.ramps[0]; if (!ramp) return { none: true };
    v.setPose(ramp.x - ramp.dx * 30, ramp.z - ramp.dz * 30, Math.atan2(ramp.dx, ramp.dz)); v.vx = ramp.dx * 30; v.vz = ramp.dz * 30;
    const m0 = g.player.money; let air = 0;
    for (let i = 0; i < 200; i++) { g.input.sim.add('KeyW'); g.update(1 / 30); g.input.endFrame(); if (v.y > 0.5) air++; }
    g.input.sim.clear();
    return { air, paid: g.player.money - m0, done: g.stunts.done.size };
  });
  assert(!r.none, 'no ramps placed');
  assert(r.air > 10 && r.paid === 500 && r.done === 1, JSON.stringify(r));
});

test('driving into a pond floods the engine', async () => {
  await reset(); await onRoad('sedan');
  const r = await G(() => { const g = window.__game, W = g.map.water.filter(w => w.bb.maxx - w.bb.minx > 12)[0], v = g.player.vehicle;
    const x = (W.bb.minx + W.bb.maxx) / 2, z = (W.bb.minz + W.bb.maxz) / 2; if (!g.map.inWater(x, z)) return null; v.setPose(x, z, 0);
    for (let i = 0; i < 120; i++) { g.update(1 / 30); g.input.endFrame(); } return { flooded: !!v.flooded, inside: !!g.player.vehicle }; });
  assert(r && r.flooded && !r.inside, JSON.stringify(r));
});

test('a bicycle and a motorcycle are parked for the player', async () => {
  const r = await G(() => window.__game.vehicles.filter(v => v.persistent).map(v => v.type));
  assert(r.includes('bicycle') && r.includes('motorcycle'), JSON.stringify(r));
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });
await run('vehicles');
await H.browser.close();
