import type { FundingProfile } from '@gtasf/shared/funding';

/**
 * Account-recovery API client (gtasf-17df). Same-origin, credentialed calls to the recovery
 * endpoints. The server owns the gtasf_device cookie: restore rebinds it to the saved profile,
 * so after a successful restore the client just reloads to re-init the game as that profile.
 */

export interface RecoveryStatus { hasCode: boolean }
export interface RestoreResult { profile: FundingProfile; outfit: string | null }

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
}

export async function recoveryStatus(): Promise<RecoveryStatus> {
  const response = await call('/api/recovery/status');
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json() as Promise<RecoveryStatus>;
}

/** Generate (or regenerate) the recovery code for this device; returns the GTASF-XXXX-XXXX form. */
export async function saveRecoveryCode(outfit?: string): Promise<string> {
  const response = await call('/api/recovery/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outfit ? { outfit } : {}),
  });
  const data = await response.json().catch(() => ({})) as { code?: string; error?: string };
  if (!response.ok || !data.code) throw new Error(data.error || `create failed (${response.status})`);
  return data.code;
}

/** Restore the profile behind `code` onto this device. Throws with a human message on failure. */
export async function restoreRecovery(code: string): Promise<RestoreResult> {
  const response = await call('/api/recovery/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await response.json().catch(() => ({})) as Partial<RestoreResult> & { error?: string };
  if (!response.ok || !data.profile) throw new Error(data.error || `restore failed (${response.status})`);
  return { profile: data.profile, outfit: data.outfit ?? null };
}
