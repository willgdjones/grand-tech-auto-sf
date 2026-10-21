import { decodePackedRoadGraph, ROAD_PACK_MAX_BYTES } from '@gtasf/shared/roadgraphPacked';
import { flags } from '@gtasf/shared/flags';
import { restoreMapArtifact, type TransportMetadata } from '@gtasf/shared/mapTransport';
import { PackedRoads } from './packedRoads';

export interface WorldRoadsEnv { ASSETS: R2Bucket; WORLD_ROAD_GRAPH_KEY?: string; WORLD_ROAD_GRAPH_SHA256?: string }
const PUBLISHED_GRAPH = /^map\/releases\/[a-f0-9]{64}\/roadgraph\.bin$/;
async function body(object: R2ObjectBody): Promise<ArrayBuffer> {
  // Map publications store every object gzip-encoded (publication.ts), so published keys arrive compressed.
  return object.httpMetadata?.contentEncoding === 'gzip'
    ? new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : object.arrayBuffer();
}

/** An explicit immutable key/hash pairs server routes with the browser's published map. A key naming a
 *  stable map manifest (e.g. map/lombard/manifest.json, no hash) follows that manifest's release-pinned
 *  roadGraph + sha256 — exactly the graph browsers load — so production needs no per-release config
 *  (citywide robotaxi routing, gtasf-u4al). A missing manifest resolves to undefined (embedded corridor). */
export async function loadWorldRoads(env: WorldRoadsEnv, transport: TransportMetadata = {}): Promise<PackedRoads | undefined> {
  const key = env.WORLD_ROAD_GRAPH_KEY, expected = env.WORLD_ROAD_GRAPH_SHA256;
  if (!key && !expected) return;
  if (key && !expected && /^map\/[a-z0-9-]+\/manifest\.json$/.test(key)) {
    const object = await env.ASSETS.get(key);
    if (!object) return;
    const manifest = JSON.parse(new TextDecoder().decode(await body(object))) as { requiredFeatures?: string[]; roadGraph?: TransportMetadata & { path?: string; encoding?: string; sha256?: string } };
    if (manifest.requiredFeatures?.some(feature => feature !== 'compactMapAssets' || !flags.compactMapAssets)) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
    const graph = manifest.roadGraph;
    const path = graph?.path?.replace(/^\//, '');
    if (!path || !PUBLISHED_GRAPH.test(path) || graph?.encoding !== 'roadpack-v1' || !graph.sha256) throw new Error('WORLD_ROAD_GRAPH_MANIFEST');
    return loadWorldRoads({ ASSETS: env.ASSETS, WORLD_ROAD_GRAPH_KEY: path, WORLD_ROAD_GRAPH_SHA256: graph.sha256 }, graph);
  }
  if (!key || !expected || !/^[a-f0-9]{64}$/.test(expected) || !key.endsWith('.bin') || key.includes('..')) throw new Error('WORLD_ROAD_GRAPH_CONFIG');
  const object = await env.ASSETS.get(key);
  if (!object) throw new Error('WORLD_ROAD_GRAPH_MISSING');
  if (object.size > ROAD_PACK_MAX_BYTES) { await object.body.cancel(); throw new Error('WORLD_ROAD_GRAPH_SIZE'); }
  const bytes = await body(object); // the hash pins the decoded roadpack bytes
  if (bytes.byteLength > ROAD_PACK_MAX_BYTES) throw new Error('WORLD_ROAD_GRAPH_SIZE');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error('WORLD_ROAD_GRAPH_HASH');
  const restored = await restoreMapArtifact(bytes, transport, 'road', flags.compactMapAssets);
  return new PackedRoads(decodePackedRoadGraph(restored));
}
