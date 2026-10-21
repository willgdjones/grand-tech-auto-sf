type WorldPoint = { x: number; y: number; z: number };
interface DestinationWorld {
  nearestRoad(x: number, z: number, maxDistance: number): WorldPoint | null;
  surfaceHeightAt(x: number, z: number, referenceY?: number): number | null;
}

/** Keep the sourced lane's vertical level when resolving a hail in world metres. */
export function resolveRobotaxiDestination(world: DestinationWorld, target: WorldPoint): WorldPoint {
  const road = world.nearestRoad(target.x, target.z, 600) ?? target;
  // With no reference height the sampler deliberately excludes bridges and tunnels.
  // An unloaded surface still has the road graph's authoritative lane height.
  return { x: road.x, y: world.surfaceHeightAt(road.x, road.z, road.y) ?? road.y, z: road.z };
}
