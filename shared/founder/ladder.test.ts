import { describe, expect, it } from 'vitest';
import {
  billboardRankForRound, CROWN_STAGE, FOUNDER_STAGES, IDEA_STAGE, founderRoundQuestReady, founderStageForValuation, freshFounderSession,
  nextFounderStage, parseFounderSession, parseValuationCents, seriesAQuestReady, serializeFounderSession, stageProgress,
} from './ladder';

describe('founder ladder stages', () => {
  it('is ascending, starts at idea/$0, and every stage has a billboard tier', () => {
    expect(FOUNDER_STAGES[0]!.id).toBe('idea');
    expect(FOUNDER_STAGES[0]!.minValuationCents).toBe(0n);
    for (let i = 1; i < FOUNDER_STAGES.length; i++) {
      expect(FOUNDER_STAGES[i]!.minValuationCents).toBeGreaterThan(FOUNDER_STAGES[i - 1]!.minValuationCents);
    }
    for (const stage of FOUNDER_STAGES) expect(stage.billboard).toBeTruthy();
    expect(CROWN_STAGE.billboard).toBe('salesforce-crown');
  });

  it('maps a valuation to the highest stage it has reached', () => {
    expect(founderStageForValuation(0n)).toBe(IDEA_STAGE);
    expect(founderStageForValuation(-100n).id).toBe('idea');          // negative clamps to idea
    expect(founderStageForValuation(49_999_999n).id).toBe('idea');     // just below pre-seed
    expect(founderStageForValuation(50_000_000n).id).toBe('pre-seed'); // exactly at the threshold
    expect(founderStageForValuation(300_000_000n).id).toBe('seed');
    expect(founderStageForValuation(2_500_000_000n).id).toBe('series-a');
    expect(founderStageForValuation(99_999_999_999n).id).toBe('series-c');
    expect(founderStageForValuation(100_000_000_000n).id).toBe('unicorn');
    expect(founderStageForValuation(10n ** 18n).id).toBe('unicorn');   // above the top stays unicorn
  });

  it('reports the next stage and the exact cents still needed, null at the top', () => {
    expect(nextFounderStage(0n)).toEqual({ stage: FOUNDER_STAGES[1]!, toGoCents: 50_000_000n });
    expect(nextFounderStage(49_999_999n)!.toGoCents).toBe(1n);
    expect(nextFounderStage(50_000_000n)!.stage.id).toBe('seed');
    expect(nextFounderStage(100_000_000_000n)).toBeNull();            // unicorn is the top of the ladder
  });

  it('stage progress runs 0..1 within a band and is 1 at the top', () => {
    expect(stageProgress(0n)).toBe(0);
    // Halfway from pre-seed (50_000_000) to seed (300_000_000) is 175_000_000.
    expect(stageProgress(175_000_000n)).toBeCloseTo(0.5, 3);
    expect(stageProgress(300_000_000n)).toBe(0); // exactly at seed: start of the seed→series-a band
    expect(stageProgress(100_000_000_000n)).toBe(1);
    expect(stageProgress(10n ** 15n)).toBe(1);
  });
});

describe('valuation cents parsing', () => {
  it('accepts non-negative bigint/string/number and rejects the rest', () => {
    expect(parseValuationCents('0')).toBe(0n);
    expect(parseValuationCents('50000000')).toBe(50_000_000n);
    expect(parseValuationCents(42)).toBe(42n);
    expect(parseValuationCents(7n)).toBe(7n);
    expect(parseValuationCents('-5')).toBeNull();
    expect(parseValuationCents(-5n)).toBeNull();
    expect(parseValuationCents('abc')).toBeNull();
    expect(parseValuationCents('1.5')).toBeNull();
    expect(parseValuationCents(null)).toBeNull();
    expect(parseValuationCents({})).toBeNull();
  });
});

