import { describe, expect, it } from 'vitest';
import { canFire, WEAPON_ORDER, WEAPONS, weaponById, isWeaponId } from './weapons';

describe('weapon data', () => {
  it('every ordered id resolves to a spec with sane fields', () => {
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      expect(w.id).toBe(id);
      expect(w.damage).toBeGreaterThan(0);
      expect(w.rangeM).toBeGreaterThan(0);
      expect(w.fireRateMs).toBeGreaterThan(0);
      expect(w.melee ? w.magazine === 0 : w.magazine > 0).toBe(true);
      expect(w.basePriceCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('weaponById / isWeaponId guard unknown ids', () => {
    expect(weaponById('pistol')?.name).toBe('Pistol');
    expect(weaponById('bazooka')).toBeUndefined();
    expect(isWeaponId('smg')).toBe(true);
    expect(isWeaponId('nope')).toBe(false);
  });
});

describe('canFire (fire-rate gate — server-authoritative in step 3)', () => {
  it('blocks a shot inside the weapon cooldown and allows it after', () => {
    const smg = WEAPONS.smg; // 90 ms
    expect(canFire(smg, 1000, 1000)).toBe(false);
    expect(canFire(smg, 1000, 1089)).toBe(false);
    expect(canFire(smg, 1000, 1090)).toBe(true);
    expect(canFire(smg, 1000, 2000)).toBe(true);
  });

  it('a slower weapon enforces a longer gap', () => {
    const pistol = WEAPONS.pistol; // 300 ms
    expect(canFire(pistol, 0, 299)).toBe(false);
    expect(canFire(pistol, 0, 300)).toBe(true);
  });
});
