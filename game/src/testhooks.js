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
        mission: g.missions.active ? { id: g.missions.active.def.id, step: g.missions.active.i, type: g.missions.active.steps[g.missions.active.i]?.type, t: g.missions.active.t, vars: Object.fromEntries(Object.entries(g.missions.active.vars).filter(([, v]) => typeof v !== 'object')) } : null,
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
    startMission(id, force = true) { return g.missions.startById(id, { force }); },
    missionIds() { return g.missions.catalog().map(m => m.id); },
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
    /** Create the mission-playing test bot (loaded on demand). */
    async bot() { const { TestBot } = await import('./testbot.js'); api._bot = new TestBot(g); return true; },
    /** Put the player on a mission's marker (in a car if the job needs one) and start it. */
    placeAndStart(id) {
      const M = g.missions, P = g.player, m = M.markers.find(m => m.def.id === id), def = M.getDef(id);
      if (P.vehicle && !def?.needsVehicle) g.exitVehicle(true);
      if (m && !P.vehicle) P.setPos(m.pos.x + 3, m.pos.z);
      if (def?.needsVehicle && !P.vehicle) { const n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, r => r.type !== 'service'), v = g.spawnVehicle('sedan', n ? n.px : P.pos.x + 3, n ? n.pz : P.pos.z, n ? Math.atan2(n.dx, n.dz) : 0); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); }
      return M.startById(id, { force: true });
    },
    /** Live bot: plays the given missions in order inside the real render loop (for perf sampling).
     *  Returns immediately; poll botTourState(). Each mission gets maxSec of game time. */
    botTour(ids, maxSec = 600) {
      const b = api._bot, t = api._tour = { ids: [...ids], cur: null, t0: 0, results: [], samples: [], heap0: null };
      g.testFrozen = false; g.paused = false; g.state = 'play';
      g.botLive = { tick(dt) {
        const M = g.missions;
        if (M.failMenu && !g.menu.open) { clearTimeout(M.failTimer); M.failShow?.(); }
        if (t.cur && !M.active && !g.menu.open) { t.results.push({ id: t.cur, t: +(g.time - t.t0).toFixed(0) }); t.cur = null; }
        if (t.cur && g.time - t.t0 > maxSec) { t.results.push({ id: t.cur, t: maxSec, timeout: true }); M.abort('bot tour timeout'); t.cur = null; }
        if (!t.cur && !M.active && t.ids.length) { const id = t.ids.shift(); if (api.placeAndStart(id)) { t.cur = id; t.t0 = g.time; } else t.results.push({ id, notStarted: true }); }
        b.tick(dt);
      } };
      return true;
    },
    botTourState() { const t = api._tour; return t && { cur: t.cur, left: t.ids.length, results: t.results, log: api._bot.log, time: g.time }; },
    botTourStop() { g.botLive = null; g.testFrozen = true; return true; },
    /** Let the bot play for up to n frames or until the active mission ends. Returns state + bot log. */
    botRun(n, untilIdle = true) {
      const b = api._bot; let i = 0;
      for (; i < n; i++) {
        if (g.missions.failMenu && !g.menu.open && g.state === 'play') { clearTimeout(g.missions.failTimer); g.missions.failShow?.(); }   // don't wait for the real-time menu delay
        b.tick(); if (untilIdle && !g.missions.active && !g.menu.open && g.state === 'play') break;
      }
      return { frames: i, state: api.state(), log: b.log };
    },
    eval(fn) { return fn(g); },
    THREE,
  };
  window.__test = api;
  return api;
}
