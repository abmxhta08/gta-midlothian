import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { settings } from './config/settings.js';
import { logEvent } from './core/health.js';

export const QUALITY = ['Low', 'Medium', 'High', 'Ultra'];

// GPU memory budget per quality level. On a Retina display a fullscreen window is ~4.5 M device pixels;
// half-float targets + MSAA + bloom + AO + a 4096 shadow map add up quickly, so the pixel ratio is capped
// per level and the main render target is also capped by total pixel count (big 4K windows scale down).
export const PIXEL_RATIO_CAP = [1, 1, 1.5, 2];
export const PIXEL_BUDGET = [3.0e6, 3.0e6, 5.5e6, 8.0e6];
const SHADOW_SIZE = [1024, 2048, 4096, 4096];

/** Renderer pipeline. Low = direct render, 1024 shadows; Medium = bloom + FXAA, 2048 shadows; High = bloom, 2x MSAA,
 *  4096 shadows; Ultra = High + ambient occlusion, 4x MSAA. Each effect can be switched off on its own
 *  (settings fxBloom/fxAO, or ?bloom=0 ?ao=0 ?post=0), and if the composer ever throws the game falls back to
 *  direct rendering instead of showing a black screen. */
export function createPost(renderer, scene, camera, sky) {
  const params = new URLSearchParams(location.search);
  let composer = null, level = 1, ao = null, bloom = null, fxaa = null;
  let size = { w: 0, h: 0, pr: 0 }, failures = 0, disabled = false, disabledReason = null, rebuilds = 0, lastError = null;

  const effects = () => ({
    post: params.get('post') !== '0',
    bloom: params.get('bloom') !== '0' && settings.fxBloom !== false,
    ao: params.get('ao') !== '0' && settings.fxAO !== false,
  });
  /** Pixel ratio for a window size at the current level: capped by level, device ratio and total pixel budget. */
  const ratio = (l, w, h) => Math.max(0.5, Math.min(devicePixelRatio || 1, PIXEL_RATIO_CAP[l], Math.sqrt(PIXEL_BUDGET[l] / Math.max(1, w * h))));

  /** EffectComposer.dispose() only frees its own two targets and the copy pass; every pass must be disposed too
   *  (bloom alone owns 11 half-float targets), otherwise each rebuild leaks GPU memory. */
  const disposeComposer = () => {
    if (!composer) return;
    for (const p of composer.passes) { try { p.dispose?.(); } catch (e) { /* keep disposing */ } }
    try { composer.dispose(); } catch (e) { /* ignore */ }
    composer = ao = bloom = fxaa = null;
  };

  const build = () => {
    disposeComposer(); rebuilds++;
    const w = Math.max(8, innerWidth), h = Math.max(8, innerHeight), pr = ratio(level, w, h);
    size = { w, h, pr };
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    sky.setShadowQuality(SHADOW_SIZE[level], level >= 2 ? 150 : 110);
    const fx = effects();
    if (level === 0 || disabled || !fx.post) return;
    const pw = Math.floor(w * pr), ph = Math.floor(h * pr);
    const msaa = +(params.get('msaa') ?? (level >= 3 ? 4 : level >= 2 ? 2 : 0));
    const rt = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (level >= 3 && fx.ao) {
      const k = pw * ph > 4e6 ? 3 : 2;   // AO runs below the main resolution; lower still on very large windows
      ao = new GTAOPass(scene, camera, Math.floor(pw / k), Math.floor(ph / k));
      ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
    }
    if (fx.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(pw / 2, ph / 2), 0.45, 0.5, 0.92); composer.addPass(bloom); }
    composer.addPass(new OutputPass());
    if (!msaa) {   // Medium: FXAA instead of MSAA (MSAA on a half-float target cost ~40% FPS in testing)
      fxaa = new ShaderPass(FXAAShader); fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph); composer.addPass(fxaa);
    }
    logEvent('post-build', { level, w, h, pr: +pr.toFixed(2), msaa, bloom: !!bloom, ao: !!ao });
  };

  build();
  return {
    get level() { return level; },
    get disabled() { return disabled; },
    set(l) { level = (l + QUALITY.length) % QUALITY.length; logEvent('quality', QUALITY[level]); build(); return QUALITY[level]; },
    /** Recreate all render targets at the current size (also used to recover from a bad frame). */
    rebuild() { build(); },
    /** Window/pixel-ratio change: resize the existing targets in place. Zero or unchanged sizes are ignored. */
    resize() {
      const w = innerWidth, h = innerHeight;
      if (!(w > 8 && h > 8)) return false;                // minimised / mid-transition: keep the old size
      const pr = ratio(level, w, h);
      if (w === size.w && h === size.h && Math.abs(pr - size.pr) < 1e-3) return false;
      size = { w, h, pr };
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
      if (composer) {
        const pw = Math.floor(w * pr), ph = Math.floor(h * pr);
        composer.setSize(pw, ph);
        if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
      }
      logEvent('post-resize', { w, h, pr: +pr.toFixed(2) });
      return true;
    },
    setNight(n) { if (bloom) { bloom.strength = 0.35 + n * 0.55; bloom.threshold = 0.95 - n * 0.2; } },
    /** Switch the whole composer off (direct rendering) or back on. */
    setDisabled(flag, reason = null) { if (disabled === flag) return; disabled = flag; disabledReason = flag ? reason : null; logEvent('post-disabled', { flag, reason }); build(); },
    status() { return { level: QUALITY[level], composer: !!composer, passes: composer ? composer.passes.length : 0, bloom: !!bloom, ao: !!ao, fxaa: !!fxaa, disabled, disabledReason, size, rebuilds, failures, lastError: lastError && String(lastError.message || lastError) }; },
    render() {
      if (composer && !disabled) {
        try { composer.render(); failures = 0; return; }
        catch (e) {
          lastError = e; failures++; console.error('[Midlothian] post-processing failed', e); logEvent('post-error', String(e.message || e));
          renderer.setRenderTarget(null);
          if (failures >= 3) this.setDisabled(true, String(e.message || e));
        }
      }
      renderer.render(scene, camera);
    },
  };
}
