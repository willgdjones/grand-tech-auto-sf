/**
 * GTASF time-trial board — server submission core (docs/PLAN-gta-pivot.md LANE C). Mirrors runMission: the pure,
 * dep-injected decision the WorldDO handler wraps. The handler does the authoritative check — the player is
 * actually AT the finish (project(finish) vs the authoritative pose, like handleMissionComplete) — and passes it
 * as `finishReached`; it also scopes the injected D1 deps to the route's current daily board (leaderboardKey).
 * This core rejects a spoofed finish or an implausible run (validateSubmission: anti-cheese floor, split sanity),
 * then records the time, replacing the device's best only when it's faster (isBetterTime). A SKILL board, not an
 * economy sink — no valuation credit — so there is no money path here, only best-time validation.
 */
import { isBetterTime, validateSubmission, type TimeTrialSpec } from '@gtasf/shared/founder/timeTrials';

export interface TimeTrialBoardDeps {
  /** The device's current best ms on this route's daily board, or null if it has none yet. */
  readBest: () => Promise<number | null>;
  /** Upsert this device's best for the route's daily board (only called when it's an improvement). */
  writeBest: (ms: number) => Promise<void>;
  /** The device's 1-based rank on the daily board for a given ms, or null if not computed. */
  rankOf?: (ms: number) => Promise<number | null>;
}

export type TimeTrialOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'recorded'; best: boolean; totalMs: number; rank: number | null };

/** One time-trial submission. `finishReached` is the handler's authoritative-pose result. Pure apart from deps;
 *  never double-writes (the slower run leaves the stored best untouched). */
export async function runTimeTrialSubmit(
  spec: TimeTrialSpec,
  submission: { readonly totalMs: number; readonly splits: readonly number[] },
  finishReached: boolean,
  deps: TimeTrialBoardDeps,
): Promise<TimeTrialOutcome> {
  if (!finishReached) return { status: 'rejected', reason: 'not-at-finish' };
  const valid = validateSubmission(spec, submission);
  if (!valid.ok) return { status: 'rejected', reason: valid.reason };
  const existing = await deps.readBest();
  const best = isBetterTime(submission.totalMs, existing);
  if (best) await deps.writeBest(submission.totalMs);
  const recordedMs = best ? submission.totalMs : existing!; // when !best, isBetterTime guarantees existing != null
  const rank = deps.rankOf ? await deps.rankOf(recordedMs) : null;
  return { status: 'recorded', best, totalMs: recordedMs, rank };
}
