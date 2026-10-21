import { ShaderMaterial, Vector2, Vector3, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { GraphicsPreset } from './graphicsPreset';
import { gradeChainGlsl, lookUniform } from './post';

/**
 * realisticLightingV2 graded output (replaces OutputPass on that path only). Two fixes over plain OutputPass:
 * 1. Sky pixels (alpha 0: the takram atmosphere and the SA dome both write it as the sky mask) are ALREADY
 *    display-referred (atmosphereSky compresses radiance with 1-exp(-6x); the dome is authored for NoToneMapping),
 *    so ACES on them pushed the pale golden horizon to flat white. They skip ACES; geometry keeps it.
 * 2. The ps2 composite's timeGrade chain (per-time tint, v2 split-tone/shoulder, SF look, reference grade) never ran on
 *    the realistic path, so the sky lost its golden tint and facades went neutral. It now runs after ACES, the
 *    same GLSL as post.ts, so the sky is graded exactly as flag-off and buildings keep their warm palette.
 */
function createGradedOutput(renderer: WebGLRenderer): ShaderPass {
  const material = new ShaderMaterial({
    name: 'GTASF realistic graded output',
    uniforms: { tDiffuse: { value: null }, tint: { value: new Vector3(1, 1, 1) }, grade: { value: 0 }, uLook: { value: lookUniform() }, exposure: { value: renderer.toneMappingExposure } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float grade; uniform vec4 uLook; uniform float exposure; varying vec2 vUv;
      vec3 rlvRrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 rlvAces(vec3 c) { // three.js ACESFilmicToneMapping (fitted), inlined: render targets get NoToneMapping.
        const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        return clamp(outM * rlvRrtOdt(inM * (c * exposure / 0.6)), 0.0, 1.0);
      }
      vec3 rlvSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float sky = 1.0 - clamp(texel.a, 0.0, 1.0);
        vec3 colour = mix(rlvAces(texel.rgb), clamp(texel.rgb, 0.0, 1.0), sky);
        ${gradeChainGlsl(true, 'medium')}
        gl_FragColor = vec4(rlvSrgb(mix(colour, graded, grade)), 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  return new ShaderPass(material);
}

/**
 * Realistic post pipeline (pane 9, behind the `realisticRender` flag).
 *
 * HD: RenderPass → SSAO → subtle bloom (emissive objects only) → OutputPass (ACES tone map + sRGB) → SMAA.
 * Low: one direct scene pass, no composer, SSAO, bloom or SMAA render targets. The renderer applies
 * ACES + sRGB directly to the screen. HD OutputPass applies whatever tone mapping the renderer is set to
 * (configureRealisticRenderer sets ACES filmic). Bloom uses a high threshold so only bright emissive
 * object pixels (windows and headlights) glow; the authored sky is excluded.
 */
export function createRealisticPost(opts: {
  renderer: WebGLRenderer; scene: Scene; camera: Camera; preset: GraphicsPreset; width: number; height: number;
  /** realisticLightingV2: graded output (sky skips ACES + timeGrade chain) instead of the plain OutputPass. */
  graded?: boolean;
}): {
  composer: EffectComposer | null; render(camera?: Camera): void; setSize(w: number, h: number): void; dispose(): void;
  /** Per-time timeGrade tint for the graded output (no-op otherwise); null disables the grade. */
  setGrade(tint: Vector3 | null): void;
} {
  if (opts.preset === 'low') {
    let camera = opts.camera, disposed = false;
    return {
      composer: null,
      render(nextCamera = camera) { if (!disposed) { camera = nextCamera; opts.renderer.render(opts.scene, camera); } },
      setSize() { /* The foundation owns the renderer drawing buffer. */ },
      setGrade() { /* Low has no composer. */ },
      dispose() { disposed = true; },
    };
  }
  const width = Math.max(1, Math.floor(opts.width)), height = Math.max(1, Math.floor(opts.height));
  const composer = new EffectComposer(opts.renderer);
  composer.setSize(width, height);
  const renderPass = new RenderPass(opts.scene, opts.camera);
  composer.addPass(renderPass);
  const ssao = new SSAOPass(opts.scene, opts.camera, width, height);
  ssao.kernelRadius = 8; ssao.minDistance = 0.0015; ssao.maxDistance = 0.1;
  composer.addPass(ssao);
  const bloom = new UnrealBloomPass(new Vector2(width, height), 0.2, 0.4, 1.1);
  // Sky writes alpha=0 as an offscreen mask; SSAO's multiplicative blend preserves it.
  // three's default high pass ignores alpha, so an HDR horizon/cloud can bloom across
  // the whole screen. Preserve its authored colour but exclude it from the glow source.
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
    'float v = luminance( texel.xyz );',
    'float v = luminance( texel.xyz ) * clamp( texel.a, 0.0, 1.0 );',
  );
  composer.addPass(bloom);
  const gradedOutput = opts.graded ? createGradedOutput(opts.renderer) : undefined;
  composer.addPass(gradedOutput ?? new OutputPass());
  const smaa = new SMAAPass();
  smaa.setSize(width, height);
  composer.addPass(smaa);
  return {
    composer,
    render(camera?: Camera): void {
      // The foundation may render with the chase or cinematic camera; keep the pass in sync.
      if (camera && camera !== renderPass.camera) { renderPass.camera = camera; if (ssao) ssao.camera = camera; }
      composer.render();
    },
    setGrade(tint: Vector3 | null): void {
      if (!gradedOutput) return;
      gradedOutput.uniforms.grade!.value = tint ? 1 : 0;
      if (tint) (gradedOutput.uniforms.tint!.value as Vector3).copy(tint);
    },
    setSize(w: number, h: number): void {
      const W = Math.max(1, Math.floor(w)), H = Math.max(1, Math.floor(h));
      composer.setSize(W, H); ssao?.setSize(W, H); bloom.setSize(W, H); smaa.setSize(W, H);
    },
    dispose(): void { for (const pass of composer.passes) pass.dispose(); composer.dispose(); },
  };
}
