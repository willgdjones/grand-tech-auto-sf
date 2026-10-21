import { describe, expect, it } from 'vitest';
import { PAINTED_LADY_SCHEME_COUNT, paintedLadyScheme } from './paintedLadyPalette';

describe('paintedLadyScheme', () => {
  it('is deterministic for a given index', () => {
    expect(paintedLadyScheme(2)).toEqual(paintedLadyScheme(2));
  });

  it('gives adjacent houses distinct body colours across the row', () => {
    for (let i = 0; i < PAINTED_LADY_SCHEME_COUNT - 1; i++) {
      expect(paintedLadyScheme(i).body).not.toBe(paintedLadyScheme(i + 1).body);
    }
  });

  it('exposes a palette of all-distinct body colours', () => {
    const bodies = new Set(Array.from({ length: PAINTED_LADY_SCHEME_COUNT }, (_, i) => paintedLadyScheme(i).body));
    expect(bodies.size).toBe(PAINTED_LADY_SCHEME_COUNT);
  });

  it('wraps after the palette length and handles negative / fractional indices', () => {
    expect(paintedLadyScheme(PAINTED_LADY_SCHEME_COUNT)).toEqual(paintedLadyScheme(0));
    expect(paintedLadyScheme(-1)).toEqual(paintedLadyScheme(PAINTED_LADY_SCHEME_COUNT - 1));
    expect(paintedLadyScheme(2.9)).toEqual(paintedLadyScheme(2));
  });

  it('every scheme is a valid 24-bit RGB body + trim', () => {
    for (let i = 0; i < PAINTED_LADY_SCHEME_COUNT; i++) {
      const { body, trim } = paintedLadyScheme(i);
      for (const c of [body, trim]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
