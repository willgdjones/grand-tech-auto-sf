import { expect, test, vi } from 'vitest';
import { moveOnGround, type MovementWorld } from '../movement/world';
import { createWalkingRouter } from './walking';

const feature = vi.hoisted(() => ({ walkingRoutes: true }));
vi.mock('@gtasf/shared/flags', () => ({ flags: feature }));

test('an authored walking stop goes around a real circle collider, with safe road fallbacks', () => {
  let probes = 0;
  const ground: MovementWorld = {
    heightAt(x, z) { probes++; return Math.abs(x) <= 20 && Math.abs(z) <= 12 ? 0 : null; },
    collidesCircle(x, z, radius) {
      const dx = x - Math.max(-1, Math.min(1, x)), dz = z - Math.max(-4, Math.min(4, z));
      return dx * dx + dz * dz <= radius * radius;
    },
  };
  const start = { x: -12, y: 0, z: 0 }, target = { x: 12, y: 0, z: 0, walkingStop: true };
  const router = createWalkingRouter(ground, () => true), route = router.route(start, target, 'walk')!;
  expect(route.mode).toBe('walk');
  expect(route.distanceM).toBeGreaterThan(24);
  expect(route.distanceM).toBeLessThan(40);
  expect(route.approach).toEqual({ x: 12, y: 0, z: 0 });
  expect(probes).toBeLessThanOrEqual(12_000);
  const pose = { ...start, yaw: 0 };
  for (const [x, , z] of route.points) expect(moveOnGround(pose, x - pose.x, z - pose.z, ground, .3, false)).toBe(true);
  expect(pose.x).toBeCloseTo(target.x); expect(pose.z).toBeCloseTo(target.z);

  // Returning null deliberately leaves the existing source-road router in charge.
  expect(router.route(start, target, 'road')).toBeNull(); // driver, passenger and taxi pickup
  expect(router.route(start, { ...target, event: { id: 'public-event' } }, 'walk')).toBeNull();
  expect(router.route(start, { ...target, walkingStop: false }, 'walk')).toBeNull();
  expect(router.route(start, { ...target, x: 200 }, 'walk')).toBeNull();
  expect(router.route(start, { ...target, y: 12 }, 'walk')).toBeNull();
  expect(createWalkingRouter(ground, x => x < 0).route(start, target, 'walk')).toBeNull();
  expect(createWalkingRouter({ heightAt: () => null }, () => true).route(start, target, 'walk')).toBeNull();
  probes = 0;
  const blocked = createWalkingRouter({ ...ground, collidesCircle: x => Math.abs(x) < 2 }, () => true);
  expect(blocked.route(start, target, 'walk')).toBeNull();
  expect(probes).toBeLessThanOrEqual(12_000);
  feature.walkingRoutes = false;
  try { expect(router.route(start, target, 'walk')).toBeNull(); } finally { feature.walkingRoutes = true; }
});
