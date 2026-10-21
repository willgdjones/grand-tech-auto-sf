import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-2cprr: a WorldDO instance RESET (Cloudflare replaces it; no webSocketClose, so remove() never stashes) must not
// launder a wanted player's heat, wounds or bust meter: the next instance restores them from the DO's own SQLite.
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
import { CombatPersistence } from './combatPersist';
import { PaidRides } from './paidRides';
import { questStartedBy } from '../founder/missions';

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

function build(storage = mockStorage(), DB?: unknown) {
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null }, blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, DB };
  return { storage, wd: new WorldDO(ctx as never, env as never) as unknown as {
    connections: Map<unknown, unknown>;
    peers: Map<number, { id: number }>;
    wantedStates: Map<number, { state: { heat: number; lastCrimeMs: number }; level: number }>;
    bustStates: Map<number, { holdMs: number }>;
    combat: { setHealth(id: number, h: number): void; healthOf(id: number): number; isProtected(id: number, now: number): boolean };
    saveCombatState(now: number): void;
    settleBust(peer: unknown, now: number): Promise<void>;
    settlePvpDeath(peer: unknown, now: number): Promise<void>;
    paidRides: PaidRides;
    quickTaxiServices(): { refundDispatched?(id: number, rideId: string): Promise<boolean> };
    missions: Map<number, { sid: number; gen: number; device: string }>;
    dropGrace: Map<number, unknown>;
    saveRuns(now: number): void;
    webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  } };
}
async function join(wd: ReturnType<typeof build>['wd'], device: string, resumeToken?: string, spawn?: object) {
  const now = Date.now(), sent: { type: string; level?: number }[] = [];
  const socket = { send: (b: Uint8Array) => { const r = decodeS2C(b); sent.push(r.ok ? r.msg as { type: string } : { type: 'BAD' }); }, serializeAttachment: () => {},
    deserializeAttachment: () => ({ kind: 'pending', expiresAt: now + 1e6 }), close: () => {}, readyState: 1 };
  wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device, ...(spawn ? { spawn } : {}) });
  await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', ...(resumeToken ? { resumeToken } : {}) }).buffer as ArrayBuffer);
  return { peer: [...wd.peers.values()].at(-1)! as { id: number; session: { id: number; generation: number; token: string } }, sent };
}

describe('combat state across a WorldDO instance reset (gtasf-2cprr)', () => {
  it('heat, wounds and the bust meter come back on the NEXT instance; no spawn protection while wanted', async () => {
    const first = build(), now = Date.now();
    const { peer } = await join(first.wd, 'dev-reset');
    first.wd.wantedStates.set(peer.id, { state: { heat: 45, lastCrimeMs: now - 2000 }, level: 2 });
    first.wd.combat.setHealth(peer.id, 60);
    first.wd.bustStates.set(peer.id, { holdMs: 1500, lastX: 0, lastZ: 0, lastAt: now } as never);
    first.wd.saveCombatState(now);
    // The runtime replaces the instance: same storage, fresh memory, remove() never ran.
    const second = build(first.storage);
    const { peer: back, sent } = await join(second.wd, 'dev-reset');
    expect(second.wd.wantedStates.get(back.id)?.state.heat).toBeCloseTo(45, 0);
    expect(second.wd.combat.healthOf(back.id)).toBe(60);
    expect(second.wd.bustStates.get(back.id)?.holdMs).toBe(1500);
    expect(second.wd.combat.isProtected(back.id, Date.now())).toBe(false);
    expect(sent.find(m => m.type === 'WANTED')?.level).toBeGreaterThan(0);
  });
  it('a clean player leaves no row; a row older than the stash TTL is not restored', async () => {
    const first = build(), now = Date.now();
    const { peer } = await join(first.wd, 'dev-old');
    first.wd.wantedStates.set(peer.id, { state: { heat: 45, lastCrimeMs: now }, level: 2 });
    first.wd.saveCombatState(now - 120_000); // last saved two minutes before the rejoin
    const second = build(first.storage);
    const { peer: back, sent } = await join(second.wd, 'dev-old');
    expect(second.wd.wantedStates.has(back.id)).toBe(false);
    expect(sent.filter(m => m.type === 'WANTED')).toEqual([{ type: 'WANTED', level: 0 }]);
  });
});

describe('settles forget the persisted row at once (gtasf-h6xe8)', () => {
  for (const settle of ['settleBust', 'settlePvpDeath'] as const) it(`${settle}: a reset before the next save restores no heat`, async () => {
    const first = build(), now = Date.now();
    const { peer } = await join(first.wd, `dev-${settle}`);
    first.wd.wantedStates.set(peer.id, { state: { heat: 45, lastCrimeMs: now }, level: 2 });
    first.wd.saveCombatState(now);
    await first.wd[settle](peer, now).catch(() => undefined); // the D1 debit fails here (no DB); the row must already be gone
    const second = build(first.storage);
    const { peer: back } = await join(second.wd, `dev-${settle}`);
    expect(second.wd.wantedStates.has(back.id)).toBe(false);
  });
});

