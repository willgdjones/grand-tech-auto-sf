import type { Point2 } from '../geo';
import { mapArea } from '../geo';
import { distance, openRing } from './rings';

export interface FacadeEdge {
  k: number;
  edgeIndex: number;
  start: Point2;
  end: Point2;
  length: number;
  outwardNormal: [number, number, number];
}

/** Input is a cleaned exterior: CCW on the (x,-z) map. k skips edges shorter than 6 m. */
export function facadeEdgeOrder(footprint: readonly Point2[]): FacadeEdge[] {
  const points = openRing(footprint);
  if (points.length < 3 || mapArea(points) <= 0) throw new Error('FACADE_CCW_FOOTPRINT_REQUIRED');
  const qualified = points.flatMap((start, edgeIndex) => {
    const end = points[(edgeIndex + 1) % points.length]!;
    const length = distance(start, end);
    if (length < 6) return [];
    const outwardNormal: [number, number, number] = [
      -(end[1] - start[1]) / length,
      0,
      (end[0] - start[0]) / length,
    ];
    return [{ k: 0, edgeIndex, start, end, length, outwardNormal }];
  });
  if (!qualified.length) return [];
  const bestDot = Math.max(...qualified.map((edge) => -edge.outwardNormal[2]));
  let north = qualified.findIndex((edge) => bestDot + edge.outwardNormal[2] <= 1e-9);
  for (let i = 0; i < qualified.length; i++) {
    const a = qualified[i]!,
      b = qualified[north]!;
    if (bestDot + a.outwardNormal[2] > 1e-9) continue;
    const az = (a.start[1] + a.end[1]) / 2,
      bz = (b.start[1] + b.end[1]) / 2;
    const ax = (a.start[0] + a.end[0]) / 2,
      bx = (b.start[0] + b.end[0]) / 2;
    if (az < bz || (az === bz && ax < bx)) north = i;
  }
  return [...qualified.slice(north), ...qualified.slice(0, north)].map((edge, k) => ({ ...edge, k }));
}

export function facadeFrame(footprint: readonly Point2[], k: number, baseY: number) {
  const edge = facadeEdgeOrder(footprint)[k];
  if (!Number.isInteger(k) || !edge || !Number.isFinite(baseY)) throw new Error(`FACADE_INVALID_FRAME(${k})`);
  return {
    ...edge,
    normal: edge.outwardNormal,
    origin: [edge.start[0], baseY, edge.start[1]] as [number, number, number],
    sAxis: [(edge.end[0] - edge.start[0]) / edge.length, 0, (edge.end[1] - edge.start[1]) / edge.length] as [
      number,
      number,
      number,
    ],
    tAxis: [0, 1, 0] as [number, number, number],
  };
}
