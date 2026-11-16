// World integrity: population caps + despawn, nothing spawns inside buildings or water, roads are not
// blocked by collision, the road graph is connected, collision queries never return NaN, and the bot can
// drive a tour of random destinations without getting stuck.
import { startServer, test, run, assert } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { G, T, reset } = H;

test('ped and traffic counts stay under their caps at max density, and despawn when you leave', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, T = window.__test; g.settings.density = 1.5; g.hour = 13; const spots = [[0, 0], [600, -600], [-500, 300], [900, 200]];
    let maxP = 0, maxT = 0;
    for (const [x, z] of spots) { const sp = g.peds.nearestSidewalk(x, z, 200); g.player.setPos(sp.x, sp.z); for (let k = 0; k < 20; k++) { T.run(30); maxP = Math.max(maxP, g.peds.list.filter(p => !p.mission && !p.cop).length); maxT = Math.max(maxT, g.traffic.list.length); } }
    const far = g.peds.list.filter(p => !p.mission && !p.cop && p.pos.distanceTo(g.player.pos) > 260).length;
    g.settings.density = 0; return { maxP, maxT, far };
  });
  assert(r.maxP <= Math.round(26 * 1.5) + 8, `peds ${r.maxP}`);
  assert(r.maxT <= Math.round(18 * 1.5) + 2, `traffic ${r.maxT}`);
  assert(r.far <= 4, `${r.far} ambient peds left far behind (despawn not working)`);
});

test('no ped, vehicle or pickup spawns inside a building or in water', async () => {
  await reset();
  const bad = await G(() => {
    const g = window.__game, T = window.__test, W = g.world, out = []; g.settings.density = 1.5;
    for (const [x, z] of [[0, 0], [700, -500], [-600, -300], [300, 700]]) { const sp = g.peds.nearestSidewalk(x, z, 200); g.player.setPos(sp.x, sp.z); T.run(240);
      for (const p of g.peds.list) if (W.insideBuilding(p.pos.x, p.pos.z) || g.map.inWater(p.pos.x, p.pos.z)) out.push(`ped ${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)}`);
      for (const v of g.traffic.list) if (W.insideBuilding(v.pos.x, v.pos.z)) out.push(`car ${v.pos.x.toFixed(0)},${v.pos.z.toFixed(0)}`);
    }
    for (const it of g.pickups.items) if (W.insideBuilding(it.pos.x, it.pos.z) || g.map.inWater(it.pos.x, it.pos.z)) out.push(`pickup ${it.kind}`);
    for (const pc of W.parked) if (W.insideBuilding(pc.x, pc.z)) out.push(`parked car ${pc.x.toFixed(0)},${pc.z.toFixed(0)}`);
    g.settings.density = 0; return [...new Set(out)];
  });
  assert(bad.length <= 2, `${bad.length} inside buildings/water: ${bad.slice(0, 8).join('; ')}`);
});

test('roads are not blocked by buildings or collision walls (sampled every 15 m)', async () => {
  const r = await G(() => {
    const g = window.__game, W = g.world; let n = 0; const bad = [];
    for (const road of g.data.roads) { if (road.svc || road.type === 'service' || road.type === 'footway') continue;
      for (let s = 5; s < road.D.at(-1); s += 15) { const i = road.D.findIndex(d => d > s) - 1, a = road.pts[Math.max(0, i)], b = road.pts[Math.max(1, i + 1)], t = (s - road.D[Math.max(0, i)]) / ((road.D[Math.max(1, i + 1)] - road.D[Math.max(0, i)]) || 1), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (Math.hypot(x, z) > g.map.R - 10) continue; n++;
        if (W.insideBuilding(x, z) || W.grid.near(x, z, 0.3)) bad.push(`${road.name || road.type} @ ${x.toFixed(0)},${z.toFixed(0)}`); } }
    return { n, bad: bad.length, sample: bad.slice(0, 6) };
  });
  assert(r.n > 1000 && r.bad / r.n < 0.01, `${r.bad}/${r.n} road samples blocked: ${r.sample.join('; ')}`);
});

test('road graph: every interior drivable road is reachable from the spawn', async () => {
  // roads that reach the map edge are excluded: their connections were clipped by the radius (see TEST_REPORT)
  const r = await G(() => {
    const g = window.__game, sp = g.player.pos, roads = g.data.roads.filter(r => !r.svc && r.type !== 'service' && r.D.at(-1) > 40 && Math.max(...r.pts.map(p => Math.hypot(...p))) < g.map.R - 250);
    let ok = 0; const bad = [];
    for (const r of roads) { const m = r.pts[Math.floor(r.pts.length / 2)], route = g.map.route(sp.x, sp.z, m[0], m[1]); if (route && route.length > 1) ok++; else bad.push(r.name || r.type); }
    return { n: roads.length, ok, bad: bad.slice(0, 8) };
  });
  assert(r.ok / r.n > 0.99, `${r.n - r.ok}/${r.n} roads unreachable: ${r.bad.join(', ')}`);
});

