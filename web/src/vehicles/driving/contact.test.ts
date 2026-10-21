import { describe, expect, it } from 'vitest';
import { createDrivingState } from './controller';
import { createCarContact } from './contact';

const car = (x: number, z: number, yaw: number, speed: number) => ({ ...createDrivingState({ x, y: 0, z, yaw }), speed });

describe('car contact (carCollisions)', () => {
  it('a head-on hit into a parked car loses most speed, bounces back and reports one impact', () => {
    const contact = createCarContact(), state = car(0, 0, 0, 12);
    // Parked car 4 m ahead (+z is forward at yaw 0), so the noses overlap.
    const hit = contact.resolve(state, 12, [{ x: 0, z: 4, yaw: 0, half: 1.25, radius: 1, id: -1 }], 1000);
    expect(hit?.id).toBe(-1);
    expect(hit!.closing).toBeCloseTo(12, 0);
    expect(state.speed).toBeLessThan(3);
    expect(state.bumpVz).toBeLessThan(0); // shoved back, away from the other car
    // Still touching next frame: no second crunch within the cooldown.
    expect(contact.resolve(state, state.speed, [{ x: 0, z: 4, yaw: 0, half: 1.25, radius: 1, id: -1 }], 1100)).toBeNull();
  });

  it('a glancing side-swipe keeps most speed; a far car is ignored', () => {
    const contact = createCarContact(), state = car(0, 0, 0, 12);
    const hit = contact.resolve(state, 12, [{ x: 1.8, z: 0, yaw: 0, half: 1.3, radius: 1, id: 5 }], 0);
    expect(hit).toBeNull(); // parallel, no closing speed: pushed apart only
    expect(state.speed).toBe(12);
    expect(state.bumpVx).toBeLessThan(0);
    expect(createCarContact().resolve(car(0, 0, 0, 12), 12, [{ x: 0, z: 20, yaw: 0, half: 1.3, radius: 1, id: 6 }], 0)).toBeNull();
  });

  it('traffic driving into a stopped player still crunches (relative velocity), and the player is shoved away', () => {
    const contact = createCarContact(), state = car(0, 0, 0, 0);
    // An AI car 4 m ahead heading straight at us (yaw PI: forward is -z) at 11 m/s.
    const hit = contact.resolve(state, 0, [{ x: 0, z: 4, yaw: Math.PI, half: 1.3, radius: 1, id: 7, vx: 0, vz: -11 }], 0);
    expect(hit?.id).toBe(7);
    expect(hit!.closing).toBeCloseTo(11, 0);
    expect(state.bumpVz).toBeLessThan(0);
  });

  it('a wall-stopped car (speed already 0 against a kerb car) stays stopped but still crunches', () => {
    const contact = createCarContact(), state = car(0, 0, 0, 0);
    const hit = contact.resolve(state, 9, [{ x: 0, z: 3.6, yaw: Math.PI / 2, half: 1.25, radius: 1, id: -2 }], 0);
    expect(hit?.id).toBe(-2);
    expect(state.speed).toBe(0);
  });
});
