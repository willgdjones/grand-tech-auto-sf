import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { onboarding: true, driveThroughFunding: false } }));

import { ORIENTATION_RING, ORIENTATION_SOURCE_REF, orientationAwardCents } from '@gtasf/shared/onboarding/tutorial';
import type { Pose } from '@gtasf/shared/protocol/types';
import { creditedRefs } from './credits';
import { getFundingProfile } from './store';
import { WorldFunding, type FundingPeer } from './world';
import { PASSENGER_FLAG } from '../world/vehicles';

// The tutorial's Founder Orientation cheque: server pose, drivers only, unnamed players allowed, once ever.
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
  } as unknown as D1Database;
  const now = Date.parse('2026-10-04T17:00:00Z');
  // A brand-new player: profile row exists (funding session) but no startup name yet.
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)').run('dev-new', 'hash-new', now, now);
  return { db, now };
}

const inRing = (flags = 0x40): Pose => ({ x: ORIENTATION_RING.x, y: ORIENTATION_RING.y, z: ORIENTATION_RING.z, yaw: 0, flags });

it('smoke: driving through the Orientation ring pays an unnamed founder exactly once (Pre-seed)', async () => {
  const { db, now } = setup();
  let peers: FundingPeer[] = [{ id: 1, deviceId: 'dev-new', pose: inRing(), onFoot: true }];
  const pending: Promise<unknown>[] = [];
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const funding = new WorldFunding({ DB: db }, () => peers, work => { pending.push(work); });

  // On foot (walking through) does not count: the step is "drive through".
  funding.tick(now); await drain();
  expect([...await creditedRefs(db, 'dev-new', 'event')]).toEqual([]);
  // A robotaxi passenger does not count either.
  peers = [{ id: 1, deviceId: 'dev-new', pose: inRing(PASSENGER_FLAG), onFoot: false }];
  funding.tick(now); await drain();
  expect([...await creditedRefs(db, 'dev-new', 'event')]).toEqual([]);

  // Driving through pays, repeatedly ticking inside (and a fresh WorldFunding, e.g. a DO restart) never repays.
  peers = [{ id: 1, deviceId: 'dev-new', pose: inRing(), onFoot: false }];
  for (let i = 0; i < 3; i++) { funding.tick(now + i); await drain(); }
  const again = new WorldFunding({ DB: db }, () => peers, work => { pending.push(work); });
  again.tick(now + 10); await drain();
  expect([...await creditedRefs(db, 'dev-new', 'event')]).toEqual([ORIENTATION_SOURCE_REF]);
  const profile = await getFundingProfile(db, 'dev-new', now);
  expect(BigInt(profile.totalCents)).toBe(orientationAwardCents());
  expect(profile.round.id).toBe('pre-seed');
});

it('ignores drivers outside the ring', async () => {
  const { db, now } = setup();
  const peers: FundingPeer[] = [{ id: 1, deviceId: 'dev-new', pose: { ...inRing(), z: ORIENTATION_RING.z + ORIENTATION_RING.radiusCm + 50 }, onFoot: false }];
  const pending: Promise<unknown>[] = [];
  const funding = new WorldFunding({ DB: db }, () => peers, work => { pending.push(work); });
  funding.tick(now); await Promise.all(pending);
  expect([...await creditedRefs(db, 'dev-new', 'event')]).toEqual([]);
});
