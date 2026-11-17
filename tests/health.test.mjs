// Black-screen hunt regression suite: proves the render-health instrumentation works and that each defect found stays fixed.
//  A. leaks and resize handling (post-processing disposal, debounce, zero size, pixel-ratio / pixel budget caps)
//  B. NaN / sanity guards and repairs, dt hardening, loop survival + watchdog
//  C. black-frame detector + recovery ladder, context loss + resume, F4 report, event ring buffer, resource watch
//  D. world sweeps: every hour x weather, teleports (culling), camera never inside buildings, instanced meshes sane
import fs from 'node:fs';
import { startServer, test, run, assert, sleep, openGame, waitReady, BROWSERS } from './lib.mjs';
import { gamePage } from './harness.mjs';

await startServer();
const H = await gamePage();
const { reset, page } = H;
// a page that never answers (infinite loop in game code) must fail the run loudly instead of hanging it forever
const guarded = (p, what) => new Promise((res, rej) => { const t = setTimeout(() => { console.error(`\nHANG: the page did not respond for 90 s during ${what} - the game code is stuck in a loop`); process.exit(3); }, 90000); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
const G = (fn, arg) => guarded(H.G(fn, arg), String(fn).slice(0, 60).replace(/\s+/g, ' '));
const T = (name, ...a) => guarded(H.T(name, ...a), name);
const live = async (hour = 13) => { await reset(); await G((h) => { const g = window.__game; g.testFrozen = false; g.paused = false; g.state = 'play'; window.__test.setTime(h); g.health.black.consecutive = 0; }, hour); };
const frames = () => G(() => window.__game.frames);
/** Tests that open a second page first quiet the main page (live render loop + Ultra quality starves the new page's load). */
const calm = () => G(() => { const g = window.__game; g.testFrozen = true; g.post.set(1); g.paused = true; });
/** Read a downloaded JSON report. */
const readDownload = async (dl) => JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));

// ---------------------------------------------------------------- A. leaks and resize
for (const q of [1, 3]) test(`post-processing: no GPU texture leak over 25 real window resizes + 8 rebuilds (${['Low', 'Medium', 'High', 'Ultra'][q]})`, async () => {
  await reset(); await G((q) => window.__game.post.set(q), q); await sleep(300);
  const mem = () => G(() => { const i = window.__game.renderer.info; return { tex: i.memory.textures, prog: i.programs.length }; });
  const a = await mem();
  for (let i = 0; i < 25; i++) { await page.setViewportSize({ width: 900 + (i % 7) * 60, height: 600 + (i % 5) * 40 }); await sleep(140); }
  await page.setViewportSize({ width: 1280, height: 720 }); await sleep(400);
  for (let i = 0; i < 8; i++) await G((q) => window.__game.post.set(q), q);
  await sleep(300);
  const b = await mem();
  // before the fix this grew by 11 (Medium) / 17 (Ultra) textures per resize event, i.e. ~300-450 here
  assert(b.tex - a.tex <= 6, `textures ${a.tex} -> ${b.tex}`);
  assert(b.prog - a.prog <= 1, `programs ${a.prog} -> ${b.prog}`);
});

test('resize is debounced: a burst of 60 resize events applies the size at most twice', async () => {
  await reset();
  const n = await G(async () => {
    const g = window.__game; let calls = 0; const r0 = g.post.resize.bind(g.post); g.post.resize = () => { calls++; return r0(); };
    for (let i = 0; i < 60; i++) window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 400)); g.post.resize = r0; return calls;
  });
  assert(n <= 2, `${n} applications`);
});

test('a zero / minimised window size is never applied (render targets keep their size)', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, before = [g.renderer.domElement.width, g.renderer.domElement.height];
    const w = Object.getOwnPropertyDescriptor(window, 'innerWidth'), h = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
    const applied = g.post.resize(); g.applySize();
    if (w) Object.defineProperty(window, 'innerWidth', w); else delete window.innerWidth; if (h) Object.defineProperty(window, 'innerHeight', h); else delete window.innerHeight;
    return { applied, before, after: [g.renderer.domElement.width, g.renderer.domElement.height], aspect: g.camera.aspect, scan: g.health.scan() };
  });
  assert(r.applied === false && r.after[0] === r.before[0] && r.after[1] === r.before[1] && Number.isFinite(r.aspect) && r.aspect > 0 && !r.scan.length, JSON.stringify(r));
});

