// Route-following AI driver for mission vehicles (chase targets, escorts, tailed vehicles, race opponents).
// Follows a polyline with pure pursuit, slows for corners, recovers when stuck.
import { along, cumLen, shortestAngle, clamp } from '../util.js';

export class AIDriver {
  constructor(game, vehicle, opts = {}) {
    this.g = game; this.v = vehicle; this.speed = opts.speed || 18; this.s = 0; this.route = null; this.D = null; this.stuck = 0; this.reverse = 0; this.done = false; this.lastS = 0; this.noProg = 0;
    if (!opts.bot) { vehicle.driver = 'npc'; vehicle.mode = 'physics'; vehicle.mission = true; }
  }
  setRoute(pts) { this.route = pts; this.D = cumLen(pts); this.s = 0; this.lastS = 0; this.noProg = 0; this.done = false; }
  routeTo(x, z) { const r = this.g.map.route(this.v.pos.x, this.v.pos.z, x, z); if (r) this.setRoute(r); return !!r; }
  /** Route through a list of waypoints ({x,z}) in order. */
  routeVia(pts) {
    let at = this.v.pos, all = [];
    for (const p of pts) { const r = this.g.map.route(at.x, at.z, p.x, p.z); if (!r) continue; all = all.concat(all.length ? r.slice(1) : r); at = { x: r.at(-1)[0], z: r.at(-1)[1] }; }
    if (all.length > 1) this.setRoute(all); return all.length > 1;
  }
  get length() { return this.D ? this.D.at(-1) : 0; }
  get remaining() { return this.D ? this.D.at(-1) - this.s : 0; }
  /** throttleScale lets callers slow down (escorts waiting for the player, tails matching speed). */
  update(dt, throttleScale = 1) { this.v.update(dt, this.controls(dt, throttleScale)); }
  /** Controls for this frame: { throttle -1..1, steer -1..1 }. */
  controls(dt, throttleScale = 1) {
    const v = this.v; if (!this.route || v.dead) return { throttle: 0, steer: 0, brake: true };
    // progress = closest point on the route ahead of the last one
    let bs = this.s, bd = 1e9;
    for (let s = this.s; s < Math.min(this.D.at(-1), this.s + 50); s += 2) { const p = along(this.route, this.D, s), d = Math.hypot(p.x - v.pos.x, p.z - v.pos.z); if (d < bd) { bd = d; bs = s; } }
    this.s = bs;
    if (this.remaining < 6) { this.done = true; return { throttle: v.forwardSpeed > 1 ? -1 : 0, steer: 0 }; }
    const look = along(this.route, this.D, this.s + 7 + v.speed * 0.55), ahead = along(this.route, this.D, this.s + 22 + v.speed);
    const want = Math.atan2(look.x - v.pos.x, look.z - v.pos.z), err = shortestAngle(want - v.heading);
    const turn = Math.abs(shortestAngle(Math.atan2(ahead.dx, ahead.dz) - Math.atan2(look.dx, look.dz)));
    const target = this.speed * throttleScale * (turn > 0.5 ? clamp(1.2 - turn * 0.6, 0.35, 1) : 1);
    let throttle = v.forwardSpeed < target ? 1 : v.forwardSpeed > target + 3 ? -0.6 : 0.15, steer = clamp(err * 2.2, -1, 1);
    if (v.speed < 1 && throttle > 0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.6) { this.reverse = 1.2; this.stuck = 0; }
    if (this.reverse > 0) { this.reverse -= dt; throttle = -1; steer = -steer; }
    if (v.flipped) v.recover();
    // last resort for deadlocks (wedged on a kerb corner, boxed in by traffic): hop a few metres along the route
    if (throttleScale > 0 && this.s > this.lastS + 1) { this.lastS = this.s; this.noProg = 0; } else if (throttleScale > 0) this.noProg += dt;
    if (this.noProg > 10) { const q = along(this.route, this.D, Math.min(this.D.at(-1), this.s + 10)); v.setPose(q.x, q.z, Math.atan2(q.dx, q.dz)); this.s += 10; this.lastS = this.s; this.noProg = 0; this.g.aiHops = (this.g.aiHops || 0) + 1; }
    return { throttle, steer };
  }
}
