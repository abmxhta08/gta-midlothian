// Owned vehicles: store at the safehouse, take them out again, or have one delivered (phone).
import { Vehicle } from '../entities/vehicle.js';
import { writeSave } from '../save.js';

const MAX = 6;
export class Garage {
  constructor(game) { this.g = game; }
  list() { return (this.g.save.ownedVehicles || []).map(o => ({ ...o, label: o.label || o.type })); }
  store(v) {
    const g = this.g, own = g.save.ownedVehicles = g.save.ownedVehicles || [];
    if (own.length >= MAX) return 'Garage full (6 vehicles)';
    own.push({ type: v.type, color: v.color, label: v.h.label });
    if (g.player.vehicle === v) g.exitVehicle(true);
    g.removeVehicle(v); writeSave(g);
    return `${v.h.label} stored`;
  }
  /** Spawn owned vehicle i next to (x,z) or the safehouse. */
  retrieve(i, x, z) {
    const g = this.g, o = (g.save.ownedVehicles || [])[i]; if (!o) return 'No such vehicle';
    const home = g.places.get('safehouse'), px = x ?? home?.pos.x ?? g.player.pos.x, pz = z ?? home?.pos.z ?? g.player.pos.z;
    const n = g.map.nearestRoad(px, pz, 60, r => r.type !== 'service'), v = new Vehicle(g, o.type, o.color);
    if (n) v.setPose(n.px - n.dz * (n.road.w / 2 - 1.3), n.pz + n.dx * (n.road.w / 2 - 1.3), Math.atan2(n.dx, n.dz)); else v.setPose(px + 3, pz, 0);
    v.owned = true; g.vehicles.push(v);
    g.save.ownedVehicles.splice(i, 1); writeSave(g);
    g.setWaypoint(v.pos.x, v.pos.z);
    return `${o.label || o.type} is parked outside`;
  }
}
