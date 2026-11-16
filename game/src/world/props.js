import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, pip, bbox, rgb, along, hash, fbm } from '../util.js';
import { instancedCar, PAINTS, CAR_TYPES } from '../entities/carmodels.js';

const rnd = mulberry32(4242);
const TC = 400;   // instancing cell size for props: bigger cells = fewer draw calls
const TREE_C = 260, TREE_LOD = 240;   // trees use smaller cells so the detailed/cheap swap stays close to the player
const paintGeo = (g, fn) => {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
};
const clean = (g) => { g = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a); return g; };
function blob(r, detail, seed, sx = 1, sy = 1, sz = 1) {
  let g = new THREE.IcosahedronGeometry(r, detail); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
  const p = g.attributes.position, R = mulberry32(seed);
  const jit = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jit.has(k)) jit.set(k, 0.82 + R() * 0.36);
    const j = jit.get(k); p.setXYZ(i, p.getX(i) * j * sx, p.getY(i) * j * sy, p.getZ(i) * j * sz);
  }
  g.computeVertexNormals(); return g;
}
function treeGeo(kind, seed) {
  const R = mulberry32(seed), parts = [];
  const bark = rgb(0x4a3a2c), shade = (base) => (x, y) => { const k = 0.55 + 0.45 * Math.min(1, Math.max(0, (y - 2) / 6)); return base.map(v => v * k * (0.9 + R() * 0.2)); };
  if (kind === 'pine') {
    parts.push(paintGeo(new THREE.CylinderGeometry(0.16, 0.3, 11, 6).translate(0, 5.5, 0), () => rgb(0x5a4632)));
    const g = rgb(0x2f4a26);
    for (let i = 0; i < 4; i++) parts.push(paintGeo(blob(1.5 + R() * 0.5, 1, seed + i, 1.2, 0.8, 1.2).translate((R() - 0.5) * 1.6, 10.2 + i * 0.7 + R(), (R() - 0.5) * 1.6), shade(g)));
  } else if (kind === 'cedar') {
    parts.push(paintGeo(new THREE.CylinderGeometry(0.15, 0.22, 1.5, 5).translate(0, 0.75, 0), () => bark));
    for (let i = 0; i < 4; i++) parts.push(paintGeo(new THREE.ConeGeometry(2.2 - i * 0.45, 2.8, 8).translate(0, 2 + i * 1.6, 0), shade(rgb(0x2b4a2a))));
  } else if (kind === 'ring') {
    parts.push(paintGeo(new THREE.CylinderGeometry(0.2, 0.3, 6, 5).translate(0, 3, 0), () => bark));
    for (let i = 0; i < 3; i++) parts.push(paintGeo(blob(2.2 + R() * 0.6, 0, seed + i).translate((R() - 0.5) * 2.4, 6.5 + i * 1.3, (R() - 0.5) * 2.4), shade(rgb(R() < 0.5 ? 0x37552a : 0x2f4a26))));
  } else {
    const h = kind === 'maple' ? 3.2 : 3.6, g = kind === 'maple' ? rgb(0x5e8a34) : rgb(0x4a7a2e);
    parts.push(paintGeo(new THREE.CylinderGeometry(0.2, 0.32, h + 1, 6).translate(0, (h + 1) / 2, 0), () => bark));
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R(), d = i === 0 ? 0 : 1.3 + R() * 0.6;
      parts.push(paintGeo(blob(1.8 + R() * 0.7, 1, seed * 7 + i).translate(Math.cos(a) * d, h + 1.6 + R() * 1.4 + (i === 0 ? 1 : 0), Math.sin(a) * d), shade(g)));
    }
  }
  return mergeGeometries(parts.map(clean));
}

