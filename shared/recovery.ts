/**
 * Account recovery code codec (PLAN-v2 founder feature, flag `accountRecovery`).
 *
 * Anonymous players save their startup with a single memorable code shown as
 * `GTASF-XXXX-XXXX`: the `GTASF` prefix plus 8 Crockford base32 characters
 * (alphabet excludes I, L, O, U to avoid confusion). On entry the code is
 * accepted with or without the prefix and dashes, case-insensitive, with the
 * Crockford aliases O→0 and I/L→1 folded in.
 *
 * This module is pure (no DOM / Worker / D1 dependency) so both the client and
 * the worker use the same canonicalisation. The server owns the salted/peppered
 * hash and storage; see `worker/src/recovery/*`.
 */

/** Crockford base32: digits 0-9 then A-Z without I, L, O, U. 32 symbols. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_PREFIX = 'GTASF';
/** Number of Crockford symbols after the prefix (40 bits of entropy). */
export const RECOVERY_CODE_LENGTH = 8;

/** Crockford input aliases: forgiving transcription of look-alike characters. */
const ALIASES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

/** A cryptographically random canonical code: 8 uppercase Crockford symbols, no prefix/dashes. */
export function generateRecoveryCode(): string {
  // 256 is an exact multiple of 32, so `byte % 32` is unbiased across the alphabet.
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += CROCKFORD_ALPHABET[bytes[i]! % 32];
  return code;
}

/** Display form for a canonical code: `GTASF-XXXX-XXXX`. */
export function formatRecoveryCode(code: string): string {
  return `${RECOVERY_PREFIX}-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

/**
 * Canonicalise user-entered text to the 8-symbol uppercase code, or null when it
 * is not a valid recovery code. Accepts the `GTASF` prefix and dashes/spaces in
 * any case, and folds the Crockford look-alikes (O→0, I/L→1). `U` is not part of
 * the alphabet and is rejected.
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  let text = input.toUpperCase().replace(/[\s-]+/g, '');
  if (text.startsWith(RECOVERY_PREFIX)) text = text.slice(RECOVERY_PREFIX.length);
  let out = '';
  for (const char of text) {
    const mapped = ALIASES[char] ?? char;
    if (!CROCKFORD_ALPHABET.includes(mapped)) return null;
    out += mapped;
  }
  return out.length === RECOVERY_CODE_LENGTH ? out : null;
}

/** True when `input` canonicalises to a well-formed recovery code. */
export const isRecoveryCode = (input: string): boolean => normalizeRecoveryCode(input) !== null;
