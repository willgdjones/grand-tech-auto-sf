/**
 * GTASF time trials (docs/PLAN-gta-pivot.md LANE C — "time trials + ghosts: Lombard switchbacks, Embarcadero
 * sprint, Twin Peaks; best-time daily leaderboard"). A shared, serializable spec — a start marker, ordered
 * checkpoints, a finish and a par time — that the CLIENT drives (minimap markers, checkpoint timing, the ghost
 * replay) while the SERVER validates the run and keeps the best-time leaderboard (a per-route, per-day D1 board).
 *
 * Time trials are a SKILL board, not an economy sink: a run earns a best TIME, never a valuation credit, so this
 * stays out of the money path (no reviewed payout). The pure validation helpers (`isPlausibleTime` anti-cheese,
 * `isBetterTime`, the daily key) are the server's authority and are unit-tested.
 *
 * Coordinates are approximate SF landmarks; the exact walkable spot for each marker is tuned with a capture
 * (the roadgraph snap / createGroundNpc hide an off-mesh point — the Series A venue + heist lesson). Flag-gated
 * behind `timeTrials` (off).
 */
import { fundingDay } from '@gtasf/shared/funding';

export interface GeoPoint { readonly lat: number; readonly lon: number }

/** How the route is run: `drive` (in a vehicle) or `foot` (sprint on foot). The client runner + the server
 *  plausibility floor both key off this (a foot sprint and a drive have very different minimum times). */
export type TimeTrialMode = 'drive' | 'foot';

/** One ordered gate of a route. The client advances through these in order (proximity within `radiusM`); the
 *  server re-checks the submitted splits are monotonic and each gate was within radius before it accepts a time. */
export interface TimeTrialCheckpoint {
  readonly id: string;
  readonly at: GeoPoint;
  readonly radiusM: number;
}

export interface TimeTrialSpec {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;                                    // the phone / marker line
  readonly mode: TimeTrialMode;
  readonly start: GeoPoint & { readonly letter: string };    // minimap letter marker + where the clock starts
  readonly checkpoints: readonly TimeTrialCheckpoint[];      // ordered gates between start and finish
  readonly finish: TimeTrialCheckpoint;                      // crossing it stops the clock
  readonly parMs: number;                                    // the target "gold" time shown to the player
  /** Anti-cheese floor: a legit run can't be faster than this (a teleport / noclip would be). The server rejects
   *  any submitted total below it, so the leaderboard can't be farmed by skipping the route. */
  readonly minMs: number;
}

/** A single leaderboard entry (one device's best for a route on an SF day). Serializable → the D1 row + the wire. */
export interface TimeTrialRecord {
  readonly routeId: string;
  readonly deviceId: string;
  readonly name: string;      // display name (startup / founder handle)
  readonly ms: number;        // total run time
  readonly day: string;       // fundingDay — the board resets daily
}

/** A lightweight ghost: the best run's sampled path for replay (the client interpolates a translucent racer).
 *  Samples are sparse (a few per second); full pose traces are a later refinement. */
export interface TimeTrialGhostSample { readonly ms: number; readonly lat: number; readonly lon: number }
export interface TimeTrialGhost { readonly routeId: string; readonly totalMs: number; readonly samples: readonly TimeTrialGhostSample[] }

/**
 * Route roster: the founder's three signature SF runs plus Mission Street Dash + Telegraph Hill Climb. Coords are
 * road-snapped (verified on the live graph); re-verify with a capture when adding a route.
 */
