import * as THREE from 'three';
import { carParts, MATS, CAR_TYPES, dynamicCar, MISC_MAT, paint } from './carmodels.js';
import { VEHICLES } from '../data/vehicles.js';
import { clamp } from '../util.js';
import { events } from '../core/events.js';

const TMP = new THREE.Vector3();

/** Drivable vehicle (player, AI traffic, police). Arcade physics with lateral grip / handbrake drift,
 *  per-type handling from data/vehicles.js, bikes (lean, rider thrown on crashes), rollovers + recovery,
 *  ballistic flight off stunt ramps, popped tyres (spike strips) and weather grip. */
export class Vehicle {
  constructor(game, type = 'sedan', color = null) {
    this.game = game; this.type = VEHICLES[type] ? type : 'sedan';
    const h = this.h = VEHICLES[this.type], model = h.model;
    const { wheels, dims, t } = carParts(model);
    this.dims = dims; this.spec = t; this.bike = !!h.bike; this.police = model === 'police' || model === 'swat';
    this.color = color ?? h.color ?? 0x8a1010;
    this.pos = new THREE.Vector3(); this.heading = 0; this.vx = 0; this.vz = 0; this.yawRate = 0; this.steer = 0; this.y = 0; this.vy = 0;
    this.health = h.health; this.maxHealth = h.health; this.dead = false; this.burn = 0; this.driver = null; this.mode = 'physics';
    this.siren = false; this.lastImpact = 0; this.smokeT = 0; this.braking = false; this.skidT = 0; this.age = 0;
    this.flipped = false; this.flipK = 0; this.tiresPopped = false; this.airT = 0;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt);
    this.paint = paint(this.police ? (model === 'swat' ? 0x1a1d22 : 0x0d0d10) : this.color);
    this.tailMat = MATS.tail.clone(); this.redMat = MATS.red.clone(); this.blueMat = MATS.blue.clone();
    const matFor = (k) => ({ paint: this.paint, tail: this.tailMat, red: this.redMat, blue: this.blueMat, misc: MISC_MAT }[k] || MATS[k]);
    const dyn = dynamicCar(model);
    this.meshes = [];
    for (const [k, geo] of Object.entries(dyn.groups)) { const m = new THREE.Mesh(geo, matFor(k)); m.castShadow = k !== 'head' && k !== 'tail'; m.receiveShadow = true; m.userData.kind = k; this.tilt.add(m); this.meshes.push(m); }
    this.wheels = wheels.map(w => {
      const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z); this.tilt.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin);
      const wm = new THREE.Mesh(dyn.wheel, MISC_MAT); wm.castShadow = true; spin.add(wm);
      return { pivot, spin, front: w.front, x: w.x, z: w.z };
    });
    const n = this.bike ? 2 : Math.max(3, Math.ceil((dims.hl * 2) / (dims.hw * 1.5)) + 1);
    this.circleOffsets = Array.from({ length: n }, (_, i) => dims.zc - (dims.hl - dims.hw) * 0.92 + (i / (n - 1)) * (dims.hl - dims.hw) * 1.84);
    this.wheelRot = 0;
    game.scene.add(this.group);
  }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get radius() { return this.bike ? 0.4 : this.dims.hw; }
  setPose(x, z, h) { this.pos.set(x, 0, z); this.heading = h; this.vx = this.vz = 0; this.yawRate = 0; this.y = 0; this.vy = 0; this.sync(); }
  sync() { this.group.position.set(this.pos.x, this.y, this.pos.z); this.group.rotation.y = this.heading; }
  /** World-space circle centres used for collision. */
  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return this.circleOffsets.map(o => [this.pos.x + fx * o, this.pos.z + fz * o]);
  }
  /** Ray vs oriented box. Returns distance or Infinity. */
  rayHit(o, d, maxD) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const rx = o.x - this.pos.x, rz = o.z - this.pos.z;
    const lo = [rx * c - rz * s, o.y - this.y, rx * s + rz * c - this.dims.zc], ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c];
    const mn = [-this.dims.hw, 0.15, -this.dims.hl], mx = [this.dims.hw, this.dims.h, this.dims.hl];
    let t0 = 0, t1 = maxD;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-8) { if (lo[i] < mn[i] || lo[i] > mx[i]) return Infinity; continue; }
      let a = (mn[i] - lo[i]) / ld[i], b = (mx[i] - lo[i]) / ld[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity;
    }
    return t0;
  }
  /** Is world point inside the (slightly inflated) footprint? */
  contains(x, z, pad = 0) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), rx = x - this.pos.x, rz = z - this.pos.z;
    const u = rx * c - rz * s, w = rx * s + rz * c - this.dims.zc;
    return Math.abs(u) < this.dims.hw + pad && Math.abs(w) < this.dims.hl + pad;
  }
  damage(n) {
    if (this.dead) return;
    this.health -= n;
    if (this.health <= 0 && !this.burn) this.burn = 0.01;
  }
  repair() { this.health = this.maxHealth; this.burn = 0; this.tiresPopped = false; this.flipped = false; this.flipK = 0; }
  explode() {
    if (this.dead) return; this.dead = true; this.burn = 0;
    for (const m of this.meshes) { if (m.userData.kind === 'glass') m.visible = false; else m.material = MATS.burnt; }
    this.game.explosion(this.pos.clone(), this);
    this.vx *= 0.3; this.vz *= 0.3;
    events.emit('vehicleDestroyed', { vehicle: this });
  }
  /** Roll the vehicle onto its roof (big side hits, explosions). Cars only. */
  flip() { if (!this.bike && !this.dead) { this.flipped = true; this.vx *= 0.4; this.vz *= 0.4; } }
  /** Put a flipped (or stuck) vehicle back on its wheels. */
  recover() { if (this.speed < 3) { this.flipped = false; this.vx = this.vz = 0; this.yawRate = 0; return true; } return false; }
  launch(vy) { this.vy = vy; this.y = Math.max(this.y, 0.05); this.airT = 0; }

  update(dt, c) {
    this.age += dt;
    if (this.mode === 'kinematic') { this.animate(dt, this.forwardSpeed, 0); return; }
    const h = this.h, wx = this.game.weather, wetGrip = wx ? wx.grip : 1;
    let VMAX = h.vmax, ENGINE = h.engine, BRAKE = h.brake, grip = h.grip * wetGrip;
    if (this.tiresPopped) { VMAX *= 0.5; grip *= 0.55; }
    const WB = this.dims.wb;
    if (this.dead || this.flipped) c = { throttle: 0, steer: 0, brake: true };
    const air = this.y > 0.02 || this.vy > 0;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz, vL = this.vx * rx + this.vz * rz, a = 0;
    if (!air) {
      if (c.throttle > 0) a = vF < -0.5 ? BRAKE : ENGINE * c.throttle * (1 - Math.max(0, vF) / VMAX) * (vF < 8 ? 1.2 : 1);
      else if (c.throttle < 0) a = vF > 0.5 ? -BRAKE : ENGINE * 0.6 * c.throttle * (1 - Math.max(0, -vF) / (this.bike ? 6 : 12));
      if (c.brake && !this.driver) a -= Math.sign(vF) * BRAKE;
      a -= vF * 0.06 + Math.sign(vF) * (0.35 + vF * vF * 0.0004) + (this.flipped ? Math.sign(vF) * 12 : 0);
      const nvF = vF + a * dt;
      vF = (c.throttle === 0 && Math.abs(nvF) < 0.2) || ((c.brake && !this.driver) && Math.sign(nvF) !== Math.sign(vF)) ? 0 : nvF;
      if (c.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);
      vL *= Math.exp(-(c.handbrake ? h.drift * wetGrip : (this.dead || this.flipped ? 3 : grip)) * dt);
      const maxSteer = Math.min(h.steer, Math.atan(26 * WB / Math.max(vF * vF, 1)) * (c.handbrake ? 1.5 : 1));
      this.steer += (c.steer * maxSteer - this.steer) * (1 - Math.exp(-8 * dt));
      let target = vF / WB * Math.tan(this.steer);
      if (c.handbrake) target *= 1.45;
      this.yawRate += (target - this.yawRate) * (1 - Math.exp(-(c.handbrake ? 4 : 9) * dt));
    } else {
      // airborne: keep momentum, gravity pulls the car down
      this.airT += dt; this.vy -= 13 * dt; this.y += this.vy * dt; this.yawRate *= Math.exp(-2 * dt);
      if (this.y <= 0) { const imp = -this.vy; this.y = 0; this.vy = 0; if (imp > 7) this.onImpact(imp * 0.6, null); events.emit('vehicleLanded', { vehicle: this, airTime: this.airT }); }
    }
    this.heading += this.yawRate * dt;
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vx = nfx * vF + -nfz * vL; this.vz = nfz * vF + nfx * vL;
    // skids
    this.skidT -= dt;
    if (!air && !this.bike && (Math.abs(vL) > 2.6 || (c.handbrake && Math.abs(vF) > 6) || (a < -20 && Math.abs(vF) > 10)) && this.skidT <= 0) {
      this.skidT = 0.04;
      for (const w of this.wheels) if (!w.front) { const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading); this.game.effects.skid(this.pos.x + w.x * c2 + w.z * s2, this.pos.z - w.x * s2 + w.z * c2, this.heading); }
      this.game.audio?.skid(this === this.game.player.vehicle);
    }
    // integrate with collision (skip walls while flying over low things is not modelled: buildings still block)
    const spd = Math.hypot(this.vx, this.vz), steps = Math.max(1, Math.ceil(spd * dt / 0.35)), rad = this.radius * 0.98;
    let impact = 0, hitN = null, side = 0;
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vx * dt / steps; this.pos.z += this.vz * dt / steps;
      for (let it = 0; it < 3; it++) {
        let any = false;
        for (const [cx, cz] of this.circles()) {
          const o = this.game.world.grid.push(cx, cz, rad);
          if (!o.hit) continue; any = true;
          this.pos.x += o.x; this.pos.z += o.z;
          const vn = this.vx * o.nx + this.vz * o.nz;
          if (vn < 0) { this.vx -= o.nx * vn * 1.15; this.vz -= o.nz * vn * 1.15; if (-vn > impact) { impact = -vn; hitN = [o.nx, o.nz]; side = Math.abs(o.nx * rx + o.nz * rz); } }
        }
        if (!any) break;
      }
    }
    if (this.game.world.bounds(this.pos)) { this.vx *= 0.5; this.vz *= 0.5; }
    if (impact > 3) { this.onImpact(impact, hitN); if (impact > 20 && side > 0.7) this.flip(); }
    this.braking = (c.throttle < 0 && vF > 0.5) || c.handbrake || (c.brake && Math.abs(vF) > 0.3);
    this.animate(dt, vF, a);
  }
  onImpact(imp, n) {
    if (this.game.time - this.lastImpact < 0.25) return; this.lastImpact = this.game.time;
    if (imp > 5) this.damage((imp - 5) * 22 / Math.max(0.5, this.h.mass));
    this.game.audio?.crash(imp, this.pos);
    if (n && imp > 6) this.game.effects.impact(new THREE.Vector3(this.pos.x - n[0] * this.dims.hw, 0.6, this.pos.z - n[1] * this.dims.hw), new THREE.Vector3(n[0], 0.3, n[1]).normalize());
    this.game.onVehicleImpact?.(this, imp);
  }
  animate(dt, vF, a) {
    this.wheelRot += vF * dt / (this.spec.r || 0.35);
    for (const w of this.wheels) { w.spin.rotation.x = this.wheelRot; if (w.front) w.pivot.rotation.y = this.steer; }
    const k = Math.min(1, dt * 6);
    if (this.bike) {
      this.tilt.rotation.z += (clamp(-this.yawRate * vF * 0.06, -0.55, 0.55) - this.tilt.rotation.z) * k;
      this.tilt.rotation.x += (clamp(this.vy * -0.03, -0.3, 0.3) - this.tilt.rotation.x) * k;
    } else {
      this.flipK += ((this.flipped ? 1 : 0) - this.flipK) * Math.min(1, dt * 3);
      this.tilt.rotation.x += (clamp(-a * 0.0035 - this.vy * 0.025, -0.35, 0.35) - this.tilt.rotation.x) * k;
      const roll = clamp(this.yawRate * vF * 0.006, -0.07, 0.07);
      this.tilt.rotation.z = roll * (1 - this.flipK) + Math.PI * this.flipK;
      this.tilt.position.y = this.flipK * this.dims.h * 0.95;
    }
    this.tailMat.emissiveIntensity = this.braking ? 4 : 0.15 + this.game.sky.night * 1.2;
    if (this.police) {
      const on = this.siren, ph = Math.floor(this.game.time * 6) % 2;
      this.redMat.emissiveIntensity = on && ph ? 8 : 0; this.blueMat.emissiveIntensity = on && !ph ? 8 : 0;
    }
    if (this.tiresPopped && this.speed > 4 && Math.random() < dt * 20) this.game.effects.impact(new THREE.Vector3(this.pos.x, 0.1, this.pos.z), new THREE.Vector3(0, 1, 0), 'spark');
    // damage effects
    if (this.health < this.maxHealth * 0.45 && !this.dead) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        const low = this.health < this.maxHealth * 0.2;
        this.smokeT = low ? 0.06 : 0.18;
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading), hp = TMP.set(this.pos.x + fx * (this.dims.hl - 0.8), this.y + 1.0, this.pos.z + fz * (this.dims.hl - 0.8));
        this.game.effects.smoke(hp, low ? 0x222222 : 0x888888, 0.7, 1.6, 1.5);
        if (this.burn > 0) this.game.effects.fire(hp, 1);
      }
    }
    if (this.burn > 0 && !this.dead) { this.burn += dt; if (this.burn > 5) this.explode(); }
    if (this.dead) {
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.age % 30 < 20) { this.smokeT = 0.25; this.game.effects.smoke(TMP.set(this.pos.x, 1.2, this.pos.z), 0x1a1a1a, 1.2, 2.5, 1.4); }
    }
    this.sync();
  }
  /** Repaint (paint shop). */
  setColor(hex) { this.color = hex; this.paint.color.setHex(hex); }
  dispose() { this.game.scene.remove(this.group); this.paint.dispose(); this.tailMat.dispose(); this.redMat.dispose(); this.blueMat.dispose(); }
}
export { CAR_TYPES };
