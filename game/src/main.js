import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { prepareData } from './mapdata.js';
import { buildWorld } from './world/index.js';
import { createSky } from './sky.js';
import { createPost, QUALITY } from './post.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { Player } from './player.js';
import { PedManager, Ped } from './peds.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Pickups } from './pickups.js';
import { MissionManager } from './missions/manager.js';
import { Vehicle } from './entities/vehicle.js';
import { MATS } from './entities/carmodels.js';
import { HUD } from './ui/hud.js';
import { FullMap } from './ui/fullmap.js';
import { Menu } from './ui/menu.js';
import { Phone } from './ui/phone.js';
import { PadNav } from './ui/padnav.js';
import { SettingsUI } from './ui/settings.js';
import { WeaponWheel } from './ui/weaponwheel.js';
import { Title } from './ui/title.js';
import { clamp, shortestAngle, cumLen } from './util.js';
import { installErrorHandling, report } from './ui/errors.js';
import { RenderHealth, logEvent } from './core/health.js';
import { Perf, DebugPanel } from './ui/debug.js';
import { installTestHooks } from './testhooks.js';
import { zones } from './config/zones.js';
import { settings } from './config/settings.js';
import { brandName } from './config/brand.js';
import { events } from './core/events.js';
import { loadSave, blankSave, applySave, writeSave } from './save.js';
import { Weather } from './systems/weather.js';
import { Projectiles } from './systems/projectiles.js';
import { Places } from './systems/places.js';
import { Garage } from './systems/garage.js';
import { Stunts } from './systems/stunts.js';
import { Collectibles } from './systems/collectibles.js';
import { Ambient } from './systems/ambient.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const STEPS = ['Downloading map', 'Painting textures', 'Laying ground', 'Paving roads', 'Raising buildings', 'Planting trees', 'Building meshes', 'Lighting the sky', 'Spawning people'];
const step = async (s) => {
  $('loadstep').textContent = s;
  const i = STEPS.indexOf(s); if (i >= 0) $('loadbar').firstElementChild.style.width = `${Math.round((i + 1) / (STEPS.length + 1) * 100)}%`;
  await new Promise(r => setTimeout(r, 0));
};
const SENS = 0.0022;
const BUILD = 'p5-bh1-2026-11-16';   // bh = black-screen hunt: render health monitor, F4 report, post-processing leak fix
document.getElementById('ver').textContent = `build ${BUILD}`;
const CARJACK_LINES = ['Hey! That\'s my car!', 'Take it, take it!', 'You\'ll regret this!', 'Not again...', 'I just washed that!'];

