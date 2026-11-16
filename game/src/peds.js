import * as THREE from 'three';
import { Human } from './entities/human.js';
import { along, shortestAngle, clamp } from './util.js';
import { weaponMesh } from './weapons.js';

/** A pedestrian or police officer on foot. */
export class Ped {
  constructor(game, x, z, opts = {}) {
    this.game = game; this.cop = !!opts.cop;
    this.h = new Human(game.scene, { cop: this.cop });
    this.pos = new THREE.Vector3(x, 0, z); this.vel = new THREE.Vector3(); this.yaw = opts.yaw ?? Math.random() * 6.28;
    this.health = this.cop ? 120 : 100; this.state = opts.state || 'walk'; this.timer = 0; this.speed = 0;
    this.path = null; this.s = 0; this.dir = 1; this.lat = (Math.random() - 0.5) * 0.8; this.walkSpeed = 1.15 + Math.random() * 0.5;
    this.fleeFrom = new THREE.Vector3(); this.removeT = 0; this.vy = 0; this.y = 0; this.shootT = 1 + Math.random(); this.arrestT = 0;
    if (this.cop) { this.weapon = weaponMesh('pistol'); this.h.setWeaponMesh(this.weapon); }
    this.sync();
  }
  get alive() { return this.state !== 'dead'; }
  sync() { this.h.root.position.set(this.pos.x, this.y, this.pos.z); this.h.root.rotation.y = this.yaw; }
  /** Ray vs vertical capsule. Returns {t, head} or null. */
  rayHit(o, d, maxD) {
    if (this.state === 'dead' || this.state === 'knocked' || this.inVehicle) return null;
    const H = 1.75 * this.h.height, r = 0.3, wx = o.x - this.pos.x, wz = o.z - this.pos.z, dd = d.x * d.x + d.z * d.z;
    if (dd < 1e-6) return null;
    const tc = -(wx * d.x + wz * d.z) / dd, cx = wx + d.x * tc, cz = wz + d.z * tc, dist2 = cx * cx + cz * cz;
    if (dist2 > r * r) return null;
    const t = tc - Math.sqrt((r * r - dist2) / dd); if (t < 0 || t > maxD) return null;
    const y = o.y + d.y * t - this.y; if (y < 0 || y > H) return null;
    return { t, head: y > H * 0.86 };
  }
  damage(n, src = null, dir = null) {
    if (this.state === 'dead') return;
    this.health -= n;
    if (this.health <= 0) {
      this.state = 'dead'; this.h.dead = 0.01; this.removeT = 40;
      this.h.deathDir = dir && (dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw)) > 0 ? -1 : 1;
      this.game.onPedKilled(this, src);
    } else if (!this.cop) { this.flee(src ? src : this.pos, 10 + Math.random() * 6); this.game.audio.scream(this.pos); }
  }
  knock(vx, vz, dmg, src) {
    if (this.state === 'dead') return;
    this.vel.set(vx, 0, vz); this.vy = 3 + Math.hypot(vx, vz) * 0.15; this.state = 'knocked'; this.timer = 1.6;
    this.h.dead = 0.01; this.h.deathDir = 1;
    this.health -= dmg;
    this.game.audio.punch(this.pos);
    if (this.health <= 0) { this.health = 0; this.pendingDeath = src || 'vehicle'; }
  }
  flee(from, time = 10) {
    if (this.state === 'dead' || this.state === 'knocked' || this.cop) return;
    this.state = 'flee'; this.timer = time; this.fleeFrom.set(from.x, 0, from.z);
  }
  update(dt) {
    const g = this.game, grid = g.world.grid;
    let speed = 0, opts = {};
    if (this.state === 'dead') { this.removeT -= dt; this.h.animate(dt, 0); return; }
    if (this.state === 'knocked') {
      this.pos.addScaledVector(this.vel, dt); this.vy -= 14 * dt; this.y = Math.max(0, this.y + this.vy * dt);
      this.vel.multiplyScalar(Math.exp(-(this.y > 0 ? 0.5 : 4) * dt));
      const o = grid.push(this.pos.x, this.pos.z, 0.3); if (o.hit) { this.pos.x += o.x; this.pos.z += o.z; this.vel.multiplyScalar(0.3); }
      this.h.animate(dt, 0); this.sync();
      if ((this.timer -= dt) <= 0 && this.y <= 0) {
        if (this.pendingDeath) { this.state = 'dead'; this.removeT = 40; this.game.onPedKilled(this, this.pendingDeath); }
        else { this.h.dead = 0; this.flee(this.pos.clone().add(this.vel), 8); }
      }
      return;
    }
    if (this.state === 'walk' && this.path) {
      const L = this.path.D[this.path.D.length - 1];
      this.s += this.dir * this.walkSpeed * dt;
      if (this.s < 0 || this.s > L) { this.dir = -this.dir; this.s = clamp(this.s, 0, L); if (Math.random() < 0.3) { this.state = 'idle'; this.timer = 2 + Math.random() * 6; } }
      const p = along(this.path.pts, this.path.D, this.s);
      const tx = p.x - p.dz * this.lat * this.dir, tz = p.z + p.dx * this.lat * this.dir;
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 3) { this.path = null; }
      else if (d > 0.05) { const k = Math.min(1, this.walkSpeed * 1.4 * dt / d); this.pos.x += dx * k; this.pos.z += dz * k; this.turnTo(Math.atan2(dx, dz), dt, 6); }
      speed = this.walkSpeed;
    } else if (this.state === 'walk') {
      // lost the path: reattach to nearest sidewalk
      const sp = g.peds.nearestSidewalk(this.pos.x, this.pos.z, 40);
      if (sp) { this.path = sp.path; this.s = sp.s; } else { this.state = 'idle'; this.timer = 5; }
    } else if (this.state === 'idle') {
      if ((this.timer -= dt) <= 0) this.state = 'walk';
    } else if (this.state === 'flee') {
      let dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z; const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      const v = 5.2;
      this.turnTo(Math.atan2(dx, dz), dt, 5);
      this.pos.x += Math.sin(this.yaw) * v * dt; this.pos.z += Math.cos(this.yaw) * v * dt; speed = v; opts.flee = d < 12;
      if ((this.timer -= dt) <= 0) { this.state = 'walk'; this.path = null; }
    } else if (this.state === 'cop') {
      speed = g.police.copThink(this, dt, opts);
    } else if (this.state === 'hostage') { opts.handsUp = true; }
    // dodge fast vehicles heading at us
    if (this.state !== 'cop') for (const v of g.vehicles) {
      const sp = v.speed; if (sp < 4) continue;
      const rx = this.pos.x - v.pos.x, rz = this.pos.z - v.pos.z, d = Math.hypot(rx, rz); if (d > 14) continue;
      const along_ = (rx * v.vx + rz * v.vz) / sp, lat = Math.abs(rx * v.vz - rz * v.vx) / sp;
      if (along_ > 0 && lat < 2.4 && along_ < sp * 1.2 && Math.random() < dt * 4 && this.state !== 'flee') { this.flee(v.pos, 3); }
    }
    for (let i = 0; i < 2; i++) { const o = grid.push(this.pos.x, this.pos.z, 0.3); if (!o.hit) break; this.pos.x += o.x; this.pos.z += o.z; }
    g.world.bounds(this.pos);
    this.speed = speed;
    opts.aim = this.aimK || 0; opts.pitch = 0;
    this.h.twoHand = false;
    this.h.animate(dt, speed, opts);
    this.sync();
  }
  turnTo(a, dt, rate) { this.yaw += shortestAngle(a - this.yaw) * Math.min(1, rate * dt); }
  dispose() { this.h.dispose(this.game.scene); }
}