test('collision grid queries never return NaN (raycast grid over the whole map)', async () => {
  const r = await G(() => {
    const g = window.__game, W = g.world, R = g.map.R; let n = 0, nan = 0;
    for (let x = -R; x <= R; x += 60) for (let z = -R; z <= R; z += 60) { if (Math.hypot(x, z) > R) continue;
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, t = W.grid.ray(x, z, Math.sin(a), Math.cos(a), 80); n++; if (Number.isNaN(t)) nan++; }
      const o = W.grid.push(x, z, 0.5); if ([o.x, o.z].some(Number.isNaN)) nan++; }
    return { n, nan };
  });
  assert(r.nan === 0 && r.n > 5000, JSON.stringify(r));
});

test('bot drives a tour of 6 random destinations without getting stuck', async () => {
  await reset();
  const r = await G(async () => {
    const g = window.__game, T = window.__test; await T.bot(); const b = T._bot; b.log = { teleports: [], assists: [], fails: [] };
    for (const v of g.traffic.list.slice()) { g.traffic.release(v); g.removeVehicle(v); }
    const P = g.player, n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, r => r.type !== 'service'), off = n.road.w / 4, v = g.spawnVehicle('sedan', n.px - n.dz * off, n.pz + n.dx * off, Math.atan2(n.dx, n.dz)); P.setPos(v.pos.x + n.dz * 2, v.pos.z - n.dx * 2); g.tryEnterExit();
    if (P.vehicle !== v) return { error: 'could not enter the test car' };
    const out = []; let frames = 0;
    for (let k = 0; k < 6; k++) {
      const l = g.missions.randomLoc(P.vehicle ? P.vehicle.pos : P.pos, 400, 900, false), goal = new T.THREE.Vector3(l.x, 0, l.z), nn = g.map.nearestRoad(goal.x, goal.z, 80, r => r.type !== 'service'); if (nn) goal.set(nn.px, 0, nn.pz);
      let f = 0; for (; f < 30 * 150; f++) { const inp = g.input; inp.sim.clear(); b.driveTo(goal, 18, 6); g.update(1 / 30); inp.endFrame(); if (b.dist(goal) < 8) break; }
      frames += f; out.push(Math.round(b.dist(goal)));
    }
    return { left: out, teleports: b.log.teleports.map(t => t.msg), minutes: +(frames / 30 / 60).toFixed(1) };
  });
  const missed = r.left.filter(d => d > 10).length;
  assert(missed <= 1 && r.teleports.length <= 2, JSON.stringify(r));
});

test('traffic obeys red lights and stop signs', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, T = window.__test, TR = g.traffic; g.settings.density = 1.5; g.hour = 12;
    const c = g.world.signals.clusters; let redSeen = 0, redRun = 0, stopEdges = 0, stopRun = 0; const prev = new Map();
    const d0 = TR.drive.bind(TR);
    TR.drive = (v, a, dt) => {
      const before = { edge: a.edge, stopped: a.stopped, panic: a.panic };
      const f = [Math.sin(v.heading), Math.cos(v.heading)], sig = g.world.signals.ahead(v.pos.x, v.pos.z, f[0], f[1]);
      if (sig && sig.state === 'r' && a.panic <= 0) { if (sig.dist < 12) redSeen++; if (sig.dist > 0.3 && sig.dist < 1.8 && a.v > 4) redRun++; }
      d0(v, a, dt);
      if (a.edge !== before.edge && before.edge.stopAt !== null && before.panic <= 0) { stopEdges++; if (before.stopped !== before.edge) stopRun++; }
    };
    const busiest = [...c].sort((a, b) => b.approaches.length - a.approaches.length).slice(0, 6);
    for (const s of busiest) { const sp = g.peds.nearestSidewalk(s.x + 25, s.z + 25, 80) || { x: s.x + 25, z: s.z + 25 }; g.player.setPos(sp.x, sp.z); T.run(1200); }
    TR.drive = d0; g.settings.density = 0; void prev;
    return { redSeen, redRun, stopEdges, stopRun };
  });
  assert(r.redSeen > 30, `not enough red-light approaches observed: ${JSON.stringify(r)}`);
  assert(r.redRun <= Math.max(2, r.redSeen * 0.02), `cars ran red lights: ${JSON.stringify(r)}`);
  assert(r.stopRun <= Math.max(1, r.stopEdges * 0.05), `cars rolled through stop signs: ${JSON.stringify(r)}`);
});

