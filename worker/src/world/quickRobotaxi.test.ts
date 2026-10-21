import { expect, test, vi } from 'vitest';
vi.mock('@gtasf/shared/flags', () => ({ flags: { quickRobotaxi: true, robotaxi: true, economyV3: true, zonedWorld: false, madMaxRobotaxi: true } }));
import type { Point, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { LocalRoads } from './localRoads';
import { LocalRobotaxis } from './localRobotaxi';
import { WorldVehicles, PASSENGER_FLAG } from './vehicles';
import { createQuickTaxiBilling, kerbExit, kerbLaneIds, safeQuickDrop, type QuickTaxiServices } from './quickRobotaxi';
const roads = new LocalRoads({ version: 1, nodes: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 2000, y: 0, z: 0 }],
  edges: [{ id: 'lane:test', from: 'a', to: 'b', lane: 1, lengthM: 2000, speedMps: 10, points: [[0, 0, 0], [2000, 0, 0]] }] });
const target = { title: 'An event', eventId: 'event', friend: '', maxFareCents: '55000' };
const destination: Point = { x: 80000, y: 0, z: 0 };
const rings = [{ x: 800, y: 0, z: 0, radiusM: 12 }];
function setup(affordable = true) {
  let now = 1000;
  const poses = new Map<number, Pose>([[1, { x: 10000, y: 0, z: 0, yaw: 64, flags: 0 }]]), messages: S2CMessage[] = [];
  const fleet = new WorldVehicles({ emit: m => messages.push(m), pose: (id, pose) => poses.set(id, pose) });
  const charged = vi.fn(async (_id: number, rideId: string) => ({ ok: true as const, rideId, chargedCents: '0', free: true, replay: false }));
  const arrived = vi.fn();
  const services: QuickTaxiServices = { now: () => now,
    resolve: async () => ({ ...safeQuickDrop(roads, destination, rings)!, title: target.title }),
    quote: async () => ({ fareCents: '20000', chargeCents: affordable ? '0' : '20000', free: affordable, freeRidesLeft: affordable ? 3 : 0, currentCents: '0', affordable }),
    charge: charged, arrived };
  const taxis = new LocalRobotaxis(fleet, { emit: m => messages.push(m), locate: id => poses.get(id) }, roads, services);
  const step = (at: number) => { now = at; taxis.step(now); };
  return { taxis, poses, fleet, messages, charged, arrived, step };
}
test('drop and exit are outside event rings, including map pins; friends remain within 50m', () => {
  const drop = safeQuickDrop(roads, destination, rings)!;
  expect(Math.hypot(drop.pose.x / 100 - 800, drop.pose.z / 100)).toBeGreaterThan(24.2);
  const friend = safeQuickDrop(roads, destination, rings, 50)!;
  expect(Math.hypot(friend.pose.x / 100 - 800, friend.pose.z / 100)).toBeLessThan(47.8);
  expect(safeQuickDrop(roads, { x: 80000, y: 0, z: 100000 }, rings)).toBeNull();
});
test('short pickup, duplicate hail, ready handshake, authoritative jump and on-foot exit', async () => {
  const { taxis, poses, fleet, messages, charged, arrived, step } = setup();
  const first = taxis.hailQuick(1, 7, destination, target, 1000);
  await taxis.hailQuick(1, 7, destination, target, 1000); await first;
  expect(charged).toHaveBeenCalledTimes(1);
  expect(taxis.ready(1, 7)).toBe(false); // cannot skip pickup by pre-acknowledging
  for (let now = 1100; now <= 5000; now += 100) step(now);
  expect(taxis.trips.get(1)?.state).toBe('quick'); expect(poses.get(1)?.flags).toBe(PASSENGER_FLAG);
  expect(poses.get(1)!.x).toBeLessThan(12000); // has not driven the cross-city route
  expect(taxis.ready(2, 7)).toBe(false); expect(taxis.ready(1, 8)).toBe(false);
  expect(taxis.ready(1, 7)).toBe(true); step(5100);
  expect(fleet.occupants.has(1)).toBe(false); expect(poses.get(1)?.flags).toBe(0);
  expect(Math.hypot(poses.get(1)!.x / 100 - 800, poses.get(1)!.z / 100)).toBeGreaterThan(22);
  expect(arrived).toHaveBeenCalledWith(1, 5100);
  expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'ROBOTAXI_STATE', state: 'quick' }), expect.objectContaining({ type: 'ROBOTAXI_STATE', state: 'arrived' })]));
  await taxis.hailQuick(1, 7, destination, target, 6500); expect(charged).toHaveBeenCalledTimes(1);
  step(7000); expect([...fleet.cars.values()].filter(c => c.entry.kind === 'robotaxi')).toHaveLength(0);
});
test('robotaxiJump: the boarded quick cab waits at the curb at speed 0 (no pull-away snap, nothing to wobble)', async () => {
  const { flags } = await import('@gtasf/shared/flags');
  (flags as Record<string, boolean>).robotaxiJump = true;
  try {
    const { taxis, fleet, step } = setup();
    await taxis.hailQuick(1, 7, destination, target, 1000);
    const seen: { x: number; z: number; speed: number }[] = [];
    for (let now = 1100; now <= 3000; now += 100) {
      step(now);
      const trip = taxis.trips.get(1), car = trip && fleet.cars.get(trip.vehicleId);
      if (trip?.state === 'quick' && car) seen.push({ x: car.entry.x, z: car.entry.z, speed: car.entry.speedCmps });
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen.map(p => `${p.x},${p.z}`)).size).toBe(1); // never moves while boarded
    expect(seen.every(p => p.speed === 0)).toBe(true);
  } finally { (flags as Record<string, boolean>).robotaxiJump = false; }
});
test('unaffordable quote never charges or boards; missing READY times out and exits', async () => {
  const denied = setup(false); expect(await denied.taxis.hailQuick(1, 1, destination, target, 1000)).toBe(false);
  expect(denied.charged).not.toHaveBeenCalled(); expect(denied.fleet.occupants.size).toBe(0);
  expect(denied.messages).toContainEqual(expect.objectContaining({ state: 'unaffordable' }));
  const slow = setup(); await slow.taxis.hailQuick(1, 1, destination, target, 1000);
  slow.step(5000); expect(slow.poses.get(1)?.flags).toBe(PASSENGER_FLAG);
  slow.step(10999); expect(slow.fleet.occupants.has(1)).toBe(true);
  slow.step(11000); expect(slow.fleet.occupants.has(1)).toBe(false);
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import { decodePackedRoadGraph, type PackedPublicRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { encodeC2S, decodeC2S } from '@gtasf/shared/protocol/c2s';
import { encodeS2C, decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PackedRoads } from './packedRoads';
import { quoteRide } from '../funding/rides';
import { createRobotaxiClient } from '../../../web/src/vehicles/robotaxi/client';

test('packed-map quote round-trip reaches the client with three free rides using the migrated fare query', async () => {
  const source: PackedPublicRoadGraph = { version: 1, warnings: [],
    nodes: roads.graph.nodes.map(n => ({ ...n, osmNode: n.id })),
    edges: roads.graph.edges.map(e => ({ ...e, kind: 'lane', osmWay: 1, name: 'Test street', inferredLanes: false, layer: 0, bridge: false, tunnel: false, next: [] })) };
  const packed = new PackedRoads(decodePackedRoadGraph(packRoadGraph(source)));
  expect(packed.graph.edges).toHaveLength(0); // production storage, not the tiny LocalRoads fixture
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const now = Date.UTC(2026, 9, 5, 18);
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at,economy_v3_current_cents,economy_v3_lifetime_cents,economy_v3_burn_updated_at,free_rides_used) VALUES(?,?,?,?,?,?,0,0,?,0)')
    .run('test-profile', 'test-token-hash', 'Fogware', 'Founder', now, now, now);
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const query = { bind(...values: (string | number | null)[]) { bindings = values; return query; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings), success: true }; } };
    return query;
  } } as unknown as D1Database;
  const player: Pose = { x: 10000, y: 0, z: 0, yaw: 64, flags: 0 };
  const quote = vi.fn((_id: number, distance: number) => quoteRide(db, 'test-profile', distance, now));
  const charge = vi.fn(async () => { throw new Error('A quote must not charge'); });
  const fleet = new WorldVehicles({ emit() {}, pose() {} });
  const server = new LocalRobotaxis(fleet, { locate: () => player, emit(message) {
    const decoded = decodeS2C(encodeS2C(message)); expect(decoded.ok).toBe(true);
    if (decoded.ok) client.message(decoded.msg);
  } }, packed, {
    resolve: async (_id, point) => { const drop = safeQuickDrop(packed, point, rings); return drop && { ...drop, title: 'An event' }; },
    quote, charge,
  });
  const requests: Promise<void>[] = [];
  const client = createRobotaxiClient({ send(message) {
    const decoded = decodeC2S(encodeC2S(message)); expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.msg.type === 'ROBOTAXI_QUOTE') requests.push(server.quoteQuick(1, decoded.msg.requestId, decoded.msg.destination, decoded.msg.quick));
    return true;
  }, notify() {}, getMode: () => 'on-foot', resolveDestination: d => d });
  try {
    client.setConnected(true);
    await expect(client.quote({ x: 800, y: 0, z: 0, title: 'An event', event: { id: 'event' } }))
      .resolves.toEqual({ label: 'FREE (3 left)', affordable: true, fareCents: '0' });
    await Promise.all(requests);
    expect(quote).toHaveBeenCalledOnce(); expect(charge).not.toHaveBeenCalled(); expect(client.active).toBe(false);
    const drop = safeQuickDrop(packed, destination, rings)!;
    expect(Math.hypot(drop.pose.x / 100 - 800, drop.pose.z / 100)).toBeGreaterThan(24.2);
    expect(sqlite.prepare('SELECT free_rides_used FROM funding_profiles').get()).toMatchObject({ free_rides_used: 0 });
  } finally { sqlite.close(); }
});


