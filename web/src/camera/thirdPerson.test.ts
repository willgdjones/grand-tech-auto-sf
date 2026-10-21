import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { createBoxCameraCollision } from './boxCollision';
import { ThirdPersonCamera } from './thirdPerson';

const point = (x: number, y: number, z: number) => new Vector3(x, y, z);
const wall = () => new Box3(point(-5, 0, 4), point(5, 8, 5));
describe('camera collision corridor', () => {
  it('accounts for camera radius, finite reach, parallel rays and embedded origins', () => {
    const collision = createBoxCameraCollision([wall()]);
    expect(collision.sphereCast(point(0, 2, 0), point(0, 0, 1), .2, 10)).toBeCloseTo(3.8);
    expect(collision.sphereCast(point(0, 2, 0), point(0, 0, 1), .2, 3)).toBe(Infinity);
    expect(collision.sphereCast(point(6, 2, 0), point(0, 0, 1), .2, 10)).toBe(Infinity);
    expect(collision.sphereCast(point(0, 2, 4), point(1, 0, 0), .2, 10)).toBe(0);
    expect(collision.sphereCast(point(0, 2, 7), point(0, 0, -1), .2, 10)).toBeCloseTo(1.8);
  });
  it('shortens immediately on a newly loaded wall and releases smoothly when it clears', () => {
    const boxes: Box3[] = [];
    const camera = new ThirdPersonCamera({ walkable: { heightAt: () => 0 }, occluders: createBoxCameraCollision(boxes), activity: { camera() {} } });
    camera.setOrbit(0, 0);
    expect(camera.update(1 / 60, point(0, 0, 0))).toBe(true);
    expect(camera.renderedBoom).toBeCloseTo(8.5);
    boxes.push(wall());
    expect(camera.update(1 / 60, point(0, 0, 0))).toBe(true);
    expect(camera.camera.position.z).toBeCloseTo(3.6);
    expect(camera.avatarOpacity).toBeLessThan(1);
    boxes.pop();
    camera.update(1 / 60, point(0, 0, 0));
    expect(camera.renderedBoom).toBeGreaterThan(3.6);
    expect(camera.renderedBoom).toBeLessThan(4);
  });
  it('refuses an unsafe pose when all camera positions intersect a building', () => {
    const box = new Box3(point(-20, -5, -20), point(20, 20, 20));
    const camera = new ThirdPersonCamera({ walkable: { heightAt: () => 0 }, occluders: createBoxCameraCollision([box]), activity: { camera() {} } });
    expect(camera.update(.016, point(0, 0, 0))).toBe(false);
    expect(camera.safe).toBe(false);
    expect(camera.avatarOpacity).toBe(0);
  });
  it('uses elapsed time for chase lag, holds keyboard orbit, recentres and pulls back with speed', () => {
    const make = () => new ThirdPersonCamera({ walkable: { heightAt: () => 0 }, occluders: createBoxCameraCollision([]), activity: { camera() {} } });
    const chase = (hz: number) => {
      const camera = make(); camera.setOrbit(Math.PI, -.22); camera.update(0, point(0, 0, 0));
      for (let i = 0; i < hz; i++) { camera.follow(0, 0, 1 / hz); camera.update(1 / hz, point(1, 0, 0)); }
      return camera.camera.position.x;
    };
    expect(chase(30)).toBeCloseTo(chase(120), 6);
    expect(chase(60)).toBeCloseTo(1 - Math.exp(-12), 6);
    const camera = make(); camera.setOrbit(Math.PI, -.22); camera.update(0, point(0, 0, 0));
    camera.orbit(1, 1, .25);
    for (let i = 0; i < 80; i++) { camera.follow(0, 0, 1 / 60); camera.update(1 / 60, point(0, 0, 0)); }
    expect(camera.yaw).toBeCloseTo(Math.PI - .45, 4);
    expect(camera.pitch).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) { camera.follow(0, 0, 1 / 60); camera.update(1 / 60, point(0, 0, 0)); }
    expect(Math.abs(Math.atan2(Math.sin(camera.yaw - Math.PI), Math.cos(camera.yaw - Math.PI)))).toBeLessThan(.002);
    camera.recenter(Math.PI / 2);
    for (let i = 0; i < 60; i++) { camera.follow(Math.PI / 2, 28, 1 / 60); camera.update(1 / 60, point(0, 0, 0)); }
    expect(camera.yaw).toBeCloseTo(-Math.PI / 2, 2);
    expect(camera.renderedBoom).toBeGreaterThan(11);
  });
});