export function buildProps(ctx) {
  const { data, map, grid, scene, M } = ctx, R = data.radius;
  const blocked = (x, z, r) => grid.near(x, z, r) || ctx.insideBuilding(x, z);
  const onRoad = (x, z, pad = 1.5) => { const n = map.nearestRoad(x, z, 25); return n && n.dist < n.road.w / 2 + pad; };

  // ---------- trees ----------
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const uTime = { value: 0 }; ctx.treeTime = uTime;
  treeMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.13;
      float sway = max(0.0, position.y - 2.5) * 0.012;
      transformed.x += sin(uTime * 1.3 + ph) * sway; transformed.z += cos(uTime * 1.1 + ph) * sway * 0.7;
      #endif`);
  };
  // Fewer kinds and one shared far-LOD mesh per cell keep the instanced-mesh count (and per-frame culling cost) down.
  const kinds = [['oak', 11], ['maple', 13], ['pine', 14], ['cedar', 16], ['ring', 17]];
  const OAK = 0, MAPLE = 1, PINE = 2, CEDAR = 3, RING = 4, DECID = () => (rnd() < 0.62 ? OAK : MAPLE), ANY = () => { const r = rnd(); return r < 0.4 ? OAK : r < 0.65 ? MAPLE : r < 0.9 ? PINE : CEDAR; };
  const tgeo = kinds.map(([k, s]) => treeGeo(k, s));
  const cells = new Map();
  const addTree = (x, z, kind = -1, s = 0.8 + rnd() * 0.55) => {
    const v = kind >= 0 ? kind : ANY();
    const k = Math.floor(x / TREE_C) * 1000 + Math.floor(z / TREE_C);
    let c = cells.get(k); if (!c) { c = { lists: kinds.map(() => []) }; cells.set(k, c); } c.lists[v].push(x, z, s);
    if (v !== RING) grid.addCircle(x, z, 0.35 * s, 2);
  };
  const treeOk = (x, z) => Math.hypot(x, z) < R + 5 && !blocked(x, z, 2.2) && !onRoad(x, z, 2.5);
  for (const t of data.trees || []) if (treeOk(t[0], t[1])) addTree(t[0], t[1]);
  for (const a of data.areas) {
    if (!['forest', 'wetland', 'scrub', 'nature_reserve'].includes(a.kind)) continue;
    const bb = bbox(a.pts), sp = a.kind === 'scrub' ? 12 : 8;
    for (let x = bb.minx; x < bb.maxx; x += sp) for (let z = bb.minz; z < bb.maxz; z += sp) {
      const px = x + rnd() * sp, pz = z + rnd() * sp;
      if (pip(px, pz, a.pts) && treeOk(px, pz)) addTree(px, pz, rnd() < 0.45 ? PINE : -1, 0.9 + rnd() * 0.6);
    }
  }
  for (const [x, z] of ctx.yardTrees) if (treeOk(x, z)) addTree(x, z);
  for (const sw of ctx.sidewalks) {
    if (sw.road.type !== 'residential' || hash(sw.road.id + 3) > 0.5) continue;
    const L = sw.D[sw.D.length - 1];
    for (let s = 8; s < L - 8; s += 18 + rnd() * 16) { const p = along(sw.pts, sw.D, s), off = sw.paved ? -1.2 : 1.2; const x = p.x - p.dz * off, z = p.z + p.dx * off; if (treeOk(x, z)) addTree(x, z, DECID()); }
  }
  // forest wall around the map edge
  for (let a = 0; a < Math.PI * 2; a += 6 / (R + 40)) for (let d = R + 8; d < R + 130; d += 9 + rnd() * 5) {
    const aa = a + (rnd() - 0.5) * 0.004, x = Math.cos(aa) * d, z = Math.sin(aa) * d;
    if (!onRoad(x, z, 3)) addTree(x, z, RING, 1 + rnd() * 0.5);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  let nTrees = 0;
  ctx.treeLOD = [];
  for (const { lists } of cells.values()) {
    const nearCount = lists.slice(0, RING).reduce((a, l) => a + l.length / 3, 0);
    const lo = nearCount ? new THREE.InstancedMesh(tgeo[RING], treeMat, nearCount) : null, his = [];
    let li = 0, cx = 0, cz = 0;
    lists.forEach((list, v) => {
      const n = list.length / 3; if (!n) return;
      const im = new THREE.InstancedMesh(tgeo[v], treeMat, n);
      for (let i = 0; i < n; i++) {
        const s = list[i * 3 + 2]; ps.set(list[i * 3], 0, list[i * 3 + 1]); e.set(0, rnd() * 6.28, 0); q.setFromEuler(e); sc.set(s, s * (0.85 + rnd() * 0.3), s);
        m4.compose(ps, q, sc); im.setMatrixAt(i, m4); const k = 0.8 + rnd() * 0.35; im.setColorAt(i, col.setRGB(k, k * (0.95 + rnd() * 0.1), k * 0.9));
        if (v !== RING) { lo.setMatrixAt(li, m4); lo.setColorAt(li, col); li++; cx += list[i * 3]; cz += list[i * 3 + 1]; }
      }
      im.castShadow = v !== RING; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); nTrees += n;
      if (v !== RING) his.push(im);
    });
    if (lo) { lo.receiveShadow = true; lo.computeBoundingSphere(); lo.visible = false; scene.add(lo); ctx.treeLOD.push({ x: cx / nearCount, z: cz / nearCount, his, lo, near: true }); }
  }
  ctx.treeCount = nTrees;
  ctx.updateLOD = (cam) => {
    for (const t of ctx.treeLOD) {
      const near = Math.hypot(t.x - cam.x, t.z - cam.z) < TREE_LOD; if (near === t.near) continue;
      t.near = near; for (const h of t.his) h.visible = near; t.lo.visible = !near;
    }
  };

  // ---------- bushes ----------
  const bushGeo = clean(paintGeo(blob(1, 1, 99, 1.2, 0.8, 1.2).translate(0, 0.55, 0), (x, y) => rgb(0x3f6a2c).map(c => c * (0.6 + 0.5 * y))));
  instanceScatter(ctx.bushes.filter(([x, z]) => !ctx.insideBuilding(x, z)).map(([x, z, s]) => ({ x, z, s, rot: rnd() * 6 })), bushGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), true);

  // ---------- street lights ----------
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.13, 8, 8).translate(0, 4, 0), new THREE.BoxGeometry(0.1, 0.1, 2.2).translate(0, 7.9, 1.05),
  ].map(clean));
  const headGeo = clean(new THREE.BoxGeometry(0.45, 0.16, 0.8).translate(0, 7.82, 2.1));
  const poolGeo = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.05, 2.6);
  const lights = [];
  for (const r of data.roads) {
    const major = ['tertiary', 'secondary', 'primary', 'trunk'].includes(r.type), res = r.type === 'residential';
    if (!major && !(res && hash(r.id + 11) < 0.55) && r.svc !== 'parking_aisle') continue;
    const L = r.D[r.D.length - 1], step = major ? 48 : r.svc === 'parking_aisle' ? 36 : 65;
    let side = 1;
    for (let s = 10; s < L - 5; s += step) {
      if (major) side = -side;
      const p = along(r.pts, r.D, s), off = side * (r.w / 2 + (r.svc === 'parking_aisle' ? 3 : 1.1));
      const x = p.x - p.dz * off, z = p.z + p.dx * off;
      if (blocked(x, z, 1) || [...ctx.junctions.values()].some(j => Math.hypot(j.x - x, j.z - z) < j.r + 4)) continue;
      lights.push({ x, z, rot: Math.atan2(-(-p.dz * side), -(p.dx * side)) });
      grid.addCircle(x, z, 0.15, 3);
    }
  }
  instanceScatter(lights.map(l => ({ ...l, s: 1 })), poleGeo, M.pole.clone(), true);   // own material: instanced vs plain meshes need different shader variants
  instanceScatter(lights.map(l => ({ ...l, s: 1 })), headGeo, M.lamp, false);
  const pools = instanceScatter(lights.map(l => ({ ...l, s: 1 })), poolGeo, M.pool, false);
  for (const p of pools) p.renderOrder = 1;

  // ---------- traffic signals ----------
  ctx.signals = buildSignals(ctx);
  // ---------- stop signs ----------
  const stopMat = new THREE.MeshStandardMaterial({ map: ctx.T.stop, transparent: true, alphaTest: 0.5, roughness: 0.5, side: THREE.DoubleSide });
  const stopPoles = [], stopFaces = [], tmp = new THREE.Object3D();
  for (const a of ctx.stopApproaches) {
    const r = a.road, p = along(r.pts, r.D, a.s), dx = p.dx * a.dir, dz = p.dz * a.dir;
    const off = r.w / 2 + 0.9, x = p.x - dz * off, z = p.z + dx * off;
    tmp.position.set(x, 0, z); tmp.rotation.set(0, Math.atan2(-dx, -dz), 0); tmp.updateMatrix();
    stopPoles.push(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(0, 1.15, 0).applyMatrix4(tmp.matrix));
    stopFaces.push(new THREE.CircleGeometry(0.38, 8).rotateZ(Math.PI / 8).translate(0, 2.3, 0.05).applyMatrix4(tmp.matrix));
  }
  if (stopPoles.length) {
    const pm = new THREE.Mesh(mergeGeometries(stopPoles), M.pole); pm.castShadow = true; scene.add(pm);
    scene.add(new THREE.Mesh(mergeGeometries(stopFaces), stopMat));
  }
  // ---------- mailboxes & hydrants ----------
  const mbGeo = mergeGeometries([paintGeo(new THREE.BoxGeometry(0.08, 1.1, 0.08).translate(0, 0.55, 0), () => rgb(0x2a2a2a)), paintGeo(new THREE.BoxGeometry(0.22, 0.24, 0.48).translate(0, 1.2, 0), () => rgb(0x1a1a1a))].map(clean));
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  instanceScatter(ctx.mailboxes.map(([x, z, rot]) => ({ x, z, rot, s: 1 })), mbGeo, vmat, true);
  const hyGeo = mergeGeometries([paintGeo(new THREE.CylinderGeometry(0.14, 0.17, 0.75, 8).translate(0, 0.37, 0), () => rgb(0xd8b81a)), paintGeo(new THREE.SphereGeometry(0.15, 8, 6).translate(0, 0.78, 0), () => rgb(0xd8b81a)), paintGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.5, 0), () => rgb(0xd8b81a))].map(clean));
  const hyd = [];
  for (const sw of ctx.sidewalks) { if (!sw.paved || hash(sw.road.id + 5) > 0.5) continue; const L = sw.D[sw.D.length - 1]; for (let s = 30; s < L; s += 140) { const p = along(sw.pts, sw.D, s); const x = p.x + p.dz * 1.2 * 0, z = p.z; if (!blocked(x, z, 0.8)) { hyd.push({ x, z, rot: 0, s: 1 }); grid.addCircle(x, z, 0.2, 3); } } }
  instanceScatter(hyd, hyGeo, vmat, true);

  // ---------- parked cars ----------
  ctx.parked = [];
  const spots = [];
  for (const st of ctx.stalls) if (rnd() < 0.3) spots.push({ ...st, heading: st.heading + (rnd() < 0.5 ? Math.PI : 0) });
  for (const d of ctx.driveSpots) spots.push(d);
  const types = ['sedan', 'sedan', 'suv', 'suv', 'hatch', 'pickup', 'compact', 'compact', 'van', 'muscle'], byType = new Map();
  for (const sp of spots) {
    const type = types[Math.floor(rnd() * types.length)], dims = CAR_TYPES[type];
    if (ctx.insideBuilding(sp.x, sp.z) || grid.near(sp.x, sp.z, dims.W / 2 + 0.1) || onRoad(sp.x, sp.z, -0.5) && !sp.aisle) continue;
    const pc = { x: sp.x, z: sp.z, heading: sp.heading, type, color: PAINTS[Math.floor(rnd() * PAINTS.length)], active: true };
    const hl = (dims.top[dims.top.length - 1][0] - dims.top[0][0]) / 2;
    pc.seg = grid.addBox(sp.x, sp.z, hl, dims.W / 2, Math.atan2(Math.cos(sp.heading), Math.sin(sp.heading)), 4);
    const bk = type + '|' + Math.floor(sp.x / 450) + ',' + Math.floor(sp.z / 450);
    if (!byType.has(bk)) byType.set(bk, []); byType.get(bk).push(pc); ctx.parked.push(pc);
  }
  for (const [bk, list] of byType) {
    const type = bk.split('|')[0];
    const { geo, mats } = instancedCar(type), im = new THREE.InstancedMesh(geo, mats, list.length);
    list.forEach((pc, i) => { ps.set(pc.x, 0, pc.z); e.set(0, pc.heading, 0); q.setFromEuler(e); im.setMatrixAt(i, m4.compose(ps, q, sc.set(1, 1, 1))); im.setColorAt(i, col.setHex(pc.color)); pc.mesh = im; pc.index = i; });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
  }
  ctx.hideParked = (pc) => { pc.active = false; grid.disable(pc.seg); pc.mesh.setMatrixAt(pc.index, m4.makeScale(0, 0, 0)); pc.mesh.instanceMatrix.needsUpdate = true; };

  function instanceScatter(items, geo, mat, shadow) {
    const groups = new Map(), out = [];
    for (const it of items) { const k = Math.floor(it.x / TC) * 1000 + Math.floor(it.z / TC); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const list of groups.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { ps.set(it.x, 0, it.z); e.set(0, it.rot || 0, 0); q.setFromEuler(e); sc.setScalar(it.s || 1); im.setMatrixAt(i, m4.compose(ps, q, sc)); });
      im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); out.push(im);
    }
    return out;
  }
  void fbm;
}

