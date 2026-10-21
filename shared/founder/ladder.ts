/**
 * Founder-ladder stage model (docs/PLAN-founder-ladder.md, founder-approved 2026-10-12).
 *
 * Pure + serializable so the client renders it and the worker can validate the same mapping. The
 * score is the startup's VALUATION, held as integer cents (bigint for sums) per the AGENTS.md money
 * rules. The ladder is the game's spine: idea → pre-seed → seed → Series A… → unicorn, with the
 * crown ("#1 valuation") awarded separately by the live leaderboard rather than a fixed threshold.
 *
 * Phase 1 only ever reaches `idea` at a $0 valuation (a fresh start for everyone — season 1, no
 * conversion of old progress); later phases raise the valuation through pitches. No DOM and no flags
 * live here — the `founderLadder` flag is checked at the client entry points that use this.
 */

/** Ladder stages. `crown` is not a valuation threshold — it is held by the live #1 (see CROWN_STAGE). */
export type FounderStageId =
  | 'idea' | 'pre-seed' | 'seed' | 'series-a' | 'series-b' | 'series-c' | 'unicorn';

/** Billboard placement earned at each stage (PLAN "Billboard upgrades per stage"). */
export type BillboardTier = 'embarcadero' | 'market' | 'bay-bridge' | 'skyline-101' | 'salesforce-crown';

/** Prestige rank of each billboard tier (0 = local Embarcadero … 4 = the Salesforce crown). A startup
 *  appears on a city billboard only when its rank meets the surface's minimum (DISTRICT_BILLBOARD_RANK in
 *  shared/content/billboards.ts), so climbing the ladder unlocks more prominent billboards (Seed → Market St). */
export const BILLBOARD_TIER_RANK: Readonly<Record<BillboardTier, number>> = Object.freeze({
  embarcadero: 0, market: 1, 'bay-bridge': 2, 'skyline-101': 3, 'salesforce-crown': 4,
});

export interface FounderStage {
  readonly id: FounderStageId;
  readonly label: string;
  /** Valuation (integer cents) at or above which the startup holds this stage. Ascending, first is 0. */
  readonly minValuationCents: bigint;
  /** The billboard placement this stage unlocks. */
  readonly billboard: BillboardTier;
  /** One-line flavour shown when the stage is first reached. */
  readonly blurb: string;
}

/**
 * The valuation ladder, ascending. Thresholds pace idea→unicorn over days-to-weeks (PLAN "Pacing")
 * and reuse the funding economy's pre-seed/seed/unicorn marks so the two systems read consistently.
 */
export const FOUNDER_STAGES: readonly FounderStage[] = Object.freeze([
  { id: 'idea',     label: 'Idea',     minValuationCents:            0n, billboard: 'embarcadero', blurb: 'A name, a vibe, and infinite projections.' },
  { id: 'pre-seed', label: 'Pre-seed', minValuationCents:     50_000_000n, billboard: 'embarcadero', blurb: 'An angel believed. Barely.' },
  { id: 'seed',     label: 'Seed',     minValuationCents:    300_000_000n, billboard: 'market',      blurb: 'A partner described your spreadsheet as a platform.' },
  { id: 'series-a', label: 'Series A', minValuationCents:  2_500_000_000n, billboard: 'bay-bridge',  blurb: 'Traction, allegedly. The deck now has a second slide.' },
  { id: 'series-b', label: 'Series B', minValuationCents: 10_000_000_000n, billboard: 'bay-bridge',  blurb: 'You survived the "is this just a wrapper?" meeting.' },
  { id: 'series-c', label: 'Series C', minValuationCents: 50_000_000_000n, billboard: 'bay-bridge',  blurb: 'The vest has acquired a vest.' },
  { id: 'unicorn',  label: 'Unicorn',  minValuationCents:100_000_000_000n, billboard: 'skyline-101', blurb: 'A billion imaginary dollars. Still nowhere to park.' },
] as const);

