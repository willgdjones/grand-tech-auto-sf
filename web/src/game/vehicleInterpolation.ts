import type { VehicleEntry } from '@gtasf/shared/protocol/types';

export type VehicleRenderPose = Pick<VehicleEntry, 'x' | 'y' | 'z' | 'yaw' | 'speedCmps'>;
type Sample = { t: number; pose: VehicleEntry };
const DELAY_MS = 150, EXTRAPOLATE_MS = 100;

/** Render 10 Hz server cars on a delayed timeline instead of chasing each packet's target. */
export function createVehicleInterpolation() {
  const vehicles = new Map<number, Sample[]>();
  return {
    push(pose: VehicleEntry, serverT: number): void {
      if (!Number.isFinite(serverT)) return;
      const samples = vehicles.get(pose.id) ?? [], last = samples.at(-1);
      if (last && serverT <= last.t) return;
      // A new owner, stale connection or authoritative relocation starts a fresh history.
      if (last && (pose.driverId !== last.pose.driverId || serverT - last.t > 1000 ||
        Math.hypot(pose.x - last.pose.x, pose.z - last.pose.z) > Math.max(3000, (serverT - last.t) * 6))) samples.length = 0;
      samples.push({ t: serverT, pose }); if (samples.length > 16) samples.shift(); vehicles.set(pose.id, samples);
    },
    remove(id: number): void { vehicles.delete(id); },
    clear(): void { vehicles.clear(); },
    sample(id: number, serverNow: number, out: VehicleRenderPose): boolean {
      const samples = vehicles.get(id); if (!samples?.length) return false;
      const time = serverNow - DELAY_MS, last = samples[samples.length - 1]!;
      let a = samples[0]!, b = a;
      for (const sample of samples) { if (sample.t <= time) a = sample; if (sample.t >= time) { b = sample; break; } b = sample; }
      if (a === b && time > last.t && samples.length > 1) { a = samples[samples.length - 2]!; b = last; }
      const span = b.t - a.t;
      const alpha = span <= 0 ? 0 : Math.max(0, Math.min((time - a.t) / span, 1 + (Math.abs(last.pose.speedCmps) > 1 ? EXTRAPOLATE_MS / span : 0)));
      out.x = a.pose.x + (b.pose.x - a.pose.x) * alpha;
      out.y = a.pose.y + (b.pose.y - a.pose.y) * alpha;
      out.z = a.pose.z + (b.pose.z - a.pose.z) * alpha;
      const yawDelta = ((b.pose.yaw - a.pose.yaw + 384) % 256) - 128;
      out.yaw = (a.pose.yaw + yawDelta * alpha + 256) % 256;
      out.speedCmps = a.pose.speedCmps + (b.pose.speedCmps - a.pose.speedCmps) * Math.min(alpha, 1);
      return true;
    },
  };
}
