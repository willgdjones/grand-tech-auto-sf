import { describe, expect, it } from 'vitest';
import { ORIENTATION_RING, ORIENTATION_SOURCE_REF, WALK_MARKER } from '@gtasf/shared/onboarding/tutorial';
import type { OnboardingStep } from '@gtasf/shared/onboarding/state';
import { createTutorialDriver, onFootInRingObjective, ORIENTATION_FALLBACK_MS, tutorialTarget, walkDone, walkObjective, type TutorialFrame } from './tutorialDriver';

function harness(step: OnboardingStep) {
  const cleared: OnboardingStep[] = [], objectives: string[] = [];
  const state = { step, hints: [], completed: false, skipped: false, emailPrompts: 0 };
  const flow = {
    get state() { return state; },
    stepCleared(s: OnboardingStep) { if (s === state.step) { cleared.push(s); } },
    updateObjective(t: string) { objectives.push(t); },
  };
  return { driver: createTutorialDriver({ flow, isTouch: false }), cleared, objectives };
}
const frame = (over: Partial<TutorialFrame>): TutorialFrame => ({
  mode: 'on-foot', x: 0, y: 3.33, z: 0, speed: 0, running: false, riding: false, scooterAvailable: true, fundingOnline: true, now: 0, ...over,
});
const atMarker = { x: WALK_MARKER.x / 100, z: WALK_MARKER.z / 100 };
const atRing = { x: ORIENTATION_RING.x / 100, z: ORIENTATION_RING.z / 100 };

describe('tutorial driver', () => {
  it('clears walk at the marker without sprinting or using the available scooter', () => {
    expect(walkDone({ marker: true, sprint: false, scooter: false })).toBe(true);
    expect(walkDone({ marker: false, sprint: true, scooter: true })).toBe(false);
    const h = harness('walk');
    h.driver.update(frame({ ...atMarker, x: atMarker.x + 5.9 }));
    expect(h.driver.walk).toEqual({ marker: true, sprint: false, scooter: false });
    expect(h.cleared).toEqual(['walk']);
    expect(tutorialTarget('walk')?.radius).toBe(6);
  });

  it('does not require the scooter when personal rides are unavailable', () => {
    const h = harness('walk');
    h.driver.update(frame({ ...atMarker, running: true, speed: 6, scooterAvailable: false }));
    expect(h.cleared).toEqual(['walk']);
    expect(walkObjective({ marker: false, sprint: false, scooter: false }, false, false)).not.toContain('scooter');
  });

  it('drive_ring: walking through never clears; driving waits for the server award', () => {
    const h = harness('drive_ring');
    h.driver.update(frame({ ...atRing }));
    h.driver.update(frame({ ...atRing, mode: 'driver', now: 1000 }));
    expect(h.cleared).toEqual([]);
    expect(h.driver.onAward(ORIENTATION_SOURCE_REF)).toBe('orientation');
    expect(h.cleared).toEqual(['drive_ring']);
  });

  it('drive_ring: a foot player IN the ring is told (once) to get in a car — the silent-no-op fix', () => {
    const h = harness('drive_ring');
    h.driver.update(frame({ ...atRing }));                 // walked into the ring on foot
    h.driver.update(frame({ ...atRing, now: 500 }));       // still on foot in the ring
    expect(h.objectives).toEqual([onFootInRingObjective(false)]); // warned exactly once, not per frame
    expect(h.cleared).toEqual([]);                          // still no credit (drive-only)
    expect(onFootInRingObjective(false)).toMatch(/press E/);
    expect(onFootInRingObjective(true)).toMatch(/tap Enter/);
  });

  it('drive_ring falls back locally when funding is offline or the award is slow', () => {
    const offline = harness('drive_ring');
    offline.driver.update(frame({ ...atRing, mode: 'driver', fundingOnline: false }));
    expect(offline.cleared).toEqual(['drive_ring']);
    const slow = harness('drive_ring');
    slow.driver.update(frame({ ...atRing, mode: 'driver', now: 1000 }));
    slow.driver.update(frame({ ...atRing, mode: 'driver', now: 1000 + ORIENTATION_FALLBACK_MS }));
    expect(slow.cleared).toEqual(['drive_ring']);
  });

  it('gps clears on a destination pick and taxi on a real event award', () => {
    const gps = harness('gps');
    gps.driver.destinationSelected();
    expect(gps.cleared).toEqual(['gps']);
    const taxi = harness('taxi');
    expect(taxi.driver.onAward('luma:abc')).toBe('event');
    expect(taxi.cleared).toEqual(['taxi']);
  });

  it('targets the walk marker and ring in metres, nothing afterwards', () => {
    expect(tutorialTarget('walk')).toMatchObject({ x: WALK_MARKER.x / 100, z: WALK_MARKER.z / 100 });
    expect(tutorialTarget('drive_ring')?.radius).toBe(ORIENTATION_RING.radiusCm / 100);
    expect(tutorialTarget('gps')).toBeNull();
  });
});
