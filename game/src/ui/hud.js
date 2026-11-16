const $ = (id) => document.getElementById(id);

/** Renders a static map of the world to a canvas (shared by the minimap and the full map). */
export function renderBaseMap(map, S) {
  const data = map.data, R = data.radius + 200, size = Math.ceil(R * 2 * S), c = document.createElement('canvas');
  c.width = c.height = size; const x = c.getContext('2d'), o = size / 2;
  const P = (p) => [o + p[0] * S, o + p[1] * S];
  const poly = (pts) => { x.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); };
  const line = (pts) => { x.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); };
  x.fillStyle = '#26332a'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#3a4b3b'; x.beginPath(); x.arc(o, o, data.radius * S, 0, 7); x.fill();
  const fills = { water: '#2f6596', swimming_pool: '#3f8ac0', forest: '#2f4a2f', wetland: '#33503a', park: '#3d6a3c', pitch: '#4a7f43', golf_course: '#467a41', recreation_ground: '#3f6a3c',
    school: '#4d5a49', college: '#4d5a49', parking: '#4a4e52', retail: '#454a45', commercial: '#454a45', cemetery: '#3d5f3c', playground: '#4f5f45', track: '#7a4a3a', grass: '#3f5f3d' };
  for (const a of data.areas) { const f = fills[a.kind]; if (!f) continue; x.fillStyle = f; poly(a.pts); x.fill(); }
  x.lineCap = x.lineJoin = 'round';
  for (const l of data.lines || []) { x.strokeStyle = '#2f6596'; x.lineWidth = Math.max(1, 3 * S); line(l.pts); x.stroke(); }
  x.fillStyle = '#5b6066';
  for (const b of data.buildings) { poly(b.pts); x.fill(); }
  const roads = [...data.roads].sort((a, b) => a.w - b.w);
  for (const pass of [0, 1]) for (const r of roads) {
    if (r.svc === 'driveway') continue;
    const major = r.w >= 9 && r.type !== 'service';
    x.strokeStyle = pass === 0 ? '#1d2124' : (major ? '#e9e2c8' : r.type === 'service' ? '#9a9da0' : '#c9cbcd');
    x.lineWidth = Math.max(pass === 0 ? 2.4 : 1.2, r.w * S * (pass === 0 ? 1.0 : 0.78) + (pass === 0 ? 1.2 : 0));
    line(r.pts); x.stroke();
  }
  return { canvas: c, S, o };
}

