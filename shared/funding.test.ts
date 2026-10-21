import { expect, it } from 'vitest';
import { FUNDING_ROUNDS, ECON_V3_ROUNDS, FUNDING_ROUNDS_V2, ECON_V3_BURN_PER_MIN_CENTS, ROUND_FLOOR_GRACE_MIN, priorRoundThresholdCents, roundFloorGraceCents, fundingDay, fundingKind, fundingPerks, fundingRound, fundingTiming, formatFunding, isPreviewLull, nextFundingStreak, normalizeFundingName, quoteFunding } from './funding';
import { normalizeNickname } from './protocol/nickname';

it('keeps saved nicknames usable by multiplayer while preserving Unicode startup names', () => {
  for (const [input, expected] of [
    ['  Ｋａｒｌ  ', 'Karl'], ['雪'.repeat(16), '雪'.repeat(16)],
    ['🌉'.repeat(12), '🌉'.repeat(12)], ['雪 👩‍💻', '雪 👩‍💻'],
  ]) {
    const saved = normalizeFundingName(input, 'nickname');
    expect(saved).toBe(expected);
    expect(normalizeNickname(saved)).toBe(saved);
  }
  for (const input of ['雪'.repeat(17), '雪'.repeat(24), '🌉'.repeat(13), 'Karl\u202e', 'Ka\u0000rl', '\ud800x']) {
    expect(() => normalizeFundingName(input, 'nickname')).toThrow(RangeError);
  }
  expect(() => normalizeFundingName('a'.repeat(25), 'nickname')).toThrow(/2–24/);
  expect(normalizeFundingName('雪'.repeat(48), 'startup')).toBe('雪'.repeat(48));
});

