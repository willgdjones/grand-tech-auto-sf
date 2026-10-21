import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePackedRoadGraph, unpackRoadGraph, type PackedPublicRoadGraph } from '../../../shared/roadgraphPacked';
import { nearRoadGraphBytes, selectNearRoadGraph, writeNearRoadGraph } from '../src/pack/roadgraphNear';
import { packRoadGraph } from '../src/pipeline/roadPack';
import { digest } from '../src/pipeline/sources';

const node = (id: string, x: number, z = 0) => ({ id, x, y: 1, z, osmNode: `osm-${id}` });
const edge = (id: string, from: [string, number], to: [string, number], extra: object = {}) => ({ id, from: from[0], to: to[0], lengthM: Math.abs(to[1] - from[1]),
  speedMps: 10, lane: 0, points: [[from[1], 1, 0], [to[1], 1, 0]] as [number, number, number][], kind: 'lane' as const, osmWay: 7, name: `${id} St`,
  inferredLanes: false, layer: 0, bridge: false, tunnel: false, routable: true, ...extra });
// a(0) - b(100) - c(1000) - d(5000); one long sparse edge e(-3000) -> f(3000) passes through the origin.
const graph: PackedPublicRoadGraph = { version: 1, warnings: ['w'],
  nodes: [node('a', 0), node('b', 100), node('c', 1000), node('d', 5000), node('e', -3000, 50), node('f', 3000, 50)],
  edges: [edge('ab', ['a', 0], ['b', 100], { next: ['bc'] }), edge('bc', ['b', 100], ['c', 1000], { next: ['cd'], routable: false }),
    edge('cd', ['c', 1000], ['d', 5000]), { ...edge('ef', ['e', -3000], ['f', 3000]), points: [[-3000, 1, 50], [3000, 1, 50]] }] };
const centre = { id: 'ferry', x: 0, z: 0, radiusM: 200 };

describe('near-spawn road graph subset (gtasf-0k01)', () => {
  it('keeps edges with any segment inside a centre radius and drops the rest', () => {
    const near = selectNearRoadGraph(graph, [centre]);
    expect(near.edges.map(e => e.id)).toEqual(['ab', 'bc', 'ef']);
    expect(near.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c', 'e', 'f']);
    expect(near.edges.find(e => e.id === 'bc')!.next).toEqual([]);
    expect(selectNearRoadGraph(graph, [{ ...centre, x: 5000 }]).edges.map(e => e.id)).toEqual(['cd']);
  });
  it('round-trips through the shared GTRP decoder with IDs and attributes intact', () => {
    const decoded = unpackRoadGraph(decodePackedRoadGraph(nearRoadGraphBytes(packRoadGraph(graph), [centre])));
    const full = unpackRoadGraph(decodePackedRoadGraph(packRoadGraph(graph)));
    expect(decoded.edges.map(e => e.id)).toEqual(['ab', 'bc', 'ef']);
    for (const e of decoded.edges) {
      const source = full.edges.find(f => f.id === e.id)!;
      expect({ ...e, next: e.next?.filter(id => id !== 'cd') }).toEqual({ ...source, next: source.next?.filter(id => id !== 'cd') });
    }
    expect(decoded.edges.find(e => e.id === 'bc')!.routable).toBe(false);
  });
  it('writes the bin, gzip sibling and a publication-valid manifest.roadGraphNear', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtasf-near-'));
    const bytes = packRoadGraph(graph);
    await writeFile(join(root, 'roadgraph.bin'), bytes);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ roadGraph: { path: 'roadgraph.bin', encoding: 'roadpack-v1', bytes: bytes.length, gzipBytes: 0, sha256: digest(bytes) } }));
    const artifact = await writeNearRoadGraph(root, [centre]);
    const raw = await readFile(join(root, 'roadgraph-near.bin')), gz = await readFile(join(root, 'roadgraph-near.bin.gz'));
    expect([raw.length, gz.length, digest(raw), digest(gunzipSync(gz))]).toEqual([artifact.bytes, artifact.gzipBytes, artifact.sha256, artifact.sha256]);
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.roadGraphNear).toEqual(artifact);
    expect(artifact.coverage).toEqual([centre]);
    expect(artifact.sourceSha256).toBe(digest(bytes));
    // Default mode writes a per-centre part so the client fetches only its circle.
    expect(artifact.parts?.map(p => p.id)).toEqual(['ferry']);
  });
  it('union mode writes one deduped citywide near graph covering every centre and omits parts (gtasf-tdbw)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtasf-near-union-'));
    const bytes = packRoadGraph(graph);
    await writeFile(join(root, 'roadgraph.bin'), bytes);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ roadGraph: { path: 'roadgraph.bin', encoding: 'roadpack-v1', bytes: bytes.length, gzipBytes: 0, sha256: digest(bytes) } }));
    const mission = { id: 'mission', x: 5000, z: 0, radiusM: 200 }; // its own circle selects only 'cd'
    const artifact = await writeNearRoadGraph(root, [centre, mission], { union: true });
    // No parts at all (undefined, not []): the client's `near.parts ? … : near` then loads the combined union.
    expect(artifact.parts).toBeUndefined();
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect('parts' in manifest.roadGraphNear).toBe(false);
    // Coverage still lists every centre so nearGraphCovers() stays true for each circle.
    expect(artifact.coverage.map(c => c.id)).toEqual(['ferry', 'mission']);
    // The combined roadgraph-near.bin is the UNION of both circles (ferry: ab,bc,ef + mission: cd), ID-intact.
    const combined = unpackRoadGraph(decodePackedRoadGraph(await readFile(join(root, 'roadgraph-near.bin'))));
    expect(combined.edges.map(e => e.id).sort()).toEqual(['ab', 'bc', 'cd', 'ef']);
    const source = unpackRoadGraph(decodePackedRoadGraph(bytes));
    const cd = combined.edges.find(e => e.id === 'cd')!;
    expect(cd).toEqual(source.edges.find(e => e.id === 'cd'));
    // No per-centre part file is emitted on disk.
    await expect(readFile(join(root, 'roadgraph-near-mission.bin'))).rejects.toThrow();
  });
});
