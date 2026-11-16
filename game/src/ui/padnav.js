// Gamepad navigation for menus: runs on its own animation frame (menus are open while the game is paused),
// and turns the D-pad / left stick / A / B / Start into the same key events the menus already handle.
const REPEAT = 0.22;

export class PadNav {
  constructor(game) {
    this.g = game; this.prev = {}; this.repeat = 0; this.last = performance.now();
    addEventListener('gamepadconnected', (e) => game.hud?.toast?.(`Controller connected: ${e.gamepad.id.split('(')[0].trim().slice(0, 32)}`));
    const loop = () => { try { this.poll(); } catch (e) { /* never break the UI over a pad glitch */ } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  key(code) { dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); }
  get uiOpen() { const g = this.g; return g.state === 'title' || g.menu.open || g.phone.open || g.settingsUI.open || g.paused; }
  poll() {
    const now = performance.now(), dt = (now - this.last) / 1000; this.last = now;
    this.g.input.uiCapture = this.g.menu.open || this.g.phone.open || this.g.settingsUI.open;
    const pads = navigator.getGamepads?.() || [], p = [...pads].find(x => x && x.connected); if (!p) return;
    const b = (i) => !!p.buttons[i]?.pressed, ly = p.axes[1] || 0;
    const st = { up: b(12) || ly < -0.6, down: b(13) || ly > 0.6, a: b(0), b: b(1), start: b(9) };
    const edge = (k) => st[k] && !this.prev[k];
    const g = this.g;
    if (edge('start')) {
      if (g.state === 'play' && !g.paused && !g.menu.open && !g.phone.open) g.pause(true);
      else if (g.state === 'play' && g.paused && !g.settingsUI.open && !g.menu.open) g.start();
    }
    if (this.uiOpen) {
      const dir = st.up ? 'ArrowUp' : st.down ? 'ArrowDown' : null;
      if (dir && (edge(st.up ? 'up' : 'down') || (this.repeat -= dt) <= 0)) { this.key(dir); this.repeat = edge(st.up ? 'up' : 'down') ? REPEAT * 2 : REPEAT; }
      if (edge('a')) { if (g.paused && g.state === 'play' && !g.menu.open && !g.phone.open && !g.settingsUI.open) g.start(); else this.key('Enter'); }
      if (edge('b')) this.key('Escape');
    }
    this.prev = st;
  }
}
