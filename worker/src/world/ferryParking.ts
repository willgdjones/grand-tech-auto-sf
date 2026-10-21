import type { Pose, VehicleKind } from '@gtasf/shared/protocol/types';
import { LocalRoads, routePose } from './localRoads';
import { LOCAL_ROAD_GRAPH } from './localRoadData';
import { LOCAL_SPAWN } from './localSpawn';

export interface ParkingBay { kind: VehicleKind; pose: Pose }

/** Embarcadero's plaza-side kerb, using the existing OSM lane geometry and elevations.
 * Leave the central approach/taxi pickup gap empty; cars run parallel to the kerb,
 * outside the plaza's central walking axis. The tenth car is the existing starter. */
export function ferryParkingBays(): ParkingBay[] {
  const roads = new LocalRoads({ ...LOCAL_ROAD_GRAPH,
    edges: LOCAL_ROAD_GRAPH.edges.filter(edge => edge.id.startsWith('lane:283512618:')) });
  const centre = roads.snap(LOCAL_SPAWN, 40);
  if (!centre) return [];
  const kinds = ['tesla', 'subaru', 'prius'] as const;
  return [-40, -33, -26, -19, -12, 12, 19, 26, 33].flatMap((offset, index) => {
    // The road bends gently here. Snap each seed separately instead of floating a straight row.
    const snap = roads.snap({ x: (centre.point[0] + offset * .58) * 100,
      y: centre.point[1] * 100, z: (centre.point[2] + offset * .81) * 100 }, 12);
    if (!snap) return [];
    const segment = roads.approach(snap, .5).at(-1);
    if (!segment) return [];
    const pose = routePose(segment, segment.length), angle = pose.yaw / 256 * Math.PI * 2;
    // 2.5m from lane centre toward the plaza: clear of the moving lane, parallel parking.
    pose.x += Math.round(Math.cos(angle) * 250);
    pose.z -= Math.round(Math.sin(angle) * 250);
    return [{ kind: kinds[index % kinds.length]!, pose }];
  });
}
