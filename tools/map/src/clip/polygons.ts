import * as polygonClipping from 'polyclip-ts';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import type JtsGeometry from 'jsts/org/locationtech/jts/geom/Geometry.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferBuilder from 'jsts/org/locationtech/jts/operation/buffer/BufferBuilder.js';
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js';
import { mapArea } from '../geo';
import type { Point2 } from '../geo';
import type { Geometry, MultiPolygon, Polygon } from '../geo/features';

export function polygonArea(shape: MultiPolygon): number {
  return shape.reduce(
    (total, polygon) =>
      total + polygon.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * Math.abs(mapArea(ring)), 0),
    0,
  );
}
export function intersectionArea(a: MultiPolygon, b: MultiPolygon): number {
  return polygonArea(polygonClipping.intersection(a, b));
}
export function polygonCentroid(shape: MultiPolygon): Point2 {
  let weight = 0,
    x = 0,
    z = 0;
  for (const polygon of shape)
    for (const [index, ring] of polygon.entries()) {
      let twiceArea = 0,
        cx = 0,
        cz = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        const cross = a[0] * b[1] - b[0] * a[1];
        twiceArea += cross;
        cx += (a[0] + b[0]) * cross;
        cz += (a[1] + b[1]) * cross;
      }
      if (twiceArea === 0) continue;
      const area = ((index === 0 ? 1 : -1) * Math.abs(twiceArea)) / 2;
      weight += area;
      x += (cx / (3 * twiceArea)) * area;
      z += (cz / (3 * twiceArea)) * area;
    }
  if (weight <= 0) throw new Error('POLYGON_ZERO_AREA');
  return [x / weight, z / weight];
}
/** Floating-precision round buffer, without simplification or precision-reduction fallback.
 * 36 segments/quadrant keeps even JTS's rounded segment counts below 5 degrees per arc.
 */
export function bufferPolygon(shape: MultiPolygon, radius: number): MultiPolygon {
  if (!Number.isFinite(radius) || radius < 0) throw new Error('BUFFER_RADIUS_INVALID');
  if (
    !shape.length ||
    shape.some(
      (polygon) =>
        !polygon.length ||
        polygon.some(
          (ring) =>
            ring.length < 4 ||
            ring.some((point) => !point.every(Number.isFinite)) ||
            ring[0]![0] !== ring.at(-1)![0] ||
            ring[0]![1] !== ring.at(-1)![1],
        ),
    )
  )
    throw new Error('BUFFER_INVALID_CLOSED_POLYGON');
  const parameters = new BufferParameters();
  parameters.setQuadrantSegments(36);
  parameters.setJoinStyle(BufferParameters.JOIN_ROUND);
  parameters.setEndCapStyle(BufferParameters.CAP_ROUND);
  parameters.setSimplifyFactor(0);
  // JSTS's generated declarations erase GeoJSON and buffer return types. The inputs here
  // are validated polygons; keep the untyped library boundary local to these casts.
  const input = new GeoJSONReader(new GeometryFactory()).read({
    type: 'MultiPolygon',
    coordinates: shape,
  }) as JtsGeometry;
  const buffered = new BufferBuilder(parameters).buffer(input, radius) as JtsGeometry & {
    isEmpty(): boolean;
  };
  if (buffered.isEmpty()) return [];
  const result = new GeoJSONWriter().write(buffered) as { type: string; coordinates: Polygon | MultiPolygon };
  if (result.type === 'Polygon') return [result.coordinates as Polygon];
  if (result.type === 'MultiPolygon') return result.coordinates as MultiPolygon;
  throw new Error('BUFFER_POLYGON_RESULT_REQUIRED');
}
function onSegment(p: Point2, a: Point2, b: Point2): boolean {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = Math.hypot(dx, dz);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= 1e-9;
  return (
    Math.abs(dx * (p[1] - a[1]) - dz * (p[0] - a[0])) <= 1e-9 * length &&
    (p[0] - a[0]) * dx + (p[1] - a[1]) * dz >= -1e-9 &&
    (p[0] - b[0]) * dx + (p[1] - b[1]) * dz <= 1e-9
  );
}
function ringContains(p: Point2, ring: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}
export function containsPoint(shape: MultiPolygon, p: Point2): boolean {
  return shape.some((polygon) => {
    if (polygon.some((ring) => ring.some((a, i) => onSegment(p, a, ring[(i + 1) % ring.length]!))))
      return true;
    return ringContains(p, polygon[0]!) && !polygon.slice(1).some((ring) => ringContains(p, ring));
  });
}
function crosses(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  const side = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
function lineIntersects(shape: MultiPolygon, line: Point2[]): boolean {
  if (line.some((p) => containsPoint(shape, p))) return true;
  return line
    .slice(1)
    .some((b, i) =>
      shape.some((polygon) =>
        polygon.some((ring) => ring.slice(1).some((d, j) => crosses(line[i]!, b, ring[j]!, d))),
      ),
    );
}
/** Boundary contact counts, including zero-area tangencies and lines spanning the ring. */
export function intersects(shape: MultiPolygon, geometry: Geometry): boolean {
  switch (geometry.type) {
    case 'Point':
      return containsPoint(shape, geometry.coordinates);
    case 'MultiPoint':
      return geometry.coordinates.some((p) => containsPoint(shape, p));
    case 'LineString':
      return lineIntersects(shape, geometry.coordinates);
    case 'MultiLineString':
      return geometry.coordinates.some((line) => lineIntersects(shape, line));
    case 'Polygon':
      return intersects(shape, { type: 'MultiPolygon', coordinates: [geometry.coordinates] });
    case 'MultiPolygon':
      return (
        intersectionArea(shape, geometry.coordinates) > 0 ||
        geometry.coordinates.some((polygon) => polygon.some((ring) => lineIntersects(shape, ring)))
      );
  }
}
