export interface MapFrame { origin: { lat: number; lon: number }; gridRotationDeg: number }
/** Same WGS84 ECEF→ENU horizontal projection used by tools/map/src/geo.ts. */
export function projectLocation(lat: number, lon: number, frame: MapFrame): { x: number; z: number } {
  const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  function ecef(latitude: number, longitude: number): [number, number, number] {
    const phi = latitude * rad, lambda = longitude * rad;
    const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    return [n * Math.cos(phi) * Math.cos(lambda), n * Math.cos(phi) * Math.sin(lambda), n * (1 - e2) * Math.sin(phi)];
  }
  const a = ecef(frame.origin.lat, frame.origin.lon), b = ecef(lat, lon);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const phi = frame.origin.lat * rad, lambda = frame.origin.lon * rad, theta = frame.gridRotationDeg * rad;
  const east = -Math.sin(lambda) * dx + Math.cos(lambda) * dy;
  const north = -Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz;
  return { x: east * Math.cos(theta) - north * Math.sin(theta), z: -(east * Math.sin(theta) + north * Math.cos(theta)) };
}
