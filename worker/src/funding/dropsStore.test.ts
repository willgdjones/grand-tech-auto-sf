import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scheduleDrop, sponsorForSlot } from '@gtasf/shared/drops';
import { clearDropSponsor, dropClaimCount, dropSponsorOverrides, listDropCapTable, recordDropClaim, setDropSponsor, yourDropClaim } from './dropsStore';

function testDb(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
        async first() { return statement.get(...bindings) ?? null; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
function addDevice(sqlite: DatabaseSync, id: string): void {
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id, `hash-${id}`, `Startup ${id}`, id, 1, 1);
}

it('smoke: pays the first N drive-throughs once each, then marks the drop full, and feeds the cap table', async () => {
  const { db, sqlite } = testDb();
  for (const id of ['alice', 'bob', 'carol']) addDevice(sqlite, id);
  // A capacity-2 drop so the third player is turned away.
  const drop = { ...scheduleDrop(1000), capacity: 2 };
  const now = Date.UTC(2026, 9, 5, 18, 0, 0);

  const first = await recordDropClaim(db, { deviceId: 'alice', drop, now });
  expect(first).toMatchObject({ credited: true, full: false, claimedCount: 1 });
  expect(first.claim).toMatchObject({ dropId: drop.id, position: 1, amountCents: drop.chequeCents });

  // The same player passing through again is idempotent: no second cheque, count unchanged.
  const again = await recordDropClaim(db, { deviceId: 'alice', drop, now: now + 1000 });
  expect(again.credited).toBe(false);
  expect(again.claim?.position).toBe(1);
  expect(await dropClaimCount(db, drop.id)).toBe(1);

  const second = await recordDropClaim(db, { deviceId: 'bob', drop, now: now + 2000 });
  expect(second).toMatchObject({ credited: true, claimedCount: 2 });
  expect(second.claim?.position).toBe(2);

  // Capacity reached: the third player gets no cheque and no claim row.
  const third = await recordDropClaim(db, { deviceId: 'carol', drop, now: now + 3000 });
  expect(third).toEqual({ credited: false, full: true, claim: null, claimedCount: 2 });
  expect(await yourDropClaim(db, 'carol', drop.id)).toBeNull();

  // Cap table lists the cheque as a fund-drop source.
  const capTable = await listDropCapTable(db, 'alice');
  expect(capTable).toHaveLength(1);
  expect(capTable[0]).toMatchObject({ source: 'fund-drop', fundName: drop.fundName, amountCents: drop.chequeCents, position: 1 });

  // The cheque flows into funding_earnings so it counts toward the player's total.
  const total = sqlite.prepare('SELECT COALESCE(SUM(amount_cents),0) t FROM funding_earnings WHERE device_id=?').get('alice') as { t: number };
  expect(total.t).toBe(Number(drop.chequeCents));
});

it('smoke: an operator sponsor renames a drop slot and clears back to parody', async () => {
  const { db } = testDb();
  const slot = 2000, parody = scheduleDrop(slot);
  await setDropSponsor(db, { slot, name: 'Acme Capital', url: 'https://acme.example', now: 1 });
  const overrides = await dropSponsorOverrides(db);
  expect(overrides).toContainEqual({ slot, sponsor: { name: 'Acme Capital', url: 'https://acme.example' } });
  const sponsored = scheduleDrop(slot, sponsorForSlot(overrides, slot));
  expect(sponsored).toMatchObject({ sponsored: true, fundName: 'Acme Capital' });
  expect(sponsored.location).toEqual(parody.location); // geometry/window unchanged by a sponsor
  expect(sponsored.opensAt).toBe(parody.opensAt);

  // Upsert replaces the sponsor for the same slot.
  await setDropSponsor(db, { slot, name: 'Beta Ventures', now: 2 });
  expect((await dropSponsorOverrides(db))[0]!.sponsor).toEqual({ name: 'Beta Ventures' });

  // Clearing releases the slot back to its parody default.
  expect(await clearDropSponsor(db, slot)).toBe(true);
  expect(await dropSponsorOverrides(db)).toEqual([]);
  expect(await clearDropSponsor(db, slot)).toBe(false);

  await expect(setDropSponsor(db, { slot: -1, name: 'X', now: 1 })).rejects.toThrow(RangeError);
  await expect(setDropSponsor(db, { slot, name: '', now: 1 })).rejects.toThrow(RangeError);
});
