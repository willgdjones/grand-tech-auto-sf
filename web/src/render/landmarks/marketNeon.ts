import type { Group } from 'three';
import { AMBER, BLUE, GREEN, PINK, RED, VIOLET, WHITE, createNeonStrip, neonStripSteps, type Blade, type Fascia, type NeonStrip } from './broadwayNeon';
import type { BuilderOptions } from './primitives';
import { graphicsPreset } from '../graphicsPreset';
import type { LandmarkDefinition } from './landmarks';

/**
 * marketNeon (GTA V gap critique #15, lane D): mid-Market between 5th and 7th is SF's old theatre row (marquees and
 * blade signs on both sides), but at night it read as a dark wide street. Same build as broadwayNeon (stacked-letter
 * blades + flush fascias in one UNLIT mesh, lit backing boxes) via createNeonStrip.
 * Frame: anchored on the OSM Market Street centreline at the 6th St / Taylor / Golden Gate node, local +x along Market
 * toward the Ferry (44.35 deg north of east, OSM 5th -> 7th nodes). Market is 120 ft (36.6 m) building to building, so the
 * nominal facades are z = -18.3 / +18.3 m, but the drawn building line wanders (in-game ray probe from the centreline,
 * 10 m steps: north-west 14.3-19.8 m, south-east 15.3-21 m), so every sign carries its own measured `wall` (nearest hit
 * within +-10 m, so none sits inside a building). Cross streets from OSM (s along Market):
 * 7th -277, Jones/McAllister -190 (north side), 6th/Taylor/Golden Gate 0, Mason/Turk +170 (north side), 5th +283;
 * every sign keeps >= 20 m clear of them. Car-free Market (motor_vehicle=no) is drawn but not in the drive/walk graph, so
 * a deep link there snaps 50-70 m off it; it is seen from the 6th St / Taylor crossing and the cross streets. Generic words
 * only, no real business names.
 */
export const MARKET_NEON: LandmarkDefinition = {
  id: 'market-neon', name: 'Market Street neon', lat: 37.782207, lon: -122.410356, heightM: 11, heightEstimated: true,
  fallbackBaseM: 8, base: 'terrain', rotationYDeg: 44.35,
  source: 'https://www.openstreetmap.org/way/403880755', heightSource: 'authored set dressing',
};

// s = metres along Market from the 6th St node toward the Ferry; side 1 = north-west facade, -1 = south-east.
const BLADES: Blade[] = [
  { s: -235, side: 1, word: 'HOTEL', colour: RED, border: WHITE, wall: -14.4 },
  { s: -120, side: 1, word: 'THEATRE', colour: AMBER, border: RED, wall: -15.9 },
  { s: -40, side: 1, word: 'CINEMA', colour: BLUE, border: PINK, wall: -15.1 },
  { s: 45, side: 1, word: 'THEATRE', colour: WHITE, border: RED, wall: -17.0 },
  { s: 110, side: 1, word: 'LIVE', colour: PINK, border: BLUE, wall: -18.5 },
  { s: 225, side: 1, word: 'DINER', colour: GREEN, border: AMBER, wall: -19.7 },
  { s: -230, side: -1, word: 'BAR', colour: PINK, border: AMBER, wall: 19.2 },
  { s: -150, side: -1, word: 'TICKETS', colour: AMBER, border: BLUE, wall: 19.7 },
  { s: -80, side: -1, word: 'PAWN', colour: GREEN, border: WHITE, wall: 19.5 },
  { s: 60, side: -1, word: 'CAFE', colour: VIOLET, border: AMBER, wall: 18.0 },
  { s: 130, side: -1, word: 'GRILL', colour: RED, border: WHITE, wall: 16.8 },
  { s: 220, side: -1, word: 'CLUB', colour: BLUE, border: VIOLET, wall: 16.3 },
];
const FASCIAS: Fascia[] = [
  { s: 80, side: 1, word: 'SHOWS TONIGHT', colour: AMBER, border: RED, wall: -18.0 },
  { s: -110, side: -1, word: 'DELI', colour: GREEN, border: WHITE, wall: 19.5 },
  { s: 180, side: -1, word: 'MUSIC', colour: PINK, border: BLUE, wall: 16.3 },
];

// Low (phones): a sign is a few pixels beyond ~120 m, so the strip draws as ~100 m runs that each empty past 120 m (critic
// 17:5x: in-view cost -1.5..-3.5 fps vs Broadway's ~1). HD keeps the whole strip as two merged meshes.
const marketStrip = (): NeonStrip => ({ name: 'Market Street neon', north: -18.3, south: 18.3, anchorS: 0, blades: BLADES, fascias: FASCIAS,
  cull: graphicsPreset() === 'low' ? { clusterM: 100, distanceM: 120 } : undefined });

export function createMarketNeon(_options: BuilderOptions = {}): Group {
  return createNeonStrip(marketStrip());
}

/** Frame-paceable build of the same strip (marketNeonLazy): step it a few ms per frame, then place + mount the result. */
export function marketNeonSteps(): Generator<void, Group> {
  return neonStripSteps(marketStrip());
}