/** Spawns/despawns pedestrians on sidewalks around the player. */
export class PedManager {
  constructor(game) {
    this.game = game; this.list = [];
    this.samples = [];
    for (const sw of game.world.sidewalks) {
      const L = sw.D[sw.D.length - 1];
      for (let s = 5; s < L - 5; s += 14) {
        const p = along(sw.pts, sw.D, s);
        if (game.map.inSchool(p.x, p.z) || game.world.insideBuilding(p.x, p.z)) continue;
        this.samples.push({ x: p.x, z: p.z, path: sw, s, paved: sw.paved });
      }
    }
    const C = 50; this.cells = new Map();
    this.samples.forEach((sm) => { const k = Math.floor(sm.x / C) * 4096 + Math.floor(sm.z / C); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(sm); });
    this.C = C; this.spawnT = 0;
  }
  nearestSidewalk(x, z, maxD) {
    let best = null, bd = maxD; const C = this.C, r = Math.ceil(maxD / C);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const l = this.cells.get((Math.floor(x / C) + i) * 4096 + Math.floor(z / C) + j); if (!l) continue;
      for (const sm of l) { const d = Math.hypot(sm.x - x, sm.z - z); if (d < bd) { bd = d; best = sm; } }
    }
    return best ? { path: best.path, s: best.s, x: best.x, z: best.z } : null;
  }
  spawnNear(px, pz, minD, maxD, opts = {}) {
    const g = this.game, cam = g.camera, fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD), x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const sm = this.nearestSidewalk(x, z, 30); if (!sm) continue;
      const dd = Math.hypot(sm.x - px, sm.z - pz); if (dd < minD || dd > maxD) continue;
      const vis = ((sm.x - cam.position.x) * fwd.x + (sm.z - cam.position.z) * fwd.z) / dd;
      if (!opts.anywhere && vis > 0.35 && dd < 90) continue;
      if (g.map.inSchool(sm.x, sm.z)) continue;
      const p = new Ped(g, sm.x, sm.z, opts);
      p.path = sm.path; p.s = sm.s; p.dir = Math.random() < 0.5 ? 1 : -1;
      this.list.push(p); return p;
    }
    return null;
  }
  add(p) { this.list.push(p); return p; }
  panic(x, z, radius, src) {
    for (const p of this.list) if (!p.cop && p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < radius) { p.flee(src || { x, z }, 8 + Math.random() * 6); if (Math.random() < 0.15) this.game.audio.scream(p.pos); }
  }
  update(dt) {
    const g = this.game, pp = g.focus;
    const want = Math.round((g.sky.night > 0.5 ? 12 : 26) * (g.settings.density ?? 1));
    this.spawnT -= dt;
    const civ = this.list.filter(p => !p.cop).length;
    if (civ < want && this.spawnT <= 0) { this.spawnT = 0.15; this.spawnNear(pp.x, pp.z, 40, 140); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
      if ((d > 180 && !p.keep) || (p.state === 'dead' && p.removeT <= 0) || p.remove) { p.dispose(); this.list.splice(i, 1); continue; }
      if (d < 140 || p.cop) p.update(dt); else p.h.root.visible = false;
      if (d < 140) p.h.root.visible = true;
    }
    // vehicles vs peds
    for (const v of g.vehicles) {
      const sp = v.speed; if (sp < 2.5) continue;
      for (const p of this.list) {
        if (!p.alive || p.state === 'knocked' || p.inVehicle) continue;
        if (Math.abs(p.pos.x - v.pos.x) > 5 || Math.abs(p.pos.z - v.pos.z) > 5) continue;
        if (v.contains(p.pos.x, p.pos.z, 0.35)) {
          p.knock(v.vx * 0.9, v.vz * 0.9, sp * 6.5, v === g.player.vehicle ? 'player' : 'vehicle');
          if (v === g.player.vehicle) { g.crime(sp > 8 ? 'assault' : 'minor', p.pos); }
          v.vx *= 0.92; v.vz *= 0.92;
          this.panic(p.pos.x, p.pos.z, 25, v.pos);
        }
      }
    }
  }
}
