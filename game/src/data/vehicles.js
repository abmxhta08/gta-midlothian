// Vehicle handling table. model = body profile in entities/carmodels.js (or 'motorcycle'/'bicycle').
// vmax m/s, engine m/s^2, brake m/s^2, grip = lateral grip, drift = grip with handbrake, steer = max wheel angle (rad),
// health = damage points before fire, mass = collision weight, traffic = relative spawn weight in AI traffic.
export const VEHICLES = {
  sedan:      { label: 'Sedan',          model: 'sedan',   vmax: 46, engine: 11.5, brake: 26, grip: 8.5, drift: 1.6, steer: 0.62, health: 1000, mass: 1.0,  traffic: 6 },
  compact:    { label: 'Compact',        model: 'compact', vmax: 40, engine: 11.0, brake: 27, grip: 9.0, drift: 1.7, steer: 0.66, health: 800,  mass: 0.8,  traffic: 4 },
  hatch:      { label: 'Hatchback',      model: 'hatch',   vmax: 42, engine: 10.8, brake: 26, grip: 8.8, drift: 1.6, steer: 0.64, health: 850,  mass: 0.85, traffic: 3 },
  suv:        { label: 'SUV',            model: 'suv',     vmax: 43, engine: 10.5, brake: 24, grip: 7.8, drift: 1.8, steer: 0.58, health: 1300, mass: 1.35, traffic: 4 },
  pickup:     { label: 'Pickup',         model: 'pickup',  vmax: 42, engine: 10.0, brake: 23, grip: 7.5, drift: 1.8, steer: 0.56, health: 1400, mass: 1.5,  traffic: 3 },
  van:        { label: 'Van',            model: 'van',     vmax: 36, engine: 8.5,  brake: 21, grip: 7.0, drift: 2.0, steer: 0.52, health: 1500, mass: 1.7,  traffic: 2 },
  taxi:       { label: 'Taxi',           model: 'sedan',   vmax: 45, engine: 11.2, brake: 26, grip: 8.5, drift: 1.6, steer: 0.62, health: 1000, mass: 1.0,  traffic: 1, color: 0xf2c21b, sign: true },
  muscle:     { label: 'Muscle Car',     model: 'muscle',  vmax: 55, engine: 14.5, brake: 25, grip: 7.6, drift: 1.3, steer: 0.6,  health: 1100, mass: 1.15, traffic: 1 },
  bus:        { label: 'Bus',            model: 'bus',     vmax: 26, engine: 5.5,  brake: 16, grip: 6.5, drift: 2.4, steer: 0.5,  health: 3000, mass: 4.0,  traffic: 0.4, color: 0x2a5d9a },
  police:     { label: 'Police Cruiser', model: 'police',  vmax: 54, engine: 13.5, brake: 28, grip: 9.2, drift: 1.6, steer: 0.62, health: 1400, mass: 1.1,  traffic: 0 },
  swat:       { label: 'Tactical Van',   model: 'swat',    vmax: 40, engine: 10.5, brake: 24, grip: 7.6, drift: 2.0, steer: 0.54, health: 2500, mass: 2.0,  traffic: 0 },
  motorcycle: { label: 'Motorcycle',     model: 'motorcycle', bike: true, vmax: 52, engine: 15, brake: 28, grip: 9.5, drift: 2.2, steer: 0.55, health: 500, mass: 0.4, traffic: 0 },
  bicycle:    { label: 'Bicycle',        model: 'bicycle', bike: true, pedal: true, vmax: 12, engine: 3.2, brake: 12, grip: 10, drift: 3, steer: 0.6, health: 200, mass: 0.15, traffic: 0 },
};
export const TRAFFIC_TYPES = Object.entries(VEHICLES).filter(([, v]) => v.traffic > 0);
export function randomTrafficType(r = Math.random) {
  const tot = TRAFFIC_TYPES.reduce((a, [, v]) => a + v.traffic, 0); let x = r() * tot;
  for (const [k, v] of TRAFFIC_TYPES) { x -= v.traffic; if (x <= 0) return k; }
  return 'sedan';
}
