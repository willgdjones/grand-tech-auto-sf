import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { rideSpeedCapMps } from '@gtasf/shared/content/rides';
import type { Pose } from '@gtasf/shared/protocol/types';
import type { TechWeekEvent } from '../events/types';
import { storeEvents } from '../events/store';
import { getCapTable, creditedRefs } from './credits';
import { getFundingProfile } from './store';
import { WorldFunding, type FundingPeer } from './world';
import { PASSENGER_FLAG } from '../world/vehicles';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, rideAnyVehicle: true, quickRobotaxi: false, madMaxRobotaxi: false } };
});

// Core v2 loop: drive-through detection in WorldFunding.tick (flags.driveThroughFunding is on by default).
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0001_initial.sql', '0002_events.sql', '0010_funding.sql', '0014_funding_bonus.sql',
    '0017_community_events.sql', '0018_fund_drops.sql', '0020_funding_credits.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
  } as unknown as D1Database;
  const now = Date.parse('2026-10-05T17:00:00Z'); // inside the event window below => "live" quote
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('dev-1', 'hash-1', 'Fogware', 'Foggy', now, now);
  return { sqlite, db, now };
}

const ANCHOR = { x: 100, y: 0, z: 200 };
function poseAt(x: number, z: number): Pose { return { x: x * 100, y: 0, z: z * 100, yaw: 0, flags: 0 }; }

it('grants ride speed from the verified funding profile and refreshes boundedly after hibernation', async () => {
  const { sqlite, db, now } = setup();
  const pending: Promise<unknown>[] = [];
  const funding = new WorldFunding({ DB: db }, () => [], work => pending.push(work));
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    expect(rideSpeedCapMps(funding.roundForMovement(undefined, now), 11)).toBe(19);
    expect(pending).toHaveLength(0);
    await funding.profileForConnection('dev-1');
    expect(rideSpeedCapMps(funding.roundForMovement('dev-1', now), 11)).toBe(19);
    // A real server credit upgrades immediately, without trusting appearance metadata.
    await funding.award('dev-1', { source: 'celebrity', sourceRef: 'ride-smoke', label: 'Ride smoke', amountCents: 1_500_000_000n }, now + 1);
    expect(rideSpeedCapMps(funding.roundForMovement('dev-1', now + 2), 11)).toBe(22);
    expect(pending).toHaveLength(0);
    const restored = new WorldFunding({ DB: db }, () => [], work => pending.push(work));
    for (let i = 0; i < 10; i++) expect(restored.roundForMovement('dev-1', now + 5000).id).toBe('bootstrapping');
    expect(pending).toHaveLength(1);
    await Promise.all(pending.splice(0));
    expect(rideSpeedCapMps(restored.roundForMovement('dev-1', now + 5001), 11)).toBe(22);
    // An external balance change is picked up on the next bounded refresh.
    sqlite.prepare("DELETE FROM funding_credits WHERE device_id='dev-1'").run();
    restored.roundForMovement('dev-1', now + 10_001);
    expect(pending).toHaveLength(1);
    await Promise.all(pending.splice(0));
    expect(rideSpeedCapMps(restored.roundForMovement('dev-1', now + 10_002), 11)).toBe(19);
  } finally { vi.useRealTimers(); sqlite.close(); }
});

