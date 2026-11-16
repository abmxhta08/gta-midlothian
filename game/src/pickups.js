import * as THREE from 'three';
import { weaponMesh, WEAPONS } from './weapons.js';
import { radial } from './textures.js';

const glowTex = radial('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
const COLORS = { health: 0x3cff6a, armor: 0x3c9bff, cash: 0x7cff7c, smg: 0xffa63c, shotgun: 0xffa63c, rifle: 0xffa63c, pistol: 0xffa63c };

function model(kind) {
  const g = new THREE.Group();
  if (kind === 'health') {
    const w = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), r = new THREE.MeshStandardMaterial({ color: 0x20c040, emissive: 0x10a030, emissiveIntensity: 0.6 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.22), w));
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.24), r), b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.24), r); g.add(a, b);
  } else if (kind === 'armor') {
    const m = new THREE.MeshStandardMaterial({ color: 0x1f3f7a, roughness: 0.6, emissive: 0x102040, emissiveIntensity: 0.4 });
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.18), m); g.add(v);
  } else if (kind === 'cash') {
    const m = new THREE.MeshStandardMaterial({ color: 0x4f9a4f, roughness: 0.7, emissive: 0x204020, emissiveIntensity: 0.5 });
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.2), m); b.position.y = i * 0.09 - 0.09; b.rotation.y = i * 0.3; g.add(b); }
  } else { const w = weaponMesh(kind); w.scale.setScalar(2.3); w.rotation.y = Math.PI / 2; g.add(w); }
  for (const c of g.children) c.castShadow = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: COLORS[kind], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
  glow.scale.setScalar(1.6);
  const root = new THREE.Group(); root.add(g, glow); root.userData.spin = g;
  return root;
}

export class Pickups {
  constructor(game) {
    this.game = game; this.items = [];
    const kinds = ['health', 'armor', 'smg', 'shotgun', 'rifle', 'health', 'pistol', 'armor', 'cash'];
    let k = 0;
    const locs = game.map.locations.filter(l => !['residential', 'school', 'college'].includes(l.kind));
    for (const l of locs) {
      const c = l.c || [0, 0], sp = game.peds.nearestSidewalk(c[0], c[1], 90);
      if (!sp || Math.random() < 0.35) continue;
      this.add(kinds[k++ % kinds.length], sp.x, sp.z, { respawn: 90 });
    }
  }
  add(kind, x, z, opts = {}) {
    const mesh = model(kind); mesh.position.set(x, 0.9, z); this.game.scene.add(mesh);
    const it = { kind, pos: new THREE.Vector3(x, 0, z), mesh, active: true, t: 0, respawn: opts.respawn || 0, life: opts.life || 0, amount: opts.amount || 0 };
    this.items.push(it); return it;
  }
  cash(x, z, amount) { this.add('cash', x, z, { life: 30, amount }); }
  update(dt) {
    const g = this.game, P = g.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      if (!it.active) { if (it.respawn && (it.wait -= dt) <= 0) { it.active = true; it.mesh.visible = true; } continue; }
      if (it.life && it.t > it.life) { g.scene.remove(it.mesh); this.items.splice(i, 1); continue; }
      it.mesh.userData.spin.rotation.y += dt * 2; it.mesh.position.y = 0.9 + Math.sin(it.t * 2.5) * 0.12;
      if (Math.abs(pp.x - it.pos.x) > 3 || Math.abs(pp.z - it.pos.z) > 3) continue;
      if (Math.hypot(pp.x - it.pos.x, pp.z - it.pos.z) > (P.vehicle ? 2.6 : 1.4)) continue;
      if (!this.collect(it)) continue;
      if (it.respawn) { it.active = false; it.mesh.visible = false; it.wait = it.respawn; }
      else { g.scene.remove(it.mesh); this.items.splice(i, 1); }
    }
  }
  collect(it) {
    const g = this.game, P = g.player;
    if (it.kind === 'health') { if (P.health >= 100) return false; P.health = 100; g.hud.toast('Health restored'); }
    else if (it.kind === 'armor') { if (P.armor >= 100) return false; P.armor = 100; g.hud.toast('Body armor'); }
    else if (it.kind === 'cash') { const a = it.amount || 50 + Math.floor(Math.random() * 150); g.addMoney(a); g.audio.cash(); return true; }
    else { const w = WEAPONS[it.kind]; P.give(it.kind, w.mag * 3); g.hud.toast(`${w.name} +${w.mag * 3}`); }
    g.audio.pickup(); return true;
  }
}
