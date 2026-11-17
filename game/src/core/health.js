// Render health monitor: everything needed to diagnose and survive "the 3D view went black but the HUD still works".
//  - WebGL context loss / restore listeners (+ resume-after-reload when the GPU data cannot be re-uploaded)
//  - black-frame detector with an automatic recovery ladder
//  - NaN / absurd-value guards at checkpoints inside the frame (names the phase that wrote the bad value)
//  - resource watch (renderer.info every 10 s, leak and shader-recompile warnings)
//  - ring buffer of the last 300 game events, last 5 s of frame times
//  - F4 = download a JSON report; also downloaded automatically (once) on a black frame or context loss
// Cheap enough to be always on: one 16x9 canvas copy every 30 frames, ~40 comparisons per checkpoint.
import { events } from './events.js';
import { report, errorLog } from '../ui/errors.js';
import { settings, saveSettings } from '../config/settings.js';

const RING = 300;
const ring = [];
const RECOVER_KEY = 'midlothian-recover', REPORT_KEY = 'midlothian-lastreport';

/** Append to the event ring buffer (cheap; safe to call from anywhere). */
export function logEvent(kind, d) {
  const e = { t: +(performance.now() / 1000).toFixed(2), kind };
  if (d !== undefined) e.d = d;
  ring.push(e); if (ring.length > RING) ring.shift();
}
export const eventRing = () => ring.slice();

let bannerEl = null, bannerT = 0;
export function banner(text, ms = 12000, bad = true) {
  if (typeof document === 'undefined') return;
  if (!bannerEl) {
    bannerEl = document.createElement('div'); bannerEl.id = 'rhbanner';
    bannerEl.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:100000;max-width:80vw;padding:8px 14px;border-radius:6px;font:600 13px Inter,system-ui,sans-serif;color:#fff;pointer-events:none;box-shadow:0 2px 12px #0008;display:none;text-align:center';
    document.body.appendChild(bannerEl);
  }
  bannerEl.textContent = text; bannerEl.style.background = bad ? '#8a1c1c' : '#1c5a8a'; bannerEl.style.display = 'block';
  clearTimeout(bannerT); bannerT = setTimeout(() => { bannerEl.style.display = 'none'; }, ms);
}

const GL_ERRORS = { 0: 'NO_ERROR', 1280: 'INVALID_ENUM', 1281: 'INVALID_VALUE', 1282: 'INVALID_OPERATION', 1285: 'OUT_OF_MEMORY', 1286: 'INVALID_FRAMEBUFFER_OPERATION', 37442: 'CONTEXT_LOST_WEBGL' };
const fin = Number.isFinite;

export class RenderHealth {
  constructor(game) {
    this.g = game; this.canvas = game.renderer.domElement;
    this.ctx = { lost: false, lostCount: 0, restoredCount: 0, lostAt: 0 };
    this.black = { samples: 0, consecutive: 0, events: 0, lastLum: null, recovered: [], unrecovered: 0 };
    this.nan = { count: 0, keys: new Map(), repairs: 0 };
    this.res = []; this.warnings = []; this.frameTimes = [];
    this.frameN = 0; this.lastNow = 0; this.nextRes = 0;
    this.phase = 'init'; this.lastGood = 'init'; this.lastGoodPos = null;
    this.rec = null; this.testBlack = null; this.autoDone = false; this.downloads = 0; this.lastReport = null;
    this.leakStrikes = 0; this.progMax = null; this.wdFrames = -1; this.wdStall = 0; this.loopRestarts = 0;
    this.install();
  }

