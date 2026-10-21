import { expect, test } from 'vitest';
import {
  CROCKFORD_ALPHABET, RECOVERY_CODE_LENGTH, RECOVERY_PREFIX,
  generateRecoveryCode, formatRecoveryCode, normalizeRecoveryCode, isRecoveryCode,
} from './recovery';

test('generated codes are 8 in-alphabet symbols and random', () => {
  const codes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
    for (const char of code) expect(CROCKFORD_ALPHABET).toContain(char);
    codes.add(code);
  }
  expect(codes.size).toBeGreaterThan(190); // 40 bits of entropy: collisions over 200 are vanishingly unlikely.
});

test('format shows the GTASF-XXXX-XXXX display form', () => {
  expect(formatRecoveryCode('ABCD2345')).toBe('GTASF-ABCD-2345');
  expect(RECOVERY_PREFIX).toBe('GTASF');
});

test('normalize round-trips the display form and the raw code', () => {
  const code = generateRecoveryCode();
  expect(normalizeRecoveryCode(formatRecoveryCode(code))).toBe(code);
  expect(normalizeRecoveryCode(code)).toBe(code);
});

test('normalize is forgiving: prefix/dashes/spaces/case optional', () => {
  expect(normalizeRecoveryCode('gtasf-abcd-2345')).toBe('ABCD2345');
  expect(normalizeRecoveryCode('ABCD2345')).toBe('ABCD2345');
  expect(normalizeRecoveryCode('  abcd 2345 ')).toBe('ABCD2345');
  expect(normalizeRecoveryCode('GTASFABCD2345')).toBe('ABCD2345');
  expect(normalizeRecoveryCode('gtasf abcd-2345')).toBe('ABCD2345');
});

test('normalize folds Crockford look-alikes O->0 and I/L->1', () => {
  // Lower/upper look-alikes map to their canonical digits.
  expect(normalizeRecoveryCode('GTASF-O1Il-2345')).toBe('01112345');
  expect(normalizeRecoveryCode('gtasf-oOiI-llLL')).toBe('00111111');
});

test('normalize rejects excluded letters, bad length and junk', () => {
  expect(normalizeRecoveryCode('GTASF-ABCU-2345')).toBeNull(); // U is not in Crockford base32
  expect(normalizeRecoveryCode('ABCD234')).toBeNull();          // too short
  expect(normalizeRecoveryCode('ABCD23456')).toBeNull();        // too long
  expect(normalizeRecoveryCode('ABCD-23$5')).toBeNull();        // punctuation
  expect(normalizeRecoveryCode('')).toBeNull();
  expect(isRecoveryCode('GTASF-ABCD-2345')).toBe(true);
  expect(isRecoveryCode('nope')).toBe(false);
});
