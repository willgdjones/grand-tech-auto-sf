import { flags } from '@gtasf/shared/flags';
import { normalizeRecoveryCode, generateRecoveryCode, formatRecoveryCode } from '@gtasf/shared/recovery';
import type { Env } from '../env';
import { ensureFundingDevice, fundingSameOrigin, fundingCookie, hashToken } from '../funding/identity';
import { getFundingProfile } from '../funding/store';
import { secretToken } from '../world/admission/http';
import { referralRateLimit } from '../referrals/store';
import { hashedIpKey } from '../referrals/ipLimiter';
import {
  recoveryPepper, hashRecoveryCode, setRecoveryCode, hasRecoveryCode,
  deviceForRecoveryCode, addDeviceAlias, setProfileOutfit, getProfileOutfit,
} from './store';

function json(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try { const value = await request.json(); return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}

/**
 * Account recovery endpoints (gtasf-17df), behind `flags.accountRecovery`:
 *   GET  /api/recovery/status  -> { hasCode }               (does this device have a saved code?)
 *   POST /api/recovery/create  { outfit? } -> { code }      (generate/regenerate; shown once)
 *   POST /api/recovery/restore { code, } -> { profile, outfit }  (bind this device to the saved profile)
 * Direct-D1 so it can issue the gtasf_device cookie, mirroring handleFundingRequest.
 */
export async function handleRecoveryRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/recovery/')) return null;
  if (!flags.accountRecovery) return json({ error: 'Account recovery is disabled' }, 503);
  if (!fundingSameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);
  const now = Date.now();
  try {
    if (path === '/api/recovery/status' && request.method === 'GET') {
      const identity = await ensureFundingDevice(request, env.DB, now);
      return json({ hasCode: await hasRecoveryCode(env.DB, identity.deviceId) }, 200, identity.cookie);
    }
    if (path === '/api/recovery/create' && request.method === 'POST') {
      const pepper = recoveryPepper(env);
      if (!pepper) return json({ error: 'Recovery is not configured' }, 503);
      const identity = await ensureFundingDevice(request, env.DB, now);
      const code = generateRecoveryCode();
      await setRecoveryCode(env.DB, identity.deviceId, await hashRecoveryCode(code, pepper), now);
      const outfit = (await readBody(request)).outfit;
      if (typeof outfit === 'string' && outfit) await setProfileOutfit(env.DB, identity.deviceId, outfit, now);
      return json({ code: formatRecoveryCode(code) }, 200, identity.cookie);
    }
    if (path === '/api/recovery/restore' && request.method === 'POST') {
      const pepper = recoveryPepper(env);
      if (!pepper) return json({ error: 'Recovery is not configured' }, 503);
      // Lockout: at most 6 attempts / 10 min per client IP. With a 40-bit code this makes guessing infeasible.
      const client = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (!await referralRateLimit(env.DB, await hashedIpKey('recover-ip:', 'gtasf-recover', client, now, env.IP_HASH_SECRET), 6, 600_000, now)) // gtasf-cnjpc: no raw IP stored
        return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
      const normalized = normalizeRecoveryCode(String((await readBody(request)).code ?? ''));
      if (!normalized) return json({ error: 'That is not a valid recovery code.' }, 400);
      const deviceId = await deviceForRecoveryCode(env.DB, await hashRecoveryCode(normalized, pepper), now);
      if (!deviceId) return json({ error: 'No startup found for that code.' }, 404);
      // Bind a fresh cookie token to the recovered profile via an alias row; the original device's
      // cookie still resolves to the same profile, so it keeps playing.
      const token = secretToken();
      await addDeviceAlias(env.DB, await hashToken(token), deviceId, now);
      const [profile, outfit] = await Promise.all([getFundingProfile(env.DB, deviceId, now), getProfileOutfit(env.DB, deviceId)]);
      return json({ profile, outfit }, 200, fundingCookie(request, token));
    }
    return json({ error: 'Not found' }, 404);
  } catch {
    return json({ error: 'Recovery is temporarily unavailable' }, 503);
  }
}
