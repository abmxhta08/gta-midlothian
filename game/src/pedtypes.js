// Pedestrian types: appearance + behaviour knobs. All invented, generic people.
import * as THREE from 'three';
import { weaponMesh } from './weapons.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const PED_TYPES = {
  civilian: { weight: 58, look: () => ({}) },
  jogger:   { weight: 14, speed: [3.2, 4.0], look: () => ({ top: pick([0xe8462e, 0x2ea0e8, 0xf2f2f2, 0x9be82e, 0xf27ad0]), bottom: pick([0x1a1a1a, 0x2b3346]), shoe: 0xf4f4f4, sleeves: true }) },
  shopper:  { weight: 16, speed: [1.0, 1.4], bag: true, look: () => ({}) },
  gang:     { weight: 12, group: 3, look: () => ({ top: pick([0x6a1a8a, 0x5a1414]), bottom: 0x1a1a1a, shoe: 0x111111, hairStyle: 0.85, fem: false }) },
  shopkeeper: { weight: 0, look: () => ({ top: 0x2a6a3a, bottom: 0x2b2b2b }) },
  vip:      { weight: 0, look: () => ({ top: 0x1c1c22, bottom: 0x1c1c22, shoe: 0x0a0a0a, hair: 0x9a9a9a, hairStyle: 0.2, fem: false }) },
};
export function pickType(r = Math.random(), allowGang = true) {
  const entries = Object.entries(PED_TYPES).filter(([k, t]) => t.weight > 0 && (allowGang || k !== 'gang'));
  const tot = entries.reduce((a, [, t]) => a + t.weight, 0); let x = r * tot;
  for (const [k, t] of entries) { x -= t.weight; if (x <= 0) return k; }
  return 'civilian';
}
const bagMat = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.9 });
/** Apply type-specific setup to a freshly constructed Ped. */
export function setupType(p, type) {
  const t = PED_TYPES[type] || PED_TYPES.civilian;
  p.type = type;
  if (t.speed) p.walkSpeed = t.speed[0] + Math.random() * (t.speed[1] - t.speed[0]);
  if (t.bag) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.12), bagMat); b.position.set(0, -0.22, 0); b.castShadow = true; p.h.armL.hand.add(b); p.bag = b; }
  if (type === 'gang') { p.gang = true; p.health = 110; p.weapon = weaponMesh('pistol'); p.state = 'hang'; }
  if (type === 'jogger') p.jogger = true;
}
