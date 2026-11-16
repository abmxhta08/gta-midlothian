import * as THREE from 'three';
import { mulberry32, fbm } from './util.js';

/** Procedural PBR-ish textures (albedo + normal + roughness) drawn on canvases: nothing to download. */
const R = mulberry32(1337);
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
let ANISO = 8;
function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO; t.needsUpdate = true;
  return t;
}
/** Build albedo/height/rough from a per-pixel function f(x,y) -> [r,g,b,height,rough]. */
function pixels(w, h, f) {
  const a = cv(w, h), ad = a.getContext('2d').createImageData(w, h);
  const H = new Float32Array(w * h), rc = cv(w, h), rd = rc.getContext('2d').createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, hh, ro] = f(x, y), i = y * w + x;
    ad.data[i * 4] = r; ad.data[i * 4 + 1] = g; ad.data[i * 4 + 2] = b; ad.data[i * 4 + 3] = 255;
    H[i] = hh; const rv = (ro ?? 0.8) * 255; rd.data[i * 4] = rv; rd.data[i * 4 + 1] = rv; rd.data[i * 4 + 2] = rv; rd.data[i * 4 + 3] = 255;
  }
  a.getContext('2d').putImageData(ad, 0, 0); rc.getContext('2d').putImageData(rd, 0, 0);
  return { albedo: a, H, rough: rc, w, h };
}
function normalFrom(H, w, h, k) {
  const c = cv(w, h), d = c.getContext('2d').createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + (x - 1 + w) % w], r = H[y * w + (x + 1) % w], u = H[((y - 1 + h) % h) * w + x], dn = H[((y + 1) % h) * w + x];
    let nx = (l - r) * k, ny = (dn - u) * k, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * w + x) * 4; d.data[i] = (nx * 0.5 + 0.5) * 255; d.data[i + 1] = (ny * 0.5 + 0.5) * 255; d.data[i + 2] = (nz * 0.5 + 0.5) * 255; d.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(d, 0, 0); return c;
}
function set(p, k) { return { map: tex(p.albedo), normalMap: tex(normalFrom(p.H, p.w, p.h, k), { srgb: false }), roughnessMap: tex(p.rough, { srgb: false }) }; }
const tileNoise = (x, y, w, s) => fbm((x / w) * s, (y / w) * s, 4); // not perfectly tileable at low freq; fine at high s

