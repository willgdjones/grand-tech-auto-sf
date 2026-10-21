/**
 * GTA V pivot — LANE B (combat & police): store-robbery payout (flag storeRobberies). Mirrors runMission —
 * pays the valuation credit once the server has validated the robbery (the handler checks the AUTHORITATIVE
 * pose is inside the store), deduped by the robbery credit ref so it can't be farmed. Pure apart from deps.
 */
import type { FundingSource } from '@gtasf/shared/funding';
import { flags } from '@gtasf/shared/flags';
import { robberyCredit, robberyPayoutCents, type StoreSpec } from '@gtasf/shared/combat/storeRobbery';
import { MAX_CREDIT_CENTS } from '../funding/credits';

export interface RobberyDeps {
  /** Cooldown pre-check: the credit ref already exists this window → a repeat is a no-op (never double-pays). */
  credited: (source: FundingSource, sourceRef: string) => Promise<boolean>;
  /** Record the valuation credit (funding_credits UNIQUE(source,ref) also enforces the daily cooldown at write). */
  award: (input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }) => Promise<{ credited: boolean }>;
  /** riskReward: the robber's current valuation (cents, burn folded to now); null = unknown → the flat $750. */
  currentCents?: () => Promise<bigint | null>;
}

export type RobberyOutcome =
  | { status: 'too-far' }                                       // the server did not confirm the player is in the store
  | { status: 'blocked'; reason: 'cooldown' }                   // already robbed this store today
  | { status: 'robbed'; credited: boolean; amountCents: string };

/** One store robbery. `inStore` is the server-validated proximity result. Only a confirmed robbery pays. */
export async function runStoreRobbery(store: StoreSpec, inStore: boolean, now: number, deps: RobberyDeps): Promise<RobberyOutcome> {
  if (!inStore) return { status: 'too-far' };
  const { source, sourceRef } = robberyCredit(store, now);
  if (await deps.credited(source, sourceRef)) return { status: 'blocked', reason: 'cooldown' };
  const rebalance = flags.riskReward && deps.currentCents !== undefined;
  // 1% of a large valuation can exceed the single-credit ceiling (award() would throw): clamp to it.
  const payout = robberyPayoutCents(store, rebalance ? await deps.currentCents!() : null, rebalance);
  const amountCents = (payout > MAX_CREDIT_CENTS ? MAX_CREDIT_CENTS : payout).toString();
  const result = await deps.award({ source, sourceRef, label: `Store robbery: ${store.name}`, amountCents, metaJson: JSON.stringify({ robbery: store.id }) });
  return { status: 'robbed', credited: result.credited, amountCents };
}
