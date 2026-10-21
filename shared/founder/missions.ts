/**
 * GTASF mission framework (docs/PLAN-gta-pivot.md LANE C). A shared, serializable mission spec — a start
 * marker, ordered objectives, fail conditions and a valuation payout — that the CLIENT drives (minimap letter
 * marker, the in-game phone, objective tracking) while the SERVER validates completion and pays the valuation
 * credit (the handleDriveStart/Complete pattern in WorldDO). Pure + serializable so the client and the worker
 * agree on the same spec with no extra protocol.
 *
 * Single currency = valuation. Payout scales with the active economy (a multiple of the demo base, like the
 * drive quest), so it stays sane in both economy-v2 and v3. Flag-gated behind `missions`; money path reviewed.
 */
import { FUNDING_BASE_CENTS, fundingDay, type FundingSource } from '@gtasf/shared/funding';
import { flags, type Feature } from '@gtasf/shared/flags';

export type MissionKind = 'heist' | 'delivery' | 'collect';
export interface GeoPoint { readonly lat: number; readonly lon: number }

/** One ordered step of a mission. `at`/`radiusM` give it a GPS waypoint + arrival radius (the server proximity
 *  check reuses project() + a hypot, like the drive/share quests). `escape` is a stub until lane B's wanted
 *  level lands (client-timed; see MissionEscape). */
export interface MissionObjective {
  readonly id: string;
  readonly kind: 'goto' | 'collect' | 'deliver' | 'escape';
  readonly label: string;        // phone / HUD line
  readonly at?: GeoPoint;        // waypoint
  readonly radiusM?: number;     // arrival radius (default MISSION_ARRIVE_RADIUS_M)
  readonly escape?: MissionEscape;
  /** Only counts while the player is DRIVING (server: the authoritative pose's driver flag) — a taxi fare can't be walked. */
  readonly drive?: true;
}

/** Stub "lose the heat" escape (until lane B's wanted level): drive at least `escapeM` from `fromObjectiveId`
 *  within `limitMs`. Client-timed for now (flavour); the server payout depends on the grab + deliver proximity,
 *  not the escape, so the stub can't be farmed. */
export interface MissionEscape { readonly escapeM: number; readonly limitMs: number; readonly fromObjectiveId: string }

export interface MissionSpec {
  readonly id: string;
  readonly kind: MissionKind;
  readonly title: string;
  readonly phoneBlurb: string;                                   // the jobs-list / quest-giver-call text
  readonly giver?: { readonly name: string } & GeoPoint;        // optional quest-giver NPC
  readonly start: GeoPoint & { readonly letter: string };       // minimap letter marker + start point
  readonly objectives: readonly MissionObjective[];
  /** Payout = FUNDING_BASE_CENTS.demo × payoutDemoX (scales with the active economy). Reviewed money value. */
  readonly payoutDemoX: bigint;
  readonly cooldown: 'once' | 'daily';
  readonly next?: string;                                        // route the quest card to this mission on complete
  /** Per-mission feature switch on top of `missions`: when set and OFF the mission is absent everywhere (phone,
   *  markers, giver, server start). Lets a new mission (a new valuation source) ship dark while missions is live. */
  readonly flag?: Feature;
  /** Acqui-hire escrow job (worker/src/founder/acquihire.ts): the start DEBITS a price (10% of valuation) and the delivery
   *  pays 1.5× it back; payoutDemoX is unused. */
  readonly acquihire?: true;
  /** The quest-giver's phone call pitching this job (fictional contact, never a real person). */
  readonly call?: { readonly from: string; readonly line: string };
}

/** How close (metres) the player must be to an objective waypoint to complete it (server-checked). */
export const MISSION_ARRIVE_RADIUS_M = 10;

/**
 * Mission roster. Coordinates are SoMa/FiDi; the exact walkable spot for each marker is tuned with the venue
 * capture (createGroundNpc / the player snap hide an off-mesh point, see the Series A venue lesson).
 */
