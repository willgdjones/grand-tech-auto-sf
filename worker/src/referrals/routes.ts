import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { smallJson } from '../world/admission/http';
import { referralIdentity, referralSameOrigin } from './identity';
import { recordReferralVisit, referralProfile, referralRateLimit } from './store';
import { claimDeliveryAvailable, requestReferralClaim, verifyReferralClaim, type ReferralMailEnv } from './claims';

export function referralJson(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
export async function handleReferralRequest(request: Request, env: Env & ReferralMailEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/referrals/')) return null;
  if (!flags.referrals) return referralJson({ error: 'Referrals are not yet available' }, 503);
  if (!referralSameOrigin(request)) return referralJson({ error: 'Same-origin request required' }, 403);
  const now = Date.now();
  try {
    if (path === '/api/referrals/cashout' && ['GET', 'POST'].includes(request.method)) {
      return referralJson({ error: 'Referral rewards are in-game funding only. Cash-out has been retired.', enabled: false, reason: 'retired' }, 410);
    }
    if (path === '/api/referrals/profile' && request.method === 'GET') {
      const identity = await referralIdentity(request, env.DB, true, now);
      return referralJson({ ...await referralProfile(env.DB, identity!.account), claimEnabled: flags.referralClaims && claimDeliveryAvailable(env) }, 200, identity!.cookie);
    }
    if (path === '/api/referrals/visit' && request.method === 'POST') {
      const identity = await referralIdentity(request, env.DB);
      if (!identity) return referralJson({ error: 'Start a referral session first' }, 401);
      if (!await referralRateLimit(env.DB, `visit:${identity.deviceId}`, 30, 60_000, now)) return referralJson({ error: 'Try again shortly' }, 429);
      const body = await smallJson(request);
      if (!body || Object.keys(body).some(key => key !== 'code' && key !== 'visitId')) return referralJson({ error: 'Invalid referral visit' }, 400);
      await recordReferralVisit(env.DB, identity.deviceId, body.code, body.visitId, now);
      // Do not reveal whether a submitted public code belongs to a blocked account.
      return referralJson({ ok: true });
    }
    if (['/api/referrals/claim', '/api/referrals/verify'].includes(path) && request.method === 'POST') {
      if (!flags.referralClaims) return referralJson({ error: 'Referral email verification is not available yet. Your referrals remain tracked.' }, 503);
      const identity = await referralIdentity(request, env.DB);
      if (!identity) return referralJson({ error: 'Open the game in the browser that requested the email.' }, 401);
      if (!await referralRateLimit(env.DB, `claim-attempt:${identity.deviceId}`, 15, 60_000, now)) return referralJson({ error: 'Try again shortly.' }, 429);
      const body = await smallJson(request);
      if (!body) return referralJson({ error: 'Invalid email claim.' }, 400);
      if (path.endsWith('/claim')) {
        await requestReferralClaim(env.DB, identity.deviceId, body.email, new URL(request.url).origin, env, now);
        return referralJson({ ok: true, message: 'Check your email and open the link in this browser within 30 minutes.' });
      }
      await verifyReferralClaim(env.DB, identity.deviceId, body.proof, now);
      return referralJson({ ok: true, message: 'Email verified for your referral account.' });
    }
    return referralJson({ error: 'Not found' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'CLAIM_RATE_LIMIT') return referralJson({ error: 'Please wait before requesting another email.' }, 429);
    if (message === 'INVALID_EMAIL') return referralJson({ error: 'Enter a valid email address.' }, 400);
    if (message === 'INVALID_CLAIM') return referralJson({ error: 'This link expired, was used, or belongs to another browser. Request a new link here.' }, 400);
    if (message === 'CLAIM_ACCOUNT_UNAVAILABLE') return referralJson({ error: 'This referral account is already linked to another email.' }, 409);
    if (message === 'CLAIM_DELIVERY_UNAVAILABLE') return referralJson({ error: 'Email delivery is not configured yet. Your referrals remain tracked; no verification email was confirmed.' }, 503);
    return referralJson({ error: 'Referrals are temporarily unavailable' }, 503);
  }
}