for (const [q, cap] of [[0, 1], [1, 1], [2, 1.5], [3, 2]]) test(`Retina (devicePixelRatio 2): ${['Low', 'Medium', 'High', 'Ultra'][q]} caps pixel ratio at ${cap} and the render target stays inside its pixel budget`, async () => {
  await calm();
  const { page: p, ctx } = await openGame(H.browser, '?test=1&title=0&newgame=1', { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2 });
  await waitReady(p);
  const r = await p.evaluate((q) => { const g = window.__game; g.post.set(q); const pr = g.renderer.getPixelRatio(), c = g.renderer.domElement; return { dpr: devicePixelRatio, pr, px: c.width * c.height, canvas: [c.width, c.height] }; }, q);
  await ctx.close();
  const budget = [3.0e6, 3.0e6, 5.5e6, 8.0e6][q];
  assert(r.dpr === 2 && r.pr <= cap + 1e-6 && r.px <= budget * 1.02, JSON.stringify({ ...r, cap, budget }));
});

// ---------------------------------------------------------------- B. guards, dt, loop
for (const kind of ['recoil', 'fov', 'pitch', 'camera-pos', 'exposure', 'fog', 'sun', 'player']) test(`NaN guard: corrupted "${kind}" is detected, named, repaired and rendering continues`, async () => {
  await reset();
  const r = await G((kind) => {
    const g = window.__game, T = window.__test, n0 = g.health.status().nan.count;
    T.run(5); T.poison(kind); T.run(3);
    const st = g.health.status(), bad = g.health.scan(true), c = g.camera;
    return { detected: st.nan.count > n0, kinds: st.nan.kinds, stillBad: bad, camFinite: Number.isFinite(c.position.x + c.position.y + c.position.z + c.fov), exp: g.renderer.toneMappingExposure };
  }, kind);
  assert(r.detected && !r.stillBad.length && r.camFinite && r.exp > 0.02, JSON.stringify(r));
});

test('NaN guard: a corrupted vehicle (NaN velocity + position) is reset to the last good spot', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, T = window.__test, P = g.player, sp = g.peds.nearestSidewalk(700, -500, 250); P.setPos(sp.x, sp.z);   // away from the always-parked bike (tryEnterExit takes the nearest vehicle)
    const n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, q => q.type !== 'service'), v = g.spawnVehicle('sedan', n.px, n.pz, Math.atan2(n.dx, n.dz));
    P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); T.run(10); T.poison('vehicle'); T.run(3);
    return { inVehicle: P.vehicle === v, finite: Number.isFinite(v.pos.x + v.pos.z + v.vx + v.vz), bad: g.health.scan(true) };
  });
  assert(r.inVehicle && r.finite && !r.bad.length, JSON.stringify(r));
});

test('NaN guard messages name the phase that first saw the bad value', async () => {
  await reset();
  const msg = await G(() => { const g = window.__game, T = window.__test; g.health.nan.keys.clear(); T.run(3); T.poison('recoil'); T.run(2); return window.__game.health.status().nan.kinds.concat(Array.from(document.querySelectorAll('#errbar')).map(e => e.textContent)).join(' | '); });
  assert(/cam\.yaw\/pitch\/recoil non-finite/.test(msg) && /bad value \(1\)/.test(msg) && /first seen after "[\w-]+"/.test(msg) && /last clean "[\w-]+"/.test(msg), msg);
});

test('dt hardening: traffic with dt = 0 or tiny never produces NaN velocities', async () => {
  await reset();
  const bad = await G(() => {
    const g = window.__game, T = window.__test; g.settings.density = 1.2; g.hour = 13; T.run(240);
    for (const dt of [0, 1e-7, 0.0005]) { g.traffic.update(dt); }
    const n = g.traffic.list.length; g.settings.density = 0;
    return { n, bad: g.vehicles.filter(v => !Number.isFinite(v.vx + v.vz + v.pos.x + v.pos.z)).length };
  });
  assert(bad.n > 3 && bad.bad === 0, JSON.stringify(bad));
});

test('the render loop survives exceptions in update, render-end and perf code (old loop died on the first throw)', async () => {
  await live();
  const r = await G(async () => {
    const g = window.__game, wait = (ms) => new Promise(r => setTimeout(r, ms));
    const f0 = g.frames; const perf = g.perf.frame.bind(g.perf), hh = g.health.afterRender.bind(g.health);
    g.perf.frame = () => { throw new Error('perf boom'); }; await wait(400);
    g.perf.frame = perf; g.health.afterRender = () => { throw new Error('health boom'); }; await wait(400); g.health.afterRender = hh;
    window.__test.throwInUpdate(); await wait(400);
    return { advanced: g.frames - f0 };
  });
  assert(r.advanced > 30, `only ${r.advanced} frames while exceptions were being thrown`);
});

