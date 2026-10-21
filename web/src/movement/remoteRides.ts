import type { Object3D } from 'three';
import type { FundingRound } from '@gtasf/shared/funding';
import { createRideSystem, type RideSystem } from './rideSystem';
import type { GroundPose } from './world';

/**
 * Remote players' personal rides (gtasf-v21-personal-rides multiplayer visibility). One RideSystem per
 * remote who is currently riding (their MOVE pose carries RIDING_POSE_FLAG), reusing the SAME public
 * createRideSystem API — and therefore the same authored per-tier meshes + wheel-spin — so remotes look
 * identical to the local rider with no mesh duplication and no edit to rideSystem.ts. Flag-gated by the
 * caller (main.ts creates this only when flags.personalRides is on).
 */
export interface RemoteRides {
  /** Per frame, per remote: show + park their ride mesh when riding, hide it when not. */
  update(id: number, pose: GroundPose, round: Pick<FundingRound, 'id'>, riding: boolean): void;
  /** Drop a remote entirely (left the world, or entered a car). */
  remove(id: number): void;
  destroy(): void;
}

export function createRemoteRides(scene: Object3D): RemoteRides {
  const rides = new Map<number, RideSystem>();
  return {
    update(id, pose, round, riding) {
      let rs = rides.get(id);
      if (riding) {
        if (!rs) { rs = createRideSystem(scene); rides.set(id, rs); }
        if (!rs.mounted) rs.toggle(round); // mount -> picks the ride their funding stage grants
        rs.syncRound(round);               // funding can change while the remote stays mounted
        rs.update(pose);                    // park + spin wheels from their travel (same as the local rider)
      } else if (rs?.mounted) {
        rs.dismount();
      }
    },
    remove(id) { const rs = rides.get(id); if (rs) { rs.destroy(); rides.delete(id); } },
    destroy() { for (const rs of rides.values()) rs.destroy(); rides.clear(); },
  };
}
