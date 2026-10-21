import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// WorldDO wiring of the acqui-hire escrow (the money module itself is covered by founder/acquihire.test.ts against real
// SQL). Here the escrow/identity/credit modules are spies, so each test asserts WHICH money call the DO makes.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, missions: true, acquihireQuest: true, economyV3: true, timeTrials: true, fundingLoop: false,
    chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false, referrals: false, proximityVoice: false,
    fundDrops: false, combat: false, outbidBanner: false, outbidCrown: false } };
});
const escrow = vi.hoisted(() => ({
  startAcquisition: vi.fn(), refundAcquisition: vi.fn(async () => true), openAcquisition: vi.fn(async (): Promise<{ acq_id: string } | null> => null), deliverAcquisition: vi.fn(async () => ({ status: 'completed', credited: true, costCents: '500000', payoutCents: '750000' })),
}));
vi.mock('../founder/acquihire', () => escrow);
vi.mock('../funding/identity', async orig => ({ ...(await orig<object>()), fundingDevice: vi.fn(async () => 'dev') }));
vi.mock('../funding/credits', async orig => ({ ...(await orig<object>()), creditedRefs: vi.fn(async () => new Set<string>()) }));
vi.mock('../funding/store', async orig => ({ ...(await orig<object>()), getFundingProfile: vi.fn(async () => ({ deviceId: 'dev' })) }));

