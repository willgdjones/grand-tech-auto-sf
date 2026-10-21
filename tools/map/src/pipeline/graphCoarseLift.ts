import { pathLength } from './roads';
import type { Bounds, HeightSampler, RoadGraph } from './types';

/**
 * gtasf-8mjjf: on COARSE chunks (no detail corridor, no district street detail) `addRoadMeshes` draws each surface road at
 * max(carved terrain, the uncut 32 m ground plane) + 0.1 m (MAP_COARSE_ROAD_LIFT, meshes.ts `uncutGround`), so it is not
 * buried under the coarse ground. The road graph kept the carved height (terrain + 0.1 m), so on hills where the 32 m plane
 * rises above the carved street the drawn road sat up to ~7 m above the graph: players (foot.y, server poses) were buried
 * under the street they see (14th Ave, Koret Way, Crestmont, Stanyan). Apply the SAME lift to the graph's at-grade points and
 * nodes on coarse chunks, so the graph is the drawn road. Grade-separated edges (bridge, tunnel, layer != 0) and nodes they
 * touch are left alone. Returns the number of points raised and the largest raise (m).
 */
export function liftGraphToCoarseRoads(graph: RoadGraph, terrain: HeightSampler, coarseAt: (x: number, z: number) => boolean, step = 32, taperM = 15, quantM = 0.1): { points: number; nodes: number; maxRaise: number } {
  const groundAt = (x: number, z: number) => Math.round(terrain.sample(x, z) * 100) / 100;
  // Identical to meshes.ts uncutGround: the cell triangulates on its (x, z+s)-(x+s, z) diagonal.
  const drawn = (x: number, z: number) => {
    const i = Math.floor(x / step), j = Math.floor(z / step), u = x / step - i, v = z / step - j;
    const a = groundAt(i * step, j * step), b = groundAt((i + 1) * step, j * step), c = groundAt(i * step, (j + 1) * step), d = groundAt((i + 1) * step, (j + 1) * step);
    return Math.max(terrain.sample(x, z), u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d)) + 0.1;
  };
  return liftGraph(graph, (x, z) => coarseAt(x, z) ? drawn(x, z) : null, taperM, quantM);
}

/** The lift itself, shared by the bake and tools/map/roadgraph-coarse-lift-preview.mts: `drawnAt` = the drawn surface-road
 *  height at (x, z) on a coarse chunk, or null elsewhere. Taper at grade-separated nodes, nodes follow their edges,
 *  lengthM recomputed. Mutates `graph`. */
