import type { EmailStatus, EmailStartResponse, EmailVerifyResponse } from '@gtasf/shared/email/contract';

/**
 * Email-capture API client (emailCapture, gtasf-1aon). Same-origin, credentialed calls; the server owns the
 * gtasf_device cookie and is the source of truth for verification + the reward. The client only reflects
 * status and never sees a raw stored address back.
 */

async function call(path: string, init?: RequestInit): Promise<Response> {
  // Keep the deadline attached through response-body reads, not just headers.
  // The card's existing catch handlers restore its controls for another attempt.
  return fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, signal: AbortSignal.timeout(10_000) });
}

export async function emailStatus(): Promise<EmailStatus> {
  const response = await call('/api/email/status');
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json() as Promise<EmailStatus>;
}

/** Submit an address; the server sends a 6-digit code + a magic link. Identical result for new/existing. */
export async function startEmailCapture(email: string): Promise<EmailStartResponse> {
  const response = await call('/api/email/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const data = await response.json().catch((error: unknown) => {
    // A truncated/timed-out success body is not confirmation that mail was sent.
    if (response.ok) throw error;
    return {};
  }) as Partial<EmailStartResponse> & { error?: string };
  if (!response.ok) throw new Error(data.error || `We couldn't send that right now (${response.status}).`);
  return { sent: data.sent === true, resendAfterSec: data.resendAfterSec ?? 60, expiresInMin: data.expiresInMin ?? 30 };
}

/** Submit the 6-digit code. Returns the full verify result (verified, reward?, attemptsLeft?, error?). */
export async function verifyEmailCode(code: string): Promise<EmailVerifyResponse> {
  const response = await call('/api/email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  return await response.json().catch((error: unknown) => {
    if (response.ok) throw error;
    return { verified: false, error: `Verification failed (${response.status}).` };
  }) as EmailVerifyResponse;
}
