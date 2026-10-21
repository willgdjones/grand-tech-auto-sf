import {
  LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace,
  Texture, Vector2, Vector3, Vector4, type IUniform,
} from 'three';
import { paintedLadyScheme, PAINTED_LADY_SCHEME_COUNT } from './landmarks/paintedLadyPalette';

/**
 * Realistic PBR facade atlas (gtasf-2rup, founder 2026-10-04 BUILDINGS direction).
 *
 * The renderer is manifest-driven and source-agnostic: the shader (realisticFacades.ts) picks one of
 * these fixed style slots per building (by district + land-use) and samples a cell of three packed
 * atlases — albedo (sRGB), OpenGL normal, and ARM (AO/roughness/metalness, linear). Cells are tagged
 * by `kind`; a style with no matching cell falls back down a chain, so a sparse CC0 starter atlas
 * renders today and extra Scenario-generated texture modules drop in by adding cells + kinds, with no
 * client change. The ps2 `facadeAtlas.ts` path is untouched.
 */
export const REALISTIC_STYLES = ['brick', 'stone', 'stucco', 'clapboard', 'glass', 'concrete', 'storefront', 'mural'] as const;
export type RealisticStyle = typeof REALISTIC_STYLES[number];
// When the manifest lacks a cell for a style, borrow the nearest realistic look instead of leaving it blank.
const FALLBACK: Record<RealisticStyle, RealisticStyle[]> = {
  brick: ['stone', 'stucco', 'concrete'],
  stone: ['concrete', 'stucco', 'brick'],
  stucco: ['concrete', 'stone', 'brick'],
  clapboard: ['stucco', 'stone', 'brick'],
  glass: ['stone', 'concrete', 'stucco'],
  concrete: ['stone', 'stucco', 'brick'],
  storefront: ['stucco', 'brick', 'stone'],
  mural: ['stucco', 'brick', 'stone'],
};

interface Cell { id: string; kind?: string; pixelRect: [number, number, number, number]; metres: [number, number] }
interface MapEntry { path: string; sha256: string; colorSpace?: string }
interface AtlasManifest { version: 1; width: number; height: number; maps: Record<'albedo' | 'normal' | 'arm', MapEntry>; cells: Cell[] }

const MAP_PATH = /^\/art\/facades-pbr\/[a-z0-9-]+\.jpg$/;

export function inspectRealisticManifest(value: unknown): AtlasManifest {
  const data = value as AtlasManifest;
  if (data?.version !== 1 || !Number.isInteger(data.width) || !Number.isInteger(data.height)
    || data.width < 1 || data.height < 1 || data.width * data.height > 1_048_576
    || !data.maps || !Array.isArray(data.cells) || data.cells.length < 1) throw new Error('Invalid realistic facade manifest');
  for (const name of ['albedo', 'normal', 'arm'] as const) {
    const map = data.maps[name];
    if (!map || typeof map.path !== 'string' || !MAP_PATH.test(map.path) || !/^[a-f0-9]{64}$/.test(map.sha256)) throw new Error(`Invalid facade map: ${name}`);
  }
  for (const cell of data.cells) {
    if (typeof cell.id !== 'string' || !Array.isArray(cell.pixelRect) || cell.pixelRect.length !== 4 || !cell.pixelRect.every(Number.isInteger)
      || !Array.isArray(cell.metres) || cell.metres.length !== 2 || !cell.metres.every(n => Number.isFinite(n) && n > 0 && n <= 100)) throw new Error(`Invalid facade cell: ${cell.id}`);
    const [x, y, w, h] = cell.pixelRect;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > data.width || y + h > data.height) throw new Error(`Facade cell outside atlas: ${cell.id}`);
  }
  return data;
}

