// 20 hidden Coal Tokens (Midlothian was a coal-mining town). Placed deterministically near parks, the
// cemetery, behind shops and at neighbourhood edges, never in school safe zones. $100 each, $5,000 for all.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';
import { events } from '../core/events.js';
import { writeSave } from '../save.js';

export const TOTAL = 20;
const coinMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, metalness: 0.8, roughness: 0.35, emissive: 0xffb84a, emissiveIntensity: 0.25 });
export class Collectibles {
  constructor(game) {
    this.g = game; this.found = new Set(game.save.collectibles || []); this.items = [];
    const r = mulberry32(1888), spots = [];
    const locs = game.map.locations.filter(l => l.c && !game.zones.nearSafeZone(l.c[0], l.c[1], 60));
    for (const l of locs.sort((a, b) => (a.kind === 'park' || a.kind === 'cemetery' ? -1 : 0) - (b.kind === 'park' || b.kind === 'cemetery' ? -1 : 0))) spots.push(l.c);
    for (const p of game.data.places || []) spots.push(p.p);
    const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20).rotateX(Math.PI / 2);
    for (const c of spots) {
      if (this.items.length >= TOTAL) break;
      // a clear spot 15-40 m away from the place's centre (behind things, not on the road)
      for (let t = 0; t < 25; t++) {
        const a = r() * Math.PI * 2, d = 15 + r() * 25, x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
        if (Math.hypot(x, z) > game.map.R - 30 || !game.world.clear(x, z, 0.8) || game.zones.nearSafeZone(x, z, 30) || game.map.inWater(x, z)) continue;
        const n = game.map.nearestRoad(x, z, 6); if (n && n.dist < n.road.w / 2 + 1) continue;
        if (this.items.some(i => Math.hypot(i.x - x, i.z - z) < 150)) continue;
        const id = `token${this.items.length}`, m = new THREE.Mesh(geo, coinMat); m.position.set(x, 0.9, z); m.castShadow = true;
        if (this.found.has(id)) m.visible = false;
        game.scene.add(m); this.items.push({ id, x, z, m }); break;
      }
    }
  }
  update(dt) {
    const g = this.g, P = g.player; if (P.vehicle) return;
    for (const it of this.items) {
      if (this.found.has(it.id)) continue;
      const far = Math.abs(P.pos.x - it.x) > 160 || Math.abs(P.pos.z - it.z) > 160; it.m.visible = !far; if (far) continue;
      it.m.rotation.y += dt * 2.5; it.m.position.y = 0.9 + Math.sin(g.time * 2 + it.x) * 0.1;
      if (Math.abs(P.pos.x - it.x) < 1.3 && Math.abs(P.pos.z - it.z) < 1.3) {
        this.found.add(it.id); it.m.visible = false; g.addMoney(100); g.audio.pickup();
        const all = this.found.size >= this.items.length;
        if (all) { g.addMoney(5000); g.hud.big('ALL COAL TOKENS', '+$5,000 · Coal Miner outfit unlocked', 'passed', 4); }
        else g.hud.toast(`Coal token ${this.found.size}/${this.items.length} · +$100`);
        events.emit('collectible', { id: it.id, count: this.found.size }); writeSave(g);
      }
    }
  }
}
