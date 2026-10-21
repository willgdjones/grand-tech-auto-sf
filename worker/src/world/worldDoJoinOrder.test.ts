import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-awnin (P0): a wanted player who reloaded was locked out — install() sent WANTED (and PICKUP_STATE) BEFORE the
// WELCOME, the client closed 4004 'Welcome required', remove() re-stashed the heat, and every retry repeated it.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, combat: true, wanted: true, vitalsPickups: true,
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
    webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  };
}

describe('join ordering (gtasf-awnin)', () => {
  it('a reconnecting WANTED player gets WELCOME first, then WANTED + taken pickups', async () => {
    const wd = build();
    const now = Date.now(), device = 'dev-wanted';
    wd.combatStash.set(device, { state: { heat: 40, lastCrimeMs: now - 1000 }, health: 100, expiresAt: now + 60_000 });
    wd.pickupTakenUntil[0] = now + 30_000;
    const sent: string[] = [];
    const socket = { send: (b: Uint8Array) => { const r = decodeS2C(b); sent.push(r.ok ? r.msg.type : 'BAD'); }, serializeAttachment: () => {},
      deserializeAttachment: () => ({ kind: 'pending', expiresAt: now + 1e6 }), close: () => {}, readyState: 1 };
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester' }).buffer as ArrayBuffer);
    expect(sent[0]).toBe('WELCOME');
    expect(sent.indexOf('WANTED')).toBeGreaterThan(0);
    expect(sent.indexOf('PICKUP_STATE')).toBeGreaterThan(0);
  });

  it('gtasf-igk2q: a rejoin with no restored heat still gets WANTED 0 (clears a stale client star)', async () => {
    const wd = build();
    const now = Date.now();
    const sent: { type: string; level?: number }[] = [];
    const socket = { send: (b: Uint8Array) => { const r = decodeS2C(b); sent.push(r.ok ? (r.msg as { type: string; level?: number }) : { type: 'BAD' }); }, serializeAttachment: () => {},
      deserializeAttachment: () => ({ kind: 'pending', expiresAt: now + 1e6 }), close: () => {}, readyState: 1 };
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: 'dev-clean' });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester' }).buffer as ArrayBuffer);
    expect(sent[0]!.type).toBe('WELCOME');
    const wanted = sent.filter(m => m.type === 'WANTED');
    expect(wanted).toEqual([{ type: 'WANTED', level: 0 }]);
  });
});
