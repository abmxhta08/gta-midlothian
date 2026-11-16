import * as THREE from 'three';
import { Human } from './entities/human.js';
import { WEAPONS, ORDER, weaponMesh } from './weapons.js';
import { shortestAngle, clamp, mulberry32 } from './util.js';
import { findCover, coverBehind, vaultTarget } from './systems/cover.js';
import { events } from './core/events.js';

export const DEFAULT_OUTFIT = { skin: 0xc68e64, hair: 0x1a1410, hairStyle: 0.2, top: 0x2f3a2a, bottom: 0x2b3346, shoe: 0xeeeeee, sleeves: false };

/** The player on foot: movement, sprint stamina, jump/vault, cover, ragdoll, swimming, health/armor,
 *  inventory and firing (hitscan, melee, sniper scope, thrown stun grenades). */
export class Player {
  constructor(game) {
    this.game = game;
    this.outfit = { ...DEFAULT_OUTFIT };
    this.h = this.makeHuman();
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.y = 0; this.vy = 0; this.speed = 0;
    this.health = 100; this.armor = 0; this.money = 0; this.vehicle = null; this.aiming = false; this.scoped = false;
    this.stamina = 100; this.staminaLock = false; this.cover = null; this.vault = null; this.ragdoll = 0; this.swimming = false; this.inSafe = false;
    this.inv = { fists: {}, pistol: { ammo: 12, reserve: 48 } }; this.current = 'pistol'; this.cool = 0; this.reloadT = 0; this.held = false; this.breath = 0;
    this.equip('pistol');
  }
  makeHuman() { return new Human(this.game.scene, { rand: mulberry32(2026), height: 1.0, fem: false, ...this.outfit }); }
  setOutfit(o) {
    const vis = this.h.visible; this.outfit = { ...this.outfit, ...o };
    this.h.dispose(this.game.scene); this.h = this.makeHuman(); this.h.visible = vis; this.equip(this.current); this.sync();
  }
  get weapon() { return WEAPONS[this.current]; }
  get dead() { return this.health <= 0; }
  get canUseWeapons() { return !this.inSafe && !this.swimming && !this.ragdoll && !this.vault; }
  setPos(x, z) { this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.y = 0; this.vy = 0; this.cover = null; this.vault = null; this.ragdoll = 0; this.h.dead = 0; this.sync(); }
  sync() { this.h.root.position.set(this.pos.x, this.y + (this.swimming ? -1.05 : 0), this.pos.z); this.h.root.rotation.y = this.yaw; }
  equip(id) {
    if (!this.inv[id]) return false;
    this.current = id; this.reloadT = 0; this.mesh = weaponMesh(id); this.h.setWeaponMesh(this.canUseWeapons ? this.mesh : null); this.h.twoHand = !!WEAPONS[id].twoHand;
    return true;
  }
  cycle(dir) { const owned = ORDER.filter(k => this.inv[k]); const i = owned.indexOf(this.current); this.equip(owned[(i + dir + owned.length) % owned.length]); }
  give(id, ammo) {
    const w = WEAPONS[id];
    if (w.melee) { this.inv[id] = this.inv[id] || {}; return; }
    if (w.thrown) { this.inv[id] = { ammo: (this.inv[id]?.ammo || 0) + ammo, reserve: 0 }; return; }
    if (!this.inv[id]) { this.inv[id] = { ammo: Math.min(ammo, w.mag), reserve: Math.max(0, ammo - w.mag) }; if (this.current === 'fists' || this.current === 'pistol') this.equip(id); }
    else this.inv[id].reserve += ammo;
  }
  damage(n, opts = {}) {
    if (this.dead || this.game.state !== 'play') return;
    const g = this.game;
    if (this.armor > 0) { const a = Math.min(this.armor, n * 0.7); this.armor -= a; n -= a; }
    this.health = Math.max(0, this.health - n);
    g.hud.flashDamage();
    if (this.health <= 0) g.wasted();
  }
  /** Knock the player over (explosions, car hits, bike crashes). */
  knock(vx, vz, up = 4) {
    if (this.vehicle || this.dead) return;
    this.cover = null; this.vault = null; this.ragdoll = 1.8; this.vel.set(vx, 0, vz); this.vy = up; this.y = Math.max(this.y, 0.05);
    this.h.dead = 0.01; this.h.deathDir = 1;
  }
  rayHit(o, d, maxD) {
    const H = this.cover && !this.aiming ? 1.05 : this.swimming ? 0.6 : 1.75, r = 0.32, wx = o.x - this.pos.x, wz = o.z - this.pos.z, dd = d.x * d.x + d.z * d.z; if (dd < 1e-6) return null;
    const tc = -(wx * d.x + wz * d.z) / dd, cx = wx + d.x * tc, cz = wz + d.z * tc, dist2 = cx * cx + cz * cz; if (dist2 > r * r) return null;
    const t = tc - Math.sqrt((r * r - dist2) / dd); if (t < 0 || t > maxD) return null;
    const y = o.y + d.y * t - this.y; return y >= 0 && y <= H ? { t } : null;
  }
  /** How exposed the player is to enemy fire (0..1): cover and swimming help. */
  get exposure() { return this.cover ? (this.aiming ? 0.6 : 0.15) : this.swimming ? 0.5 : 1; }
  muzzleWorld(out) {
    this.h.root.updateMatrixWorld(true);
    if (this.mesh && this.mesh.parent) return this.mesh.localToWorld(out.copy(this.mesh.userData.muzzle));
    return out.set(this.pos.x, 1.4, this.pos.z);
  }

