// Ambient street events (one at a time, with cooldowns and despawn): bag snatch chase, stranded driver,
// street race challenge. Never near school safe zones.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { events } from '../core/events.js';

const COOLDOWN = [70, 130];
export class Ambient {
  constructor(game) { this.g = game; this.active = null; this.cool = 40; this.marker = null; }
  rndCool() { this.cool = COOLDOWN[0] + Math.random() * (COOLDOWN[1] - COOLDOWN[0]); }
  update(dt) {
    const g = this.g;
    if (g.missions.active || g.police.wanted) { if (this.active && this.active.kind !== 'race') this.end(false); return; }
    if (!this.active) { if ((this.cool -= dt) <= 0) { this.rndCool(); this.start(); } return; }
    this.active.t += dt; this.tick(dt);
  }
  start(kind) {
    const g = this.g, P = g.player;
    kind = kind || (P.vehicle ? (Math.random() < 0.6 ? 'race' : 'stranded') : (Math.random() < 0.6 ? 'snatch' : 'stranded'));
    const sp = g.peds.nearestSidewalk(P.pos.x + (Math.random() - 0.5) * 120, P.pos.z + (Math.random() - 0.5) * 120, 60);
    if (!sp || g.zones.nearSafeZone(sp.x, sp.z, 80) || Math.hypot(sp.x - P.pos.x, sp.z - P.pos.z) < 25) return false;
    if (kind === 'snatch') {
      const victim = g.peds.spawnNear(sp.x, sp.z, 0, 8, { anywhere: true, type: 'shopper' }), thief = g.peds.spawnNear(sp.x, sp.z, 3, 10, { anywhere: true, type: 'civilian' });
      if (!victim || !thief) return false;
      thief.keep = victim.keep = true; thief.health = 60; thief.noFlee = false; thief.thief = true;
      if (victim.bag) { victim.bag.removeFromParent(); thief.h.armL.hand.add(victim.bag); }
      thief.flee(victim.pos, 60); victim.state = 'idle'; victim.timer = 1e9;
      this.active = { kind, t: 0, thief, victim };
      g.hud.help('<b>Bag snatch!</b> Someone grabbed a shopper\'s bag. Stop the thief.', 5);
      g.audio.scream(victim.pos);
    } else if (kind === 'stranded') {
      const n = g.map.nearestRoad(sp.x, sp.z, 40, r => r.type !== 'service'); if (!n) return false;
      const v = new Vehicle(g, Math.random() < 0.5 ? 'hatch' : 'compact'); const off = n.road.w / 2 - 1.2;
      v.setPose(n.px - n.dz * off, n.pz + n.dx * off, Math.atan2(n.dx, n.dz)); v.health = v.maxHealth * 0.3; v.stranded = true; g.vehicles.push(v);
      const driver = g.peds.spawnNear(v.pos.x, v.pos.z, 0, 6, { anywhere: true }); if (!driver) { g.removeVehicle(v); return false; }
      driver.keep = true; driver.state = 'hostage'; driver.noFlee = true; driver.pos.set(v.pos.x - n.dz * -2.5, 0, v.pos.z + n.dx * -2.5);
      this.active = { kind, t: 0, v, driver };
      g.hud.help('<b>Stranded driver.</b> Someone is waving for help nearby. Walk up and press <b>E</b>.', 5);
    } else if (kind === 'race') {
      if (!P.vehicle) return false;
      const ok = g.missions.startSide?.('streetrace_challenge'); if (!ok) return false;
      this.active = { kind, t: 0 };
    }
    events.emit('ambient', { kind }); return true;
  }
  tick(dt) {
    const g = this.g, a = this.active, P = g.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    if (a.kind === 'snatch') {
      const th = a.thief, d = th.pos.distanceTo(pp);
      g.hud.objectiveMarker = th.pos;
      if (!th.alive || th.state === 'knocked' || th.state === 'stunned') {
        const reward = 150 + Math.floor(Math.random() * 150); g.addMoney(reward); g.hud.big('BAG RETURNED', `+$${reward}`, 'passed', 2.5); g.audio.jingle(true); return this.end(true);
      }
      if (th.state !== 'flee') th.flee(pp, 30);
      if (d > 160 || a.t > 70) { g.hud.toast('The thief got away'); return this.end(false); }
    } else if (a.kind === 'stranded') {
      g.hud.objectiveMarker = a.driver.pos;
      if (!a.driver.alive || a.v.dead) return this.end(false);
      if (!P.vehicle && a.driver.pos.distanceTo(P.pos) < 3 && g.input.pressed('interact')) {
        a.v.repair(); g.addMoney(120); g.hud.big('GOOD SAMARITAN', '+$120 · you got their car running', 'passed', 2.5); g.audio.jingle(true);
        a.driver.state = 'walk'; a.driver.noFlee = false; return this.end(true);
      }
      if (a.t > 120 || a.driver.pos.distanceTo(pp) > 300) return this.end(false);
    } else if (a.kind === 'race') {
      if (!g.missions.active) return this.end(true);
    }
  }
  end(ok) {
    const a = this.active; if (!a) return; this.active = null; this.g.hud.objectiveMarker = null; this.rndCool();
    for (const p of [a.thief, a.victim, a.driver]) if (p) { p.keep = false; }
    if (a.v) a.v.stranded = false;
    events.emit('ambientEnd', { kind: a.kind, ok });
  }
}
