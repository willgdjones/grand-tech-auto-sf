/** Roof guard (gtasf-roof-fix): a driven car must NEVER use a building roof as drivable ground.
 *
 * Live bug (#5.46 dense LiDAR map): a car launched by a hill/jump can land on a contiguous rowhouse
 * roof and then drive across the roofs, because the controller's airborne-landing fallback keeps the
 * car at its ballistic height when the ground sample over a footprint is null, and a roof-high surface
 * sample then reads as ground. The real drivable network is the ROAD graph, which is always at street
 * level regardless of the terrain field or building geometry — so we detect "on a roof" against it.
 */
export interface RoofGuardWorld {
  /** Top (max y) of the loaded building whose footprint contains (or is within `slack` m of) (x,z). */
  buildingTopAt(x: number, z: number, slack?: number): number | null;
  /** Road-surface height at/near (x,z) (null when no road is near): the street level, bare of buildings. */
  roadHeightAt(x: number, z: number, referenceY?: number): number | null;
}

export interface RoofGuardOptions {
  /** How far outside a footprint still counts as "on this building" (m). */
  topSlack?: number;
  /** The car's y must be within this of the building top to count as sitting on its roof (m). */
  topMargin?: number;
  /** The car must sit at least this far above the nearest road to count as elevated onto a roof (m). */
  roadMargin?: number;
}

/**
 * True when a driven car is perched on a building roof rather than on the road/terrain: a building
 * footprint sits under (x,z), the car's height `y` is at that building's top, and the road network is
 * clearly below it (or there is no road near). Robust whether the stray height came from an airborne
 * landing (terrain is street-level, car stuck high) or a roof-high surface sample (terrain reads as the
 * roof): both leave the car far above the street-level road graph on top of a footprint.
 */
export function isOnBuildingRoof(world: RoofGuardWorld, x: number, z: number, y: number,
  { topSlack = 1.0, topMargin = 2.0, roadMargin = 3.0 }: RoofGuardOptions = {}): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return false;
  const top = world.buildingTopAt(x, z, topSlack);
  // No footprint under the car (or the car is well below the roof, e.g. driving past at street level).
  if (top === null || y < top - topMargin) return false;
  const road = world.roadHeightAt(x, z, y);
  // On a roof when the road network is clearly below the car (or absent under the building footprint).
  return road === null || y > road + roadMargin;
}
