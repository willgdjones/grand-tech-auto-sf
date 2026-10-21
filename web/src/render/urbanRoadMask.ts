import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2 } from 'three';
import type { ShopfrontContext } from './shopfrontSigns';

// residentialBlockGreens road mask tuning (metres). RANGE scales the stored 0..1 distance; the shader
// greens only where the sampled distance is past the carriageway+sidewalk (~11-13 m from the road
// centreline in an SF residential block), so streets/sidewalks stay grey and the block interior goes green.
const RANGE = 36; // stored value saturates to 1.0 at this distance-to-road
const MAXD = 40;  // nearestRoad query cap: bounds the per-texel spatial query
const GRID = 64;  // coarse grid over the chunk's 256 m extent (~4 m texels; LinearFilter smooths it)

/** Coarse per-chunk distance-to-nearest-road mask: texel.r = clamp(dist/RANGE, 0, 1)*255, so 0 on the
 *  road/kerb and ~1 deep in the block interior. Built once per residential chunk at mount, freed on unload.
 *  Pass no context (non-residential / context-less chunk) to get a 1x1 all-zero texture so the green branch
 *  never fires there (roadDist stays 0, below the shader threshold). */
export function createUrbanRoadMask(context?: ShopfrontContext) {
  const size = context ? GRID : 1, step = 256 / size;
  const data = new Uint8Array(size * size);
  const origin = new Vector2(context ? context.ground.x * 256 : 0, context ? context.ground.z * 256 : 0);
  if (context) {
    const { nearestRoad } = context;
    for (let iz = 0; iz < size; iz++) for (let ix = 0; ix < size; ix++) {
      const x = origin.x + (ix + 0.5) * step, z = origin.y + (iz + 0.5) * step;
      const road = nearestRoad(x, z, MAXD);
      const dist = road ? Math.hypot(x - road.x, z - road.z) : MAXD;
      data[iz * size + ix] = Math.max(0, Math.min(255, Math.round((dist / RANGE) * 255)));
    }
  }
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.name = 'residential road-distance mask';
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, origin };
}
