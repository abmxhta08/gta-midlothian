// Minimal event bus for cross-system messages, e.g.
//   events.on('crime', ({ kind, pos }) => ...);  events.emit('crime', { kind, pos });
// Events in use: crime, wanted, money, pedKilled, explosion, vehicleEnter, vehicleExit, pickup, collectible,
// stunt, missionStart, missionPass, missionFail, weather, shop, save, settings.
const handlers = new Map();
export const events = {
  on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name)?.delete(fn); },
  once(name, fn) { const off = events.on(name, (d) => { off(); fn(d); }); return off; },
  emit(name, data) {
    const set = handlers.get(name); if (!set) return;
    for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(`[events] ${name} handler failed`, e); } }
  },
  clear() { handlers.clear(); },
};
