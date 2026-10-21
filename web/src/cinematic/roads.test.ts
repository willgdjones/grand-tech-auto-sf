import { afterEach, expect, it, vi } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { cinematicRoadGraph } from './roads';
import { createMapRouter } from '../radar/routing';
const feature = vi.hoisted(() => ({ compactMapAssets: true }));
vi.mock('@gtasf/shared/flags', () => ({ flags: feature }));
afterEach(() => { vi.unstubAllGlobals(); feature.compactMapAssets = true; });

it('routes compact cinematics from the loaded graph without fetching retired JSON, retaining ordinary fallback', async () => {
  const graph: RoadGraph = { version: 1, nodes: [{ id: 'a', x: 0, y: 20, z: 0 }, { id: 'b', x: 60, y: 10, z: 0 }],
    edges: [{ id: 'lane:ab', from: 'a', to: 'b', lengthM: 61, speedMps: 10, lane: 0, points: [[0, 20, 0], [30, 15, 0], [60, 10, 0]] }] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => graph }); vi.stubGlobal('fetch', fetcher);
  const world = { manifest: { requiredFeatures: ['compactMapAssets'] }, routingGraph: graph } as Parameters<typeof cinematicRoadGraph>[0];
  const loaded = await cinematicRoadGraph(world);
  expect(loaded).toBe(graph); expect(fetcher).not.toHaveBeenCalled();
  const route = createMapRouter(loaded).route({ x: 0, z: 0 }, { x: 60, z: 0 });
  expect(route?.points).toContainEqual([30, 15, 0]);
  feature.compactMapAssets = false;
  await expect(cinematicRoadGraph(world)).rejects.toThrow('COMPACT_MAP_ASSETS_DISABLED');
  feature.compactMapAssets = true;
  await expect(cinematicRoadGraph({ ...world, routingGraph: undefined })).rejects.toThrow('CINEMATIC_CITY_GRAPH_REQUIRED');
  expect(await cinematicRoadGraph({ ...world, manifest: { ...world.manifest, requiredFeatures: undefined } })).toBe(graph);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/map/lombard/roadgraph-playable.json');
});
