import { districtAt } from './index';

export const ROAD_DETAIL_CELL_METRES = 256;
/** Metadata limit only; the renderer still requests at most two of its nine nearby cells. */
export const DISTRICT_ROAD_MAX_CELLS = 1024;
export const LEGACY_ROAD_DETAIL_BOUNDS = [-2304, -2816, 2048, 3584] as const;
type Bounds = readonly [number, number, number, number];
type Point = readonly [number, number, number];
export interface RoadDetailPart { key: string; points: [number, number, number][]; from: number; to: number }
export interface DistrictRoadSource {
  name: string; highway: string; points: readonly Point[];
  bridge?: boolean; tunnel?: boolean; layer?: number;
}
const CELL = ROAD_DETAIL_CELL_METRES;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;

/** Split at grid edges while retaining source arclength for paint phase and junction gaps. */
export function splitRoadDetailCells(points: readonly Point[]): RoadDetailPart[] {
  const parts: RoadDetailPart[] = []; let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (length < .001) continue;
    const cuts = new Set([0, 1]);
    for (const axis of [0, 2] as const) {
      const min = Math.min(a[axis], b[axis]), max = Math.max(a[axis], b[axis]);
      for (let edge = (Math.floor(min / CELL) + 1) * CELL; edge < max; edge += CELL)
        cuts.add((edge - a[axis]) / (b[axis] - a[axis]));
    }
    const ordered = [...cuts].sort((x, y) => x - y);
    const at = (t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let j = 1; j < ordered.length; j++) {
      const lo = ordered[j - 1]!, hi = ordered[j]!, p = at(lo), q = at(hi);
      const key = cellKey((p[0] + q[0]) / 2, (p[2] + q[2]) / 2), previous = parts.at(-1);
      if (previous?.key === key) { previous.points.push(q); previous.to = walked + length * hi; }
      else parts.push({ key, points: [p, q], from: walked + length * lo, to: walked + length * hi });
    }
    walked += length;
  }
  return parts;
}

export function roadDetailCellWithin(key: string, bounds: Bounds): boolean {
  const [cx, cz] = key.split('_').map(Number), x = (cx! + .5) * CELL, z = (cz! + .5) * CELL;
  return x >= bounds[0] && x < bounds[2] && z >= bounds[1] && z < bounds[3];
}

export function districtRoadPartOwners(road: Pick<DistrictRoadSource, 'name' | 'highway' | 'bridge' | 'tunnel' | 'layer'>, part: RoadDetailPart): string[] {
  if (road.bridge || road.tunnel || road.layer || /^(motorway|trunk)(_|$)/.test(road.highway)) return [];
  const owners = new Set<string>();
  for (let i = 1; i < part.points.length; i++) {
    const a = part.points[i - 1]!, b = part.points[i]!;
    const district = districtAt((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    if (district?.streets.includes(road.name)) owners.add(district.id);
  }
  return [...owners];
}

/** Keep existing eastern coverage and extend along every configured source street.
 * No nearest-N truncation: an oversized result must fail the exporter budget gate.
 * Input roads come from prepareRoadDetails (source drivable, non-grade-separated).
 */
export function selectDistrictRoadCells(roads: readonly DistrictRoadSource[], corridor: Bounds, legacyCells: Iterable<string> = []) {
  const cells = new Set([...legacyCells].filter(key => !roadDetailCellWithin(key, corridor)));
  const byDistrict = new Map<string, Set<string>>();
  for (const road of roads) {
    if (road.bridge || road.tunnel || road.layer || /^(motorway|trunk)(_|$)/.test(road.highway)) continue;
    for (const part of splitRoadDetailCells(road.points)) {
      if (roadDetailCellWithin(part.key, corridor)) continue;
      // Source profiles are dense, so use every fragment midpoint, not the cell
      // centre: a frontage can cross a region boundary inside one 256m cell.
      for (const id of districtRoadPartOwners(road, part)) {
        cells.add(part.key);
        const owned = byDistrict.get(id) ?? new Set<string>();
        owned.add(part.key); byDistrict.set(id, owned);
      }
    }
  }
  return { cells, byDistrict };
}

export function districtRoadCellBounds(keys: Iterable<string>): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const key of keys) {
    const [x, z] = key.split('_').map(Number);
    minX = Math.min(minX, x! * CELL); minZ = Math.min(minZ, z! * CELL);
    maxX = Math.max(maxX, (x! + 1) * CELL); maxZ = Math.max(maxZ, (z! + 1) * CELL);
  }
  if (!Number.isFinite(minX)) throw new Error('District road selection is empty');
  return [minX, minZ, maxX, maxZ];
}