export function makeTextures(renderer) {
  ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = {};

  // Asphalt (tile 6 m): aggregate speckle + blotches.
  T.asphalt = set(pixels(512, 512, (x, y) => {
    const n = Math.random(), big = fbm(x / 64, y / 64, 3);
    let v = 58 + n * 22 + (big - 0.5) * 18; if (n > 0.985) v += 40;
    return [v, v, v + 3, n * 0.6 + big * 0.4, 0.88 + n * 0.1];
  }), 2.2);
  // Concrete sidewalk (along-road UV, 1.5 m panels): joints at v edge.
  T.concrete = set(pixels(256, 256, (x, y) => {
    const n = Math.random() * 0.5 + fbm(x / 40, y / 40, 3) * 0.5, joint = y < 3 || x < 2 ? 1 : 0;
    const v = 170 + n * 30 - joint * 60;
    return [v, v - 2, v - 7, joint ? 0 : 0.5 + n * 0.3, 0.85];
  }), 3);
  // Neutral ground detail (tinted by vertex colour): grass blades + clumps.
  T.ground = set(pixels(512, 512, (x, y) => {
    const n = Math.random(), c = fbm(x / 30, y / 30, 4), blade = (Math.sin(x * 1.7 + y * 0.3 + n * 3) > 0.6 ? 1 : 0);
    const v = 175 + c * 60 + n * 25 + blade * 15;
    return [v, v, v * 0.92, c * 0.7 + n * 0.3, 0.95];
  }), 3);
  // Lap siding (2 m tile, 10 boards).
  T.siding = set(pixels(256, 256, (x, y) => {
    const t = (y % 25.6) / 25.6, n = Math.random() * 0.06;
    const v = 235 - (1 - t) * 18 - (t > 0.93 ? 70 : 0) + n * 60;
    return [v, v, v, t * 0.9, 0.62 + n];
  }), 4);
  // Brick (1.2 m tile).
  T.brick = set(pixels(256, 256, (x, y) => {
    const row = Math.floor(y / 14.2), off = (row % 2) * 21, col = Math.floor((x + off) / 42.6);
    const mx = ((x + off) % 42.6) < 3, my = (y % 14.2) < 2.5, mortar = mx || my;
    const hv = (Math.sin(row * 12.9 + col * 78.2) * 43758.5) % 1, n = Math.random() * 18;
    if (mortar) return [178 + n, 172 + n, 160 + n, 0, 0.95];
    return [140 + hv * 50 + n, 62 + hv * 22 + n * 0.5, 48 + hv * 15, 0.8 + n / 100, 0.88];
  }), 3);
  // Split-face block / stucco for commercial (2 m tile, tinted).
  T.block = set(pixels(256, 256, (x, y) => {
    const row = Math.floor(y / 25.6), off = (row % 2) * 32, line = (y % 25.6) < 2 || ((x + off) % 64) < 2;
    const n = Math.random() * 20 + fbm(x / 20, y / 20) * 25;
    const v = 205 + n - (line ? 45 : 0);
    return [v, v, v, line ? 0 : 0.5 + n / 90, 0.9];
  }), 3);
  // Corrugated metal (vertical ribs, 2 m tile).
  T.metal = set(pixels(256, 256, (x, y) => {
    const t = (x % 19) / 19, rib = Math.sin(t * Math.PI * 2), n = Math.random() * 10;
    const v = 200 + rib * 15 + n;
    return [v, v, v, rib * 0.5 + 0.5, 0.55];
  }), 3);
  // Asphalt shingles (2 m tile).
  T.shingle = set(pixels(256, 256, (x, y) => {
    const row = Math.floor(y / 25.6), off = (row % 2) * 21, tab = Math.floor((x + off) / 42.6);
    const gap = ((x + off) % 42.6) < 2, t = (y % 25.6) / 25.6;
    const hv = Math.abs(Math.sin(row * 91.3 + tab * 47.1) * 4375.5) % 1, n = Math.random() * 30;
    const v = 150 + hv * 40 + n - (gap ? 70 : 0) - (t < 0.12 ? 45 : 0);
    return [v, v, v, gap ? 0 : t, 0.92];
  }), 5);
  // Flat roof membrane (6 m tile).
  T.flatroof = set(pixels(256, 256, (x, y) => {
    const seam = x % 128 < 1, n = Math.random() * 26 + fbm(x / 22, y / 22) * 40;
    const v = 120 + n - (seam ? 12 : 0);
    return [v, v, v + 2, seam ? 1 : 0.3, 0.85];
  }), 2);

  // House window (one window per quad): frame, muntins, glass.
  {
    const w = 128, h = 176, glassAt = (x, y) => x > 10 && x < w - 10 && y > 10 && y < h - 10 && Math.abs(x - w / 2) > 3 && Math.abs(y - h / 2) > 3 && Math.abs(y - h / 4) > 2 && Math.abs(y - 3 * h / 4) > 2;
    const p = pixels(w, h, (x, y) => {
      if (glassAt(x, y)) { const g = 40 + (1 - y / h) * 45 + (x + y * 0.6 < 110 ? 25 : 0); return [g * 0.8, g * 0.92, g * 1.05, 0, 0.06]; }
      return [236, 236, 232, 1, 0.55];
    });
    T.window = { map: tex(p.albedo), normalMap: tex(normalFrom(p.H, w, h, 2), { srgb: false }), roughnessMap: tex(p.rough, { srgb: false }) };
    const e = cv(w, h), ex = e.getContext('2d'), ed = ex.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, g = glassAt(x, y); ed.data[i] = g ? 255 : 0; ed.data[i + 1] = g ? 196 : 0; ed.data[i + 2] = g ? 120 : 0; ed.data[i + 3] = 255; }
    ex.putImageData(ed, 0, 0); T.windowGlow = tex(e);
  }
  // Storefront glass (4 m wide x 3 m tall tile).
  {
    const w = 256, h = 192;
    const p = pixels(w, h, (x, y) => {
      const mull = (x % 85) < 5 || y < 6 || y > h - 8 || Math.abs(y - 40) < 3;
      if (mull) return [60, 62, 66, 1, 0.4];
      const shelf = y > 90 && (y % 26) < 4 && x % 85 > 15 ? 30 : 0;
      const g = 34 + (1 - y / h) * 40 + shelf + (y < 40 ? 30 : 0);
      return [g * 0.85, g, g * 1.05, 0, 0.05];
    });
    T.store = { map: tex(p.albedo), roughnessMap: tex(p.rough, { srgb: false }) };
    const e = cv(w, h), ex = e.getContext('2d');
    ex.fillStyle = '#000'; ex.fillRect(0, 0, w, h);
    const gr = ex.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff4d8'); gr.addColorStop(1, '#c9b48c');
    ex.fillStyle = gr; for (let i = 0; i < 3; i++) ex.fillRect(i * 85 + 5, 6, 80, h - 14);
    ex.fillStyle = '#000'; ex.fillRect(0, 37, w, 6);
    T.storeGlow = tex(e);
  }
  // Doors.
  {
    const d = cv(64, 128), x = d.getContext('2d');
    x.fillStyle = '#e8e6e0'; x.fillRect(0, 0, 64, 128);
    x.strokeStyle = '#9a978f'; x.lineWidth = 2;
    for (const [a, b, c, e] of [[10, 10, 18, 40], [36, 10, 18, 40], [10, 58, 18, 58], [36, 58, 18, 58]]) x.strokeRect(a, b, c, e);
    x.fillStyle = '#c8b46a'; x.beginPath(); x.arc(52, 68, 3, 0, 7); x.fill();
    T.door = tex(d);
    const g = cv(256, 128), gx = g.getContext('2d');
    gx.fillStyle = '#efefeb'; gx.fillRect(0, 0, 256, 128);
    for (let i = 1; i < 4; i++) { gx.fillStyle = '#b9b9b2'; gx.fillRect(0, i * 32 - 2, 256, 3); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { gx.strokeStyle = '#d0d0c9'; gx.strokeRect(8 + j * 62, 6 + i * 32, 54, 20); }
    T.garage = tex(g);
  }
  // Water normal map.
  {
    const w = 256, H = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) H[y * w + x] = Math.sin(x / w * Math.PI * 8 + Math.sin(y / w * Math.PI * 6) * 2) * 0.5 + Math.sin(y / w * Math.PI * 10 + x / w * Math.PI * 4) * 0.5;
    T.waterNormal = tex(normalFrom(H, w, w, 1.5), { srgb: false });
  }
  // Soft radial glow.
  T.glow = radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  T.pool = radial('rgba(255,214,150,0.9)', 'rgba(255,200,120,0)');
  // Clouds.
  {
    const w = 512, c = cv(w, w), x = c.getContext('2d'), d = x.createImageData(w, w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const n = fbm(i / 70, j / 70, 5), r = Math.hypot(i - w / 2, j - w / 2) / (w / 2);
      const a = Math.max(0, (n - 0.5) * 3.2) * Math.max(0, 1 - r * r);
      const k = (j * w + i) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = 255; d.data[k + 3] = Math.min(255, a * 255);
    }
    x.putImageData(d, 0, 0); T.clouds = tex(c, { repeat: false });
  }
  // Stop sign face.
  {
    const c = cv(128, 128), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; x.lineTo(64 + Math.cos(a) * 63, 64 + Math.sin(a) * 63); }
    x.fill(); x.fillStyle = '#b3121a'; x.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; x.lineTo(64 + Math.cos(a) * 57, 64 + Math.sin(a) * 57); }
    x.fill(); x.fillStyle = '#fff'; x.font = 'bold 34px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STOP', 64, 66);
    T.stop = tex(c, { repeat: false });
  }
  return T;
}

