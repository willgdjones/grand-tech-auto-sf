import type { Polygon } from '../geo/features';
import { polygonArea, intersectionArea } from '../clip/polygons';
import { facadeEdgeOrder } from '../geom/facades';
import { distance, edgeLines, openRing, ringFromLines, validPolygon } from '../geom/rings';
import type { Setback } from './types';

export const BUILDING_BASE_Y = 0.15;
export interface MassTier {
  baseY: number;
  topY: number;
  polygon: Polygon;
}

/** k is fixed on the cleaned exterior; successive tiers retain those original edge identities. */
export function setbackTiers(
  key: string,
  polygon: Polygon,
  height: number,
  setbacks: readonly Setback[],
): MassTier[] {
  function fail(reason: string): never {
    throw new Error(`MASS_INVALID_SETBACK(${key}): ${reason}`);
  }
  const qualified = facadeEdgeOrder(polygon[0]!);
  let current = polygon.map(openRing),
    baseY = BUILDING_BASE_Y;
  const tiers: MassTier[] = [];
  for (const setback of setbacks) {
    const topY = BUILDING_BASE_Y + setback.atM;
    if (topY <= baseY || setback.atM >= height)
      fail('tier must be strictly above the previous tier and below the roof');
    tiers.push({ baseY, topY, polygon: current });
    const lines = edgeLines(current[0]!);
    for (const k of setback.edges) {
      const facade = qualified[k];
      if (!facade || !Number.isSafeInteger(k)) fail(`unknown facade k=${k}`);
      const line = lines[facade.edgeIndex]!;
      // Map-CCW exterior: (-dz,dx) is outward in world x/z.
      line.centre = [
        line.centre[0] + line.direction[1] * setback.insetM,
        line.centre[1] - line.direction[0] * setback.insetM,
      ];
    }
    const exterior = ringFromLines(lines);
    if (!exterior) fail('parallel neighbouring lines');
    const next = [exterior, ...current.slice(1)];
    if (!validPolygon(next) || polygonArea([next]) <= 0) fail('self-intersection or collapsed tier');
    for (const [i, point] of exterior.entries()) {
      const end = exterior[(i + 1) % exterior.length]!;
      const direction = lines[i]!.direction;
      if (
        distance(point, end) < 0.001 ||
        (end[0] - point[0]) * direction[0] + (end[1] - point[1]) * direction[1] <= 0
      )
        fail(`vanishing or reversed edge ${i}`);
    }
    if (polygonArea([next]) - intersectionArea([next], [current]) > 1e-6)
      fail('tier leaves its supporting footprint');
    current = next;
    baseY = topY;
  }
  tiers.push({ baseY, topY: BUILDING_BASE_Y + height, polygon: current });
  return tiers;
}
