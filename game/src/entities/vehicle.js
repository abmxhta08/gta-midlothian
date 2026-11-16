import * as THREE from 'three';
import { carParts, wheelGeo, MATS, paint, CAR_TYPES } from './carmodels.js';
import { clamp } from '../util.js';

const TMP = new THREE.Vector3();

/** Drivable vehicle (player, AI traffic, police). Arcade physics with lateral grip / handbrake drift. */
export class Vehicle {
  constructor(game, type = 'sedan', color = 0x8a1010) {
    this.game = game; this.type = type; this.color = color;
    const { parts, wheels, dims, t } = carParts(type);
    this.dims = dims; this.spec = t; this.police = type === 'police';
    this.pos = new THREE.Vector3(); this.heading = 0; this.vx = 0; this.vz = 0; this.yawRate = 0; this.steer = 0;
    this.health = this.police ? 1400 : 1000; this.dead = false; this.burn = 0; this.driver = null; this.mode = 'physics';
    this.siren = false; this.horn = 0; this.lastImpact = 0; this.smokeT = 0; this.braking = false; this.skidT = 0; this.age = 0;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt);
    this.paint = paint(this.police ? 0x0d0d10 : color);
    this.tailMat = MATS.tail.clone(); this.redMat = MATS.red.clone(); this.blueMat = MATS.blue.clone();
    const matFor = (k) => ({ paint: this.paint, tail: this.tailMat, red: this.redMat, blue: this.blueMat }[k] || MATS[k]);
    this.meshes = [];
    for (const p of parts) { const m = new THREE.Mesh(p.geo, matFor(p.mat)); m.castShadow = true; m.receiveShadow = true; m.userData.kind = p.mat; this.tilt.add(m); this.meshes.push(m); }
    this.wheels = wheels.map(w => {
      const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z); this.group.add(pivot);
      const spin = new THREE.Group(); pivot.add(spin); const g = wheelGeo(w.r);
      const tire = new THREE.Mesh(g.tire, MATS.tire), rim = new THREE.Mesh(g.rim, MATS.rim); tire.castShadow = true; spin.add(tire, rim);
      return { pivot, spin, front: w.front, x: w.x, z: w.z };
    });
    this.wheelRot = 0;
    game.scene.add(this.group);
  }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  setPose(x, z, h) { this.pos.set(x, 0, z); this.heading = h; this.vx = this.vz = 0; this.yawRate = 0; this.sync(); }
  sync() { this.group.position.copy(this.pos); this.group.rotation.y = this.heading; }
  /** World-space circle centres used for collision. */
  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), d = Math.max(0, this.dims.hl - this.dims.hw) * 0.9, zc = this.dims.zc;
    return [[this.pos.x + fx * (zc - d), this.pos.z + fz * (zc - d)], [this.pos.x + fx * zc, this.pos.z + fz * zc], [this.pos.x + fx * (zc + d), this.pos.z + fz * (zc + d)]];
  }
  /** Ray vs oriented box. Returns distance or Infinity. */
  rayHit(o, d, maxD) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const rx = o.x - this.pos.x, rz = o.z - this.pos.z;
    const lo = [rx * c - rz * s, o.y, rx * s + rz * c - this.dims.zc], ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c];
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
  explode() {
    if (this.dead) return; this.dead = true; this.burn = 0;
    for (const m of this.meshes) { if (m.userData.kind === 'glass') m.visible = false; else m.material = MATS.burnt; }
    this.game.explosion(this.pos.clone(), this);
    this.vx *= 0.3; this.vz *= 0.3;
  }

  update(dt, c) {
    this.age += dt;
    if (this.mode === 'kinematic') { this.animate(dt, this.forwardSpeed, 0); return; }
    const t = this.spec, sp = t.speed || 1;
    const VMAX = 46 * sp, ENGINE = 11.5 * sp, BRAKE = 26, WB = this.dims.wb;
    if (this.dead) c = { throttle: 0, steer: 0, brake: true };
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz, vL = this.vx * rx + this.vz * rz, a = 0;
    if (c.throttle > 0) a = vF < -0.5 ? BRAKE : ENGINE * c.throttle * (1 - Math.max(0, vF) / VMAX) * (vF < 8 ? 1.2 : 1);
    else if (c.throttle < 0) a = vF > 0.5 ? -BRAKE : ENGINE * 0.6 * c.throttle * (1 - Math.max(0, -vF) / 12);
    if (c.brake && !this.driver) a -= Math.sign(vF) * BRAKE;
    a -= vF * 0.06 + Math.sign(vF) * (0.35 + vF * vF * 0.0004);
    const nvF = vF + a * dt;
    vF = (c.throttle === 0 && Math.abs(nvF) < 0.2) || ((c.brake && !this.driver) && Math.sign(nvF) !== Math.sign(vF)) ? 0 : nvF;
    if (c.handbrake) { vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt); }
    const grip = c.handbrake ? 1.6 : (this.dead ? 3 : 8.5);
    vL *= Math.exp(-grip * dt);
    const maxSteer = Math.min(0.62, Math.atan(26 * WB / Math.max(vF * vF, 1)) * (c.handbrake ? 1.5 : 1));
    this.steer += (c.steer * maxSteer - this.steer) * (1 - Math.exp(-8 * dt));
    let target = vF / WB * Math.tan(this.steer);
    if (c.handbrake) target *= 1.45;
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-(c.handbrake ? 4 : 9) * dt));
    this.heading += this.yawRate * dt;
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vx = nfx * vF + -nfz * vL; this.vz = nfz * vF + nfx * vL;
    // skids
    this.skidT -= dt;
    if ((Math.abs(vL) > 2.6 || (c.handbrake && Math.abs(vF) > 6) || (a < -20 && Math.abs(vF) > 10)) && this.skidT <= 0) {
      this.skidT = 0.04;
      for (const w of this.wheels) if (!w.front) { const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading); this.game.effects.skid(this.pos.x + w.x * c2 + w.z * s2, this.pos.z - w.x * s2 + w.z * c2, this.heading); }
      this.game.audio?.skid(this === this.game.player.vehicle);
    }
    // integrate with collision
    const spd = Math.hypot(this.vx, this.vz), steps = Math.max(1, Math.ceil(spd * dt / 0.35));
    let impact = 0, hitN = null;
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vx * dt / steps; this.pos.z += this.vz * dt / steps;
      for (let it = 0; it < 3; it++) {
        let any = false;
        for (const [cx, cz] of this.circles()) {
          const o = this.game.world.grid.push(cx, cz, this.dims.hw * 0.98);
          if (!o.hit) continue; any = true;
          this.pos.x += o.x; this.pos.z += o.z;
          const vn = this.vx * o.nx + this.vz * o.nz;
          if (vn < 0) { this.vx -= o.nx * vn * 1.15; this.vz -= o.nz * vn * 1.15; impact = Math.max(impact, -vn); hitN = [o.nx, o.nz]; }
        }
        if (!any) break;
      }
    }
    if (this.game.world.bounds(this.pos)) { this.vx *= 0.5; this.vz *= 0.5; }
    if (impact > 3) this.onImpact(impact, hitN);
    this.braking = (c.throttle < 0 && vF > 0.5) || c.handbrake || (c.brake && Math.abs(vF) > 0.3);
    this.animate(dt, vF, a);
  }
  onImpact(imp, n) {
    if (this.game.time - this.lastImpact < 0.25) return; this.lastImpact = this.game.time;
    if (imp > 5) this.damage((imp - 5) * 22);
    this.game.audio?.crash(imp, this.pos);
    if (n && imp > 6) this.game.effects.impact(new THREE.Vector3(this.pos.x - n[0] * this.dims.hw, 0.6, this.pos.z - n[1] * this.dims.hw), new THREE.Vector3(n[0], 0.3, n[1]).normalize());
    this.game.onVehicleImpact?.(this, imp);
  }
  animate(dt, vF, a) {
    this.wheelRot += vF * dt / (this.spec.r || 0.35);
    for (const w of this.wheels) { w.spin.rotation.x = this.wheelRot; if (w.front) w.pivot.rotation.y = this.steer; }
    this.tilt.rotation.x += (clamp(-a * 0.0035, -0.045, 0.045) - this.tilt.rotation.x) * Math.min(1, dt * 6);
    this.tilt.rotation.z += (clamp(this.yawRate * vF * 0.006, -0.07, 0.07) - this.tilt.rotation.z) * Math.min(1, dt * 6);
    this.tailMat.emissiveIntensity = this.braking ? 4 : 0.15 + this.game.sky.night * 1.2;
    if (this.police) {
      const on = this.siren, ph = Math.floor(this.game.time * 6) % 2;
      this.redMat.emissiveIntensity = on && ph ? 8 : 0; this.blueMat.emissiveIntensity = on && !ph ? 8 : 0;
    }
    // damage effects
    if (this.health < 450 && !this.dead) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.health < 200 ? 0.06 : 0.18;
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading), hp = TMP.set(this.pos.x + fx * (this.dims.hl - 0.8), 1.0, this.pos.z + fz * (this.dims.hl - 0.8));
        this.game.effects.smoke(hp, this.health < 200 ? 0x222222 : 0x888888, 0.7, 1.6, 1.5);
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
  dispose() { this.game.scene.remove(this.group); this.paint.dispose(); this.tailMat.dispose(); this.redMat.dispose(); this.blueMat.dispose(); }
}
export { CAR_TYPES };