it('smoke: a peer passing through an event marker is paid once ever by the tick', async () => {
  const { sqlite, db, now } = setup();
  try {
    const event: TechWeekEvent = { id: 'luma:dtmixer', title: 'Drive-through Mixer', host: null,
      start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z', venue: null, address: null,
      lat: 37.795, lon: -122.39, approx: false, url: 'https://lu.ma/dtmixer', source: 'luma', tags: [] };
    await storeEvents(db, [event], '2026-10-05T12:00:00Z');

    let peers: FundingPeer[] = [{ id: 1, deviceId: 'dev-1', pose: poseAt(ANCHOR.x, ANCHOR.z), onFoot: true }];
    const pending: Promise<unknown>[] = [];
    const retain = (work: Promise<unknown>) => { pending.push(work); };
    const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const funding = new WorldFunding({ DB: db }, () => peers, retain, undefined, () => ANCHOR);

    // New route passengers never collect, independently of either taxi mode's flag.
    peers[0]!.pose.flags = PASSENGER_FLAG; peers[0]!.onFoot = false;
    for (let i = 0; i < 4; i++) { funding.tick(now); await drain(); }
    expect([...await creditedRefs(db, 'dev-1', 'event')]).toEqual([]);
    peers[0]!.pose.flags = 0; peers[0]!.onFoot = true;

    // The tick builds the drive index, loads the once-ever set, then detects + pays across a few ticks.
    for (let i = 0; i < 4; i++) { funding.tick(now); await drain(); }

    // Paid exactly once, recorded as an event credit on the cap table, lifting the season total.
    expect([...await creditedRefs(db, 'dev-1', 'event')]).toEqual(['luma:dtmixer']);
    const profile = await getFundingProfile(db, 'dev-1', now);
    expect(BigInt(profile.totalCents) > 0n).toBe(true);
    const events = (await getCapTable(db, 'dev-1', now)).groups.find(g => g.source === 'event')!;
    expect(events.entries[0]!.label).toBe('Drive-through Mixer');
    const paid = profile.totalCents;

    // Still parked in the marker: more ticks never double-pay the same event.
    for (let i = 0; i < 4; i++) { funding.tick(now + 1000); await drain(); }
    expect((await getFundingProfile(db, 'dev-1', now)).totalCents).toBe(paid);
    expect((await db.prepare("SELECT COUNT(*) n FROM funding_credits WHERE device_id='dev-1' AND source='event'").first<{ n: number }>())!.n).toBe(1);

    // An unnamed device (new phone, tutorial not finished) is paid too; naming comes after the first cheque.
    peers = [{ id: 3, deviceId: 'dev-3', pose: poseAt(ANCHOR.x, ANCHOR.z), onFoot: true }];
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)').run('dev-3', 'hash-3', now, now);
    for (let i = 0; i < 4; i++) { funding.tick(now + 1500); await drain(); }
    expect([...await creditedRefs(db, 'dev-3', 'event')]).toEqual(['luma:dtmixer']);

    // A peer that never enters the marker is not paid.
    peers = [{ id: 2, deviceId: 'dev-2', pose: poseAt(ANCHOR.x + 50, ANCHOR.z + 50), onFoot: true }];
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('dev-2', 'hash-2', 'Farware', 'Far', now, now);
    for (let i = 0; i < 4; i++) { funding.tick(now + 2000); await drain(); }
    expect([...await creditedRefs(db, 'dev-2', 'event')]).toEqual([]);
  } finally { sqlite.close(); }
});

it('pays every event at a shared venue in one pass, once ever (combined cheque)', async () => {
  const { sqlite, db, now } = setup();
  try {
    const mk = (id: string, title: string, url: string): TechWeekEvent => ({ id, title, host: null,
      start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z', venue: 'Shared Venue', address: null,
      lat: 37.795, lon: -122.39, approx: false, url, source: 'luma', tags: [] });
    // Two events at the same venue => the same anchor (anchorForEvent returns ANCHOR for all).
    await storeEvents(db, [mk('luma:a', 'Mixer A', 'https://lu.ma/a'), mk('luma:b', 'Mixer B', 'https://lu.ma/b')], '2026-10-05T12:00:00Z');
    const peers: FundingPeer[] = [{ id: 1, deviceId: 'dev-1', pose: poseAt(ANCHOR.x, ANCHOR.z), onFoot: false }];
    const pending: Promise<unknown>[] = [];
    const retain = (work: Promise<unknown>) => { pending.push(work); };
    const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const funding = new WorldFunding({ DB: db }, () => peers, retain, undefined, () => ANCHOR);

    for (let i = 0; i < 5; i++) { funding.tick(now); await drain(); }

    // Both events at the venue are paid once each in the pass.
    expect([...await creditedRefs(db, 'dev-1', 'event')].sort()).toEqual(['luma:a', 'luma:b']);
    expect((await getCapTable(db, 'dev-1', now)).groups.find(g => g.source === 'event')!.count).toBe(2);
    const paid = (await getFundingProfile(db, 'dev-1', now)).totalCents;
    expect(BigInt(paid) > 0n).toBe(true);

    // Re-passing the venue never double-pays either event.
    for (let i = 0; i < 4; i++) { funding.tick(now + 1000); await drain(); }
    expect((await getFundingProfile(db, 'dev-1', now)).totalCents).toBe(paid);
    expect((await db.prepare("SELECT COUNT(*) n FROM funding_credits WHERE device_id='dev-1' AND source='event'").first<{ n: number }>())!.n).toBe(2);
  } finally { sqlite.close(); }
});