test('watchdog restarts a stopped animation loop', async () => {
  await live();
  const f0 = await frames();
  await G(() => window.__game.renderer.setAnimationLoop(null));   // simulate the loop dying
  await sleep(3800);
  const f1 = await frames(), st = await T('health');
  assert(f1 - f0 > 10 && st.loopRestarts >= 1, `frames +${f1 - f0}, restarts ${st.loopRestarts}`);   // the loop was dead for ~2.5 s, then ran again
});

// ---------------------------------------------------------------- C. detector, ladder, context loss, report
test('no false black-frame events in 12 s of normal daytime play (and none at night)', async () => {
  await live(13); await sleep(6000);
  await G(() => window.__test.setTime(23)); await sleep(6000);
  const st = await T('health'); assert(st.black.events === 0 && st.black.samples >= 8, JSON.stringify(st.black));
});

for (const step of ['reset-camera', 'reset-lighting', 'rebuild-post-targets', 'lower-quality']) test(`black frame -> automatic recovery ladder ends at step "${step}"`, async () => {
  await live(13); await G(() => { const g = window.__game; g.post.set(2); window.__game.health.black.events = 0; window.__game.health.black.recovered = []; window.__game.health.autoDone = true; });   // autoDone: skip the download here
  const q0 = await G(() => window.__game.post.level);
  await T('forceBlack', step);
  await sleep(4500);
  const st = await T('health'), q1 = await G(() => window.__game.post.level);
  assert(st.black.events === 1, `events ${st.black.events}`);
  assert(st.black.recovered.at(-1) === step, `recovered by ${JSON.stringify(st.black.recovered)}`);
  if (step === 'lower-quality') assert(q1 === q0 - 1, `quality ${q0} -> ${q1}`);
  await G(() => { window.__game.post.set(1); });
});

test('black frame: banner, automatic report download (once), ladder exhausted -> reload and resume', async () => {
  await calm();
  const { page: p, ctx } = await openGame(H.browser, '?test=1&title=0&newgame=1'); await waitReady(p);
  await p.evaluate(() => { const g = window.__game, T = window.__test; T.start(); T.setTime(13); g.testFrozen = false; g.player.setPos(300, -400); g.player.money = 4321; g.persist(); });
  const down = p.waitForEvent('download', { timeout: 15000 });
  await p.evaluate(() => window.__test.forceBlack('never'));
  const dl = await down, rep = await readDownload(dl);
  assert(/black-frame/.test(rep.reason) && rep.build && rep.events.length > 3, `report: ${JSON.stringify(rep.reason)}`);
  const banner = await p.evaluate(() => document.getElementById('rhbanner')?.textContent || '');
  assert(/black|recover|saved/i.test(banner), 'banner: ' + banner);
  await p.waitForURL(/resume=1/, { timeout: 20000 }); await waitReady(p);
  const r = await p.evaluate(() => { const g = window.__game; return { x: Math.round(g.focus.x), z: Math.round(g.focus.z), money: g.player.money, prev: !!document.getElementById('rhbanner') }; });
  await ctx.close();
  assert(Math.abs(r.x - 300) < 25 && Math.abs(r.z + 400) < 25 && r.money === 4321, `resumed at ${JSON.stringify(r)}`);
});

test('WebGL context loss: detected, banner + report, restored, scene reloads and the player resumes where they were', async () => {
  await calm();
  const { page: p, ctx, problems } = await openGame(H.browser, '?test=1&title=0&newgame=1'); await waitReady(p);
  await p.evaluate(() => { const g = window.__game, T = window.__test; T.start(); T.setTime(13); g.testFrozen = false; g.player.setPos(-250, 120); g.player.money = 777; g.persist(); });
  await sleep(500);
  const down = p.waitForEvent('download', { timeout: 15000 });
  await p.evaluate(() => window.__test.loseContext());
  const rep = await readDownload(await down);
  const lost = await p.evaluate(() => ({ st: window.__game.health.status().ctx, banner: document.getElementById('rhbanner')?.textContent || '' }));
  assert(rep.reason.includes('context-lost') && lost.st.lost === true && /context lost|report saved|reload|recover/i.test(lost.banner), JSON.stringify({ reason: rep.reason, lost }));
  await p.evaluate(() => window.__test.restoreContext());
  await p.waitForURL(/resume=1/, { timeout: 20000 }); await waitReady(p);
  await sleep(1500);
  const r = await p.evaluate(() => { const g = window.__game; g.health.black.consecutive = 0; return { x: Math.round(g.focus.x), z: Math.round(g.focus.z), money: g.player.money, lost: g.health.status().ctx.lost, frames: g.frames }; });
  await ctx.close();
  assert(Math.abs(r.x + 250) < 25 && Math.abs(r.z - 120) < 25 && r.money === 777 && !r.lost && r.frames > 20, JSON.stringify(r));
  assert(!problems.some(m => /pageerror/.test(m)), problems.join('\n'));
});

