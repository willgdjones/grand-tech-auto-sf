import { CHAT_MAX_BYTES, CHAT_MAX_GRAPHEMES } from './constants';
import { CONFUSABLES } from './confusables.generated';
import { JOIN_D, JOIN_L, JOIN_R, JOIN_T, RGI_TAG_SEQUENCES, VIRAMA_RANGES } from './unicode.generated';

export const NORMALIZER_VERSION = 'n-2026-09-28-u16-v2';
export const CHAT_MAX_MARKS_PER_GRAPHEME = 8;
export type DisplayResult =
  | { ok: true; display: string; graphemes: number; bytes: number }
  | { ok: false; reason: 'EMPTY' | 'TOO_MANY_GRAPHEMES' | 'TOO_MANY_BYTES' | 'PATHOLOGICAL' };
export interface MatchForms {
  base: string;
  leet: string;
  /** Indexed by Unicode code point, not UTF-16 code unit. */
  wasLetter: readonly boolean[];
  leetSquashed: string;
  lettersOnly: string;
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const encoder = new TextEncoder();
const mark = /[\p{Mn}\p{Me}]/u;
const letter = /\p{L}/u;
const pictographic = /\p{Extended_Pictographic}/u;
const emojiDecoration = /[\uFE0F\p{Emoji_Modifier}]/u;
const zeroWidth = /[\u200B-\u200D\u2060\uFEFF]/gu;
const leetMap: Readonly<Record<string, string>> = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
});
function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const [first, last] = ranges[mid]!;
    if (cp < first) hi = mid;
    else if (cp > last) lo = mid + 1;
    else return true;
  }
  return false;
}
function keepJoiner(chars: readonly string[], i: number, beforeChars: readonly string[]): boolean {
  const before = beforeChars.at(-1)?.codePointAt(0);
  if (before !== undefined && inRanges(before, VIRAMA_RANGES)) return true;
  if (chars[i] === '\u200D') {
    let left = beforeChars.length - 1;
    while (left >= 0 && emojiDecoration.test(beforeChars[left]!)) left--;
    return left >= 0 && pictographic.test(beforeChars[left]!) && pictographic.test(chars[i + 1] ?? '');
  }
  let left = beforeChars.length - 1;
  let right = i + 1;
  while (left >= 0 && inRanges(beforeChars[left]!.codePointAt(0)!, JOIN_T)) left--;
  while (right < chars.length && inRanges(chars[right]!.codePointAt(0)!, JOIN_T)) right++;
  if (left < 0 || right >= chars.length) return false;
  const a = beforeChars[left]!.codePointAt(0)!;
  const b = chars[right]!.codePointAt(0)!;
  return (inRanges(a, JOIN_L) || inRanges(a, JOIN_D)) && (inRanges(b, JOIN_R) || inRanges(b, JOIN_D));
}
function cleanJoiners(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  const result: string[] = [];
  let pending: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== '\u200C' && ch !== '\u200D') {
      pending.push(ch);
      continue;
    }
    // A removed joiner lets marks reorder. Decide the next joiner's left context
    // from the cleaned NFC prefix, so a chain is resolved in this same traversal.
    const prefix = pending.join('').normalize('NFC');
    pending = Array.from(prefix);
    if (keepJoiner(chars, i, pending)) {
      result.push(prefix, ch);
      // A kept joiner blocks canonical composition/reordering across this boundary.
      pending = [];
    }
  }
  result.push(pending.join('').normalize('NFC'));
  return result.join('');
}
function cleanTags(text: string): string {
  let result = '';
  for (let i = 0; i < text.length;) {
    const sequence =
      text.codePointAt(i) === 0x1f3f4 ? RGI_TAG_SEQUENCES.find((tag) => text.startsWith(tag, i)) : undefined;
    if (sequence) {
      result += sequence;
      i += sequence.length;
      continue;
    }
    const cp = text.codePointAt(i)!;
    if (cp < 0xe0000 || cp > 0xe007f) result += String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return result;
}
export function countGraphemes(text: string): number {
  let count = 0;
  for (const ignored of segmenter.segment(text)) {
    void ignored;
    count++;
  }
  return count;
}
export function normalizeDisplay(text: string): DisplayResult {
  return normalizeDisplayText(text, { maxGraphemes: CHAT_MAX_GRAPHEMES, maxBytes: CHAT_MAX_BYTES });
}
export function normalizeDisplayText(
  text: string,
  limits: { maxGraphemes: number; maxBytes?: number },
): DisplayResult {
  if (
    !Number.isSafeInteger(limits.maxGraphemes) ||
    limits.maxGraphemes < 0 ||
    (limits.maxBytes !== undefined && (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 0))
  )
    throw new RangeError('Invalid display limits');
  // The wire decoder is fatal UTF-8; direct JS callers may supply lone surrogates.
  const wellFormed = Array.from(text, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : ch;
  }).join('');
  const cleaned = cleanTags(
    wellFormed
      .normalize('NFC')
      .replace(/[\t\n\r]/g, ' ')
      .replace(/[\p{Cc}\p{Bidi_Control}\u200B\u2060\uFEFF]/gu, ''),
  );
  const normalized = cleanJoiners(cleaned);
  for (const { segment } of segmenter.segment(normalized)) {
    let marks = 0;
    // Count canonical marks so a precomposed accent cannot evade the eight-mark bound.
    for (const ch of segment.normalize('NFD'))
      if (mark.test(ch) && ++marks > CHAT_MAX_MARKS_PER_GRAPHEME)
        return { ok: false, reason: 'PATHOLOGICAL' };
  }
  const display = normalized.replace(/\p{White_Space}+/gu, ' ').trim();
  if (!display) return { ok: false, reason: 'EMPTY' };
  const graphemes = countGraphemes(display);
  if (graphemes > limits.maxGraphemes) return { ok: false, reason: 'TOO_MANY_GRAPHEMES' };
  const bytes = encoder.encode(display).byteLength;
  if (limits.maxBytes !== undefined && bytes > limits.maxBytes)
    return { ok: false, reason: 'TOO_MANY_BYTES' };
  return { ok: true, display, graphemes, bytes };
}
export function matchForms(display: string): MatchForms {
  const base = Array.from(
    display.normalize('NFKC').toLowerCase().replace(zeroWidth, ''),
    (ch) => CONFUSABLES[ch] ?? ch,
  ).join('');
  const chars = Array.from(base);
  const wasLetter = chars.map((ch) => letter.test(ch));
  const leetChars = chars.map((ch) => leetMap[ch] ?? ch);
  let previous = '';
  let repeats = 0;
  let leetSquashed = '';
  for (const ch of leetChars) {
    repeats = ch === previous ? repeats + 1 : 1;
    if (repeats <= 2) leetSquashed += ch;
    previous = ch;
  }
  return {
    base,
    leet: leetChars.join(''),
    wasLetter,
    leetSquashed,
    lettersOnly: Array.from(leetSquashed)
      .filter((ch) => letter.test(ch))
      .join(''),
  };
}
