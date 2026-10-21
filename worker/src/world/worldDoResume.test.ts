import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// WorldDO extends DurableObject from the workers-only 'cloudflare:workers' module (no vitest workers pool is
// configured here — the reason combatScenario wires modules instead of constructing the DO). Stub the base class so
// the DO can be constructed in plain node, then drive the real HELLO resume path against mocks.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
// Minimal flags: missions/timeTrials/multiplayer on; the heavy subsystems off so the HELLO path stays lean.
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, missions: true, timeTrials: true,
    fundingLoop: false, chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false,
    xAdsPixel: false, referrals: false, proximityVoice: false, fundDrops: false, combat: false,
    outbidBanner: false, outbidCrown: false } };
});

import { questStartedBy } from '../founder/missions';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { WorldDO, RECONNECT_GRACE_MS, SESSION_SAVE_MS, BUST_DROP_SETTLE_MS } from './WorldDO';
import { BUST_HOLD_MS } from '@gtasf/shared/combat/bust';
import { wantedLevel } from '@gtasf/shared/combat/wanted';
import { flags } from '@gtasf/shared/flags';
import { project } from '../funding/anchors';

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
    sessions: { admit(name: string, token: string | undefined, now: number): { id: number; generation: number; token: string }; save(session: unknown): void };
    // The run-maps are keyed by SESSION id (two-tab fix); the value carries `device` so clearDeviceQuests can drop
    // every one of a device's runs across tabs.
    missions: Map<number, { device: string }>; timeTrialRuns: Map<number, { device: string }>;
    driveQuests: Map<number, { device: string }>; connections: Map<unknown, unknown>;
    clearDeviceQuests(deviceId: string): void;
    pilgrimApproach: Map<number, { far: Set<string>; device: string }>;
    notePilgrimTravel(peer: unknown): void;
    webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
    webSocketClose(s: unknown, code: number): void;
    dropGrace: Map<number, unknown>; peers: Map<number, unknown>; expire(now: number): void;
    taxis: { paused: Set<number> };
    bustStates: Map<number, { holdMs: number; lastX: number; lastZ: number; lastAt: number }>;
    wantedStates: Map<number, { state: { heat: number }; level: number }>;
    combat: { isProtected(id: number, now: number): boolean };
    settleBust(peer: unknown, now: number): Promise<void>;
  };
}

function mockSocket() {
  return { send: () => {}, serializeAttachment: () => {}, deserializeAttachment: () => ({ kind: 'pending', expiresAt: Date.now() + 1e6 }), close: () => {}, readyState: 1 };
}

describe('WorldDO resume with ?at= clears the active mission + trial', () => {
  it('a spawn-override (deep-link) resume drops the device quests on HELLO', async () => {
    const wd = build();
    const now = Date.now(), device = 'dev-1';
    // Create the session the resume token will resume (admit with no token mints one).
    const session = wd.sessions.admit('Tester', undefined, now);
    expect(typeof session).not.toBe('string');
    // An in-flight mission + time trial for this device, started by this session (keyed by session id now).
    wd.missions.set(session.id, { missionId: 'steal-pitch-deck', startMs: now, sid: session.id, gen: session.generation, device } as never);
    wd.timeTrialRuns.set(session.id, { routeId: 'lombard-switchbacks', startMs: now, sid: session.id, gen: session.generation, device } as never);
    // A connection carrying a ?at= spawn override for this device (as /api/world?at=… sets up).
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, spawn: { x: 100, y: 333, z: -200, yaw: 0, flags: 0 }, fundingDeviceId: device });
    // Resume HELLO with the session's token → the spawn-override clear (clearDeviceQuests) fires.
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    expect([...wd.missions.values()].some(m => m.device === device)).toBe(false);
    expect([...wd.timeTrialRuns.values()].some(t => t.device === device)).toBe(false);
  });
});

