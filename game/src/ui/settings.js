// Settings panel: volume, sensitivity, invert Y, graphics quality, reduced violence, brand mode, density, keybinds.
import { settings, saveSettings, resetSettings, BIND_LABELS } from '../config/settings.js';
import { QUALITY } from '../post.js';

export class SettingsUI {
  constructor(game) { this.g = game; this.el = document.getElementById('settings'); this.open = false; this.waitBind = null;
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (this.waitBind) { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') { settings.binds[this.waitBind] = e.code; saveSettings(); } this.waitBind = null; this.render(); return; }
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    }, true);
  }
  show(onClose) { this.open = true; this.onClose = onClose; this.prevPaused = this.g.paused; this.g.paused = true; document.exitPointerLock?.(); this.render(); }
  close() { this.open = false; this.el.style.display = 'none'; this.g.paused = this.prevPaused && this.g.state !== 'play' ? true : false; if (this.onClose) this.onClose(); else this.g.input.lock(); }
  render() {
    const s = settings, row = (label, ctrl) => `<div class="srow"><label>${label}</label><div>${ctrl}</div></div>`;
    const slider = (k, min, max, step) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"><span>${(+s[k]).toFixed(step < 1 ? 2 : 0)}</span>`;
    const toggle = (k) => `<button class="tog${s[k] ? ' on' : ''}" data-t="${k}">${s[k] ? 'On' : 'Off'}</button>`;
    this.el.innerHTML = `<div class="st">Settings</div><div class="scols"><div>` +
      row('Master volume', slider('volume', 0, 1, 0.05)) + row('Radio volume', slider('musicVolume', 0, 1, 0.05)) +
      row('Mouse sensitivity', slider('sensitivity', 0.2, 3, 0.1)) + row('Invert mouse Y', toggle('invertY')) +
      row('Graphics quality', QUALITY.map((q, i) => `<button class="opt${this.g.post.level === i ? ' on' : ''}" data-q="${i}">${q}</button>`).join('')) +
      row('Bloom glow', toggle('fxBloom')) + row('Ambient occlusion (Ultra)', toggle('fxAO')) +
      row('Reduced violence', toggle('reducedViolence')) +
      row('Business names', ['real', 'parody'].map(m => `<button class="opt${s.brandMode === m ? ' on' : ''}" data-b="${m}">${m === 'real' ? 'Real' : 'Parody'}</button>`).join('') + '<small> (applies on reload)</small>') +
      row('Traffic & people', slider('density', 0.25, 1.5, 0.25)) +
      `</div><div><div class="sh">Controls</div>` +
      Object.keys(BIND_LABELS).map(k => row(BIND_LABELS[k], `<button class="bind${this.waitBind === k ? ' wait' : ''}" data-bind="${k}">${this.waitBind === k ? 'Press a key…' : s.binds[k].replace(/^Key|^Digit/, '')}</button>`)).join('') +
      `</div></div><div class="sfoot"><button data-reset>Reset to defaults</button><button data-close class="primary">Done</button></div>`;
    this.el.style.display = 'block';
    for (const i of this.el.querySelectorAll('input[type=range]')) i.oninput = () => { s[i.dataset.k] = +i.value; i.nextElementSibling.textContent = (+i.value).toFixed(+i.step < 1 ? 2 : 0); saveSettings(); this.apply(); };
    for (const b of this.el.querySelectorAll('[data-t]')) b.onclick = () => { s[b.dataset.t] = !s[b.dataset.t]; saveSettings(); if (b.dataset.t === 'fxBloom' || b.dataset.t === 'fxAO') this.g.post.rebuild(); this.render(); };
    for (const b of this.el.querySelectorAll('[data-q]')) b.onclick = () => { s.quality = +b.dataset.q; this.g.post.set(s.quality); saveSettings(); this.render(); };
    for (const b of this.el.querySelectorAll('[data-b]')) b.onclick = () => { s.brandMode = b.dataset.b; saveSettings(); this.render(); };
    for (const b of this.el.querySelectorAll('[data-bind]')) b.onclick = () => { this.waitBind = b.dataset.bind; this.render(); };
    this.el.querySelector('[data-reset]').onclick = () => { resetSettings(); this.g.post.set(settings.quality); this.apply(); this.render(); };
    this.el.querySelector('[data-close]').onclick = () => this.close();
  }
  apply() { this.g.audio.setVolume(settings.volume); this.g.settings.density = settings.density; }
}