class Game {
  async init() {
    this.BUILD = BUILD; this.PedClass = Ped; this.zones = zones; this.events = events; this.settings = settings;
    if (params.get('test') === '1' && params.has('crash')) throw new Error('Test crash during startup');
    await step('Downloading map');
    this.data = await (await fetch('data/midlothian.json')).json();
    this.map = prepareData(this.data);
    this.save = (params.get('newgame') ? null : loadSave()) || blankSave();
    this.stats = this.save.stats;
    const canvas = $('c');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('steps') });
    this.renderer.info.autoReset = false;   // count draw calls across all post-processing passes per frame
    this.perf = new Perf();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.25, 2500);
    await step('Painting textures');
    this.T = makeTextures(this.renderer);
    this.world = await buildWorld(this.scene, this.map, this.T, step);
    await step('Lighting the sky');
    this.sky = createSky(this.scene, this.renderer, this.T);
    this.hour = parseFloat(params.get('t') ?? this.save.hour ?? '15.5');
    this.sky.setTime(this.hour);
    this.post = createPost(this.renderer, this.scene, this.camera, this.sky);
    this.post.set(+(params.get('q') ?? settings.quality));
    this.input = new Input(canvas);
    this.audio = new Audio(); this.effects = new Effects(this.scene);
    this.time = 0; this.state = 'play'; this.shake = 0; this.vehicles = []; this.route = null; this.waypoint = null; this.focus = new THREE.Vector3();
    await step('Spawning people');
    this.player = new Player(this);
    this.combat = new Combat(this);
    this.cam = { yaw: 0, pitch: 0.2, dist: [3.4, 4.6, 2.6], di: 0, lookT: 0, recoil: 0 };
    this.peds = new PedManager(this);
    this.spawnPoint = this.findSpawn();
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.hud = new HUD(this);
    this.projectiles = new Projectiles(this);
    this.weather = new Weather(this, params.get('weather') || this.save.weather || 'clear');
    this.places = new Places(this);
    { const home = this.places.get('safehouse'); if (home) this.spawnPoint = { x: home.pos.x, z: home.pos.z }; }   // you start at your safehouse
    this.garage = new Garage(this);
    this.pickups = new Pickups(this);
    this.missions = new MissionManager(this);
    this.stunts = new Stunts(this);
    this.collectibles = new Collectibles(this);
    this.ambient = new Ambient(this);
    this.fullmap = new FullMap(this);
    this.menu = new Menu(this); this.phone = new Phone(this); this.settingsUI = new SettingsUI(this); this.wheel = new WeaponWheel(this);
    applySave(this, this.save);
    this.hud.shownMoney = this.player.money;
    // a bicycle at the safehouse and a motorcycle at the gas station, always there
    for (const [kind, type] of [['safehouse', 'bicycle'], ['gas', 'motorcycle']]) {
      const p = this.places.get(kind); if (!p) continue;
      const n = this.map.nearestRoad(p.pos.x, p.pos.z, 60, r => r.type !== 'service' || kind === 'gas');
      if (!n) continue;
      // first spot near the place that isn't taken by a parked car, another vehicle or a wall
      const bx = p.pos.x + (n.px - p.pos.x) * 0.5, bz = p.pos.z + (n.pz - p.pos.z) * 0.5, free = (x, z) => this.world.clear(x, z, 1) &&
        !this.world.parked.some(pc => pc.active && Math.hypot(pc.x - x, pc.z - z) < 4.5) && !this.vehicles.some(o => Math.hypot(o.pos.x - x, o.pos.z - z) < 4.5);
      let spot = null;
      for (let k = 0; k < 24 && !spot; k++) { const along = ((k >> 1) + 1) * 2.5 * (k % 2 ? -1 : 1) * (k < 12 ? 1 : 0), side = k < 12 ? 2 : (k - 12) * 0.6 - 3; const x = bx + n.dx * along - n.dz * side, z = bz + n.dz * along + n.dx * side; if (free(x, z)) spot = [x, z]; }
      const v = this.spawnVehicle(type, ...(spot || [bx + 2, bz]), Math.atan2(n.dx, n.dz));
      v.persistent = true;
    }
    // shared headlight beams that follow whatever the player drives (constant light count = no shader recompiles)
    this.heads = [0, 1].map(() => { const l = new THREE.SpotLight(0xfff1d6, 0, 75, 0.48, 0.55, 1.1); this.scene.add(l, l.target); return l; });
    this.spawnPlayer(true);
    // Pause screen: only reappears when the player deliberately leaves mouse lock (Esc) after playing a moment.
    this.input.onLock = (l) => {
      if (this.fullmap.open || this.menu.open || this.phone.open || this.settingsUI.open || this.title?.open) return;
      if (l) { this.lockedAt = performance.now(); return; }
      if (this.lockedAt && performance.now() - this.lockedAt > 800 && this.state === 'play') this.pause(true);
      this.lockedAt = 0;
    };
    this.debug = new DebugPanel(this);
    addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.debug.toggle(); } });
    this.title = new Title(this); this.padnav = new PadNav(this);
    // resize / fullscreen / pixel-ratio changes: debounced, never applies a 0 size, resizes render targets in place
    const queueSize = () => { clearTimeout(this._sizeT); this._sizeT = setTimeout(() => this.applySize(), 120); };
    addEventListener('resize', queueSize); document.addEventListener('fullscreenchange', queueSize);
    const watchDpr = () => { const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); mq.addEventListener?.('change', () => { queueSize(); watchDpr(); }, { once: true }); };
    try { watchDpr(); } catch (e) { /* matchMedia not available */ }
    this.health = new RenderHealth(this);
    events.on('settings', () => { this.audio.setVolume(settings.volume); });
    $('loading').style.display = 'none';
    this.ready = true; this.frames = 0;
    if (params.has('resume')) this.applyRecovery(RenderHealth.readRecovery());
    $('loadbar').firstElementChild.style.width = '100%';
    console.log('Midlothian build', BUILD, `ready: ${this.data.buildings.length} buildings, ${this.world.treeCount} trees, ${this.world.parked.length} parked cars, ${this.world.tris | 0} tris`);
  }
  // ---------- start / pause ----------
  /** Hide menus and start playing. Hiding comes first; audio and pointer lock can fail without blocking play. */
  start() {
    $('overlay').style.display = 'none'; this.title?.hide(); this.paused = false; if (this.state === 'title') this.state = 'play';
    try { this.audio.init(); this.audio.setVolume(settings.volume); } catch (e) { report(e, 'audio init'); }
    try { this.input.lock(); } catch (e) { /* lock denied: drag-to-look still works */ }
  }
  pause(on) { logEvent(on ? 'pause' : 'resume-play'); this.paused = on; $('overlay').style.display = on ? 'flex' : 'none'; if (on) writeSave(this); }
  persist() { writeSave(this); }
  /** After a graphics reset reload (?resume=1): put the player back where they were. */
  applyRecovery(r) {
    if (!r) return;
    try {
      this.hour = r.hour ?? this.hour; this.sky.setTime(this.hour); if (r.weather) this.weather.set(r.weather, true);
      this.spawnPlayer(false, { x: r.x, z: r.z }); this.cam.yaw = r.yaw ?? this.cam.yaw;
      if (r.vehicle) { const v = this.spawnVehicle(r.vehicle.type, r.x, r.z, r.vehicle.heading, r.vehicle.color); this.player.setPos(v.pos.x + 1.5, v.pos.z); this.tryEnterExit(); }
      if (r.wanted) this.police.setWanted(Math.min(r.wanted, 2));
      logEvent('resumed', { reason: r.reason, x: Math.round(r.x), z: Math.round(r.z), vehicle: r.vehicle?.type || null });
      this.hud.toast(`Recovered from a graphics reset${r.mission ? ` (mission cancelled)` : ''}`);
    } catch (e) { report(e, 'resume'); }
  }
  /** Apply the current window size to camera + renderer + post targets (ignores a 0 / minimised size). */
  applySize() {
    if (!(innerWidth > 8 && innerHeight > 8)) return;
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.post.resize();
  }
  /** Black-screen recovery: put the camera right behind the player with sane lens and state. */
  resetCameraSafe() {
    const P = this.player, v = P.vehicle, c = this.cam, cam = this.camera;
    c.recoil = 0; c.pitch = 0.2; c.di = 0; c.lookT = 0; c.yaw = Number.isFinite(v ? v.heading : P.yaw) ? (v ? v.heading : P.yaw) : 0;
    cam.fov = 65; cam.aspect = innerWidth > 8 && innerHeight > 8 ? innerWidth / innerHeight : 16 / 9; cam.near = 0.25; cam.far = 2500; cam.up.set(0, 1, 0); cam.updateProjectionMatrix();
    const f = v ? v.pos : P.pos; const fx = Number.isFinite(f.x) ? f.x : 0, fz = Number.isFinite(f.z) ? f.z : 0;
    cam.position.set(fx - Math.sin(c.yaw) * 5, 3, fz - Math.cos(c.yaw) * 5); cam.lookAt(fx, 1.5, fz); cam.updateMatrixWorld(true);
    logEvent('camera-reset');
  }
  /** Black-screen recovery: exposure, fog and sun back to their defaults for the current time of day. */
  resetLighting() {
    this.renderer.toneMappingExposure = 0.62;
    const f = this.scene.fog; if (f) { f.near = 260; f.far = 1900; }
    if (!Number.isFinite(this.hour)) this.hour = 15.5;
    this.sky.refreshEnvironment?.(); this.sky.setTime(this.hour);
    logEvent('lighting-reset');
  }
  addMoney(n) { this.player.money = Math.max(0, this.player.money + n); events.emit('money', { delta: n, total: this.player.money }); }
  skipHours(h) { logEvent('time-skip', h); this.hour = (this.hour + h) % 24; this.sky.setTime(this.hour); this.hud.toast(`${Math.floor(this.hour)}:00`); }
  openMap() { this.fullmap.toggle(true); document.exitPointerLock?.(); if (this.state === 'play') this.state = 'map'; }
  brand(name, kind) { return kind === 'building' ? brandName(name) : name; }

  findSpawn() {
    for (const r of [60, 120, 200, 320]) { const sp = this.peds.nearestSidewalk(Math.cos(r) * r + 120, Math.sin(r) * r - 80, 120); if (sp && !zones.nearSafeZone(sp.x, sp.z, 20)) return sp; }
    return { x: 120, z: -80 };
  }
  spawnPlayer(first, at = null) {
    const sp = at || this.spawnPoint;
    const P = this.player; P.vehicle = null; P.h.visible = true; P.health = 100; P.setPos(sp.x, sp.z);
    const near = this.map.nearestRoad(sp.x, sp.z, 40, r => r.type !== 'service');
    if (near) {
      P.yaw = Math.atan2(near.px - sp.x, near.pz - sp.z); this.cam.yaw = P.yaw;
      if (first || !this.vehicles.some(v => v.pos.distanceTo(P.pos) < 30)) {
        const side = ((sp.x - near.px) * -near.dz + (sp.z - near.pz) * near.dx) > 0 ? 1 : -1, off = near.road.w / 2 - 1.3;
        this.myCar = this.spawnVehicle('sedan', near.px - near.dz * off * side, near.pz + near.dx * off * side, Math.atan2(near.dx * side, near.dz * side), 0x8a1010);
      }
    }
    if (first) this.hud.help('Welcome to <b>Midlothian</b>.<br><b>F</b> get in the car · <b>M</b> map · <b>P</b> phone · hold <b>Q</b> weapons. Yellow markers are <b>missions</b>.', 10);
  }
  spawnVehicle(type, x, z, h = 0, color = null) { const v = new Vehicle(this, type, color); v.setPose(x, z, h); this.vehicles.push(v); return v; }
  removeVehicle(v) { const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1); if (v !== this.player.vehicle) v.dispose(); }
  crime(kind, pos, victim = null) { this.police.crime(kind, pos, victim); }
  onPedKilled(p, src) {
    if (src === 'player') { this.crime(p.cop ? 'copkill' : 'kill', p.pos, p); this.stats.kills = (this.stats.kills || 0) + 1; if (!p.cop && Math.random() < 0.5) this.pickups.cash(p.pos.x + 0.6, p.pos.z, 10 + Math.floor(Math.random() * 60)); }
    this.peds.panic(p.pos.x, p.pos.z, 40, p.pos);
    events.emit('pedKilled', { ped: p, src });
  }
  onVehicleImpact(v, imp) {
    const P = this.player;
    if (v === P.vehicle) {
      this.shake = Math.max(this.shake, Math.min(0.6, imp / 30));
      if (v.bike && imp > 9) { const vx = v.vx, vz = v.vz; this.exitVehicle(true); P.damage(imp * 1.5); P.knock(vx * 0.7, vz * 0.7, 4); this.hud.toast('You were thrown off!'); }
    }
  }
  explosion(p, src) { logEvent('explosion', [Math.round(p.x), Math.round(p.z), Math.round(p.distanceTo(this.camera.position))]); this.combat.explosion(p, src); if (src === this.player.vehicle) this.crime('explosion', p); }
  recoil(r) { this.cam.recoil += r; }
  setRouteTo(x, z, mission) {
    const f = this.focus, r = this.map.route(f.x, f.z, x, z);
    this.route = r; this.routeMission = mission; this.routeTarget = [x, z]; this.routeT = 2;
    this.routeLength = r ? cumLen(r).at(-1) : Math.hypot(x - f.x, z - f.z);
  }
  setWaypoint(x, z) { this.waypoint = { x, z }; if (!this.missions.active) this.setRouteTo(x, z, false); }
  clearRoute(mission) {
    if (mission) { this.route = null; this.routeMission = false; this.routeTarget = null; if (this.waypoint) this.setRouteTo(this.waypoint.x, this.waypoint.z, false); }
    else { this.waypoint = null; if (!this.routeMission) { this.route = null; this.routeTarget = null; } }
  }

  wasted() {
    if (this.state !== 'play') return; this.state = 'wasted'; this.stateT = 4.5;
    const fee = Math.min(this.player.money, 200);
    this.hud.big('WASTED', `Hospital bill: $${fee}`, 'wasted', 4.5); this.audio.jingle(false);
    this.missions.onWastedOrBusted('You died');
    if (this.player.vehicle) this.exitVehicle(true);
    this.player.h.dead = 0.01; this.pendingFee = fee;
    events.emit('wasted', {});
  }
  busted() {
    if (this.state !== 'play') return; this.state = 'busted'; this.stateT = 4;
    const fee = Math.min(this.player.money, 250);
    this.hud.big('BUSTED', `Fine: $${fee} · weapons confiscated`, 'busted', 4); this.audio.jingle(false);
    this.missions.onWastedOrBusted('You got busted');
    if (this.player.vehicle) this.exitVehicle(true);
    this.pendingFee = fee;
    events.emit('busted', {});
  }
  respawn(kind) {
    const P = this.player;
    this.addMoney(-(this.pendingFee || 0)); this.pendingFee = 0;
    this.police.clearAll();
    if (kind === 'busted') { P.inv = { fists: {} }; P.equip('fists'); }
    P.h.dead = 0; P.armor = 0; this.state = 'play';
    const place = this.places.get(kind === 'busted' ? 'police' : 'hospital');
    this.spawnPlayer(false, place ? { x: place.pos.x, z: place.pos.z } : null); P.health = 100;
    this.hud.toast(kind === 'busted' ? 'Released from the police substation' : `Discharged from ${place ? this.places.display(place) : 'the hospital'}`);
    events.emit('respawn', { kind });
    this.missions.afterRespawn();
    writeSave(this);
  }

  // ---------- vehicles ----------
  tryEnterExit() {
    const P = this.player;
    if (P.vehicle) return this.exitVehicle();
    if (P.ragdoll || P.vault || P.swimming) return;
    let best = null, bd = 3.6;
    for (const v of this.vehicles) { if (v.dead || v.flipped) continue; const d = v.pos.distanceTo(P.pos) - v.radius; if (d < bd) { bd = d; best = v; } }
    for (const pc of this.world.parked) { if (!pc.active) continue; const d = Math.hypot(pc.x - P.pos.x, pc.z - P.pos.z) - 1; if (d < bd) { bd = d; best = pc; } }
    if (!best) return;
    let v = best;
    if (!(best instanceof Vehicle)) {   // break into a parked car
      this.world.hideParked(best); v = this.spawnVehicle(best.type, best.x, best.z, best.heading, best.color);
      this.crime('theft', P.pos); this.hud.toast('Vehicle stolen');
    } else if (v.ai || v.driver === 'npc') {   // carjack: drivers react differently
      const r = [-Math.cos(v.heading), Math.sin(v.heading)], d = new Ped(this, v.pos.x - r[0] * 1.6, v.pos.z - r[1] * 1.6);
      if (Math.random() < 0.2) { d.state = 'hostage'; d.timer = 2; setTimeout(() => d.alive && d.flee(P.pos, 10), 1800); }
      else d.flee(P.pos, 12);
      this.peds.add(d); this.audio.scream(v.pos); this.hud.toast(`"${CARJACK_LINES[Math.floor(Math.random() * CARJACK_LINES.length)]}"`);
      if (v.ai) this.traffic.release(v); this.crime('theft', P.pos, d);
    } else if (v.police) {
      this.police.cars = this.police.cars.filter(c => c !== v); this.crime('copcar', P.pos);
    }
    if (this.police.wanted && P.lastVehicle !== v) this.police.coolOff(5);   // switching cars helps lose the cops
    v.driver = 'player'; v.mode = 'physics'; v.siren = false; v.cop = null; P.vehicle = v; P.lastVehicle = v; P.cover = null;
    P.h.visible = v.bike; this.cam.yaw = v.heading; this.cam.pitch = 0.2;
    events.emit('vehicleEnter', { vehicle: v });
  }
  exitVehicle(force = false) {
    const P = this.player, v = P.vehicle; if (!v) return;
    if (!force && v.speed > 6 && !v.bike) return;
    const r = [-Math.cos(v.heading), Math.sin(v.heading)], f = [Math.sin(v.heading), Math.cos(v.heading)];
    let placed = false;
    for (const [s, a] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const off = s ? v.radius + 0.8 : v.dims.hl + 1, x = v.pos.x + r[0] * s * off + f[0] * a * off, z = v.pos.z + r[1] * s * off + f[1] * a * off;
      if (this.world.clear(x, z, 0.4)) { P.setPos(x, z); placed = true; break; }
    }
    if (!placed) P.setPos(v.pos.x + r[0] * (v.radius + 0.8), v.pos.z + r[1] * (v.radius + 0.8));
    v.driver = null; P.vehicle = null; P.h.visible = true; P.h.root.rotation.set(0, v.heading, 0); P.yaw = v.heading; this.cam.yaw = v.heading;
    events.emit('vehicleExit', { vehicle: v });
  }
  vehicleCollisions() {
    const V = this.vehicles, f = this.focus;
    for (let i = 0; i < V.length; i++) {
      // comparisons are written so that NaN fails them (NaN > 150 is false, which used to let NaN cars through)
      const a = V[i]; if (!(Math.abs(a.pos.x - f.x) <= 150 && Math.abs(a.pos.z - f.z) <= 150) || !Number.isFinite(a.vx + a.vz + a.y)) continue;
      for (let j = i + 1; j < V.length; j++) {
        const b = V[j]; if (!(Math.abs(a.pos.x - b.pos.x) <= 14 && Math.abs(a.pos.z - b.pos.z) <= 14) || !Number.isFinite(b.vx + b.vz + b.y)) continue;
        if (!(Math.abs(a.y - b.y) <= 1.5)) continue;
        const ca = a.circles(), cb = b.circles(), ra = a.radius, rb = b.radius;
        for (const [ax, az] of ca) for (const [bx, bz] of cb) {
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz), m = ra + rb;
          if (!(d < m) || d < 1e-4) continue;
          dx /= d; dz /= d;
          const ma = a.mode === 'kinematic' ? 0 : a.h.mass, mb = b.mode === 'kinematic' ? 0 : b.h.mass;
          const ka = ma ? (mb ? mb / (ma + mb) : 1) : 0, kb = mb ? (ma ? ma / (ma + mb) : 1) : 0;
          const pen = m - d; a.pos.x -= dx * pen * ka; a.pos.z -= dz * pen * ka; b.pos.x += dx * pen * kb; b.pos.z += dz * pen * kb;
          const rel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
          if (rel < 0) {
            const imp = -rel;
            if (ka) { a.vx += dx * rel * ka * 1.2; a.vz += dz * rel * ka * 1.2; }
            if (kb) { b.vx -= dx * rel * kb * 1.2; b.vz -= dz * rel * kb * 1.2; }
            if (imp > 2.5) {
              for (const v of [a, b]) if (v.ai) this.traffic.disturb(v, 'crash');
              if (imp > 4) { a.onImpact(imp, null); b.onImpact(imp, null); }
              const pv = this.player.vehicle; if ((a === pv && b.police) || (b === pv && a.police)) this.crime('copcar', pv.pos);
            }
          }
        }
      }
    }
  }

  // ---------- camera ----------
  updateCamera(dt) {
    const P = this.player, c = this.cam, cam = this.camera, inp = this.input;
    if (inp.pressed('camera')) { c.di = (c.di + 1) % 3; logEvent('camera-mode', c.di); }
    c.recoil *= Math.exp(-9 * dt);
    const sens = SENS * settings.sensitivity, mdx = inp.mdx * sens, mdy = inp.mdy * sens * (settings.invertY ? -1 : 1);
    let target, dist, fov = 65, shoulder = 0;
    if (P.vehicle) {
      const v = P.vehicle, sp = v.speed;
      if (Math.abs(mdx) + Math.abs(mdy) > 0) c.lookT = 1.6; else c.lookT -= dt;
      c.yaw -= mdx; c.pitch = clamp(c.pitch + mdy, -0.1, 1.0);
      if (c.lookT <= 0) {
        const moveH = sp > 3 && v.forwardSpeed > 0 ? Math.atan2(v.vx, v.vz) : v.heading;
        c.yaw += shortestAngle(moveH - c.yaw) * (1 - Math.exp(-3 * dt)); c.pitch += (0.17 - c.pitch) * (1 - Math.exp(-2 * dt));
      }
      target = new THREE.Vector3(v.pos.x, v.y + 1.4 + v.dims.h * 0.3, v.pos.z);
      dist = (v.dims.hl * 2 + 2.6) * [1, 1.35, 0.8][c.di] + Math.min(sp, 40) * 0.05; fov = 66 + Math.min(sp, 45) * 0.32;
    } else {
      const slow = P.scoped ? 0.18 : P.aiming ? 0.6 : 1;
      c.yaw -= mdx * slow; c.pitch = clamp(c.pitch + mdy * slow, -0.75, 1.2);
      shoulder = P.aiming ? 0.62 : 0.5;
      target = new THREE.Vector3(P.pos.x, P.y + (P.swimming ? 0.5 : P.cover && !P.aiming ? 1.15 : 1.58), P.pos.z);
      dist = P.aiming ? 1.8 : c.dist[c.di]; fov = P.aiming ? 50 : 65;
      if (this.state !== 'play') { dist = 6; c.yaw += dt * 0.3; c.pitch = 0.4; }
    }
    // sniper scope: first-person from the eyes with sway (hold sprint to steady your breath)
    if (P.scoped && !P.vehicle) {
      const w = P.weapon, breath = this.input.down('sprint') && P.stamina > 5;
      if (breath) P.stamina = Math.max(0, P.stamina - dt * 25);
      const sway = w.sway * (breath ? 0.15 : 1), t = this.time;
      const yaw = c.yaw + Math.sin(t * 0.9) * sway, pitch = c.pitch - c.recoil * 3 + Math.sin(t * 1.3) * sway * 0.7;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      cam.fov += (w.scope - cam.fov) * (1 - Math.exp(-14 * dt)); cam.updateProjectionMatrix();
      cam.position.set(P.pos.x, P.y + 1.62, P.pos.z).addScaledVector(dir, 0.3); cam.lookAt(cam.position.clone().add(dir));
      this.hud.scope(true); return;
    }
    this.hud.scope(false);
    const pk = c.pitch - c.recoil * 3, dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(pk), -Math.sin(pk), Math.cos(c.yaw) * Math.cos(pk));
    const right = new THREE.Vector3(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
    // over-the-shoulder offset: never push the pivot through a wall beside the player
    if (shoulder > 0) { const ts = this.world.grid.ray(target.x, target.z, right.x, right.z, shoulder + 0.3); if (ts !== Infinity) shoulder = Math.max(0, ts - 0.3); }
    target.addScaledVector(right, shoulder);
    const hx = -dir.x, hz = -dir.z, hl = Math.hypot(hx, hz);
    // pull the camera in front of any wall behind the player. The old floor of 0.8 m put the camera inside the building
    // whenever the player stood closer than ~0.5 m to a wall.
    if (hl > 1e-3) { const t = this.world.grid.ray(target.x, target.z, hx / hl, hz / hl, dist * hl + 0.3); if (t !== Infinity) dist = Math.max(0.12, Math.min(dist, t / hl - 0.3)); }
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-8 * dt)); cam.updateProjectionMatrix();
    cam.position.copy(target).addScaledVector(dir, -dist); cam.position.y = Math.max(cam.position.y, 0.4);
    this.shake *= Math.exp(-4 * dt);
    if (this.shake > 0.01) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    cam.lookAt(cam.position.clone().add(dir));
  }

  // ---------- main update ----------
  update(rawDt) {
    if (this._testThrow) { this._testThrow = false; throw new Error('Test exception from update()'); }
    const inp = this.input, P = this.player;
    inp.pollGamepad();
    this.wheel.update(inp);
    const dt = rawDt * this.wheel.timeScale;
    this.time += dt; this.stats.playTime = (this.stats.playTime || 0) + rawDt;
    if (inp.pressed('map') && !this.menu.open && !this.phone.open) {
      this.fullmap.toggle();
      if (this.fullmap.open) { document.exitPointerLock?.(); if (this.state === 'play') this.state = 'map'; }
      else { if (this.state === 'map') this.state = 'play'; inp.lock(); }
    }
    if (this.state === 'map') return;
    if (inp.pressed('phone') && this.state === 'play') { this.phone.toggle(); return; }
    if (inp.pressed('KeyG')) { const q = this.post.set(this.post.level + 1); settings.quality = this.post.level; this.hud.toast(`Graphics: ${q}`); }
    // slow day/night cycle: 1 game hour every 2 real minutes
    this.hour = (this.hour + dt / 120) % 24; this.skyT = (this.skyT || 0) + dt; if (this.skyT > 8) { this.skyT = 0; this.sky.setTime(this.hour); }

    if (this.state === 'play') {
      if (inp.pressed('enter') || (inp.pressed('interact') && !this.places.near && !this.ambient.active && !this.missions.wantsInteract)) this.tryEnterExit();
      if (P.vehicle) this.drive(dt);
      else { P.update(dt, inp, this.cam.yaw, this.cam.pitch); this.audio.engine(false, 0); }
    } else {
      this.stateT -= dt; this.audio.engine(false, 0);
      P.h.animate(dt, 0, { handsUp: this.state === 'busted' }); P.sync();
      if (this.stateT <= 0) this.respawn(this.state);
    }
    this.audio.radio.update(!!P.vehicle && !P.vehicle.bike && !P.vehicle.dead, settings.musicVolume);
    for (const v of this.vehicles) if (v !== P.vehicle && !v.ai && !v.cop) v.update(dt, { throttle: 0, steer: 0, brake: true });
    for (let i = this.vehicles.length - 1; i >= 0; i--) { const v = this.vehicles[i]; if (!v.ai && !v.cop && !v.owned && !v.mission && !v.persistent && v !== P.vehicle && v !== this.myCar && v.pos.distanceTo(P.pos) > 380) this.removeVehicle(v); }
    this.health.check('player-vehicle');
    this.focus.copy(P.vehicle ? P.vehicle.pos : P.pos);
    this.traffic.update(dt);
    this.police.update(dt);
    this.vehicleCollisions();
    this.peds.update(dt);
    this.pickups.update(dt);
    this.projectiles.update(dt);
    this.weather.update(dt);
    this.places.update(dt);
    this.stunts.update(dt);
    this.collectibles.update(dt);
    this.ambient.update(dt);
    this.missions.update(dt);
    this.effects.update(dt);
    this.health.check('world-systems', true);
    this.updateCamera(rawDt);
    this.health.check('camera');
    this.audio.listener = this.focus; this.audio.ambient(this.sky.night);
    // GPS refresh
    if (this.route && this.routeTarget && (this.routeT -= dt) <= 0) {
      this.routeT = 2.5; const [x, z] = this.routeTarget, r = this.map.route(this.focus.x, this.focus.z, x, z); if (r) { this.route = r; this.routeLength = cumLen(r).at(-1); }
      if (!this.routeMission && this.waypoint && Math.hypot(x - this.focus.x, z - this.focus.z) < 25) { this.clearRoute(false); this.hud.toast('Destination reached'); }
    }
    this.updateLocation(dt);
    this.world.nightUpdate(this.sky.night, this.time);
    this.post.setNight(this.sky.night);
    MATS.head.emissiveIntensity = 0.15 + this.sky.night * 4;
    this.updateHeadlights();
    this.sky.update(this.focus, this.camera, dt);
    this.world.updateLOD(this.camera.position);
    this.health.check('sky-lighting');
    if ((this.autosaveT = (this.autosaveT || 0) + rawDt) > 120 && this.state === 'play' && !this.police.wanted) { this.autosaveT = 0; writeSave(this); }
    this.hud.update(rawDt);
    this.debug.update(rawDt);
  }
  drive(dt) {
    const P = this.player, v = P.vehicle, inp = this.input, gp = inp.gamepad;
    let throttle = (inp.down('forward') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('back') || inp.down('ArrowDown') ? 1 : 0);
    let steer = (inp.down('left') || inp.down('ArrowLeft') ? 1 : 0) - (inp.down('right') || inp.down('ArrowRight') ? 1 : 0);
    if (gp) { throttle += (gp.rt ? 1 : 0) - (gp.lt ? 1 : 0); if (Math.abs(gp.lx) > 0.15) steer = -gp.lx; }
    const ctl = { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1), handbrake: inp.down('jump') };
    if (v.flipped) { if (inp.pressed('reload')) { if (v.recover()) this.hud.toast('Back on four wheels'); } else if (!this.flipHint) { this.flipHint = true; this.hud.help('Vehicle flipped. Press <b>R</b> to flip it back.', 4); } }
    else this.flipHint = false;
    if (inp.pressed('radio') && !v.bike) { const st = this.audio.radio.cycle(); this.hud.radio(st); }
    v.update(dt, ctl);
    if (this.map.inWater(v.pos.x, v.pos.z) && !v.dead) {   // drove into a pond: the engine floods
      v.vx *= Math.exp(-2.5 * dt); v.vz *= Math.exp(-2.5 * dt); v.waterT = (v.waterT || 0) + dt;
      if (v.waterT > 2.5) { v.dead = true; v.flooded = true; this.exitVehicle(true); this.hud.toast('Your vehicle flooded'); return; }
    } else v.waterT = 0;
    if (inp.pressed('horn')) this.audio.horn();
    P.pos.copy(v.pos); P.speed = v.speed;
    if (v.bike) {   // the rider is visible on bikes
      P.h.root.position.set(v.pos.x, v.y, v.pos.z); P.h.root.rotation.set(0, v.heading, 0); P.h.root.rotation.z = v.tilt.rotation.z;
      P.h.animate(dt, v.h.pedal ? v.speed : 0, { ride: true });
    }
    this.audio.engine(!v.dead && !v.h.pedal, v.forwardSpeed, ctl.throttle !== 0 ? 1 : 0);
  }
  updateHeadlights() {
    const P = this.player, v = P.vehicle, on = v && !v.dead && !v.flipped ? this.sky.night + (this.weather.k.overcast > 0.5 ? 0.5 : 0) : 0;
    this.heads.forEach((l, i) => {
      l.intensity = Math.min(1, on) * 90;
      if (v) { const s = i ? 1 : -1, c = Math.cos(v.heading), sn = Math.sin(v.heading), fx = sn, fz = c, rx = -c, rz = sn, zf = v.dims.zc + v.dims.hl;
        l.position.set(v.pos.x + fx * zf + rx * s * (v.bike ? 0 : 0.65), v.y + 0.75, v.pos.z + fz * zf + rz * s * (v.bike ? 0 : 0.65)); l.target.position.set(l.position.x + fx * 14, 0, l.position.z + fz * 14); }
    });
  }
  updateLocation(dt) {
    const P = this.player;
    this.locT = (this.locT || 0) - dt;
    if (this.locT > 0) return;
    this.locT = 0.5;
    const loc = this.map.locationAt(this.focus.x, this.focus.z), key = loc ? loc.name : null, district = this.map.districtAt(this.focus.x, this.focus.z);
    if (key !== this.lastLoc) { this.lastLoc = key; if (loc) this.hud.location(this.brand(loc.name, loc.kind), [loc.label, district].filter(Boolean).join(' · ')); }
    if (district !== this.lastDistrict) { this.lastDistrict = district; if (!loc) this.hud.location(district, 'Midlothian, VA'); }
    const st = this.map.streetAt(this.focus.x, this.focus.z);
    if (st && st !== this.lastStreet) { this.lastStreet = st; if (P.vehicle) this.hud.street(st, district); }
  }
  /** One frame: guarded so an exception is reported instead of stopping three.js's animation loop. */
  frame(now, dt, doUpdate) {
    this.frames++;
    this.renderer.info.reset();
    // update and render are guarded separately: a bug in a system must never skip the render, and nothing may escape
    try { if (doUpdate) for (let k = this.stepsPerFrame || 1; k > 0; k--) { if (this.botLive) this.botLive.tick(dt); else this.update(dt); } } catch (e) { report(e, 'update'); }
    try { this.input.endFrame(); if (!this.fullmap.open) this.post.render(); } catch (e) { report(e, 'render'); }
    try { this.health.afterRender(now); this.perf.frame(now, this.renderer.info.render); } catch (e) { report(e, 'frame-end'); }
  }
  /** (Re)start the animation loop. Every callback is fully guarded: three.js stops rescheduling frames after a throw. */
  startLoop() {
    let last = performance.now();
    this.renderer.setAnimationLoop(null);
    this.renderer.setAnimationLoop((now) => {
      try {
        // dt is clamped on both sides: a huge value (tab was hidden) or 0 / negative (two callbacks with the same timestamp)
        // would otherwise throw objects away or divide by zero (traffic computes velocity as distance / dt)
        let dt = (now - last) / 1000; last = now;
        dt = Number.isFinite(dt) ? Math.min(0.05, Math.max(0.001, dt)) : 1 / 60;
        this.frame(now, dt, (!this.paused || params.has('nopause')) && !this.testFrozen);
      } catch (e) { try { report(e, 'loop'); } catch (e2) { /* never throw out of the loop */ } }
    });
  }
}

