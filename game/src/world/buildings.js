import * as THREE from 'three';
import { obb, signedArea, centroid, dedupe, pip, rgb, hash, bbox, flatPoly, ribbon, mulberry32 } from '../util.js';
import { signTexture } from '../textures.js';

const SIDING = [0xf2efe6, 0xe9e1cf, 0xd9d6cc, 0xcfd6d8, 0xe6dfbf, 0xc9d1c0, 0xb7c3cc, 0xe8e2d2, 0xd6cbb6, 0xa9b4a6];
const BRICKT = [0xffffff, 0xf0e0d8, 0xe0d0c8, 0xffe8d8, 0xd8c8c0];
const ROOF = [0x8d8d90, 0x9a8e84, 0x7c7e82, 0x8a7a6c, 0x6f7276, 0x8f8a80];
const SHUTTER = [0x2a3a2a, 0x1e1e22, 0x4a1e1e, 0x1f2a40, 0x3a3a3a];
const DOOR = [0x7a1414, 0x1c1c1c, 0x1b2a4a, 0xf2f2ee, 0x2e4a2e, 0x6a4a2a];
const BLOCK = [0xe9dcc4, 0xd8d2c6, 0xcfc2a8, 0xf0ebe0, 0xbdb6aa, 0xd9c7a8];
const AWN = [0x1f4a2e, 0x6a1a1a, 0x1b2f5a, 0x2a2a2a, 0x8a5a1a];
const WHITE = [1, 1, 1];

