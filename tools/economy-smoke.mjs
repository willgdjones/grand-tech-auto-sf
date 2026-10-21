// Economy v3 money smoke: calibration model plus real payout constants and lazy burn.
// Run: nice -n 10 node tools/economy-smoke.mjs (no browser, server, or saved-account changes).
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { FUNDING_BASE_CENTS_V3, ECON_V3_ROUNDS, ECON_V3_BURN_PER_MIN_CENTS, applyEconomyV3Burn } =
  await tsImport('../shared/funding.ts', import.meta.url);

// 1. Simulator targets.
let out = '';
try {
  out = execFileSync(process.execPath, [new URL('./economy/simulate.mjs', import.meta.url).pathname], { encoding: 'utf8' });
} catch (e) {
  console.error('ECONOMY_SMOKE_FAIL: simulator errored\n' + ((e.stdout ?? '') + (e.stderr ?? '')).slice(0, 2000));
  process.exit(1);
}
assert.match(out, /ECONOMY SIM OK/, 'economy simulator: all star timings + burn within tolerance');
for (const star of ['Seed', 'Series A', 'Series B', 'Series C', 'Decacorn'])
  assert.ok(out.includes(star), `simulator reports the ${star} rung`);
// The five ✓ marks confirm each star target was hit by the calibration model.
assert.ok((out.match(/✓/g) ?? []).length >= 5, 'simulator hit its star-timing + idle-burn targets (✓ marks)');
console.log('economy-sim: PASS — simulator hits all star timings + burn within tolerance.');

// 2. V3 policy exports deliberately bypass the local feature switch (default-off).
// This checks the shipped amounts, not production flag deployment or a D1 account.
const seed = BigInt(ECON_V3_ROUNDS[1].thresholdCents);
for (const [kind, base] of Object.entries(FUNDING_BASE_CENTS_V3)) {
  assert.equal(typeof base, 'bigint', `${kind}: integer cents`);
  assert.ok(base >= 10_000n && base < 1_000_000n, `${kind}: base is $100–$9,999`);
  assert.ok(base * 3n < seed, `${kind}: a first solo live cheque cannot skip to Seed`);
}
assert.ok(FUNDING_BASE_CENTS_V3.investor > FUNDING_BASE_CENTS_V3.demo
  && FUNDING_BASE_CENTS_V3.demo > FUNDING_BASE_CENTS_V3.community, 'investor > demo > community');
console.log('economy-payouts: PASS — real v3 bases stay small; first solo live cheque remains below Seed.');

// 3. Exercise the actual lazy burn with an injected elapsed interval. Current founder policy is
// flat $/minute by stage, NOT the superseded exactly-one-round-per-24h calibration.
assert.deepEqual(ECON_V3_ROUNDS.map(r => r.stars), [0, 1, 2, 3, 4, 5]);
assert.equal(ECON_V3_ROUNDS.at(-1).label, 'Decacorn');
const starter = FUNDING_BASE_CENTS_V3.community;
assert.equal(applyEconomyV3Burn(starter, 86_400).currentCents, starter, 'bootstrapping has no idle burn');
for (const round of ECON_V3_ROUNDS.slice(1)) {
  const floor = BigInt(round.thresholdCents), rate = ECON_V3_BURN_PER_MIN_CENTS[round.id];
  assert.ok(rate > 0n, `${round.id}: positive flat burn`);
  const start = floor + rate * 2n;
  const minute = applyEconomyV3Burn(start, 60);
  assert.equal(minute.currentCents, start - rate, `${round.id}: one minute charges exactly its flat rate`);
  assert.equal(minute.downRounds, 0, `${round.id}: within-band burn preserves the round`);
  assert.equal(minute.burnPerMinCents, rate, `${round.id}: HUD rate matches the resulting stage`);
  const crossed = applyEconomyV3Burn(floor, 1);
  assert.equal(crossed.downRounds, 1, `${round.id}: crossing the threshold loses a round`);
  assert.ok(crossed.currentCents < floor && crossed.currentCents >= 0n);
  const previousRound = ECON_V3_ROUNDS[round.stars - 1];
  assert.equal(crossed.burnPerMinCents, ECON_V3_BURN_PER_MIN_CENTS[previousRound.id] ?? 0n,
    `${round.id}: crossing adopts the lower stage's rate`);
  let previous = start;
  for (const seconds of [0, 1, 60, 3600, 86_400, 365 * 86_400]) {
    const result = applyEconomyV3Burn(start, seconds);
    assert.ok(result.currentCents <= previous && result.currentCents >= 0n,
      `${round.id}: longer offline time never increases or makes funding negative`);
    previous = result.currentCents;
  }
}
for (const elapsed of [-60, NaN, Infinity]) {
  assert.equal(applyEconomyV3Burn(seed, elapsed).currentCents, seed, 'invalid/backward time cannot charge burn');
}
console.log('economy-burn: PASS — flat rates, down rounds, offline monotonicity and nonnegative balances.');
console.log('ECONOMY_SMOKE_PASS — calibration model, v3 payout policy and implemented burn checks passed.');
