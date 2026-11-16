import { cumLen, pip, bbox, along, centroid, signedArea } from './util.js';

const NO_DRIVE = new Set(['driveway']);
const TRAFFIC_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const SPEED = { motorway: 29, trunk: 22, primary: 20, secondary: 17, tertiary: 15, unclassified: 12, residential: 11, living_street: 7, service: 6 };
const KIND_LABEL = { school: 'School', retail: 'Shopping', commercial: 'Business District', park: 'Park', mall: 'Shopping Center', place_of_worship: 'Church',
  religious: 'Church', golf_course: 'Golf Course', recreation_ground: 'Recreation', sports_centre: 'Sports Center', cemetery: 'Cemetery', hospital: 'Hospital',
  college: 'College', library: 'Library', fire_station: 'Fire Station', police: 'Police', residential: 'Neighborhood', nature_reserve: 'Nature Reserve',
  pitch: 'Sports Field', industrial: 'Industrial', stadium: 'Stadium', playground: 'Playground', dog_park: 'Dog Park', building: '' };

/** Derived structures: road index, drive graph (A*), locations, school exclusion. */
export function prepareData(data) {
  for (const r of data.roads) r.D = cumLen(r.pts);
  const M = { data, R: data.radius };

  // ---- road segment index for nearest-road queries ----
  const C = 40, cells = new Map(), key = (i, j) => (i + 512) * 2048 + (j + 512);
  data.roads.forEach((r, ri) => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++)
        for (let z = Math.floor(Math.min(a[1], b[1]) / C); z <= Math.floor(Math.max(a[1], b[1]) / C); z++) {
          const k = key(x, z); let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(ri, i);
        }
    }
  });
  M.nearestRoad = (x, z, maxD = 60, filter = null) => {
    let best = null, bd = maxD;
    const r0 = Math.ceil(maxD / C);
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = ci - r0; i <= ci + r0; i++) for (let j = cj - r0; j <= cj + r0; j++) {
      const l = cells.get(key(i, j)); if (!l) continue;
      for (let q = 0; q < l.length; q += 2) {
        const r = data.roads[l[q]], s = l[q + 1]; if (filter && !filter(r)) continue;
        const a = r.pts[s], b = r.pts[s + 1], abx = b[0] - a[0], abz = b[1] - a[1], L2 = abx * abx + abz * abz || 1;
        let t = ((x - a[0]) * abx + (z - a[1]) * abz) / L2; t = Math.max(0, Math.min(1, t));
        const px = a[0] + abx * t, pz = a[1] + abz * t, d = Math.hypot(x - px, z - pz);
        if (d < bd) { const L = Math.sqrt(L2); bd = d; best = { road: r, seg: s, t, px, pz, dist: d, dx: abx / L, dz: abz / L, s: r.D[s] + t * L }; }
      }
    }
    return best;
  };

  // ---- drive graph ----
  const count = new Map();
  const driveRoads = data.roads.filter(r => !NO_DRIVE.has(r.svc));
  for (const r of driveRoads) r.nids.forEach((n, i) => count.set(n, (count.get(n) || 0) + (i === 0 || i === r.nids.length - 1 ? 2 : 1)));
  const nodePos = new Map(), out = new Map(), edges = [];
  const addEdge = (from, to, pts, road, rev) => {
    const e = { id: edges.length, from, to, pts, D: cumLen(pts), road, rev, traffic: TRAFFIC_TYPES.has(road.type) };
    e.len = e.D[e.D.length - 1]; if (e.len < 0.5) return;
    edges.push(e); if (!out.has(from)) out.set(from, []); out.get(from).push(e);
  };
  for (const r of driveRoads) {
    let start = 0;
    for (let i = 1; i < r.nids.length; i++) {
      if (count.get(r.nids[i]) >= 2 || i === r.nids.length - 1) {
        const pts = r.pts.slice(start, i + 1), a = r.nids[start], b = r.nids[i];
        nodePos.set(a, r.pts[start]); nodePos.set(b, r.pts[i]);
        addEdge(a, b, pts, r, false);
        if (!r.oneway) addEdge(b, a, pts.slice().reverse(), r, true);
        start = i;
      }
    }
  }
  for (const e of edges) {   // lane offset to the right of travel (US right-hand traffic)
    const r = e.road, lw = r.w / Math.max(1, r.lanes);
    e.laneOffsets = r.oneway ? Array.from({ length: r.lanes }, (_, k) => (k - (r.lanes - 1) / 2) * lw)
      : Array.from({ length: Math.max(1, Math.floor(r.lanes / 2)) }, (_, k) => lw * (k + 0.5));
    if (r.svc === 'parking_aisle' || (r.type === 'service' && !r.oneway)) e.laneOffsets = [1.3];
  }
  M.graph = { nodePos, out, edges };
  M.nearestNode = (x, z, trafficOnly = false) => {
    let best = null, bd = 1e18;
    for (const [n, p] of nodePos) { if (trafficOnly && !(out.get(n) || []).some(e => e.traffic)) continue; const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  };
  /** A* on the drive graph. Returns polyline [[x,z]...] or null. */
  M.route = (fx, fz, tx, tz) => {
    const s = M.nearestNode(fx, fz), t = M.nearestNode(tx, tz); if (s == null || t == null) return null;
    const tp = nodePos.get(t), h = (n) => { const p = nodePos.get(n); return Math.hypot(p[0] - tp[0], p[1] - tp[1]); };
    const g = new Map([[s, 0]]), came = new Map(), open = [[h(s), s]], closed = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, n] = open.splice(bi, 1)[0]; if (n === t) break; if (closed.has(n)) continue; closed.add(n);
      for (const e of out.get(n) || []) {
        const cost = e.len * (e.road.type === 'service' ? 1.6 : 1), ng = g.get(n) + cost;
        if (ng < (g.get(e.to) ?? Infinity)) { g.set(e.to, ng); came.set(e.to, e); open.push([ng + h(e.to), e.to]); }
      }
    }
    if (!came.has(t) && s !== t) return null;
    const path = []; let n = t;
    while (n !== s) { const e = came.get(n); path.unshift(e); n = e.from; }
    const pts = [[fx, fz]]; for (const e of path) for (const p of e.pts) pts.push(p); pts.push([tx, tz]);
    return pts;
  };

  // ---- locations & districts ----
  M.locations = (data.locations || []).map(l => {
    const o = { ...l, label: KIND_LABEL[l.kind] ?? '' };
    if (l.pts) { o.bb = bbox(l.pts); o.c = centroid(l.pts); o.area = Math.abs(signedArea(l.pts)); }
    return o;
  });
  M.locationAt = (x, z) => {
    let best = null;
    for (const l of M.locations) {
      if (l.kind === 'residential' && l.area > 2.5e6) continue;
      const inside = l.pts ? (x >= l.bb.minx && x <= l.bb.maxx && z >= l.bb.minz && z <= l.bb.maxz && pip(x, z, l.pts)) : Math.hypot(x - l.c[0], z - l.c[1]) < l.r;
      if (inside && (!best || l.area < best.area)) best = l;
    }
    return best;
  };
  M.districtAt = (x, z) => {
    const res = M.locations.filter(l => l.kind === 'residential' && l.pts && l.name);
    for (const l of res) if (x >= l.bb.minx && x <= l.bb.maxx && z >= l.bb.minz && z <= l.bb.maxz && pip(x, z, l.pts)) return l.name;
    let best = null, bd = 1600;
    for (const p of data.places || []) { const d = Math.hypot(p.p[0] - x, p.p[1] - z); if (d < bd) { bd = d; best = p.name; } }
    return best || 'Midlothian';
  };
  M.schoolPolys = data.areas.filter(a => a.kind === 'school').map(a => a.pts);
  M.inSchool = (x, z) => M.schoolPolys.some(p => pip(x, z, p));
  M.streetAt = (x, z) => { const n = M.nearestRoad(x, z, 18, r => !!r.name); return n ? n.road.name : null; };
  M.along = along;
  return M;
}