export const TIME_TRIALS: readonly TimeTrialSpec[] = Object.freeze([
  {
    id: 'lombard-switchbacks',
    title: 'Lombard Switchbacks',
    blurb: "The crookedest street in the world. Thread the eight curves clean, fastest run wins the day.",
    mode: 'drive',
    start: { lat: 37.802326, lon: -122.418938, letter: 'T' }, // Hyde & Lombard (top of the crooked block)
    checkpoints: [
      { id: 'cp1', at: { lat: 37.802100, lon: -122.418200 }, radiusM: 12 }, // mid-curves
    ],
    finish: { id: 'finish', at: { lat: 37.802339, lon: -122.416868 }, radiusM: 14 }, // bottom of the crooked block, Lombard St (snapped to walkable)
    parMs: 40_000,
    minMs: 28_000, // ~0.7× par (review fix 2): nothing below this is a human run on this route
  },
  {
    id: 'embarcadero-sprint',
    title: 'Embarcadero Sprint',
    blurb: "On foot, flat out along the waterfront from the Ferry Building to the piers. No shortcuts.",
    mode: 'foot',
    start: { lat: 37.795347, lon: -122.393962, letter: 'T' }, // Embarcadero promenade by the Ferry Building (snapped to walkable)
    checkpoints: [
      { id: 'cp1', at: { lat: 37.797878, lon: -122.395200 }, radiusM: 14 }, // along the promenade (snapped to walkable)
    ],
    finish: { id: 'finish', at: { lat: 37.799500, lon: -122.397500 }, radiusM: 16 }, // toward Pier 7
    parMs: 85_000,
    minMs: 59_500, // ~0.7× par (review fix 2)
  },
  {
    id: 'twin-peaks-climb',
    title: 'Twin Peaks Climb',
    blurb: "Up the switchbacks to the summit for the whole-city view. Keep it on the road.",
    mode: 'drive',
    start: { lat: 37.758500, lon: -122.446000, letter: 'T' }, // base of the Twin Peaks climb
    checkpoints: [
      { id: 'cp1', at: { lat: 37.756321, lon: -122.446824 }, radiusM: 16 }, // up the grade (snapped to walkable)
    ],
    finish: { id: 'finish', at: { lat: 37.754553, lon: -122.447255 }, radiusM: 18 }, // Christmas Tree Point Rd summit lookout (snapped to walkable)
    parMs: 75_000,
    minMs: 52_500, // ~0.7× par (review fix 2)
  },
  {
    id: 'mission-street-dash',
    title: 'Mission Street Dash',
    blurb: "Waterfront to Civic Center down Mission Street in one go. Lights are a suggestion.",
    mode: 'drive',
    start: { lat: 37.792822, lon: -122.394398, letter: 'T' }, // Mission & Steuart (road-snapped, live graph 2026-10-14)
    checkpoints: [
      { id: 'cp1', at: { lat: 37.786062, lon: -122.401921 }, radiusM: 16 }, // Mission & 3rd
      { id: 'cp2', at: { lat: 37.782654, lon: -122.406445 }, radiusM: 16 }, // Mission & 5th
    ],
    finish: { id: 'finish', at: { lat: 37.778018, lon: -122.412378 }, radiusM: 18 }, // Mission & 8th, by Civic Center
    parMs: 110_000,
    minMs: 77_000, // 0.7× par; the ~2.3 km straight line alone is >38 s at the 60 m/s server cap
  },
  {
    id: 'telegraph-hill-climb',
    title: 'Telegraph Hill Climb',
    blurb: "On foot from Washington Square up the steps of Telegraph Hill to Coit Tower. Lungs optional.",
    mode: 'foot',
    start: { lat: 37.800367, lon: -122.409934, letter: 'T' }, // Washington Square, North Beach (road-snapped)
    checkpoints: [
      { id: 'cp1', at: { lat: 37.801719, lon: -122.406763 }, radiusM: 14 }, // up Filbert toward Grant
    ],
    finish: { id: 'finish', at: { lat: 37.802488, lon: -122.405617 }, radiusM: 16 }, // Coit Tower (the SF-pilgrimage stop)
    parMs: 75_000,
    minMs: 52_500, // 0.7× par; ~450 m straight line is >56 s at the 8 m/s on-foot cap
  },
]);