describe('two-tab / reconnect void fix: runs are session-keyed, clearDeviceQuests drops all of a device tabs', () => {
  it('two sessions of ONE device hold independent runs (no clobber), and a clear drops both but spares other devices', () => {
    const wd = build();
    const now = Date.now(), device = 'dev-two-tab', other = 'dev-other';
    // Two tabs of the SAME device → two distinct sessions.
    const tabA = wd.sessions.admit('A', undefined, now);
    const tabB = wd.sessions.admit('B', undefined, now);
    expect(tabA.id).not.toBe(tabB.id);
    // A third tab belongs to a DIFFERENT device.
    const tabC = wd.sessions.admit('C', undefined, now);
    // Each tab starts its own mission (device-keying would have had tab B clobber tab A → the void).
    wd.missions.set(tabA.id, { missionId: 'steal-pitch-deck', startMs: now, sid: tabA.id, gen: tabA.generation, device } as never);
    wd.missions.set(tabB.id, { missionId: 'steal-pitch-deck', startMs: now, sid: tabB.id, gen: tabB.generation, device } as never);
    wd.missions.set(tabC.id, { missionId: 'steal-pitch-deck', startMs: now, sid: tabC.id, gen: tabC.generation, device: other } as never);
    wd.driveQuests.set(tabA.id, { npcId: 'robotaxi-protester', startMs: now, device } as never);
    wd.timeTrialRuns.set(tabB.id, { routeId: 'embarcadero-sprint', startMs: now, sid: tabB.id, gen: tabB.generation, device } as never);
    // Both of the device's tabs coexist — the two-tab void is fixed.
    expect(wd.missions.size).toBe(3);
    expect(wd.missions.has(tabA.id) && wd.missions.has(tabB.id)).toBe(true);
    // A server-authorized teleport/reload for the device clears EVERY one of its runs (anti-cash-out across tabs)...
    wd.clearDeviceQuests(device);
    expect(wd.missions.has(tabA.id)).toBe(false);
    expect(wd.missions.has(tabB.id)).toBe(false);
    expect(wd.driveQuests.size).toBe(0);
    expect(wd.timeTrialRuns.size).toBe(0);
    // ...but never touches another device's run.
    expect(wd.missions.has(tabC.id)).toBe(true);
    expect((wd.missions.get(tabC.id) as { device: string }).device).toBe(other);
  });
});

describe('pilgrimage approach tracking (anti-teleport)', () => {
  const peer = (id: number, device: string, x: number, z: number) => ({ session: { id }, fundingDeviceId: device, pose: { x: x * 100, y: 0, z: z * 100, yaw: 0, flags: 0 } });
  const coit = project(37.8024, -122.4058);
  it('marks a landmark approached from afar, and a teleport clear forgets it', () => {
    const wd = build();
    wd.notePilgrimTravel(peer(1, 'dev-p', coit.x, coit.z)); // dropped on Coit Tower
    expect(wd.pilgrimApproach.get(1)!.far.has('coit-tower')).toBe(false);
    wd.notePilgrimTravel(peer(1, 'dev-p', coit.x + 200, coit.z)); // walked 200 m out
    expect(wd.pilgrimApproach.get(1)!.far.has('coit-tower')).toBe(true);
    wd.notePilgrimTravel(peer(2, 'dev-other', 0, 0));
    wd.clearDeviceQuests('dev-p'); // deep-link resume / robotaxi jump / respawn / road recovery
    expect(wd.pilgrimApproach.has(1)).toBe(false);
    expect(wd.pilgrimApproach.has(2)).toBe(true);
  });
  it('a ?at= resume forgets the approach state', async () => {
    const wd = build();
    const now = Date.now(), device = 'dev-at';
    const session = wd.sessions.admit('Tester', undefined, now);
    wd.notePilgrimTravel(peer(session.id, device, 0, 0));
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, spawn: { x: 100, y: 333, z: -200, yaw: 0, flags: 0 }, fundingDeviceId: device });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    expect(wd.pilgrimApproach.has(session.id)).toBe(false);
  });
});

