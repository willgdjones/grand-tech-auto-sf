import { NICKNAME_MAX_BYTES } from './constants';

/** Anonymous display labels, never identity credentials. Preserve emoji and non-Latin names. */
export function normalizeNickname(input: string): string | null {
  const name = input.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  // Reject controls, bidi overrides/isolates and invisible-only labels. ZWJ remains valid in emoji.
  if (!name || /[\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(name)) return null;
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name)) return null;
  return new TextEncoder().encode(name).length <= NICKNAME_MAX_BYTES ? name : null;
}
