// Weather: clear / rain / fog. Affects grip (vehicles read game.weather.grip), visibility (fog distance),
// sky darkness, wet road reflections, and rain particles around the camera.
import * as THREE from 'three';
import { events } from '../core/events.js';

export const KINDS = {
  clear: { grip: 1.0, overcast: 0, fogNear: 260, fogFar: 1900, wet: 0, rain: 0 },
  rain:  { grip: 0.74, overcast: 0.8, fogNear: 120, fogFar: 900, wet: 1, rain: 1 },
  fog:   { grip: 0.95, overcast: 0.5, fogNear: 15, fogFar: 230, wet: 0.3, rain: 0 },
};
const DROPS = 2400, BOX = 60;

export class Weather {
  constructor(game, kind = 'clear') {
    this.game = game; this.kind = kind; this.k = { ...KINDS[kind] }; this.target = KINDS[kind]; this.timer = 180 + Math.random() * 180; this.locked = false;
    const pos = new Float32Array(DROPS * 6);
    for (let i = 0; i < DROPS; i++) { const x = (Math.random() - 0.5) * BOX, y = Math.random() * 30, z = (Math.random() - 0.5) * BOX; pos.set([x, y, z, x, y - 0.6, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; game.scene.add(this.rain);
    this.fall = 0;
  }
  get grip() { return this.k.grip; }
  set(kind, lock = false) {
    if (!KINDS[kind]) return; this.kind = kind; this.target = KINDS[kind]; this.locked = lock; this.timer = 180 + Math.random() * 240;
    events.emit('weather', { kind });
  }
  update(dt) {
    const g = this.game, k = this.k, t = this.target, a = 1 - Math.exp(-dt * 0.5);
    for (const key of ['grip', 'overcast', 'fogNear', 'fogFar', 'wet', 'rain']) k[key] += (t[key] - k[key]) * a;
    if (!this.locked && (this.timer -= dt) <= 0) { const r = Math.random(); this.set(r < 0.6 ? 'clear' : r < 0.85 ? 'rain' : 'fog'); }
    // sky + fog
    g.sky.overcast = k.overcast;
    g.scene.fog.near = k.fogNear; g.scene.fog.far = Math.max(k.fogFar, k.fogNear + 50);
    // wet roads: lower roughness so the sky/headlights reflect
    const M = g.world.M; if (M) { M.asphalt.roughness = 1 - 0.55 * k.wet; M.concrete.roughness = 1 - 0.35 * k.wet; }
    // rain particles follow the camera
    this.rain.visible = k.rain > 0.02; this.rain.material.opacity = 0.45 * k.rain;
    if (this.rain.visible) {
      this.fall = (this.fall + dt * 22) % 30; const c = g.camera.position;
      this.rain.position.set(Math.round(c.x / 2) * 2, c.y - 12 - this.fall + 15, Math.round(c.z / 2) * 2);
      if (this.fall < dt * 22) this.rain.position.y += 0;   // wrap is invisible because drops span 30 m
    }
    g.audio.rain?.(k.rain);
  }
}
