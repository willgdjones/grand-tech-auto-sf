import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { packMapTransport } from '../src/pipeline/transport';
import { packRoadGraph } from '../src/pipeline/roadPack';
import { createHeightfield, encodeHeightfield } from '../src/pipeline/heightfield';
import { decodeHeightTransport, decodeRoadTransport } from '../../../shared/mapTransport';
import { decodeMapCollision } from '../../../shared/mapCollision';
import { digest } from '../src/pipeline/sources';
import { writeRuntimeInventory } from '../src/pipeline/runtime';
import type { Artifact, MapManifest } from '../src/pipeline/types';

it('converts an isolated manifest, pins exact restored source data and preserves untouched assets', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'gtasf-transport-')), source = join(temporary, 'source'), output = join(temporary, 'candidate');
  await mkdir(source);
  try {
    const graph = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: ['Source warning'] });
    const height = encodeHeightfield(createHeightfield([0, 0, 256, 256], { sample: (x, z) => x * .12 - z * .05 }, 128));
    const unchanged = new TextEncoder().encode('Unchanged source artifact');
    async function artifact(path: string, bytes: Uint8Array): Promise<Artifact> {
      await writeFile(join(source, path), bytes); return { path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: digest(bytes) };
    }
    const collisionSource = new TextEncoder().encode(JSON.stringify({ version: 1, origin: [0, 0, 0], buildings: [{
      id: 'source-footprint', minY: -1, maxY: 8.321, heightSource: 'datasf', rings: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
    }] }) + '\n');
    const lod = await artifact('lod.glb', unchanged), terrain = await artifact('terrain.bin', height), collision = await artifact('collision.json', collisionSource);
    const legacy = ['roadgraph-playable.json', 'roadgraph-local-play.json', 'local-play.json'].map(path => ({ path,
      bytes: new TextEncoder().encode(JSON.stringify({ version: 1, preserved: path, nodes: [], edges: [] }) + '\n') }));
    for (const file of legacy) await writeFile(join(source, file.path), file.bytes);
    const manifest = { version: 1, generator: 'fixture', area: 'sf', chunkSize: 256,
      roadGraph: { ...await artifact('roadgraph.bin', graph), encoding: 'roadpack-v1' },
      chunks: [{ id: '0_0', x: 0, z: 0, lods: [lod, lod], terrain, collision, triangles: [1, 1] }],
      stats: { gzipBytes: 0, budgetBytes: 25_000_000 }, sourceDigests: [{ key: 'survey', sha256: 'a'.repeat(64) }],
    } as MapManifest;
    const original = JSON.stringify(manifest); await writeFile(join(source, 'manifest.json'), original);
    await expect(packMapTransport(source, output, { enabled: false })).rejects.toThrow('explicitly');
    const converted = await packMapTransport(source, output, { enabled: true, collisions: true });
    expect(converted.requiredFeatures).toEqual(['compactMapAssets']); expect(converted.sourceDigests).toEqual(manifest.sourceDigests);
    expect(decodeRoadTransport(await readFile(join(output, 'roadgraph.bin')))).toEqual(graph);
    expect(decodeHeightTransport(await readFile(join(output, 'terrain.bin')))).toEqual(Uint8Array.from(height));
    expect(await readFile(join(output, 'lod.glb'))).toEqual(Buffer.from(unchanged));
    expect(JSON.stringify(decodeMapCollision(await readFile(join(output, 'collision.bin')))) + '\n').toBe(new TextDecoder().decode(collisionSource));
    expect(converted.chunks[0]!.collision.decodedSha256).toBe(collision.sha256);
    const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { files: Artifact[]; gzipBytes: number };
    for (const file of legacy) {
      expect(await readFile(join(output, file.path))).toEqual(Buffer.from(file.bytes));
      expect(converted.runtime?.[file.path]?.sha256).toBe(digest(file.bytes));
      expect(inventory.files.find(a => a.path === file.path)).toEqual(converted.runtime?.[file.path]);
    }
    expect(inventory.gzipBytes).toBe(inventory.files.reduce((sum, file) => sum + file.gzipBytes, 0));
    // A legacy 80 MB manifest must not turn a 30 MB map into a 25 MB pass.
    // These declared lengths exercise accounting, without allocating 30 MB.
    const legacyBudget = structuredClone(converted);
    legacyBudget.stats.budgetBytes = 80_000_000;
    legacyBudget.roadGraph.gzipBytes = 30_000_000;
    await writeRuntimeInventory(output, legacyBudget);
    const budget = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8'));
    expect(budget).toMatchObject({ mapBudgetBytes: 25_000_000, withinMapBudget: false,
      manifestBudgetBytes: 80_000_000, withinManifestBudget: true, productionBudgetBlocker: 'gtasf-zzpr' });
    expect(await readFile(join(source, 'manifest.json'), 'utf8')).toBe(original);
    await expect(packMapTransport(source, output, { enabled: true })).rejects.toThrow();
    await rm(join(source, 'local-play.json'));
    await expect(packMapTransport(source, join(temporary, 'partial'), { enabled: true })).rejects.toThrow('Incomplete legacy');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
