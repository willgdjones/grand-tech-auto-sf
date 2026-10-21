import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Garage phase 1 WorldDO conditions (gtasf-n1bns, docs/PLAN-garage.md; reviewer pre-review [1]-[4]): drive the real
// handleGarageDeliver / handleGarageKeep against a stubbed DO base, as worldDoResume.test.ts does.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, driving: true, personalCar: true, garageSlots: true, economyV3: false,
    fundingLoop: false, chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false, referrals: false,
    proximityVoice: false, fundDrops: false, combat: false, outbidBanner: false, outbidCrown: false } };
});
// Wanted heat is a combat path; let the garage read it without booting combat on HELLO.
vi.mock('@gtasf/shared/combat/wanted', async orig => ({ ...(await orig<typeof import('@gtasf/shared/combat/wanted')>()), wantedRaiseAllowed: () => true }));

import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import type { Pose } from '@gtasf/shared/protocol/types';
import { WorldDO } from './WorldDO';
import { flags } from '@gtasf/shared/flags';
import { keepCar } from './garage';
import { savePersonalCar } from './personalCar';

function mockStorage() {
  const db = new DatabaseSync(':memory:');
  const sql = (q: string, ...params: (string | number | null)[]) => {
    const stmt = db.prepare(q), read = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) || /\breturning\b/i.test(q);
    const rows = read ? stmt.all(...params) : (stmt.run(...params), []);
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => (rows as unknown[])[Symbol.iterator]() };
  };
  return { sql: Object.assign(sql, { exec: sql }), transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0051_personal_cars.sql', '0054_garage.sql']) sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  return { prepare(q: string) { const st = sqlite.prepare(q); let b: (string | number)[] = [];
    const w = { bind(...v: (string | number)[]) { b = v; return w; }, async first() { return st.get(...b) ?? null; },
      async all() { return { results: st.all(...b) }; }, async run() { st.run(...b); return {}; } }; return w; } } as unknown as D1Database;
}
const socket = () => ({ send: () => {}, serializeAttachment: () => {}, deserializeAttachment: () => ({ kind: 'pending', expiresAt: Date.now() + 1e6 }), close: () => {}, readyState: 1 });

type Garage = {
  sessions: { admit(name: string, token: string | undefined, now: number): { id: number; token: string } };
  connections: Map<unknown, unknown>; peers: Map<number, { id: number; pose: Pose }>;
  webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  wantedStates: Map<number, { state: { heat: number }; level: number }>;
  garageDeliverAt: Map<string, number>;
  vehicles: { cars: Map<number, { entry: Pose & { id: number; driverId: number } }>; enter(p: number, pose: Pose, id: number, now: number, reach?: number): boolean;
    claimPersonal(p: number, id: number, now: number): void; personalCarOf(p: number): { id: number } | undefined };
  handleGarageDeliver(r: Request): Promise<Response>; handleGarageKeep(r: Request): Promise<Response>; handlePersonalCarDeliver(r: Request): Promise<Response>;
  personalPeer: unknown; garageRound: unknown; deliverPose: unknown;
};

