// Interactive places: shops (clothes, snacks, sporting goods), gas station, paint shop, safehouse,
// hospital + police station respawn points. Locations are picked from real map data where the business
// type matches (clothing store, grocery, fuel, car repair); weapons and police use invented names and
// are placed at unnamed buildings so no real business is shown selling guns.
import * as THREE from 'three';
import { WEAPONS, ORDER } from '../weapons.js';
import { OUTFITS, SNACKS, PAINTS_SHOP, PAINT_PRICE, REPAIR_PRICE, ARMOR_PRICE } from '../data/shops.js';
import { brandName } from '../config/brand.js';
import { centroid, signedArea } from '../util.js';
import { events } from '../core/events.js';
import { writeSave } from '../save.js';
import { radial } from '../textures.js';

const glow = radial('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
export const PLACE_STYLE = {
  clothes: { color: 0xff7ad0, letter: 'C', label: 'Clothes' }, snacks: { color: 0x7cff7c, letter: 'F', label: 'Food' },
  ammo: { color: 0xffa63c, letter: 'A', label: 'Sporting goods' }, gas: { color: 0xffe14a, letter: 'G', label: 'Gas & repair' },
  paint: { color: 0x8ad8ff, letter: 'P', label: 'Paint shop' }, safehouse: { color: 0xffffff, letter: 'H', label: 'Safehouse' },
  hospital: { color: 0xff5a5a, letter: '+', label: 'EMS station' }, police: { color: 0x4a7cff, letter: '★', label: 'Police station' },
};

export class Places {
  constructor(game) {
    this.g = game; this.list = []; this.near = null;
    const d = game.data, poi = (kinds) => d.pois.filter(p => kinds.includes(p.kind)).sort((a, b) => Math.hypot(...a.p) - Math.hypot(...b.p));
    const foot = game.world.footprints;
    const unnamedCommercial = foot.filter(f => f.kind === 'commercial' && !f.name && Math.abs(signedArea(f.pts)) > 350 && !game.zones.nearSafeZone(...centroid(f.pts), 60));
    // marker spot: nearest sidewalk, else the nearest open ground next to a road (never inside the building,
    // which is where respawns and drop-offs happen)
    const open = (x, z) => game.world.clear(x, z, 0.8) && !game.map.inWater?.(x, z);
    const at = (kind, name, x, z) => {
      let sp = game.peds.nearestSidewalk(x, z, 80);
      if (!sp || !open(sp.x, sp.z)) {
        sp = null;
        for (const needRoad of [true, false]) { for (let r = 3; r <= 120 && !sp; r += 3) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r; if (open(px, pz) && (!needRoad || game.map.nearestRoad(px, pz, 25, q => q.type !== 'service'))) { sp = { x: px, z: pz }; break; } } if (sp) break; }
      }
      sp = sp || { x, z };
      this.add(kind, name, sp.x, sp.z);
    };
    const c = poi(['clothes'])[0]; if (c) at('clothes', c.name, ...c.p);
    const s = poi(['supermarket', 'convenience', 'bakery'])[0]; if (s) at('snacks', s.name, ...s.p);
    const fuel = poi(['fuel'])[0]; if (fuel) at('gas', fuel.name, ...fuel.p);
    const rep = poi(['car_repair'])[0]; if (rep) at('paint', 'Midlothian Paint & Tune', ...rep.p);   // invented service name at a repair-shop location
    // invented businesses at unnamed commercial buildings, spread apart
    const pickFoot = (cx, cz, avoid = []) => unnamedCommercial.filter(f => avoid.every(a => Math.hypot(...centroid(f.pts).map((v, i) => v - a[i])) > 400)).sort((a, b) => Math.hypot(centroid(a.pts)[0] - cx, centroid(a.pts)[1] - cz) - Math.hypot(centroid(b.pts)[0] - cx, centroid(b.pts)[1] - cz))[0];
    const ammoF = pickFoot(600, -500); if (ammoF) at('ammo', 'Turnpike Sporting Goods', ...centroid(ammoF.pts));
    const polF = pickFoot(-400, -300, ammoF ? [centroid(ammoF.pts)] : []); if (polF) at('police', 'Midlothian Police Substation', ...centroid(polF.pts));
    const ems = game.map.locations.find(l => /ems|fire/i.test(l.name)); if (ems) at('hospital', ems.name, ...ems.c);
    // safehouse: the closest house to the player's start
    const sp = game.spawnPoint || { x: 120, z: -80 };
    const houses = foot.filter(f => f.kind === 'house' && !game.zones.nearSafeZone(...centroid(f.pts), 40)).sort((a, b) => Math.hypot(centroid(a.pts)[0] - sp.x, centroid(a.pts)[1] - sp.z) - Math.hypot(centroid(b.pts)[0] - sp.x, centroid(b.pts)[1] - sp.z));
    if (houses[0]) {   // marker on the front lawn, between the house and the street
      const [hx, hz] = centroid(houses[0].pts), n = game.map.nearestRoad(hx, hz, 80, r => r.type !== 'service');
      if (n) { const dx = n.px - hx, dz = n.pz - hz, d = Math.hypot(dx, dz) || 1, k = Math.max(0, d - n.road.w / 2 - 5) / d; this.add('safehouse', 'Your Safehouse', hx + dx * k, hz + dz * k); }
      else at('safehouse', 'Your Safehouse', hx, hz);
    }
  }
  add(kind, name, x, z) {
    const st = PLACE_STYLE[kind], g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.y = 0.06; g.add(ring);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: st.color, transparent: true, depthWrite: false, opacity: 0.35, blending: THREE.AdditiveBlending })); sp.position.y = 0.9; sp.scale.set(0.7, 1.6, 1); g.add(sp);
    g.position.set(x, 0, z); this.g.scene.add(g);
    const p = { kind, name, pos: new THREE.Vector3(x, 0, z), mesh: g, style: st };
    this.list.push(p); return p;
  }
  get(kind) { return this.list.find(p => p.kind === kind); }
  display(p) { return brandName(p.name, p.kind === 'snacks' ? 'supermarket' : p.kind === 'gas' ? 'fuel' : p.kind === 'clothes' ? 'clothes' : null); }
  update(dt) {
    const g = this.g, P = g.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    let near = null;
    for (const p of this.list) { p.mesh.children[1].material.opacity = 0.25 + Math.sin(g.time * 3) * 0.1; if (Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z) < (P.vehicle ? 4 : 2.2)) near = p; }
    if (near !== this.near) { this.near = near; if (near) g.hud.help(`<b>${this.display(near)}</b><br>Press <b>E</b> to ${near.kind === 'safehouse' ? 'use the safehouse' : 'enter'}.`, 4); }
    if (near && g.input.pressed('interact') && !g.menu.open && g.state === 'play') this.open(near);
  }
  open(p) {
    const g = this.g, P = g.player, M = g.menu, title = this.display(p), buy = (price, fn) => { if (P.money < price) return 'Not enough money'; g.addMoney(-price); g.audio.cash(); return fn(); };
    if (p.kind === 'ammo') {
      const items = () => {
        const out = [];
        for (const id of ORDER) {
          const w = WEAPONS[id]; if (!w.price) continue;
          if (!P.inv[id]) out.push({ label: w.name, sub: 'Buy weapon', price: w.price, action: () => buy(w.price, () => { P.give(id, w.thrown ? 3 : w.mag * 2); P.equip(id); return `Bought ${w.name}`; }) });
          else if (!w.melee) { const n = w.thrown ? 3 : w.mag * 3, pr = w.thrown ? w.ammoPrice * 3 : w.ammoPrice * n; out.push({ label: `${w.name} ammo`, sub: `+${n}`, price: pr, action: () => buy(pr, () => { P.give(id, n); return `+${n} ${w.name} ammo`; }) }); }
        }
        out.push({ label: 'Body armor', sub: P.armor >= 100 ? 'Full' : 'Full protection', price: ARMOR_PRICE, disabled: P.armor >= 100, action: () => buy(ARMOR_PRICE, () => { P.armor = 100; return 'Armor on'; }) });
        return out;
      };
      M.show(title, items(), { stay: true, refresh: items });
    } else if (p.kind === 'clothes') {
      const owned = new Set(g.save.outfits || ['default']), found = g.collectibles?.found.size || 0;
      const items = () => OUTFITS.map(o => {
        const locked = o.unlock === 'collectibles' && found < 20, has = owned.has(o.id);
        return { label: o.name, sub: locked ? 'Find all 20 coal tokens' : has ? 'Owned' : '', price: has || locked ? null : o.price, right: has ? 'Wear' : locked ? 'Locked' : '', disabled: locked,
          action: () => { if (has) { P.setOutfit(o.o); return `Wearing ${o.name}`; } return buy(o.price, () => { owned.add(o.id); g.save.outfits = [...owned]; P.setOutfit(o.o); writeSave(g); return `Bought ${o.name}`; }); } };
      });
      M.show(title, items(), { stay: true, refresh: items, subtitle: 'Clothing' });
    } else if (p.kind === 'snacks') {
      M.show(title, SNACKS.map(s => ({ label: s.name, sub: `+${s.heal} health`, price: s.price, action: () => buy(s.price, () => { P.health = Math.min(100, P.health + s.heal); if (s.stamina) P.stamina = 100; return `Ate ${s.name}`; }) })), { stay: true, subtitle: 'Snacks & drinks' });
    } else if (p.kind === 'gas') {
      const v = P.vehicle;
      M.show(title, [
        { label: 'Fill up & quick repair', sub: v ? `${Math.round(v.health / v.maxHealth * 100)}% condition` : 'Drive in with a vehicle', price: REPAIR_PRICE, disabled: !v, action: () => buy(REPAIR_PRICE, () => { v.repair(); return 'Vehicle repaired'; }) },
        { label: 'Snack from the counter', sub: '+25 health', price: 8, action: () => buy(8, () => { P.health = Math.min(100, P.health + 25); return 'Tasty'; }) },
      ], { subtitle: 'Gas station', stay: true });
    } else if (p.kind === 'paint') {
      const v = P.vehicle;
      if (!v) return void g.hud.toast('Drive a vehicle in to get a respray');
      M.show(title, PAINTS_SHOP.map(c => ({ label: c.name, sub: 'Respray + repair, cools off the cops', price: PAINT_PRICE, action: () => buy(PAINT_PRICE, () => {
        v.setColor(c.hex); v.repair(); const w = g.police.wanted;
        if (w) { g.police.setWanted(Math.max(0, w - 2)); g.police.coolOff(10); }
        events.emit('paint', { vehicle: v, color: c.hex });
        return w ? `Fresh paint. The cops lose track of you${g.police.wanted ? ' (partly)' : ''}.` : 'Looking sharp';
      }) })), { subtitle: 'Respray changes your look and clears up to 2 wanted stars' });
    } else if (p.kind === 'safehouse') {
      M.show(title, [
        { label: 'Save game', action: () => (writeSave(g) ? 'Game saved' : 'Could not save') , close: false },
        { label: 'Sleep 6 hours', sub: 'Heal and skip time', disabled: g.police.wanted > 0, action: () => { g.skipHours(6); P.health = 100; writeSave(g); return 'You feel rested'; } },
        { label: 'Wardrobe', sub: 'Outfits you own', action: () => setTimeout(() => this.open({ ...this.get('clothes') || p, kind: 'clothes', name: 'Wardrobe' }), 0) },
        { label: 'Store current vehicle', sub: P.vehicle ? P.vehicle.h.label : 'Arrive in a vehicle', disabled: !P.vehicle || P.vehicle.police, action: () => g.garage.store(P.vehicle) },
        ...g.garage.list().map((o, i) => ({ label: `Take out: ${o.label}`, sub: 'From your garage', action: () => g.garage.retrieve(i) })),
      ], { stay: true, subtitle: g.police.wanted ? 'Lose the cops before you can sleep' : 'Home sweet home' });
    } else if (p.kind === 'hospital' || p.kind === 'police') {
      M.show(title, [{ label: p.kind === 'hospital' ? 'Get patched up' : 'Nothing to see here', price: p.kind === 'hospital' ? 150 : null, disabled: p.kind !== 'hospital' || P.health >= 100, action: () => buy(150, () => { P.health = 100; return 'Fully healed'; }) }], { subtitle: PLACE_STYLE[p.kind].label });
    }
  }
}