export function timeTrialById(id: string): TimeTrialSpec | undefined {
  return TIME_TRIALS.find(trial => trial.id === id);
}

/** The SF day a run belongs to — the leaderboard resets each fundingDay. */
export function timeTrialDay(now: number): string {
  return fundingDay(now);
}

/** The per-route, per-day leaderboard key (the D1 board id + the wire channel). */
export function leaderboardKey(routeId: string, day: string): string {
  return `tt:${routeId}:${day}`;
}

/** Anti-cheese: a submitted total is only plausible if it's at or above the route's floor (a teleport/noclip
 *  run finishes under it). The server gates every submission on this before it touches the board. */
export function isPlausibleTime(spec: TimeTrialSpec, ms: number): boolean {
  return Number.isFinite(ms) && ms >= spec.minMs;
}

/** True when `candidate` is a faster (better) time than `current` — the leaderboard keeps the minimum. A missing
 *  current time (no record yet) is always beaten. */
export function isBetterTime(candidate: number, current: number | null | undefined): boolean {
  return current == null || candidate < current;
}

/** Whether a run beat par (the "gold" target). Cosmetic — par never gates the board. */
export function beatPar(spec: TimeTrialSpec, ms: number): boolean {
  return ms <= spec.parMs;
}

/** The wire + D1 shape a finished run submits. `splits` is the elapsed ms at each gate (the checkpoints in order,
 *  then the finish), so splits.length === checkpoints.length + 1. */
export interface TimeTrialSubmission {
  readonly routeId: string;
  readonly totalMs: number;
  readonly splits: readonly number[];
  readonly day: string;
}

/**
 * Pure split/shape sanity of a submitted run. One of three checks the WorldDO submit handler runs (review fix 2 —
 * the submit is now WorldDO-owned, not the worker edge, so the authoritative pose is available):
 *   1. a server-recorded START (the handler records startMs only when the authoritative pose is at the route start);
 *   2. the authoritative pose is AT the finish on submit, and the SERVER-measured elapsed (now − startMs) clears the
 *      floor and matches the client's reported total within slack — `serverRunTimingOk` (this is the real
 *      anti-teleport defense; the server clock can't be faked);
 *   3. this pure check — the rest of the defense: it rejects teleport-speed totals (below the anti-cheese floor),
 *      the wrong number of splits, out-of-order (non-monotonic) splits, and a total that doesn't match the final
 *      split. The intermediate checkpoints stay client-trusted (like the drive quest's escape is client-timed).
 * A skill board, not money, so this + the finish-pose + server-elapsed checks are proportionate.
 */
export function validateSubmission(
  spec: TimeTrialSpec,
  sub: { readonly totalMs: number; readonly splits: readonly number[] },
): { ok: true } | { ok: false; reason: string } {
  if (!isPlausibleTime(spec, sub.totalMs)) return { ok: false, reason: 'implausible-time' };
  const expected = spec.checkpoints.length + 1; // one split per gate, including the finish
  if (sub.splits.length !== expected) return { ok: false, reason: 'split-count' };
  for (let i = 0; i < sub.splits.length; i++) {
    const t = sub.splits[i]!;
    if (!Number.isFinite(t) || t < 0) return { ok: false, reason: 'split-value' };
    if (i > 0 && t <= sub.splits[i - 1]!) return { ok: false, reason: 'non-monotonic' };
  }
  const last = sub.splits[sub.splits.length - 1]!;
  if (Math.abs(last - sub.totalMs) > 250) return { ok: false, reason: 'total-mismatch' }; // final split is the total (±250ms)
  return { ok: true };
}

/** How close the authoritative pose must be to the route START for the WorldDO to arm the clock (m). */
export const TIME_TRIAL_START_RADIUS_M = 20;
/** Latency/clock-skew slack between the client's reported total and the server-measured elapsed (ms). A legit run's
 *  reported total is at most this much below the server elapsed (the server clock includes the submit round trip). */