import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { missionById } from '@gtasf/shared/founder/missions';
import { project } from '../funding/anchors';
import { missionMinTravelMs } from '../founder/missions';
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
type Run = { missionId: string; startMs: number; sid: number; gen: number; device: string; reached: number; acqId?: string };
type DO = {
  sessions: { admit(name: string, token: string | undefined, now: number): { id: number; generation: number; token: string } };
  missions: Map<number, Run>; peers: Map<number, unknown>; connections: Map<unknown, unknown>; funding: unknown;
  clearDeviceQuests(d: string): void; webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  fetch(r: Request): Promise<Response>;
};
const waits: Promise<unknown>[] = [];
function build(): DO {
  const storage = mockStorage();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null },
    blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: (p: Promise<unknown>) => { waits.push(p); }, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, DB: { tag: 'db' } };
  const wd = new WorldDO(ctx as never, env as never) as unknown as DO;
  wd.funding = { award: vi.fn(), disconnect: vi.fn(), tick: vi.fn() }; // the DO only needs it to exist + be passed through (tick: the world ticker may fire mid-test)
  return wd;
}
const ACQ = missionById('acquihire')!;
const at = (p: { lat: number; lon: number }) => { const q = project(p.lat, p.lon); return { x: Math.round(q.x * 100), y: 0, z: Math.round(q.z * 100), yaw: 0, flags: 0 }; };
function addPeer(wd: DO, sessionId: number, pose: ReturnType<typeof at>, generation = 1) {
  const peer = { id: sessionId, session: { id: sessionId, generation }, fundingDeviceId: 'dev', pose, send: () => {} };
  wd.peers.set(sessionId, peer); return peer;
}
const post = (wd: DO, path: string, body: unknown) => wd.fetch(new Request(`https://x.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => { vi.clearAllMocks(); waits.length = 0; escrow.startAcquisition.mockResolvedValue({ ok: true, acqId: 'acq-1', costCents: '500000', deadlineAt: 9e15 }); });

describe('start', () => {
  it('debits via the escrow and reports the price; a retried start by the same session is a replay (one debit)', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.start));
    const a = await (await post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 })).json();
    expect(a).toMatchObject({ status: 'started', costCents: '500000' });
    expect(wd.missions.get(7)?.acqId).toBe('acq-1');
    const b = await (await post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 })).json();
    expect(b).toMatchObject({ status: 'started', replay: true });
    expect(escrow.startAcquisition).toHaveBeenCalledTimes(1);
  });
  it('a refused purchase (unaffordable) opens no run', async () => {
    escrow.startAcquisition.mockResolvedValue({ ok: false, reason: 'unaffordable' });
    const wd = build(); addPeer(wd, 7, at(ACQ.start));
    const res = await post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 });
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ status: 'refused', reason: 'unaffordable' });
    expect(wd.missions.has(7)).toBe(false);
  });
  it('too far from the burnt-out founder: no debit', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.objectives[0]!.at!));
    expect((await post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 })).status).toBe(409);
    expect(escrow.startAcquisition).not.toHaveBeenCalled();
  });
  it('starting another job supersedes the acqui-hire and refunds it', async () => {
    const wd = build(); addPeer(wd, 7, at(missionById('steal-pitch-deck')!.start));
    wd.missions.set(7, { missionId: 'acquihire', startMs: 0, sid: 7, gen: 1, device: 'dev', reached: 0, acqId: 'acq-old' });
    await post(wd, '/api/funding/mission-start', { missionId: 'steal-pitch-deck', sid: 7 });
    expect(escrow.refundAcquisition).toHaveBeenCalledWith({ tag: 'db' }, 'dev', 'acq-old');
  });
});

describe('refund on teleport / disconnect / resume / abandon', () => {
  it('a teleport or disconnect clear refunds the open escrow; a plain mission refunds nothing', () => {
    const wd = build();
    wd.missions.set(1, { missionId: 'acquihire', startMs: 0, sid: 1, gen: 1, device: 'dev', reached: 0, acqId: 'acq-1' });
    wd.missions.set(2, { missionId: 'steal-pitch-deck', startMs: 0, sid: 2, gen: 1, device: 'dev', reached: 0 });
    wd.clearDeviceQuests('dev');
    expect(wd.missions.size).toBe(0);
    expect(escrow.refundAcquisition).toHaveBeenCalledTimes(1);
    expect(escrow.refundAcquisition).toHaveBeenCalledWith({ tag: 'db' }, 'dev', 'acq-1');
    expect(waits).toHaveLength(1); // kept alive past the request via ctx.waitUntil
  });
  it('a ?at= resume (spawn override) refunds', async () => {
    const wd = build(); const session = wd.sessions.admit('T', undefined, Date.now());
    wd.missions.set(session.id, { missionId: 'acquihire', startMs: 0, sid: session.id, gen: session.generation, device: 'dev', reached: 0, acqId: 'acq-at' });
    const socket = { send: () => {}, serializeAttachment: () => {}, deserializeAttachment: () => ({ kind: 'pending', expiresAt: Date.now() + 1e6 }), close: () => {}, readyState: 1 };
    wd.connections.set(socket, { expiresAt: Date.now() + 1e6, credit: 60, budgetAt: Date.now(), spawn: { x: 100, y: 0, z: -200, yaw: 0, flags: 0 }, fundingDeviceId: 'dev' });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'T', resumeToken: session.token }).buffer as ArrayBuffer);
    expect(escrow.refundAcquisition).toHaveBeenCalledWith({ tag: 'db' }, 'dev', 'acq-at');
  });
  it('abandon refunds and reports it; with no job it is a no-op', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.start));
    wd.missions.set(7, { missionId: 'acquihire', startMs: 0, sid: 7, gen: 1, device: 'dev', reached: 0, acqId: 'acq-1' });
    expect(await (await post(wd, '/api/funding/mission-abandon', { sid: 7 })).json()).toMatchObject({ status: 'abandoned', refunded: true });
    expect(escrow.refundAcquisition).toHaveBeenCalledWith({ tag: 'db' }, 'dev', 'acq-1');
    expect(await (await post(wd, '/api/funding/mission-abandon', { sid: 7 })).json()).toEqual({ status: 'none' });
  });
});

describe('credit at delivery (server-checked)', () => {
  const run = (startMs: number, gen = 1): Run => ({ missionId: 'acquihire', startMs, sid: 7, gen, device: 'dev', reached: 0, acqId: 'acq-1' });
  it('not at the hacker house, or faster than the travel floor: incomplete, escrow kept open', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.start)); wd.missions.set(7, run(Date.now() - 600_000));
    expect(await (await post(wd, '/api/funding/mission-complete', { sid: 7 })).json()).toMatchObject({ status: 'incomplete' });
    const wd2 = build(); addPeer(wd2, 7, at(ACQ.objectives[0]!.at!)); wd2.missions.set(7, run(Date.now() - 1_000)); // instant jump
    expect(await (await post(wd2, '/api/funding/mission-complete', { sid: 7 })).json()).toMatchObject({ status: 'incomplete' });
    expect(escrow.deliverAcquisition).not.toHaveBeenCalled();
    expect(escrow.refundAcquisition).not.toHaveBeenCalled();
    expect(wd.missions.has(7) && wd2.missions.has(7)).toBe(true);
  });
  it('a legitimate delivery pays through the escrow once and ends the run', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.objectives[0]!.at!));
    wd.missions.set(7, run(Date.now() - missionMinTravelMs(ACQ) - 5_000));
    expect(await (await post(wd, '/api/funding/mission-complete', { sid: 7 })).json()).toMatchObject({ status: 'completed', outcome: { payoutCents: '750000' } });
    expect(escrow.deliverAcquisition).toHaveBeenCalledTimes(1);
    expect(escrow.deliverAcquisition.mock.calls[0]!.slice(1, 3)).toEqual(['dev', 'acq-1']);
    expect(wd.missions.has(7)).toBe(false);
  });
  it('the run is removed BEFORE the delivery awaits: a disconnect / abandon landing mid-delivery refunds nothing', async () => {
    let release!: () => void;
    escrow.deliverAcquisition.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: 'completed', credited: true, costCents: '500000', payoutCents: '750000' }); }));
    const wd = build(); addPeer(wd, 7, at(ACQ.objectives[0]!.at!));
    wd.missions.set(7, run(Date.now() - missionMinTravelMs(ACQ) - 5_000));
    const pending = post(wd, '/api/funding/mission-complete', { sid: 7 });
    await new Promise(r => setTimeout(r, 0));
    expect(wd.missions.has(7)).toBe(false);          // gone before the escrow call resolves
    wd.clearDeviceQuests('dev');                      // socket close mid-delivery
    expect(await (await post(wd, '/api/funding/mission-abandon', { sid: 7 })).json()).toEqual({ status: 'none' });
    expect(escrow.refundAcquisition).not.toHaveBeenCalled();
    release();
    expect(await (await pending).json()).toMatchObject({ status: 'completed' });
  });
  it('a resumed session (bumped generation) cannot cash out: the run is dropped and refunded', async () => {
    const wd = build(); addPeer(wd, 7, at(ACQ.objectives[0]!.at!), 2);
    wd.missions.set(7, run(Date.now() - 600_000, 1));
    expect((await post(wd, '/api/funding/mission-complete', { sid: 7 })).status).toBe(409);
    expect(escrow.deliverAcquisition).not.toHaveBeenCalled();
    expect(escrow.refundAcquisition).toHaveBeenCalledWith({ tag: 'db' }, 'dev', 'acq-1');
  });
});

describe('abandon after a DO eviction (review E-M1)', () => {
  it('with no run in memory, abandon refunds the device\'s open escrow', async () => {
    escrow.openAcquisition.mockResolvedValueOnce({ acq_id: 'acq-orphan' });
    const wd = build(); addPeer(wd, 7, at(ACQ.start));
    expect(await (await post(wd, '/api/funding/mission-abandon', { sid: 7 })).json()).toMatchObject({ status: 'abandoned', refunded: true });
    expect(escrow.refundAcquisition).toHaveBeenCalledWith(expect.anything(), 'dev', 'acq-orphan');
  });
  it('but never refunds an escrow another tab of the device is still running', async () => {
    escrow.openAcquisition.mockResolvedValueOnce({ acq_id: 'acq-live' });
    const wd = build(); addPeer(wd, 7, at(ACQ.start)); addPeer(wd, 8, at(ACQ.start));
    wd.missions.set(8, { missionId: 'acquihire', startMs: Date.now(), sid: 8, gen: 1, device: 'dev', reached: 0, acqId: 'acq-live' });
    expect(await (await post(wd, '/api/funding/mission-abandon', { sid: 7 })).json()).toEqual({ status: 'none' });
    expect(escrow.refundAcquisition).not.toHaveBeenCalled();
  });
});

describe('two starts in the same instant (review E-L2)', () => {
  it('the second concurrent start from the same session retries: one escrow, no orphan', async () => {
    let release!: () => void;
    escrow.startAcquisition.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ ok: true, acqId: 'acq-1', costCents: '500000', deadlineAt: 9e15 }); }));
    const wd = build(); addPeer(wd, 7, at(ACQ.start));
    const first = post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 });
    const second = await post(wd, '/api/funding/mission-start', { missionId: 'acquihire', sid: 7 });
    expect(second.status).toBe(409); expect(await second.json()).toEqual({ status: 'refused', reason: 'retry' });
    await new Promise(r => setTimeout(r, 0)); release();
    expect(await (await first).json()).toMatchObject({ status: 'started' });
    expect(escrow.startAcquisition).toHaveBeenCalledTimes(1);
  });
});
