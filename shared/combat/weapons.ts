/**
 * GTA V pivot — LANE B (combat & police): weapon definitions.
 *
 * Pure, shared data + helpers: the client uses it for the weapon wheel, aiming and local fire feedback;
 * the server (step 3) uses damage/range/fireRate to validate hits. Arcade values (no physics engine).
 * Gun-shop pricing (step 7) scales these base prices by the player's stage.
 */

export type WeaponId = 'fists' | 'bat' | 'pistol' | 'smg' | 'rifle';
export type WeaponKind = 'melee' | 'pistol' | 'smg' | 'rifle';

export interface WeaponSpec {
  id: WeaponId;
  /** Player-facing name. */
  name: string;
  kind: WeaponKind;
  melee: boolean;
  /** Damage per hit (health points; MAX_HEALTH is 100). */
  damage: number;
  /** Max effective range in metres (melee is an arm's reach). */
  rangeM: number;
  /** Minimum milliseconds between shots/swings. */
  fireRateMs: number;
  /** Hold-to-fire (true) vs. one shot per press (false). */
  automatic: boolean;
  /** Rounds before a reload (0 for melee). */
  magazine: number;
  /** Reload time in milliseconds (0 for melee). */
  reloadMs: number;
  /** Aim-cone half-angle in radians (0 = perfectly accurate). */
  spreadRad: number;
  /** Wheel glyph. */
  icon: string;
  /** Base gun-shop price in valuation cents, before the stage multiplier (0 = not sold / starter). */
  basePriceCents: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = Object.freeze({
  fists: { id: 'fists', name: 'Fists', kind: 'melee', melee: true, damage: 12, rangeM: 1.8, fireRateMs: 450, automatic: false, magazine: 0, reloadMs: 0, spreadRad: 0, icon: '👊', basePriceCents: 0 },
  bat: { id: 'bat', name: 'Baseball Bat', kind: 'melee', melee: true, damage: 28, rangeM: 2.2, fireRateMs: 550, automatic: false, magazine: 0, reloadMs: 0, spreadRad: 0, icon: '🏏', basePriceCents: 0 },
  pistol: { id: 'pistol', name: 'Pistol', kind: 'pistol', melee: false, damage: 22, rangeM: 60, fireRateMs: 300, automatic: false, magazine: 12, reloadMs: 1200, spreadRad: 0.012, icon: '🔫', basePriceCents: 500_000 },
  smg: { id: 'smg', name: 'SMG', kind: 'smg', melee: false, damage: 14, rangeM: 55, fireRateMs: 90, automatic: true, magazine: 30, reloadMs: 1600, spreadRad: 0.03, icon: '🧰', basePriceCents: 2_500_000 },
  rifle: { id: 'rifle', name: 'Rifle', kind: 'rifle', melee: false, damage: 34, rangeM: 120, fireRateMs: 140, automatic: true, magazine: 30, reloadMs: 2000, spreadRad: 0.02, icon: '🎯', basePriceCents: 8_000_000 },
});

/** Wheel order: melee first, then up the firepower. */
export const WEAPON_ORDER: readonly WeaponId[] = ['fists', 'bat', 'pistol', 'smg', 'rifle'];

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && value in WEAPONS;
}

export function weaponById(id: string): WeaponSpec | undefined {
  return isWeaponId(id) ? WEAPONS[id] : undefined;
}

/**
 * May this weapon fire again? `now - lastFireMs >= fireRateMs`. Used client-side for local feedback and
 * SERVER-side (step 3) to reject a client firing faster than the weapon allows. Mirrors mayhemCanFire.
 */
export function canFire(spec: WeaponSpec, lastFireMs: number, now: number): boolean {
  return now - lastFireMs >= spec.fireRateMs;
}
