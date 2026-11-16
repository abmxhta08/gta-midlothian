import * as THREE from 'three';
import { Vehicle } from './entities/vehicle.js';
import { Ped } from './peds.js';
import { weaponMesh } from './weapons.js';
import { along, shortestAngle, clamp, cumLen } from './util.js';
import { WitnessCalls } from './witness.js';
import { Roadblocks } from './systems/roadblocks.js';
import { Helicopter } from './systems/heli.js';
import { events } from './core/events.js';

const MAX_CARS = 6, MAX_OFFICERS = 12;

/** Wanted level, pursuit cars, tactical units, roadblocks, helicopter, officers on foot, busted/evade logic.
 *  Police search the last known position when they lose sight of you. No police response inside school safe zones. */
export class Police {
  constructor(game) {
    this.game = game; this.wanted = 0; this.unseen = 0; this.cars = []; this.officers = []; this.spawnT = 0; this.searching = false; this.arrest = 0;
    this.calls = new WitnessCalls(game); this.lastKnown = null; this.spawnCount = 0;
    this.roadblocks = new Roadblocks(game, this); this.heli = new Helicopter(game, this);
    this.suppressed = false;   // missions can turn police response off
  }
  setWanted(n) {
    n = clamp(Math.round(n), 0, 5);
    if (this.suppressed && n > 0) return;
    const before = this.wanted;
    if (n > this.wanted) {
      this.unseen = 0; this.game.hud.toast(n >= 3 ? 'Police are closing in!' : 'Wanted by the police');
      if (!this.lastKnown) { const P = this.game.player; this.lastKnown = (P.vehicle ? P.vehicle.pos : P.pos).clone(); }
    }
    this.wanted = n;
    if (n === 0) { this.searching = false; this.calls.clear(); this.lastKnown = null; }
    if (n !== before) events.emit('wanted', { level: n, before });
  }
  /** Shave time off the evasion timer (changing cars, new paint). */
  coolOff(seconds) { if (this.wanted && this.unseen > 1) this.unseen += seconds; }
  /** A crime happened. It only counts if witnessed (see witness.js). */
  crime(kind, pos, victim = null) {
    if (this.game.zones?.inSafeZone(pos.x, pos.z)) return;
    if (this.wanted > 0 && kind === 'gunfire') { if (this.unseen > 2) { this.unseen = Math.min(this.unseen, 2); this.lastKnown = pos.clone(); } return; }
    if (!this.calls.report(kind, pos, victim)) return;
    this.applyCrime(kind, pos, false);
  }
  applyCrime(kind, pos, viaCall) {
    if (this.game.zones?.inSafeZone(pos.x, pos.z) || this.suppressed) return;   // no wanted level can start in a school safe zone
    if (viaCall) this.game.hud.toast('A witness called the police');
    this.lastKnown = pos.clone();
    const w = this.wanted;
    if (kind === 'gunfire' || kind === 'minor') { if (w === 0) this.setWanted(1); }
    else if (kind === 'theft') this.setWanted(Math.max(w, 1));
    else if (kind === 'assault') this.setWanted(Math.max(w, 1) + (w < 2 && !viaCall ? 1 : 0));
    else if (kind === 'kill') this.setWanted(Math.max(2, w + (w < 3 ? 1 : 0.34)));
    else if (kind === 'copkill') this.setWanted(Math.max(3, w + 1));
    else if (kind === 'copcar') this.setWanted(Math.max(w, 2));
    else if (kind === 'explosion') this.setWanted(Math.max(w, 2));
    if (this.wanted > 0) this.unseen = 0;
    events.emit('crime', { kind, pos, viaCall });
  }
  spawnCar(type = 'police') {
    const g = this.game, pp = g.focus;
    const edges = g.traffic.edges.filter(e => e.pts.some((p, i) => i % 3 === 0 && Math.abs(p[0] - pp.x) < 260 && Math.abs(p[1] - pp.z) < 260));
    if (!edges.length) return null;
    for (let t = 0; t < 30; t++) {
      const e = edges[Math.floor(Math.random() * edges.length)], s = Math.random() * e.len, p = along(e.pts, e.D, s), d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (d < 110 || d > 240 || g.zones.nearSafeZone(p.x, p.z, 20)) continue;
      const v = new Vehicle(g, type); v.setPose(p.x - p.dz * 1.7, p.z + p.dx * 1.7, Math.atan2(p.dx, p.dz));
      v.driver = 'cop'; v.siren = true; v.cop = { route: null, routeT: 0, stuck: 0, reverse: 0, crew: type === 'swat' ? 4 : 2, deployed: false, tactical: type === 'swat' };
      this.cars.push(v); g.vehicles.push(v); this.spawnCount++; return v;
    }
    return null;
  }
  /** Target the police drive/run toward: the player if seen, else the last known position. */
  target() { const P = this.game.player, tp = P.vehicle ? P.vehicle.pos : P.pos; return this.searching && this.lastKnown ? this.lastKnown : tp; }
  update(dt) {
    const g = this.game, P = g.player, tp = P.vehicle ? P.vehicle.pos : P.pos;
    this.calls.update(dt, (k, p, via) => this.applyCrime(k, p, via));
    const inZone = g.zones.inSafeZone(tp.x, tp.z);
    // pursuit units (tactical vans from 4 stars)
    const desired = this.wanted ? Math.min(MAX_CARS, this.wanted + 1) : 0;
    this.spawnT -= dt;
    const active = this.cars.filter(c => !c.dead && c.cop?.crew > 0 && !c.cop.deployed).length;
    if (active < desired && this.spawnT <= 0 && this.cars.length < MAX_CARS + 2) { this.spawnT = 6 - this.wanted * 0.6; this.spawnCar(this.wanted >= 4 && this.spawnCount % 2 ? 'swat' : 'police'); }
    let seen = false;
    const goal = this.target();
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], d = c.pos.distanceTo(tp);
      if ((d > 320 || (!this.wanted && d > 140)) || (c.dead && d > 120)) { this.cars.splice(i, 1); g.removeVehicle(c); continue; }
      if (c === P.vehicle || !c.cop) { this.cars.splice(i, 1); continue; }   // stolen!
      if (c.dead) { c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      if (!this.wanted) { c.siren = false; c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      c.siren = true;
      if (d < 70 && this.los(c.pos, tp)) seen = true;
      if (c.cop.deployed || c.cop.crew === 0 || c.cop.roadblock) { c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      // no police response inside school safe zones: hold at the edge
      if (inZone || g.zones.nearSafeZone(c.pos.x, c.pos.z, 8)) { c.update(dt, { throttle: c.speed > 2 ? -1 : 0, steer: 0 }); continue; }
      if (!this.searching && ((!P.vehicle && d < 22) || (P.vehicle && P.vehicle.speed < 1.5 && d < 12))) {
        if (c.speed < 2) { this.deploy(c); continue; }
        c.update(dt, { throttle: -1, steer: 0 }); continue;
      }
      this.drivePursuit(c, goal, c.pos.distanceTo(goal), dt);
    }
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      if (!o.alive || o.remove) { if (o.remove || !g.peds.list.includes(o)) this.officers.splice(i, 1); continue; }
      const d = o.pos.distanceTo(tp);
      if (d < 55 && o.state !== 'stunned' && this.los(o.pos, tp)) seen = true;
      if (!this.wanted && d > 60) { o.remove = true; this.officers.splice(i, 1); }
    }
    this.roadblocks.update(dt);
    if (this.heli.update(dt)) seen = true;
    // evasion: stay out of sight to make the stars go away (faster with fewer stars)
    if (this.wanted) {
      if (seen && !inZone) { this.unseen = 0; this.lastKnown = tp.clone(); } else this.unseen += dt * (inZone ? 0.5 : 1);
      this.searching = this.unseen > 2;
      if (this.unseen > 7 + this.wanted * 4) { this.setWanted(0); g.hud.toast('You lost the cops'); g.missions?.event('evaded'); }
    }
    // busted (never inside a school zone)
    if (this.wanted && this.wanted <= 2 && !inZone) {
      const close = this.officers.some(o => o.alive && o.state !== 'stunned' && o.pos.distanceTo(P.pos) < 1.8) && !P.vehicle && P.speed < 2.2;
      const boxed = P.vehicle && P.vehicle.speed < 1 && this.cars.some(c => !c.dead && c.pos.distanceTo(P.vehicle.pos) < 7 && c.speed < 1);
      this.arrest = close || boxed ? this.arrest + dt : Math.max(0, this.arrest - dt * 2);
      if (this.arrest > (boxed ? 3 : 1.4)) { this.arrest = 0; g.busted(); }
    } else this.arrest = 0;
    g.audio.siren(this.wanted ? clamp(1 - Math.min(...this.cars.map(c => c.pos.distanceTo(tp)), 300) / 250, 0, 1) : 0, g.time);
  }
  los(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); if (d < 1) return true;
    return this.game.world.grid.ray(a.x, a.z, dx / d, dz / d, d - 1) === Infinity;
  }
  drivePursuit(c, tp, d, dt) {
    const g = this.game, k = c.cop;
    let tx = tp.x, tz = tp.z;
    if (d > 45 || !this.los(c.pos, tp)) {
      k.routeT -= dt;
      if (!k.route || k.routeT <= 0) { k.routeT = 2.5; const r = g.map.route(c.pos.x, c.pos.z, tp.x, tp.z); if (r) { k.route = r; k.D = cumLen(r); k.s = 0; } }
      if (k.route) {
        let bs = k.s, bd = 1e9;
        for (let s = k.s; s < Math.min(k.D[k.D.length - 1], k.s + 60); s += 2) { const p = along(k.route, k.D, s), dd = Math.hypot(p.x - c.pos.x, p.z - c.pos.z); if (dd < bd) { bd = dd; bs = s; } }
        k.s = bs; const la = along(k.route, k.D, k.s + 8 + c.speed * 0.6); tx = la.x; tz = la.z;
      }
    }
    const want = Math.atan2(tx - c.pos.x, tz - c.pos.z), err = shortestAngle(want - c.heading);
    let throttle = Math.abs(err) > 1.2 && c.speed > 12 ? 0.2 : 1, steer = clamp(err * 2.2, -1, 1);
    if (this.searching && d < 15) throttle = c.speed > 4 ? -0.5 : 0.2;   // creep around the search area
    if (c.speed < 1.2 && throttle > 0) k.stuck += dt; else k.stuck = Math.max(0, k.stuck - dt);
    if (k.stuck > 1.8) { k.reverse = 1.4; k.stuck = 0; }
    if (k.reverse > 0) { k.reverse -= dt; throttle = -1; steer = -steer; }
    if (c.flipped) { c.recover(); }
    c.update(dt, { throttle, steer, handbrake: Math.abs(err) > 1.4 && c.speed > 10 });
  }
  deploy(c) {
    const g = this.game; c.cop.deployed = true;
    const r = [-Math.cos(c.heading), Math.sin(c.heading)], f = [Math.sin(c.heading), Math.cos(c.heading)];
    for (let i = 0; i < c.cop.crew && this.officers.length < MAX_OFFICERS; i++) {
      const side = i % 2 === 0 ? 1 : -1, back = i >= 2 ? -2 : 0, x = c.pos.x + r[0] * side * 1.8 + f[0] * back, z = c.pos.z + r[1] * side * 1.8 + f[1] * back;
      this.addOfficer(x, z, c.heading, c.cop.tactical, c);
    }
    c.cop.crew = 0;
  }
  addOfficer(x, z, yaw, tactical = false, car = null) {
    const g = this.game, o = new Ped(g, x, z, { cop: true, state: 'cop', yaw }); o.keep = true; o.car = car; o.tactical = tactical;
    if (tactical) { o.health = 200; o.weapon = weaponMesh('rifle'); o.h.setWeaponMesh(o.weapon); o.h.twoHand = true; }
    g.peds.add(o); this.officers.push(o); return o;
  }
  /** Officer AI: search, approach, shoot (2+ stars) or arrest (1 star). Returns move speed. */
  copThink(o, dt, opts) {
    const g = this.game, P = g.player, tp = P.vehicle ? P.vehicle.pos : P.pos;
    if (!this.wanted) { o.aimK = 0; return 0; }
    const inZone = g.zones.inSafeZone(tp.x, tp.z), goal = this.searching ? (this.lastKnown || tp) : tp;
    const dx = goal.x - o.pos.x, dz = goal.z - o.pos.z, d = Math.hypot(dx, dz), los = !this.searching && this.los(o.pos, tp);
    o.turnTo(Math.atan2(dx, dz), dt, 8);
    let speed = 0;
    const shoot = !inZone && !this.searching && (this.wanted >= 2 || (P.weapon?.id !== 'fists' && P.aiming));
    const stopAt = inZone ? 1e9 : this.searching ? 4 : shoot ? (o.tactical ? 16 : 11) : 1.2;
    const nextStep = { x: o.pos.x + Math.sin(o.yaw) * 1.5, z: o.pos.z + Math.cos(o.yaw) * 1.5 };
    if ((d > stopAt || (!los && !this.searching)) && !g.zones.inSafeZone(nextStep.x, nextStep.z)) { speed = d > 25 ? 5.5 : 3.2; o.pos.x += Math.sin(o.yaw) * speed * dt; o.pos.z += Math.cos(o.yaw) * speed * dt; }
    o.aimK = shoot && los && d < 55 ? Math.min(1, (o.aimK || 0) + dt * 4) : Math.max(0, (o.aimK || 0) - dt * 4);
    if (o.aimK > 0.9) {
      o.shootT -= dt;
      if (o.shootT <= 0) {
        o.shootT = o.tactical ? 0.25 + Math.random() * 0.3 : 0.55 + Math.random() * 0.7;
        const hitP = clamp((o.tactical ? 0.62 : 0.55) - d * 0.009 - (P.vehicle ? P.vehicle.speed : P.speed) * 0.035, 0.06, 0.6);
        const muzzle = new THREE.Vector3(o.pos.x + Math.sin(o.yaw) * 0.6, 1.45, o.pos.z + Math.cos(o.yaw) * 0.6);
        const hit = Math.random() < hitP, sp = hit ? 0.2 : 3;
        const aimPt = new THREE.Vector3(tp.x + (Math.random() - 0.5) * sp, 1.1 + (Math.random() - 0.5) * 0.8, tp.z + (Math.random() - 0.5) * sp);
        g.combat.npcShot(o, muzzle, aimPt, hit ? (o.tactical ? 9 : 7) + Math.random() * 5 : 0);
      }
    }
    opts.aim = o.aimK;
    return speed;
  }
  /** Remove every police unit (respawn, mission start). */
  clearAll() {
    const g = this.game;
    for (const c of [...this.cars]) g.removeVehicle(c); this.cars = [];
    for (const o of this.officers) o.remove = true; this.officers = [];
    this.roadblocks.clear(); this.heli.hide(); this.setWanted(0);
  }
}
