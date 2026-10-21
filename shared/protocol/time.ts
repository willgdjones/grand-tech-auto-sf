/**
 * `t32` wire time (M1.3a, §4.5): epoch milliseconds mod 2³², unwrapped by the receiver to the full epoch
 * value closest to its own synchronised estimate. `unwrapT32Within` bounds the result to an evidence
 * window (R1-034), so a stale or forged timestamp cannot land anywhere in a 49.7-day cycle.
 */

const T32 = 2 ** 32;
const HALF_T32 = 2 ** 31;

/** epochMs mod 2³² for a non-negative integer epochMs. */
export function toT32(epochMs: number): number {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError(`epochMs must be a non-negative safe integer, got ${String(epochMs)}`);
  }
  return epochMs % T32;
}

/**
 * The epoch millisecond value congruent to `t32` (mod 2³²) closest to `refEpochMs`, choosing among the
 * candidates in the reference's cycle and its neighbours; an exact tie (2³¹ away) resolves to the earlier.
 */
export function unwrapT32(t32: number, refEpochMs: number): number {
  const base = refEpochMs - (refEpochMs % T32);
  let best = base + t32 - T32;
  for (const candidate of [base + t32, base + t32 + T32]) {
    const distance = Math.abs(candidate - refEpochMs);
    const bestDistance = Math.abs(best - refEpochMs);
    if (distance < bestDistance) best = candidate;
  }
  return best;
}

/** `unwrapT32`, or null when the result is more than `maxSkewMs` from the reference. */
export function unwrapT32Within(t32: number, refEpochMs: number, maxSkewMs: number): number | null {
  const unwrapped = unwrapT32(t32, refEpochMs);
  return Math.abs(unwrapped - refEpochMs) <= maxSkewMs ? unwrapped : null;
}

/** Half the t32 cycle, the largest distance `unwrapT32` can return. */
export const T32_HALF_RANGE_MS = HALF_T32;