/** The crown is not earned by a fixed valuation — the live #1 holds it and takes the Salesforce slot. */
export const CROWN_STAGE = Object.freeze({
  label: 'Crown', billboard: 'salesforce-crown' as BillboardTier,
  blurb: 'Highest valuation in San Francisco. Your name over the city.',
});

export const IDEA_STAGE: FounderStage = FOUNDER_STAGES[0]!;

/** Parse an untrusted cents string to a non-negative bigint, or null when malformed/negative. */
export function parseValuationCents(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') return raw >= 0n ? raw : null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  try { const v = BigInt(raw); return v >= 0n ? v : null; } catch { return null; }
}

/** The stage a given valuation holds: the highest stage whose threshold it has reached. */
export function founderStageForValuation(cents: bigint): FounderStage {
  const total = cents < 0n ? 0n : cents;
  let held: FounderStage = IDEA_STAGE;
  for (const stage of FOUNDER_STAGES) if (total >= stage.minValuationCents) held = stage; else break;
  return held;
}

/** The billboard-tier rank (0..4) a startup has earned, keyed on the ECONOMY funding round id — the single
 *  source of truth for the billboard tier (orchestrator 2026-10-13), NOT the FOUNDER_STAGES valuation ladder.
 *  The two had diverged badly in economy-v3 (Seed $75k vs the ladder's $3M), so a prod Seed player read as rank 0
 *  (Embarcadero) instead of Market St. Mapped by round id so it's economy-agnostic (works for v2 and v3 ids):
 *  Seed → Market St (1), any Series round → Bay Bridge (2), Unicorn → skyline (3), Pre-IPO/Decacorn/Hectocorn →
 *  the Salesforce crown (4); Bootstrapping / Pre-seed / anything earlier → the local Embarcadero (0). */
export function billboardRankForRound(roundId: string): number {
  if (roundId === 'seed') return BILLBOARD_TIER_RANK.market;
  if (roundId.startsWith('series-')) return BILLBOARD_TIER_RANK['bay-bridge'];
  if (roundId === 'unicorn') return BILLBOARD_TIER_RANK['skyline-101'];
  if (roundId === 'pre-ipo' || roundId === 'decacorn' || roundId === 'hectocorn') return BILLBOARD_TIER_RANK['salesforce-crown'];
  return BILLBOARD_TIER_RANK.embarcadero;
}

/** Round quests pace the climb — one per SF day from Series A on (PLAN "a daily cooldown on round quests").
 *  The first visit (Idea → Seed) has NO cooldown, so a player reaches Seed in one session and then "Series A
 *  opens tomorrow". Ready iff the target round is Seed-or-earlier, or a new SF day has begun since the
 *  player's last round close. lastRoundCloseDay / today are `fundingDay(now)` ISO date strings ('YYYY-MM-DD',
 *  which order lexicographically), null = the player has not closed a cooldown-gated round yet. */
export function founderRoundQuestReady(target: FounderStageId, lastRoundCloseDay: string | null, today: string): boolean {
  const seriesA = FOUNDER_STAGES.findIndex(stage => stage.id === 'series-a');
  const targetIndex = FOUNDER_STAGES.findIndex(stage => stage.id === target);
  if (seriesA < 0 || targetIndex < seriesA) return true; // Idea..Seed: no daily cooldown (the first visit)
  return lastRoundCloseDay === null || lastRoundCloseDay < today;
}

/** Phase 6 — whether the Series A Demo Day quest should be OFFERED to a free-roam player right now (the pure
 *  open gate the client render will call; the server pitch route is separately gated by flags.seriesAQuest +
 *  the stage-gated floor). True iff the player currently holds the ECONOMY **Seed round** (reached Seed but not
 *  yet Series A) AND the daily round cooldown has elapsed since their last round close (founderRoundQuestReady).
 *  `currentRoundId` is the player's `profile.round.id` (the funding economy round — NOT the FOUNDER_STAGES
 *  billboard ladder, whose thresholds differ; in economy-v3 Seed is $75k, so the funding round is the right
 *  "at Seed" signal). lastRoundCloseDay/today are `fundingDay(now)` ISO date strings (null = no cooldown-gated
 *  round closed yet, e.g. right after Seed on the first visit → opens next day). */
