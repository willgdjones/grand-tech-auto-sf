/** Optional SA map overlay; world metres (+x east, +z south). Rings use even-odd fill. */
export interface CoastlineData {
  version: 1;
  frame: { origin: { lat: number; lon: number }; gridRotationDeg: number };
  units: 'metres';
  bounds: readonly [number, number, number, number];
  rings: [number, number][][];
  toleranceM: number;
  source: { label: string; sha256: string; ways: number };
}
export const COASTLINE_MAX_BYTES = 200_000;
export const COASTLINE_MAX_VERTICES = 10_000;

export function validCoastline(value: unknown, frame: CoastlineData['frame']): value is CoastlineData {
  const data = value as CoastlineData | undefined;
  if (data?.version !== 1 || data.units !== 'metres' || !Array.isArray(data.rings) || data.rings.length > 256 ||
    !Number.isFinite(data.toleranceM) || data.toleranceM < 0 || data.toleranceM > 10 ||
    typeof data.source?.label !== 'string' || !/^[a-f0-9]{64}$/.test(data.source.sha256) ||
    !Number.isSafeInteger(data.source.ways) || data.source.ways < 1 ||
    data.frame?.origin?.lat !== frame.origin.lat || data.frame.origin.lon !== frame.origin.lon ||
    data.frame.gridRotationDeg !== frame.gridRotationDeg || !Array.isArray(data.bounds) || data.bounds.length !== 4 ||
    !data.bounds.every(Number.isFinite) || data.bounds[0] >= data.bounds[2] || data.bounds[1] >= data.bounds[3]) return false;
  let vertices = 0;
  return data.rings.every(ring => Array.isArray(ring) && ring.length >= 4 &&
    (vertices += ring.length) <= COASTLINE_MAX_VERTICES && ring.every(point => Array.isArray(point) && point.length === 2 &&
      point.every(Number.isFinite) && point[0] >= data.bounds[0] - .01 && point[0] <= data.bounds[2] + .01 &&
      point[1] >= data.bounds[1] - .01 && point[1] <= data.bounds[3] + .01) &&
    ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]);
}
