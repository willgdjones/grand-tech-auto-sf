import { describe, expect, it } from 'vitest';
import { ellipsePoint, headingFromVelocity, skyAdCreative, SKY_AD_CRAFT, SKY_AD_CREATIVES } from '@gtasf/shared/content/skyAds';

describe('ellipsePoint', () => {
  it('traces a horizontal ellipse around the centre', () => {
    expect(ellipsePoint(100, 200, 50, 30, 0)).toEqual({ x: 150, z: 200 });           // phase 0 → +x
    const quarter = ellipsePoint(100, 200, 50, 30, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(100, 6);                                            // phase π/2 → +z
    expect(quarter.z).toBeCloseTo(230, 6);
    const half = ellipsePoint(0, 0, 10, 10, Math.PI);
    expect(half.x).toBeCloseTo(-10, 6); expect(half.z).toBeCloseTo(0, 6);
  });
});

describe('headingFromVelocity', () => {
  it('points local +Z along the velocity', () => {
    expect(headingFromVelocity(0, 1)).toBeCloseTo(0, 6);            // +z forward → yaw 0
    expect(headingFromVelocity(1, 0)).toBeCloseTo(Math.PI / 2, 6);  // +x → yaw +90°
    expect(headingFromVelocity(0, -1)).toBeCloseTo(Math.PI, 6);     // -z → 180°
  });
});

describe('sky ad content integrity', () => {
  it('every craft references a real creative and is a known kind', () => {
    for (const craft of SKY_AD_CRAFT) {
      expect(skyAdCreative(craft.creativeId), craft.id).toBeDefined();
      expect(['blimp', 'plane']).toContain(craft.kind);
      expect(craft.periodSec).toBeGreaterThan(0);
      expect(craft.radiusXM).toBeGreaterThan(0);
      expect(craft.radiusZM).toBeGreaterThan(0);
    }
  });
  it('has exactly one blimp and at least one plane, with unique ids and slot ids', () => {
    expect(SKY_AD_CRAFT.filter(c => c.kind === 'blimp')).toHaveLength(1);
    expect(SKY_AD_CRAFT.some(c => c.kind === 'plane')).toBe(true);
    expect(new Set(SKY_AD_CRAFT.map(c => c.id)).size).toBe(SKY_AD_CRAFT.length);
    expect(new Set(SKY_AD_CRAFT.map(c => c.slotId)).size).toBe(SKY_AD_CRAFT.length);
  });
  it('creatives have unique ids and non-empty copy', () => {
    expect(new Set(SKY_AD_CREATIVES.map(c => c.id)).size).toBe(SKY_AD_CREATIVES.length);
    for (const creative of SKY_AD_CREATIVES) {
      expect(creative.headline.length).toBeGreaterThan(0);
      expect(creative.subline.length).toBeGreaterThan(0);
    }
  });
});
