/**
 * Username rules (PLAN-v2.1 decision 5, gtasf-q4yo). Globally unique, case-insensitive usernames for
 * the friends system. Pure + shared so the client validates before submit and the worker validates +
 * keys uniqueness on the same rules. Display form keeps the player's casing; `key` (casefolded) is the
 * UNIQUE column. Offensive content is caught separately by Jev moderation (worker/src/friends/moderation).
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
/** Reserved handles that must not be claimable (impersonation / confusion). Casefolded. */
const RESERVED = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'founder', 'gtasf', 'system',
  'root', 'official', 'null', 'undefined', 'anonymous', 'me', 'you', 'everyone', 'here',
]);

export interface NormalizedUsername {
  /** As claimed (casing preserved) — what others see. */
  display: string;
  /** Casefolded uniqueness key — the UNIQUE column. */
  key: string;
}

/** Validate + normalise a desired username. null = invalid (bad length, chars, or reserved). */
export function normalizeUsername(input: unknown): NormalizedUsername | null {
  if (typeof input !== 'string') return null;
  const display = input.trim();
  if (display.length < USERNAME_MIN || display.length > USERNAME_MAX || !USERNAME_RE.test(display)) return null;
  const key = display.toLowerCase();
  if (RESERVED.has(key)) return null;
  return { display, key };
}

export function isValidUsername(input: unknown): boolean {
  return normalizeUsername(input) !== null;
}

/**
 * Derive a valid username base from an existing display nickname (which may have spaces, emoji or
 * punctuation), for the "migrate existing nicknames" default / conflict suggestions. Strips to the
 * allowed charset, trims to the max length, pads short results. null if nothing usable remains.
 */
export function deriveUsernameBase(nickname: unknown): string | null {
  if (typeof nickname !== 'string') return null;
  const stripped = nickname.normalize('NFKD').replace(/[^a-zA-Z0-9_]+/g, '').slice(0, USERNAME_MAX);
  if (stripped.length >= USERNAME_MIN && !RESERVED.has(stripped.toLowerCase())) return stripped;
  return null;
}

/**
 * Suggest available usernames from a base by appending digits, skipping taken keys. Pure: the caller
 * supplies `isTaken(key)` (a D1 lookup result). Returns up to `count` display suggestions.
 */
export function usernameSuggestions(base: string, isTaken: (key: string) => boolean, count = 3): string[] {
  const out: string[] = [];
  const root = (deriveUsernameBase(base) ?? 'founder').slice(0, USERNAME_MAX - 3);
  for (let n = 1; out.length < count && n < 1000; n++) {
    const candidate = n === 1 ? root : `${root}${n}`;
    const norm = normalizeUsername(candidate);
    if (norm && !isTaken(norm.key)) out.push(norm.display);
  }
  return out;
}
