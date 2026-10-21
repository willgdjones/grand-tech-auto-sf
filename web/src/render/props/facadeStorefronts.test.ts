import { describe, expect, it } from 'vitest';
import { placeGroundFacades } from './facadeStorefronts';
import type { ShopfrontContext } from '../shopfrontSigns';
import type { ChunkCollision } from '../chunks/terrain';

// placeGroundFacades reads collision + ground cell + nearestRoad; ground values are flat (height 0).
function context(buildings: ChunkCollision['buildings'], nearestRoad: ShopfrontContext['nearestRoad']): ShopfrontContext {
  return {
    collision: { version: 1, origin: [0, 0, 0], buildings },
    ground: { size: 2, step: 1, baseCm: 0, x: 0, z: 0, values: new Uint16Array(4) },
    nearestRoad,
  };
}
// A square footprint whose south edge (z = oz) faces -z; placed inside chunk (0,0).
const squareAt = (ox: number, oz: number, s = 18): [number, number][] => [[ox, oz], [ox + s, oz], [ox + s, oz + s], [ox, oz + s]];
// A road always 6 m south of the query, so each footprint's south wall (and only it) faces a street.
const roadToSouth: ShopfrontContext['nearestRoad'] = (qx, qz) => ({ x: qx, y: 0, z: qz - 6, yaw: 0 });
// Grid of footprints all inside chunk (0,0).
const grid = (n: number, maxY: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `blk${i}`, minY: 0, maxY, rings: [squareAt((i % 10) * 24, 20 + Math.floor(i / 10) * 60)] }));

describe('placeGroundFacades', () => {
  it('places road-facing, grounded pieces on street walls (hash-gated subset, one per building)', () => {
    const placements = placeGroundFacades(context(grid(30, 30), roadToSouth));
    expect(placements.length).toBeGreaterThanOrEqual(5);
    expect(new Set(placements.map(p => p.id)).size).toBe(placements.length); // no dupes
    for (const p of placements) {
      expect(['storefront', 'entrance']).toContain(p.kind);
      const [nx, nz] = p.normal;
      expect(Math.hypot(nx, nz)).toBeCloseTo(1, 5);
      expect(nz).toBeLessThan(-0.9);                      // faces the south road (outward)
      expect(p.width).toBeGreaterThan(0); expect(p.width).toBeLessThanOrEqual(6);
      expect(Math.abs(p.centre[1])).toBeLessThan(4);      // grounded near the road height
    }
  });

  it('uses grand entrances on some tall blocks and storefronts elsewhere', () => {
    const kinds = new Set(placeGroundFacades(context(grid(30, 30), roadToSouth)).map(p => p.kind));
    expect(kinds.has('storefront')).toBe(true);
    expect(kinds.has('entrance')).toBe(true);             // ~1/3 of tall blocks (>=12 m)
  });

  it('never uses entrances on low/medium blocks', () => {
    const kinds = new Set(placeGroundFacades(context(grid(20, 8), roadToSouth)).map(p => p.kind));
    expect(kinds.has('entrance')).toBe(false);            // height < 12 m stays storefront
    expect(kinds.has('storefront')).toBe(true);
  });

  it('places nothing when no wall faces a road, and skips sheds below 4 m', () => {
    expect(placeGroundFacades(context(grid(30, 30), () => null))).toEqual([]);
    expect(placeGroundFacades(context(grid(20, 3), roadToSouth))).toEqual([]);
  });
});