export class HUD {
  constructor(game) {
    this.g = game;
    this.el = { hp: $('hpbar'), ar: $('arbar'), money: $('money'), wanted: $('wanted'), wname: $('wname'), ammo: $('ammo'), help: $('help'),
      obj: $('objective'), timer: $('timer'), loc: $('loc'), locname: $('locname'), locsub: $('locsub'), street: $('street'), speed: $('speed'),
      cross: $('cross'), toast: $('toast'), big: $('big'), bigt: $('bigt'), bigs: $('bigs'), mm: $('minimap'), hud: $('hud') };
    this.mm = this.el.mm.getContext('2d'); this.shownMoney = game.player.money; this.toastT = 0; this.locT = 0; this.streetT = 0; this.bigT = 0; this.helpT = 0; this.dmgT = 0; this.hitT = 0;
    this.base = renderBaseMap(game.map, 0.6);
    this.lastLoc = null; this.lastStreet = null;
  }
  toast(t) { this.el.toast.textContent = t; this.el.toast.style.opacity = 1; this.toastT = 2.6; }
  help(html, t = 5) { this.el.help.innerHTML = html; this.el.help.style.opacity = 1; this.helpT = t; }
  objective(html) { if (this.el.obj.innerHTML !== html) this.el.obj.innerHTML = html || ''; }
  timer(t) { this.el.timer.textContent = t == null ? '' : `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`; this.el.timer.style.color = t != null && t < 10 ? '#ff5050' : '#fff'; }
  big(t, s, cls, dur = 3) { this.el.big.className = cls; this.el.bigt.textContent = t; this.el.bigs.textContent = s || ''; this.el.big.style.display = 'flex'; this.bigT = dur; }
  location(name, sub) { this.el.locname.textContent = name; this.el.locsub.textContent = sub || ''; this.el.loc.style.opacity = 1; this.locT = 4.5; this.el.street.style.opacity = 0; }
  street(name, district) { if (this.locT > 0) return; this.el.street.innerHTML = `${name}<br><small style="opacity:.75;font-size:15px">${district}</small>`; this.el.street.style.opacity = 1; this.streetT = 3.5; }
  flashDamage() { this.dmgT = 0.35; }
  hit() { this.hitT = 0.15; }
  scope(on) { if (this.scopeOn !== on) { this.scopeOn = on; document.getElementById('scope').style.display = on ? 'block' : 'none'; } }
  radio(st) { const el = document.getElementById('radio'); el.innerHTML = `<b>${st.name}</b>${st.tag ? `<small>${st.tag}</small>` : ''}`; el.style.opacity = 1; this.radioT = 2.5; }
  whiteout(t) { this.whiteT = t; }
  update(dt) {
    const g = this.g, P = g.player, e = this.el;
    e.hp.style.width = `${P.health}%`; e.ar.style.width = `${P.armor}%`;
    const stEl = document.getElementById('stambar'); if (stEl) { stEl.style.width = `${P.stamina}%`; stEl.parentElement.style.opacity = P.stamina < 99 ? 1 : 0; stEl.style.background = P.staminaLock ? '#c95a3a' : ''; }
    if ((this.radioT = (this.radioT || 0) - dt) <= 0) document.getElementById('radio').style.opacity = 0;
    this.whiteT = Math.max(0, (this.whiteT || 0) - dt); document.getElementById('white').style.opacity = Math.min(1, this.whiteT);
    e.hp.style.background = P.health < 25 ? 'linear-gradient(#ff6b6b,#b52a2a)' : '';
    if (this.shownMoney !== P.money) { this.shownMoney += Math.sign(P.money - this.shownMoney) * Math.max(1, Math.ceil(Math.abs(P.money - this.shownMoney) * dt * 4)); if (Math.abs(this.shownMoney - P.money) < 2) this.shownMoney = P.money; }
    e.money.textContent = '$' + this.shownMoney.toLocaleString();
    const w = g.police.wanted, stars = '★'.repeat(w), off = '★'.repeat(5 - w);
    const wh = w ? `<span class="off">${off}</span><span>${stars}</span>` : ''; if (e.wanted.innerHTML !== wh) e.wanted.innerHTML = wh;
    e.wanted.classList.toggle('blink', g.police.searching);
    const W = P.weapon, inv = P.inv[P.current];
    e.wname.textContent = W.name; e.ammo.textContent = W.melee ? '' : (P.reloadT > 0 ? 'reloading…' : `${inv.ammo} / ${inv.reserve}`);
    const veh = P.vehicle;
    e.speed.style.display = veh ? 'block' : 'none';
    if (veh) e.speed.innerHTML = `${Math.round(veh.speed * 2.237)}<small> mph</small>`;
    e.cross.style.display = !veh && !W.melee && g.state === 'play' ? 'block' : 'none';
    e.cross.classList.toggle('aim', P.aiming); e.cross.classList.toggle('hit', this.hitT > 0);
    this.hitT -= dt;
    if ((this.toastT -= dt) <= 0) e.toast.style.opacity = 0;
    if ((this.helpT -= dt) <= 0) e.help.style.opacity = 0;
    if ((this.locT -= dt) <= 0) e.loc.style.opacity = 0;
    if ((this.streetT -= dt) <= 0) e.street.style.opacity = 0;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) e.big.style.display = 'none';
    this.dmgT -= dt;
    e.hud.style.boxShadow = this.dmgT > 0 ? `inset 0 0 120px rgba(200,0,0,${this.dmgT * 1.6})` : (P.health < 25 ? 'inset 0 0 90px rgba(160,0,0,0.35)' : 'none');
    this.drawMinimap();
  }
  drawMinimap() {
    const g = this.g, c = this.mm, W = 300, H = 200, B = this.base, P = g.player, focus = g.focus;
    const zoom = P.vehicle ? Math.max(0.55, 1 - P.vehicle.speed / 70) : 1, S = B.S * zoom, yaw = g.cam.yaw;
    c.save(); c.fillStyle = '#26332a'; c.fillRect(0, 0, W, H);
    c.translate(W / 2, H * 0.62); c.rotate(yaw - Math.PI); c.scale(zoom, zoom);
    c.drawImage(B.canvas, -(B.o + focus.x * B.S), -(B.o + focus.z * B.S));
    c.restore();
    const toScreen = (x, z) => {
      const dx = (x - focus.x) * S, dz = (z - focus.z) * S, a = yaw - Math.PI, cs = Math.cos(a), sn = Math.sin(a);
      return [W / 2 + dx * cs - dz * sn, H * 0.62 + dx * sn + dz * cs];
    };
    // GPS route
    if (g.route) {
      c.strokeStyle = g.routeMission ? '#ffd23f' : '#c46bff'; c.lineWidth = 4; c.lineJoin = c.lineCap = 'round'; c.beginPath();
      g.route.forEach((p, i) => { const [a, b] = toScreen(p[0], p[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.stroke();
    }
    const drawn = this.blipsDrawn = [];   // what the minimap shows this frame (tests compare it with real targets)
    const blip = (x, z, col, r = 5, letter = null, clampEdge = false) => {
      let [a, b] = toScreen(x, z);
      if (clampEdge) { a = Math.max(8, Math.min(W - 8, a)); b = Math.max(8, Math.min(H - 8, b)); }
      else if (a < -10 || a > W + 10 || b < -10 || b > H + 10) return;
      drawn.push({ x, z, col, letter });
      c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); c.stroke();
      if (letter) { c.fillStyle = '#000'; c.font = 'bold 9px Inter'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(letter, a, b + 0.5); }
    };
    for (const it of g.pickups.items) if (it.active) blip(it.pos.x, it.pos.z, { health: '#3cff6a', armor: '#3c9bff', cash: '#7cff7c' }[it.kind] || '#ffa63c', 3);
    if (!g.missions.active) for (const m of g.missions.markers) if (m.mesh.visible && m.def.letter) blip(m.pos.x, m.pos.z, m.def.type === 'side' ? '#5ad2ff' : '#ffd23f', 7, m.def.letter, m.def.type !== 'side');
    if (g.missions.dest) blip(g.missions.dest.x, g.missions.dest.z, '#ffd23f', 6, null, true);
    if (g.waypoint) blip(g.waypoint.x, g.waypoint.z, '#c46bff', 5, null, true);
    for (const pl of g.places?.list || []) blip(pl.pos.x, pl.pos.z, '#' + pl.style.color.toString(16).padStart(6, '0'), 5, pl.style.letter);
    if (this.objectiveMarker) blip(this.objectiveMarker.x, this.objectiveMarker.z, '#ffd23f', 5, '!', true);
    if (g.police.wanted && g.police.searching && g.police.lastKnown) {   // search area
      const [sx, sy] = toScreen(g.police.lastKnown.x, g.police.lastKnown.z); c.strokeStyle = '#ff303099'; c.fillStyle = '#ff303022'; c.lineWidth = 2;
      c.beginPath(); c.arc(sx, sy, 60 * S, 0, 7); c.fill(); c.stroke();
    }
    const flash = Math.floor(g.time * 5) % 2;
    for (const v of g.police.cars) if (!v.dead) blip(v.pos.x, v.pos.z, flash ? '#ff3030' : '#3060ff', 4);
    for (const o of g.police.officers) if (o.alive) blip(o.pos.x, o.pos.z, flash ? '#3060ff' : '#ff3030', 3);
    // player arrow
    const ph = P.vehicle ? P.vehicle.heading : P.yaw, [pa, pb] = toScreen(focus.x, focus.z), a = -(ph - yaw);
    c.save(); c.translate(pa, pb); c.rotate(a); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke(); c.restore();
    // north marker
    const [nx, ny] = toScreen(focus.x, focus.z - 1000); const dx = nx - W / 2, dy = ny - H * 0.62, l = Math.hypot(dx, dy) || 1;
    const k = Math.min((W / 2 - 10) / Math.abs(dx / l || 1e-6), (H * 0.62 - 10) / Math.abs(dy / l || 1e-6), 1e4);
    const mx = Math.max(10, Math.min(W - 10, W / 2 + dx / l * k)), my = Math.max(10, Math.min(H - 10, H * 0.62 + dy / l * k));
    c.fillStyle = '#000a'; c.beginPath(); c.arc(mx, my, 8, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 10px Inter'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', mx, my + 0.5);
    if (g.police.wanted) { c.strokeStyle = flash ? '#ff3030' : '#3060ff'; c.lineWidth = 6; c.strokeRect(0, 0, W, H); }
  }
}
