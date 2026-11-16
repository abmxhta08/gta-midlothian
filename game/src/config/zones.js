// Runtime queries for the school safe zones defined in safezones.js.
import { SAFE_ZONES } from './safezones.js';
import { pip, bbox } from '../util.js';

const Z = SAFE_ZONES.map(z => ({ ...z, bb: bbox(z.pts) }));
export const zones = {
  list: Z,
  /** Zone containing (x,z), or null. pad grows each zone's box (metres) for "near" checks. */
  at(x, z, pad = 0) {
    for (const s of Z) if (x >= s.bb.minx - pad && x <= s.bb.maxx + pad && z >= s.bb.minz - pad && z <= s.bb.maxz + pad && (pad ? true : pip(x, z, s.pts))) return s;
    return null;
  },
  inSafeZone(x, z) { return !!zones.at(x, z); },
  /** True if a point is in or within `margin` metres of any safe zone (used to keep missions/combat away). */
  nearSafeZone(x, z, margin = 40) {
    for (const s of Z) {
      if (x < s.bb.minx - margin || x > s.bb.maxx + margin || z < s.bb.minz - margin || z > s.bb.maxz + margin) continue;
      if (pip(x, z, s.pts)) return true;
      for (let i = 0; i < s.pts.length; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length], abx = b[0] - a[0], abz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz || 1)));
        if (Math.hypot(x - a[0] - abx * t, z - a[1] - abz * t) < margin) return true;
      }
    }
    return false;
  },
};
