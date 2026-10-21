import { expect, it } from 'vitest';
import { ECON_V3_ROUNDS, FUNDING_ROUNDS_V2, FUNDING_BASE_CENTS_V3, FUNDING_ROUNDS, FUNDING_BASE_CENTS, ECON_V3_BURN_PER_MIN_CENTS, rescaleV2ToV3Cents, applyEconomyV3Burn } from './funding';

const v2Star = (cents: bigint) => [...FUNDING_ROUNDS_V2].reverse().find(r => cents >= BigInt(r.thresholdCents))!.stars;
const v3Star = (cents: bigint) => [...ECON_V3_ROUNDS].reverse().find(r => cents >= BigInt(r.thresholdCents))!.stars;

// Economy v3 (PLAN-economy-v3 decisions 1 + 3): the 5-star ladder + simulator-calibrated base payouts.
// Values come from tools/economy/simulate.mjs (solved for Seed 30m / A 2h / B 5h / C 10h / D 20h).

it('econ-v3 ladder is the 5-star Seed→Decacorn set, no Unicorn/Pre-IPO/Hectocorn/Pre-seed', () => {
  expect(ECON_V3_ROUNDS.map(r => r.id)).toEqual(['bootstrapping', 'seed', 'series-a', 'series-b', 'series-c', 'series-d']);
  expect(ECON_V3_ROUNDS.map(r => r.stars)).toEqual([0, 1, 2, 3, 4, 5]); // ★0..★5, one per rung
  // Series D is the top, shown as "Decacorn".
  expect(ECON_V3_ROUNDS.at(-1)).toMatchObject({ id: 'series-d', stars: 5, label: 'Decacorn' });
  // The removed v2 rungs are gone.
  for (const gone of ['pre-seed', 'unicorn', 'pre-ipo', 'hectocorn', 'series-e', 'decacorn'])
    expect(ECON_V3_ROUNDS.find(r => r.id === gone)).toBeUndefined();
});

it('econ-v3 thresholds match the simulator and ascend strictly', () => {
  const byId = Object.fromEntries(ECON_V3_ROUNDS.map(r => [r.id, r.thresholdCents]));
  expect(byId).toMatchObject({
    bootstrapping: '0', seed: '7500000', 'series-a': '69841638',
    'series-b': '258591292', 'series-c': '635674447', 'series-d': '1445824715',
  });
  const cents = ECON_V3_ROUNDS.map(r => BigInt(r.thresholdCents));
  for (let i = 1; i < cents.length; i++) expect(cents[i]! > cents[i - 1]!).toBe(true); // strictly monotonic
});

it('econ-v3 base payouts are the four–five-figure simulator values (far below v2)', () => {
  expect(FUNDING_BASE_CENTS_V3).toEqual({ investor: 452_100n, demo: 226_050n, community: 90_420n });
  // Community base is four-figure ($2.3k) — orders of magnitude below v2's $200k, but bigger than the
  // first Seed-$20k pass since Seed is now $75k (so reaching Seed in 30 min needs larger cheques).
  expect(FUNDING_BASE_CENTS_V3.community < 1_000_000n).toBe(true);
});

it('default (flag off) keeps the v2 ladder + large payouts unchanged — econ-v3 is inert until flipped', () => {
  // With flags.economyV3 false (the real default), the active exports are v2.
  expect(FUNDING_ROUNDS.find(r => r.id === 'hectocorn')).toBeTruthy(); // v2 top rung present
  expect(FUNDING_ROUNDS.find(r => r.id === 'pre-seed')).toBeTruthy();
  expect(FUNDING_BASE_CENTS.community).toBe(20_000_000n); // v2 $200k community base
});

// --- Rescale migration (PLAN-economy-v3 decision 7): proportional, star-preserving, order-preserving ---

it('rescaleV2ToV3Cents maps each v2 round to the matching new star — nobody jumps to max', () => {
  // One v2 total inside each star band (cents).
  const cases: [bigint, number][] = [
    [0n, 0], [100_000_000n, 1], [500_000_000n, 2], [10_000_000_000n, 3], [500_000_000_000n, 4], [5_000_000_000_000n, 5],
  ];
  for (const [v2, star] of cases) {
    expect(v2Star(v2)).toBe(star); // fixture sanity: this v2 total really is that star
    expect(v3Star(rescaleV2ToV3Cents(v2))).toBe(star); // rescaled total lands on the SAME star in v3
  }
  // A v2 non-max player (★4 Unicorn/Pre-IPO band) never becomes ★5 in v3.
  expect(v3Star(rescaleV2ToV3Cents(999_999_999_999n))).toBeLessThan(5);
});

