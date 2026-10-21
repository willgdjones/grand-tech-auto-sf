import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getAngel,
  getAngelByCheckoutId,
  incrementPitchCount,
  insertPendingAngel,
  listAngelsBySponsor,
  listLiveAngels,
  publishAngel,
  removeAngel,
  takenSpotIds,
} from './store';
import type { SponsoredAngelDraft } from '@gtasf/shared/sponsoredAngels';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0022_sponsored_angels.sql', import.meta.url), 'utf8'));
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
  const now = Date.UTC(2026, 9, 5, 18, 0, 0);
  const draft = (over: Partial<SponsoredAngelDraft> = {}): SponsoredAngelDraft => ({
    displayName: 'Lane Capital', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId: 'fidi-jackson-alley', ...over,
  });
  return { sqlite, db, now, draft };
}

describe('sponsored-angels store', () => {
  it('inserts pending, publishes live, and lists for spawn + dashboard', async () => {
    const { db, now, draft } = setup();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft: draft(), checkoutId: 'cs_test_1', now });
    const pending = await getAngel(db, 'a1');
    expect(pending?.status).toBe('pending');
    expect(pending?.tier).toBe('angel');
    expect(pending?.pitchCount).toBe(0);
    expect(await listLiveAngels(db)).toHaveLength(0);

    expect(await publishAngel(db, 'a1', now + 10)).toBe('published');
    const live = await listLiveAngels(db);
    expect(live).toHaveLength(1);
    expect(live[0]!.displayName).toBe('Lane Capital');
    expect(live[0]!.publishedAt).toBe(now + 10);
    expect(await takenSpotIds(db)).toEqual(['fidi-jackson-alley']);
    expect((await listAngelsBySponsor(db, 'dev-1'))).toHaveLength(1);
  });

  it('refuses a second live angel on a taken spot, but frees it on removal', async () => {
    const { db, now, draft } = setup();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft: draft(), now });
    await insertPendingAngel(db, { id: 'a2', sponsorDeviceId: 'dev-2', draft: draft(), now });
    expect(await publishAngel(db, 'a1', now)).toBe('published');
    expect(await publishAngel(db, 'a2', now)).toBe('spot-taken');

    await removeAngel(db, 'a1', now + 5);
    expect((await getAngel(db, 'a1'))?.status).toBe('removed');
    expect(await takenSpotIds(db)).toEqual([]);
    // The spot is free again, so the second angel can now go live.
    expect(await publishAngel(db, 'a2', now + 6)).toBe('published');
  });

  it('counts pitches only against a live angel', async () => {
    const { db, now, draft } = setup();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft: draft(), now });
    // Not live yet → no increment.
    expect(await incrementPitchCount(db, 'a1')).toBe(0);
    await publishAngel(db, 'a1', now);
    expect(await incrementPitchCount(db, 'a1')).toBe(1);
    expect(await incrementPitchCount(db, 'a1')).toBe(2);
    expect((await getAngel(db, 'a1'))?.pitchCount).toBe(2);
  });

  it('finds a pending angel by its checkout id (webhook settlement seam)', async () => {
    const { db, now, draft } = setup();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft: draft(), checkoutId: 'cs_test_42', now });
    expect((await getAngelByCheckoutId(db, 'cs_test_42'))?.id).toBe('a1');
    expect(await getAngelByCheckoutId(db, 'cs_test_unknown')).toBeNull();
  });

  it('will not publish a non-pending angel', async () => {
    const { db, now, draft } = setup();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft: draft(), now });
    await publishAngel(db, 'a1', now);
    expect(await publishAngel(db, 'a1', now)).toBe('not-pending');
    expect(await publishAngel(db, 'missing', now)).toBe('not-pending');
  });
});
