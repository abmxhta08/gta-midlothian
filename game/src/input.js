import { settings } from './config/settings.js';

/** Keyboard + mouse + gamepad input. down()/pressed() accept either a key code ('KeyW') or an action name
 *  ('forward', 'jump', ...) which is resolved through the rebindable settings.binds map. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.sim = new Set(); this.pressedSet = new Set(); this.simPressed = new Set();
    this.mouse = [false, false, false]; this.clicked = [false, false, false]; this.simFire = false; this.simAim = false;
    this.mdx = 0; this.mdy = 0; this.wheel = 0; this.locked = false; this.onLock = null; this.enabled = true; this.gamepad = null; this.padPrev = {};
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'KeyM', 'KeyQ'].includes(e.code) && e.target === document.body) e.preventDefault();
      if (e.repeat || e.target?.tagName === 'INPUT') return;
      this.keys.add(e.code); this.pressedSet.add(e.code); this.lastKey = e.code;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.fill(false); });
    canvas.addEventListener('mousedown', (e) => { this.mouse[e.button] = true; this.clicked[e.button] = true; if (!this.locked) { this.lock(); this.drag = true; } });
    addEventListener('mouseup', (e) => { this.mouse[e.button] = false; this.drag = false; });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.fill(false); }
      this.onLock?.(this.locked);
    });
    // mouse look when locked; drag-to-look fallback if the browser refuses pointer lock
    document.addEventListener('mousemove', (e) => { if (this.locked || this.drag) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  lock() { try { const p = this.canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch (e) { /* denied: drag-to-look still works */ } }
  code(x) { return settings.binds[x] || x; }
  down(x) {
    const c = this.code(x);
    if (this.keys.has(c) || this.sim.has(x) || this.sim.has(c)) return true;
    if (x === 'sprint' && this.keys.has('ShiftRight')) return true;
    return !!this.padDown(x);
  }
  pressed(x) { const c = this.code(x); return this.pressedSet.has(c) || this.simPressed.has(x) || this.simPressed.has(c) || !!this.padPressed?.[x]; }
  get fire() { return this.mouse[0] || this.simFire || !!this.gamepad?.rt; }
  get aim() { return this.mouse[2] || this.simAim || !!this.gamepad?.lt; }

  /** Poll the Gamepad API once per frame (standard mapping). */
  pollGamepad() {
    if (this.simPad) { this.gamepad = this.simPad; this.padPressed = null; return; }
    const pads = navigator.getGamepads?.() || []; const p = [...pads].find(x => x && x.connected);
    if (!p) { this.gamepad = null; this.padPressed = null; return; }
    const b = (i) => !!p.buttons[i]?.pressed, ax = (i) => Math.abs(p.axes[i] || 0) > 0.15 ? p.axes[i] : 0;
    const g = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: (p.buttons[6]?.value || 0) > 0.3, rt: (p.buttons[7]?.value || 0) > 0.3,
      back: b(8), start: b(9), ls: b(10), rs: b(11), up: b(12), down: b(13), left: b(14), right: b(15) };
    // map buttons to actions
    const act = { jump: g.x, enter: g.y, sprint: g.a, cover: g.rb, reload: g.b, wheel: g.lb, map: g.back, phone: g.up, radio: g.right, horn: g.ls, camera: g.rs, interact: g.down };
    if (this.uiCapture) for (const k in act) act[k] = false;   // a menu/phone is open: the pad drives that instead (ui/padnav.js)
    this.padPressed = {}; for (const k in act) { if (act[k] && !this.padPrev[k]) this.padPressed[k] = true; }
    this.padPrev = act; this.padAct = act; this.gamepad = g;
    this.mdx += g.rx * 14; this.mdy += g.ry * 10;
  }
  padDown(x) {
    if (!this.gamepad) return false; const g = this.gamepad;
    if (x === 'forward') return g.ly < -0.4 || (g.rt && false); if (x === 'back') return g.ly > 0.4; if (x === 'left') return g.lx < -0.4; if (x === 'right') return g.lx > 0.4;
    return !!this.padAct?.[x];
  }
  endFrame() { this.pressedSet.clear(); this.simPressed.clear(); this.clicked.fill(false); this.mdx = 0; this.mdy = 0; this.wheel = 0; this.padPressed = null; }
}
