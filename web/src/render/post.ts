import {
  BufferAttribute, BufferGeometry, LinearFilter, LinearSRGBColorSpace, Mesh, OrthographicCamera,
  Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget,
  type Camera, type WebGLRenderer, Vector4, DepthTexture, UnsignedIntType, Matrix4, type PerspectiveCamera } from 'three';
import { gradeFromQuery, sfLookEnabled } from './sky/grade';
import type { QualityTier } from './qualityTier';
import { flags } from '@gtasf/shared/flags';

/** Small, single-scale bloom. No full-resolution blur chain or HDR image allocations. */
export const BLOOM = Object.freeze({ scale: 0.25, strength: 0.06, threshold: 0.7 });
/** San Andreas grade (vivid SF pass, PLAN-v2.1 §4 / pane 9): per-time `tint` only. The global 15%
 * desaturation (`sat` 0.85) and 3% black lift that washed the city to grey-green are removed — the
 * founder's "monochrome" note. `sat` 1.0 keeps full chroma, `lift` 0.0 keeps shadows true so blues
 * and reds read, while the per-time `tint` still carries the SA sky (cyan midday, orange golden
 * hour). Applied only in the graded (atmosphere) path. */
export const SA_GRADE = Object.freeze({ lift: 0.0, sat: 1.0 });

/** Mirrors the SA composite grade for tests: per-time `tint`, then optional lift/desaturate.
 * Vivid pass keeps lift 0 and sat 1, so this is a pure tint multiply. Linear in, linear out, [0,1]. */
export function saGrade(
  rgb: readonly [number, number, number], tint: readonly [number, number, number],
  lift: number = SA_GRADE.lift, sat: number = SA_GRADE.sat,
): [number, number, number] {
  const lifted = rgb.map((c, i) => c * tint[i]! * (1 - lift) + lift);
  const luma = lifted[0]! * 0.299 + lifted[1]! * 0.587 + lifted[2]! * 0.114;
  return lifted.map(c => Math.max(0, Math.min(1, luma + (c - luma) * sat))) as [number, number, number];
}
/** referenceGrade (GTA V gap critique #5): the default look moves from the vivid pumpkin golden hour / clear-blue noon
 * toward docs/sf-data/teleoperator-reference.png — warm but desaturated, cool blue-grey shadow side, lifted haze
 * blacks, low contrast. Applied last in the composite (HD + Low). `neutral` removes that share of the per-time tint's
 * HUE (brightness kept); `shadow`/`highlight` split-tone by luma; `lift` raises blacks (slightly blue); `sat` and
 * `contrast` (perceptual, about mid-grey) soften. Flag off keeps the vivid grade byte-identical (the "vivid" toggle). */