  install() {
    const g = this.g, c = this.canvas;
    c.addEventListener('webglcontextlost', (e) => this.onLost(e), false);
    c.addEventListener('webglcontextrestored', () => this.onRestored(), false);
    addEventListener('resize', () => logEvent('resize', [innerWidth, innerHeight, +devicePixelRatio.toFixed(2)]));
    document.addEventListener('fullscreenchange', () => logEvent('fullscreen', !!document.fullscreenElement));
    document.addEventListener('visibilitychange', () => logEvent('visibility', document.visibilityState));
    document.addEventListener('pointerlockchange', () => logEvent('pointerlock', document.pointerLockElement === c));
    addEventListener('keydown', (e) => { if (e.code === 'F4') { e.preventDefault(); this.download('manual (F4)'); } }, true);
    for (const n of ['vehicleEnter', 'vehicleExit', 'missionStart', 'missionPass', 'missionFail', 'wasted', 'busted', 'respawn', 'weather', 'explosion', 'vehicleDestroyed', 'wanted', 'paint', 'settings', 'ambient'])
      events.on(n, (d) => logEvent(n, d && typeof d === 'object' ? (d.id || d.kind || d.reason || d.type || d.level || undefined) : d));
    // loop watchdog: if frames stop advancing while the tab is visible and the context is fine, restart the loop
    setInterval(() => {
      if (document.hidden || this.ctx.lost || !g.ready) { this.wdStall = 0; return; }
      if (g.frames === this.wdFrames) { if (++this.wdStall >= 2) { this.wdStall = 0; this.loopRestarts++; logEvent('loop-restart'); report(new Error('render loop had stopped; restarted'), 'watchdog'); g.startLoop?.(); } }
      else this.wdStall = 0;
      this.wdFrames = g.frames;
    }, 1000);
    try { if (localStorage.getItem(REPORT_KEY)) banner('A graphics problem was detected last session. Press F4 to save a report you can send.', 20000, false); } catch (e) { /* no storage */ }
    logEvent('boot', { build: g.BUILD });
  }

  // ---------- context loss ----------
  onLost(e) {
    e.preventDefault();   // allows the browser to restore the context
    this.ctx.lost = true; this.ctx.lostCount++; this.ctx.lostAt = performance.now();
    logEvent('webglcontextlost');
    console.error('[Midlothian] WebGL context lost');
    this.persistRecovery('context-lost');
    banner('Graphics context lost (the browser took the GPU away — memory pressure or too many WebGL tabs). Recovering…', 60000);
    this.autoReport('context-lost');
    // Chrome restores a context lost to a GPU hiccup on its own, but never one it killed because the page had too many WebGL
    // contexts / too much memory. So do not wait forever: if nothing came back, reload and resume where the player was.
    setTimeout(() => {
      if (!this.ctx.lost) return;
      banner('The browser did not give the GPU back. Reloading the game at your position…', 15000);
      if (!this.reloadWithResume('context lost and not restored')) banner('Still no graphics. Press F5 to reload: your progress and position were saved.', 600000);
    }, this.restoreWaitMs ?? 4000);
  }
  onRestored() {
    this.ctx.lost = false; this.ctx.restoredCount++;
    logEvent('webglcontextrestored');
    console.warn('[Midlothian] WebGL context restored');
    const g = this.g;
    // three.js re-creates textures, buffers and programs lazily. Rebuild the pieces that are ours.
    try { g.post.rebuild(); g.sky.refreshEnvironment?.(); g.sky.setTime(g.hour); g.renderer.resetState(); } catch (e) { report(e, 'context-restore'); }
    if (this.staticWorldLost()) {
      // the static world's vertex arrays were freed after upload to save RAM (~160 MB), so they cannot be re-sent
      banner('Graphics restored. Reloading the scene…', 15000, false);
      this.reloadWithResume('context restored but static world GPU data was released');
    } else banner('Graphics restored.', 4000, false);
  }
  staticWorldLost() {
    const w = this.g.scene.getObjectByName('static-world'); let lost = false;
    w?.traverse((o) => { if (!lost && o.isMesh) { const p = o.geometry?.attributes?.position; if (p && !p.array) lost = true; } });
    return lost;
  }