const game = new Game();
window.__game = game;
installErrorHandling(game);
try { await game.init(); } catch (e) { report(e, 'startup'); throw e; }
if (params.get('test') === '1') installTestHooks(game);

if (params.has('steps')) {
  // Deterministic scripted run for automated testing.
  const auto = params.get('auto') || 'walk', N = +params.get('steps'), inp = game.input;
  game.start(); $('overlay').style.display = 'none';
  const log = [];
  for (let i = 0; i < N; i++) {
    inp.sim.clear(); inp.simFire = false; inp.simAim = false;
    if (auto === 'walk') inp.sim.add('KeyW');
    if (auto === 'shoot') { inp.simAim = true; if (i % 10 === 0) inp.simFire = true; if (i === 40) inp.simPressed.add('Digit4'); }
    if (auto === 'drive') { if (i === 2) inp.simPressed.add('KeyF'); if (i > 4) { inp.sim.add('KeyW'); if (i % 120 < 30) inp.sim.add('KeyA'); } }
    if (auto === 'chaos') { if (i === 1) game.police.setWanted(3); inp.sim.add('KeyW'); inp.simAim = true; if (i % 8 === 0) inp.simFire = true; }
    if (auto === 'map' && i === N - 1) inp.simPressed.add('KeyM');
    if (auto === 'look') { if (i === 0) { game.cam.yaw += Math.PI * 0.75; game.cam.di = 1; } }
    game.update(1 / 30); inp.endFrame();
    if (i % 60 === 0) log.push(`${i}: peds ${game.peds.list.length} traffic ${game.traffic.list.length} cops ${game.police.cars.length} wanted ${game.police.wanted} hp ${game.player.health | 0}`);
  }
  console.log(log.join(' | '));
  let f = 0; game.renderer.setAnimationLoop(() => {
    if (++f > 3) {
      game.renderer.setAnimationLoop(null);
      const img = document.createElement('img'); img.src = game.renderer.domElement.toDataURL();
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0'; document.body.insertBefore(img, document.body.children[1]);
      console.log('done'); return;
    }
    if (!game.fullmap.open) game.post.render();
  });
} else {
  game.startLoop();
  if (params.get('title') === '0' || params.has('clicktest')) { game.title.hide(); $('overlay').style.display = 'flex'; }
  else game.title.show();
  // Space / Enter / click on the start overlay starts the game
  addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'Enter') && getComputedStyle($('overlay')).display !== 'none' && !e.repeat && !game.title.open) {
      e.preventDefault(); game.input.pressedSet.delete(e.code); game.input.keys.delete(e.code); game.start();
    }
  }, true);
  $('overlay').addEventListener('click', () => game.start());
  $('resume').onclick = (e) => { e.stopPropagation(); game.start(); };
  $('psettings').onclick = (e) => { e.stopPropagation(); $('overlay').style.display = 'none'; game.settingsUI.show(() => { $('overlay').style.display = 'flex'; }); };
  if (params.has('clicktest')) {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    setTimeout(() => console.log('clicktest overlay', $('overlay').style.display, 'paused', game.paused, 'time', game.time.toFixed(2)), 1500);
  }
}
