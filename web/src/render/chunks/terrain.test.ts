import { describe, expect, it } from 'vitest';
import { FootprintIndex, createRoadSampler, createRoadSnapper, type ChunkCollision } from './terrain';
import type { RoadGraph } from '@gtasf/shared/roadgraph';

it('checks road presence at strict lane boundaries and separate bridge/tunnel levels', () => {
  const edges: (Pick<RoadGraph['edges'][number], 'id' | 'points'> & {
    bridge?: boolean; tunnel?: boolean; layer?: number;
  })[] = [
    { id: 'ground', points: [[-80, 0, 0], [80, 0, 0]] },
    { id: 'portal-street', points: [[-80, 4, 0], [80, 4, 0]] },
    { id: 'bridge', points: [[-80, 10, 20], [80, 10, 20]], bridge: true, layer: 1 },
    { id: 'tunnel', points: [[-80, -10, 40], [80, -10, 40]], tunnel: true, layer: -1 },
    { id: 'point', points: [[0, 2, 60], [0, 2, 60]] },
  ];
  const road = createRoadSampler({ version: 1, nodes: [],
    edges: edges.map(edge => ({ from: 'a', to: 'b', lengthM: 160, speedMps: 10, lane: 0, ...edge })),
  });
  const queries: [number, number, number | undefined, boolean][] = [
    [-64, 0, undefined, true], [0, 3.5, undefined, false], [0, 3.4999, undefined, true],
    [0, 20, undefined, false], [0, 20, 10, true], [0, 20, 5, true], [0, 20, 4, false],
    [0, 40, undefined, false], [0, 40, -10, true], [0, 60, 2, true],
    [1000, 0, undefined, false], [NaN, 0, undefined, false], [0, Infinity, undefined, false],
    [0, 0, NaN, false], [0, 0, Infinity, false],
  ];
  for (const [x, z, y, expected] of queries) {
    expect(road.contains(x, z, y), `presence at ${x},${z},${y}`).toBe(expected);
    expect(road(x, z, y) !== null, `height at ${x},${z},${y}`).toBe(expected);
  }
  // Presence may stop at the first acceptable road; wheels still need the
  // closest vertical level even when that road appears later in the bucket.
  expect(road(0, 0, 4)).toBe(4);
  expect(road.contains(0, 0, 4)).toBe(true);
});

describe('streamed footprint collision', () => {
  it('preserves courtyard, vertical and neighbouring-cell clearance after replacing a chunk', () => {
    const chunk: ChunkCollision = { version: 1, origin: [-256, 0, -256], buildings: [{
      id: 'courtyard', minY: 5, maxY: 20, rings: [
        [[220, 220], [280, 220], [280, 280], [220, 280]],
        [[240, 240], [260, 240], [260, 260], [240, 260]],
      ],
    }] };
    const index = new FootprintIndex(); index.rebuild([chunk]);
    expect(index.collides(-25, 6, -25, .35, 1.8)).toBe(true);
    expect(index.collides(-8, 6, -8, .35, 1.8)).toBe(false);
    expect(index.collides(-15.8, 6, -8, .35, 1.8)).toBe(true);
    expect(index.collides(-36.2, 6, -25, .35, 1.8)).toBe(true);
    expect(index.collides(-36.4, 6, -25, .35, 1.8)).toBe(false);
    expect(index.collides(24.2, 6, 10, .35, 1.8)).toBe(true);
    expect(index.collides(-25, 3.2, -25, .35, 1.8)).toBe(false);
    expect(index.collides(-25, 20, -25, .35, 1.8)).toBe(false);
    expect(index.collides(500, 6, 500, .35, 1.8)).toBe(false);
    index.rebuild([]);
    expect(index.collides(-25, 6, -25, .35, 1.8)).toBe(false);
  });
});


describe('nearest road on the city graph', () => {
  function graph(...lines: [number, number, number][][]): RoadGraph {
    return { version: 1, nodes: [], edges: lines.map((points, i) => ({
      id: `lane:${i}`, from: 'a', to: 'b', lengthM: 1, speedMps: 10, lane: 0, points,
    })) };
  }
  it('finds a sloping segment across remote endpoints and repeated negative-cell queries', () => {
    const snap = createRoadSnapper(graph([[-256, 5, -256], [256, 21, 256]]));
    expect(snap(0, 4)).toEqual({ x: 2, y: 13.0625, z: 2, yaw: Math.PI / 4 });
    expect(snap(-68, -64)).toEqual({ x: -66, y: 10.9375, z: -66, yaw: Math.PI / 4 });
    expect(snap(0, 4)).toEqual({ x: 2, y: 13.0625, z: 2, yaw: Math.PI / 4 });
    expect(snap(0, 4, Infinity)).toEqual(snap(0, 4));
  });
  it('preserves source-order ties and strict radius boundaries across spatial cells', () => {
    const snap = createRoadSnapper(graph(
      [[2, 20, -200], [2, 20, 200]],
      [[-2, 0, -200], [-2, 0, 200]],
      [[0, 0, 0], [0, 100, 0]],
    ));
    const first = { x: 2, y: 20, z: 0, yaw: 0 };
    expect(snap(0, 0, 3)).toEqual(first);
    expect(snap(0, 0, -3)).toEqual(first);
    expect(snap(0, 0, 2)).toBeNull();
    expect(snap(0, 0, 0)).toBeNull();
    expect(snap(NaN, 0)).toBeNull();
    expect(snap(0, Infinity)).toBeNull();
    expect(snap(0, 0, NaN)).toBeNull();
    expect(createRoadSnapper(graph())(0, 0, Infinity)).toBeNull();
  });
});
