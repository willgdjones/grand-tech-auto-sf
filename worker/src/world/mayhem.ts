import { MAYHEM_ITEMS, mayhemCanFire } from '@gtasf/shared/content/mayhem';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';

/**
 * Server half of Playful Mayhem sync (gtasf-mayhem-sync-4fez), behind flags.playfulMayhem. A client
 * fires a cosmetic toy (C2S MAYHEM_FIRE {item, at, colour, normal}); the server VALIDATES it, enforces
 * the same per-player cooldown the client self-limits with (never trust the client), then relays an
 * S2C MAYHEM_FIRE stamped with senderId to NEARBY peers so everyone sees the splat/confetti/splash.
 * Non-lethal, purely cosmetic, never gameplay/funding; tiny, rate-limited, no per-frame traffic.
 *
 * This module is pure policy: validation, the per-peer rate limiter, and the nearby test. WorldDO owns
 * the peer set, so it does the fan-out loop (a far peer never receives a fire it cannot see).
 */

/** How far a splat/burst carries. The firer's aim ray is short (~55 m) so `at` sits near the firer;
 *  a block or two of visibility reads naturally while keeping each fire's fan-out bounded. */
export const MAYHEM_RELAY_RADIUS_M = 250;

type MayhemFire = Extract<C2SMessage, { type: 'MAYHEM_FIRE' }>;
type MayhemBroadcast = Extract<S2CMessage, { type: 'MAYHEM_FIRE' }>;

const finite3 = (v: readonly unknown[] | null): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6);

/** Reject a malformed or out-of-range fire before it reaches the renderer (a bad item index or a NaN
 *  coordinate would otherwise crash or teleport a decal). The codec guarantees the shape; this bounds
 *  the values a hostile client could still send. */
export function validMayhemFire(m: MayhemFire): boolean {
  return Number.isInteger(m.item) && m.item >= 0 && m.item < MAYHEM_ITEMS.length
    && finite3(m.at)
    && Number.isInteger(m.colour) && m.colour >= 0 && m.colour <= 0xffffffff
    && (m.normal === null || finite3(m.normal));
}

/** True when a viewer at `viewerPoseCm` (world centimetres, as peers are stored) is within the relay
 *  radius of a splat at `atM` (world metres, as the wire carries it). Horizontal distance only. */
export function nearMayhem(viewerPoseCm: { x: number; z: number }, atM: readonly [number, number, number], radiusM = MAYHEM_RELAY_RADIUS_M): boolean {
  const dx = viewerPoseCm.x / 100 - atM[0], dz = viewerPoseCm.z / 100 - atM[2];
  return dx * dx + dz * dz <= radiusM * radiusM;
}

export class WorldMayhem {
  private readonly lastFire = new Map<number, number>();

  /** Validate + rate-limit a fire from `senderId`. Returns the S2C broadcast to relay to nearby peers,
   *  or null if the fire is invalid or too soon after the sender's previous one. */
  fire(senderId: number, m: MayhemFire, now: number): MayhemBroadcast | null {
    if (!validMayhemFire(m)) return null;
    if (!mayhemCanFire(this.lastFire.get(senderId) ?? Number.NEGATIVE_INFINITY, now)) return null;
    this.lastFire.set(senderId, now);
    return { type: 'MAYHEM_FIRE', senderId, item: m.item, at: m.at, colour: m.colour, normal: m.normal };
  }

  /** Drop a disconnected player's cooldown state so the map does not grow unbounded. */
  forget(senderId: number): void { this.lastFire.delete(senderId); }
}
