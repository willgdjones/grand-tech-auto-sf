import {
  DataTexture, FloatType, LinearMipmapLinearFilter, NearestFilter, RedFormat, SRGBColorSpace,
  Texture, Vector2, Vector4, type IUniform,
} from 'three';
import type { Heightfield } from './chunks/terrain';

export const FACADE_CELLS = ['victorian', 'edwardian', 'fidi-glass', 'fidi-stone', 'soma-brick', 'mission-mural', 'storefront', 'stone-variant'] as const;
type CellName = typeof FACADE_CELLS[number];
interface Cell { id: CellName; pixelRect: [number, number, number, number]; metres: [number, number] }
interface AtlasManifest { version: 1; atlas: { path: string; width: number; height: number; sha256: string }; assets: Cell[] }

function inspectManifest(value: unknown): AtlasManifest {
  const data = value as AtlasManifest;
  const atlas = data?.atlas;
  if (data?.version !== 1 || !atlas || !Number.isInteger(atlas.width) || !Number.isInteger(atlas.height)
    || atlas.width < 1 || atlas.height < 1 || atlas.width * atlas.height > 1_048_576
    || !/^\/art\/facades\/[a-z0-9-]+\.png$/.test(atlas.path) || !/^[a-f0-9]{64}$/.test(atlas.sha256)
    || !Array.isArray(data.assets)) throw new Error('Invalid facade atlas manifest');
  for (const name of FACADE_CELLS) {
    const cells = data.assets.filter(cell => cell.id === name);
    const cell = cells[0];
    if (cells.length !== 1 || !cell || !Array.isArray(cell.pixelRect) || cell.pixelRect.length !== 4
      || !cell.pixelRect.every(Number.isInteger) || !Array.isArray(cell.metres) || cell.metres.length !== 2
      || !cell.metres.every(n => Number.isFinite(n) && n > 0 && n <= 100)) throw new Error(`Invalid facade cell: ${name}`);
    const [x, y, w, h] = cell.pixelRect;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > atlas.width || y + h > atlas.height) throw new Error(`Facade cell outside atlas: ${name}`);
  }
  return data;
}

