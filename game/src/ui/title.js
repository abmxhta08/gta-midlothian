// Title screen: Continue (if a save exists), New Game (confirms before wiping), Settings.
import { hasSave, deleteSave, loadSave } from '../save.js';

export class Title {
  constructor(game) {
    this.g = game; this.el = document.getElementById('title'); this.open = false; this.i = 0;
    addEventListener('keydown', (e) => {
      if (!this.open || game.settingsUI.open) return;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.move(1);
      else if (['ArrowUp', 'KeyW'].includes(e.code)) this.move(-1);
      else if (['Enter', 'Space'].includes(e.code)) this.choose();
      else if (e.code === 'Escape' && this.confirming) { this.confirming = false; this.render(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  items() {
    if (this.confirming) return [{ id: 'confirm', label: 'Yes, start over (erases your save)' }, { id: 'cancel', label: 'Cancel' }];
    const s = hasSave() ? loadSave() : null, out = [];
    if (s) out.push({ id: 'continue', label: 'Continue', sub: `$${(s.money || 0).toLocaleString()} · story ${s.missions?.story || 0}/10` });
    out.push({ id: 'new', label: 'New Game' }, { id: 'settings', label: 'Settings' });
    return out;
  }
  show() { this.open = true; this.g.paused = true; this.g.state = 'title'; this.i = 0; this.confirming = false; this.render(); }
  hide() { this.open = false; this.el.style.display = 'none'; }
  move(d) { const n = this.items().length; this.i = (this.i + d + n) % n; this.render(); }
  choose(i = this.i) {
    const it = this.items()[i]; if (!it) return;
    if (it.id === 'continue') { this.hide(); this.g.start(); }
    else if (it.id === 'new') { if (hasSave()) { this.confirming = true; this.i = 1; this.render(); } else { this.hide(); this.g.start(); } }
    else if (it.id === 'confirm') { deleteSave(); location.search = '?newgame=1&title=0'; }
    else if (it.id === 'cancel') { this.confirming = false; this.i = 0; this.render(); }
    else if (it.id === 'settings') { this.el.style.display = 'none'; this.g.settingsUI.show(() => this.render()); }
  }
  render() {
    const items = this.items();
    this.el.innerHTML = `<div class="tbox"><h1>MIDLOTHIAN</h1><div class="tsub">${this.confirming ? 'Start a new game? Your current save will be erased.' : 'A Virginia story'}</div>` +
      items.map((it, i) => `<div class="titem${i === this.i ? ' sel' : ''}" data-i="${i}">${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</div>`).join('') +
      `<div class="tfoot">↑↓ / mouse to choose · Enter to select · build ${this.g.BUILD}</div></div>`;
    this.el.style.display = 'flex';
    for (const d of this.el.querySelectorAll('.titem')) { d.onclick = () => { this.i = +d.dataset.i; this.choose(); }; d.onmouseenter = () => { this.i = +d.dataset.i; for (const o of this.el.querySelectorAll('.titem')) o.classList.toggle('sel', +o.dataset.i === this.i); }; }
  }
}