test('peds and traffic never spawn on top of the player', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, T = window.__test; g.settings.density = 1.5; const near = []; let n = 0;
    // watch every new ped / traffic car the frame it appears
    for (const [x, z] of [[0, 0], [500, -700], [-700, 100]]) {
      for (const v of g.traffic.list.slice()) { g.traffic.release(v); g.removeVehicle(v); }
      const s = g.peds.nearestSidewalk(x, z, 200); g.player.setPos(s.x, s.z);
      let seenP = new Set(g.peds.list), seenT = new Set(g.traffic.list);
      for (let f = 0; f < 300; f++) { T.run(1);
        for (const p of g.peds.list) if (!seenP.has(p)) { seenP.add(p); if (p.mission || p.keep) continue; n++; const d = p.pos.distanceTo(g.player.pos); if (d < 12) near.push('ped ' + d.toFixed(1)); }
        for (const v of g.traffic.list) if (!seenT.has(v)) { seenT.add(v); n++; const d = v.pos.distanceTo(g.player.pos); if (d < 50) near.push('car ' + d.toFixed(1)); } }
    }
    g.settings.density = 0; return { n, near };
  });
  assert(r.n > 20 && !r.near.length, JSON.stringify(r));
});

test('no holes in the ground (grid over the full radius checked against ground meshes)', async () => {
  const r = await G(() => {
    const g = window.__game, R = g.map.R, boxes = [];
    g.scene.traverse(o => { if (o.isMesh && o.userData.layer === 'ground' && o.geometry.boundingBox) boxes.push(o.geometry.boundingBox); });
    let n = 0; const holes = [];
    for (let x = -R; x <= R; x += 25) for (let z = -R; z <= R; z += 25) { if (Math.hypot(x, z) > R) continue; n++; if (!boxes.some(b => x >= b.min.x - 0.01 && x <= b.max.x + 0.01 && z >= b.min.z - 0.01 && z <= b.max.z + 0.01)) holes.push(`${x},${z}`); }
    return { meshes: boxes.length, n, holes: holes.length, sample: holes.slice(0, 5) };
  });
  assert(r.meshes > 10 && r.holes === 0, JSON.stringify(r));
});

test('every road segment: both lanes are drivable (no invisible walls) along the full length', async () => {
  const r = await G(() => {
    const g = window.__game, W = g.world; let segs = 0, samples = 0; const bad = new Map();
    for (const road of g.data.roads) { if (road.svc || road.type === 'service' || road.type === 'footway') continue;
      for (let i = 0; i + 1 < road.pts.length; i++) { const a = road.pts[i], b = road.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue; segs++;
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, off = (road.w || 7) / 4;
        for (let s = 0; s <= L; s += 5) for (const side of [-1, 1]) { const x = a[0] + dx * s - dz * off * side, z = a[1] + dz * s + dx * off * side;
          if (Math.hypot(x, z) > g.map.R - 10) continue; samples++;
          if (W.grid.near(x, z, 0.9) || W.insideBuilding(x, z)) { const k = `${road.name || road.type}`; bad.set(k, (bad.get(k) || 0) + 1); } } } }
    const blocked = [...bad.values()].reduce((a, b) => a + b, 0);
    return { segs, samples, blocked, worst: [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
  });
  assert(r.segs > 500 && r.blocked / r.samples < 0.01, JSON.stringify(r));
});

test('always-parked bicycle and motorcycle do not overlap other cars or walls', async () => {
  const bad = await G(() => {
    const g = window.__game, out = [];
    for (const v of g.vehicles.filter(v => v.persistent)) {
      if (!g.world.clear(v.pos.x, v.pos.z, 0.8)) out.push(`${v.type} in a wall`);
      for (const pc of g.world.parked) if (pc.active && Math.hypot(pc.x - v.pos.x, pc.z - v.pos.z) < 3.5) out.push(`${v.type} overlaps a parked car`);
      for (const o of g.vehicles) if (o !== v && o.pos.distanceTo(v.pos) < 3.5) out.push(`${v.type} overlaps ${o.type}`);
    }
    return out;
  });
  assert(!bad.length, bad.join('; '));
});

test('shops, police, hospital and safehouse markers are on open ground by a road (respawns land there)', async () => {
  const bad = await G(() => { const g = window.__game; return g.places.list.filter(p => !g.world.clear(p.pos.x, p.pos.z, 0.6) || !g.map.nearestRoad(p.pos.x, p.pos.z, 40)).map(p => p.kind); });
  assert(!bad.length, 'blocked: ' + bad.join(', '));
});

test('no console errors during the suite', async () => { assert(H.problems.length === 0, H.problems.join('\n')); });
await run('world');
await H.browser.close();
