/**
 * Roaming angel investors (living map item 8, flags.angelNpcs + flags.pitching, gtasf-y5vc). Fictional parody angels
 * (no real people) who stand outside SF tech places and move on every 20 minutes. Where each angel stands is a pure
 * function of time, so every client draws the same angels in the same spots and the server checks pitch reach with
 * the same function: no protocol or server state. Stops are sidewalk spots from shared/content/angelStops.ts.
 */
import { ANGEL_STOPS } from './angelStops';

export interface RoamingAngel { id: string; name: string; outfit: number; line: string }
export const ROAMING_ANGELS: readonly RoamingAngel[] = [
  { id: 'angel-seraphina-seed', name: 'Seraphina Seed', outfit: 1, line: 'I only invest in founders who pitch to strangers on the street.' },
  { id: 'angel-gabriel-termsheet', name: 'Gabriel Termsheet', outfit: 2, line: 'Heavenly terms. Hellish pro-rata.' },
  { id: 'angel-halo-hannah', name: 'Halo Hannah', outfit: 3, line: 'Two exits, one podcast, zero chill.' },
  { id: 'angel-preseed-pete', name: 'Pre-Seed Pete', outfit: 0, line: 'I write cheques before you have a name.' },
  { id: 'angel-ursula-uptick', name: 'Ursula Uptick', outfit: 1, line: 'Show me the graph. Up and to the right, please.' },
  { id: 'angel-cupid-capital', name: 'Cupid Capital', outfit: 2, line: 'I match founders with money. It is basically love.' },
  { id: 'angel-angela-allocation', name: 'Angela Allocation', outfit: 3, line: 'I have a little allocation left. Very little.' },
  { id: 'angel-rocky-safe', name: 'Rocky SAFE', outfit: 0, line: 'Post-money, pre-coffee. Talk fast.' },
];
export const ANGEL_SLOT_MS = 20 * 60_000;

/** Deterministic shuffle of stop indices for one time slot (mulberry32 seeded by the slot). */
function slotOrder(slot: number, count: number): number[] {
  let seed = (slot * 2654435761) >>> 0;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}
export interface AngelSpot { angel: RoamingAngel; stop: { placeId: string; name: string; x: number; z: number }; slot: number }
/** Where every roaming angel stands at `now` (ms): each at a different stop, reshuffled every 20 minutes. */
export function angelSpots(now: number, stops = ANGEL_STOPS, angels = ROAMING_ANGELS): AngelSpot[] {
  if (!stops.length || !Number.isFinite(now)) return [];
  const slot = Math.floor(now / ANGEL_SLOT_MS), order = slotOrder(slot, stops.length);
  return angels.slice(0, stops.length).map((angel, i) => ({ angel, stop: stops[order[i]!]!, slot }));
}
