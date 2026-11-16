/** Synthesized audio (no sound files). Positional falloff by distance to the listener. */
export class Audio {
  constructor() { this.ctx = null; this.listener = { x: 0, z: 0 }; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 1.2; this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    this.eo = c.createOscillator(); this.eo.type = 'sawtooth'; this.eo2 = c.createOscillator(); this.eo2.type = 'square';
    const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 520;
    this.eg = c.createGain(); this.eg.gain.value = 0;
    this.eo.connect(ef); this.eo2.connect(ef); ef.connect(this.eg); this.eg.connect(this.master); this.eo.start(); this.eo2.start();
    // siren
    this.so = c.createOscillator(); this.so.type = 'triangle'; this.sg = c.createGain(); this.sg.gain.value = 0;
    this.so.connect(this.sg); this.sg.connect(this.master); this.so.start();
    // ambient city / birds bed
    const amb = c.createBufferSource(); amb.buffer = this.noise; amb.loop = true;
    const af = c.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 280; this.ag = c.createGain(); this.ag.gain.value = 0.05;
    amb.connect(af); af.connect(this.ag); this.ag.connect(this.master); amb.start();
  }
  vol(p, base = 1, range = 120) { if (!p) return base; const d = Math.hypot(p.x - this.listener.x, p.z - this.listener.z); return base * Math.max(0, 1 - d / range) ** 1.5; }
  burst(freq, vol, dur = 0.3, rate = 1, type = 'lowpass') {
    if (!this.ctx || vol < 0.01) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(f0, f1, vol, dur, type = 'sine', when = 0) {
    if (!this.ctx || vol < 0.01) return; const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  shot(kind, p) {
    const v = this.vol(p, 1, 250);
    if (kind === 'shotgun') { this.burst(2500, 1.1 * v, 0.45, 0.7); this.tone(120, 35, 0.9 * v, 0.25); }
    else if (kind === 'rifle') { this.burst(6000, 0.8 * v, 0.22, 1.2); this.tone(180, 50, 0.6 * v, 0.12); }
    else if (kind === 'smg') { this.burst(5000, 0.55 * v, 0.14, 1.3); this.tone(200, 60, 0.4 * v, 0.08); }
    else { this.burst(4500, 0.8 * v, 0.25, 1); this.tone(160, 45, 0.7 * v, 0.14); }
  }
  punch(p) { this.burst(700, this.vol(p, 0.6), 0.12, 0.6); this.tone(90, 40, this.vol(p, 0.5), 0.1); }
  click() { this.tone(1200, 900, 0.12, 0.04, 'square'); }
  reload() { this.tone(500, 400, 0.12, 0.05, 'square'); this.tone(900, 700, 0.12, 0.05, 'square', 0.25); }
  crash(v, p) { this.burst(900, this.vol(p, Math.min(1, v / 18)), 0.5, 0.5); this.tone(80, 30, this.vol(p, Math.min(0.8, v / 25)), 0.3); }
  explosion(p) { const v = this.vol(p, 1.4, 400); this.burst(600, v, 1.6, 0.35); this.tone(70, 20, v, 1.2); }
  skid(mine) { if (mine) this.burst(1800, 0.06, 0.12, 1.4, 'bandpass'); }
  horn() { this.tone(415, 410, 0.25, 0.4, 'square'); this.tone(330, 328, 0.2, 0.4, 'square'); }
  pickup() { this.tone(660, 990, 0.25, 0.15, 'triangle'); this.tone(990, 1320, 0.2, 0.18, 'triangle', 0.09); }
  cash() { this.tone(1400, 1800, 0.18, 0.08, 'square'); this.tone(1800, 2200, 0.15, 0.1, 'square', 0.07); }
  jingle(good = true) {
    const n = good ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    n.forEach((f, i) => this.tone(f, f, 0.22, 0.32, 'triangle', i * 0.14));
  }
  scream(p) { const v = this.vol(p, 0.25, 50); if (v > 0.02) this.tone(900 + Math.random() * 300, 500, v, 0.6, 'sawtooth'); }
  engine(on, speed, rpm = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime, s = Math.abs(speed), gear = Math.min(4, Math.floor(s / 11)), r = (s - gear * 11) / 11;
    this.eg.gain.setTargetAtTime(on ? 0.06 + Math.min(s, 40) * 0.0015 + rpm * 0.03 : 0, t, 0.1);
    const f = 32 + r * 42 + gear * 6 + rpm * 20;
    this.eo.frequency.setTargetAtTime(f, t, 0.06); this.eo2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
  }
  siren(level, t) {
    if (!this.ctx) return;
    this.sg.gain.setTargetAtTime(level * 0.07, this.ctx.currentTime, 0.2);
    this.so.frequency.setTargetAtTime(720 + Math.sin(t * 5) * 260, this.ctx.currentTime, 0.02);
  }
  ambient(night) { if (this.ctx) this.ag.gain.setTargetAtTime(0.03 + (1 - night) * 0.03, this.ctx.currentTime, 1); }
}
