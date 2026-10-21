import { describe, it, expect } from 'vitest';
import { advanceSlide, objectiveArrowLayout, slideMood } from './saMission';

// Smoke coverage for the pure geometry/state helpers behind the onboarding SA UI kit (gtasf-ha2l).
// The DOM classes are browser-only and verified by tsc + pane 6's fresh-profile smoke; this file
// pins the maths pane 14 depends on. No DOM here (repo vitest runs in node, no jsdom).

describe('advanceSlide', () => {
  it('steps forward without completing in the middle', () => {
    expect(advanceSlide(0, 3)).toEqual({ index: 1, done: false });
    expect(advanceSlide(1, 3)).toEqual({ index: 2, done: false });
  });
  it('completes once advanced past the last slide', () => {
    expect(advanceSlide(2, 3)).toEqual({ index: 2, done: true });
  });
  it('is defensive about empty/invalid totals', () => {
    expect(advanceSlide(0, 0)).toEqual({ index: 0, done: true });
    expect(advanceSlide(0, 1)).toEqual({ index: 0, done: true });
  });
});

describe('slideMood', () => {
  it('cycles day/gold/dusk by slide index', () => {
    expect([slideMood(0), slideMood(1), slideMood(2)]).toEqual(['day', 'gold', 'dusk']);
    expect(slideMood(3)).toBe('day'); // wraps
  });
  it('is defensive about negative/fractional indices', () => {
    expect(slideMood(-1)).toBe('dusk');
    expect(slideMood(1.9)).toBe('gold');
  });
});

describe('objectiveArrowLayout', () => {
  const view = { w: 1000, h: 800 }; // centre (500, 400)

  it('reports onScreen and sits on the target when it is inside the viewport', () => {
    const l = objectiveArrowLayout(600, 500, view);
    expect(l.onScreen).toBe(true);
    expect(l.x).toBe(600);
    expect(l.y).toBe(500);
  });

  it('points the up-triangle toward the target bearing', () => {
    // Straight up from centre → 0deg.
    expect(objectiveArrowLayout(500, 100, view).angleDeg).toBeCloseTo(0, 5);
    // Directly right → +90deg (clockwise).
    expect(objectiveArrowLayout(900, 400, view).angleDeg).toBeCloseTo(90, 5);
    // Directly down → 180deg.
    expect(Math.abs(objectiveArrowLayout(500, 700, view).angleDeg)).toBeCloseTo(180, 5);
    // Directly left → -90deg.
    expect(objectiveArrowLayout(100, 400, view).angleDeg).toBeCloseTo(-90, 5);
  });

  it('clamps an off-screen target to the inset rectangle edge', () => {
    const inset = 56;
    const l = objectiveArrowLayout(5000, 400, view, inset); // far to the right, same height as centre
    expect(l.onScreen).toBe(false);
    // Hugs the right inset edge; y stays at centre height.
    expect(l.x).toBeCloseTo(view.w - inset, 5);
    expect(l.y).toBeCloseTo(400, 5);
    // Stays within the inset bounds on both axes.
    expect(l.x).toBeGreaterThanOrEqual(inset);
    expect(l.x).toBeLessThanOrEqual(view.w - inset);
    expect(l.y).toBeGreaterThanOrEqual(inset);
    expect(l.y).toBeLessThanOrEqual(view.h - inset);
  });

  it('clamps a far diagonal target inside the inset box', () => {
    const inset = 56;
    const l = objectiveArrowLayout(-4000, -3000, view, inset); // far up-left
    expect(l.onScreen).toBe(false);
    expect(l.x).toBeGreaterThanOrEqual(inset);
    expect(l.x).toBeLessThanOrEqual(view.w - inset);
    expect(l.y).toBeGreaterThanOrEqual(inset);
    expect(l.y).toBeLessThanOrEqual(view.h - inset);
  });
});