test('after a recovery reload the scene actually renders (not black)', async () => {
  await calm();
  const { page: p, ctx } = await openGame(H.browser, '?test=1&title=0&newgame=1'); await waitReady(p);
  await p.evaluate(() => { const g = window.__game, T = window.__test; T.start(); T.setTime(13); g.testFrozen = false; });
  await p.evaluate(() => window.__test.loseContext()); await sleep(300);
  await p.evaluate(() => window.__test.restoreContext());
  await p.waitForURL(/resume=1/, { timeout: 20000 }); await waitReady(p); await sleep(800);
  const s = await p.evaluate(() => { const g = window.__game; window.__test.setTime(13); g.post.render(); return { ...g.health.sample(), tris: g.renderer.info.render.triangles }; });
  await ctx.close();
  assert(s.lum > 60 && s.max > 150, JSON.stringify(s));
});

test('F4 downloads a complete JSON report', async () => {
  await live(13); await sleep(1500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('F4')]);
  const r = await readDownload(dl);
  const need = ['build', 'userAgent', 'gpu', 'glError', 'contextLost', 'canvas', 'window', 'quality', 'post', 'time', 'player', 'camera', 'renderer', 'blackFrames', 'nanGuards', 'errors', 'events', 'frameTimesLast5s'];
  const missing = need.filter(k => !(k in r));
  assert(!missing.length, 'missing: ' + missing.join(', '));
  assert(r.gpu.renderer && r.canvas.width > 0 && r.window.devicePixelRatio > 0 && r.glError.includes('NO_ERROR') && r.renderer.memory.textures > 0 && r.renderer.programs > 10, JSON.stringify({ gpu: r.gpu.renderer, c: r.canvas, e: r.glError }));
  assert(r.frameTimesLast5s.length > 20 && r.events.length >= 3 && r.camera.pos.length === 3 && r.player.pos.length === 3, `frames ${r.frameTimesLast5s.length} events ${r.events.length}`);
});

test('event ring buffer keeps the last 300 events and records the key game events', async () => {
  await reset();
  const r = await G(async () => {
    const g = window.__game, T = window.__test, { eventRing } = await import('./src/core/health.js');
    const P = g.player; T.run(2);
    P.setPos(P.pos.x + 200, P.pos.z);                                  // teleport
    const n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, q => q.type !== 'service'), v = g.spawnVehicle('sedan', n.px, n.pz, 0); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); g.tryEnterExit();   // enter + exit
    g.pause(true); g.pause(false); g.weather.set('rain', true); g.post.set(2); g.skipHours(1); T.explodeNearCamera(10); g.cam.di = 0; g.input.simPressed.add('KeyV'); T.run(2);
    g.police.setWanted(1); T.startMission('side_delivery', true); g.missions.abort('x'); P.damage(999); T.run(5);
    window.dispatchEvent(new Event('resize'));
    const kinds = new Set(eventRing().map(e => e.kind));
    const { logEvent } = await import('./src/core/health.js'); for (let i = 0; i < 400; i++) logEvent('spam', i);
    return { kinds: [...kinds], len: eventRing().length };
  });
  const want = ['teleport', 'vehicleEnter', 'vehicleExit', 'pause', 'resume-play', 'weather', 'quality', 'time-skip', 'explosion', 'camera-mode', 'missionStart', 'wasted', 'resize'];
  const missing = want.filter(k => !r.kinds.includes(k));
  assert(!missing.length && r.len === 300, `missing ${missing.join(', ')}; ring length ${r.len}`);
});

test('resource watch logs renderer.info, counts lights, and warns on steady growth and climbing shader programs', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, H = g.health, info = g.renderer.info; H.res.length = 0; H.warnings.length = 0; H.leakStrikes = 0; H.progMax = null;
    let t = 0; const step = () => { H.watchResources(t += 10000); };
    for (let i = 0; i < 6; i++) step();                       // baseline minute
    const base = H.res.at(-1), progs0 = info.programs.length;
    for (let i = 0; i < 22; i++) { info.memory.textures += 12; info.memory.geometries += 25; step(); }   // fake leak: +72 tex / +150 geo per minute
    info.memory.textures -= 22 * 12; info.memory.geometries -= 22 * 25;
    return { sample: base, warnings: H.warnings.map(w => w.msg), lights: base.lights };
  });
  assert(r.sample.geometries > 0 && r.sample.textures > 0 && r.sample.programs > 10 && r.lights >= 5 && r.sample.lightsActive >= 1, JSON.stringify(r.sample));
  assert(r.warnings.some(w => /steady GPU resource growth/.test(w)), 'no leak warning: ' + JSON.stringify(r.warnings));
});

