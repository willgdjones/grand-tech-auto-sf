import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import { mapArea } from '../geo';
import type { Point2 } from '../geo';
import type { Polygon } from '../geo/features';

export const distance = (a: Point2, b: Point2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const cross = (a: Point2, b: Point2): number => a[0] * b[1] - a[1] * b[0];
export const subtract = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];

/** Algorithms use open rings; GeoJSON and the topology validator use closed rings. */
export function openRing(ring: readonly Point2[]): Point2[] {
  const points = ring.map((point): Point2 => [...point]);
  if (points.length > 1 && distance(points[0]!, points.at(-1)!) < 1e-9) points.pop();
  return points;
}
export function closeRing(ring: readonly Point2[]): Point2[] {
  const points = openRing(ring);
  return points.length ? [...points, [...points[0]!]] : [];
}
export function perimeter(ring: readonly Point2[]): number {
  const points = openRing(ring);
  return points.reduce((sum, p, i) => sum + distance(p, points[(i + 1) % points.length]!), 0);
}
/** Stable starting vertex, preserving exterior/void orientation on the (x,-z) map plane. */
export function orientRing(ring: readonly Point2[], exterior = true): Point2[] {
  let points = openRing(ring);
  if (!points.length) return points;
  if (mapArea(points) > 0 !== exterior) points = points.reverse();
  let first = 0;
  for (let i = 1; i < points.length; i++)
    if (
      points[i]![0] < points[first]![0] ||
      (points[i]![0] === points[first]![0] && points[i]![1] < points[first]![1])
    )
      first = i;
  return [...points.slice(first), ...points.slice(0, first)];
}

export function validPolygon(polygon: Polygon): boolean {
  if (!polygon.length) return false;
  const rings = polygon.map(openRing);
  if (
    rings.some(
      (ring) =>
        ring.length < 3 ||
        ring.some((p, i) => !p.every(Number.isFinite) || distance(p, ring[(i + 1) % ring.length]!) < 1e-9),
    )
  )
    return false;
  // JSTS's generated reader declarations are untyped; the boundary is validated above.
  const geometry: unknown = new GeoJSONReader(new GeometryFactory()).read({
    type: 'Polygon',
    coordinates: rings.map(closeRing),
  });
  return new IsValidOp(geometry).isValid();
}

export function removeRedundant(ring: readonly Point2[]): Point2[] {
  const points = openRing(ring).filter((p, i, all) => i === 0 || distance(p, all[i - 1]!) >= 0.001);
  if (points.length > 1 && distance(points[0]!, points.at(-1)!) < 0.001) points.pop();
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const a = subtract(points[i]!, points[(i + points.length - 1) % points.length]!);
      const b = subtract(points[(i + 1) % points.length]!, points[i]!);
      const angle = Math.abs(Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]));
      if (angle < (0.1 * Math.PI) / 180) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}
export function nearestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const d = subtract(b, a);
  const square = d[0] ** 2 + d[1] ** 2;
  const t =
    square === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / square));
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}
function simplifyLine(points: Point2[], epsilon: number): Point2[] {
  if (points.length <= 2) return points;
  let maximum = epsilon,
    at = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const deviation = distance(points[i]!, nearestOnSegment(points[i]!, points[0]!, points.at(-1)!));
    if (deviation > maximum) {
      maximum = deviation;
      at = i;
    }
  }
  return at < 0
    ? [points[0]!, points.at(-1)!]
    : [
        ...simplifyLine(points.slice(0, at + 1), epsilon).slice(0, -1),
        ...simplifyLine(points.slice(at), epsilon),
      ];
}
/** Split a closed ring at a stable vertex and its farthest vertex, then simplify both arcs. */
export function simplifyRing(ring: readonly Point2[], epsilon: number): Point2[] {
  const points = openRing(ring);
  if (points.length <= 3) return points;
  let farthest = 1;
  for (let i = 2; i < points.length; i++)
    if (distance(points[0]!, points[i]!) > distance(points[0]!, points[farthest]!)) farthest = i;
  const result = [
    ...simplifyLine(points.slice(0, farthest + 1), epsilon).slice(0, -1),
    ...simplifyLine([...points.slice(farthest), points[0]!], epsilon).slice(0, -1),
  ];
  return result.length >= 3 ? result : points;
}
export interface EdgeLine {
  centre: Point2;
  direction: Point2;
}
export function edgeLines(ring: readonly Point2[]): EdgeLine[] {
  const points = openRing(ring);
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length]!;
    const length = distance(p, q);
    return {
      centre: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
      direction: [(q[0] - p[0]) / length, (q[1] - p[1]) / length],
    };
  });
}
export function intersectLines(a: EdgeLine, b: EdgeLine): Point2 | null {
  const denominator = cross(a.direction, b.direction);
  if (Math.abs(denominator) < 1e-10) return null;
  const t = cross(subtract(b.centre, a.centre), b.direction) / denominator;
  return [a.centre[0] + t * a.direction[0], a.centre[1] + t * a.direction[1]];
}
export function ringFromLines(lines: readonly EdgeLine[]): Point2[] | null {
  const points = lines.map((line, i) => intersectLines(lines[(i + lines.length - 1) % lines.length]!, line));
  return points.every((point): point is Point2 => point !== null) ? points : null;
}
export function snapRightAngles(polygon: Polygon): { polygon: Polygon; rejected: boolean } {
  const snapped = polygon.map((ring) => {
    const points = openRing(ring);
    const lines = edgeLines(points);
    const lengths = points.map((p, i) => distance(p, points[(i + 1) % points.length]!));
    const longest = lengths.indexOf(Math.max(...lengths));
    for (let step = 0; step < lines.length; step++) {
      const i = (longest + step) % lines.length,
        j = (i + 1) % lines.length;
      const a = lines[i]!.direction,
        b = lines[j]!.direction;
      if (Math.abs(a[0] * b[0] + a[1] * b[1]) > Math.sin((5 * Math.PI) / 180) + 1e-12) continue;
      const shorter = lengths[i]! < lengths[j]! ? i : j;
      const reference = lines[shorter === i ? j : i]!.direction;
      const current = lines[shorter]!.direction;
      const perpendicular: Point2 = [-reference[1], reference[0]];
      const sign = perpendicular[0] * current[0] + perpendicular[1] * current[1] >= 0 ? 1 : -1;
      lines[shorter]!.direction = [perpendicular[0] * sign, perpendicular[1] * sign];
    }
    return ringFromLines(lines);
  });
  if (snapped.some((ring) => ring === null)) return { polygon, rejected: true };
  const candidate = snapped as Polygon;
  const area = (rings: Polygon) =>
    rings.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * Math.abs(mapArea(ring)), 0);
  if (!validPolygon(candidate) || Math.abs(area(candidate) - area(polygon)) > 0.02 * area(polygon))
    return { polygon, rejected: true };
  return { polygon: candidate, rejected: false };
}
