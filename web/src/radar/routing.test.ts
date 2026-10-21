import { expect, it } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { createMapRouter, createMapRouterIncremental, assembleMapRouter, buildRouterStructures, type MapRouter, type RouterStructures } from './routing';

/** Drain the sliced generator fully (as radar.ts does across frames) into a finished router. */
function drain(graph: RoadGraph, budgetMs: number): MapRouter {
  const gen = createMapRouterIncremental(graph, budgetMs);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

/** Drain the structure-only generator exactly as routing.worker.ts does (budget Infinity, off-main). */
function buildStructures(graph: RoadGraph): RouterStructures {
  const gen = buildRouterStructures(graph, Infinity);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

it('starts directed GPS on the current road deck and retains planar destination/legacy callers', () => {
  const graph: RoadGraph = {
    version: 1,
    nodes: [
      { id: 'low-a', x: 0, y: 0, z: 0 }, { id: 'low-b', x: 80, y: 0, z: 0 },
      { id: 'high-a', x: 0, y: 12, z: 1 }, { id: 'high-b', x: 80, y: 12, z: 1 },
      { id: 'hill-a', x: 400, y: 0, z: 0 }, { id: 'hill-b', x: 500, y: 20, z: 0 },
    ],
    edges: [
      { id: 'lane:low', from: 'low-a', to: 'low-b', lengthM: 80, speedMps: 10, lane: 1, points: [[0, 0, 0], [80, 0, 0]] },
      { id: 'lane:high', from: 'high-a', to: 'high-b', lengthM: 80, speedMps: 10, lane: 1, points: [[0, 12, 1], [80, 12, 1]] },
      { id: 'lane:hill', from: 'hill-a', to: 'hill-b', lengthM: Math.hypot(100, 20), speedMps: 10, lane: 1, points: [[400, 0, 0], [500, 20, 0]] },
    ],
  };
  const router = createMapRouter(graph), from = { x: 20, y: 12.2, z: 0 }, target = { x: 60, y: 0, z: 1 };
  expect(router.snap(from.x, from.z)?.edge.id).toBe('lane:low');
  expect(router.snap(from.x, from.z, 150, from.y)?.edge.id).toBe('lane:high');
  const upper = router.route(from, target)!;
  expect(upper.points[0]).toEqual([20, 12, 1]);
  expect(upper.approach).toEqual({ x: 60, y: 12, z: 1 });
  expect(upper.distanceM).toBe(40);
  expect(router.route({ x: 20, z: 0 }, { x: 60, z: 0 })?.points[0]).toEqual([20, 0, 0]);
  expect(router.route({ ...from, y: .2 }, { x: 60, z: 0 })?.points[0]).toEqual([20, 0, 0]);
  expect(router.route({ ...from, y: 6 }, target)).toBeNull();
  expect(router.route({ ...from, y: NaN }, target)).toBeNull();
  expect(router.route(from, { x: 10, z: 1 })).toBeNull(); // One-way lane has no return connection.
  expect(router.snap(450, 1, 20, 10.2)?.point).toEqual([450, 10, 0]);
  expect(router.route({ x: 450, y: 10.2, z: 1 }, { x: 475, z: 0 })?.points[0]).toEqual([450, 10, 0]);
});

it('finds the whole lane across distant endpoints and preserves source-order junction ties', () => {
  const graph: RoadGraph = { version: 1, nodes: [], edges: [
    { id: 'lane:first', from: 'a', to: 'b', lengthM: 1024, speedMps: 10, lane: 1, points: [[128, 0, -512], [128, 0, 512]] },
    { id: 'lane:second', from: 'c', to: 'd', lengthM: 1024, speedMps: 10, lane: 1, points: [[-512, 0, 128], [512, 0, 128]] },
    { id: 'turn:ignored', from: 'e', to: 'f', lengthM: 1000, speedMps: 10, lane: 1, points: [[0, 0, -500], [0, 0, 500]] },
  ] };
  const router = createMapRouter(graph);
  expect(router.snap(130, -300, 2)).toMatchObject({ edge: { id: 'lane:first' }, point: [128, 0, -300], along: 212, distance: 2 });
  expect(router.snap(130, -300, 1)).toBeNull();
  // The horizontal lane is encountered in an earlier grid cell, but appears later in source order.
  expect(router.snap(128, 128, 150)).toMatchObject({ edge: { id: 'lane:first' }, point: [128, 0, 128], along: 640 });
  expect(router.snap(128, 128, 0)?.edge.id).toBe('lane:first');
  expect(router.snap(-350, 130, 2)).toMatchObject({ edge: { id: 'lane:second' }, point: [-350, 0, 128], along: 162 });
  expect(router.snap(0, -300, 10)).toBeNull();
  expect(router.snap(128, 128, -1)).toBeNull();
});


it('visits every outgoing road and retains source order for equal-cost alternatives', () => {
  const graph: RoadGraph = { version: 1, nodes: [], edges: [
    { id: 'lane:start', from: 'a', to: 'b', lengthM: 10, speedMps: 10, lane: 1, points: [[0, 0, 0], [10, 0, 0]] },
    { id: 'turn:first', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, 5], [20, 0, 0]] },
    { id: 'turn:second', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, -5], [20, 0, 0]] },
    { id: 'lane:end', from: 'c', to: 'd', lengthM: 10, speedMps: 10, lane: 1, points: [[20, 0, 0], [30, 0, 0]] },
  ] };
  const from = { x: 5, z: 0 }, to = { x: 25, z: 0 };
  const tied = createMapRouter(graph).route(from, to)!;
  expect(tied.points).toContainEqual([15, 0, 5]);
  expect(tied.points).not.toContainEqual([15, 0, -5]);
  const cheaperSecond = { ...graph, edges: graph.edges.map(edge => edge.id === 'turn:second' ? { ...edge, lengthM: 10 } : edge) };
  const shorter = createMapRouter(cheaperSecond).route(from, to)!;
  expect(shorter.points).toContainEqual([15, 0, -5]);
  expect(shorter.points).not.toContainEqual([15, 0, 5]);
  expect(createMapRouter(graph).route(to, from)).toBeNull();
  expect(createMapRouter({ version: 1, nodes: [], edges: [] }).snap(0, 0, Infinity)).toBeNull();
});

