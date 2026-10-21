import { LocalRoads } from '../world/localRoads';
import type { TechWeekEvent } from '../events/types';

export interface FundingAnchor { x: number; y: number; z: number }
export type FundingAnchorResolver = (event: Pick<TechWeekEvent, 'lat' | 'lon'>) => FundingAnchor | null;
let fallbackRoads: LocalRoads | undefined;

/** Matches the map manifest's WGS84 ECEF→ENU frame and radar/projection.ts. */
export function project(lat: number, lon: number): { x: number; z: number } {
  const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f), origin = { lat: 37.7842, lon: -122.4078 };
  const ecef = (latitude: number, longitude: number) => {
    const phi = latitude * rad, lambda = longitude * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    return [n * Math.cos(phi) * Math.cos(lambda), n * Math.cos(phi) * Math.sin(lambda), n * (1 - e2) * Math.sin(phi)] as const;
  };
  const a = ecef(origin.lat, origin.lon), b = ecef(lat, lon), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const phi = origin.lat * rad, lambda = origin.lon * rad;
  return { x: -Math.sin(lambda) * dx + Math.cos(lambda) * dy,
    z: -(-Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz) };
}
/** Authoritative approach on the active map; indexed city roads retain their road height. */
/** Same snap radius as the client's ring placement. */
export const RING_SNAP_M = 200;
export function fundingAnchor(event: Pick<TechWeekEvent, 'lat' | 'lon'>, roads?: Pick<LocalRoads, 'snap'>): FundingAnchor | null {
  if (event.lat === null || event.lon === null || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return null;
  const point = project(event.lat, event.lon);
  // 200 m matches the client's ring snap (main.ts resolvePosition), so every ring it draws has an anchor.
  const snap = (roads ?? (fallbackRoads ??= new LocalRoads())).snap({ x: point.x * 100, y: 0, z: point.z * 100 }, RING_SNAP_M);
  if (!snap || snap.distance >= RING_SNAP_M) return null;
  return { x: snap.point[0], y: snap.point[1], z: snap.point[2] };
}
