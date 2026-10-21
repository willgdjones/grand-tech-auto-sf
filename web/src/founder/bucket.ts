/**
 * Founder-ladder A/B bucket (PLAN "Measurement": flag-gated A/B against the current onboarding,
 * 50/50 on new devices). The bucket lives in its own localStorage key, assigned once per device and
 * independent of analytics consent, so the split is stable whether or not the player opts into
 * tracking. The bucket is reported as a property on founder-ladder analytics events, never in a URL.
 */
export type FounderBucket = 'control' | 'ladder';
// v2: the A/B is over (founder 2026-10-13 GTA pivot) — everyone gets the ladder. Bumping the key from v1 means a
// device previously assigned 'control' re-reads clean and is (re-)assigned 'ladder'. 'control' stays in the type
// for back-compat but is never assigned any more.
const BUCKET_KEY = 'gtasf.founder.bucket.v2';

/** Read an already-assigned bucket, or null if this device has never been assigned. */
export function readBucket(): FounderBucket | null {
  try {
    const value = localStorage.getItem(BUCKET_KEY);
    return value === 'control' || value === 'ladder' ? value : null;
  } catch { return null; }
}

/**
 * The device's bucket. The A/B is over (founder 2026-10-13): this always returns 'ladder' and persists it under
 * the v2 key, so everyone gets the founder ladder. `_rng` is kept only for the call/test signature (unused now).
 */
export function assignBucket(_rng: () => number = Math.random): FounderBucket {
  try { localStorage.setItem(BUCKET_KEY, 'ladder'); } catch { /* per-session fallback; still 'ladder' */ }
  return 'ladder';
}
