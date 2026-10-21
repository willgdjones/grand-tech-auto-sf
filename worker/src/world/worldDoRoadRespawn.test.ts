import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-dtnk7: ROAD_RESPAWN (a ≤200 m road snap) must not let a wanted player on foot jump out of the cuff radius.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, combat: true, wanted: true, vitalsPickups: true, roadRespawn: true,
    fundingLoop: false, chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false,
    referrals: false, proximityVoice: false, fundDrops: false, outbidBanner: false, outbidCrown: false, missions: false, timeTrials: false } };
});

import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { WorldDO } from './WorldDO';

/** node:sqlite shim for the DO storage.sql API (eager exec + toArray/one + transactionSync). */
function mockStorage() {
  const db = new DatabaseSync(':memory:');
  const sql = (strOrTemplate: string, ...params: (string | number | null)[]) => {
    const stmt = db.prepare(strOrTemplate);
    const read = /^\s*(SELECT|PRAGMA|WITH)/i.test(strOrTemplate) || /\breturning\b/i.test(strOrTemplate);
    const rows = read ? stmt.all(...params) : (stmt.run(...params), []);
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => (rows as unknown[])[Symbol.iterator]() };
  };
  return {
    sql: Object.assign(sql, { exec: sql }),
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

function build() {
  const storage = mockStorage();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null }, blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
  // Construct with mocks (stubbed DurableObject base + partial ctx/env); cast to any to reach private test seams.
  return new WorldDO(ctx as never, env as never) as unknown as {
    connections: Map<unknown, unknown>;
    combatStash: Map<string, { state: { heat: number; lastCrimeMs: number }; health: number; expiresAt: number }>;
    pickupTakenUntil: number[];
    peers: Map<number, { id: number; pose: { x: number; y: number; z: number; yaw: number; flags: number } }>;
    wantedStates: Map<number, { state: { heat: number; lastCrimeMs: number }; level: number }>;
    recoveredAt: Map<number, number>;
    recoverRoad(peer: unknown, now: number): void;
    webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  };
}


async function join(wd: ReturnType<typeof build>) {
  const now = Date.now(), sent: { type: string; pose?: unknown }[] = [];
  const socket = { send: (b: Uint8Array) => { const r = decodeS2C(b); sent.push(r.ok ? r.msg as { type: string } : { type: 'BAD' }); }, serializeAttachment: () => {},
    deserializeAttachment: () => ({ kind: 'pending', expiresAt: now + 1e6 }), close: () => {}, readyState: 1 };
  wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: 'dev-road' });
  await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester' }).buffer as ArrayBuffer);
  const peer = [...wd.peers.values()][0]!;
  return { peer, sent };
}

describe('road respawn while wanted (gtasf-dtnk7)', () => {
  it('a wanted player on foot is refused: pose unchanged, CORRECTION to where they stand, no cooldown spent', async () => {
    const wd = build(), { peer, sent } = await join(wd), now = Date.now();
    peer.pose = { ...peer.pose, x: peer.pose.x + 1234, z: peer.pose.z + 4321 }; // off the road
    const before = { ...peer.pose };
    wd.wantedStates.set(peer.id, { state: { heat: 40, lastCrimeMs: now }, level: 2 });
    sent.length = 0;
    wd.recoverRoad(peer, now);
    expect(peer.pose).toEqual(before);
    expect(sent).toEqual([{ type: 'CORRECTION', pose: before }]);
    expect(wd.recoveredAt.has(peer.id)).toBe(false);
  });
  it('an unwanted player still gets the snap (control)', async () => {
    const wd = build(), { peer } = await join(wd), now = Date.now();
    peer.pose = { ...peer.pose, x: peer.pose.x + 1234, z: peer.pose.z + 4321 };
    wd.recoverRoad(peer, now);
    expect(wd.recoveredAt.get(peer.id)).toBe(now);
  });
});
