import { MASTER_MAX_PIXELS } from '@gtasf/shared/constants';
import { resampleInto } from '../resample';
import type { Rgba } from '../codecs';
/** The decoded-image boundary from BDTS, retaining the 1 MP cap. Track E wires codec and R2 jobs. */
export function normalizePixels(image: Rgba, width: number, height: number): Rgba {
  if (![width, height].every(n => Number.isInteger(n) && n > 0) || width * height > MASTER_MAX_PIXELS) throw new RangeError('MASTER_PIXEL_CAP');
  if (width > image.width || height > image.height) throw new RangeError('NO_UPSCALE');
  const canvas = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  resampleInto(image, canvas, 0, 0, width, height, 'lanczos3');
  return canvas;
}
