import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePackedRoadGraph, ROAD_EDGE_FLAGS } from '../../shared/roadgraphPacked';
import { decodeHeightfield, sampleHeight, type Heightfield } from '../../web/src/render/chunks/terrain';
import type { RoadEdge } from '../../shared/roadgraph';

interface Artifact { path: string; sha256: string }
interface Manifest { chunkSize: number; roadGraph: Artifact & { encoding?: string }; chunks: { x: number; z: number; terrain: Artifact }[] }
type SurfaceRoad = RoadEdge & { tunnel?: boolean; layer?: number };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Rail heading disambiguates a bridge from the crossing street below it. */
export function createCableRoadSampler(edges: readonly SurfaceRoad[]) {
  type Segment = { a: readonly number[]; dx: number; dy: number; dz: number; length2: number };
  const cells = new Map<string, Segment[]>(), cellSize = 32, radius = 3.5;
  for (const edge of edges) {
    if (edge.tunnel || (edge.layer ?? 0) < 0) continue;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!;
      const dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
      if (length2 < .0001) continue;
      const segment = { a, dx, dy: b[1] - a[1], dz, length2 };
      for (let x = Math.floor((Math.min(a[0], b[0]) - radius) / cellSize); x <= Math.floor((Math.max(a[0], b[0]) + radius) / cellSize); x++) {
        for (let z = Math.floor((Math.min(a[2], b[2]) - radius) / cellSize); z <= Math.floor((Math.max(a[2], b[2]) + radius) / cellSize); z++) {
          const key = `${x}_${z}`, list = cells.get(key) ?? [];
          list.push(segment); cells.set(key, list);
        }
      }
    }
  }
  return (x: number, z: number, railDx: number, railDz: number): number | null => {
    const railLength = Math.hypot(railDx, railDz);
    if (!railLength) return null;
    let best = Infinity, height: number | null = null;
    for (const segment of cells.get(`${Math.floor(x / cellSize)}_${Math.floor(z / cellSize)}`) ?? []) {
      const { a, dx, dy, dz, length2 } = segment;
      const alignment = Math.abs(dx * railDx + dz * railDz) / Math.sqrt(length2) / railLength;
      if (alignment < .65) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[2]!) * dz) / length2));
      const distance2 = (x - a[0]! - dx * t) ** 2 + (z - a[2]! - dz * t) ** 2;
      if (distance2 > radius * radius) continue;
      const score = distance2 + 2 * (1 - alignment);
      if (score < best) { best = score; height = a[1]! + dy * t; }
    }
    return height;
  };
}

/** Offline surface profile uses the same road levels and carved heightfields as the client. */
export async function loadCableGround(directory: string, bounds: readonly [number, number, number, number]) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Manifest;
  assert.equal(manifest.roadGraph.encoding, 'roadpack-v1', 'Cable surface requires the packed city graph');
  const graphBytes = await readFile(join(directory, manifest.roadGraph.path));
  assert.equal(sha(graphBytes), manifest.roadGraph.sha256, 'Verified cable surface road graph');
  const packed = decodePackedRoadGraph(graphBytes), edges: RoadEdge[] = [];
  for (let i = 0; i < packed.counts.edges; i++) {
    // All three cable routes are surface rail. A road tunnel below the tracks
    // must never become the cable deck, even within the general car level filter.
    if (packed.columns.edgeFlags[i]! & ROAD_EDGE_FLAGS.tunnel || packed.columns.edgeLayer[i]! < 0) continue;
    const points = packed.edgePoints(i);
    if (points.some(p => p[0] >= bounds[0] - 32 && p[0] <= bounds[2] + 32 && p[2] >= bounds[1] - 32 && p[2] <= bounds[3] + 32)) edges.push(packed.edge(i));
  }
  const road = createCableRoadSampler(edges), fields = new Map<string, Heightfield>();
  const sources: { path: string; sha256: string }[] = [];
  for (const chunk of manifest.chunks) {
    if ((chunk.x + 1) * manifest.chunkSize < bounds[0] || chunk.x * manifest.chunkSize > bounds[2]
      || (chunk.z + 1) * manifest.chunkSize < bounds[1] || chunk.z * manifest.chunkSize > bounds[3]) continue;
    const bytes = await readFile(join(directory, chunk.terrain.path));
    assert.equal(sha(bytes), chunk.terrain.sha256, `Verified cable surface ${chunk.terrain.path}`);
    fields.set(`${chunk.x}_${chunk.z}`, decodeHeightfield(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    sources.push(chunk.terrain);
  }
  return {
    provenance: { roadGraphSha256: manifest.roadGraph.sha256, terrain: sources },
    sample(x: number, z: number, railDx: number, railDz: number): number {
      const onRoad = road(x, z, railDx, railDz);
      if (onRoad !== null) return onRoad;
      const field = fields.get(`${Math.floor(x / manifest.chunkSize)}_${Math.floor(z / manifest.chunkSize)}`);
      assert(field, `Cable surface chunk at ${x},${z}`);
      const ground = sampleHeight(field, x, z);
      assert(ground !== null, `Cable surface height at ${x},${z}`);
      return ground + .12;
    },
  };
}