test('a disconnect during charge refunds the original profile before hail completes', async () => {
  let finishCharge!: (value: Awaited<ReturnType<QuickTaxiServices['charge']>>) => void;
  let finishRefund!: (value: boolean) => void;
  let device: string | undefined = 'paid-profile';
  const charge = vi.fn((_deviceId: string, _rideId: string, _fareCents: string) => new Promise<Awaited<ReturnType<QuickTaxiServices['charge']>>>(resolve => { finishCharge = resolve; }));
  const refund = vi.fn(() => new Promise<boolean>(resolve => { finishRefund = resolve; }));
  const billing = createQuickTaxiBilling({ device: () => { if (!device) throw new Error('Disconnected'); return device; }, charge, refund });
  let pose: Pose | undefined = { x: 10000, y: 0, z: 0, yaw: 64, flags: 0 };
  const fleet = new WorldVehicles({ emit() {}, pose() {} });
  const taxis = new LocalRobotaxis(fleet, { locate: () => pose, emit() {} }, roads, {
    resolve: async () => ({ ...safeQuickDrop(roads, destination, rings)!, title: 'Event' }),
    quote: async () => ({ fareCents: '20000', chargeCents: '20000', free: false, freeRidesLeft: 0, currentCents: '30000', affordable: true }),
    charge: billing.charge, refund: billing.refund, charged: (_id, _friend, rideId) => billing.dispatched(rideId),
  });
  let finished = false;
  const hail = taxis.hailQuick(1, 19, destination, target, 1000).then(value => { finished = true; return value; });
  await Promise.resolve(); await Promise.resolve(); expect(charge).toHaveBeenCalledOnce();
  const rideId = charge.mock.calls[0]![1];
  taxis.disconnect(1, 1100); pose = undefined; device = undefined;
  finishCharge({ ok: true, rideId, chargedCents: '20000', free: false, replay: false });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(refund).toHaveBeenCalledWith('paid-profile', rideId); expect(finished).toBe(false);
  finishRefund(true); await expect(hail).resolves.toBe(false);
  expect(taxis.trips.size).toBe(0); expect([...fleet.cars.values()].filter(car => car.entry.kind === 'robotaxi')).toHaveLength(0);
  expect(await billing.refund(1, rideId)).toBe(false); expect(refund).toHaveBeenCalledOnce();
});
test('gtasf-sjmkk: no robotaxi stops for a wanted player — quote, quick hail and plain hail are refused, nothing charged', async () => {
  const { fleet, messages, charged, poses } = setup();
  let wanted = true;
  const services: QuickTaxiServices = { now: () => 1000, resolve: async () => ({ ...safeQuickDrop(roads, destination, rings)!, title: target.title }),
    quote: async () => ({ fareCents: '20000', chargeCents: '0', free: true, freeRidesLeft: 3, currentCents: '0', affordable: true }), charge: charged, arrived: vi.fn() };
  const taxis = new LocalRobotaxis(fleet, { emit: m => messages.push(m), locate: id => poses.get(id), wanted: () => wanted }, roads, services);
  await taxis.quoteQuick(1, 1, destination, target);
  expect(await taxis.hailQuick(1, 2, destination, target, 1000)).toBe(false);
  expect(taxis.hail(1, 3, destination, 1000)).toBe(false);
  expect(charged).not.toHaveBeenCalled(); expect(taxis.trips.size).toBe(0);
  expect(messages.filter(m => m.type === 'ROBOTAXI_STATE').map(m => (m as { state: string }).state)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  wanted = false; // lost the cops: the next hail goes through
  expect(await taxis.hailQuick(1, 4, destination, target, 1000)).toBe(true);
  expect(charged).toHaveBeenCalledTimes(1);
});
test('gtasf-d4zmv: heat raised while boarded ends the ride at the kerb — no jump, fare refunded by rideId', async () => {
  const { fleet, messages, charged, poses } = setup();
  let wanted = false;
  const refundDispatched = vi.fn(async () => true);
  const services: QuickTaxiServices = { now: () => 1000, resolve: async () => ({ ...safeQuickDrop(roads, destination, rings)!, title: target.title }),
    quote: async () => ({ fareCents: '20000', chargeCents: '20000', free: false, freeRidesLeft: 0, currentCents: '90000', affordable: true }),
    charge: charged, arrived: vi.fn(), refundDispatched };
  const taxis = new LocalRobotaxis(fleet, { emit: m => messages.push(m), locate: id => poses.get(id), wanted: () => wanted }, roads, services);
  expect(await taxis.hailQuick(1, 9, destination, target, 1000)).toBe(true);
  for (let now = 1100; now <= 5000; now += 100) { taxis.step(now); if (taxis.trips.get(1)?.state === 'quick') break; }
  expect(taxis.trips.get(1)?.state).toBe('quick');
  wanted = true; // e.g. a kerbside robbery completed from the seat
  taxis.step(5200);
  expect(taxis.trips.has(1)).toBe(false);
  expect(poses.get(1)!.x).toBeLessThan(12000); // never jumped to the drop
  expect(fleet.occupants.has(1)).toBe(false);
  const rideId = (charged.mock.calls[0] as unknown as [number, string])[1];
  expect(refundDispatched).toHaveBeenCalledWith(1, rideId);
  expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'ROBOTAXI_STATE', state: 'cancelled' })]));
});