  update(dt, input, camYaw, camPitch) {
    const g = this.game, map = g.map;
    // environment state
    const wasSafe = this.inSafe;
    this.inSafe = !!g.zones?.inSafeZone(this.pos.x, this.pos.z);
    if (this.inSafe !== wasSafe) { this.h.setWeaponMesh(this.canUseWeapons ? this.mesh : null); if (this.inSafe) g.hud.help('<b>School zone.</b> Weapons are holstered here.', 4); }
    const wasSwim = this.swimming; this.swimming = !!map.inWater?.(this.pos.x, this.pos.z);
    if (this.swimming !== wasSwim) { this.h.setWeaponMesh(this.canUseWeapons ? this.mesh : null); this.cover = null; }

    if (this.ragdoll > 0) return this.updateRagdoll(dt);
    if (this.vault) return this.updateVault(dt);

    // weapon switching (wheel UI handles hold-Q separately)
    if (input.wheel && !g.wheel?.open) this.cycle(input.wheel > 0 ? 1 : -1);
    for (const id of ORDER) if (input.pressed('Digit' + WEAPONS[id].slot)) this.equip(id);
    const w = this.weapon;
    this.aiming = input.aim && !w.melee && this.canUseWeapons;
    this.scoped = this.aiming && !!w.scope && !this.cover?.blind;

    // cover
    if (input.pressed('cover')) {
      if (this.cover) this.cover = null;
      else { const c = findCover(g, this.pos.x, this.pos.z); if (c && !this.swimming) { this.cover = c; this.pos.x += c.nx * (c.dist - 0.45) * -1; this.pos.z += c.nz * (c.dist - 0.45) * -1; this.vel.set(0, 0, 0); } }
    }
    let f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0), r = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    if (input.gamepad) { f += -input.gamepad.ly; r += input.gamepad.lx; }
    let mx, mz, len;
    if (this.cover) {
      const c = this.cover;
      // camera-relative left/right projected onto the wall tangent; pressing away from the wall leaves cover
      const crx = -Math.cos(camYaw), crz = Math.sin(camYaw), cfx = Math.sin(camYaw), cfz = Math.cos(camYaw);
      const wantX = cfx * f + crx * r, wantZ = cfz * f + crz * r, along = wantX * c.tx + wantZ * c.tz, away = wantX * c.nx + wantZ * c.nz;
      if (away > 0.7 && Math.abs(along) < 0.4) { this.cover = null; }
      mx = c.tx * Math.sign(along) * (Math.abs(along) > 0.3 ? 1 : 0); mz = c.tz * Math.sign(along) * (Math.abs(along) > 0.3 ? 1 : 0); len = Math.hypot(mx, mz);
      if (len && !coverBehind(g, this.pos.x + mx * 0.6, this.pos.z + mz * 0.6, c.nx, c.nz)) { mx = mz = 0; len = 0; }
    }
    if (!this.cover) {
      mx = Math.sin(camYaw) * f - Math.cos(camYaw) * r; mz = Math.cos(camYaw) * f + Math.sin(camYaw) * r;
      len = Math.hypot(mx, mz); if (len > 0) { mx /= len; mz /= len; }
    }
    // sprint stamina
    const wantRun = input.down('sprint') && len > 0 && !this.aiming && !this.cover;
    const running = wantRun && !this.staminaLock && this.stamina > 0;
    if (running) { this.stamina = Math.max(0, this.stamina - dt * (this.swimming ? 14 : 16)); if (this.stamina === 0) this.staminaLock = true; this.restT = 1; }
    else { this.restT = (this.restT || 0) - dt; if (this.restT <= 0) this.stamina = Math.min(100, this.stamina + dt * 14); if (this.stamina > 30) this.staminaLock = false; }
    const base = this.swimming ? (running ? 3.2 : 1.9) : this.cover ? 2.2 : this.aiming ? 2.2 : running ? 7.2 : 3.6;
    const tgt = len > 0 ? base : 0, k = 1 - Math.exp(-(this.y > 0 ? 2 : 11) * dt);
    this.vel.x += (mx * tgt - this.vel.x) * k; this.vel.z += (mz * tgt - this.vel.z) * k;
    // jump / vault
    if (input.pressed('jump') && this.y <= 0 && !this.swimming) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), vt = vaultTarget(g, this.pos.x, this.pos.z, fx, fz);
      if (vt) { this.cover = null; this.vault = { x0: this.pos.x, z0: this.pos.z, x1: vt.x, z1: vt.z, t: 0, T: 0.55 }; return; }
      this.vy = 5.2;
    }
    this.vy -= 15 * dt; this.y = Math.max(0, this.y + this.vy * dt); if (this.y <= 0) this.vy = 0;
    const sp = Math.hypot(this.vel.x, this.vel.z); this.speed = sp;
    this.move(dt);
    // facing
    const wantYaw = this.cover && !this.aiming ? Math.atan2(this.cover.nx, this.cover.nz)
      : this.aiming || (this.cool > 0 && !w.melee) ? camYaw : (len > 0 ? Math.atan2(mx, mz) : this.yaw);
    this.yaw += shortestAngle(wantYaw - this.yaw) * (1 - Math.exp(-14 * dt));
    this.updateWeapon(dt, input, camYaw, camPitch);
    const aimK = (this.aiming || this.cool > 0.02) && !w.melee && this.canUseWeapons ? 1 : 0;
    this.h.animate(dt, this.y > 0 ? 0 : sp, { aim: aimK, pitch: clamp(camPitch, -0.9, 0.9), air: this.y > 0.05, crouch: !!this.cover && !this.aiming, swim: this.swimming });
    this.sync();
  }
  move(dt) {
    const g = this.game, steps = Math.max(1, Math.ceil(this.speed * dt / 0.25));
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vel.x * dt / steps; this.pos.z += this.vel.z * dt / steps;
      for (let i = 0; i < 3; i++) { const o = g.world.grid.push(this.pos.x, this.pos.z, 0.38); if (!o.hit) break; this.pos.x += o.x; this.pos.z += o.z; }
    }
    for (const v of g.vehicles) {
      if (Math.abs(v.pos.x - this.pos.x) > 7 || Math.abs(v.pos.z - this.pos.z) > 7) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.pos.x - cx, dz = this.pos.z - cz, d = Math.hypot(dx, dz), m = v.radius + 0.4;
        if (d < m && d > 1e-3) {
          this.pos.x += dx / d * (m - d); this.pos.z += dz / d * (m - d);
          if (v.speed > 6 && v !== this.vehicle && !this.ragdoll) { this.damage(v.speed * 2.5); this.knock(v.vx * 0.8, v.vz * 0.8, 3); g.audio.punch(this.pos); }
        }
      }
    }
    g.world.bounds(this.pos);
  }
  updateVault(dt) {
    const v = this.vault; v.t += dt; const k = Math.min(1, v.t / v.T);
    this.pos.x = v.x0 + (v.x1 - v.x0) * k; this.pos.z = v.z0 + (v.z1 - v.z0) * k; this.y = Math.sin(k * Math.PI) * 1.15;
    this.h.animate(dt, 0, { air: true }); this.sync();
    if (k >= 1) { this.vault = null; this.y = 0; this.vel.set(0, 0, 0); events.emit('vault', {}); }
  }
  updateRagdoll(dt) {
    this.ragdoll -= dt; this.vy -= 15 * dt; this.y = Math.max(0, this.y + this.vy * dt);
    this.vel.multiplyScalar(Math.exp(-(this.y > 0 ? 0.6 : 5) * dt)); this.speed = Math.hypot(this.vel.x, this.vel.z); this.move(dt);
    this.h.animate(dt, 0, {});
    if (this.ragdoll <= 0) { this.ragdoll = 0; this.h.dead = 0; this.y = 0; }
    this.sync();
  }
  updateWeapon(dt, input, camYaw, camPitch) {
    const g = this.game, w = this.weapon, inv = this.inv[this.current];
    this.cool = Math.max(0, this.cool - dt);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0 && !w.melee && !w.thrown) { const n = Math.min(w.mag - inv.ammo, inv.reserve); inv.ammo += n; inv.reserve -= n; } }
    if (input.pressed('reload') && !w.melee && !w.thrown && inv.ammo < w.mag && inv.reserve > 0 && this.reloadT <= 0) { this.reloadT = w.reload; g.audio.reload(); }
    const trigger = w.auto ? input.fire : (input.fire && !this.held);
    this.held = input.fire;
    if (!trigger || this.cool > 0 || this.reloadT > 0) return;
    if (!this.canUseWeapons) { if (this.inSafe && input.clicked[0]) g.hud.toast('Weapons are not allowed on school grounds'); return; }
    if (w.melee) { this.cool = w.rate; this.h.punch = 1; g.combat.melee(this, w); return; }
    if (inv.ammo <= 0) { g.audio.click(); this.cool = 0.3; if (inv.reserve > 0) { this.reloadT = w.reload; g.audio.reload(); } return; }
    inv.ammo--; this.cool = w.rate; this.h.kick = 1; this.yaw = camYaw;
    const m = this.muzzleWorld(new THREE.Vector3());
    if (w.thrown) { g.projectiles.throwGrenade(m, camYaw, camPitch, w); if (inv.ammo <= 0) { delete this.inv[this.current]; this.equip('fists'); } return; }
    const blind = !!this.cover && !this.aiming;
    g.combat.playerFire(w, m, { blind });
    g.recoil(w.recoil * (blind ? 1.5 : 1));
    if (inv.ammo === 0 && inv.reserve > 0) { this.reloadT = w.reload; g.audio.reload(); }
  }
}
