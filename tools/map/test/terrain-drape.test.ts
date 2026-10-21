import { describe, expect, it } from 'vitest';
import { areaXZ, createTerrainDraper, type DrapeTriangle, type DrapeVertex } from '../../../shared/terrainDrape';

const saddle = (x: number, z: number) => 0.02 * x * x - 0.015 * z * z + 0.1 * x;
const ridge = (x: number, z: number) => 30 - Math.abs(x) * 0.4 + Math.sin(z * 0.2) * 2;

function drape(sample: (x: number, z: number) => number, source: DrapeTriangle, lift = 0.05) {
  const draper = createTerrainDraper(4, sample);
  const out: DrapeTriangle[] = [];
  draper.triangle(source, lift, (a, b, c) => out.push([a, b, c]));
  return { draper, out };
}

describe('terrain drape clearance', () => {
  for (const [name, sample, source] of [
    ['saddle', saddle, [[-13, 0, -9, 0, 0], [17, 0, -5, 1, 0], [-3, 0, 14, 0, 1]]],
    ['ridge across negative chunk coords', ridge, [[-21.5, 0, -30.2, 0, 0], [9.3, 0, -28, 1, 0], [-4, 0, -2.5, 0, 1]]],
  ] as const) {
    it(`${name}: paint sits exactly lift above terrain, covers source area, interpolates UVs`, () => {
      const src = source.map(v => [...v]) as unknown as DrapeTriangle;
      const { draper, out } = drape(sample, src);
      expect(out.length).toBeGreaterThan(4);
      let area = 0;
      for (const tri of out) {
        expect(areaXZ(tri[0], tri[1], tri[2])).toBeLessThan(0); // upward winding
        area += Math.abs(areaXZ(tri[0], tri[1], tri[2]));
        const centroid = [0, 1, 2].map(k => (tri[0][k]! + tri[1][k]! + tri[2][k]!) / 3);
        for (const p of [...tri, centroid]) expect(p[1]! - draper.height(p[0]!, p[2]!)).toBeCloseTo(0.05, 6);
        for (const p of tri) {
          // Barycentric UVs of the source triangle at this XZ.
          const [a, b, c] = src, d = areaXZ(a, b, c);
          const u = areaXZ(a, p, c) / d, v = areaXZ(a, b, p) / d;
          expect(p[3]).toBeCloseTo(u, 6);
          expect(p[4]).toBeCloseTo(v, 6);
        }
      }
      expect(area).toBeCloseTo(Math.abs(areaXZ(src[0], src[1], src[2])), 6);
    });
  }

  it('skips degenerate triangles', () => {
    const { out } = drape(saddle, [[0, 0, 0], [4, 0, 4], [8, 0, 8]]);
    expect(out).toHaveLength(0);
  });
});
