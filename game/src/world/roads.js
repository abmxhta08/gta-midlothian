import { ribbon, offsetLine, cumLen, along, rgb, hash, flatPoly } from '../util.js';

const TIER = { service: 0, living_street: 1, residential: 1, unclassified: 1, tertiary: 2, tertiary_link: 2, secondary_link: 2.5, secondary: 3,
  primary_link: 3, trunk_link: 3, primary: 4, trunk: 4, motorway_link: 4.5, motorway: 5 };
const MAJOR = new Set(['tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'tertiary_link', 'secondary_link', 'primary_link', 'trunk_link', 'motorway_link']);
const WALKABLE = new Set(['residential', 'tertiary', 'secondary', 'primary', 'trunk', 'unclassified', 'living_street']);
const WHITE = rgb(0xeeeeea), YELLOW = rgb(0xe3b021);

/** Sub-polyline between distances s0..s1. */
function sub(pts, D, s0, s1) {
  const a = along(pts, D, s0), b = along(pts, D, s1), out = [[a.x, a.z]];
  for (let i = 0; i < pts.length; i++) if (D[i] > s0 && D[i] < s1) out.push(pts[i]);
  out.push([b.x, b.z]); return out;
}
/** Intervals [s0,s1] of a road not within junction exclusion zones. */
function freeRanges(r, J, pad) {
  const L = r.D[r.D.length - 1], cuts = [];
  r.nids.forEach((n, i) => { const j = J.get(n); if (j) cuts.push([r.D[i] - j.r - pad, r.D[i] + j.r + pad]); });
  cuts.sort((a, b) => a[0] - b[0]);
  const out = []; let s = 0;
  for (const [a, b] of cuts) { if (a > s) out.push([s, a]); s = Math.max(s, b); }
  if (s < L) out.push([s, L]);
  return out.filter(([a, b]) => b - a > 1);
}

export function buildRoads(ctx) {
  const { data, map } = ctx, roads = data.roads;
  ctx.sidewalks = []; ctx.stalls = [];
  // ---- junctions ----
  const deg = new Map();
  for (const r of roads) { if (r.svc === 'driveway') continue; r.nids.forEach((n, i) => deg.set(n, (deg.get(n) || 0) + (i === 0 || i === r.nids.length - 1 ? 1 : 2))); }
  const J = new Map();
  for (const r of roads) {
    if (r.svc === 'driveway') continue;
    r.nids.forEach((n, i) => {
      if ((deg.get(n) || 0) < 3) return;
      const j = J.get(n) || { x: r.pts[i][0], z: r.pts[i][1], r: 0, roads: [] };
      j.r = Math.max(j.r, r.w / 2 + 0.3); j.roads.push(r); J.set(n, j);
    });
  }
  ctx.junctions = J;

  for (const r of roads) {
    const tier = TIER[r.type] ?? 1, walk = WALKABLE.has(r.type);
    if (r.svc === 'driveway') { ribbon((x, z) => ctx.get('concrete', -3.2, x, z), r.pts, r.w, 0, WHITE, 'along', 1.5); continue; }
    // road surface
    ribbon((x, z) => ctx.get('asphalt', -2.6 + tier * 0.05 + (r.bridge ? 0.3 : 0), x, z), r.pts, r.w, 0, WHITE, 'world', 1);
    // curbs + sidewalks
    if (walk || r.type.endsWith('_link')) {
      for (const side of [1, -1]) ribbon((x, z) => ctx.get('curb', -2.9, x, z), r.pts, 0.3, 0, WHITE, 'world', 1, side * (r.w / 2 + 0.15));
    }
    if (walk) {
      const has = MAJOR.has(r.type) ? hash(r.id) < 0.75 : hash(r.id) < 0.7;
      for (const side of [1, -1]) {
        const off = side * (r.w / 2 + (has ? 2.25 : 1.6));
        if (has) ribbon((x, z) => ctx.get('concrete', -3.0, x, z), r.pts, 1.5, 0, WHITE, 'along', 1.5, off);
        const path = offsetLine(r.pts, off);
        ctx.sidewalks.push({ pts: path, D: cumLen(path), road: r, paved: has });
      }
    }
  }
  // junction caps (cover overlapping road ends)
  for (const j of J.values()) {
    const pts = []; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; pts.push([j.x + Math.cos(a) * j.r, j.z + Math.sin(a) * j.r]); }
    flatPoly(ctx.get('asphalt', -2.0, j.x, j.z), pts, 0, WHITE, 1);
  }

  // ---- markings ----
  const mk = (x, z) => ctx.get('marking', -1.9, x, z);
  const line = (r, s0, s1, off, w, col, dash = 0) => {
    if (!dash) { ribbon(mk, sub(r.pts, r.D, s0, s1), w, 0, col, 'world', 1, off); return; }
    for (let s = s0; s < s1; s += dash * 4) ribbon(mk, sub(r.pts, r.D, s, Math.min(s1, s + dash)), w, 0, col, 'world', 1, off);
  };
  for (const r of roads) {
    if (r.type === 'service' || r.pts.length < 2) continue;
    const major = MAJOR.has(r.type), lw = r.w / Math.max(1, r.lanes), hw = r.w / 2;
    for (const [s0, s1] of freeRanges(r, J, 1.5)) {
      if (!r.oneway) {
        if (major || r.lanes >= 3) { line(r, s0, s1, 0.13, 0.11, YELLOW); line(r, s0, s1, -0.13, 0.11, YELLOW); }
        const per = Math.floor(r.lanes / 2);
        for (let k = 1; k < per; k++) { line(r, s0, s1, k * lw, 0.12, WHITE, 3); line(r, s0, s1, -k * lw, 0.12, WHITE, 3); }
        if (major) { line(r, s0, s1, hw - 0.35, 0.12, WHITE); line(r, s0, s1, -(hw - 0.35), 0.12, WHITE); }
      } else if (major || r.lanes > 1) {
        for (let k = 1; k < r.lanes; k++) line(r, s0, s1, (k - r.lanes / 2) * lw, 0.12, WHITE, 3);
        if (major) { line(r, s0, s1, -(hw - 0.35), 0.12, YELLOW); line(r, s0, s1, hw - 0.35, 0.12, WHITE); }
      }
    }
  }
  // stop bars + crosswalks at signals, stop bars at stop signs, zebra at crossings
  const near = (p, r) => { let bi = -1, bd = 3.5; r.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const bar = (r, s, side) => {   // side 1 = right half (travel in +s), -1 = left half
    if (s < 0.5 || s > r.D[r.D.length - 1] - 0.5) return;
    const lo = side > 0 ? 0.15 : -r.w / 2 + 0.3, hi = side > 0 ? r.w / 2 - 0.3 : -0.15;
    ribbon(mk, sub(r.pts, r.D, s - 0.25, s + 0.25), hi - lo, 0, WHITE, 'world', 1, (lo + hi) / 2);
  };
  const zebra = (r, sc) => {
    const L = r.D[r.D.length - 1]; if (sc < 2 || sc > L - 2) return;
    for (let o = -r.w / 2 + 0.6; o < r.w / 2 - 0.3; o += 1.1) ribbon(mk, sub(r.pts, r.D, sc - 1.5, sc + 1.5), 0.55, 0, WHITE, 'world', 1, o);
  };
  ctx.signalApproaches = [];
  for (const sp of data.signals || []) {
    for (const r of roads) {
      if (r.type === 'service') continue;
      const i = near(sp, r); if (i < 0) continue;
      const j = J.get(r.nids[i]), jr = j ? j.r : 3, sN = r.D[i];
      for (const dir of r.oneway ? [1] : [1, -1]) {
        const s = sN - dir * (jr + 3.6);
        bar(r, s, dir); zebra(r, sN - dir * (jr + 1.8));
        ctx.signalApproaches.push({ node: sp, road: r, i, dir, s, jr });
      }
    }
  }
  ctx.stopApproaches = [];
  for (const st of data.stops || []) {
    let best = null, bd = 4;
    for (const r of roads) { if (r.type === 'service') continue; const i = near(st, r); if (i >= 0) { const d = Math.hypot(r.pts[i][0] - st[0], r.pts[i][1] - st[1]); if (d < bd) { bd = d; best = { r, i }; } } }
    if (!best) continue;
    const { r, i } = best;
    // approach direction = toward the nearest junction along this road
    let dir = 1, bdist = 1e9;
    r.nids.forEach((n, k) => { if (J.has(n)) { const d = Math.abs(r.D[k] - r.D[i]); if (d < bdist) { bdist = d; dir = r.D[k] >= r.D[i] ? 1 : -1; } } });
    if (r.oneway) dir = 1;
    bar(r, r.D[i] - dir * 0.5, dir);
    ctx.stopApproaches.push({ node: st, road: r, i, dir, s: r.D[i] });
  }
  for (const c of data.crossings || []) {
    for (const r of roads) { if (r.type === 'service' || r.type === 'residential') continue; const i = near(c, r); if (i >= 0 && !J.has(r.nids[i])) zebra(r, r.D[i]); }
  }
  // parking stalls along aisles
  for (const r of roads) {
    if (r.svc !== 'parking_aisle') continue;
    const L = r.D[r.D.length - 1];
    for (const side of [1, -1]) {
      let prev = null;
      for (let s = 4; s < L - 4; s += 2.8) {
        const a = along(r.pts, r.D, s), nx = -a.dz * side, nz = a.dx * side;
        if (prev && Math.abs(prev.dx * a.dx + prev.dz * a.dz) < 0.97) { prev = a; continue; }
        prev = a;
        const o0 = r.w / 2 + 0.2, o1 = o0 + 5.2;
        const p0 = [a.x + nx * o0, a.z + nz * o0], p1 = [a.x + nx * o1, a.z + nz * o1];
        ribbon(mk, [p0, p1], 0.12, 0, WHITE, 'world', 1);
        const sc = s + 1.4; if (sc > L - 4) continue;
        const c = along(r.pts, r.D, sc), mid = o0 + 2.6;
        ctx.stalls.push({ x: c.x - c.dz * side * mid, z: c.z + c.dx * side * mid, heading: Math.atan2(nx, nz), aisle: r });
      }
    }
  }
}