it('gtasf-a989: the idle-sliced incremental build is byte-identical to the synchronous build', () => {
  // A graph large enough to cross the generator's per-phase slice checkpoints (every ~2048 nodes/edges/
  // lanes), driven with budgetMs=0 so a yield fires at every checkpoint — proving mid-build yields never
  // corrupt the index. 9000 lanes, each a short disconnected segment on a 100-wide grid.
  const big: RoadGraph = { version: 1, nodes: [], edges: [] };
  for (let i = 0; i < 9000; i++) {
    const x = (i % 100) * 5, z = Math.floor(i / 100) * 5;
    big.nodes.push({ id: `n${i}a`, x, y: 0, z }, { id: `n${i}b`, x: x + 4, y: 0, z });
    big.edges.push({ id: `lane:${i}`, from: `n${i}a`, to: `n${i}b`, lengthM: 4, speedMps: 10, lane: 1, points: [[x, 0, z], [x + 4, 0, z]] });
  }
  const sync = createMapRouter(big), sliced = drain(big, 0);
  const probes: [number, number][] = [[0, 0], [2, 0], [250, 250], [495, 445], [12, 37], [203, 10], [-9, -9]];
  for (const [x, z] of probes) {
    expect(sliced.snap(x, z, 12)).toEqual(sync.snap(x, z, 12));
    expect(sliced.snap(x, z, 150, 0)).toEqual(sync.snap(x, z, 150, 0));
  }
  // Same-lane route (both endpoints on lane:0) must slice identically through the sliced build.
  expect(sliced.route({ x: 1, z: 0 }, { x: 3, z: 0 })).toEqual(sync.route({ x: 1, z: 0 }, { x: 3, z: 0 }));

  // Also identical on the small directed/junction graphs, including a real A* path across turn edges.
  const junction: RoadGraph = { version: 1, nodes: [], edges: [
    { id: 'lane:start', from: 'a', to: 'b', lengthM: 10, speedMps: 10, lane: 1, points: [[0, 0, 0], [10, 0, 0]] },
    { id: 'turn:first', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, 5], [20, 0, 0]] },
    { id: 'turn:second', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, -5], [20, 0, 0]] },
    { id: 'lane:end', from: 'c', to: 'd', lengthM: 10, speedMps: 10, lane: 1, points: [[20, 0, 0], [30, 0, 0]] },
  ] };
  expect(drain(junction, 0).route({ x: 5, z: 0 }, { x: 25, z: 0 }))
    .toEqual(createMapRouter(junction).route({ x: 5, z: 0 }, { x: 25, z: 0 }));
});

