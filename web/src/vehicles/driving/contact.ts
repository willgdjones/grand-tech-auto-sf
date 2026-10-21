import type { DrivingState } from './controller';

/**
 * Real car-vs-car contact (flags.carCollisions, gtasf-4g29). Every car is a capsule: a centre segment along its
 * heading (forward = (sin yaw, cos yaw)) swept by a radius. The driven car is pushed out of overlaps, loses the
 * speed it carried into the other car, and bounces off a little. A fresh hit (closing speed, per-car cooldown)
 * is returned so the caller can crunch, shake the camera and nudge an AI car. Client-side only; no server
 * physics, so remote players' cars are never moved here (each owner pushes itself away).
 */
export interface ContactBody {
  x: number; z: number; yaw: number;
  /** Half the centre segment's length (m) and the capsule radius (m). */
  half: number; radius: number;
  /** Fleet vehicle id, or a negative id for cosmetic kerb cars. */
  id: number;
  /** The other car's world velocity (m/s), so traffic driving INTO a slow/stopped player still crunches. */
  vx?: number; vz?: number;
}
export interface CarImpact { id: number; closing: number; nx: number; nz: number }

/** The driven car's own capsule (a ~4.6 m by 2 m car). */
export const PLAYER_CAR_HALF = 1.3, PLAYER_CAR_RADIUS = 1.0;
/** Contact counts slightly before overlap: walls (kerb cars) stop the car at the surface, never inside it. */
const CONTACT_MARGIN = .35, MIN_IMPACT_MPS = 1.2, COOLDOWN_MS = 450, MAX_SHOVE = 9;

function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return { x: ax + dx * t, z: az + dz * t };
}

/** Closest pair between two segments, sampled at both ends and the projected middle: plenty for car-sized capsules. */
function closestPair(a0x: number, a0z: number, a1x: number, a1z: number, b0x: number, b0z: number, b1x: number, b1z: number) {
  let best = { ax: 0, az: 0, bx: 0, bz: 0, d2: Infinity };
  const consider = (ax: number, az: number, bx: number, bz: number) => {
    const d2 = (ax - bx) ** 2 + (az - bz) ** 2;
    if (d2 < best.d2) best = { ax, az, bx, bz, d2 };
  };
  for (const [px, pz] of [[a0x, a0z], [a1x, a1z], [(a0x + a1x) / 2, (a0z + a1z) / 2]] as const) {
    const q = closestOnSegment(px, pz, b0x, b0z, b1x, b1z); consider(px, pz, q.x, q.z);
  }
  for (const [px, pz] of [[b0x, b0z], [b1x, b1z], [(b0x + b1x) / 2, (b0z + b1z) / 2]] as const) {
    const q = closestOnSegment(px, pz, a0x, a0z, a1x, a1z); consider(q.x, q.z, px, pz);
  }
  return best;
}

export function createCarContact() {
  const lastHit = new Map<number, number>();
  return {
    /**
     * Resolve the driven car against nearby bodies after this frame's driving update. `speedBefore` is the
     * car's speed entering the frame (a wall stop may already have zeroed `state.speed`). Returns the hardest
     * fresh impact, or null.
     */
    resolve(state: DrivingState, speedBefore: number, bodies: readonly ContactBody[], now: number): CarImpact | null {
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      const a0x = state.x + sin * PLAYER_CAR_HALF, a0z = state.z + cos * PLAYER_CAR_HALF;
      const a1x = state.x - sin * PLAYER_CAR_HALF, a1z = state.z - cos * PLAYER_CAR_HALF;
      const vx = sin * speedBefore, vz = cos * speedBefore;
      let pushX = 0, pushZ = 0, impact: CarImpact | null = null, touching = false;
      for (const body of bodies) {
        if (Math.abs(body.x - state.x) > 9 || Math.abs(body.z - state.z) > 9) continue;
        const bs = Math.sin(body.yaw) * body.half, bc = Math.cos(body.yaw) * body.half;
        const pair = closestPair(a0x, a0z, a1x, a1z, body.x + bs, body.z + bc, body.x - bs, body.z - bc);
        const reach = PLAYER_CAR_RADIUS + body.radius, dist = Math.sqrt(pair.d2);
        if (!Number.isFinite(dist) || dist >= reach + CONTACT_MARGIN) continue;
        touching = true;
        // Normal from the other car to ours; on a dead-centre overlap fall back to centre-to-centre.
        let nx = pair.ax - pair.bx, nz = pair.az - pair.bz, nl = Math.hypot(nx, nz);
        if (nl < 1e-4) { nx = state.x - body.x; nz = state.z - body.z; nl = Math.hypot(nx, nz) || 1; }
        nx /= nl; nz /= nl;
        const overlap = reach - dist;
        if (overlap > 0) { pushX += nx * overlap * 10; pushZ += nz * overlap * 10; }
        const closing = -((vx - (body.vx ?? 0)) * nx + (vz - (body.vz ?? 0)) * nz); // relative speed INTO each other
        if (closing < MIN_IMPACT_MPS) continue;
        if (now - (lastHit.get(body.id) ?? -Infinity) < COOLDOWN_MS) continue;
        if (!impact || closing > impact.closing) impact = { id: body.id, closing, nx, nz };
      }
      if (impact) {
        lastHit.set(impact.id, now);
        // Lose the speed that went into the hit (head-on: most of it; glancing: a little), never speed up.
        const align = Math.min(1, impact.closing / Math.max(.1, Math.abs(speedBefore)));
        const kept = Math.sign(speedBefore) * Math.abs(speedBefore) * Math.max(.1, 1 - align * .85);
        // A wall stop (kerb car) already zeroed the speed: keep it stopped; otherwise take the slower of the two.
        if (state.speed !== 0 && Math.abs(kept) < Math.abs(state.speed)) state.speed = kept;
        // Bounce back along the normal, scaled by how hard we hit.
        pushX += impact.nx * impact.closing * .55; pushZ += impact.nz * impact.closing * .55;
        state.bumpSpin = Math.max(-1.6, Math.min(1.6, state.bumpSpin + (impact.nx * cos - impact.nz * sin) * impact.closing * .08));
      }
      if (pushX || pushZ) {
        const scale = Math.min(1, MAX_SHOVE / Math.max(1e-6, Math.hypot(pushX, pushZ)));
        state.bumpVx = pushX * scale; state.bumpVz = pushZ * scale;
      }
      if (lastHit.size > 64) for (const [id, t] of lastHit) if (now - t > 5_000) lastHit.delete(id);
      return touching ? impact : null;
    },
  };
}
