// Witness rules for crimes. A crime only raises the wanted level if someone saw it:
//  - a police officer or police car with line of sight within COP_RANGE  -> immediate
//  - a pedestrian with line of sight within PED_RANGE                    -> they phone it in after CALL_DELAY s
//    (the call is cancelled if that pedestrian is knocked down or killed first)
// Crimes committed against the police are always witnessed.
export const COP_RANGE = 90, PED_RANGE = 45, CALL_DELAY = 6;
const ALWAYS = new Set(['copkill', 'copcar']);

export function los(grid, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (d < 1.5) return true;
  return grid.ray(a.x, a.z, dx / d, dz / d, d - 1) === Infinity;
}

/** Returns { cop: bool, ped: Ped|null } describing who saw a crime at pos. */
export function findWitness(game, pos, victim = null) {
  const grid = game.world.grid;
  for (const c of game.police.cars) if (!c.dead && c.pos.distanceTo(pos) < COP_RANGE && los(grid, c.pos, pos)) return { cop: true, ped: null };
  for (const o of game.police.officers) if (o.alive && o.pos.distanceTo(pos) < COP_RANGE && los(grid, o.pos, pos)) return { cop: true, ped: null };
  let best = null, bd = PED_RANGE;
  for (const p of game.peds.list) {
    if (!p.alive || p.cop || p === victim || p.inVehicle || p.state === 'knocked' || p.gang) continue;
    const d = p.pos.distanceTo(pos); if (d < bd && los(grid, p.pos, pos)) { bd = d; best = p; }
  }
  return { cop: false, ped: best };
}

/** Tracks pending 911 calls from pedestrian witnesses. */
export class WitnessCalls {
  constructor(game) { this.game = game; this.pending = []; }
  /** Returns true if the crime should apply right now (cop saw it). */
  report(kind, pos, victim = null) {
    if (ALWAYS.has(kind)) return true;
    const w = findWitness(this.game, pos, victim);
    if (w.cop) return true;
    if (w.ped && !this.pending.some(c => c.ped === w.ped)) {
      this.pending.push({ kind, pos: pos.clone(), ped: w.ped, t: CALL_DELAY });
      w.ped.calling = CALL_DELAY;
    }
    return false;
  }
  update(dt, apply) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i]; c.t -= dt;
      if (!c.ped.alive || c.ped.state === 'knocked') { this.pending.splice(i, 1); continue; }
      if (c.t <= 0) { this.pending.splice(i, 1); c.ped.calling = 0; apply(c.kind, c.pos, true); }
    }
  }
  clear() { this.pending.length = 0; }
}
