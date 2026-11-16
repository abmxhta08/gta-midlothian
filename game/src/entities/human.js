import * as THREE from 'three';
import { clamp } from '../util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// every human shares one material; clothing/skin colours live in vertex colours
const SHARED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });

const SKIN = [0xf1c8a8, 0xe0ac86, 0xc68e64, 0xa36c47, 0x7d4f33, 0x5c3a24];
const HAIR = [0x1a1410, 0x3b2a1e, 0x6b4a2a, 0xa8834e, 0xd9c08a, 0x777777, 0xb34a24];
const TOP = [0x2f5d8a, 0x8a2f2f, 0x2f6a3a, 0xdedede, 0x222222, 0x6a4a8a, 0xc9a050, 0x3a7a8a, 0xd06a3a, 0x9a9a9a, 0x1f2f4f, 0xe8c8c8];
const BOTTOM = [0x2b3346, 0x1c1c1c, 0x4a4036, 0x6a6a72, 0x8a7a5a, 0x2f3f5f, 0xb8a888];
const SHOE = [0x111111, 0xeeeeee, 0x5a3a20, 0x2a2a3a];

const geoCache = {};
const G = (k, f) => geoCache[k] || (geoCache[k] = f());
const capsule = (r, l) => G(`c${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const sphere = (r) => G(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10));
const boxg = (x, y, z) => G(`b${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
const pickc = (a, r) => a[Math.floor(r() * a.length)];

/** Procedural articulated human (generic, invented appearance). Forward = +z. */
export class Human {
  constructor(scene, opts = {}) {
    const r = opts.rand || Math.random;
    const cop = opts.cop;
    this.height = (opts.height || 0.92 + r() * 0.16);
    const fem = opts.fem ?? (r() < 0.45 && !cop);
    const std = (c) => new THREE.MeshBasicMaterial({ color: c });   // temporary: baked into vertex colours below
    const skin = std(opts.skin ?? pickc(SKIN, r), 0.6), hair = std(opts.hair ?? pickc(HAIR, r), 0.9);
    const top = std(opts.top ?? (cop ? 0x1b2a4a : pickc(TOP, r)), 0.85), bottom = std(opts.bottom ?? (cop ? 0x14203a : pickc(BOTTOM, r)), 0.9), shoe = std(opts.shoe ?? (cop ? 0x0a0a0a : pickc(SHOE, r)), 0.5);
    this.mats = [skin, hair, top, bottom, shoe];
    const root = this.root = new THREE.Group();
    const body = this.body = new THREE.Group(); root.add(body); body.scale.setScalar(this.height);
    const sw = fem ? 0.88 : 1, hw = fem ? 1.05 : 1;
    const mesh = (g, m, x, y, z, p = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
    // hips & torso
    this.hips = new THREE.Bone(); this.hips.position.y = 0.95; body.add(this.hips);
    mesh(boxg(0.38 * hw, 0.22, 0.24), bottom, 0, 0, 0, this.hips);
    this.spine = new THREE.Bone(); this.spine.position.y = 0.08; this.hips.add(this.spine);
    const torso = mesh(capsule(0.19 * sw, 0.3), top, 0, 0.27, 0, this.spine); torso.scale.set(1.12, 1, 0.72);
    if (cop) { mesh(boxg(0.06, 0.06, 0.02), std(0xd4af37, 0.3), 0.09, 0.4, 0.12, this.spine); mesh(boxg(0.36, 0.06, 0.24), std(0x111111), 0, 0.02, 0, this.spine); }
    this.neck = new THREE.Bone(); this.neck.position.y = 0.56; this.spine.add(this.neck);
    mesh(capsule(0.058, 0.06), skin, 0, 0.02, 0, this.neck);
    this.head = new THREE.Bone(); this.head.position.y = 0.14; this.neck.add(this.head);
    const hd = mesh(sphere(0.11), skin, 0, 0.02, 0, this.head); hd.scale.set(0.92, 1.08, 1);
    mesh(sphere(0.012), std(0x111111, 0.3), 0.038, 0.04, 0.095, this.head); mesh(sphere(0.012), std(0x111111, 0.3), -0.038, 0.04, 0.095, this.head);
    mesh(boxg(0.022, 0.035, 0.03), skin, 0, 0.0, 0.11, this.head);
    if (cop) { mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 14), std(0x14203a), 0, 0.12, 0, this.head); mesh(boxg(0.2, 0.015, 0.1), std(0x0a0a0a), 0, 0.09, 0.1, this.head); }
    else {
      const style = opts.hairStyle ?? r();
      if (style < 0.55) { const h = mesh(sphere(0.115), hair, 0, 0.05, -0.012, this.head); h.scale.set(0.97, 0.85, 1.02); }
      else if (style < 0.8) { const h = mesh(sphere(0.12), hair, 0, 0.04, -0.02, this.head); h.scale.set(1, 0.95, 1.05); mesh(capsule(0.08, 0.16), hair, 0, -0.1, -0.07, this.head).scale.set(1.2, 1, 0.6); }
      else if (style < 0.92) { mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.08, 14), std(pickc(TOP, r)), 0, 0.1, 0, this.head); mesh(boxg(0.18, 0.015, 0.12), std(pickc(TOP, r)), 0, 0.07, 0.1, this.head); }
    }
    // arms
    const arm = (side) => {
      const sh = new THREE.Bone(); sh.position.set(side * 0.24 * sw, 0.47, 0); this.spine.add(sh);
      mesh(sphere(0.075), top, 0, -0.01, 0, sh);
      mesh(capsule(0.066, 0.2), top, 0, -0.14, 0, sh);
      const el = new THREE.Bone(); el.position.y = -0.29; sh.add(el);
      mesh(capsule(0.056, 0.19), opts.sleeves ?? (r() < 0.5 && !cop) ? skin : top, 0, -0.12, 0, el);
      const hand = new THREE.Bone(); hand.position.y = -0.27; el.add(hand);
      mesh(sphere(0.052), skin, 0, 0, 0, hand);
      return { sh, el, hand };
    };
    this.armL = arm(1); this.armR = arm(-1);
    const leg = (side) => {
      const hp = new THREE.Bone(); hp.position.set(side * 0.105 * hw, -0.04, 0); this.hips.add(hp);
      mesh(capsule(0.092, 0.28), bottom, 0, -0.22, 0, hp);
      const kn = new THREE.Bone(); kn.position.y = -0.44; hp.add(kn);
      mesh(capsule(0.074, 0.3), bottom, 0, -0.2, 0, kn);
      const ft = new THREE.Bone(); ft.position.y = -0.44; kn.add(ft);
      mesh(boxg(0.11, 0.08, 0.27), shoe, 0, -0.02, 0.05, ft);
      return { hp, kn, ft };
    };
    this.legL = leg(1); this.legR = leg(-1);
    this.weaponHolder = new THREE.Group(); this.weaponHolder.rotation.x = Math.PI / 2; this.armR.hand.add(this.weaponHolder);
    this.bake();
    this.phase = r() * 10; this.t = 0; this.pose = 'idle'; this.aim = 0; this.aimPitch = 0; this.punch = 0; this.dead = 0; this.deathDir = 1; this.kick = 0; this.twoHand = false;
    scene.add(root);
  }
  /** Merge all body parts into ONE skinned mesh (one draw call per person instead of ~20). Each part is
   *  rigidly bound to the joint it was attached to, so the existing joint animation code keeps working. */
  bake() {
    const bones = [], meshes = [];
    this.body.traverse(o => { if (o.isBone) bones.push(o); else if (o.isMesh) meshes.push(o); });
    this.body.updateMatrixWorld(true);
    const inv = this.body.matrixWorld.clone().invert(), M = new THREE.Matrix4(), geos = [];
    for (const m of meshes) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
      g.applyMatrix4(M.multiplyMatrices(inv, m.matrixWorld));
      const n = g.attributes.position.count, c = m.material.color, bi = Math.max(0, bones.indexOf(m.parent));
      const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geos.push(g); m.parent.remove(m); m.material.dispose();
    }
    const sm = this.mesh = new THREE.SkinnedMesh(mergeGeometries(geos), SHARED_MAT);
    sm.castShadow = true; sm.receiveShadow = true;
    this.body.add(sm); sm.updateMatrixWorld(true); sm.bind(new THREE.Skeleton(bones));
    sm.computeBoundingSphere(); sm.boundingSphere.radius *= 1.7;   // generous: covers running, aiming and lying down
    this.mats = [];
  }
  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }
  setWeaponMesh(m) { this.weaponHolder.clear(); if (m) this.weaponHolder.add(m); }
  dispose(scene) { scene.remove(this.root); this.mesh?.geometry.dispose(); this.mesh?.skeleton.dispose(); }
  /** speed m/s, aim 0..1, dt seconds. */
  animate(dt, speed, opts = {}) {
    this.t += dt;
    const b = this;
    if (this.dead > 0) {   // fall over and lie still
      this.dead = Math.min(1, this.dead + dt * 2.2);
      const k = 1 - Math.pow(1 - this.dead, 3);
      b.body.rotation.x = -this.deathDir * k * Math.PI / 2; b.body.position.y = k * 0.12;
      b.armL.sh.rotation.z = k * 1.2; b.armR.sh.rotation.z = -k * 1.2; b.legL.kn.rotation.x = k * 0.3;
      return;
    }
    b.body.rotation.x = 0; b.body.position.y = 0;
    const run = clamp((speed - 2.5) / 3, 0, 1), walk = clamp(speed / 1.6, 0, 1);
    this.phase += dt * (speed > 0.1 ? 2.2 + speed * 1.15 : 0);
    const p = this.phase, amp = walk * (0.45 + run * 0.45);
    // legs
    const leg = (L, ph) => {
      const s = Math.sin(p + ph);
      L.hp.rotation.x = -s * amp;
      L.kn.rotation.x = Math.max(0, Math.cos(p + ph)) * amp * (1.2 + run * 0.9) + (opts.crouch ? 0.9 : 0);
      L.ft.rotation.x = -L.kn.rotation.x * 0.3 + s * 0.15 * amp;
    };
    leg(this.legL, 0); leg(this.legR, Math.PI);
    if (opts.air) { this.legL.hp.rotation.x = -0.6; this.legL.kn.rotation.x = 1.1; this.legR.hp.rotation.x = 0.2; this.legR.kn.rotation.x = 0.5; }
    b.hips.position.y = 0.95 - Math.abs(Math.sin(p)) * 0.04 * walk - (opts.crouch ? 0.3 : 0);
    b.spine.rotation.x = run * 0.22 + (opts.crouch ? 0.4 : 0);
    b.spine.rotation.y = Math.sin(p) * 0.08 * walk;
    // arms
    const breathe = Math.sin(this.t * 1.8) * 0.03;
    const swing = Math.sin(p) * amp * (0.9 + run * 0.4);
    b.armL.sh.rotation.set(swing, 0, 0.08 + breathe); b.armL.el.rotation.x = -0.2 - run * 1.1;
    b.armR.sh.rotation.set(-swing, 0, -0.08 - breathe); b.armR.el.rotation.x = -0.2 - run * 1.1;
    if (opts.flee) { b.armL.sh.rotation.set(-2.6, 0, 0.4); b.armR.sh.rotation.set(-2.6, 0, -0.4); b.armL.el.rotation.x = -0.6; b.armR.el.rotation.x = -0.6; }
    if (opts.handsUp) { b.armL.sh.rotation.set(-2.9, 0, 0.3); b.armR.sh.rotation.set(-2.9, 0, -0.3); b.armL.el.rotation.x = -0.4; b.armR.el.rotation.x = -0.4; }
    // aiming: right arm straight forward, pitched; two-handed adds left arm
    this.kick = Math.max(0, this.kick - dt * 6);
    const a = opts.aim ?? 0;
    if (a > 0) {
      const pitch = -Math.PI / 2 - clamp(-(opts.pitch || 0), -1, 1);
      b.armR.sh.rotation.set(THREE.MathUtils.lerp(b.armR.sh.rotation.x, pitch - this.kick * 0.25, a), 0.12 * a, -0.05);
      b.armR.el.rotation.x = THREE.MathUtils.lerp(b.armR.el.rotation.x, -0.05, a);
      if (this.twoHand) { b.armL.sh.rotation.set(THREE.MathUtils.lerp(b.armL.sh.rotation.x, pitch + 0.15, a), -0.6 * a, 0.2); b.armL.el.rotation.x = -0.55 * a; }
      b.spine.rotation.y = -0.15 * a;
    }
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - dt * 4);
      const k = Math.sin((1 - this.punch) * Math.PI);
      b.armR.sh.rotation.set(-1.5 * k - 0.2, 0, -0.1); b.armR.el.rotation.x = -1.6 * (1 - k); b.spine.rotation.y = -0.4 * k;
    }
  }
}
