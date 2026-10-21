import { EXTRAP_MAX_MS, INTEREST_NEAR_M, INTEREST_FAR_M, INTERP_DELAY_BASE_MS } from '@gtasf/shared/constants';
import type { Pose, SnapshotEntry } from '@gtasf/shared/protocol/types';
interface Sample { t: number; pose: Pose }
/** BDTS interpolation adapted to dynamic player IDs and i32 city coordinates. Sixteen samples/peer. */
export function createRemotes() {
  const players = new Map<number, Sample[]>();
  return {
    players,
    push(entry: SnapshotEntry, serverT: number) {
      const samples = players.get(entry.id) ?? [];
      if (samples.length && samples[samples.length - 1]!.t >= serverT) return;
      samples.push({ t: serverT, pose: entry });
      if (samples.length > 16) samples.shift();
      players.set(entry.id, samples);
    },
    remove(id: number) { players.delete(id); },
    clear() { players.clear(); },
    sample(id: number, serverNow: number, local: Pose): Pose | undefined {
      const samples = players.get(id); if (!samples?.length) return;
      const last = samples[samples.length - 1]!;
      const distance = Math.hypot(last.pose.x - local.x, last.pose.z - local.z) / 100;
      const tier = distance < INTEREST_NEAR_M ? 'near' : distance <= INTEREST_FAR_M ? 'mid' : 'far';
      const t = serverNow - INTERP_DELAY_BASE_MS[tier];
      let a = samples[0]!, b = a;
      for (const sample of samples) { if (sample.t <= t) a = sample; if (sample.t >= t) { b = sample; break; } b = sample; }
      if (a === b && t > last.t && samples.length > 1) { a = samples[samples.length - 2]!; b = last; }
      const span = b.t - a.t;
      const alpha = span <= 0 ? 0 : Math.max(0, Math.min((t - a.t) / span, 1 + EXTRAP_MAX_MS / span));
      const yawDelta = ((b.pose.yaw - a.pose.yaw + 384) % 256) - 128;
      return { x: a.pose.x + (b.pose.x - a.pose.x) * alpha, y: a.pose.y + (b.pose.y - a.pose.y) * alpha, z: a.pose.z + (b.pose.z - a.pose.z) * alpha, yaw: (a.pose.yaw + yawDelta * alpha + 256) % 256, flags: b.pose.flags };
    },
  };
}
