import * as THREE from 'three';
import { Vehicle } from './entities/vehicle.js';
import { Ped } from './peds.js';
import { along, shortestAngle, clamp, cumLen } from './util.js';

/** Wanted level, pursuit cars, officers on foot, busted/evade logic. */
export class Police {
  constructor(game) {
    this.game = game; this.wanted = 0; this.heat = 0; this.unseen = 0; this.cars = []; this.officers = []; this.spawnT = 0; this.searching = false; this.arrest = 0;
  }
  setWanted(n) {
    n = clamp(Math.round(n), 0, 5);
    if (n > this.wanted) { this.unseen = 0; this.game.hud.toast(n >= 3 ? 'Police are closing in!' : 'Wanted by the police'); }
    this.wanted = n; this.heat = n;
    if (n === 0) this.searching = false;
  }
  crime(kind, pos) {
    const w = this.wanted;
    const copNear = this.cars.some(c => c.pos.distanceTo(pos) < 90) || this.officers.some(o => o.pos.distanceTo(pos) < 70);
    if (kind === 'gunfire') { if (w === 0 && (copNear || Math.random() < 0.35)) this.setWanted(1); }
    else if (kind === 'minor') { if (w === 0 && copNear) this.setWanted(1); }
    else if (kind === 'theft') { if (copNear || Math.random() < 0.3) this.setWanted(Math.max(w, 1)); }
    else if (kind === 'assault') this.setWanted(Math.max(w, 1) + (copNear && w < 2 ? 1 : 0));
    else if (kind === 'kill') this.setWanted(Math.max(2, w + (w < 3 ? 1 : 0.34)));
    else if (kind === 'copkill') this.setWanted(Math.max(3, w + 1));
    else if (kind === 'copcar') this.setWanted(Math.max(w, 2));
    else if (kind === 'explosion') this.setWanted(Math.max(w, 2));
    if (this.wanted > 0) this.unseen = 0;
  }
  spawnCar() {
    const g = this.game, pp = g.focus, edges = g.traffic.edges;
    for (let t = 0; t < 30; t++) {
      const e = edges[Math.floor(Math.random() * edges.length)], s = Math.random() * e.len, p = along(e.pts, e.D, s), d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (d < 110 || d > 240) continue;
      const v = new Vehicle(g, 'police'); v.setPose(p.x - p.dz * 1.7, p.z + p.dx * 1.7, Math.atan2(p.dx, p.dz));
      v.driver = 'cop'; v.siren = true; v.cop = { route: null, routeT: 0, idx: 0, stuck: 0, reverse: 0, crew: 2, deployed: false };
      this.cars.push(v); g.vehicles.push(v); return v;
    }
  }
  update(dt) {
    const g = this.game, P = g.player, tp = P.vehicle ? P.vehicle.pos : P.pos;
    // pursuit units
    const desired = this.wanted ? Math.min(6, this.wanted + 1) : 0;
    this.spawnT -= dt;
    const active = this.cars.filter(c => !c.dead && c.cop.crew > 0 && !c.cop.deployed).length;
    if (active < desired && this.spawnT <= 0) { this.spawnT = 6 - this.wanted * 0.6; this.spawnCar(); }
    let seen = false;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], d = c.pos.distanceTo(tp);
      if ((d > 320 || (!this.wanted && d > 140)) || (c.dead && d > 120)) { this.cars.splice(i, 1); g.removeVehicle(c); continue; }
      if (c === P.vehicle) { this.cars.splice(i, 1); continue; }   // stolen!
      if (c.dead) { c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      if (!this.wanted) { c.siren = false; c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      c.siren = true;
      if (d < 70 && this.los(c.pos, tp)) seen = true;
      if (c.cop.deployed || c.cop.crew === 0) { c.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
      // deploy officers when the suspect is on foot and close, or stopped
      if ((!P.vehicle && d < 22) || (P.vehicle && P.vehicle.speed < 1.5 && d < 12)) {
        if (c.speed < 2) { this.deploy(c); continue; }
        c.update(dt, { throttle: -1, steer: 0 }); continue;
      }
      this.drivePursuit(c, tp, d, dt);
    }
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      if (!o.alive || o.remove) { if (o.remove || !g.peds.list.includes(o)) this.officers.splice(i, 1); continue; }
      const d = o.pos.distanceTo(tp);
      if (d < 55 && this.los(o.pos, tp)) seen = true;
      if (!this.wanted && d > 60) { o.remove = true; this.officers.splice(i, 1); }
    }
    // evasion
    if (this.wanted) {
      if (seen) this.unseen = 0; else this.unseen += dt;
      this.searching = this.unseen > 2;
      if (this.unseen > 7 + this.wanted * 4) { this.setWanted(0); g.hud.toast('You lost the cops'); g.missions?.event('evaded'); }
    }
    // busted
    if (this.wanted && this.wanted <= 2) {
      const close = this.officers.some(o => o.alive && o.pos.distanceTo(P.pos) < 1.8) && !P.vehicle && P.speed < 2.2;
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
        // advance along route to the point closest ahead
        let bs = k.s, bd = 1e9;
        for (let s = k.s; s < Math.min(k.D[k.D.length - 1], k.s + 60); s += 2) { const p = along(k.route, k.D, s), dd = Math.hypot(p.x - c.pos.x, p.z - c.pos.z); if (dd < bd) { bd = dd; bs = s; } }
        k.s = bs; const la = along(k.route, k.D, k.s + 8 + c.speed * 0.6); tx = la.x; tz = la.z;
      }
    }
    const want = Math.atan2(tx - c.pos.x, tz - c.pos.z), err = shortestAngle(want - c.heading);
    let throttle = Math.abs(err) > 1.2 && c.speed > 12 ? 0.2 : 1, steer = clamp(err * 2.2, -1, 1);
    if (d < 30 && g.player.vehicle) throttle = 1;
    // stuck recovery
    if (c.speed < 1.2 && throttle > 0) k.stuck += dt; else k.stuck = Math.max(0, k.stuck - dt);
    if (k.stuck > 1.8) { k.reverse = 1.4; k.stuck = 0; }
    if (k.reverse > 0) { k.reverse -= dt; throttle = -1; steer = -steer; }
    c.update(dt, { throttle, steer, handbrake: Math.abs(err) > 1.4 && c.speed > 10 });
  }
  deploy(c) {
    const g = this.game; c.cop.deployed = true;
    const r = [-Math.cos(c.heading), Math.sin(c.heading)];
    for (let i = 0; i < c.cop.crew; i++) {
      const side = i === 0 ? 1 : -1, x = c.pos.x + r[0] * side * 1.8, z = c.pos.z + r[1] * side * 1.8;
      const o = new Ped(g, x, z, { cop: true, state: 'cop', yaw: c.heading }); o.keep = true; o.car = c;
      g.peds.add(o); this.officers.push(o);
    }
    c.cop.crew = 0;
  }
  /** Officer AI: approach, shoot (2+ stars) or arrest (1 star). Returns move speed. */
  copThink(o, dt, opts) {
    const g = this.game, P = g.player, tp = P.vehicle ? P.vehicle.pos : P.pos;
    if (!this.wanted) { o.aimK = 0; return 0; }
    const dx = tp.x - o.pos.x, dz = tp.z - o.pos.z, d = Math.hypot(dx, dz), los = this.los(o.pos, tp);
    o.turnTo(Math.atan2(dx, dz), dt, 8);
    let speed = 0;
    const shoot = this.wanted >= 2 || P.weapon?.id !== 'fists' && P.aiming;
    const stopAt = shoot ? 11 : 1.2;
    if (d > stopAt || !los) { speed = d > 25 ? 5.5 : 3.2; o.pos.x += Math.sin(o.yaw) * speed * dt; o.pos.z += Math.cos(o.yaw) * speed * dt; }
    o.aimK = shoot && los && d < 50 ? Math.min(1, (o.aimK || 0) + dt * 4) : Math.max(0, (o.aimK || 0) - dt * 4);
    if (o.aimK > 0.9) {
      o.shootT -= dt;
      if (o.shootT <= 0) {
        o.shootT = 0.55 + Math.random() * 0.7;
        const hitP = clamp(0.55 - d * 0.009 - (P.vehicle ? P.vehicle.speed : P.speed) * 0.035, 0.06, 0.55);
        const muzzle = new THREE.Vector3(o.pos.x + Math.sin(o.yaw) * 0.6, 1.45, o.pos.z + Math.cos(o.yaw) * 0.6);
        const aimPt = new THREE.Vector3(tp.x + (Math.random() - 0.5) * (Math.random() < hitP ? 0.2 : 3), 1.1 + (Math.random() - 0.5) * 0.8, tp.z + (Math.random() - 0.5) * (Math.random() < hitP ? 0.2 : 3));
        g.combat.npcShot(o, muzzle, aimPt, Math.random() < hitP ? 7 + Math.random() * 5 : 0);
      }
    }
    opts.aim = o.aimK;
    return speed;
  }
}
