import type { Pose } from '@gtasf/shared/protocol/types';
import { validPose } from '@gtasf/shared/protocol/pose';

/** Ferry Building plaza, source-checked outside the building footprint; faces the clock tower. */
export const LOCAL_SPAWN: Readonly<Pose> = { x: 119687, y: 333, z: -122431, yaw: 88, flags: 0 };
export const LOMBARD_SPAWN: Readonly<Pose> = { x: -104186, y: 8595, z: -197520, yaw: 66, flags: 0 };
export const LOCAL_TAXI_DESTINATION = { x: -89714, y: 5312, z: -199998 };

/** The client snaps a shared location to walkable ground before requesting this one-time spawn. */
export function parseSpawnQuery(value: string | null | undefined): Pose | undefined {
  if (!value || !/^-?\d+,-?\d+,-?\d+,\d+$/.test(value)) return undefined;
  const [x, y, z, yaw] = value.split(',').map(Number);
  const pose = { x: x!, y: y!, z: z!, yaw: yaw!, flags: 0 };
  return validPose(pose) ? pose : undefined;
}