export const REFERENCE_GRADE = Object.freeze({
  // First A/B (0.55 / lift 0.026-0.038 / sat 0.8 / contrast 0.92) read milky and killed the lit arcade's warmth.
  neutral: 0.45, shadow: [0.95, 0.99, 1.06] as const, highlight: [1.03, 1.0, 0.96] as const,
  lift: [0.009, 0.012, 0.019] as const, sat: 0.86, contrast: 0.98,
});
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const luma = (c: readonly number[]) => c[0]! * LUMA[0] + c[1]! * LUMA[1] + c[2]! * LUMA[2];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Mirrors the GLSL referenceGrade stage for tests. Linear in, linear out, [0,1]. */
export function referenceGrade(rgb: readonly [number, number, number], tint: readonly [number, number, number] = [1, 1, 1]): [number, number, number] {
  const g = REFERENCE_GRADE, tl = Math.max(luma(tint), 1e-3);
  let c = rgb.map((v, i) => v / (1 + (tint[i]! / tl - 1) * g.neutral));
  const l = luma(c), k = smooth(0.05, 0.6, l);
  c = c.map((v, i) => v * (g.shadow[i]! + (g.highlight[i]! - g.shadow[i]!) * k) * (1 - 0.04) + g.lift[i]!);
  const l2 = luma(c);
  c = c.map(v => l2 + (v - l2) * g.sat);
  c = c.map(v => Math.pow((Math.pow(Math.max(v, 0), 1 / 2.2) - 0.5) * g.contrast + 0.5, 2.2));
  return c.map(v => Math.max(0, Math.min(1, v))) as [number, number, number];
}
const v3 = (v: readonly number[]) => `vec3(${v.map(n => n.toFixed(4)).join(',')})`;
const vertexShader = `varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position, 1.0); }`;
const blurShader = `uniform sampler2D image; uniform vec2 stepUv; uniform bool extract;
  uniform float threshold; varying vec2 vUv;
  vec3 tap(vec2 uv) {
    vec4 sampleColour = texture2D(image, uv);
    vec3 c = sampleColour.rgb;
    float peak = max(c.r, max(c.g, c.b));
    // Sky writes alpha zero; opaque ads, windows, roads and characters write one.
    return extract ? c * smoothstep(threshold, 1.0, peak) * (1.0-sampleColour.a) : c;
  }
  void main() {
    vec3 c = tap(vUv) * 0.227027;
    c += (tap(vUv + stepUv * 1.384615) + tap(vUv - stepUv * 1.384615)) * 0.316216;
    c += (tap(vUv + stepUv * 3.230769) + tap(vUv - stepUv * 3.230769)) * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }`;

/** Mirrors the bounded GPU composite for budget/contrast tests. Inputs and output are linear. */
export function bloomChannel(base: number, glow: number, strength = BLOOM.strength): number {
  const value = Math.max(0, Math.min(1, base));
  const x = Math.max(0, Math.min(1, (value - 0.02) / 0.13));
  const protectDark = x * x * (3 - 2 * x);
  return value + Math.max(0, Math.min(1, glow)) * Math.max(0, Math.min(BLOOM.strength, strength)) * (1 - value) * protectDark;
}

function target(width: number, height: number, depth: boolean, samples = 0) {
  const result = new WebGLRenderTarget(width, height, {
    type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: depth, stencilBuffer: false, generateMipmaps: false, samples,
  });
  result.texture.colorSpace = LinearSRGBColorSpace;
  return result;
}

/** gtasf-r9f6: the SF look preset (sky/grade.ts, ?grade= to tune) as (exposure, contrast, warmth, saturation). */
export function lookUniform(): Vector4 {
  if (!sfLookEnabled()) return new Vector4(0, 0, 0, 0);
  const g = gradeFromQuery(typeof location === 'undefined' ? '' : location.search);
  return new Vector4(g.exposure, g.contrast, g.warmth, g.saturation);
}
/** gtasf-r9f6 SSAO (desktop HD + SF look): half-res, depth-only (normals from depth derivatives), 12 spiral taps. */
const SSAO_FRAGMENT = `#include <packing>
  uniform sampler2D depthTex; uniform float cameraNear; uniform float cameraFar; uniform mat4 projInv; uniform vec2 texel; varying vec2 vUv;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(depthTex, uv).x;
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = projInv * clip; return v.xyz / v.w;
  }
  void main() {
    float d = texture2D(depthTex, vUv).x;
    if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(vUv);
    vec3 n = normalize(cross(dFdx(p), dFdy(p)));
    float radius = 1.2, occlusion = 0.0;
    float scale = radius / max(0.5, -p.z) * 0.9; // screen-space radius shrinks with distance
    for (int i = 0; i < 12; i++) {
      float fi = float(i), a = fi * 2.39996, r = (fi + 1.0) / 12.0;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * scale;
      vec3 q = viewPos(uv) - p;
      float dist = length(q);
      // Fade by DEPTH difference, not distance: a foreground body must not darken the ground far behind it (halo).
      float rangeCheck = (1.0 - smoothstep(0.3 * radius, 0.6 * radius, abs(q.z))) * step(dist, radius * 1.5);
      occlusion += max(0.0, dot(n, q / max(dist, 1e-3)) - 0.05) * rangeCheck;
    }
    float ao = clamp(1.0 - occlusion / 12.0 * 4.0, 0.0, 1.0);
    gl_FragColor = vec4(vec3(ao), 1.0);
  }`;
