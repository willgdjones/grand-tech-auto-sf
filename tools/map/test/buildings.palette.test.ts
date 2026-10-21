import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/pipeline/buildings';

/**
 * Guards the fragile coupling between the land-use PALETTE here and the facade-STYLE classifier in
 * `web/src/render/facades.ts`, which picks each wall's style from the source vertex-colour channel
 * RATIOS. Saturating the palette (PLAN-v2.1 §4 / pane 9 vivid colour) must keep those ratios inside
 * their bands, or buildings get the wrong facade (e.g. FiDi glass on a Victorian). These predicates
 * mirror the GLSL in facades.ts exactly; keep them in sync if that shader's thresholds change.
 */
type RGB = readonly [number, number, number];
const isOffice = (c: RGB) => c[2] > c[0] * 1.03;
const isIndustrial = (c: RGB) => Math.abs(c[0] - c[1]) < 0.012 && c[1] > c[2] * 1.025;
const isRetail = (c: RGB) => c[0] > c[1] * 1.10 && c[0] < c[1] * 1.17 && c[1] > c[2] * 1.18;
// Everything that is none of the above falls through to the Victorian/Edwardian styles.
const isResidentialStyle = (c: RGB) => !isOffice(c) && !isIndustrial(c) && !isRetail(c);
// The per-building hash in buildings.ts scales every channel by this range (ratio-preserving).
const SCALES = [0.88, 1.0, 1.12] as const;
const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

describe('land-use palette drives the right facade style (facades.ts coupling)', () => {
  it('classifies each land use the way the facade shader expects', () => {
    expect(isOffice(PALETTE.commercial!)).toBe(true);        // FiDi glass
    expect(isIndustrial(PALETTE.industrial!)).toBe(true);    // SoMa brick
    expect(isRetail(PALETTE.retail!)).toBe(true);            // ground-floor shopfronts
    // Homes and civic/religious stock stay on the Victorian/Edwardian path.
    for (const use of ['residential', 'religious', 'civic'] as const) {
      expect(isResidentialStyle(PALETTE[use]!)).toBe(true);
    }
    // The office and industrial signals are mutually exclusive from the residential set.
    expect(isOffice(PALETTE.residential!)).toBe(false);
    expect(isIndustrial(PALETTE.residential!)).toBe(false);
  });

  it('keeps the classification stable across the per-building hash brightness range', () => {
    const classify = (c: RGB) =>
      isOffice(c) ? 'office' : isIndustrial(c) ? 'industrial' : isRetail(c) ? 'retail' : 'residential';
    for (const [use, colour] of Object.entries(PALETTE)) {
      const base = classify(colour);
      for (const f of SCALES) {
        // No channel clips at the brightest hash factor, so the ratios (and the style) survive.
        expect(Math.max(...colour) * f).toBeLessThanOrEqual(1);
        expect(classify(scale(colour, f))).toBe(base);
      }
    }
  });
});