test('post-processing falls back to direct rendering if the composer keeps throwing', async () => {
  await reset(); await G(() => window.__game.post.set(2));
  const r = await G(() => {
    const g = window.__game, T = window.__test; T.setTime(13);
    const post = g.post; let boom = true;
    // sabotage: make every pass render throw
    const st0 = post.status(); const rr = g.renderer.render.bind(g.renderer);
    g.renderer.render = function (...a) { if (boom && g.renderer.getRenderTarget()) throw new Error('driver render-to-texture failure'); return rr(...a); };
    for (let i = 0; i < 5; i++) post.render();
    boom = false; g.renderer.render = rr; post.render();
    const s = g.health.sample();
    return { before: st0.composer, after: post.status(), lum: s.lum };
  });
  assert(r.before && r.after.disabled === true && !r.after.composer && r.lum > 40, JSON.stringify(r));
  await G(() => window.__game.post.setDisabled(false));
});

test('each post effect can be switched off on its own (bloom, ambient occlusion, whole composer)', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, S = window.__game.settingsRef; const out = {};
    g.post.set(3); out.ultra = g.post.status();
    return out;
  });
  assert(r.ultra.ao && r.ultra.bloom, JSON.stringify(r.ultra));
  const p = await G(async () => {
    const { settings } = await import('./src/config/settings.js'); const g = window.__game, o = {};
    settings.fxAO = false; g.post.rebuild(); o.noAO = g.post.status();
    settings.fxBloom = false; g.post.rebuild(); o.noBloomNoAO = g.post.status();
    settings.fxAO = true; settings.fxBloom = true; g.post.set(1); o.back = g.post.status(); return o;
  });
  assert(!p.noAO.ao && p.noAO.bloom && !p.noBloomNoAO.bloom && p.back.bloom && p.back.composer, JSON.stringify(p));
});

// ---------------------------------------------------------------- D. sweeps
test('every in-game hour x clear/rain/fog x Medium/Ultra: values finite, frame never black, bright by day', async () => {
  await reset();
  const bad = [];
  for (const q of [1, 3]) {
    await G((q) => window.__game.post.set(q), q);
    for (const w of ['clear', 'rain', 'fog']) for (let h = 0; h < 24; h++) {
      const r = await G(([h, w]) => {
        const g = window.__game, T = window.__test; g.weather.set(w, true); g.weather.k = { ...g.weather.target }; T.setTime(h); T.run(15);
        g.post.render(); const s = g.health.sample(); return { lum: s.lum, max: s.max, bad: g.health.scan(true) };
      }, [h, w]);
      const day = h >= 8 && h <= 17;
      if (r.bad.length || r.lum < (day ? 70 : 20) || r.max < 60) bad.push(`q${q} ${w} ${h}h lum ${r.lum.toFixed(0)} max ${r.max.toFixed(0)} ${r.bad.join('|')}`);
    }
  }
  await G(() => { window.__game.post.set(1); window.__game.weather.set('clear', true); });
  assert(!bad.length, bad.slice(0, 6).join('; '));
});

test('teleports (map edge, corners, respawn spots) keep the world visible: no culling hole, no black frame', async () => {
  await reset(); await G(() => window.__test.setTime(13));
  const bad = await G(() => {
    const g = window.__game, T = window.__test, R = g.map.R, out = [];
    const spots = [[0, 0], [R * 0.9, 0], [-R * 0.9, 0], [0, R * 0.9], [0, -R * 0.9], [R * 0.65, R * 0.65], [-R * 0.65, -R * 0.65], [R * 0.65, -R * 0.65], [-R * 0.65, R * 0.65]];
    for (const [x, z] of spots) {
      const sp = g.peds.nearestSidewalk(x, z, 250); if (!sp) { out.push(`no sidewalk near ${x | 0},${z | 0}`); continue; }
      g.player.setPos(sp.x, sp.z); T.run(3); g.post.render(); const s = g.health.sample(), i = g.renderer.info.render;
      if (s.lum < 40 || i.triangles < 50000 || i.calls < 100) out.push(`${sp.x | 0},${sp.z | 0}: lum ${s.lum.toFixed(0)} tris ${i.triangles} calls ${i.calls}`);
    }
    // respawns (hospital / police) and a mission teleport
    for (const kind of ['wasted', 'busted']) { g.state = kind; g.stateT = 0; T.run(4); g.post.render(); const s = g.health.sample(); if (s.lum < 40) out.push(`after ${kind}: lum ${s.lum.toFixed(0)}`); }
    return out;
  });
  assert(!bad.length, bad.join('; '));
});

