import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { ReferralProfile } from '@gtasf/shared/referrals';
import type { Env } from '../env';

// A stale cash flag must not restore the retired product. Email verification remains gated.
vi.mock('@gtasf/shared/flags', () => ({ flags: {
  referrals: true, referralCredit: true, referralCashout: true, referralClaims: false,
} }));

import { handleReferralRequest } from './routes';
import { recordReferralPlayer } from './store';

const ORIGIN = 'https://gtasf.test';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  // Deliberately omit the retired cash-ledger schema: invite links/stats must not need it.
  for (const migration of ['0010_funding.sql', '0011_referrals.sql', '0016_referral_claims.sql'])
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
    async batch(statements: D1PreparedStatement[]) { return Promise.all(statements.map(statement => statement.run())); },
  } as unknown as D1Database;
  return { sqlite, db, env: { DB: db } as Env };
}
function request(path: string, cookie?: string, body?: unknown) {
  return new Request(`${ORIGIN}/api/referrals/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it('keeps real referral links and player stats working without a cash ledger, and retires cash-out', async () => {
  const { sqlite, db, env } = setup();
  try {
    const ownerResponse = (await handleReferralRequest(request('profile'), env))!;
    expect(ownerResponse.status).toBe(200);
    const ownerCookie = ownerResponse.headers.get('Set-Cookie')!.split(';')[0]!;
    const owner = await ownerResponse.json() as ReferralProfile;
    expect(owner.code).toMatch(/^[a-f0-9]{24}$/);
    expect(owner).toMatchObject({ clicks: 0, players: 0, claimed: false, creditEnabled: false,
      cashoutEnabled: false, pendingCents: '0', availableCents: '0', debtCents: '0' });

    const friendResponse = (await handleReferralRequest(request('profile'), env))!;
    const friendCookie = friendResponse.headers.get('Set-Cookie')!.split(';')[0]!;
    const friend = await friendResponse.json() as ReferralProfile;
    const visit = { code: owner.code, visitId: crypto.randomUUID() };
    expect((await handleReferralRequest(request('visit', friendCookie, visit), env))!.status).toBe(200);
    // A repeated browser boot must not count the same visit twice.
    expect((await handleReferralRequest(request('visit', friendCookie, visit), env))!.status).toBe(200);
    const friendDevice = sqlite.prepare('SELECT id FROM referral_accounts WHERE code=?').get(friend.code)!.id as string;
    await recordReferralPlayer(db, friendDevice, Date.now());
    sqlite.prepare('UPDATE referral_accounts SET claimed_at=?,email_hash=? WHERE code=?').run(Date.now(), 'verified-email-hash', owner.code);

    const refreshed = (await handleReferralRequest(request('profile', ownerCookie), env))!;
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ code: owner.code, clicks: 1, players: 1, claimed: true,
      creditEnabled: false, cashoutEnabled: false, pendingCents: '0', availableCents: '0' });

    for (const cashoutRequest of [request('cashout'), request('cashout', undefined, {})]) {
      // No authenticated account, DB or payment provider is needed to explain retirement.
      const response = (await handleReferralRequest(cashoutRequest, {} as Env))!;
      expect(response.status).toBe(410);
      const result = await response.json();
      expect(result).toMatchObject({ enabled: false, reason: 'retired' });
      expect(result).not.toHaveProperty('earliestAt');
      expect(result).not.toHaveProperty('minimumCents');
    }
  } finally { sqlite.close(); }
});