/** Resolve each fixed style slot to a cell: exact `kind` match first, then the fallback chain, then cell 0. */
function resolveSlots(manifest: AtlasManifest): Cell[] {
  const byKind = new Map<string, Cell>();
  for (const cell of manifest.cells) if (cell.kind && !byKind.has(cell.kind)) byKind.set(cell.kind, cell);
  return REALISTIC_STYLES.map(style => {
    const chain = [style, ...FALLBACK[style]];
    for (const kind of chain) { const cell = byKind.get(kind); if (cell) return cell; }
    return manifest.cells[0]!;
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function loadMap(entry: MapEntry, srgb: boolean, signal: AbortSignal): Promise<{ texture: Texture; bitmap: ImageBitmap; bytes: number }> {
  const response = await fetch(entry.path, { signal });
  if (!response.ok) throw new Error(`Facade map HTTP ${response.status}: ${entry.path}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 4_000_000) throw new Error(`Facade map exceeds budget: ${entry.path}`);
  if (await sha256Hex(bytes) !== entry.sha256) throw new Error(`Facade map hash mismatch: ${entry.path}`);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = new Texture(bitmap);
  texture.name = `GTASF realistic facade ${entry.path}`;
  texture.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.flipY = false; texture.needsUpdate = true;
  return { texture, bitmap, bytes: bytes.byteLength };
}

/** One shared PBR atlas per realistic city scene; a late load cannot resurrect a disposed scene. */
export function createRealisticFacadeAtlas(low = false) {
  // Per-building painted-lady wall pastels (gtasf-painted-lady-colour-variety-mv1y): the realistic
  // shader tints Victorian clapboard per building from a stable hash, so a row gets the real
  // pink/blue/green/ochre spread. Decoupled from the land-use classifier, so no map rebuild is needed
  // (the ps2 facades.ts classifier blocker does not apply here). Raw sRGB values to match the shader's
  // manual atlas sampling (no linear decode), 0xRRGGBB → vec3.
  const paintedLadies = Array.from({ length: PAINTED_LADY_SCHEME_COUNT }, (_, i) => {
    const body = paintedLadyScheme(i).body;
    return new Vector3(((body >> 16) & 255) / 255, ((body >> 8) & 255) / 255, (body & 255) / 255);
  });
  const uniforms: Record<string, IUniform> = {
    uRealAlbedo: { value: null }, uRealNormal: { value: null }, uRealArm: { value: null },
    uRealReady: { value: 0 }, uRealHasPbr: { value: low ? 0 : 1 }, uFacadeNight: { value: 0 },
    // 8 primary style slots (0-7) + 8 alternate slots (8-15): a 2nd module per wall type, picked per
    // building by the shader's variant hash so same-style blocks don't repeat one texture.
    uRealRects: { value: Array.from({ length: 2 * REALISTIC_STYLES.length }, () => new Vector4(0, 0, 1, 1)) },
    uRealRepeats: { value: Array.from({ length: 2 * REALISTIC_STYLES.length }, () => new Vector2(3, 3)) },
    uRealAtlasSize: { value: new Vector2(1, 1) },
    uPaintedLadies: { value: paintedLadies },
  };
  const stats = { state: 'loading', bytes: 0, width: 0, height: 0, error: '', materials: 0, low };
  const abort = new AbortController();
  const textures: Texture[] = [];
  const bitmaps: ImageBitmap[] = [];
  let disposed = false;
  const ready = (async () => {
    // Pure scene/geometry checks in Node keep the flat land-use fallback (no fetch/WebGL).
    if (typeof window === 'undefined' || typeof fetch === 'undefined') { stats.state = 'fallback'; return false; }
    try {
      const response = await fetch('/art/facades-pbr/manifest.json', { signal: abort.signal });
      if (!response.ok) throw new Error(`Facade manifest HTTP ${response.status}`);
      const manifest = inspectRealisticManifest(await response.json());
      // Low preset is albedo-only (cheaper): skip the normal + ARM uploads entirely.
      const [albedo, normal, arm] = await Promise.all([
        loadMap(manifest.maps.albedo, true, abort.signal),
        low ? Promise.resolve(undefined) : loadMap(manifest.maps.normal, false, abort.signal),
        low ? Promise.resolve(undefined) : loadMap(manifest.maps.arm, false, abort.signal),
      ]);
      if (disposed) { for (const m of [albedo, normal, arm]) m && m.bitmap.close(); return false; }
      for (const m of [albedo, normal, arm]) if (m) { textures.push(m.texture); bitmaps.push(m.bitmap); }
      const slots = resolveSlots(manifest);
      const rects = uniforms.uRealRects!.value as Vector4[];
      const repeats = uniforms.uRealRepeats!.value as Vector2[];
      // Alternate slots (8-15): the 2nd module of each style's kind, so every style with two modules
      // gets per-building variety; a style with only one module reuses its primary cell (no change).
      const alts = REALISTIC_STYLES.map((style, i) => manifest.cells.filter(cell => cell.kind === style)[1] ?? slots[i]!);
      const slotCells = [...slots, ...alts];
      for (let i = 0; i < slotCells.length; i++) {
        const [x, y, w, h] = slotCells[i]!.pixelRect;
        rects[i]!.set(x / manifest.width, 1 - (y + h) / manifest.height, w / manifest.width, h / manifest.height);
        repeats[i]!.fromArray(slotCells[i]!.metres);
      }
      (uniforms.uRealAtlasSize!.value as Vector2).set(manifest.width, manifest.height);
      uniforms.uRealAlbedo!.value = albedo.texture;
      if (normal) uniforms.uRealNormal!.value = normal.texture;
      if (arm) uniforms.uRealArm!.value = arm.texture;
      uniforms.uRealReady!.value = 1;
      const bytes = albedo.bytes + (normal?.bytes ?? 0) + (arm?.bytes ?? 0);
      Object.assign(stats, { state: 'ready', bytes, width: manifest.width, height: manifest.height });
      return true;
    } catch (error) {
      if (!disposed) { stats.state = 'fallback'; stats.error = String(error); }
      return false;
    }
  })();
  return {
    uniforms, stats, ready,
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); stats.state = 'disposed';
      uniforms.uRealReady!.value = 0;
      uniforms.uRealAlbedo!.value = uniforms.uRealNormal!.value = uniforms.uRealArm!.value = null;
      for (const texture of textures) texture.dispose();
      for (const bitmap of bitmaps) bitmap.close();
      textures.length = 0; bitmaps.length = 0;
    },
  };
}
export type RealisticFacadeAtlas = ReturnType<typeof createRealisticFacadeAtlas>;
