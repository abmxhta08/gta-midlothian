// Data-driven mission manager: runs mission definitions (missions/data/*.js) made of typed steps
// (missions/steps.js). Handles markers, objectives, GPS, dialogue subtitles, checkpoints + retry,
// fail conditions, medals, payouts, wanted suppression, save progress and side-job/phone entry points.
import * as THREE from 'three';
import { STEPS } from './steps.js';
import { STORY } from './data/story.js';
import { HEIST } from './data/heist.js';
import { SIDE } from './data/side.js';
import { Ped } from '../peds.js';
import { Vehicle } from '../entities/vehicle.js';
import { weaponMesh } from '../weapons.js';
import { centroid, signedArea, mulberry32 } from '../util.js';
import { events } from '../core/events.js';
import { writeSave } from '../save.js';
import { brandName } from '../config/brand.js';

const ALL = [...STORY, ...HEIST, ...SIDE];
const MAX_ENTITIES = 40;
function beam(color = 0xffd23f, r = 1.6, h = 2.2) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), m); c.position.y = h / 2; g.add(c);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 32).rotateX(-Math.PI / 2), m); ring.position.y = 0.08; g.add(ring);
  return g;
}

export class MissionManager {
  constructor(game) {
    this.g = game; this.active = null; this.markers = []; this.dest = null; this.talking = false; this.wantsInteract = false; this.failMenu = false;
    this.prog = game.save.missions;   // { completed: {id:n}, medals: {id:'gold'}, story, heist }
    this.sites = this.findSites();
    this.destMesh = beam(0xffd23f, 3, 30); this.destMesh.visible = false; game.scene.add(this.destMesh);
    this.subsEl = document.getElementById('subs'); this.lines = []; this.lineT = 0;
    for (const def of ALL) {
      if (!def.start) continue;
      let pos = this.loc(def.start); if (!pos) continue;
      // school campuses stay mission-free: move a marker that lands inside one to the nearest sidewalk outside
      if (game.zones.inSafeZone(pos.x, pos.z)) for (let r = 20; r < 400 && game.zones.inSafeZone(pos.x, pos.z); r += 20) for (let k = 0; k < 12; k++) { const sp = game.peds.nearestSidewalk(pos.x + Math.sin(k / 12 * 6.28) * r, pos.z + Math.cos(k / 12 * 6.28) * r, 30); if (sp && !game.zones.nearSafeZone(sp.x, sp.z, 25)) { pos = new THREE.Vector3(sp.x, 0, sp.z); break; } }
      const mesh = beam(def.type === 'story' || def.type === 'heist' ? 0xffd23f : 0x5ad2ff); mesh.position.copy(pos); game.scene.add(mesh);
      this.markers.push({ def, pos, mesh, cool: 0 });
    }
    this.refreshMarkers();
  }
  // ---------- locations ----------
  /** Invented story sites at unnamed commercial buildings, far from schools (deterministic). */
  findSites() {
    const g = this.g, foot = g.world.footprints.filter(f => f.kind === 'commercial' && !f.name && Math.abs(signedArea(f.pts)) > 300 && !g.zones.nearSafeZone(...centroid(f.pts), 200));
    const used = [], pick = (x, z, minArea = 300) => {
      const f = foot.filter(f => Math.abs(signedArea(f.pts)) > minArea && used.every(u => Math.hypot(...centroid(f.pts).map((v, i) => v - u[i])) > 350) && !g.places.list.some(p => Math.hypot(p.pos.x - centroid(f.pts)[0], p.pos.z - centroid(f.pts)[1]) < 60))
        .sort((a, b) => Math.hypot(centroid(a.pts)[0] - x, centroid(a.pts)[1] - z) - Math.hypot(centroid(b.pts)[0] - x, centroid(b.pts)[1] - z))[0];
      if (!f) return null; const c = centroid(f.pts); used.push(c); return this.sidewalkNear(c);
    };
    const mines = g.map.locations.find(l => /mines park/i.test(l.name)), market = g.map.locations.find(l => /marketplace/i.test(l.name));
    return {
      quill: pick(-300, 100), graves: pick(700, -400, 1200), gravesLot: pick(900, 300, 500),
      tick: market ? this.sidewalkNear(market.c) : pick(0, -600), harlan: mines ? this.sidewalkNear(mines.c) : pick(600, 600),
    };
  }
  /** A reachable, dry point near c: the nearest sidewalk, else the nearest road (park centroids can sit in a pond). */
  sidewalkNear(c) {
    const g = this.g, sp = g.peds.nearestSidewalk(c[0], c[1], 120);
    if (sp && !g.map.inWater(sp.x, sp.z)) return { x: sp.x, z: sp.z, bx: c[0], bz: c[1] };
    const o = this.openSpot(c[0], c[1]); if (Math.hypot(o.x - c[0], o.z - c[1]) < 70 && g.world.clear(o.x, o.z, 0.6)) return { x: o.x, z: o.z, bx: c[0], bz: c[1] };
    const n = g.map.nearestRoad(c[0], c[1], 400, r => r.type !== 'service');
    if (n && !g.map.inWater(n.px, n.pz)) { const e = this.openSpot(n.px + n.dz * n.road.w * 0.6, n.pz - n.dx * n.road.w * 0.6); return { x: e.x, z: e.z, bx: c[0], bz: c[1] }; }
    const e = this.openSpot(c[0], c[1]); return { x: e.x, z: e.z, bx: c[0], bz: c[1] };
  }
  /** Nearest walkable spot (not inside a building or wall, not in water) to x,z. */
  openSpot(x, z) {
    const g = this.g, ok = (a, b) => g.world.clear(a, b, 0.6) && !g.map.inWater(a, b);
    if (ok(x, z)) return { x, z };
    for (let r = 2; r <= 80; r += 2) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
    return { x, z };
  }
  /** Resolve a location spec to a Vector3. Specs: {site}, {place}, {name}, {random:{min,max}}, {near:spec, dist}, [x,z]. */
  loc(spec) {
    const g = this.g; if (!spec) return null;
    if (spec.isVector3) return spec.clone();
    if (Array.isArray(spec)) return new THREE.Vector3(spec[0], 0, spec[1]);
    if (spec.site) { const s = this.sites[spec.site]; return s ? new THREE.Vector3(s.x, 0, s.z) : this.loc({ random: { min: 200, max: 600 } }); }
    if (spec.place) { const p = g.places.get(spec.place); return p ? p.pos.clone() : this.loc({ random: { min: 200, max: 600 } }); }
    if (spec.name) { const l = g.map.locations.find(l => l.name.toLowerCase().includes(spec.name.toLowerCase())); if (l) { const s = this.sidewalkNear(l.c); return new THREE.Vector3(s.x, 0, s.z); } return this.loc({ random: { min: 200, max: 600 } }); }
    if (spec.random) { const l = this.randomLoc(this.pp, spec.random.min, spec.random.max, true, spec.random.combat); const s = this.sidewalkNear(l.c); return new THREE.Vector3(s.x, 0, s.z); }
    if (spec.near) { const b = this.loc(spec.near), a = Math.random() * Math.PI * 2, d = spec.dist || 60; const sp = g.peds.nearestSidewalk(b.x + Math.cos(a) * d, b.z + Math.sin(a) * d, 80); return sp ? new THREE.Vector3(sp.x, 0, sp.z) : b; }
    if (spec.player) return this.pp.clone();
    if (spec.var) { const e = this.active?.vars[spec.var]; return e?.pos ? e.pos.clone() : this.pp.clone(); }
    return null;
  }
  /** A named, non-residential, non-school location in a distance band (for random destinations). */
  randomLoc(from, min, max, retLoc = true, combat = false) {
    const g = this.g, c = g.map.locations.filter(l => l.c && !['residential', 'school', 'college'].includes(l.kind) && !g.zones.nearSafeZone(l.c[0], l.c[1], combat ? 150 : 40));
    const band = c.filter(l => { const d = Math.hypot(l.c[0] - from.x, l.c[1] - from.z); return d > min && d < max; });
    const pickFrom = band.length ? band : c; const l = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    return retLoc ? l : new THREE.Vector3(l.c[0], 0, l.c[1]);
  }
  randomSidewalk(min, max) { const p = this.pp; for (let t = 0; t < 80; t++) { if (t === 40) { min *= 0.5; max *= 1.6; } const a = Math.random() * 6.28, d = min + Math.random() * (max - min), sp = this.g.peds.nearestSidewalk(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 40); if (sp && !this.g.zones.nearSafeZone(sp.x, sp.z, 40)) return sp; } return null; }
  itemSpot(c, r) { for (let t = 0; t < 30; t++) { const a = Math.random() * 6.28, d = Math.random() * r, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; if (this.g.world.clear(x, z, 0.7)) return new THREE.Vector3(x, 0, z); } return c.clone(); }
  get pp() { const P = this.g.player; return P.vehicle ? P.vehicle.pos : P.pos; }