export const MISSIONS: readonly MissionSpec[] = Object.freeze([
  {
    id: 'steal-pitch-deck',
    kind: 'heist',
    title: 'Steal the Pitch Deck',
    phoneBlurb: "A rival's Series A deck is sitting in their SoMa office. Grab it and get it to your VC before they notice.",
    start: { lat: 37.782190, lon: -122.402980, letter: 'H' }, // rival SoMa office (grab) — walkable-verify
    objectives: [
      { id: 'grab', kind: 'collect', label: 'Grab the pitch deck from the rival office', at: { lat: 37.782190, lon: -122.402980 }, radiusM: 10 },
      { id: 'escape', kind: 'escape', label: flags.heistGetaway ? 'Lose the heat: take a car, or get out of their sight' : 'Lose the heat', escape: { escapeM: 180, limitMs: 60_000, fromObjectiveId: 'grab' } }, // heistGetaway: the card says how (critic N47)
      { id: 'deliver', kind: 'deliver', label: 'Deliver the deck to First Round Capital', at: { lat: 37.799653, lon: -122.400453 }, radiusM: 10 }, // First Round / FiDi (snapped to walkable)
    ],
    payoutDemoX: 4n,
    cooldown: 'daily',
    call: { from: 'Your shadiest angel investor', line: "Kid. A rival's Series A deck is sitting on a desk in SoMa. Grab it, lose the cops, bring it to your VC. Interested?" },
  },
  {
    // Founder-ladder meme roster: the hacker-house recruiter — "find 3 co-founders around SoMa" (a collection
    // loop). Every pickup is a server-verified checkpoint (the server tracks them from accepted poses), then hand
    // the team back at the house. Every point is its nearest road lane (live road graph, 2026-10-14). Ships dark behind flags.cofounderHunt (a new daily valuation source).
    id: 'cofounder-hunt',
    kind: 'collect',
    title: 'Find Your Co-founders',
    phoneBlurb: 'A hacker-house recruiter swears your future co-founders are wandering SoMa right now. Find all three and bring them back to the house.',
    giver: { name: 'A hacker-house recruiter', lat: 37.785418, lon: -122.397022 },
    start: { lat: 37.785418, lon: -122.397022, letter: 'C' }, // the hacker house (fictional), SoMa — road-snapped
    objectives: [
      { id: 'rust', kind: 'goto', label: 'Recruit the 19-year-old Rust prodigy at South Park', at: { lat: 37.781691, lon: -122.394117 }, radiusM: 20 },
      // cofounderShortLoop (critic N41): Caltrain sat across the I-80/rail barrier: lane E's road-routed legs were ~290 s in
      // and ~335 s out (14-15 min of walking for the job). Howard St by Moscone (road-snapped, 7 m) keeps the loop in SoMa:
      // 2.5 km -> 1.7 km straight-line, no barrier. The server's checkpoints and travel floor read this same spec.
      flags.cofounderShortLoop
        ? { id: 'designer', kind: 'goto', label: 'Recruit the designer with the Figma tattoo outside Moscone', at: { lat: 37.783355, lon: -122.399594 }, radiusM: 20 }
        : { id: 'designer', kind: 'goto', label: 'Recruit the designer with the Figma tattoo by Caltrain', at: { lat: 37.776493, lon: -122.394309 }, radiusM: 20 },
      { id: 'staff-eng', kind: 'goto', label: 'Recruit the burnt-out ex-FAANG staff engineer at Yerba Buena', at: { lat: 37.782761, lon: -122.401856 }, radiusM: 20 },
      { id: 'return', kind: 'deliver', label: 'Bring your new co-founders back to the hacker house', at: { lat: 37.785418, lon: -122.397022 }, radiusM: 15 },
    ],
    payoutDemoX: 2n,
    cooldown: 'daily',
    flag: 'cofounderHunt',
    call: { from: 'A hacker-house recruiter', line: 'Three future co-founders are wandering SoMa right now, all wildly underqualified. Want them?' },
  },
  {
    // Founder-ladder meme roster: the burnt-out founder — "buy my company" (docs/decision-burnt-out-founder.md option A,
    // orchestrator-approved 2026-10-14). Buying DEBITS 10% of valuation (escrow, refunded on abandon/teleport/
    // disconnect/timeout); delivering their laptop to the hacker house pays 1.5× back. Dark behind flags.acquihireQuest.
    id: 'acquihire',
    kind: 'delivery',
    title: 'Buy My Company',
    phoneBlurb: "A burnt-out founder will sell you their startup for 10% of your valuation. Get the laptop to the hacker house in 10 minutes and flip it for 1.5× what you paid.",
    giver: { name: 'A burnt-out founder', lat: 37.776464, lon: -122.424129 },
    start: { lat: 37.776464, lon: -122.424129, letter: 'A' }, // Hayes Valley (Patricia's Green), road-snapped on the live graph
    objectives: [
      { id: 'deliver', kind: 'deliver', label: 'Get the laptop to the hacker house before the deal goes cold', at: { lat: 37.785418, lon: -122.397022 }, radiusM: 15 },
    ],
    payoutDemoX: 0n,
    cooldown: 'daily',
    flag: 'acquihireQuest',
    acquihire: true,
    call: { from: 'A burnt-out founder', line: "I'm done. Ten percent of your valuation and the company's yours. Laptop, logo, one loyal user. Deal?" },
  },
  {
    // GTA V critique "not in the 20": a taxi-fare job on the robotaxi idea — YOU drive the fare. Start on foot at the Ferry
    // Building taxi stand (the plaza's parked cars are right there), pull up at the stand IN a car, then drive the fare to
    // Union Square. Both steps are `drive` objectives: the server only counts them while the pose carries the driver flag.
    // A new daily valuation source, so it ships dark behind flags.taxiFareJob.
    id: 'taxi-fare',
    kind: 'delivery',
    title: 'Drive a Fare',
    phoneBlurb: "The robotaxis are all booked and a VC is stuck at the Ferry Building. Grab a car at the taxi stand and drive them to their Union Square offsite.",
    start: { lat: 37.795000, lon: -122.394200, letter: 'F' }, // Ferry Building plaza taxi stand (verified: The Embarcadero lane 7.3 m away, inside the 25 m pickup)
    objectives: [
      { id: 'pickup', kind: 'goto', label: 'Get in a car and pull up at the taxi stand for your fare', at: { lat: 37.795000, lon: -122.394200 }, radiusM: 25, drive: true },
      { id: 'dropoff', kind: 'deliver', label: 'Drive your fare to Union Square', at: { lat: 37.787696, lon: -122.407555 }, radiusM: 20, drive: true }, // Geary St at Powell, on the road lane (walkable check 17 m -> 0)
    ],
    payoutDemoX: 1n,
    cooldown: 'daily',
    flag: 'taxiFareJob',
    call: { from: 'GTASF Cabs dispatch', line: "Every robotaxi in the city is booked and a VC is stranded at the Ferry Building. You've got a licence, right? Union Square, fast." },
  },
]);

