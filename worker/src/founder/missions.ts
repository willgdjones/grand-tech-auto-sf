/**
 * GTASF mission framework — server payout (docs/PLAN-gta-pivot.md LANE C). Mirrors runDriveQuest: pays the
 * valuation credit once the server has validated completion, deduped by the mission credit ref so it can't be
 * farmed by re-triggering. The handler (WorldDO) does the kind-specific completion check — proximity to the
 * deliver waypoint from the AUTHORITATIVE pose, like handleDriveComplete — and passes a MissionCompletion. Pure
 * apart from the injected deps. Flag-gated behind flags.missions at the call site; money path reviewed.
 *
 * Anti-cheat (money review 2026-10-14, issue 1): a delivery-pose proximity gate alone was farmable — grab the
 * deck in SoMa, teleport the authoritative pose to the delivery point (reload with ?at=<deliver>, or a
 * quick-robotaxi) and claim ~$9k in seconds. `missionCompleted` closes the instant-claim/teleport vectors:
 *  • a minimum grab→deliver travel time (`missionMinTravelMs`) rejects a delivery faster than physically possible;
 *  • a heist must be delivered with the heat lost (0 stars) when the wanted system is on.
 * The WorldDO also CLEARS the active mission on disconnect and on a quick-robotaxi teleport, so a teleport can't
 * leave an in-progress mission to cash out later (the elapsed floor only bounds a single continuous attempt).
 */
import type { FundingSource } from '@gtasf/shared/funding';
import { MISSIONS, MISSION_ARRIVE_RADIUS_M, missionCheckpoints, missionCredit, missionEnabled, missionPayoutCents, type MissionSpec } from '@gtasf/shared/founder/missions';
import { project } from '../funding/anchors';

export interface MissionDeps {
  /** Cooldown pre-check: the credit ref already exists → a repeat is a no-op (never double-pays). */
  credited: (source: FundingSource, sourceRef: string) => Promise<boolean>;
  /** Record the valuation credit (the funding_credits UNIQUE(source,ref) also enforces the cooldown at write). */
  award: (input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }) => Promise<{ credited: boolean }>;
}

export type MissionOutcome =
  | { status: 'incomplete' }                                   // the server did not confirm completion
  | { status: 'blocked'; reason: 'cooldown' }                  // already completed this mission this cooldown window
  | { status: 'completed'; credited: boolean; amountCents: string };

/** Upper bound on vehicle speed for the travel-time floor (m/s). Above the 60 m/s (MAX_SPEED_CMPS = 6000) server
 *  cap on driven vehicles, so a legitimate flat-out run never trips the floor — it only blocks an instant jump. */
export const MISSION_TOP_SPEED_MPS = 70;

/** The minimum plausible start→deliver time (ms): the straight-line PATH from the start through every waypoint in
 *  order, at top speed. Straight lines underestimate the real road path AND top speed over-estimates the real average,
 *  so this floor is strictly below any legit run — it only rejects a teleport/instant claim. Summing the path (not
 *  start→deliver) matters for a loop mission whose delivery is back at its start. 0 with no waypoints. */
export function missionMinTravelMs(mission: MissionSpec): number {
  let prev = project(mission.start.lat, mission.start.lon), metres = 0;
  for (const objective of mission.objectives) {
    if (!objective.at) continue;
    const next = project(objective.at.lat, objective.at.lon);
    metres += Math.hypot(next.x - prev.x, next.z - prev.z); prev = next;
  }
  return Math.round(metres / MISSION_TOP_SPEED_MPS * 1000);
}

/** Advance a run's server-verified checkpoint count from an authoritative pose (metres): while the pose is inside
 *  the NEXT checkpoint's radius, count it. In order only — skipping ahead never counts. Pure; the WorldDO calls it
 *  on mission-start (a heist's grab sits at its start) and on every server-accepted pose while the run is live. */
/** Server slack (m) on a checkpoint radius: the server pose trails the client by a tick, so a car clipping the edge of
 *  the client's radius still counts. Small next to the path-length travel floor, so it buys no shortcut. */
