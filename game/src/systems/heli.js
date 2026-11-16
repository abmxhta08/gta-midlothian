// Police helicopter at 5 stars: circles above the player, searchlight at night, a marksman takes shots.
// Can be shot down. Uses one SpotLight created up front (constant light count = no shader recompiles).
import * as THREE from 'three';

export class Helicopter {
  constructor(game, police) {
    this.game = game; this.police = police; this.active = false; this.health = 1600; this.t = 0; this.shootT = 2;
    const g = this.group = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.4, metalness: 0.4 }), glass = new THREE.MeshStandardMaterial({ color: 0x0b1820, roughness: 0.05, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 10), dark); body.scale.set(1, 0.9, 1.7); g.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 8), glass); nose.position.set(0, 0.15, 1.3); nose.scale.set(0.95, 0.8, 0.9); g.add(nose);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 4.5), dark); boom.position.set(0, 0.3, -3.6); g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.7), dark); fin.position.set(0, 0.9, -5.7); g.add(fin);
    for (const x of [-0.8, 0.8]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3), dark); sk.position.set(x, -1.35, 0); g.add(sk); }
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), dark); this.rotor.position.y = 1.45; g.add(this.rotor);
    this.rotor2 = this.rotor.clone(); this.rotor2.rotation.y = Math.PI / 2; this.rotor.add(this.rotor2.clone());
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.18), dark); this.tailRotor.position.set(0.2, 0.9, -5.7); g.add(this.tailRotor);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.light = new THREE.SpotLight(0xf0f6ff, 0, 160, 0.16, 0.5, 1); this.light.position.set(0, -1, 1.5); g.add(this.light, this.light.target);
    g.visible = false; game.scene.add(g);
    this.pos = new THREE.Vector3(); this.ang = 0;
  }
  hide() { this.active = false; this.group.visible = false; this.light.intensity = 0; }
  /** Returns true if the helicopter can see the player this frame. */
  update(dt) {
    const g = this.game, P = g.player, tp = P.vehicle ? P.vehicle.pos : P.pos;
    if (this.police.wanted < 5 || this.health <= 0) { if (this.active && this.health > 0) this.hide(); return false; }
    if (!this.active) { this.active = true; this.health = 1600; this.pos.set(tp.x + 200, 60, tp.z + 200); this.group.visible = true; g.hud.toast('Police helicopter overhead'); }
    this.t += dt; this.ang += dt * 0.25;
    const goal = this.police.searching && this.police.lastKnown ? this.police.lastKnown : tp;
    const want = new THREE.Vector3(goal.x + Math.cos(this.ang) * 30, 42, goal.z + Math.sin(this.ang) * 30);
    this.pos.lerp(want, 1 - Math.exp(-dt * 0.6));
    this.group.position.copy(this.pos); this.group.rotation.y = Math.atan2(goal.x - this.pos.x, goal.z - this.pos.z);
    this.group.rotation.z = Math.sin(this.t * 0.7) * 0.06;
    this.rotor.rotation.y += dt * 40; this.tailRotor.rotation.x += dt * 50;
    this.light.intensity = 400 * Math.max(0.15, g.sky.night); this.light.target.position.set(0, 0, 0);
    this.light.target.position.copy(this.group.worldToLocal(new THREE.Vector3(goal.x, 0, goal.z)));
    const sees = !g.zones.inSafeZone(tp.x, tp.z) && Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < 90;
    if (sees && !this.police.searching && (this.shootT -= dt) <= 0) {
      this.shootT = 1.3 + Math.random();
      const hit = Math.random() < 0.3, sp = hit ? 0.3 : 4;
      g.combat.npcShot({ h: { kick: 0 } }, this.pos.clone().add(new THREE.Vector3(0, -1.2, 0)), new THREE.Vector3(tp.x + (Math.random() - 0.5) * sp, 1, tp.z + (Math.random() - 0.5) * sp), hit ? 8 : 0);
    }
    g.audio.burst?.(160, Math.max(0, 0.05 - Math.hypot(this.pos.x - tp.x, this.pos.z - tp.z) * 0.0003), 0.08, 0.5);
    return sees;
  }
  /** Bullet test against the helicopter body (sphere). */
  rayHit(o, d, maxD) {
    if (!this.active) return Infinity;
    const oc = o.clone().sub(this.pos), b = oc.dot(d), c = oc.lengthSq() - 6.5, h = b * b - c;
    if (h < 0) return Infinity; const t = -b - Math.sqrt(h); return t > 0 && t < maxD ? t : Infinity;
  }
  damage(n) {
    if (!this.active) return; this.health -= n;
    if (this.health <= 0) { this.game.explosion(this.pos.clone().setY(2), 'heli'); this.hide(); this.game.crime('copkill', this.pos.clone()); this.game.hud.toast('Helicopter down!'); }
  }
}