  // ---------- resume after reload ----------
  persistRecovery(reason) {
    const g = this.g; try {
      const v = g.player.vehicle;
      localStorage.setItem(RECOVER_KEY, JSON.stringify({
        t: Date.now(), reason, x: g.focus.x, z: g.focus.z, yaw: g.cam.yaw, hour: g.hour, weather: g.weather?.kind || 'clear',
        wanted: g.police?.wanted || 0, quality: g.post.level, mission: g.missions?.active?.def.id || null,
        vehicle: v ? { type: v.type, heading: v.heading, color: v.color } : null,
      }));
      g.persist?.();
    } catch (e) { /* ignore */ }
  }
  reloadWithResume(reason) {
    // never loop: at most 3 reloads per minute
    let n = 0; try { const a = JSON.parse(sessionStorage.getItem('midlothian-reloads') || '[]').filter((t) => Date.now() - t < 60000); a.push(Date.now()); n = a.length; sessionStorage.setItem('midlothian-reloads', JSON.stringify(a)); } catch (e) { /* ignore */ }
    if (n > 3) { banner('Graphics keep failing. Press F4 to save a report, lower Graphics quality (G) and press F5.', 600000); return false; }
    this.persistRecovery(reason); logEvent('reload-resume', reason);
    const u = new URL(location.href); u.searchParams.set('resume', '1'); u.searchParams.set('title', '0'); u.searchParams.delete('newgame');
    setTimeout(() => location.replace(u.toString()), 150);
    return true;
  }
  /** Called once at startup when the URL has ?resume=1: put the player back where they were. */
  static readRecovery() {
    try { const r = JSON.parse(localStorage.getItem(RECOVER_KEY) || 'null'); localStorage.removeItem(RECOVER_KEY); return r && Date.now() - r.t < 5 * 60000 ? r : null; } catch (e) { return null; }
  }

