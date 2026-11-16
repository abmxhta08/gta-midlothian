import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = mulberry32(987654);
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length) % arr.length];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export function shortestAngle(d) { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export const fwdOf = (h) => [Math.sin(h), Math.cos(h)];
export const rightOf = (h) => [-Math.cos(h), Math.sin(h)];

// ---- value noise ----
const P = new Uint8Array(512); { const r = mulberry32(42); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => P[(P[(xi + i) & 255] + yi + j) & 255] / 255;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v);
}
export function fbm(x, y, oct = 4) { let a = 0, s = 0.5, f = 1; for (let i = 0; i < oct; i++) { a += vn(x * f, y * f) * s; f *= 2; s *= 0.5; } return a / (1 - Math.pow(0.5, oct)); }

// ---- polygons ----
export function pip(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x1 = poly[i][0], z1 = poly[i][1], x2 = poly[j][0], z2 = poly[j][1];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c;
  }
  return c;
}
export function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function centroid(pts) { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
export function bbox(pts) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const p of pts) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); } return { minx: a, maxx: b, minz: c, maxz: d }; }
/** Minimum-area oriented bounding box: {cx, cz, ang, hl (half length along ang), hw, area}. */
export function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), c = Math.cos(ang), s = Math.sin(ang);
    let a = 1e9, b = -1e9, e = 1e9, f = -1e9;
    for (const r of pts) { const u = r[0] * c + r[1] * s, v = -r[0] * s + r[1] * c; a = Math.min(a, u); b = Math.max(b, u); e = Math.min(e, v); f = Math.max(f, v); }
    const area = (b - a) * (f - e);
    if (!best || area < best.area) {
      const uc = (a + b) / 2, vc = (e + f) / 2;
      best = { cx: uc * c - vc * s, cz: uc * s + vc * c, ang, hl: (b - a) / 2, hw: (f - e) / 2, area };
    }
  }
  if (best.hw > best.hl) { const t = best.hw; best.hw = best.hl; best.hl = t; best.ang += Math.PI / 2; }
  return best;
}
export function dedupe(raw, eps = 0.05) {
  const pts = [];
  for (const p of raw) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) pts.push(p); }
  if (pts.length > 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) pts.pop(); }
  return pts;
}
/** Offset a polyline sideways (positive = left of travel direction in x/z map frame). */
export function offsetLine(pts, off) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.push([pts[i][0] - dz * off, pts[i][1] + dx * off]);
  }
  return out;
}
export function cumLen(pts) { const D = [0]; for (let i = 1; i < pts.length; i++) D.push(D[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return D; }
/** Point + tangent at distance s along polyline (with precomputed cumulative lengths D). */
export function along(pts, D, s, out = {}) {
  const L = D[D.length - 1]; s = clamp(s, 0, L);
  let i = 0, lo = 0, hi = D.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (D[m + 1] < s) lo = m + 1; else hi = m; }
  i = Math.min(lo, pts.length - 2);
  const seg = D[i + 1] - D[i] || 1, t = (s - D[i]) / seg, a = pts[i], b = pts[i + 1];
  out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t;
  out.dx = (b[0] - a[0]) / seg; out.dz = (b[1] - a[1]) / seg; out.i = i;
  return out;
}

/** Accumulates non-indexed triangles; winding auto-fixed to face along the given normal. */
export class Builder {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  get empty() { return this.p.length === 0; }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, au, av, bu, bv, cu, cv, r, g, b) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    if ((e1y * e2z - e1z * e2y) * nx + (e1z * e2x - e1x * e2z) * ny + (e1x * e2y - e1y * e2x) * nz < 0) {
      let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bz; bz = cz; cz = t; t = bu; bu = cu; cu = t; t = bv; bv = cv; cv = t;
    }
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz); this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.u.push(au, av, bu, bv, cu, cv); this.c.push(r, g, b, r, g, b, r, g, b);
  }
  /** Quad a,b,c,d (in order around), arrays [x,y,z]; uv arrays [u,v]; normal auto from geometry if n omitted. */
  quad(a, b, c, d, n, ua, ub, uc, ud, col) {
    if (!n) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    }
    this.tri(...a, ...b, ...c, ...n, ...ua, ...ub, ...uc, ...col);
    this.tri(...a, ...c, ...d, ...n, ...ua, ...uc, ...ud, ...col);
  }
  /** Axis-aligned-in-local-frame box: centre (x,y,z), size, yaw rotation. */
  box(x, y, z, sx, sy, sz, yaw, col, uvScale = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const N = (lx, lz) => [lx * c + lz * s, 0, -lx * s + lz * c];
    const u = uvScale;
    const faces = [
      [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz], N(1, 0), sz, sy],
      [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], N(-1, 0), sz, sy],
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], N(0, 1), sx, sy],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], N(0, -1), sx, sy],
      [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [0, 1, 0], sx, sz],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0], sx, sz],
    ];
    for (const [a, b, cc, d, n, w, h] of faces)
      this.quad(P(...a), P(...b), P(...cc), P(...d), n, [0, 0], [w / u, 0], [w / u, h / u], [0, h / u], col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Builders bucketed by (material key, spatial cell) so each becomes one cullable mesh. */
export class Chunks {
  constructor(size) { this.size = size; this.map = new Map(); }
  get(key, x, z) {
    const k = key + '|' + Math.floor(x / this.size) + ',' + Math.floor(z / this.size);
    let b = this.map.get(k); if (!b) { b = new Builder(); b.key = key; this.map.set(k, b); } return b;
  }
}

/** Flat ribbon along a polyline. uvMode 'world' = x/z tiling, 'along' = u across (0..1), v along/len. */
export function ribbon(get, pts, w, y, col, uvMode = 'world', tile = 6, offset = 0) {
  const n = pts.length; if (n < 2) return;
  const Lp = offsetLine(pts, offset + w / 2), Rp = offsetLine(pts, offset - w / 2), D = cumLen(pts);
  for (let i = 0; i < n - 1; i++) {
    const b = get((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    const uv = uvMode === 'world'
      ? [Lp[i][0] / tile, Lp[i][1] / tile, Rp[i][0] / tile, Rp[i][1] / tile, Lp[i + 1][0] / tile, Lp[i + 1][1] / tile, Rp[i + 1][0] / tile, Rp[i + 1][1] / tile]
      : [0, D[i] / tile, 1, D[i] / tile, 0, D[i + 1] / tile, 1, D[i + 1] / tile];
    b.tri(Lp[i][0], y, Lp[i][1], Rp[i][0], y, Rp[i][1], Lp[i + 1][0], y, Lp[i + 1][1], 0, 1, 0, uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], col[0], col[1], col[2]);
    b.tri(Rp[i][0], y, Rp[i][1], Rp[i + 1][0], y, Rp[i + 1][1], Lp[i + 1][0], y, Lp[i + 1][1], 0, 1, 0, uv[2], uv[3], uv[6], uv[7], uv[4], uv[5], col[0], col[1], col[2]);
  }
}
/** Flat polygon (triangulated) at height y. */
export function flatPoly(b, pts, y, col, tile = 6, up = true) {
  const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
  let faces; try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  for (const f of faces) {
    const A = pts[f[0]], B = pts[f[1]], C = pts[f[2]]; if (!A || !B || !C) continue;
    b.tri(A[0], y, A[1], B[0], y, B[1], C[0], y, C[1], 0, up ? 1 : -1, 0, A[0] / tile, A[1] / tile, B[0] / tile, B[1] / tile, C[0] / tile, C[1] / tile, col[0], col[1], col[2]);
  }
}
