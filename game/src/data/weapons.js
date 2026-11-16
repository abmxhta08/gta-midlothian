// Per-weapon stats. Edit here to tune. Units: dmg = health points per hit (per pellet for shotguns), rate = seconds
// between shots, mag = rounds per magazine, spread = radians of random spread, recoil = camera kick,
// range = metres, hs = headshot multiplier, reload = seconds, price/ammoPrice = ammo shop dollars.
export const WEAPONS = {
  fists:   { id: 'fists',   name: 'Fists',          slot: 1, melee: true, dmg: 22, rate: 0.45, range: 1.5, hs: 1 },
  bat:     { id: 'bat',     name: 'Baseball Bat',   slot: 2, melee: true, dmg: 42, rate: 0.75, range: 1.9, hs: 1, price: 60 },
  pistol:  { id: 'pistol',  name: 'Pistol',         slot: 3, dmg: 34, rate: 0.2,  mag: 12, spread: 0.005, recoil: 0.018, range: 300, hs: 2.5, reload: 1.3, auto: false, price: 400, ammoPrice: 3 },
  smg:     { id: 'smg',     name: 'SMG',            slot: 4, dmg: 19, rate: 0.075, mag: 30, spread: 0.02, recoil: 0.008, range: 200, hs: 2.0, reload: 1.6, auto: true, twoHand: true, price: 1200, ammoPrice: 2 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun',   slot: 5, dmg: 15, pellets: 8, rate: 0.85, mag: 6, spread: 0.06, recoil: 0.05, range: 60, hs: 1.5, reload: 2.2, auto: false, twoHand: true, price: 1500, ammoPrice: 6 },
  rifle:   { id: 'rifle',   name: 'Carbine Rifle',  slot: 6, dmg: 31, rate: 0.11, mag: 30, spread: 0.008, recoil: 0.012, range: 400, hs: 2.5, reload: 1.9, auto: true, twoHand: true, price: 2600, ammoPrice: 4 },
  sniper:  { id: 'sniper',  name: 'Sniper Rifle',   slot: 7, dmg: 110, rate: 1.3, mag: 5, spread: 0.0015, recoil: 0.06, range: 900, hs: 3, reload: 2.4, auto: false, twoHand: true, scope: 14, sway: 0.012, price: 4000, ammoPrice: 15 },
  stun:    { id: 'stun',    name: 'Stun Grenade',   slot: 8, thrown: true, rate: 0.9, fuse: 1.6, radius: 8, stun: 6, dmg: 0, hs: 1, price: 150, ammoPrice: 150 },
};
export const ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'stun'];
