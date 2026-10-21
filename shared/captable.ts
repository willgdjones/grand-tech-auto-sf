import { formatFunding, fundingRound, type FundingRound, type FundingSource } from './funding';

/**
 * Cap-table contract (PLAN-v2 decision 5). Every source that funded a player is
 * listed: drive-through events (as "angel syndicates"), VC fund drops, parody
 * celebrity angels and referral warm intros. A player's public cap table can be
 * fetched for anyone, so it carries only public fields — never email, payment or
 * private identity data.
 *
 * {@link FundingSource} itself lives in ./funding so it has no cyclic import; this
 * module adds the cap-table presentation around it.
 */
export { type FundingSource } from './funding';

export const FUNDING_SOURCES: readonly FundingSource[] = Object.freeze(['event', 'vc-drop', 'celebrity', 'warm-intro']);

/** Public section heading for each funding source, shown on the cap table. */
export const FUNDING_SOURCE_LABELS: Readonly<Record<FundingSource, string>> = Object.freeze({
  event: 'Angel syndicates',
  'vc-drop': 'VC fund drops',
  celebrity: 'Celebrity angels',
  'warm-intro': 'Warm intros',
});

export function isFundingSource(value: unknown): value is FundingSource {
  return typeof value === 'string' && (FUNDING_SOURCES as readonly string[]).includes(value);
}
export function fundingSourceLabel(source: FundingSource): string {
  return FUNDING_SOURCE_LABELS[source] ?? 'Other backers';
}

/** One cheque from one backer. Public display fields only. */
export interface CapTableEntry {
  source: FundingSource;
  /** Specific backer name: the event title, fund name or investor. */
  label: string;
  amountCents: string;
  awardedAt: number;
}
/** Credits grouped by source, each with a subtotal and a capped list of recent entries. */
export interface CapTableGroup {
  source: FundingSource;
  title: string;
  totalCents: string;
  /** Total number of credits in this group (may exceed {@link entries} length). */
  count: number;
  /** Most-recent credits, newest first, capped at {@link CAP_TABLE_ENTRY_LIMIT}. */
  entries: CapTableEntry[];
}
/** A player's public cap table: who funded their startup and how much. */
export interface CapTable {
  deviceId: string;
  startupName: string;
  nickname: string;
  round: FundingRound;
  totalCents: string;
  groups: CapTableGroup[];
  serverNow: number;
}

/** Cap table never lists every single cheque a grinder has; groups keep accurate totals/counts. */
export const CAP_TABLE_ENTRY_LIMIT = 50;

export function formatCapTableTotal(cents: string): string {
  return formatFunding(cents);
}

/** Build the grouped view from flat public rows, preserving {@link FUNDING_SOURCES} order. */
export function groupCapTableRows(rows: readonly CapTableEntry[]): CapTableGroup[] {
  const groups = new Map<FundingSource, CapTableGroup>();
  for (const row of rows) {
    if (!isFundingSource(row.source)) continue;
    const group = groups.get(row.source) ?? { source: row.source, title: fundingSourceLabel(row.source), totalCents: '0', count: 0, entries: [] };
    group.totalCents = (BigInt(group.totalCents) + BigInt(row.amountCents)).toString();
    group.count += 1;
    if (group.entries.length < CAP_TABLE_ENTRY_LIMIT) group.entries.push(row);
    groups.set(row.source, group);
  }
  return FUNDING_SOURCES.flatMap(source => {
    const group = groups.get(source);
    return group ? [group] : [];
  });
}

/** The ladder round implied by a cap table's total, for clients that only hold the groups. */
export function capTableRound(total: string): FundingRound {
  return fundingRound(total);
}
