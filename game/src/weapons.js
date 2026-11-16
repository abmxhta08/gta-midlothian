import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', slot: 1, melee: true, rate: 0.45, dmg: 22, range: 1.5 },
  pistol: { id: 'pistol', name: 'Pistol', slot: 2, dmg: 34, rate: 0.2, mag: 12, spread: 0.005, auto: false, range: 300, recoil: 0.018, reload: 1.3 },
  smg: { id: 'smg', name: 'SMG', slot: 3, dmg: 19, rate: 0.075, mag: 30, spread: 0.02, auto: true, twoHand: true, range: 200, recoil: 0.008, reload: 1.6 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', slot: 4, dmg: 15, pellets: 8, rate: 0.85, mag: 6, spread: 0.06, auto: false, twoHand: true, range: 60, recoil: 0.05, reload: 2.2 },
  rifle: { id: 'rifle', name: 'Carbine Rifle', slot: 5, dmg: 31, rate: 0.11, mag: 30, spread: 0.008, auto: true, twoHand: true, range: 400, recoil: 0.012, reload: 1.9 },
};
export const ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

const metal = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.45, metalness: 0.7 });
const box = (x, y, z, px, py, pz) => new THREE.BoxGeometry(x, y, z).translate(px, py, pz).toNonIndexed();
const models = {};
/** Small held weapon mesh, barrel along +z, muzzle at userData.muzzle. */
export function weaponMesh(id) {
  if (id === 'fists') return null;
  if (!models[id]) {
    let parts, muzzle;
    if (id === 'pistol') { parts = [box(0.04, 0.05, 0.2, 0, 0.03, 0.06), box(0.035, 0.1, 0.05, 0, -0.03, -0.01)]; muzzle = 0.17; }
    else if (id === 'smg') { parts = [box(0.05, 0.08, 0.34, 0, 0.03, 0.08), box(0.035, 0.12, 0.05, 0, -0.05, 0.02), box(0.03, 0.14, 0.04, 0, -0.06, 0.13), box(0.025, 0.025, 0.12, 0, 0.04, 0.29)]; muzzle = 0.36; }
    else if (id === 'shotgun') { parts = [box(0.05, 0.06, 0.75, 0, 0.03, 0.2), box(0.045, 0.045, 0.2, 0, -0.01, 0.3), box(0.04, 0.12, 0.25, 0, -0.03, -0.2)]; muzzle = 0.58; }
    else { parts = [box(0.05, 0.08, 0.6, 0, 0.03, 0.15), box(0.035, 0.13, 0.05, 0, -0.06, 0.04), box(0.03, 0.15, 0.05, 0, -0.06, 0.16), box(0.04, 0.1, 0.22, 0, 0.0, -0.22), box(0.04, 0.04, 0.12, 0, 0.1, 0.1)]; muzzle = 0.48; }
    models[id] = { geo: mergeGeometries(parts), muzzle };
  }
  const m = new THREE.Mesh(models[id].geo, metal); m.castShadow = true;
  m.userData.muzzle = new THREE.Vector3(0, 0.03, models[id].muzzle);
  return m;
}

/** Weapon pickup display model (larger, glowing). */
export function pickupMesh(kind) {
  const g = new THREE.Group();
  if (WEAPONS[kind] && kind !== 'fists') { const w = weaponMesh(kind); w.scale.setScalar(2.4); w.rotation.y = Math.PI / 2; g.add(w); }
  return g;
}