test('third-person camera never ends up inside a building or under the ground (1500 random wall-hugging positions; was 0.4% before the fix)', async () => {
  await reset();
  const bad = await G(() => {
    const g = window.__game, T = window.__test, W = g.world, out = []; let n = 0;
    const foots = W.footprints.filter(f => f.kind !== 'house' || Math.random() < 0.4).slice(0, 4000);
    for (let k = 0; k < 1500; k++) {
      const f = W.footprints[Math.floor(Math.random() * W.footprints.length)], c = f.pts[Math.floor(Math.random() * f.pts.length)], d = 0.8 + Math.random() * 3, a = Math.random() * 6.28;
      const sp = g.peds.nearestSidewalk(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, 40); if (!sp || Math.hypot(sp.x, sp.z) > g.map.R - 8) continue;   // the player is clamped inside the map radius
      g.player.setPos(sp.x, sp.z); g.cam.yaw = a + Math.PI * (k % 2); g.cam.pitch = 0.2 + (k % 4) * 0.1; g.cam.di = k % 3; n++;
      T.run(4);
      const p = g.camera.position;
      if (W.insideBuilding(p.x, p.z) && !W.insideBuilding(sp.x, sp.z)) out.push(`cam inside building near ${sp.x | 0},${sp.z | 0}`);
      if (p.y < 0.3) out.push('cam below ground');
    }
    return { n, out: [...new Set(out)].slice(0, 5), total: out.length };
  });
  assert(bad.n > 800 && bad.total === 0, JSON.stringify(bad));
});

test('camera + frame stay valid when entering/leaving every vehicle type, dying, and respawning', async () => {
  await reset(); await G(() => window.__test.setTime(13));
  const bad = await G(() => {
    const g = window.__game, T = window.__test, P = g.player, out = [];
    const types = [...new Set(g.vehicles.map(v => v.type).concat(['sedan', 'hatch', 'suv', 'pickup', 'van', 'bus', 'taxi', 'muscle', 'compact', 'motorcycle', 'bicycle']))];
    for (const t of types) {
      try {
        const n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, q => q.type !== 'service'), v = g.spawnVehicle(t, n.px, n.pz, Math.atan2(n.dx, n.dz)); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit(); T.run(20);
        g.post.render(); let s = g.health.sample(); if (g.health.scan(true).length || s.lum < 40) out.push(`${t}: in vehicle lum ${s.lum.toFixed(0)} ${g.health.scan(true).join('|')}`);
        v.explode?.(); T.run(10); g.exitVehicle?.(true); T.run(5); g.post.render(); s = g.health.sample(); if (s.lum < 40) out.push(`${t}: after explode/exit lum ${s.lum.toFixed(0)}`);
        g.removeVehicle(v);
      } catch (e) { out.push(`${t}: ${e.message}`); }
    }
    P.damage(999); T.run(120); g.post.render(); const s = g.health.sample(); if (s.lum < 40) out.push(`after death lum ${s.lum.toFixed(0)}`);
    return out;
  });
  assert(!bad.length, bad.slice(0, 5).join('; '));
});

test('every InstancedMesh and static mesh has finite matrices / bounding spheres and a sane instance count', async () => {
  const r = await G(() => {
    const g = window.__game, out = []; let inst = 0, meshes = 0;
    g.scene.traverse(o => {
      if (o.isInstancedMesh) { inst++;
        if (!(o.count > 0) && !/lamp|sign/i.test(o.name || '')) out.push(`instanced count ${o.count} ${o.name || o.geometry.type}`);
        const a = o.instanceMatrix.array; for (let i = 0; i < Math.min(a.length, o.count * 16); i += 16 * 7) { if (!Number.isFinite(a[i] + a[i + 5] + a[i + 10] + a[i + 12] + a[i + 13] + a[i + 14])) { out.push('NaN instance matrix in ' + (o.name || o.geometry.type)); break; } }
        if (o.boundingSphere && !(Number.isFinite(o.boundingSphere.radius) && o.boundingSphere.radius > 0)) out.push('bad instanced bounding sphere');
      } else if (o.isMesh && o.geometry?.boundingSphere) { meshes++; const b = o.geometry.boundingSphere; if (!Number.isFinite(b.radius + b.center.x + b.center.y + b.center.z)) out.push('NaN bounding sphere'); }
      if (o.isMesh && !Number.isFinite(o.matrixWorld.elements[12] + o.matrixWorld.elements[13] + o.matrixWorld.elements[14])) out.push('NaN matrixWorld');
    });
    return { inst, meshes, out: [...new Set(out)].slice(0, 6) };
  });
  assert(r.inst > 20 && !r.out.length, JSON.stringify(r));
});