it('rescaleV2ToV3Cents strictly preserves relative order across the whole range', () => {
  const v2Totals = [0n, 10_000_000n, 49_999_999n, 50_000_000n, 299_999_999n, 300_000_000n, 1_500_000_000n,
    50_000_000_000n, 99_999_999_999n, 100_000_000_000n, 999_999_999_999n, 1_000_000_000_000n, 9_000_000_000_000n];
  const mapped = v2Totals.map(rescaleV2ToV3Cents);
  for (let i = 1; i < mapped.length; i++) expect(mapped[i]! >= mapped[i - 1]!).toBe(true); // monotonic non-decreasing
  // Distinct totals in the SAME band keep strict order (no collapse that would scramble the leaderboard).
  expect(rescaleV2ToV3Cents(60_000_000n) > rescaleV2ToV3Cents(55_000_000n)).toBe(true);
  expect(rescaleV2ToV3Cents(0n)).toBe(0n); // bootstrapping stays at zero
});

// --- Flat per-stage burn (PLAN-economy-v3 decision 4, founder 06:3x), matching tools/economy/simulate.mjs ---

const DAY = 86_400;
const SEED = 7_500_000n, SERIES_A = 69_841_638n, SERIES_B = 258_591_292n, SERIES_C = 635_674_447n, DECACORN = 1_445_824_715n;
const BAND4 = DECACORN - SERIES_C, MID4 = SERIES_C + BAND4 / 2n;       // middle of the ★4 (Series C) band
const BAND2 = SERIES_B - SERIES_A, MID2 = SERIES_A + BAND2 / 2n;       // middle of the ★2 (Series A) band

it('★0 Bootstrapping (below the Seed threshold) never burns', () => {
  const r = applyEconomyV3Burn(5_000_000n, DAY * 100); // $50k, below Seed $75k
  expect(r).toMatchObject({ currentCents: 5_000_000n, burnPerMinCents: 0n, downRounds: 0 });
});

it('burnPerMinCents is the flat calibrated rate for the current stage (−$X/min, not a function of round size)', () => {
  expect(applyEconomyV3Burn(SEED + 1_000_000n, 0).burnPerMinCents).toBe(ECON_V3_BURN_PER_MIN_CENTS['seed']);       // ★1
  expect(applyEconomyV3Burn(SERIES_B + 1n, 0).burnPerMinCents).toBe(ECON_V3_BURN_PER_MIN_CENTS['series-b']);       // ★3
  expect(applyEconomyV3Burn(DECACORN + 1n, 0).burnPerMinCents).toBe(ECON_V3_BURN_PER_MIN_CENTS['series-d']);       // ★5
  // Rates rise with stage (gently), never a function of the (widely varying) band size.
  const rates = ['seed', 'series-a', 'series-b', 'series-c', 'series-d'].map(id => ECON_V3_BURN_PER_MIN_CENTS[id]!);
  for (let i = 1; i < rates.length; i++) expect(rates[i]! >= rates[i - 1]!).toBe(true);
});

it('idle 24h loses ≤25% of the band (gentle; mid-band keeps the round)', () => {
  const r = applyEconomyV3Burn(MID2, DAY);
  const lost = MID2 - r.currentCents;
  expect(lost <= BAND2 / 4n + BAND2 / 100n).toBe(true); // ≤ ~25% of band (+rounding headroom)
  expect(lost >= BAND2 / 5n).toBe(true);                // it IS burning (~20–25%)
  expect(v3Star(r.currentCents)).toBe(2);               // mid-band after a day → still ★2
  expect(r.downRounds).toBe(0);
});

it('down rounds need multiple idle days; Seed can drop to Bootstrapping; monotonic; zero-elapsed no-op', () => {
  expect(applyEconomyV3Burn(DECACORN, 0)).toMatchObject({ currentCents: DECACORN, downRounds: 0 }); // no-op
  // Founder 09:2x: a ★1 player idle long enough is demoted to ★0 Bootstrapping, then ★0 stops burning.
  const dropped = applyEconomyV3Burn(SEED + 5_000_000n, DAY * 50);
  expect(dropped.currentCents).toBe(SEED - 1n);
  expect(v3Star(dropped.currentCents)).toBe(0);
  expect(dropped.downRounds).toBe(1);
  expect(dropped.burnPerMinCents).toBe(0n);
  // Exactly at Seed still burns, so any idle time tips it just under Seed into ★0.
  expect(applyEconomyV3Burn(SEED, 60).currentCents).toBe(SEED - 1n);
  // A top player idle for a year walks all the way down to ★0 but never below zero.
  const year = applyEconomyV3Burn(DECACORN, DAY * 365);
  expect(v3Star(year.currentCents)).toBe(0);
  expect(year.currentCents >= 0n).toBe(true);
  // Monotonic: more idle time never raises current, never below 0.
  const d1 = applyEconomyV3Burn(MID4, DAY).currentCents, d6 = applyEconomyV3Burn(MID4, DAY * 6).currentCents;
  expect(d6 <= d1 && d6 >= 0n).toBe(true);
  // One idle day from mid-band keeps the round; several idle days drop at least one.
  expect(applyEconomyV3Burn(MID4, DAY).downRounds).toBe(0);
  expect(applyEconomyV3Burn(MID4, DAY * 6).downRounds >= 1).toBe(true);
});
