/** Small, bounded raster stamps for repeated radar glyphs and venue counts.
 * Alpha remains on the destination context so collected/edge states stay live.
 * This caches text only: venue positions, pulses, circles and hit targets are unchanged.
 */
const MAX_ENTRIES = 256, MAX_PIXELS = 262_144;
type Stamp = { canvas: HTMLCanvasElement; x: number; y: number; pixels: number };

export function createRadarTextCache(target: CanvasRenderingContext2D) {
  const stamps = new Map<string, Stamp>();
  let ratio = 1, pixels = 0, hits = 0, misses = 0, evictions = 0, fallbacks = 0, unavailable = false;
  function remove(key: string) {
    const stamp = stamps.get(key); if (!stamp) return;
    pixels -= stamp.pixels; stamps.delete(key);
    // Release the backing bitmap immediately rather than waiting for canvas GC.
    stamp.canvas.width = stamp.canvas.height = 1;
  }
  function clear() { for (const key of stamps.keys()) remove(key); unavailable = false; }
  function fallback(text: string, x: number, y: number, font: string, color: string, baseline: CanvasTextBaseline) {
    fallbacks++; target.font = font; target.fillStyle = color; target.textAlign = 'center'; target.textBaseline = baseline;
    target.fillText(text, x, y);
  }
  return {
    setPixelRatio(value: number) {
      const next = Number.isFinite(value) && value > 0 ? Math.min(value, 2) : 1;
      if (next !== ratio) { clear(); ratio = next; }
    },
    paint(text: string, x: number, y: number, font: string, color: string, baseline: CanvasTextBaseline) {
      if (unavailable || !text || text.length > 8) { fallback(text, x, y, font, color, baseline); return; }
      const key = `${font}\0${color}\0${baseline}\0${text}`;
      let stamp = stamps.get(key);
      if (stamp) hits++;
      else {
        misses++;
        // These callers already use centred text. Measuring on the destination preserves
        // the exact font metrics/baseline, including the platform emoji font.
        target.font = font; target.textAlign = 'center'; target.textBaseline = baseline;
        const metrics = target.measureText(text);
        const bounds = metrics && [metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight,
          metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent];
        if (!bounds || !bounds.every(Number.isFinite)) { unavailable = true; fallback(text, x, y, font, color, baseline); return; }
        const [left, right, ascent, descent] = bounds.map(value => Math.ceil(Math.max(0, value)));
        const width = Math.ceil((left! + right! + 4) * ratio), height = Math.ceil((ascent! + descent! + 4) * ratio);
        const size = width * height;
        if (size > MAX_PIXELS) { fallback(text, x, y, font, color, baseline); return; }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) { canvas.width = canvas.height = 1; unavailable = true; fallback(text, x, y, font, color, baseline); return; }
        context.setTransform(ratio, 0, 0, ratio, 0, 0); context.font = font; context.fillStyle = color;
        context.textAlign = 'center'; context.textBaseline = baseline;
        const originX = left! + 2, originY = ascent! + 2;
        context.fillText(text, originX, originY);
        while (stamps.size >= MAX_ENTRIES || pixels + size > MAX_PIXELS) {
          const oldest = stamps.keys().next().value; if (oldest === undefined) break;
          remove(oldest); evictions++;
        }
        stamp = { canvas, x: originX, y: originY, pixels: size }; stamps.set(key, stamp); pixels += size;
      }
      target.drawImage(stamp.canvas, x - stamp.x, y - stamp.y, stamp.canvas.width / ratio, stamp.canvas.height / ratio);
    },
    clear,
    get stats() { return { entries: stamps.size, pixels, hits, misses, evictions, fallbacks, maxEntries: MAX_ENTRIES, maxPixels: MAX_PIXELS }; },
  };
}
