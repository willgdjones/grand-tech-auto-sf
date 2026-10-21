import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MAX_CREDIT_CENTS, alreadyCredited, creditedRefs, getCapTable, recordFundingCredit } from './credits';
import { celebById, celebChequeCents, celebLabel } from '@gtasf/shared/content/celebs';
import { getFundingProfile } from './store';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  // VC drops (0018) create fund_drop_claims; the funding_credits view (0020) unions it, so apply both.
  for (const migration of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
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
  const now = Date.UTC(2026, 9, 5, 18, 0, 0); // Oct 5 2026, 11:00 SF time.
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('dev-1', 'hash-1', 'Fogware', 'Foggy', now, now);
  return { sqlite, db, now };
}

it('smoke: credits pay once-ever, roll into totals, and group on the cap table across sources', async () => {
  const { sqlite, db, now } = setup();
  try {
    const first = await recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: 'ron-conway', label: 'Ron Conway', amountCents: 500_000_000n, now });
    expect(first.credited).toBe(true);
    expect(first.credit.amountCents).toBe('500000000');

    // Once ever: the same (source, ref) does not pay twice.
    const dup = await recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: 'ron-conway', label: 'Ron Conway', amountCents: 500_000_000n, now: now + 1000 });
    expect(dup.credited).toBe(false);
    expect(await alreadyCredited(db, 'dev-1', 'celebrity', 'ron-conway')).toBe(true);

    // A drive-through event credit, and a VC fund-drop cheque in pane 7's separate committed ledger.
    await recordFundingCredit(db, { deviceId: 'dev-1', source: 'event', sourceRef: 'evt-1', label: 'AI Mixer', amountCents: 100_000_000n, now });
    sqlite.prepare(`INSERT INTO fund_drop_claims(id,device_id,season,drop_id,slot,fund_name,sponsored,position,amount_cents,claimed_at,day)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('d1', 'dev-1', 'sf-tech-week-2026', 'drop-1', 0, 'Dry Powder Partners', 0, 1, 25_000_000, now, '2026-10-05');

    // Totals flow through the funding_earnings view (25M + 500M + 100M).
    const profile = await getFundingProfile(db, 'dev-1', now);
    expect(profile.totalCents).toBe('625000000');

    const cap = await getCapTable(db, 'dev-1', now);
    expect(cap.totalCents).toBe('625000000');
    expect(cap.startupName).toBe('Fogware');
    // Groups follow the canonical source order and exclude empty sources (no warm-intro yet).
    expect(cap.groups.map(group => group.source)).toEqual(['event', 'vc-drop', 'celebrity']);
    const bySource = Object.fromEntries(cap.groups.map(group => [group.source, group]));
    expect(bySource['vc-drop']!.totalCents).toBe('25000000');
    expect(bySource['vc-drop']!.entries[0]!.label).toBe('Dry Powder Partners');
    expect(bySource['celebrity']!.entries[0]!.label).toBe('Ron Conway');
    expect(bySource['event']!.totalCents).toBe('100000000');
    expect([...await creditedRefs(db, 'dev-1', 'event')]).toEqual(['evt-1']);
  } finally { sqlite.close(); }
});

it('includes v1 event-room awards and referral warm intros on the cap table', async () => {
  const { sqlite, db, now } = setup();
  try {
    // A v1 "work the room" award and a referral warm-intro bonus predate v2 credits.
    sqlite.prepare(`INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('a1', 'dev-1', 'sf-tech-week-2026', 'evt-room', 'Founders Breakfast', '2026-10-05', now, now, 50_000_000, '{}');
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('friend-1', 'hash-f', 'Friendware', 'Pal', now, now);
    sqlite.prepare(`INSERT INTO funding_bonuses(id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents)
      VALUES(?,?,?,?,?,?,?,?)`).run('b1', 'dev-1', 'friend-1', 'sf-tech-week-2026', 'warm-intro', '2026-10-05', now, 10_000_000);

    const cap = await getCapTable(db, 'dev-1', now);
    const bySource = Object.fromEntries(cap.groups.map(group => [group.source, group]));
    expect(bySource['event']!.entries[0]!.label).toBe('Founders Breakfast');
    expect(bySource['event']!.totalCents).toBe('50000000');
    expect(bySource['warm-intro']!.totalCents).toBe('10000000');
    expect(cap.totalCents).toBe('60000000');
  } finally { sqlite.close(); }
});

it('credits a celebrity pitch at the tier cheque, labelled for the cap table, once ever', async () => {
  const { sqlite, db, now } = setup();
  try {
    const npc = celebById('ron-conway')!; // 'notable' tier = $2M
    const first = await recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: npc.id, label: celebLabel(npc), amountCents: celebChequeCents(npc.id), now });
    expect(first.credited).toBe(true);
    expect(first.credit.amountCents).toBe('200000000');
    const angels = (await getCapTable(db, 'dev-1', now)).groups.find(g => g.source === 'celebrity')!;
    expect(angels.entries[0]!.label).toBe('Ron Conway (parody)');
    expect(angels.totalCents).toBe('200000000');
    // Once ever: re-pitching the same investor pays nothing.
    expect((await recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: npc.id, label: celebLabel(npc), amountCents: celebChequeCents(npc.id), now: now + 1 })).credited).toBe(false);
    expect([...await creditedRefs(db, 'dev-1', 'celebrity')]).toEqual(['ron-conway']);
  } finally { sqlite.close(); }
});

it('rejects out-of-range, malformed and VC-drop credits', async () => {
  const { sqlite, db, now } = setup();
  try {
    await expect(recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: 'x', label: 'X', amountCents: 0n, now })).rejects.toThrow();
    await expect(recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: 'y', label: 'Y', amountCents: MAX_CREDIT_CENTS + 1n, now })).rejects.toThrow();
    await expect(recordFundingCredit(db, { deviceId: 'dev-1', source: 'nope' as never, sourceRef: 'z', label: 'Z', amountCents: 10n, now })).rejects.toThrow();
    await expect(recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: '', label: 'Blank', amountCents: 10n, now })).rejects.toThrow();
    // VC fund drops belong in fund_drop_claims, never in the funding_credits ledger.
    await expect(recordFundingCredit(db, { deviceId: 'dev-1', source: 'vc-drop', sourceRef: 'drop-x', label: 'Drop', amountCents: 10n, now })).rejects.toThrow();
  } finally { sqlite.close(); }
});
