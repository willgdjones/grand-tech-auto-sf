import { describe, expect, it } from 'vitest';
import { WEAPONS } from './weapons';
import { gunPriceCents, isForSale, shopWeapons } from './gunShop';

describe('gunPriceCents', () => {
  it('scales the base price with stage (×(stars+1))', () => {
    const base = BigInt(WEAPONS.pistol.basePriceCents); // 500,000
    expect(gunPriceCents('pistol', 0)).toBe(base); // bootstrapping
    expect(gunPriceCents('pistol', 1)).toBe(base * 2n);
    expect(gunPriceCents('pistol', 5)).toBe(base * 6n); // decacorn
  });

  it('clamps the stage to 0..5 and handles non-finite', () => {
    expect(gunPriceCents('rifle', -3)).toBe(BigInt(WEAPONS.rifle.basePriceCents));
    expect(gunPriceCents('rifle', 99)).toBe(BigInt(WEAPONS.rifle.basePriceCents) * 6n);
    expect(gunPriceCents('rifle', NaN)).toBe(BigInt(WEAPONS.rifle.basePriceCents));
  });

  it('never sells melee / starter weapons', () => {
    expect(gunPriceCents('fists', 3)).toBe(0n);
    expect(gunPriceCents('bat', 3)).toBe(0n);
    expect(isForSale('fists')).toBe(false);
    expect(isForSale('pistol')).toBe(true);
  });
});

describe('shopWeapons', () => {
  it('lists only the sold weapons', () => {
    expect(shopWeapons()).toEqual(['pistol', 'smg', 'rifle']);
  });
});

describe('armour counter (stores only)', () => {
  it('is within ARMOUR_COUNTER_RADIUS_M of a store, not elsewhere', async () => {
    const { atArmourCounter, ARMOUR_COUNTER_RADIUS_M } = await import('./gunShop');
    const { STORE_ROBBERIES } = await import('./storeRobbery');
    const flat = (lat: number, lon: number) => ({ x: lon * 100_000, z: -lat * 100_000 });
    const s = flat(STORE_ROBBERIES[0]!.lat, STORE_ROBBERIES[0]!.lon);
    expect(atArmourCounter(s.x + ARMOUR_COUNTER_RADIUS_M - 1, s.z, flat)).toBe(true);
    expect(atArmourCounter(s.x + ARMOUR_COUNTER_RADIUS_M + 50, s.z + 500, flat)).toBe(false);
  });
});

describe('shop price cap (≤10% of current valuation)', () => {
  it('caps at 10%, keeps the stage price below that, floors at $500', async () => {
    const { cappedShopPrice } = await import('./gunShop');
    expect(cappedShopPrice(16_000_000n, 10_000_000n)).toBe(1_000_000n); // $160k rifle, $100k founder → $10k
    expect(cappedShopPrice(500_000n, 100_000_000n)).toBe(500_000n);      // stage price under the cap stays
    expect(cappedShopPrice(1_000_000n, 0n)).toBe(50_000n);              // broke: the $500 floor, not free
    expect(cappedShopPrice(30_000n, 0n)).toBe(30_000n);                 // a sub-floor stage price is untouched
    expect(cappedShopPrice(0n, 10_000_000n)).toBe(0n);                  // not-for-sale/free stays free
  });
});
