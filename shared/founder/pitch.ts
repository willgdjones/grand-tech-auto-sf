/**
 * Founder-ladder phase 2 — the first pitch (docs/PLAN-founder-ladder.md step 4; founder decisions
 * 2026-10-12). A real SF VC firm partner stands on the Ferry plaza; the player pitches by voice OR, with
 * no mic (the phone-first default), by tapping one of three curated lines. The pitch runs through the
 * existing AI judge (worker/src/pitch/pitch.ts), which pays a cheque and moves the player to Pre-seed.
 *
 * Founder guardrails enforced here + at the judge:
 * - Investors are REAL VC firms; the plaza target is a real firm id from shared/content/pitchVcs.ts, so the
 *   judge persona is "a partner at <firm>" (never a named individual).
 * - The tap lines are the PLAYER'S pitch (meme startup lines); the judge roasts the pitch, never the firm.
 * - The three lines are server-known, so the tap path skips STT + moderation (curated text) and feeds the
 *   judge directly — the client only sends a line INDEX, never free text.
 *
 * Pure + serializable: client shows the lines + places the NPC, the worker resolves the index → line.
 */

/** The plaza investor is a real SF VC firm (Pear VC — a real SF pre-seed firm; persona "a partner at Pear VC").
 *  Must be a valid id in shared/content/pitchVcs.ts; a build-time takedown of that firm removes it everywhere. */
export const FOUNDER_PLAZA_VC_ID = 'pear';
export const FOUNDER_PLAZA_VC_NAME = 'Pear VC';

/** Phase 3 — the Seed round quest: the player robotaxis to this VC OFFICE and pitches the partner there
 *  (First Round Capital — apt for the first institutional round, and a short ride from the Ferry). Must be
 *  a valid id in shared/content/pitchVcs.ts (consistency asserted in tests); a build-time takedown of the
 *  firm removes the Seed quest target too. Only the plaza (Pre-seed) and this firm are card-pitchable. */
export const FOUNDER_SEED_VC_ID = 'first-round';
export const FOUNDER_SEED_VC_NAME = 'First Round Capital';

/** Phase 6 — the Series A round quest: Demo Day at a FICTIONAL hacker house (founder decision 2026-10-13; no
 *  real accelerator, so no PROVENANCE/denylist concern — the AI judge still roasts only the player's pitch).
 *  The player pitches on stage here and a credited pitch floors the valuation to the Series A round threshold
 *  (mirrors the Seed floor). kind 'vc' gives the per-SF-day cooldown; this id never collides with a real
 *  pitchVcs firm id (it is fictional). Location is a placeholder SoMa-ish spot — a map-verified walkable stage
 *  spot lands with the client/venue slice. Gated behind flags.seriesAQuest (added with the wiring). */
export const FOUNDER_SERIES_A_ID = 'demo-day-house';
export const FOUNDER_SERIES_A_NAME = 'the Demo Day House';
export const FOUNDER_SERIES_A_PERSONA = 'the MC at a San Francisco hacker-house Demo Day (a fictional accelerator)';
/** A SoMa spot on WALKABLE ground (verified 2026-10-13 via the deep-link snap: the original placeholder
 *  37.7815,-122.4045 sat on a building footprint → createGroundNpc silently hid the MC/audience; this is the
 *  nearest walkable point, world x≈274.2 z≈316.1). */
export const FOUNDER_SERIES_A_PLACE = Object.freeze({ lat: 37.781352, lon: -122.404687 });
/** Where the player approaches the Demo Day MC from (the MC faces this way). ≤8 m from PLACE and on walkable
 *  ground, so createGroundNpc stands the MC at PLACE facing here. Tuned with the venue capture. */
export const FOUNDER_SERIES_A_FACE = Object.freeze({ lat: 37.781302, lon: -122.404687 });

/** Where the plaza investor NPC stands — ~10 m NW of the Ferry spawn, on the clock-tower plaza (PLAN step 4).
 *  Within PITCH_VC_RADIUS_M (15 m) so the card-driven first pitch is in range (the earlier 37.795650,
 *  -122.393850 sat ~21 m out, so the pitch 409'd "walk up to the investor").
 *  Geodetic; snapped to walkable ground at runtime like any other placement. */
export const FOUNDER_PLAZA_ANGEL = Object.freeze({ lat: 37.795570, lon: -122.393771 });

/** guidedOpener (gtasf-dzrrn): the Pear VC partner waits a DRIVE away instead — on the city-side Embarcadero sidewalk
 *  near Mission St, ~370 m SE of the Ferry spawn, so the opener's last step is "drive to the marker". Verified on the
 *  walkable mesh 2026-10-18 with the light deep-link check (sidewalk surface y≈3.12, ~10 m off the southbound carriageway,
 *  clear of the shopfronts; the ?at= snap of the road centre next to it was 0.3 m). FACE is ~4 m toward the roadway (the partner faces arriving
 *  cars; createGroundNpc walks in from FACE toward the target, so the NPC stands within a few metres of it). */
export const FOUNDER_OPENER_ANGEL = Object.freeze({ lat: 37.792574, lon: -122.391562 });
export const FOUNDER_OPENER_FACE = Object.freeze({ lat: 37.792595, lon: -122.391525 });

/** Where the Pre-seed partner stands: the drive-away opener spot under guidedOpener, else the Ferry plaza. Pure (the
 *  caller passes its flag) so client and worker agree on one rule. */
export function founderPlazaAngel(guidedOpener: boolean): { readonly lat: number; readonly lon: number } {
  return guidedOpener ? FOUNDER_OPENER_ANGEL : FOUNDER_PLAZA_ANGEL;
}

/** openingDrive (GTA V critique #13, orchestrator 2026-10-15): a NEW player spawns in a car on the Embarcadero roadway at
 *  Howard St, facing the Ferry Building clock tower, and drives ~0.5 km to the Pear VC partner. Geodetic, on the
 *  roadway (the server spawns the car on the nearest road and only within OPENING_CAR_RADIUS_M of here). Heading in
 *  compass degrees (as SpawnRequest places use). */
export const FOUNDER_OPENING_DRIVE_START = Object.freeze({ lat: 37.79215, lon: -122.39065, heading: 324 });

/** Three curated tap-fallback pitch lines (no mic needed). Meme startup pitches — the judge roasts THESE.
 *  Server-known so they bypass STT/moderation; the client sends only the index into this list. */
export const FOUNDER_PITCH_LINES: readonly string[] = Object.freeze([
  "We're building the AI that builds the AI. It's recursive, it's inevitable, and the moat is vibes.",
  "It's Uber for everything. Our total addressable market is every human alive. We have three users and a dream.",
  "No revenue yet, but the burn rate is beautiful, the deck has a hockey stick, and we are pre-pre-seed by choice.",
]);

/** A line index is valid iff it indexes FOUNDER_PITCH_LINES. */
export function isFounderPitchLine(index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < FOUNDER_PITCH_LINES.length;
}

/** The curated pitch text for a tap-fallback index, or null when out of range (server resolves the text). */
export function founderPitchLine(index: unknown): string | null {
  return isFounderPitchLine(index) ? FOUNDER_PITCH_LINES[index]! : null;
}
