/** WGS84 horizontal geometry. Building height is independent of tangent-plane up. */
export type Vec3 = readonly [number, number, number];
export type Point2 = [number, number];
export interface Geodetic {
  lat: number;
  lon: number;
  h?: number;
}
export interface WorldFrame {
  origin: Geodetic;
  gridRotationDeg: number;
}
export const WGS84_A = 6_378_137;
export const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const RAD = Math.PI / 180;
export const US_SURVEY_FOOT_M = 1200 / 3937;

function finite(...values: number[]): void {
  if (values.some((v) => !Number.isFinite(v))) throw new Error('GEO_NONFINITE');
}
export function geodeticToEcef(latDeg: number, lonDeg: number, h = 0): Vec3 {
  finite(latDeg, lonDeg, h);
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) throw new Error('GEO_RANGE');
  const phi = latDeg * RAD,
    lambda = lonDeg * RAD;
  const sin = Math.sin(phi),
    cos = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
  return [(n + h) * cos * Math.cos(lambda), (n + h) * cos * Math.sin(lambda), (n * (1 - E2) + h) * sin];
}
export function ecefToGeodetic([x, y, z]: Vec3): Required<Geodetic> {
  finite(x, y, z);
  const p = Math.hypot(x, y);
  if (p === 0) {
    if (z === 0) throw new Error('GEO_EARTH_CENTRE');
    return { lat: Math.sign(z) * 90, lon: 0, h: Math.abs(z) - WGS84_A * (1 - WGS84_F) };
  }
  let phi = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 20; i++) {
    const sin = Math.sin(phi),
      n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
    const next = Math.atan2(z + E2 * n * sin, p);
    if (Math.abs(next - phi) < 1e-14) {
      phi = next;
      break;
    }
    phi = next;
    if (i === 19) throw new Error('GEO_INVERSE_DID_NOT_CONVERGE');
  }
  const sin = Math.sin(phi),
    cos = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
  const h = Math.abs(cos) > 0.5 ? p / cos - n : z / sin - n * (1 - E2);
  return { lat: phi / RAD, lon: Math.atan2(y, x) / RAD, h };
}
function basis(origin: Geodetic) {
  const phi = origin.lat * RAD,
    lambda = origin.lon * RAD;
  const sinPhi = Math.sin(phi),
    cosPhi = Math.cos(phi),
    sinLambda = Math.sin(lambda),
    cosLambda = Math.cos(lambda);
  return { o: geodeticToEcef(origin.lat, origin.lon, origin.h ?? 0), sinPhi, cosPhi, sinLambda, cosLambda };
}
export function ecefToEnu(point: Vec3, origin: Geodetic): Vec3 {
  finite(...point);
  const { o, sinPhi: s, cosPhi: c, sinLambda: sl, cosLambda: cl } = basis(origin);
  const dx = point[0] - o[0],
    dy = point[1] - o[1],
    dz = point[2] - o[2];
  return [-sl * dx + cl * dy, -s * cl * dx - s * sl * dy + c * dz, c * cl * dx + c * sl * dy + s * dz];
}
export function enuToEcef([e, n, u]: Vec3, origin: Geodetic): Vec3 {
  finite(e, n, u);
  const { o, sinPhi: s, cosPhi: c, sinLambda: sl, cosLambda: cl } = basis(origin);
  return [
    o[0] - sl * e - s * cl * n + c * cl * u,
    o[1] + cl * e - s * sl * n + c * sl * u,
    o[2] + c * n + s * u,
  ];
}
export function enuToWorld(e: number, n: number, gridRotationDeg: number): Point2 {
  finite(e, n, gridRotationDeg);
  const theta = gridRotationDeg * RAD,
    c = Math.cos(theta),
    s = Math.sin(theta);
  return [e * c - n * s, -(e * s + n * c)];
}
export function worldToEnu(x: number, z: number, gridRotationDeg: number): Point2 {
  finite(x, z, gridRotationDeg);
  const theta = gridRotationDeg * RAD,
    c = Math.cos(theta),
    s = Math.sin(theta);
  return [x * c - z * s, -x * s - z * c];
}
export function geodeticToWorld(lat: number, lon: number, frame: WorldFrame): Point2 {
  const [e, n] = ecefToEnu(geodeticToEcef(lat, lon), frame.origin);
  return enuToWorld(e, n, frame.gridRotationDeg);
}
/** Recover the h=0 ellipsoid surface, not the tangent plane's slightly elevated point. */
export function worldToGeodetic(x: number, z: number, frame: WorldFrame): Required<Geodetic> {
  const [e, n] = worldToEnu(x, z, frame.gridRotationDeg);
  let u = 0;
  for (let i = 0; i < 8; i++) {
    const point = ecefToGeodetic(enuToEcef([e, n, u], frame.origin));
    if (Math.abs(point.h) < 1e-8) return point;
    u -= point.h;
  }
  throw new Error('GEO_SURFACE_INVERSE_DID_NOT_CONVERGE');
}


/** Positive means CCW on a north-up map, whose vertical axis is -z. */
export function mapArea(ring: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    area += b[0] * a[1] - a[0] * b[1];
  }
  return area / 2;
}
