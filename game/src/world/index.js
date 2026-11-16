import * as THREE from 'three';
import { Chunks, pip } from '../util.js';
import { SegGrid } from '../collision.js';
import { makeMaterials } from './materials.js';
import { buildGround } from './ground.js';
import { buildRoads } from './roads.js';
import { buildBuildings } from './buildings.js';
import { buildProps } from './props.js';

function freeArray() { this.array = null; }

export async function buildWorld(scene, map, T, step = async () => {}) {
  const M = makeMaterials(T);
  M.swim = Object.assign(new THREE.MeshStandardMaterial({ color: 0x48b4dc, roughness: 0.04, metalness: 0.1, normalMap: T.waterNormal }), { depthTest: false, depthWrite: false });
  const chunks = new Chunks(400);
  const ctx = { scene, data: map.data, map, M, T, grid: new SegGrid(24), custom: {}, solids: [] };
  ctx.get = (key, order, x, z) => chunks.get(key + '@' + order, x, z);

  await step('Laying ground'); buildGround(ctx);
  await step('Paving roads'); buildRoads(ctx);
  await step('Raising buildings'); buildBuildings(ctx);

  // footprint index for inside-building tests
  const FC = 64, fgrid = new Map(), fk = (i, j) => (i + 512) * 2048 + (j + 512);
  for (const f of ctx.footprints) for (let i = Math.floor(f.bb.minx / FC); i <= Math.floor(f.bb.maxx / FC); i++) for (let j = Math.floor(f.bb.minz / FC); j <= Math.floor(f.bb.maxz / FC); j++) {
    const k = fk(i, j); if (!fgrid.has(k)) fgrid.set(k, []); fgrid.get(k).push(f);
  }
  ctx.insideBuilding = (x, z) => {
    const l = fgrid.get(fk(Math.floor(x / FC), Math.floor(z / FC))); if (!l) return false;
    for (const f of l) if (x >= f.bb.minx && x <= f.bb.maxx && z >= f.bb.minz && z <= f.bb.maxz && pip(x, z, f.pts)) return true;
    return false;
  };

  await step('Planting trees'); buildProps(ctx);

  await step('Building meshes');
  let tris = 0;
  for (const b of chunks.map.values()) {
    if (b.empty) continue;
    const [key, order] = b.key.split('@'), mat = M[key] || ctx.custom[key];
    if (!mat) { console.warn('missing material', key); continue; }
    const o = +order, mesh = new THREE.Mesh(b.build(), mat);
    mesh.renderOrder = o; mesh.receiveShadow = true; mesh.castShadow = o >= 0; mesh.matrixAutoUpdate = false;
    scene.add(mesh); if (o >= 0) ctx.solids.push(mesh); tris += b.p.length / 9;
    b.p = b.n = b.u = b.c = null;   // drop the JS-side build arrays
    for (const a of Object.values(mesh.geometry.attributes)) a.onUpload(freeArray);   // and the typed arrays once on the GPU
  }
  ctx.tris = tris; chunks.map.clear();
  ctx.nightUpdate = (night, t) => {
    M.nightUpdate(night, t);
    for (const m of ctx.signMats) m.emissiveIntensity = 0.12 + night * 1.3;
    ctx.treeTime.value = t;
    ctx.signals.update(t);
  };
  ctx.clear = (x, z, r) => !ctx.grid.near(x, z, r) && !ctx.insideBuilding(x, z) && Math.hypot(x, z) < map.R - 5;
  ctx.bounds = (v) => { const d = Math.hypot(v.x, v.z), m = map.R - 4; if (d > m) { v.x *= m / d; v.z *= m / d; return true; } return false; };
  return ctx;
}