export const TIME_TRIAL_TIMING_SLACK_MS = 5_000;
/** The client finishes the instant it crosses the finish radius; the server's newest pose is from a moment before, so it
 *  usually sits just OUTSIDE (QA gtasf-024it: phone run 422 'not-at-finish'). Allow one-to-two pose intervals of travel at
 *  sprint/drive speed. Still anti-cheat: the run also needs the server-recorded start, the travel floor and the splits. */
export const TIME_TRIAL_FINISH_LAG_M = 8;
/** Is the server's authoritative pose (metres) at the finish, allowing for pose lag? `finish` is the projected finish point. */
export function atTimeTrialFinish(spec: TimeTrialSpec, finish: { readonly x: number; readonly z: number }, x: number, z: number): boolean {
  return Math.hypot(x - finish.x, z - finish.z) <= spec.finish.radiusM + TIME_TRIAL_FINISH_LAG_M;
}
/** Hard cap on a submitted ghost's samples (the client samples a few per second; a full route is well under this). */
export const TIME_TRIAL_GHOST_MAX_SAMPLES = 600;
/** Max bytes of a submit body (the ghost dominates). The handler size-guards BEFORE parsing so an oversized body is
 *  rejected without the parse cost (review fix 3). */
export const TIME_TRIAL_SUBMIT_BODY_MAX = 90_000;

/**
 * Server-authoritative timing gate (review fix 2): the WorldDO owns the run, so `serverElapsedMs` is the real time
 * between the server-recorded start and this submit — it can't be faked. The run must have taken at least the
 * anti-cheese floor (no teleport-to-finish), and the client's reported total can't be meaningfully faster than the
 * server actually observed (no lying the time down to spoof the board). Pure + unit-tested.
 */
export function serverRunTimingOk(
  spec: TimeTrialSpec,
  serverElapsedMs: number,
  clientTotalMs: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(serverElapsedMs) || serverElapsedMs < spec.minMs) return { ok: false, reason: 'too-soon' };
  if (!Number.isFinite(clientTotalMs) || clientTotalMs < serverElapsedMs - TIME_TRIAL_TIMING_SLACK_MS) return { ok: false, reason: 'time-mismatch' };
  return { ok: true };
}

/**
 * Validate + bound a submitted ghost (review fix 3). Returns a clean, size-bounded ghost to store, or null to drop
 * it (the time still records without a ghost — the ghost is cosmetic). Rejects a non-array / oversized sample set,
 * any non-finite coord or ms, and non-increasing sample times. Shape-only; the stored path itself is never trusted
 * for scoring. The caller has already size-guarded the raw body (TIME_TRIAL_SUBMIT_BODY_MAX).
 */
export function sanitizeTimeTrialGhost(raw: unknown, routeId: string): TimeTrialGhost | null {
  if (!raw || typeof raw !== 'object') return null;
  const samplesRaw = (raw as { samples?: unknown }).samples;
  if (!Array.isArray(samplesRaw) || samplesRaw.length === 0 || samplesRaw.length > TIME_TRIAL_GHOST_MAX_SAMPLES) return null;
  const samples: TimeTrialGhostSample[] = [];
  let prevMs = -Infinity;
  for (const s of samplesRaw) {
    if (!s || typeof s !== 'object') return null;
    const { ms, lat, lon } = s as { ms?: unknown; lat?: unknown; lon?: unknown };
    if (typeof ms !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (ms < 0 || ms <= prevMs) return null; // strictly increasing sample times
    prevMs = ms;
    samples.push({ ms, lat, lon });
  }
  const totalMsRaw = (raw as { totalMs?: unknown }).totalMs;
  const totalMs = typeof totalMsRaw === 'number' && Number.isFinite(totalMsRaw) && totalMsRaw >= 0 ? totalMsRaw : samples[samples.length - 1]!.ms;
  return { routeId, totalMs, samples };
}
