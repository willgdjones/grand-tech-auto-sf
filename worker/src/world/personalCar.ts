/**
 * Personal car (flag personalCar, GTA V critique #20 "nothing persists"): the last car a device DROVE and left becomes
 * its car. Saved per funding device in D1 (pose + kind), kept out of the abandoned-car sweep while its owner is online,
 * re-parked at that spot when they come back, and deliverable to the nearest road from the jobs phone. No money moves.
 */
import type { Pose, VehicleKind } from '@gtasf/shared/protocol/types';

/** Road cars a player can own (not buses, robotaxis, cable cars). */
export const PERSONAL_KINDS: ReadonlySet<VehicleKind> = new Set(['prius', 'tesla', 'subaru', 'supercar']);
export const DELIVER_COOLDOWN_MS = 60_000;
/** Deliveries land on the road nearest a point this far ahead of the player, never on top of them. */
export const DELIVER_AHEAD_M = 9;
/** …within this distance of the player (a plaza can be ~40 m from the nearest road). */
export const DELIVER_MAX_M = 120;

export interface SavedPersonalCar { kind: VehicleKind; pose: Pose; savedAt: number }

type Db = Pick<D1Database, 'prepare'>;

export async function savePersonalCar(db: Db, device: string, kind: VehicleKind, pose: Pose, now: number): Promise<void> {
  if (!PERSONAL_KINDS.has(kind)) return;
  await db.prepare('INSERT INTO personal_cars (device_id, kind, x, y, z, yaw, saved_at) VALUES (?,?,?,?,?,?,?) ' +
    'ON CONFLICT(device_id) DO UPDATE SET kind=excluded.kind, x=excluded.x, y=excluded.y, z=excluded.z, yaw=excluded.yaw, saved_at=excluded.saved_at')
    .bind(device, kind, Math.round(pose.x), Math.round(pose.y), Math.round(pose.z), pose.yaw & 0xff, now).run();
}

export async function loadPersonalCar(db: Db, device: string): Promise<SavedPersonalCar | null> {
  const row = await db.prepare('SELECT kind, x, y, z, yaw, saved_at FROM personal_cars WHERE device_id=?').bind(device)
    .first<{ kind: string; x: number; y: number; z: number; yaw: number; saved_at: number }>().catch(() => null);
  if (!row || !PERSONAL_KINDS.has(row.kind as VehicleKind)) return null;
  return { kind: row.kind as VehicleKind, pose: { x: row.x, y: row.y, z: row.z, yaw: row.yaw, flags: 0 }, savedAt: row.saved_at };
}
