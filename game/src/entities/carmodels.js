import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MATS = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1116, roughness: 0.04, metalness: 0.3, clearcoat: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.15, metalness: 1 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.25, metalness: 0.9 }),
  head: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0xfff3d6, emissiveIntensity: 0.15, roughness: 0.1 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x5a0808, emissive: 0xff1a10, emissiveIntensity: 0.1, roughness: 0.2 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x1040ff, emissiveIntensity: 0 }),
  burnt: new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 }),
};
export const PAINTS = [0xf4f4f4, 0x111214, 0x9aa0a6, 0x5b6067, 0x8a1010, 0x0e2a5a, 0x1d4a2a, 0xc8b89a, 0x3a4a5a, 0x6a0f1a, 0xd8d8d0, 0x2b2b2e, 0x1f6fb5, 0xb05a18];
export const paint = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });

const TYPES = {
  sedan: { W: 1.82, r: 0.34, wf: 1.4, wr: -1.38, clear: 0.3,
    top: [[-2.36, 0.56], [-2.3, 0.86], [-1.45, 0.97], [1.1, 0.95], [2.25, 0.8], [2.38, 0.56]],
    cab: [[-1.47, 0.95], [-0.85, 1.42], [0.45, 1.44], [1.13, 0.93]], roof: [-0.85, 0.45, 1.43], speed: 1, mass: 1 },
  hatch: { W: 1.76, r: 0.33, wf: 1.3, wr: -1.27, clear: 0.3,
    top: [[-2.08, 0.6], [-2.02, 0.92], [0.95, 0.92], [1.95, 0.78], [2.08, 0.55]],
    cab: [[-2.0, 0.9], [-1.78, 1.42], [0.3, 1.45], [0.98, 0.9]], roof: [-1.76, 0.3, 1.44], speed: 0.92, mass: 0.85 },
  suv: { W: 1.95, r: 0.4, wf: 1.45, wr: -1.42, clear: 0.38,
    top: [[-2.42, 0.7], [-2.4, 1.1], [0.95, 1.1], [2.25, 0.96], [2.4, 0.66]],
    cab: [[-2.36, 1.08], [-2.24, 1.8], [0.35, 1.82], [1.0, 1.08]], roof: [-2.22, 0.35, 1.81], speed: 0.95, mass: 1.35 },
  pickup: { W: 2.0, r: 0.42, wf: 1.75, wr: -1.65, clear: 0.42, bed: [-2.75, -0.62],
    top: [[-2.82, 0.72], [-2.82, 1.12], [1.25, 1.12], [2.6, 1.0], [2.8, 0.7]],
    cab: [[-0.6, 1.1], [-0.55, 1.86], [0.7, 1.88], [1.3, 1.1]], roof: [-0.55, 0.7, 1.87], speed: 0.95, mass: 1.5 },
  police: { base: 'sedan', speed: 1.18, mass: 1.1 },
};
for (const k in TYPES) if (TYPES[k].base) TYPES[k] = { ...TYPES[TYPES[k].base], ...TYPES[k] };
export const CAR_TYPES = TYPES;

