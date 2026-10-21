import { CanvasTexture, SRGBColorSpace, RepeatWrapping, Texture } from 'three';
import { FRONT_STYLES, type FrontStyle } from './facadeStyles';

/** Internal mapping contract. Source atlas adapters translate pixel rectangles into this view. */
export interface FrontCell {
  id: string; style: FrontStyle; widthM: number; heightM: number; floors: number;
  /** Lowest usable complete floor, counted from the bottom of the source image. */
  firstUsableFloor?: number;
  colour: Texture; mask: Texture;
  /** Normalised bottom-left UV bounds. */
  rect: [number, number, number, number];
  bays: { rect: [number, number, number, number]; depth: number }[];
}

/** Original development elevations: no fetched art. Real cells replace these through the same contract. */
export function createPlaceholderFronts(): { cells: Map<FrontStyle, FrontCell[]>; dispose(): void } {
  const cells = new Map<FrontStyle, FrontCell[]>(), textures: Texture[] = [];
  for (const style of FRONT_STYLES) {
    const office = style === 'office' || style === 'tower', floors = office ? 8 : 3;
    const canvas = document.createElement('canvas'), mask = document.createElement('canvas');
    canvas.width = mask.width = 128; canvas.height = mask.height = 192;
    const c = canvas.getContext('2d')!, m = mask.getContext('2d')!;
    c.fillStyle = style === 'brk' ? '#a78069' : office ? '#8e9fa9' : '#d0c4a8'; c.fillRect(0, 0, 128, 192);
    m.fillStyle = '#ff0000'; m.fillRect(0, 0, 128, 192);
    const floorH = 192 / floors;
    for (let floor = 0; floor < floors; floor++) {
      const y = floor * floorH;
      c.fillStyle = '#eee0c4'; c.fillRect(0, y, 128, 3);
      m.fillStyle = '#000000'; m.fillRect(0, y, 128, 3);
      for (let column = 0; column < (office ? 5 : 3); column++) {
        const x = 10 + column * (office ? 23 : 38), w = office ? 13 : 21;
        c.fillStyle = '#eee0c4'; c.fillRect(x - 2, y + 8, w + 4, floorH - 16);
        c.fillStyle = '#374b59'; c.fillRect(x, y + 10, w, floorH - 20);
        m.fillStyle = '#00ff00'; m.fillRect(x, y + 10, w, floorH - 20);
        c.fillStyle = '#baa987'; c.fillRect(x + w / 2, y + 10, 1, floorH - 20);
      }
    }
    c.fillStyle = '#574b3e'; c.fillRect(53, 158, 22, 34); m.fillStyle = '#000000'; m.fillRect(53, 158, 22, 34);
    const colour = new CanvasTexture(canvas), tint = new CanvasTexture(mask);
    colour.colorSpace = SRGBColorSpace;
    for (const texture of [colour, tint]) { texture.wrapS = RepeatWrapping; texture.anisotropy = 4; textures.push(texture); }
    cells.set(style, [{ id: `placeholder-${style}`, style, widthM: office ? 24 : 7.6, heightM: office ? 28 : 10.5,
      floors, colour, mask: tint, rect: [0, 0, 1, 1], bays: style === 'vic' || style === 'edw' ? [{ rect: [.34, .34, .66, .94], depth: .6 }] : [] }]);
  }
  return { cells, dispose() { textures.forEach(texture => texture.dispose()); } };
}

type SourceCell = {
  id: string; col: number; row: number; sheet?: number;
  bayRects?: { rect: [number, number, number, number]; depth: number }[];
};
type SourceStyle = {
  image: string; mask: string; cols: number; rows: number; cell: { width: number; height: number };
  /** Big-wall styles (office, tower) span several <= 1 MP sheets of cols x rows cells each; cells name their sheet. */
  sheets?: { image: string; mask: string }[];
  widthM: number; heightM: number; floors: number; firstUsableFloor?: number; cells: SourceCell[];
};
type Manifest = { version: number; styles: Partial<Record<FrontStyle, SourceStyle>> };
const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

