import { describe, expect, it } from 'vitest';
import { normalizeUsername, isValidUsername, deriveUsernameBase, usernameSuggestions, USERNAME_MAX } from './username';

describe('normalizeUsername', () => {
  it('accepts a valid handle, preserving casing but keying casefolded', () => {
    expect(normalizeUsername('Karl_SF')).toEqual({ display: 'Karl_SF', key: 'karl_sf' });
    expect(normalizeUsername('  trimmed  ')).toEqual({ display: 'trimmed', key: 'trimmed' });
  });
  it('rejects bad length, characters, and reserved handles', () => {
    expect(normalizeUsername('ab')).toBeNull();                 // too short
    expect(normalizeUsername('a'.repeat(USERNAME_MAX + 1))).toBeNull(); // too long
    expect(normalizeUsername('has space')).toBeNull();
    expect(normalizeUsername('emoji🌁')).toBeNull();
    expect(normalizeUsername('bad-dash')).toBeNull();
    expect(normalizeUsername('Admin')).toBeNull();              // reserved (casefolded)
    expect(normalizeUsername(42)).toBeNull();
  });
  it('case-insensitive uniqueness: different casings share one key', () => {
    expect(normalizeUsername('Founder99')!.key).toBe(normalizeUsername('FOUNDER99')!.key);
  });
  it('isValidUsername mirrors normalize', () => {
    expect(isValidUsername('Karl_SF')).toBe(true);
    expect(isValidUsername('no')).toBe(false);
  });
});

describe('deriveUsernameBase', () => {
  it('strips a display nickname to the allowed charset', () => {
    expect(deriveUsernameBase('Karl 🌁 Founder')).toBe('KarlFounder');
    expect(deriveUsernameBase('a'.repeat(30))).toHaveLength(USERNAME_MAX);
  });
  it('returns null when nothing usable remains', () => {
    expect(deriveUsernameBase('🌁🌴')).toBeNull();
    expect(deriveUsernameBase('ab')).toBeNull();
    expect(deriveUsernameBase('admin')).toBeNull(); // reserved
  });
});

describe('usernameSuggestions', () => {
  it('appends digits and skips taken keys', () => {
    const taken = new Set(['karl', 'karl2']);
    expect(usernameSuggestions('Karl', k => taken.has(k), 3)).toEqual(['Karl3', 'Karl4', 'Karl5']);
  });
  it('returns the base first when free, and respects the max length', () => {
    expect(usernameSuggestions('Ada', () => false, 1)).toEqual(['Ada']);
    const long = usernameSuggestions('a'.repeat(30), () => false, 1)[0]!;
    expect(long.length).toBeLessThanOrEqual(USERNAME_MAX);
  });
});
