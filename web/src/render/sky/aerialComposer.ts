// gtasf-kpi9 (flag aerialPerspectiveHd, graphicsV2 + HD only): full takram AerialPerspectiveEffect in a pmndrs
// EffectComposer with HalfFloat buffers, replacing the ps2 post on HD. Lazy-loaded from foundation.ts so Low/phone
// bundles never download postprocessing. Shares the sky's precomputed textures, world->ECEF frame and ECEF sun
// (atmosphereSky.ts), so fog and sky agree. Chain: RenderPass -> AerialPerspective -> low bloom (readable ads)
// -> ACES tone map; the composer's last pass writes the renderer's sRGB output colour space.
import { HalfFloatType, type Camera, type Scene, type WebGLRenderer, Uniform } from 'three';
import type { AtmosphereSky } from './atmosphereSky';

import { GRADE_FRAGMENT, gradeFromQuery } from './grade';
export interface AerialComposer {
  render(camera: Camera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Undefined when anything fails to load or build; the caller keeps the ps2 post path. */
export async function createAerialComposer(opts: {
  renderer: WebGLRenderer; scene: Scene; camera?: Camera; sky: AtmosphereSky; width: number; height: number;
}): Promise<AerialComposer | undefined> {
  try {
    const [pp, { AerialPerspectiveEffect }] = await Promise.all([import('postprocessing'), import('@takram/three-atmosphere')]);
    const { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, Effect } = pp;
    const composer = new EffectComposer(opts.renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
    const renderPass = new RenderPass(opts.scene, opts.camera);
    // sky: false — the takram SkyMaterial mesh already draws the sky; the effect only fogs geometry.
    const aerial = new AerialPerspectiveEffect(opts.camera, { sky: false, ground: false });
    Object.assign(aerial, opts.sky.shared.textures);
    aerial.worldToECEFMatrix.copy(opts.sky.shared.worldToECEFMatrix);
    const bloom = new BloomEffect({ intensity: 0.2, luminanceThreshold: 1.1, luminanceSmoothing: 0.2, mipmapBlur: true });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const aerialPass = new EffectPass(opts.camera, aerial);
    composer.addPass(renderPass);
    composer.addPass(aerialPass);
    // Lightroom-style grade after tone mapping (gtasf-r9f6): one tunable preset, ?grade=e,c,w,s to tune live.
    const g = gradeFromQuery(typeof location === 'undefined' ? '' : location.search);
    const grade = new Effect('GtasfGrade', GRADE_FRAGMENT, { uniforms: new Map([
      ['uExposure', new Uniform(g.exposure)], ['uContrast', new Uniform(g.contrast)], ['uWarmth', new Uniform(g.warmth)], ['uSaturation', new Uniform(g.saturation)]]) });
    composer.addPass(new EffectPass(opts.camera, bloom, toneMapping, grade));
    composer.setSize(Math.max(1, Math.floor(opts.width)), Math.max(1, Math.floor(opts.height)), false);
    let current: Camera | undefined = opts.camera;
    return {
      render(camera) {
        if (camera !== current) { current = camera; renderPass.mainCamera = camera; aerial.mainCamera = camera; aerialPass.mainCamera = camera; }
        aerial.sunDirection.copy(opts.sky.shared.sunDirection);
        composer.render();
      },
      setSize(width, height) { composer.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)), false); },
      dispose() { composer.dispose(); },
    };
  } catch { return undefined; }
}
