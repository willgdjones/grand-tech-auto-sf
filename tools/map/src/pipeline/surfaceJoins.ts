import type { XYZ } from './types';

/** Existing mesh arrays are read only: joins never alter road/contact heights. */
export interface JoinSurface {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  colours: ArrayLike<number>;
}
export interface SurfaceJoinTriangle { points: [XYZ, XYZ, XYZ]; colour: [number, number, number] }
interface Edge { a: XYZ; b: XYZ; count: number; road: boolean; colour: [number, number, number] }
export interface SurfaceJoinResult { triangles: SurfaceJoinTriangle[]; joinedPairs: number; rejectedWidePairs: number }
const key = (p: XYZ) => p.map(n => n.toFixed(5)).join(',');
const interpolate = (a: XYZ, b: XYZ, t: number): XYZ => a.map((n, i) => n + (b[i]! - n) * t) as XYZ;

/** Seal narrow road/ground and junction cracks with faces between their
 * actual existing edges. The 0.5m cap excludes bridge decks/tunnel levels. Both
 * windings match the existing opaque, front-sided road material contract.
 */
export function createSurfaceJoins(terrain: JoinSurface, roads: JoinSurface): SurfaceJoinResult {
  function boundaries(surface: JoinSurface, road: boolean): Edge[] {
    const edges = new Map<string, Edge>();
    const point = (i: number): XYZ => [surface.positions[i * 3]!, surface.positions[i * 3 + 1]!, surface.positions[i * 3 + 2]!];
    for (let t = 0; t < surface.indices.length; t += 3) {
      const first = surface.indices[t]!, points = [point(first), point(surface.indices[t + 1]!), point(surface.indices[t + 2]!)];
      const [p, q, r] = points as [XYZ, XYZ, XYZ];
      const u = q.map((n, axis) => n - p[axis]!), v = r.map((n, axis) => n - p[axis]!);
      // Quantization can collapse a clipped triangle onto an exterior edge.
      // Counting that zero-area face adds the edge twice and hides the real
      // boundary (Potrero road face 288). Keep original data; skip only its vote.
      if (Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) < 1e-8) continue;
      const colour = [surface.colours[first * 3]! / 255, surface.colours[first * 3 + 1]! / 255, surface.colours[first * 3 + 2]! / 255] as [number, number, number];
      for (let i = 0; i < 3; i++) {
        const a = points[i]!, b = points[(i + 1) % 3]!, id = [key(a), key(b)].sort().join('|'), edge = edges.get(id);
        if (edge) edge.count++;
        else edges.set(id, { a, b, colour, road, count: 1 });
      }
    }
    return [...edges.values()].filter(e => e.count === 1 && Math.hypot(e.a[0] - e.b[0], e.a[2] - e.b[2]) > .05);
  }
  const edges = [...boundaries(roads, true), ...boundaries(terrain, false)];
  function cells(edge: Edge): string[] {
    const result: string[] = [];
    for (let x = Math.floor((Math.min(edge.a[0], edge.b[0]) - .02) / 16); x <= Math.floor((Math.max(edge.a[0], edge.b[0]) + .02) / 16); x++)
      for (let z = Math.floor((Math.min(edge.a[2], edge.b[2]) - .02) / 16); z <= Math.floor((Math.max(edge.a[2], edge.b[2]) + .02) / 16); z++) result.push(`${x},${z}`);
    return result;
  }
  const grid = new Map<string, number[]>();
  edges.forEach((edge, i) => { for (const cell of cells(edge)) { const list = grid.get(cell) ?? []; list.push(i); grid.set(cell, list); } });
  const result: SurfaceJoinResult = { triangles: [], joinedPairs: 0, rejectedWidePairs: 0 }, seen = new Set<string>();
  edges.forEach((a, i) => {
    if (!a.road) return;
    const dx = a.b[0] - a.a[0], dz = a.b[2] - a.a[2], length = Math.hypot(dx, dz);
    const along = (p: XYZ) => ((p[0] - a.a[0]) * dx + (p[2] - a.a[2]) * dz) / (length * length);
    const perpendicular = (p: XYZ) => Math.abs((p[0] - a.a[0]) * dz - (p[2] - a.a[2]) * dx) / length;
    for (const j of new Set(cells(a).flatMap(cell => grid.get(cell) ?? []))) {
      if (i === j) continue;
      const pair = [i, j].sort((n, m) => n - m).join(','); if (seen.has(pair)) continue; seen.add(pair);
      const b = edges[j]!;
      // Shared quantization/rounding can move a border a few millimetres in XZ.
      if (perpendicular(b.a) > .02 || perpendicular(b.b) > .02) continue;
      const b0 = along(b.a), b1 = along(b.b), from = Math.max(0, Math.min(b0, b1)), to = Math.min(1, Math.max(b0, b1));
      if ((to - from) * length < .05 || Math.abs(b1 - b0) < 1e-8) continue;
      const onA = (t: number) => interpolate(a.a, a.b, t), onB = (t: number) => interpolate(b.a, b.b, (t - b0) / (b1 - b0));
      const firstGap = onA(from)[1] - onB(from)[1], lastGap = onA(to)[1] - onB(to)[1];
      const gap = Math.max(Math.abs(firstGap), Math.abs(lastGap));
      // Independently quantized clipped edges can have almost equal heights
      // but still leave a millimetre-wide opening in XZ (Columbus roads).
      if (gap < .005 && Math.max(perpendicular(b.a), perpendicular(b.b)) < 1e-5) continue;
      if (gap > .5) { result.rejectedWidePairs++; continue; }
      const appendFace = (points: [XYZ, XYZ, XYZ]) => {
        const u = points[1].map((n, axis) => n - points[0][axis]!), v = points[2].map((n, axis) => n - points[0][axis]!);
        if (Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) < 1e-8) return;
        result.triangles.push({ points, colour: a.colour }, { points: [points[2], points[1], points[0]], colour: a.colour });
      };
      // A projected endpoint can round onto its opposite edge when the GLB
      // reuses the source Int16 grid. For almost-coplanar, non-crossing edges,
      // retain the original endpoints instead: the thin cap then survives
      // encoding. Bound the extrapolated height across both whole edges too.
      const side = (p: XYZ) => (p[0] - a.a[0]) * dz - (p[2] - a.a[2]) * dx;
      const wholeGap = Math.max(Math.abs(onA(b0)[1] - b.a[1]), Math.abs(onA(b1)[1] - b.b[1]),
        Math.abs(onB(0)[1] - a.a[1]), Math.abs(onB(1)[1] - a.b[1]));
      if (gap < .005 && wholeGap < .005 && side(b.a) * side(b.b) >= -1e-12) {
        const low = b0 < b1 ? b.a : b.b, high = b0 < b1 ? b.b : b.a;
        appendFace([a.a, low, high]); appendFace([a.a, high, a.b]);
        result.joinedPairs++; continue;
      }
      const breaks = firstGap * lastGap < 0 ? [from, from + (to - from) * firstGap / (firstGap - lastGap), to] : [from, to];
      for (let k = 1; k < breaks.length; k++) {
        const a0 = onA(breaks[k - 1]!), a1 = onA(breaks[k]!), b0p = onB(breaks[k - 1]!), b1p = onB(breaks[k]!);
        for (const points of [[a0, b0p, b1p], [a0, b1p, a1]] as [XYZ, XYZ, XYZ][]) {
          appendFace(points);
        }
      }
      result.joinedPairs++;
    }
  });
  return result;
}
