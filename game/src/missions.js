import * as THREE from 'three';
import { cumLen, along } from './util.js';
import { Ped } from './peds.js';

const DEFS = [
  { id: 'delivery', title: 'Special Delivery', letter: 'D', blurb: 'Pick up a package and deliver it before time runs out.' },
  { id: 'race', title: 'Street Race', letter: 'R', blurb: 'Hit every checkpoint before the clock runs out.' },
  { id: 'taxi', title: 'Fare Game', letter: 'T', blurb: 'Pick up passengers and drive them across town.' },
  { id: 'heat', title: 'Heat Wave', letter: 'H', blurb: 'The cops are after you. Lose them.' },
];

function beam(color = 0xffd23f, r = 1.6, h = 2.2) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), m); c.position.y = h / 2; g.add(c);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 32).rotateX(-Math.PI / 2), m); ring.position.y = 0.08; g.add(ring);
  g.renderOrder = 3; return g;
}
function gate() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const t = new THREE.Mesh(new THREE.TorusGeometry(5, 0.25, 8, 36), m); t.position.y = 4.5; const g = new THREE.Group(); g.add(t); return g;
}

export class Missions {
  constructor(game) {
    this.game = game; this.active = null; this.markers = [];
    this.done = game.save.missions || {};
    this.dests = game.map.locations.filter(l => !['residential', 'school', 'college'].includes(l.kind) && (l.c));
    const sorted = [...this.dests].sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c));
    const used = [];
    DEFS.forEach((d, i) => {
      let loc = sorted.find(l => !used.includes(l) && used.every(u => Math.hypot(u.c[0] - l.c[0], u.c[1] - l.c[1]) > 250)) || sorted[i];
      used.push(loc);
      const sp = game.peds.nearestSidewalk(loc.c[0], loc.c[1], 150) || { x: loc.c[0], z: loc.c[1] };
      const mesh = beam(); mesh.position.set(sp.x, 0, sp.z); game.scene.add(mesh);
      this.markers.push({ def: d, pos: new THREE.Vector3(sp.x, 0, sp.z), mesh, cool: 0, near: loc.name });
    });
    this.destMesh = beam(0xffd23f, 3, 30); this.destMesh.visible = false; game.scene.add(this.destMesh);
    this.gates = [];
  }
  pointNear(loc) { const sp = this.game.peds.nearestSidewalk(loc.c[0], loc.c[1], 150); return sp ? new THREE.Vector3(sp.x, 0, sp.z) : new THREE.Vector3(loc.c[0], 0, loc.c[1]); }
  pickDest(from, minD, maxD) {
    const c = this.dests.filter(l => { const d = Math.hypot(l.c[0] - from.x, l.c[1] - from.z); return d > minD && d < maxD; });
    return c.length ? c[Math.floor(Math.random() * c.length)] : this.dests[Math.floor(Math.random() * this.dests.length)];
  }
  get dest() { return this.active?.dest || null; }
  start(mk) {
    const g = this.game, P = g.player;
    const m = { def: mk.def, stage: 0, t: 0, timer: null, dest: null, marker: mk, data: {} };
    this.active = m; for (const k of this.markers) k.mesh.visible = false;
    g.hud.big(mk.def.title, mk.def.blurb, 'passed', 2.5); g.audio.jingle(true);
    if (m.def.id === 'delivery') { const a = this.pickDest(mk.pos, 250, 650); m.data.a = a; this.setDest(m, this.pointNear(a)); m.text = `Pick up the package at <em>${a.name}</em>.`; }
    if (m.def.id === 'race') { m.text = P.vehicle ? '' : 'Get a <em>vehicle</em>.'; if (P.vehicle) this.setupRace(m); }
    if (m.def.id === 'taxi') { m.text = P.vehicle ? '' : 'Get a <em>vehicle</em>.'; m.data.fares = 0; if (P.vehicle) this.nextFare(m); }
    if (m.def.id === 'heat') { g.police.setWanted(3); m.text = '<em>Lose the cops.</em>'; }
  }
  setDest(m, p) { m.dest = p; this.destMesh.position.copy(p); this.destMesh.visible = true; this.game.setRouteTo(p.x, p.z, true); }
  setupRace(m) {
    const g = this.game, P = g.player, pos = P.vehicle.pos, to = this.pickDest(pos, 1100, 2200);
    const r = g.map.route(pos.x, pos.z, to.c[0], to.c[1]); if (!r) { this.fail('No route'); return; }
    const D = cumLen(r), L = D[D.length - 1]; m.data.cps = [];
    for (let s = 140; s < L; s += 140) { const p = along(r, D, s); m.data.cps.push(new THREE.Vector3(p.x, 0, p.z)); }
    const end = along(r, D, L); m.data.cps.push(new THREE.Vector3(end.x, 0, end.z));
    m.data.i = 0; m.timer = L / 16 + 20; m.stage = 1; m.data.to = to;
    for (const gt of this.gates) g.scene.remove(gt); this.gates = m.data.cps.map((p, i) => { const gm = gate(); gm.position.copy(p); const q = m.data.cps[i + 1] || p, pr = m.data.cps[i - 1] || pos; gm.rotation.y = Math.atan2(q.x - pr.x, q.z - pr.z) + Math.PI / 2; g.scene.add(gm); return gm; });
    this.raceDest(m);
  }
  raceDest(m) { const p = m.data.cps[m.data.i]; this.setDest(m, p); m.text = `Checkpoint <em>${m.data.i + 1}/${m.data.cps.length}</em>${m.data.i === m.data.cps.length - 1 ? ` · finish at <em>${m.data.to.name}</em>` : ''}`; this.gates.forEach((gt, i) => gt.visible = i >= m.data.i && i < m.data.i + 3); }
  nextFare(m) {
    const g = this.game, from = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    let sp = null; for (let t = 0; t < 20 && !sp; t++) { const a = Math.random() * 6.28, d = 150 + Math.random() * 250; sp = g.peds.nearestSidewalk(from.x + Math.cos(a) * d, from.z + Math.sin(a) * d, 40); if (sp && g.map.inSchool(sp.x, sp.z)) sp = null; }
    if (!sp) { this.fail('No fares around'); return; }
    const ped = new Ped(g, sp.x, sp.z, { state: 'hostage' }); ped.keep = true; ped.state = 'idle'; ped.timer = 1e9; g.peds.add(ped);
    m.data.ped = ped; m.stage = 1; this.setDest(m, new THREE.Vector3(sp.x, 0, sp.z)); m.timer = 70;
    m.text = `Pick up the <em>passenger</em>.`;
  }
  fail(reason) {
    const g = this.game; g.hud.big('MISSION FAILED', reason, 'failed', 3); g.audio.jingle(false); this.end();
  }
  pass(reward, note = '') {
    const g = this.game, m = this.active;
    g.addMoney(reward); g.hud.big('MISSION PASSED', `$${reward}${note ? ' · ' + note : ''}`, 'passed', 3.5); g.audio.jingle(true);
    this.done[m.def.id] = (this.done[m.def.id] || 0) + 1; g.save.missions = this.done; g.persist();
    this.end();
  }
  end() {
    const g = this.game, m = this.active; if (!m) return;
    if (m.data.ped) { m.data.ped.keep = false; m.data.ped.remove = true; }
    m.marker.cool = 20; this.active = null; this.destMesh.visible = false; g.clearRoute(true);
    for (const gt of this.gates) g.scene.remove(gt); this.gates = [];
    for (const k of this.markers) k.mesh.visible = true;
    g.hud.objective('');
  }
  event(e) { if (e === 'evaded' && this.active?.def.id === 'heat') this.pass(1200, 'Clean getaway'); }
  onWastedOrBusted(why) { if (this.active) this.fail(why); }
  update(dt) {
    const g = this.game, P = g.player, pp = P.vehicle ? P.vehicle.pos : P.pos, m = this.active;
    for (const k of this.markers) {
      k.mesh.rotation.y += dt; k.cool = Math.max(0, k.cool - dt);
      if (!m && k.cool <= 0 && Math.hypot(pp.x - k.pos.x, pp.z - k.pos.z) < 2.4 && (!P.vehicle || P.vehicle.speed < 6)) { this.start(k); return; }
    }
    this.destMesh.rotation.y += dt;
    if (!m) return;
    m.t += dt;
    if (m.timer !== null) { m.timer -= dt; if (m.timer <= 0) { this.fail('Out of time'); return; } }
    const at = (p, r) => Math.hypot(pp.x - p.x, pp.z - p.z) < r;
    const id = m.def.id;
    if (id === 'delivery') {
      if (m.stage === 0 && at(m.dest, 4.5)) {
        const b = this.pickDest(m.dest, 500, 1300); m.data.b = b; m.stage = 1;
        this.setDest(m, this.pointNear(b)); const route = g.routeLength || m.dest.distanceTo(pp);
        m.timer = route / 10 + 25; m.text = `Deliver the package to <em>${b.name}</em>.`; g.hud.toast('Package collected'); g.audio.pickup();
      } else if (m.stage === 1 && at(m.dest, 5)) this.pass(Math.round(300 + m.dest.distanceTo(this.pointNear(m.data.a)) * 0.45 + Math.max(0, m.timer) * 4));
    } else if (id === 'race' || id === 'taxi') {
      if (m.stage === 0) { if (P.vehicle) { m.text = ''; id === 'race' ? this.setupRace(m) : this.nextFare(m); } return void g.hud.objective(m.text); }
      if (!P.vehicle) { m.data.out = (m.data.out || 0) + dt; m.text = 'Get back in a <em>vehicle</em>!'; if (m.data.out > 15) return void this.fail('You left the vehicle'); }
      else { m.data.out = 0; if (P.vehicle.dead) return void this.fail('Vehicle destroyed'); }
      if (id === 'race' && P.vehicle) {
        if (at(m.dest, 7.5)) {
          g.audio.pickup(); m.data.i++;
          if (m.data.i >= m.data.cps.length) return void this.pass(Math.round(600 + m.timer * 15), `${Math.round(m.timer)}s to spare`);
          this.raceDest(m);
        } else if (!m.text.includes('Checkpoint')) this.raceDest(m);
      }
      if (id === 'taxi' && P.vehicle) {
        if (m.stage === 1 && m.data.ped && at(m.data.ped.pos, 7) && P.vehicle.speed < 2) {
          m.data.ped.inVehicle = true; m.data.ped.h.visible = false; m.data.ped.keep = true;
          const to = this.pickDest(pp, 500, 1400); m.data.to = to; m.stage = 2; this.setDest(m, this.pointNear(to));
          m.timer = (g.routeLength || 900) / 10 + 30; m.data.t0 = m.timer; m.text = `"Take me to <em>${to.name}</em>, please."`; g.audio.pickup();
        } else if (m.stage === 1) m.text = 'Pick up the <em>passenger</em>.';
        if (m.stage === 2) {
          m.text = `Drive the passenger to <em>${m.data.to.name}</em>.`;
          if (at(m.dest, 9) && P.vehicle.speed < 2) {
            const fare = Math.round(120 + (g.routeLength || 600) * 0.15 + m.timer * 3);
            const ped = m.data.ped; ped.inVehicle = false; ped.h.visible = true; ped.pos.set(m.dest.x, 0, m.dest.z); ped.state = 'walk'; ped.path = null; ped.keep = false; m.data.ped = null;
            m.data.fares++; m.data.earned = (m.data.earned || 0) + fare; g.addMoney(fare); g.audio.cash(); g.hud.toast(`Fare paid: $${fare}`);
            if (m.data.fares >= 3) return void this.pass(250, `3 fares · $${m.data.earned} earned`);
            this.nextFare(m);
          }
        }
      }
    }
    g.hud.objective(m.text);
    g.hud.timer(m.timer);
  }
}
