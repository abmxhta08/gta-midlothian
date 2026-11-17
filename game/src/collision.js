/** Segment spatial hash: circle-vs-wall pushes for buildings, props and parked cars. */
export class SegGrid {
  constructor(cell = 24) {
    this.cell = cell; this.cells = new Map(); this.n = 0; this.cap = 4096; this.stamp = 0; this.out = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
    this.S = new Float32Array(this.cap * 5); this.seen = new Int32Array(this.cap); this.off = new Uint8Array(this.cap);
  }
  grow() {
    this.cap *= 2; const S = new Float32Array(this.cap * 5), seen = new Int32Array(this.cap), off = new Uint8Array(this.cap);
    S.set(this.S); seen.set(this.seen); off.set(this.off); this.S = S; this.seen = seen; this.off = off;
  }
  key(i, j) { return (i + 2048) * 8192 + (j + 2048); }
  add(x1, z1, x2, z2, tag = 0) {
    if (this.n >= this.cap) this.grow();
    const id = this.n++, k = id * 5; this.S[k] = x1; this.S[k + 1] = z1; this.S[k + 2] = x2; this.S[k + 3] = z2; this.S[k + 4] = tag;
    const c = this.cell;
    for (let i = Math.floor(Math.min(x1, x2) / c); i <= Math.floor(Math.max(x1, x2) / c); i++)
      for (let j = Math.floor(Math.min(z1, z2) / c); j <= Math.floor(Math.max(z1, z2) / c); j++) {
        const k = this.key(i, j); let l = this.cells.get(k); if (!l) { l = []; this.cells.set(k, l); } l.push(id);
      }
    return id;
  }
  addPoly(pts, tag = 0) { const ids = []; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; ids.push(this.add(p[0], p[1], q[0], q[1], tag)); } return ids; }
  addBox(cx, cz, hl, hw, ang, tag = 0) {
    const c = Math.cos(ang), s = Math.sin(ang), P = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
    return this.addPoly([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)], tag);
  }
  addCircle(x, z, r, tag = 0) { const pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return this.addPoly(pts, tag); }
  disable(ids) { for (const id of ids) this.off[id] = 1; }
  finalize() {}
  tagAt(id) { return this.S[id * 5 + 4]; }
  /** Accumulated push-out for a circle. Returned object is shared. */
  push(x, z, r, accumulate = true) {
    const o = this.out; o.x = 0; o.z = 0; o.hit = false;
    // a non-finite / absurd coordinate would make the cell loops below run forever (Infinity <= Infinity never ends): treat as no hit
    if (!(Math.abs(x) < 1e6 && Math.abs(z) < 1e6 && r < 1e4)) return o;
    const st = ++this.stamp, c = this.cell, S = this.S, seen = this.seen, off = this.off;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const l = this.cells.get(this.key(i, j)); if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const id = l[q]; if (seen[id] === st || off[id]) continue; seen[id] = st;
        const k = id * 5, ax = S[k], az = S[k + 1], abx = S[k + 2] - ax, abz = S[k + 3] - az;
        let t = ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax + abx * t), dz = z - (az + abz * t), d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          o.hit = true; if (!accumulate) return o;
          const d = Math.sqrt(d2);
          if (d > 1e-4) { const p = r - d; o.x += dx / d * p; o.z += dz / d * p; }
          else { const L = Math.hypot(abx, abz) || 1; o.x += -abz / L * r; o.z += abx / L * r; }
        }
      }
    }
    if (o.hit) { const L = Math.hypot(o.x, o.z) || 1; o.nx = o.x / L; o.nz = o.z / L; }
    return o;
  }
  near(x, z, r) { return this.push(x, z, r, false).hit; }
  /** First intersection distance of 2D ray (ox,oz)+(dx,dz)*t within maxT, or Infinity. */
  ray(ox, oz, dx, dz, maxT) {
    if (!(Math.abs(ox) < 1e6 && Math.abs(oz) < 1e6 && Math.abs(dx) <= 1.5 && Math.abs(dz) <= 1.5)) return Infinity;   // NaN / Infinity inputs
    const c = this.cell, S = this.S, st = ++this.stamp, seen = this.seen, off = this.off; let best = Infinity;
    const steps = Math.ceil(Math.min(maxT, 5000) / (c * 0.5));   // a huge or infinite maxT must not loop forever
    for (let s = 0; s <= steps; s++) {
      const x = ox + dx * (s * c * 0.5), z = oz + dz * (s * c * 0.5);
      const l = this.cells.get(this.key(Math.floor(x / c), Math.floor(z / c))); if (!l) continue;
      for (const id of l) {
        if (seen[id] === st || off[id]) continue; seen[id] = st;
        const k = id * 5, ax = S[k], az = S[k + 1], ex = S[k + 2] - ax, ez = S[k + 3] - az;
        const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
        if (t >= 0 && t <= maxT && u >= 0 && u <= 1 && t < best) { best = t; const L = Math.hypot(ex, ez) || 1; this.rayN = [-ez / L, ex / L]; this.rayTag = S[k + 4]; }
      }
      if (best < (s + 1) * c * 0.5) break;
    }
    return best;
  }
}
