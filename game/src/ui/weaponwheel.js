// Weapon wheel: hold the wheel key (Q) to open, time slows to 25%, move the mouse (or right stick) toward a
// weapon, release to equip. Shows ammo for owned weapons.
import { WEAPONS, ORDER } from '../weapons.js';

export class WeaponWheel {
  constructor(game) { this.g = game; this.el = document.getElementById('wheel'); this.open = false; this.sel = null; this.vx = 0; this.vy = 0; }
  update(input) {
    const g = this.g, P = g.player;
    const held = input.down('wheel') && !P.vehicle && g.state === 'play' && !g.menu.open && !g.phone.open;
    if (held && !this.open) { this.open = true; this.vx = this.vy = 0; this.sel = P.current; this.render(); }
    if (!held && this.open) { this.open = false; this.el.style.display = 'none'; if (this.sel && P.inv[this.sel]) P.equip(this.sel); return; }
    if (!this.open) return;
    // steer the selection with mouse delta
    this.vx = Math.max(-80, Math.min(80, this.vx + input.mdx)); this.vy = Math.max(-80, Math.min(80, this.vy + input.mdy));
    input.mdx = 0; input.mdy = 0;   // swallow look input while the wheel is open
    if (Math.hypot(this.vx, this.vy) > 25) {
      const a = (Math.atan2(this.vx, -this.vy) + Math.PI * 2) % (Math.PI * 2), i = Math.round(a / (Math.PI * 2) * ORDER.length) % ORDER.length;
      if (ORDER[i] !== this.sel && P.inv[ORDER[i]]) { this.sel = ORDER[i]; this.render(); }
    }
  }
  /** Time scale while the wheel is open. */
  get timeScale() { return this.open ? 0.25 : 1; }
  render() {
    const P = this.g.player, n = ORDER.length, R = 150;
    this.el.innerHTML = ORDER.map((id, i) => {
      const a = i / n * Math.PI * 2, x = Math.sin(a) * R, y = -Math.cos(a) * R, w = WEAPONS[id], own = P.inv[id], inv = own || {};
      const ammo = !own ? 'locked' : w.melee ? '' : w.thrown ? `×${inv.ammo}` : `${inv.ammo} / ${inv.reserve}`;
      return `<div class="ww${this.sel === id ? ' sel' : ''}${own ? '' : ' no'}" style="transform:translate(${x}px,${y}px)"><b>${w.name}</b><small>${ammo}</small></div>`;
    }).join('') + `<div class="wc">${WEAPONS[this.sel]?.name || ''}</div>`;
    this.el.style.display = 'block';
  }
}
