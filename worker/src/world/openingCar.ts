/**
 * Opening drive (flag openingDrive, GTA V critique #13): a new player spawns at FOUNDER_OPENING_DRIVE_START and asks for
 * their opening car (C2S OPENING_CAR). The server places it on the road nearest the AUTHORITATIVE pose and seats them.
 * Scoped so it can't become a free car anywhere: only within OPENING_CAR_RADIUS_M of the start, only when the road is
 * within reach, once per session (the caller tracks that). No money and no wanted. Pure, so it's unit-testable.
 */
import type { Pose } from '@gtasf/shared/protocol/types';

/** The player must be this close (metres, 2-D) to the opening start. */
export const OPENING_CAR_RADIUS_M = 40;
/** The road the car spawns on must be this close (metres) to the player (vehicles.enter reaches 5.5 m). */
export const OPENING_CAR_REACH_M = 5;

/** `player` in cm; `start` and `road` (the server's nearest-road snap of the player, yaw a byte) in metres. The car's
 *  pose (cm, yaw byte) — the road's direction flipped if it points away from where the player faces — or a refusal. */
export function openingCarPose(player: { x: number; z: number }, start: { x: number; z: number },
  road: { x: number; y: number; z: number; yaw: number } | null, facingYaw: number): Pose | 'not-at-start' | 'no-road' | 'reach' {
  const px = player.x / 100, pz = player.z / 100;
  if (Math.hypot(px - start.x, pz - start.z) > OPENING_CAR_RADIUS_M) return 'not-at-start';
  if (!road) return 'no-road';
  if (Math.hypot(road.x - px, road.z - pz) > OPENING_CAR_REACH_M) return 'reach';
  const roadYaw = ((Math.round(road.yaw) % 256) + 256) % 256;
  const off = ((((facingYaw - roadYaw) % 256) + 384) % 256) - 128; // signed byte difference, -128..127
  const yaw = Math.abs(off) > 64 ? (roadYaw + 128) % 256 : roadYaw;
  return { x: Math.round(road.x * 100), y: Math.round(road.y * 100), z: Math.round(road.z * 100), yaw, flags: 0 };
}
