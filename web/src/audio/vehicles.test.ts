import { describe, expect, it } from 'vitest';
import { ENGINE_VOICES, SOUND_RANGE_M, vehicleSound } from './vehicles';

describe('vehicle sound perspective', () => {
  it('places passing cars on the correct screen side as the camera turns and fades with distance', () => {
    const listener = { x: 0, y: 0, z: 0, yaw: 0 };
    const left = vehicleSound({ x: -8, y: 0, z: 0 }, listener, 10, 'prius');
    const right = vehicleSound({ x: 8, y: 0, z: 0 }, listener, 10, 'prius');
    expect(left.pan).toBe(-1); expect(right.pan).toBe(1); expect(left.gain).toBe(right.gain);
    expect(vehicleSound({ x: 8, y: 0, z: 0 }, { ...listener, yaw: Math.PI }, 10, 'prius').pan).toBe(-1);
    expect(vehicleSound({ x: 35, y: 0, z: 0 }, listener, 10, 'prius').gain).toBeLessThan(right.gain);
    expect(vehicleSound({ x: SOUND_RANGE_M, y: 0, z: 0 }, listener, 10, 'prius').gain).toBe(0);
  });

  it('gives an occupied engine a quiet idle and stable reverse pitch without making parked cars drone', () => {
    const listener = { x: 0, y: 0, z: 0, yaw: 0 }, position = { x: 3, y: 0, z: 0 };
    expect(vehicleSound(position, listener, 0, 'prius').gain).toBe(0);
    const idle = vehicleSound(position, listener, 0, 'prius', true);
    const forward = vehicleSound(position, listener, 15, 'prius', true);
    expect(idle.gain).toBeGreaterThan(0); expect(idle.pan).toBe(0);
    expect(forward.frequency).toBeGreaterThan(idle.frequency);
    expect(vehicleSound(position, listener, -15, 'prius', true)).toEqual(forward);
    expect(vehicleSound(position, listener, Infinity, 'prius', true)).toEqual(idle);
    expect(vehicleSound(position, listener, 5, 'cable-car', true).gain).toBe(0);
    // Two harmonics per pooled engine leave ample headroom before master volume/compression.
    expect(forward.gain * ENGINE_VOICES * 2).toBeLessThan(.3);
  });
});