async function world(device = 'dev-g', roundId = 'series-a') {
  const storage = mockStorage(), DB = d1();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null },
    blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const wd = new WorldDO(ctx as never, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, DB } as never) as unknown as Garage;
  const join = async () => {
    const now = Date.now(), session = wd.sessions.admit('Tester', undefined, now), s = socket();
    wd.connections.set(s, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device });
    await wd.webSocketMessage(s, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    return session.id;
  };
  let next = 0; // a fresh, clear road pose for each delivery
  wd.personalPeer = async (_r: Request, sid?: number) => ({ device, peer: [...wd.peers.values()].find(p => sid === undefined || p.id === sid) });
  wd.garageRound = async () => ({ id: roundId });
  wd.deliverPose = () => ({ pose: { x: 50_000 + 2_000 * ++next, y: 300, z: -50_000, yaw: 0, flags: 0 }, blocked: false });
  return { wd, DB, join, device };
}
const post = (path: string, body: object) => new Request(`https://gtasf.test/api/funding/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('garage WorldDO conditions (gtasf-n1bns)', () => {
  it('[1] one device-wide cooldown, across tabs and slots', async () => {
    const { wd, DB, join, device } = await world();
    const a = await join(), b = await join(); // two tabs, one device
    await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
    await keepCar(DB, device, 1, 'tesla', { id: 'series-a' }, 2);
    expect((await wd.handleGarageDeliver(post('garage-deliver', { slot: 0, sid: a }))).status).toBe(200);
    const again = await wd.handleGarageDeliver(post('garage-deliver', { slot: 1, sid: a }));
    expect(again.status).toBe(429); // another slot, same device: still cooling down
    expect((await wd.handleGarageDeliver(post('garage-deliver', { slot: 1, sid: b }))).status).toBe(429); // the other tab too
  });
  it('[1] one live delivered car per device: delivering from tab B removes tab A\'s parked car', async () => {
    const { wd, DB, join, device } = await world();
    const a = await join(), b = await join();
    await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
    await keepCar(DB, device, 1, 'tesla', { id: 'series-a' }, 2);
    expect((await wd.handleGarageDeliver(post('garage-deliver', { slot: 0, sid: a }))).status).toBe(200);
    expect(wd.vehicles.personalCarOf(a)).toBeDefined();
    wd.garageDeliverAt.clear(); // past the cooldown
    expect((await wd.handleGarageDeliver(post('garage-deliver', { slot: 1, sid: b }))).status).toBe(200);
    expect(wd.vehicles.personalCarOf(a)).toBeUndefined();
    expect(wd.vehicles.personalCarOf(b)).toBeDefined();
  });
  it('[3] no delivery while wanted', async () => {
    const { wd, DB, join, device } = await world();
    const a = await join();
    await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
    wd.wantedStates.set(a, { state: { heat: 1e9 }, level: 5 });
    const res = await wd.handleGarageDeliver(post('garage-deliver', { slot: 0, sid: a }));
    expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ status: 'wanted' });
  });
  it('[4] a car above a lower round\'s slot count is hidden and can\'t be delivered', async () => {
    const { wd, DB, join, device } = await world('dev-g', 'seed'); // 2 slots
    const a = await join();
    await keepCar(DB, device, 2, 'tesla', { id: 'series-a' }, 1); // kept when the device had 3 slots
    const res = await wd.handleGarageDeliver(post('garage-deliver', { slot: 2, sid: a }));
    expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ status: 'hidden' });
  });
  it('[2] keep: only while driving, and never another player\'s own car', async () => {
    const { wd, join } = await world();
    const a = await join(), other = await join();
    expect((await wd.handleGarageKeep(post('garage-keep', { slot: 1, sid: a }))).status).toBe(409); // not driving
    const [carId, car] = [...wd.vehicles.cars.entries()].find(([, c]) => ['prius', 'tesla', 'subaru', 'supercar'].includes((c.entry as unknown as { kind: string }).kind))!;
    wd.vehicles.claimPersonal(other, carId, Date.now()); // the other player's own car
    wd.peers.get(a)!.pose = { ...car.entry, flags: 0 };
    expect(wd.vehicles.enter(a, car.entry, carId, Date.now())).toBe(true);
    const owned = await wd.handleGarageKeep(post('garage-keep', { slot: 1, sid: a }));
    expect(owned.status).toBe(409); expect(await owned.json()).toMatchObject({ reason: 'owned' });
  });
  it('reviewer (A): under the flag the old /personal-car-deliver is the garage\'s slot 0 (wanted block + device cooldown)', async () => {
    const { wd, DB, join, device } = await world();
    const a = await join(), b = await join();
    await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
    wd.wantedStates.set(a, { state: { heat: 1e9 }, level: 5 });
    expect(await (await wd.handlePersonalCarDeliver(post('personal-car-deliver', { sid: a }))).json()).toMatchObject({ status: 'wanted' });
    expect((await wd.handlePersonalCarDeliver(post('personal-car-deliver', { sid: b }))).status).toBe(200);
    expect((await wd.handlePersonalCarDeliver(post('personal-car-deliver', { sid: b }))).status).toBe(429); // device cooldown
  });
  it('reviewer (B): with the garage off, the old /personal-car-deliver still refuses while wanted', async () => {
    const was = flags.garageSlots; (flags as { garageSlots: boolean }).garageSlots = false;
    try {
      const { wd, DB, join, device } = await world();
      const a = await join();
      await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
      wd.wantedStates.set(a, { state: { heat: 1e9 }, level: 5 });
      const res = await wd.handlePersonalCarDeliver(post('personal-car-deliver', { sid: a }));
      expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ status: 'wanted' });
    } finally { (flags as { garageSlots: boolean }).garageSlots = was; }
  });
  it('reviewer LOW: a tab driving its own car refuses the delivery before anything is removed', async () => {
    const { wd, DB, join, device } = await world();
    const a = await join(), b = await join();
    await savePersonalCar(DB, device, 'prius', { x: 1, y: 2, z: 3, yaw: 0, flags: 0 }, 1);
    expect((await wd.handleGarageDeliver(post('garage-deliver', { slot: 0, sid: a }))).status).toBe(200);
    const mine = wd.vehicles.personalCarOf(a)!, car = wd.vehicles.cars.get(mine.id)!;
    wd.peers.get(a)!.pose = { ...car.entry, flags: 0 };
    expect(wd.vehicles.enter(a, car.entry, mine.id, Date.now())).toBe(true); // tab A is driving it
    wd.garageDeliverAt.clear();
    wd.peers.get(b)!.pose = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
    expect(await (await wd.handleGarageDeliver(post('garage-deliver', { slot: 0, sid: b }))).json()).toMatchObject({ status: 'taken' });
    expect(wd.vehicles.personalCarOf(a)?.id).toBe(mine.id); // untouched
  });
});
