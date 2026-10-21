import { afterEach, expect, it, vi } from 'vitest';
import { CanvasTexture, ImageLoader, SRGBColorSpace } from 'three';
import { loadLombardPlantImage } from './lombardFlowerTextures';

afterEach(() => vi.restoreAllMocks());

it('keeps painted plants until a bounded image arrives and never revives disposed gardens', async () => {
  const painted = { width: 512, height: 512 } as HTMLCanvasElement;
  const image = { width: 512, height: 512 } as HTMLImageElement;
  let complete!: (image: HTMLImageElement) => void;
  const load = vi.spyOn(ImageLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const texture = new CanvasTexture(painted); texture.colorSpace = SRGBColorSpace;
  const initialVersion = texture.version;
  loadLombardPlantImage(texture, '/art/foliage/lombard-leaves-v1.png');
  expect(texture.image).toBe(painted); expect(texture.version).toBe(initialVersion);
  complete(image); await Promise.resolve();
  expect(texture.image).toBe(image); expect(texture.version).toBe(initialVersion + 1);
  expect(texture.colorSpace).toBe(SRGBColorSpace);

  const retired = new CanvasTexture(painted);
  loadLombardPlantImage(retired, '/art/foliage/lombard-petals-v1.png');
  const retiredVersion = retired.version; retired.dispose(); complete(image); await Promise.resolve();
  expect(retired.image).toBe(painted); expect(retired.version).toBe(retiredVersion);

  const offline = new CanvasTexture(painted);
  load.mockRejectedValueOnce(new Error('offline'));
  loadLombardPlantImage(offline, '/art/foliage/lombard-leaves-v1.png'); await Promise.resolve();
  expect(offline.image).toBe(painted);

  load.mockResolvedValueOnce({ width: 2048, height: 2048 } as HTMLImageElement);
  loadLombardPlantImage(offline, '/art/foliage/lombard-leaves-v1.png'); await Promise.resolve();
  expect(offline.image).toBe(painted);
  texture.dispose(); offline.dispose();
});
