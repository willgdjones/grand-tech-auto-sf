/**
 * GTASF "SF Pilgrimage" (docs/PLAN-gta-pivot.md LANE C task 6 — exploration collectibles with valuation rewards).
 * A curated set of iconic SF landmarks. Reaching one (server-checked against the AUTHORITATIVE pose, after real
 * travel — see worker/src/founder/pilgrimage.ts) pays a small ONCE-EVER valuation credit; collecting every site
 * pays a once-ever completion bonus. The in-game phone lists them with GPS routing.
 *
 * Separate from place stamps (flags.placeStamps): those are the cosmetic, client-proximity tech-company stamps;
 * these are landmarks with a reviewed money path. Pure + serializable so client and worker share one roster.
 * Flag-gated behind `pilgrimage`.
 */
import { FUNDING_BASE_CENTS, type FundingSource } from '@gtasf/shared/funding';

export interface PilgrimageSite {
  readonly id: string;
  readonly name: string;
  /** Phone line: why a founder makes the trip. Fictional parody voice; never quotes a real person. */
  readonly blurb: string;
  readonly lat: number;
  readonly lon: number;
}

/** Arrival radius (m). Generous: landmarks are big and the walkable snap can sit tens of metres off the coord. */
export const PILGRIMAGE_RADIUS_M = 40;
/** Anti-teleport: a site only pays once the player has been at least this far from it since this session joined
 *  or last teleported (deep link, robotaxi jump, respawn, road recovery), so they must walk or drive in rather
 *  than spawn on top of it. Dropped on a site? Walk out past this and come back. */
export const PILGRIMAGE_MIN_TRAVEL_M = 150;

/** Each coord is the nearest road lane to the landmark (where a deep link or the GPS route lands), measured on the
 *  live road graph 2026-10-14. None within ~700 m of the Ferry spawn, so a fresh player's first move already counts
 *  as approaching them all. */
export const PILGRIMAGE_SITES: readonly PilgrimageSite[] = Object.freeze([
  { id: 'coit-tower', name: 'Coit Tower', blurb: 'Vertical integration, literally. The view is the pitch.', lat: 37.802488, lon: -122.405617 },
  { id: 'transamerica', name: 'Transamerica Pyramid', blurb: 'The original pointy-roofed growth chart.', lat: 37.795152, lon: -122.403196 },
  { id: 'pier-39', name: 'Pier 39', blurb: 'The sea lions have better engagement than your app.', lat: 37.808362, lon: -122.409856 },
  { id: 'lombard', name: 'Lombard Street', blurb: 'Eight hairpins. Still straighter than your cap table.', lat: 37.802100, lon: -122.418799 },
  { id: 'palace-fine-arts', name: 'Palace of Fine Arts', blurb: 'Where every wedding photographer pivots to drone.', lat: 37.802710, lon: -122.449580 },
  { id: 'painted-ladies', name: 'Painted Ladies', blurb: 'Seven Victorians, zero product-market fit, infinite postcards.', lat: 37.776155, lon: -122.432949 },
  { id: 'haight-ashbury', name: 'Haight-Ashbury', blurb: 'The first decentralised community. No token required.', lat: 37.769899, lon: -122.446910 },
  { id: 'twin-peaks', name: 'Twin Peaks', blurb: 'See the whole TAM from one lookout.', lat: 37.754553, lon: -122.447256 },
  { id: 'castro-theatre', name: 'Castro Theatre', blurb: 'A marquee that has outlasted every pivot below it.', lat: 37.761859, lon: -122.434570 },
  { id: 'dolores-park', name: 'Dolores Park', blurb: 'Half the seed rounds in SF closed on this lawn.', lat: 37.759654, lon: -122.426013 },
  { id: 'city-hall', name: 'City Hall', blurb: 'File your permits. The dome is bigger than the Capitol’s.', lat: 37.779218, lon: -122.419947 },
  { id: 'oracle-park', name: 'Oracle Park', blurb: 'Splash hits, garlic fries, enterprise licensing.', lat: 37.779125, lon: -122.390245 },
]);

export function pilgrimageSiteById(id: string): PilgrimageSite | undefined {
  return PILGRIMAGE_SITES.find(site => site.id === id);
}

/** Per-site cheque (cents): half a demo-day base, so it scales with the active economy (~$1.1k in v3). */
export function pilgrimageSiteCents(): bigint { return FUNDING_BASE_CENTS.demo / 2n; }
/** Completion bonus (cents) once every site is collected: two demo-day bases (~$4.5k in v3). */
export function pilgrimageBonusCents(): bigint { return FUNDING_BASE_CENTS.demo * 2n; }

/** Funding source + ONCE-EVER ref for a site (no day component). Source 'celebrity' (the quest source, as
 *  missions/meme quests); the `pilgrimage:` namespace never collides with a mission/meme/drive/share ref. */
export function pilgrimageCredit(siteId: string): { source: FundingSource; sourceRef: string } {
  return { source: 'celebrity', sourceRef: `pilgrimage:${siteId}` };
}
export const PILGRIMAGE_BONUS_REF = 'pilgrimage-complete';
export function pilgrimageBonusCredit(): { source: FundingSource; sourceRef: string } {
  return { source: 'celebrity', sourceRef: PILGRIMAGE_BONUS_REF };
}
