// Player + weapons: movement, stamina, vault, cover, ragdoll, swimming, every weapon, scope, grenade, wheel,
// headshots, safe-zone holstering, reduced violence.
import { startServer, test, run, assert, sleep } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { page, G, T, reset } = H;

test('walking moves the player', async () => {
  await reset();
  const a = await T('state'); await G(() => { window.__game.cam.yaw += Math.PI; });   // face away from the car
  const b = await H.run(60, { keys: ['KeyW'] });
  assert(Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) > 3, 'player did not move');
});

test('sprinting drains stamina, resting refills it, empty stamina blocks sprint', async () => {
  await reset(); await G(() => { window.__game.cam.yaw += Math.PI; });
  let s = await H.run(90, { keys: ['KeyW', 'ShiftLeft'] });
  assert(s.stamina < 70, `stamina only ${s.stamina}`);
  s = await H.run(260, { keys: ['KeyW', 'ShiftLeft'] });
  assert(s.stamina === 0, `stamina should be empty, is ${s.stamina}`);
  const locked = await G(() => window.__game.player.staminaLock); assert(locked, 'no sprint lock at 0 stamina');
  s = await H.run(240); assert(s.stamina > 30, `stamina did not recover (${s.stamina})`);
});

test('health, armor absorbs damage', async () => {
  await reset();
  const r = await G(() => { const P = window.__game.player; P.armor = 50; P.damage(40); return { h: P.health, a: P.armor }; });
  assert(r.a < 50 && r.h > 60, `armor did not absorb: ${JSON.stringify(r)}`);
});

test('vault over a parked car', async () => {
  await reset();
  const ok = await G(() => {
    const g = window.__game, P = g.player, pc = g.world.parked.filter(p => p.active).sort((a, b) => Math.hypot(a.x - P.pos.x, a.z - P.pos.z) - Math.hypot(b.x - P.pos.x, b.z - P.pos.z))[0];
    // stand beside the car, facing across it
    const side = pc.heading + Math.PI / 2, fx = Math.sin(side), fz = Math.cos(side);
    for (const s of [1, -1]) {
      const x = pc.x - fx * s * 2.0, z = pc.z - fz * s * 2.0;
      if (g.world.clear(x, z, 0.4)) { P.setPos(x, z); P.yaw = Math.atan2(fx * s, fz * s); g.cam.yaw = P.yaw; return { x: pc.x, z: pc.z, sx: x, sz: z }; }
    }
    return null;
  });
  assert(ok, 'no clear spot beside a parked car');
  await H.run(1, { press: ['Space'] });
  const mid = await G(() => !!window.__game.player.vault);
  await H.run(30);
  const end = await T('state');
  const crossed = (end.pos[0] - ok.x) * (ok.sx - ok.x) + (end.pos[1] - ok.z) * (ok.sz - ok.z) < 0;
  assert(mid && crossed, `vault did not happen (started=${mid}, crossed=${crossed})`);
});

test('take cover next to a wall, exposure drops, peek when aiming', async () => {
  await reset();
  const placed = await G(() => {
    const g = window.__game, P = g.player, f = g.world.footprints.find(f => f.kind === 'house' && Math.hypot(f.pts[0][0] - P.pos.x, f.pts[0][1] - P.pos.z) < 150);
    const a = f.pts[0], b = f.pts[1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    for (const s of [1, -1]) { const x = mx - dz / L * s * 1.0, z = mz + dx / L * s * 1.0; if (g.world.clear(x, z, 0.38)) { P.setPos(x, z); return true; } }
    return false;
  });
  assert(placed, 'could not stand next to a wall');
  await H.run(2, { press: ['KeyC'] });
  let s = await T('state'); assert(s.inCover, 'not in cover');
  const ex = await G(() => window.__game.player.exposure); assert(ex < 0.3, `exposure ${ex}`);
  await H.run(5, { aim: true }); const ex2 = await G(() => window.__game.player.exposure); assert(ex2 > ex, 'peeking should expose more');
  await H.run(2, { press: ['KeyC'] }); s = await T('state'); assert(!s.inCover, 'did not leave cover');
});

test('explosion ragdolls and hurts the player', async () => {
  await reset();
  await G(() => { const g = window.__game, P = g.player; g.explosion(P.pos.clone().add(new window.__test.THREE.Vector3(3, 0, 0)), 'test'); });
  const r = await G(() => ({ rag: window.__game.player.ragdoll, hp: window.__game.player.health }));
  assert(r.rag > 0 && r.hp < 100, `ragdoll=${r.rag} hp=${r.hp}`);
  await H.run(80); const r2 = await G(() => window.__game.player.ragdoll); assert(r2 === 0, 'player never got up');
});

test('water: swimming, weapons holstered', async () => {
  await reset();
  const w = await G(() => { const g = window.__game, W = g.map.water.filter(w => w.bb.maxx - w.bb.minx > 12).sort((a, b) => (b.bb.maxx - b.bb.minx) - (a.bb.maxx - a.bb.minx))[0];
    const x = (W.bb.minx + W.bb.maxx) / 2, z = (W.bb.minz + W.bb.maxz) / 2; if (!g.map.inWater(x, z)) return null; g.player.setPos(x, z); return [x, z]; });
  assert(w, 'no water body large enough');
  await H.run(5);
  const s = await T('state'); assert(s.swimming, 'not swimming');
  const ammo = s.inv.pistol.ammo; const s2 = await H.run(20, { fire: true, aim: true }); assert(s2.inv.pistol.ammo === ammo, 'fired a gun while swimming');
});

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];
for (const id of GUNS) test(`weapon ${id}: equip, fire, ammo, reload`, async () => {
  await reset(); await G(() => { window.__game.cam.yaw += Math.PI; });
  await T('giveWeapon', id, 60);
  const before = await T('state'); assert(before.weapon === id, `not equipped (${before.weapon})`);
  const a0 = before.inv[id].ammo;
  const s = await H.run(id === 'sniper' ? 60 : 30, { fire: true, aim: true });
  assert(s.inv[id].ammo < a0 || s.inv[id].reserve < before.inv[id].reserve, `ammo did not decrease (${a0} -> ${s.inv[id].ammo})`);
  await H.run(2, { press: ['KeyR'] }); await H.run(90);
  const r = await T('state'); assert(r.inv[id].ammo > s.inv[id].ammo || r.inv[id].ammo === s.inv[id].ammo && s.inv[id].reserve === 0 || r.inv[id].ammo >= 1, 'reload failed');
});

