import { extrudeStrip } from './uploadScheduler';

/** Called only by a staging task, never the GL frame callback. The canvas is exactly width × rows. */
export function readCanvasStrip(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  sourceStart: number,
  rowStart: number,
  rowCount: number,
  cropped: boolean,
): Uint8Array<ArrayBuffer> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, rowCount)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = rowCount;
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('ATLAS_STRIP_CANVAS');
  try {
    const count = Math.min(height - sourceStart, Math.max(1, rowStart + rowCount - 1 - sourceStart));
    context.drawImage(bitmap, 0, cropped ? 0 : sourceStart, width, count, 0, 0, width, count);
    const pixels = context.getImageData(0, 0, width, rowCount, { colorSpace: 'srgb' });
    return extrudeStrip(pixels.data, width, height, sourceStart, rowStart, rowCount);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
