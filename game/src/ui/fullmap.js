import { renderBaseMap } from './hud.js';
import { cumLen, along } from '../util.js';

/** Full-screen pause map (M): pan, zoom, labels, blips, click to set a GPS waypoint. */
export class FullMap {
  constructor(game) {
    this.g = game; this.cv = document.getElementById('fullmap'); this.hint = document.getElementById('maphint');
    this.ctx = this.cv.getContext('2d'); this.open = false;
    this.base = renderBaseMap(game.map, 1.4);
    this.scale = 0.5; this.cx = 0; this.cz = 0; this.drag = null;
    this.labels = this.makeLabels();
    this.cv.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false }; });
    addEventListener('mousemove', (e) => {
      if (!this.drag || !this.open) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      this.cx = this.drag.cx - dx / this.scale; this.cz = this.drag.cz - dy / this.scale; this.draw();
    });
    addEventListener('mouseup', (e) => {
      if (!this.drag || !this.open) return; const d = this.drag; this.drag = null;
      if (!d.moved) { const [x, z] = this.toWorld(e.clientX, e.clientY); if (e.button === 2) game.clearRoute(false); else game.setWaypoint(x, z); this.draw(); }
    });
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cv.addEventListener('wheel', (e) => {
      const [wx, wz] = this.toWorld(e.clientX, e.clientY);
      this.scale = Math.max(0.12, Math.min(4, this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const [nx, nz] = this.toWorld(e.clientX, e.clientY); this.cx += wx - nx; this.cz += wz - nz; this.draw();
    }, { passive: true });
    addEventListener('resize', () => this.open && this.draw());
  }
  makeLabels() {
    const g = this.g, L = [];
    // neighbourhoods
    for (const p of g.data.places || []) if (Math.hypot(...p.p) < g.map.R + 100) L.push({ x: p.p[0], z: p.p[1], text: p.name, kind: 'place', min: 0, pri: 2 });
    for (const l of g.map.locations) { if (l.kind === 'residential') continue; L.push({ x: l.c[0], z: l.c[1], text: l.name, kind: l.kind === 'building' ? 'poi' : 'area', min: l.kind === 'building' ? 0.9 : 0.25, pri: l.kind === 'building' ? 3 : 1 }); }
    // streets: one label per ~350 m of each named street
    const byName = new Map();
    for (const r of g.data.roads) { if (!r.name || r.svc) continue; if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }
    for (const [name, rs] of byName) {
      const placed = [];
      for (const r of rs.sort((a, b) => b.D[b.D.length - 1] - a.D[a.D.length - 1])) {
        const len = r.D[r.D.length - 1]; if (len < 60) continue;
        for (let s = len / 2; s < len; s += 400) {
          const p = along(r.pts, r.D, s); if (placed.some(q => Math.hypot(q[0] - p.x, q[1] - p.z) < 350)) continue;
          placed.push([p.x, p.z]); let ang = Math.atan2(p.dz, p.dx); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          L.push({ x: p.x, z: p.z, text: name, kind: 'street', ang, min: r.w >= 9 ? 0.35 : 0.7, pri: r.w >= 9 ? 0 : 4 });
        }
      }
    }
    return L.sort((a, b) => a.pri - b.pri);
  }
  toWorld(sx, sy) { return [this.cx + (sx - innerWidth / 2) / this.scale, this.cz + (sy - innerHeight / 2) / this.scale]; }
  toScreen(x, z) { return [innerWidth / 2 + (x - this.cx) * this.scale, innerHeight / 2 + (z - this.cz) * this.scale]; }
  toggle(on) {
    this.open = on ?? !this.open;
    this.cv.style.display = this.open ? 'block' : 'none'; this.hint.style.display = this.open ? 'block' : 'none';
    if (this.open) { const f = this.g.focus; this.cx = f.x; this.cz = f.z; this.draw(); }
  }
  draw() {
    const c = this.ctx, W = this.cv.width = innerWidth, H = this.cv.height = innerHeight, B = this.base, g = this.g;
    c.fillStyle = '#1c2a33'; c.fillRect(0, 0, W, H);
    const k = this.scale / B.S;
    c.imageSmoothingEnabled = true;
    c.drawImage(B.canvas, W / 2 - (B.o + this.cx * B.S) * k, H / 2 - (B.o + this.cz * B.S) * k, B.canvas.width * k, B.canvas.height * k);
    // route
    if (g.route) { c.strokeStyle = g.routeMission ? '#ffd23f' : '#c46bff'; c.lineWidth = 5; c.lineJoin = c.lineCap = 'round'; c.beginPath(); g.route.forEach((p, i) => { const [a, b] = this.toScreen(p[0], p[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.stroke(); }
    // labels with simple overlap rejection
    const boxes = [];
    const fits = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    for (const l of this.labels) {
      if (this.scale < l.min) continue;
      const [x, y] = this.toScreen(l.x, l.z); if (x < -100 || x > W + 100 || y < -40 || y > H + 40) continue;
      const size = l.kind === 'place' ? 15 : l.kind === 'street' ? 12 : l.kind === 'area' ? 14 : 12;
      c.font = `${l.kind === 'place' ? 'italic 600' : l.kind === 'area' ? '700' : '600'} ${size}px Inter`;
      const tw = c.measureText(l.text).width;
      if (l.kind === 'street') {
        if (!fits(x - tw / 2, y - 8, tw, 16)) continue;
        c.save(); c.translate(x, y); c.rotate(l.ang); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 3; c.strokeStyle = '#000c'; c.strokeText(l.text, 0, 0); c.fillStyle = '#f3f0e6'; c.fillText(l.text, 0, 0); c.restore();
      } else {
        if (!fits(x - tw / 2 - 4, y - size, tw + 8, size * 1.6)) continue;
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 4; c.strokeStyle = '#000d'; c.strokeText(l.text, x, y);
        c.fillStyle = l.kind === 'place' ? '#d8d2b0' : l.kind === 'area' ? '#ffffff' : '#ffd9a0'; c.fillText(l.text, x, y);
        if (l.kind === 'poi') { c.fillStyle = '#ffb347'; c.beginPath(); c.arc(x, y + size * 0.9, 3, 0, 7); c.fill(); }
      }
    }
    const blip = (x, z, col, r, letter) => { const [a, b] = this.toScreen(x, z); c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); c.stroke(); if (letter) { c.fillStyle = '#000'; c.font = 'bold 11px Inter'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(letter, a, b + 0.5); } };
    for (const it of g.pickups.items) if (it.active) blip(it.pos.x, it.pos.z, { health: '#3cff6a', armor: '#3c9bff', cash: '#7cff7c' }[it.kind] || '#ffa63c', 4);
    for (const m of g.missions.markers) if (!g.missions.active) blip(m.pos.x, m.pos.z, '#ffd23f', 9, m.def.letter);
    if (g.missions.dest) blip(g.missions.dest.x, g.missions.dest.z, '#ffd23f', 8);
    if (g.waypoint) blip(g.waypoint.x, g.waypoint.z, '#c46bff', 7);
    for (const v of g.police.cars) if (!v.dead) blip(v.pos.x, v.pos.z, '#ff3030', 5);
    const f = g.focus, ph = g.player.vehicle ? g.player.vehicle.heading : g.player.yaw, [px, py] = this.toScreen(f.x, f.z);
    c.save(); c.translate(px, py); c.rotate(-ph + Math.PI); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke(); c.restore();
    // legend
    c.fillStyle = '#000b'; c.fillRect(16, 16, 230, 132); c.fillStyle = '#fff'; c.font = '700 18px Oswald, Inter'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('MIDLOTHIAN, VA', 28, 24);
    c.font = '13px Inter'; const items = [['#ffd23f', 'Mission'], ['#c46bff', 'Waypoint / GPS'], ['#3cff6a', 'Health'], ['#3c9bff', 'Armor'], ['#ffa63c', 'Weapon']];
    items.forEach(([col, t], i) => { c.fillStyle = col; c.beginPath(); c.arc(34, 60 + i * 17, 5, 0, 7); c.fill(); c.fillStyle = '#ddd'; c.fillText(t, 46, 53 + i * 17); });
    c.fillStyle = '#fff8'; c.font = '11px Inter'; c.textAlign = 'right'; c.fillText('© OpenStreetMap contributors', W - 12, H - 40);
    void cumLen;
  }
}
