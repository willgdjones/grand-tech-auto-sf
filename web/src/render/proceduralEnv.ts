import { BackSide, Color, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { TimeGrade } from './timeGrade';

/**
 * A cheap IBL environment built from the time-of-day grade, for the realistic
 * renderer when no HDRI asset ships. The fallback in `loadRealisticEnvironment()`
 * uses this instead of a null environment, which would leave metallic/glass
 * materials with nothing to reflect but black. This gives them the sky and ground
 * colours of the current grade instead, and SA-STYLE's "crude environment-map
 * gleam on car paint and chrome".
 *
 * The loader owns this handle; foundation refreshes it on the ~30s grade
 * resample and live time overrides (gtasf-bqt8). Replacing/disposal frees the
 * full PMREM render target. Gated behind `realisticRender` for both presets.
 */
export function createProceduralEnvironment(renderer: WebGLRenderer) {
  const pmrem = new PMREMGenerator(renderer);
  const geometry = new SphereGeometry(10, 24, 16);
  const material = new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: { uZenith: { value: new Color() }, uHorizon: { value: new Color() }, uGround: { value: new Color() } },
    vertexShader: /* glsl */`
      varying float vY;
      void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying float vY; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
      void main() {
        vec3 col = vY < 0.0
          ? mix(uHorizon, uGround, clamp(-vY * 1.5, 0.0, 1.0))      // below the horizon: ground bounce
          : mix(uHorizon, uZenith, pow(clamp(vY, 0.0, 1.0), 0.45)); // above: sky gradient
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  let current: WebGLRenderTarget | null = null;
  let disposed = false;
  return {
    /** Build or refresh the PMREM environment map from `grade`; returns the new map. */
    update(grade: TimeGrade): Texture {
      if (disposed) throw new Error('Procedural environment is disposed');
      (material.uniforms.uZenith!.value as Color).copy(grade.zenith);
      (material.uniforms.uHorizon!.value as Color).copy(grade.horizon);
      (material.uniforms.uGround!.value as Color).copy(grade.groundColour);
      const next = pmrem.fromScene(scene);
      current?.dispose();
      current = next;
      return current.texture;
    },
    /** The current environment map, or null until the first `update`. */
    get texture(): Texture | null { return current?.texture ?? null; },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      current?.dispose(); current = null;
      pmrem.dispose(); geometry.dispose(); material.dispose();
    },
  };
}
