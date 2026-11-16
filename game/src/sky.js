import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { smooth, clamp } from './util.js';

const DEG = Math.PI / 180;
const FOG_DAY = new THREE.Color(0xa9c4de), FOG_DUSK = new THREE.Color(0xe6a27a), FOG_NIGHT = new THREE.Color(0x0a0f18);
const SUN_NOON = new THREE.Color(0xfff1dc), SUN_LOW = new THREE.Color(0xff9a4d), GREY = new THREE.Color(0x9aa2aa);

/** Sky, sun (shadowed), hemisphere/moon fill, fog, clouds, stars and a sky-derived environment map. */
export function createSky(scene, renderer, T) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sky = new Sky(); sky.scale.setScalar(2800); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const U = sky.material.uniforms;
  U.turbidity.value = 2.5; U.mieCoefficient.value = 0.004; U.mieDirectionalG.value = 0.86;

  // environment from a private copy of the sky
  const envScene = new THREE.Scene(), envSky = new Sky(); envSky.scale.setScalar(50); envScene.add(envSky);
  const hemiEnv = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d4a35, side: THREE.BackSide }));
  envScene.add(hemiEnv);
  const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null;

  // stars
  const sp = [], r = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 1400; i++) { const y = r() * 0.95 + 0.04, a = r() * 6.283, q = Math.sqrt(1 - y * y); sp.push(Math.cos(a) * q * 1900, y * 1900, Math.sin(a) * q * 1900); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, fog: false, depthTest: false, depthWrite: false }));
  stars.renderOrder = -9; stars.frustumCulled = false; scene.add(stars);

  // clouds
  const cloudMat = new THREE.MeshBasicMaterial({ map: T.clouds, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  const clouds = new THREE.Mesh(new THREE.CircleGeometry(2300, 48).rotateX(Math.PI / 2), cloudMat);
  clouds.position.y = 520; clouds.renderOrder = -8; clouds.frustumCulled = false; clouds.visible = false; scene.add(clouds);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a6448, 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.4;
  const moon = new THREE.DirectionalLight(0x8fa6ff, 0); moon.position.set(-300, 600, -200);
  scene.add(sun, sun.target, moon);
  scene.fog = new THREE.Fog(FOG_DAY.clone(), 260, 1900);

  const L = { sky, sun, hemi, night: 0, day: 1, hour: 15.5, dir: new THREE.Vector3(), shadowSize: 0 };
  L.setShadowQuality = (size, extent) => {
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(size, size); L.shadowSize = size;
    const c = sun.shadow.camera; c.left = c.bottom = -extent; c.right = c.top = extent; c.near = 10; c.far = 1000; c.updateProjectionMatrix();
    L.texel = (extent * 2) / size;
  };
  L.setShadowQuality(4096, 140);

  L.setTime = (h) => {
    L.hour = ((h % 24) + 24) % 24;
    const el = Math.sin((L.hour - 6.5) / 24 * Math.PI * 2) * 70 * DEG, az = (12.5 - L.hour) * 15 * DEG;
    L.dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const s = Math.sin(el), day = smooth(-0.08, 0.22, s); L.day = day;
    L.night = 1 - smooth(-0.14, 0.04, s);
    for (const u of [U, envSky.material.uniforms]) { u.sunPosition.value.copy(L.dir); u.rayleigh.value = 2.4 + 1.2 * (1 - clamp(s * 2.5, 0, 1)); u.turbidity.value = 3.5; u.mieCoefficient.value = 0.0022; u.mieDirectionalG.value = 0.82; u.mieDirectionalG.value = 0.86; }
    sun.intensity = 3.4 * smooth(-0.01, 0.18, s);
    sun.color.copy(SUN_LOW).lerp(SUN_NOON, smooth(0.04, 0.45, s));
    hemi.intensity = 0.62 + 0.1 * day; moon.intensity = 1.25 * (1 - day);
    hemi.color.setHex(0x4e64a0).lerp(new THREE.Color(0xcfe3ff), day);
    hemi.groundColor.setHex(0x353b47).lerp(new THREE.Color(0x5a6448), day);   // night: street-light bounce so characters aren't pure silhouettes
    const sunset = 1 - clamp(Math.abs(s) / 0.28, 0, 1);
    scene.fog.color.copy(FOG_NIGHT).lerp(FOG_DAY, day).lerp(FOG_DUSK, sunset * 0.65 * (0.3 + day));
    stars.visible = L.night > 0.6; stars.material.color.setScalar(clamp((L.night - 0.6) * 2.5, 0, 1));
    cloudMat.color.copy(new THREE.Color(0x1a2030)).lerp(new THREE.Color(0xffffff), day).lerp(new THREE.Color(0xffb07a), sunset * 0.6 * day);
    cloudMat.opacity = 0.04 + 0.86 * day;
    hemiEnv.material.color.setHex(0x0b0e0a).lerp(new THREE.Color(0x46523b), day);
    renderer.toneMappingExposure = 0.66 - 0.04 * day;
    // regenerate environment
    // the reflection map is expensive to rebuild (a frame spike), so only redo it when the light changed noticeably
    if (!envRT || Math.abs(L.envDay - day) > 0.06 || Math.abs((L.envHour ?? -9) - L.hour) > 1.5) {
      const old = envRT; envRT = pmrem.fromScene(envScene, 0, 0.1, 200); scene.environment = envRT.texture; old?.dispose(); L.envDay = day; L.envHour = L.hour;
    }
    scene.environmentIntensity = 0.35 + 0.65 * day;
    L.baseSun = sun.intensity; L.baseHemi = hemi.intensity; L.baseFog = scene.fog.color.clone(); L.baseTurb = U.turbidity.value; L.baseStars = stars.visible;
  };
  L.update = (focus, camera, dt) => {
    const sn = L.texel || 0.1, tx = Math.round(focus.x / sn) * sn, tz = Math.round(focus.z / sn) * sn;
    sun.target.position.set(tx, 0, tz);
    const d = L.dir.y > 0.02 ? L.dir : new THREE.Vector3(L.dir.x, 0.02, L.dir.z).normalize();
    sun.position.set(tx + d.x * 450, d.y * 450, tz + d.z * 450);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
    clouds.position.x = camera.position.x; clouds.position.z = camera.position.z; clouds.rotation.y += dt * 0.002;
    // weather overcast (0..1) darkens the sun, greys the fog and hazes the sky
    const oc = L.overcast || 0;
    sun.intensity = L.baseSun * (1 - 0.82 * oc); hemi.intensity = L.baseHemi * (1 - 0.15 * oc);
    scene.fog.color.copy(L.baseFog).lerp(GREY.clone().multiplyScalar(0.25 + 0.75 * L.day), oc * 0.75);
    U.turbidity.value = L.baseTurb + 14 * oc; stars.visible = L.baseStars && oc < 0.4;
  };
  L.refreshEnvironment = () => { L.envDay = -9; };   // force the reflection map to be regenerated (after a GPU context restore)
  L.setTime(L.hour);
  return L;
}