  // ---------- NaN / sanity guards ----------
  scan(deep = false) {
    const g = this.g, c = g.camera, bad = [];
    const v3 = (n, v) => { if (!v) return; if (!fin(v.x + v.y + v.z)) bad.push(n + ' non-finite'); else if (Math.abs(v.x) > 1e4 || Math.abs(v.y) > 1e4 || Math.abs(v.z) > 1e4) bad.push(n + ' absurd'); };
    v3('camera.position', c.position);
    const q = c.quaternion; if (!fin(q.x + q.y + q.z + q.w)) bad.push('camera.quaternion non-finite');
    if (!fin(c.fov) || c.fov < 5 || c.fov > 150) bad.push('camera.fov=' + c.fov);
    if (!fin(c.aspect) || c.aspect <= 0) bad.push('camera.aspect=' + c.aspect);
    const pm = c.projectionMatrix.elements; if (!fin(pm[0] + pm[5] + pm[10] + pm[14])) bad.push('camera.projectionMatrix non-finite');
    const cm = g.cam; if (!fin(cm.yaw + cm.pitch + cm.recoil)) bad.push('cam.yaw/pitch/recoil non-finite');
    const P = g.player; v3('player.pos', P.pos); if (!fin(P.y)) bad.push('player.y non-finite');
    const v = P.vehicle; if (v) { v3('vehicle.pos', v.pos); if (!fin(v.vx + v.vz + v.heading + v.y)) bad.push('vehicle velocity/heading/y non-finite'); }
    if (deep) for (const o of g.vehicles) { if (o !== v) { const tag = o.type + (o.ai ? '@' + o.ai.edge.road.type : o.cop ? '@cop' : ''); v3('vehicle[' + tag + '].pos', o.pos); if (!fin(o.vx + o.vz + o.heading)) bad.push('vehicle[' + tag + '] velocity non-finite'); } }
    const s = g.sky; if (s) { v3('sky.dir', s.dir); if (!fin(s.sun.intensity)) bad.push('sun.intensity=' + s.sun.intensity); }
    const ex = g.renderer.toneMappingExposure; if (!fin(ex) || ex < 0.02) bad.push('exposure=' + ex);
    const f = g.scene.fog; if (f) { if (!fin(f.near + f.far) || f.far <= f.near) bad.push(`fog near/far=${f.near}/${f.far}`); if (!fin(f.color.r + f.color.g + f.color.b)) bad.push('fog.color non-finite'); }
    const pr = g.renderer.getPixelRatio(); if (!fin(pr) || pr <= 0) bad.push('pixelRatio=' + pr);
    if (!(this.canvas.width > 0 && this.canvas.height > 0)) bad.push(`canvas size ${this.canvas.width}x${this.canvas.height}`);
    return bad;
  }
  /** Called at a few points inside update(). The first checkpoint that sees a bad value names where it was written. */
  check(name, deep = false) {
    this.phase = name;
    const bad = this.scan(deep);
    if (!bad.length) { this.lastGood = name; if (name === 'camera') this.rememberPos(); return true; }
    const key = bad[0].replace(/\[[^\]]*\]/g, '[]'), first = !this.nan.keys.has(key);
    this.nan.count++; this.nan.keys.set(key, (this.nan.keys.get(key) || 0) + 1);
    if (first) {   // one short banner per kind of problem; the full list goes to the event log / F4 report
      logEvent('nan-guard', `${bad.join('; ').slice(0, 700)} | after "${name}", last clean "${this.lastGood}"`);
      report(new Error(`bad value (${bad.length}): ${bad[0]}${bad.length > 1 ? ` +${bad.length - 1} more` : ''}; first seen after "${name}", last clean "${this.lastGood}"`), 'health');
    }
    this.repair(bad);
    return false;
  }
  rememberPos() { const g = this.g, v = g.player.vehicle; this.lastGoodPos = { x: g.focus.x, z: g.focus.z, h: v ? v.heading : g.player.yaw || 0 }; }
  repair(bad) {
    const g = this.g, P = g.player, lg = this.lastGoodPos || { x: g.spawnPoint?.x || 0, z: g.spawnPoint?.z || 0, h: 0 };
    this.nan.repairs++;
    const has = (s) => bad.some((b) => b.startsWith(s));
    if (has('player.') || has('vehicle')) {
      const v = P.vehicle;
      if (v) { v.vx = v.vz = 0; v.vy = 0; v.yawRate = 0; v.setPose(lg.x, lg.z, fin(lg.h) ? lg.h : 0); }
      else P.setPos(lg.x, lg.z);
      for (const o of g.vehicles) if (o !== v && !fin(o.pos.x + o.pos.z + o.vx + o.vz)) { o.vx = o.vz = 0; o.setPose(lg.x + 30, lg.z + 30, 0); }
    }
    if (has('camera') || has('cam.')) g.resetCameraSafe?.();
    if (has('sky.') || has('sun.') || has('exposure') || has('fog')) g.resetLighting?.();
    if (has('canvas') || has('pixelRatio')) g.applySize?.();
  }

  // ---------- per frame ----------
  afterRender(now) {
    const g = this.g;
    if (this.lastNow) { this.frameTimes.push([Math.round(now), +(now - this.lastNow).toFixed(1)]); while (this.frameTimes.length && now - this.frameTimes[0][0] > 5000) this.frameTimes.shift(); }
    this.lastNow = now;
    if (this.testBlack) this.blankCanvas();
    if (++this.frameN % 30 === 0 && !this.ctx.lost) this.blackFrameTick();
    if (this.rec) this.recoveryTick();
    if (now >= this.nextRes) { this.nextRes = now + 10000; if (this.nextRes > 10000) this.watchResources(now); }
  }
  /** Test hook: simulate a GPU returning black by painting the canvas black after the real render. */
  blankCanvas() { const r = this.g.renderer; r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); }
  sample() {
    const c2 = this.probe || (this.probe = document.createElement('canvas')); c2.width = 16; c2.height = 9;
    const x = this.probeCtx || (this.probeCtx = c2.getContext('2d', { willReadFrequently: true }));
    x.drawImage(this.canvas, 0, 0, 16, 9);
    const d = x.getImageData(0, 0, 16, 9).data; let s = 0, mx = 0;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; s += l; if (l > mx) mx = l; }
    return { lum: s / 144, max: mx };
  }
  isBlack(s) { return s.lum < 2 && s.max < 6; }
  blackFrameTick() {
    const g = this.g, B = this.black;
    // only judge frames that should be bright: daytime, in play, not paused / on the map, tab visible
    if (g.paused || g.state !== 'play' || g.fullmap.open || document.hidden || g.sky.day < 0.5 || this.rec) { B.consecutive = 0; return; }
    let s; try { s = this.sample(); } catch (e) { return; }
    B.samples++; B.lastLum = +s.lum.toFixed(2);
    if (this.isBlack(s)) B.consecutive++; else B.consecutive = 0;
    if (B.consecutive >= 3) {
      B.consecutive = 0; B.events++;
      const info = { lum: B.lastLum, hour: +g.hour.toFixed(1), weather: g.weather?.kind, quality: g.post.level, pos: [Math.round(g.focus.x), Math.round(g.focus.z)] };
      logEvent('BLACK-FRAME', info); console.error('[Midlothian] black frame detected', info);
      report(new Error('black frame detected (3 samples)'), 'health');
      banner('The 3D view went black — trying to recover. A diagnostic report was saved.', 15000);
      this.autoReport('black-frame');
      this.startRecovery();
    }
  }

  // ---------- recovery ladder ----------
  startRecovery() {
    const g = this.g;
    this.rec = { i: 0, wait: 0, steps: [
      ['reset-camera', () => g.resetCameraSafe()],
      ['reset-lighting', () => g.resetLighting()],
      ['rebuild-post-targets', () => { g.post.rebuild(); g.renderer.resetState(); }],
      ['lower-quality', () => { if (g.post.level > 0) { g.post.set(g.post.level - 1); settings.quality = g.post.level; saveSettings(); } }],
      ['reload', () => { this.black.unrecovered++; this.reloadWithResume('black frame, ladder exhausted'); }],
    ] };
  }
  recoveryTick() {
    const r = this.rec; if (--r.wait > 0) return;
    if (r.i > 0) {   // did the previous step fix it?
      let s; try { s = this.sample(); } catch (e) { s = { lum: 99, max: 255 }; }
      if (!this.isBlack(s)) { const name = r.steps[r.i - 1][0]; this.black.recovered.push(name); logEvent('recovered', name); banner(`3D view recovered (step: ${name}).`, 6000, false); this.rec = null; return; }
    }
    if (r.i >= r.steps.length) { this.rec = null; return; }
    const [name, fn] = r.steps[r.i++]; logEvent('recovery-step', name);
    if (this.testBlack === name) this.testBlack = null;   // test hook: pretend this step cures the fake black screen
    try { fn(); } catch (e) { report(e, 'recovery:' + name); }
    r.wait = 12;
  }

  // ---------- resource watch ----------
  watchResources(now) {
    const g = this.g, i = g.renderer.info, m = i.memory, r = i.render, heap = performance.memory?.usedJSHeapSize;
    let lights = 0, active = 0; g.scene.traverse((o) => { if (o.isLight) { lights++; if (o.visible && o.intensity > 0) active++; } });
    const s = { t: +(now / 1000).toFixed(1), geometries: m.geometries, textures: m.textures, programs: i.programs ? i.programs.length : null, calls: r.calls, triangles: r.triangles, lights, lightsActive: active, heapMB: heap ? Math.round(heap / 1048576) : null, peds: g.peds.list.length, traffic: g.traffic.list.length, vehicles: g.vehicles.length };
    this.res.push(s); if (this.res.length > 360) this.res.shift();
    console.info('[Midlothian] resources ' + JSON.stringify(s));
    const n = this.res.length;
    if (n >= 7) {   // steady growth over the last minute, three windows in a row
      const a = this.res[n - 7], dT = s.textures - a.textures, dG = s.geometries - a.geometries;
      if (dT > 20 || dG > 40) { if (++this.leakStrikes === 3) this.warn(`steady GPU resource growth: textures +${dT}, geometries +${dG} per minute`); } else this.leakStrikes = 0;
    }
    if (s.programs != null) {
      if (n === 6) this.progMax = s.programs;   // baseline after one minute
      else if (this.progMax != null && s.programs > this.progMax) { this.warn(`shader program count climbed ${this.progMax} -> ${s.programs} (recompiles)`); this.progMax = s.programs; }
    }
    if (active > 8) this.warn(`${active} active lights (more than the 8 the shaders are built for)`);
  }
  warn(msg) { if (this.warnings.length < 50) this.warnings.push({ t: +(performance.now() / 1000).toFixed(1), msg }); logEvent('warning', msg); console.warn('[Midlothian] ' + msg); }

  // ---------- report ----------
  buildReport(reason) {
    const g = this.g, gl = g.renderer.getContext(), i = g.renderer.info;
    let gpu = {}; try {
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = { vendor: e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : null, renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null, version: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxSamples: gl.getParameter(gl.MAX_SAMPLES), attributes: gl.getContextAttributes() };
    } catch (err) { gpu.error = String(err); }
    let glError = null; try { const code = gl.getError(); glError = `${GL_ERRORS[code] || code} (${code})`; } catch (err) { glError = 'threw: ' + err.message; }
    const v3 = (v) => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    let previousSession = null; try { previousSession = JSON.parse(localStorage.getItem(REPORT_KEY) || 'null'); } catch (e) { /* ignore */ }
    const mem = performance.memory;
    return {
      reason, createdAt: new Date().toISOString(), build: g.BUILD, userAgent: navigator.userAgent, platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null,
      gpu, glError, contextLost: { now: g.renderer.getContext().isContextLost?.() ?? null, ...this.ctx },
      canvas: { width: this.canvas.width, height: this.canvas.height, clientWidth: this.canvas.clientWidth, clientHeight: this.canvas.clientHeight },
      window: { inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], devicePixelRatio, visualViewport: visualViewport ? [visualViewport.width, visualViewport.height, visualViewport.scale] : null, fullscreen: !!document.fullscreenElement, visibility: document.visibilityState },
      quality: g.post.level, post: g.post.status(), time: { hour: +g.hour.toFixed(2), weather: g.weather?.kind, overcast: g.sky.overcast ?? null, gameSeconds: +g.time.toFixed(1) },
      player: { pos: v3(g.player.pos), vehicle: g.player.vehicle ? { type: g.player.vehicle.type, pos: v3(g.player.vehicle.pos), speed: +g.player.vehicle.speed.toFixed(1) } : null, state: g.state, wanted: g.police?.wanted },
      camera: { pos: v3(g.camera.position), fov: g.camera.fov, near: g.camera.near, far: g.camera.far, state: { ...g.cam, dist: undefined }, },
      renderer: { memory: { ...i.memory }, render: { ...i.render }, programs: i.programs ? i.programs.length : null, exposure: g.renderer.toneMappingExposure, pixelRatio: g.renderer.getPixelRatio(), lights: this.res.at(-1) ? { total: this.res.at(-1).lights, active: this.res.at(-1).lightsActive } : null },
      jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      blackFrames: { ...this.black }, nanGuards: { count: this.nan.count, repairs: this.nan.repairs, kinds: [...this.nan.keys.entries()] }, loopRestarts: this.loopRestarts,
      warnings: this.warnings, resourceHistory: this.res.slice(-30), errors: errorLog(), events: eventRing(), frameTimesLast5s: this.frameTimes.slice(), previousSession,
    };
  }
  download(reason) {
    let rep; try { rep = this.buildReport(reason); } catch (e) { rep = { reason, reportError: String(e && e.stack || e), events: eventRing() }; }
    this.lastReport = rep; this.downloads++;
    const json = JSON.stringify(rep, null, 2);
    try { localStorage.removeItem(REPORT_KEY); } catch (e) { /* ignore */ }
    try {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `midlothian-blackscreen-${(this.g.BUILD || 'build')}-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      banner(`Report saved: ${a.download}. Send me that file.`, 10000, false);
    } catch (e) { report(e, 'report-download'); }
    return rep;
  }
  /** Once per session: remember the report for the next session and download it with a banner. */
  autoReport(reason) {
    if (this.autoDone) return; this.autoDone = true;
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(this.buildReport('auto: ' + reason)).slice(0, 250000)); } catch (e) { /* ignore */ }
    this.download('auto: ' + reason);
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(this.lastReport).slice(0, 250000)); } catch (e) { /* ignore */ }   // keep it for the next session as well
  }

  status() {
    return { ctx: { ...this.ctx }, black: { ...this.black, recovered: [...this.black.recovered] }, nan: { count: this.nan.count, repairs: this.nan.repairs, kinds: [...this.nan.keys.keys()] }, warnings: this.warnings.length, programs: this.res.at(-1)?.programs ?? null, loopRestarts: this.loopRestarts, downloads: this.downloads };
  }
}
