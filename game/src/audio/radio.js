// In-car radio: three original, procedurally generated stations (WebAudio synthesis, nothing recorded).
// A look-ahead scheduler plays drums, bass, chords and a lead based on each station's style.
export const STATIONS = [
  { id: 'off', name: 'Radio Off' },
  { id: 'lofi', name: 'Coalfield 88.1', tag: 'Lo-fi beats', bpm: 78, prog: [57, 53, 60, 55], wave: 'triangle', lead: 'sine', drive: 0, swing: 0.12 },
  { id: 'rock', name: 'Turnpike Rock 96.5', tag: 'Garage rock', bpm: 132, prog: [52, 52, 55, 57], wave: 'sawtooth', lead: 'square', drive: 1, swing: 0 },
  { id: 'synth', name: 'Swift Creek 101.9', tag: 'Night drive synthwave', bpm: 100, prog: [57, 53, 48, 55], wave: 'sawtooth', lead: 'square', drive: 0, swing: 0, arp: true },
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Radio {
  constructor(audio) { this.audio = audio; this.index = 0; this.step = 0; this.next = 0; this.on = false; this.seed = 1; }
  get station() { return STATIONS[this.index]; }
  ensure() {
    const a = this.audio; if (!a.ctx || this.out) return !!this.out;
    const c = a.ctx;
    this.out = c.createGain(); this.out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;   // "speaker" tone
    this.dist = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } this.dist.curve = curve;
    this.out.connect(lp); lp.connect(a.master);
    this.dist.connect(this.out);
    return true;
  }
  cycle() { this.index = (this.index + 1) % STATIONS.length; this.step = 0; return this.station; }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  /** Called every frame. playing = player is in a vehicle with the radio on. */
  update(playing, volume) {
    const a = this.audio; if (!a.ctx || !this.ensure()) return;
    const c = a.ctx, st = this.station, live = playing && st.id !== 'off';
    this.out.gain.setTargetAtTime(live ? 0.32 * volume : 0, c.currentTime, 0.15);
    if (!live) { this.next = c.currentTime; return; }
    const spb = 60 / st.bpm / 4;   // 16th notes
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05;
    while (this.next < c.currentTime + 0.25) { this.play(st, this.step, this.next, spb); this.next += spb * (1 + (this.step % 2 ? -st.swing : st.swing)); this.step++; }
  }
  play(st, step, t, spb) {
    const s16 = step % 16, bar = Math.floor(step / 16), root = st.prog[bar % st.prog.length];
    // drums
    if (st.id === 'rock') { if (s16 % 8 === 0) this.kick(t, 0.9); if (s16 % 8 === 4) this.snare(t, 0.6); if (s16 % 2 === 0) this.hat(t, 0.15); }
    else if (st.id === 'lofi') { if (s16 === 0 || s16 === 10) this.kick(t, 0.7); if (s16 === 4 || s16 === 12) this.snare(t, 0.35); if (s16 % 2 === 0) this.hat(t, 0.07); }
    else { if (s16 % 4 === 0) this.kick(t, 0.8); if (s16 === 4 || s16 === 12) this.snare(t, 0.45); if (s16 % 2 === 1) this.hat(t, 0.1); }
    // bass
    if (st.id === 'rock' && s16 % 2 === 0) this.note(root - 12, t, spb * 1.8, 'sawtooth', 0.22, true);
    if (st.id === 'lofi' && (s16 === 0 || s16 === 8)) this.note(root - 12, t, spb * 6, 'sine', 0.35);
    if (st.id === 'synth' && s16 % 2 === 0) this.note(root - 12 + (s16 % 4 ? 12 : 0), t, spb * 1.6, 'sawtooth', 0.14);
    // chords / power chords
    if (s16 === 0) {
      const ch = st.id === 'rock' ? [0, 7, 12] : [0, 4, 7, 11].map((x, i) => (st.id === 'lofi' && i === 1 && bar % 2) ? 3 : x);
      for (const iv of ch) this.note(root + iv, t, spb * 15, st.wave, st.id === 'rock' ? 0.05 : 0.045, !!st.drive);
    }
    // lead
    const scale = [0, 2, 3, 5, 7, 9, 10, 12];
    if (st.arp) { const arp = [0, 4, 7, 12, 7, 4][s16 % 6]; this.note(root + 12 + arp, t, spb * 0.9, 'square', 0.035); }
    else if (s16 % (st.id === 'rock' ? 2 : 4) === 0 && this.rnd() < (st.id === 'rock' ? 0.45 : 0.5)) this.note(root + 12 + scale[Math.floor(this.rnd() * scale.length)], t, spb * (st.id === 'lofi' ? 3 : 1.5), st.lead, 0.05, !!st.drive);
  }
  note(m, t, dur, type, vol, drive = false) {
    const c = this.audio.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(drive ? this.dist : this.out); o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t, vol) { const c = this.audio.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.3); }
  noise(t, vol, dur, type, freq) {
    const c = this.audio.ctx, s = c.createBufferSource(); s.buffer = this.audio.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  snare(t, vol) { this.noise(t, vol, 0.18, 'bandpass', 1800); }
  hat(t, vol) { this.noise(t, vol, 0.04, 'highpass', 7000); }
}
