import { expect, it, vi } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';

// A mutable copy of the (frozen) flags so this file can route the same graph with routerTypedAstar on and off.
const mutable = vi.hoisted(() => ({ flags: {} as Record<string, unknown> }));
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  Object.assign(mutable.flags, actual.flags);
  return { ...actual, flags: mutable.flags };
});
const { createMapRouter } = await import('./routing');

it('routerTypedAstar: typed-array A* routes byte-identically to the Map A* (seeded grid, one-ways, 200 pairs)', () => {
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = 24, nodes: RoadGraph['nodes'] = [], edges: RoadGraph['edges'] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: `n${i}_${j}`, x: i * 60 + rand() * 20, y: 0, z: j * 60 + rand() * 20 });
  const at = (i: number, j: number) => nodes[i * n + j]!;
  const lane = (a: RoadGraph['nodes'][number], b: RoadGraph['nodes'][number]) => edges.push({ id: `lane:${a.id}>${b.id}`, from: a.id, to: b.id,
    lengthM: Math.hypot(b.x - a.x, b.z - a.z) * (1 + rand() * 0.5), speedMps: 10, lane: 1, points: [[a.x, 0, a.z], [b.x, 0, b.z]] });
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i + 1 < n) { lane(at(i, j), at(i + 1, j)); if (rand() > 0.2) lane(at(i + 1, j), at(i, j)); } // ~20 % one-way
    if (j + 1 < n) { lane(at(i, j), at(i, j + 1)); if (rand() > 0.2) lane(at(i, j + 1), at(i, j)); }
  }
  const graph: RoadGraph = { version: 1, nodes, edges };
  const pairs = Array.from({ length: 200 }, () => [nodes[Math.floor(rand() * nodes.length)]!, nodes[Math.floor(rand() * nodes.length)]!] as const);
  const run = (on: boolean) => { mutable.flags.routerTypedAstar = on; mutable.flags.routeSnapFallback = false; const router = createMapRouter(graph);
    return pairs.map(([a, b]) => JSON.stringify(router.route({ x: a.x + 3, z: a.z + 2 }, { x: b.x - 2, z: b.z + 3 }))); };
  const typedRoutes = run(true), mapRoutes = run(false);
  expect(typedRoutes.filter(r => r !== 'null').length).toBeGreaterThan(150);
  expect(typedRoutes).toEqual(mapRoutes);
});
