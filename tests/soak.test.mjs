// Black-screen soak test: randomized play for N minutes of GAME time per quality level (default 20), time-compressed with
// __test.fastForward (several game updates per rendered frame; rendering and every detector still run every frame).
// Random mix: walking/driving to far corners, teleports, every vehicle type in and out, dying and getting busted, missions
// started and failed, explosions at the camera, 5-star chases, all 24 hours and every weather, window resizes (+ fullscreen),
// pause / map / phone / settings, a main-thread stall (= tab hidden then shown), and one forced WebGL context loss per level.
// After every action: black-frame detector, console + page errors, NaN guards, renderer.info growth. Screenshot on a black frame.
//   SOAK_MINUTES=20  SOAK_QUALITIES=1,0,2,3  SOAK_FF=6  SOAK_SEED=1  GPU=swiftshader (software GL comparison)
import fs from 'node:fs';
import { BROWSERS, openGame, waitReady, startServer, test, run, assert, sleep, ART } from './lib.mjs';

await startServer();
const MIN = +(process.env.SOAK_MINUTES || 20), FF = +(process.env.SOAK_FF || 6), SEED = +(process.env.SOAK_SEED || 1);
const LEVELS = (process.env.SOAK_QUALITIES || '1,0,2,3').split(',').map(Number), NAMES = ['Low', 'Medium', 'High', 'Ultra'];
const GPU = process.env.GPU === 'swiftshader' ? 'swiftshader' : 'metal';
const DIR = `${ART}/soak-${GPU}`; fs.mkdirSync(DIR, { recursive: true });
const browser = await BROWSERS.chromium();
const rng = (() => { let s = SEED >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const pick = (a) => a[Math.floor(rng() * a.length)];
const VEHICLES = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'bus', 'taxi', 'muscle', 'compact', 'motorcycle', 'bicycle'];

async function soakLevel(q) {
  const { page, problems, glNoise } = await openGame(browser, `?test=1&title=0&newgame=1&q=${q}`, { viewport: { width: 1280, height: 720 } });
  await waitReady(page);
  const E = (fn, arg) => page.evaluate(fn, arg), T = (n, ...a) => page.evaluate(([n, a]) => window.__test[n](...a), [n, a]);
  await T('start'); await E((q) => { const g = window.__game; g.post.set(q); g.testFrozen = false; g.paused = false; g.settings.density = 1; }, q);
  await T('bot'); await T('fastForward', FF);
  const sceneGeo = await E(() => { const u = new Set(); window.__game.scene.traverse(o => { if (o.geometry) u.add(o.geometry.uuid); }); return u.size; });   // everything that can ever be on the GPU at once, except entities
  const rep = { gpu: GPU, quality: NAMES[q], ff: FF, targetGameMin: MIN, actions: {}, failures: [], blackFrames: 0, nan: 0, sceneGeo, contextLoss: null, screenshots: [], series: [], errors: [], glNoiseCount: 0, glNoiseSamples: [] };
  const t0 = Date.now(); let gameSec0 = await E(() => window.__game.time), actions = 0, ctxDone = false;
  const status = () => E(() => { const g = window.__game, i = g.renderer.info, f = g.perf.frames.slice(-120), m = performance.memory; return { t: g.time, black: g.health.black.events, recovered: g.health.black.recovered, nan: g.health.nan.count, nanKinds: [...g.health.nan.keys.keys()], bad: g.health.scan(true), tex: i.memory.textures, geo: i.memory.geometries, prog: i.programs.length, heap: m ? Math.round(m.usedJSHeapSize / 1048576) : null, peds: g.peds.list.length, veh: g.vehicles.length, ft: f, ready: g.ready, ctxLost: g.health.ctx.lost, frames: g.frames, lights: 0, quality: g.post.level }; });
  const shot = async (why) => { const n = `${DIR}/q${q}-${why}-${Date.now()}.png`; try { await page.screenshot({ path: n }); rep.screenshots.push(n); } catch (e) { /* page may be reloading */ } };
  const randomSpot = (far) => E((far) => { const g = window.__game, R = g.map.R, a = Math.random() * 6.283, d = far ? R * (0.75 + Math.random() * 0.2) : R * Math.random() * 0.7; const sp = g.peds.nearestSidewalk(Math.cos(a) * d, Math.sin(a) * d, 300); return sp ? [sp.x, sp.z] : [0, 0]; }, far);

  const ACTIONS = {
    async teleport() { const [x, z] = await randomSpot(rng() < 0.5); await E(([x, z]) => window.__game.player.setPos(x, z), [x, z]); await sleep(1200); },
    async walkFar() { const [x, z] = await randomSpot(true); await E(([x, z]) => { const b = window.__test._bot; b.freeGoal = { x, z, mode: 'walk' }; window.__game.botLive = { tick: (dt) => b.tick(dt) }; }, [x, z]); await sleep(4000); await E(() => { window.__test._bot.freeGoal = null; }); await E(() => { window.__game.botLive = null; }); },
    async driveFar() {
      const [x, z] = await randomSpot(true);
      await E(([x, z, t]) => { const g = window.__game, P = g.player, n = g.map.nearestRoad(P.pos.x, P.pos.z, 120, r => r.type !== 'service'); if (!P.vehicle && n) { const v = g.spawnVehicle(t, n.px, n.pz, Math.atan2(n.dx, n.dz)); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); } const b = window.__test._bot; b.freeGoal = { x, z, mode: 'drive' }; g.botLive = { tick: (dt) => b.tick(dt) }; }, [x, z, pick(['sedan', 'suv', 'muscle', 'taxi'])]);
      await sleep(5000); await E(() => { window.__game.botLive = null; window.__test._bot.freeGoal = null; });
    },
    async vehicleCarousel() { await E((t) => { const g = window.__game, P = g.player; if (P.vehicle) g.exitVehicle(true); const n = g.map.nearestRoad(P.pos.x, P.pos.z, 120, r => r.type !== 'service'); if (!n) return; const v = g.spawnVehicle(t, n.px, n.pz, Math.atan2(n.dx, n.dz)); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); }, pick(VEHICLES)); await sleep(1500); await E(() => { const g = window.__game; if (g.player.vehicle) g.tryEnterExit(); }); await sleep(500); },
    async die() { await E(() => window.__game.player.damage(999)); await sleep(4500); },
    async busted() { await E(() => { const g = window.__game; if (g.player.vehicle) g.exitVehicle(true); g.police.setWanted(2); (g.busted || (() => {})).call(g); }); await sleep(4500); },
    async missionFail() {
      const ids = await T('missionIds'), id = pick(ids);
      await E((id) => { window.__test.placeAndStart(id); }, id); await sleep(2500);
      await E(() => { const g = window.__game, M = g.missions; if (M.active) { g.player.damage(999); } });
      await sleep(3500);
      await E(() => { const g = window.__game, M = g.missions; if (g.menu.open) { clearTimeout(M.failTimer); const i = g.menu.items.findIndex(x => /Quit/.test(x.label)); g.menu.choose(i >= 0 ? i : 0); } if (M.active) M.abort('soak'); });
      await sleep(2500);
    },
    async missionBot() { const ids = await T('missionIds'), id = pick(ids.filter(i => /delivery|taxi|repo|heat|homecoming/.test(i))); await E((id) => { window.__test.placeAndStart(id); const b = window.__test._bot; b.freeGoal = null; window.__game.botLive = { tick: (dt) => b.tick(dt) }; }, id); await sleep(5000); await E(() => { const g = window.__game; g.botLive = null; if (g.missions.active) g.missions.abort('soak'); }); },
    async explosions() { for (let i = 0; i < 3; i++) { await T('explodeNearCamera', 6 + i * 3); await sleep(500); } },
    async chase5() { await E(() => { const g = window.__game; g.police.setWanted(5); const b = window.__test._bot; b.freeGoal = null; g.botLive = { tick: (dt) => b.flee ? (b.flee(), window.__game.update(dt), window.__game.input.endFrame()) : b.tick(dt) }; }); await sleep(6000); await E(() => { const g = window.__game; g.botLive = null; g.police.setWanted(0); }); },
    async timeWeather() { const h = Math.floor(rng() * 24), w = pick(['clear', 'rain', 'fog']); await E(([h, w]) => { window.__test.setTime(h); window.__game.weather.set(w, true); }, [h, w]); await sleep(2500); },
    async resize() { const sizes = [[320, 240], [800, 450], [1920, 1080], [2560, 1440], [1280, 720], [1000, 700]]; for (let i = 0; i < 4; i++) { const [w, h] = pick(sizes); await page.setViewportSize({ width: w, height: h }); await sleep(250); } await page.setViewportSize({ width: 1280, height: 720 }); await sleep(600); },
    async fullscreen() { for (let i = 0; i < 3; i++) { await E(() => document.documentElement.requestFullscreen?.().catch(() => {})); await sleep(300); await E(() => document.fullscreenElement && document.exitFullscreen?.().catch(() => {})); await sleep(300); } },
    async uiToggles() { for (const k of ['KeyM', 'KeyM', 'KeyP', 'Escape', 'Escape']) { await page.keyboard.press(k); await sleep(250); } await E(() => { const g = window.__game; g.settingsUI.show(); setTimeout(() => g.settingsUI.close(), 200); }); await sleep(500); await E(() => { const g = window.__game; g.paused = false; g.state = 'play'; g.fullmap.open && g.fullmap.toggle(false); g.phone.open && g.phone.close(); g.menu.open && g.menu.close(); g.pause?.(false); }); },
    async stall() { await E(() => { const t = performance.now(); while (performance.now() - t < 2500); }); await sleep(800); },
    async qualityCycle() { await E(() => { const g = window.__game; g.post.set(g.post.level + 1); }); await sleep(800); await E((q) => window.__game.post.set(q), q); },
  };
  const W = { teleport: 8, walkFar: 3, driveFar: 4, vehicleCarousel: 6, die: 2, busted: 1, missionFail: 2, missionBot: 2, explosions: 3, chase5: 2, timeWeather: 5, resize: 3, fullscreen: 1, uiToggles: 3, stall: 1, qualityCycle: 1 };
  const bag = Object.entries(W).flatMap(([k, n]) => Array(n).fill(k));

  let prev = await status(); rep.series.push({ ...prev, ft: undefined, wall: 0 });
  let nextCtx = 0.1 + rng() * 0.15;   // forced context loss once, early (10-25% of the run) so the last two thirds are steady state after the reload
  while ((prev.t - gameSec0) / 60 < MIN) {
    let name = pick(bag); actions++;
    if (name === 'qualityCycle' && (prev.t - gameSec0) / 60 > MIN * 0.25) name = 'teleport';   // switching quality compiles that level's shaders once: do it early so the rest of the run is steady state
    if (!ctxDone && (prev.t - gameSec0) / 60 > MIN * nextCtx) { name = 'contextLoss'; ctxDone = true; }
    rep.actions[name] = (rep.actions[name] || 0) + 1;
    try {
      if (name === 'contextLoss') {
        const before = await E(() => ({ x: window.__game.focus.x, z: window.__game.focus.z, money: window.__game.player.money }));
        await E(() => { window.__game.persist(); });
        await T('loseContext'); await sleep(400); await T('restoreContext');
        let ok = false; const tStart = Date.now();
        try { await page.waitForURL(/resume=1/, { timeout: 25000 }); await waitReady(page); await sleep(1500); ok = true; } catch (e) { /* not recovered */ }
        if (ok) {
          await T('start'); await E((q) => { const g = window.__game; g.post.set(q); g.testFrozen = false; g.paused = false; g.state = 'play'; }, q); await T('bot'); await T('fastForward', FF);
          const after = await E(() => ({ x: window.__game.focus.x, z: window.__game.focus.z, money: window.__game.player.money, frames: window.__game.frames }));
          rep.contextLoss = { recovered: true, seconds: +((Date.now() - tStart) / 1000).toFixed(1), moved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(1), moneyKept: after.money === before.money };
          if (rep.contextLoss.moved > 40 || !rep.contextLoss.moneyKept) rep.failures.push(`context loss resume mismatch ${JSON.stringify(rep.contextLoss)}`);
        } else { rep.contextLoss = { recovered: false }; rep.failures.push('context loss was NOT recovered'); await shot('ctxloss'); break; }
        rep.ctxConsoleErrors = problems.splice(0).length;   // the deliberate context loss logs console errors; they are expected
        gameSec0 += 0; prev = await status(); continue;
      }
      await ACTIONS[name]();
    } catch (e) { rep.errors.push(`${name}: ${e.message}`.slice(0, 200)); }
    const s = await status();
    if (s.black > prev.black) { rep.blackFrames += s.black - prev.black; rep.failures.push(`BLACK FRAME after "${name}" at game ${(s.t / 60).toFixed(1)} min (recovered by ${s.recovered.join(',') || 'nothing'})`); await shot('black'); }
    if (s.nan > prev.nan) { rep.nan += s.nan - prev.nan; rep.failures.push(`NaN guard after "${name}": ${s.nanKinds.join(' | ')}`); }
    if (s.bad.length) rep.failures.push(`bad values after "${name}": ${s.bad.join('; ')}`);
    if (problems.length) { rep.failures.push(`errors after "${name}": ${problems.splice(0).join(' || ').slice(0, 300)}`); }
    rep.series.push({ ...s, ft: undefined, wall: Math.round((Date.now() - t0) / 1000), action: name });
    prev = s;
    if (rep.failures.length > 25) break;
  }
  // fps from the last frames of each sample (live frame times; includes the cost of fast-forward updates)
  const fts = []; for (let i = 0; i < 6; i++) { await sleep(800); const f = await E(() => window.__game.perf.frames.slice(-60)); fts.push(...f); }
  await T('fastForward', 1); await sleep(1500);
  const live = await E(() => { const s = window.__game.perf.stats(); return { fps: s.fps, low1: s.low1, calls: s.calls, tris: s.tris }; });
  rep.livePerf = live; rep.glNoiseCount = glNoise.length; rep.glNoiseSamples = [...new Set(glNoise.map(m => m.slice(0, 160)))].slice(0, 8);
  rep.wallMinutes = +((Date.now() - t0) / 60000).toFixed(1); rep.gameMinutes = +((prev.t - gameSec0) / 60).toFixed(1); rep.actionCount = actions;
  // Trends. The bot explores the whole map, so world geometry keeps uploading to the GPU during the first part of the run (bounded by
  // the size of the world, not a leak) and each pedestrian owns a bone texture. So compare steady-state samples: the sample at 60% of the
  // run against the last one, with entity-dependent counts normalised (textures - peds).
  const S = rep.series, warm = S[Math.floor(S.length * 0.6)] || S[0], last = S.at(-1);
  const third = (k) => S.slice(Math.floor(S.length * k / 3), Math.floor(S.length * (k + 1) / 3)), mx = (a, f) => Math.max(...a.map(f), 0);
  rep.thirds = { geoMax: [0, 1, 2].map(k => mx(third(k), x => x.geo)), texMinusPedsMax: [0, 1, 2].map(k => mx(third(k), x => x.tex - x.peds)) };
  rep.trend = { textures: [warm.tex, last.tex, Math.max(...S.map(s => s.tex))], geometries: [warm.geo, last.geo, Math.max(...S.map(s => s.geo))], programs: [warm.prog, last.prog, Math.max(...S.map(s => s.prog))], heapMB: [warm.heap, last.heap, Math.max(...S.map(s => s.heap || 0))], peds: [warm.peds, last.peds], vehicles: [warm.veh, last.veh] };
  fs.writeFileSync(`${DIR}/soak-q${q}.json`, JSON.stringify(rep, null, 2));   // raw data first: a failing check must never lose a run
  if (MIN >= 8 && rep.thirds.texMinusPedsMax[2] - rep.thirds.texMinusPedsMax[1] > 30) rep.failures.push(`texture growth (minus peds) ${rep.thirds.texMinusPedsMax.join(' -> ')}`);
  // geometry on the GPU is bounded by the world (every chunk visited) + a few hundred for entities and effects; unbounded growth is a leak
  const geoBound = sceneGeo + 600; rep.geoBound = geoBound;
  if (Math.max(...S.map(x => x.geo)) > geoBound) rep.failures.push(`GPU geometries ${Math.max(...S.map(x => x.geo))} exceeded the world bound ${geoBound}`);
  // programs: the first samples precede the first composer frames, and the quality-cycle action adds the Low/High/Ultra variants once (~25), so
  // bound the total and require the steady-state part of the run (last 40%) to be flat: a climb there means shaders are recompiling during play
  if (last.prog - S[Math.min(3, S.length - 1)].prog > 30) rep.failures.push(`shader programs climbed ${S[Math.min(3, S.length - 1)].prog} -> ${last.prog}`);
  if (MIN >= 5 && last.prog - S[Math.floor(S.length * 0.6)].prog > 3) rep.failures.push(`shader programs still climbing in the last 40% of the run: ${S[Math.floor(S.length * 0.6)].prog} -> ${last.prog}`);
  if (warm.heap && last.heap - warm.heap > 250) rep.failures.push(`JS heap growth ${warm.heap} -> ${last.heap} MB`);
  if (Math.max(...S.map(x => x.heap || 0)) > 1200) rep.failures.push(`JS heap peaked at ${Math.max(...S.map(x => x.heap || 0))} MB`);
  fs.writeFileSync(`${DIR}/soak-q${q}.json`, JSON.stringify(rep, null, 2));
  await page.context().close();
  return rep;
}

const all = [];
for (const q of LEVELS) test(`soak ${GPU} ${NAMES[q]}: ${MIN} game-minutes of randomized play, zero black frames / errors / NaN, recovers from context loss`, async () => {
  let r; try { r = await soakLevel(q); } catch (e) { console.log('SOAK ERROR STACK:', e.stack); throw e; } all.push(r);
  console.log('      ' + JSON.stringify({ quality: r.quality, gameMin: r.gameMinutes, wallMin: r.wallMinutes, actions: r.actionCount, black: r.blackFrames, nan: r.nan, ctx: r.contextLoss, live: r.livePerf, trend: r.trend, glNoise: r.glNoiseCount }));
  assert(!r.failures.length, r.failures.slice(0, 6).join(' // '));
});
test('soak summary written', async () => { fs.writeFileSync(`${DIR}/summary.json`, JSON.stringify(all.map(r => ({ ...r, series: r.series.length })), null, 2)); });
await run('soak');
await browser.close();
