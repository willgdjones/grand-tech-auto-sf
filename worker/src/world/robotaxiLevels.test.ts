import { expect, it, vi } from 'vitest';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { decodePackedRoadGraph, type PackedPublicRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import { LocalRoads } from './localRoads';
import { PackedRoads } from './packedRoads';
import { LocalRobotaxis } from './localRobotaxi';
import { WorldVehicles } from './vehicles';
import { LOCAL_SPAWN, LOCAL_TAXI_DESTINATION } from './localSpawn';

const switches = vi.hoisted(() => ({ madMaxRobotaxi: true }));
vi.mock('@gtasf/shared/flags', () => ({ flags: switches }));

// The first 50 metres have identical map coordinates on three distinct decks.
// Each lane then diverges so its destination pin can omit height unambiguously.
const levels = [{ y: 0, z: 0 }, { y: 12, z: 25 }, { y: -8, z: -25 }];
const graph: RoadGraph = { version: 1,
  nodes: levels.flatMap(({ y, z }, i) => [{ id: `a${i}`, x: 0, y, z: 0 }, { id: `b${i}`, x: 100, y, z }]),
  edges: levels.map(({ y, z }, i) => ({ id: `lane:${i}`, from: `a${i}`, to: `b${i}`, speedMps: 10,
    lengthM: 50 + Math.hypot(50, z), lane: 0, points: [[0, y, 0], [50, y, 0], [100, y, z]] })) };
const packedGraph: PackedPublicRoadGraph = { ...graph, warnings: [],
  nodes: graph.nodes.map(node => ({ ...node, osmNode: node.id })),
  edges: graph.edges.map((edge, i) => ({ ...edge, kind: 'lane', osmWay: i + 1, name: 'Stacked roads',
    inferredLanes: false, layer: i === 2 ? -1 : i, bridge: i === 1, tunnel: i === 2, next: [] })) };

it('hails on the player deck in both graph formats and pickup modes while map pins remain heightless', () => {
  for (const roads of [new LocalRoads(graph), new PackedRoads(decodePackedRoadGraph(packRoadGraph(packedGraph)))]) {
    // Ordinary map/recovery snaps preserve their original XZ-only contract.
    const mapSnap = roads.snap({ x: 2500, y: 1200, z: 0 })!;
    expect([mapSnap.point[0], mapSnap.point[2]]).toEqual([25, 0]);
    expect(roads.snap({ x: 2500, y: -800, z: 0 })?.point).toEqual(mapSnap.point);
    expect(roads.snap({ x: 2500, y: 2500, z: 0 }, 35, 3)).toBeUndefined();
    expect(roads.snap({ x: 2500, y: 0, z: 3600 }, 35, 3)).toBeUndefined();
    for (const madMax of [false, true]) for (const { y, z } of levels) {
      switches.madMaxRobotaxi = madMax;
      // A small curb-height difference must not make a valid pickup unavailable.
      let player: Pose = { x: 2500, y: Math.round((y + .25) * 100), z: 0, yaw: 0, flags: 0 };
      const messages: S2CMessage[] = [];
      const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (_, pose) => { player = pose; } });
      const taxis = new LocalRobotaxis(fleet, { emit: message => messages.push(message), locate: () => player }, roads);
      const destination = { x: 9000, y: 0, z: z * 80 };
      expect(taxis.hail(1, 1, destination, 1000)).toBe(true);
      const trip = taxis.trips.get(1)!;
      expect(trip.ride[0]!.from).toEqual([25, y, 0]);
      expect(trip.ride.at(-1)!.to).toEqual([90, y, z * .8]);
      for (let now = 1100; now < 5000 && trip.state === 'pickup'; now += 100) taxis.step(now);
      expect(trip.state).toBe('riding');
      expect(player.y).toBe(y * 100);
      const taxi = fleet.cars.get(trip.vehicleId)!;
      expect(taxi.entry.y).toBe(y * 100);
      expect(messages.some(message => message.type === 'ROBOTAXI_STATE' && message.state === 'unavailable')).toBe(false);
    }
    let player: Pose = { x: 2500, y: 2500, z: 0, yaw: 0, flags: 0 };
    const fleet = new WorldVehicles({ emit: () => undefined, pose: (_, pose) => { player = pose; } });
    const taxis = new LocalRobotaxis(fleet, { emit: () => undefined, locate: () => player }, roads);
    expect(taxis.hail(1, 1, { x: 9000, y: 0, z: 0 }, 1000)).toBe(false);
    expect(fleet.occupants.size).toBe(0);
    expect(player.y).toBe(2500);
  }
  // The founder's initial plaza hail still reaches the real Ferry curb.
  const roads = new LocalRoads();
  const pickup = roads.snap(LOCAL_SPAWN, 35, 3)!;
  expect(pickup).toBeDefined();
  expect(roads.route(pickup, roads.snap(LOCAL_TAXI_DESTINATION)!)?.length).toBeGreaterThan(0);
});

