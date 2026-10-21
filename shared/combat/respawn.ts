/**
 * WASTED / BUSTED respawn point (critic N20, flag nearestHospitalRespawn). GTA V sends a downed player to the nearest
 * hospital; GTASF always used SF General, so a first wanted death near the Ferry Building start dropped a new player
 * 4.7 km away with no car. Pick the nearest of a few real SF hospitals to where the player went down instead.
 * Shared so the server's authoritative respawn (WorldDO.respawnAt) and the client's local fallback agree.
 */
import { SF_GENERAL_RESPAWN } from './economy';

export interface RespawnHospital { readonly id: string; readonly name: string; readonly lat: number; readonly lon: number; readonly heading: number }

/** SF General first: it stays the default. heading = the wake view, facing each hospital's arrival dressing (SF General:
 *  sfGeneralArrival; the other three: lane D's hospitalEntrances, headings measured from its frames, ffeeb81b). */
export const RESPAWN_HOSPITALS: readonly RespawnHospital[] = [
  { id: 'sf-general', name: 'SF General', ...SF_GENERAL_RESPAWN },
  { id: 'saint-francis', name: 'Saint Francis Memorial', lat: 37.7896, lon: -122.4166, heading: 30 }, // Hyde & Bush: downtown, Nob Hill
  { id: 'ucsf-mission-bay', name: 'UCSF Mission Bay', lat: 37.7666, lon: -122.3906, heading: 30 },     // 4th St: SoMa, Dogpatch, ballpark
  // gtasf-2mdpz: moved ~59 m north up Stanyan from 37.7737,-122.4545, where the road graph was 3.7 m under the drawn hill
  // (a respawned player was buried for everyone else: unhittable, while their own shots landed). Here graph and drawn
  // ground agree: every graph point within 15 m is < 0.5 m off (tools/map/roadgraph-height-sweep.mts --near; lane D's
  // GROUNDCHECK ~0.2 m). Same point as lane D's hospitalEntrances anchor; heading 125 faces its sign and forecourt.
  { id: 'st-marys', name: "St. Mary's", lat: 37.774227, lon: -122.454550, heading: 125 },              // Stanyan: Haight, Golden Gate Park
];
/** Hospitals withheld from respawn (none now). A spot whose road graph sits well under the drawn ground buries the
 *  respawned player for everyone else — check with roadgraph-height-sweep --near before adding one. */
export const HELD_HOSPITALS: readonly RespawnHospital[] = [];

/** The hospital nearest to `from` (world metres), given the caller's lat/lon projection; ties keep list order. */
export function nearestHospital(from: { x: number; z: number }, project: (lat: number, lon: number) => { x: number; z: number },
  hospitals: readonly RespawnHospital[] = RESPAWN_HOSPITALS): RespawnHospital {
  let best = hospitals[0]!, bestD2 = Infinity;
  for (const hospital of hospitals) {
    const p = project(hospital.lat, hospital.lon), d2 = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
    if (d2 < bestD2) { best = hospital; bestD2 = d2; }
  }
  return best;
}
