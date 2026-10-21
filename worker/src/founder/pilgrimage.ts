/**
 * GTASF SF Pilgrimage — server payout (docs/PLAN-gta-pivot.md LANE C task 6). Mirrors runShareQuest/runMission:
 * pure apart from the injected deps; the WorldDO handler supplies what the server observed.
 *
 * Money guardrails:
 *  • proximity from the AUTHORITATIVE pose (PILGRIMAGE_RADIUS_M), never a client claim;
 *  • anti-teleport: since joining / its last server-authorized teleport, the session must have been at least
 *    PILGRIMAGE_MIN_TRAVEL_M from the site (`approached`, from server-accepted poses only), so a `?at=<site>` deep
 *    link or a quick-robotaxi drop can't cash out on arrival — the player has to walk or drive in (both
 *    server-speed-checked);
 *  • ONCE-EVER refs per site + one completion bonus, enforced again by funding_credits' UNIQUE(source,ref).
 * The worst case is bounded: every site once + the bonus, once per device, ever.
 */
import type { FundingSource } from '@gtasf/shared/funding';
import { project } from '../funding/anchors';
import {
  PILGRIMAGE_MIN_TRAVEL_M, PILGRIMAGE_RADIUS_M, PILGRIMAGE_SITES, pilgrimageBonusCents, pilgrimageBonusCredit,
  pilgrimageCredit, pilgrimageSiteCents, type PilgrimageSite,
} from '@gtasf/shared/founder/pilgrimage';

export interface PilgrimageDeps {
  /** Every 'celebrity' ref this device has been credited (one read covers the site + the bonus check). */
  creditedRefs: () => Promise<ReadonlySet<string>>;
  award: (input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }) => Promise<{ credited: boolean }>;
}

/** What the server observed: metres from the authoritative pose to the site, and whether this session has been
 *  PILGRIMAGE_MIN_TRAVEL_M+ from the site since it joined / last teleported (see markApproached). */
export interface PilgrimageObservation { readonly siteM: number; readonly approached: boolean }

let sitePoints: { id: string; x: number; z: number }[] | undefined;
/** Record (into `far`) every site the pose (metres) is at least PILGRIMAGE_MIN_TRAVEL_M from. Called on each
 *  server-accepted pose; `far` is cleared on every teleport, so a site only counts as approached by travel. */
export function markApproached(x: number, z: number, far: Set<string>): void {
  if (far.size === PILGRIMAGE_SITES.length) return;
  sitePoints ??= PILGRIMAGE_SITES.map(site => ({ id: site.id, ...project(site.lat, site.lon) }));
  for (const p of sitePoints) if (!far.has(p.id) && Math.hypot(x - p.x, z - p.z) >= PILGRIMAGE_MIN_TRAVEL_M) far.add(p.id);
}

export type PilgrimageOutcome =
  | { status: 'too-far' }
  | { status: 'no-travel' }
  | { status: 'blocked'; reason: 'already-claimed' }
  | { status: 'completed'; credited: boolean; amountCents: string; bonusCents: string | null; collected: number; total: number };

/** Pure eligibility (unit-tested): at the site, and arrived by travel rather than a teleport onto it. */
export function pilgrimageArrival(observation: PilgrimageObservation): 'ok' | 'too-far' | 'no-travel' {
  if (observation.siteM > PILGRIMAGE_RADIUS_M) return 'too-far';
  if (!observation.approached) return 'no-travel';
  return 'ok';
}

export async function runPilgrimageClaim(site: PilgrimageSite, observation: PilgrimageObservation, deps: PilgrimageDeps): Promise<PilgrimageOutcome> {
  const arrival = pilgrimageArrival(observation);
  if (arrival !== 'ok') return { status: arrival };
  const { source, sourceRef } = pilgrimageCredit(site.id);
  const before = await deps.creditedRefs();
  if (before.has(sourceRef)) return { status: 'blocked', reason: 'already-claimed' };
  const amountCents = pilgrimageSiteCents().toString();
  const collected = PILGRIMAGE_SITES.filter(s => s.id === site.id || before.has(pilgrimageCredit(s.id).sourceRef)).length;
  // The label is what the funding cheque card shows, so it carries the progress (the client adds no second toast).
  const result = await deps.award({ source, sourceRef, label: `SF pilgrimage: ${site.name} (${collected}/${PILGRIMAGE_SITES.length})`, amountCents, metaJson: JSON.stringify({ pilgrimage: site.id }) });
  let bonusCents: string | null = null;
  const bonus = pilgrimageBonusCredit();
  if (collected === PILGRIMAGE_SITES.length && !before.has(bonus.sourceRef)) {
    const paid = await deps.award({ ...bonus, label: 'SF pilgrimage complete', amountCents: pilgrimageBonusCents().toString(), metaJson: JSON.stringify({ pilgrimage: 'complete' }) });
    if (paid.credited) bonusCents = pilgrimageBonusCents().toString();
  }
  return { status: 'completed', credited: result.credited, amountCents, bonusCents, collected, total: PILGRIMAGE_SITES.length };
}

/** The device's collected site ids, from its credited refs (for the phone list). */
export function pilgrimageCollected(refs: ReadonlySet<string>): string[] {
  return PILGRIMAGE_SITES.filter(site => refs.has(pilgrimageCredit(site.id).sourceRef)).map(site => site.id);
}
