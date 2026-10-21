import {
  ACESFilmicToneMapping, EquirectangularReflectionMapping, PCFSoftShadowMap, PMREMGenerator,
  type DirectionalLight, type Texture, type WebGLRenderer,
} from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { GraphicsPreset } from './graphicsPreset';
import type { TimeGrade } from './timeGrade';
import { createProceduralEnvironment } from './proceduralEnv';

/** Bound the complete optional acquisition, including the HEAD probe. RGBELoader cannot be
 * cancelled, so a texture arriving after timeout/cancellation must be explicitly disposed. */
const HDRI_LOAD_TIMEOUT_MS = 8000;
function loadHdri(url: string, signal?: AbortSignal): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    const probe = new AbortController();
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); probe.abort(); reject(error);
    };
    const onAbort = () => fail(new Error('HDRI load aborted'));
    const timer = setTimeout(() => fail(new Error('HDRI load timed out')), HDRI_LOAD_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    void (async () => {
      const head = await fetch(url, { method: 'HEAD', signal: probe.signal });
      if (settled) return;
      const contentType = head.headers.get('content-type') ?? '';
      // Static SPA hosts may answer missing HDR assets with their HTML shell.
      if (!head.ok || /text\/html|application\/xhtml|application\/json/i.test(contentType)) {
        throw new Error(`Not an HDR (HTTP ${head.status}, ${contentType || 'no content-type'})`);
      }
      const hdr = await new RGBELoader().loadAsync(url);
      if (settled) { hdr.dispose(); return; }
      settled = true; cleanup(); resolve(hdr);
    })().catch(fail);
  });
}

/**
 * Realistic-renderer helpers (pane 9, founder teleoperator look, behind the `realisticRender` flag).
 * Deterministic, self-contained pieces the render foundation calls when the flag is on; the HD/Low
 * split comes from {@link GraphicsPreset}. Image-based lighting prefers CC0 Poly Haven HDRIs under
 * `/art/hdri/` (see docs/art/asset-purchases.md), chosen to match the SF time of day, but those assets
 * are optional: when none are shipped/served it falls back to a procedural IBL so boot never hangs
 * (gtasf-lpu0) — the realistic renderer runs with zero HDRI payload by default.
 */

/** ACES filmic tone mapping + soft shadow maps (shadows HD only). Call once on the renderer. */
export function configureRealisticRenderer(renderer: WebGLRenderer, preset: GraphicsPreset): void {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = preset === 'hd';
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = preset === 'hd';
}

/**
 * Configure the sun as a shadow-casting directional light with a stable ortho shadow camera sized to
 * `distance` metres (HD only; Low casts no shadows). Keep the light following the camera so the
 * shadow volume stays near the player (caller repositions `sun.target`/`sun.position` per frame).
 */
export function configureSunShadows(sun: DirectionalLight, preset: GraphicsPreset, distance = 220): void {
  sun.castShadow = preset === 'hd';
  if (!sun.castShadow) return;
  const size = preset === 'hd' ? 2048 : 1024;
  sun.shadow.mapSize.set(size, size);
  const c = sun.shadow.camera;
  c.near = 1; c.far = distance * 2.4;
  c.left = -distance; c.right = distance; c.top = distance; c.bottom = -distance;
  c.updateProjectionMatrix();
  // Bias tuned for city-scale ortho shadows; normalBias removes acne on near-vertical facades.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
}

/**
 * Much less fog than the PS2 path — the realistic look is clear and cinematic, with distance haze
 * only far out. Derived from the time-of-day fog so night/overcast still close in somewhat.
 */
export function realisticFog(grade: TimeGrade): { near: number; far: number } {
  return { near: Math.max(grade.fogNear * 2.2, 300), far: Math.max(grade.fogFar * 2.0, 1600) };
}

/** Time-of-day → HDRI basename under /art/hdri/ (matches the buckets proposed in asset-purchases.md). */
export function hdriForTime(grade: TimeGrade): string {
  if (grade.night > 0.6) return 'night';
  const h = grade.hour;
  if (h >= 17.5 && h < 18.9) return 'golden';
  if (h >= 18.9 && h < 20.2) return 'dusk';
  if (h >= 6 && h < 9) return 'partly-cloudy';
  return 'midday';
}

export interface RealisticEnvironment {
  /** The PMREM-processed environment map to assign to `scene.environment`, or null if unavailable. */
  texture: Texture | null;
  basename: string;
  /** Procedural fallback only: rebuild at the foundation's grade resample cadence. */
  update?(grade: TimeGrade): Texture | null;
  dispose(): void;
}

/**
 * Load the HDRI for `grade`'s time of day, PMREM-process it for IBL, and return the environment map.
 * When the asset is missing or decoding fails, falls back to a cheap procedural IBL built from the
 * grade (so metallic glass/chrome reflect the sky instead of black; gtasf-vvq9) — and to `null` only
 * if even that can't be built (no GL) or the load was aborted. The renderer never hard-fails.
 */
export async function loadRealisticEnvironment(
  renderer: WebGLRenderer, grade: TimeGrade, baseUrl = '/art/hdri/', signal?: AbortSignal,
): Promise<RealisticEnvironment> {
  const basename = hdriForTime(grade);
  const pmrem = new PMREMGenerator(renderer);
  try {
    const url = new URL(`${basename}.hdr`, new URL(baseUrl, location.href)).href;
    const hdr = await loadHdri(url, signal);
    if (signal?.aborted) { hdr.dispose(); pmrem.dispose(); return { texture: null, basename, dispose() {} }; }
    hdr.mapping = EquirectangularReflectionMapping;
    let env;
    try { env = pmrem.fromEquirectangular(hdr); } finally { hdr.dispose(); }
    pmrem.dispose();
    return { texture: env.texture, basename, dispose() { env.dispose(); } };
  } catch {
    pmrem.dispose();
    if (signal?.aborted) return { texture: null, basename, dispose() {} };
    // No HDRI shipped (web/public/art/hdri/ is absent) or it failed to decode: build a procedural
    // IBL from the grade so metallic surfaces reflect the sky instead of black (gtasf-vvq9). Guard
    // in case GL is unavailable, keeping the original graceful null fallback.
    try {
      const env = createProceduralEnvironment(renderer);
      try { env.update(grade); } catch (error) { env.dispose(); throw error; }
      return { get texture() { return env.texture; }, basename,
        update(nextGrade) { return env.update(nextGrade); }, dispose() { env.dispose(); } };
    } catch {
      return { texture: null, basename, dispose() {} };
    }
  }
}
