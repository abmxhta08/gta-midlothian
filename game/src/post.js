import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = ['Low', 'Medium', 'High', 'Ultra'];

/** Renderer pipeline. Low = direct render, 1024 shadows; Medium = bloom, 2048 shadows; High = bloom, 4096 shadows, 1.5x res;
 *  Ultra = High + ambient occlusion (re-renders the scene, roughly halves FPS) and full-res. */
export function createPost(renderer, scene, camera, sky) {
  let composer = null, level = 1, ao = null, bloom = null;
  const build = () => {
    composer?.dispose?.();
    composer = null; ao = null; bloom = null;
    const pr = Math.min(devicePixelRatio, level >= 3 ? 2 : level >= 2 ? 1.5 : 1.25);
    renderer.setPixelRatio(pr);
    renderer.setSize(innerWidth, innerHeight, false);
    sky.setShadowQuality(level >= 2 ? 4096 : level >= 1 ? 2048 : 1024, level >= 2 ? 150 : 110);
    if (level === 0) return;
    const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
    const msaa = +(new URLSearchParams(location.search).get('msaa') ?? (level >= 3 ? 4 : level >= 2 ? 2 : 0));
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (level >= 3) {
      ao = new GTAOPass(scene, camera, Math.floor(w / 2), Math.floor(h / 2));
      ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
    }
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.45, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    if (!msaa) {   // Medium: FXAA instead of MSAA (MSAA on a half-float target cost ~40% FPS in testing)
      const fxaa = new ShaderPass(FXAAShader); fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h); composer.addPass(fxaa);
    }
  };
  build();
  return {
    get level() { return level; },
    set(l) { level = (l + QUALITY.length) % QUALITY.length; build(); return QUALITY[level]; },
    resize() { build(); },
    setNight(n) { if (bloom) { bloom.strength = 0.35 + n * 0.55; bloom.threshold = 0.95 - n * 0.2; } },
    render() { if (composer) composer.render(); else renderer.render(scene, camera); },
  };
}
