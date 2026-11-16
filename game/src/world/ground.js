import * as THREE from 'three';
import { fbm, rgb, flatPoly, ribbon, lerp } from '../util.js';

const AREA = {   // colour (sRGB) and draw order
  residential: [0x7d9a52, -4.0], commercial: [0x8a9168, -4.0], retail: [0x8a9168, -4.0], industrial: [0x8d8c78, -4.0], construction: [0x9a8a6a, -3.9],
  brownfield: [0x9a8a6a, -3.9], farmland: [0x9aa060, -3.95], school: [0x7fa058, -3.9], college: [0x7fa058, -3.9], hospital: [0x7fa058, -3.9],
  grass: [0x7fa654, -3.8], meadow: [0x8fa45a, -3.8], grassland: [0x8fa45a, -3.8], park: [0x6f9e4a, -3.8], recreation_ground: [0x76a24e, -3.8],
  village_green: [0x76a24e, -3.8], garden: [0x6f9e4a, -3.75], playground: [0xa08f6a, -3.7], dog_park: [0x8a9a5a, -3.7], cemetery: [0x6f9a4a, -3.8],
  religious: [0x7d9a52, -3.85], golf_course: [0x6aa84a, -3.8], fairway: [0x6fb24a, -3.75], green: [0x7cc458, -3.7], rough: [0x6a8f45, -3.78],
  pitch: [0x5fae48, -3.6], sports_centre: [0x7fa058, -3.85], stadium: [0x7fa058, -3.85], track: [0xa0503e, -3.55],
  forest: [0x4a5e30, -3.7], wetland: [0x5f6e3e, -3.7], scrub: [0x6b7a42, -3.72], nature_reserve: [0x56703a, -3.82],
};

export function buildGround(ctx) {
  const { data, scene, M } = ctx, R = data.radius, G = R + 260;
  // ground grid with macro colour variation (lawn, dry patches, dark patches)
  const cell = 14, base = rgb(0x7a9a50), dry = rgb(0x9fa063), dark = rgb(0x52703a);
  const col = (x, z) => {
    const n = fbm(x / 180, z / 180, 4), m = fbm(x / 35 + 40, z / 35, 3);
    const c = base.map((v, i) => lerp(v, n > 0.55 ? dry[i] : dark[i], Math.abs(n - 0.5) * 1.6));
    return c.map(v => v * (0.85 + m * 0.3));
  };
  for (let x = -G; x < G; x += cell) for (let z = -G; z < G; z += cell) {
    if (Math.hypot(x + cell / 2, z + cell / 2) > G) continue;
    const b = ctx.get('ground', -5, x, z), c0 = col(x, z), c1 = col(x + cell, z), c2 = col(x + cell, z + cell), c3 = col(x, z + cell);
    // per-vertex colours: two tris with averaged colours keeps it simple & smooth enough
    const ca = c0.map((v, i) => (v + c1[i] + c2[i]) / 3), cb = c0.map((v, i) => (v + c2[i] + c3[i]) / 3);
    b.tri(x, 0, z, x + cell, 0, z, x + cell, 0, z + cell, 0, 1, 0, x, z, x + cell, z, x + cell, z + cell, ...ca);
    b.tri(x, 0, z, x + cell, 0, z + cell, x, 0, z + cell, 0, 1, 0, x, z, x + cell, z + cell, x, z + cell, ...cb);
  }
  const mega = new THREE.Mesh(new THREE.RingGeometry(G - 5, 20000, 64, 1).rotateX(-Math.PI / 2), Object.assign(new THREE.MeshStandardMaterial({ color: 0x41552c, roughness: 1 }), { depthTest: false, depthWrite: false }));
  mega.renderOrder = -6; scene.add(mega);

  for (const a of data.areas) {
    if (a.pts.length < 3) continue;
    if (a.kind === 'water' || a.kind === 'swimming_pool') { flatPoly(ctx.get(a.kind === 'water' ? 'water' : 'swim', -3.5, a.pts[0][0], a.pts[0][1]), a.pts, 0, [1, 1, 1], 1); continue; }
    if (a.kind === 'parking' || a.kind === 'fuel') { flatPoly(ctx.get('asphalt', -3.4, a.pts[0][0], a.pts[0][1]), a.pts, 0, [1, 1, 1], 1); continue; }
    const k = AREA[a.kind]; if (!k) continue;
    const c = rgb(k[0]);
    const tier = k[1] <= -3.85 ? -4 : k[1] < -3.65 ? -3.8 : -3.6;   // three draw tiers instead of one per land-use kind
    flatPoly(ctx.get('ground', tier, a.pts[0][0], a.pts[0][1]), a.pts, 0, c, 1);
  }
  for (const l of data.lines || []) ribbon((x, z) => ctx.get('water', -3.5, x, z), l.pts, l.kind === 'river' ? 12 : 2.5, 0, [1, 1, 1], 'world', 1);
}
