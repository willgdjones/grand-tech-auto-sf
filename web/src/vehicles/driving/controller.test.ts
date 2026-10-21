import { afterEach, describe, expect, it, vi } from 'vitest';
// Real driving/arcade defaults; the hill-air tests toggle hillJumps (OFF by default).
vi.mock('@gtasf/shared/flags', () => ({ flags: { driving: true, arcadeHandling: true, hillJumps: false, carHangRecovery: false } }));
import { flags } from '@gtasf/shared/flags';
import { applyCarBumps, createDrivingState, defaultDrivingTuning, updateDriving } from './controller';

const testFlags = flags as { hillJumps: boolean; carHangRecovery: boolean };
afterEach(() => { testFlags.hillJumps = false; testFlags.carHangRecovery = false; });

const flat = { heightAt: () => 0 };
const neutral = { steer: 0, throttle: 0, brake: 0, handbrake: false };

describe('carHangRecovery: a car over a void falls instead of hanging', () => {
  const nowhere = { heightAt: () => null }; // no terrain anywhere (unloaded chunk / void)

  it('hangs at its height with the fix off (shipped behaviour)', () => {
    const car = createDrivingState({ x: 0, y: 50, z: 0, yaw: 0 });
    for (let i = 0; i < 60; i++) updateDriving(car, neutral, 1 / 60, nowhere);
    expect(car.y).toBe(50); // ground-locked to its own height -> frozen in the air
  });

  it('falls under gravity with the fix on, until real ground streams in', () => {
    testFlags.carHangRecovery = true;
    const car = createDrivingState({ x: 0, y: 50, z: 0, yaw: 0 });
    for (let i = 0; i < 30; i++) updateDriving(car, neutral, 1 / 60, nowhere); // ~0.5 s of falling
    expect(car.y).toBeLessThan(48); // descending
    expect(car.vy).toBeLessThan(0);
    // Ground appears below the car: it lands and stops falling (no fall-through / hang).
    const groundAt10 = { heightAt: () => 10 };
    for (let i = 0; i < 120; i++) updateDriving(car, neutral, 1 / 60, groundAt10);
    expect(car.y).toBeCloseTo(10, 1);
    expect(car.airborne).toBe(false);
  });

  it('normal flat-ground driving is unaffected by the fix', () => {
    testFlags.carHangRecovery = true;
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    for (let i = 0; i < 60; i++) updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, flat);
    expect(car.y).toBe(0); // stays ground-locked on real ground
    expect(car.airborne).toBe(false);
    expect(car.speed).toBeGreaterThan(0);
  });
});

