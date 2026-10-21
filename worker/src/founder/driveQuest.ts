/**
 * Founder-ladder phase 5.1 — Robotaxi-protester "escape the cone" DRIVE quest money path.
 *
 * Server-VERIFIABLE (unlike the share quest): the player must be IN A VEHICLE and have driven at least
 * `escapeM` from the protester within `limitMs` — the pure `escapedCone` rule that the client HUD timer and
 * the server verifier both evaluate, so a client can't claim an escape it didn't make. Pays a per-SF-day
 * valuation cheque, deduped by a ledger ref so it can't be farmed by re-triggering.
 *
 * Pure apart from the injected deps (mirrors runPitch's shape in ../pitch/pitch.ts). Flag-gated behind
 * memeQuests at the call site. Payout is reviewed by the founder before the flag flips.
 */
import { fundingDay, FUNDING_BASE_CENTS, type FundingSource } from '@gtasf/shared/funding';
import { escapedCone, type DriveQuestParams, type DriveQuestState, type MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';

/** Walk-up radius (m) to START the drive quest next to the protester — matches the pitch angel walk-up. */
export const DRIVE_START_RADIUS_M = 8;

/** Build the server-verified DriveQuestState from the player's authoritative WIRE pose (CENTIMETRES, as
 *  stored on the peer) + vehicle flag + the protester's WORLD position (metres, from project()) + the
 *  quest start time. Centralises the cm→m conversion so the server distance check can't silently use the
 *  wrong units. */
export function driveQuestState(poseCm: { x: number; z: number }, inVehicle: boolean, protesterM: { x: number; z: number }, startMs: number, now: number): DriveQuestState {
  const x = poseCm.x / 100, z = poseCm.z / 100;
  return { distFromProtesterM: Math.hypot(x - protesterM.x, z - protesterM.z), elapsedMs: now - startMs, inVehicle };
}

/**
 * Flat valuation cheque for escaping the protester's cone. TUNABLE — the founder sets the final size
 * (docs/PLAN-founder-ladder-phase5.md open decision: "Payout sizes per quest"). A fixed bump for a binary
 * stunt objective; server-verified, so it can be meaningful without being farmable (the per-SF-day ref caps
 * it to once per NPC per day). Default ~a modest pitch (pitchBaseCents = demo*3; a strong pitch pays up to
 * demo*4.5), deliberately below a great pitch so pitching stays the primary earner.
 */
export const DRIVE_QUEST_PAYOUT_CENTS = FUNDING_BASE_CENTS.demo * 2n;

export interface DriveQuestDeps {
  /** Cooldown pre-check: the per-day ledger key already exists → a repeat is a no-op (never double-pays). */
  credited: (source: FundingSource, sourceRef: string) => Promise<boolean>;
  /** Record the valuation credit (the ledger's UNIQUE(source,ref) also enforces once-per-day at write time). */
  award: (input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }) => Promise<{ credited: boolean }>;
}

export type DriveQuestOutcome =
  | { status: 'incomplete' }                                  // not escaped: still in cone / timed out / on foot / bad clock / not a drive NPC
  | { status: 'blocked'; reason: 'cooldown' }                 // already escaped this NPC today
  | { status: 'completed'; credited: boolean; amountCents: string };

/** Funding source + unique per-SF-day ref for a drive-quest escape. Source 'celebrity' (the meme-NPC quest
 *  source, like the meme pitch); the `meme:drive:` id namespace never collides with a pitch ref or a real
 *  firm id. */
export function driveQuestCredit(npcId: string, now: number): { source: FundingSource; sourceRef: string } {
  return { source: 'celebrity', sourceRef: `meme:drive:${npcId}:${fundingDay(now)}` };
}

/** One drive-quest completion, server-verified. Pure apart from the injected deps (credited/award). */
export async function runDriveQuest(
  npc: MemeNpcSpec,
  state: DriveQuestState,
  params: DriveQuestParams,
  now: number,
  deps: DriveQuestDeps,
): Promise<DriveQuestOutcome> {
  // Only a drive NPC, and only a genuine server-verified escape, is paid.
  if (npc.questKind !== 'drive' || !escapedCone(state, params)) return { status: 'incomplete' };
  const { source, sourceRef } = driveQuestCredit(npc.id, now);
  if (await deps.credited(source, sourceRef)) return { status: 'blocked', reason: 'cooldown' };
  const amountCents = DRIVE_QUEST_PAYOUT_CENTS.toString();
  const result = await deps.award({ source, sourceRef, label: `Escaped ${npc.archetype}`, amountCents, metaJson: JSON.stringify({ driveQuest: true, npc: npc.id }) });
  return { status: 'completed', credited: result.credited, amountCents };
}