it('completes rides at the resolved destination deck when bridge, ground and tunnel share XZ', () => {
  for (const roads of [new LocalRoads(graph), new PackedRoads(decodePackedRoadGraph(packRoadGraph(packedGraph)))]) {
    for (const madMax of [false, true]) for (const { y } of levels) {
      switches.madMaxRobotaxi = madMax;
      let player: Pose = { x: 2500, y: y * 100, z: 0, yaw: 0, flags: 0 };
      const messages: S2CMessage[] = [];
      const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (_, pose) => { player = pose; } });
      const taxis = new LocalRobotaxis(fleet, { emit: message => messages.push(message), locate: () => player }, roads);
      // Small centre/height rounding differences are allowed after centimetre encoding.
      expect(taxis.hail(1, 1, { x: 4000, y: y * 100 + 1, z: 1 }, 1000)).toBe(true);
      expect(taxis.trips.get(1)?.ride.at(-1)?.to).toEqual([40, y, 0]);
      for (let now = 1100; now < 10_000 && taxis.trips.size; now += 100) taxis.step(now);
      expect(taxis.trips.size).toBe(0);
      expect(fleet.occupants.size).toBe(0);
      expect(player.y).toBe(y * 100);
      expect(player.flags).toBe(0);
      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'ROBOTAXI_STATE', state: 'arrived', pose: expect.objectContaining({ x: 4000, y: y * 100, z: 0 }),
      })]));
    }
  }
});

it('waits at an endpoint curb for classic boarding or timeout, while instant pickup still boards', () => {
  for (const roads of [new LocalRoads(graph), new PackedRoads(decodePackedRoadGraph(packRoadGraph(packedGraph)))]) {
    switches.madMaxRobotaxi = false;
    let player: Pose = { x: -1200, y: 0, z: 0, yaw: 0, flags: 0 };
    const messages: S2CMessage[] = [];
    const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (_, pose) => { player = pose; } });
    const taxis = new LocalRobotaxis(fleet, { emit: message => messages.push(message), locate: () => player }, roads);
    const destination = { x: 9000, y: 0, z: 0 };
    expect(taxis.hail(1, 1, destination, 1000)).toBe(true);
    const trip = taxis.trips.get(1)!;
    for (let now = 1100; now <= 3000; now += 100) taxis.step(now);
    expect(trip.state).toBe('pickup');
    expect(fleet.occupants.size).toBe(0);
    expect(fleet.cars.get(trip.vehicleId)?.entry).toMatchObject({ x: 0, y: 0, z: 0, speedCmps: 0 });
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'ROBOTAXI_STATE', state: 'pickup', etaSeconds: 0,
    })]));
    // Walk from the plaza to the waiting cab, then complete the originally requested ride.
    player.x = -500;
    taxis.step(3100);
    expect(trip.state).toBe('riding');
    for (let now = 3200; now < 15_000 && taxis.trips.size; now += 100) taxis.step(now);
    expect(taxis.trips.size).toBe(0);
    expect(player.x).toBe(9000);
    expect(player.flags).toBe(0);

    // A waiting cab still retires if nobody walks over to board it.
    player = { x: -1200, y: 0, z: 0, yaw: 0, flags: 0 };
    expect(taxis.hail(1, 2, destination, 20_000)).toBe(true);
    const waiting = taxis.trips.get(1)!.vehicleId;
    taxis.step(80_001);
    expect(taxis.trips.size).toBe(0);
    expect(fleet.cars.has(waiting)).toBe(false);
    expect(fleet.occupants.size).toBe(0);
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'ROBOTAXI_STATE', requestId: 2, state: 'cancelled',
    })]));

    switches.madMaxRobotaxi = true;
    expect(taxis.hail(1, 3, destination, 90_000)).toBe(true);
    expect(taxis.trips.get(1)?.state).toBe('riding');
    expect(fleet.occupants.size).toBe(1);
    expect(player.x).toBe(0);
  }
});