// quickDropKerb (critic N19b): two eastbound lanes of one way; right-hand traffic puts the outer (kerb) lane on the
// south side, which is +z here (+x east, -z north). Lane 1 is the outer lane, 3.2 m south of lane 0.
const twoLanes = new LocalRoads({ version: 1, nodes: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 2000, y: 0, z: 0 }, { id: 'c', x: 0, y: 0, z: 3.2 }, { id: 'd', x: 2000, y: 0, z: 3.2 }],
  edges: [{ id: 'lane:main:0', from: 'a', to: 'b', lane: 0, lengthM: 2000, speedMps: 10, points: [[0, 0, 0], [2000, 0, 0]] },
    { id: 'lane:main:1', from: 'c', to: 'd', lane: 1, lengthM: 2000, speedMps: 10, points: [[0, 0, 3.2], [2000, 0, 3.2]] }] });
async function withKerb<T>(run: () => T | Promise<T>): Promise<T> {
  const { flags } = await import('@gtasf/shared/flags');
  (flags as Record<string, boolean>).quickDropKerb = true;
  try { return await run(); } finally { (flags as Record<string, boolean>).quickDropKerb = false; }
}
test('quickDropKerb: the kerb lane is the outermost lane of each way and direction', () => {
  expect([...kerbLaneIds(twoLanes.graph.edges)]).toEqual(['lane:main:1']);
});
test('quickDropKerb: the drop stops in the kerb lane, still outside the funding rings with the wider margin', async () => {
  const target = { x: 80000, y: 0, z: -50 }; // a pin just north of the inner lane: the old pick took lane 0
  expect(safeQuickDrop(twoLanes, target, rings)!.snap.edge.id).toBe('lane:main:0');
  const drop = await withKerb(() => safeQuickDrop(twoLanes, target, rings)!);
  expect(drop.snap.edge.id).toBe('lane:main:1');
  expect(Math.hypot(drop.pose.x / 100 - 800, drop.pose.z / 100)).toBeGreaterThan(12 + 12.7); // radius + 10 m + 2.6 m step
});
test('quickDropKerb: the passenger steps 2.6 m to the kerb side (south, away from the inner lane), not into traffic', async () => {
  const drop = await withKerb(() => safeQuickDrop(twoLanes, { x: 80000, y: 0, z: 320 }, rings)!);
  const out = kerbExit(drop.pose);
  expect(out.z - drop.pose.z).toBeGreaterThan(250); // +z = south = the kerb beyond the outer lane
  expect(Math.abs(out.x - drop.pose.x)).toBeLessThan(10);
  expect(out.flags).toBe(0);
});
test('quickDropKerb: the arrival exit lands on the kerb side of the cab', async () => {
  await withKerb(async () => {
    const { taxis, poses, fleet, step } = setup();
    await taxis.hailQuick(1, 7, destination, target, 1000);
    for (let now = 1100; now <= 5000; now += 100) step(now);
    taxis.ready(1, 7); const cab = [...fleet.cars.values()].find(c => c.entry.kind === 'robotaxi')!;
    step(5100);
    const cabPose = cab.entry, player = poses.get(1)!;
    expect(fleet.occupants.has(1)).toBe(false);
    expect(player.z - cabPose.z).toBeGreaterThan(250); // the single test lane runs east: kerb side is +z
  });
});
test('quickDropKerb: a building in the kerb step (no sidewalk) falls back to the standard exit step', async () => {
  await withKerb(async () => {
    let now = 1000;
    const poses = new Map<number, Pose>([[1, { x: 10000, y: 0, z: 0, yaw: 64, flags: 0 }]]);
    const fleet = new WorldVehicles({ emit() {}, pose: (id, pose) => poses.set(id, pose) });
    const services: QuickTaxiServices = { now: () => now, resolve: async () => ({ ...safeQuickDrop(roads, destination, rings)!, title: 'x' }),
      quote: async () => ({ fareCents: '0', chargeCents: '0', free: true, freeRidesLeft: 3, currentCents: '0', affordable: true }),
      charge: async (_id, rideId) => ({ ok: true as const, rideId, chargedCents: '0', free: true, replay: false }) };
    const taxis = new LocalRobotaxis(fleet, { emit() {}, locate: id => poses.get(id), kerbStepClear: () => false }, roads, services);
    await taxis.hailQuick(1, 7, destination, target, 1000);
    for (now = 1100; now <= 5000; now += 100) taxis.step(now);
    taxis.ready(1, 7); const cab = [...fleet.cars.values()].find(c => c.entry.kind === 'robotaxi')!;
    now = 5100; taxis.step(now);
    expect(poses.get(1)!.z - cab.entry.z).toBe(210); // WorldVehicles.exit's own 2.1 m step, not the 2.6 m kerb step
  });
});
