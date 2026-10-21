import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, ORIENTATION_RING, insideOrientationRing, tutorialStepFor } from './tutorial';

// Ferry spawn (LOCAL_SPAWN) in world centimetres, for the ~100 m distance check.
const SPAWN = { x: 119_687, z: -122_431 };

describe('tutorial mission model', () => {
  it('runs walk → drive_ring → gps → taxi, each mapped to its onboarding step', () => {
    expect(TUTORIAL_STEPS.map(s => s.id)).toEqual(['walk', 'drive_ring', 'gps', 'taxi']);
    expect(TUTORIAL_STEPS.every(s => s.step === s.id)).toBe(true);
    expect(TUTORIAL_STEPS.every(s => s.objective.length > 0 && s.hint.length > 0)).toBe(true);
  });

  it('places the Orientation ring about 100 m from the Ferry spawn', () => {
    const metres = Math.hypot(ORIENTATION_RING.x - SPAWN.x, ORIENTATION_RING.z - SPAWN.z) / 100;
    expect(metres).toBeGreaterThanOrEqual(80);
    expect(metres).toBeLessThanOrEqual(130);
    expect(ORIENTATION_RING.radiusCm).toBeGreaterThan(0);
  });

  it('detects drive-through inside the ring but not at the edge+1 or at spawn', () => {
    expect(insideOrientationRing(ORIENTATION_RING.x, ORIENTATION_RING.z)).toBe(true);
    expect(insideOrientationRing(ORIENTATION_RING.x, ORIENTATION_RING.z + ORIENTATION_RING.radiusCm)).toBe(true);
    expect(insideOrientationRing(ORIENTATION_RING.x, ORIENTATION_RING.z + ORIENTATION_RING.radiusCm + 1)).toBe(false);
    expect(insideOrientationRing(SPAWN.x, SPAWN.z)).toBe(false);
  });

  it('maps only the four mission steps, not intro/identity/done', () => {
    expect(tutorialStepFor('drive_ring')?.id).toBe('drive_ring');
    expect(tutorialStepFor('taxi')?.id).toBe('taxi');
    expect(tutorialStepFor('intro')).toBeUndefined();
    expect(tutorialStepFor('identity')).toBeUndefined();
    expect(tutorialStepFor('done')).toBeUndefined();
  });
});
