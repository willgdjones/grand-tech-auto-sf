import { describe, expect, it } from 'vitest';
import { Color, ColorManagement } from 'three';
import { enableLinearColorManagement } from './colorManagement';
import { sampleTimeGrade } from './timeGrade';

/** Independent re-derivation of the sRGB electro-optical transfer function, so the
 * expectations below do not just mirror three's own Color decode. */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

describe('linear colour management for the SA sky grade', () => {
  it('pins ColorManagement.enabled so hex keyframes decode sRGB -> linear', () => {
    enableLinearColorManagement();
    expect(ColorManagement.enabled).toBe(true);
    // Mid-grey hex is ~0.502 in sRGB but ~0.216 once decoded to the linear working space.
    expect(new Color('#808080').r).toBeCloseTo(srgbToLinear(128 / 255), 3);
  });

  it('blends the time-grade keyframes in LINEAR space, not raw sRGB', () => {
    enableLinearColorManagement();
    // 16:00Z on 2026-10-03 is 09:00 SF (PDT) — exactly halfway between the hour-7
    // (#bcc4cb) and hour-11 (#a9c8e0) keyframes, so smoothstep(0.5) = 0.5.
    const grade = sampleTimeGrade(Date.parse('2026-10-03T16:00:00Z'));
    expect(grade.hour).toBeCloseTo(9, 5);

    const linearLerp = srgbToLinear(0xbc / 255) + (srgbToLinear(0xa9 / 255) - srgbToLinear(0xbc / 255)) * 0.5;
    const srgbRawLerp = (0xbc / 255 + 0xa9 / 255) / 2;

    // The grade must match the linear-space blend of the two keyframes...
    expect(grade.horizon.r).toBeCloseTo(linearLerp, 3);
    // ...and be clearly distinct from an (incorrect) sRGB-space blend.
    expect(Math.abs(grade.horizon.r - srgbRawLerp)).toBeGreaterThan(0.05);
  });
});