describe('reconnectGrace (gtasf-j7wvv): a dropped socket keeps the ride + runs for a same-session resume', () => {
  const device = 'dev-grace';
  async function joined() {
    const wd = build(), now = Date.now();
    const session = wd.sessions.admit('Tester', undefined, now);
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    expect(wd.peers.has(session.id)).toBe(true);
    wd.missions.set(session.id, { missionId: 'steal-pitch-deck', startMs: now, sid: session.id, gen: session.generation, device } as never);
    return { wd, session, socket, now };
  }
  const resume = async (wd: ReturnType<typeof build>, token: string, spawn?: object) => {
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: Date.now() + 1e6, credit: 60, budgetAt: Date.now(), fundingDeviceId: device, ...(spawn ? { spawn } : {}) });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: token }).buffer as ArrayBuffer);
  };
  const hasRun = (wd: ReturnType<typeof build>) => [...wd.missions.values()].some(m => m.device === device);

  it('a 1006 close holds the run and pauses the taxi; a plain resume continues both', async () => {
    const { wd, session, socket } = await joined();
    wd.webSocketClose(socket, 1006);
    expect(wd.peers.has(session.id)).toBe(false);
    expect(hasRun(wd)).toBe(true);                       // not torn down on the drop
    expect(wd.dropGrace.has(session.id)).toBe(true);
    expect(wd.taxis.paused.has(session.id)).toBe(true);  // the ride waits for them
    await resume(wd, session.token);
    expect(wd.peers.has(session.id)).toBe(true);
    expect(hasRun(wd)).toBe(true);                       // same run, no restart
    expect(wd.dropGrace.has(session.id)).toBe(false);
    expect(wd.taxis.paused.has(session.id)).toBe(false);
    // The resume bumped the generation: the held run must still count as started by THIS session, or the delivery
    // answers 'stale-session' and the grace was pointless.
    const run = wd.missions.get(session.id) as unknown as { sid: number; gen: number }, peer = wd.peers.get(session.id) as { session: { id: number; generation: number } };
    expect(questStartedBy(run, peer)).toBe(true);
  });
  it('gtasf-t9joj: a resume that beats the old socket\'s close (peer swap) still keeps the run startable by THIS session', async () => {
    const { wd, session, socket } = await joined();
    // A 1006: the client reconnects before the server has seen the old socket close, so the resume swaps the peer with
    // no dropGrace entry yet; the old socket's close arrives afterwards.
    await resume(wd, session.token);
    wd.webSocketClose(socket, 1006);
    expect(hasRun(wd)).toBe(true);
    const run = wd.missions.get(session.id) as unknown as { sid: number; gen: number }, peer = wd.peers.get(session.id) as { session: { id: number; generation: number } };
    expect(peer).toBeDefined();
    expect(questStartedBy(run, peer)).toBe(true); // was 'stale-session': the generation moved, the held run did not
  });
  it('a ?at= (spawn-override) resume after a drop still clears the runs (anti-teleport kept)', async () => {
    const { wd, session, socket } = await joined();
    wd.webSocketClose(socket, 1006);
    await resume(wd, session.token, { x: 100, y: 333, z: -200, yaw: 0, flags: 0 });
    expect(hasRun(wd)).toBe(false);
    expect(wd.dropGrace.has(session.id)).toBe(false);
  });
  it('no resume within RECONNECT_GRACE_MS: the held runs are cleared when the grace ends', async () => {
    const { wd, session, socket, now } = await joined();
    wd.webSocketClose(socket, 1006);
    wd.expire(now + RECONNECT_GRACE_MS - 1000);
    expect(hasRun(wd)).toBe(true);
    wd.expire(now + RECONNECT_GRACE_MS + 1000);
    expect(hasRun(wd)).toBe(false);
    expect(wd.dropGrace.has(session.id)).toBe(false);
  });
  it('a clean close (1000) clears at once, as before', async () => {
    const { wd, session, socket } = await joined();
    wd.webSocketClose(socket, 1000);
    expect(hasRun(wd)).toBe(false);
    expect(wd.dropGrace.has(session.id)).toBe(false);
  });
  it('budgetCloseGrace (gtasf-giklk): a message-budget close holds the run like a 1006; the resume continues it', async () => {
    const { wd, session, socket } = await joined();
    wd.connections.set(socket, { ...(wd.connections.get(socket) as object), credit: 0, budgetAt: Date.now() }); // the burst used the credit
    await wd.webSocketMessage(socket, encodeC2S({ type: 'MOVE', seq: 1, x: 0, y: 0, z: 0, yaw: 0, flags: 0 }).buffer as ArrayBuffer);
    expect(wd.peers.has(session.id)).toBe(false);        // still closed: the budget is unchanged
    expect(hasRun(wd)).toBe(true);
    expect(wd.dropGrace.has(session.id)).toBe(true);
    await resume(wd, session.token);
    expect(wd.peers.has(session.id)).toBe(true);
    expect(hasRun(wd)).toBe(true);
  });
  it('budgetCloseGrace: other protocol closes (a bad frame) still clear at once; flag off restores the old clear', async () => {
    const bad = await joined();
    await bad.wd.webSocketMessage(bad.socket, new Uint8Array([0xff, 1, 2]).buffer as ArrayBuffer);
    expect(bad.wd.peers.has(bad.session.id)).toBe(false);
    expect(hasRun(bad.wd)).toBe(false);
    const was = flags.budgetCloseGrace; (flags as { budgetCloseGrace: boolean }).budgetCloseGrace = false;
    try {
      const { wd, session, socket } = await joined();
      wd.connections.set(socket, { ...(wd.connections.get(socket) as object), credit: 0, budgetAt: Date.now() });
      await wd.webSocketMessage(socket, encodeC2S({ type: 'MOVE', seq: 1, x: 0, y: 0, z: 0, yaw: 0, flags: 0 }).buffer as ArrayBuffer);
      expect(hasRun(wd)).toBe(false);
      expect(wd.dropGrace.has(session.id)).toBe(false);
    } finally { (flags as { budgetCloseGrace: boolean }).budgetCloseGrace = was; }
  });
  it('flag off: a 1006 close clears at once (pre-grace behaviour)', async () => {
    const was = flags.reconnectGrace; (flags as { reconnectGrace: boolean }).reconnectGrace = false;
    try {
      const { wd, session, socket } = await joined();
      wd.webSocketClose(socket, 1006);
      expect(hasRun(wd)).toBe(false);
      expect(wd.dropGrace.has(session.id)).toBe(false);
    } finally { (flags as { reconnectGrace: boolean }).reconnectGrace = was; }
  });
});

