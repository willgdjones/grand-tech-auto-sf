/** USD cents are decimal strings at the API boundary; sum with bigint. */
export const REFERRAL_WINDOW_MS = 30 * 86_400_000;
export const REFERRAL_PENDING_MS = 7 * 86_400_000;
export const REFERRAL_RATE_PERCENT = 20;
export const REFERRAL_CASHOUT_START_MS = Date.UTC(2026, 9, 12, 7); // Oct 12 00:00 America/Los_Angeles.
export const REFERRAL_CASHOUT_MINIMUM_CENTS = 5000;
export type ReferralProduct = 'outbid' | 'ad' | 'billboard';
export interface ReferralProfile {
  code: string;
  clicks: number;
  players: number;
  pendingCents: string;
  availableCents: string;
  debtCents?: string;
  claimed: boolean;
  creditEnabled: boolean;
  claimEnabled: boolean;
  cashoutEnabled: boolean;
}
export function validReferralCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
}
export function validReferralVisit(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
/** Never attach our referrer code to another site's event/checkout URL. */
export function addReferralToUrl(input: string | URL, code: string, origin: string): string {
  const url = new URL(input, origin);
  if (url.origin === new URL(origin).origin) {
    // Email proofs must never escape in a player's shared URL, even after a failed claim.
    if (new URLSearchParams(url.hash.slice(1)).has('referral-claim')) url.hash = '';
    if (validReferralCode(code)) url.searchParams.set('ref', code);
  }
  return url.href;
}
