import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Hitscan shooting, melee and explosions for player and NPCs. */
export class Combat {
  constructor(game) { this.game = game; }
  /** Nearest hit along a ray (o, unit d). ignore = entity to skip. */
  raycast(o, d, maxD, ignore = null, tMin = 0) {
    const g = this.game; let best = { t: maxD, kind: null };
    const hd = Math.hypot(d.x, d.z);
    if (hd > 1e-4) {
      const th = g.world.grid.ray(o.x + d.x * tMin, o.z + d.z * tMin, d.x / hd, d.z / hd, (maxD - tMin) * hd);
      if (th !== Infinity) {
        const t = tMin + th / hd, y = o.y + d.y * t;
        if (y < 6.5 && y > -0.1 && t < best.t) {
          const n = g.world.grid.rayN; let nx = n[0], nz = n[1]; if (nx * d.x + nz * d.z > 0) { nx = -nx; nz = -nz; }
          best = { t, kind: 'world', normal: new THREE.Vector3(nx, 0, nz), tag: g.world.grid.rayTag };
        }
      }
    }
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > tMin && t < best.t) best = { t, kind: 'ground', normal: UP.clone() }; }
    for (const v of g.vehicles) {
      if (v === ignore || Math.abs(v.pos.x - o.x) > maxD + 5 || Math.abs(v.pos.z - o.z) > maxD + 5) continue;
      const t = v.rayHit(o, d, best.t); if (t > tMin && t < best.t) best = { t, kind: 'vehicle', obj: v, normal: d.clone().negate() };
    }
    for (const p of g.peds.list) {
      if (p === ignore) continue;
      const h = p.rayHit(o, d, best.t); if (h && h.t > tMin && h.t < best.t) best = { t: h.t, kind: 'ped', obj: p, head: h.head, normal: d.clone().negate() };
    }
    const ht = g.police.heli?.rayHit(o, d, best.t) ?? Infinity;
    if (ht > tMin && ht < best.t) best = { t: ht, kind: 'heli', normal: d.clone().negate() };
    if (ignore !== g.player && !g.player.vehicle) {
      const h = g.player.rayHit(o, d, best.t); if (h && h.t < best.t) best = { t: h.t, kind: 'player', normal: d.clone().negate() };
    }
    best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }
  /** Player fires current weapon along the camera ray. */
  playerFire(w, muzzle, opts = {}) {
    const g = this.game, cam = g.camera, o = cam.position.clone(), base = new THREE.Vector3(); cam.getWorldDirection(base);
    const tMin = g.player.scoped ? 0.5 : cam.position.distanceTo(g.player.pos) * 0.9;
    const pellets = w.pellets || 1;
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      const spread = w.spread * (g.player.aiming ? 0.6 : 1.2) * (1 + g.player.speed * 0.15) * (opts.blind ? 5 : 1);
      const d = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
      const hit = this.raycast(o, d, w.range, g.player, tMin);
      g.effects.tracer(muzzle, hit.point);
      if (this.apply(hit, w.dmg, 'player', d, w.hs)) { anyHit = true; g.hud.hit(); }
    }
    g.effects.muzzle(muzzle, w.id === 'shotgun' ? 0.9 : 0.6);
    g.audio.shot(w.id, g.player.pos);
    g.peds.panic(g.player.pos.x, g.player.pos.z, 45, g.player.pos);
    for (const v of g.traffic.list) if (v.pos.distanceTo(g.player.pos) < 40) g.traffic.disturb(v, 'gunfire');
    g.crime('gunfire', g.player.pos);
    return anyHit;
  }
  apply(hit, dmg, src, d, hs = 2.5) {
    const g = this.game;
    if (hit.kind === 'ped') {
      const p = hit.obj, wasAlive = p.alive;
      p.damage(dmg * (hit.head ? hs : 1), src === 'player' ? 'player' : src, d);
      if (src === 'player' && hit.head && wasAlive && !p.alive) g.stats.headshots = (g.stats.headshots || 0) + 1;
      g.effects.impact(hit.point, hit.normal, 'blood');
      if (src === 'player' && wasAlive) { if (p.cop) g.crime('assault', p.pos); }
      return true;
    }
    if (hit.kind === 'vehicle') {
      hit.obj.damage(dmg * 1.3); g.effects.impact(hit.point, hit.normal, 'spark');
      if (src === 'player' && hit.obj.police) g.crime('copcar', hit.obj.pos);
      return true;
    }
    if (hit.kind === 'player') { g.player.damage(dmg); g.effects.impact(hit.point, hit.normal, 'blood'); return true; }
    if (hit.kind === 'heli') { g.police.heli.damage(dmg * 1.2); g.effects.impact(hit.point, hit.normal, 'spark'); return true; }
    if (hit.kind === 'world') { g.effects.impact(hit.point, hit.normal, hit.tag === 2 ? 'dust' : 'spark'); return false; }
    if (hit.kind === 'ground') { g.effects.impact(hit.point, hit.normal, 'dust'); return false; }
    return false;
  }
  /** NPC (police) shot from muzzle toward aim point. dmg>0 means intended hit. */
  npcShot(shooter, muzzle, aim, dmg) {
    const g = this.game, d = aim.clone().sub(muzzle).normalize();
    const hit = this.raycast(muzzle, d, 120, shooter, 0.3);
    g.effects.tracer(muzzle, hit.point); g.effects.muzzle(muzzle, 0.5); g.audio.shot('pistol', muzzle);
    if (hit.kind === 'player') {
      // cover / swimming make you harder to hit: the bullet strikes the cover instead
      if (dmg > 0 && Math.random() < g.player.exposure) { g.player.damage(dmg); g.effects.impact(hit.point, hit.normal, 'blood'); }
      else g.effects.impact(hit.point.clone().addScaledVector(d, -0.4), hit.normal, 'spark');
    }
    else if (hit.kind === 'vehicle' && hit.obj === g.player.vehicle) { hit.obj.damage(dmg > 0 ? 35 : 10); g.effects.impact(hit.point, hit.normal, 'spark'); if (dmg > 0 && Math.random() < 0.25) g.player.damage(dmg * 0.5); }
    else this.apply(hit, 15, 'cop', d);
    shooter.h.kick = 1;
  }
  melee(attacker, w = { dmg: 22, range: 1.5 }) {
    const g = this.game, fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    let hitAny = false;
    for (const p of g.peds.list) {
      if (!p.alive || p === attacker || p.inVehicle) continue;
      const rx = p.pos.x - attacker.pos.x, rz = p.pos.z - attacker.pos.z, d = Math.hypot(rx, rz);
      if (d < w.range + 0.2 && (rx * fx + rz * fz) / (d || 1) > 0.5) {
        const dmg = w.dmg * (p.state === 'stunned' ? 2 : 1);
        if (w.id === 'bat' && p.health - dmg > 0) p.knock(fx * 4, fz * 4, 0, 'player');
        p.damage(dmg, 'player', new THREE.Vector3(fx, 0, fz)); p.pos.x += fx * 0.4; p.pos.z += fz * 0.4; hitAny = true;
        g.events?.emit('melee', { target: p, weapon: w.id });
        g.crime(p.cop ? 'assault' : 'minor', p.pos);
        g.effects.impact(new THREE.Vector3(p.pos.x, 1.5, p.pos.z), new THREE.Vector3(-fx, 0, -fz), 'blood');
      }
    }
    g.audio.punch(attacker.pos);
    return hitAny;
  }
  explosion(p, src) {
    const g = this.game;
    g.effects.explosion(p); g.audio.explosion(p);
    for (const q of g.peds.list) { const d = q.pos.distanceTo(p); if (d < 10 && q.alive) { const k = 1 - d / 10, dx = (q.pos.x - p.x) / (d || 1), dz = (q.pos.z - p.z) / (d || 1); q.knock(dx * 12 * k, dz * 12 * k, 140 * k, src === g.player.vehicle || src === 'player' ? 'player' : 'explosion'); } }
    for (const v of g.vehicles) { if (v === src) continue; const d = v.pos.distanceTo(p); if (d < 9) { v.damage(900 * (1 - d / 9)); const dx = (v.pos.x - p.x) / (d || 1), dz = (v.pos.z - p.z) / (d || 1); v.vx += dx * 8 * (1 - d / 9); v.vz += dz * 8 * (1 - d / 9); if (d < 4.5) v.flip(); g.traffic.disturb(v, 'crash'); } }
    const pp = g.player.vehicle ? g.player.vehicle.pos : g.player.pos, d = pp.distanceTo(p);
    if (d < 10) {
      if (g.player.vehicle === src) g.player.damage(200); else g.player.damage(110 * (1 - d / 10));
      if (!g.player.vehicle && d < 8) { const dx = (pp.x - p.x) / (d || 1), dz = (pp.z - p.z) / (d || 1); g.player.knock(dx * 9 * (1 - d / 8), dz * 9 * (1 - d / 8), 5); }
    }
    g.events?.emit('explosion', { pos: p });
    g.peds.panic(p.x, p.z, 80, p);
    g.shake = Math.max(g.shake, Math.max(0, 1 - d / 60));
  }
}
