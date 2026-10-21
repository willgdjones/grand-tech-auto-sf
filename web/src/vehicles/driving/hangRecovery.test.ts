import { describe, expect, it } from 'vitest';
import { advanceHangRecovery, carIsHanging, HANG_RECOVERY } from './hangRecovery';

const grounded = (h: number, vy = 0) => ({ groundSampled: true, heightAboveGround: h, verticalSpeed: vy });
const noGround = (vy = 0) => ({ groundSampled: false, heightAboveGround: 0, verticalSpeed: vy });

describe('carIsHanging', () => {
  it('is false for a car sitting on the road', () => {
    expect(carIsHanging(grounded(0))).toBe(false);
    expect(carIsHanging(grounded(0.3))).toBe(false); // suspension / kerb slack
  });

  it('is true when there is no ground sample under the car (unloaded chunk / void)', () => {
    expect(carIsHanging(noGround())).toBe(true);
    expect(carIsHanging(noGround(3))).toBe(true); // even while moving: no ground is always stuck
  });

  it('is true when hovering high above the ground with ~zero vertical speed', () => {
    expect(carIsHanging(grounded(10, 0))).toBe(true);
    expect(carIsHanging(grounded(10, 0.4))).toBe(true); // within still threshold
  });

  it('is false when high but actively falling or rising (a real jump / fall, not a hang)', () => {
    expect(carIsHanging(grounded(10, -8))).toBe(false); // falling
    expect(carIsHanging(grounded(10, 6))).toBe(false);  // launched upward
  });

  it('respects the hover-height threshold', () => {
    expect(carIsHanging(grounded(HANG_RECOVERY.hoverHeight - 0.1, 0))).toBe(false);
    expect(carIsHanging(grounded(HANG_RECOVERY.hoverHeight + 0.1, 0))).toBe(true);
  });

  it('treats a NaN/Infinite physics state as stuck', () => {
    expect(carIsHanging(grounded(2, Number.NaN))).toBe(true);
    expect(carIsHanging(grounded(2, Number.POSITIVE_INFINITY))).toBe(true);
  });
});

describe('advanceHangRecovery', () => {
  it('does not recover before the hold time elapses', () => {
    let hangMs = 0, recovered = false;
    for (let t = 0; t < HANG_RECOVERY.holdMs - 100; t += 100) {
      const r = advanceHangRecovery(hangMs, 100, noGround());
      hangMs = r.hangMs; recovered ||= r.recover;
    }
    expect(recovered).toBe(false);
    expect(hangMs).toBeGreaterThan(0);
  });

  it('recovers once the car has hung continuously past holdMs, then resets the timer', () => {
    let hangMs = 0;
    // 1.5s of hanging at 100ms steps -> should trip exactly when the accumulator reaches holdMs.
    const steps = HANG_RECOVERY.holdMs / 100;
    let fired = 0;
    for (let i = 0; i < steps; i++) {
      const r = advanceHangRecovery(hangMs, 100, grounded(12, 0));
      hangMs = r.hangMs; if (r.recover) fired++;
    }
    expect(fired).toBe(1);
    expect(hangMs).toBe(0); // reset after firing
  });

  it('resets the timer the moment the car is back on the ground', () => {
    let hangMs = 0;
    for (let i = 0; i < 10; i++) hangMs = advanceHangRecovery(hangMs, 100, noGround()).hangMs; // 1.0s hung
    expect(hangMs).toBe(1000);
    const back = advanceHangRecovery(hangMs, 100, grounded(0, 0)); // landed
    expect(back.recover).toBe(false);
    expect(back.hangMs).toBe(0);
  });

  it('clamps a huge frame delta so a single long frame (tab stall / GC pause) cannot trip recovery', () => {
    const r = advanceHangRecovery(0, 60_000, noGround());
    // One stalled frame adds at most the per-frame cap (100ms), nowhere near holdMs: recovery needs the hang
    // to persist across several real frames, not one long one.
    expect(r.recover).toBe(false);
    expect(r.hangMs).toBeLessThanOrEqual(100);
    expect(r.hangMs).toBeGreaterThan(0);
    expect(advanceHangRecovery(0, -5, noGround()).hangMs).toBe(0); // negative dt ignored
  });

  it('does not accumulate while the car is grounded and still (normal parked car)', () => {
    let hangMs = 0;
    for (let i = 0; i < 100; i++) hangMs = advanceHangRecovery(hangMs, 16, grounded(0, 0)).hangMs;
    expect(hangMs).toBe(0);
  });
});
