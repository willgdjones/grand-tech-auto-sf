import { expect, it } from 'vitest';
import { normalizePixels } from './pipeline';
it('preserves constant colour while downsampling and enforces the image cap before allocation', () => {
  const image = { width: 4, height: 4, data: new Uint8Array(Array.from({ length: 16 }, () => [120, 60, 30, 255]).flat()) };
  const result = normalizePixels(image, 2, 2);
  expect([...result.data]).toEqual(Array.from({ length: 4 }, () => [120, 60, 30, 255]).flat());
  expect(() => normalizePixels(image, 4096, 4096)).toThrow('MASTER_PIXEL_CAP');
});