describe('short arcade braking and drift', () => {
  it('stops from 100 km/h in under 1.3 seconds and 18 metres without damage', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 100 / 3.6;
    let seconds = 0;
    while (car.speed > 0 && seconds < 3) {
      updateDriving(car, { ...neutral, handbrake: true }, 1 / 60, flat);
      seconds += 1 / 60;
    }
    expect(seconds).toBeLessThan(1.3);
    expect(car.z).toBeGreaterThan(12);
    expect(car.z).toBeLessThan(18);
    expect(car.speed).toBe(0);
    updateDriving(car, { ...neutral, throttle: 1 }, .1, flat);
    expect(car.speed).toBeGreaterThan(0);
  });

  it('allows a brief handbrake slide, regains grip promptly, and never exceeds the speed cap', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 20;
    for (let i = 0; i < 12; i++) updateDriving(car, { ...neutral, steer: 1, handbrake: true }, 1 / 60, flat);
    expect(Math.abs(car.slip)).toBeGreaterThan(.02);
    expect(Math.abs(car.slip)).toBeLessThan(.2);
    expect(car.yaw).toBeLessThan(0);
    for (let i = 0; i < 24; i++) updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, flat);
    expect(Math.abs(car.slip)).toBeLessThan(.005);
    for (let i = 0; i < 240; i++) updateDriving(car, { ...neutral, throttle: 1 }, .1, flat);
    expect(car.speed).toBeLessThanOrEqual(defaultDrivingTuning.maxSpeed);
  });

  it('sweeps the sliding car against a wall and can reverse away afterwards', () => {
    const world = { heightAt: () => 0, collidesCircle: (_x: number, z: number, radius: number) => z + radius >= 4 };
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 20;
    for (let i = 0; i < 60; i++) updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, world);
    expect(car.z).toBeLessThan(2);
    expect(car.speed).toBe(0);
    const stopped = car.z;
    for (let i = 0; i < 30; i++) updateDriving(car, { ...neutral, brake: 1 }, 1 / 60, world);
    expect(car.z).toBeLessThan(stopped - .5);
    expect(car.speed).toBeLessThan(0);
  });

  it('rides over a kerb/bump without the lurch-stop (relaxed height guard)', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 15;
    const kerb = { heightAt: (_x: number, z: number) => (z > 4 ? .6 : 0) }; // +0.6 m kerb (old guard stopped at >0.4 m)
    for (let i = 0; i < 120 && car.speed > 1; i++) updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, kerb);
    expect(car.z).toBeGreaterThan(5); // climbed over it instead of lurching to a stop
    expect(car.y).toBeCloseTo(.6, 1);
    expect(car.speed).toBeGreaterThan(0);
    // Real walls/obstacles carry collision geometry and still block the car (see the collidesCircle test above).
  });

  it('eases the render height (visualY) toward the true height instead of jittering', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 5;
    const raised = { heightAt: () => .8 };
    updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, raised);
    expect(car.y).toBeCloseTo(.8, 1);          // physics tracks the true height at once
    expect(car.visualY).toBeGreaterThan(0);    // render height has started easing up
    expect(car.visualY).toBeLessThan(.8);      // but did not snap (smoothed)
    for (let i = 0; i < 60; i++) updateDriving(car, { ...neutral }, 1 / 60, raised);
    expect(car.visualY).toBeCloseTo(.8, 2);    // and converges
  });

  it('reaches 48 m/s in three seconds, then brakes from top speed within 1.7 seconds', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    for (let i = 0; i < 180; i++) updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, flat);
    expect(car.speed).toBeCloseTo(48);
    expect(car.speed).toBeLessThanOrEqual(defaultDrivingTuning.maxSpeed);
    const brakingAt = car.z;
    for (let i = 0; i < 100; i++) updateDriving(car, { ...neutral, handbrake: true }, 1 / 60, flat);
    expect(car.speed).toBe(0); expect(car.z - brakingAt).toBeLessThan(39);
  });

  it('ramps steering smoothly and cuts the lock at speed (founder car-handling)', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    // One frame of full input does not snap the wheel to full lock (smoothed ~0.2s ramp).
    updateDriving(car, { ...neutral, steer: 1 }, 1 / 60, flat);
    expect(Math.abs(car.steering)).toBeGreaterThan(0);
    expect(Math.abs(car.steering)).toBeLessThan(defaultDrivingTuning.maxSteering * 0.5);
    // At low speed it converges to near-full lock (tight parking).
    for (let i = 0; i < 40; i++) updateDriving(car, { ...neutral, steer: 1 }, 1 / 60, flat);
    const lowSpeedLock = Math.abs(car.steering);
    expect(lowSpeedLock).toBeGreaterThan(defaultDrivingTuning.maxSteering * 0.8);
    // At speed the sustained lock is much smaller (speed-sensitive, calmer highway).
    const fast = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    fast.speed = 34;
    for (let i = 0; i < 60; i++) updateDriving(fast, { ...neutral, steer: 1, throttle: 1 }, 1 / 60, flat);
    expect(Math.abs(fast.steering)).toBeLessThan(lowSpeedLock * 0.6);
  });

  it('car-vs-car bump shoves the car away from an overlapping car, then decays to rest', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    expect(applyCarBumps(car, [{ x: 1, z: 0 }], 1 / 60)).toBe(true); // a car overlapping from +x
    expect(car.bumpVx).toBeLessThan(0);                               // shoved toward -x (away)
    for (let i = 0; i < 90; i++) updateDriving(car, neutral, 1 / 60, flat);
    expect(car.x).toBeLessThan(-.3);                                  // separated
    expect(car.bumpVx).toBe(0); expect(car.bumpSpin).toBe(0);         // decayed to rest
  });

  it('does not bump when cars are clear of each other', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    expect(applyCarBumps(car, [{ x: 20, z: 0 }], 1 / 60)).toBe(false);
    expect(car.bumpVx).toBe(0); expect(car.bumpVz).toBe(0); expect(car.bumpSpin).toBe(0);
  });

  it('keeps sustained pile-up shoves bounded across phone and desktop frame rates', () => {
    const distance = (fps: number) => {
      const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
      for (let i = 0; i < fps * 2; i++) {
        // Keep contact for two seconds, as when another driver continues pushing against us.
        applyCarBumps(car, [{ x: car.x, z: car.z + 1 }, { x: car.x, z: car.z + 2 }], 1 / fps);
        expect(Math.hypot(car.bumpVx, car.bumpVz)).toBeLessThanOrEqual(7);
        expect(Math.abs(car.bumpSpin)).toBeLessThanOrEqual(1.6);
        updateDriving(car, neutral, 1 / fps, flat);
      }
      return -car.z;
    };
    const phone = distance(30), desktop = distance(120);
    expect(phone).toBeGreaterThan(10);
    expect(phone).toBeLessThanOrEqual(14.01);
    expect(Math.abs(desktop - phone)).toBeLessThan(.2);
  });

  it('sweeps a shove through thin walls and unloaded gaps instead of checking only its endpoint', () => {
    for (const world of [
      { heightAt: () => 0, collidesCircle: (x: number, _z: number, radius: number) => Math.abs(x - 1.1) < radius + .025 },
      { heightAt: (x: number) => x >= .1 && x <= .4 ? null : 0 },
    ]) {
      const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
      car.bumpVx = 80; // residual impulse from a prior contact: the endpoint is beyond either obstacle.
      updateDriving(car, neutral, .1, world);
      expect(car.x).toBeLessThan(.1);
      expect(car.bumpVx).toBe(0);
      expect(car.bumpSpin).toBe(0);
    }
  });

  it('keeps a sideways shove grounded on a slope', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.bumpVx = 7;
    updateDriving(car, neutral, .1, { heightAt: (x: number) => x * .4 });
    expect(car.x).toBeCloseTo(.7);
    expect(car.y).toBeCloseTo(car.x * .4);
    expect(car.airborne).toBe(false);
  });

  // A hill peak: ground climbs to z=15 then descends (like a Lombard crest).
  const peak = { heightAt: (_x: number, z: number) => Math.max(0, (z < 15 ? z : 30 - z)) * .5 };

  it('with hillJumps off, the car stays ground-locked (never airborne)', () => {
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 25;
    let maxAbove = 0;
    for (let i = 0; i < 300; i++) {
      updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, peak);
      expect(car.airborne).toBe(false); // the real guarantee: flag off => never leaves the ground
      maxAbove = Math.max(maxAbove, car.y - peak.heightAt(0, car.z));
    }
    // Ground-locked y is the availableHeight region-max over the wheelbase, so on a steep slope it sits a
    // little above the single centre sample — but nowhere near flying (a launched car climbs metres).
    expect(maxAbove).toBeLessThan(1.5);
  });

  it('with hillJumps on, a fast car flies off a crest and lands (real airborne)', () => {
    testFlags.hillJumps = true;
    const car = createDrivingState({ x: 0, y: 0, z: 0, yaw: 0 });
    car.speed = 48;
    let everAirborne = false, maxAir = 0;
    for (let i = 0; i < 240; i++) {
      updateDriving(car, { ...neutral, throttle: 1 }, 1 / 60, peak);
      if (car.airborne) everAirborne = true;
      maxAir = Math.max(maxAir, car.y - peak.heightAt(0, car.z));
    }
    expect(everAirborne).toBe(true);     // left the road over the crest
    expect(maxAir).toBeGreaterThan(.3);  // real physics air: the car's y rose well above the ground
    for (let i = 0; i < 180; i++) updateDriving(car, { ...neutral }, 1 / 60, peak);
    expect(car.airborne).toBe(false);                                    // and came back down
    expect(Math.abs(car.y - peak.heightAt(0, car.z))).toBeLessThan(.3);  // settled onto the ground
  });
});
