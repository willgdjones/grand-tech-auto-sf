/**
 * Kerb-car theft (flag kerbCarTheft, gtasf-0lnjq): the client's kerb-parked cars are cosmetic props (not networked), so
 * the server can't look them up — it validates the claimed pose instead. Pure, so it's unit-testable.
 */
/** The player (on foot) must be this close (metres, 2-D) to the car they claim. */
export const KERB_REACH_M = 4.5;
/** A kerb spot sits beside the carriageway: its nearest road point must be within this many metres. */
export const KERB_ROAD_M = 9;

/** cm poses for player + claim; `road` is the server's nearest-road snap (metres) of the claim, or null. */
export function kerbTheftValid(player: { x: number; z: number }, claim: { x: number; z: number }, road: { x: number; z: number } | null): boolean {
  if (!Number.isFinite(claim.x) || !Number.isFinite(claim.z)) return false;
  if (Math.hypot(player.x - claim.x, player.z - claim.z) > KERB_REACH_M * 100) return false;
  if (!road) return false;
  return Math.hypot(road.x - claim.x / 100, road.z - claim.z / 100) <= KERB_ROAD_M;
}
