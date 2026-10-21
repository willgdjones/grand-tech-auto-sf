import type { Point2 } from '../geo';

export type Polygon = Point2[][];
export type MultiPolygon = Polygon[];
export type Geometry =
  | { type: 'Point'; coordinates: Point2 }
  | { type: 'MultiPoint' | 'LineString'; coordinates: Point2[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Point2[][] }
  | { type: 'MultiPolygon'; coordinates: MultiPolygon };
/** Coordinates are horizontal; source elevations remain properties until massing. */
export interface Feature {
  type: 'Feature';
  id: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
}
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}
export function mapGeometry(geometry: Geometry, transform: (point: Point2) => Point2): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: geometry.type, coordinates: transform(geometry.coordinates) };
    case 'LineString':
    case 'MultiPoint':
      return { type: geometry.type, coordinates: geometry.coordinates.map(transform) };
    case 'Polygon':
    case 'MultiLineString':
      return { type: geometry.type, coordinates: geometry.coordinates.map((line) => line.map(transform)) };
    case 'MultiPolygon':
      return {
        type: geometry.type,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(transform))),
      };
  }
}
export function vertices(geometry: Geometry): Point2[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates];
    case 'LineString':
    case 'MultiPoint':
      return geometry.coordinates;
    case 'Polygon':
    case 'MultiLineString':
      return geometry.coordinates.flat();
    case 'MultiPolygon':
      return geometry.coordinates.flat(2);
  }
}
export function polygons(geometry: Geometry): MultiPolygon {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`POLYGON_REQUIRED(${geometry.type})`);
}
export function transformFeatures(
  features: readonly Feature[],
  transform: (point: Point2) => Point2,
): Feature[] {
  return features.map((feature) => ({ ...feature, geometry: mapGeometry(feature.geometry, transform) }));
}
/** Stage boundaries alone quantize geometry, never intermediate transforms. */
export function quantizedCollection(features: readonly Feature[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: transformFeatures(features, ([x, z]) => [
      Number(x.toFixed(4)) + 0,
      Number(z.toFixed(4)) + 0,
    ]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
