import { expect, test, vi } from 'vitest';
import type { RoadEdge, RoadGraph } from '@gtasf/shared/roadgraph';
import type { C2SMessage } from '@gtasf/shared/protocol/types';
import { createRoadSampler, createRoadSnapper } from '../../render/chunks/terrain';
import { createRobotaxiClient } from './client';
import { resolveRobotaxiDestination } from './destination';

vi.mock('@gtasf/shared/flags', () => ({ flags: { robotaxi: true } }));

test('hail keeps actual bridge/tunnel sampler heights through centimetre encoding and unloaded fallbacks', () => {
  for (const lane of [{ y: 14.25, bridge: true }, { y: -4.5, tunnel: true }]) {
    const edge: RoadEdge & { bridge?: boolean; tunnel?: boolean } = {
      id: 'lane:test', from: 'a', to: 'b', lane: 0, lengthM: 20, speedMps: 10,
      points: [[-10, lane.y, 0], [10, lane.y, 0]], ...lane,
    };
    const graph: RoadGraph = { version: 1, nodes: [], edges: [edge] };
    const sample = createRoadSampler(graph);
    const world = { nearestRoad: createRoadSnapper(graph),
      surfaceHeightAt: (x: number, z: number, referenceY?: number) => sample(x, z, referenceY) ?? 0 };
    // Reproduce the old callback's loss of lane height before checking the fix.
    expect(world.surfaceHeightAt(0, 0)).toBe(0);
    const messages: C2SMessage[] = [];
    const taxi = createRobotaxiClient({ send: message => { messages.push(message); return true; },
      notify: () => {}, getMode: () => 'on-foot', resolveDestination: target => resolveRobotaxiDestination(world, target) });
    taxi.setConnected(true);
    expect(taxi.hail({ title: 'Destination', x: 0, y: 0, z: 1 })).toBe(true);
    expect(messages).toEqual([{ type: 'ROBOTAXI_HAIL', requestId: 1, destination: { x: 0, y: lane.y * 100, z: 0 } }]);
    expect(resolveRobotaxiDestination({ ...world, surfaceHeightAt: () => null }, { x: 0, y: 0, z: 1 }))
      .toEqual({ x: 0, y: lane.y, z: 0 });
  }
  const target = { x: 3, y: 7, z: 5 };
  const noRoad = vi.fn(() => null);
  expect(resolveRobotaxiDestination({ nearestRoad: noRoad, surfaceHeightAt: () => null }, target)).toEqual(target);
  expect(noRoad).toHaveBeenCalledWith(3, 5, 600);
  expect(resolveRobotaxiDestination({ nearestRoad: noRoad, surfaceHeightAt: () => 8 }, target)).toEqual({ ...target, y: 8 });
});
