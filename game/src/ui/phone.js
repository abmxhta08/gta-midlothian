// In-game phone (P): contacts, map, mission list, stats, settings. Pauses the game while open.
import { STORY_CONTACTS } from '../data/contacts.js';

export class Phone {
  constructor(game) {
    this.g = game; this.el = document.getElementById('phone'); this.open = false; this.stack = []; this.i = 0;
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.move(1);
      else if (['ArrowUp', 'KeyW'].includes(e.code)) this.move(-1);
      else if (['Enter', 'KeyE', 'Space'].includes(e.code)) this.choose(this.i);
      else if (['Backspace', 'Escape', 'KeyQ'].includes(e.code)) this.back();
      else if (e.code === game.input.code('phone')) this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  toggle() { this.open ? this.close() : this.show(); }
  show() { this.open = true; this.g.paused = true; document.exitPointerLock?.(); this.stack = [this.home()]; this.i = 0; this.render(); }
  close() { this.open = false; this.el.style.display = 'none'; this.g.paused = false; this.g.input.lock(); }
  back() { if (this.stack.length > 1) { this.stack.pop(); this.i = 0; this.render(); } else this.close(); }
  push(screen) { this.stack.push(screen); this.i = 0; this.render(); }
  move(d) { const s = this.stack.at(-1); if (!s.items.length) return; this.i = (this.i + d + s.items.length) % s.items.length; this.render(); }
  choose(i) { const it = this.stack.at(-1).items[i]; if (!it || it.disabled) return; const r = it.action?.(); if (typeof r === 'string') { this.note = r; this.render(); } }
  home() {
    const g = this.g;
    return { title: 'Phone', apps: true, items: [
      { label: 'Contacts', icon: '☎', action: () => this.push(this.contacts()) },
      { label: 'Map', icon: '🗺', action: () => { this.close(); g.openMap(); } },
      { label: 'Missions', icon: '★', action: () => this.push(this.missionList()) },
      { label: 'Stats', icon: '▤', action: () => this.push(this.stats()) },
      { label: 'Settings', icon: '⚙', action: () => { this.close(); g.settingsUI.show(); } },
    ] };
  }
  contacts() {
    const g = this.g, items = STORY_CONTACTS.map(c => ({ label: c.name, sub: c.role, action: () => this.push(this.contact(c)) }));
    items.push({ label: 'Rosa\'s Tow — deliver my car', sub: `${g.garage.list().length} in garage`, disabled: !g.garage.list().length, action: () => this.push({ title: 'Deliver which car?', items: g.garage.list().map((o, i) => ({ label: o.label, action: () => { const p = g.player.pos; const r = g.garage.retrieve(i, p.x + 6, p.z + 6); this.close(); g.hud.toast(r); } })) }) });
    return { title: 'Contacts', items };
  }
  contact(c) {
    const g = this.g, next = g.missions.nextStoryFor?.(c.id);
    return { title: c.name, text: next ? `"${next.callLine || 'Got something for you. Come see me.'}"` : `"${c.idle}"`, items: [
      next ? { label: `Start: ${next.title}`, action: () => { g.missions.setGPSToStart(next.id); this.close(); g.hud.toast(`GPS set to ${next.title}`); } } : { label: 'Nothing new right now', disabled: true },
      { label: 'Hang up', action: () => this.back() },
    ] };
  }
  missionList() {
    const g = this.g, all = g.missions.catalog?.() || [];
    return { title: 'Missions', items: all.map(m => ({ label: m.title, sub: m.status, disabled: m.status === 'Locked', right: m.medal || '',
      action: () => { g.missions.setGPSToStart(m.id); this.close(); g.hud.toast(`GPS set to ${m.title}`); } })) };
  }
  stats() {
    const g = this.g, s = g.save.stats, m = g.missions.progressSummary?.() || {};
    return { title: 'Stats', items: [
      { label: 'Money', right: '$' + g.player.money.toLocaleString() }, { label: 'Story', right: `${m.story || 0}/${m.storyTotal || 0}` },
      { label: 'Side jobs done', right: m.side || 0 }, { label: 'Coal tokens', right: `${g.collectibles.found.size}/${g.collectibles.items.length}` },
      { label: 'Stunt jumps', right: `${g.stunts.done.size}/${g.stunts.ramps.length}` }, { label: 'Headshots', right: s.headshots || 0 },
      { label: 'Time played', right: `${Math.floor((s.playTime || 0) / 60)} min` },
    ].map(x => ({ ...x, disabled: false })) };
  }
  render() {
    const s = this.stack.at(-1), h = Math.floor(this.g.hour), m = Math.floor((this.g.hour - h) * 60);
    this.el.innerHTML = `<div class="ph-top"><span>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</span><span>MIDLO ▮▮▮</span></div><div class="ph-title">${s.title}</div>` +
      (s.text ? `<div class="ph-text">${s.text}</div>` : '') +
      `<div class="${s.apps ? 'ph-apps' : 'ph-list'}">` + s.items.map((it, i) => s.apps
        ? `<div class="ph-app${i === this.i ? ' sel' : ''}" data-i="${i}"><i>${it.icon}</i>${it.label}</div>`
        : `<div class="ph-item${i === this.i ? ' sel' : ''}${it.disabled ? ' dis' : ''}" data-i="${i}"><span>${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</span><b>${it.right ?? ''}</b></div>`).join('') + '</div>' +
      `<div class="ph-foot">${this.note ? this.note : 'Enter select · Backspace back · P close'}</div>`;
    this.note = '';
    this.el.style.display = 'block';
    for (const d of this.el.querySelectorAll('[data-i]')) { d.onclick = () => { this.i = +d.dataset.i; this.choose(this.i); }; }
  }
}
