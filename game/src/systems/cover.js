// Cover detection: walls (buildings, trees, poles, parked cars from the collision grid) and dynamic vehicles.
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.sin(i / 16 * Math.PI * 2), Math.cos(i / 16 * Math.PI * 2)]);

/** Find cover next to (x,z). Returns { nx, nz (normal pointing away from cover), dist, tx, tz (tangent) } or null. */
export function findCover(game, x, z, maxD = 1.6) {
  let best = null, bd = maxD;
  const grid = game.world.grid;
  for (const [dx, dz] of DIRS) {
    const t = grid.ray(x, z, dx, dz, maxD);
    if (t < bd) { bd = t; best = { nx: -dx, nz: -dz, dist: t }; }
  }
  for (const v of game.vehicles) {
    if (v === game.player.vehicle || v.speed > 1 || Math.abs(v.pos.x - x) > 5 || Math.abs(v.pos.z - z) > 5) continue;
    for (const [cx, cz] of v.circles()) {
      const dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz) - v.radius;
      if (d < bd) { bd = d; best = { nx: -dx / (d + v.radius), nz: -dz / (d + v.radius), dist: d, vehicle: v }; }
    }
  }
  if (best) { best.tx = -best.nz; best.tz = best.nx; }
  return best;
}

/** Is there still cover behind a point (used to stop sliding past the end of a wall)? */
export function coverBehind(game, x, z, nx, nz, maxD = 1.1) {
  if (game.world.grid.ray(x, z, -nx, -nz, maxD) < maxD) return true;
  for (const v of game.vehicles) if (v.speed < 1 && v.contains(x - nx * 0.8, z - nz * 0.8, 0.2)) return true;
  return false;
}

/** Low obstacle directly ahead that can be vaulted (parked cars, hydrants, stopped vehicles). */
export function vaultTarget(game, x, z, fx, fz) {
  const grid = game.world.grid, t = grid.ray(x, z, fx, fz, 1.4);
  let low = false;
  if (t < 1.4 && (grid.rayTag === 4 || grid.rayTag === 3)) low = true;
  for (const v of game.vehicles) if (v !== game.player.vehicle && v.speed < 1 && v.dims.h < 2.2 && v.contains(x + fx * 1.1, z + fz * 1.1, 0.1)) low = true;
  if (!low) return null;
  for (const d of [2.6, 3.2, 3.8]) {
    const lx = x + fx * d, lz = z + fz * d;
    if (game.world.clear(lx, lz, 0.4) && !game.vehicles.some(v => v.contains(lx, lz, 0.4))) return { x: lx, z: lz };
  }
  return null;
}
