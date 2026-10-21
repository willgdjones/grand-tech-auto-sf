import { webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import { loadWorldRoads } from './worldRoads';
import { encodeRoadTransport } from '@gtasf/shared/mapTransport';

const compact = vi.hoisted(() => ({ enabled: false }));
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, get compactMapAssets() { return compact.enabled; } } };
});

it('requires an explicit valid key/hash pair and fails closed for missing, oversized or mismatched city data', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const data = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: [] });
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', data.slice().buffer)).toString('hex');
  const cancel = vi.fn(), get = vi.fn(async () => ({ size: data.byteLength, body: { cancel }, arrayBuffer: async () => data.buffer }));
  const env = { ASSETS: { get } as unknown as R2Bucket, WORLD_ROAD_GRAPH_KEY: 'maps/sf/hash/roadgraph.bin', WORLD_ROAD_GRAPH_SHA256: expected };
  expect(await loadWorldRoads({ ASSETS: env.ASSETS })).toBeUndefined(); expect(get).not.toHaveBeenCalled();
  expect((await loadWorldRoads(env))?.packed.counts.edges).toBe(0);
  await expect(loadWorldRoads({ ...env, WORLD_ROAD_GRAPH_SHA256: '0'.repeat(64) })).rejects.toThrow('WORLD_ROAD_GRAPH_HASH');
  await expect(loadWorldRoads({ ...env, WORLD_ROAD_GRAPH_KEY: undefined })).rejects.toThrow('WORLD_ROAD_GRAPH_CONFIG');
  get.mockResolvedValueOnce({ size: 25_000_001, body: { cancel }, arrayBuffer: async () => data.buffer });
  await expect(loadWorldRoads(env)).rejects.toThrow('WORLD_ROAD_GRAPH_SIZE'); expect(cancel).toHaveBeenCalledOnce();
  get.mockResolvedValueOnce(null as never);
  await expect(loadWorldRoads(env)).rejects.toThrow('WORLD_ROAD_GRAPH_MISSING');
  vi.unstubAllGlobals();
});

it('decodes the gzip-encoded object a map publication stores and pins the decoded hash (gtasf-u4al)', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const data = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: [] });
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', data.slice().buffer)).toString('hex');
  const compressed = gzipSync(data);
  const get = vi.fn(async () => ({ size: compressed.byteLength, httpMetadata: { contentEncoding: 'gzip' },
    body: new Response(new Uint8Array(compressed)).body!, arrayBuffer: async () => { throw new Error('read raw'); } }));
  const env = { ASSETS: { get } as unknown as R2Bucket, WORLD_ROAD_GRAPH_KEY: `map/releases/${'a'.repeat(64)}/roadgraph.bin`, WORLD_ROAD_GRAPH_SHA256: expected };
  expect((await loadWorldRoads(env))?.packed.counts.edges).toBe(0);
  vi.unstubAllGlobals();
});

it('follows a stable map manifest to its release-pinned graph, and falls back when unpublished (gtasf-u4al)', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const data = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: [] });
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', data.slice().buffer)).toString('hex');
  const graphKey = `map/releases/${'b'.repeat(64)}/roadgraph.bin`;
  const manifest = (path: string) => gzipSync(JSON.stringify({ roadGraph: { path: `/${path}`, encoding: 'roadpack-v1', sha256 } }));
  const objects = new Map<string, Buffer>([['map/lombard/manifest.json', manifest(graphKey)], [graphKey, gzipSync(data)]]);
  const ASSETS = { get: vi.fn(async (key: string) => { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength,
    httpMetadata: { contentEncoding: 'gzip' }, body: new Response(new Uint8Array(bytes)).body! } : null; }) } as unknown as R2Bucket;
  expect((await loadWorldRoads({ ASSETS, WORLD_ROAD_GRAPH_KEY: 'map/lombard/manifest.json' }))?.packed.counts.edges).toBe(0);
  expect(await loadWorldRoads({ ASSETS, WORLD_ROAD_GRAPH_KEY: 'map/sf/manifest.json' })).toBeUndefined();
  objects.set('map/lombard/manifest.json', manifest('chunks/0_0/lod0.glb'));
  await expect(loadWorldRoads({ ASSETS, WORLD_ROAD_GRAPH_KEY: 'map/lombard/manifest.json' })).rejects.toThrow('WORLD_ROAD_GRAPH_MANIFEST');
  vi.unstubAllGlobals();
});

it('keeps the new map off by default and restores the same pinned packed graph when explicitly enabled', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: ['Retained survey metadata'] });
  const encoded = encodeRoadTransport(source);
  const hash = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)).toString('hex');
  const key = `map/releases/${'c'.repeat(64)}/roadgraph.bin`, manifest = { requiredFeatures: ['compactMapAssets'], roadGraph: {
    path: `/${key}`, encoding: 'roadpack-v1', sha256: await hash(encoded), transport: 'predictive-v1', decodedBytes: source.length, decodedSha256: await hash(source),
  } };
  const ASSETS = { get: async (path: string) => {
    const bytes = path === key ? encoded : new TextEncoder().encode(JSON.stringify(manifest));
    return { size: bytes.length, arrayBuffer: async () => bytes.buffer };
  } } as unknown as R2Bucket;
  const env = { ASSETS, WORLD_ROAD_GRAPH_KEY: 'map/lombard/manifest.json' };
  try {
    await expect(loadWorldRoads(env)).rejects.toThrow('COMPACT_MAP_ASSETS_DISABLED');
    compact.enabled = true;
    const loaded = await loadWorldRoads(env);
    expect(loaded?.packed.bytes).toEqual(source);
    manifest.roadGraph.decodedSha256 = '0'.repeat(64);
    await expect(loadWorldRoads(env)).rejects.toThrow('MAP_TRANSPORT_HASH');
  } finally { compact.enabled = false; vi.unstubAllGlobals(); }
});
