import { describe, expect, it } from 'vitest';
import {
  CAP_TABLE_ENTRY_LIMIT, FUNDING_SOURCES, capTableRound, formatCapTableTotal,
  fundingSourceLabel, groupCapTableRows, isFundingSource, type CapTableEntry,
} from './captable';

const row = (over: Partial<CapTableEntry>): CapTableEntry => ({
  source: 'event', label: 'Event', amountCents: '0', awardedAt: 0, ...over,
});

describe('isFundingSource', () => {
  it('accepts the four public sources and rejects anything else', () => {
    for (const s of FUNDING_SOURCES) expect(isFundingSource(s)).toBe(true);
    for (const s of ['', 'payment', 'device', 'investor', 42, null, undefined]) expect(isFundingSource(s)).toBe(false);
  });
});

describe('fundingSourceLabel', () => {
  it('labels known sources and falls back for unknown', () => {
    expect(fundingSourceLabel('event')).toBe('Angel syndicates');
    expect(fundingSourceLabel('vc-drop')).toBe('VC fund drops');
    expect(fundingSourceLabel('celebrity')).toBe('Celebrity angels');
    expect(fundingSourceLabel('warm-intro')).toBe('Warm intros');
    expect(fundingSourceLabel('mystery' as CapTableEntry['source'])).toBe('Other backers');
  });
});

describe('groupCapTableRows', () => {
  it('groups in canonical source order and drops empty sources', () => {
    const groups = groupCapTableRows([
      row({ source: 'warm-intro', amountCents: '10' }),
      row({ source: 'celebrity', amountCents: '20' }),
      row({ source: 'event', amountCents: '30' }),
    ]);
    expect(groups.map(g => g.source)).toEqual(['event', 'celebrity', 'warm-intro']);
    expect(groups.find(g => g.source === 'vc-drop')).toBeUndefined();
  });

  it('subtotals (as bigint cents) and counts per group', () => {
    const groups = groupCapTableRows([
      row({ source: 'event', amountCents: '100' }),
      row({ source: 'event', amountCents: '250' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Angel syndicates');
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.totalCents).toBe('350');
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it('caps listed entries at CAP_TABLE_ENTRY_LIMIT while count and total reflect every credit', () => {
    const many = Array.from({ length: CAP_TABLE_ENTRY_LIMIT + 5 }, (_, i) => row({ amountCents: '2', awardedAt: i }));
    const [group] = groupCapTableRows(many);
    expect(group!.count).toBe(CAP_TABLE_ENTRY_LIMIT + 5);
    expect(group!.entries).toHaveLength(CAP_TABLE_ENTRY_LIMIT);
    expect(group!.totalCents).toBe(String((CAP_TABLE_ENTRY_LIMIT + 5) * 2));
  });

  it('ignores rows with an unknown source', () => {
    const groups = groupCapTableRows([
      row({ source: 'event', amountCents: '5' }),
      row({ source: 'mystery' as CapTableEntry['source'], amountCents: '999' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.totalCents).toBe('5');
  });

  it('returns [] for no rows', () => {
    expect(groupCapTableRows([])).toEqual([]);
  });
});

describe('capTableRound', () => {
  it('derives the funding stage from a total', () => {
    expect(capTableRound('0').id).toBe('bootstrapping');
    expect(capTableRound('50000000').id).toBe('pre-seed');
  });
});

describe('formatCapTableTotal', () => {
  it('formats integer cents into SA-style money', () => {
    expect(formatCapTableTotal('150000000')).toBe('$1.5M');
    expect(formatCapTableTotal('0')).toBe('$0');
  });
});