test('light count is constant and capped through a 5-star chase, explosions and headlights at night', async () => {
  await live(22);
  const r = await G(async () => {
    const g = window.__game, T = window.__test, wait = (ms) => new Promise(r => setTimeout(r, ms)); const counts = new Set(), act = []; let progs0 = null;
    const P = g.player, n = g.map.nearestRoad(P.pos.x, P.pos.z, 80, q => q.type !== 'service'), v = g.spawnVehicle('sedan', n.px, n.pz, Math.atan2(n.dx, n.dz)); P.setPos(v.pos.x + 1.5, v.pos.z); g.tryEnterExit();
    g.police.setWanted(5); progs0 = g.renderer.info.programs.length;
    for (let i = 0; i < 8; i++) { T.explodeNearCamera(10); g.testFrozen = false; await wait(350); let L = 0, A = 0; g.scene.traverse(o => { if (o.isLight) { L++; if (o.visible && o.intensity > 0) A++; } }); counts.add(L); act.push(A); }
    g.police.setWanted(0);
    return { counts: [...counts], maxActive: Math.max(...act), progsDelta: g.renderer.info.programs.length - progs0 };
  });
  assert(r.counts.length === 1 && r.maxActive <= 8, JSON.stringify(r));
});

// ---------------------------------------------------------------- E. the NaN-traffic bug seen in live play (ramps -> NaN cars -> NaN spreads to the player's car and camera)
test('speed table covers every road type in the map (a missing entry gave undefined * x = NaN)', async () => {
  const r = await G(async () => {
    const { SPEED, speedFor } = await import('./src/mapdata.js'), g = window.__game;
    const types = [...new Set(g.data.roads.map(r => r.type))], trafficTypes = [...new Set(g.traffic.edges.map(e => e.road.type))];
    return { missing: types.filter(t => !(t in SPEED) && g.traffic.edges.some(e => e.road.type === t)), bad: trafficTypes.filter(t => !(speedFor(t) > 0)), unknown: speedFor('made_up_road') };
  });
  assert(!r.missing.length && !r.bad.length && r.unknown > 0, JSON.stringify(r));
});

test('traffic driving over every highway ramp / link road stays finite and moves (before the fix these cars became NaN)', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, T = window.__test, P = g.player; g.settings.density = 0;
    const byRoad = new Map(); for (const e of g.traffic.edges) if (/_link$/.test(e.road.type) && !byRoad.has(e.road)) byRoad.set(e.road, e);
    const types = new Set(), bad = []; let tested = 0, moved = 0; const nan0 = g.health.status().nan.count, cull0 = g.traffic.nanCulls || 0;
    for (const e of byRoad.values()) {
      for (const v of g.traffic.list.slice()) { g.traffic.list.splice(g.traffic.list.indexOf(v), 1); g.removeVehicle(v); }
      const car = g.traffic.make(e, Math.min(5, e.len * 0.2), 'sedan'); P.setPos(car.pos.x + 30, car.pos.z + 30);
      const x0 = car.pos.x, z0 = car.pos.z; T.run(150); tested++; types.add(e.road.type);
      if (!g.vehicles.includes(car)) { bad.push(e.road.type + ': car was removed'); continue; }
      if (!Number.isFinite(car.pos.x + car.pos.z + car.vx + car.vz)) bad.push(e.road.type + ': NaN'); else if (Math.hypot(car.pos.x - x0, car.pos.z - z0) > 3) moved++;
    }
    return { tested, moved, types: [...types], bad, nan: g.health.status().nan.count - nan0, culls: (g.traffic.nanCulls || 0) - cull0 };
  });
  assert(r.tested >= 8 && r.types.length >= 3 && !r.bad.length && r.nan === 0 && r.culls === 0 && r.moved >= r.tested * 0.6, JSON.stringify(r));
});

