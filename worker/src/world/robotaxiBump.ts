import type { Pose } from '@gtasf/shared/protocol/types';

// Loose-arcade (gtasf-k7cz): a moving driver car shoves an EMPTY robotaxi aside with a little spin,
// decaying back onto its route. Cosmetic pose offset only; same tuning as the NPC traffic bump.
const CONTACT_M = 3.2, MIN_SPEED_CMPS = 150, IMPULSE = 3.2, MAX_OFFSET_M = 2.2, SPIN = 2.2, MAX_SPIN = 0.9, HALFLIFE_S = 0.45;

export interface TaxiBump { offX: number; offZ: number; spin: number }
type Obstacle = { x: number; z: number; yaw: number; speedCmps: number };

/** Decays the bump, applies contact impulses from moving obstacles and returns the displaced pose. */
export function bumpTaxi(bump: TaxiBump, base: Pose, obstacles: Iterable<Obstacle>, dt: number): Pose {
  const decay = Math.pow(0.5, dt / HALFLIFE_S);
  bump.offX *= decay; bump.offZ *= decay; bump.spin *= decay;
  for (const ob of obstacles) {
    if (ob.speedCmps < MIN_SPEED_CMPS) continue;
    const dx = (base.x - ob.x) / 100 + bump.offX, dz = (base.z - ob.z) / 100 + bump.offZ;
    const dist = Math.hypot(dx, dz), overlap = CONTACT_M - dist;
    if (overlap <= 0 || dist < 1e-4) continue;
    const nx = dx / dist, nz = dz / dist, push = overlap * IMPULSE * dt;
    bump.offX += nx * push; bump.offZ += nz * push;
    const yaw = ob.yaw / 256 * Math.PI * 2;
    bump.spin += (Math.sin(yaw) * nz - Math.cos(yaw) * nx) * SPIN * push;
  }
  const off = Math.hypot(bump.offX, bump.offZ);
  if (off > MAX_OFFSET_M) { const s = MAX_OFFSET_M / off; bump.offX *= s; bump.offZ *= s; }
  bump.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, bump.spin));
  if (Math.abs(bump.offX) < 1e-3 && Math.abs(bump.offZ) < 1e-3 && Math.abs(bump.spin) < 1e-3) { bump.offX = bump.offZ = bump.spin = 0; return base; }
  return { ...base, x: Math.round(base.x + bump.offX * 100), z: Math.round(base.z + bump.offZ * 100),
    yaw: ((Math.round(base.yaw + bump.spin / (Math.PI * 2) * 256) % 256) + 256) % 256 };
}
