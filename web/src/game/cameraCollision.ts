import type { CameraCollision } from '../camera/thirdPerson';
import type { FleetCar } from './fleet';

/** Inflated local model bounds keep the camera outside rotated and hill-aligned parked cars. */
export function vehicleCameraHit(car: Pick<FleetCar, 'cameraBounds' | 'cameraInverse'>,
  origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number },
  radius: number, maxDistance: number): number {
  const e = car.cameraInverse.elements, { min, max } = car.cameraBounds;
  let near = 0, far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    const o = e[axis]! * origin.x + e[axis + 4]! * origin.y + e[axis + 8]! * origin.z + e[axis + 12]!;
    const d = e[axis]! * direction.x + e[axis + 4]! * direction.y + e[axis + 8]! * direction.z;
    const lo = min.getComponent(axis) - radius, hi = max.getComponent(axis) + radius;
    if (Math.abs(d) < 1e-10) { if (o < lo || o > hi) return Infinity; continue; }
    const a = (lo - o) / d, b = (hi - o) / d;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return Infinity;
  }
  return near;
}

/** Sweep the camera against real footprint polygons; rotated buildings have huge empty AABB corners. */
export function createMapCameraCollision(world: {
  collides(x: number, y: number, z: number, radius: number, height: number): boolean;
  // Coarse (citywide) districts ship no building footprint collision, so world.collides lets the chase
  // camera bury itself in their blocks. collidesCamera adds the coarse blocks' render triangles for the
  // camera only, independent of the player-collision flag (gtasf-q3r6). Falls back to collides when absent.
  collidesCamera?(x: number, y: number, z: number, radius: number, height: number): boolean;
}, cars?: ReadonlyMap<number, FleetCar>, occupiedId: () => number = () => 0): CameraCollision {
  // .call(world) keeps `this` for method consumers (the StructureCollisionIndex double in tests); the
  // game passes plain closures where `this` is irrelevant.
  const occludes = world.collidesCamera ?? world.collides;
  return {
    sphereCast(origin, direction, radius, maxDistance) {
      let carHit = Infinity;
      // keys()+get(): Map entry iteration allocated a [key, value] array per vehicle per camera sweep (gtasf-pooa).
      if (cars) { const occupied = occupiedId(); for (const id of cars.keys()) {
        const car = cars.get(id)!;
        if (id !== occupied && car.model.root.visible) carHit = Math.min(carHit, vehicleCameraHit(car, origin, direction, radius, maxDistance));
      } }
      const steps = Math.max(1, Math.ceil(maxDistance / Math.max(.05, radius)));
      const step = maxDistance / steps, padded = radius + step / 2;
      for (let i = 0; i <= steps; i++) {
        const t = i * step;
        if (occludes.call(world, origin.x + direction.x * t, origin.y + direction.y * t - padded,
          origin.z + direction.z * t, padded, padded * 2)) return Math.min(carHit, Math.max(0, t - step / 2));
      }
      return carHit;
    },
  };
}
