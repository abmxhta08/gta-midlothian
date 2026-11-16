import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { WEAPONS, ORDER } from './data/weapons.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.45, metalness: 0.7 });
const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 });
const grenade = new THREE.MeshStandardMaterial({ color: 0x2e3a2a, roughness: 0.6, metalness: 0.3 });
const box = (x, y, z, px, py, pz) => new THREE.BoxGeometry(x, y, z).translate(px, py, pz).toNonIndexed();
const cyl = (r0, r1, l, pz, seg = 10) => new THREE.CylinderGeometry(r0, r1, l, seg).rotateX(Math.PI / 2).translate(0, 0, pz).toNonIndexed();
const models = {};
/** Small held weapon mesh, barrel along +z, muzzle at userData.muzzle. */
export function weaponMesh(id) {
  if (id === 'fists') return null;
  if (!models[id]) {
    let parts, muzzle, mat = metal;
    if (id === 'pistol') { parts = [box(0.04, 0.05, 0.2, 0, 0.03, 0.06), box(0.035, 0.1, 0.05, 0, -0.03, -0.01)]; muzzle = 0.17; }
    else if (id === 'smg') { parts = [box(0.05, 0.08, 0.34, 0, 0.03, 0.08), box(0.035, 0.12, 0.05, 0, -0.05, 0.02), box(0.03, 0.14, 0.04, 0, -0.06, 0.13), box(0.025, 0.025, 0.12, 0, 0.04, 0.29)]; muzzle = 0.36; }
    else if (id === 'shotgun') { parts = [box(0.05, 0.06, 0.75, 0, 0.03, 0.2), box(0.045, 0.045, 0.2, 0, -0.01, 0.3), box(0.04, 0.12, 0.25, 0, -0.03, -0.2)]; muzzle = 0.58; }
    else if (id === 'rifle') { parts = [box(0.05, 0.08, 0.6, 0, 0.03, 0.15), box(0.035, 0.13, 0.05, 0, -0.06, 0.04), box(0.03, 0.15, 0.05, 0, -0.06, 0.16), box(0.04, 0.1, 0.22, 0, 0.0, -0.22), box(0.04, 0.04, 0.12, 0, 0.1, 0.1)]; muzzle = 0.48; }
    else if (id === 'sniper') { parts = [box(0.05, 0.08, 0.7, 0, 0.03, 0.1), cyl(0.012, 0.014, 0.5, 0.68), box(0.035, 0.13, 0.05, 0, -0.06, 0.0), box(0.04, 0.11, 0.3, 0, -0.01, -0.35), cyl(0.028, 0.028, 0.32, 0.1, 12).translate(0, 0.11, 0), box(0.02, 0.05, 0.02, 0, 0.07, 0.1)]; muzzle = 0.93; }
    else if (id === 'bat') { parts = [cyl(0.018, 0.035, 0.8, 0.35, 10), cyl(0.022, 0.022, 0.06, -0.04)]; muzzle = 0.7; mat = wood; }
    else if (id === 'stun') { parts = [new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10).toNonIndexed(), box(0.012, 0.05, 0.03, 0, 0.07, 0)]; muzzle = 0.05; mat = grenade; }
    for (const p of parts) for (const a of Object.keys(p.attributes)) if (a !== 'position' && a !== 'normal') p.deleteAttribute(a);
    models[id] = { geo: mergeGeometries(parts), muzzle, mat };
  }
  const m = new THREE.Mesh(models[id].geo, models[id].mat); m.castShadow = true;
  m.userData.muzzle = new THREE.Vector3(0, 0.03, models[id].muzzle);
  return m;
}

/** Weapon pickup display model (larger). */
export function pickupMesh(kind) {
  const g = new THREE.Group();
  const w = weaponMesh(kind); if (w) { w.scale.setScalar(2.4); w.rotation.y = Math.PI / 2; g.add(w); }
  return g;
}