/** The SA/SF composite grade chain (GLSL): `colour` (linear, [0,1]) + `tint` uniform in, `graded` out. Shared with the
 * realisticLightingV2 output pass so the realistic HD path keeps the timeGrade palette (sky gradient, warm facades). */
export function gradeChainGlsl(useBloom: boolean, tier: QualityTier): string {
  return `// San Andreas grade: per-time tint, then LIFT blacks (shadows stay off pure black) and
        // DESATURATE mid-tones at low contrast — the opposite of a black cut / contrast boost.
        vec3 lifted = colour * tint * (1.0 - ${SA_GRADE.lift.toFixed(3)}) + ${SA_GRADE.lift.toFixed(3)};
        float saLuma = dot(lifted, vec3(0.299, 0.587, 0.114));
        vec3 graded = clamp(mix(vec3(saLuma), lifted, ${SA_GRADE.sat.toFixed(3)}), 0.0, 1.0);
        ${flags.graphicsV2 ? `// Graphics v2 SA grade (preview #1: v1 read grey/washed): warm saturated SA light, barely lifted, a soft
        // filmic shoulder and slight desaturation — the hazy PS2 San Andreas look, never a black crush.
        // Highlights roll off rather than clip so billboards/ads stay readable.
        float l2 = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        vec3 split = mix(vec3(0.97, 0.99, 1.04), vec3(1.07, 1.01, 0.92), smoothstep(0.1, 0.65, l2));
        vec3 v2 = graded * split;
        v2 = v2 * (1.0 - 0.012) + vec3(0.010, 0.010, 0.014);
        v2 = v2 / (1.0 + 0.18 * v2) * 1.18;
        float l3 = dot(v2, vec3(0.2126, 0.7152, 0.0722));
        v2 = clamp(mix(vec3(l3), v2, 1.08), 0.0, 1.0);
        v2 = clamp(mix(vec3(0.42), v2, 1.07), 0.0, 1.0); // gentle contrast: noon must not read milky
        ${useBloom ? `vec2 vc = vUv - 0.5; v2 *= 1.0 - 0.16 * dot(vc, vc);` : ''}
        graded = v2;` : ''}
        ${flags.atmosphereSky ? `// SF look grade (gtasf-r9f6, all tiers): uLook = (exposure stops, contrast, warmth, saturation), sky/grade.ts.
        graded *= exp2(uLook.x);
        // Contrast in perceptual (gamma) space: this pass is LINEAR, and pivoting at linear 0.5 crushed shadows and
        // turned backlit people/cars into silhouettes at sunset (first A/B, Oct 7).
        vec3 pLook = pow(max(graded, 0.0), vec3(1.0 / 2.2));
        pLook = (pLook - 0.5) * (1.0 + uLook.y) + 0.5;
        graded = pow(max(pLook, 0.0), vec3(2.2));
        graded *= vec3(1.0 + uLook.z * 0.12, 1.0 + uLook.z * 0.02, 1.0 - uLook.z * 0.12);
        float lLook = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = clamp(mix(vec3(lLook), graded, 1.0 + uLook.w), 0.0, 1.0);` : ''}
        ${'filmicGrade' in flags && flags.filmicGrade && tier !== 'low' ? `// Filmic finish (gtasf teleoperator look), HD only (Low missed the 60 fps floor for a full-screen pass):
        // a gentle highlight shoulder + a touch of warmth on the upper mids
        // for a cohesive cinematic tone on top of the SA/SF grade. Deliberately subtle — complements, never fights,
        // the existing split-tone; no extra pass, LUT texture or bloom. Flag-off is byte-identical.
        float fL = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = graded / (1.0 + 0.10 * max(graded - 0.62, 0.0));                              // soft shoulder on highlights only
        graded *= mix(vec3(1.0), vec3(1.035, 1.006, 0.972), smoothstep(0.25, 0.92, fL));       // warm the upper mids/highlights a hair
        graded = clamp(graded, 0.0, 1.0);` : ''}
        ${flags.referenceGrade ? `// referenceGrade (critique #5): desaturated warm-grey with a cool shadow side (REFERENCE_GRADE above).
        vec3 rT = tint / max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        graded = graded / (1.0 + (rT - 1.0) * ${REFERENCE_GRADE.neutral.toFixed(3)});
        float rL = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded *= mix(${v3(REFERENCE_GRADE.shadow)}, ${v3(REFERENCE_GRADE.highlight)}, smoothstep(0.05, 0.6, rL));
        graded = graded * (1.0 - 0.04) + ${v3(REFERENCE_GRADE.lift)};
        float rL2 = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(rL2), graded, ${REFERENCE_GRADE.sat.toFixed(3)});
        vec3 rP = (pow(max(graded, 0.0), vec3(1.0 / 2.2)) - 0.5) * ${REFERENCE_GRADE.contrast.toFixed(3)} + 0.5;
        graded = clamp(pow(max(rP, 0.0), vec3(2.2)), 0.0, 1.0);` : ''}`;
}
export function createPost(renderer: WebGLRenderer, tier: QualityTier = 'medium', options: { ssao?: boolean } = {}) {
  // MSAA 4x on the scene colour target gives edge anti-aliasing (the biggest "low quality"
  // win, gtasf-v2-render-cheap-wins-yjjz); phones (low) stay at 0. Three resolves the
  // multisample buffer on .texture read, so the bloom blur/composite are unchanged. The
  // bloom targets stay single-sample.
  const useBloom = tier !== 'low';
  const samples = useBloom ? (flags.graphicsV2 ? Math.min(4, renderer.capabilities.maxSamples) : 4) : 0;
  const colour = target(1, 1, true, samples);
  const ssao = Boolean(options.ssao) && tier !== 'low';
  const ssaoDebug = ssao && flags.testingHarness && typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'ssao';
  if (ssao) colour.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
  const aoTarget = ssao ? target(1, 1, false) : undefined;
  const horizontal = useBloom ? target(1, 1, false) : undefined;
  const vertical = useBloom ? target(1, 1, false) : undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), 3));
  const blur = new ShaderMaterial({
    name: 'GTASF bounded bloom', vertexShader, fragmentShader: blurShader,
    uniforms: { image: { value: colour.texture }, stepUv: { value: new Vector2() }, extract: { value: true }, threshold: { value: BLOOM.threshold } },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const composite = new ShaderMaterial({
    name: 'GTASF output', vertexShader,
    uniforms: { image: { value: colour.texture }, bloom: { value: vertical?.texture ?? colour.texture }, strength: { value: BLOOM.strength }, tint: { value: new Vector3(1,1,1) }, grade: { value: 0 }, uLook: { value: lookUniform() }, aoTex: { value: null }, aoOn: { value: 0 }, aoTexel: { value: new Vector2() } },
    fragmentShader: `uniform sampler2D image; uniform sampler2D bloom; uniform float strength; uniform vec3 tint; uniform float grade; uniform vec4 uLook; uniform sampler2D aoTex; uniform float aoOn; uniform vec2 aoTexel; varying vec2 vUv;
      void main() {
        vec3 base = texture2D(image, vUv).rgb;
        if (aoOn > 0.5) { // SSAO (gtasf-r9f6): 3x3 blurred, darkens only
          float ao = 0.0;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) ao += texture2D(aoTex, vUv + vec2(float(x), float(y)) * aoTexel).r;
          base *= mix(1.0, ao / 9.0, 0.85);
          if (aoOn > 1.5) base = vec3(ao / 9.0); // ?debug=ssao (testing harness): show the AO buffer
        }
        vec3 glow = ${useBloom ? 'texture2D(bloom, vUv).rgb' : 'vec3(0.0)'};
        // Preserve dark text and leave headroom instead of clipping additive bloom to white.
        vec3 protectDark = smoothstep(vec3(0.02), vec3(0.15), base);
        vec3 colour = base + glow * strength * (1.0 - base) * protectDark;
        ${gradeChainGlsl(useBloom, tier)}
        gl_FragColor = vec4(mix(colour,graded,grade), 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const aoMaterial = ssao ? new ShaderMaterial({ name: 'GTASF SSAO', vertexShader, fragmentShader: SSAO_FRAGMENT,
    uniforms: { depthTex: { value: colour.depthTexture }, cameraNear: { value: .1 }, cameraFar: { value: 1000 }, projInv: { value: new Matrix4() }, texel: { value: new Vector2() } },
    depthTest: false, depthWrite: false }) : undefined;
  const triangle = new Mesh(geometry, blur), passScene = new Scene(), passCamera = new OrthographicCamera();
  triangle.frustumCulled = false;
  passScene.add(triangle);
  let width = 1, height = 1, disposed = false;
  function pass(material: ShaderMaterial, output: WebGLRenderTarget | null) {
    triangle.material = material;
    renderer.setRenderTarget(output);
    renderer.render(passScene, passCamera);
  }
  return {
    setGrade(tint: Vector3 | null): void {
      composite.uniforms.grade!.value = tint ? 1 : 0;
      (composite.uniforms.tint!.value as Vector3).copy(tint ?? new Vector3(1,1,1));
    },
    resize(w: number, h: number): void {
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new RangeError('POST_SIZE');
      if (width === w && height === h) return;
      width = w; height = h;
      colour.setSize(w, h);
      aoTarget?.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
      const bw = Math.max(1, Math.ceil(w * BLOOM.scale)), bh = Math.max(1, Math.ceil(h * BLOOM.scale));
      horizontal?.setSize(bw, bh); vertical?.setSize(bw, bh);
    },
    render(scene: Scene, camera: Camera, bloom = true): void {
      if (disposed) return;
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(colour);
        renderer.render(scene, camera);
        if (bloom && horizontal && vertical) {
          blur.uniforms.image!.value = colour.texture;
          blur.uniforms.extract!.value = true;
          (blur.uniforms.stepUv!.value as Vector2).set(1 / horizontal.width, 0);
          pass(blur, horizontal);
          blur.uniforms.image!.value = horizontal.texture;
          blur.uniforms.extract!.value = false;
          (blur.uniforms.stepUv!.value as Vector2).set(0, 1 / vertical.height);
          pass(blur, vertical);
        }
        if (aoMaterial && aoTarget && (camera as PerspectiveCamera).isPerspectiveCamera) {
          const cam = camera as PerspectiveCamera;
          aoMaterial.uniforms.cameraNear!.value = cam.near; aoMaterial.uniforms.cameraFar!.value = cam.far;
          (aoMaterial.uniforms.projInv!.value as Matrix4).copy(cam.projectionMatrixInverse);
          pass(aoMaterial, aoTarget);
          composite.uniforms.aoTex!.value = aoTarget.texture; composite.uniforms.aoOn!.value = ssaoDebug ? 2 : 1;
          (composite.uniforms.aoTexel!.value as Vector2).set(1 / aoTarget.width, 1 / aoTarget.height);
        } else composite.uniforms.aoOn!.value = 0;
        composite.uniforms.strength!.value = bloom && useBloom ? BLOOM.strength : 0;
        pass(composite, previous);
      } finally { renderer.setRenderTarget(previous); }
    },
    /** Conservative depth charge is four bytes/pixel, in addition to scene colour. */
    bytes(): number { return width * height * 8 + (horizontal ? horizontal.width * horizontal.height * 8 : 0); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      colour.dispose(); horizontal?.dispose(); vertical?.dispose();
      geometry.dispose(); blur.dispose(); composite.dispose();
      colour.depthTexture?.dispose(); aoTarget?.dispose(); aoMaterial?.dispose();
    },
  };
}
