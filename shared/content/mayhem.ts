/**
 * Playful Mayhem (founder feature, behind flags.playfulMayhem). Cartoonish, NON-LETHAL party toys —
 * no guns, no weapons, no damage, no health, nobody dies. This shared module is the pure contract the
 * client controller, the renderer (decals/particles) and the sync protocol all build on.
 *
 *  - paintball: fire your startup's logo/colours as a splat decal onto players/cars/walls/billboards.
 *  - confetti:  celebratory burst (auto-fires on round close; crowd effect at events).
 *  - water:     lob a water balloon that splashes and briefly slows whoever it hits.
 */
export type MayhemItemId = 'paintball' | 'confetti' | 'water';

export interface MayhemItem {
  readonly id: MayhemItemId;
  readonly label: string;
  /** Picker slot (1-based) for the HUD and number/scroll selection. */
  readonly slot: number;
  /** Fired automatically by the game (confetti on round close), not just on the fire key. */
  readonly auto: boolean;
}

/** Stable order; the picker and wire encoding index by this array. Append, never reorder. */
export const MAYHEM_ITEMS: readonly MayhemItem[] = Object.freeze([
  { id: 'paintball', label: 'Logo paintball', slot: 1, auto: false },
  { id: 'confetti', label: 'Confetti cannon', slot: 2, auto: true },
  { id: 'water', label: 'Water balloon', slot: 3, auto: false },
] as const);

/** Min milliseconds between manual fires — anti-spam and keeps the synced events low-bandwidth. */
export const MAYHEM_FIRE_COOLDOWN_MS = 350;
/** Splat decals fade out over ~3 minutes, then are recycled. */
export const SPLAT_FADE_MS = 180_000;
/** Max live splat decals at once (phone budget); the oldest is recycled past this. */
export const MAX_SPLAT_DECALS = 64;
/** Water balloon hit: brief, cartoonish movement slow (never a knockdown). */
export const WATER_SLOW_FACTOR = 0.55; // multiply move speed by this
export const WATER_SLOW_MS = 1500;     // for 1.5 s, then back to normal

/** Index of an item id (for compact wire encoding); -1 if unknown. */
export function mayhemItemIndex(id: MayhemItemId): number {
  return MAYHEM_ITEMS.findIndex(item => item.id === id);
}
export function mayhemItemAt(index: number): MayhemItem | null {
  return MAYHEM_ITEMS[index] ?? null;
}

/** Cycle the selected item by `dir` (+1 next / -1 previous), wrapping — for scroll/next-item picking. */
export function cycleMayhemItem(current: MayhemItemId, dir: number): MayhemItemId {
  const n = MAYHEM_ITEMS.length;
  const i = Math.max(0, mayhemItemIndex(current));
  const step = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  return MAYHEM_ITEMS[((i + step) % n + n) % n]!.id;
}

/** Rate-limit gate: true if enough time has passed since the last fire (and advances nothing — pure). */
export function mayhemCanFire(lastFireMs: number, now: number): boolean {
  return !Number.isFinite(lastFireMs) || now - lastFireMs >= MAYHEM_FIRE_COOLDOWN_MS;
}

/**
 * One fired toy: produced by the client controller and the sync protocol, consumed by the renderer
 * (decals/particles). Additive contract for gtasf-mayhem-render-dd3w; kept compact for the wire.
 */
export interface MayhemFireEvent {
  readonly item: MayhemItemId;
  /** World position of the splat hit / particle burst, metres [x, y, z]. */
  readonly at: readonly [number, number, number];
  /** Firer's startup logo colour as 0xRRGGBB for the splat/confetti; renderer falls back to a per-item default. */
  readonly colour?: number;
  /** Unit surface normal [x, y, z] at a splat hit, to orient the decal; omit for mid-air bursts (confetti). */
  readonly normal?: readonly [number, number, number];
  /** Id of the player/car hit so a decal can later stick to it; omit for walls/world (v1 renders in world space). */
  readonly targetId?: string;
  /** Local-only splat size multiplier (e.g. the onboarding first shot); never sent on the wire. */
  readonly size?: number;
}

/** Per-item fallback colours (0xRRGGBB) when a fire event carries no firer colour. */
export const MAYHEM_DEFAULT_COLOUR: Readonly<Record<MayhemItemId, number>> = Object.freeze({
  paintball: 0xff2d7a, confetti: 0xffd23f, water: 0x5ab6ff,
});

/** Splash radius (metres): a received water-balloon fire landing within this of the local player
 *  slows them (gtasf-mayhem-water-slow). Small — the balloon has to land near you. */
export const WATER_SPLASH_RADIUS_M = 3;

/**
 * True when a water fire at `atMetres` (world metres [x,y,z], as the wire carries it) splashes the
 * local player at `localMetres` — planar x/z distance within `radiusM`. The receiving client calls
 * this on a water MAYHEM_FIRE and, when true, applies `MayhemController.hitByWater` to self-slow.
 * Self-applied (each client decides if its own player was hit), so no `targetId` on the wire and no
 * server hit-detection are needed. Y is ignored (a balloon slows you whether you're up- or downhill).
 */
export function mayhemWaterHit(atMetres: readonly [number, number, number], localMetres: { readonly x: number; readonly z: number }, radiusM = WATER_SPLASH_RADIUS_M): boolean {
  const dx = atMetres[0] - localMetres.x, dz = atMetres[2] - localMetres.z;
  return dx * dx + dz * dz <= radiusM * radiusM;
}
