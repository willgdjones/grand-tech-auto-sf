import { describe, expect, it, vi } from 'vitest';

// riskReward on for this file: the scaled payout needs BOTH the flag and a currentCents dep (the existing cases pass no
// dep, so they still pay the flat $750). economyV3 on so MAX_CREDIT_CENTS is the v3 single-credit ceiling ($200k).
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, riskReward: true, economyV3: true } };
});
import { MAX_CREDIT_CENTS } from '../funding/credits';
import { robberyCredit, robberyPayoutCents, STORE_ROBBERIES } from '@gtasf/shared/combat/storeRobbery';
import { runStoreRobbery, type RobberyDeps } from './robbery';

const store = STORE_ROBBERIES[0]!;
const NOW = 1_760_000_000_000;

function deps(over: Partial<RobberyDeps> = {}): RobberyDeps & { credited: ReturnType<typeof vi.fn>; award: ReturnType<typeof vi.fn> } {
  const credited = vi.fn(async () => false);
  const award = vi.fn(async () => ({ credited: true }));
  return { credited, award, ...over } as never;
}

describe('runStoreRobbery', () => {
  it('pays a server-validated robbery once, with the robbery credit ref + flat payout', async () => {
    const d = deps();
    const out = await runStoreRobbery(store, true, NOW, d);
    expect(out).toEqual({ status: 'robbed', credited: true, amountCents: robberyPayoutCents(store).toString() });
    const { source, sourceRef } = robberyCredit(store, NOW);
    expect(d.award).toHaveBeenCalledOnce();
    expect(d.award.mock.calls[0]![0]).toMatchObject({ source, sourceRef, amountCents: robberyPayoutCents(store).toString() });
  });

  it('does not pay (and does not touch the ledger) when the server says the player is not in the store', async () => {
    const d = deps();
    expect(await runStoreRobbery(store, false, NOW, d)).toEqual({ status: 'too-far' });
    expect(d.award).not.toHaveBeenCalled();
    expect(d.credited).not.toHaveBeenCalled();
  });

  it('blocks a repeat within the daily cooldown without awarding again', async () => {
    const d = deps({ credited: vi.fn(async () => true) });
    expect(await runStoreRobbery(store, true, NOW, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('reports credited:false if the ledger loses a write race (robbed, not double-counted)', async () => {
    const d = deps({ award: vi.fn(async () => ({ credited: false })) });
    expect(await runStoreRobbery(store, true, NOW, d)).toMatchObject({ status: 'robbed', credited: false });
  });
});

describe('runStoreRobbery with riskReward (critique #12)', () => {
  it('pays 1% of the robber\'s current valuation when that beats $750', async () => {
    const d = deps({ currentCents: vi.fn(async () => 8_100_000n) });
    expect(await runStoreRobbery(store, true, NOW, d)).toEqual({ status: 'robbed', credited: true, amountCents: '81000' });
    expect(d.award.mock.calls[0]![0]).toMatchObject({ amountCents: '81000' });
  });
  it('pays the $750 floor for a small or unknown valuation', async () => {
    expect(await runStoreRobbery(store, true, NOW, deps({ currentCents: vi.fn(async () => 1_000_000n) }))).toMatchObject({ amountCents: '75000' });
    expect(await runStoreRobbery(store, true, NOW, deps({ currentCents: vi.fn(async () => null) }))).toMatchObject({ amountCents: '75000' });
  });
  it('caps a rich robber at $5,000 per robbery (review RR-H1), well inside the single-credit ceiling', async () => {
    const d = deps({ currentCents: vi.fn(async () => 1_000_000_000_000n) }); // $10B → 1% = $100M
    expect(await runStoreRobbery(store, true, NOW, d)).toMatchObject({ status: 'robbed', amountCents: '500000' });
    expect(500_000n <= MAX_CREDIT_CENTS).toBe(true);
  });
  it('never reads the valuation for a cooldown repeat or an out-of-store attempt', async () => {
    const currentCents = vi.fn(async () => 8_100_000n);
    await runStoreRobbery(store, true, NOW, deps({ credited: vi.fn(async () => true), currentCents }));
    await runStoreRobbery(store, false, NOW, deps({ currentCents }));
    expect(currentCents).not.toHaveBeenCalled();
  });
});
