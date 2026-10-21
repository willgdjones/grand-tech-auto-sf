/**
 * "Become an angel" — player-sponsored angel NPCs (docs/engineering/become-an-angel.md,
 * bead gtasf-become-an-angel-7ggb). Pure types + validators shared by the worker submit route
 * and the web HUD form. No I/O, no flag read here; the feature's entry points
 * (route/HUD) gate on the `becomeAnAngel` flag and own the charge (Stripe-gated).
 *
 * Self-sponsorship is opt-in, so there is no third-party likeness; the always-visible
 * "player-sponsored" label keeps it from reading as an official endorsement.
 */
import { normalizeFundingName } from './funding';

/**
 * ~$100 in integer **USD** cents, config-driven. The live Stripe account defaults to GBP, so the
 * checkout MUST set `currency: 'usd'` explicitly. Keys are configured (live); charges stay OFF in
 * production behind the `becomeAnAngel` flag until a founder-approved single $1 live test (gtasf-e5m).
 */
export const SPONSORED_ANGEL_PRICE_USD_CENTS = 10000n;
/** The always-visible tag shown over a sponsored angel so it never reads as official. */
export const SPONSORED_ANGEL_LABEL = 'Angel (player-sponsored)';
/** Sponsored angels get the base cheque tier; they do not buy a bigger payout. */
export const SPONSORED_ANGEL_TIER = 'angel' as const;
/** Max length of the one-line pitch reply. */
export const SPONSOR_LINE_MAX = 140;

export type SponsoredAngelStatus = 'pending' | 'live' | 'removed';

/** A clean, validated submission before it is persisted. */
export interface SponsoredAngelDraft {
  readonly displayName: string;
  readonly line: string;
  readonly avatarColor: string | null;
  readonly spotId: string;
}

/** A persisted sponsored angel (mirrors the `sponsored_angels` table, 0022 migration). */
export interface SponsoredAngel extends SponsoredAngelDraft {
  readonly id: string;
  readonly sponsorDeviceId: string;
  readonly tier: string;
  readonly status: SponsoredAngelStatus;
  readonly pitchCount: number;
  readonly createdAt: number;
  readonly publishedAt: number | null;
  readonly removedAt: number | null;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalise a sponsor's display name — reuses the funding startup-name rules (NFC, 2–48 chars). */
export function normalizeSponsorName(value: unknown): string {
  return normalizeFundingName(value, 'startup');
}

/** Normalise the one-line pitch reply: strip control/format chars, collapse whitespace, 1–140 chars. */
export function normalizeSponsorLine(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('Enter a line for your angel');
  // Strip control/format chars but keep tab/newline/return so they collapse to a single space
  // rather than joining adjacent words.
  const clean = value.normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = [...clean].length;
  if (length < 1 || length > SPONSOR_LINE_MAX) throw new RangeError(`Line must be 1–${SPONSOR_LINE_MAX} characters`);
  return clean;
}

/** Validate an optional avatar colour as a #rgb/#rrggbb hex string; null when omitted. */
export function normalizeAvatarColor(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !HEX.test(value.trim())) throw new RangeError('Choose a colour like #4f7cff');
  return value.trim().toLowerCase();
}

export interface SponsorDraftInput {
  readonly displayName: unknown;
  readonly line: unknown;
  readonly avatarColor?: unknown;
  readonly spotId: unknown;
}

/**
 * Validate a raw submission, throwing RangeError with a user-facing message on the first problem.
 * Jev moderation of name/line (over OpenRouter, gtasf-openrouter-migration-wxbt) runs separately at
 * the route; this is only shape/length/allow-list validation. `isSpotAllowed` is supplied by the
 * caller so it can exclude spots already taken by a live sponsored angel.
 */
export function validateSponsorDraft(raw: SponsorDraftInput, isSpotAllowed: (spotId: string) => boolean): SponsoredAngelDraft {
  const displayName = normalizeSponsorName(raw.displayName);
  const line = normalizeSponsorLine(raw.line);
  const avatarColor = normalizeAvatarColor(raw.avatarColor);
  if (typeof raw.spotId !== 'string' || !isSpotAllowed(raw.spotId)) throw new RangeError('Pick an available spot');
  return { displayName, line, avatarColor, spotId: raw.spotId };
}
