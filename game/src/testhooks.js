// Test hook layer. Only installed when the URL has ?test=1. Exposes window.__test with read-only state
// queries and a few controls used by the Playwright suite in tests/.
import * as THREE from 'three';

export function installTestHooks(game) {
  const g = game;
  const api = {
    /** Hide the start screen and unpause without any input. */
    start() { document.getElementById('overlay').style.display = 'none'; const t = document.getElementById('title'); if (t) t.style.display = 'none'; g.paused = false; g.state = g.state === 'title' ? 'play' : g.state; return true; },
    state() {
      const P = g.player, v = P.vehicle;
      return {
        state: g.state, paused: !!g.paused, time: g.time, hour: g.hour, frames: g.frames,
        pos: [P.pos.x, P.pos.z], health: P.health, armor: P.armor, money: P.money, stamina: P.stamina,
        weapon: P.current, inv: JSON.parse(JSON.stringify(P.inv)), inVehicle: !!v, vehicle: v ? { type: v.type, speed: v.speed, health: v.health, dead: v.dead, flipped: !!v.flipped } : null,
        wanted: g.police.wanted, searching: g.police.searching, cops: g.police.cars.length, officers: g.police.officers.length,
        peds: g.peds.list.length, traffic: g.traffic.list.length, vehicles: g.vehicles.length, pickups: g.pickups.items.length,
        mission: g.missions.active ? { id: g.missions.active.def.id, stage: g.missions.active.stage, text: g.missions.active.text } : null,
        weather: g.weather?.kind || 'clear', inCover: !!P.cover, swimming: !!P.swimming, safe: !!g.zones?.inSafeZone(P.pos.x, P.pos.z),
        loc: g.lastLoc, district: g.lastDistrict, street: g.lastStreet,
      };
    },
    stats() { const s = g.perf.stats(), m = performance.memory; return { ...s, heapMB: m ? m.usedJSHeapSize / 1048576 : null, quality: g.post.level }; },
    teleport(x, z) { const P = g.player; if (P.vehicle) { P.vehicle.setPose(x, z, P.vehicle.heading); } else P.setPos(x, z); g.focus.set(x, 0, z); return true; },
    spawnVehicle(type = 'sedan', enter = true) {
      const P = g.player, h = P.yaw, x = P.pos.x + Math.sin(h) * 4, z = P.pos.z + Math.cos(h) * 4;
      const v = g.spawnVehicle ? g.spawnVehicle(type, x, z, h) : null;
      if (v && enter) { P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); }
      return !!v;
    },
    giveWeapon(id, ammo = 60) { g.player.give(id, ammo); g.player.equip(id); return g.player.current; },
    setWanted(n) { g.police.setWanted(n); return g.police.wanted; },
    crime(kind) { g.crime(kind, g.player.pos.clone()); return g.police.wanted; },
    setQuality(q) { return g.post.set(q); },
    skipTime(h) { g.hour = (g.hour + h) % 24; g.sky.setTime(g.hour); return g.hour; },
    setTime(h) { g.hour = h; g.sky.setTime(h); return h; },
    /** Simulate N fixed frames with held keys, e.g. run(60, {keys:['KeyW'], fire:true}). */
    run(n, opts = {}) {
      const inp = g.input;
      for (let i = 0; i < n; i++) {
        inp.sim.clear(); for (const k of opts.keys || []) inp.sim.add(k);
        if (i === 0) for (const k of opts.press || []) inp.simPressed.add(k);
        inp.simFire = !!opts.fire; inp.simAim = !!opts.aim;
        g.update(opts.dt || 1 / 30); inp.endFrame();
      }
      inp.sim.clear(); inp.simFire = false; inp.simAim = false;
      return api.state();
    },
    /** Remove all pedestrians and stop new ones spawning (density 0), for deterministic witness tests. */
    clearPeds() { for (const p of g.peds.list) p.dispose(); g.peds.list.length = 0; g.police.officers.length = 0; return 0; },
    setDensity(d) { g.settings.density = d; return d; },
    /** Spawn an idle pedestrian `dist` metres in front of the player (toward the street at spawn). */
    spawnPed(dist = 6, opts = {}) {
      const P = g.player, p = new g.PedClass(g, P.pos.x + Math.sin(P.yaw) * dist, P.pos.z + Math.cos(P.yaw) * dist, opts); p.state = opts.state || 'idle'; p.timer = 1e9; p.keep = true; g.peds.add(p); return g.peds.list.length;
    },
    knockAllPeds() { for (const p of g.peds.list) p.knock(0, 0, 0, 'test'); return true; },
    throwInUpdate() { g._testThrow = true; return true; },
    pendingCalls() { return g.police.calls.pending.length; },
    /** Stop the live loop from updating (rendering continues) so tests drive frames deterministically with run(). */
    freeze(on = true) { g.testFrozen = on; return on; },
    eval(fn) { return fn(g); },
    THREE,
  };
  window.__test = api;
  return api;
}