describe('CombatPersistence', () => {
  it('upserts dirty devices, deletes a device once clean, re-stamps a steady row, prunes stale rows', () => {
    const { sql } = mockStorage(), store = new CombatPersistence(sql);
    const count = () => (sql.exec('SELECT COUNT(*) AS n FROM combat_state').toArray()[0] as { n: number }).n;
    store.save([['a', { heat: 30, lastCrimeMs: 1, health: 100, bustMs: 0 }], ['b', undefined]], 1000);
    expect(count()).toBe(1);
    store.save([['a', { heat: 30, lastCrimeMs: 1, health: 100, bustMs: 0 }]], 30_000); // unchanged but 29 s old: re-stamped
    expect(store.take('a', 80_000, 60_000)?.savedAt).toBe(30_000);
    expect(count()).toBe(0); // take() consumes
    store.save([['a', { heat: 30, lastCrimeMs: 1, health: 100, bustMs: 0 }]], 100_000);
    store.save([['a', undefined]], 102_000);
    expect(count()).toBe(0);
    store.save([['c', { heat: 0, lastCrimeMs: 0, health: 40, bustMs: 0 }]], 200_000);
    store.prune(300_000, 60_000);
    expect(count()).toBe(0);
  });
  it('fails open: a broken storage never throws from construct, save, take, forget or prune', () => {
    const broken = { exec: () => { throw new Error('SQLITE_IOERR'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new CombatPersistence(broken);
    expect(() => { store.save([['a', { heat: 1, lastCrimeMs: 1, health: 50, bustMs: 0 }]], 1); store.take('a', 1, 60_000); store.forget('a'); store.prune(1, 1); }).not.toThrow();
    expect(store.take('a', 1, 60_000)).toBeUndefined();
    warn.mockRestore();
  });
});

describe('quick-robotaxi fares across a WorldDO instance reset (gtasf-vmpq1)', () => {
  /** Fake D1: records refundRide's batch (one UPDATE + one DELETE per refund). */
  function fakeDb() {
    const refunds: unknown[][] = [];
    return { refunds, db: { prepare: (_sql: string) => ({ bind: (...args: unknown[]) => ({ args }) }),
      batch: async (statements: { args: unknown[] }[]) => { refunds.push(statements[1]!.args); return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]; } } };
  }
  it('a ride charged but not arrived when the instance died is refunded once by the next instance, then dropped', async () => {
    const first = build();
    first.wd.paidRides.charged(7, 'ride-orphan', 'dev-taxi', Date.now());
    const d1 = fakeDb(), second = build(first.storage, d1.db);
    await new Promise(r => setTimeout(r, 0));
    expect(d1.refunds).toEqual([['ride-orphan', 'dev-taxi']]); // DELETE FROM robotaxi_fares WHERE ride_id=? AND device_id=?
    expect(second.wd.paidRides.orphans()).toEqual([]);
    const third = fakeDb(); build(first.storage, third.db); await new Promise(r => setTimeout(r, 0));
    expect(third.refunds).toEqual([]); // never twice
  });
  it('review LOW (d4zmv): a kerb refund that fails keeps the row, and the next instance refunds it', async () => {
    const broken = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('D1 down'); } };
    const first = build(undefined, broken);
    first.wd.paidRides.charged(5, 'ride-kerb', 'dev-kerb', Date.now());
    await expect(first.wd.quickTaxiServices().refundDispatched!(5, 'ride-kerb')).rejects.toThrow('D1 down');
    const d1 = fakeDb(); build(first.storage, d1.db); await new Promise(r => setTimeout(r, 0));
    expect(d1.refunds).toEqual([['ride-kerb', 'dev-kerb']]);
  });
  it('an arrived ride and a cancelled one (no trip left) are not refunded after a reset', async () => {
    const first = build();
    first.wd.paidRides.charged(1, 'ride-arrived', 'dev-a', Date.now()); first.wd.paidRides.settled(1);
    first.wd.paidRides.charged(2, 'ride-cancelled', 'dev-b', Date.now()); first.wd.paidRides.sweep(() => false);
    const d1 = fakeDb(); build(first.storage, d1.db); await new Promise(r => setTimeout(r, 0));
    expect(d1.refunds).toEqual([]);
  });
});

describe('in-progress runs across a WorldDO instance reset (gtasf-yufot)', () => {
  async function startedRun() {
    const first = build(), now = Date.now();
    const { peer } = await join(first.wd, 'dev-run');
    first.wd.missions.set(peer.id, { missionId: 'steal-pitch-deck', startMs: now - 30_000, sid: peer.id, gen: peer.session.generation, device: 'dev-run', reached: 1 } as never);
    first.wd.saveRuns(now);
    return { first, peer, now };
  }
  it('the next instance holds the run in grace; a plain resume keeps it, still started by this session', async () => {
    const { first, peer } = await startedRun();
    const second = build(first.storage);
    expect(second.wd.missions.get(peer.id)?.device).toBe('dev-run');
    expect(second.wd.dropGrace.has(peer.id)).toBe(true);
    const { peer: back } = await join(second.wd, 'dev-run', peer.session.token);
    expect(back.id).toBe(peer.id);
    expect(questStartedBy(second.wd.missions.get(peer.id)!, back)).toBe(true);
  });
  it('a ?at= resume after the reset drops the restored run (anti-teleport kept)', async () => {
    const { first, peer } = await startedRun();
    const second = build(first.storage);
    await join(second.wd, 'dev-run', peer.session.token, { x: 0, y: 0, z: 0, yaw: 0, flags: 0 });
    expect(second.wd.missions.has(peer.id)).toBe(false);
  });
  it('a row saved more than a minute before the instance started is not restored', async () => {
    const first = build(), now = Date.now();
    const { peer } = await join(first.wd, 'dev-old-run');
    first.wd.missions.set(peer.id, { missionId: 'steal-pitch-deck', startMs: now, sid: peer.id, gen: peer.session.generation, device: 'dev-old-run', reached: 0 } as never);
    first.wd.saveRuns(now - 120_000);
    expect(build(first.storage).wd.missions.has(peer.id)).toBe(false);
  });
});
