import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHUNK_METRES, SF_BBOX, SF_FRAME } from '../config';
import { geodeticToWorld, worldToGeodetic } from '../geo';
import type { Bbox, Bounds, XZ } from './types';

export { SF_FRAME };
export const MAP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const AREAS = {
  // First playable corridor: Ferry Building/Embarcadero, North Beach and Russian Hill.
  lombard: [-122.424, 37.795, -122.390, 37.806] as Bbox,
  sf: SF_BBOX,
};
export interface Settings {
  area: string;
  bbox: Bbox;
  bounds: Bounds;
  sourceBbox: Bbox;
  zoom: number;
  chunkSize: number;
  terrainStep: number;
  /** Full detail in the initial playable corridor; one coarse LOD elsewhere. */
  detailBounds?: Bounds;
  out: string;
  cache: string;
}
export const project = (lon: number, lat: number): XZ => geodeticToWorld(lat, lon, SF_FRAME);
export const unproject = (x: number, z: number) => worldToGeodetic(x, z, SF_FRAME);
export function validateBbox(bbox: Bbox): void {
  const [w, s, e, n] = bbox;
  if (!bbox.every(Number.isFinite) || w >= e || s >= n || w < -180 || e > 180 || s < -85 || n > 85)
    throw new Error('Invalid bbox: expected west,south,east,north within Web Mercator coverage');
}
export function geographicBounds(bounds: Bounds, pad = 0): Bbox {
  const [x0, z0, x1, z1] = bounds;
  const corners = [[x0-pad,z0-pad], [x1+pad,z0-pad], [x1+pad,z1+pad], [x0-pad,z1+pad]]
    .map(([x,z]) => unproject(x!,z!));
  return [Math.min(...corners.map(p=>p.lon)), Math.min(...corners.map(p=>p.lat)),
    Math.max(...corners.map(p=>p.lon)), Math.max(...corners.map(p=>p.lat))];
}
export function settings(area = 'lombard', bbox?: Bbox, zoom = 15): Settings {
  const selected = bbox ?? AREAS[area as keyof typeof AREAS];
  if (!selected) throw new Error(`Unknown area ${area}; use lombard, sf, or --bbox`);
  if (!/^[a-z0-9_-]+$/.test(area)) throw new Error('Area must be a simple directory name');
  validateBbox(selected);
  if (!Number.isInteger(zoom) || zoom < 12 || zoom > 15) throw new Error('Terrain zoom must be 12–15');
  const [w,s,e,n] = selected;
  const corners = [[w,s],[w,n],[e,s],[e,n]].map(([lon,lat])=>project(lon!,lat!));
  const snapDown = (v: number) => Math.floor(v / CHUNK_METRES) * CHUNK_METRES || 0;
  const snapUp = (v: number) => Math.ceil(v / CHUNK_METRES) * CHUNK_METRES || 0;
  const bounds: Bounds = [snapDown(Math.min(...corners.map(p=>p[0]))), snapDown(Math.min(...corners.map(p=>p[1]))),
    snapUp(Math.max(...corners.map(p=>p[0]))), snapUp(Math.max(...corners.map(p=>p[1])))];
  return { area, bbox: selected, bounds, sourceBbox: geographicBounds(bounds, 64), zoom,
    ...(area==='sf'?{detailBounds:settings('lombard').bounds}:{}),
    chunkSize: CHUNK_METRES, terrainStep: 4, out: resolve(MAP_ROOT,'out',process.env.MAP_OUT||area), cache: resolve(MAP_ROOT,'out/cache',area) };
// MAP_OUT=<dir> (gtasf-bhft): bake into tools/map/out/<dir> (e.g. sf-3dep) while sharing the area's source cache, so an
// experimental bake never overwrites the live area's output.
}
