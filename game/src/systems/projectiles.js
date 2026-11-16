// Thrown stun grenades: ballistic arc, bounce off walls/ground, flash + stun everyone in radius (no damage).
import * as THREE from 'three';
import { weaponMesh } from '../weapons.js';
import { radial } from '../textures.js';
import { events } from '../core/events.js';

const MAX = 6;
export class Projectiles {
  constructor(game) {
    this.game = game; this.list = [];
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    this.flash.visible = false; game.scene.add(this.flash); this.flashT = 0;
  }
  throwGrenade(from, yaw, pitch, w) {
    if (this.list.length >= MAX) this.remove(this.list[0]);
    const m = weaponMesh('stun'); m.scale.setScalar(1.6); this.game.scene.add(m);
    const sp = 13, up = Math.max(-0.2, -pitch) + 0.35;
    const v = new THREE.Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up)).multiplyScalar(sp);
    this.list.push({ m, p: from.clone(), v, t: 0, w });
    this.game.audio.tone?.(300, 200, 0.1, 0.08, 'triangle');
  }
  remove(g) { this.game.scene.remove(g.m); this.list.splice(this.list.indexOf(g), 1); }
  update(dt) {
    const g = this.game, grid = g.world.grid;
    if (this.flashT > 0) { this.flashT -= dt; this.flash.material.opacity = Math.max(0, this.flashT / 0.35); if (this.flashT <= 0) this.flash.visible = false; }
    for (const n of [...this.list]) {
      n.t += dt; n.v.y -= 14 * dt;
      const step = n.v.clone().multiplyScalar(dt), hd = Math.hypot(step.x, step.z);
      if (hd > 1e-4) { const th = grid.ray(n.p.x, n.p.z, step.x / hd, step.z / hd, hd + 0.1); if (th < hd + 0.1) { const rn = grid.rayN; const vn = n.v.x * rn[0] + n.v.z * rn[1]; n.v.x -= 1.6 * vn * rn[0]; n.v.z -= 1.6 * vn * rn[1]; n.v.multiplyScalar(0.5); step.set(0, step.y, 0); } }
      n.p.add(step);
      if (n.p.y < 0.06) { n.p.y = 0.06; n.v.y = Math.abs(n.v.y) * 0.35; n.v.x *= 0.6; n.v.z *= 0.6; }
      n.m.position.copy(n.p); n.m.rotation.x += dt * 8;
      if (n.t >= n.w.fuse) { this.detonate(n.p, n.w); this.remove(n); }
    }
  }
  detonate(p, w) {
    const g = this.game;
    this.flash.position.copy(p).y += 0.6; this.flash.scale.setScalar(w.radius * 2.2); this.flash.visible = true; this.flashT = 0.35;
    g.effects.boom.position.copy(p); g.effects.boom.color.setHex(0xffffff); g.effects.boom.intensity = 60; g.effects.boomT = 0.3;
    g.audio.burst?.(3000, 0.9, 0.5, 1.4); g.audio.tone?.(2400, 2300, 0.25, 0.9, 'sine');
    let n = 0;
    for (const q of g.peds.list) if (q.alive && q.pos.distanceTo(p) < w.radius) { q.stun?.(w.stun); n++; if (q.cop || q.hostile) g.crime('assault', q.pos, q); }
    const pp = g.player; if (!pp.vehicle && pp.pos.distanceTo(p) < w.radius * 0.7) { g.hud.whiteout?.(1.4); }
    g.peds.panic(p.x, p.z, 30, p);
    events.emit('stun', { pos: p, count: n });
  }
}