export function radial(inner, outer, size = 128) {
  const c = cv(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const signCache = new Map();
const BRAND = { 'Target': ['#cc0000', '#fff'], 'Kroger': ['#21409a', '#fff'], 'Walmart': ['#0071ce', '#ffc220'], "Sam's Club": ['#0067a0', '#fff'],
  'Food Lion': ['#2c4f9e', '#fff'], 'CVS Pharmacy': ['#cc0000', '#fff'], 'Walgreens': ['#e31837', '#fff'], 'Starbucks': ['#00704a', '#fff'],
  "McDonald's": ['#da291c', '#ffc72c'], 'Wawa': ['#9c1b30', '#f2c500'], 'Chick-fil-A': ['#dd0033', '#fff'], 'Publix': ['#3f8b3a', '#fff'],
  'Wegmans': ['#1e1e1e', '#e8e0c8'], 'Lowe\'s': ['#004990', '#fff'], 'Home Depot': ['#f96302', '#fff'] };
/** Store sign texture with the business name (cached). Returns {tex, aspect}. */
export function signTexture(name) {
  if (signCache.has(name)) return signCache.get(name);
  const brand = Object.keys(BRAND).find(k => name.toLowerCase().includes(k.toLowerCase()));
  const [bg, fg] = brand ? BRAND[brand] : [['#1d2b3a', '#2a2a2a', '#3a1f1f', '#13342a'][name.length % 4], '#ffffff'];
  const c = cv(1024, 160), x = c.getContext('2d');
  x.font = '700 104px Oswald, Arial Narrow, Arial'; const tw = Math.min(980, x.measureText(name).width + 70);
  c.width = Math.max(256, Math.ceil(tw)); const y = c.getContext('2d');
  y.fillStyle = bg; y.fillRect(0, 0, c.width, 160);
  y.fillStyle = fg; y.font = '700 104px Oswald, Arial Narrow, Arial'; y.textAlign = 'center'; y.textBaseline = 'middle';
  y.fillText(name, c.width / 2, 86, c.width - 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
  const r = { tex: t, aspect: c.width / 160 }; signCache.set(name, r); return r;
}
