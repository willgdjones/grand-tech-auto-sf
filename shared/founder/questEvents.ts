/**
 * Multiplayer quest events (lane C: street races, Most Wanted bounty, co-op heist) carried by the generic S2C QUEST
 * message as small JSON. Times are RELATIVE (ms from receipt) so client clock skew never matters.
 */
export interface RacePlacing { readonly name: string; readonly ms: number | null; readonly place: number | null }
export type QuestEvent =
  | { kind: 'race-invite'; raceId: string; routeId: string; host: string; joinInMs: number }
  | { kind: 'race-lobby'; raceId: string; routeId: string; racers: string[]; closesInMs: number }
  | { kind: 'race-countdown'; raceId: string; routeId: string; startsInMs: number; /** raceRivals: NPC rivals + their finish times */ rivals?: { name: string; ms: number }[] }
  | { kind: 'race-go'; raceId: string; routeId: string }
  | { kind: 'race-gate'; raceId: string; reached: number; total: number }
  | { kind: 'race-finish'; raceId: string; name: string; place: number; ms: number }
  | { kind: 'race-results'; raceId: string; routeId: string; placings: RacePlacing[]; you: number | null }
  | { kind: 'race-cancelled'; raceId: string; reason: string }
  // Most Wanted bounty: the current holder (targetId = wire player id; null = no bounty), sent once per holder change.
  | { kind: 'bounty'; targetId: number | null; name: string; amountCents: string; you: boolean }
  | { kind: 'bounty-claimed'; killer: string; target: string; amountCents: string; you: boolean }
  // Co-op heist: an invite to join a running heist as the getaway driver (hostSid = the leader's session id), the crew
  // formed (to both), the crew's payout (sent when the leader's delivery pays the waiting crew), or the crew run ending.
  | { kind: 'heist-invite'; hostSid: number; host: string; joinInMs: number }
  | { kind: 'heist-crew'; partner: string; role: 'leader' | 'crew' }
  | { kind: 'heist-paid'; amountCents: string; partner: string }
  | { kind: 'heist-cancelled'; reason: string };

const KINDS = new Set(['race-invite', 'race-lobby', 'race-countdown', 'race-go', 'race-gate', 'race-finish', 'race-results', 'race-cancelled', 'bounty', 'bounty-claimed', 'heist-invite', 'heist-crew', 'heist-paid', 'heist-cancelled']);

/** Parse a QUEST message body; null for anything malformed or an unknown kind (newer servers, older clients). */
export function parseQuestEvent(json: string): QuestEvent | null {
  try {
    const value = JSON.parse(json) as { kind?: unknown } | null;
    return value && typeof value.kind === 'string' && KINDS.has(value.kind) ? value as QuestEvent : null;
  } catch { return null; }
}
