import { describe, expect, it, vi } from 'vitest';
vi.mock('../flags', () => ({ flags: { economyV3: false } }));
import { FUNDING_ROUNDS } from '../funding';
import {
  FOUNDER_ARCHETYPES, LOOK_TIERS, type Appearance,
  decodeAppearance, defaultAppearance, encodeAppearance, nameplateTitle,
  resolveLook, tierForRound, tierUnlocked, unlockRoundLabel,
} from './cosmetics';

const roundId = (id: string) => ({ id });
const sample: Appearance = { sex: 'female', archetype: 'serial', outfit: 5, hair: 2, hairColor: 7, accessory: 3, car: 6, stageRound: 12 };

describe('cosmetics catalog', () => {
  it('has 12 archetypes with unique ids and a stable order', () => {
    expect(FOUNDER_ARCHETYPES).toHaveLength(12);
    expect(new Set(FOUNDER_ARCHETYPES.map(a => a.id)).size).toBe(12);
    expect(FOUNDER_ARCHETYPES[0]!.id).toBe('hacker'); // order is the encoding contract
  });
  it('has six look tiers rising with the funding ladder', () => {
    expect(LOOK_TIERS.map(t => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(LOOK_TIERS[0]!.car).toBe('scooter');
    expect(LOOK_TIERS[5]!.flyover).toBe('jet');
  });
});

describe('tierForRound', () => {
  it('maps each stage band to the right tier', () => {
    expect(tierForRound(roundId('bootstrapping')).index).toBe(0);
    expect(tierForRound(roundId('pre-seed')).index).toBe(1);
    expect(tierForRound(roundId('seed')).index).toBe(1);
    expect(tierForRound(roundId('series-a')).index).toBe(2);
    expect(tierForRound(roundId('series-c')).index).toBe(2);
    expect(tierForRound(roundId('series-d')).index).toBe(3);
    expect(tierForRound(roundId('series-z')).index).toBe(3);
    expect(tierForRound(roundId('unicorn')).index).toBe(4);
    expect(tierForRound(roundId('pre-ipo')).index).toBe(4);
    expect(tierForRound(roundId('decacorn')).index).toBe(5);
    expect(tierForRound(roundId('hectocorn')).index).toBe(5);
  });
  it('is monotonic across the whole ladder', () => {
    let last = -1;
    for (const round of FUNDING_ROUNDS) {
      const idx = tierForRound(round).index;
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe('tier unlock gating', () => {
  it('locks higher tiers until the round reaches them', () => {
    expect(tierUnlocked(0, roundId('bootstrapping'))).toBe(true);
    expect(tierUnlocked(2, roundId('seed'))).toBe(false);
    expect(tierUnlocked(2, roundId('series-a'))).toBe(true);
    expect(tierUnlocked(5, roundId('unicorn'))).toBe(false);
    expect(tierUnlocked(5, roundId('decacorn'))).toBe(true);
  });
  it('reports the required stage label for a locked tier', () => {
    expect(unlockRoundLabel(2)).toBe('Series A');
    expect(unlockRoundLabel(5)).toBe('Decacorn');
  });
});

describe('appearance id encode/decode', () => {
  it('round-trips every field', () => {
    expect(decodeAppearance(encodeAppearance(sample))).toEqual(sample);
  });
  it('round-trips the default and both sexes / all archetypes', () => {
    for (const sex of ['male', 'female'] as const) {
      for (const a of FOUNDER_ARCHETYPES) {
        const appearance = { ...defaultAppearance(sex, a.id), outfit: 7, stageRound: 32 };
        expect(decodeAppearance(encodeAppearance(appearance))).toEqual(appearance);
      }
    }
  });
  it('packs into an unsigned 26-bit int', () => {
    const id = encodeAppearance({ ...sample, stageRound: 63, outfit: 7, hair: 7, hairColor: 7, accessory: 7, car: 7 });
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThan(2 ** 26);
  });
  it('clamps out-of-range variants rather than corrupting neighbours', () => {
    const decoded = decodeAppearance(encodeAppearance({ ...sample, outfit: 99, car: -3, stageRound: 999 }));
    expect(decoded.outfit).toBeGreaterThanOrEqual(0);
    expect(decoded.outfit).toBeLessThan(8);
    expect(decoded.car).toBeGreaterThanOrEqual(0);
    expect(decoded.car).toBeLessThan(8);
    expect(decoded.stageRound).toBeLessThan(64);
    expect(decoded.archetype).toBe(sample.archetype); // neighbours intact
  });
});

describe('resolveLook + nameplate', () => {
  it('layers the stage tier onto the chosen archetype/variants', () => {
    const look = resolveLook(sample, roundId('series-e'));
    expect(look.sex).toBe('female');
    expect(look.title).toBe('Serial Founder');
    expect(look.prop).toBe('coffee');
    expect(look.tier.index).toBe(3);        // Series D–Z
    expect(look.car).toBe('sports');
    expect(look.carVariant).toBe(6);        // the player's chosen variant survives
    expect(look.outfitVariant).toBe(5);
  });
  it('falls back to the encoded stageRound when no round is passed', () => {
    const look = resolveLook({ ...sample, stageRound: FUNDING_ROUNDS.findIndex(r => r.id === 'unicorn') });
    expect(look.tier.index).toBe(4);
    expect(look.companion).toBe('assistant');
  });
  it('formats the nameplate flavour line', () => {
    expect(nameplateTitle({ archetype: 'hacker' }, { label: 'Series B' })).toBe('Hacker · Series B');
  });
});
