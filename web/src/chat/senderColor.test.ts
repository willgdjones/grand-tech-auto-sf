import { describe, expect, it } from 'vitest';
import { SELF_SENDER_COLOR, SENDER_COLORS, senderColor } from './senderColor';

const HEX = /^#[0-9a-f]{6}$/i;

describe('senderColor', () => {
  it('is stable for the same key and always a palette hex', () => {
    expect(senderColor('alice')).toBe(senderColor('alice'));
    expect(senderColor(42)).toBe(senderColor(42));
    for (const key of ['alice', 'bob', 'Zuck', 7, 99999, '']) {
      const c = senderColor(key);
      expect(c).toMatch(HEX);
      expect(SENDER_COLORS).toContain(c);
    }
  });
  it('returns the fixed self colour when self=true', () => {
    expect(senderColor('alice', true)).toBe(SELF_SENDER_COLOR);
    expect(senderColor(1, true)).toBe(SELF_SENDER_COLOR);
  });
  it('spreads distinct keys across the palette (not all one colour)', () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => senderColor(`player-${i}`)));
    expect(used.size).toBeGreaterThan(4);
  });
  it('palette entries are unique, readable hexes', () => {
    expect(new Set(SENDER_COLORS).size).toBe(SENDER_COLORS.length);
    for (const c of SENDER_COLORS) expect(c).toMatch(HEX);
  });
});
