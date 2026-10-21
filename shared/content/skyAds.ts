/**
 * Flying ad content for GTASF sky ads (founder playtest feedback, bead
 * gtasf-more-billboards-sky-ads-hyvs): a blimp looping over the Bay/FiDi and banner planes along
 * the Embarcadero and over the Tech Week hotspots. All copy is original parody (no real brands).
 *
 * This module is pure data + geometry math (no three.js), so the route math is unit-testable and
 * the creatives can be reused by the sellable "plane-flyover" ad slot (shared/gtm/catalogue.ts).
 * Each craft is a presell slot: unsold it shows a parody creative; a sold creative + checkout stay
 * gated behind the paid-ads flags and pane 7's ledger, exactly like billboards.
 */

export interface SkyAdCreative {
  id: string;
  /** Big parody brand line. */
  headline: string;
  /** Small tagline under it. */
  subline: string;
  /** Banner background / text colours (SA-ish saturated panels). */
  bg: string;
  fg: string;
}

export const SKY_AD_CREATIVES: readonly SkyAdCreative[] = [
  { id: 'fog-compute', headline: 'FOG COMPUTE', subline: 'Your data, now 100% mist', bg: '#15314a', fg: '#eaf4ff' },
  { id: 'scale-the-pile', headline: 'SCALE THE PILE', subline: 'Series Z term sheets, same day', bg: '#3a1f4a', fg: '#ffe9ff' },
  { id: 'unicorn-assurance', headline: 'UNICORN ASSURANCE', subline: 'Down-round protection for founders', bg: '#4a2a12', fg: '#ffe7c7' },
  { id: 'disruptly', headline: 'DISRUPTLY', subline: 'We disrupt disruption', bg: '#123a2a', fg: '#d9ffe9' },
  { id: 'vested', headline: 'VESTED', subline: '4-year cliff, 0% chill', bg: '#3a1414', fg: '#ffdede' },
] as const;

export interface SkyAdCraftConfig {
  id: string;
  kind: 'blimp' | 'plane';
  /** Which parody creative it carries while the slot is unsold. */
  creativeId: string;
  /** Sellable slot id, billed via the 'plane-flyover' catalogue product (checkout gated). */
  slotId: string;
  /** Loop centre in WGS84 degrees; projected to world at render time. */
  center: { lat: number; lon: number };
  /** Horizontal loop radii in metres (east/x, north/z); elongate for a street fly-along. */
  radiusXM: number;
  radiusZM: number;
  /** Cruise altitude in metres above the loop centre's ground. */
  altitudeM: number;
  /** Seconds for one full loop (slow + majestic for the blimp). */
  periodSec: number;
}

/** One blimp + two banner planes. Positions are ambient and approximate by design. */
export const SKY_AD_CRAFT: readonly SkyAdCraftConfig[] = [
  { id: 'blimp-bay', kind: 'blimp', creativeId: 'fog-compute', slotId: 'sky-blimp-bay',
    center: { lat: 37.7965, lon: -122.3955 }, radiusXM: 620, radiusZM: 470, altitudeM: 230, periodSec: 120 },
  { id: 'plane-embarcadero', kind: 'plane', creativeId: 'scale-the-pile', slotId: 'sky-plane-embarcadero',
    center: { lat: 37.8005, lon: -122.3975 }, radiusXM: 230, radiusZM: 950, altitudeM: 135, periodSec: 72 },
  { id: 'plane-soma', kind: 'plane', creativeId: 'unicorn-assurance', slotId: 'sky-plane-soma',
    center: { lat: 37.7845, lon: -122.4015 }, radiusXM: 760, radiusZM: 320, altitudeM: 185, periodSec: 84 },
] as const;

export function skyAdCreative(id: string): SkyAdCreative | undefined {
  return SKY_AD_CREATIVES.find(creative => creative.id === id);
}

/** Point on a horizontal ellipse at the given phase (radians). Pure, for the per-frame flight path. */
export function ellipsePoint(cx: number, cz: number, radiusX: number, radiusZ: number, phase: number): { x: number; z: number } {
  return { x: cx + radiusX * Math.cos(phase), z: cz + radiusZ * Math.sin(phase) };
}

/** Yaw (radians) that points local +Z along the horizontal velocity (vx, vz). */
export function headingFromVelocity(vx: number, vz: number): number {
  return Math.atan2(vx, vz);
}
