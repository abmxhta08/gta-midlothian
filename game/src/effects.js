import * as THREE from 'three';
import { radial } from './textures.js';
import { settings } from './config/settings.js';

/** Pooled visual effects. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.85, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = this.pool(24, () => new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), tm));
    const flashTex = radial('rgba(255,240,190,1)', 'rgba(255,140,30,0)');
    this.flashes = this.pool(8, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })));
    const dm = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
    this.decals = this.pool(80, () => new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), dm), true);
    const spark = new THREE.MeshBasicMaterial({ color: 0xffc860, fog: false });
    const blood = new THREE.MeshBasicMaterial({ color: 0x7a0a0a });
    const hitMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false });
    const debris = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    this.bits = this.pool(140, () => new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), spark));
    this.mats = { spark, blood, debris, hit: hitMat };
    const smokeTex = this.smokeTex = radial('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    this.puffs = this.pool(160, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0x777777 })));
    this.fireTex = radial('rgba(255,230,140,1)', 'rgba(255,90,10,0)');
    this.light = new THREE.PointLight(0xffb060, 0, 18, 2); scene.add(this.light); this.lightT = 0;
    this.boom = new THREE.PointLight(0xff8a30, 0, 60, 1.6); scene.add(this.boom); this.boomT = 0;
    const skm = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.skids = this.pool(500, () => new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.5).rotateX(-Math.PI / 2), skm), true);
    this.skids.forEach(s => { s.renderOrder = 2; });
  }
  pool(n, make, persistent = false) {
    const a = []; for (let i = 0; i < n; i++) { const m = make(); m.visible = false; m.userData = { t: 0, v: new THREE.Vector3(), p: persistent }; m.frustumCulled = false; m.matrixAutoUpdate = false; this.scene.add(m); a.push(m); }
    a.i = 0; return a;
  }
  next(a) { const m = a[a.i++ % a.length]; return m; }
  tracer(a, b) {
    const m = this.next(this.tracers), len = a.distanceTo(b);
    m.position.copy(a).lerp(b, 0.5); m.scale.set(1, 1, len); m.lookAt(b); m.visible = true; m.userData.t = 0.045; m.updateMatrix();
  }
  muzzle(p, size = 0.6) {
    const m = this.next(this.flashes); m.position.copy(p); m.scale.setScalar(size * (0.8 + Math.random() * 0.4)); m.material.rotation = Math.random() * 6; m.visible = true; m.userData.t = 0.05; m.updateMatrix();
    this.light.position.copy(p); this.light.intensity = 8; this.lightT = 0.05;
  }
  impact(p, n, kind = 'spark') {
    if (kind === 'blood' && settings.reducedViolence) kind = 'hit';   // reduced violence: hit flash instead of blood
    if (kind === 'hit') { this.muzzle(p, 0.35); this.light.intensity = 0; }
    if (kind !== 'blood' && kind !== 'hit') {
      const d = this.next(this.decals); d.position.copy(p).addScaledVector(n, 0.015); d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); d.visible = true; d.userData.t = 40; d.updateMatrix();
    }
    const cnt = kind === 'blood' ? 6 : 5;
    for (let i = 0; i < cnt; i++) {
      const s = this.next(this.bits); s.material = kind === 'blood' ? this.mats.blood : kind === 'hit' ? this.mats.hit : this.mats.spark;
      s.position.copy(p).addScaledVector(n, 0.05);
      s.userData.v.set((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3).addScaledVector(n, 2.5);
      s.userData.t = kind === 'blood' ? 0.5 : 0.3; s.userData.g = 9; s.visible = true; s.scale.setScalar(kind === 'blood' ? 1.4 : 1);
    }
    if (kind === 'dust') this.smoke(p, 0x9a9488, 0.6, 0.8);
  }
  smoke(p, color = 0x666666, size = 1.5, life = 2, up = 1.2) {
    const s = this.next(this.puffs); s.material.color.setHex(color); s.material.map = this.smokeTex; s.material.blending = THREE.NormalBlending;
    s.position.copy(p); s.scale.setScalar(size); s.userData.s0 = size; s.userData.t = life; s.userData.life = life; s.userData.fire = false;
    s.userData.v.set((Math.random() - 0.5) * 0.6, up, (Math.random() - 0.5) * 0.6); s.material.opacity = 0.5; s.visible = true;
  }
  fire(p, size = 1.2) {
    const s = this.next(this.puffs); s.material.map = this.fireTex; s.material.color.setHex(0xffffff); s.material.blending = THREE.AdditiveBlending;
    s.position.copy(p); s.scale.setScalar(size); s.userData.s0 = size; s.userData.t = 0.5; s.userData.life = 0.5; s.userData.fire = true;
    s.userData.v.set((Math.random() - 0.5) * 0.8, 2 + Math.random(), (Math.random() - 0.5) * 0.8); s.material.opacity = 1; s.visible = true;
  }
  explosion(p) {
    this.boom.position.copy(p).y += 2; this.boom.intensity = 80; this.boomT = 0.6;
    for (let i = 0; i < 14; i++) this.fire(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 3 + Math.random() * 3);
    for (let i = 0; i < 10; i++) this.smoke(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4)), 0x222222, 4, 3.5, 2.5);
    for (let i = 0; i < 16; i++) {
      const s = this.next(this.bits); s.material = this.mats.debris; s.position.copy(p).y += 1;
      s.userData.v.set((Math.random() - 0.5) * 14, 5 + Math.random() * 8, (Math.random() - 0.5) * 14); s.userData.t = 1.6; s.userData.g = 14; s.visible = true; s.scale.setScalar(3 + Math.random() * 4);
    }
  }
  skid(x, z, heading) {
    const s = this.next(this.skids); s.position.set(x, 0.03, z); s.rotation.y = heading; s.visible = true; s.userData.t = 25; s.updateMatrix();
  }
  update(dt) {
    for (const m of this.tracers) if (m.visible && (m.userData.t -= dt) <= 0) m.visible = false;
    for (const m of this.flashes) if (m.visible && (m.userData.t -= dt) <= 0) m.visible = false;
    for (const m of this.decals) if (m.visible && (m.userData.t -= dt) <= 0) m.visible = false;
    for (const m of this.skids) if (m.visible && (m.userData.t -= dt) <= 0) m.visible = false;
    if (this.lightT > 0 && (this.lightT -= dt) <= 0) this.light.intensity = 0;
    if (this.boomT > 0) { this.boomT -= dt; this.boom.intensity = Math.max(0, this.boomT / 0.6) * 80; }
    for (const s of this.bits) {
      if (!s.visible) continue;
      if ((s.userData.t -= dt) <= 0) { s.visible = false; continue; }
      s.userData.v.y -= (s.userData.g || 9) * dt; s.position.addScaledVector(s.userData.v, dt);
      if (s.position.y < 0.03) { s.position.y = 0.03; s.userData.v.multiplyScalar(0.3); s.userData.v.y = Math.abs(s.userData.v.y) * 0.3; }
      s.rotation.x += dt * 8; s.rotation.y += dt * 6; s.updateMatrix();
    }
    for (const s of this.puffs) {
      if (!s.visible) continue;
      const u = s.userData; if ((u.t -= dt) <= 0) { s.visible = false; continue; }
      const k = 1 - u.t / u.life;
      s.position.addScaledVector(u.v, dt); s.scale.setScalar(u.s0 * (1 + k * (u.fire ? 0.6 : 2.2)));
      s.material.opacity = u.fire ? (1 - k) : 0.5 * (1 - k); s.updateMatrix();
    }
  }
}