export const CHECKPOINT_SLACK_M = 5;
export function advanceCheckpoints(mission: MissionSpec, reached: number, x: number, z: number, driving = false): number {
  const checkpoints = missionCheckpoints(mission);
  while (reached < checkpoints.length) {
    const checkpoint = checkpoints[reached]!, at = project(checkpoint.at!.lat, checkpoint.at!.lon);
    if (checkpoint.drive && !driving) break; // a drive objective (taxi fare) only counts from the driver's seat
    if (Math.hypot(x - at.x, z - at.z) > (checkpoint.radiusM ?? MISSION_ARRIVE_RADIUS_M) + CHECKPOINT_SLACK_M) break;
    reached += 1;
  }
  return reached;
}

/** What the server observed about a delivery attempt. All fields are authoritative (server pose / server clock). */
export interface MissionCompletion {
  /** The authoritative pose is within the deliver waypoint's radius. */
  readonly atDelivery: boolean;
  /** Milliseconds since the server recorded the mission start (the grab). */
  readonly elapsedMs: number;
  /** Current wanted stars at delivery, or null when the wanted system is off (nothing to enforce). A heist pays
   *  only once the heat is lost (0 stars) — no cashing out with the SFPD still on you. */
  readonly wantedStars: number | null;
  /** Checkpoints the SERVER saw this run reach, in order (advanceCheckpoints). Every one is required. */
  readonly checkpointsReached: number;
}

/** Is this a legitimate (at the delivery point, not teleported/instant, heat lost) completion? Pure anti-cheat
 *  predicate so the rule is unit-tested, not buried in the handler. */
export function missionCompleted(mission: MissionSpec, completion: MissionCompletion): boolean {
  if (!completion.atDelivery) return false;
  if (completion.checkpointsReached < missionCheckpoints(mission).length) return false;  // skipped a pickup
  if (completion.elapsedMs < missionMinTravelMs(mission)) return false;              // teleport / impossibly fast
  if (mission.kind === 'heist' && completion.wantedStars !== null && completion.wantedStars > 0) return false; // lose the heat first
  return true;
}

/** An in-flight quest records the SESSION that started it (id + generation). A `?at=` reload resumes the session
 *  with the SAME id but a BUMPED generation (sessions.admit → generation++) and swaps the peer under that id, so a
 *  find()-by-device would hand the resumed peer the old quest. Requiring the completing peer to be the exact
 *  starting session (id AND generation) makes every resume/teleport-via-reload a non-completion — the payout/board
 *  bypass the review flagged. An in-session teleport (quick-robotaxi, respawn) keeps the generation, so the explicit
 *  clears cover those; this covers the resume path. Pure → unit-tested. */
export function questStartedBy(entry: { sid: number; gen: number }, peer: { session: { id: number; generation: number } } | undefined): boolean {
  return !!peer && peer.session.id === entry.sid && peer.session.generation === entry.gen;
}

/** One mission completion. `completion` is the server-validated observation (authoritative pose, server-measured
 *  elapsed, current heat); only a legitimate completion (see `missionCompleted`) is paid. Pure apart from deps. */
export async function runMission(mission: MissionSpec, completion: MissionCompletion, now: number, deps: MissionDeps): Promise<MissionOutcome> {
  if (!missionCompleted(mission, completion)) return { status: 'incomplete' };
  const { source, sourceRef } = missionCredit(mission, now);
  if (await deps.credited(source, sourceRef)) return { status: 'blocked', reason: 'cooldown' };
  const amountCents = missionPayoutCents(mission).toString();
  const result = await deps.award({ source, sourceRef, label: `Mission: ${mission.title}`, amountCents, metaJson: JSON.stringify({ mission: mission.id, kind: mission.kind }) });
  return { status: 'completed', credited: result.credited, amountCents };
}

/** Is this mission already paid in its current cooldown window (today's SF day for a daily job, ever for a once job)?
 *  Checked at mission-start so a player isn't sent on a whole run that can only end in 'blocked'. */
export function missionDoneNow(mission: MissionSpec, creditedRefs: ReadonlySet<string>, now: number): boolean {
  return creditedRefs.has(missionCredit(mission, now).sourceRef);
}

/** The enabled missions already done in their cooldown window (the jobs phone greys them out). */
export function missionsDoneNow(creditedRefs: ReadonlySet<string>, now: number, enabled: Readonly<Record<string, boolean>>): string[] {
  return MISSIONS.filter(mission => missionEnabled(mission, enabled) && missionDoneNow(mission, creditedRefs, now)).map(mission => mission.id);
}
