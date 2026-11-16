// Roadblocks at 3+ stars: two cruisers across the road ahead of the player, two officers and a spike strip
// that pops the tyres of any vehicle that drives over it.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';

const MAX = 2, COOLDOWN = 22;
const spikeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });

export class Roadblocks {
  constructor(game, police) { this.game = game; this.police = police; this.list = []; this.t = 8; }
  update(dt) {
    const g = this.game, P = g.player;
    this.t -= dt;
    if (this.police.wanted >= 3 && P.vehicle && P.vehicle.speed > 8 && this.t <= 0 && this.list.length < MAX) { this.t = COOLDOWN; this.spawn(); }
    for (const rb of [...this.list]) {
      rb.age += dt;
      const pp = P.vehicle ? P.vehicle.pos : P.pos, d = Math.hypot(pp.x - rb.x, pp.z - rb.z);
      // spikes
      for (const v of g.vehicles) if (!v.tiresPopped && !v.police && this.onStrip(rb, v.pos.x, v.pos.z)) { v.tiresPopped = true; if (v === P.vehicle) g.hud.toast('Spike strip! Your tyres are shredded'); g.audio.crash(6, v.pos); }
      if (rb.age > 70 || d > 300 || this.police.wanted < 2) this.remove(rb);
    }
  }
  onStrip(rb, x, z) {
    const lx = x - rb.x, lz = z - rb.z, u = lx * rb.dx + lz * rb.dz, w = -lx * rb.dz + lz * rb.dx;
    return Math.abs(u) < 0.6 && Math.abs(w) < rb.w / 2;
  }
  spawn() {
    const g = this.game, v = g.player.vehicle, fx = v.vx / v.speed, fz = v.vz / v.speed;
    for (const ahead of [150, 120, 180]) {
      const px = v.pos.x + fx * ahead, pz = v.pos.z + fz * ahead;
      const n = g.map.nearestRoad(px, pz, 40, r => r.type !== 'service' && r.type !== 'motorway');
      if (!n || g.zones.nearSafeZone(n.px, n.pz, 30)) continue;
      // block must be roughly in our direction of travel
      if (((n.px - v.pos.x) * fx + (n.pz - v.pos.z) * fz) < 80) continue;
      const w = n.road.w, rb = { x: n.px, z: n.pz, dx: n.dx, dz: n.dz, w: w + 1, age: 0, cars: [], meshes: [] };
      const perp = Math.atan2(-n.dz, n.dx);   // heading across the road
      for (const side of [-1, 1]) {
        const c = new Vehicle(g, 'police');
        c.setPose(n.px - n.dz * side * w * 0.28 + n.dx * 4, n.pz + n.dx * side * w * 0.28 + n.dz * 4, perp + (side > 0 ? Math.PI : 0));
        c.driver = 'cop'; c.siren = true; c.cop = { roadblock: true, crew: 0, deployed: true };
        g.vehicles.push(c); this.police.cars.push(c); rb.cars.push(c);
        this.police.addOfficer(n.px - n.dz * side * w * 0.45 + n.dx * 6.5, n.pz + n.dx * side * w * 0.45 + n.dz * 6.5, Math.atan2(-n.dx, -n.dz));
      }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.5), spikeMat);
      strip.position.set(n.px, 0.03, n.pz); strip.rotation.y = Math.atan2(n.dx, n.dz) + Math.PI / 2; strip.receiveShadow = true;
      g.scene.add(strip); rb.meshes.push(strip);
      this.list.push(rb); g.hud.toast('Roadblock ahead!'); return rb;
    }
    return null;
  }
  remove(rb) { for (const m of rb.meshes) this.game.scene.remove(m); this.list.splice(this.list.indexOf(rb), 1); }
  clear() { for (const rb of [...this.list]) this.remove(rb); }
}