export function seriesAQuestReady(currentRoundId: string, lastRoundCloseDay: string | null, today: string): boolean {
  return currentRoundId === 'seed' && founderRoundQuestReady('series-a', lastRoundCloseDay, today);
}

/** The next stage up and the valuation still needed to reach it, or null at the top of the ladder. */
export function nextFounderStage(cents: bigint): { stage: FounderStage; toGoCents: bigint } | null {
  const total = cents < 0n ? 0n : cents;
  const next = FOUNDER_STAGES.find(stage => stage.minValuationCents > total);
  return next ? { stage: next, toGoCents: next.minValuationCents - total } : null;
}

/** Progress (0..1) from the current stage's threshold toward the next stage's threshold. */
export function stageProgress(cents: bigint): number {
  const total = cents < 0n ? 0n : cents;
  const current = founderStageForValuation(total), next = nextFounderStage(total);
  if (!next) return 1;
  const span = next.stage.minValuationCents - current.minValuationCents;
  if (span <= 0n) return 1;
  // Hundredths, computed in bigint to avoid precision loss on large valuations.
  return Number((total - current.minValuationCents) * 10_000n / span) / 10_000;
}

/** Client-side founder-ladder session (localStorage `gtasf.founder.v1`; the funding profile owns the
 *  canonical startup name + valuation, so this only tracks the flow's own progress on this device). */
export interface FounderLadderSession {
  /** The player has founded their startup (passed the found-your-startup card). */
  founded: boolean;
  /** The chosen startup name (mirrors the funding profile once saved). */
  startupName: string;
  /** ms since epoch when the startup was founded, for the "billboard within 2 min" metric. */
  foundedAt: number;
  /** The billboard has swung into view at least once (so we fire billboard_seen only once). */
  billboardSeen: boolean;
  /** The SF day the player last closed a round quest, as a `fundingDay(now)` ISO date string ('YYYY-MM-DD'), or
   *  null if they have not closed a cooldown-gated round yet. Set when Seed closes (so "Series A opens tomorrow"
   *  is real) and on each later round close; read by seriesAQuestReady / founderRoundQuestReady to pace the
   *  ladder one round per SF day. */
  lastRoundCloseDay: string | null;
  /** The player has closed their first pitch (Pre-seed, the Pear VC plaza investor). Returning/already-founded
   *  players who haven't get the free-roam Pre-seed nudge + the interactive plaza investor; set it once closed so
   *  the nudge doesn't nag. */
  preSeedClosed: boolean;
}

export function freshFounderSession(): FounderLadderSession {
  return { founded: false, startupName: '', foundedAt: 0, billboardSeen: false, lastRoundCloseDay: null, preSeedClosed: false };
}

export function serializeFounderSession(session: FounderLadderSession): string {
  return JSON.stringify({
    founded: session.founded, startupName: session.startupName,
    foundedAt: session.foundedAt, billboardSeen: session.billboardSeen,
    lastRoundCloseDay: session.lastRoundCloseDay, preSeedClosed: session.preSeedClosed,
  });
}

/** Parse persisted/untrusted session, coercing anything malformed back to a safe fresh session. */
export function parseFounderSession(raw: unknown): FounderLadderSession {
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return freshFounderSession(); } }
  if (!value || typeof value !== 'object') return freshFounderSession();
  const v = value as Record<string, unknown>;
  return {
    founded: v.founded === true,
    startupName: typeof v.startupName === 'string' ? v.startupName.slice(0, 96) : '',
    foundedAt: Number.isFinite(v.foundedAt) ? Math.max(0, Math.trunc(v.foundedAt as number)) : 0,
    billboardSeen: v.billboardSeen === true,
    lastRoundCloseDay: typeof v.lastRoundCloseDay === 'string' ? v.lastRoundCloseDay.slice(0, 10) : null,
    preSeedClosed: v.preSeedClosed === true,
  };
}
