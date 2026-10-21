import { describe, expect, it } from 'vitest';
import {
  SPONSOR_LINE_MAX,
  normalizeAvatarColor,
  normalizeSponsorLine,
  normalizeSponsorName,
  validateSponsorDraft,
} from './sponsoredAngels';
import {
  SPONSORED_ANGEL_SPOTS,
  isSponsoredAngelSpot,
  openSponsoredAngelSpots,
  sponsoredAngelSpot,
} from './content/sponsoredAngelSpots';

describe('sponsor name/line validation', () => {
  it('normalises a plain name and line', () => {
    expect(normalizeSponsorName('  Acme   Capital ')).toBe('Acme Capital');
    expect(normalizeSponsorLine('  back\tthe\nbold  ')).toBe('back the bold');
  });
  it('strips zero-width and bidi control characters', () => {
    expect(normalizeSponsorLine('he​llo‮')).toBe('hello');
  });
  it('rejects an empty or over-long line', () => {
    expect(() => normalizeSponsorLine('   ')).toThrow(RangeError);
    expect(() => normalizeSponsorLine('x'.repeat(SPONSOR_LINE_MAX + 1))).toThrow(RangeError);
    expect(normalizeSponsorLine('x'.repeat(SPONSOR_LINE_MAX)).length).toBe(SPONSOR_LINE_MAX);
  });
  it('rejects a too-short name', () => {
    expect(() => normalizeSponsorName('a')).toThrow(RangeError);
    expect(() => normalizeSponsorName(42)).toThrow(RangeError);
  });
});

describe('avatar colour', () => {
  it('accepts #rgb and #rrggbb and lowercases', () => {
    expect(normalizeAvatarColor('#FFF')).toBe('#fff');
    expect(normalizeAvatarColor(' #4F7CFF ')).toBe('#4f7cff');
  });
  it('treats empty/omitted as null', () => {
    expect(normalizeAvatarColor('')).toBeNull();
    expect(normalizeAvatarColor(undefined)).toBeNull();
    expect(normalizeAvatarColor(null)).toBeNull();
  });
  it('rejects a non-hex colour', () => {
    expect(() => normalizeAvatarColor('red')).toThrow(RangeError);
    expect(() => normalizeAvatarColor('#12')).toThrow(RangeError);
  });
});

const firstSpot = SPONSORED_ANGEL_SPOTS[0]!;

describe('spot allow-list', () => {
  it('has unique ids and finite provisional coordinates', () => {
    const ids = SPONSORED_ANGEL_SPOTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spot of SPONSORED_ANGEL_SPOTS) {
      expect(Number.isFinite(spot.x) && Number.isFinite(spot.z) && Number.isFinite(spot.yaw)).toBe(true);
      expect(spot.label.length).toBeGreaterThan(0);
    }
  });
  it('resolves and excludes taken spots', () => {
    const first = firstSpot.id;
    expect(isSponsoredAngelSpot(first)).toBe(true);
    expect(isSponsoredAngelSpot('not-a-spot')).toBe(false);
    expect(sponsoredAngelSpot(first)?.id).toBe(first);
    const open = openSponsoredAngelSpots([first]);
    expect(open.some(s => s.id === first)).toBe(false);
    expect(open.length).toBe(SPONSORED_ANGEL_SPOTS.length - 1);
  });
});

describe('validateSponsorDraft', () => {
  const allow = (id: string) => isSponsoredAngelSpot(id);
  it('returns a clean draft for good input', () => {
    const spotId = firstSpot.id;
    const draft = validateSponsorDraft(
      { displayName: 'Lane Capital', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId },
      allow,
    );
    expect(draft).toEqual({ displayName: 'Lane Capital', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId });
  });
  it('rejects an unknown or taken spot', () => {
    expect(() => validateSponsorDraft({ displayName: 'Lane Capital', line: 'Hi', spotId: 'nope' }, allow)).toThrow(RangeError);
    const taken = new Set([firstSpot.id]);
    const openOnly = (id: string) => isSponsoredAngelSpot(id) && !taken.has(id);
    expect(() => validateSponsorDraft({ displayName: 'Lane Capital', line: 'Hi', spotId: firstSpot.id }, openOnly)).toThrow(RangeError);
  });
});
