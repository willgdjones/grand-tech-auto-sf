import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routableEdgeIds } from '../src/pipeline/runtime';
import type { RoadEdge, RoadGraph } from '../src/pipeline/types';

const node = (id: string, x: number) => ({ id, x, y: 0, z: 0, osmNode: id });
const edge = (id: string, from: string, to: string): RoadEdge => ({ id, from, to, lengthM: 10, speedMps: 10, lane: 0,
  points: [[0, 0, 0], [10, 0, 0]], kind: 'lane', osmWay: 1, name: 'Test St', inferredLanes: false, layer: 0, bridge: false, tunnel: false });
// a <-> b <-> c is a loop you can always leave; c -> d is a dead-end spur; b <-> e only through a building.
const graph = { version: 1, nodes: ['a', 'b', 'c', 'd', 'e'].map(node), warnings: [],
  edges: [edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('bc', 'b', 'c'), edge('cb', 'c', 'b'), edge('cd', 'c', 'd'),
    edge('be', 'b', 'e'), edge('eb', 'e', 'b')] } as unknown as RoadGraph;

describe('citywide routable mask (gtasf-u4al)', () => {
  it('routes on the whole collision-clear strongly connected network, not the corridor JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtasf-routable-'));
    await writeFile(join(root, 'road-collision-audit.json'), JSON.stringify({ blocked: [{ edge: 'eb' }] }));
    await writeFile(join(root, 'roadgraph-playable.json'), JSON.stringify({ ...graph, edges: [graph.edges[0]] }));
    expect([...await routableEdgeIds(root, graph)].sort()).toEqual(['ab', 'ba', 'bc', 'cb']);
  });
  it('falls back to roadgraph-playable.json for bakes without an audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gtasf-routable-'));
    await writeFile(join(root, 'roadgraph-playable.json'), JSON.stringify({ ...graph, edges: [graph.edges[0]] }));
    expect([...await routableEdgeIds(root, graph)]).toEqual(['ab']);
  });
});