describe('session save throttle (gtasf-j7wvv): not a SQLite write per message', () => {
  it('a burst of messages saves once; after SESSION_SAVE_MS it saves again; a disconnect always saves', async () => {
    const wd = build(), t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0);
    try {
      const session = wd.sessions.admit('Tester', undefined, t0);
      const socket = mockSocket();
      wd.connections.set(socket, { expiresAt: t0 + 1e6, credit: 60, budgetAt: t0 });
      await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
      const save = vi.spyOn(wd.sessions, 'save');
      const ping = (n: number) => wd.webSocketMessage(socket, encodeC2S({ type: 'PING', nonce: n, clientT: n }).buffer as ArrayBuffer);
      for (let i = 1; i <= 8; i++) { vi.setSystemTime(t0 + i * 100); await ping(i); } // 8 messages in 0.8 s
      expect(save).toHaveBeenCalledTimes(1);
      vi.setSystemTime(t0 + 100 + SESSION_SAVE_MS + 50); await ping(9);
      expect(save).toHaveBeenCalledTimes(2);
      wd.webSocketClose(socket, 1000);                                             // disconnect persists the latest state
      expect(save).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});

describe('gtasf-7p7oi: a socket drop cannot dodge a bust', () => {
  const device = 'dev-bust';
  const combatFlags = { combat: true, wanted: true, policeBust: true } as const;
  async function wantedPeer(holdMs: number) {
    const saved = Object.fromEntries(Object.keys(combatFlags).map(k => [k, (flags as Record<string, boolean>)[k]]));
    Object.assign(flags, combatFlags);
    const wd = build(), now = Date.now();
    const session = wd.sessions.admit('Tester', undefined, now);
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    const heat = { heat: 30, lastCrimeAt: now, lastSeenAt: now } as unknown as { heat: number };
    wd.wantedStates.set(session.id, { state: heat, level: wantedLevel(30) });
    wd.bustStates.set(session.id, { holdMs, lastX: 0, lastZ: 0, lastAt: now });
    const settle = vi.spyOn(wd, 'settleBust').mockResolvedValue(undefined);
    return { wd, session, socket, settle, restore: () => Object.assign(flags, saved) };
  }
  it(`a drop with the meter >= BUST_HOLD_MS - ${BUST_DROP_SETTLE_MS} ms is settled as BUSTED (the debit), not dodged`, async () => {
    const t = await wantedPeer(BUST_HOLD_MS - 500); // 3.5 s into a 4 s hold
    try {
      t.wd.webSocketClose(t.socket, 1006);
      expect(t.settle).toHaveBeenCalledTimes(1);
    } finally { t.restore(); }
  });
  it('an early drop is not busted, and the reconnect keeps the meter and gets NO spawn protection', async () => {
    const t = await wantedPeer(1500);
    try {
      t.wd.webSocketClose(t.socket, 1006);
      expect(t.settle).not.toHaveBeenCalled();
      const socket = mockSocket();
      t.wd.connections.set(socket, { expiresAt: Date.now() + 1e6, credit: 60, budgetAt: Date.now(), fundingDeviceId: device });
      await t.wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: t.session.token }).buffer as ArrayBuffer);
      expect(t.wd.bustStates.get(t.session.id)?.holdMs).toBe(1500);        // meter carried, not reset to 0
      expect(t.wd.combat.isProtected(t.session.id, Date.now())).toBe(false); // no 3 s invulnerability on a wanted reconnect
      expect((t.wd.wantedStates.get(t.session.id)?.state.heat ?? 0) > 0).toBe(true);
    } finally { t.restore(); }
  });
  it('an unwanted reconnect still gets spawn protection', async () => {
    const saved = flags.combat; (flags as { combat: boolean }).combat = true;
    try {
      const wd = build(), now = Date.now();
      const session = wd.sessions.admit('Tester', undefined, now);
      const socket = mockSocket();
      wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now, fundingDeviceId: device });
      await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
      expect(wd.combat.isProtected(session.id, Date.now())).toBe(true);
    } finally { (flags as { combat: boolean }).combat = saved; }
  });
});

