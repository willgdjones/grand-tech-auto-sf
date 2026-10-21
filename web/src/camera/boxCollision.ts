import type { Box3 } from 'three';
import type { CameraCollision } from './thirdPerson';
const AXES = ['x', 'y', 'z'] as const;

/** Conservative swept sphere against static world bounds; no allocations in the frame loop. */
export function createBoxCameraCollision(boxes: readonly Box3[]): CameraCollision {
  return {
    sphereCast(origin, direction, radius, maxDistance) {
      let nearest = Infinity;
      for (const box of boxes) {
        let enter = 0, exit = maxDistance;
        for (const axis of AXES) {
          const min = box.min[axis] - radius, max = box.max[axis] + radius;
          const o = origin[axis], d = direction[axis];
          if (Math.abs(d) < 1e-12) {
            if (o < min || o > max) { exit = -1; break; }
          } else {
            const a = (min - o) / d, b = (max - o) / d;
            enter = Math.max(enter, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
            if (exit < enter) break;
          }
        }
        if (enter <= exit && enter <= maxDistance) nearest = Math.min(nearest, enter);
      }
      return nearest;
    },
  };
}
