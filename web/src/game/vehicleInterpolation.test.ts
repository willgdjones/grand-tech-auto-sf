import { describe, expect, it } from 'vitest';
import { createVehicleInterpolation, type VehicleRenderPose } from './vehicleInterpolation';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';

const car = (x: number, yaw = 0, driverId = 0): VehicleEntry => ({ id: 1, kind: 'robotaxi', x, y: 300, z: 0, yaw, speedCmps: 500, flags: 0, driverId });
const pose = (): VehicleRenderPose => ({ x: 0, y: 0, z: 0, yaw: 0, speedCmps: 0 });
describe('server vehicle rendering', () => {
  it('moves uniformly at 60 Hz between 10 Hz snapshots including uneven arrival gaps', () => {
    const interpolation = createVehicleInterpolation(), out = pose();
    interpolation.push(car(0), 0); interpolation.push(car(50), 100); interpolation.push(car(100), 200);
    const positions: number[] = [];
    for (let frame = 0; frame <= 6; frame++) { interpolation.sample(1, 250 + frame * 1000 / 60, out); positions.push(out.x); }
    for (let i = 1; i < positions.length; i++) expect(positions[i]! - positions[i - 1]!).toBeCloseTo(500 / 60, 8);
    // Packet 300 arrives late; short extrapolation keeps motion continuous until it arrives.
    interpolation.sample(1, 400, out); expect(out.x).toBeCloseTo(125);
    interpolation.push(car(150), 300); interpolation.sample(1, 400, out); expect(out.x).toBeCloseTo(125);
  });
  it('wraps yaw and caps stale motion rather than running away', () => {
    const interpolation = createVehicleInterpolation(), out = pose();
    interpolation.push(car(0, 250), 1000); interpolation.push(car(50, 6), 1100);
    interpolation.sample(1, 1200, out); expect(out.yaw).toBeCloseTo(0);
    interpolation.sample(1, 5000, out); expect(out.x).toBeCloseTo(100);
    interpolation.push(car(999), 1050); interpolation.sample(1, 5000, out); expect(out.x).toBeCloseTo(100);
  });
  it('resets ownership/relocation and removes despawned cars', () => {
    const interpolation = createVehicleInterpolation(), out = pose();
    interpolation.push(car(0), 1000); interpolation.push(car(100, 0, 2), 1100);
    interpolation.sample(1, 1120, out); expect(out.x).toBe(100);
    interpolation.push(car(9999, 0, 2), 1200); interpolation.sample(1, 1230, out); expect(out.x).toBe(9999);
    interpolation.remove(1); expect(interpolation.sample(1, 1300, out)).toBe(false);
  });
});
