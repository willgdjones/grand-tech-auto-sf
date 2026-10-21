import { flags } from '@gtasf/shared/flags';
import { freshOnboarding, returningOnboarding, parseOnboarding } from '@gtasf/shared/onboarding/state';
import type { Env } from '../env';
import { ensureFundingDevice, fundingSameOrigin } from '../funding/identity';
import { smallJson } from '../world/admission/http';
import { getOnboardingState, saveOnboardingState } from './store';

function json(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}

/**
 * Onboarding state endpoints (PLAN-onboarding.md, gtasf-n34i), behind `flags.onboarding`:
 *   GET  /api/onboarding/state           -> { state }   (load; fresh for a new device, returning otherwise)
 *   POST /api/onboarding/state { state } -> { state }   (persist the client's progress)
 * Direct-D1 so it can issue the gtasf_device cookie, mirroring handleRecoveryRequest. The state is
 * cosmetic UI progress (shared/onboarding/state.ts), re-validated with parseOnboarding and never trusted
 * as gameplay — the tutorial's one-time cheque is awarded server-side through funding (separate slice).
 */
export async function handleOnboardingRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/onboarding/')) return null;
  if (!flags.onboarding) return json({ error: 'Onboarding is disabled' }, 503);
  if (!fundingSameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);
  const now = Date.now();
  try {
    if (path === '/api/onboarding/state' && request.method === 'GET') {
      const identity = await ensureFundingDevice(request, env.DB, now);
      const saved = await getOnboardingState(env.DB, identity.deviceId);
      // New devices are seeded when funding/referrals mint their cookie, before this GET. Only
      // genuine pre-onboarding devices have an existing cookie without any saved state.
      const state = saved ?? (identity.cookie ? freshOnboarding() : returningOnboarding());
      return json({ state }, 200, identity.cookie);
    }
    if (path === '/api/onboarding/state' && request.method === 'POST') {
      const identity = await ensureFundingDevice(request, env.DB, now);
      const body = await smallJson(request);
      if (!body || typeof body !== 'object') return json({ error: 'Missing state' }, 400);
      // Tolerate both client body shapes: { state: <serialized string | object> } (api.ts
      // saveOnboardingState) AND a bare parsed state object carrying a `step` field (an earlier client
      // build POSTed the state directly, which 400'd on prod — console errors fail playtest acceptance).
      // Genuine garbage (no `state`, no `step`) still 400s. parseOnboarding re-validates either shape.
      const b = body as Record<string, unknown>;
      const payload = 'state' in b ? b.state : ('step' in b ? b : undefined);
      if (payload === undefined) return json({ error: 'Missing state' }, 400);
      const state = parseOnboarding(payload);
      await saveOnboardingState(env.DB, identity.deviceId, state, now);
      return json({ state }, 200, identity.cookie);
    }
    return json({ error: 'Not found' }, 404);
  } catch {
    return json({ error: 'Onboarding is temporarily unavailable' }, 503);
  }
}
