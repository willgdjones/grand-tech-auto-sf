/**
 * Founder-ladder phase 5.1 — Thought-leader "repost my take" SHARE quest money path.
 *
 * ⚠️ UNVERIFIABLE (client-trust): there is no server-side proof that the player actually reposted/shared,
 * so this credit fires on the client's claim alone. Two guardrails bound the farming it invites:
 *   1. ONCE-EVER ref `meme:share:<npcId>` (NO day component) — a player can claim each share NPC at most
 *      once, ever. Unlike the drive/pitch per-SF-day refs, there is no daily reset.
 *   2. A SMALL flat payout (default below the verifiable drive quest and well below a pitch), so the
 *      upside of lying is minimal and pitching/driving stay the real earners.
 *
 * FOUNDER DECISION (docs/PLAN-founder-ladder-phase5.md open decisions): whether a client-trust credit is
 * acceptable at all, and the payout size. This file is the concrete proposal to review before the flag.
 *
 * Pure apart from the injected deps (mirrors runDriveQuest/runPitch). Flag-gated behind memeQuests.
 */
import { FUNDING_BASE_CENTS, type FundingSource } from '@gtasf/shared/funding';
import type { MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';

/**
 * Flat valuation cheque for reposting a thought-leader's take. TUNABLE — founder sets the final size.
 * Deliberately SMALL (default ~a sixth of the demo base, below the drive quest's demo*2) because it is
 * client-trust + once-ever: it's a one-time nudge to share, not a reliable earner.
 */
export const SHARE_QUEST_PAYOUT_CENTS = FUNDING_BASE_CENTS.demo / 2n;

/** Walk-up radius (m) to claim the share quest next to the thought-leader — matches the pitch angel walk-up. */
export const SHARE_CLAIM_RADIUS_M = 8;

export interface ShareQuestDeps {
  /** Once-ever pre-check: the ref already exists → this player already claimed this share NPC. */
  credited: (source: FundingSource, sourceRef: string) => Promise<boolean>;
  /** Record the valuation credit (the ledger's UNIQUE(source,ref) also enforces once-ever at write time). */
  award: (input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }) => Promise<{ credited: boolean }>;
}

export type ShareQuestOutcome =
  | { status: 'ineligible' }                                  // not a share NPC
  | { status: 'blocked'; reason: 'already-claimed' }          // already claimed this share NPC (once-ever)
  | { status: 'completed'; credited: boolean; amountCents: string };

/** Funding source + ONCE-EVER ref for a share-quest claim. No day component (unlike drive/pitch) — a share
 *  NPC pays at most once ever per player. Source 'celebrity' (the meme-NPC quest source). */
export function shareQuestCredit(npcId: string): { source: FundingSource; sourceRef: string } {
  return { source: 'celebrity', sourceRef: `meme:share:${npcId}` };
}

/** One share-quest claim. Client-trust (no server verification), so the only gate is the once-ever ref.
 *  Pure apart from the injected deps (credited/award). */
export async function runShareQuest(npc: MemeNpcSpec, deps: ShareQuestDeps): Promise<ShareQuestOutcome> {
  if (npc.questKind !== 'share') return { status: 'ineligible' };
  const { source, sourceRef } = shareQuestCredit(npc.id);
  if (await deps.credited(source, sourceRef)) return { status: 'blocked', reason: 'already-claimed' };
  const amountCents = SHARE_QUEST_PAYOUT_CENTS.toString();
  const result = await deps.award({ source, sourceRef, label: `Reposted ${npc.archetype}`, amountCents, metaJson: JSON.stringify({ shareQuest: true, npc: npc.id }) });
  return { status: 'completed', credited: result.credited, amountCents };
}
