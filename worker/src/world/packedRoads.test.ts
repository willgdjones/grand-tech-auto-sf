import { expect, it } from 'vitest';
import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import { decodePackedRoadGraph, type PackedPublicRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { PackedRoads } from './packedRoads';
import { routeLength } from './localRoads';
import { TrafficSimulation } from './traffic/simulation';

const points: [number, number, number][] = [[0, 10, 0], [100, 12, 0], [100, 14, 100], [0, 16, 100]];
const graph: PackedPublicRoadGraph = { version: 1, warnings: [],
  nodes: points.map((p, i) => ({ id: `n${i}`, x: p[0], y: p[1], z: p[2], osmNode: `${i}`, ...(i === 1 ? { control: 'signal' as const } : {}) })),
  edges: points.map((p, i) => ({ id: `lane:${i}`, from: `n${i}`, to: `n${(i + 1) % 4}`, lengthM: 101, speedMps: 8,
    lane: 0, points: [p, points[(i + 1) % 4]!], kind: 'lane', osmWay: 100 + i, name: 'Source street', inferredLanes: false,
    layer: 0, bridge: false, tunnel: false, next: [`lane:${(i + 1) % 4}`] })) };
const make = (source = graph, options = {}) => new PackedRoads(decodePackedRoadGraph(packRoadGraph(source, options)));
const cm = (x: number, z: number) => ({ x: x * 100, y: 0, z: z * 100 });

it('routes and approaches directed roads continuously, including a backwards destination on the same lane', () => {
  const roads = make(), start = roads.snap(cm(75, 1))!, finish = roads.snap(cm(25, 1))!;
  const route = roads.route(start, finish)!;
  expect(route[0]!.from).toEqual(start.point); expect(route.at(-1)!.to).toEqual(finish.point);
  expect(routeLength(route)).toBeGreaterThan(350);
  for (let i = 1; i < route.length; i++) expect(route[i]!.from).toEqual(route[i - 1]!.to);
  const approach = roads.approach(finish, 150);
  expect(routeLength(approach)).toBeCloseTo(150); expect(approach.at(-1)!.to).toEqual(finish.point);
  expect(roads.targetNode(start.edge)?.control).toBe('signal');
  expect(roads.successors(start.edge).map(edge => edge.id)).toEqual(['lane:1']);
  expect(roads.route(start, finish)).toEqual(route);
});
it('honours explicit turn restrictions and the collision-cleared routable mask', () => {
  const blocked = make({ ...graph, edges: graph.edges.map((edge, i) => i === 1 ? { ...edge, next: [] } : edge) });
  expect(blocked.route(blocked.snap(cm(25, 1))!, blocked.snap(cm(75, 99))!)).toBeUndefined();
  const masked = make(graph, { routableEdgeIds: new Set(['lane:0', 'lane:2', 'lane:3']) });
  expect(masked.snap(cm(101, 50), 10)).toBeUndefined();
  expect(masked.route(masked.snap(cm(25, 1))!, masked.snap(cm(75, 99))!)).toBeUndefined();
});
it('finds curved road interiors outside endpoint cells without eager whole-graph decoding', () => {
  const source = { ...graph, edges: [{ ...graph.edges[0]!, points: [points[0]!, [350, 20, 350] as [number, number, number], points[1]!], next: [] }] };
  const roads = make(source), snap = roads.snap(cm(350, 350), 2);
  expect(snap?.distance).toBe(0); expect(snap?.point).toEqual([350, 20, 350]);
  expect(roads.nearbyEdges([{ x: 350, z: 350 }], 2)).toHaveLength(1);
  expect(roads.snap(cm(-10000, -10000), 2)).toBeUndefined();
  expect(roads.retainedBytes).toBeLessThan(10_000);
});
it('supplies moving regional NPC traffic without eagerly expanding the packed graph', () => {
  const roads = make(), traffic = new TrafficSimulation(roads, { maximum: 12, perPlayer: 12 });
  const observer = { x: 5000, y: 0, z: 5000, yaw: 0, flags: 0 };
  traffic.step(.1, [observer], 1000);
  const before = traffic.snapshotFor(observer);
  expect(before.length).toBeGreaterThan(0); expect(before.length).toBeLessThanOrEqual(12);
  for (let i = 0; i < 30; i++) traffic.step(.1, [observer], 1100 + i * 100);
  expect(traffic.snapshotFor(observer).some(car => before.some(old => old.id === car.id && (old.x !== car.x || old.z !== car.z)))).toBe(true);
});
