// Mission step types. Each type: { start(M, s, run), update(M, s, run, dt) -> true (done) | 'fail reason' | undefined }.
// M = MissionManager (helpers: loc, setDest, objective, say, spawnGoon, spawnCar, pp, gates...), s = step data,
// run = the active mission run (vars, timer, entities).
import * as THREE from 'three';
import { AIDriver } from './aidriver.js';
import { along, cumLen } from '../util.js';

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (p) => p && p.alive && p.state !== 'knocked' && p.state !== 'stunned' && p.state !== 'out' && !p.subdued;

export const STEPS = {
  /** Walk/drive to a spot. opts: radius, inVehicle (must arrive in a vehicle), onFoot. */
  goto: {
    start(M, s) { s.pos = M.loc(s.to); M.setDest(s.pos, s.radius); },
    update(M, s) {
      const P = M.g.player;
      if (s.inVehicle && !P.vehicle) return void M.objective('Get in a <em>vehicle</em>.');
      if (s.onFoot && P.vehicle) return void M.objective(`Get out of the vehicle at <em>${s.label || 'the marker'}</em>.`);
      M.objective(s.text);
      if (dist2(M.pp, s.pos) < (s.radius || 5) && (!P.vehicle || P.vehicle.speed < 6)) return true;
    },
  },
  /** Instant: spawn a vehicle (parked at the roadside near `at`) and store it in run.vars[var]. */
  spawnVehicle: {
    start(M, s, run) { const p = M.loc(s.at); run.vars[s.var] = M.spawnCar(s.vtype, p, s.color, s.offRoad); if (s.mark) M.setDest(run.vars[s.var].pos, 4); },
    update() { return true; },
  },
  /** Get into any vehicle, or the one in run.vars[vehicle]. */
  enter: {
    start(M, s, run) { const v = s.vehicle && run.vars[s.vehicle]; if (v) M.setDest(v.pos, 3, true); else M.clearDest(); },
    update(M, s, run) {
      const v = s.vehicle && run.vars[s.vehicle], P = M.g.player;
      if (v?.dead) return 'The vehicle was destroyed';
      if (v) M.setDest(v.pos, 3, true);
      M.objective(s.text || (v ? `Get in the <em>${v.h.label.toLowerCase()}</em>.` : 'Get in a <em>vehicle</em>.'));
      if (P.vehicle && (!v || P.vehicle === v)) return true;
    },
  },
  /** Bring a vehicle (run.vars[vehicle] or any) to a spot and stop. */
  deliver: {
    start(M, s) { s.pos = M.loc(s.to); M.setDest(s.pos, s.radius || 7); },
    update(M, s, run) {
      const v = s.vehicle ? run.vars[s.vehicle] : M.g.player.vehicle, P = M.g.player;
      if (s.vehicle && (!v || v.dead)) return 'The vehicle was destroyed';
      if (s.vehicle && P.vehicle !== v) { M.objective(`Get back in the <em>${v.h.label.toLowerCase()}</em>.`); M.setDest(v.pos, 3, true); s.left = true; return; }
      if (s.left) { s.left = false; M.setDest(s.pos, s.radius || 7); }
      if (!P.vehicle) return void M.objective('Get in a <em>vehicle</em>.');
      M.objective(s.text);
      if (s.minHealth && v.health < v.maxHealth * s.minHealth) return 'The vehicle is too damaged';
      if (dist2(P.vehicle.pos, s.pos) < (s.radius || 7) && P.vehicle.speed < 3) return true;
    },
  },
  /** Subtitled dialogue. wait=false lets the next step run while lines play. */
  dialogue: {
    start(M, s) { M.say(s.lines); },
    update(M, s) { return !s.wait ? true : !M.talking; },
  },
  /** Chase a fleeing vehicle until it is disabled (health below disableAt) or destroyed. */
  chase: {
    start(M, s, run) {
      const p = M.loc(s.from), v = M.spawnCar(s.vtype || 'sedan', p, s.color);
      v.health = v.maxHealth * (s.health || 1); const d = new AIDriver(M.g, v, { speed: s.speed || 22 });
      s.v = v; s.d = d; s.far = 0; run.vars[s.var || 'target'] = v; M.flee(d);
      if (s.driverPed !== false) v.hostileDriver = true;
    },
    update(M, s, run, dt) {
      const v = s.v, P = M.g.player;
      M.setDest(v.pos, 0, true); M.objective(s.text);
      if (v.dead || v.health < v.maxHealth * (s.disableAt ?? 0.4)) { v.update(dt, { throttle: 0, steer: 0, brake: true }); v.mission = true; v.driver = null; return true; }
      if (s.d.done) M.flee(s.d);
      // cruises until it notices you (close, or after a while), then floors it
      if (!s.alerted && (dist2(v.pos, M.pp) < 90 || (s.alertT = (s.alertT || 0) + dt) > 25)) { s.alerted = true; M.g.hud.toast('They\'ve spotted you!'); }
      s.d.update(dt, s.alerted ? 1 : 0.5);
      const dd = dist2(v.pos, M.pp); if (dd < 200) s.seen = true;
      s.far = s.seen && dd > 350 ? s.far + dt : 0;   // only counts once you've caught up with it
      if (s.far > 10) return 'The target escaped';
      if (!s.seen && (s.stepT = (s.stepT || 0) + dt) > 120) return 'The target escaped';
      void P;
    },
  },
  /** Follow a vehicle at a distance without getting too close or losing it. */
  tail: {
    start(M, s, run) {
      const p = M.loc(s.from), to = M.loc(s.to), v = M.spawnCar(s.vtype || 'van', p, s.color);
      const d = new AIDriver(M.g, v, { speed: s.speed || 12 }); d.routeVia([...(s.via || []).map(x => M.loc(x)), to]); s.v = v; s.d = d; s.close = 0; s.lost = 0; s.moving = false; run.vars[s.var || 'target'] = v;
    },
    update(M, s, run, dt) {
      const v = s.v, d = dist2(v.pos, M.pp), min = s.min || 14, max = s.max || 110;
      if (v.dead) return 'The target was destroyed';
      M.setDest(v.pos, 0, true);
      // the target only sets off once the player has caught up with it
      if (!s.moving) { if (d < max * 0.8) s.moving = true; else { M.objective(`${s.text} <em>Catch up to it.</em>`); s.d.update(dt, 0); return; } }
      M.objective(`${s.text} <em>${d < min + 6 ? 'Too close!' : d > max * 0.75 ? 'Falling behind!' : 'Good distance.'}</em>`);
      M.meter('tail', Math.min(1, s.close / 3), 'Suspicion');
      s.close = d < min ? s.close + dt : Math.max(0, s.close - dt * 0.5); s.lost = d > max ? s.lost + dt : 0;
      if (s.close > 3) return 'You were spotted';
      if (s.lost > 6) return 'You lost the target';
      s.d.update(dt);
      if (s.d.done && d <= max) return true;
    },
    end(M) { M.meter(null); },
  },
  /** Escort an ally vehicle to its destination; attackers try to wreck it. */
  escort: {
    start(M, s, run) {
      const p = M.loc(s.from), to = M.loc(s.to), v = M.spawnCar(s.vtype || 'pickup', p, s.color);
      v.health = v.maxHealth * 1.5; v.maxHealth *= 1.5;
      const d = new AIDriver(M.g, v, { speed: s.speed || 14 }); d.routeTo(to.x, to.z); s.v = v; s.d = d; s.attackers = []; s.spawnT = 12; s.sent = 0; run.vars[s.var || 'ally'] = v;
    },
    update(M, s, run, dt) {
      const v = s.v, P = M.g.player;
      if (v.dead || v.health < v.maxHealth * 0.1) return `${s.allyName || 'Your ally'} didn't make it`;
      M.setDest(v.pos, 0, true); M.objective(s.text); M.meter('ally', v.health / v.maxHealth, s.allyName || 'Ally');
      const far = dist2(v.pos, M.pp) > 70;
      s.d.update(dt, far ? 0 : 1);
      if (far && !P.vehicle) M.objective(`${s.text} <em>Stay close!</em>`);
      if ((s.spawnT -= dt) <= 0 && s.sent < (s.attackerCount ?? 3)) {
        s.spawnT = 18; s.sent++;
        const back = along(s.d.route, s.d.D, Math.max(0, s.d.s - 90)), a = M.spawnCar('suv', new THREE.Vector3(back.x, 0, back.z), 0x2a2a2a);
        a.goon = true; s.attackers.push(a); M.g.hud.toast('Graves crew incoming!');
      }
      for (const a of s.attackers) {
        if (a.dead || a.health < a.maxHealth * 0.35) { a.update(dt, { throttle: 0, steer: 0, brake: true }); continue; }
        const want = Math.atan2(v.pos.x - a.pos.x, v.pos.z - a.pos.z), err = ((want - a.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        a.update(dt, { throttle: 1, steer: Math.max(-1, Math.min(1, err * 2)) });
      }
      if (s.d.done) return true;
    },
    end(M) { M.meter(null); },
  },
  /** Survive waves of attackers around a location for `duration` seconds. */
  defend: {
    start(M, s, run) { s.ownTimer = true; s.pos = M.loc(s.at); s.t = s.duration || 60; s.wave = 0; s.nextWave = 0; s.goons = []; s.away = 0; M.setDest(s.pos, s.radius ? 0 : 0); run.timer = s.t; },
    update(M, s, run, dt) {
      s.t -= dt; run.timer = Math.max(0, s.t);
      if ((s.nextWave -= dt) <= 0 && s.wave < (s.waves || 3)) { s.wave++; s.nextWave = (s.duration || 60) / (s.waves || 3); for (let i = 0; i < (s.perWave || 4); i++) s.goons.push(M.spawnGoon(s.pos, 22, 40, s.armed !== false)); M.g.hud.toast(`Wave ${s.wave}`); }
      const left = s.goons.filter(alive).length;
      M.objective(`${s.text} <em>${left} attacker${left === 1 ? '' : 's'}</em>`);
      s.away = dist2(M.pp, s.pos) > (s.radius || 60) ? s.away + dt : 0;
      if (s.away > 6) return 'You left the area';
      if (s.t <= 0 && left === 0) { run.timer = null; return true; }
      if (s.t <= 0) M.objective(`${s.text} <em>Finish off ${left} attacker${left === 1 ? '' : 's'}</em>`);
    },
  },
  /** Take down every enemy at a location. */
  clear: {
    start(M, s) { s.pos = M.loc(s.at); s.goons = []; for (let i = 0; i < (s.count || 5); i++) s.goons.push(M.spawnGoon(s.pos, 4, 18, s.armed !== false, true)); M.setDest(s.pos, 0); },
    update(M, s) { const left = s.goons.filter(alive).length; M.objective(`${s.text} <em>${left} left</em>`); if (!left) return true; },
  },
  /** Pick up / photograph N items near a spot. interact=true needs E at each item. */
  collect: {
    start(M, s, run) { s.pos = M.loc(s.at); s.items = M.spawnItems(s.pos, s.count || 3, s.spread || 20, s.color); s.got = 0; M.setDest(s.pos, 0); run.vars.collected = 0; },
    update(M, s, run) {
      const P = M.g.player;
      for (const it of s.items) {
        if (it.got) continue;
        const near = dist2(M.pp, it.pos) < 1.8 && !P.vehicle;
        if (near && (!s.interact || M.g.input.pressed('interact'))) { it.got = true; it.mesh.visible = false; s.got++; run.vars.collected = s.got; M.g.audio.pickup(); }
      }
      const next = s.items.find(i => !i.got); if (next) M.setDest(next.pos, 0, true);
      M.wantsInteract = s.interact && s.items.some(i => !i.got && dist2(M.pp, i.pos) < 1.8);
      M.objective(`${s.text} <em>${s.got}/${s.items.length}</em>${M.wantsInteract ? ' · press <em>E</em>' : ''}`);
      if (s.got >= s.items.length) { M.wantsInteract = false; return true; }
    },
  },
  /** Sneak past patrolling guards (view cones). goal: 'collect' items or 'hold' E at a spot for `seconds`. */
  stealth: {
    start(M, s, run) {
      s.pos = M.loc(s.at); s.guards = []; s.meter = 0; s.loud = false; s.grace = 3;
      for (let i = 0; i < (s.guardCount || 4); i++) s.guards.push(M.spawnGuard(s.pos, s.radius || 26));
      if (s.goal === 'hold') { s.hold = 0; s.need = (s.seconds || 20) + (run.vars.hackBonus || 0) * -1; s.spot = M.itemSpot(s.pos, 8); s.marker = M.spawnItems(s.spot, 1, 0, 0x4ad6ff)[0]; }
      else { s.items = M.spawnItems(s.pos, s.count || 3, s.spread || 18, 0x4ad6ff); s.got = 0; }
      M.setDest(s.pos, 0);
    },
    update(M, s, run, dt) {
      const P = M.g.player, crouch = !!P.cover;
      // detection: view cone + line of sight, faster the closer you are (near guards notice almost at once)
      let seen = 0; s.grace -= dt;
      for (const g of s.guards) {
        if (!alive(g) || s.loud) continue;
        const d = dist2(g.pos, M.pp); if (d > 17) continue;
        const ang = Math.atan2(M.pp.x - g.pos.x, M.pp.z - g.pos.z), diff = Math.abs(((ang - g.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < 0.6 && M.g.police.los(g.pos, M.pp)) seen = Math.max(seen, 1.6 - d / 17 * 1.2);
        if (d < 2.5 && (diff < 1.9 || P.speed > 4)) seen = Math.max(seen, 2);   // right in front, or running up behind them
      }
      if (!s.loud) {
        s.meter = Math.max(0, Math.min(1, s.meter + (seen && s.grace <= 0 ? dt * seen * (crouch ? 0.5 : 1) : -dt * 0.35)));
        M.meter('stealth', s.meter, 'Detection');
        // takedown: E right behind an unaware guard knocks them out silently (shooting or stunning is loud)
        const tk = !P.vehicle && s.guards.find(g => alive(g) && dist2(g.pos, M.pp) < 1.9 && Math.abs(((Math.atan2(M.pp.x - g.pos.x, M.pp.z - g.pos.z) - g.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 1.9);
        s.canTakedown = !!tk;
        if (tk && M.g.input.pressed('interact')) { tk.takedown(); M.g.hud.toast('Guard taken down'); run.vars.takedowns = (run.vars.takedowns || 0) + 1; }
        if (s.meter >= 1 || s.guards.some(g => !g.alive || g.state === 'stunned' || g.state === 'knocked')) {
          if (s.failOnDetect) return 'You were spotted';
          s.loud = true; run.vars.loud = true; M.meter(null); M.g.hud.toast('Alarm! The guards are onto you');
          for (const g of s.guards) if (alive(g)) M.makeHostile(g);
        }
      }
      if (s.goal === 'hold') {
        const near = dist2(M.pp, s.spot) < 2.2 && !P.vehicle, holding = near && M.g.input.down('interact');
        if (holding) s.hold += dt;
        M.wantsInteract = near; M.setDest(s.spot, 0, true);
        M.objective(`${s.text} ${near ? `<em>Hold E: ${Math.floor(Math.min(100, s.hold / s.need * 100))}%</em>` : ''}${s.canTakedown ? ' · <em>E</em> take down' : ''}`);
        if (s.hold >= s.need) { s.marker.mesh.visible = false; M.wantsInteract = false; return true; }
      } else {
        for (const it of s.items) if (!it.got && dist2(M.pp, it.pos) < 1.8 && !P.vehicle && M.g.input.pressed('interact')) { it.got = true; it.mesh.visible = false; s.got++; M.g.audio.pickup(); }
        const next = s.items.find(i => !i.got); if (next) M.setDest(next.pos, 0, true);
        M.wantsInteract = s.items.some(i => !i.got && dist2(M.pp, i.pos) < 1.8);
        M.objective(`${s.text} <em>${s.got}/${s.items.length}</em>${s.canTakedown ? ' · <em>E</em> take down' : ''}`);
        if (s.got >= s.items.length) { M.wantsInteract = false; return true; }
      }
    },
    end(M) { M.meter(null); M.wantsInteract = false; },
  },
  /** Lose a wanted level of at least `stars`. */
  getaway: {
    start(M, s) { M.g.police.suppressed = false; if (s.stars) M.g.police.setWanted(Math.max(M.g.police.wanted, s.stars)); M.clearDest(); },
    update(M, s) { M.objective(s.text || '<em>Lose the cops.</em>'); if (M.g.police.wanted === 0) return true; },
  },
  /** Instant: set a wanted level. */
  wanted: { start(M, s) { M.g.police.suppressed = false; M.g.police.setWanted(s.stars); }, update() { return true; } },
  /** Checkpoint race, optionally against AI opponents. Finish place stored in run.vars.place. */
  race: {
    start(M, s, run) {
      const g = M.g, P = g.player, v = P.vehicle, from = v.pos;
      const to = M.randomLoc(from, s.min || 1100, s.max || 1800, false), r = g.map.route(from.x, from.z, to.x, to.z) || [[from.x, from.z], [to.x, to.z]];
      const D = cumLen(r), L = D.at(-1); s.cps = []; for (let d = 140; d < L; d += 140) { const p = along(r, D, d); s.cps.push(new THREE.Vector3(p.x, 0, p.z)); } const e = along(r, D, L); s.cps.push(new THREE.Vector3(e.x, 0, e.z));
      s.i = 0; s.route = r; s.D = D; run.timer = s.timeLimit ? s.timeLimit : null; s.ownTimer = !s.timeLimit; s.gates = M.gates(s.cps);
      s.ais = [];
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = -fz, rz = fx;
      for (let k = 0; k < (s.opponents || 0); k++) {
        const side = k % 2 ? 1 : -1, back = Math.floor(k / 2) * 7 + 3, p = new THREE.Vector3(from.x + rx * side * 3.2 - fx * back, 0, from.z + rz * side * 3.2 - fz * back);
        const o = M.spawnCar(k === 0 && s.rival ? 'muscle' : ['muscle', 'sedan', 'compact', 'suv'][k % 4], p, [0xd23a2a, 0x2a6ad2, 0xe0c020, 0x2ad26a][k % 4], true);
        o.heading = v.heading; o.sync(); const d = new AIDriver(g, o, { speed: (s.aiSpeed || 25) + (Math.random() - 0.5) * 4 }); d.setRoute(r); s.ais.push({ v: o, d });
      }
      s.countdown = s.opponents ? 3 : 0;
      M.say([['', s.opponents ? '3... 2... 1... GO!' : 'Go!']]);
    },
    update(M, s, run, dt) {
      const g = M.g, P = g.player;
      if (!P.vehicle) { s.out = (s.out || 0) + dt; M.objective('Get back in a <em>vehicle</em>!'); return s.out > 10 ? 'You left your vehicle' : undefined; } s.out = 0;
      if (s.countdown > 0) { s.countdown -= dt; P.vehicle.vx *= 0.8; P.vehicle.vz *= 0.8; M.objective(`<em>${Math.ceil(s.countdown)}</em>`); for (const a of s.ais) a.v.update(dt, { throttle: 0, steer: 0, brake: true }); return; }
      for (const a of s.ais) { a.d.update(dt); a.finished = a.finished || a.d.done; }
      if (dist2(P.vehicle.pos, s.cps[s.i]) < 9) { s.i++; g.audio.pickup(); if (s.i >= s.cps.length) { run.vars.place = 1 + s.ais.filter(a => a.finished).length; return true; } }
      // ranking: progress along the route
      const prog = (pos, hint) => { let best = hint, bd = 1e9; for (let d = Math.max(0, hint - 60); d < Math.min(s.D.at(-1), hint + 80); d += 4) { const p = along(s.route, s.D, d), dd = Math.hypot(p.x - pos.x, p.z - pos.z); if (dd < bd) { bd = dd; best = d; } } return best; };
      s.myS = prog(P.vehicle.pos, s.myS || 0);
      const place = 1 + s.ais.filter(a => a.finished || a.d.s > s.myS).length;
      M.setDest(s.cps[s.i], 0, true);
      for (let k = 0; k < s.gates.length; k++) s.gates[k].visible = k >= s.i && k < s.i + 3;
      M.objective(`${s.text} Checkpoint <em>${s.i + 1}/${s.cps.length}</em>${s.ais.length ? ` · Position <em>${place}/${s.ais.length + 1}</em>` : ''}`);
      if (s.ais.length && s.ais.every(a => a.finished) && s.needPlace === 1) { run.vars.place = s.ais.length + 1; return 'You lost the race'; }
    },
    end(M, s) { for (const gt of s.gates || []) { M.g.scene.remove(gt); gt.geometry.dispose(); } s.gates?.[0]?.material.dispose(); s.gates = []; },
  },
  /** Knock a target out (fists, bat or stun grenade) without killing them. */
  knockout: {
    start(M, s, run) {
      const p = M.loc(s.at), t = M.spawnPed(p, s.look || 'gang', { hostile: !!s.fights });
      t.nonLethal = true; t.health = s.health || 70; run.vars[s.var || 'target'] = t; s.t = t; s.far = 0;
      if (s.flees) t.flee(M.pp, 999);
    },
    update(M, s, run, dt) {
      const t = s.t; M.setDest(t.pos, 0, true);
      if (!t.alive) return 'The target was killed';
      if (t.subdued) return true;
      if (s.flees && t.state !== 'flee' && t.state !== 'knocked' && t.state !== 'stunned') t.flee(M.pp, 999);
      const d = dist2(t.pos, M.pp); if (d < 120) s.seen = true;
      s.far = s.seen && d > 220 ? s.far + dt : 0; if (s.far > 10) return 'The target got away';   // only once you've found them
      M.objective(s.text);
    },
  },
  /** Load a subdued target into your vehicle and drive them somewhere (e.g. the police station). */
  dropoff: {
    // you drive there: snap the drop point to the nearest road
    start(M, s) {
      s.pos = M.loc(s.to);
      const r = M.g.map.route(M.pp.x, M.pp.z, s.pos.x, s.pos.z);   // where the road network actually gets you
      if (r && Math.hypot(r.at(-1)[0] - s.pos.x, r.at(-1)[1] - s.pos.z) < 80) s.pos.set(r.at(-1)[0], 0, r.at(-1)[1]);
      else { const n = M.g.map.nearestRoad(s.pos.x, s.pos.z, 80, q => q.type !== 'service'); if (n) s.pos.set(n.px, 0, n.pz); }
    },
    update(M, s, run) {
      const t = run.vars[s.var || 'target'], P = M.g.player;
      if (!t || !t.alive) return 'The target was killed';
      if (!t.inVehicle) {
        M.setDest(t.pos, 0, true);
        if (!P.vehicle) return void M.objective('Get a <em>vehicle</em> for the target.');
        M.objective('Pull up next to the <em>target</em> to load them.');
        if (dist2(P.vehicle.pos, t.pos) < 7 && P.vehicle.speed < 2) { t.inVehicle = true; t.h.visible = false; t.carried = P.vehicle; M.g.audio.pickup(); M.setDest(s.pos, 8); }
        return;
      }
      if (P.vehicle !== t.carried) { t.inVehicle = false; t.h.visible = true; t.pos.copy(t.carried.pos).x += 2; return; }
      t.pos.copy(P.vehicle.pos); M.setDest(s.pos, 8); M.objective(s.text);
      if (dist2(P.vehicle.pos, s.pos) < (s.radius || 14) && P.vehicle.speed < 2) { t.remove = true; return true; }
    },
  },
  /** Menu choice stored in run.vars[var] (approach, crew members...). */
  choice: {
    start(M, s, run) {
      s.done = false;
      M.g.menu.show(s.title, s.options.map(o => ({ label: o.label, sub: o.sub, right: o.right, action: () => { run.vars[s.var] = o.value; if (o.cut) run.vars.cut = (run.vars.cut || 0) + o.cut; Object.assign(run.vars, o.set || {}); s.done = true; } })), { subtitle: s.subtitle, onClose: () => { if (!s.done) { const o = s.options[0]; run.vars[s.var] = o.value; if (o.cut) run.vars.cut = (run.vars.cut || 0) + o.cut; Object.assign(run.vars, o.set || {}); s.done = true; } } });
    },
    update(M, s) { return s.done; },
  },
  /** Run different step lists depending on run.vars[var]. Expanded in place by the manager. */
  branch: { start() {}, update() { return true; } },
  /** Taxi fares: pick up `fares` passengers and drive each to a named place. */
  taxi: {
    start(M, s) { s.n = 0; s.stage = 0; },
    update(M, s, run, dt) {
      const g = M.g, P = g.player;
      if (!P.vehicle) return void M.objective('Get in a <em>vehicle</em>.');
      if (s.stage === 0) {
        const sp = M.randomSidewalk(150, 380); if (!sp) return 'No fares around';
        s.ped = M.spawnPed(new THREE.Vector3(sp.x, 0, sp.z), 'civilian', {}); s.ped.state = 'hostage'; s.ped.noFlee = true; s.stage = 1; s.t = 75; run.timer = s.t;
      }
      if (s.stage === 1) {
        s.t -= dt; run.timer = s.t; M.setDest(s.ped.pos, 0, true); M.objective('Pick up the <em>passenger</em>.');
        if (!s.ped.alive) return 'The passenger was hurt';
        if (dist2(P.vehicle.pos, s.ped.pos) < 7 && P.vehicle.speed < 2) {
          s.ped.inVehicle = true; s.ped.h.visible = false; s.dest = M.randomLoc(P.vehicle.pos, 500, 1300, true); s.destPos = M.loc({ name: s.dest.name }); s.stage = 2;
          const L = g.map.route(P.vehicle.pos.x, P.vehicle.pos.z, s.destPos.x, s.destPos.z); const len = L ? cumLen(L).at(-1) : 800;
          s.t = len / 10 + 30; s.t0 = s.t; M.setDest(s.destPos, 9); M.say([['Passenger', `Take me to ${g.brand(s.dest.name, s.dest.kind)}, please.`]]); g.audio.pickup();
        }
        if (s.t <= 0) return 'Out of time';
      } else if (s.stage === 2) {
        s.t -= dt; run.timer = s.t; s.ped.pos.copy(P.vehicle.pos);
        M.objective(`Drive the passenger to <em>${g.brand(s.dest.name, s.dest.kind)}</em>.`);
        if (dist2(P.vehicle.pos, s.destPos) < 10 && P.vehicle.speed < 2) {
          const fare = Math.round(120 + s.t0 * 3 + Math.max(0, s.t) * 4); g.addMoney(fare); g.audio.cash(); g.hud.toast(`Fare paid: $${fare}`);
          run.vars.earned = (run.vars.earned || 0) + fare; s.ped.inVehicle = false; s.ped.h.visible = true; s.ped.pos.set(s.destPos.x, 0, s.destPos.z); s.ped.state = 'walk'; s.ped.path = null; s.ped.keep = false;
          s.n++; s.stage = 0; run.timer = null; if (s.n >= (s.fares || 3)) return true;
        }
        if (s.t <= 0) return 'Out of time';
      }
    },
  },
};