let LOD = 0;
function extrudeProfile(points, width, bevel = 0.05) {
  const s = new THREE.Shape(); s.moveTo(points[0][0], points[0][1]); for (const p of points.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  return extrudeShape(s, width, bevel);
}
function extrudeShape(s, width, bevel) {
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: LOD ? 1 : 2, curveSegments: LOD ? 3 : 6 });
  g.rotateY(-Math.PI / 2); g.translate((width - 2 * bevel) / 2, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();

const cache = new Map();
/** Geometry parts for a car type in local space (forward = +z). */
export function carParts(type, lod = 0) {
  const ck = type + ':' + lod; if (cache.has(ck)) return cache.get(ck);
  LOD = lod;
  const t = TYPES[type], W = t.W, parts = [];
  const add = (geo, mat) => parts.push({ geo, mat });
  // body with wheel-arch cut-outs
  const ar = t.r + 0.07, front = t.top[t.top.length - 1][0], rear = t.top[0][0];
  const s = new THREE.Shape();
  s.moveTo(rear + 0.04, t.clear); for (const p of t.top) s.lineTo(p[0], p[1]);
  s.lineTo(front - 0.06, t.clear);
  s.lineTo(t.wf + ar, t.clear); s.lineTo(t.wf + ar, t.r); s.absarc(t.wf, t.r, ar, 0, Math.PI, false); s.lineTo(t.wf - ar, t.clear);
  s.lineTo(t.wr + ar, t.clear); s.lineTo(t.wr + ar, t.r); s.absarc(t.wr, t.r, ar, 0, Math.PI, false); s.lineTo(t.wr - ar, t.clear);
  s.closePath();
  add(extrudeShape(s, W, 0.07), 'paint');
  add(extrudeProfile(t.cab, W * 0.84, 0.04), 'glass');
  const [r0, r1, ry] = t.roof;
  add(extrudeProfile([[r0, ry - 0.03], [r1, ry - 0.02], [r1 - 0.06, ry + 0.04], [r0 + 0.06, ry + 0.035]], W * 0.87, 0.03), 'paint');
  const cabMid = (t.cab[0][0] + t.cab[3][0]) / 2, cabH = t.roof[2] - t.cab[0][1];
  add(box(W * 0.85, cabH, 0.13, 0, t.cab[0][1] + cabH / 2, cabMid - 0.1), 'paint');
  const zf = front, zr = rear, bh = t.clear + 0.12;
  add(box(W + 0.04, 0.22, 0.22, 0, bh, zf - 0.05), 'trim'); add(box(W + 0.04, 0.22, 0.22, 0, bh, zr + 0.05), 'trim');
  add(box(W * 0.5, 0.2, 0.05, 0, t.top[t.top.length - 1][1] + 0.08, zf + 0.0), 'trim');
  for (const x of [-1, 1]) {
    add(box(0.42, 0.13, 0.06, x * W * 0.33, t.top[t.top.length - 1][1] + 0.12, zf - 0.02), 'head');
    add(box(0.38, 0.12, 0.06, x * W * 0.34, t.top[0][1] + 0.18, zr + 0.01), 'tail');
    add(box(0.1, 0.1, 0.18, x * (W / 2 + 0.08), t.cab[3][1] + 0.08, t.cab[3][0] - 0.25), 'paint');
  }
  add(box(0.52, 0.12, 0.03, 0, bh + 0.2, zr - 0.02), 'plate');
  if (t.bed) add(box(W - 0.24, 0.02, t.bed[1] - t.bed[0], 0, 1.13, (t.bed[0] + t.bed[1]) / 2), 'trim');
  if (type === 'police') {
    add(box(1.1, 0.13, 0.3, -0.3, t.roof[2] + 0.1, cabMid), 'red');
    add(box(1.1, 0.13, 0.3, 0.3 + 0.25, t.roof[2] + 0.1, cabMid), 'blue');
    add(box(0.06, 0.42, 1.7, W / 2 + 0.03, 0.72, 0.1), 'plate'); add(box(0.06, 0.42, 1.7, -W / 2 - 0.03, 0.72, 0.1), 'plate');
    add(box(W * 0.6, 0.28, 0.12, 0, 0.55, zf + 0.12), 'trim');
  }
  const wheels = [];
  for (const z of [t.wf, t.wr]) for (const x of [-1, 1]) wheels.push({ x: x * (W / 2 - 0.13), y: t.r, z, r: t.r, front: z > 0 });
  const out = { parts, wheels, dims: { hl: (front - rear) / 2, hw: W / 2, h: t.roof[2], wb: t.wf - t.wr, zc: (front + rear) / 2 }, t };
  cache.set(ck, out); LOD = 0; return out;
}
export function wheelGeo(r, seg = 22) {
  const tire = new THREE.CylinderGeometry(r, r, 0.26, seg).rotateZ(Math.PI / 2).toNonIndexed();
  const rim = new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.27, Math.max(6, seg >> 1)).rotateZ(Math.PI / 2).toNonIndexed();
  return { tire, rim };
}

/** Single-material merged geometry for InstancedMesh (parked cars): part colours baked into vertex colours,
 * paint is white so instanceColor gives each car its colour. One draw call per mesh. */
const instCache = new Map();
const PART_COL = { paint: [1, 1, 1], glass: [0.05, 0.06, 0.07], trim: [0.07, 0.07, 0.07], chrome: [0.6, 0.6, 0.6], tire: [0.04, 0.04, 0.04], rim: [0.55, 0.56, 0.58], head: [0.95, 0.95, 0.9], tail: [0.45, 0.04, 0.04], plate: [0.9, 0.9, 0.9], red: [0.5, 0.05, 0.05], blue: [0.05, 0.1, 0.5] };
export const PARKED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35 });
export function instancedCar(type) {
  if (instCache.has(type)) return instCache.get(type);
  const { parts, wheels } = carParts(type, 1), geos = [];
  const colorize = (g, c) => { g = g.index ? g.toNonIndexed() : g.clone(); for (const a of Object.keys(g.attributes)) if (!['position', 'normal'].includes(a)) g.deleteAttribute(a); const n = g.attributes.position.count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) arr.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
  for (const p of parts) geos.push(colorize(p.geo, PART_COL[p.mat]));
  for (const w of wheels) { const g = wheelGeo(w.r, 10); geos.push(colorize(g.tire.translate(w.x, w.y, w.z), PART_COL.tire), colorize(g.rim.translate(w.x, w.y, w.z), PART_COL.rim)); }
  const res = { geo: mergeGeometries(geos), mats: PARKED_MAT };
  instCache.set(type, res); return res;
}
