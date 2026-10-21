import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2 } from 'three';
import { placeShopfrontSigns, type ShopfrontContext } from './shopfrontSigns';

/** Small, chunk-local mask around the actual signed shopfronts. Built once, freed on unload. */
export function createUrbanFrontages(context?: ShopfrontContext) {
  const size = context ? 128 : 1, step = 256 / size;
  const data = new Uint8Array(size * size);
  const origin = new Vector2(context ? context.ground.x * 256 : 0, context ? context.ground.z * 256 : 0);
  if (context) for (const shop of placeShopfrontSigns(context)) {
    const [x, , z] = shop.centre, [nx, nz] = shop.normal;
    // A wider entrance apron, with a 3.5m outward strip aligned to the real facade.
    const halfWidth = shop.width / 2 + 2, depth = 3.5, radius = halfWidth + depth;
    const minX = Math.max(0, Math.floor((x - radius - origin.x) / step));
    const maxX = Math.min(size - 1, Math.floor((x + radius - origin.x) / step));
    const minZ = Math.max(0, Math.floor((z - radius - origin.y) / step));
    const maxZ = Math.min(size - 1, Math.floor((z + radius - origin.y) / step));
    for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
      const dx = origin.x + (ix + .5) * step - x, dz = origin.y + (iz + .5) * step - z;
      const outward = dx * nx + dz * nz, along = dx * nz - dz * nx;
      if (outward >= -.5 && outward <= depth && Math.abs(along) <= halfWidth) data[iz * size + ix] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.name = 'SoMa shopfront paving mask';
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, origin };
}
