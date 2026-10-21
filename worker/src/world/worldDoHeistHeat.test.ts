import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// heistHeatOnLeave (critic N47): the heist's wanted heat is raised when the player first gets 50 m from the grab, not at
// mission-start (a cruiser could already be parked at the office). Off: the instant raise is unchanged.
const flagState = vi.hoisted(() => ({ heistHeatOnLeave: true }));
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  const flags = { ...actual.flags, multiplayer: true, missions: true, coopHeist: false, acquihireQuest: false, timeTrials: false, fundingLoop: false,
    chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false, referrals: false, proximityVoice: false,
    fundDrops: false, combat: false, outbidBanner: false, outbidCrown: false, streetRaces: false, mostWantedBounty: false };
  return { ...actual, flags: new Proxy(flags, { get: (t, k) => k === 'heistHeatOnLeave' ? flagState.heistHeatOnLeave : (t as Record<string | symbol, unknown>)[k] }) };
});
vi.mock('../funding/identity', async orig => ({ ...(await orig<object>()), fundingDevice: vi.fn(async (r: Request) => r.headers.get('x-dev')) }));
vi.mock('../funding/credits', async orig => ({ ...(await orig<object>()), creditedRefs: vi.fn(async () => new Set<string>()) }));
vi.mock('../funding/store', async orig => ({ ...(await orig<object>()), getFundingProfile: vi.fn(async (_db: unknown, d: string) => ({ deviceId: d })) }));

import { missionById } from '@gtasf/shared/founder/missions';
import { project } from '../funding/anchors';
import { WorldDO } from './WorldDO';

function mockStorage() {
  const db = new DatabaseSync(':memory:');
  const sql = (q: string, ...params: (string | number | null)[]) => {
    const st = db.prepare(q), read = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) || /\breturning\b/i.test(q);
    const rows = read ? st.all(...params) : (st.run(...params), []);
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => (rows as unknown[])[Symbol.iterator]() };
  };
  return { sql: Object.assign(sql, { exec: sql }), transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
type Pose = { x: number; y: number; z: number; yaw: number; flags: number };
type Peer = { id: number; session: { id: number; generation: number; name: string }; fundingDeviceId: string; pose: Pose; send(b: Uint8Array): void };
type DO = { missions: Map<number, { heatPendingAt?: unknown }>; peers: Map<number, Peer>; funding: unknown; fetch(r: Request): Promise<Response>;
  notePoseProgress(p: Peer): void; raiseWantedForDevice(device: string, reason: string, now: number): void };
const HEIST = missionById('steal-pitch-deck')!;
const at = (dxM = 0): Pose => { const q = project(HEIST.start.lat, HEIST.start.lon); return { x: Math.round((q.x + dxM) * 100), y: 0, z: Math.round(q.z * 100), yaw: 0, flags: 0 }; };
function build() {
  const storage = mockStorage();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null },
    blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const wd = new WorldDO(ctx as never, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, DB: { tag: 'db' } } as never) as unknown as DO;
  wd.funding = { award: vi.fn(async () => ({ credited: true })), disconnect: vi.fn(), tick: vi.fn() };
  const raise = vi.spyOn(wd, 'raiseWantedForDevice').mockImplementation(() => {});
  const peer: Peer = { id: 1, session: { id: 1, generation: 1, name: 'LEAD' }, fundingDeviceId: 'lead', pose: at(), send: () => {} };
  wd.peers.set(1, peer);
  return { wd, raise, peer };
}
const start = async (wd: DO) => (await wd.fetch(new Request('https://x.test/api/funding/mission-start', { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dev': 'lead' }, body: JSON.stringify({ missionId: HEIST.id, sid: 1 }) }))).json() as Promise<Record<string, unknown>>;

beforeEach(() => { vi.clearAllMocks(); flagState.heistHeatOnLeave = true; });

describe('heistHeatOnLeave', () => {
  it('no heat at the grab; raised once, on the first accepted pose past 50 m', async () => {
    const { wd, raise, peer } = build();
    expect(await start(wd)).toMatchObject({ status: 'started' });
    expect(raise).not.toHaveBeenCalled();
    peer.pose = at(30); wd.notePoseProgress(peer);
    expect(raise).not.toHaveBeenCalled(); // still in the block
    peer.pose = at(55); wd.notePoseProgress(peer);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0]!.slice(0, 2)).toEqual(['lead', 'heist']);
    peer.pose = at(120); wd.notePoseProgress(peer); peer.pose = at(10); wd.notePoseProgress(peer);
    expect(raise).toHaveBeenCalledTimes(1); // once per run
  });
  it('flag off: the heat lands at mission-start, as before', async () => {
    flagState.heistHeatOnLeave = false;
    const { wd, raise, peer } = build();
    await start(wd);
    expect(raise).toHaveBeenCalledTimes(1);
    peer.pose = at(80); wd.notePoseProgress(peer);
    expect(raise).toHaveBeenCalledTimes(1);
  });
});