/** One shared image/texture per city scene; late loads cannot resurrect a disposed scene. */
export function createFacadeAtlas() {
  const uniforms: Record<string, IUniform> = {
    uFacadeAtlas: { value: null }, uFacadeAtlasReady: { value: 0 }, uFacadeNight: { value: 0 },
    uFacadeRects: { value: FACADE_CELLS.map(() => new Vector4()) },
    uFacadeRepeats: { value: FACADE_CELLS.map(() => new Vector2(1, 1)) },
    uFacadeAtlasSize: { value: new Vector2(1, 1) },
  };
  // Normalized cell rects, clock and readiness are shared; the city variant has
  // half as many texels per side and the same original artwork/metre repeats.
  const lowUniforms: Record<string, IUniform> = { ...uniforms,
    uFacadeAtlas: { value: null }, uFacadeAtlasSize: { value: new Vector2(1, 1) },
  };
  const stats = { state: 'loading', bytes: 0, width: 0, height: 0, lowWidth: 0, lowHeight: 0, error: '', materials: 0, lowMaterials: 0 };
  const abort = new AbortController();
  let disposed = false, texture: Texture | undefined, image: ImageBitmap | undefined;
  let lowTexture: Texture | undefined, lowImage: ImageBitmap | undefined;
  const ready = (async () => {
    // Pure scene/geometry checks in Node retain the authored procedural fallback.
    if (typeof window === 'undefined') { stats.state = 'fallback'; return false; }
    try {
      const response = await fetch('/art/manifest.json', { signal: abort.signal });
      if (!response.ok) throw new Error(`Facade manifest HTTP ${response.status}`);
      const manifest = inspectManifest(await response.json());
      const pixels = await fetch(manifest.atlas.path, { signal: abort.signal });
      if (!pixels.ok) throw new Error(`Facade image HTTP ${pixels.status}`);
      const bytes = await pixels.arrayBuffer();
      if (bytes.byteLength > 4_000_000) throw new Error('Facade image exceeds encoded budget');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      if (hash !== manifest.atlas.sha256) throw new Error('Facade atlas hash mismatch');
      // ImageBitmap ignores Texture.flipY, so perform the upload orientation at decode.
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (disposed) { bitmap.close(); return false; }
      if (bitmap.width !== manifest.atlas.width || bitmap.height !== manifest.atlas.height) { bitmap.close(); throw new Error('Facade image dimensions differ from manifest'); }
      image = bitmap; texture = new Texture(bitmap);
      texture.name = 'GTASF reviewed SF facade atlas'; texture.colorSpace = SRGBColorSpace;
      // Vivid SF pass (PLAN-v2.1 §4 / pane 9): trilinear mipmaps + anisotropy so facade art stays
      // legible at 200 m+ instead of fading out (the shader samples with manual texture gradients so
      // the per-cell tiling does not seam at mip boundaries). Nearest magnification keeps the chunky
      // SA look up close.
      texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = NearestFilter; texture.generateMipmaps = true;
      texture.anisotropy = 8; texture.flipY = false; texture.needsUpdate = true;
      const small = await createImageBitmap(bitmap, { resizeWidth: bitmap.width/2, resizeHeight: bitmap.height/2,
        resizeQuality: 'pixelated', imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (disposed) { small.close(); return false; }
      lowImage = small; lowTexture = new Texture(small);
      lowTexture.name = 'GTASF city facade atlas 512px'; lowTexture.colorSpace = SRGBColorSpace;
      // City/phone variant: lighter 4x anisotropy, still mipmapped so distant facades read.
      lowTexture.minFilter = LinearMipmapLinearFilter; lowTexture.magFilter = NearestFilter; lowTexture.generateMipmaps = true;
      lowTexture.anisotropy = 4; lowTexture.flipY = false; lowTexture.needsUpdate = true;
      for (let i = 0; i < FACADE_CELLS.length; i++) {
        const cell = manifest.assets.find(entry => entry.id === FACADE_CELLS[i])!;
        const [x, y, w, h] = cell.pixelRect;
        (uniforms.uFacadeRects!.value as Vector4[])[i]!.set(x / bitmap.width, 1 - (y + h) / bitmap.height, w / bitmap.width, h / bitmap.height);
        (uniforms.uFacadeRepeats!.value as Vector2[])[i]!.fromArray(cell.metres);
      }
      (uniforms.uFacadeAtlasSize!.value as Vector2).set(bitmap.width, bitmap.height);
      (lowUniforms.uFacadeAtlasSize!.value as Vector2).set(small.width, small.height);
      lowUniforms.uFacadeAtlas!.value = lowTexture;
      uniforms.uFacadeAtlas!.value = texture; uniforms.uFacadeAtlasReady!.value = 1;
      Object.assign(stats, { state: 'ready', bytes: bytes.byteLength, width: bitmap.width, height: bitmap.height, lowWidth: small.width, lowHeight: small.height });
      return true;
    } catch (error) {
      if (!disposed) { stats.state = 'fallback'; stats.error = String(error); }
      return false;
    }
  })();
  return {
    uniforms, lowUniforms, stats, ready,
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); stats.state = 'disposed';
      uniforms.uFacadeAtlasReady!.value = 0; uniforms.uFacadeAtlas!.value = null;
      lowUniforms.uFacadeAtlas!.value = null;
      texture?.dispose(); image?.close(); lowTexture?.dispose(); lowImage?.close();
      texture = undefined; image = undefined; lowTexture = undefined; lowImage = undefined;
    },
  };
}
export type FacadeAtlas = ReturnType<typeof createFacadeAtlas>;

/** Sourced GTHF ground under the chunk, sampled only in the vertex shader. */
export function createFacadeGround(field: Heightfield | undefined) {
  const uniforms: Record<string, IUniform> = {
    uFacadeGround: { value: null }, uFacadeGroundReady: { value: 0 },
    uFacadeGroundGrid: { value: new Vector4(0, 0, 1, 1) },
  };
  let texture: DataTexture | undefined;
  if (field && field.size >= 2 && field.size <= 257 && field.values.length === field.size * field.size) {
    const values = Float32Array.from(field.values, value => (field.baseCm + value) / 100);
    texture = new DataTexture(values, field.size, field.size, RedFormat, FloatType);
    texture.name = 'GTASF facade source ground'; texture.minFilter = texture.magFilter = NearestFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    const span = (field.size - 1) * field.step;
    uniforms.uFacadeGround!.value = texture; uniforms.uFacadeGroundReady!.value = 1;
    (uniforms.uFacadeGroundGrid!.value as Vector4).set(field.x * span, field.z * span, field.step, field.size);
  }
  return { uniforms, dispose() { texture?.dispose(); texture = undefined; uniforms.uFacadeGround!.value = null; } };
}
export type FacadeGround = ReturnType<typeof createFacadeGround>;
