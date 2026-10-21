/**
 * Email-capture API contract (emailCapture, gtasf-1aon, founder 2026-10-04). Shared request/response
 * shapes for the optional "Save your startup" flow: submit an email -> receive a 6-digit code + a magic
 * link -> verify -> earn the cosmetic "Verified founder" tick + a modest one-time cheque. The WORKER is the
 * single source of truth for verification and for the (one-per-profile, one-per-address) reward; the client
 * only reflects status. No raw address or code appears in these types beyond the single inbound submit, and
 * the worker never logs either (founder constraint).
 */

/** Verification status for the current device/profile (GET /api/email/status). */
export interface EmailStatus {
  /** The feature is usable right now: flag on AND the Cloudflare send_email binding is configured. When
   *  false the client MUST NOT show the card or Game-options entry (no fake "check your inbox"). */
  available: boolean;
  /** An address is recorded for this profile but not yet verified (a live code/link is outstanding). */
  pending: boolean;
  /** This profile has a verified email. */
  verified: boolean;
  /** The verified-founder reward (tick + cheque) has been granted to this profile. */
  rewarded: boolean;
}

/** POST /api/email/start — submit an address; the worker sends a code + magic link. */
export interface EmailStartRequest { email: string; }
export interface EmailStartResponse {
  /** A code + link were sent (or would have been). Identical for new and existing addresses (no
   *  enumeration), matching the waitlist endpoint's privacy stance. */
  sent: boolean;
  /** Seconds the client must wait before offering "Resend" (server-enforced). */
  resendAfterSec: number;
  /** Minutes the code/link stay valid, for the client copy. */
  expiresInMin: number;
}

/** POST /api/email/verify — submit the 6-digit code; the magic link hits the same logic via GET ?token=. */
export interface EmailVerifyRequest { code: string; }
export interface EmailVerifyResponse {
  verified: boolean;
  /** The reward just granted (or already held) once verified. Absent when verification failed. */
  reward?: EmailReward;
  /** Attempts left before the outstanding code is locked (returned on a wrong code). */
  attemptsLeft?: number;
  error?: string;
}

/** The non-farmable verified-founder reward: a cosmetic tick plus a modest one-time cheque. */
export interface EmailReward {
  /** The gold "Verified founder" nameplate tick is now on this profile. */
  verifiedFounder: boolean;
  /** One-time bonus cheque in integer cents (sized by pane 1 ~ 10 min of early econ-v3 earnings). 0 when
   *  the profile or address already claimed it. */
  bonusCents: number;
}

/** Verification copy is separate from account recovery, which still requires a recovery code. */
export const EMAIL_PITCH = 'Verify your email for a Verified Founder tick and a Tech Week recap.';
export const EMAIL_RECOVERY_HINT = 'Keep your recovery code to restore your startup on another device.';
export const EMAIL_CONSENT = "We'll email you about GTASF. Unsubscribe anytime.";

/** Code/link policy — shared so the client copy and the server enforcement never drift. */
export const EMAIL_CODE_DIGITS = 6;
export const EMAIL_CODE_TTL_MIN = 30;
export const EMAIL_RESEND_SEC = 30; // founder, Oct 6: 'Resend' after 30 s (codes can land in Spam/Promotions)
export const EMAIL_MAX_ATTEMPTS = 5;

/** One-time verified-founder bonus cheque, in integer cents. Sized against the live economy v3 (40% event
 *  bases, Seed $75k; docs/economy/v3-review.md): $2.5k ≈ one live demo event, ~3% of Seed, so it is a
 *  noticeable thank-you that can't move a player up the ladder. Granted once per profile AND once per
 *  address, only after verification (so fake emails can't farm it). [gtasf-1aon, gtasf-2904] */
export const EMAIL_VERIFY_BONUS_CENTS = 250_000;

/** A 6-digit numeric code as sent and entered (used by client input validation and server checks). */
export function isWellFormedEmailCode(code: string): boolean {
  return new RegExp(`^\\d{${EMAIL_CODE_DIGITS}}$`).test(code);
}

/** Minimal shared email-shape check (lowercased+trimmed by the caller), matching the waitlist route. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