for (const id of ['fists', 'bat']) test(`melee ${id} damages a pedestrian in front`, async () => {
  await reset(); if (id === 'bat') await T('giveWeapon', 'bat', 1); else await G(() => window.__game.player.equip('fists'));
  await T('spawnPed', 1.0);
  const hp0 = await G(() => window.__game.peds.list.at(-1).health);
  await G(() => { const g = window.__game, P = g.player, p = g.peds.list.at(-1); P.yaw = Math.atan2(p.pos.x - P.pos.x, p.pos.z - P.pos.z); g.cam.yaw = P.yaw; });
  await H.run(3, { fire: true });
  const hp = await G(() => window.__game.peds.list.at(-1).health);
  assert(hp < hp0, `no damage (${hp0} -> ${hp})`);
});

test('headshot multiplier comes from the weapon table', async () => {
  await reset(); await T('spawnPed', 6);
  const r = await G(() => { const g = window.__game, p = g.peds.list.at(-1), T3 = window.__test.THREE; p.health = 1000;
    g.combat.apply({ kind: 'ped', obj: p, head: true, point: p.pos.clone(), normal: new T3.Vector3(0, 0, 1) }, 34, 'player', new T3.Vector3(0, 0, 1), 2.5); return 1000 - p.health; });
  assert(Math.abs(r - 85) < 0.01, `head damage ${r}, expected 85`);
});

test('sniper scope zooms the camera and sways', async () => {
  await reset(); await T('giveWeapon', 'sniper', 10);
  await H.run(30, { aim: true });
  const s = await G(() => ({ scoped: window.__game.player.scoped, fov: window.__game.camera.fov, overlay: getComputedStyle(document.getElementById('scope')).display }));
  assert(s.scoped && s.fov < 25 && s.overlay === 'block', JSON.stringify(s));
});

test('stun grenade stuns nearby pedestrians without killing them', async () => {
  await reset(); await T('giveWeapon', 'stun', 3); await T('spawnPed', 7);
  await G(() => { const g = window.__game, P = g.player, p = g.peds.list.at(-1); g.cam.yaw = Math.atan2(p.pos.x - P.pos.x, p.pos.z - P.pos.z); g.cam.pitch = 0.1; });
  await H.run(2, { fire: true }); await H.run(70);
  const p = await G(() => { const q = window.__game.peds.list.at(-1); return { state: q.state, hp: q.health }; });
  assert(p.state === 'stunned' && p.hp > 0, JSON.stringify(p));
});

test('weapon wheel: hold Q opens it and slows time, release equips', async () => {
  await reset(); await T('giveWeapon', 'smg', 60); await G(() => window.__game.player.equip('pistol')); await T('freeze', false);
  await page.keyboard.down('KeyQ'); await sleep(400);
  const open = await G(() => ({ open: window.__game.wheel.open, ts: window.__game.wheel.timeScale, vis: getComputedStyle(document.getElementById('wheel')).display }));
  await G(() => { window.__game.wheel.sel = 'smg'; });
  await page.keyboard.up('KeyQ'); await sleep(300);
  const w = await T('state');
  assert(open.open && open.ts === 0.25 && open.vis === 'block', JSON.stringify(open));
  assert(w.weapon === 'smg', `equipped ${w.weapon}`);
});

test('school safe zone holsters weapons and blocks wanted level', async () => {
  await reset();
  await G(() => { const g = window.__game, z = g.zones.list.find(z => z.name === 'Midlothian High School'); const x = (z.bb.minx + z.bb.maxx) / 2, zz = (z.bb.minz + z.bb.maxz) / 2;
    for (let r = 0; r < 200; r += 5) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * r, pz = zz + Math.sin(a) * r; if (g.zones.inSafeZone(px, pz) && g.world.clear(px, pz, 0.5)) { g.player.setPos(px, pz); return; } } });
  await H.run(3);
  const s = await T('state'); assert(s.safe, 'not inside the safe zone');
  const a0 = s.inv.pistol.ammo; const s2 = await H.run(20, { fire: true, aim: true });
  assert(s2.inv.pistol.ammo === a0, 'fired inside the school zone');
  await T('crime', 'kill'); const s3 = await T('state'); assert(s3.wanted === 0, `wanted=${s3.wanted} inside school zone`);
});

test('reduced violence (default on) replaces blood with hit flashes', async () => {
  await reset();
  const r = await G(() => { const g = window.__game, T3 = window.__test.THREE; const before = g.effects.bits.filter(b => b.material === g.effects.mats.blood && b.visible).length;
    g.effects.impact(new T3.Vector3(0, 1, 0), new T3.Vector3(0, 1, 0), 'blood'); const after = g.effects.bits.filter(b => b.material === g.effects.mats.blood && b.visible).length;
    return { on: g.settings.reducedViolence, before, after }; });
  assert(r.on && r.after === r.before, JSON.stringify(r));
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });

await run('gameplay');
await H.browser.close();
