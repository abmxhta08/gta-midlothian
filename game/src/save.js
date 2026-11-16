// Save game: money, weapons + ammo, outfit, owned vehicles, mission/story progress, collectibles, stats, time.
// Stored in localStorage under KEY with a version number; older versions are migrated step by step.
import { events } from './core/events.js';

export const KEY = 'midlothian-save';
export const VERSION = 2;

export function blankSave() {
  return {
    version: VERSION, created: Date.now(), updated: Date.now(),
    money: 250, hour: 15.5, weather: 'clear',
    weapons: { fists: {}, pistol: { ammo: 12, reserve: 48 } }, current: 'pistol', armor: 0,
    outfit: null, ownedVehicles: [], safehousePos: null,
    missions: { completed: {}, medals: {}, story: 0, heist: null },
    collectibles: [], stunts: [], stats: { kills: 0, headshots: 0, stunts: 0, distance: 0, playTime: 0 },
  };
}

/** Migrations: index = from-version. Each returns the next version's shape. */
const MIGRATIONS = {
  // v1 (pre-versioned): { money, missions: {delivery: n, ...}, quality, hour }
  1: (s) => {
    const n = blankSave();
    n.money = s.money ?? n.money; n.hour = s.hour ?? n.hour;
    n.missions.completed = { ...(s.missions || {}) };
    n.migratedFrom = 1;
    return n;
  },
};

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let s = raw, v = s.version || 1;
  while (v < VERSION) {
    const m = MIGRATIONS[v]; if (!m) throw new Error(`No save migration from v${v}`);
    s = m(s); v = s.version || v + 1;
  }
  const base = blankSave();   // fill any fields added later in the same version
  return { ...base, ...s, missions: { ...base.missions, ...(s.missions || {}) }, stats: { ...base.stats, ...(s.stats || {}) } };
}

export function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
export function loadSave() {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); return raw ? migrate(raw) : null; }
  catch (e) { console.warn('save unreadable, starting fresh', e); return null; }
}
export function deleteSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

/** Collect the current game state into a save object and write it. */
export function writeSave(game) {
  const P = game.player, s = game.save;
  Object.assign(s, {
    version: VERSION, updated: Date.now(), money: P.money, hour: game.hour, weather: game.weather?.kind || 'clear',
    weapons: JSON.parse(JSON.stringify(P.inv)), current: P.current, armor: Math.round(P.armor), outfit: P.outfit,
    collectibles: [...(game.collectibles?.found || [])], stunts: [...(game.stunts?.done || [])],
  });
  try { localStorage.setItem(KEY, JSON.stringify(s)); events.emit('save', s); return true; } catch (e) { return false; }
}

/** Apply a loaded save to a freshly built game. */
export function applySave(game, s) {
  const P = game.player;
  P.money = s.money; P.inv = JSON.parse(JSON.stringify(s.weapons || { fists: {} })); P.armor = s.armor || 0;
  if (!P.inv[s.current]) s.current = 'fists';
  if (s.outfit) P.setOutfit(s.outfit);
  P.equip(s.current);
  game.hour = s.hour ?? 15.5;
}