/** Is this mission switched on (its own per-mission flag, if any)? `missions` itself is checked by the callers. */
export function missionEnabled(mission: MissionSpec, enabled: Readonly<Record<string, boolean>>): boolean {
  return !mission.flag || enabled[mission.flag] === true;
}

/** The waypoints the SERVER must see the player reach, in order, before the final delivery: every objective with a
 *  GPS point except the last one (the delivery, checked at mission-complete). */
export function missionCheckpoints(mission: MissionSpec): readonly MissionObjective[] {
  const withAt = mission.objectives.filter(objective => objective.at);
  return withAt.slice(0, -1);
}

export function missionById(id: string): MissionSpec | undefined {
  return MISSIONS.find(mission => mission.id === id);
}

/** The valuation payout (cents) for a mission in the active economy. */
export function missionPayoutCents(mission: MissionSpec): bigint {
  return FUNDING_BASE_CENTS.demo * mission.payoutDemoX;
}

/** Funding source + credit ref for a mission payout. Source 'celebrity' (the quest source; recordFundingCredit
 *  accepts it — unlike 'vc-drop'); the `mission:<id>` namespace never collides with a pitch/meme/drive/share ref.
 *  A daily mission adds the SF day so it can pay once per SF day; a once-ever mission omits it. */
export function missionCredit(mission: MissionSpec, now: number): { source: FundingSource; sourceRef: string } {
  const ref = mission.cooldown === 'daily' ? `mission:${mission.id}:${fundingDay(now)}` : `mission:${mission.id}`;
  return { source: 'celebrity', sourceRef: ref };
}
