import { fundingDevice, ensureFundingDevice } from '../funding/identity';
import { ensureReferralAccount, referralAccountForDevice } from './store';

/** Public codes identify referrers, never authenticate a balance or an email claim. */
export async function referralIdentity(request: Request, db: D1Database, create = false, now = Date.now()) {
  if (create) {
    const identity = await ensureFundingDevice(request, db, now);
    return { ...identity, account: await ensureReferralAccount(db, identity.deviceId, now) };
  }
  const deviceId = await fundingDevice(request, db);
  if (!deviceId) return null;
  const account = await referralAccountForDevice(db, deviceId);
  return account ? { deviceId, account, cookie: undefined } : null;
}
export function referralSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return (!site || site === 'same-origin' || site === 'none')
    && (request.method === 'GET' ? !origin || origin === new URL(request.url).origin : origin === new URL(request.url).origin);
}
