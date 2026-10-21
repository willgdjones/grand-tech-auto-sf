import { expect, it } from 'vitest';
import { createCableRoadSampler } from './profile-ground';
import type { RoadEdge } from '../../shared/roadgraph';

it('follows the surface rail deck across a lower street and ignores parallel tunnel lanes', () => {
  const edge = (id: string, points: RoadEdge['points'], extra = {}) => ({ id, points, from: 'a', to: 'b', lengthM: 20, speedMps: 5, lane: 0, ...extra });
  const sample = createCableRoadSampler([
    edge('crossing-below', [[-10, 55, 0], [10, 55, 0]]),
    edge('underground-parallel', [[0, 48, -10], [0, 48, 10]], { tunnel: true, layer: -1 }),
    edge('rail-deck', [[1, 61, -10], [1, 61, 10]], { layer: 1 }),
  ]);
  expect(sample(0, 0, 0, 1)).toBe(61);
  expect(sample(0, 0, 0, -1)).toBe(61);
  expect(sample(0, 0, 1, 0)).toBe(55);
  expect(sample(20, 20, 0, 1)).toBeNull();
});
