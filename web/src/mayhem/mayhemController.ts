import {
  type MayhemFireEvent, type MayhemItemId, MAYHEM_DEFAULT_COLOUR, WATER_SLOW_FACTOR, WATER_SLOW_MS,
  cycleMayhemItem, mayhemCanFire, mayhemItemAt, mayhemItemIndex, mayhemWaterHit,
} from '@gtasf/shared/content/mayhem';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';

type MayhemCommand = Extract<C2SMessage, { type: 'MAYHEM_FIRE' }>;
type MayhemBroadcast = Extract<S2CMessage, { type: 'MAYHEM_FIRE' }>;

/**
 * Local Playful Mayhem control (gtasf-playful-mayhem): tracks the selected toy, rate-limits firing, and
 * turns a fire into a MayhemFireEvent (to sync to peers + render locally). Decoupled from three.js — the
 * aim raycast and the firer's colour are injected — so it is fully unit-testable and the render/scene
 * wiring lives in main.ts. Non-lethal: produces splat/confetti/splash events only, never any damage.
 */
export interface MayhemHit {
  /** World hit point (metres). */
  readonly at: [number, number, number];
  /** Surface normal at the hit (omit for a mid-air burst). */
  readonly normal?: [number, number, number];
  /** Player/car id the ray hit (omit for walls/world). */
  readonly targetId?: string;
}
/** Aim from the camera forward into the scene; null when nothing is in range. */
export type MayhemRaycast = () => MayhemHit | null;

export interface MayhemController {
  readonly selected: MayhemItemId;
  select(id: MayhemItemId): void;
  cycle(dir: number): void;
  /** Fire the selected toy now: returns the event to sync + render, or null if rate-limited or no hit. */
  fire(now: number): MayhemFireEvent | null;
  /** Convert a validated peer broadcast into an effect and apply a nearby water hit locally. */
  receive(message: MayhemBroadcast, player: { x: number; z: number }, now: number): MayhemFireEvent | null;
  /** A water balloon hit the local player: briefly slow them (never a knockdown). */
  hitByWater(now: number): void;
  /** Movement speed multiplier to feed OnFootInput.speedScale; <1 while a water slow is active, else 1. */
  speedScale(now: number): number;
}

export function createMayhemController(opts: {
  raycast: MayhemRaycast;
  colour?: () => number | undefined;
  /** Existing world transport; called only for a successful, rate-limited local fire. */
  send?: (message: MayhemCommand) => void;
}): MayhemController {
  let selected: MayhemItemId = 'paintball';
  let lastFire = Number.NEGATIVE_INFINITY;
  let slowedUntil = Number.NEGATIVE_INFINITY;
  return {
    get selected() { return selected; },
    select(id) { selected = id; },
    cycle(dir) { selected = cycleMayhemItem(selected, dir); },
    fire(now) {
      if (!mayhemCanFire(lastFire, now)) return null; // rate-limited (anti-spam + low bandwidth)
      const hit = opts.raycast();
      if (!hit) return null;
      lastFire = now;
      const event = { item: selected, at: hit.at, colour: opts.colour?.(), normal: hit.normal, targetId: hit.targetId };
      opts.send?.({ type: 'MAYHEM_FIRE', item: mayhemItemIndex(event.item), at: [...event.at],
        colour: event.colour ?? MAYHEM_DEFAULT_COLOUR[event.item], normal: event.normal ? [...event.normal] : null });
      return event;
    },
    receive(message, player, now) {
      const item = mayhemItemAt(message.item);
      if (!item) return null;
      if (item.id === 'water' && mayhemWaterHit(message.at, player)) slowedUntil = now + WATER_SLOW_MS;
      return { item: item.id, at: message.at, colour: message.colour, normal: message.normal ?? undefined };
    },
    hitByWater(now) { slowedUntil = now + WATER_SLOW_MS; },
    speedScale(now) { return now < slowedUntil ? WATER_SLOW_FACTOR : 1; },
  };
}
