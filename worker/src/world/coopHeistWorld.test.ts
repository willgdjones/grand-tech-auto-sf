import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// WorldDO wiring of the co-op heist (flag coopHeist). Identity/credits are spies: each test asserts WHO the DO pays. The
// crew is paid the normal heist credit under its OWN device's daily ref, only with the leader's delivery.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, missions: true, coopHeist: true, acquihireQuest: false, timeTrials: true, fundingLoop: false,
    chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false, referrals: false, proximityVoice: false,
    fundDrops: false, combat: false, outbidBanner: false, outbidCrown: false, streetRaces: false, mostWantedBounty: false } };
});
const done = vi.hoisted(() => new Map<string, Set<string>>());
vi.mock('../funding/identity', async orig => ({ ...(await orig<object>()), fundingDevice: vi.fn(async (r: Request) => r.headers.get('x-dev')) }));
vi.mock('../funding/credits', async orig => ({ ...(await orig<object>()), creditedRefs: vi.fn(async (_db: unknown, device: string) => done.get(device) ?? new Set<string>()) }));
vi.mock('../funding/store', async orig => ({ ...(await orig<object>()), getFundingProfile: vi.fn(async (_db: unknown, d: string) => ({ deviceId: d })) }));

import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { missionById, missionCredit } from '@gtasf/shared/founder/missions';
import { parseQuestEvent, type QuestEvent } from '@gtasf/shared/founder/questEvents';
import { project } from '../funding/anchors';
import { missionMinTravelMs } from '../founder/missions';
import { COOP_CREW_GRACE_MS, COOP_JOIN_RADIUS_M, COOP_JOIN_WINDOW_MS, coopJoinRefusal, crewPayable } from '../founder/coopHeist';
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
type Run = { missionId: string; startMs: number; sid: number; gen: number; device: string; reached: number; crewOf?: number; crewSid?: number; leaderDeliveredAt?: number };
type DO = { missions: Map<number, Run>; peers: Map<number, Peer>; funding: { award: ReturnType<typeof vi.fn> }; clearDeviceQuests(d: string): void; fetch(r: Request): Promise<Response> };
type Peer = { id: number; session: { id: number; generation: number; name: string }; fundingDeviceId: string; pose: Pose; send(b: Uint8Array): void; inbox: QuestEvent[] };
type Pose = { x: number; y: number; z: number; yaw: number; flags: number };
const HEIST = missionById('steal-pitch-deck')!;
const DROP = HEIST.objectives.at(-1)!.at!;
const at = (p: { lat: number; lon: number }, dxM = 0): Pose => { const q = project(p.lat, p.lon); return { x: Math.round((q.x + dxM) * 100), y: 0, z: Math.round(q.z * 100), yaw: 0, flags: 0 }; };
function build(): DO {
  const storage = mockStorage();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null },
    blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const wd = new WorldDO(ctx as never, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, DB: { tag: 'db' } } as never) as unknown as DO;
  wd.funding = { award: vi.fn(async () => ({ credited: true })), disconnect: vi.fn(), tick: vi.fn() } as never; // tick: the world ticker may fire mid-test
  return wd;
}
function addPeer(wd: DO, sid: number, device: string, pose: Pose): Peer {
  const inbox: QuestEvent[] = [];
  const peer: Peer = { id: sid, session: { id: sid, generation: 1, name: device.toUpperCase() }, fundingDeviceId: device, pose, inbox,
    send: b => { const d = decodeS2C(b); if (d.ok && d.msg.type === 'QUEST') inbox.push(parseQuestEvent(d.msg.json)!); } };
  wd.peers.set(sid, peer); return peer;
}
const post = async (wd: DO, path: string, device: string, body: unknown) => (await wd.fetch(new Request(`https://x.test${path}`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dev': device }, body: JSON.stringify(body) }))).json() as Promise<Record<string, unknown>>;
const paidDevices = (wd: DO) => wd.funding.award.mock.calls.map(c => c[0]);
/** Leader L (sid 1) starts the heist; crew C (sid 2) joins from the office. */
async function crewed() {
  const wd = build();
  const L = addPeer(wd, 1, 'lead', at(HEIST.start)), C = addPeer(wd, 2, 'crew', at(HEIST.start, 20));
  expect(await post(wd, '/api/funding/mission-start', 'lead', { missionId: HEIST.id, sid: 1 })).toMatchObject({ status: 'started' });
  expect(await post(wd, '/api/funding/heist-join', 'crew', { hostSid: 1, sid: 2 })).toMatchObject({ status: 'joined' });
  C.pose = at(HEIST.start); (wd as unknown as { notePoseProgress(p: Peer): void }).notePoseProgress(C); // the crew passes the grab
  return { wd, L, C };
}
const age = (wd: DO, sid: number, ms: number) => { wd.missions.get(sid)!.startMs -= ms; };
const FLOOR = missionMinTravelMs(HEIST) + 5_000;

beforeEach(() => { vi.clearAllMocks(); done.clear(); });

describe('coop rules (pure)', () => {
  const leader = { startMs: 0, device: 'lead', heist: true };
  const ok = { device: 'crew', busy: false, distanceM: 10, doneToday: false };
  it('join refusals', () => {
    expect(coopJoinRefusal(leader, ok, 1)).toBeNull();
    expect(coopJoinRefusal(undefined, ok, 1)).toBe('no-heist');
    expect(coopJoinRefusal({ ...leader, crewOf: 9 }, ok, 1)).toBe('no-heist');   // a crew run can't recruit
    expect(coopJoinRefusal(leader, ok, COOP_JOIN_WINDOW_MS + 1)).toBe('closed');
    expect(coopJoinRefusal({ ...leader, crewSid: 3 }, ok, 1)).toBe('full');
    expect(coopJoinRefusal(leader, { ...ok, device: 'lead' }, 1)).toBe('same-device');
    expect(coopJoinRefusal(leader, { ...ok, busy: true }, 1)).toBe('busy');
    expect(coopJoinRefusal(leader, { ...ok, distanceM: COOP_JOIN_RADIUS_M + 1 }, 1)).toBe('too-far');
    expect(coopJoinRefusal(leader, { ...ok, doneToday: true }, 1)).toBe('cooldown');
  });
  it('crew payable only after the leader delivered, within the grace', () => {
    expect(crewPayable({}, 5)).toBe('waiting-for-leader');
    expect(crewPayable({ leaderDeliveredAt: 0 }, COOP_CREW_GRACE_MS)).toBe('ok');
    expect(crewPayable({ leaderDeliveredAt: 0 }, COOP_CREW_GRACE_MS + 1)).toBe('too-late');
  });
});

describe('co-op heist (WorldDO)', () => {
  it('a heist start invites players near the office (not far ones, not the leader’s other tab)', async () => {
    const wd = build();
    addPeer(wd, 1, 'lead', at(HEIST.start));
    const near = addPeer(wd, 2, 'crew', at(HEIST.start, 100)), far = addPeer(wd, 3, 'far', at(HEIST.start, 400)), tab = addPeer(wd, 4, 'lead', at(HEIST.start, 5));
    await post(wd, '/api/funding/mission-start', 'lead', { missionId: HEIST.id, sid: 1 });
    expect(near.inbox).toEqual([{ kind: 'heist-invite', hostSid: 1, host: 'LEAD', joinInMs: COOP_JOIN_WINDOW_MS }]);
    expect(far.inbox).toEqual([]); expect(tab.inbox).toEqual([]);
  });
  it('join is refused too far / same device / when full / after the window / when the crew already did the heist today', async () => {
    const wd = build();
    addPeer(wd, 1, 'lead', at(HEIST.start));
    addPeer(wd, 2, 'crew', at(HEIST.start, 100)); addPeer(wd, 3, 'lead', at(HEIST.start, 5)); addPeer(wd, 4, 'c2', at(HEIST.start, 5)); addPeer(wd, 5, 'c3', at(HEIST.start, 5));
    await post(wd, '/api/funding/mission-start', 'lead', { missionId: HEIST.id, sid: 1 });
    expect(await post(wd, '/api/funding/heist-join', 'crew', { hostSid: 1, sid: 2 })).toEqual({ status: 'refused', reason: 'too-far' });
    expect(await post(wd, '/api/funding/heist-join', 'lead', { hostSid: 1, sid: 3 })).toEqual({ status: 'refused', reason: 'same-device' }); // own second tab
    done.set('c3', new Set([missionCredit(HEIST, Date.now()).sourceRef]));
    expect(await post(wd, '/api/funding/heist-join', 'c3', { hostSid: 1, sid: 5 })).toEqual({ status: 'refused', reason: 'cooldown' });
    expect(await post(wd, '/api/funding/heist-join', 'c2', { hostSid: 1, sid: 4 })).toMatchObject({ status: 'joined' });
    done.delete('c3');
    expect(await post(wd, '/api/funding/heist-join', 'c3', { hostSid: 1, sid: 5 })).toEqual({ status: 'refused', reason: 'full' });
    const late = build(); addPeer(late, 1, 'lead', at(HEIST.start)); addPeer(late, 2, 'crew', at(HEIST.start, 5));
    await post(late, '/api/funding/mission-start', 'lead', { missionId: HEIST.id, sid: 1 }); age(late, 1, COOP_JOIN_WINDOW_MS + 1);
    expect(await post(late, '/api/funding/heist-join', 'crew', { hostSid: 1, sid: 2 })).toEqual({ status: 'refused', reason: 'closed' });
  });
  it('both at the drop when the leader delivers: both paid once, each under their own device', async () => {
    const { wd, L, C } = await crewed();
    expect(C.inbox.at(-1)).toEqual({ kind: 'heist-crew', partner: 'LEAD', role: 'crew' });
    expect(L.inbox.at(-1)).toEqual({ kind: 'heist-crew', partner: 'CREW', role: 'leader' });
    age(wd, 1, FLOOR); age(wd, 2, FLOOR); L.pose = at(DROP); C.pose = at(DROP, 3);
    expect(await post(wd, '/api/funding/mission-complete', 'lead', { sid: 1 })).toMatchObject({ status: 'completed' });
    expect(paidDevices(wd)).toEqual(['lead', 'crew']);
    expect(C.inbox.at(-1)).toMatchObject({ kind: 'heist-paid', partner: 'LEAD' });
    expect(wd.missions.size).toBe(0);
  });
  it('the crew arriving first waits for the leader; arriving within the grace after is paid; after the grace is not', async () => {
    const { wd, L, C } = await crewed();
    age(wd, 1, FLOOR); age(wd, 2, FLOOR); C.pose = at(DROP);
    expect(await post(wd, '/api/funding/mission-complete', 'crew', { sid: 2 })).toMatchObject({ status: 'waiting-for-leader' });
    expect(paidDevices(wd)).toEqual([]);
    C.pose = at(HEIST.start); L.pose = at(DROP);  // the crew wandered off; the leader delivers alone
    await post(wd, '/api/funding/mission-complete', 'lead', { sid: 1 });
    expect(paidDevices(wd)).toEqual(['lead']);
    C.pose = at(DROP);
    expect(await post(wd, '/api/funding/mission-complete', 'crew', { sid: 2 })).toMatchObject({ status: 'completed' });
    expect(paidDevices(wd)).toEqual(['lead', 'crew']);
    const late = await crewed();
    age(late.wd, 1, FLOOR); age(late.wd, 2, FLOOR); late.L.pose = at(DROP);
    await post(late.wd, '/api/funding/mission-complete', 'lead', { sid: 1 });
    late.wd.missions.get(2)!.leaderDeliveredAt! -= COOP_CREW_GRACE_MS + 1;
    late.C.pose = at(DROP);
    expect(await post(late.wd, '/api/funding/mission-complete', 'crew', { sid: 2 })).toMatchObject({ status: 'too-late' });
    expect(paidDevices(late.wd)).toEqual(['lead']);
  });
  it('the crew must pass the grab and respect the travel floor from its join (no teleport cash-out)', async () => {
    const wd = build();
    const L = addPeer(wd, 1, 'lead', at(HEIST.start)), C = addPeer(wd, 2, 'crew', at(HEIST.start, 25));
    await post(wd, '/api/funding/mission-start', 'lead', { missionId: HEIST.id, sid: 1 });
    await post(wd, '/api/funding/heist-join', 'crew', { hostSid: 1, sid: 2 });
    age(wd, 1, FLOOR); age(wd, 2, FLOOR); L.pose = at(DROP); C.pose = at(DROP); // crew never stood at the grab
    await post(wd, '/api/funding/mission-complete', 'lead', { sid: 1 });
    expect(await post(wd, '/api/funding/mission-complete', 'crew', { sid: 2 })).toMatchObject({ status: 'incomplete' });
    const fast = await crewed();
    age(fast.wd, 1, FLOOR); fast.L.pose = at(DROP); fast.C.pose = at(DROP); // the crew joined just now: too fast
    await post(fast.wd, '/api/funding/mission-complete', 'lead', { sid: 1 });
    expect(await post(fast.wd, '/api/funding/mission-complete', 'crew', { sid: 2 })).toMatchObject({ status: 'incomplete' });
    expect(paidDevices(fast.wd)).toEqual(['lead']);
  });
  it('the leader abandoning ends the crew run (told); a crew disconnect frees the seat and the leader is paid alone', async () => {
    const { wd, C } = await crewed();
    await post(wd, '/api/funding/mission-abandon', 'lead', { sid: 1 });
    expect(wd.missions.size).toBe(0);
    expect(C.inbox.at(-1)).toEqual({ kind: 'heist-cancelled', reason: 'leader-left' });
    const solo = await crewed();
    solo.wd.clearDeviceQuests('crew');
    expect(solo.wd.missions.get(1)?.crewSid).toBeUndefined();
    age(solo.wd, 1, FLOOR); solo.L.pose = at(DROP);
    await post(solo.wd, '/api/funding/mission-complete', 'lead', { sid: 1 });
    expect(paidDevices(solo.wd)).toEqual(['lead']);
  });
});
