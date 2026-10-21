import { Box3, Group, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMapCameraCollision, vehicleCameraHit } from './cameraCollision';
import type { FleetCar } from './fleet';

describe('parked-car camera collision', () => {
  const car = {
    model: { root: new Group() },
    cameraBounds: new Box3(new Vector3(-1, 0, -2), new Vector3(1, 1.6, 2)),
    cameraInverse: new Matrix4().makeRotationY(Math.PI / 4).setPosition(3, 0, 0).invert(),
  };
  it('hits the rotated car body but clears a ray above its roof', () => {
    const direction = { x: 1, y: 0, z: 0 };
    expect(vehicleCameraHit(car, { x: 0, y: 1, z: 0 }, direction, .2, 10)).toBeGreaterThan(1);
    expect(vehicleCameraHit(car, { x: 0, y: 1, z: 0 }, direction, .2, 10)).toBeLessThan(2);
    expect(vehicleCameraHit(car, { x: 0, y: 2, z: 0 }, direction, .2, 10)).toBe(Infinity);
  });
  it('pulls in before a parked vehicle while excluding the occupied vehicle', () => {
    let occupied = 0;
    const collision = createMapCameraCollision({ collides: () => false }, new Map([[7, car as FleetCar]]), () => occupied);
    expect(collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, .2, 10)).toBeLessThan(2);
    occupied = 7;
    expect(collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, .2, 10)).toBe(Infinity);
    occupied = 0; car.model.root.visible = false;
    expect(collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, .2, 10)).toBe(Infinity);
    car.model.root.visible = true;
  });
});

describe('coarse-district building camera occlusion (gtasf-q3r6)', () => {
  // collidesCamera reports a coarse block from ~1 m along +x; collides (the player path) sees nothing there.
  const collidesCamera = (x: number) => x >= 1;
  it('pulls the camera in on collidesCamera even when the player collides reports nothing', () => {
    const collision = createMapCameraCollision({ collides: () => false, collidesCamera });
    const hit = collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, .2, 10);
    expect(hit).toBeGreaterThan(0.5);
    expect(hit).toBeLessThan(1.5);
  });
  it('ignores coarse blocks that are not along the ray', () => {
    const collision = createMapCameraCollision({ collides: () => false, collidesCamera });
    expect(collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, .2, 10)).toBe(Infinity);
  });
  it('falls back to collides when collidesCamera is absent (e.g. the structure-index test double)', () => {
    const collision = createMapCameraCollision({ collides: () => false });
    expect(collision.sphereCast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, .2, 10)).toBe(Infinity);
  });
});
