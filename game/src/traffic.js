import * as THREE from 'three';
import { Vehicle } from './entities/vehicle.js';
import { PAINTS } from './entities/carmodels.js';
import { along, shortestAngle, clamp } from './util.js';
import { SPEED } from './mapdata.js';

const TYPES = ['sedan', 'sedan', 'sedan', 'suv', 'suv', 'hatch', 'pickup'];

/** Kinematic lane-following traffic on the drive graph. */
export class Traffic {
  constructor(game) {
    this.game = game; this.list = []; this.spawnT = 0;
    const g = game.map.graph;
    this.edges = g.edges.filter(e => e.traffic && e.len > 15);
    // precompute stop-sign positions on edges (stop near edge end)
    for (const e of g.edges) {
      e.stopAt = null;
      for (const st of game.data.stops || []) {
        const end = e.pts[e.pts.length - 1];
        if (Math.hypot(end[0] - st[0], end[1] - st[1]) < 22) {
          let bs = null, bd = 6;
          for (let i = 0; i < e.pts.length; i++) { const d = Math.hypot(e.pts[i][0] - st[0], e.pts[i][1] - st[1]); if (d < bd) { bd = d; bs = e.D[i]; } }
          if (bs !== null && bs > e.len - 25) e.stopAt = Math.max(0, bs - 2);
        }
      }
    }
  }
  spawn(px, pz) {
    const cam = this.game.camera, fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const cand = this.edges.filter(e => e.pts.some((p, i) => i % 3 === 0 && Math.abs(p[0] - px) < 280 && Math.abs(p[1] - pz) < 280));
    if (!cand.length) return null;
    for (let tries = 0; tries < 20; tries++) {
      const e = cand[Math.floor(Math.random() * cand.length)], s = Math.random() * e.len;
      const p = along(e.pts, e.D, s), d = Math.hypot(p.x - px, p.z - pz);
      if (d < 70 || d > 280) continue;
      const vis = ((p.x - cam.position.x) * fwd.x + (p.z - cam.position.z) * fwd.z) / d;
      if (vis > 0.5 && d < 160) continue;
      if (this.list.some(c => c.ai && c.ai.edge === e && Math.abs(c.ai.s - s) < 14)) continue;
      const v = new Vehicle(this.game, TYPES[Math.floor(Math.random() * TYPES.length)], PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      v.mode = 'kinematic'; v.driver = 'npc';
      v.ai = { edge: e, s, lane: e.laneOffsets[Math.floor(Math.random() * e.laneOffsets.length)], v: SPEED[e.road.type] * 0.6, aggro: 0.85 + Math.random() * 0.3, wait: 0, stopped: null, panic: 0, crashT: 0, honkT: 0 };
      this.place(v, true);
      this.list.push(v); this.game.vehicles.push(v); return v;
    }
    return null;
  }
  place(v, snap = false) {
    const a = v.ai, p = along(a.edge.pts, a.edge.D, a.s);
    const tx = p.x - p.dz * a.lane, tz = p.z + p.dx * a.lane, th = Math.atan2(p.dx, p.dz);
    if (snap) { v.pos.set(tx, 0, tz); v.heading = th; }
    return { tx, tz, th, dx: p.dx, dz: p.dz };
  }
  release(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); v.ai = null; v.mode = 'physics'; }
  /** Called on collision/gunfire: car stops (crashed) or flees. */
  disturb(v, kind) {
    if (!v.ai) return;
    if (kind === 'crash') { v.mode = 'physics'; v.ai.crashT = 4 + Math.random() * 3; v.ai.honkT = 0.2; }
    if (kind === 'gunfire') v.ai.panic = 12;
  }
  update(dt) {
    const g = this.game, pp = g.focus, want = Math.round((g.sky.night > 0.5 ? 10 : 18) * (g.settings.density ?? 1));
    this.spawnT -= dt;
    if (this.list.length < want && this.spawnT <= 0) { this.spawnT = 0.3; this.spawn(pp.x, pp.z); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i], a = v.ai;
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (d > 340 || v.dead) { if (!v.dead || d > 200) { this.list.splice(i, 1); g.removeVehicle(v); } continue; }
      if (a.crashT > 0) {   // physics until it settles, then try to rejoin the lane
        a.crashT -= dt; v.update(dt, { throttle: 0, steer: 0, brake: true });
        if ((a.honkT -= dt) <= 0 && d < 60) { a.honkT = 1.5 + Math.random() * 2; g.audio.horn(); }
        if (a.crashT <= 0) {
          const ld = this.place(v); if (Math.hypot(ld.tx - v.pos.x, ld.tz - v.pos.z) < 3 && !v.dead) { v.mode = 'kinematic'; a.v = 0; } else { this.release(v); v.abandoned = true; }
        }
        continue;
      }
      this.drive(v, a, dt);
    }
  }
  drive(v, a, dt) {
    const g = this.game, e = a.edge;
    let target = SPEED[e.road.type] * a.aggro * (a.panic > 0 ? 1.5 : 1);
    a.panic = Math.max(0, a.panic - dt);
    const ld = this.place(v), fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // curvature ahead
    const ahead = this.lookAhead(a, 14 + a.v);
    if (ahead) { const turn = Math.abs(shortestAngle(Math.atan2(ahead.dx, ahead.dz) - ld.th)); if (turn > 0.35) target = Math.min(target, 4 + 18 * (1 - Math.min(1, turn / 1.6))); }
    // obstacles in front
    const blocker = this.blockDist(v, fx, fz);
    if (blocker < 30) target = Math.min(target, Math.max(0, (blocker - 5.5) * 0.9));
    if (blocker < 6 && (a.honkT -= dt) <= 0) { a.honkT = 3 + Math.random() * 4; if (Math.hypot(v.pos.x - g.focus.x, v.pos.z - g.focus.z) < 50) g.audio.horn(); }
    // signals
    if (a.panic <= 0) {
      const sig = g.world.signals.ahead(v.pos.x, v.pos.z, fx, fz);
      if (sig && sig.state !== 'g' && sig.dist > 1.5 && !(sig.state === 'y' && sig.dist < 9)) target = Math.min(target, Math.max(0, (sig.dist - 2.5) * 0.7));
      if (e.stopAt !== null && a.stopped !== e) {
        const ds = e.stopAt - a.s;
        if (ds > -1 && ds < 25) { target = Math.min(target, Math.max(0, ds * 0.6)); if (ds < 1.5 && a.v < 0.5) { a.wait += dt; if (a.wait > 1.2) { a.stopped = e; a.wait = 0; } } }
      }
    }
    const acc = target > a.v ? 3.2 : -8;
    a.v = clamp(a.v + acc * dt, Math.min(a.v, target), Math.max(a.v, target));
    if (target < a.v) a.v = Math.max(target, a.v - 8 * dt);
    a.s += a.v * dt;
    while (a.s > a.edge.len) {
      const next = this.nextEdge(a.edge);
      if (!next) { a.s = a.edge.len; a.v = 0; break; }
      a.s -= a.edge.len; a.edge = next; a.nextHint = null; a.lane = next.laneOffsets[Math.min(next.laneOffsets.length - 1, Math.floor(Math.random() * next.laneOffsets.length))]; a.stopped = null;
    }
    const t = this.place(v), k = 1 - Math.exp(-9 * dt), ox = v.pos.x, oz = v.pos.z;
    v.pos.x += (t.tx - v.pos.x) * k; v.pos.z += (t.tz - v.pos.z) * k;
    v.heading += shortestAngle(t.th - v.heading) * (1 - Math.exp(-7 * dt));
    v.vx = (v.pos.x - ox) / dt; v.vz = (v.pos.z - oz) / dt;
    v.braking = acc < 0 && a.v > 0.5;
    v.update(dt, null);
  }
  lookAhead(a, dist) {
    let s = a.s + dist, e = a.edge;
    if (s <= e.len) return along(e.pts, e.D, s);
    const n = a.nextHint || (a.nextHint = this.nextEdge(e));
    return n ? along(n.pts, n.D, Math.min(n.len, s - e.len)) : null;
  }
  nextEdge(e) {
    const outs = (this.game.map.graph.out.get(e.to) || []).filter(o => o.traffic && !(o.road === e.road && o.to === e.from && o.rev !== e.rev));
    if (!outs.length) return (this.game.map.graph.out.get(e.to) || []).find(o => o.traffic) || null;
    // prefer going roughly straight
    const end = e.pts[e.pts.length - 1], prev = e.pts[Math.max(0, e.pts.length - 2)], h0 = Math.atan2(end[0] - prev[0], end[1] - prev[1]);
    const w = outs.map(o => { const p = o.pts[Math.min(1, o.pts.length - 1)], h = Math.atan2(p[0] - end[0], p[1] - end[1]); return 1 + 2 * Math.max(0, Math.cos(shortestAngle(h - h0))); });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) return outs[i]; }
    return outs[0];
  }
  /** Distance to the nearest thing in our lane ahead (vehicles, player, peds). */
  blockDist(v, fx, fz) {
    const g = this.game; let best = 99;
    const test = (x, z, rad) => {
      const rx = x - v.pos.x, rz = z - v.pos.z, al = rx * fx + rz * fz; if (al < 0 || al > 30) return;
      const lat = Math.abs(rx * fz - rz * fx); if (lat < 1.25 + rad) best = Math.min(best, al - rad);
    };
    for (const o of g.vehicles) if (o !== v) test(o.pos.x, o.pos.z, 1.0);
    if (!g.player.vehicle) test(g.player.pos.x, g.player.pos.z, 0.5);
    for (const p of g.peds.list) if (p.alive) test(p.pos.x, p.pos.z, 0.4);
    return best;
  }
}