describe('resumeHeightResnap (gtasf-8mjjf blocker #1): a resumed on-foot pose takes the current road height', () => {
  async function resumeAt(dy: number, flags = 0) {
    const { LOCAL_ROAD_GRAPH } = await import('./localRoadData');
    const edge = LOCAL_ROAD_GRAPH.edges.find(e => e.id.startsWith('lane:'))!, [x, y, z] = edge.points[0]!;
    const wd = build(), now = Date.now();
    const session = wd.sessions.admit('Hill', undefined, now) as unknown as { id: number; token: string; movement: { pose: { x: number; y: number; z: number; yaw: number; flags: number } } };
    session.movement.pose = { x: Math.round(x * 100), y: Math.round((y + dy) * 100), z: Math.round(z * 100), yaw: 0, flags };
    wd.sessions.save(session);
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: now + 1e6, credit: 60, budgetAt: now });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Hill', resumeToken: session.token }).buffer as ArrayBuffer);
    const peer = wd.peers.get(session.id) as { pose: { y: number } } | undefined;
    return { peerY: peer?.pose.y, roadY: Math.round(y * 100), storedY: Math.round((y + dy) * 100) };
  }
  it('a pose 10 m under the street (saved before the graph lift) resumes on the street', async () => {
    const r = await resumeAt(-10);
    expect(r.peerY).toBe(r.roadY);
  });
  it('a pose 5 m ABOVE the road (a stair, deck edge) is never lowered (upward only)', async () => {
    const r = await resumeAt(5);
    expect(r.peerY).toBe(r.storedY);
  });
  it('a pose 1 m off (a raised plaza, kerb) is left alone', async () => {
    const r = await resumeAt(1);
    expect(r.peerY).toBe(r.storedY);
  });
});

describe('escapeOwnsClear (review 1.2 HIGH): nothing can pin a wanted player at their stars', () => {
  const on = { combat: true, wanted: true, wantedEscape: true, escapeOwnsClear: true, escapeWaitsForSighting: false } as const;
  async function wanted() {
    const saved = Object.fromEntries(Object.keys(on).map(k => [k, (flags as Record<string, boolean>)[k]]));
    Object.assign(flags, on);
    const wd = build() as unknown as ReturnType<typeof build> & { step(): void; roadsReady: boolean; stepWantedEscape(...a: unknown[]): void };
    const t0 = Date.now();
    const session = wd.sessions.admit('Tester', undefined, t0);
    const socket = mockSocket();
    wd.connections.set(socket, { expiresAt: t0 + 1e6, credit: 60, budgetAt: t0 });
    await wd.webSocketMessage(socket, encodeC2S({ type: 'HELLO', name: 'Tester', resumeToken: session.token }).buffer as ArrayBuffer);
    wd.roadsReady = true;
    wd.wantedStates.set(session.id, { state: { heat: 30, lastCrimeMs: t0 - 120_000 } as never, level: wantedLevel(30) });
    return { wd, session, t0, restore: () => Object.assign(flags, saved) };
  }
  const heatOf = (wd: ReturnType<typeof build>, id: number) => (wd.wantedStates.get(id)?.state as { heat: number } | undefined)?.heat ?? 0;
  it('a throwing escape step falls back to the legacy decay for that tick (stars still clear)', async () => {
    const t = await wanted();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.spyOn(t.wd, 'stepWantedEscape').mockImplementation(() => { throw new Error('boom'); });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let i = 0; i <= 200; i++) { vi.setSystemTime(t.t0 + i * 100); t.wd.step(); } // 20 s
      expect(heatOf(t.wd, t.session.id)).toBeLessThan(30);
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); t.restore(); }
  });
  it('with the escape step working, the legacy decay stays off (the escape clock owns the clear)', async () => {
    const t = await wanted();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const spy = vi.spyOn(t.wd, 'stepWantedEscape').mockImplementation(() => {});
      for (let i = 0; i <= 50; i++) { vi.setSystemTime(t.t0 + i * 100); t.wd.step(); }
      expect(spy).toHaveBeenCalled();
      expect(heatOf(t.wd, t.session.id)).toBe(30);
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); t.restore(); }
  });
});
