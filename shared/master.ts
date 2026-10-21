import { MASTER_MAX_PIXELS, MAX_GRID } from './constants';

const MAX_TILE_PX = 64;
const MAX_EDGE_PX = 4_096;

export function masterTilePx(cols: number, rows: number): number {
  if (!Number.isSafeInteger(cols) || cols < 1 || cols > MAX_GRID) {
    throw new RangeError(`Master columns must be an integer from 1 to ${MAX_GRID}`);
  }
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_GRID) {
    throw new RangeError(`Master rows must be an integer from 1 to ${MAX_GRID}`);
  }

  // Search the integer scale directly: all products are at most 255² × 64²,
  // well below Number.MAX_SAFE_INTEGER, so area boundaries remain exact.
  let low = 1;
  let high = MAX_TILE_PX;
  while (low < high) {
    const candidate = Math.floor((low + high + 1) / 2);
    const width = cols * candidate;
    const height = rows * candidate;
    if (width <= MAX_EDGE_PX && height <= MAX_EDGE_PX && width * height <= MASTER_MAX_PIXELS) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  return low;
}

export function masterDims(cols: number, rows: number): { width: number; height: number } {
  const tilePx = masterTilePx(cols, rows);
  return { width: cols * tilePx, height: rows * tilePx };
}