describe('founder session persistence', () => {
  it('round-trips a session through serialize/parse (incl. lastRoundCloseDay)', () => {
    const session = { founded: true, startupName: 'Quantum Sourdough', foundedAt: 1_700_000_000_000, billboardSeen: true, lastRoundCloseDay: '2026-07-15', preSeedClosed: true };
    expect(parseFounderSession(serializeFounderSession(session))).toEqual(session);
  });

  it('coerces malformed input back to a fresh session', () => {
    expect(parseFounderSession('not json')).toEqual(freshFounderSession());
    expect(parseFounderSession(null)).toEqual(freshFounderSession());
    expect(parseFounderSession(42)).toEqual(freshFounderSession());
    expect(parseFounderSession({ founded: 'yes', foundedAt: -3, startupName: 5 }))
      .toEqual({ founded: false, startupName: '', foundedAt: 0, billboardSeen: false, lastRoundCloseDay: null, preSeedClosed: false });
  });

  it('defaults preSeedClosed to false for old sessions and coerces non-true to false', () => {
    expect(freshFounderSession().preSeedClosed).toBe(false);
    expect(parseFounderSession({ founded: true, startupName: 'A', foundedAt: 1, billboardSeen: true }).preSeedClosed).toBe(false);
    expect(parseFounderSession({ preSeedClosed: 'yes' }).preSeedClosed).toBe(false);
    expect(parseFounderSession({ preSeedClosed: true }).preSeedClosed).toBe(true);
  });

  it('defaults lastRoundCloseDay to null (old sessions) and coerces a non-string to null, keeping an ISO day', () => {
    // An old persisted session with no lastRoundCloseDay field parses as null (has not closed a gated round).
    expect(parseFounderSession({ founded: true, startupName: 'A', foundedAt: 1, billboardSeen: true }).lastRoundCloseDay).toBeNull();
    expect(parseFounderSession({ lastRoundCloseDay: 20_301 }).lastRoundCloseDay).toBeNull(); // a number is not a valid SF-day string
    expect(parseFounderSession({ lastRoundCloseDay: '2026-07-16' }).lastRoundCloseDay).toBe('2026-07-16');
  });

  it('caps an over-long persisted startup name at 96 chars', () => {
    const parsed = parseFounderSession({ founded: true, startupName: 'x'.repeat(500), foundedAt: 1, billboardSeen: false });
    expect(parsed.startupName).toHaveLength(96);
  });

  it('a fresh session has not founded, has not seen a billboard, and has no round close', () => {
    expect(freshFounderSession()).toEqual({ founded: false, startupName: '', foundedAt: 0, billboardSeen: false, lastRoundCloseDay: null, preSeedClosed: false });
  });
});

describe('founderRoundQuestReady (daily round cooldown)', () => {
  const d0 = '2026-07-15', d1 = '2026-07-16'; // consecutive SF days (ISO strings order lexicographically)
  it('Idea..Seed have no cooldown — the first visit closes through Seed in one session', () => {
    expect(founderRoundQuestReady('idea', null, d0)).toBe(true);
    expect(founderRoundQuestReady('pre-seed', d0, d0)).toBe(true);
    expect(founderRoundQuestReady('seed', d0, d0)).toBe(true); // same day as Pre-seed, still ready
  });
  it('Series A opens only on a new SF day after the last round close', () => {
    expect(founderRoundQuestReady('series-a', d0, d0)).toBe(false); // same day as the Seed close
    expect(founderRoundQuestReady('series-a', d0, d1)).toBe(true);  // the next SF day
    expect(founderRoundQuestReady('series-a', null, d0)).toBe(true); // no gated round closed yet
  });
  it('later rounds are paced the same way (one per day), incl. across a month boundary', () => {
    expect(founderRoundQuestReady('series-b', d0, d0)).toBe(false);
    expect(founderRoundQuestReady('series-b', d0, d1)).toBe(true);
    expect(founderRoundQuestReady('unicorn', '2026-07-31', '2026-07-31')).toBe(false);
    expect(founderRoundQuestReady('unicorn', '2026-07-31', '2026-08-01')).toBe(true); // ISO ordering across months
  });
});

describe('billboardRankForRound (economy round → billboard tier, single source of truth)', () => {
  it('Seed unlocks Market St (1), any Series round the Bay Bridge (2); earlier rounds stay Embarcadero (0)', () => {
    expect(billboardRankForRound('bootstrapping')).toBe(0); // Embarcadero
    expect(billboardRankForRound('pre-seed')).toBe(0);      // v2 pre-seed still local
    expect(billboardRankForRound('seed')).toBe(1);          // Market St — the live-bug fix
    expect(billboardRankForRound('series-a')).toBe(2);      // Bay Bridge
    expect(billboardRankForRound('series-d')).toBe(2);      // v3 top series round
    expect(billboardRankForRound('series-z')).toBe(2);      // v2 late series
  });
  it('maps the very top rounds above the Bay Bridge, and unknown ids to Embarcadero', () => {
    expect(billboardRankForRound('unicorn')).toBe(3);        // skyline-101
    expect(billboardRankForRound('decacorn')).toBe(4);       // salesforce crown
    expect(billboardRankForRound('hectocorn')).toBe(4);
    expect(billboardRankForRound('not-a-round')).toBe(0);
  });
});

describe('seriesAQuestReady (phase 6 free-roam open gate; keyed on the economy round id)', () => {
  const d0 = '2026-07-15', d1 = '2026-07-16';
  it('offers Series A once the player holds the Seed round and the daily cooldown has elapsed', () => {
    expect(seriesAQuestReady('seed', d0, d1)).toBe(true);   // at Seed, a new SF day since the close
    expect(seriesAQuestReady('seed', null, d0)).toBe(true); // at Seed, no gated round closed yet
  });
  it('does not offer it the same day Seed closed (opens tomorrow)', () => {
    expect(seriesAQuestReady('seed', d0, d0)).toBe(false);
  });
  it('does not offer it below Seed (bootstrapping/pre-seed) or once already at/past Series A', () => {
    expect(seriesAQuestReady('pre-seed', null, d0)).toBe(false);  // not yet Seed (v2 round below Seed)
    expect(seriesAQuestReady('bootstrapping', null, d0)).toBe(false);
    expect(seriesAQuestReady('series-a', null, d0)).toBe(false);  // already Series A — the Seed round is behind them
  });
});
