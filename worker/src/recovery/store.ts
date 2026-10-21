import type { Env } from '../env';

/**
 * Account recovery storage (gtasf-17df). The recovery code is hashed with a keyed HMAC whose key
 * (the "pepper") is a worker secret, never stored in D1 — so a leaked `recovery_codes` table cannot
 * be brute-forced offline, while online guessing is bounded by the restore rate limit. See
 * `shared/recovery.ts` for the code codec and `worker/src/recovery/routes.ts` for the endpoints.
 */

// Local/dev fallback only; production requires the RECOVERY_PEPPER secret (recovery 503s without it).
const DEV_PEPPER = 'gtasf-local-recovery-pepper-v1';

export function recoveryPepper(env: Env): string | null {
  if (env.RECOVERY_PEPPER && env.RECOVERY_PEPPER.trim()) return env.RECOVERY_PEPPER;
  return env.ENVIRONMENT === 'production' ? null : DEV_PEPPER;
}

/** Peppered keyed hash of a normalized code, hex-encoded. Deterministic → O(1) lookup. */
export async function hashRecoveryCode(normalized: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Store (or replace) the single active recovery code for a profile; regenerating invalidates the old one. */
export async function setRecoveryCode(db: D1Database, deviceId: string, codeHash: string, now: number): Promise<void> {
  await db.prepare('DELETE FROM recovery_codes WHERE device_id=?').bind(deviceId).run();
  await db.prepare('INSERT INTO recovery_codes(code_hash,device_id,created_at) VALUES(?,?,?)').bind(codeHash, deviceId, now).run();
}

export async function hasRecoveryCode(db: D1Database, deviceId: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM recovery_codes WHERE device_id=? LIMIT 1').bind(deviceId).first());
}

/** Resolve a code hash to its profile device id (and stamp last use), or null if unknown. */
export async function deviceForRecoveryCode(db: D1Database, codeHash: string, now: number): Promise<string | null> {
  const row = await db.prepare('SELECT device_id FROM recovery_codes WHERE code_hash=?').bind(codeHash).first<{ device_id: string }>();
  if (!row) return null;
  await db.prepare('UPDATE recovery_codes SET last_used_at=? WHERE code_hash=?').bind(now, codeHash).run();
  return row.device_id;
}

/** Bind an extra cookie token hash to an existing profile so both devices resolve to it. */
export async function addDeviceAlias(db: D1Database, tokenHash: string, deviceId: string, now: number): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO device_aliases(token_hash,device_id,created_at) VALUES(?,?,?)').bind(tokenHash, deviceId, now).run();
}

export async function setProfileOutfit(db: D1Database, deviceId: string, outfit: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO profile_cosmetics(device_id,outfit,updated_at) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET outfit=excluded.outfit,updated_at=excluded.updated_at')
    .bind(deviceId, outfit, now).run();
}

export async function getProfileOutfit(db: D1Database, deviceId: string): Promise<string | null> {
  return (await db.prepare('SELECT outfit FROM profile_cosmetics WHERE device_id=?').bind(deviceId).first<{ outfit: string | null }>())?.outfit ?? null;
}
