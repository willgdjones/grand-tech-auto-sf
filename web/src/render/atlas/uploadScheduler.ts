import { ATLAS_UPLOAD_BUDGET_BYTES_DESKTOP, ATLAS_UPLOAD_BUDGET_BYTES_MOBILE } from '@gtasf/shared/constants';

export function uploadBudget(mobile: boolean): number {
  return mobile ? ATLAS_UPLOAD_BUDGET_BYTES_MOBILE : ATLAS_UPLOAD_BUDGET_BYTES_DESKTOP;
}

/** @hot Dimensions include extrusion. Zero means defer; the caller preserves its source offset. */
export function uploadRows(width: number, rowsLeft: number, readyRows: number, remaining: number): number {
  return Math.min(rowsLeft, readyRows, Math.floor(remaining / (width * 4)));
}

/** Entry rows are top-origin; WebGL's increasing y deliberately follows that same order. */
export function extrudeStrip(
  source: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  sourceStart: number,
  entryStart: number,
  rowCount: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array((width + 2) * rowCount * 4);
  for (let row = 0; row < rowCount; row++) {
    const y = Math.max(0, Math.min(height - 1, entryStart + row - 1)) - sourceStart;
    for (let col = 0; col < width + 2; col++) {
      const x = Math.max(0, Math.min(width - 1, col - 1));
      const from = (y * width + x) * 4,
        to = (row * (width + 2) + col) * 4;
      out[to] = source[from]!;
      out[to + 1] = source[from + 1]!;
      out[to + 2] = source[from + 2]!;
      out[to + 3] = source[from + 3]!;
    }
  }
  return out;
}