/** Fetch only styles present in mounted chunks; one manifest and one texture pair per style. */
export function createFrontAtlas() {
  // Until real images are decoded, callers retain the existing authored facade and details.
  // Development fixtures must never replace a building in a preview/production failure path.
  const cells = new Map<FrontStyle, FrontCell[]>();
  const abort = new AbortController(), owned = new Map<Texture, ImageBitmap>();
  const pending = new Map<FrontStyle, Promise<boolean>>();
  const listeners = new Set<(style: FrontStyle) => void>();
  let manifest: Promise<Manifest | undefined> | undefined;
  let manifestRetryAt = 0;
  const retryAt = new Map<FrontStyle, number>();
  const retryDelay = 30_000;
  function release(texture: Texture) {
    const bitmap = owned.get(texture);
    if (!bitmap) return;
    texture.dispose(); bitmap.close(); owned.delete(texture);
  }
  async function request(url: string, budget: number): Promise<ArrayBuffer> {
    const controller = new AbortController(), cancel = () => controller.abort();
    if (abort.signal.aborted) cancel();
    else abort.signal.addEventListener('abort', cancel, { once: true });
    const deadline = setTimeout(cancel, 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Facade unavailable');
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted || bytes.byteLength > budget) throw new Error('Facade request expired or over budget');
      return bytes;
    } finally { clearTimeout(deadline); abort.signal.removeEventListener('abort', cancel); }
  }
  const texture = async (file: string, colour: boolean, width: number, height: number) => {
    if (!/^[a-z0-9-]+\.webp$/.test(file)) throw new Error('Invalid facade path');
    const data = await request(`/art/facades/${file}`, 4_000_000);
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/webp' }), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (abort.signal.aborted || bitmap.width !== width || bitmap.height !== height || bitmap.width * bitmap.height > 1_048_576) { bitmap.close(); throw new Error('Facade decoded budget'); }
    const result = new Texture(bitmap); result.flipY = false; if (colour) result.colorSpace = SRGBColorSpace;
    result.anisotropy = 8; result.needsUpdate = true; owned.set(result, bitmap); return result;
  };
  function ensure(style: FrontStyle): Promise<boolean> {
    if (abort.signal.aborted) return Promise.resolve(false);
    const cached = pending.get(style); if (cached) return cached;
    // Retry only when a later chunk needs this style; no background polling or rebuild loop.
    if (Date.now() < Math.max(manifestRetryAt, retryAt.get(style) ?? 0)) return Promise.resolve(false);
    manifest ??= request('/art/facades/atlas.json', 500_000).then(bytes => {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
      if (value.version !== 1 || !value.styles) throw new Error('Invalid facade manifest');
      return value;
    }).catch(() => { manifest = undefined; manifestRetryAt = Date.now() + retryDelay; return undefined; });
    const attemptTextures: Texture[] = [];
    const ready = (async () => {
      const source = (await manifest)?.styles[style];
      if (!source || !Number.isInteger(source.cols) || !Number.isInteger(source.rows) || source.cols < 1 || source.rows < 1
        || source.cols * source.rows > 64 || !finitePositive(source.widthM) || !finitePositive(source.heightM)
        || !Number.isInteger(source.floors) || source.floors < 1 || source.floors > 100
        || !source.cell || !finitePositive(source.cell.width) || !finitePositive(source.cell.height)
        || source.cell.width * source.cols * source.cell.height * source.rows > 1_048_576
        || !Array.isArray(source.cells) || source.cells.length > 64
        || (source.sheets !== undefined && (!Array.isArray(source.sheets) || source.sheets.length < 1 || source.sheets.length > 16))) return false;
      const firstUsableFloor = source.firstUsableFloor ?? 0;
      if (!Number.isInteger(firstUsableFloor) || firstUsableFloor < 0 || firstUsableFloor >= source.floors) return false;
      const width = source.cell.width * source.cols, height = source.cell.height * source.rows;
      // Wait for every decode even when one fails, so late successful siblings are released too.
      const sheets = source.sheets ?? [{ image: source.image, mask: source.mask }];
      const decoded = await Promise.allSettled(sheets.flatMap(sheet => [texture(sheet.image, true, width, height), texture(sheet.mask, false, Math.round(width / 2), Math.round(height / 2))]));
      for (const result of decoded) if (result.status === 'fulfilled') attemptTextures.push(result.value);
      if (decoded.some(result => result.status !== 'fulfilled')) return false;
      const textures = decoded.map(result => (result as PromiseFulfilledResult<Texture>).value);
      if (abort.signal.aborted) return false;
      const loaded: FrontCell[] = [];
      for (const item of source.cells) {
        if (typeof item.id !== 'string' || !Number.isInteger(item.col) || !Number.isInteger(item.row)
          || item.col < 0 || item.col >= source.cols || item.row < 0 || item.row >= source.rows) continue;
        const sheet = item.sheet ?? 0;
        if (!Number.isInteger(sheet) || sheet < 0 || sheet >= sheets.length) continue;
        const colour = textures[sheet * 2]!, mask = textures[sheet * 2 + 1]!;
        const bays = (item.bayRects ?? []).filter(b => Array.isArray(b.rect) && b.rect.length === 4
          && b.rect.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && b.rect[2] > b.rect[0] && b.rect[3] > b.rect[1]
          && finitePositive(b.depth) && b.depth <= 1.5).map(b => ({ rect: [b.rect[0], 1 - b.rect[3], b.rect[2], 1 - b.rect[1]] as [number, number, number, number], depth: b.depth }));
        loaded.push({ id: item.id, style, widthM: source.widthM, heightM: source.heightM, floors: source.floors, firstUsableFloor, colour, mask,
          rect: [item.col / source.cols, 1 - (item.row + 1) / source.rows, (item.col + 1) / source.cols, 1 - item.row / source.rows], bays });
      }
      if (!loaded.length) return false;
      cells.set(style, loaded); return true;
    })().catch(() => false).then(loaded => {
      if (!loaded) {
        attemptTextures.forEach(release);
        pending.delete(style); retryAt.set(style, Date.now() + retryDelay);
      }
      if (loaded && !abort.signal.aborted) for (const listener of listeners) listener(style);
      return loaded;
    });
    pending.set(style, ready); return ready;
  }
  return {
    cells, ensure,
    subscribe(listener: (style: FrontStyle) => void) {
      if (!abort.signal.aborted) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() { abort.abort(); listeners.clear(); for (const texture of owned.keys()) release(texture); cells.clear(); pending.clear(); retryAt.clear(); },
  };
}
