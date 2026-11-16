// Player settings (separate from the save game so "New Game" keeps them). Stored in localStorage.
import { BRAND_MODE_DEFAULT, setBrandMode } from './brand.js';
import { events } from '../core/events.js';

const KEY = 'midlothian-settings';
export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', jump: 'Space', enter: 'KeyF',
  cover: 'KeyC', wheel: 'KeyQ', reload: 'KeyR', horn: 'KeyH', map: 'KeyM', phone: 'KeyP', radio: 'KeyN', camera: 'KeyV', interact: 'KeyE',
};
export const BIND_LABELS = {
  forward: 'Move forward / accelerate', back: 'Move back / brake', left: 'Left', right: 'Right', sprint: 'Sprint', jump: 'Jump / handbrake / vault',
  enter: 'Enter / exit vehicle', cover: 'Take cover', wheel: 'Weapon wheel (hold)', reload: 'Reload / flip vehicle', horn: 'Horn', map: 'Full map',
  phone: 'Phone', radio: 'Radio station', camera: 'Camera distance', interact: 'Interact (shops, doors)',
};
export const DEFAULTS = {
  volume: 0.8, musicVolume: 0.6, sensitivity: 1, invertY: false, quality: 1, reducedViolence: true,
  brandMode: BRAND_MODE_DEFAULT, density: 1, binds: { ...DEFAULT_BINDS },
};

export const settings = load();
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { s = {}; }
  const out = { ...DEFAULTS, ...s, binds: { ...DEFAULT_BINDS, ...(s.binds || {}) } };
  setBrandMode(out.brandMode);
  return out;
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  setBrandMode(settings.brandMode);
  events.emit('settings', settings);
}
export function setSetting(k, v) { settings[k] = v; saveSettings(); }
export function resetSettings() { Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS))); saveSettings(); }
