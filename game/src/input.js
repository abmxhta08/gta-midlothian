export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.sim = new Set(); this.pressedSet = new Set(); this.simPressed = new Set();
    this.mouse = [false, false, false]; this.clicked = [false, false, false]; this.simFire = false; this.simAim = false;
    this.mdx = 0; this.mdy = 0; this.wheel = 0; this.locked = false; this.onLock = null; this.enabled = true;
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'KeyM'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.pressedSet.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('mousedown', (e) => { if (!this.locked) { this.lock(); this.drag = true; return; } this.mouse[e.button] = true; this.clicked[e.button] = true; });
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
  lock() { try { const p = this.canvas.requestPointerLock(); p?.catch?.(() => {}); } catch (e) { /* ignore */ } }
  down(c) { return this.keys.has(c) || this.sim.has(c); }
  pressed(c) { return this.pressedSet.has(c) || this.simPressed.has(c); }
  get fire() { return this.mouse[0] || this.simFire; }
  get aim() { return this.mouse[2] || this.simAim; }
  endFrame() { this.pressedSet.clear(); this.simPressed.clear(); this.clicked.fill(false); this.mdx = 0; this.mdy = 0; this.wheel = 0; }
}
