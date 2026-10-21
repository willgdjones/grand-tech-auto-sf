import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

// The alias fallback in fundingDeviceByHash only runs when the flag is on.
vi.mock('@gtasf/shared/flags', () => ({ flags: { accountRecovery: true, fundingLoop: true } }));

import {
  recoveryPepper, hashRecoveryCode, setRecoveryCode, hasRecoveryCode,
  deviceForRecoveryCode, addDeviceAlias, setProfileOutfit, getProfileOutfit,
} from './store';
import { createFundingProfile, fundingDeviceByHash } from '../funding/store';
import { generateRecoveryCode, normalizeRecoveryCode } from '@gtasf/shared/recovery';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0010_funding.sql', '0023_account_recovery.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  return {
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
}

test('recoveryPepper: prod requires the secret; dev has a fallback', () => {
  expect(recoveryPepper({ ENVIRONMENT: 'production' } as never)).toBeNull();
  expect(recoveryPepper({ ENVIRONMENT: 'production', RECOVERY_PEPPER: 'x' } as never)).toBe('x');
  expect(recoveryPepper({ ENVIRONMENT: 'local' } as never)).toBeTruthy();
});

test('hashRecoveryCode is deterministic, pepper- and code-sensitive', async () => {
  const a = await hashRecoveryCode('ABCD2345', 'pepper-1');
  expect(await hashRecoveryCode('ABCD2345', 'pepper-1')).toBe(a);        // deterministic
  expect(await hashRecoveryCode('ABCD2345', 'pepper-2')).not.toBe(a);    // pepper matters (salt)
  expect(await hashRecoveryCode('ABCD2346', 'pepper-1')).not.toBe(a);    // code matters
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});

test('code store: round-trip, status, and regenerate invalidates the old code', async () => {
  const db = setup();
  const pepper = 'test-pepper';
  await createFundingProfile(db, 'device-1', 'tok-hash-1', 1000);
  expect(await hasRecoveryCode(db, 'device-1')).toBe(false);

  const first = normalizeRecoveryCode(generateRecoveryCode())!;
  await setRecoveryCode(db, 'device-1', await hashRecoveryCode(first, pepper), 1000);
  expect(await hasRecoveryCode(db, 'device-1')).toBe(true);
  expect(await deviceForRecoveryCode(db, await hashRecoveryCode(first, pepper), 2000)).toBe('device-1');

  // Regenerate: a new code replaces the old one, which now resolves to nothing.
  const second = normalizeRecoveryCode(generateRecoveryCode())!;
  await setRecoveryCode(db, 'device-1', await hashRecoveryCode(second, pepper), 3000);
  expect(await deviceForRecoveryCode(db, await hashRecoveryCode(first, pepper), 4000)).toBeNull();
  expect(await deviceForRecoveryCode(db, await hashRecoveryCode(second, pepper), 4000)).toBe('device-1');
  expect(await deviceForRecoveryCode(db, await hashRecoveryCode('NOSUCH12', pepper), 4000)).toBeNull();
});

test('a recovered device alias resolves to the original profile (old device keeps its own)', async () => {
  const db = setup();
  await createFundingProfile(db, 'device-orig', 'orig-token-hash', 1000); // original device
  // New device gets a fresh cookie token hash aliased to the original profile.
  await addDeviceAlias(db, 'new-token-hash', 'device-orig', 5000);
  expect(await fundingDeviceByHash(db, 'new-token-hash')).toBe('device-orig'); // recovered device -> same profile
  expect(await fundingDeviceByHash(db, 'orig-token-hash')).toBe('device-orig'); // original still resolves directly
  expect(await fundingDeviceByHash(db, 'unknown-hash')).toBeNull();
});

test('outfit cosmetics persist and read back for restore', async () => {
  const db = setup();
  expect(await getProfileOutfit(db, 'device-1')).toBeNull();
  await setProfileOutfit(db, 'device-1', 'Golden Gate green', 1000);
  expect(await getProfileOutfit(db, 'device-1')).toBe('Golden Gate green');
  await setProfileOutfit(db, 'device-1', 'Sunset cream', 2000); // upsert
  expect(await getProfileOutfit(db, 'device-1')).toBe('Sunset cream');
});
