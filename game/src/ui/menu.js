// Generic modal list menu (shops, safehouse, crew selection, choices). Keyboard (arrows/W/S, Enter, Esc),
// mouse and gamepad friendly. Pauses the game while open.
export class Menu {
  constructor(game) {
    this.g = game; this.el = document.getElementById('menu'); this.open = false; this.items = []; this.i = 0;
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.move(1);
      else if (['ArrowUp', 'KeyW'].includes(e.code)) this.move(-1);
      else if (['Enter', 'Space', 'KeyE'].includes(e.code)) this.choose(this.i);
      else if (['Escape', 'Backspace', 'KeyQ'].includes(e.code)) this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  /** show(title, items: [{label, sub?, price?, disabled?, action: () => (string|void)}], opts) */
  show(title, items, opts = {}) {
    this.title = title; this.items = items; this.i = Math.max(0, items.findIndex(x => !x.disabled)); this.opts = opts; this.open = true;
    this.g.paused = true; document.exitPointerLock?.(); this.render();
  }
  move(d) { if (!this.items.length) return; let n = this.i; for (let k = 0; k < this.items.length; k++) { n = (n + d + this.items.length) % this.items.length; if (!this.items[n].disabled) break; } this.i = n; this.render(); }
  choose(i) {
    const it = this.items[i]; if (!it || it.disabled) return;
    const msg = it.action?.(); if (msg) this.msg = msg;
    if (it.close !== false && !this.opts.stay) this.close(); else { if (this.opts.refresh) this.items = this.opts.refresh(); this.render(); }
  }
  close() { if (!this.open) return; this.open = false; this.el.style.display = 'none'; this.g.paused = false; this.g.input.lock(); this.opts.onClose?.(); this.msg = ''; }
  render() {
    const money = this.g.player.money;
    this.el.innerHTML = `<div class="mt">${this.title}</div>${this.opts.subtitle ? `<div class="ms">${this.opts.subtitle}</div>` : ''}<div class="mm">$${money.toLocaleString()}</div>` +
      this.items.map((it, i) => `<div class="mi${i === this.i ? ' sel' : ''}${it.disabled ? ' dis' : ''}" data-i="${i}"><span>${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</span><b>${it.price != null ? (it.price ? '$' + it.price : 'Free') : (it.right || '')}</b></div>`).join('') +
      `<div class="mh">${this.msg ? `<span class="ok">${this.msg}</span>` : '↑↓ choose · Enter select · Esc close'}</div>`;
    this.el.style.display = 'block';
    for (const d of this.el.querySelectorAll('.mi')) {
      d.onclick = () => this.choose(+d.dataset.i);
      d.onmouseenter = () => {   // only move the highlight (a full re-render here would retrigger mouseenter forever)
        if (this.items[+d.dataset.i].disabled) return;
        this.i = +d.dataset.i; for (const o of this.el.querySelectorAll('.mi')) o.classList.toggle('sel', +o.dataset.i === this.i);
      };
    }
  }
}
