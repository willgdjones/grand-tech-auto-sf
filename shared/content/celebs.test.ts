import { describe, expect, it, vi } from 'vitest';
import { ECON_V3_ROUNDS } from '../funding';
import {
  CELEB_APPEARANCE, CELEB_NPCS, CELEB_PARODY_SUFFIX, CELEB_RADIO_RUMOURS, CELEB_RUMOURS,
  CELEB_TIER_CHEQUE_CENTS, celebAppearance, celebById, celebChequeCents, celebLabel, celebRumourFor,
  type CelebTier,
} from './celebs';

const TIERS: readonly CelebTier[] = ['angel', 'notable', 'legend', 'mega'];

describe('cheque amounts (review M4: bigint integer cents)', () => {
  it('selects capped, ascending v3 payouts and preserves v2 cheques when the economy flag is off', async () => {
    const seed = BigInt(ECON_V3_ROUNDS.find(round => round.id === 'seed')!.thresholdCents);
    try {
      for (const economyV3 of [false, true]) {
        vi.resetModules();
        vi.doMock('../flags', () => ({ flags: { economyV3 } }));
        const content = await import('./celebs');
        const expected = economyV3
          ? [2_162_900n, 2_250_000n, 2_375_000n, 2_500_000n]
          : [50_000_000n, 200_000_000n, 600_000_000n, 4_000_000_000n];
        expect(TIERS.map(tier => content.CELEB_TIER_CHEQUE_CENTS[tier])).toEqual(expected);
        for (const npc of content.CELEB_NPCS) {
          const cheque = content.celebChequeCents(npc.id);
          expect(cheque).toBe(expected[TIERS.indexOf(npc.tier)]);
          if (economyV3) expect(cheque * 3n).toBeLessThanOrEqual(seed);
        }
        expect(content.celebChequeCents('not-a-real-id')).toBe(0n);
      }
    } finally {
      vi.doUnmock('../flags');
      vi.resetModules();
    }
  });
  it('every tier is a positive bigint, ascending by rarity', () => {
    for (const tier of TIERS) expect(typeof CELEB_TIER_CHEQUE_CENTS[tier]).toBe('bigint');
    expect(CELEB_TIER_CHEQUE_CENTS.angel).toBeGreaterThan(0n);
    expect(CELEB_TIER_CHEQUE_CENTS.angel).toBeLessThan(CELEB_TIER_CHEQUE_CENTS.notable);
    expect(CELEB_TIER_CHEQUE_CENTS.notable).toBeLessThan(CELEB_TIER_CHEQUE_CENTS.legend);
    expect(CELEB_TIER_CHEQUE_CENTS.legend).toBeLessThan(CELEB_TIER_CHEQUE_CENTS.mega);
  });
  it('celebChequeCents returns the tier amount as bigint, 0n for unknown', () => {
    const ron = celebById('ron-conway')!;
    expect(celebChequeCents('ron-conway')).toBe(CELEB_TIER_CHEQUE_CENTS[ron.tier]);
    expect(typeof celebChequeCents('ron-conway')).toBe('bigint');
    expect(celebChequeCents('not-a-real-id')).toBe(0n);
  });
});

describe('celebById + celebLabel', () => {
  it('resolves known ids and rejects unknown', () => {
    expect(celebById('naval-ravikant')?.name).toBe('Naval Ravikant');
    expect(celebById('nope')).toBeUndefined();
  });
  it('always tags the display label as parody', () => {
    const npc = celebById('elon')!;
    expect(celebLabel(npc)).toBe(`Elon ${CELEB_PARODY_SUFFIX}`);
    for (const npc2 of CELEB_NPCS) expect(celebLabel(npc2).endsWith(CELEB_PARODY_SUFFIX)).toBe(true);
  });
});

describe('roster integrity', () => {
  it('has unique ids', () => {
    const ids = CELEB_NPCS.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every NPC is well-formed and sits inside the SF map bounds (L12 guard)', () => {
    for (const npc of CELEB_NPCS) {
      expect(npc.name.length).toBeGreaterThan(0);
      expect(npc.neighbourhood.length).toBeGreaterThan(0);
      expect(npc.line.length).toBeGreaterThan(0);
      expect(TIERS).toContain(npc.tier);
      expect(Number.isInteger(npc.outfit)).toBe(true);
      expect(npc.outfit).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(npc.headingDeg)).toBe(true);
      const [lat, lon] = npc.spot;
      expect(lat).toBeGreaterThan(37.74);
      expect(lat).toBeLessThan(37.82);
      expect(lon).toBeGreaterThan(-122.44);
      expect(lon).toBeLessThan(-122.38);
    }
  });
});

describe('rumour hints', () => {
  it('fills the {where} slot and rotates deterministically', () => {
    expect(celebRumourFor('Jackson Square', 0)).toBe(CELEB_RUMOURS[0]!.replace('{where}', 'Jackson Square'));
    expect(celebRumourFor('SoMa', CELEB_RUMOURS.length)).toBe(celebRumourFor('SoMa', 0));
    expect(celebRumourFor('SoMa', -1)).toBe(celebRumourFor('SoMa', CELEB_RUMOURS.length - 1));
    expect(celebRumourFor('Nob Hill', 0)).not.toContain('{where}');
  });
  it('ships non-empty ambient radio rumours', () => {
    expect(CELEB_RADIO_RUMOURS.length).toBeGreaterThan(0);
    for (const line of CELEB_RADIO_RUMOURS) expect(line.trim().length).toBeGreaterThan(0);
  });
});

describe('loose-resemblance appearance (cc13)', () => {
  it('gives every roster NPC an appearance with a non-empty prop', () => {
    for (const npc of CELEB_NPCS) {
      const look = celebAppearance(npc.id);
      expect(look, `missing appearance for ${npc.id}`).toBeDefined();
      expect(look!.prop.trim().length).toBeGreaterThan(0);
    }
  });
  it('has no appearance rows for ids outside the roster', () => {
    const ids = new Set<string>(CELEB_NPCS.map(n => n.id));
    for (const id of Object.keys(CELEB_APPEARANCE)) expect(ids.has(id)).toBe(true);
    expect(celebAppearance('not-a-real-id')).toBeUndefined();
  });
});
