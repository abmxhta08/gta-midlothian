import * as THREE from 'three';
import { Human } from './entities/human.js';
import { WEAPONS, ORDER, weaponMesh } from './weapons.js';
import { shortestAngle, clamp, mulberry32 } from './util.js';

/** The player on foot: movement, jumping, health/armor, inventory and firing. */
export class Player {
  constructor(game) {
    this.game = game;
    this.h = new Human(game.scene, { rand: mulberry32(2026), height: 1.0, fem: false, skin: 0xc68e64, hair: 0x1a1410, hairStyle: 0.2, top: 0x2f3a2a, bottom: 0x2b3346, shoe: 0xeeeeee, sleeves: false });
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.y = 0; this.vy = 0; this.speed = 0;
    this.health = 100; this.armor = 0; this.money = 0; this.vehicle = null; this.aiming = false;
    this.inv = { fists: {}, pistol: { ammo: 12, reserve: 48 } }; this.current = 'pistol'; this.cool = 0; this.reloadT = 0; this.held = false;
    this.equip('pistol');
  }
  get weapon() { return WEAPONS[this.current]; }
  get dead() { return this.health <= 0; }
  setPos(x, z) { this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.y = 0; this.vy = 0; this.sync(); }
  sync() { this.h.root.position.set(this.pos.x, this.y, this.pos.z); this.h.root.rotation.y = this.yaw; }
  equip(id) {
    if (!this.inv[id]) return false;
    this.current = id; this.reloadT = 0; this.mesh = weaponMesh(id); this.h.setWeaponMesh(this.mesh); this.h.twoHand = !!WEAPONS[id].twoHand;
    return true;
  }
  cycle(dir) { const owned = ORDER.filter(k => this.inv[k]); const i = owned.indexOf(this.current); this.equip(owned[(i + dir + owned.length) % owned.length]); }
  give(id, ammo) {
    const w = WEAPONS[id];
    if (!this.inv[id]) { this.inv[id] = { ammo: Math.min(ammo, w.mag), reserve: Math.max(0, ammo - w.mag) }; if (this.current === 'fists' || this.current === 'pistol') this.equip(id); }
    else this.inv[id].reserve += ammo;
  }
  damage(n) {
    if (this.dead || this.game.state !== 'play') return;
    const g = this.game;
    if (this.armor > 0) { const a = Math.min(this.armor, n * 0.7); this.armor -= a; n -= a; }
    this.health = Math.max(0, this.health - n);
    g.hud.flashDamage();
    if (this.health <= 0) g.wasted();
  }
  rayHit(o, d, maxD) {
    const H = 1.75, r = 0.32, wx = o.x - this.pos.x, wz = o.z - this.pos.z, dd = d.x * d.x + d.z * d.z; if (dd < 1e-6) return null;
    const tc = -(wx * d.x + wz * d.z) / dd, cx = wx + d.x * tc, cz = wz + d.z * tc, dist2 = cx * cx + cz * cz; if (dist2 > r * r) return null;
    const t = tc - Math.sqrt((r * r - dist2) / dd); if (t < 0 || t > maxD) return null;
    const y = o.y + d.y * t - this.y; return y >= 0 && y <= H ? { t } : null;
  }
  muzzleWorld(out) {
    this.h.root.updateMatrixWorld(true);
    if (this.mesh) return this.mesh.localToWorld(out.copy(this.mesh.userData.muzzle));
    return out.set(this.pos.x, 1.4, this.pos.z);
  }
  update(dt, input, camYaw, camPitch) {
    const g = this.game, w = this.weapon;
    // weapon switching
    if (input.wheel) this.cycle(input.wheel > 0 ? 1 : -1);
    for (const id of ORDER) if (input.pressed('Digit' + WEAPONS[id].slot)) this.equip(id);
    this.aiming = input.aim && !w.melee;
    // movement
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0), r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    let mx = Math.sin(camYaw) * f - Math.cos(camYaw) * r, mz = Math.cos(camYaw) * f + Math.sin(camYaw) * r;
    const len = Math.hypot(mx, mz); if (len > 0) { mx /= len; mz /= len; }
    const tgt = len > 0 ? (this.aiming ? 2.2 : run ? 7.2 : 3.6) : 0, k = 1 - Math.exp(-(this.y > 0 ? 2 : 11) * dt);
    this.vel.x += (mx * tgt - this.vel.x) * k; this.vel.z += (mz * tgt - this.vel.z) * k;
    if (input.pressed('Space') && this.y <= 0) this.vy = 5.2;
    this.vy -= 15 * dt; this.y = Math.max(0, this.y + this.vy * dt); if (this.y <= 0) this.vy = 0;
    const sp = Math.hypot(this.vel.x, this.vel.z); this.speed = sp;
    const steps = Math.max(1, Math.ceil(sp * dt / 0.25));
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vel.x * dt / steps; this.pos.z += this.vel.z * dt / steps;
      for (let i = 0; i < 3; i++) { const o = g.world.grid.push(this.pos.x, this.pos.z, 0.38); if (!o.hit) break; this.pos.x += o.x; this.pos.z += o.z; }
    }
    // push out of vehicles
    for (const v of g.vehicles) {
      if (Math.abs(v.pos.x - this.pos.x) > 5 || Math.abs(v.pos.z - this.pos.z) > 5) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.pos.x - cx, dz = this.pos.z - cz, d = Math.hypot(dx, dz), m = v.dims.hw + 0.4;
        if (d < m && d > 1e-3) { this.pos.x += dx / d * (m - d); this.pos.z += dz / d * (m - d); }
      }
    }
    g.world.bounds(this.pos);
    const wantYaw = this.aiming || (this.cool > 0 && !w.melee) ? camYaw : (len > 0 ? Math.atan2(mx, mz) : this.yaw);
    this.yaw += shortestAngle(wantYaw - this.yaw) * (1 - Math.exp(-14 * dt));
    // firing
    this.cool = Math.max(0, this.cool - dt);
    const inv = this.inv[this.current];
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const n = Math.min(w.mag - inv.ammo, inv.reserve); inv.ammo += n; inv.reserve -= n; } }
    if (input.pressed('KeyR') && !w.melee && inv.ammo < w.mag && inv.reserve > 0 && this.reloadT <= 0) { this.reloadT = w.reload; g.audio.reload(); }
    const trigger = w.auto ? input.fire : (input.fire && !this.held);
    this.held = input.fire;
    if (trigger && this.cool <= 0 && this.reloadT <= 0) {
      if (w.melee) { this.cool = w.rate; this.h.punch = 1; g.combat.melee(this); }
      else if (inv.ammo > 0) {
        inv.ammo--; this.cool = w.rate; this.h.kick = 1;
        this.yaw = camYaw;
        const m = this.muzzleWorld(new THREE.Vector3());
        g.combat.playerFire(w, m);
        g.recoil(w.recoil);
        if (inv.ammo === 0 && inv.reserve > 0) { this.reloadT = w.reload; g.audio.reload(); }
      } else { g.audio.click(); this.cool = 0.3; if (inv.reserve > 0) { this.reloadT = w.reload; g.audio.reload(); } }
    }
    const aimK = (this.aiming || this.cool > 0.02) && !w.melee ? 1 : 0;
    this.h.animate(dt, this.y > 0 ? 0 : sp, { aim: aimK, pitch: clamp(camPitch, -0.9, 0.9), air: this.y > 0.05 });
    this.sync();
  }
}
