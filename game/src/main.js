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
import { Missions } from './missions.js';
import { Vehicle } from './entities/vehicle.js';
import { MATS } from './entities/carmodels.js';
import { HUD } from './ui/hud.js';
import { FullMap } from './ui/fullmap.js';
import { clamp, shortestAngle, cumLen } from './util.js';
import { installErrorHandling, report } from './ui/errors.js';
import { Perf, DebugPanel } from './ui/debug.js';
import { installTestHooks } from './testhooks.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const STEPS = ['Downloading map', 'Painting textures', 'Laying ground', 'Paving roads', 'Raising buildings', 'Planting trees', 'Building meshes', 'Lighting the sky', 'Spawning people'];
const step = async (s) => {
  $('loadstep').textContent = s;
  const i = STEPS.indexOf(s); if (i >= 0) $('loadbar').firstElementChild.style.width = `${Math.round((i + 1) / (STEPS.length + 1) * 100)}%`;
  await new Promise(r => setTimeout(r, 0));
};
const SENS = 0.0022;
const BUILD = 'p1-2026-11-16';
document.getElementById('ver').textContent = `build ${BUILD}`;

class Game {
  async init() {
    this.BUILD = BUILD; this.PedClass = Ped;
    if (params.get('test') === '1' && params.has('crash')) throw new Error('Test crash during startup');
    await step('Downloading map');
    this.data = await (await fetch('data/midlothian.json')).json();
    this.map = prepareData(this.data);
    this.save = (() => { try { return JSON.parse(localStorage.getItem('midlothian-save') || '{}'); } catch (e) { return {}; } })();
    this.settings = { density: 1 };
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
    if (this.save.quality != null || params.has('q')) this.post.set(+(params.get('q') ?? this.save.quality));
    this.input = new Input(canvas);
    this.audio = new Audio(); this.effects = new Effects(this.scene);
    this.time = 0; this.state = 'play'; this.shake = 0; this.vehicles = []; this.route = null; this.waypoint = null; this.focus = new THREE.Vector3();
    await step('Spawning people');
    this.player = new Player(this); this.player.money = this.save.money || 0;
    this.combat = new Combat(this);
    this.cam = { yaw: 0, pitch: 0.2, dist: [3.4, 4.6, 2.6], di: 0, lookT: 0, recoil: 0 };
    this.peds = new PedManager(this);
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.hud = new HUD(this);
    this.pickups = new Pickups(this);
    this.missions = new Missions(this);
    this.fullmap = new FullMap(this);
    // shared headlight beams that follow whatever the player drives (constant light count = no shader recompiles)
    this.heads = [0, 1].map(() => { const l = new THREE.SpotLight(0xfff1d6, 0, 75, 0.48, 0.55, 1.1); this.scene.add(l, l.target); return l; });
    this.spawnPlayer(true);
    // Pause screen: only reappears when the player deliberately leaves mouse lock (Esc) after playing a moment.
    // If the browser refuses or instantly drops the lock, keep playing (drag with the mouse to look).
    this.input.onLock = (l) => {
      if (this.fullmap.open) return;
      if (l) { this.lockedAt = performance.now(); return; }
      if (this.lockedAt && performance.now() - this.lockedAt > 800) { $('overlay').style.display = 'flex'; this.paused = true; }
      this.lockedAt = 0;
    };
    // Space starts / resumes the game and hides the controls screen
    // hide first, then the things that can fail (audio, pointer lock) each in their own try/catch
    const start = () => {
      $('overlay').style.display = 'none'; this.paused = false;
      try { this.audio.init(); } catch (e) { report(e, 'audio init'); }
      try { this.input.lock(); } catch (e) { /* lock denied: drag-to-look still works */ }
    };
    addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && getComputedStyle($('overlay')).display !== 'none' && !e.repeat) {
        e.preventDefault(); this.input.pressedSet.delete(e.code); this.input.keys.delete(e.code); start();
      }
    }, true);
    $('overlay').addEventListener('click', start);
    this.debug = new DebugPanel(this);
    addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.debug.toggle(); } });
    console.log('Midlothian build', BUILD);
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.post.resize(); });
    $('qual').textContent = `Graphics: ${QUALITY[this.post.level]} (G to change)`;
    $('loading').style.display = 'none';
    this.ready = true; this.frames = 0;
    $('loadbar').firstElementChild.style.width = '100%';
    console.log(`ready: ${this.data.buildings.length} buildings, ${this.world.treeCount} trees, ${this.world.parked.length} parked cars, ${this.world.tris | 0} tris`);
  }
  persist() { try { localStorage.setItem('midlothian-save', JSON.stringify({ ...this.save, money: this.player.money, quality: this.post.level, hour: this.hour })); } catch (e) { /* private mode */ } }
  addMoney(n) { this.player.money = Math.max(0, this.player.money + n); this.persist(); }

  spawnPlayer(first) {
    // a sidewalk near the middle of town, outside any school campus, with a car parked beside it
    let sp = null;
    for (const r of [60, 120, 200, 320]) { sp = this.peds.nearestSidewalk(Math.cos(r) * r + 120, Math.sin(r) * r - 80, 120); if (sp && !this.map.inSchool(sp.x, sp.z)) break; }
    const P = this.player; P.vehicle = null; P.h.visible = true; P.health = 100; P.setPos(sp.x, sp.z);
    const near = this.map.nearestRoad(sp.x, sp.z, 40, r => r.type !== 'service');
    if (near) {
      P.yaw = Math.atan2(near.px - sp.x, near.pz - sp.z); this.cam.yaw = P.yaw;
      if (first || !this.vehicles.some(v => v.pos.distanceTo(P.pos) < 30)) {
        const side = ((sp.x - near.px) * -near.dz + (sp.z - near.pz) * near.dx) > 0 ? 1 : -1, off = near.road.w / 2 - 1.3;
        const v = new Vehicle(this, 'sedan', 0x8a1010);
        v.setPose(near.px - near.dz * off * side, near.pz + near.dx * off * side, Math.atan2(near.dx * side, near.dz * side));
        this.vehicles.push(v); this.myCar = v;
      }
    }
    if (first) this.hud.help('Welcome to <b>Midlothian</b>.<br>Press <b>F</b> to get in the car, <b>M</b> for the map. Yellow markers are <b>missions</b>.', 9);
  }
  removeVehicle(v) { const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1); if (v !== this.player.vehicle) v.dispose(); }
  crime(kind, pos, victim = null) { this.police.crime(kind, pos, victim); }
  onPedKilled(p, src) {
    if (src === 'player') { this.crime(p.cop ? 'copkill' : 'kill', p.pos, p); if (!p.cop && Math.random() < 0.5) this.pickups.cash(p.pos.x + 0.6, p.pos.z, 10 + Math.floor(Math.random() * 60)); this.hud.hit(); }
    this.peds.panic(p.pos.x, p.pos.z, 40, p.pos);
  }
  onVehicleImpact(v, imp) { if (v === this.player.vehicle) this.shake = Math.max(this.shake, Math.min(0.6, imp / 30)); }
  explosion(p, src) { this.combat.explosion(p, src); if (src === this.player.vehicle) this.crime('explosion', p); }
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
    this.hud.big('WASTED', 'You lost $100 in hospital bills', 'wasted', 4.5); this.audio.jingle(false);
    this.missions.onWastedOrBusted('You died');
    if (this.player.vehicle) this.exitVehicle(true);
    this.player.h.dead = 0.01;
  }
  busted() {
    if (this.state !== 'play') return; this.state = 'busted'; this.stateT = 4;
    this.hud.big('BUSTED', 'Your weapons were confiscated', 'busted', 4); this.audio.jingle(false);
    this.missions.onWastedOrBusted('You got busted');
    if (this.player.vehicle) this.exitVehicle(true);
  }
  respawn(kind) {
    const P = this.player;
    this.addMoney(-100); this.police.setWanted(0);
    for (const c of [...this.police.cars]) this.removeVehicle(c); this.police.cars = [];
    for (const o of this.police.officers) o.remove = true; this.police.officers = [];
    if (kind === 'busted') { P.inv = { fists: {}, pistol: { ammo: 12, reserve: 24 } }; P.equip('pistol'); }
    P.h.dead = 0; P.armor = 0; this.state = 'play';
    this.spawnPlayer(false); P.health = 100;
  }

  // ---------- vehicles ----------
  tryEnterExit() {
    const P = this.player;
    if (P.vehicle) return this.exitVehicle();
    let best = null, bd = 3.6;
    for (const v of this.vehicles) { if (v.dead) continue; const d = v.pos.distanceTo(P.pos) - v.dims.hw; if (d < bd) { bd = d; best = v; } }
    for (const pc of this.world.parked) { if (!pc.active) continue; const d = Math.hypot(pc.x - P.pos.x, pc.z - P.pos.z) - 1; if (d < bd) { bd = d; best = pc; } }
    if (!best) return;
    let v = best;
    if (!(best instanceof Vehicle)) {   // break into a parked car
      this.world.hideParked(best); v = new Vehicle(this, best.type, best.color); v.setPose(best.x, best.z, best.heading); this.vehicles.push(v);
      if (Math.random() < 0.3) this.crime('theft', P.pos); this.hud.toast('Vehicle stolen');
    } else if (v.ai || v.driver === 'npc') {   // carjack
      const r = [-Math.cos(v.heading), Math.sin(v.heading)];
      const d = new Ped(this, v.pos.x - r[0] * 1.6, v.pos.z - r[1] * 1.6); d.flee(P.pos, 12); this.peds.add(d); this.audio.scream(v.pos);
      if (v.ai) this.traffic.release(v); this.crime('theft', P.pos); this.hud.toast('Carjacked!');
    } else if (v.police) {
      this.police.cars = this.police.cars.filter(c => c !== v); this.crime('copcar', P.pos);
    }
    v.driver = 'player'; v.mode = 'physics'; v.siren = false; v.cop = null; P.vehicle = v; P.h.visible = false; this.cam.yaw = v.heading; this.cam.pitch = 0.2;
  }
  exitVehicle(force = false) {
    const P = this.player, v = P.vehicle; if (!v) return;
    if (!force && v.speed > 6) return;
    const r = [-Math.cos(v.heading), Math.sin(v.heading)], f = [Math.sin(v.heading), Math.cos(v.heading)];
    for (const [s, a] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const off = s ? v.dims.hw + 0.8 : v.dims.hl + 1, x = v.pos.x + r[0] * s * off + f[0] * a * off, z = v.pos.z + r[1] * s * off + f[1] * a * off;
      if (this.world.clear(x, z, 0.4) || force) { P.setPos(x, z); break; }
    }
    v.driver = null; P.vehicle = null; P.h.visible = true; P.yaw = v.heading; this.cam.yaw = v.heading;
  }
  vehicleCollisions() {
    const V = this.vehicles, f = this.focus;
    for (let i = 0; i < V.length; i++) {
      const a = V[i]; if (Math.abs(a.pos.x - f.x) > 150 || Math.abs(a.pos.z - f.z) > 150) continue;
      for (let j = i + 1; j < V.length; j++) {
        const b = V[j]; if (Math.abs(a.pos.x - b.pos.x) > 7 || Math.abs(a.pos.z - b.pos.z) > 7) continue;
        const ca = a.circles(), cb = b.circles(), ra = a.dims.hw, rb = b.dims.hw;
        for (const [ax, az] of ca) for (const [bx, bz] of cb) {
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz), m = ra + rb;
          if (d >= m || d < 1e-4) continue;
          dx /= d; dz /= d;
          const ka = a.mode === 'kinematic' ? 0 : 1, kb = b.mode === 'kinematic' ? 0 : 1, tot = ka + kb || 1;
          const pen = m - d; a.pos.x -= dx * pen * ka / tot; a.pos.z -= dz * pen * ka / tot; b.pos.x += dx * pen * kb / tot; b.pos.z += dz * pen * kb / tot;
          const rel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
          if (rel < 0) {
            const imp = -rel;
            if (ka) { a.vx += dx * rel * (kb ? 0.6 : 1.2); a.vz += dz * rel * (kb ? 0.6 : 1.2); }
            if (kb) { b.vx -= dx * rel * (ka ? 0.6 : 1.2); b.vz -= dz * rel * (ka ? 0.6 : 1.2); }
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
    if (inp.pressed('KeyC')) c.di = (c.di + 1) % 3;
    c.recoil *= Math.exp(-9 * dt);
    const mdx = inp.mdx * SENS, mdy = inp.mdy * SENS;
    let target, dist, fov = 65, shoulder = 0;
    if (P.vehicle) {
      const v = P.vehicle, sp = v.speed;
      if (Math.abs(mdx) + Math.abs(mdy) > 0) c.lookT = 1.6; else c.lookT -= dt;
      c.yaw -= mdx; c.pitch = clamp(c.pitch + mdy, -0.1, 1.0);
      if (c.lookT <= 0) {
        const moveH = sp > 3 && v.forwardSpeed > 0 ? Math.atan2(v.vx, v.vz) : v.heading;
        c.yaw += shortestAngle(moveH - c.yaw) * (1 - Math.exp(-3 * dt)); c.pitch += (0.17 - c.pitch) * (1 - Math.exp(-2 * dt));
      }
      target = new THREE.Vector3(v.pos.x, 1.4 + v.dims.h * 0.3, v.pos.z);
      dist = (v.dims.hl * 2 + 2.6) * [1, 1.35, 0.8][c.di] + Math.min(sp, 40) * 0.05; fov = 66 + Math.min(sp, 45) * 0.32;
    } else {
      c.yaw -= mdx * (P.aiming ? 0.6 : 1); c.pitch = clamp(c.pitch + mdy * (P.aiming ? 0.6 : 1), -0.75, 1.2);
      shoulder = P.aiming ? 0.62 : 0.5;
      target = new THREE.Vector3(P.pos.x, P.y + 1.58, P.pos.z);
      dist = P.aiming ? 1.8 : c.dist[c.di]; fov = P.aiming ? 50 : 65;
      if (this.state !== 'play') { dist = 6; c.yaw += dt * 0.3; c.pitch = 0.4; }
    }
    const pk = c.pitch - c.recoil * 3, dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(pk), -Math.sin(pk), Math.cos(c.yaw) * Math.cos(pk));
    const right = new THREE.Vector3(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
    target.addScaledVector(right, shoulder);
    const hx = -dir.x, hz = -dir.z, hl = Math.hypot(hx, hz);
    if (hl > 1e-3) { const t = this.world.grid.ray(target.x, target.z, hx / hl, hz / hl, dist * hl + 0.3); if (t !== Infinity) dist = Math.max(0.8, Math.min(dist, t / hl - 0.35)); }
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-8 * dt)); cam.updateProjectionMatrix();
    cam.position.copy(target).addScaledVector(dir, -dist); cam.position.y = Math.max(cam.position.y, 0.4);
    this.shake *= Math.exp(-4 * dt);
    if (this.shake > 0.01) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    cam.lookAt(cam.position.clone().add(dir));
  }

  // ---------- main update ----------
  update(dt) {
    if (this._testThrow) { this._testThrow = false; throw new Error('Test exception from update()'); }
    const inp = this.input, P = this.player;
    this.time += dt;
    if (inp.pressed('KeyM')) {
      this.fullmap.toggle();
      if (this.fullmap.open) { document.exitPointerLock?.(); if (this.state === 'play') this.state = 'map'; }
      else { if (this.state === 'map') this.state = 'play'; inp.lock(); }
    }
    if (this.state === 'map') return;
    if (inp.pressed('KeyG')) { const q = this.post.set(this.post.level + 1); this.hud.toast(`Graphics: ${q}`); $('qual').textContent = `Graphics: ${q} (G to change)`; this.persist(); }
    if (inp.pressed('KeyT')) { this.hour = (this.hour + 1) % 24; this.sky.setTime(this.hour); this.hud.toast(`Time ${Math.floor(this.hour)}:00`); this.persist(); }
    // slow day/night cycle: 1 game hour every 2 real minutes
    this.hour = (this.hour + dt / 120) % 24; this.skyT = (this.skyT || 0) + dt; if (this.skyT > 8) { this.skyT = 0; this.sky.setTime(this.hour); }

    if (this.state === 'play') {
      if (inp.pressed('KeyF') || inp.pressed('KeyE')) this.tryEnterExit();
      if (P.vehicle) {
        const v = P.vehicle;
        const ctl = { throttle: (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0),
          steer: (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0) - (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0), handbrake: inp.down('Space') };
        v.update(dt, ctl);
        if (inp.pressed('KeyH')) this.audio.horn();
        P.pos.copy(v.pos); P.speed = v.speed;
        this.audio.engine(!v.dead, v.forwardSpeed, ctl.throttle !== 0 ? 1 : 0);
        if (v.dead && v.pos.distanceTo(P.pos) < 1) { /* still inside a burning wreck */ }
      } else { P.update(dt, inp, this.cam.yaw, this.cam.pitch); this.audio.engine(false, 0); }
    } else {
      this.stateT -= dt; this.audio.engine(false, 0);
      P.h.animate(dt, 0, { handsUp: this.state === 'busted' }); P.sync();
      if (this.stateT <= 0) this.respawn(this.state);
    }
    for (const v of this.vehicles) if (v !== P.vehicle && !v.ai && !v.cop) v.update(dt, { throttle: 0, steer: 0, brake: true });
    for (let i = this.vehicles.length - 1; i >= 0; i--) { const v = this.vehicles[i]; if (!v.ai && !v.cop && v !== P.vehicle && v !== this.myCar && v.pos.distanceTo(P.pos) > 380) this.removeVehicle(v); }
    this.focus.copy(P.vehicle ? P.vehicle.pos : P.pos);
    this.traffic.update(dt);
    this.police.update(dt);
    this.vehicleCollisions();
    this.peds.update(dt);
    this.pickups.update(dt);
    this.missions.update(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.audio.listener = this.focus; this.audio.ambient(this.sky.night);
    // GPS refresh
    if (this.route && this.routeTarget && (this.routeT -= dt) <= 0) {
      this.routeT = 2.5; const [x, z] = this.routeTarget, r = this.map.route(this.focus.x, this.focus.z, x, z); if (r) { this.route = r; this.routeLength = cumLen(r).at(-1); }
      if (!this.routeMission && this.waypoint && Math.hypot(x - this.focus.x, z - this.focus.z) < 25) { this.clearRoute(false); this.hud.toast('Destination reached'); }
    }
    // location / street pop-ups
    this.locT = (this.locT || 0) - dt;
    if (this.locT <= 0) {
      this.locT = 0.5;
      const loc = this.map.locationAt(this.focus.x, this.focus.z), key = loc ? loc.name : null, district = this.map.districtAt(this.focus.x, this.focus.z);
      if (key !== this.lastLoc) { this.lastLoc = key; if (loc) this.hud.location(loc.name, [loc.label, district].filter(Boolean).join(' · ')); }
      if (district !== this.lastDistrict) { this.lastDistrict = district; if (!loc) this.hud.location(district, 'Midlothian, VA'); }
      const st = this.map.streetAt(this.focus.x, this.focus.z);
      if (st && st !== this.lastStreet) { this.lastStreet = st; if (P.vehicle) this.hud.street(st, district); }
    }
    this.world.nightUpdate(this.sky.night, this.time);
    this.post.setNight(this.sky.night);
    MATS.head.emissiveIntensity = 0.15 + this.sky.night * 4;
    { const v = P.vehicle, on = v && !v.dead ? this.sky.night : 0;
      this.heads.forEach((l, i) => {
        l.intensity = on * 90;
        if (v) { const s = i ? 1 : -1, c = Math.cos(v.heading), sn = Math.sin(v.heading), fx = sn, fz = c, rx = -c, rz = sn, zf = v.dims.zc + v.dims.hl;
          l.position.set(v.pos.x + fx * zf + rx * s * 0.65, 0.75, v.pos.z + fz * zf + rz * s * 0.65); l.target.position.set(l.position.x + fx * 14, 0, l.position.z + fz * 14); }
      }); }
    this.sky.update(this.focus, this.camera, dt);
    this.world.updateLOD(this.camera.position);
    this.hud.update(dt);
    this.debug.update(dt);
  }
  /** One frame: guarded so an exception is reported instead of stopping three.js's animation loop. */
  frame(now, dt, doUpdate) {
    this.frames++;
    this.renderer.info.reset();
    try { if (doUpdate) this.update(dt); } catch (e) { report(e, 'update'); }
    try { this.input.endFrame(); if (!this.fullmap.open) this.post.render(); } catch (e) { report(e, 'render'); }
    this.perf.frame(now, this.renderer.info.render);
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
  $('overlay').style.display = 'none';
  const log = [];
  for (let i = 0; i < N; i++) {
    inp.sim.clear(); inp.simFire = false; inp.simAim = false;
    if (auto === 'walk') inp.sim.add('KeyW');
    if (auto === 'shoot') { inp.simAim = true; if (i % 10 === 0) inp.simFire = true; if (i === 40) inp.simPressed.add('Digit3'); }
    if (auto === 'drive') { if (i === 2) inp.simPressed.add('KeyF'); if (i > 4) { inp.sim.add('KeyW'); if (i % 120 < 30) inp.sim.add('KeyA'); } }
    if (auto === 'chaos') { if (i === 1) game.police.setWanted(3); inp.sim.add('KeyW'); inp.simAim = true; if (i % 8 === 0) inp.simFire = true; }
    if (auto === 'map' && i === N - 1) inp.simPressed.add('KeyM');
    if (auto === 'mission' && i === 0) { const m = game.missions.markers[+(params.get('m') || 0)]; game.player.setPos(m.pos.x + 0.5, m.pos.z); }
    if (auto === 'mission' && i === 5) console.log('mission', game.missions.active?.def.title, '|', game.missions.active?.text, '| dest', game.missions.dest?.toArray().map(v => v | 0).join(','), '| route pts', game.route?.length);
    if (auto === 'look') { if (i === 0) { game.cam.yaw += Math.PI * 0.75; game.cam.di = 1; } }
    if (auto === 'night' && i === 0) { game.hour = +(params.get('t') || 21); game.sky.setTime(game.hour); }
    game.update(1 / 30); inp.endFrame();
    if (i % 60 === 0) log.push(`${i}: peds ${game.peds.list.length} traffic ${game.traffic.list.length} cops ${game.police.cars.length} wanted ${game.police.wanted} hp ${game.player.health | 0}`);
  }
  console.log(log.join(' | '));
  { const f = game.focus, E = game.traffic.edges; let inR = 0; for (const e of E) { const p = e.pts[0], d = Math.hypot(p[0] - f.x, p[1] - f.z); if (d > 70 && d < 280) inR++; }
    console.log('traffic edges', E.length, 'in range', inR, 'graph edges', game.map.graph.edges.length, 'vehicles', game.vehicles.length); }
  const P = game.player;
  console.log('state', game.state, 'pos', P.pos.toArray().map(v => v.toFixed(1)).join(','), 'veh', !!P.vehicle, P.vehicle ? P.vehicle.speed.toFixed(1) : '', 'ammo', JSON.stringify(P.inv[P.current]), 'loc', game.lastLoc, 'street', game.lastStreet, 'district', game.lastDistrict);
  let f = 0; game.renderer.setAnimationLoop(() => {
    if (++f > 3) {
      game.renderer.setAnimationLoop(null);
      const img = document.createElement('img'); img.src = game.renderer.domElement.toDataURL();
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0'; document.body.insertBefore(img, document.body.children[1]);
      console.log('done'); return;
    }
    if (!game.fullmap.open) game.post.render();
    if (f === 2) { const c = game.camera; console.log('cam', c.position.toArray().map(v => v.toFixed(2)).join(','), 'fov', c.fov.toFixed(1), 'info', JSON.stringify(game.renderer.info.render), 'canvas', game.renderer.domElement.width, game.renderer.domElement.height);
      const gl = game.renderer.getContext(), px = new Uint8Array(4 * 3); gl.readPixels(700, 600, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.readPixels(700, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px.subarray(4));
      console.log('pixels sky', px.slice(0, 4).join(','), 'ground', px.slice(4, 8).join(','), 'sun', game.sky.dir.toArray().map(v => v.toFixed(2)).join(','), 'exp', game.renderer.toneMappingExposure, 'hour', game.hour); }
  });
} else {
  let last = performance.now();
  game.renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    game.frame(now, dt, !game.paused || params.has('nopause'));
  });
  $('overlay').style.display = 'flex';
  if (params.has('clicktest')) {   // automated check that clicking the start screen gets you into the game
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    setTimeout(() => console.log('clicktest overlay', $('overlay').style.display, 'paused', game.paused, 'time', game.time.toFixed(2)), 1500);
  }
}
