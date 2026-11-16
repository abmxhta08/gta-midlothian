import * as THREE from 'three';

/** Shared materials. UVs are in metres; texture repeat converts metres to tiles. */
export function makeMaterials(T) {
  const rep = (set, metres) => { for (const k of ['map', 'normalMap', 'roughnessMap']) if (set[k]) set[k].repeat.set(1 / metres, 1 / metres); return set; };
  rep(T.asphalt, 6); rep(T.ground, 4); rep(T.siding, 2); rep(T.brick, 1.2); rep(T.block, 2); rep(T.metal, 2); rep(T.shingle, 2); rep(T.flatroof, 6);
  const flat = (m, order) => { m.depthTest = false; m.depthWrite = false; m.userData.order = order; return m; };
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const nscale = (v) => new THREE.Vector2(v, v);
  const M = {
    ground: flat(S({ ...T.ground, vertexColors: true, roughness: 1, normalScale: nscale(0.7) })),
    asphalt: flat(S({ ...T.asphalt, roughness: 1, normalScale: nscale(0.6) })),
    concrete: flat(S({ ...T.concrete, roughness: 1, color: 0xf2f0ea, normalScale: nscale(0.5) })),
    curb: flat(S({ color: 0xd2cfc6, roughness: 0.85 })),
    marking: flat(S({ vertexColors: true, roughness: 0.55 })),
    water: flat(S({ color: 0x264f66, roughness: 0.05, metalness: 0.2, normalMap: T.waterNormal, normalScale: nscale(0.35) })),
    siding: S({ ...T.siding, vertexColors: true, roughness: 1 }),
    brick: S({ ...T.brick, vertexColors: true, roughness: 1 }),
    block: S({ ...T.block, vertexColors: true, roughness: 1 }),
    metal: S({ ...T.metal, vertexColors: true, roughness: 1, metalness: 0.3 }),
    shingle: S({ ...T.shingle, vertexColors: true, roughness: 1 }),
    flatroof: S({ ...T.flatroof, vertexColors: true, roughness: 1 }),
    trim: S({ vertexColors: true, roughness: 0.6 }),
    windowDark: S({ ...T.window, roughness: 1, metalness: 0.15 }),
    windowLit: S({ ...T.window, roughness: 1, metalness: 0.15, emissive: 0xffffff, emissiveMap: T.windowGlow, emissiveIntensity: 0 }),
    store: S({ ...T.store, roughness: 1, metalness: 0.2, emissive: 0xffffff, emissiveMap: T.storeGlow, emissiveIntensity: 0.15 }),
    door: S({ map: T.door, vertexColors: true, roughness: 0.6 }),
    garage: S({ map: T.garage, roughness: 0.6 }),
    lamp: S({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 0 }),
    pole: S({ color: 0x55585c, roughness: 0.5, metalness: 0.6 }),
    pool: new THREE.MeshBasicMaterial({ map: T.pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  };
  M.water.userData.order = -2.95;
  M.nightUpdate = (night, time) => {
    M.windowLit.emissiveIntensity = night * 1.4;
    M.store.emissiveIntensity = 0.15 + night * 1.6;
    M.lamp.emissiveIntensity = night * 6;
    M.pool.opacity = night * 0.55;
    T.waterNormal.offset.set(time * 0.01, time * 0.006);
  };
  return M;
}