it('award() is the shared once-ever payout API for the celeb/VC-drop panes', async () => {
  const { sqlite, db, now } = setup();
  try {
    const funding = new WorldFunding({ DB: db }, () => [], () => {}, undefined, () => ANCHOR);
    const first = await funding.award('dev-1', { source: 'celebrity', sourceRef: 'elon', label: 'Elon (parody)', amountCents: 4_000_000_000n }, now);
    expect(first.credited).toBe(true);
    const angels = (await getCapTable(db, 'dev-1', now)).groups.find(g => g.source === 'celebrity')!;
    expect(angels.entries[0]!.label).toBe('Elon (parody)');
    expect(angels.totalCents).toBe('4000000000');
    // Idempotent: another pane re-awarding the same source_ref pays nothing extra.
    expect((await funding.award('dev-1', { source: 'celebrity', sourceRef: 'elon', label: 'Elon (parody)', amountCents: 4_000_000_000n }, now + 1)).credited).toBe(false);
    expect((await getFundingProfile(db, 'dev-1', now)).totalCents).toBe('4000000000');
  } finally { sqlite.close(); }
});


it('the public drive-through status preserves the paid preview quote', async () => {
  const { sqlite, db } = setup();
  const now = Date.parse('2026-10-04T11:00:00Z');
  const token = 'a'.repeat(64);
  sqlite.prepare('UPDATE funding_profiles SET token_hash=? WHERE device_id=?')
    .run(createHash('sha256').update(token).digest('hex'), 'dev-1');
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    const event: TechWeekEvent = { id: 'luma:preview', title: 'Next week mixer', host: null,
      start: '2026-10-07T21:00:00Z', end: '2026-10-07T23:00:00Z', venue: 'Real venue', address: null,
      lat: 37.795, lon: -122.39, approx: false, url: 'https://lu.ma/preview', source: 'luma', tags: [] };
    await storeEvents(db, [event], new Date(now).toISOString());
    const pending: Promise<unknown>[] = [];
    const funding = new WorldFunding({ DB: db }, () => [{ id: 1, deviceId: 'dev-1',
      pose: poseAt(ANCHOR.x, ANCHOR.z), onFoot: true }], work => pending.push(work), undefined, () => ANCHOR);
    for (let i = 0; i < 5; i++) {
      funding.tick(now);
      while (pending.length) await Promise.all(pending.splice(0));
    }
    const response = await funding.handle(new Request('https://game.test/api/funding/status', {
      headers: { Origin: 'https://game.test', Cookie: `gtasf_device=${token}` },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'awarded',
      profile: { totalCents: '30000000' },
      award: { eventId: event.id, kind: 'community', baseCents: '20000000',
        amountCents: '30000000', preview: true, timing: 'upcoming', timeMultiplier: 1.5,
        crowdCount: 0, crowdMultiplier: 1, streakCount: 1, streakMultiplier: 1 },
    });
    expect((await getCapTable(db, 'dev-1', now)).groups[0]!.totalCents).toBe('30000000');
  } finally { vi.useRealTimers(); sqlite.close(); }
});

it('pays only for events the client can see: an invisible later-in-week event at the same spot does not pay', async () => {
  const { db, now } = setup();
  try {
    const base = { host: null, venue: null, address: null, approx: false, source: 'luma' as const, tags: [] as string[] };
    const visible: TechWeekEvent = { ...base, id: 'luma:now', url: 'https://lu.ma/now', title: 'Visible Now', start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z', lat: 37.795, lon: -122.39 };
    const later: TechWeekEvent = { ...base, id: 'luma:thu', url: 'https://lu.ma/thu', title: 'Thursday Thing', start: '2026-10-08T16:00:00Z', end: '2026-10-08T18:00:00Z', lat: 37.795, lon: -122.39 };
    // 30 more events in the next 24h elsewhere, so the 24h focus window holds (no preview fallback).
    const fillers: TechWeekEvent[] = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `luma:f${i}`, url: `https://lu.ma/f${i}`, title: `Filler ${i}`,
      start: '2026-10-05T20:00:00Z', end: '2026-10-05T22:00:00Z', lat: 37.76 + i * 0.001, lon: -122.45 }));
    await storeEvents(db, [visible, later, ...fillers], '2026-10-05T12:00:00Z');
    const peers: FundingPeer[] = [{ id: 1, deviceId: 'dev-1', pose: poseAt(ANCHOR.x, ANCHOR.z), onFoot: true }];
    const pending: Promise<unknown>[] = [];
    const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const funding = new WorldFunding({ DB: db }, () => peers, work => { pending.push(work); }, undefined, () => ANCHOR);
    for (let i = 0; i < 4; i++) { funding.tick(now); await drain(); }
    const paid = await creditedRefs(db, 'dev-1', 'event'); // the test resolver puts every event at ANCHOR
    expect(paid.has('luma:now')).toBe(true);   // visible (live) event pays
    expect(paid.has('luma:thu')).toBe(false);  // invisible later-in-week event at the same spot does not
  } finally { /* sqlite closed with the process */ }
});
