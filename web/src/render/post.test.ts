import { describe, expect, it } from 'vitest';
import { REFERENCE_GRADE, SA_GRADE, referenceGrade, saGrade } from './post';

const span = (c: readonly [number, number, number]) => Math.max(...c) - Math.min(...c);
const WHITE = [1, 1, 1] as const;

describe('San Andreas colour grade (the vivid stage; referenceGrade off = vivid toggle)', () => {
  it('keeps the SA stage itself free of a global black lift and desaturation (the reference look is a later stage)', () => {
    expect(SA_GRADE.lift).toBe(0);
    expect(SA_GRADE.sat).toBe(1);
  });

  it('keeps blacks true (no global lift washing the shadows grey)', () => {
    const black = saGrade([0, 0, 0], WHITE);
    for (const c of black) expect(c).toBeCloseTo(0, 6);
  });

  it('preserves saturation — the grade no longer pulls channels toward luminance', () => {
    const red = [1, 0, 0] as const;
    // At the vivid default (sat 1), chroma survives the grade unchanged.
    expect(span(saGrade(red, WHITE))).toBeCloseTo(span(red), 6);
    // A forced sat < 1 would still desaturate, proving the parameter, not the pass, is neutral.
    expect(span(saGrade(red, WHITE, SA_GRADE.lift, 0.85))).toBeLessThan(span(red));
  });

  it('leaves a mid-grey exactly where it is — neither cut nor lifted', () => {
    const grey = saGrade([0.5, 0.5, 0.5], WHITE);
    expect(grey[0]).toBeCloseTo(grey[1], 6);
    expect(grey[1]).toBeCloseTo(grey[2], 6);
    expect(grey[0]).toBeCloseTo(0.5, 6);
  });

  it('applies the per-time tint (a warm tint keeps red above blue)', () => {
    const warm = saGrade([0.5, 0.5, 0.5], [1.2, 1.0, 0.8]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });

  it('clamps to the unit range', () => {
    for (const c of saGrade([1, 1, 1], [1.3, 1.3, 1.3])) { expect(c).toBeLessThanOrEqual(1); expect(c).toBeGreaterThanOrEqual(0); }
  });
});

describe('referenceGrade (critique #5: desaturated, lifted, cool-shadow default)', () => {
  const GOLDEN = [1.2, 1.0, 0.78] as const;
  it('lifts blacks off pure black, slightly blue', () => {
    const black = referenceGrade([0, 0, 0]);
    expect(black[0]).toBeGreaterThan(0.005);
    expect(black[2]).toBeGreaterThan(black[0]);
  });
  it('desaturates: a strong red keeps less chroma than the vivid stage', () => {
    expect(span(referenceGrade([0.8, 0.1, 0.1]))).toBeLessThan(span(saGrade([0.8, 0.1, 0.1], WHITE)));
  });
  it('gives a cool shadow side and warm-neutral highlights', () => {
    const shadow = referenceGrade([0.04, 0.04, 0.04]), light = referenceGrade([0.7, 0.7, 0.7]);
    expect(shadow[2]).toBeGreaterThan(shadow[0]);
    expect(light[0]).toBeGreaterThan(light[2]);
  });
  it('pulls the golden-hour orange cast back toward neutral', () => {
    const vivid = saGrade([0.5, 0.5, 0.5], GOLDEN), ref = referenceGrade(vivid, GOLDEN);
    expect(ref[0] - ref[2]).toBeLessThan((vivid[0] - vivid[2]) * 0.6);
  });
  it('softens contrast and stays in range', () => {
    const lo = referenceGrade([0.05, 0.05, 0.05]), hi = referenceGrade([0.9, 0.9, 0.9]);
    expect(hi[1] - lo[1]).toBeLessThan(0.9 - 0.05);
    for (const c of referenceGrade([1, 1, 1], GOLDEN)) { expect(c).toBeLessThanOrEqual(1); expect(c).toBeGreaterThanOrEqual(0); }
    expect(REFERENCE_GRADE.sat).toBeLessThan(1);
  });
});
