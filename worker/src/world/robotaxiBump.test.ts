import { describe, expect, it } from 'vitest';
import { bumpTaxi } from './robotaxiBump';

const base = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
describe('bumpTaxi', () => {
  it('is exact with no contact, shoves away from a moving car, then decays back', () => {
    const bump = { offX: 0, offZ: 0, spin: 0 };
    expect(bumpTaxi(bump, base, [], .1)).toBe(base);
    expect(bumpTaxi(bump, base, [{ x: -200, z: 0, yaw: 64, speedCmps: 0 }], .1)).toBe(base); // parked: no shove
    const hit = bumpTaxi(bump, base, [{ x: -200, z: 0, yaw: 64, speedCmps: 800 }], .1);
    expect(hit.x).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) bumpTaxi(bump, base, [], .1);
    expect(bumpTaxi(bump, base, [], .1)).toBe(base);
  });
  it('caps the offset', () => {
    const bump = { offX: 0, offZ: 0, spin: 0 };
    let pose = base;
    for (let i = 0; i < 50; i++) pose = bumpTaxi(bump, base, [{ x: -50, z: 0, yaw: 0, speedCmps: 800 }], .1);
    expect(Math.hypot(pose.x, pose.z)).toBeLessThanOrEqual(221);
  });
});