  // ---------- helpers used by steps ----------
  setDest(p, r = 0, small = false) { this.dest = p; this.destMesh.position.copy(p); this.destMesh.visible = true; this.destMesh.scale.set(small ? 0.5 : 1, small ? 0.4 : 1, small ? 0.5 : 1); if (!this.routeTo || this.routeTo.distanceTo(p) > 25) { this.routeTo = p.clone(); this.g.setRouteTo(p.x, p.z, true); } }
  clearDest() { this.dest = null; this.destMesh.visible = false; this.routeTo = null; this.g.clearRoute(true); }
  objective(html) { this.g.hud.objective(html || ''); }
  meter(kind, v, label) { const el = document.getElementById('checklist'); if (!kind) { el.innerHTML = ''; return; } el.innerHTML = `<div>${label}</div><div class="meter"><i style="width:${Math.round(v * 100)}%;background:${kind === 'stealth' || kind === 'tail' ? '#ff6a3a' : '#5ad27a'}"></i></div>`; }
  say(lines) { this.lines.push(...lines); if (!this.talking) this.nextLine(); }
  nextLine() { const l = this.lines.shift(); if (!l) { this.talking = false; this.subsEl.innerHTML = ''; return; } this.talking = true; this.subsEl.innerHTML = l[0] ? `<b>${l[0]}:</b> ${l[1]}` : `<b>${l[1]}</b>`; this.lineT = 1.4 + l[1].length * 0.045; }
  track(e) { this.active?.ent.push({ e, step: this.active.i }); if (this.active && this.active.ent.length > MAX_ENTITIES) { const old = this.active.ent.shift(); this.dispose(old.e); } return e; }
  spawnCar(type, p, color = null, onRoad = true) {
    const g = this.g; let x = p.x, z = p.z, h = Math.random() * 6.28;
    const n = onRoad ? g.map.nearestRoad(x, z, 80, r => r.type !== 'service' && !r.svc) : null;
    if (n) { const off = n.road.w / 4; x = n.px - n.dz * off; z = n.pz + n.dx * off; h = Math.atan2(n.dx, n.dz); }
    const v = new Vehicle(g, type, color); v.setPose(x, z, h); v.mission = true; g.vehicles.push(v); return this.track(v);
  }
  spawnPed(p, look = 'civilian', opts = {}) {
    const g = this.g, q = new Ped(g, p.x, p.z, { type: look === 'goon' ? 'gang' : look }); q.keep = true; q.mission = true; q.group = this.active?.def.id || 'mission';
    if (opts.hostile) this.makeHostile(q); else if (look === 'gang' || look === 'goon') q.state = 'idle';
    g.peds.add(q); return this.track(q);
  }
  makeHostile(q) { q.gang = true; q.hostile = true; q.state = 'hostile'; q.weapon = q.weapon || weaponMesh('pistol'); q.h.setWeaponMesh(q.weapon); q.shootT = 1 + Math.random(); q.group = this.active?.def.id; }
  /** Hostile attacker spawned on a clear spot rMin..rMax from c (never inside a school zone). */
  spawnGoon(c, rMin, rMax, armed = true, idle = false, avoid = null) {
    let p = null; for (let t = 0; t < 40 && !p; t++) { const a = Math.random() * 6.28, d = rMin + Math.random() * (rMax - rMin), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; if (this.g.world.clear(x, z, 0.6) && !this.g.zones.nearSafeZone(x, z, 20) && (!avoid || t > 34 || Math.hypot(x - avoid.x, z - avoid.z) > 16)) p = new THREE.Vector3(x, 0, z); }
    const q = this.spawnPed(p || c, 'goon', { hostile: !idle });
    if (idle) { q.state = 'idle'; q.timer = 1e9; q.provokeGroup = true; }
    if (!armed) { q.weapon = null; q.h.setWeaponMesh(null); }
    return q;
  }
  /** Patrolling guard for stealth steps (turns hostile when the alarm goes off). */
  spawnGuard(c, r) {
    const pp = this.pp, q = this.spawnGoon(c, 4, r, true, true, pp); q.yaw = Math.atan2(q.pos.x - pp.x, q.pos.z - pp.z); // (start facing away from the player)
    q.state = 'guard'; q.noFlee = true; q.provokeGroup = false; q.guard = { a: q.pos.clone(), b: this.itemSpot(c, r), toB: true, wait: 0 }; q.walkSpeed = 1.2; q.h.setWeaponMesh(q.weapon);
    return q;
  }
  spawnItems(c, n, spread, color = 0xffd23f) {
    const items = [];
    for (let k = 0; k < n; k++) {
      const p = n === 1 && !spread ? c.clone() : this.itemSpot(c, spread), m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
      m.position.set(p.x, 0.9, p.z); this.g.scene.add(m); items.push({ pos: p, mesh: m, got: false }); this.track({ mesh: m });
    }
    return items;
  }
  gates(cps) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    return cps.map((p, i) => { const q = cps[i + 1] || p, pr = cps[i - 1] || p; const t = new THREE.Mesh(new THREE.TorusGeometry(5, 0.25, 8, 36), m); t.position.set(p.x, 4.5, p.z); t.rotation.y = Math.atan2(q.x - pr.x, q.z - pr.z) + Math.PI / 2; this.g.scene.add(t); return t; });
  }
  flee(driver) { const v = driver.v, to = this.randomLoc(v.pos, 600, 1300, false, true); driver.routeTo(to.x, to.z); }
  dispose(e) {
    const g = this.g;
    // always release mission vehicles (a car you're still sitting in becomes an ordinary car that can despawn later)
    if (e instanceof Vehicle) { e.mission = false; if (e.driver === 'npc') e.driver = null; if (e !== g.player.vehicle && g.player.lastVehicle !== e) g.removeVehicle(e); }
    else if (e instanceof Ped) { e.keep = false; e.remove = true; }
    else if (e.mesh) g.scene.remove(e.mesh);
  }

  // ---------- availability ----------
  done(id) { return (this.prog.completed[id] || 0) > 0; }
  available(def) {
    if (def.type === 'side') return true;
    if (def.type === 'story' || def.type === 'heist') return !this.done(def.id) && (def.requires || []).every(r => this.done(r));
    return false;
  }
  refreshMarkers() { for (const m of this.markers) m.mesh.visible = !this.active && this.available(m.def) && m.cool <= 0; }
  catalog() {
    return ALL.filter(d => d.start).map(d => ({ id: d.id, title: d.title, type: d.type, status: this.done(d.id) ? (d.type === 'side' ? `Done ×${this.prog.completed[d.id]}` : 'Complete') : this.available(d) ? 'Available' : 'Locked', medal: this.prog.medals[d.id] || '' }));
  }
  nextStoryFor(contact) { return ALL.find(d => (d.type === 'story' || d.type === 'heist') && d.giver === contact && this.available(d)) || null; }
  setGPSToStart(id) { const m = this.markers.find(m => m.def.id === id); if (m) this.g.setWaypoint(m.pos.x, m.pos.z); }
  progressSummary() { const story = ALL.filter(d => d.type === 'story' || d.type === 'heist'); return { story: story.filter(d => this.done(d.id)).length, storyTotal: story.length, side: SIDE.reduce((a, d) => a + (this.prog.completed[d.id] || 0), 0) }; }

  // ---------- running ----------
  /** Start a mission by id (side jobs may be started from ambient events / the phone). */
  startById(id, opts = {}) { const def = ALL.find(d => d.id === id); if (!def || this.active || (!opts.force && !this.available(def))) return false; return this.start(def) !== false; }
  getDef(id) { return ALL.find(d => d.id === id); }
  startSide(id) { return this.startById(id, { force: true }); }
  start(def) {
    const g = this.g;
    if (this.active || g.state !== 'play') return false;
    if (def.needsVehicle && !g.player.vehicle) { g.hud.toast('You need a vehicle for this job'); return false; }
    this.active = { def, steps: def.steps.map(s => ({ ...s })), i: -1, vars: { ...(def.vars || {}) }, ent: [], t: 0, timer: null, cp: null };
    if (def.suppressWanted) { g.police.clearAll(); g.police.suppressed = true; }
    this.refreshMarkers();
    g.hud.big(def.title, def.blurb || '', 'passed', 2.5); g.audio.jingle(true);
    events.emit('missionStart', { id: def.id });
    this.advance();
    return true;
  }
  advance() {
    const run = this.active; if (!run) return;
    const cur = run.steps[run.i]; if (cur) STEPS[cur.type].end?.(this, cur, run);
    run.i++;
    let s = run.steps[run.i];
    while (s && s.type === 'branch') {   // expand a branch in place
      const pick = s.cases[run.vars[s.var]] || s.cases.default || [];
      run.steps.splice(run.i, 1, ...pick.map(x => ({ ...x }))); s = run.steps[run.i];
    }
    if (!s) return this.pass();
    if (s.checkpoint || run.i === 0) {
      const pv = this.g.player.vehicle;
      run.cp = {
        i: run.i, pos: this.pp.clone(), heading: pv?.heading || 0, vtype: pv?.type, vcolor: pv?.color,
        vvar: Object.keys(run.vars).find(k => pv && run.vars[k] === pv),
        // mission vehicles alive at the checkpoint are restored (repaired, or respawned if wrecked) on retry
        vsnap: Object.entries(run.vars).filter(([, v]) => v instanceof Vehicle && !v.dead).map(([k, v]) => ({ k, type: v.type, color: v.color, x: v.pos.x, z: v.pos.z, h: v.heading })),
        vars: JSON.parse(JSON.stringify(run.vars, (k, v) => (v && (v instanceof Vehicle || v instanceof Ped)) ? undefined : v)), steps: run.steps.map(x => ({ ...x })),
      };
    }
    if (s.timer) run.timer = s.timer;
    run.stepT = 0;
    STEPS[s.type].start(this, s, run);
  }
  update(dt) {
    const g = this.g;
    for (const m of this.markers) {
      m.mesh.rotation.y += dt; if (m.cool > 0) { m.cool -= dt; if (m.cool <= 0) this.refreshMarkers(); }
      if (!this.active && m.mesh.visible && g.state === 'play' && m.pos.distanceTo(this.pp) < 2.6 && (!g.player.vehicle || g.player.vehicle.speed < 6)) this.start(m.def);
    }
    if (this.talking && (this.lineT -= dt) <= 0) this.nextLine();
    this.destMesh.rotation.y += dt;
    const run = this.active; if (!run || this.failMenu) return;
    run.t += dt;
    if (run.timer != null) { run.timer -= dt; g.hud.timer(Math.max(0, run.timer)); if (run.timer <= 0 && !run.steps[run.i]?.ownTimer) return this.fail('Out of time'); } else g.hud.timer(null);
    // global fail conditions
    for (const [k, v] of Object.entries(run.vars)) if (v instanceof Vehicle && run.def.protect?.includes(k) && v.dead) return this.fail('A vehicle you needed was destroyed');
    const s = run.steps[run.i];
    const r = STEPS[s.type].update(this, s, run, dt);
    if (r === true) this.advance();
    else if (typeof r === 'string') this.fail(r);
  }
  pass() {
    const g = this.g, run = this.active, def = run.def;
    const medal = def.medals ? (run.t <= def.medals.gold ? 'gold' : run.t <= def.medals.silver ? 'silver' : 'bronze') : null;
    let pay = typeof def.payout === 'function' ? def.payout(run.vars) : (def.payout || 0);
    if (medal === 'gold') pay = Math.round(pay * 1.25); else if (medal === 'silver') pay = Math.round(pay * 1.1);
    if (pay) g.addMoney(pay);
    this.prog.completed[def.id] = (this.prog.completed[def.id] || 0) + 1;
    const order = { gold: 3, silver: 2, bronze: 1 }; if (medal && (order[medal] > (order[this.prog.medals[def.id]] || 0))) this.prog.medals[def.id] = medal;
    if (def.type === 'story' || def.type === 'heist') this.prog.story = ALL.filter(d => (d.type === 'story' || d.type === 'heist') && this.done(d.id)).length;
    g.hud.big('MISSION PASSED', `${pay ? `$${pay.toLocaleString()}` : ''}${medal ? ` · ${medal.toUpperCase()} medal` : ''}${def.passNote ? ` · ${def.passNote(run.vars)}` : ''}`, 'passed', 4);
    g.audio.jingle(true);
    if (def.outro) this.say(def.outro);
    events.emit('missionPass', { id: def.id, pay, medal, time: run.t });
    this.end(); writeSave(g);
    if (def.ending) setTimeout(() => this.g.hud.big('THE END', 'Midlothian is yours. Free roam continues.', 'passed', 6), 4500);
  }
  fail(reason) {
    const g = this.g, run = this.active; if (!run) return;
    events.emit('missionFail', { id: run.def.id, reason });
    run.def.onFail?.(g);
    if (run.def.type === 'side' && !run.def.retry) { g.hud.big('MISSION FAILED', reason, 'failed', 3); g.audio.jingle(false); return this.end(); }
    g.hud.big('MISSION FAILED', reason, 'failed', 2.5); g.audio.jingle(false);
    this.failMenu = true;
    const show = () => this.active === run && this.failMenu && g.menu.show('Mission failed', [
      { label: 'Retry from checkpoint', action: () => { this.failMenu = false; this.retry(); } },
      { label: 'Quit mission', action: () => { this.failMenu = false; this.end(); } },
    ], { subtitle: reason, onClose: () => { if (this.failMenu) { this.failMenu = false; this.end(); } } });
    this.failShow = show;
    if (g.state === 'play') this.failTimer = setTimeout(show, 1200); else this.pendingFailMenu = show;
  }
  retry() {
    const g = this.g, run = this.active, cp = run.cp;
    STEPS[run.steps[run.i]?.type]?.end?.(this, run.steps[run.i], run);
    for (const { e, step } of run.ent.filter(x => x.step >= cp.i)) this.dispose(e);
    run.ent = run.ent.filter(x => x.step < cp.i);
    g.police.clearAll(); if (run.def.suppressWanted) g.police.suppressed = true;
    g.state = 'play'; const P = g.player; if (P.vehicle) g.exitVehicle(true); P.setPos(cp.pos.x, cp.pos.z); P.health = 100;
    // restore the vehicles the mission needs
    for (const sn of cp.vsnap || []) {
      let v = run.vars[sn.k];
      if (!v || v.dead || v.flooded || !g.vehicles.includes(v)) {
        v = new Vehicle(g, sn.type, sn.color); v.mission = true; g.vehicles.push(v); run.ent.push({ e: v, step: cp.i - 1 }); run.vars[sn.k] = v;
      } else v.repair();
      v.vx = v.vz = 0; v.setPose(sn.x, sn.z, sn.h);
    }
    if (cp.vtype) {
      const v = (cp.vvar && run.vars[cp.vvar]) || g.spawnVehicle(cp.vtype, cp.pos.x, cp.pos.z, cp.heading, cp.vcolor);
      v.mission = true; v.setPose(cp.pos.x, cp.pos.z, cp.heading); P.setPos(v.pos.x + 2, v.pos.z); g.tryEnterExit();
    }
    run.steps = cp.steps.map(x => ({ ...x })); Object.assign(run.vars, cp.vars); run.timer = null; run.i = cp.i - 1;
    this.advance();
  }
  abort(reason = 'Mission cancelled') { if (this.active) { this.end(); this.g.hud.toast(reason); } }
  end() {
    const g = this.g, run = this.active; if (!run) return;
    clearTimeout(this.failTimer); this.failMenu = false; this.pendingFailMenu = null;
    const s = run.steps[run.i]; if (s) STEPS[s.type].end?.(this, s, run);
    for (const { e } of run.ent) this.dispose(e);
    for (const m of this.markers) if (m.def === run.def) m.cool = run.def.type === 'side' ? 25 : 0;
    this.active = null; this.clearDest(); this.objective(''); this.meter(null); g.hud.timer(null); this.wantsInteract = false;
    g.police.suppressed = false; this.refreshMarkers();
  }
  event(e) { if (e === 'evaded') { /* getaway steps watch the wanted level directly */ } }
  onWastedOrBusted(why) {
    if (!this.active) return;
    this.fail(why);
  }
  /** Called once the player has respawned so a pending retry menu can open. */
  afterRespawn() { if (this.pendingFailMenu) { const f = this.pendingFailMenu; this.pendingFailMenu = null; setTimeout(f, 600); } }
  get brand() { return brandName; }
}
export { ALL as MISSIONS };
void mulberry32;
