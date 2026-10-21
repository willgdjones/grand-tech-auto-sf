import { ShapeUtils, Vector2 } from 'three';
import type { Point2 } from '../geo';
import type { Polygon } from '../geo/features';
import { polygonArea } from '../clip/polygons';
import { facadeEdgeOrder } from '../geom/facades';
import { openRing, orientRing, simplifyRing, validPolygon } from '../geom/rings';
import type { MassTier } from './setbacks';
import { BUILDING_BASE_Y, setbackTiers } from './setbacks';
import type { CleanBuilding, Setback } from './types';

export interface MeshGeometry {
  positions: number[];
  indices: number[];
}
function roofTriangles(polygon: Polygon): number[][] {
  const vectors = polygon.map((ring) => openRing(ring).map(([x, z]) => new Vector2(x, z)));
  return ShapeUtils.triangulateShape(vectors[0]!, vectors.slice(1));
}
export function extrudeTiers(tiers: readonly MassTier[]): MeshGeometry {
  const positions: number[] = [],
    indices: number[] = [];
  for (const tier of tiers) {
    const rings = tier.polygon.map(openRing),
      points = rings.flat();
    const offset = positions.length / 3,
      count = points.length;
    for (const y of [tier.baseY, tier.topY]) for (const [x, z] of points) positions.push(x, y, z);
    let start = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = offset + start + i,
          b = offset + start + ((i + 1) % ring.length);
        indices.push(a, b, b + count, a, b + count, a + count);
      }
      start += ring.length;
    }
    let triangleArea = 0;
    for (const triangle of roofTriangles(rings)) {
      const [a, b, c] = triangle as [number, number, number];
      const p = points[a]!,
        q = points[b]!,
        r = points[c]!;
      const up = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
      triangleArea += Math.abs(up) / 2;
      const ordered = up > 0 ? [a, b, c] : [a, c, b];
      indices.push(...ordered.map((i) => offset + count + i));
    }
    const area = polygonArea([rings]);
    if (Math.abs(triangleArea - area) > Math.max(1e-6, area * 1e-8))
      throw new Error('MASS_ROOF_TRIANGULATION_INCOMPLETE');
  }
  return { positions, indices };
}

export function heroMesh(building: CleanBuilding, height: number, setbacks: readonly Setback[]) {
  let polygon = building.polygon,
    tiers = setbackTiers(building.key, polygon, height, setbacks);
  let geometry = extrudeTiers(tiers),
    simplifiedForBudget = false;
  if (geometry.indices.length / 3 > 1500) {
    polygon = polygon.map((ring, i) => orientRing(simplifyRing(ring, 0.5), i === 0));
    if (!validPolygon(polygon)) throw new Error(`MASS_BUDGET_SIMPLIFICATION_INVALID(${building.key})`);
    const before = facadeEdgeOrder(building.polygon[0]!),
      after = facadeEdgeOrder(polygon[0]!);
    for (const k of new Set(setbacks.flatMap((setback) => setback.edges))) {
      const a = before[k],
        b = after[k];
      if (
        !a ||
        !b ||
        a.outwardNormal[0] * b.outwardNormal[0] + a.outwardNormal[2] * b.outwardNormal[2] < 1 - 1e-6 ||
        Math.hypot(
          (a.start[0] + a.end[0] - b.start[0] - b.end[0]) / 2,
          (a.start[1] + a.end[1] - b.start[1] - b.end[1]) / 2,
        ) > 1
      )
        throw new Error(`MASS_BUDGET_CHANGES_SETBACK_FACADE(${building.key}, ${k})`);
    }
    tiers = setbackTiers(building.key, polygon, height, setbacks);
    geometry = extrudeTiers(tiers);
    simplifiedForBudget = true;
  }
  const tris = geometry.indices.length / 3;
  if (tris > 1500) throw new Error(`MASS_HERO_TRIANGLE_BUDGET(${building.key}, ${tris})`);
  return { polygon, tiers, geometry, tris, simplifiedForBudget };
}

/** A minimum-area bounding rectangle must align to an edge of the convex hull. */
export function minimumRectangle(ring: readonly Point2[]): Point2[] {
  const points = openRing(ring).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (rows: Point2[]) => {
    const hull: Point2[] = [];
    for (const p of rows) {
      while (hull.length >= 2 && turn(hull.at(-2)!, hull.at(-1)!, p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(points), ...half([...points].reverse())];
  let best: Point2[] | undefined,
    bestArea = Infinity;
  for (const [i, a] of hull.entries()) {
    const b = hull[(i + 1) % hull.length]!,
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const u = hull.map(([x, z]) => x * c + z * s),
      v = hull.map(([x, z]) => -x * s + z * c);
    const loU = Math.min(...u),
      hiU = Math.max(...u),
      loV = Math.min(...v),
      hiV = Math.max(...v);
    const area = (hiU - loU) * (hiV - loV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      best = [
        [loU, loV],
        [hiU, loV],
        [hiU, hiV],
        [loU, hiV],
      ].map(([u, v]): Point2 => [u! * c - v! * s, u! * s + v! * c]);
    }
  }
  if (!best || bestArea <= 0) throw new Error('MASS_BOUNDING_RECTANGLE_INVALID');
  return orientRing(best);
}
export function backdropMesh(building: CleanBuilding, height: number) {
  let exterior = orientRing(simplifyRing(building.polygon[0]!, 2));
  if (exterior.length > 12 || !validPolygon([exterior])) exterior = minimumRectangle(building.polygon[0]!);
  const geometry = extrudeTiers([
    { baseY: BUILDING_BASE_Y, topY: BUILDING_BASE_Y + height, polygon: [exterior] },
  ]);
  const tris = geometry.indices.length / 3;
  if (tris > 60) throw new Error(`MASS_BACKDROP_TRIANGLE_BUDGET(${building.key}, ${tris})`);
  return { polygon: [exterior], geometry, tris };
}
