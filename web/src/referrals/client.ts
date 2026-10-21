import { flags } from '@gtasf/shared/flags';
import { addReferralToUrl, validReferralCode, type ReferralProfile } from '@gtasf/shared/referrals';

let bootstrap: Promise<ReferralProfile | null> | undefined;
let profile: ReferralProfile | null = null;
let claimMessage = '';
const visitId = crypto.randomUUID();
/** Boot and sharing await this client, so bound both headers and body reads. */
async function request<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; value: T }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Referral request timed out. Please try again.')); }, 4000);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetch(`/api/referrals/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, signal: controller.signal });
      const value = await response.json() as T;
      return { response, value };
    })(), timeout]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function refreshReferralProfile(): Promise<ReferralProfile> {
  if (!flags.referrals) throw new Error('Referrals are not available yet.');
  const { response, value } = await request<ReferralProfile>('profile');
  if (!response.ok) throw new Error('Referral balance is temporarily unavailable.');
  if (!validReferralCode(value.code)) throw new Error('Invalid referral profile.');
  profile = value;
  return value;
}
export function initReferrals(): Promise<ReferralProfile | null> {
  if (!flags.referrals) return Promise.resolve(null);
  return bootstrap ??= (async () => {
    try {
      await refreshReferralProfile();
      const proof = new URLSearchParams(location.hash.slice(1)).get('referral-claim');
      if (proof && flags.referralClaims) {
        // Remove the secret fragment before any subsequent share/copy action.
        const clean = new URL(location.href); clean.hash = ''; history.replaceState(null, '', clean);
        try {
          const result = await referralAction('verify', { proof }); claimMessage = result;
          await refreshReferralProfile();
        } catch (error) { claimMessage = error instanceof Error ? error.message : 'Email verification is unavailable.'; }
      }
      const code = new URL(location.href).searchParams.get('ref');
      if (validReferralCode(code)) {
        const { response } = await request('visit', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, visitId }) });
        if (!response.ok) throw new Error('Referral visit is temporarily unavailable.');
      }
      return profile;
    } catch { bootstrap = undefined; return null; }
  })();
}
export async function referralShareUrl(input: string | URL): Promise<string> {
  await initReferrals();
  const current = flags.referrals ? profile : null;
  return addReferralToUrl(input, current?.code ?? '', location.origin);
}
export function referralClaimMessage(): string { return claimMessage; }
export async function referralAction(action: 'claim' | 'verify', body: { email?: string; proof?: string }): Promise<string> {
  if (!(flags.referrals && flags.referralClaims)) throw new Error('Email claims are not available yet. Your earnings remain saved.');
  const { response, value: result } = await request<{ message?: string; error?: string }>(action,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(result.error?.slice(0, 240) ?? 'Email verification is temporarily unavailable.');
  return result.message?.slice(0, 240) ?? 'Request accepted.';
}
