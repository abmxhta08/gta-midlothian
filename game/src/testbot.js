// Test bot (only loaded with ?test=1). Plays missions with the real input path: steering/throttle keys while
// driving along the GPS route, camera + W while walking, aiming + firing at hostiles. When it gets stuck it
// teleports a short way (or applies an "assist") and logs it, so the test report can list those as bugs.
import * as THREE from 'three';
import { along, cumLen, shortestAngle } from './util.js';

const V3 = THREE.Vector3;
export class TestBot {
  constructor(game) { this.g = game; this.dt = 1 / 30; this.log = { teleports: [], assists: [], fails: [] }; this.route = null; this.prog = { d: 1e9, t: 0 }; this.choices = 0; }
  note(kind, msg) { const g = this.g, e = { t: +g.time.toFixed(1), mission: g.missions.active?.def.id, step: g.missions.active?.steps[g.missions.active.i]?.type, msg }; this.log[kind].push(e); }
  get P() { return this.g.player; }
  get M() { return this.g.missions; }
  /** One simulated frame. */
  tick(dt = 1 / 30) {
    this.dt = dt; const g = this.g, inp = g.input; inp.sim.clear(); inp.simFire = false; inp.simAim = false;
    try { this.think(dt); } catch (e) { this.note('assists', 'bot error: ' + e.message); }
    g.update(dt); inp.endFrame();
  }
  think(dt) {
    const g = this.g, M = this.M, run = M.active;
    if (g.menu.open) { // mission choices: alternate options so both approaches get exercised across runs
      const i = g.menu.items.findIndex(x => /Retry/.test(x.label)); g.menu.choose(i >= 0 ? i : (this.choices++ % Math.max(1, g.menu.items.length))); return;
    }
    if (!run || g.state !== 'play' || M.failMenu) return;
    const s = run.steps[run.i]; if (!s) return;
    if (this.P.vehicle && this.P.vehicle.burn > 0) { if (this.P.vehicle.speed > 3) return this.brake(); g.input.simPressed.add('KeyF'); return; }   // bail out before it blows
    const key = run.def.id + ':' + run.i + ':' + run.t.toFixed(0).length;
    if (this.stepObj !== s) { this.stepObj = s; this.prog = { d: 1e9, t: 0 }; this.route = null; this.escape = null; this.fleeStart = null; this.chaseT = 0; this.thrown = false; this.hist = []; this.td = null; this.waitT = 0; this.sneakT = 0; }
    void key;
    const P = this.P;
    switch (s.type) {
      case 'dialogue': return;
      case 'goto': return s.inVehicle || (this.dist(s.pos) > 70 && !s.onFoot) ? this.driveTo(s.pos, 18, (s.radius || 5) * 0.6) : this.walkTo(s.pos, (s.radius || 5) * 0.6);
      case 'enter': { const v = s.vehicle && run.vars[s.vehicle]; if (v) return this.board(v); return this.getVehicle(); }
      case 'deliver': { const v = s.vehicle && run.vars[s.vehicle]; if (v && P.vehicle !== v) return this.board(v); return this.driveTo(s.pos, 16, 3); }
      case 'chase': return this.ram(s.v, s.d);
      case 'tail': return this.follow(s.v, 40, s.d);
      case 'escort': return this.follow(s.v, 22, s.d);
      case 'defend': case 'clear': {
        if (P.vehicle) { if (this.dist(s.pos) > 40) return this.driveTo(s.pos, 16, 20); if (P.vehicle.speed > 3) return this.brake(); g.input.simPressed.add('KeyF'); return; }
        if (this.fight(45)) return;
        // nobody in sight: go to the nearest remaining attacker (staying inside a defend radius), else hold the centre
        let t = null, bd = 1e9; for (const q of s.goons) if (q.alive && q.state !== 'knocked') { const d = q.pos.distanceTo(P.pos); if (d < bd) { bd = d; t = q; } }
        if (t && (s.type === 'clear' || t.pos.distanceTo(s.pos) < (s.radius || 60) - 5)) return this.walkTo(t.pos, 4);
        if (this.dist(s.pos) > 12) this.walkTo(s.pos, 8); return;
      }
      case 'collect': { const it = s.items.find(i => !i.got); if (!it) return; if (P.vehicle && this.dist(it.pos) < 30) { if (P.vehicle.speed > 2) return this.brake(); g.input.simPressed.add('KeyF'); return; } if (this.dist(it.pos) > 60) return this.driveTo(it.pos, 16, 8); if (this.fight(30)) return; this.walkTo(it.pos, 0.6); if (s.interact && this.dist(it.pos) < 1.8) g.input.simPressed.add('KeyE'); return; }
      case 'stealth': return this.sneak(s);
      case 'getaway': return this.flee();
      case 'race': return this.raceDrive(s);
      case 'knockout': return this.subdue(s.t);
      case 'dropoff': { const t = run.vars[s.var || 'target']; if (!t.inVehicle) { if (!P.vehicle) return this.getVehicle(); return this.driveTo(t.pos, 10, 3); } return this.driveTo(s.pos, 15, 3); }
      case 'taxi': if (!P.vehicle) return this.getVehicle(); if (s.stage === 1) return this.driveTo(s.ped.pos, 14, 3); if (s.stage === 2) return this.driveTo(s.destPos, 16, 4); return;
      default: return;
    }
  }
  dist(p) { const a = this.P.vehicle ? this.P.vehicle.pos : this.P.pos; return Math.hypot(p.x - a.x, p.z - a.z); }
  /** Teleport a short way toward a target if no progress has been made for a while (logged). */
  unstick(target, label) {
    const d = this.dist(target), P = this.P, here = (P.vehicle ? P.vehicle.pos : P.pos);
    // walking: stuck = no progress toward the target; driving: stuck = barely moving (roads wind away from targets)
    if (!this.prog.at) this.prog.at = here.clone();
    const moved = here.distanceTo(this.prog.at);
    if (label === 'drive' ? moved > 8 : d < this.prog.d - 2) { this.prog = { d, t: 0, at: here.clone() }; return false; }
    this.prog.t += this.dt;
    if (this.prog.t < (label === 'drive' ? 7 : 9)) return false;
    const a = here, k = Math.min(1, 25 / d), x = a.x + (target.x - a.x) * k, z = a.z + (target.z - a.z) * k;
    let sp = this.g.peds.nearestSidewalk(x, z, 40) || { x, z };
    if (P.vehicle) { const n = this.g.map.nearestRoad(x, z, 40); if (n) sp = { x: n.px, z: n.pz }; P.vehicle.setPose(sp.x, sp.z, Math.atan2(target.x - sp.x, target.z - sp.z)); } else P.setPos(sp.x, sp.z);
    this.note('teleports', `${label}: stuck ${d.toFixed(0)} m from target at (${a.x.toFixed(0)}, ${a.z.toFixed(0)})`);
    this.prog = { d: 1e9, t: 0 }; this.route = null; return true;
  }
  face(p) { const P = this.P, a = P.pos; this.g.cam.yaw = Math.atan2(p.x - a.x, p.z - a.z); }
  walkTo(p, r = 1) {
    const P = this.P; if (P.vehicle) { if (P.vehicle.speed > 2) return this.brake(); this.g.input.simPressed.add('KeyF'); return; }
    if (this.dist(p) < r) return;
    this.unstick(p, 'walk');
    // steer around walls: probe the straight line, then fan out to the side we last chose until a gap opens
    const g = this.g, a0 = Math.atan2(p.x - P.pos.x, p.z - P.pos.z), ray = (a, d) => g.world.grid.ray(P.pos.x, P.pos.z, Math.sin(a), Math.cos(a), d) === Infinity;
    let yaw = a0;
    if (this.detour && this.detour.until > g.time && !ray(a0, Math.min(4, this.dist(p)))) yaw = this.detour.yaw;
    else if (!ray(a0, Math.min(2.5, this.dist(p)))) {
      this.side = this.side || 1;
      for (let k = 1; k <= 8; k++) { const b = a0 + this.side * k * 0.35; if (ray(b, 3)) { yaw = b; break; } const c = a0 - this.side * k * 0.35; if (ray(c, 3)) { yaw = c; this.side = -this.side; break; } }
      this.detour = { yaw, until: g.time + 1.2 };
    }
    g.cam.yaw = yaw; g.input.sim.add('KeyW'); if (this.dist(p) > 15 && P.stamina > 30) this.g.input.sim.add('ShiftLeft');
    // hop over low things
    if (P.speed < 0.6 && Math.random() < 0.1) this.g.input.simPressed.add('Space');
  }
  getVehicle() {
    const g = this.g, P = this.P; if (P.vehicle) return;
    let best = null, bd = 90;
    for (const v of g.vehicles) { if (v.dead || v.flipped || v.police || v.bike) continue; const d = v.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = v; } }
    for (const pc of g.world.parked) { if (!pc.active) continue; const d = Math.hypot(pc.x - P.pos.x, pc.z - P.pos.z); if (d < bd) { bd = d; best = pc; } }
    if (!best) { const v = g.spawnVehicle('sedan', P.pos.x + 4, P.pos.z, 0); this.note('assists', 'no vehicle within 90 m, spawned one'); best = v; }
    const p = best.pos || new V3(best.x, 0, best.z);
    if (P.pos.distanceTo(p) < 3.2) { g.input.simPressed.add('KeyF'); return; }
    this.walkTo(p, 2.5);
  }
  board(v) {
    const P = this.P; if (P.vehicle === v) return;
    if (P.vehicle) { if (this.dist(v.pos) > 25) return this.driveTo(v.pos, 15, 12); if (P.vehicle.speed > 2) return this.brake(); this.g.input.simPressed.add('KeyF'); return; }
    if (v.pos.distanceTo(P.pos) < 3.2) { this.g.input.simPressed.add('KeyF'); return; }
    if (this.dist(v.pos) > 120) return this.getVehicle();
    this.walkTo(v.pos, 2.5);
  }
  brake() { this.g.input.sim.add('Space'); }
  /** Steer along the A* route toward p with keyboard input. */
  driveTo(p, speed = 16, stop = 3, any = false) {
    const g = this.g, P = this.P; if (!P.vehicle) return any ? this.walkTo(p, 2.5) : this.getVehicle();
    const v = P.vehicle;
    if (this.dist(p) < stop) return v.speed > 1 ? this.brake() : undefined;
    // re-plan only when the goal moves or the car has left the planned route (re-planning on a timer made the bot circle blocks)
    const moved = this.routeGoal && this.routeGoal.distanceTo(p) > Math.max(15, this.dist(p) * 0.25) && g.time - (this.planT || 0) > 1.5;
    if (!this.route || !this.routeGoal || moved || this.offRoute > 2) {
      this.routeGoal = p.clone(); this.planT = g.time;
      // moving: plan from a point ahead so the new route doesn't start with a U-turn back to the last junction
      const ah = v.forwardSpeed > 6 ? Math.min(40, v.forwardSpeed * 1.2) : 0, sx = v.pos.x + Math.sin(v.heading) * ah, sz = v.pos.z + Math.cos(v.heading) * ah;
      let r = ah && g.map.route(sx, sz, p.x, p.z); if (r) r = [[v.pos.x, v.pos.z], ...r]; else r = g.map.route(v.pos.x, v.pos.z, p.x, p.z) || [[v.pos.x, v.pos.z], [p.x, p.z]]; this.route = r; this.D = cumLen(r); this.s = 0; this.offRoute = 0;
    }
    if (this.unstick(p, 'drive')) return;
    let bs = this.s, bd = 1e9; for (let s = this.s; s < Math.min(this.D.at(-1), this.s + 50); s += 2) { const q = along(this.route, this.D, s), d = Math.hypot(q.x - v.pos.x, q.z - v.pos.z); if (d < bd) { bd = d; bs = s; } } this.s = bs;
    this.offRoute = bd > 20 ? (this.offRoute || 0) + this.dt : 0;
    const left = this.D.at(-1) - this.s, la = left < 12 ? { x: p.x, z: p.z } : along(this.route, this.D, this.s + 7 + v.speed * 0.5);
    // slow down before corners (look further ahead the faster we go)
    let turn = 0; for (let k = 8; k <= 16 + v.speed * 1.6; k += 6) { const q = along(this.route, this.D, this.s + k); turn = Math.max(turn, Math.abs(shortestAngle(Math.atan2(q.dx, q.dz) - v.heading))); }
    const corner = turn > 0.35 ? Math.max(6, speed * (1.25 - turn * 0.75)) : speed;
    this.steerAt(la, Math.min(speed, corner, 4 + left * 0.5));
  }
  steerAt(t, speed) {
    const v = this.P.vehicle, inp = this.g.input, want = Math.atan2(t.x - v.pos.x, t.z - v.pos.z), err = shortestAngle(want - v.heading);
    if (err > 0.06) inp.sim.add('KeyA'); else if (err < -0.06) inp.sim.add('KeyD');
    const sp = v.forwardSpeed, slow = Math.abs(err) > 0.7 ? 0.45 : 1;
    if (sp < speed * slow) inp.sim.add('KeyW'); else if (sp > speed * slow + 4) inp.sim.add('KeyS');
    if (v.flipped) inp.simPressed.add('KeyR');
    // never drive into a pond (it floods the engine): brake, then back out
    const ahead = 3 + Math.max(0, sp) * 0.6, wx = v.pos.x + Math.sin(v.heading) * ahead, wz = v.pos.z + Math.cos(v.heading) * ahead;
    if (this.g.map.inWater(wx, wz) || this.g.map.inWater(v.pos.x, v.pos.z)) { inp.sim.delete('KeyW'); inp.sim.add(sp > 1 ? 'Space' : 'KeyS'); this.route = null; return; }
    if (sp < 0.5 && (this.revT = (this.revT || 0) + this.dt) > 2) { inp.sim.delete('KeyW'); inp.sim.add('KeyS'); inp.sim.delete('KeyA'); inp.sim.delete('KeyD'); if (err > 0) inp.sim.add('KeyD'); else inp.sim.add('KeyA'); if (this.revT > 3.2) this.revT = 0; }
    else if (sp > 1) this.revT = 0;
  }
  ram(target, drv) {
    const P = this.P; if (!P.vehicle) return this.getVehicle();
    const d = this.dist(target.pos);
    // too far behind for too long: hop onto its route a little behind it (logged as a teleport = the bot can't keep up)
    this.farT = d > 120 ? (this.farT || 0) + this.dt : 0;
    if (this.farT > 20 && drv?.route) {
      const q = along(drv.route, drv.D, Math.max(0, drv.s - 35)); P.vehicle.setPose(q.x, q.z, Math.atan2(q.dx, q.dz)); P.vehicle.vx = Math.sin(P.vehicle.heading) * target.speed; P.vehicle.vz = Math.cos(P.vehicle.heading) * target.speed;
      this.note('teleports', `chase: ${d.toFixed(0)} m behind for 20 s, placed 35 m behind the target`); this.farT = 0; this.route = null; return;
    }
    if (d > 70 || !drv?.route) { if (d > 50) return this.driveTo(target.pos, 30, 0); this.steerAt(target.pos, 34); }
    else if (d > 14) this.follow(target, -10, drv, target.speed + 12);   // run it down along its own route
    else this.steerAt({ x: target.pos.x + target.vx * 0.35, z: target.pos.z + target.vz * 0.35 }, 40);
    if ((this.chaseT = (this.chaseT || 0) + this.dt) > 45) { target.damage(target.maxHealth * 0.3); this.chaseT = 15; this.note('assists', 'chase: could not ram target for 45 s, applied damage'); }
  }
  /** Follow a mission vehicle at a gap. If it drives an AIDriver route, follow the same route (no overtaking). */
  follow(target, gap, drv, maxSpeed = 99) {
    const P = this.P; if (!P.vehicle) return this.getVehicle();
    const d = this.dist(target.pos), v = P.vehicle;
    if (!drv?.route || d > gap + 60) { if (d > gap + 30) return this.driveTo(target.pos, 22, gap); this.steerAt(target.pos, Math.max(4, target.speed + (d - gap) * 0.25)); return; }
    if (this.route !== drv.route) { this.route = drv.route; this.D = drv.D; this.s = Math.max(0, drv.s - d - 20); this.routeGoal = null; }
    let bs = this.s, bd = 1e9; for (let s = this.s; s < Math.min(this.D.at(-1), this.s + 50); s += 2) { const q = along(this.route, this.D, s), dd = Math.hypot(q.x - v.pos.x, q.z - v.pos.z); if (dd < bd) { bd = dd; bs = s; } } this.s = bs;
    if (bd > 15) { this.route = null; return this.driveTo(target.pos, Math.min(maxSpeed, 26), Math.max(0, gap)); }   // not on its road: path there first
    const gapS = drv.s - this.s, la = along(this.route, this.D, Math.min(drv.s - 4, this.s + 7 + v.speed * 0.5));
    if (target.speed > 2 && gapS > gap) this.unstick(target.pos, 'drive'); else this.prog = { d: 1e9, t: 0 };
    if (gap > 0 && gapS < gap * 0.6) return this.brake();
    this.steerAt(la, Math.min(maxSpeed, Math.max(0, target.speed + (gapS - gap) * 0.3)));
  }

  /** Aim at the nearest hostile in range and shoot. Returns true if a target was engaged. */
  fight(range) {
    const g = this.g, P = this.P; if (P.vehicle) return false;
    if (!P.inv.rifle) P.give('rifle', 240);
    if (P.current !== 'rifle') P.equip('rifle');
    let best = null, bd = range;
    this.ignore = this.ignore || new Map();
    for (const q of g.peds.list) { if (!q.hostile || !q.alive || q.state === 'knocked' || q.subdued || (this.ignore.get(q) || 0) > g.time) continue; const d = q.pos.distanceTo(P.pos); if (d < bd && g.police.los(P.pos, q.pos)) { bd = d; best = q; } }
    if (!best) return false;
    // aim like a player moving the mouse: correct the *camera ray* (shots go along it, not from the player)
    const cam = g.camera.position, d = this.tmpDir || (this.tmpDir = new V3()); g.camera.getWorldDirection(d);
    const wx = best.pos.x - cam.x, wy = 1.15 - cam.y, wz = best.pos.z - cam.z, h = Math.hypot(wx, wz);
    const ey = shortestAngle(Math.atan2(wx, wz) - Math.atan2(d.x, d.z)), ep = -Math.atan2(wy, h) + Math.asin(Math.max(-1, Math.min(1, d.y)));
    g.cam.yaw += ey; g.cam.pitch += ep;
    g.input.simAim = true; g.input.simFire = Math.abs(ey) < 0.04 && Math.abs(ep) < 0.04;
    // shots not landing (camera ray blocked by a wall/prop, or target too close): reposition like a player would
    if (this.aimT !== best) { this.aimT = best; this.aimH = best.health; this.missT = 0; }
    if (best.health < this.aimH) { this.aimH = best.health; this.missT = 0; this.missAll = 0; } else if (g.input.simFire) { this.missT += this.dt; this.missAll = (this.missAll || 0) + this.dt; }
    if (this.missAll > 3.5) { this.ignore.set(best, g.time + 6); this.missAll = 0; this.aimT = null; return false; }   // can't hit it from here: go closer
    if (bd < 3.5) g.input.sim.add('KeyS');
    else if (this.missT > 1.2) { g.input.sim.add((this.strafe = this.missT > 1.25 ? this.strafe : !this.strafe) ? 'KeyD' : 'KeyA'); if (this.missT > 2.6) this.missT = 0; }
    if (P.inv.rifle.ammo === 0 && P.inv.rifle.reserve === 0) P.give('rifle', 120);
    if (P.health < 40) P.health = Math.min(100, P.health + 30);   // bots don't take cover well
    return true;
  }
  subdue(t) {
    const g = this.g, P = this.P;
    if (P.vehicle) { if (this.dist(t.pos) > 25) return this.driveTo(t.pos, 20, 12); if (P.vehicle.speed > 2) return this.brake(); g.input.simPressed.add('KeyF'); return; }
    const d = this.dist(t.pos);
    if (d < 9 && d > 3) { if (!P.inv.stun) P.give('stun', 3); P.equip('stun'); this.face(t.pos); g.cam.pitch = 0.05; g.input.simFire = !this.thrown; this.thrown = true; return; }
    this.thrown = false; this.walkTo(t.pos, 1);
    if (d > 60 && !P.vehicle) this.getVehicle();
  }
  sneak(s) {
    const g = this.g, P = this.P;
    if (P.vehicle) { if (P.vehicle.speed > 2) return this.brake(); g.input.simPressed.add('KeyF'); return; }
    const goal = s.goal === 'hold' ? s.spot : (s.items.find(i => !i.got) || {}).pos; if (!goal) return;
    if (!s.loud && P.current !== 'fists') P.equip('fists');
    this.sneakT = (this.sneakT || 0) + this.dt;
    if (this.sneakT > 90 && !s.loud && s.grace < 1e8) { s.grace = 1e9; this.note('assists', 'stealth: could not sneak past the guards in 90 s, detection disabled for the bot'); }
    if (s.loud || s.grace > 1e8) { if (s.loud && this.fight(35)) return; this.walkTo(goal, 0.8); if (this.dist(goal) < 2) g.input.sim.add('KeyE'); if (this.dist(goal) < 1.8) g.input.simPressed.add('KeyE'); return; }
    // danger(p, t): could a guard see point p t seconds from now? (guards walk ~1.2 m/s the way they face)
    const here0 = P.pos, behind = (q) => Math.abs(shortestAngle(Math.atan2(here0.x - q.pos.x, here0.z - q.pos.z) - q.yaw)) > 1.9;
    // stuck waiting: pick the guard nearest the goal and take them down from behind
    if (this.td && (!this.td.alive || this.td.state === 'out')) this.td = null;
    if (!this.td && (this.waitT || 0) > 4) { let bd = 1e9; for (const q of s.guards) if (q.alive && q.state !== 'out' && q.state !== 'knocked') { const d = q.pos.distanceTo(goal); if (d < bd) { bd = d; this.td = q; } } }
    const live = s.guards.filter(q => q.alive && q.state !== 'knocked' && q.state !== 'out' && !q.subdued && q !== this.td);
    // where a guard will be and which way it will face t seconds from now (patrol legs are observable, like a player watching)
    const future = (q, t) => {
      const gd = q.guard; if (!gd || t <= 0) return [{ x: q.pos.x, z: q.pos.z, yaw: q.yaw }];
      const tg = gd.toB ? gd.b : gd.a, dx = tg.x - q.pos.x, dz = tg.z - q.pos.z, L = Math.hypot(dx, dz) || 1, rem = Math.max(0, t - Math.max(0, gd.wait));
      const step = Math.min(L, rem * 1.2), out = [{ x: q.pos.x + dx / L * step, z: q.pos.z + dz / L * step, yaw: Math.atan2(dx, dz) }];
      if (gd.wait > 0 || L < rem * 1.2 + 1) { const nx = gd.toB ? gd.a : gd.b, ex = out[0].x, ez = out[0].z; out.push({ x: ex, z: ez, yaw: Math.atan2(nx.x - ex, nx.z - ez) }, { x: ex, z: ez, yaw: q.yaw }); }
      return out;
    };
    const sees = (q, p, t, prox = true) => future(q, t).some(f => {
      const d = Math.hypot(f.x - p.x, f.z - p.z); if (d < 4 && prox) return true; if (d > 19) return false;
      return Math.abs(shortestAngle(Math.atan2(p.x - f.x, p.z - f.z) - f.yaw)) < 0.8 && g.police.los(f, p);
    });
    // the takedown target only counts if it could actually see us (sneaking up behind it is the point)
    const danger = (p, t = 0) => live.some(q => sees(q, p, t)) || (this.td && sees(this.td, p, t, false));
    const risky = (p) => danger(p, 0) || danger(p, 1.5) || danger(p, 3);
    const here = P.pos;
    this.hist = this.hist || []; if (!this.histT || g.time - this.histT > 0.5) { this.histT = g.time; if (!risky(here)) { this.hist.push(here.clone()); if (this.hist.length > 40) this.hist.shift(); } }
    if (this.td) {
      const q = this.td, d = this.dist(q.pos);
      if (d < 1.8 && behind(q)) { g.input.simPressed.add('KeyE'); this.waitT = 0; return; }
      const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw), spot = { x: q.pos.x - fx * 1.1, z: q.pos.z - fz * 1.1 };
      const facingMe = d > 3 && [0, 1, 2].some(t => sees(q, here, t));
      const path = [1.5, 3].map(k => ({ x: here.x + (spot.x - here.x) / Math.max(d, 0.1) * Math.min(k, d), z: here.z + (spot.z - here.z) / Math.max(d, 0.1) * Math.min(k, d) }));
      if (!risky(here) && !facingMe && !path.some((p, n) => danger(p, n + 0.5))) { this.walkTo(new V3(spot.x, 0, spot.z), 0.3); if (d > 6) g.input.sim.add('ShiftLeft'); else g.input.sim.delete('ShiftLeft'); this.prog = { d: 1e9, t: 0 }; return; }
    }
    const atGoal = this.dist(goal) < (s.goal === 'hold' ? 1.2 : 0.8);
    if (!(atGoal && s.goal !== 'hold') && risky(here) && !(atGoal && s.meter < 0.4)) {
      // retreat to the most recent spot that stays hidden for the next few seconds
      for (let k = this.hist.length - 1; k >= 0; k--) { const h = this.hist[k]; if (h.distanceTo(here) > 2.5 && !risky(h)) { this.walkTo(h, 0.5); g.input.sim.add('ShiftLeft'); return; } }
      // nothing in the history is hidden any more: search a ring of nearby reachable spots
      for (const r of [4, 8, 12]) for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, p = { x: here.x + Math.sin(a) * r, z: here.z + Math.cos(a) * r };
        if (g.world.clear(p.x, p.z, 0.5) && g.police.los(here, p) && !risky(p)) { this.walkTo(new V3(p.x, 0, p.z), 0.5); g.input.sim.add('ShiftLeft'); this.prog = { d: 1e9, t: 0 }; return; }
      }
    }
    const dx = goal.x - here.x, dz = goal.z - here.z, L = Math.hypot(dx, dz) || 1;
    const blocked = !atGoal && [2.5, 5].some((k, n) => { const a = Math.min(k, L); return danger({ x: here.x + dx / L * a, z: here.z + dz / L * a }, n + 1); });
    if (blocked && (this.waitT = (this.waitT || 0) + this.dt) < 25) { this.prog = { d: 1e9, t: 0 }; return; }
    this.waitT = 0;
    if (!atGoal) { this.walkTo(goal, s.goal === 'hold' ? 1.2 : 0.8); g.input.sim.delete('ShiftLeft'); }
    if (s.goal === 'hold' && this.dist(goal) < 2) g.input.sim.add('KeyE'); else if (this.dist(goal) < 1.8) g.input.simPressed.add('KeyE');
  }
  flee() {
    const g = this.g, P = this.P; if (!P.vehicle) return this.getVehicle();
    if (!this.escape || this.dist(this.escape) < 40) { this.escape = this.M.randomLoc(P.vehicle.pos, 700, 1500, false); this.fleeStart = this.fleeStart || g.time; }
    this.driveTo(this.escape, 26, 0);
    if (g.time - (this.fleeStart || g.time) > 150) { g.police.unseen = 999; this.fleeStart = g.time; this.note('assists', 'getaway: still wanted after 150 s, forced the police to lose track'); }
  }
  raceDrive(s) { if (s.countdown > 0) return; this.driveTo(s.cps[s.i], 30, 0); }
}