/** Signal heads at each approach + a two-phase controller per intersection cluster.
 *  All poles, arms and housings are merged into one mesh and every lamp is one instance of one InstancedMesh,
 *  so ~40 intersections cost 2 draw calls instead of ~2000 objects. */
function buildSignals(ctx) {
  const { scene, M } = ctx;
  const OFF = new THREE.Color(0.06, 0.06, 0.06), ON = { r: new THREE.Color(4, 0.35, 0.15), y: new THREE.Color(4, 2.4, 0.1), g: new THREE.Color(0.2, 4, 1.2) };
  const statics = [], lampMats = [], tmp = new THREE.Object3D(), child = new THREE.Object3D(); tmp.add(child);
  const place = (geo, x, y, z, ry = 0, rz = 0) => { child.position.set(x, y, z); child.rotation.set(0, ry, rz); tmp.updateMatrixWorld(true); return geo.clone().applyMatrix4(child.matrixWorld); };
  const clusters = [];
  for (const a of ctx.signalApproaches) {
    let c = clusters.find(c => Math.hypot(c.x - a.node[0], c.z - a.node[1]) < 45);
    if (!c) { c = { x: a.node[0], z: a.node[1], axis: null, offset: Math.random() * 30, approaches: [] }; clusters.push(c); }
    const r = a.road, p = along(r.pts, r.D, Math.max(0, Math.min(r.D[r.D.length - 1], a.s))), dx = p.dx * a.dir, dz = p.dz * a.dir;
    const bear = Math.atan2(dx, dz);
    if (c.axis === null) c.axis = bear;
    let d = Math.abs(((bear - c.axis) % Math.PI + Math.PI) % Math.PI); d = Math.min(d, Math.PI - d);
    const ap = { ...a, group: d < Math.PI / 4 ? 0 : 1, x: p.x, z: p.z, dx, dz, heads: [] };
    c.approaches.push(ap);
    const off = r.w / 2 + 1.2, px = p.x - dz * off, pz = p.z + dx * off, armLen = r.w / 2 + 0.6;
    tmp.position.set(px, 0, pz); tmp.rotation.set(0, bear, 0);
    statics.push(place(new THREE.CylinderGeometry(0.12, 0.16, 6.6, 8), 0, 3.3, 0));
    statics.push(place(new THREE.CylinderGeometry(0.07, 0.09, armLen, 6), armLen / 2, 6.3, 0, 0, Math.PI / 2));
    const nHeads = Math.max(1, Math.min(3, Math.round(r.w / 2 / 3.4)));
    for (let k = 0; k < nHeads; k++) {
      const hx = off - (k + 0.5) * (r.w / 2) / nHeads;
      statics.push(place(new THREE.BoxGeometry(0.36, 1.05, 0.3), hx, 5.55, 0));
      const lamps = [0, 1, 2].map(i => { child.position.set(hx, 5.55 + 0.32 - i * 0.32, -0.16); child.rotation.set(0, Math.PI, 0); tmp.updateMatrixWorld(true); lampMats.push(child.matrixWorld.clone()); return lampMats.length - 1; });
      ap.heads.push(lamps);
    }
    ctx.grid.addCircle(px, pz, 0.2, 3);
  }
  if (statics.length) { const m = new THREE.Mesh(mergeGeometries(statics.map(g => g.index ? g.toNonIndexed() : g)), M.pole); m.castShadow = true; scene.add(m); }
  const lampMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampMats.length));
  lampMats.forEach((m, i) => { lampMesh.setMatrixAt(i, m); lampMesh.setColorAt(i, OFF); });
  lampMesh.count = lampMats.length; lampMesh.computeBoundingSphere(); scene.add(lampMesh);
  const CYCLE = [[0, 'g', 16], [0, 'y', 3.5], [-1, 'r', 1.5], [1, 'g', 14], [1, 'y', 3.5], [-1, 'r', 1.5]], TOTAL = CYCLE.reduce((a, c) => a + c[2], 0);
  const stateOf = (c, group, t) => {
    let u = (t + c.offset) % TOTAL;
    for (const [g, s, d] of CYCLE) { if (u < d) return g === group ? s : 'r'; u -= d; }
    return 'r';
  };
  let lastT = -1;
  return {
    clusters,
    update(t) {
      if (Math.floor(t * 4) === lastT) return; lastT = Math.floor(t * 4);
      for (const c of clusters) for (const ap of c.approaches) {
        const st = stateOf(c, ap.group, t); ap.state = st;
        for (const [r, y, g] of ap.heads) { lampMesh.setColorAt(r, st === 'r' ? ON.r : OFF); lampMesh.setColorAt(y, st === 'y' ? ON.y : OFF); lampMesh.setColorAt(g, st === 'g' ? ON.g : OFF); }
      }
      if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
    },
    /** Signal state for a vehicle at (x,z) moving (dx,dz): returns {state, dist} for the approach ahead, or null. */
    ahead(x, z, dx, dz, maxD = 45) {
      let best = null, bd = maxD;
      for (const c of clusters) {
        if (Math.abs(c.x - x) > 80 || Math.abs(c.z - z) > 80) continue;
        for (const ap of c.approaches) {
          if (ap.dx * dx + ap.dz * dz < 0.8) continue;
          const vx = ap.x - x, vz = ap.z - z, d = vx * dx + vz * dz, lat = Math.abs(-vx * dz + vz * dx);
          if (d > -1 && d < bd && lat < ap.road.w / 2 + 2) { bd = d; best = { state: ap.state || 'r', dist: d }; }
        }
      }
      return best;
    },
  };
}
