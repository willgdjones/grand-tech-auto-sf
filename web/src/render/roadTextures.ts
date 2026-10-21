import { NearestFilter, NearestMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, type IUniform, type MeshLambertMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';

const ids = ['worn-asphalt', 'cobbles', 'sidewalk-kerb'] as const;
interface Tile { id: string; path: string; width: number; height: number; sha256: string }
/** Anisotropic filtering keeps worn asphalt and lane paint crisp at the shallow angles you drive at
 *  (the SA street look) instead of blurring into the distance. three.js clamps it to the device max on
 *  upload, so an unsupported value can't break rendering; the cost is GPU fill-rate only, so it does not
 *  load the CPU-throttled phone perf gate. [gtasf-v2-render-cheap-wins-yjjz] */
const ROAD_ANISOTROPY = 8;

/** Three shared 256px tiles for the source road material. Markings use road-aligned geometry. */
export function createRoadTextures(enabled = 'groundTextures' in flags && Boolean(flags.groundTextures)) {
  if (!enabled) return undefined;
  const uniforms: Record<string, IUniform> = {
    uRoadAsphalt: { value: null }, uRoadCobbles: { value: null }, uRoadSlabs: { value: null }, uRoadReady: { value: 0 },
  };
  const lowUniforms: Record<string, IUniform> = { ...uniforms,
    uRoadAsphalt: { value: null }, uRoadCobbles: { value: null }, uRoadSlabs: { value: null },
  };
  const textures: Texture[] = [], images: ImageBitmap[] = [], abort = new AbortController();
  const stats = { state: 'loading', bytes: 0, materials: 0, lowMaterials: 0, tileSize: 256, lowTileSize: 128, error: '' };
  let disposed = false;
  const ready = (async () => {
    if (typeof window === 'undefined') { stats.state = 'fallback'; return false; }
    try {
      const response = await fetch('/art/manifest.json', { signal: abort.signal });
      if (!response.ok) throw new Error(`Road manifest HTTP ${response.status}`);
      const manifest = await response.json() as { ground?: Tile[] };
      for (let i = 0; i < ids.length; i++) {
        const tile = manifest.ground?.find(t => t.id === ids[i]);
        if (!tile || tile.width !== 256 || tile.height !== 256 || !/^\/art\/ground\/[a-z-]+\.tile\.png$/.test(tile.path) || !/^[a-f0-9]{64}$/.test(tile.sha256)) throw new Error('Invalid road tile manifest');
        const imageResponse = await fetch(tile.path, { signal: abort.signal });
        if (!imageResponse.ok) throw new Error(`Road tile HTTP ${imageResponse.status}`);
        const bytes = await imageResponse.arrayBuffer();
        if (bytes.byteLength > 500_000) throw new Error('Road tile encoded budget');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        if (hash !== tile.sha256) throw new Error('Road tile hash mismatch');
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        if (disposed) { image.close(); return false; }
        if (image.width !== 256 || image.height !== 256) { image.close(); throw new Error('Road tile dimensions'); }
        images.push(image); stats.bytes += bytes.byteLength;
        const texture = new Texture(image); texture.name = `GTASF ${ids[i]}`;
        texture.colorSpace = SRGBColorSpace; texture.flipY = false; texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.minFilter = NearestMipmapLinearFilter; texture.magFilter = NearestFilter; texture.generateMipmaps = true; texture.anisotropy = ROAD_ANISOTROPY; texture.needsUpdate = true;
        textures.push(texture); uniforms[['uRoadAsphalt', 'uRoadCobbles', 'uRoadSlabs'][i]!]!.value = texture;
        const small = await createImageBitmap(image, { resizeWidth: 128, resizeHeight: 128, resizeQuality: 'pixelated',
          imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        if (disposed) { small.close(); return false; }
        images.push(small);
        const lowTexture = new Texture(small); lowTexture.name = `GTASF city ${ids[i]} 128px`;
        lowTexture.colorSpace = SRGBColorSpace; lowTexture.flipY = false; lowTexture.wrapS = lowTexture.wrapT = RepeatWrapping;
        lowTexture.minFilter = NearestMipmapLinearFilter; lowTexture.magFilter = NearestFilter; lowTexture.generateMipmaps = true; lowTexture.anisotropy = ROAD_ANISOTROPY; lowTexture.needsUpdate = true;
        textures.push(lowTexture); lowUniforms[['uRoadAsphalt', 'uRoadCobbles', 'uRoadSlabs'][i]!]!.value = lowTexture;
      }
      uniforms.uRoadReady!.value = 1; stats.state = 'ready'; return true;
    } catch (error) {
      if (!disposed) { stats.state = 'fallback'; stats.error = String(error); }
      return false;
    }
  })();
  return {
    uniforms, lowUniforms, stats, ready,
    dispose() {
      if (disposed) return; disposed = true; abort.abort(); stats.state = 'disposed';
      uniforms.uRoadReady!.value = 0;
      for (const texture of textures) texture.dispose(); for (const image of images) image.close();
      textures.length = 0; images.length = 0;
    },
  };
}
export type RoadTextures = NonNullable<ReturnType<typeof createRoadTextures>>;

/** Merged/quantized source meshes have no UVs; resolve world metres after node transforms. */
export function addRoadTextures(material: MeshLambertMaterial, tiles: RoadTextures, low = false): void {
  material.customProgramCacheKey = () => `gtasf-road-tiles-v1:ar${flags.aerialRoadRead ? 1 : 0}`;
  material.userData.gtasfRoadTextures = tiles.stats; tiles.stats.materials++;
  material.userData.gtasfRoadLow = low; if (low) tiles.stats.lowMaterials++;
  material.addEventListener('dispose', () => { tiles.stats.materials--; if (low) tiles.stats.lowMaterials--; });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, low ? tiles.lowUniforms : tiles.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoadMetres;${flags.aerialRoadRead ? '\nvarying vec3 vRoadWorld;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvRoadMetres=(modelMatrix*vec4(transformed,1.0)).xz;${flags.aerialRoadRead ? '\n  vRoadWorld=(modelMatrix*vec4(transformed,1.0)).xyz;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRoadMetres;\nuniform sampler2D uRoadAsphalt;\nuniform sampler2D uRoadCobbles;\nuniform sampler2D uRoadSlabs;\nuniform float uRoadReady;${flags.aerialRoadRead ? '\nvarying vec3 vRoadWorld;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (uRoadReady > 0.5) {
  // Authored source palettes distinguish brick Lombard and concrete footways from asphalt.
  if (diffuseColor.r > diffuseColor.g*1.5) diffuseColor.rgb = texture2D(uRoadCobbles,vRoadMetres/3.0).rgb;
  else if (diffuseColor.r > 0.40 && diffuseColor.g > 0.40) diffuseColor.rgb = texture2D(uRoadSlabs,vRoadMetres/3.0).rgb;
  else {
    diffuseColor.rgb = texture2D(uRoadAsphalt,vRoadMetres/6.0).rgb;
${flags.aerialRoadRead ? `    // aerialRoadRead: lift the near-black asphalt toward a mid grey as the eye pulls back, so from the title
    // flyover the streets read as streets, not black voids. Gated on 3D view distance (~70->180 m), so street-level
    // asphalt (close to the camera) is unchanged; only the aerial/distant road surface greys up.
    float aerialRoad = smoothstep(70.0, 180.0, length(vRoadWorld - cameraPosition));
    diffuseColor.rgb = mix(diffuseColor.rgb, max(diffuseColor.rgb, vec3(0.30, 0.29, 0.27)), aerialRoad * 0.8);` : ''}
  }
}`);
  };
  material.needsUpdate = true;
}