test('one NaN car in a crowd around the player is removed and cannot spread NaN to the player, the cops or the camera', async () => {
  await reset(); await G(() => window.__test.setTime(13));
  const r = await G(() => {
    const g = window.__game, T = window.__test, P = g.player; g.settings.density = 0;
    const n = g.map.nearestRoad(P.pos.x, P.pos.z, 200, q => q.type !== 'service');
    const mine = g.spawnVehicle('sedan', n.px, n.pz, Math.atan2(n.dx, n.dz)); P.setPos(mine.pos.x + 1.5, mine.pos.z); g.tryEnterExit();
    const crowd = []; for (let i = 0; i < 6; i++) { const v = g.spawnVehicle(['suv', 'bus', 'sedan', 'van', 'muscle', 'taxi'][i], mine.pos.x + (i - 2.5) * 2.2, mine.pos.z + 2 + (i % 2) * 3, 0); crowd.push(v); }
    g.police.setWanted(3); T.run(20);
    const e = g.traffic.edges.find(q => Math.hypot(q.pts[0][0] - mine.pos.x, q.pts[0][1] - mine.pos.z) < 300) || g.traffic.edges[0], tcar = g.traffic.make(e, e.len * 0.5, 'sedan');
    tcar.pos.set(mine.pos.x + 3, 0, mine.pos.z + 6); tcar.mode = 'kinematic';
    const bomb = crowd[2]; bomb.pos.x = NaN; bomb.vx = NaN; bomb.vz = NaN; tcar.pos.x = NaN;     // two "first bad cars": a physics car and a traffic car
    const nan0 = g.health.status().nan.count, cull0 = g.traffic.nanCulls || 0; T.run(90);
    const all = g.vehicles.filter(v => !Number.isFinite(v.pos.x + v.pos.z + v.vx + v.vz));
    const c = g.camera.position;
    return { badVehicles: all.length, playerOk: Number.isFinite(mine.pos.x + mine.pos.z + mine.vx + mine.vz), camOk: Number.isFinite(c.x + c.y + c.z), guardFired: g.health.status().nan.count - nan0, culled: (g.traffic.nanCulls || 0) - cull0, healed: bomb.nanResets || 0, scan: g.health.scan(true) };
  });
  // guardFired === 0: the lower layers (vehicle self-heal, traffic cull, collision checks) stop NaN before the frame-level guard has to repair it
  assert(r.playerOk && r.camOk && r.badVehicles === 0 && !r.scan.length && r.guardFired === 0 && r.culled === 1 && r.healed >= 1, JSON.stringify(r));
});

test('a vehicle with NaN velocity and position heals itself in one update instead of keeping NaN', async () => {
  await reset();
  const r = await G(() => {
    const g = window.__game, P = g.player, n = g.map.nearestRoad(P.pos.x, P.pos.z, 100, q => q.type !== 'service'), v = g.spawnVehicle('sedan', n.px, n.pz, 0);
    v.update(1 / 30, { throttle: 1, steer: 0 }); v.vx = NaN; v.pos.z = NaN; v.heading = Infinity; v.update(1 / 30, { throttle: 1, steer: 0 });
    return { finite: Number.isFinite(v.pos.x + v.pos.z + v.vx + v.vz + v.heading), resets: v.nanResets };
  });
  assert(r.finite && r.resets === 1, JSON.stringify(r));
});

test('collision grid never hangs or hits on NaN / Infinity / absurd inputs (Infinity used to loop forever)', async () => {
  const r = await G(() => {
    const grid = window.__game.world.grid, out = [], t0 = performance.now();
    for (const v of [NaN, Infinity, -Infinity, 1e300, 1e9]) {
      out.push(grid.push(v, 0, 0.5).hit, grid.push(0, v, 0.5).hit, grid.near(v, v, 2), grid.ray(v, 0, 1, 0, 50), grid.ray(0, 0, 1, 0, v), grid.ray(0, 0, v, 0, 50));
    }
    const normal = grid.ray(0, 0, 1, 0, 40);   // ordinary calls still work
    return { ms: Math.round(performance.now() - t0), anyHit: out.some(x => x === true), allInfinityRays: out.filter((x, i) => i % 6 >= 3 && i % 6 <= 4).every(x => x === Infinity || Number.isFinite(x)), normalType: typeof normal };
  });
  assert(r.ms < 1000 && !r.anyHit && r.normalType === 'number', JSON.stringify(r));
});

test('no console errors, page errors or failed requests during the suite (except the faults the tests inject on purpose)', async () => {
  const deliberate = /bad value|black frame|WebGL context lost|post-processing failed|render loop had stopped|perf boom|health boom|Test exception|driver render-to-texture|\[Midlothian\]/;
  const real = H.problems.filter(p => !deliberate.test(p));
  assert(real.length === 0, real.join('\n'));
});
await run('health');
await H.browser.close();