it('pays pre-Tech-Week preview events at the upcoming rate without widening the 2h window', () => {
  const event = { id: 'preview', title: 'Founder breakfast', host: 'Example Ventures', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z' };
  const start = Date.parse(event.start);
  // A future event 2h+1ms before start is normally x0.5 "missed it"; as a preview it pays the upcoming rate.
  const missed = quoteFunding(event, start - 2 * 60 * 60_000 - 1, 0, 1);
  expect(missed.amountCents).toBe('50000000'); expect(missed.timing).toBe('follow-up'); expect(missed.preview).toBe(false);
  const previewed = quoteFunding(event, start - 2 * 60 * 60_000 - 1, 0, 1, true);
  expect(previewed.amountCents).toBe('150000000'); expect(previewed.timing).toBe('upcoming'); expect(previewed.preview).toBe(true);
  // The deliberate 2h upcoming window is untouched: inside it the quote is already upcoming, preview or not.
  expect(quoteFunding(event, start - 2 * 60 * 60_000, 0, 1).amountCents).toBe('150000000');
  // A genuinely past event stays x0.5 even with the preview flag — you did miss it.
  const past = quoteFunding(event, Date.parse(event.end) + 1, 0, 1, true);
  expect(past.amountCents).toBe('50000000'); expect(past.timing).toBe('follow-up'); expect(past.preview).toBe(false);
  // A live event ignores the preview flag entirely.
  expect(quoteFunding(event, start + 10 * 60_000, 0, 1, true).timing).toBe('live');
  // isPreviewLull: before Tech Week nothing is near-term -> lull; a full slate of near-term events -> not.
  expect(isPreviewLull([event], Date.parse('2026-10-03T12:00:00Z'))).toBe(true);
  const slate = Array.from({ length: 30 }, (_, i) => ({ start: new Date(start - 10 * 60_000).toISOString(), end: new Date(start + (i + 1) * 60_000).toISOString() }));
  expect(isPreviewLull(slate, start - 30 * 60_000)).toBe(false);
});

it('pays a real timed room, advances a streak/round, and respects caps and SF midnight', () => {
  const event = { id: 'real-event', title: 'Founder breakfast', host: 'Example Ventures', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z' };
  const now = Date.parse('2026-10-05T16:10:00Z');
  expect(fundingKind(event)).toBe('investor');
  expect(fundingKind({ title: 'Demo Day' })).toBe('demo');
  expect(fundingKind({ title: 'Community meetup' })).toBe('community');
  const first = quoteFunding(event, now, 2, 1);
  expect(first.amountCents).toBe('360000000');
  expect(fundingRound(first.amountCents).id).toBe('seed');
  expect(fundingPerks(first.amountCents)).toEqual(['nicer-car', 'building-name']);
  const streak = nextFundingStreak({ eventId: event.id, at: now, count: 1 }, 'next', now + 15 * 60_000);
  expect(streak).toBe(2);
  expect(quoteFunding(event, now, 2, streak).amountCents).toBe('450000000');
  expect(quoteFunding(event, now, 50, 50).amountCents).toBe('1200000000');
  expect(nextFundingStreak({ eventId: event.id, at: now, count: 5 }, 'next', now + 15 * 60_000 + 1)).toBe(1);
  expect(quoteFunding(event, Date.parse(event.start) - 2 * 60 * 60_000, 0, 1).amountCents).toBe('150000000');
  expect(quoteFunding(event, Date.parse(event.start) - 2 * 60 * 60_000 - 1, 0, 1).amountCents).toBe('50000000');
  expect(fundingTiming(event, Date.parse(event.end))).toBe('follow-up');
  expect(fundingTiming({ ...event, end: null }, now)).toBe('follow-up');
  expect(fundingDay(Date.parse('2026-10-06T06:59:59Z'))).toBe('2026-10-05');
  expect(fundingDay(Date.parse('2026-10-06T07:00:00Z'))).toBe('2026-10-06');
  expect(fundingDay(Date.parse('2026-11-02T08:00:00Z'))).toBe('2026-11-02');
  expect(formatFunding('240000000')).toBe('$2.4M');
  expect(formatFunding('10000000000000')).toBe('$100B');    // Hectocorn threshold reads in billions
  expect(formatFunding('100000000000000')).toBe('$1T');     // beyond Hectocorn scales to trillions, not $1000B
  expect(formatFunding('250000000000000')).toBe('$2.5T');
  // Extended ladder (PLAN-v2 decision 2): Unicorn is the 4-star milestone; Decacorn/Hectocorn are the 5-star top.
  expect(fundingRound('100000000000').id).toBe('unicorn');
  expect(fundingRound('100000000000').stars).toBe(4);
  expect(fundingRound('1000000000000').id).toBe('decacorn');
  expect(fundingRound('10000000000000').id).toBe('hectocorn');
  expect(fundingRound('10000000000000').stars).toBe(5);
});

it('builds a strictly increasing, star-capped week-long ladder through Hectocorn', () => {
  expect(FUNDING_ROUNDS.length).toBe(33); // bootstrapping + pre-seed + seed + 26 series + unicorn + pre-ipo + decacorn + hectocorn
  for (let i = 1; i < FUNDING_ROUNDS.length; i++)
    expect(BigInt(FUNDING_ROUNDS[i]!.thresholdCents)).toBeGreaterThan(BigInt(FUNDING_ROUNDS[i - 1]!.thresholdCents));
  for (const round of FUNDING_ROUNDS) { expect(round.stars).toBeGreaterThanOrEqual(0); expect(round.stars).toBeLessThanOrEqual(5); }
  expect(fundingRound('0').id).toBe('bootstrapping');
  expect(fundingRound('1500000000').id).toBe('series-a'); // $15M
  expect(fundingRound('1500000000').stars).toBe(3); // Series A unlocks the party gate
  // Series A–Z stay below the Unicorn threshold so the climb is the whole week.
  expect(BigInt(FUNDING_ROUNDS.find(r => r.id === 'series-z')!.thresholdCents)).toBeLessThan(100000000000n);
});

it('roundFloorGraceCents: a grace margin above a round threshold so a floored round survives idle burn (no-op in v2)', () => {
  // economyV3 is OFF in the test flags (the ladder here is v2), so the grace is a no-op — no v2 idle burn.
  expect(roundFloorGraceCents('seed')).toBe(0n);
  expect(roundFloorGraceCents('series-a')).toBe(0n);
  // The economy-v3 margin it WOULD add (the fix for the Seed floor landing on the exact threshold then burning
  // back to Bootstrapping within ~1 s): ROUND_FLOOR_GRACE_MIN minutes of that round's idle burn, > 0 and well
  // above a single burn tick, so the closed round sticks for the grace window.
  expect(ROUND_FLOOR_GRACE_MIN).toBeGreaterThan(0n);
  const seedV3Margin = ECON_V3_BURN_PER_MIN_CENTS['seed']! * ROUND_FLOOR_GRACE_MIN;
  expect(ECON_V3_BURN_PER_MIN_CENTS['seed']).toBeGreaterThan(0n);
  expect(seedV3Margin).toBe(10_823n * 60n); // 649,380¢ above the $75k Seed threshold
});

it('priorRoundThresholdCents gives the immediately-prior round threshold (0 for the first/unknown), per economy', () => {
  // v2 ladder: Seed's prior is Pre-seed; Series A's prior is Seed; the first round and unknown ids give 0.
  expect(priorRoundThresholdCents(FUNDING_ROUNDS_V2, 'seed')).toBe(50000000n); // Pre-seed
  expect(priorRoundThresholdCents(FUNDING_ROUNDS_V2, 'series-a')).toBe(300000000n); // Seed
  expect(priorRoundThresholdCents(FUNDING_ROUNDS_V2, 'bootstrapping')).toBe(0n); // first round -> no prior
  expect(priorRoundThresholdCents(FUNDING_ROUNDS_V2, 'not-a-round')).toBe(0n);
  // economy-v3 (prod): Seed IS the first funded round, so its prior is Bootstrapping (0 ⇒ no stage gate on Seed);
  // Series A's prior is Seed ($75k), which is the real stage gate protecting the Demo Day floor.
  expect(priorRoundThresholdCents(ECON_V3_ROUNDS, 'seed')).toBe(0n);
  expect(priorRoundThresholdCents(ECON_V3_ROUNDS, 'series-a')).toBe(7500000n);
});
