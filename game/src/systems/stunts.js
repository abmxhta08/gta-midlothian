// Stunt jumps: wedge ramps in parking lots / straight roads. Driving up a ramp fast launches the vehicle;
// landing after enough airtime pays out once per ramp.
import * as THREE from 'three';
import { along } from '../util.js';
import { events } from '../core/events.js';

const COUNT = 6, LEN = 6, H = 1.4, MIN_SPEED = 13, REWARD = 500;
const rampMat = new THREE.MeshStandardMaterial({ color: 0xd9b21b, roughness: 0.6 });
function rampGeo() {
  const w = 3.2, g = new THREE.BufferGeometry();
  const v = [[-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, H, LEN], [-w / 2, H, LEN], [-w / 2, 0, LEN], [w / 2, 0, LEN]];
  const tri = [0, 2, 1, 0, 3, 2, 1, 2, 5, 0, 4, 3, 3, 4, 5, 3, 5, 2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flatMap(i => v[i]), 3)); g.computeVertexNormals(); return g;
}

export class Stunts {
  constructor(game) {
    this.g = game; this.ramps = []; this.done = new Set(game.save.stunts || []);
    // candidate: long straight service/parking roads and residential straights away from schools
    const cands = [];
    for (const r of game.data.roads) {
      if (!['parking_aisle', null].includes(r.svc) || r.type === 'motorway' || r.pts.length < 2) continue;
      const L = r.D.at(-1); if (L < 70) continue;
      const a = along(r.pts, r.D, 10), b = along(r.pts, r.D, 10 + 50);
      if (a.dx * b.dx + a.dz * b.dz < 0.995) continue;   // must be straight for 50 m
      if (game.zones.nearSafeZone(a.x, a.z, 60)) continue;
      cands.push({ r, x: b.x, z: b.z, dx: b.dx, dz: b.dz });
    }
    cands.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    const geo = rampGeo();
    for (const c of cands) {
      if (this.ramps.length >= COUNT) break;
      if (this.ramps.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 350)) continue;
      const off = c.r.svc ? 0 : c.r.w / 4;   // keep to the right lane on roads
      const x = c.x - c.dz * off, z = c.z + c.dx * off, id = `ramp${this.ramps.length}`;
      const m = new THREE.Mesh(geo, rampMat); m.position.set(x, 0.01, z); m.rotation.y = Math.atan2(c.dx, c.dz); m.castShadow = m.receiveShadow = true;
      game.scene.add(m);
      this.ramps.push({ id, x, z, dx: c.dx, dz: c.dz, mesh: m });
    }
    this.flying = null;
    events.on('vehicleLanded', ({ vehicle, airTime }) => {
      if (!this.flying || vehicle !== this.g.player.vehicle) return;
      const r = this.flying; this.flying = null;
      if (airTime < 1.0) return;
      const first = !this.done.has(r.id);
      if (first) { this.done.add(r.id); this.g.addMoney(REWARD); this.g.save.stats.stunts = this.done.size; }
      this.g.hud.big('STUNT JUMP', first ? `+$${REWARD} · ${this.done.size}/${this.ramps.length} completed` : `${airTime.toFixed(1)}s airtime`, 'passed', 2.5);
      this.g.audio.jingle(true); events.emit('stunt', { id: r.id, first, airTime });
    });
  }
  update() {
    const v = this.g.player.vehicle; if (!v || this.flying) return;
    for (const r of this.ramps) {
      const lx = v.pos.x - r.x, lz = v.pos.z - r.z, u = lx * r.dx + lz * r.dz, w = -lx * r.dz + lz * r.dx;
      if (Math.abs(w) > 1.6 || u < 0 || u > LEN) continue;
      const along_ = v.vx * r.dx + v.vz * r.dz;
      if (along_ <= 0) continue;
      v.y = (u / LEN) * H; v.vy = 0;   // climb the ramp
      if (u > LEN - 0.6) { if (along_ > MIN_SPEED) { v.launch(along_ * (H / LEN) * 1.7 + 2); this.flying = r; this.g.hud.toast('Stunt jump!'); } else { v.launch(0.5); } }
    }
  }
}