it('gtasf-fddi: assembleMapRouter over worker-style structures routes byte-identically to createMapRouter', () => {
  // This is the worker path WITHOUT a real worker: buildRouterStructures (what routing.worker.ts drains
  // off-main) + assembleMapRouter (what radar.ts runs on main) must equal the one-pass createMapRouter.
  // The junction graph exercises snap, an A* path across tied turn edges, a one-way unreachable pair and
  // a no-snap pair; the big grid is a city-scale index across many lanes/cells for snap + same-lane parity.
  const junction: RoadGraph = { version: 1, nodes: [
    { id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 10, y: 0, z: 0 }, { id: 'c', x: 20, y: 0, z: 0 }, { id: 'd', x: 30, y: 0, z: 0 },
  ], edges: [
    { id: 'lane:start', from: 'a', to: 'b', lengthM: 10, speedMps: 10, lane: 1, points: [[0, 0, 0], [10, 0, 0]] },
    { id: 'turn:first', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, 5], [20, 0, 0]] },
    { id: 'turn:second', from: 'b', to: 'c', lengthM: 20, speedMps: 10, lane: 1, points: [[10, 0, 0], [15, 0, -5], [20, 0, 0]] },
    { id: 'lane:end', from: 'c', to: 'd', lengthM: 10, speedMps: 10, lane: 1, points: [[20, 0, 0], [30, 0, 0]] },
  ] };
  const syncJunction = createMapRouter(junction), viaJunction = assembleMapRouter(junction, buildStructures(junction));
  const pairs: [{ x: number; y?: number; z: number }, { x: number; z: number }][] = [
    [{ x: 1, z: 0 }, { x: 3, z: 0 }],          // same edge — sliced directly
    [{ x: 5, z: 0 }, { x: 25, z: 0 }],         // cross-junction A* across the tied turns
    [{ x: 25, z: 0 }, { x: 5, z: 0 }],         // one-way: no return connection -> both null
    [{ x: 1000, z: 1000 }, { x: 3, z: 0 }],    // start out of snap range -> both null
  ];
  for (const [from, to] of pairs) expect(viaJunction.route(from, to)).toEqual(syncJunction.route(from, to));
  for (const [x, z] of [[1, 0], [15, 5], [15, -5], [30, 0], [-50, -50]] as [number, number][]) {
    expect(viaJunction.snap(x, z, 12)).toEqual(syncJunction.snap(x, z, 12));
    expect(viaJunction.snap(x, z, 150, 0)).toEqual(syncJunction.snap(x, z, 150, 0));
  }

  const big: RoadGraph = { version: 1, nodes: [], edges: [] };
  for (let i = 0; i < 9000; i++) {
    const x = (i % 100) * 5, z = Math.floor(i / 100) * 5;
    big.nodes.push({ id: `n${i}a`, x, y: 0, z }, { id: `n${i}b`, x: x + 4, y: 0, z });
    big.edges.push({ id: `lane:${i}`, from: `n${i}a`, to: `n${i}b`, lengthM: 4, speedMps: 10, lane: 1, points: [[x, 0, z], [x + 4, 0, z]] });
  }
  const syncBig = createMapRouter(big), viaBig = assembleMapRouter(big, buildStructures(big));
  for (const [x, z] of [[0, 0], [2, 0], [250, 250], [495, 445], [12, 37], [203, 10], [-9, -9]] as [number, number][]) {
    expect(viaBig.snap(x, z, 12)).toEqual(syncBig.snap(x, z, 12));
    expect(viaBig.snap(x, z, 150, 0)).toEqual(syncBig.snap(x, z, 150, 0));
  }
  expect(viaBig.route({ x: 1, z: 0 }, { x: 3, z: 0 })).toEqual(syncBig.route({ x: 1, z: 0 }, { x: 3, z: 0 }));
  expect(viaBig.route({ x: 0, z: 0 }, { x: 495, z: 445 })).toEqual(syncBig.route({ x: 0, z: 0 }, { x: 495, z: 445 }));
});
