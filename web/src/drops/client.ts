import { flags } from '@gtasf/shared/flags';
import { DROP_CAPACITY, type FundDropClaim, type FundDropState, type LiveFundDrop } from '@gtasf/shared/drops';

export interface DropProximity { drop: LiveFundDrop; distance: number; bearing: number; compass: string }
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** Geometry is +x east, -z north, so a heading is atan2(east, north). */
export function compassOf(dx: number, dz: number): { bearing: number; compass: string } {
  const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return { bearing, compass: COMPASS[Math.round(bearing / 45) % 8]! };
}

/**
 * Read-only client for VC fund drops. The server detects drive/walk-throughs authoritatively;
 * this just polls `/api/drops/state` for the banner, the N/50 counter and the one-shot claim toast,
 * polling faster the closer the player is to the open drop.
 */
export function createDropsClient(options: {
  onState?(state: FundDropState): void;
  onClaim?(claim: FundDropClaim): void;
  onError?(message: string): void;
} = {}) {
  if (!flags.fundDrops) return null;
  let disposed = false, busy = false, state: FundDropState | null = null;
  let position = { x: 0, y: 0, z: 0 }, connected = false;
  let lastPoll = -Infinity, nextAttempt = 0, error = '';
  const controllers = new Set<AbortController>(), seenClaims = new Set<string>();

  async function poll(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/drops/state', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const text = await response.text(); if (text.length > 131072) throw new Error('Drops response was too large');
      const value = JSON.parse(text) as FundDropState & { error?: string };
      if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error.slice(0, 160) : 'Fund drops are temporarily unavailable');
      if (disposed) return;
      state = value; error = '';
      options.onState?.(value);
      const claim = value.recentClaim;
      if (claim && claim.position > 0 && !seenClaims.has(claimKey(claim))) {
        seenClaims.add(claimKey(claim)); if (seenClaims.size > 100) seenClaims.delete(seenClaims.values().next().value!);
        options.onClaim?.(claim);
      }
    } catch (value) {
      if (disposed || (value instanceof DOMException && value.name === 'AbortError')) return;
      const message = value instanceof Error ? value.message : 'Fund drops are temporarily unavailable';
      if (message !== error) options.onError?.(message);
      error = message; nextAttempt = performance.now() + 5000;
    } finally { clearTimeout(timeout); controllers.delete(controller); busy = false; }
  }
  function claimKey(claim: FundDropClaim): string { return `${claim.dropId}:${claim.position}:${claim.claimedAt}`; }
  function nearest(): DropProximity | null {
    if (!state?.active.length) return null;
    let best: DropProximity | null = null;
    for (const drop of state.active) {
      const dx = drop.anchor.x - position.x, dz = drop.anchor.z - position.z, distance = Math.hypot(dx, dz);
      if (!best || distance < best.distance) best = { drop, distance, ...compassOf(dx, dz) };
    }
    return best;
  }
  return {
    init() { if (!disposed) void poll(); },
    update(pos: { x: number; y: number; z: number }, _mode: 'on-foot' | 'driver' | 'passenger', isConnected: boolean, now = performance.now()) {
      if (disposed) return;
      position = pos; connected = isConnected;
      if (busy || now < nextAttempt) return;
      // Poll every ~3s normally, but every ~1s within 120 m so the counter feels live on approach.
      const near = (nearest()?.distance ?? Infinity) < 120;
      if (connected && now - lastPoll >= (near ? 1000 : 3000)) { lastPoll = now; void poll(); }
    },
    get state() { return state; },
    get active(): LiveFundDrop[] { return state?.active ?? []; },
    get nearest() { return nearest(); },
    get error() { return error; },
    get capacity() { return DROP_CAPACITY; },
    destroy() {
      if (disposed) return;
      disposed = true; for (const controller of controllers) controller.abort(); controllers.clear();
    },
  };
}
export type DropsClient = NonNullable<ReturnType<typeof createDropsClient>>;
