import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { strongGzip } from '../pipeline/strongGzip';
import { decodePackedRoadGraph, unpackRoadGraph, type PackedPublicRoadGraph } from '../../../../shared/roadgraphPacked';
import { decodeRoadTransport, encodeRoadTransport, MAP_TRANSPORT } from '../../../../shared/mapTransport';
import { packRoadGraph } from '../pipeline/roadPack';
import { atomicWrite, digest } from '../pipeline/sources';
import type { Artifact } from '../pipeline/types';

/** A circle (world metres, +x east / -z north) whose roads the near-spawn graph must contain. [gtasf-0k01] */
export interface NearCentre { id: string; x: number; z: number; radiusM: number }
export const NEAR_GRAPH_PATH = 'roadgraph-near.bin';
type NearFile = Artifact & { encoding: 'roadpack-v1'; transport?: string; decodedBytes?: number; decodedSha256?: string };
/** One spawn centre's own subset (roadgraph-near-<id>.bin): a phone downloads only the circle it spawns in. */
export type NearGraphPart = NearFile & { id: string };
export type NearGraphArtifact = NearFile & { sourceSha256: string; coverage: NearCentre[]; parts?: NearGraphPart[] };

function segmentDistanceSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq)) : 0;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return x * x + z * z;
}
/** True when any segment of the polyline passes within a centre's radius (sparse long edges still count). */
export function edgeNearAny(points: readonly (readonly [number, number, number])[], centres: readonly NearCentre[]): boolean {
  for (const c of centres) {
    const r2 = c.radiusM * c.radiusM;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[Math.min(i + 1, points.length - 1)]!;
      if (segmentDistanceSq(c.x, c.z, a[0], a[2], b[0], b[2]) <= r2) return true;
    }
  }
  return false;
}
/**
 * GTRP v1 indices (node/edge/string/next) are file-local, so a subset is a fresh pack of the kept
 * edges, their endpoint nodes and only the `next` successors that survived. Node/edge IDs and every
 * per-edge attribute (routable, bridge, tunnel, layer...) are preserved, so the same decoder reads it
 * and IDs match the full graph when it is swapped in after READY.
 */
export function selectNearRoadGraph(graph: PackedPublicRoadGraph, centres: readonly NearCentre[]): PackedPublicRoadGraph {
  const edges = graph.edges.filter(edge => edgeNearAny(edge.points, centres));
  const kept = new Set(edges.map(edge => edge.id)), nodeIds = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  return { version: 1, warnings: [], nodes: graph.nodes.filter(node => nodeIds.has(node.id)),
    edges: edges.map(edge => edge.next === undefined ? edge : { ...edge, next: edge.next.filter(id => kept.has(id)) }) };
}
export function nearRoadGraphBytes(source: Uint8Array, centres: readonly NearCentre[]): Uint8Array {
  return packRoadGraph(selectNearRoadGraph(unpackRoadGraph(decodePackedRoadGraph(source)), centres));
}
export const nearPartPath = (id: string) => `roadgraph-near-${id.replace(/[^a-z0-9-]/gi, '_')}.bin`;

/**
 * Post-process an existing bake/publication root (no rebake): reads manifest.roadGraph, writes
 * roadgraph-near.bin + .gz beside it (mirroring the source's predictive transport, if any) and adds
 * manifest.roadGraphNear so preparePublication uploads it with the release.
 *
 * `union` (MAP_NEAR_UNION bake option, gtasf-tdbw): replace the 50 overlapping per-centre parts with
 * ONE citywide first-load graph — roadgraph-near.bin holds every centre's roads deduped, and no `parts`
 * are emitted. This removes the published inter-part overlap (~9 MB of parts → ~5 MB union; one shared
 * object instead of 50), so the whole-city payload fits closer to 80 MB without raising the budget. The
 * client already handles a parts-less manifest (web/src/render/chunks/world.ts:44 `near.parts ? … : near`
 * loads the combined file for any in-coverage spawn); IDs/attributes are preserved so the post-READY
 * swap to the full graph is unchanged. Trade-off: every in-coverage session downloads the ~5 MB union on
 * first load instead of its own ~0.6 MB circle — a budget-vs-first-load lever, so it is OFF by default.
 */
export async function writeNearRoadGraph(root: string, centres: readonly NearCentre[], options: { union?: boolean } = {}): Promise<NearGraphArtifact> {
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { roadGraph: Artifact & { encoding?: string; transport?: string }; roadGraphNear?: NearGraphArtifact };
  if (manifest.roadGraph.encoding !== 'roadpack-v1') throw new Error('Near graph needs a roadpack-v1 manifest.roadGraph');
  const stored = await readFile(join(root, manifest.roadGraph.path));
  if (digest(stored) !== manifest.roadGraph.sha256) throw new Error('roadgraph.bin does not match its manifest');
  const transport = manifest.roadGraph.transport;
  if (transport && transport !== MAP_TRANSPORT) throw new Error(`Unsupported road transport ${transport}`);
  const source = transport ? decodeRoadTransport(stored) : stored;
  const full = unpackRoadGraph(decodePackedRoadGraph(source));
  async function write(path: string, decoded: Uint8Array): Promise<NearFile> {
    const raw = transport ? encodeRoadTransport(decoded) : decoded, compressed = strongGzip(raw); // gtasf-7vt00: stronger standard deflate for road graphs
    await atomicWrite(join(root, path), raw);
    await atomicWrite(join(root, `${path}.gz`), compressed);
    return { path, encoding: 'roadpack-v1', bytes: raw.length, gzipBytes: compressed.length, sha256: digest(raw),
      ...(transport ? { transport, decodedBytes: decoded.length, decodedSha256: digest(decoded) } : {}) };
  }
  // Default: clients load the part for their spawn circle, so the combined single file only needs to
  // stay a valid artifact — it holds the first (default, Ferry) centre instead of every circle.
  // Union: the combined file holds EVERY centre's roads deduped (one citywide first-load graph), and no
  // per-centre parts are written, so the publication carries one near object instead of 50 overlapping ones.
  const combined = await write(NEAR_GRAPH_PATH, packRoadGraph(selectNearRoadGraph(full, options.union ? centres : centres.slice(0, 1))));
  // Per-centre parts: the Ferry's 1.5 km is ~0.6 MB gz vs ~3.6 MB for every centre combined. [gtasf-0k01]
  const parts: NearGraphPart[] = [];
  if (!options.union) for (const centre of centres) parts.push({ id: centre.id, ...await write(nearPartPath(centre.id), packRoadGraph(selectNearRoadGraph(full, [centre]))) });
  // Union omits `parts` entirely (undefined, not []): the client's `near.parts ? … : near` falls to the
  // combined union only when `parts` is absent — an empty array would skip the near graph to the full one.
  const artifact: NearGraphArtifact = { ...combined,
    sourceSha256: manifest.roadGraph.sha256, coverage: centres.map(c => ({ id: c.id, x: Math.round(c.x * 100) / 100, z: Math.round(c.z * 100) / 100, radiusM: c.radiusM })),
    ...(options.union ? {} : { parts }) };
  manifest.roadGraphNear = artifact;
  const text = JSON.stringify(manifest, null, 2) + '\n';
  await atomicWrite(manifestPath, text); await atomicWrite(`${manifestPath}.gz`, gzipSync(text, { level: 9 }));
  return artifact;
}