export function buildBuildings(ctx) {
  const { data, map, grid } = ctx;
  ctx.bushes = []; ctx.yardTrees = []; ctx.mailboxes = []; ctx.driveSpots = []; ctx.footprints = [];
  const signMats = ctx.signMats = [];
  const comAreas = data.areas.filter(a => ['retail', 'commercial', 'industrial'].includes(a.kind)).map(a => ({ pts: a.pts, bb: bbox(a.pts) }));
  const inCom = (x, z) => comAreas.some(a => x >= a.bb.minx && x <= a.bb.maxx && z >= a.bb.minz && z <= a.bb.maxz && pip(x, z, a.pts));
  const signed = new Set();
  // largest building per school gets the sign
  const schoolBig = new Map();
  for (const b of data.buildings) if (b.school) { const a = Math.abs(signedArea(b.pts)); if (!schoolBig.has(b.school) || schoolBig.get(b.school).a < a) schoolBig.set(b.school, { b, a }); }

  data.buildings.forEach((bd, idx) => {
    const pts0 = dedupe(bd.pts); if (pts0.length < 3) return;
    const area = Math.abs(signedArea(pts0)); if (area < 8) return;
    const [cx, cz] = centroid(pts0), rnd = mulberry32(Math.abs(bd.id || idx) + 7);
    const kind = classify(bd, area, cx, cz);
    const B = (key) => ctx.get(key, 0, cx, cz);
    const o = obb(pts0), rect = area / o.area > 0.8 && o.hw > 1.6;
    const poly = rect ? rectPoly(o) : pts0;
    const E = edges(poly);
    const nr = map.nearestRoad(cx, cz, 80, r => r.svc !== 'driveway');
    const front = frontEdge(E, cx, cz, nr);
    const H = { house: 0, townhouse: 0 }[kind];
    const opts = { bd, area, cx, cz, rnd, o, rect, poly, E, front, nr, B, kind };
    if (kind === 'house' || kind === 'townhouse') house(opts);
    else if (kind === 'apartment') apartment(opts);
    else if (kind === 'shed') shed(opts);
    else if (kind === 'church') church(opts);
    else if (kind === 'school' || kind === 'office') institutional(opts);
    else commercial(opts);
    grid.addPoly(poly, 1);
    ctx.footprints.push({ pts: poly, bb: bbox(poly), name: bd.name || bd.school, kind });
    void H;
  });

  function classify(b, area, cx, cz) {
    const t = b.type, n = (b.name || '').toLowerCase();
    if (b.school || t === 'school') return 'school';
    if (t === 'college' || t === 'office' || t === 'hospital' || /hall$|institute|campus/.test(n)) return 'office';
    if (/church|chapel|kingdom hall|temple|synagogue/.test(n) || t === 'church') return 'church';
    if (['shed', 'garage', 'garages', 'roof', 'ruins', 'tree_house', 'carport', 'service'].includes(t) || area < 34) return 'shed';
    if (t === 'terrace') return 'townhouse';
    if (t === 'apartments') return 'apartment';
    if (t === 'retail' || t === 'commercial' || t === 'supermarket' || b.name || b.shop) return 'commercial';
    if (t === 'house' || t === 'detached' || t === 'semidetached_house') return 'house';
    if (inCom(cx, cz)) return 'commercial';
    if (area < 400) return 'house';
    if (area < 2600) return 'apartment';
    return 'commercial';
  }

  // ---------- geometry helpers ----------
  function rectPoly(o) {
    const c = Math.cos(o.ang), s = Math.sin(o.ang), P = (u, v) => [o.cx + u * c - v * s, o.cz + u * s + v * c];
    return [P(-o.hl, -o.hw), P(o.hl, -o.hw), P(o.hl, o.hw), P(-o.hl, o.hw)];
  }
  function edges(poly) {
    const sg = signedArea(poly) > 0 ? 1 : -1, out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const dx = (q[0] - p[0]) / len, dz = (q[1] - p[1]) / len;
      out.push({ p, q, len, dx, dz, nx: sg > 0 ? dz : -dz, nz: sg > 0 ? -dx : dx, i });
    }
    return out;
  }
  function frontEdge(E, cx, cz, nr) {
    let best = E[0], bs = -1e9;
    const tx = nr ? nr.px - cx : 0, tz = nr ? nr.pz - cz : 1, tl = Math.hypot(tx, tz) || 1;
    for (const e of E) { const s = (e.nx * tx + e.nz * tz) / tl + Math.min(e.len, 12) * 0.02; if (s > bs) { bs = s; best = e; } }
    return best;
  }
  function wall(B, e, y0, y1, col, inward = false) {
    const n = inward ? [-e.nx, 0, -e.nz] : [e.nx, 0, e.nz];
    B.quad([e.p[0], y0, e.p[1]], [e.q[0], y0, e.q[1]], [e.q[0], y1, e.q[1]], [e.p[0], y1, e.p[1]], n, [0, y0], [e.len, y0], [e.len, y1], [0, y1], col);
  }
  /** Quad on wall e between along-distances s0..s1 and heights y0..y1, pushed out by d. */
  function decal(B, e, s0, s1, y0, y1, d, col = WHITE, uv = [0, 0, 1, 1]) {
    const ax = e.p[0] + e.dx * s0 + e.nx * d, az = e.p[1] + e.dz * s0 + e.nz * d, bx = e.p[0] + e.dx * s1 + e.nx * d, bz = e.p[1] + e.dz * s1 + e.nz * d;
    B.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [e.nx, 0, e.nz], [uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]], col);
  }
  function face(B, V, U, col, up = true) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < V.length; i++) { const a = V[i], b = V[(i + 1) % V.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if ((up && ny < 0) || (!up && ny > 0)) { nx = -nx; ny = -ny; nz = -nz; }
    for (let i = 1; i < V.length - 1; i++) B.tri(...V[0], ...V[i], ...V[i + 1], nx, ny, nz, ...U[0], ...U[i], ...U[i + 1], ...col);
  }
  function windowsOn(B, e, floors, y0, fh, ww, wh, spacing, skip = [], shutters = null, rnd = Math.random) {
    const n = Math.floor((e.len - 0.6) / spacing); if (n < 1) return;
    for (let f = 0; f < floors; f++) for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * e.len / n, y = y0 + f * fh;
      if (f === 0 && skip.some(([a, b]) => s + ww / 2 > a && s - ww / 2 < b)) continue;
      decal(ctx.get(rnd() < 0.33 ? 'windowLit' : 'windowDark', 0, e.p[0], e.p[1]), e, s - ww / 2, s + ww / 2, y, y + wh, 0.04);
      if (shutters) { decal(B('trim'), e, s - ww / 2 - 0.45, s - ww / 2 - 0.05, y, y + wh, 0.06, shutters); decal(B('trim'), e, s + ww / 2 + 0.05, s + ww / 2 + 0.45, y, y + wh, 0.06, shutters); }
      if (!shutters && ww < 1.3) decal(B('trim'), e, s - ww / 2 - 0.08, s + ww / 2 + 0.08, y - 0.12, y, 0.07, [0.9, 0.9, 0.88]);
    }
    function B(k) { return ctx.get(k, 0, e.p[0], e.p[1]); }
  }
  function P3(o, u, v, y) { const c = Math.cos(o.ang), s = Math.sin(o.ang); return [o.cx + u * c - v * s, y, o.cz + u * s + v * c]; }
  function gableRoof(B, o, H, rise, roofCol, wallKey, wallCol, hip = false) {
    const oh = 0.45, sl = rise / o.hw, ye = H - oh * sl, hl = o.hl + oh, hw = o.hw + oh, top = H + rise, slope = Math.hypot(hw, rise + oh * sl);
    const r = B('shingle'), soff = B('trim'), sc = [0.92, 0.92, 0.9];
    const rl = hip ? Math.max(0.2, o.hl - o.hw) : hl;
    for (const sv of [-1, 1]) {
      const V = [P3(o, -hl, sv * hw, ye), P3(o, hl, sv * hw, ye), P3(o, rl, 0, top), P3(o, -rl, 0, top)];
      const U = [[-hl, 0], [hl, 0], [rl, slope], [-rl, slope]];
      face(r, V, U, roofCol); face(soff, V, U, sc, false);
    }
    if (hip) {
      for (const su of [-1, 1]) {
        const V = [P3(o, su * hl, -hw, ye), P3(o, su * hl, hw, ye), P3(o, su * rl, 0, top)];
        const U = [[-hw, 0], [hw, 0], [0, slope]];
        face(r, V, U, roofCol); face(soff, V, U, sc, false);
      }
    } else {
      const w = B(wallKey);
      for (const su of [-1, 1]) {
        const a = P3(o, su * o.hl, -o.hw, H), b = P3(o, su * o.hl, o.hw, H), c = P3(o, su * o.hl, 0, top);
        w.tri(...a, ...b, ...c, Math.cos(o.ang) * su, 0, Math.sin(o.ang) * su, 0, H, o.hw * 2, H, o.hw, top, ...wallCol);
      }
    }
  }
  function pyramidRoof(B, poly, H, rise, roofCol) {
    const [cx, cz] = centroid(poly), apex = [cx, H + rise, cz], r = B('shingle');
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const d = Math.hypot((p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - cz);
      face(r, [[p[0], H, p[1]], [q[0], H, q[1]], apex], [[0, 0], [len, 0], [len / 2, Math.hypot(d, rise)]], roofCol);
    }
  }
  function flatRoof(B, poly, E, H, parapet, roofCol, wallKey, wallCol) {
    flatPoly(B('flatroof'), poly, H - parapet, roofCol, 1);
    if (parapet > 0) for (const e of E) wall(B(wallKey), e, H - parapet, H, wallCol, true);
  }
  function footprintFrontInfo(e) { return e; }
  void footprintFrontInfo;

  // ---------- building types ----------
  function house({ bd, area, cx, cz, rnd, o, rect, poly, E, front, nr, B, kind }) {
    const town = kind === 'townhouse';
    const two = bd.levels ? bd.levels >= 2 : town || (area > 115 && rnd() < 0.68);
    const H = (bd.levels ? Math.min(bd.levels, 3) : two ? 2 : 1) * 2.8 + 0.45;
    const brick = rnd() < (town ? 0.5 : 0.42);
    const wallKey = brick ? 'brick' : 'siding', wallCol = rgb(brick ? BRICKT[Math.floor(rnd() * BRICKT.length)] : SIDING[Math.floor(rnd() * SIDING.length)]);
    const roofCol = rgb(ROOF[Math.floor(rnd() * ROOF.length)]);
    const shut = !brick && rnd() < 0.5 ? rgb(SHUTTER[Math.floor(rnd() * SHUTTER.length)]) : (brick && rnd() < 0.35 ? rgb(SHUTTER[Math.floor(rnd() * SHUTTER.length)]) : null);
    const floors = Math.round((H - 0.45) / 2.8);
    // door + garage on front
    const garage = !town && area > 130 && front.len > 9 && rnd() < 0.55 ? (front.len > 13 && rnd() < 0.5 ? 5.0 : 2.7) : 0;
    const gs = garage ? [front.len - garage - 0.8, front.len - 0.8] : null;
    const doorS = garage ? Math.min(front.len * 0.42, gs[0] - 1.5) : front.len / 2;
    for (const e of E) {
      wall(B('brick'), e, 0, 0.45, [0.8, 0.75, 0.72]);
      wall(B(wallKey), e, 0.45, H, wallCol);
      const skip = [];
      if (e === front) {
        if (town) {
          const units = Math.max(2, Math.round(e.len / 6.5));
          for (let u = 0; u < units; u++) {
            const ds = (u + 0.3) * e.len / units; skip.push([ds - 0.7, ds + 0.7]);
            decal(B('door'), e, ds - 0.5, ds + 0.5, 0.45, 2.55, 0.05, rgb(DOOR[(u + Math.floor(rnd() * 6)) % DOOR.length]));
          }
        } else {
          skip.push([doorS - 0.8, doorS + 0.8]);
          decal(B('door'), e, doorS - 0.5, doorS + 0.5, 0.45, 2.55, 0.05, rgb(DOOR[Math.floor(rnd() * DOOR.length)]));
          decal(B('trim'), e, doorS - 0.65, doorS + 0.65, 2.55, 2.7, 0.06, [0.95, 0.95, 0.93]);
          // stoop
          const sx = e.p[0] + e.dx * doorS + e.nx * 0.7, sz = e.p[1] + e.dz * doorS + e.nz * 0.7;
          B('trim').box(sx, 0.18, sz, 1.6, 0.36, 1.3, -Math.atan2(e.dz, e.dx), [0.62, 0.62, 0.6]);
          if (garage) { skip.push(gs); decal(B('garage'), e, gs[0], gs[1], 0.05, 2.35, 0.05, WHITE); }
        }
      }
      windowsOn(B, e, floors, 1.25, 2.8, 0.95, 1.4, 3.1, skip, shut, rnd);
    }
    if (rect) {
      const hip = rnd() < 0.35 || town;
      gableRoof(B, o, H, o.hw * (town ? 0.5 : 0.62), roofCol, wallKey, wallCol, hip && o.hl > o.hw * 1.05);
      if (!town && rnd() < 0.4) {
        const su = rnd() < 0.5 ? -1 : 1, c = P3(o, su * (o.hl + 0.35), 0, 0);
        B('brick').box(c[0], (H + o.hw * 0.62 + 0.8) / 2, c[2], 0.7, H + o.hw * 0.62 + 0.8, 1.5, -o.ang, [0.85, 0.8, 0.78]);
      }
    } else pyramidRoof(B, poly, H, Math.min(3.2, 0.28 * Math.sqrt(area)), roofCol);
    // yard dressing
    for (let s = 0.8; s < front.len - 0.6; s += 1.7) {
      if ((gs && s > gs[0] - 0.5) || Math.abs(s - doorS) < 1.1) continue;
      if (rnd() < 0.8) ctx.bushes.push([front.p[0] + front.dx * s + front.nx * 0.9, front.p[1] + front.dz * s + front.nz * 0.9, 0.6 + rnd() * 0.5]);
    }
    if (rnd() < 0.5) ctx.yardTrees.push([cx + front.nx * (o.hw + 7 + rnd() * 3) + front.dx * (rnd() - 0.5) * 6, cz + front.nz * (o.hw + 7 + rnd() * 3) + front.dz * (rnd() - 0.5) * 6]);
    for (let k = 0; k < 2; k++) if (rnd() < 0.75) ctx.yardTrees.push([cx - front.nx * (o.hw + 6 + rnd() * 9) + front.dx * (rnd() - 0.5) * 14, cz - front.nz * (o.hw + 6 + rnd() * 9) + front.dz * (rnd() - 0.5) * 14]);
    // driveway to the street
    if (!town && nr && nr.road.type !== 'service') {
      const s = gs ? (gs[0] + gs[1]) / 2 : front.len * 0.82;
      const sx = front.p[0] + front.dx * s + front.nx * 0.1, sz = front.p[1] + front.dz * s + front.nz * 0.1;
      const r2 = map.nearestRoad(sx, sz, 50, r => r === nr.road);
      if (r2) {
        let dx = r2.px - sx, dz = r2.pz - sz; const L = Math.hypot(dx, dz) - r2.road.w / 2 - 0.15; dx /= L + r2.road.w / 2 + 0.15; dz /= L + r2.road.w / 2 + 0.15;
        if (L > 2 && L < 38) {
          const ex = sx + dx * L, ez = sz + dz * L, w = garage > 4 ? 5.4 : 3.2;
          ribbon((x, z) => ctx.get('concrete', -3.2, x, z), [[sx, sz], [ex, ez]], w, 0, WHITE, 'along', 1.5);
          ctx.mailboxes.push([ex - dz * (w / 2 + 0.9) - dx * 0.8, ez + dx * (w / 2 + 0.9) - dz * 0.8, Math.atan2(dx, dz)]);
          if (L > 7 && rnd() < 0.4) ctx.driveSpots.push({ x: sx + dx * 3.6, z: sz + dz * 3.6, heading: Math.atan2(-dx, -dz) });
        }
      }
    }
  }

  function apartment({ bd, area, rnd, o, rect, poly, E, front, B }) {
    const floors = bd.levels || 3, H = floors * 3 + 0.4;
    const brick = rnd() < 0.6, wallKey = brick ? 'brick' : 'siding', wallCol = rgb(brick ? BRICKT[Math.floor(rnd() * 5)] : SIDING[Math.floor(rnd() * SIDING.length)]);
    const roofCol = rgb(ROOF[Math.floor(rnd() * ROOF.length)]);
    for (const e of E) {
      wall(B(wallKey), e, 0, H, wallCol);
      const skip = [];
      if (e === front) for (let s = 6; s < e.len - 3; s += 16) {
        skip.push([s - 1.4, s + 1.4]);
        decal(B('door'), e, s - 0.9, s + 0.9, 0, 2.3, 0.05, [0.35, 0.3, 0.25]);
        B('trim').box(e.p[0] + e.dx * s + e.nx * 0.8, 2.6, e.p[1] + e.dz * s + e.nz * 0.8, 2.6, 0.2, 1.6, -Math.atan2(e.dz, e.dx), [0.92, 0.92, 0.9]);
      }
      windowsOn(B, e, floors, 0.95, 3, 1.1, 1.45, 3.2, skip, null, rnd);
    }
    if (rect && o.hw < 14) gableRoof(B, o, H, o.hw * 0.45, roofCol, wallKey, wallCol, true);
    else flatRoof(B, poly, E, H, 0.6, rgb(0xd0d0d0), wallKey, wallCol);
    void area;
  }

  function shed({ rnd, o, rect, poly, E, B, area }) {
    const H = area > 25 ? 2.8 : 2.3, col = rgb(SIDING[Math.floor(rnd() * SIDING.length)]);
    for (const e of E) wall(B('siding'), e, 0, H, col);
    if (E[0] && E[0].len > 1.6) decal(B('door'), E[0], E[0].len / 2 - 0.5, E[0].len / 2 + 0.5, 0, 2, 0.04, [0.8, 0.8, 0.78]);
    if (rect) gableRoof(B, o, H, o.hw * 0.5, rgb(ROOF[Math.floor(rnd() * ROOF.length)]), 'siding', col);
    else flatRoof(B, poly, E, H, 0, rgb(0x888888), 'siding', col);
  }

  function church({ bd, rnd, o, rect, poly, E, front, B, area }) {
    const H = 6.5, brick = rnd() < 0.6, wallKey = brick ? 'brick' : 'siding', wallCol = brick ? [1, 1, 1] : rgb(0xf4f2ec);
    for (const e of E) { wall(B(wallKey), e, 0, H, wallCol); windowsOn(B, e, 1, 1.2, 3, 1.0, 3.6, 3.6, e === front ? [[e.len / 2 - 1.5, e.len / 2 + 1.5]] : [], null, rnd); }
    decal(B('door'), front, front.len / 2 - 1, front.len / 2 + 1, 0, 2.8, 0.05, [0.45, 0.3, 0.2]);
    const roofCol = rgb(0x6a6c70);
    if (rect) {
      gableRoof(B, o, H, o.hw * 0.9, roofCol, wallKey, wallCol);
      const su = 1, base = P3(o, su * (o.hl - 1.9), 0, 0), th = H + o.hw * 0.9 + 4;
      B(wallKey).box(base[0], th / 2, base[2], 3.4, th, 3.4, -o.ang, wallCol);
      const s = B('trim'), c = [0.96, 0.96, 0.94], h0 = th, h1 = th + 8;
      const q = [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]].map(([u, v]) => { const p = P3(o, su * (o.hl - 1.9) + u, v, h0); return p; });
      const apex = [base[0], h1, base[2]];
      for (let i = 0; i < 4; i++) face(s, [q[i], q[(i + 1) % 4], apex], [[0, 0], [3.6, 0], [1.8, 8]], c);
    } else pyramidRoof(B, poly, H, 4, roofCol);
    if (bd.name) sign(front, bd.name, 2.6, 0.7, B, 1.4);
    void area;
  }

  function institutional({ bd, rnd, poly, E, front, B, kind }) {
    const floors = bd.levels || (kind === 'school' ? 2 : 2), H = floors * 3.8 + 0.6;
    const brick = kind === 'school' || rnd() < 0.6, wallKey = brick ? 'brick' : 'block', wallCol = brick ? rgb(0xf6e8de) : rgb(BLOCK[Math.floor(rnd() * BLOCK.length)]);
    for (const e of E) {
      wall(B(wallKey), e, 0, H, wallCol);
      const skip = e === front ? [[e.len / 2 - 2.5, e.len / 2 + 2.5]] : [];
      windowsOn(B, e, floors, 1.0, 3.8, 2.3, 1.7, 3.6, skip, null, rnd);
    }
    decal(B('store'), front, front.len / 2 - 2, front.len / 2 + 2, 0.05, 2.9, 0.05, WHITE, [0, 0, 1, 1]);
    B('trim').box(front.p[0] + front.dx * front.len / 2 + front.nx * 1.4, 3.2, front.p[1] + front.dz * front.len / 2 + front.nz * 1.4, 6, 0.3, 2.8, -Math.atan2(front.dz, front.dx), [0.9, 0.9, 0.88]);
    flatRoof(B, poly, E, H, 0.8, rgb(0xcfcfcf), wallKey, wallCol);
    const name = bd.school || bd.name;
    if (name && (!bd.school || schoolBig.get(bd.school)?.b === bd)) sign(front, name, 3.6, Math.min(1.1, H - 4.4), B, 0.9);
  }

  function commercial({ bd, area, rnd, poly, E, front, B, cx, cz }) {
    const storage = /storage/i.test(bd.name || '');
    let H = bd.h || (bd.levels ? bd.levels * 3.8 : area > 3000 ? 8.5 : area > 1200 ? 7 : 5.8);
    if (bd.name) H = Math.max(H, 6.2);
    const brick = !storage && rnd() < 0.35, wallKey = storage ? 'metal' : brick ? 'brick' : 'block';
    const wallCol = storage ? rgb(0xd8d8d4) : brick ? rgb(BRICKT[Math.floor(rnd() * 5)]) : rgb(BLOCK[Math.floor(rnd() * BLOCK.length)]);
    for (const e of E) {
      wall(B(wallKey), e, 0, H, wallCol);
      if (storage && e.len > 8) for (let s = 2; s < e.len - 2; s += 3.6) decal(B('garage'), e, s, s + 2.8, 0.02, 2.6, 0.04, rgb(0xe07a2a));
    }
    if (!storage && front.len > 5) {
      const s0 = front.len * 0.08, s1 = front.len * 0.92;
      decal(B('store'), front, s0, s1, 0.08, 3.05, 0.04, WHITE, [0, 0, (s1 - s0) / 4, 1]);
      const awn = rgb(AWN[Math.floor(rnd() * AWN.length)]), mid = (s0 + s1) / 2;
      B('trim').box(front.p[0] + front.dx * mid + front.nx * 0.65, 3.35, front.p[1] + front.dz * mid + front.nz * 0.65, s1 - s0, 0.28, 1.3, -Math.atan2(front.dz, front.dx), awn);
      // a second storefront on the opposite long side for big stores facing parking
    }
    flatRoof(B, poly, E, H, 0.8, rgb(0xd8d8d6), wallKey, wallCol);
    // rooftop HVAC units
    const bb = bbox(poly), n = Math.min(10, Math.floor(area / 300));
    for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
      const x = bb.minx + rnd() * (bb.maxx - bb.minx), z = bb.minz + rnd() * (bb.maxz - bb.minz);
      if (!pip(x, z, poly) || grid.near(x, z, 2.5)) continue;
      B('trim').box(x, H - 0.8 + 0.6, z, 2.2, 1.2, 1.6, rnd() * 3, [0.78, 0.79, 0.8]); k++;
    }
    if (bd.name) sign(front, bd.name, 3.75, Math.min(1.5, H - 4.2), B, 0.7);
    void cx; void cz;
  }

  function sign(e, name, y0, h, B, maxFrac) {
    if (h < 0.5 || e.len < 3) return;
    const key = 'sign:' + name;
    if (!ctx.custom[key]) {
      const st = signTexture(name);
      const m = new THREE.MeshStandardMaterial({ map: st.tex, emissive: 0xffffff, emissiveMap: st.tex, emissiveIntensity: 0.12, roughness: 0.4 });
      ctx.custom[key] = m; m.userData.aspect = st.aspect; signMats.push(m);
    }
    const asp = ctx.custom[key].userData.aspect, w = Math.min(e.len * maxFrac, h * asp), hh = w / asp, mid = e.len / 2;
    decal(ctx.get(key, 0, e.p[0], e.p[1]), e, mid - w / 2, mid + w / 2, y0, y0 + hh, 0.12);
    signed.add(name);
  }
}
