import { secretToken } from '../world/admission/http';
import { createFundingProfile, fundingDeviceByHash } from './store';
import { flags } from '@gtasf/shared/flags';
import { freshOnboarding } from '@gtasf/shared/onboarding/state';
import { saveOnboardingState } from '../onboarding/store';

const COOKIE = 'gtasf_device';
export async function hashToken(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
/** The gtasf_device Set-Cookie string (shared by new-device minting and account recovery). */
export function fundingCookie(request: Request, token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function fundingDevice(request: Request, db: D1Database): Promise<string | null> {
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return fundingDeviceByHash(db, await hashToken(token));
}
/** Automated test visits send a gtasf_bot=1 session cookie (web/src/analytics/bot.ts). */
export function isBotRequest(request: Request): boolean {
  return request.headers.get('cookie')?.split(';').some(part => part.trim() === 'gtasf_bot=1') === true;
}
/** Mark a profile as an automated test visit so player counts exclude it (migration 0033). Never fails the request. */
async function markBot(db: D1Database, deviceId: string): Promise<void> {
  try { await db.prepare('UPDATE funding_profiles SET is_bot=1 WHERE device_id=? AND is_bot IS NOT 1').bind(deviceId).run(); } catch { /* pre-0033 DB */ }
}
export async function ensureFundingDevice(request: Request, db: D1Database, now: number): Promise<{ deviceId: string; cookie?: string }> {
  const existing = await fundingDevice(request, db), bot = isBotRequest(request);
  if (existing) { if (bot) await markBot(db, existing); return { deviceId: existing }; }
  const token = secretToken(), deviceId = crypto.randomUUID();
  await createFundingProfile(db, deviceId, await hashToken(token), now);
  if (bot) await markBot(db, deviceId);
  // Referrals/funding mint the cookie before the client mounts onboarding. Record first-visit
  // state here so that later GET cannot mistake this new device for a pre-onboarding returner.
  if (flags.onboarding) await saveOnboardingState(db, deviceId, freshOnboarding(), now);
  return { deviceId, cookie: fundingCookie(request, token) };
}
export function fundingSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