export function liftGraph(graph: Pick<RoadGraph, 'nodes' | 'edges'>, drawnAt: (x: number, z: number) => number | null, taperM = 15, quantM = 0.01): { points: number; nodes: number; maxRaise: number } {
  const round = (n: number) => Math.round(n * 100) / 100, quant = (n: number) => round(Math.round(n / quantM) * quantM);
  const separated = new Set<string>();
  for (const e of graph.edges) if (e.bridge || e.tunnel || e.layer !== 0) { separated.add(e.from); separated.add(e.to); }
  let points = 0, nodes = 0, maxRaise = 0; const touched = new Set<RoadGraph['edges'][number]>();
  for (const e of graph.edges) {
    if (e.bridge || e.tunnel || e.layer !== 0) continue;
    // Junction step (reviewer): a node shared with a grade-separated edge (ramp, bridge) is not lifted, so taper the lift
    // from 0 at such an end to full over the first taperM metres of the edge (horizontal distance along the path).
    const along: number[] = [0];
    for (let i = 1; i < e.points.length; i++) along.push(along[i - 1]! + Math.hypot(e.points[i]![0] - e.points[i - 1]![0], e.points[i]![2] - e.points[i - 1]![2]));
    const total = along[along.length - 1]!, fromSep = separated.has(e.from), toSep = separated.has(e.to);
    let changed = false;
    e.points.forEach((p, i) => {
      const target = drawnAt(p[0], p[2]); if (target === null) return;
      const weight = Math.min(1, fromSep ? along[i]! / taperM : 1, toSep ? (total - along[i]!) / taperM : 1);
      if (weight <= 0) return;
      // quantM: lifted heights on a coarser step compress better (graph gz vs the 87 MB budget); unlifted points keep cm.
      const y = quant(p[1] + (target - p[1]) * weight);
      if (y > p[1] + 0.005) { maxRaise = Math.max(maxRaise, y - p[1]); p[1] = y; points++; changed = true; }
    });
    if (changed) touched.add(e);
  }
  // Nodes follow their edges: a short edge next to a separated node is only partly lifted at its far end, so an
  // independently lifted node would leave a step there. Each ordinary node takes the LOWEST lifted end of its at-grade
  // edges, and every one of those ends snaps to it, so all edges meet exactly at every junction.
  const ends = new Map<string, number[][]>();
  for (const e of graph.edges) { if (e.bridge || e.tunnel || e.layer !== 0) continue;
    for (const [id, p] of [[e.from, e.points[0]!], [e.to, e.points[e.points.length - 1]!]] as const) { const l = ends.get(id) ?? []; l.push(p as number[]); ends.set(id, l); } }
  const byId = new Map(graph.edges.map(e => [e.id, e]));
  for (const n of graph.nodes) {
    const list = ends.get(n.id); if (separated.has(n.id) || !list?.length) continue;
    const y = Math.min(...list.map(p => p[1]!)); if (y > n.y + 0.005) { n.y = y; nodes++; }
    for (const p of list) if (p[1] !== n.y) p[1] = n.y;
  }
  for (const e of graph.edges) if (!e.bridge && !e.tunnel && e.layer === 0 && (ends.get(e.from) || ends.get(e.to))) touched.add(byId.get(e.id)!);
  // lengthM feeds routing costs and street parking (lane A review): recompute it from the lifted 3D path exactly as
  // roadgraph.ts does (lanes ceil to mm; connectors also floor at 1 mm).
  for (const e of touched) { const length = Math.ceil(pathLength(e.points) * 1000) / 1000; e.lengthM = e.kind === 'connector' ? Math.max(0.001, length) : length; }
  return { points, nodes, maxRaise: round(maxRaise) };
}

/** The chunk-level coarse test build.ts uses when it writes chunks (kept beside the lift so the two cannot drift). */
export function coarseChunkTest(chunkSize: number, detailBounds: Bounds | undefined, hasDistrictDetail: (b: Bounds) => boolean): (x: number, z: number) => boolean {
  const overlaps = (a: Bounds, b: Bounds) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  return (x, z) => {
    const cx = Math.floor(x / chunkSize) * chunkSize, cz = Math.floor(z / chunkSize) * chunkSize, bounds: Bounds = [cx, cz, cx + chunkSize, cz + chunkSize];
    const detailed = !detailBounds || overlaps([cx + 0.001, cz + 0.001, cx + chunkSize - 0.001, cz + chunkSize - 0.001], detailBounds);
    const streetDetail = !detailed && hasDistrictDetail(bounds) && process.env.MAP_DISTRICT_STREETS !== '0';
    return !detailed && !streetDetail && process.env.MAP_COARSE_ROAD_LIFT !== '0';
  };
}

/** MAP_GRAPH_HEIGHT_QUANT (gtasf-8mjjf, 87 MB budget): round EVERY graph height to `step` metres (0.1 -> at most 5 cm off,
 *  heights still interpolate linearly between points ~3 m apart). Coarser heights compress much better: with the coarse lift
 *  the 52 graph files go from +339 KB (cm) to -35 KB vs the unlifted cm graph. lengthM recomputed for every edge. */
export function quantizeGraphHeights(graph: Pick<RoadGraph, 'nodes' | 'edges'>, step: number): void {
  if (!(step > 0)) return;
  const q = (n: number) => Math.round(Math.round(n / step) * step * 100) / 100;
  for (const n of graph.nodes) n.y = q(n.y);
  for (const e of graph.edges) {
    for (const p of e.points) p[1] = q(p[1]);
    const length = Math.ceil(pathLength(e.points) * 1000) / 1000; e.lengthM = e.kind === 'connector' ? Math.max(0.001, length) : length;
  }
}
