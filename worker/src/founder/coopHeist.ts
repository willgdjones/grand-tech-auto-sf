/**
 * Co-op heist (flag coopHeist; GTA-pivot lane C multiplayer): a second player joins a running pitch-deck heist as the
 * getaway driver. Money design: NO new money — the crew is paid the normal heist credit under THEIR OWN daily heist ref
 * (`mission:steal-pitch-deck:<day>`), so each device can still earn the heist at most once a day, solo or crewed. The
 * crew must do the same server-checked run as a solo player (pass the grab, the route's travel floor measured from their
 * join, lose the heat, be at the delivery) AND the leader must have delivered the deck — at the same moment, or the crew
 * arrives within COOP_CREW_GRACE_MS after. These rules are pure; the WorldDO applies them to authoritative poses.
 */
export const COOP_JOIN_WINDOW_MS = 60_000;   // join within a minute of the grab
export const COOP_JOIN_RADIUS_M = 40;        // ... standing at the rival's office
export const COOP_INVITE_RADIUS_M = 150;     // who gets the invite
export const COOP_CREW_GRACE_MS = 120_000;   // a crew arriving after the leader's delivery still counts for 2 min

export type CoopJoinRefusal = 'no-heist' | 'closed' | 'full' | 'same-device' | 'busy' | 'too-far' | 'cooldown';
export interface CoopLeaderRun { readonly startMs: number; readonly device: string; readonly crewSid?: number; readonly crewOf?: number; readonly heist: boolean }
export interface CoopJoiner { readonly device: string; readonly busy: boolean; readonly distanceM: number; readonly doneToday: boolean }

/** Why a player can't join this leader's heist (null = they can). */
export function coopJoinRefusal(leader: CoopLeaderRun | undefined, joiner: CoopJoiner, now: number): CoopJoinRefusal | null {
  if (!leader || !leader.heist || leader.crewOf !== undefined) return 'no-heist';
  if (now - leader.startMs > COOP_JOIN_WINDOW_MS) return 'closed';
  if (leader.crewSid !== undefined) return 'full';
  if (joiner.device === leader.device) return 'same-device'; // your own second tab can't be your crew
  if (joiner.busy) return 'busy';
  if (joiner.distanceM > COOP_JOIN_RADIUS_M) return 'too-far';
  if (joiner.doneToday) return 'cooldown';
  return null;
}

/** Can a crew run be paid now (its own completion checks are separate)? Needs the leader's delivery, recent enough. */
export function crewPayable(crew: { readonly leaderDeliveredAt?: number }, now: number): 'ok' | 'waiting-for-leader' | 'too-late' {
  if (crew.leaderDeliveredAt === undefined) return 'waiting-for-leader';
  return now - crew.leaderDeliveredAt <= COOP_CREW_GRACE_MS ? 'ok' : 'too-late';
}
