import { Matrix4, Vector3 } from 'three';

export interface GoogleWorldFrame {
  origin: { lat: number; lon: number };
  gridRotationDeg: number;
}

/** WGS84 ECEF -> our map frame (+X east, +Y up, -Z north), including grid rotation.
 * Same ellipsoid and horizontal basis as tools/map/src/geo.ts. Heights initially remain
 * ellipsoidal; the runtime aligns only the rendered basemap to our independent road surface. */
export function ecefToWorldMatrix(frame: GoogleWorldFrame): Matrix4 {
  const latitude = frame.origin.lat * Math.PI / 180, longitude = frame.origin.lon * Math.PI / 180;
  const angle = frame.gridRotationDeg * Math.PI / 180;
  if (![latitude, longitude, angle].every(Number.isFinite)) throw new Error('Invalid Google Tiles world frame');
  const sp = Math.sin(latitude), cp = Math.cos(latitude), sl = Math.sin(longitude), cl = Math.cos(longitude);
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const n = a / Math.sqrt(1 - e2 * sp * sp);
  const origin = new Vector3(n * cp * cl, n * cp * sl, n * (1 - e2) * sp);
  const east = new Vector3(-sl, cl, 0), north = new Vector3(-sp * cl, -sp * sl, cp);
  const up = new Vector3(cp * cl, cp * sl, sp);
  const x = east.clone().multiplyScalar(Math.cos(angle)).addScaledVector(north, -Math.sin(angle));
  const z = east.clone().multiplyScalar(-Math.sin(angle)).addScaledVector(north, -Math.cos(angle));
  return new Matrix4().set(
    x.x, x.y, x.z, -x.dot(origin),
    up.x, up.y, up.z, -up.dot(origin),
    z.x, z.y, z.z, -z.dot(origin),
    0, 0, 0, 1,
  );
}
