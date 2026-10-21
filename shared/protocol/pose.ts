import { Reader, Writer } from './bytes';
import { WORLD_MIN_CM, WORLD_MAX_CM } from './constants';
import type { Pose } from './types';
export function validPose(p: Pose): boolean {
  return [p.x, p.y, p.z].every(n => Number.isInteger(n) && n >= WORLD_MIN_CM && n <= WORLD_MAX_CM) && Number.isInteger(p.yaw) && p.yaw >= 0 && p.yaw <= 255 && Number.isInteger(p.flags) && p.flags >= 0 && p.flags <= 255;
}
export function writePose(w: Writer, p: Pose): void {
  if (!validPose(p)) throw new RangeError('INVALID_POSE');
  w.i32(p.x).i32(p.y).i32(p.z).u8(p.yaw).u8(p.flags);
}
export function readPose(r: Reader): Pose {
  const p = { x: r.i32(), y: r.i32(), z: r.i32(), yaw: r.u8(), flags: r.u8() };
  if (!validPose(p)) r.fail('OUT_OF_RANGE');
  return p;
}
