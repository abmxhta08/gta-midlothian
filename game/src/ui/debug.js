// F3 debug panel + rolling performance samples (also used by the test suite).
import { errorLog } from './errors.js';
import { QUALITY } from '../post.js';

export class Perf {
  constructor() { this.frames = []; this.samples = []; this.last = performance.now(); this.calls = 0; this.tris = 0; }
  frame(now, info) {
    const ft = now - this.last; this.last = now;
    this.frames.push(ft); if (this.frames.length > 600) this.frames.shift();
    this.calls = info.calls; this.tris = info.triangles;
  }
  stats() {
    const f = this.frames.slice(-240); if (!f.length) return { fps: 0, ft: 0, low1: 0 };
    const avg = f.reduce((a, b) => a + b, 0) / f.length, sorted = [...f].sort((a, b) => b - a), worst = sorted[Math.max(0, Math.floor(f.length * 0.01) - 1)] || sorted[0];
    return { fps: 1000 / avg, ft: avg, maxFt: sorted[0], low1: 1000 / worst, calls: this.calls, tris: this.tris };
  }
}

export class DebugPanel {
  constructor(game) {
    this.g = game; this.el = document.getElementById('debug'); this.open = false; this.t = 0;
  }
  toggle() { this.open = !this.open; this.el.style.display = this.open ? 'block' : 'none'; if (this.open) this.draw(); }
  update(dt) { if (!this.open || (this.t -= dt) > 0) return; this.t = 0.5; this.draw(); }
  draw() {
    const g = this.g, s = g.perf.stats(), mem = performance.memory, P = g.player, f = g.focus;
    const rows = [
      ['Build', g.BUILD], ['FPS', `${s.fps.toFixed(0)}  (1% low ${s.low1.toFixed(0)})`], ['Frame', `${s.ft.toFixed(1)} ms  (max ${s.maxFt?.toFixed(0)} ms)`],
      ['Draw calls', s.calls], ['Triangles', (s.tris / 1e6).toFixed(2) + ' M'], ['Quality', QUALITY[g.post.level]],
      ['Peds / cops', `${g.peds.list.length} / ${g.police.officers.length}`], ['Traffic / police cars', `${g.traffic.list.length} / ${g.police.cars.length}`],
      ['Vehicles total', g.vehicles.length], ['Pickups', g.pickups.items.length],
      ['JS heap', mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : 'n/a (Chrome only)'],
      ['Geometries / textures', `${g.renderer.info.memory.geometries} / ${g.renderer.info.memory.textures}`],
      ['Position', `${f.x.toFixed(0)}, ${f.z.toFixed(0)}`], ['Time / weather', `${g.hour.toFixed(1)}h / ${g.weather?.kind || 'clear'}`],
      ['Wanted', g.police.wanted], ['State', g.state + (P.vehicle ? ' (driving)' : '')],
    ];
    const errs = errorLog();
    this.el.innerHTML = '<b>DEBUG (F3)</b><table>' + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') + '</table>'
      + (errs.length ? '<b style="color:#ff8080">Errors</b><br>' + errs.slice(-5).map(e => `${e.count}× ${e.error.replace(/</g, '&lt;')}`).join('<br>') : '');
  }
}
