import { WorldAnalytics } from '../analytics/world';
import { analyticsServerContext, type AnalyticsServerContext } from '../analytics/xConversions';
import { DurableObject } from 'cloudflare:workers';
import { countCaption } from '../voice/metrics';
import { flags } from '@gtasf/shared/flags';
import { decodeC2S } from '@gtasf/shared/protocol/c2s';
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import { CloseCode, OFFICERS_MAX, PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import { normalizeNickname } from '@gtasf/shared/protocol/nickname';
import { DRIVE_THROUGH_RADIUS_M, FUNDING_ROUNDS, priorRoundThresholdCents, roundFloorGraceCents, type FundingProfile } from '@gtasf/shared/funding';
import { decodeAppearance } from '@gtasf/shared/content/cosmetics';
import { RIDING_POSE_FLAG, rideSpeedCapMps } from '@gtasf/shared/content/rides';
import type { Point, Pose, QuickRobotaxiTarget, S2CMessage, C2SMessage, VehicleKind } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import { WorldTick } from './tick';
import { checkMovement } from './movement';
import { broadcastSnapshots, snapshotEntries, type WorldPeer } from './snapshot';
import { NEAREST_FULL } from '@gtasf/shared/world/interest';
import { SF_ZONE_GRID, cellIndex, cellFromIndex, globalPlayerId, borderObservers, handoffDestination, zoneId } from '@gtasf/shared/world/zones';
import { resolveZoneCell } from './zoneRouting';
import { IDLE_MS, RESUME_GRACE_MS, WorldSessions, type WorldSession } from './sessions';
import { loadPersonalCar, savePersonalCar, DELIVER_AHEAD_M, DELIVER_COOLDOWN_MS, DELIVER_MAX_M } from './personalCar';
import { giftTierCars, keepCar, listGarage } from './garage';
import { DRIVER_FLAG, PASSENGER_FLAG, WorldVehicles } from './vehicles';
import { RideAnyVehicles } from './rideAnyVehicle';
import { occupiedVehicleState, zonedVehicleId, type OccupiedVehicleTransfer } from './vehicleHandoff';
import { TRANSFER_TIMEOUT_MS, validZoneTransfer, ZoneTransfers, type ZoneTransfer } from './zoneTransfers';
import { WorldMayhem, nearMayhem, MAYHEM_RELAY_RADIUS_M } from './mayhem';
import { CHEST_M, WorldCombat, overdueDeaths, pvpTargets, vehicleFireAllowed } from './combat';
import { addHeat, freshWanted, tickWanted, wantedLevel, wantedRaiseAllowed, type Crime, type WantedState } from '@gtasf/shared/combat/wanted';
import { ESCAPE_PHASES, freshEscape, HIDEOUTS, NO_UNIT_GRACE_MS, placePositions, RESPRAY_SHOPS, resprayClears, stepEscape, stepSightingHold, withinAny, type EscapeState, type SightingHold } from '@gtasf/shared/combat/escape';
import { SFPD_TUNING } from '@gtasf/shared/combat/sfpdTuning';
import { WorldPolice, type PoliceRam } from './police';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import { POLICE_ID_BASE, SFPD_FIRING_WINDOW_MS } from '@gtasf/shared/combat/police';
import { crashReportAllowed, vehicleOnShot, WorldVehicleDamage } from './vehicleDamage';
import { applyPickup, PICKUP_RADIUS_M, PICKUP_RESPAWN_MS, PICKUP_SPOTS } from '@gtasf/shared/combat/pickups';
import { buyArmour } from '../combat/shop';
import { atArmourCounter } from '@gtasf/shared/combat/gunShop';
import { PED_PUNCH_DAMAGE, pedPunchAllowed } from '@gtasf/shared/combat/pedMelee';
import { RAM_CONTACT_M, RAM_DAMAGE, RAM_MAX_DY_M, ramDirection } from '@gtasf/shared/combat/policeRam';
import { KERB_REACH_M, kerbTheftValid } from './kerbTheft';
import { openingCarPose } from './openingCar';
import { blastDamage, bulletDamage, CHAIN_BLAST_MULTIPLIER, crashDamage, EXPLOSION_RADIUS_M, crashClosingCap, drivePeak, nextDriveTrack, type DriveTrack } from '@gtasf/shared/combat/vehicleDamage';
import { CombatPersistence } from './combatPersist';
import { PaidRides } from './paidRides';
import { RunPersistence, type StoredRun } from './runPersist';
import { BUST_MAX_DY_M, BUST_RADIUS_M, freshBust, stepBust, type BustState, BUST_OFFICER_RADIUS_M, resistingArrest, BUST_HOLD_MS } from '@gtasf/shared/combat/bust';
import { policeHitChance, POLICE_FIRE_MIN_LEVEL, POLICE_SHOT_DAMAGE, unitMayFire } from '@gtasf/shared/combat/policeFire';
import { applyStreetCrime, crimeForReport, freshStreetCrimeClock, POLICE_HIT_RADIUS_M, shotHitsPolice, streetCrimeForShot, type StreetCrimeClock } from '@gtasf/shared/combat/streetCrime';
import { lineOfSight } from '@gtasf/shared/combat/rayVsWorld';
import { WEAPON_ORDER, WEAPONS } from '@gtasf/shared/combat/weapons';
import { COLLISION_CHUNK_M, CombatCollision, policeLineClear, shotLosKnown } from './combatCollision';
import { MOVE_BURST_CM, ON_FOOT_CAP_MPS } from './movement';
import { LocalRobotaxis } from './localRobotaxi';
import { LOCAL_SPAWN, parseSpawnQuery } from './localSpawn';
import { LOCAL_ROAD_GRAPH } from './localRoadData';
import { TrafficSimulation } from './traffic/simulation';
import { ADMISSION_PROTOCOL_PREFIX, INPUT_IDLE_MS, launchMode, validAdmissionToken, worldCapacity } from '@gtasf/shared/admission';
import { WorldReservations } from './admission/reservations';
import { admissionJson, smallJson } from './admission/http';
import { launchAllowed } from './admission/invite';
import { fundingDevice, fundingSameOrigin } from '../funding/identity';
import { readObserverIdentity } from '@gtasf/shared/world/observers';
import { observerTargetAllowed, observerPoseUpdateAllowed, observerRejectStatus, observerZoneCap, OBSERVER_PER_CLIENT_CAP } from './observerAdmission';
import { WorldFunding } from '../funding/world';
import { clampPitchFloor, devicePitchedBefore, founderFirstPitchMin, founderMemePitchTarget, founderPitchTarget, founderSeedFloor, founderSeriesATarget, founderSeriesAFloor, openRouterJudge, pitchSpotsAt, pitchTargetNear, reconcileJudgeSpend, reserveJudgeSpend, runPitch, type PitchModeration, type PitchOutcome } from '../pitch/pitch';
import { founderPitchLine, FOUNDER_OPENING_DRIVE_START, FOUNDER_SERIES_A_ID } from '@gtasf/shared/founder/pitch';
import { memeNpcById, memeNpcEnabled } from '@gtasf/shared/founder/memeQuests';
import { DRIVE_START_RADIUS_M, driveQuestCredit, driveQuestState, runDriveQuest } from '../founder/driveQuest';
import { runShareQuest, SHARE_CLAIM_RADIUS_M } from '../founder/shareQuest';
import { missionById, missionEnabled, MISSION_ARRIVE_RADIUS_M } from '@gtasf/shared/founder/missions';
import { advanceCheckpoints, missionCompleted, missionDoneNow, missionsDoneNow, runMission, questStartedBy } from '../founder/missions';
import { deliverAcquisition, openAcquisition, refundAcquisition, startAcquisition } from '../founder/acquihire';
import { atTimeTrialFinish, timeTrialById, timeTrialDay, serverRunTimingOk, sanitizeTimeTrialGhost, TIME_TRIAL_START_RADIUS_M, TIME_TRIAL_SUBMIT_BODY_MAX } from '@gtasf/shared/founder/timeTrials';
import { runTimeTrialSubmit } from '../founder/timeTrialBoard';
import { PILGRIMAGE_SITES, pilgrimageSiteById } from '@gtasf/shared/founder/pilgrimage';
import { markApproached, pilgrimageCollected, runPilgrimageClaim } from '../founder/pilgrimage';
import { ttReadBest, ttWriteBest, ttRankOf, ttDisplayName } from '../founder/timeTrialRoutes';
import { WorldStreetRaces } from './streetRaces';
import { WorldBounty } from './bounty';
import { COOP_INVITE_RADIUS_M, COOP_JOIN_WINDOW_MS, coopJoinRefusal, crewPayable } from '../founder/coopHeist';
import type { QuestEvent } from '@gtasf/shared/founder/questEvents';
import { recordFundingCredit } from '../funding/credits';
import { runStoreRobbery } from '../combat/robbery';
import { storeById, robberyCredit, robberyCompleteStatus, robberyPayoutAllowed, ROBBERY_HOLD_MS, ROBBERY_RADIUS_M, type StoreSpec } from '@gtasf/shared/combat/storeRobbery';
import { creditedRefs, MAX_CREDIT_CENTS } from '../funding/credits';
import { getFundingProfile } from '../funding/store';
import { WorldDrops } from '../funding/drops';
import { fundingAnchor, project, type FundingAnchorResolver } from '../funding/anchors';
import { chargeRide, quoteRide, refundRide } from '../funding/rides';
import { applyCombatPenalty, settleWithRetry, currentValuationCents } from '../funding/penalty';
import { MAX_ARMOUR, MAX_HEALTH, SF_GENERAL_RESPAWN } from '@gtasf/shared/combat/economy';
import { nearestHospital } from '@gtasf/shared/combat/respawn';

/** review fix 4: how long a disconnected player's wanted heat + health are held for a reconnect (ms). */
const COMBAT_STASH_TTL_MS = 60_000;
/** reconnectGrace (gtasf-j7wvv): how long a vanished client's ride + runs are held for a same-session resume. Prod 1006s
 *  reconnect in 1-4 s; 20 s also covers a slow mobile reconnect, and it is far below the 120 s session resume window. */
export const RECONNECT_GRACE_MS = 20_000;
export const BUDGET_CLOSE_REASON = 'server: message budget exceeded';
/** gtasf-yufot: a run row older than this at an instance's start is from a player who left, not a reset. */
const RUN_RESTORE_MAX_AGE_MS = 60_000;
/** gtasf-j7wvv: the per-message session save runs at most this often per player (a DO restart resumes <= this stale). */
export const SESSION_SAVE_MS = 2_000;
/** gtasf-7p7oi: a socket drop within this much of a completed bust hold is settled as BUSTED (no dodge by disconnecting). */
export const BUST_DROP_SETTLE_MS = 1_000;
import { listEvents } from '../events/store';
import type { TechWeekEvent } from '../events/types';
import { areFriends, deviceForUsernameKey } from '../friends/store';
import { normalizeUsername } from '@gtasf/shared/friends/username';
import { createQuickTaxiBilling, safeQuickDrop, type FundingRing, type QuickTaxiServices, type QuickTripDestination } from './quickRobotaxi';
import { WorldReferralPlay } from '../referrals/play';
import { isScheduledTransit, WorldCableCars } from './cableCars';
import { LocalRoads, routePose } from './localRoads';
import { WorldChat, type ChatPeer } from './chat/world';
import { WorldVoice } from './voice/hearing';
import { refuseVoice, type VoiceAuthorizer } from './voice/authorize';
import { setVoiceGrants, voiceTrackState } from '../voice/store';
import { VoiceGrantHandoffs } from './voice/grants';
import { loadWorldRoads } from './worldRoads';
import { CaptionRing, fitCaption, reconcileCaptionSeconds, recordCaptionStrike, releaseCaptionSeconds } from '../voice/captions';
import { createSttAdapter, type SttAdapter } from '../voice/stt';

const HELLO_MS = 5000;
interface Peer extends WorldPeer { socket: WebSocket; session: WorldSession; fundingDeviceId?: string; appearance: number; spokenBubbles?: boolean; combatActive?: boolean }
interface Connection { claiming?: boolean; peer?: Peer; expiresAt: number; credit: number; budgetAt: number; spawn?: Pose; grant?: string; fundingDeviceId?: string; fundingNickname?: string; analyticsServer?: AnalyticsServerContext; observer?: boolean; observerPose?: Pose; observerPoseAt?: number; observerLooks?: Map<number, number>; observerClientKey?: string; spokenBubbles?: boolean }
type Attachment = ({ kind: 'pending'; expiresAt: number; spawn?: string; grant?: string; fundingNickname?: string } | { kind: 'session'; id: number; generation: number } | { kind: 'observer'; pose: string; clientKey: string }) & { fundingDeviceId?: string; analyticsServer?: AnalyticsServerContext; spokenBubbles?: true };

/** worldRoadsBackground: requests served while the city graph is still loading on a cold instance. Read/admission only:
 *  none of them reads roads, traffic, taxis or poses. Everything else waits for the graph exactly as before. */
function roadFreeRoute(path: string, method: string): boolean {
  return path === '/internal/admission/reserve' || path === '/internal/admission/cancel' || (path === '/api/funding/profile' && method === 'GET');
}

/** One shared city. Durable sessions and socket generations survive hibernation and reconnects. */
/** heistHeatOnLeave: how far from the grab point the heist's heat is raised (out of the office's block, critic N47). */
const HEIST_HEAT_LEAVE_M = 50;

export class WorldDO extends DurableObject<Env> {
  private readonly peers = new Map<number, Peer>();
  // Founder-ladder phase 5.1 (flags.driveQuest): the active "escape the cone" drive quest. Keyed by the SESSION id
  // (sid), not the device — a second tab / reconnect for the same device must not clobber another connection's run
  // (reviewer: find()-by-device two-tab void, matches the robbery fix). `device` is kept so clearDeviceQuests still
  // drops every one of a device's runs on a server-authorized teleport (anti-cash-out). Transient — re-starts on eviction.
  private readonly driveQuests = new Map<number, { npcId: string; startMs: number; device: string }>();
  // GTA-pivot mission framework (flags.missions): the in-progress mission (started at its marker; paid on a
  // server-validated delivery). Keyed by the SESSION id (two-tab void, as above); `device` kept for clearDeviceQuests,
  // `sid`+`gen` for questStartedBy (the started-by-this-session anti-teleport check). [gtasf-ldlm LANE C]
  // `reached` = checkpoints the server saw, in order (advanceCheckpoints on start + every accepted pose).
  // `acqId` = the D1 escrow of an acqui-hire job (founder/acquihire.ts); dropMissionRun refunds it whenever the run ends
  // without a delivery (teleport, disconnect, abandon, supersede, stale session).
  // crewOf / crewSid / leaderDeliveredAt: co-op heist links (flags.coopHeist; founder/coopHeist.ts) — a crew run is keyed
  // by the crew's session like any run, startMs = its join time.
  private readonly missions = new Map<number, { missionId: string; startMs: number; sid: number; gen: number; device: string; reached: number; acqId?: string;
    /** heistHeatOnLeave: the grab point (metres) whose 50 m the player must leave before the heist's heat is raised. */
    heatPendingAt?: { x: number; z: number };
    crewOf?: number; crewSid?: number; leaderDeliveredAt?: number }>();
  // LANE B store robbery (flags.combat+storeRobberies+wanted): the in-progress hold-up per device (started inside
  // the store; paid on rob-complete after a server-enforced >=ROBBERY_HOLD_MS hold + a re-check of the pose). [review fix 2]
  // Keyed by the SESSION id (sid), not the device: a second tab / reconnect for the same device must not clobber
  // another connection's in-progress hold (reviewer: find()-by-device two-tab void). `device` is kept in the value
  // so clearDeviceQuests can still drop every one of a device's holds on a server-authorized teleport (anti-cash-out).
  private readonly robberies = new Map<number, { storeId: string; startMs: number; device: string }>();
  // GTA-pivot time trials (flags.timeTrials): the in-progress run per funding device (armed at the route start
  // from the authoritative pose; the board records the SERVER-measured elapsed on a pose-checked finish). The
  // submit lives here (not the worker edge) so the finish + timing are authoritative. [gtasf-ldlm LANE C, review fix 2]
  private readonly timeTrialRuns = new Map<number, { routeId: string; startMs: number; sid: number; gen: number; device: string }>();
  // LANE C SF pilgrimage (flags.pilgrimage): per session, the landmarks it has been PILGRIMAGE_MIN_TRAVEL_M+ away from
  // (server-accepted poses only) since joining or its last server-authorized teleport (clearDeviceQuests drops it). A
  // site only pays once approached this way, so a deep link / robotaxi jump / respawn onto it can't cash out.
  private readonly pilgrimApproach = new Map<number, { far: Set<string>; device: string }>();
  // LANE C multiplayer street races (flags.streetRaces): transient in-memory races at time-trial routes (founder/
  // streetRace.ts rules, world/streetRaces.ts orchestration). No valuation; finish times post to the daily TT board.
  private readonly streetRaces = new WorldStreetRaces({
    peers: () => this.peers.values(),
    inVehicle: id => this.vehicles.occupants.has(id),
    newId: () => crypto.randomUUID(),
    recordBoard: (device, routeId, ms) => { this.ctx.waitUntil(this.recordRaceTime(device, routeId, ms).catch(() => {})); },
  });
  // LANE C multiplayer quest 2 (flags.mostWantedBounty): the richest combat-opted-in founder online in this cell carries a
  // bounty marker; a server-validated PvP takedown by another device collects the victim's own WASTED debit, capped
  // (founder/bounty.ts: victim-funded, target >= 3x killer, no friends / recent pairs, once per target and killer per day).
  private readonly bounty = new WorldBounty({
    db: () => this.env.DB,
    peers: () => this.peers.values(),
    profile: async (device, now) => {
      const profile = await getFundingProfile(this.env.DB, device, now);
      const bot = await this.env.DB.prepare('SELECT is_bot FROM funding_profiles WHERE device_id=?').bind(device).first<{ is_bot: number | null }>().catch(() => null);
      return { cents: BigInt(profile.totalCents), bot: bot?.is_bot === 1 };
    },
    valuation: async (device, now) => BigInt((await getFundingProfile(this.env.DB, device, now)).totalCents), // fresh, at claim
    award: input => recordFundingCredit(this.env.DB, { ...input, source: 'celebrity' }),
    refreshProfile: async (device, now) => { await this.funding?.refreshAfterRide(device, now); },
    waitUntil: promise => this.ctx.waitUntil(promise.catch(() => undefined)),
  });
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly sessions: WorldSessions;
  /** gtasf-2cprr: wanted/health/bust that survives an instance reset (in-memory stash doesn't). */
  private readonly combatPersist: CombatPersistence;
  private combatPersistAt = 0;
  /** gtasf-vmpq1: charged quick-robotaxi rides not yet arrived; a fresh instance refunds the ones a reset orphaned. */
  private readonly paidRides: PaidRides;
  /** gtasf-yufot: in-progress mission / drive / trial runs that survive an instance reset. */
  private readonly runPersist: RunPersistence;
  private runPersistAt = 0;
  private readonly transfers: ZoneTransfers | undefined;
  private readonly reservations: WorldReservations;
  private readonly funding: WorldFunding | undefined;
  private readonly drops: WorldDrops | undefined;
  private readonly analytics: WorldAnalytics | undefined;
  private readonly referralPlay: WorldReferralPlay | undefined;
  private readonly chat: WorldChat | undefined;
  // Proximity voice (flag proximityVoice): who-can-hear sets; audio itself flows through Cloudflare Realtime.
  private readonly voice = flags.proximityVoice ? new WorldVoice() : undefined;
  protected voiceAuthorize: VoiceAuthorizer = refuseVoice;
  /** Persists each listener device's subscribable tracks for the Realtime proxy (no-op when voice is off). */
  protected voiceGrants: (deviceId: string, tracks: readonly { sessionId: string; trackName: string }[]) => Promise<void> = async () => {};
  // Bumped on every PUBLISH, STOP and disconnect so a slow authorisation can never resurrect a released hold.
  private readonly voiceGeneration = new Map<number, number>();
  private voiceRecheckAt = 0;
  private recoveryRoads = new LocalRoads();
  private roadsReady = true;
  /** worldRoadsBackground: resolves once the city graph is loaded (or immediately when there is none to load). */
  private roadsLoad: Promise<void> = Promise.resolve();
  private readonly recoveredAt = new Map<number, number>();
  private outbidRevision = 0;
  private readonly vehicles = new WorldVehicles({
    emit: (message, playerId) => playerId === undefined ? this.broadcast(message) : this.peers.get(playerId)?.send(encodeS2C(message)),
    pose: (playerId, pose, now) => this.setVehiclePose(playerId, pose, now),
    personalCarLeft: (playerId, kind, pose) => this.savePersonal(playerId, kind, pose),
  });
  private taxis = new LocalRobotaxis(this.vehicles, {
    emit: (message, playerId) => this.peers.get(playerId)?.send(encodeS2C(message)),
    locate: playerId => this.peers.get(playerId)?.pose,
    wanted: playerId => this.taxiRefusesWanted(playerId),
    kerbStepClear: (from, to) => this.kerbStepClear(from, to),
  }, this.recoveryRoads, this.quickTaxiServices());
  private traffic = flags.traffic ? new TrafficSimulation(LOCAL_ROAD_GRAPH, { maximum: 240, perPlayer: 24 }) : undefined;
  private readonly movingRides = new RideAnyVehicles(this.vehicles, () => this.traffic, () => this.recoveryRoads);
  private readonly cableCars = flags.cableCars || flags.muni ? new WorldCableCars(this.vehicles) : undefined;
  private trafficLastAt = Date.now();
  private tick = 0;
  // This instance's grid cell index, learned from the first /api/world request via the
  // same routing function index.ts used (zonedWorld only); gives per-cell globally-unique ids.
  private zoneCellIndex?: number;
  // Peers mid-handoff to a neighbour cell (gtasf-djjz §7): their PLAYER_LEAVE is suppressed when their
  // socket closes (they re-home to the destination with the same id, so remotes keep seeing them via the
  // border-observer band — no blink). Cleared on leave.
  private readonly handingOff = new Set<number>();
  // Playful Mayhem server sync (gtasf-mayhem-sync-4fez): per-peer cooldown + validation for the
  // cosmetic MAYHEM_FIRE relay. Always constructed (tiny); the handler is gated by flags.playfulMayhem.
  private readonly mayhem = new WorldMayhem();
  // Server-authoritative combat (flag serverHits): owns per-player health; validates FIRE against server poses.
  private readonly combat = new WorldCombat();
  // Wanted level (flag wanted): per-player heat/level; raised by crimes, decays on line-of-sight escape + cooldown.
  private readonly wantedStates = new Map<number, { state: WantedState; level: number }>();
  private wantedLastAt = 0;
  // review fix 4: wanted heat + health persisted by funding device across a short reconnect (keyed by device,
  // expires ~60s) so a reload/disconnect can't launder away a wanted level or wounds. Set on disconnect, consumed on join.
  private readonly combatStash = new Map<string, { state: WantedState; health: number; expiresAt: number; bust?: BustState }>();
  // SFPD pursuit (flag wanted): units chase wanted players, snapped to the road graph, published as NPC cars.
  private readonly police = new WorldPolice((x, z) => this.roadSnap(x, z), Math.random,
    // A cruiser/officer may leave the road only where the LOADED building footprints show the step is clear; missing
    // collision fails closed (blocked) — never walk or drive through an unknown wall. (warmPoliceCollision loads it.)
    (x0, z0, x1, z1, y) => !policeLineClear(this.combatCollision?.near(x1, z1), [x0, y + 1, z0], [x1, y + 1, z1]));
  // Street-crime wanted (flag streetCrimeWanted): per-shooter rate-limit clocks for gunfire / cop-hit crimes.
  private readonly streetCrimeClocks = new Map<number, StreetCrimeClock>();
  // SFPD bust (flag policeBust): per-player 'caught by the police' timers (shared/combat/bust.ts).
  private readonly bustStates = new Map<number, BustState>();
  private readonly bustsInFlight = new Set<number>(); // a bust debit is settling: no second bust for this player
  // SFPD return fire (flag policeFire): last shot per police unit id, and each player's tracked ground speed.
  private readonly policeFireAt = new Map<number, number>();
  private readonly policeTrack = new Map<number, { x: number; z: number; at: number; speed: number }>();
  // SFPD on foot (flag sfpdOnFoot): peers whose last OFFICERS message was non-empty (they get one clearing message).
  private readonly officerViewers = new Set<number>();
  // Vehicle damage + explosions (flag vehicleDamage): damaged-vehicle HP + wrecks, per-driver crash rate limit, chain
  // explosions queued to the next tick, and the burn-down clock.
  private readonly vehicleDamage = new WorldVehicleDamage();
  private readonly crashAt = new Map<number, number>();
  private pendingExplosions: number[] = [];
  private vehicleDamageAt = 0;
  // Health + armour pickups (flag vitalsPickups): per spot (PICKUP_SPOTS order), when it comes back (0 = available).
  private readonly pickupTakenUntil = PICKUP_SPOTS.map(() => 0);
  private readonly pedPunchAt = new Map<number, number>(); // pedMelee: last accepted PED_PUNCH per player
  private readonly wantedSightSent = new Map<number, boolean>(); // gtasf-abijv: last WANTED_SIGHT sent per player
  // wantedEscape (gtasf-66lvh): per-player escape clock, last WANTED_ESCAPE sent, last respray; garage/shop positions (m).
  private readonly escapeStates = new Map<number, EscapeState>();
  private readonly sightingHolds = new Map<number, SightingHold>(); // escapeWaitsForSighting (critic N38)
  private readonly escapeSent = new Map<number, { phase: number; cover: number; progress: number; at: number }>();
  private readonly resprayAt = new Map<number, number>();
  private hideoutSpots?: { x: number; z: number }[];
  private resprayShops?: { x: number; z: number }[];
  private readonly driveTrack = new Map<number, DriveTrack>(); // review: measured driver speed (nextDriveTrack)
  private regenAt = 0; // healthRegen: last regen step
  private readonly stepErrorAt = new Map<string, number>(); // gtasf-j7wvv: throttled step-error logs
  // reconnectGrace (gtasf-j7wvv): session id -> its ride/runs held while the client is gone (until), and its device.
  private readonly dropGrace = new Map<number, { device?: string; until: number }>();
  // gtasf-j7wvv: 10 Hz ticks should land ~100 ms apart. A 1-30 s gap with players attached means the DO's event loop
  // stalled (CPU-heavy work or GC), which bunches inbound MOVEs into CORRECTION bursts; logged so the next socket
  // drop can be told apart from an edge/runtime reset. Longer gaps are the ticker having stopped with nobody connected.
  private lastStepAt = 0; private stallLogAt = 0;
  private readonly sessionSavedAt = new Map<number, number>(); // per-message session saves are throttled (SESSION_SAVE_MS)
  private closeCause: string | undefined; // set by the runtime close/error/send-failure path just before remove()
  // Review WG-M1 (gtasf-kill-settle-before-broadcast-yda5o): deaths being settled (one applyPvpDeath per victim at a
  // time) + when each still-unsettled dead peer was first seen, for the tick watchdog.
  private readonly deathsInFlight = new Set<number>();
  private readonly deadSeenAt = new Map<number, number>();
  private readonly kerbTakeAt = new Map<number, number>(); // kerbCarTheft: last attempt per player (rate limit)
  private readonly openingCarAsked = new Set<number>(); // openingDrive: one ask per session
  private readonly openingCarOfDevice = new Map<string, number>(); // openingDrive (OD-M1): each device's live opening car
  private readonly personalDeliverAt = new Map<number, number>(); // personalCar: last delivery per player (cooldown)
  private readonly garageDeliverAt = new Map<string, number>(); // garageSlots [1]: last delivery per DEVICE (one cooldown across tabs and slots)
  private readonly personalRestoring = new Set<string>(); // personalCar review LOW 1: one restore in flight per device
  private pickupPositions: { x: number; z: number }[] | undefined;
  // Server-side building collision for hit line-of-sight (flag serverHits); lazily loaded from the map manifest.
  private readonly combatCollision: CombatCollision;
  /** serverTerrainLos (gtasf-fajmy): shot + police-sight LoS also test the drawn ground, so nobody shoots through a hill. */
  private readonly terrainHeightAt = flags.serverTerrainLos ? (x: number, z: number) => this.combatCollision.heightAt(x, z) : undefined;
  private armedAt = Infinity;
  private alarmCleared = false; // gtasf-27jen: the stored alarm was deleted for this empty spell
  private readonly ticker = new WorldTick(() => this.peers.size, () => this.step());

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.combatCollision = new CombatCollision(env.ASSETS, env.WORLD_ROAD_GRAPH_KEY);
    if (env.WORLD_ROAD_GRAPH_KEY || env.WORLD_ROAD_GRAPH_SHA256) {
      this.roadsReady = false;
      const loadRoads = async () => {
        const startedAt = Date.now();
        const roads = await loadWorldRoads(env);
        // A manifest-mode key (no pinned hash) with no publication yet keeps the embedded corridor graph.
        if (!roads && !env.WORLD_ROAD_GRAPH_SHA256) { this.roadsReady = true; return; }
        if (!roads) throw new Error('WORLD_ROAD_GRAPH_REQUIRED');
        this.recoveryRoads = roads;
        this.vehicles.configureStreetParking(roads);
        this.taxis = new LocalRobotaxis(this.vehicles, {
          emit: (message, playerId) => this.peers.get(playerId)?.send(encodeS2C(message)),
          locate: playerId => this.peers.get(playerId)?.pose,
          wanted: playerId => this.taxiRefusesWanted(playerId),
    kerbStepClear: (from, to) => this.kerbStepClear(from, to),
        }, roads, this.quickTaxiServices());
        this.traffic = flags.traffic ? new TrafficSimulation(roads, { maximum: 240, perPlayer: 24 }) : undefined;
        this.roadsReady = true;
        for (const peer of this.peers.values()) this.resnapSessionHeight(peer.session, peer); // wake-installed peers (roads weren't ready)
        // gtasf-27jen: every wake (cold start / hibernation resume) re-loads and parses the city graph inside
        // blockConcurrencyWhile, holding every queued request. One line per wake shows how often and how long.
        console.log('world DO start', `roads ${Date.now() - startedAt}ms`, `sockets ${ctx.getWebSockets().length}`);
      };
      if (flags.worldRoadsBackground) {
        // gtasf-ep30n (lane C cold-phone trace): blockConcurrencyWhile held EVERY request for the whole graph load, so a cold
        // instance (night, or after one of Cloudflare's resets) answered /internal/admission/reserve in ~1 s and the funding
        // profile in 2-4 s, both on the critical path to READY although neither touches roads. Load in the background:
        // fetch() awaits it for everything except ROAD_FREE_ROUTES, socket messages await it, step() already skips until
        // roadsReady. A failed load aborts the instance, as a throw inside blockConcurrencyWhile did.
        this.roadsLoad = loadRoads();
        this.roadsLoad.catch(error => {
          console.error('world roads load failed', error instanceof Error ? error.message : String(error));
          (ctx as unknown as { abort?(reason?: string): void }).abort?.('world roads load failed');
        });
      } else ctx.blockConcurrencyWhile(loadRoads);
    }
    if (flags.zonedWorld) {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_zone (id INTEGER PRIMARY KEY CHECK(id=1), cell_index INTEGER NOT NULL)');
      this.zoneCellIndex = ctx.storage.sql.exec<{ cell_index: number }>('SELECT cell_index FROM world_zone WHERE id=1').toArray()[0]?.cell_index;
      if (this.zoneCellIndex !== undefined) this.configureZoneFleet();
    }
    this.sessions = new WorldSessions(ctx.storage);
    this.combatPersist = new CombatPersistence(ctx.storage.sql);
    this.paidRides = new PaidRides(ctx.storage.sql);
    this.runPersist = new RunPersistence(ctx.storage.sql);
    if (flags.reconnectGrace) this.restoreRuns(this.runPersist.load(Date.now(), RUN_RESTORE_MAX_AGE_MS), Date.now());
    // gtasf-vmpq1: rows here at construction belong to a DEAD instance (reset mid-ride): the car and trip are gone, so
    // the fare goes back (idempotent by rideId; the row is dropped only once the refund has landed).
    for (const orphan of this.paidRides.orphans()) ctx.waitUntil(refundRide(env.DB, orphan.device, orphan.rideId)
      .then(() => this.paidRides.drop(orphan.rideId))
      .catch(error => console.warn('orphan ride refund failed', error instanceof Error ? error.name : 'unknown')));
    this.transfers = flags.zonedWorld ? new ZoneTransfers(ctx.storage) : undefined;
    this.reservations = new WorldReservations(ctx.storage);
    this.analytics = flags.posthogAnalytics || flags.xAdsPixel ? new WorldAnalytics(ctx.storage, env) : undefined;
    this.referralPlay = flags.referrals ? new WorldReferralPlay(ctx.storage, env.DB, work => ctx.waitUntil(work), () => this.arm(), flags.referralWarmIntro && flags.fundingLoop) : undefined;
    // blockConcurrencyWhile loads the configured city graph before requests arrive.
    // Resolve through the current graph, not the constructor's initial corridor.
    const anchorForEvent: FundingAnchorResolver = event => fundingAnchor(event, this.recoveryRoads);
    // Only tracks the Worker voice proxy authorised for this device (gtasf-bdzy) may be published.
    if (flags.proximityVoice) {
      this.voiceAuthorize = (deviceId, sessionId, trackName, intent) => voiceTrackState(env.DB, deviceId, sessionId, trackName, Date.now(), intent);
      this.voiceGrants = (deviceId, tracks) => setVoiceGrants(env.DB, deviceId, tracks, Date.now());
    }
    this.chat = flags.chat ? new WorldChat(ctx.storage, env, () => [...this.peers.values()].map(peer => this.chatPeer(peer)), undefined, anchorForEvent,
      flags.zonedWorld ? (broadcast, senderPose, eventId) => this.fanoutChat(broadcast, senderPose, eventId) : undefined) : undefined;
    this.funding = flags.fundingLoop ? new WorldFunding(env, () => [...this.peers.values()].map(peer => ({
      id: peer.id, deviceId: peer.fundingDeviceId, pose: peer.pose, onFoot: !this.vehicles.occupants.has(peer.id),
    })), work => ctx.waitUntil(work), profile => this.updateFundingIdentity(profile), anchorForEvent) : undefined;
    this.drops = flags.fundDrops ? new WorldDrops(env, () => [...this.peers.values()].map(peer => ({
      id: peer.id, deviceId: peer.fundingDeviceId, pose: peer.pose,
    })), work => ctx.waitUntil(work), anchorForEvent) : undefined;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_outbid_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)');
    this.outbidRevision = ctx.storage.sql.exec<{ revision: number }>('SELECT revision FROM world_outbid_revision WHERE id=1').toArray()[0]?.revision ?? 0;
    const now = Date.now();
    this.cableCars?.step(now);
    this.sessions.prune(now);
    const departed = new Set<number>();
    for (const socket of ctx.getWebSockets()) {
      const attachment: unknown = socket.deserializeAttachment();
      if (!attachment || typeof attachment !== 'object' || !('kind' in attachment)) {
        this.closeSocket(socket, CloseCode.BAD_RESUME); continue;
      }
      const analyticsServer = this.analytics && 'analyticsServer' in attachment ? attachment.analyticsServer as AnalyticsServerContext : undefined;
      const deviceId = 'fundingDeviceId' in attachment && typeof attachment.fundingDeviceId === 'string' ? attachment.fundingDeviceId : undefined;
      const spokenBubbles = 'spokenBubbles' in attachment && attachment.spokenBubbles === true;
      if (attachment.kind === 'pending' && 'expiresAt' in attachment && typeof attachment.expiresAt === 'number' && attachment.expiresAt > now) {
        const spawn = flags.deepLinkSpawns && 'spawn' in attachment && typeof attachment.spawn === 'string' ? parseSpawnQuery(attachment.spawn) : undefined;
        const grant = 'grant' in attachment && validAdmissionToken(attachment.grant) ? attachment.grant : undefined;
        const fundingNickname = 'fundingNickname' in attachment && typeof attachment.fundingNickname === 'string' ? normalizeNickname(attachment.fundingNickname) ?? undefined : undefined;
        this.connections.set(socket, { expiresAt: attachment.expiresAt, credit: 60, budgetAt: now, spawn, grant, fundingDeviceId: deviceId, fundingNickname, analyticsServer, spokenBubbles });
      } else if (attachment.kind === 'session' && 'id' in attachment && typeof attachment.id === 'number' && 'generation' in attachment) {
        const session = this.sessions.get(attachment.id);
        // gtasf-j7wvv: a DO restart with players attached re-checks each socket against STORED session state; log every
        // socket it closes here (these never pass through remove(), so the close-cause line above can't see them).
        const wakeClose = (code: number, why: string) => { console.warn('world socket closed on wake', `player ${attachment.id}`, `code ${code}`, why, `| sockets ${ctx.getWebSockets().length}`); this.closeSocket(socket, code); };
        if (!session) { departed.add(attachment.id); wakeClose(CloseCode.BAD_RESUME, 'no stored session'); continue; }
        if (session.generation !== attachment.generation) { wakeClose(CloseCode.SUPERSEDED, `generation ${attachment.generation} != stored ${session.generation}`); continue; }
        if (session.lastSeen + IDLE_MS <= now) { departed.add(session.id); wakeClose(CloseCode.IDLE, `stored lastSeen ${now - session.lastSeen} ms ago`); continue; }
        if (flags.worldCapacity && session.lastInput + INPUT_IDLE_MS <= now) { departed.add(session.id); wakeClose(CloseCode.INPUT_IDLE, `stored lastInput ${now - session.lastInput} ms ago`); continue; }
        this.install(socket, session, now, deviceId, analyticsServer, spokenBubbles);
      } else if (attachment.kind === 'observer' && 'pose' in attachment && typeof attachment.pose === 'string') {
        // Read-only cross-zone viewer; recovered without a session (zonedWorld only).
        const pose = flags.zonedWorld ? parseSpawnQuery(attachment.pose) : undefined;
        if (pose && 'clientKey' in attachment && typeof attachment.clientKey === 'string') this.connections.set(socket, { observer: true, observerPose: pose, observerClientKey: attachment.clientKey, expiresAt: now + IDLE_MS, credit: 60, budgetAt: now });
        else this.closeSocket(socket, CloseCode.BAD_RESUME);
      } else this.closeSocket(socket, CloseCode.BAD_RESUME);
    }
    for (const id of departed) if (!this.peers.has(id)) this.broadcast({ type: 'PLAYER_LEAVE', id });
    this.ticker.ensureTicking();
    this.arm();
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!this.roadsReady && !roadFreeRoute(path, request.method)) await this.roadsLoad; // worldRoadsBackground
    // Founder-ladder tap pitch (phase 2): a curated line (no mic) judged by the same AI judge as voice. Handled
    // here in the main DO (not WorldFunding) because the OpenRouter key lives on this env. Must precede the funding forward.
    if (path === '/api/funding/pitch-text' && request.method === 'POST') return this.handlePitchTap(request);
    // Founder-ladder phase 5.1 drive quest (flags.driveQuest): start the "escape the cone" timer next to the
    // protester, then complete it server-verified (escapedCone from the authoritative pose). Precede the forward.
    if (path === '/api/funding/drive-start' && request.method === 'POST') return this.handleDriveStart(request);
    if (path === '/api/funding/drive-complete' && request.method === 'POST') return this.handleDriveComplete(request);
    // Phase 5.1 share quest (flags.shareQuest): a once-ever client-trust claim next to the thought-leader.
    if (path === '/api/funding/share-claim' && request.method === 'POST') return this.handleShareClaim(request);
    if (path === '/api/funding/mission-start' && request.method === 'POST') return this.handleMissionStart(request);
    if (path === '/api/funding/mission-complete' && request.method === 'POST') return this.handleMissionComplete(request);
    if (path === '/api/funding/missions' && request.method === 'GET') return this.handleMissionList(request);
    if (path === '/api/funding/mission-abandon' && request.method === 'POST') return this.handleMissionAbandon(request);
    // LANE C live street races (flags.streetRaces): host at a time-trial marker / join an invite.
    if (path === '/api/funding/race-host' && request.method === 'POST') return this.handleRace(request, 'host');
    if (path === '/api/funding/heist-join' && request.method === 'POST') return this.handleHeistJoin(request); // co-op heist
    if (path === '/api/funding/race-join' && request.method === 'POST') return this.handleRace(request, 'join');
    // LANE C SF pilgrimage (flags.pilgrimage): the collected list + a pose-checked, approached-by-travel landmark claim.
    if (path === '/api/funding/pilgrimage' && request.method === 'GET') return this.handlePilgrimageList(request);
    if (path === '/api/funding/pilgrimage-claim' && request.method === 'POST') return this.handlePilgrimageClaim(request);
    // GTA-pivot time trials (flags.timeTrials): server-recorded start (pose at the route start) + a pose-checked,
    // server-timed finish submit — the authoritative anti-spoof the worker edge couldn't do. [review fix 2]
    if (path === '/api/funding/tt-start' && request.method === 'POST') return this.handleTimeTrialStart(request);
    if (path === '/api/funding/tt-submit' && request.method === 'POST') return this.handleTimeTrialSubmit(request);
    // LANE B store robbery (flags.storeRobberies): server-validated hold-up (start records the hold, complete pays
    // after >=2.5s + a pose re-check) → valuation payout + 2-star wanted. [review fix 2]
    if (path === '/api/funding/rob-start' && request.method === 'POST') return this.handleRobStart(request);
    if (path === '/api/funding/buy-armour' && request.method === 'POST') return this.handleBuyArmour(request); // vitalsPickups
    if (path === '/api/funding/rob-complete' && request.method === 'POST') return this.handleRobComplete(request);
    // LANE C personal car (flags.personalCar, critique #20): where my car is, and "Deliver my car" to the nearest road.
    if (path === '/api/funding/personal-car' && request.method === 'GET') return this.handlePersonalCar(request);
    if (path === '/api/funding/personal-car-deliver' && request.method === 'POST') return this.handlePersonalCarDeliver(request);
    // LANE C garage phase 1 (flags.garageSlots, critique 20e, docs/PLAN-garage.md): list (+ tier gifts), keep, deliver a slot.
    if (path === '/api/funding/garage' && request.method === 'GET') return this.handleGarage(request);
    if (path === '/api/funding/garage-keep' && request.method === 'POST') return this.handleGarageKeep(request);
    if (path === '/api/funding/garage-deliver' && request.method === 'POST') return this.handleGarageDeliver(request);
    if (path.startsWith('/api/funding/')) return this.funding ? this.funding.handle(request) : admissionJson({ error: 'Funding gameplay is disabled' }, 503);
    if (path.startsWith('/api/drops/')) return this.drops ? this.drops.handle(request) : admissionJson({ error: 'Fund drops are disabled' }, 503);
    if (path === '/internal/outbid/changed') {
      if (!flags.outbidBanner && !flags.outbidCrown) return admissionJson({ error: 'Outbid display disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      if (!body || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0)
        return admissionJson({ error: 'Invalid revision' }, 400);
      if (body.revision > this.outbidRevision) {
        this.outbidRevision = body.revision;
        this.ctx.storage.sql.exec('INSERT INTO world_outbid_revision VALUES (1,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision', this.outbidRevision);
        this.broadcast({ type: 'OUTBID_CHANGED', revision: this.outbidRevision });
      }
      return admissionJson({ revision: this.outbidRevision });
    }
    // Spoken bubbles (gtasf-qjja). Internal only: the Worker's /api/voice/caption route forwards here after its gates.
    if (path === '/internal/voice/caption' && request.method === 'POST') return this.handleCaption(request);
    if (path === '/internal/voice/caption-ring') {
      const device = new URL(request.url).searchParams.get('device') ?? '';
      return admissionJson({ lines: flags.voiceCaptions ? this.captionRing.recent(device, Date.now()) : [] });
    }
    if (path === '/internal/chat/relay') {
      // Cross-border chat (zoned): a sibling cell relays an already-moderated broadcast; deliver to this
      // cell's matching peers. Reachable only through the World binding, same code on both sides.
      if (!flags.chat || !flags.zonedWorld || !this.chat) return admissionJson({ error: 'Chat relay disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      const b = body?.broadcast as S2CMessage | undefined, sp = body?.senderPose as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      if (!b || b.type !== 'CHAT_BROADCAST' || !sp || typeof sp.x !== 'number' || typeof sp.y !== 'number' || typeof sp.z !== 'number')
        return admissionJson({ error: 'Invalid relay' }, 400);
      const eventId = Number((body as { eventId?: unknown }).eventId) || 0;
      try { this.chat.relayIncoming(b, { x: sp.x, y: sp.y, z: sp.z, yaw: 0, flags: 0 }, eventId); }
      catch { /* a malformed relayed frame must never crash the receiving cell */ }
      return admissionJson({ ok: true });
    }
    if (path === '/internal/mayhem/relay') {
      // Cross-border Playful Mayhem (zoned): a sibling cell relays an already-validated+rate-limited
      // fire; show it to this cell's peers near the splat. Cosmetic; reachable only via the World binding.
      if (!flags.playfulMayhem || !flags.zonedWorld) return admissionJson({ error: 'Mayhem relay disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      const b = body?.broadcast as S2CMessage | undefined;
      if (!b || b.type !== 'MAYHEM_FIRE') return admissionJson({ error: 'Invalid relay' }, 400);
      this.relayMayhemNearby(b); // no sender exclusion: the firer lives in the origin cell
      return admissionJson({ ok: true });
    }
    if (path === '/internal/handoff/claim') {
      if (!this.transfers) return admissionJson({ error: 'Zoned world disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      const owner = typeof body?.id === 'number' ? this.sessions.get(body.id) : undefined;
      if (owner && owner.generation !== body?.generation) return admissionJson({ error: 'Superseded transfer' }, 409);
      if (!body || typeof body.id !== 'number' || typeof body.generation !== 'number' || typeof body.key !== 'string'
        || !this.transfers.claim(body.id, body.generation, body.key, Date.now())) return admissionJson({ error: 'Expired transfer' }, 409);
      const peer = this.peers.get(body.id);
      if (peer?.session.generation === body.generation) {
        this.handingOff.add(peer.id);
        this.remove(peer.socket, CloseCode.SUPERSEDED);
      }
      this.sessions.depart(body.id, body.generation);
      return admissionJson({ ok: true });
    }
    if (path === '/internal/handoff/receive') {
      // Seamless handoff (zoned, gtasf-djjz): the origin cell transfers a crossing player's session
      // here so a resume preserves its id (no border blink). Reachable only via the World binding.
      if (!flags.zonedWorld) return admissionJson({ error: 'Zoned world disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request, 2_000_000) : undefined;
      const s = body?.session as { id?: unknown; token?: unknown; name?: unknown; generation?: unknown; seq?: unknown; accepted?: unknown; carryCm?: unknown; pose?: { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; flags?: unknown } } | undefined;
      const p = s?.pose;
      if (!s || typeof s.id !== 'number' || typeof s.token !== 'string' || typeof s.name !== 'string' || typeof s.generation !== 'number'
        || !p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number' || typeof p.yaw !== 'number' || typeof p.flags !== 'number')
        return admissionJson({ error: 'Invalid handoff' }, 400);
      const now = Date.now();
      const transfer = body?.transfer;
      if (transfer !== undefined && !validZoneTransfer(transfer, now)) return admissionJson({ error: 'Invalid transfer' }, 400);
      if (transfer) {
        const index = cellIndex(SF_ZONE_GRID, transfer.to.cx, transfer.to.cy);
        if (this.zoneCellIndex !== undefined && this.zoneCellIndex !== index) return admissionJson({ error: 'Wrong destination zone' }, 409);
        if (this.zoneCellIndex === undefined) {
          this.zoneCellIndex = index;
          this.ctx.storage.sql.exec('INSERT INTO world_zone VALUES (1,?)', index);
          this.configureZoneFleet();
        }
        const v = transfer.vehicle;
        const expectedFlags = v?.mode === 'driver' ? DRIVER_FLAG : v ? PASSENGER_FLAG : 0;
        if ((p.flags & 0xc0) !== expectedFlags) return admissionJson({ error: 'Seat does not match pose' }, 400);
        if (v && v.mode !== 'cable' && ['x', 'y', 'z', 'yaw'].some(k => p[k as keyof typeof p] !== v.state.pose[k as keyof Pose]))
          return admissionJson({ error: 'Vehicle does not match pose' }, 400);
        if (v && v.mode !== 'cable' && this.vehicles.cars.has(v.id)) return admissionJson({ error: 'Vehicle already owned' }, 409);
      }
      const session: WorldSession = {
        id: s.id, token: s.token, name: s.name, generation: s.generation,
        movement: { pose: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, flags: p.flags }, seq: Number(s.seq) || 0, accepted: !!s.accepted, lastAt: now, carryCm: Number(s.carryCm) || 0 },
        lastSeen: now, lastInput: now, expiresAt: now, appearance: Math.max(0, Math.min(0x3ffffff, Number((s as { appearance?: unknown }).appearance) || 0)),
      };
      const previous = this.transfers?.incoming(session.token);
      if (transfer && previous && previous.generation === session.generation && previous.transfer.key !== transfer.key
        && previous.transfer.expiresAt > now) return admissionJson({ error: 'Transfer already pending' }, 409);
      const result = this.sessions.adopt(session, now);
      if (typeof result !== 'string' && transfer) {
        // A timed-out, unclaimed prepare may be retried at the source's newer accepted pose.
        if (previous?.generation === session.generation && previous.transfer.key !== transfer.key && !this.peers.has(session.id)) this.sessions.save(session);
        this.transfers!.prepare(session.id, session.token, session.generation, transfer);
      }
      return typeof result === 'string' ? admissionJson({ error: result }, 400) : admissionJson({ ok: true, id: result.id });
    }
    if (path === '/internal/observers/authorize') {
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      const peer = body && Number.isInteger(body.id) ? this.peers.get(Number(body.id)) : undefined;
      const target = body?.target as { cx?: unknown; cy?: unknown } | undefined;
      const allowed = flags.zonedWorld && this.zoneCellIndex !== undefined && peer
        && peer.session.token === body?.token && peer.session.lastSeen + IDLE_MS > Date.now()
        && target && typeof target.cx === 'number' && typeof target.cy === 'number'
        && observerTargetAllowed(peer.pose, cellFromIndex(SF_ZONE_GRID, this.zoneCellIndex), { cx: target.cx, cy: target.cy });
      return admissionJson({ ok: !!allowed }, allowed ? 200 : 403);
    }
    if (path === '/internal/friends/presence') {
      // Friends panel presence (gtasf-q4yo): which of these device ids are connected to THIS world
      // instance, where (x,z) and at what funding stage (from the cosmetic appearance — no funding
      // query). The friends route fans this across the world instance(s) and maps devices->usernames.
      if (!flags.friends) return admissionJson({ error: 'Friends disabled' }, 503);
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      const want = new Set((Array.isArray(body?.deviceIds) ? body!.deviceIds as unknown[] : []).filter((d): d is string => typeof d === 'string').slice(0, 200));
      const presence: Record<string, { x: number; z: number; stage: number }> = {};
      for (const peer of this.peers.values()) {
        const device = peer.fundingDeviceId;
        if (device && want.has(device) && !presence[device]) presence[device] = { x: peer.pose.x, z: peer.pose.z, stage: decodeAppearance(peer.appearance).stageRound };
      }
      return admissionJson({ presence });
    }
    // These routes are reachable only through the World binding. The public Worker forwards /api/world exactly.
    if (path === '/internal/admission/reserve' || path === '/internal/admission/cancel') {
      const body = request.method === 'POST' ? await smallJson(request) : undefined;
      if (!body || !validAdmissionToken(body.ticket)) return admissionJson({ error: 'Invalid ticket' }, 400);
      const now = Date.now(); this.expire(now);
      if (path.endsWith('/cancel')) { this.reservations.cancel(body.ticket); this.arm(); return admissionJson({ ok: true }); }
      if (!flags.worldCapacity || launchMode(this.env) === 'waitlist') return admissionJson({ error: 'Admission disabled' }, 503);
      const result = this.reservations.reserve(body.ticket, now, this.peers.size, worldCapacity(this.env));
      this.arm(); return admissionJson(result);
    }
    if (path !== '/api/world') return new Response('Not found', { status: 404 });
    if (!flags.multiplayer) return new Response('Multiplayer disabled', { status: 503 });
    if (!await launchAllowed(request, this.env)) return admissionJson({ status: 'waitlist' }, 403);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (!request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(x => x.trim()).includes(PROTOCOL_SUBPROTOCOL)) return new Response('Protocol required', { status: 400 });
    if (flags.zonedWorld && this.zoneCellIndex === undefined) {
      // Same routing function index.ts used, so every connection here resolves to this cell.
      const cell = resolveZoneCell(new URL(request.url));
      this.zoneCellIndex = cellIndex(SF_ZONE_GRID, cell.cx, cell.cy);
      this.ctx.storage.sql.exec('INSERT INTO world_zone VALUES (1,?)', this.zoneCellIndex);
      this.configureZoneFleet();
    }
    if (flags.zonedWorld && new URL(request.url).searchParams.get('observe') === '1') {
      // Read-only neighbour-zone viewer (docs/engineering/zoned-world.md §5-§7): no grant,
      // capacity, session or funding, and never a peer so this zone's players never see it.
      // Carries a filter pose (from ?spawn) refreshed by non-authoritative MOVE.
      const now = Date.now(); this.expire(now);
      if (!fundingSameOrigin(request)) return admissionJson({ error: 'Same-origin request required' }, 403);
      const identity = readObserverIdentity(request.headers.get('Sec-WebSocket-Protocol'), SF_ZONE_GRID);
      if (!identity || this.zoneCellIndex === undefined) return admissionJson({ error: 'Home session required' }, 403);
      const source = this.env.WORLD.get(this.env.WORLD.idFromName(zoneId(identity.home.cx, identity.home.cy)));
      try {
        const response = await source.fetch('https://world.internal/internal/observers/authorize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: identity.id, token: identity.token, target: cellFromIndex(SF_ZONE_GRID, this.zoneCellIndex) }),
        });
        if (!response.ok) return admissionJson({ error: 'Observer session rejected' }, 403);
      } catch { return admissionJson({ error: 'Home session unavailable' }, 503); }
      // One event Wi-Fi or staging runner can host many real players. Limits follow the verified
      // player, not CF-Connecting-IP; the cap permits an old/new socket during a handoff.
      const clientKey = `player:${identity.id}`;
      let observerCount = 0, clientObserverCount = 0;
      for (const c of this.connections.values()) if (c.observer) { observerCount++; if (c.observerClientKey === clientKey) clientObserverCount++; }
      const observerReject = observerRejectStatus(fundingSameOrigin(request), observerCount, observerZoneCap(worldCapacity(this.env)), clientObserverCount, OBSERVER_PER_CLIENT_CAP);
      if (observerReject) return admissionJson({ error: observerReject === 403 ? 'Same-origin request required' : 'Zone observer capacity reached' }, observerReject);
      const pose = parseSpawnQuery(new URL(request.url).searchParams.get('spawn')) ?? { ...LOCAL_SPAWN };
      const pair = new WebSocketPair(), client = pair[0], socket = pair[1];
      this.ctx.acceptWebSocket(socket);
      socket.serializeAttachment({ kind: 'observer', pose: `${pose.x},${pose.y},${pose.z},${pose.yaw}`, clientKey } satisfies Attachment);
      this.connections.set(socket, { observer: true, observerPose: pose, observerClientKey: clientKey, expiresAt: now + IDLE_MS, credit: 60, budgetAt: now });
      this.arm();
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL } });
    }
    let deviceId: string | undefined, fundingNickname: string | undefined;
    if (this.funding || this.referralPlay) {
      if (!fundingSameOrigin(request)) return admissionJson({ error: 'Same-origin request required' }, 403);
      try {
        deviceId = await fundingDevice(request, this.env.DB) ?? undefined;
        if (deviceId && this.funding) {
          const profile = await this.funding.profileForConnection(deviceId);
          fundingNickname = normalizeNickname(profile.nickname) ?? undefined;
        }
      }
      catch { /* Funding persistence must not prevent the existing city from connecting. */ }
      // Legacy clients still join the city. Only a verified device binding may earn funding.
    }
    const now = Date.now(); this.expire(now);
    const grant = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()).find(value => value.startsWith(ADMISSION_PROTOCOL_PREFIX))?.slice(ADMISSION_PROTOCOL_PREFIX.length);
    if (flags.worldCapacity && (!validAdmissionToken(grant) || !this.reservations.claim(grant, now)))
      return admissionJson({ error: 'Join the admission queue' }, 429);
    const pair = new WebSocketPair(), client = pair[0], socket = pair[1];
    this.ctx.acceptWebSocket(socket);
    const expiresAt = now + HELLO_MS;
    const rawSpawn = new URL(request.url).searchParams.get('spawn'), spawn = flags.deepLinkSpawns ? parseSpawnQuery(rawSpawn) : undefined;
    const analyticsServer = this.analytics ? analyticsServerContext(request) : undefined;
    // Capability from the client build (?caps=spoken): only those clients may receive CHAT_SPOKEN; older builds close
    // their socket on an unknown opcode (gtasf-6ef9), so they get the same bubble as a plain CHAT_BROADCAST.
    const spokenBubbles = (new URL(request.url).searchParams.get('caps') ?? '').split(',').includes('spoken');
    socket.serializeAttachment({ kind: 'pending', expiresAt, ...(spokenBubbles ? { spokenBubbles: true as const } : {}), ...(analyticsServer ? { analyticsServer } : {}), ...(spawn ? { spawn: rawSpawn! } : {}), ...(grant ? { grant } : {}), ...(deviceId ? { fundingDeviceId: deviceId } : {}), ...(fundingNickname ? { fundingNickname } : {}) } satisfies Attachment);
    this.connections.set(socket, { expiresAt, credit: 60, budgetAt: now, spawn, grant, fundingDeviceId: deviceId, fundingNickname, analyticsServer, spokenBubbles });
    this.arm();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL } });
  }

  override async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (!this.roadsReady) await this.roadsLoad; // worldRoadsBackground: a woken socket's first message waits for the graph, as before
    const connection = this.connections.get(socket); let now = Date.now();
    if (!connection) { this.closeSocket(socket, CloseCode.BAD_RESUME); return; }
    // Bound work before decoding. No client timestamp can refill this budget.
    connection.credit = Math.min(60, connection.credit + Math.max(0, now - connection.budgetAt) * 0.03);
    connection.budgetAt = now;
    // gtasf-j7wvv: every server-side PROTOCOL close names its cause, so a client log can tell it from a client-side 4004.
    if (--connection.credit < 0) { this.remove(socket, CloseCode.PROTOCOL, BUDGET_CLOSE_REASON); return; }
    if (typeof data === 'string') { this.remove(socket, CloseCode.PROTOCOL, 'server: text frame'); return; }
    const decoded = decodeC2S(new Uint8Array(data));
    if (!decoded.ok) { this.remove(socket, CloseCode.PROTOCOL, `server: bad frame ${decoded.err} op=0x${(new Uint8Array(data)[0] ?? 0).toString(16)}`); return; }
    const message = decoded.msg;
    if (connection.observer) {
      // Read-only: MOVE only refreshes the filter pose (never an authoritative player move),
      // PING is answered, anything else is a protocol violation.
      if (message.type === 'MOVE') {
        // gtasf-obsv-4un5: accept a new filter pose at most once per world tick. A faster sweep gains no
        // data (snapshots are per-tick) and must not become a cheap player-position enumeration oracle.
        if (observerPoseUpdateAllowed(now, connection.observerPoseAt)) {
          connection.observerPose = { x: message.x, y: message.y, z: message.z, yaw: message.yaw, flags: 0 };
          connection.observerPoseAt = now;
        }
        connection.expiresAt = now + IDLE_MS;
      }
      else if (message.type === 'PING') { connection.expiresAt = now + IDLE_MS; socket.send(encodeS2C({ type: 'PONG', nonce: message.nonce, clientT: message.clientT, serverT: now })); }
      else if (message.type === 'ACTIVITY') { connection.expiresAt = now + IDLE_MS; }
      else this.remove(socket, CloseCode.PROTOCOL, `server: observer sent ${message.type}`);
      return;
    }
    if (!connection.peer) {
      if (connection.claiming) return;
      if (connection.expiresAt <= now || message.type !== 'HELLO') { this.remove(socket, CloseCode.BAD_HELLO); return; }
      if (flags.worldCapacity && (this.peers.size >= worldCapacity(this.env) || !connection.grant || !this.reservations.consume(connection.grant, now))) {
        this.remove(socket, CloseCode.CAPACITY); return;
      }
      // Zoned: seed a fresh session's id into this cell's block so player ids are globally
      // unique across zones (gtasf-l1qi/xlbt); resumes keep their existing id.
      const firstId = flags.zonedWorld && this.zoneCellIndex !== undefined ? globalPlayerId(this.zoneCellIndex, 1) : undefined;
      const incoming = message.resumeToken ? this.transfers?.incoming(message.resumeToken) : undefined;
      if (incoming) {
        connection.claiming = true;
        const { transfer } = incoming;
        try {
          const response = await this.env.WORLD.get(this.env.WORLD.idFromName(zoneId(transfer.from.cx, transfer.from.cy))).fetch('https://world.internal/internal/handoff/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: incoming.id, generation: incoming.generation, key: transfer.key }),
          });
          if (!response.ok) { this.remove(socket, CloseCode.BAD_RESUME); return; }
        } catch { this.remove(socket, 4000); return; } // retry the same token after a lost claim response
        if (this.connections.get(socket) !== connection) return;
        connection.claiming = false; now = Date.now();
      }
      const session = this.sessions.admit(connection.fundingNickname ?? message.name, message.resumeToken, now, firstId);
      if (typeof session === 'string') {
        this.remove(socket, session === 'BAD_RESUME' ? CloseCode.BAD_RESUME : CloseCode.BAD_HELLO); return;
      }
      if (connection.fundingNickname) this.sessions.rename(session, connection.fundingNickname);
      if (incoming?.transfer.vehicle && !this.restoreTransferredVehicle(session.id, incoming.transfer.vehicle, now)) {
        this.remove(socket, CloseCode.BAD_RESUME); return;
      }
      if (incoming) this.transfers!.activate(incoming.id, incoming.generation);
      if (this.dropGrace.has(session.id)) { // reconnectGrace: a ?at= resume ends the held ride/runs; a plain resume keeps them
        if (connection.spawn && !incoming) this.settleDropGrace(now, session.id);
        else { this.dropGrace.delete(session.id); this.taxis.resume(session.id, now); this.rebindHeldRuns(session); }
      }
      // gtasf-t9joj: after a 1006 the client often resumes BEFORE the server has seen the old socket close (a peer swap, no
      // dropGrace entry yet). The resume still bumps the generation, so the held runs must be rebound here too or a finished
      // trial / delivery answers 'stale-session'. Same session + device; a ?at= spawn override still clears them below.
      else if (flags.reconnectGrace && !(connection.spawn && !incoming)) this.rebindHeldRuns(session);
      if (connection.spawn && !incoming) {
        this.taxis.disconnect(session.id, now); this.vehicles.disconnect(session.id, now);
        Object.assign(session.movement, { pose: connection.spawn, lastAt: now, carryCm: MOVE_BURST_CM });
        this.sessions.save(session);
        // review fix 2b (resume bypass): a ?at= deep-link/share spawn override teleports the resumed session, so
        // drop any in-flight mission/trial/quest for this device — a reload can't resume one into a free payout.
        // (The old socket's remove() was pre-empted by the peer swap below, so this is the only clear on this path.)
        if (connection.fundingDeviceId) this.clearDeviceQuests(connection.fundingDeviceId);
      } else if (!this.vehicles.occupants.has(session.id)) {
        // A local runtime restart resets the fleet; resumed players return on foot at their last location.
        session.movement.pose = { ...session.movement.pose, flags: session.movement.pose.flags & 0x3f };
      }
      const old = this.peers.get(session.id);
      this.funding?.disconnect(session.id, now);
      // Replace the map entry before closing the old transport; its late callbacks cannot remove us.
      const peer = this.install(socket, session, now, connection.fundingDeviceId, connection.analyticsServer, connection.spokenBubbles);
      socket.serializeAttachment({ kind: 'session', id: session.id, generation: session.generation, ...(connection.spokenBubbles ? { spokenBubbles: true as const } : {}), ...(connection.analyticsServer ? { analyticsServer: connection.analyticsServer } : {}), ...(peer.fundingDeviceId ? { fundingDeviceId: peer.fundingDeviceId } : {}) } satisfies Attachment);
      if (old) { this.connections.delete(old.socket); this.closeSocket(old.socket, CloseCode.SUPERSEDED); }
      peer.send(encodeS2C({ type: 'WELCOME', id: session.id, serverT: now, name: session.name, pose: peer.pose,
        resumeToken: session.token, lastMoveSeq: session.movement.seq, resumed: !!message.resumeToken }));
      if (this.peers.get(peer.id) !== peer) return;
      this.sendCombatJoinState(peer, now); // after WELCOME (gtasf-awnin)
      // P0 bisect review loose end: never an unhandled rejection from the restore (a D1 blip during the CF DO incident).
      if (flags.personalCar) this.ctx.waitUntil(this.restorePersonal(peer).catch(error => console.warn('personal car restore failed', error instanceof Error ? error.name : 'unknown')));
      if (this.analytics) this.ctx.waitUntil(this.analytics.joined(session.id, connection.analyticsServer, message.analytics).catch(() => undefined));
      if (flags.outbidBanner || flags.outbidCrown) peer.send(encodeS2C({ type: 'OUTBID_CHANGED', revision: this.outbidRevision }));
      for (const other of this.peers.values()) if (other !== peer) {
        peer.send(encodeS2C({ type: 'PLAYER_JOIN', id: other.id, name: other.session.name, pose: other.pose }));
        other.send(encodeS2C({ type: 'PLAYER_JOIN', id: peer.id, name: session.name, pose: peer.pose }));
        if (flags.characterLooks || flags.personalRides) {
          // Replay each side's latest look right after its PLAYER_JOIN (join ordering unchanged).
          peer.send(encodeS2C({ type: 'APPEARANCE', id: other.id, appearance: other.appearance }));
          other.send(encodeS2C({ type: 'APPEARANCE', id: peer.id, appearance: peer.appearance }));
        }
      }
      if (flags.driving || flags.robotaxi || flags.traffic || flags.cableCars) {
        peer.send(encodeS2C(this.vehicleSnapshot(peer, now)));
        for (const state of this.vehicles.states()) peer.send(encodeS2C(state));
        this.taxis.state(peer.id);
      }
      this.ticker.ensureTicking(); this.arm(); return;
    }
    const peer = connection.peer;
    if (this.peers.get(peer.id) !== peer) { this.remove(socket, CloseCode.SUPERSEDED); return; }
    if (message.type === 'HELLO') { this.remove(socket, CloseCode.PROTOCOL, 'server: repeated HELLO'); return; }
    const session = peer.session;
    if (flags.worldCapacity && session.lastInput + INPUT_IDLE_MS <= now) { this.remove(socket, CloseCode.INPUT_IDLE); return; }
    session.lastSeen = now; session.expiresAt = now + IDLE_MS + RESUME_GRACE_MS;
    // Heartbeats and automatic/replayed pose updates (MOVE) are not human input; the client signals real
    // activity with ACTIVITY. Customising your look is deliberate human activity too (SET_APPEARANCE), so
    // onboarding/wardrobe isn't idle-disconnected once worldCapacity and characterLooks are both on
    // (gtasf-apidle-chad).
    if (message.type === 'ACTIVITY' || message.type === 'VEHICLE_ENTER' || message.type === 'VEHICLE_EXIT' ||
      message.type === 'ROBOTAXI_HAIL' || message.type === 'ROBOTAXI_CANCEL' || message.type === 'CHAT' ||
      message.type === 'ROAD_RESPAWN' || message.type === 'SET_APPEARANCE' || message.type === 'MAYHEM_FIRE' ||
      message.type === 'COMBAT_FIRE' || message.type === 'COMBAT_CRIME') session.lastInput = now;
    // The prepared pose is immutable until destination claim or timeout. Never let both zones drive it.
    if (this.handingOff.has(peer.id) && message.type !== 'PING' && message.type !== 'ACTIVITY') return;
    if (message.type === 'ANALYTICS') {
      // No context is retained: withdrawal is silent, opt-in only applies to this confirmed peer.
      if (this.analytics && message.analytics) this.ctx.waitUntil(this.analytics.joined(session.id, connection.analyticsServer, message.analytics).catch(() => undefined));
    } else if (message.type === 'MOVE') {
      if (this.vehicles.occupants.has(peer.id)) { /* Seat movement comes from the owning vehicle. */ }
      else {
        // On foot: brisk walk 4, sprint 8 m/s (v2.1 gtasf-v21-walk-sprint). The cap carries sprint + 3D-hill
        // + jitter slack. Mounted ride tiers come from the verified funding profile; cosmetic metadata
        // cannot grant speed. Unmounted players retain the walking cap at every funding stage.
        const cap = flags.personalRides && (message.flags & RIDING_POSE_FLAG)
          ? rideSpeedCapMps(this.funding?.roundForMovement(peer.fundingDeviceId, now) ?? FUNDING_ROUNDS[0]!, ON_FOOT_CAP_MPS)
          : ON_FOOT_CAP_MPS;
        if (checkMovement(session.movement, message, now, cap)) {
          peer.pose = session.movement.pose;
          this.notePoseProgress(peer);
          if (flags.zonedWorld && this.zoneCellIndex !== undefined) this.maybeHandoff(peer);
        } else peer.send(encodeS2C({ type: 'CORRECTION', pose: peer.pose }));
      }
    } else if (message.type === 'PING') {
      peer.send(encodeS2C({ type: 'PONG', nonce: message.nonce, clientT: message.clientT, serverT: now }));
    } else if (flags.driving && flags.kerbCarTheft && message.type === 'KERB_CAR_TAKE') {
      this.guarded('kerbCarTheft', () => this.stealKerbCar(peer, message, now)); // founder playtest gtasf-0lnjq: kerb-parked props are stealable
    } else if (flags.driving && flags.openingDrive && message.type === 'OPENING_CAR') {
      this.guarded('openingCar', () => this.giveOpeningCar(peer, message.yaw, now)); // critique #13: the opening starts in a car
    } else if (flags.driving && flags.carjacking && message.type === 'VEHICLE_ENTER' && this.police.entryById(message.vehicleId)) {
      // Founder playtest: E on an SFPD cruiser did nothing (it's a police unit, not traffic). GTA rule: you can steal
      // a cop car, and it raises wanted. It leaves the pursuit and becomes this player's car (livery kept).
      this.guarded('copCarTheft', () => this.stealPoliceCar(peer, message.vehicleId, now));
    } else if ((flags.driving || flags.cableCars || flags.muni) && message.type === 'VEHICLE_ENTER') {
      // Seed the client with the exact NPC speed/pose used for this synchronous takeover.
      if (flags.rideAnyVehicle) peer.send(encodeS2C(this.vehicleSnapshot(peer, now)));
      const moving = flags.rideAnyVehicle ? this.movingRides.enter(peer.id, peer.pose, message.vehicleId, now) : undefined;
      const entered = moving ?? (isScheduledTransit(message.vehicleId) ? this.cableCars?.board(peer.id, peer.pose, message.vehicleId, now)
        : flags.driving && this.vehicles.enter(peer.id, peer.pose, message.vehicleId, now));
      if (entered) this.taxis.cancel(peer.id, undefined, now);
      // Carjacking a MOVING traffic car (not a parked/owned one) is a car crime → raise car-theft wanted so the
      // SFPD react. `moving` is truthy only for a traffic-NPC takeover; parked-car theft via vehicles.enter is free.
      if (moving && flags.carjacking && wantedRaiseAllowed(flags)) this.raiseWanted(peer.id, 'car-theft', now); // review fix 4: wanted needs combat too
    } else if ((flags.driving || flags.robotaxi || flags.cableCars || flags.muni) && message.type === 'VEHICLE_EXIT') {
      if (this.movingRides.owns(peer.id)) {
        if (this.vehicles.occupants.get(peer.id) === message.vehicleId) this.movingRides.exit(peer.id, now);
      } else if (!this.taxis.cancel(peer.id, undefined, now)) this.vehicles.exit(peer.id, message.vehicleId, now);
    } else if (flags.driving && message.type === 'VEHICLE_MOVE') {
      if (this.vehicles.move(peer.id, message, now) && flags.zonedWorld && this.zoneCellIndex !== undefined) this.maybeHandoff(peer);
    } else if (flags.robotaxi && message.type === 'ROBOTAXI_HAIL') {
      if (flags.quickRobotaxi) this.ctx.waitUntil(this.taxis.hailQuick(peer.id, message.requestId, message.destination,
        message.quick ?? { title: 'Your destination', eventId: '', friend: '', maxFareCents: '' }, now));
      else this.taxis.hail(peer.id, message.requestId, message.destination, now);
    } else if (flags.robotaxi && flags.quickRobotaxi && message.type === 'ROBOTAXI_QUOTE') {
      this.ctx.waitUntil(this.taxis.quoteQuick(peer.id, message.requestId, message.destination, message.quick));
    } else if (flags.robotaxi && flags.quickRobotaxi && message.type === 'ROBOTAXI_READY') {
      this.taxis.ready(peer.id, message.requestId);
    } else if (flags.robotaxi && message.type === 'ROBOTAXI_CANCEL') {
      this.taxis.cancel(peer.id, message.requestId, now);
    } else if (flags.roadRespawn && message.type === 'ROAD_RESPAWN') {
      this.recoverRoad(peer, now);
    } else if (this.chat && (message.type === 'CHAT' || message.type === 'EVENT_JOIN' || message.type === 'EVENT_LEAVE')) {
      this.ctx.waitUntil(this.chat.handle(this.chatPeer(peer), message, now).catch(() => undefined));
    } else if ((flags.characterLooks || flags.personalRides) && message.type === 'SET_APPEARANCE') {
      // Cosmetic, opaque 26-bit id; store and relay to others. Never influences gameplay/funding.
      if (message.appearance >= 0 && message.appearance < 0x4000000 && message.appearance !== peer.appearance) {
        // Persist on the session row (save() at the end of this handler) so the look survives
        // hibernate/evict + resume; peer.appearance is the in-memory copy used for cosmetic relay.
        peer.appearance = session.appearance = message.appearance;
        const relay = encodeS2C({ type: 'APPEARANCE', id: peer.id, appearance: peer.appearance });
        for (const other of this.peers.values()) if (other !== peer) other.send(relay);
      }
    } else if (this.voice && (message.type === 'VOICE_PUBLISH' || message.type === 'VOICE_STOP' || message.type === 'VOICE_MUTE')) {
      this.handleVoice(peer, message);
    } else if (flags.playfulMayhem && message.type === 'MAYHEM_FIRE') {
      // Cosmetic party toy (gtasf-mayhem-sync-4fez): validate + per-peer rate-limit, then relay to
      // NEARBY peers stamped with senderId so everyone around sees the splat/confetti/splash. Never
      // gameplay/funding; a far peer that cannot see it is not sent the frame.
      const broadcast = this.mayhem.fire(peer.id, message, now);
      if (broadcast) {
        this.relayMayhemNearby(broadcast, peer.id);
        // Zoned: carry a near-border fire to the neighbour cells (like fanoutChat) so cross-border
        // viewers see it too; each sibling re-applies nearMayhem to its own peers.
        if (flags.zonedWorld && this.zoneCellIndex !== undefined) this.fanoutMayhem(broadcast, peer.pose);
      }
    } else if (flags.combat && flags.weapons && flags.serverHits && message.type === 'COMBAT_FIRE') {
      // Server-authoritative hit: validate fire rate/range against the shooter's AUTHORITATIVE pose, resolve the
      // nearest peer the ray hits, apply damage, and broadcast COMBAT_HIT. On a PvP kill, the SERVER applies the
      // valuation cost (server-minted 'srv:' incident id) and respawns the victim.
      this.guarded('combatFire', () => this.handleCombatFire(peer, message, now)); // gtasf-j7wvv: a throw can't take the DO down
    } else if (flags.combat && message.type === 'COMBAT_READY') {
      // The player accepted the 18+ gate (combat live): they may now be a PvP target. Unconfirmed players stay off
      // the target list (pvpTargets filters on combatActive), so they can't be shot before opting into combat.
      peer.combatActive = true;
    } else if (flags.combat && flags.vehicleDamage && message.type === 'VEHICLE_CRASH') {
      // The driver's own car crashed: self-damage only (trusted). Only an opted-in (18+) driver of that car, 4 reports/s
      // at most (crashReportAllowed) — an opted-out player can't be shot back, so must not be able to crash-bomb.
      const vehicleId = this.vehicles.occupants.get(peer.id);
      if (vehicleId !== undefined && crashReportAllowed(peer, this.vehicles.entry(vehicleId), this.crashAt.get(peer.id), now)) {
        this.crashAt.set(peer.id, now);
        // Review: the closing speed is capped by the server-measured speed of this car, and a crash only sets it
        // burning (it explodes on the burn timer, so people can run); the driver is credited with its blast.
        const closing = crashClosingCap(message.closing, this.driveSpeedPeak(peer.id, now));
        this.vehicleDamage.crash(vehicleId, crashDamage(closing), peer.id, now);
      }
    } else if (flags.combat && flags.pedMelee && message.type === 'PED_PUNCH') {
      // A pedestrian who fought back landed a swing (pedMelee). Self-damage only, so trusted, but the server owns the
      // amount and rate, and it goes through armour, spawn protection and the normal WASTED path.
      if (peer.combatActive && (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) === 0 && pedPunchAllowed(this.pedPunchAt.get(peer.id) ?? -Infinity, now)) {
        this.pedPunchAt.set(peer.id, now);
        const hit = this.combat.damage(peer.id, PED_PUNCH_DAMAGE, now);
        if (hit && !hit.killed) this.sendVitals(peer.id, true);
        if (hit?.killed) this.ctx.waitUntil(this.applyPvpDeath(peer, now).catch(() => undefined));
      }
    } else if (flags.streetCrimeWanted && message.type === 'COMBAT_CRIME') {
      // A confessed crime the server can't see (ped shot / run over, police car rammed). It can only raise the sender's own wanted level, so
      // it's trusted; rate-limited per player, and only for players who opted into combat. [gtasf-laneb-combat-epic-igho.3]
      if (peer.combatActive && wantedRaiseAllowed(flags)) {
        const crime = crimeForReport(message.kind, this.streetCrimeClock(peer.id), now);
        if (crime) this.raiseWanted(peer.id, crime, now, applyStreetCrime);
      }
    }
    this.chat?.presenceChanged(peer.id);
    this.funding?.presenceChanged(peer.id, now);
    // gtasf-j7wvv: this ran a SQLite UPDATE after EVERY message (~10/s per player at the MOVE rate). Durable Object output
    // gates hold outgoing WebSocket frames until pending writes commit, so every server frame waited on the latest write
    // (and it was ~860k row writes per player-day). The stored copy only matters if the DO restarts mid-session (remove()
    // saves on disconnect, so a same-instance resume is exact): persist at most every SESSION_SAVE_MS.
    if (this.peers.get(peer.id) === peer && now - (this.sessionSavedAt.get(peer.id) ?? 0) >= SESSION_SAVE_MS) {
      this.sessions.save(session); this.sessionSavedAt.set(peer.id, now);
    }
  }

  // gtasf-j7wvv: every close of a connected player is logged once (client 1006s with the DO alive: who closed it?).
  override webSocketClose(socket: WebSocket, code: number, reason?: string, wasClean?: boolean): void {
    this.closeCause = `client/runtime close ${code}${wasClean === false ? ' unclean' : ''}${reason ? ` '${String(reason).slice(0, 40)}'` : ''}`;
    this.remove(socket, code === 1000 ? 1000 : 1001);
  }
  override webSocketError(socket: WebSocket, error?: unknown): void {
    this.closeCause = `socket error ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 80)}` : String(error).slice(0, 80)}`;
    this.remove(socket, 1011);
  }
  override async alarm(): Promise<void> {
    this.armedAt = Infinity;
    this.expire(Date.now());
    this.sessions.prune(Date.now());
    this.reservations.prune(Date.now());
    await this.referralPlay?.flush(Date.now());
    this.arm();
  }

  /** resumeHeightResnap (gtasf-8mjjf publish blocker #1): a stored on-foot pose keeps the height of the map it was saved
   *  on. The road-graph lift raises hill streets by up to ~10 m, and checkMovement is 3D, so a resumed hill player's
   *  first MOVEs (at the new height) failed the speed guard and the CORRECTION pulled them back underground, in a loop.
   *  Snap the height to the current road within 6 m (by 3D distance, up to 15 m vertically) when it's off by > 2 m —
   *  bigger than legit offsets (a raised plaza passes the guard on burst credit), smaller than a lift. */
  private resnapSessionHeight(session: WorldSession, peer?: Peer): void {
    if (!flags.resumeHeightResnap || !this.roadsReady) return;
    const pose = session.movement.pose;
    if (pose.flags & 0xc0) return; // seated: the vehicle owns the pose
    const snap = this.recoveryRoads.snap(pose, 6, 15);
    if (!snap) return; // off the road network (a park, a pier): nothing to compare against
    // Upward only (reviewer 63351eb4): the lift only raises, so a buried pose is always BELOW the road; lowering a pose
    // > 2 m above a road (a stair, embankment or deck edge) would start the inverse loop.
    const y = Math.round(snap.point[1] * 100);
    if (y - pose.y <= 200) return;
    session.movement.pose = { ...pose, y };
    if (peer) peer.pose = session.movement.pose;
  }
  private install(socket: WebSocket, session: WorldSession, now: number, fundingDeviceId?: string, analyticsServer?: AnalyticsServerContext, spokenBubbles = false): Peer {
    this.resnapSessionHeight(session);
    const peer: Peer = { id: session.id, pose: session.movement.pose, socket, session, fundingDeviceId, appearance: session.appearance, spokenBubbles, send: bytes => {
      try { socket.send(bytes); } catch (error) { this.closeCause = `send failed (${bytes.byteLength} B) ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 80)}` : ''}`; this.remove(socket, 1011); }
    } };
    this.peers.set(peer.id, peer);
    this.combat.reset(peer.id, now); // full health + spawn protection on (re)join
    // review fix 4: restore stashed wanted heat + health if this device reconnected within the TTL (keep the
    // spawn protection from reset so they aren't instantly re-killed, but carry their heat + wounds back).
    if (flags.combat && fundingDeviceId) {
      // gtasf-2cprr: after an instance RESET there is no in-memory stash (remove() never ran); the persisted row is it.
      const memory = this.combatStash.get(fundingDeviceId), stash = memory ?? this.persistedStash(fundingDeviceId, now);
      // Reviewer ask (reconnect-grace review): one line per restore so prod logs show WHICH path carried the state
      // (in-memory stash after a drop vs the persisted row after an instance reset). No device id.
      if (stash && stash.expiresAt > now) console.log('combat stash restored', memory ? 'memory' : 'persisted', `stars ${wantedLevel(stash.state.heat)}`, `health ${stash.health}`, `bust ${stash.bust?.holdMs ?? 0}`);
      this.combatStash.delete(fundingDeviceId); this.combatPersist.forget(fundingDeviceId);
      if (stash && stash.expiresAt > now) {
        // Wounds come back, but never death: a player who dropped while at 0 health was already being settled (debit +
        // respawn), so restoring 0 here would strand them dead and let the dead-peer watchdog charge them again (WG-M1).
        if (stash.health > 0 && stash.health < MAX_HEALTH) { this.combat.setHealth(peer.id, stash.health); this.combat.markHurt(peer.id, now); } // review HR-L1
        if (stash.state.heat > 0 && flags.wanted) {
          this.wantedStates.set(peer.id, { state: stash.state, level: wantedLevel(stash.state.heat) });
          this.wantedLastAt = now; // avoid a huge first decay dt against the stale timestamp
          // gtasf-7p7oi: a wanted player who dropped comes back mid-pursuit: no spawn protection, and the bust meter resumes
          // where it was (re-anchored at the resumed pose/now so the offline gap isn't counted as movement or hold).
          this.combat.clearProtection(peer.id);
          if (stash.bust && stash.bust.holdMs > 0) this.bustStates.set(peer.id, { holdMs: stash.bust.holdMs, lastX: peer.pose.x / 100, lastZ: peer.pose.z / 100, lastAt: now });
          // (WANTED is sent by sendCombatJoinState AFTER the WELCOME — gtasf-awnin.)
        }
      }
    }
    this.connections.set(socket, { peer, expiresAt: Infinity, credit: 60, budgetAt: now, analyticsServer, spokenBubbles });
    this.observeReferralPlay(now);
    this.chat?.presenceChanged(peer.id);
    return peer;
  }
  /** gtasf-2cprr: the persisted row as an in-memory stash (same TTL, measured from its last save). */
  private persistedStash(device: string, now: number): { state: WantedState; health: number; expiresAt: number; bust?: BustState } | undefined {
    const row = this.combatPersist.take(device, now, COMBAT_STASH_TTL_MS);
    if (!row) return undefined;
    return { state: { heat: row.heat, lastCrimeMs: row.lastCrimeMs }, health: row.health, expiresAt: row.savedAt + COMBAT_STASH_TTL_MS,
      ...(row.bustMs > 0 ? { bust: { holdMs: row.bustMs, lastX: 0, lastZ: 0, lastAt: now } } : {}) };
  }
  /** gtasf-2cprr: every SESSION_SAVE_MS, save each connected device's wanted/health/bust (a clean one deletes its row). */
  private saveCombatState(now: number): void {
    if (!flags.combat || now - this.combatPersistAt < SESSION_SAVE_MS) return;
    if (Math.floor(now / 60_000) !== Math.floor(this.combatPersistAt / 60_000)) this.combatPersist.prune(now, COMBAT_STASH_TTL_MS);
    this.combatPersistAt = now;
    const states: [string, { heat: number; lastCrimeMs: number; health: number; bustMs: number } | undefined][] = [];
    for (const peer of this.peers.values()) {
      if (!peer.fundingDeviceId) continue;
      const heat = this.wantedStates.get(peer.id)?.state, health = this.combat.healthOf(peer.id), bustMs = this.bustStates.get(peer.id)?.holdMs ?? 0;
      const dirty = (heat !== undefined && heat.heat > 0) || (health > 0 && health < MAX_HEALTH);
      states.push([peer.fundingDeviceId, dirty ? { heat: heat?.heat ?? 0, lastCrimeMs: heat?.lastCrimeMs ?? 0, health, bustMs } : undefined]);
    }
    this.combatPersist.save(states, now);
  }
  /** Wanted (>= 1 star). gtasf-sjmkk: robotaxis refuse a wanted player (else rob → 1.2 s robotaxiJump → police lose you,
   *  payout kept); gtasf-dtnk7: so does the road snap on foot. */
  private taxiRefusesWanted(playerId: number): boolean {
    return flags.combat && flags.wanted && wantedLevel(this.wantedStates.get(playerId)?.state.heat ?? 0) >= 1;
  }
  /** gtasf-awnin (P0): combat state a joiner needs — restored wanted level, taken pickups. Only ever AFTER the
   *  WELCOME: the client closes 4004 'Welcome required' on anything earlier, and remove() re-stashed the heat, so a
   *  wanted player who reloaded was locked out of the city on every retry. */
  private sendCombatJoinState(peer: Peer, now: number): void {
    if (!flags.combat) return;
    // gtasf-igk2q: ALWAYS send the level, 0 included — a rejoin with no restored heat (decayed / stash expired) must
    // clear the client's pre-drop star, which otherwise stayed lit with no police (#6.33: one star for 240 s).
    const wanted = this.wantedStates.get(peer.id);
    if (flags.wanted) peer.send(encodeS2C({ type: 'WANTED', level: wanted && wanted.state.heat > 0 ? wantedLevel(wanted.state.heat) : 0 }));
    if (flags.vitalsPickups) this.pickupTakenUntil.forEach((until, index) => { if (until > now) peer.send(encodeS2C({ type: 'PICKUP_STATE', index, available: false })); });
  }
  private updateFundingIdentity(profile: FundingProfile): void {
    const name = normalizeNickname(profile.nickname); if (!name) return;
    for (const [socket, connection] of this.connections) {
      if (connection.peer || connection.fundingDeviceId !== profile.deviceId) continue;
      connection.fundingNickname = name;
      const attachment = socket.deserializeAttachment() as Attachment;
      if (attachment.kind === 'pending') socket.serializeAttachment({ ...attachment, fundingNickname: name } satisfies Attachment);
    }
    for (const peer of this.peers.values()) {
      if (peer.fundingDeviceId !== profile.deviceId || !this.sessions.rename(peer.session, name)) continue;
      const message = encodeS2C({ type: 'PLAYER_JOIN', id: peer.id, name, pose: peer.pose });
      for (const other of this.peers.values()) if (other !== peer) other.send(message);
    }
  }
  private closeSocket(socket: WebSocket, code: number, reason?: string): void {
    try { socket.close(code, reason); } catch { /* Already closed; membership is removed separately. */ }
  }
  private remove(socket: WebSocket, code: number, reason?: string): void {
    const cause = this.closeCause; this.closeCause = undefined;
    const connection = this.connections.get(socket);
    this.connections.delete(socket);
    const peer = connection?.peer;
    if (!peer && connection?.grant) this.reservations.releaseGrant(connection.grant);
    if (peer && this.peers.get(peer.id) === peer) {
      // gtasf-j7wvv: one line per connected player leaving: who closed it and why (clean 1000 leaves stay quiet).
      if (code !== 1000) console.warn('world socket closed', `player ${peer.id}`, `code ${code}`, cause ?? `server ${reason ?? 'close'}`,
        `| last msg ${Date.now() - peer.session.lastSeen} ms ago, peers ${this.peers.size}`);
      // client vanished, not a server close. budgetCloseGrace (gtasf-giklk): the message-budget close too. A steady client
      // (~12 msg/s) gets it when a network stall delivers its queued frames as one burst, and the client resumes at once;
      // a phone time trial lost its finished run that way. A flooder gains nothing it couldn't by dropping its network.
      const graced = flags.reconnectGrace && (code === 1001 || code === 1011 || (flags.budgetCloseGrace && code === CloseCode.PROTOCOL && reason === BUDGET_CLOSE_REASON));
      const bust = this.bustStates.get(peer.id); // gtasf-7p7oi: read before the per-peer cleanup below deletes it
      this.funding?.disconnect(peer.id, Date.now());
      this.chat?.disconnect(peer.id);
      this.recoveredAt.delete(peer.id);
      if (this.handingOff.has(peer.id)) {
        this.taxis.detach(peer.id);
        const vehicleId = this.vehicles.detach(peer.id);
        if (vehicleId !== undefined && !isScheduledTransit(vehicleId))
          this.ctx.storage.sql.exec('INSERT OR IGNORE INTO world_vehicle_departed VALUES (?)', vehicleId);
      } else if (graced) {
        // reconnectGrace: the client vanished (1006 / error), most often a Cloudflare drop that reconnects in 1-4 s. Hold the
        // ride (taxi paused, seat kept) and the runs; a same-session resume continues them, settleDropGrace ends them.
        this.taxis.pause(peer.id);
        this.dropGrace.set(peer.id, { device: peer.fundingDeviceId, until: Date.now() + RECONNECT_GRACE_MS });
      } else {
        this.movingRides.disconnect(peer.id, Date.now());
        this.taxis.disconnect(peer.id, Date.now());
        this.vehicles.disconnect(peer.id, Date.now());
        this.vehicles.releasePersonal(peer.id); // saved per device; it comes back with them
      }
      this.personalDeliverAt.delete(peer.id);
      this.mayhem.forget(peer.id);
      this.streetCrimeClocks.delete(peer.id);
      this.bustStates.delete(peer.id);
      this.policeTrack.delete(peer.id);
      this.officerViewers.delete(peer.id);
      // review fix 1 (anti-teleport): drop any in-progress mission/drive/robbery for this device on disconnect, so a
      // reload with ?at=<deliver> (a fresh connection overwrites the server pose) can't resume + instantly complete
      // it. The elapsed-time floor only bounds one continuous attempt; this closes the disconnect/rejoin vector. [gtasf-ldlm]
      // gtasf-7p7oi (review of reconnectGrace): dropping the socket mid-arrest must not dodge the bust. A drop with the bust
      // meter within BUST_DROP_SETTLE_MS of completing is settled as BUSTED now (the -5% debit, wanted cleared; settleBust
      // skips the respawn for a gone peer). The device's runs end as a real bust's respawn would end them.
      const bustedOnDrop = flags.combat && flags.wanted && flags.policeBust && bust !== undefined && bust.holdMs >= BUST_HOLD_MS - BUST_DROP_SETTLE_MS
        && this.combat.healthOf(peer.id) > 0 && !this.bustsInFlight.has(peer.id);
      if (bustedOnDrop) {
        this.bustsInFlight.add(peer.id);
        this.ctx.waitUntil(this.settleBust(peer, Date.now()).catch(() => undefined).finally(() => this.bustsInFlight.delete(peer.id)));
        if (peer.fundingDeviceId) this.combatPersist.forget(peer.fundingDeviceId); // settled: nothing to carry across a reset
      }
      if (peer.fundingDeviceId && (!graced || bustedOnDrop)) this.clearDeviceQuests(peer.fundingDeviceId);
      // review fix 4: before dropping this connection's combat state, stash heat + health by device for ~60s so a
      // reconnect restores it (a reload can't launder away a wanted level or wounds). Only when there's something to hold.
      // gtasf-7p7oi: the bust meter rides along, so a drop can't reset it either.
      if (flags.combat && peer.fundingDeviceId) {
        const heat = this.wantedStates.get(peer.id)?.state, health = this.combat.healthOf(peer.id);
        if ((heat && heat.heat > 0) || health < MAX_HEALTH) {
          this.combatStash.set(peer.fundingDeviceId, { state: heat ?? freshWanted(), health, expiresAt: Date.now() + COMBAT_STASH_TTL_MS,
            ...(bust && !bustedOnDrop && heat && heat.heat > 0 ? { bust } : {}) });
        }
      }
      this.combat.forget(peer.id);
      this.pedPunchAt.delete(peer.id);
      this.crashAt.delete(peer.id);
      this.wantedSightSent.delete(peer.id);
      this.escapeStates.delete(peer.id); this.escapeSent.delete(peer.id); this.resprayAt.delete(peer.id); this.sightingHolds.delete(peer.id);
      this.driveTrack.delete(peer.id);
      this.kerbTakeAt.delete(peer.id);
      this.openingCarAsked.delete(peer.id);
      this.wantedStates.delete(peer.id);
      this.police.forget(peer.id);
      if (this.voice) {
        this.voice.remove(peer.id); this.voiceGeneration.set(peer.id, (this.voiceGeneration.get(peer.id) ?? 0) + 1);
        if (peer.fundingDeviceId) {
          this.voiceHandoffs.remove(peer.fundingDeviceId, peer.id);
          for (const work of this.voiceHandoffs.flush()) this.ctx.waitUntil(work);
        }
      }
      this.peers.delete(peer.id);
      this.sessionSavedAt.delete(peer.id);
      if (!this.peers.size) this.lastStepAt = 0; // the ticker stops with nobody here: a restart isn't a stall (853aaebd false positive)
      this.bounty.dropPeer(peer.id);
      this.observeReferralPlay(Date.now());
      if (!this.peers.size) this.traffic?.step(0, [], Date.now());
      this.sessions.disconnect(peer.session, Date.now());
      // Seamless handoff (gtasf-djjz §7): a crossing peer re-homes to its destination cell with the same
      // id, so suppress PLAYER_LEAVE — remotes keep rendering it via the border-observer band (no blink).
      if (this.handingOff.delete(peer.id)) { /* handed off: id lives on in the destination cell */ }
      else this.broadcast({ type: 'PLAYER_LEAVE', id: peer.id });
      if (flags.worldCapacity && this.env.LOBBY) this.ctx.waitUntil(this.env.LOBBY.get(this.env.LOBBY.idFromName('sf')).fetch('https://lobby.internal/internal/released', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(() => undefined).catch(() => undefined));
    }
    this.closeSocket(socket, code, reason);
    this.ticker.maybeStopTicking(); this.arm();
  }
  private broadcast(message: S2CMessage): void {
    const bytes = encodeS2C(message);
    for (const peer of this.peers.values()) peer.send(bytes);
  }
  /** Zoned world: carry an accepted chat broadcast to the sender's border-neighbour cells (CHAT_RADIUS_M
   *  and the event room radius both sit inside BORDER_SUBSCRIBE_M, so these are the only cells that can
   *  hold a cross-border listener). The sibling cell re-applies the same visibility in relayIncoming.
   *  No-op when the sender is not near any border (empty neighbour set). */
  /** Seamless handoff (zoned, gtasf-djjz §7): when an accepted on-foot move carries a player out of this
   *  cell, transfer their session to the destination cell (preserving the id) and tell the client to
   *  re-home there. Fire-and-forget: the client keeps playing here until it reconnects with ?handoff. If
   *  the destination refuses the adopt, we clear the flag so the player stays (and a later move retries). */
  private maybeHandoff(peer: Peer): void {
    if (this.handingOff.has(peer.id)) return; // already transferring; one move per crossing
    // Hand off only once the player is clearly past this cell's border (hysteresis ⇒ no border-line thrash).
    const target = handoffDestination(SF_ZONE_GRID, this.zoneCellIndex!, peer.pose.x / 100, peer.pose.z / 100);
    if (!target) return;
    const vehicleId = this.vehicles.occupants.get(peer.id);
    const car = vehicleId === undefined ? undefined : this.vehicles.cars.get(vehicleId);
    let vehicle: OccupiedVehicleTransfer | undefined;
    if (car) {
      if (car.entry.kind === 'cable-car' || isScheduledTransit(car.entry.id)) vehicle = { id: car.entry.id, mode: 'cable' };
      else if (car.entry.kind === 'robotaxi') {
        const state = this.taxis.transfer(peer.id); if (!state) return;
        vehicle = { id: car.entry.id, mode: 'taxi', state };
      } else vehicle = { id: car.entry.id, mode: 'driver', state: occupiedVehicleState(car) };
    } else if (this.taxis.trips.has(peer.id)) return; // finish the caller's curb pickup before moving it
    this.handingOff.add(peer.id);
    this.taxis.pause(peer.id);
    const transfer: ZoneTransfer = { key: crypto.randomUUID(), from: cellFromIndex(SF_ZONE_GRID, this.zoneCellIndex!),
      to: target, expiresAt: Date.now() + TRANSFER_TIMEOUT_MS, ...(vehicle ? { vehicle } : {}) };
    this.transfers!.begin(peer.id, peer.session.generation, transfer);
    const s = peer.session, p = peer.pose;
    const session = {
      id: s.id, token: s.token, name: s.name, generation: s.generation,
      seq: s.movement.seq, accepted: s.movement.accepted, carryCm: Math.min(MOVE_BURST_CM, s.movement.carryCm), appearance: peer.appearance,
      pose: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, flags: p.flags },
    };
    const stub = this.env.WORLD.get(this.env.WORLD.idFromName(zoneId(target.cx, target.cy)));
    this.ctx.waitUntil(stub.fetch('https://world.internal/internal/handoff/receive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, transfer }),
    }).then(res => {
      const pending = this.transfers!.outgoing(peer.id);
      if (pending?.key !== transfer.key || pending.claimed !== 0) return;
      if (!res.ok || transfer.expiresAt <= Date.now()) { this.cancelHandoff(peer); return; }
      if (this.peers.get(peer.id) === peer) peer.send(encodeS2C({ type: 'ZONE_HANDOFF', token: s.token, cx: target.cx, cy: target.cy }));
    }).catch(() => { if (this.transfers!.outgoing(peer.id)?.key === transfer.key) this.cancelHandoff(peer); }));
  }
  private cancelHandoff(peer: Peer): void {
    this.transfers!.cancel(peer.id);
    this.handingOff.delete(peer.id);
    this.taxis.resume(peer.id, Date.now());
    peer.send(encodeS2C({ type: 'CORRECTION', pose: peer.pose }));
  }
  private restoreTransferredVehicle(playerId: number, vehicle: OccupiedVehicleTransfer, now: number): boolean {
    if (this.vehicles.occupants.get(playerId) === vehicle.id) return true;
    const adopted = vehicle.mode === 'driver' ? this.vehicles.adoptCar(playerId, vehicle.id, vehicle.state, now)
      : vehicle.mode === 'taxi' ? this.taxis.adopt(playerId, vehicle.id, vehicle.state, now)
      : this.vehicles.boardPassenger(playerId, vehicle.id, now);
    if (adopted) this.ctx.storage.sql.exec('DELETE FROM world_vehicle_departed WHERE id=?', vehicle.id);
    return adopted;
  }
  private fanoutChat(broadcast: S2CMessage, senderPose: Pose, eventId: number): void {
    if (broadcast.type !== 'CHAT_BROADCAST') return;
    const cells = borderObservers(SF_ZONE_GRID, senderPose.x / 100, senderPose.z / 100);
    if (!cells.length) return;
    const payload = JSON.stringify({ broadcast, senderPose: { x: senderPose.x, y: senderPose.y, z: senderPose.z }, eventId });
    for (const cell of cells) {
      const stub = this.env.WORLD.get(this.env.WORLD.idFromName(zoneId(cell.cx, cell.cy)));
      this.ctx.waitUntil(stub.fetch('https://world.internal/internal/chat/relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      }).then(() => undefined).catch(() => undefined));
    }
  }
  /** Send a mayhem fire to this cell's peers near the splat (excludeId skips the firer, who already
   *  renders it locally). Shared by the local fire path and the cross-border relay receiver. */
  private relayMayhemNearby(broadcast: Extract<S2CMessage, { type: 'MAYHEM_FIRE' }>, excludeId?: number): void {
    const bytes = encodeS2C(broadcast);
    for (const other of this.peers.values()) if (other.id !== excludeId && nearMayhem(other.pose, broadcast.at)) other.send(bytes);
  }
  /** Server-authoritative combat FIRE: resolve the hit from the shooter's authoritative pose against the peer
   *  poses, apply damage, broadcast COMBAT_HIT to nearby peers (incl. the shooter, for the authoritative kill),
   *  and on a kill apply the valuation cost + respawn server-side. Peds are client-only cosmetic — PvP peers
   *  are the server-validated targets here; SFPD/NPC targets come with the wanted system. */
  private handleCombatFire(peer: Peer, message: Extract<C2SMessage, { type: 'COMBAT_FIRE' }>, now: number): void {
    peer.combatActive = true; // a shooter has clearly opted into combat → they are a valid target to shoot back at
    // Other players are PvP targets only when open PvP is enabled (flag openPvp); otherwise the shot can still
    // fire/tracer but harms no one — serverHits alone never opens PvP. [gtasf-combat-open-pvp-x75y]
    // Server-authoritative line of sight: use the building collision loaded around the shooter. If collision exists for
    // this world but the shooter's chunk isn't loaded yet, the shot can't be wall-checked, so it harms no one (fail
    // closed); opted-in players are warmed every tick (warmShooterCollision), so that's only a fresh area's first moments.
    // driveBy: no melee from inside a vehicle, and never the players sharing the shooter's vehicle.
    const ownVehicle = this.vehicles.occupants.get(peer.id);
    if (!vehicleFireAllowed(ownVehicle !== undefined, WEAPONS[WEAPON_ORDER[message.weapon] ?? 'fists'].melee, flags.driveBy)) return; // review DB-M1
    const collision = this.combatCollision.near(peer.pose.x / 100, peer.pose.z / 100);
    const targets = shotLosKnown(collision, this.combatCollision.status)
      ? pvpTargets(this.peers.values(), peer.id, flags.openPvp).filter(t => ownVehicle === undefined || this.vehicles.occupants.get(t.id) !== ownVehicle) : [];
    const result = this.combat.fire(peer.id, peer.pose, { weapon: message.weapon, dir: message.dir }, targets, now,
      { collision, ...(this.terrainHeightAt ? { heightAt: this.terrainHeightAt } : {}) });
    this.ctx.waitUntil(this.combatCollision.warm(peer.pose.x / 100, peer.pose.z / 100).catch(() => undefined));
    if (!result) return;
    // Review WG-M1: the damage has landed, so the death MUST be settled even if encoding/broadcasting below throws
    // (guarded() would otherwise swallow it and leave the victim at 0 health, undebited and never respawned).
    try {
      const bytes = encodeS2C({ type: 'COMBAT_HIT', shooterId: peer.id, weapon: message.weapon, origin: result.origin,
        to: result.to, targetId: result.targetId, damage: result.damage, killed: result.killed });
      for (const other of this.peers.values()) if (nearMayhem(other.pose, result.origin, MAYHEM_RELAY_RADIUS_M)) other.send(bytes);
      if (result.targetId && wantedRaiseAllowed(flags)) this.raiseWanted(peer.id, result.killed ? 'ped-kill' : 'assault', now); // review fix 4: wanted needs combat too
      if (result.targetId && !result.killed) this.sendVitals(result.targetId); // vitalsPickups: exact health + armour
      if (flags.streetCrimeWanted && wantedRaiseAllowed(flags)) this.raiseStreetCrime(peer.id, message.weapon, result, collision, now);
      if (flags.vehicleDamage && !result.targetId) this.shootVehicle(peer, message.weapon, result.origin, result.to, collision, now);
    } finally {
      if (result.killed && result.targetId) {
        const victim = this.peers.get(result.targetId);
        if (victim) this.ctx.waitUntil(this.applyPvpDeath(victim, now, peer).catch(() => undefined)); // peer = the killer (bounty)
      }
    }
  }
  /** Street-crime wanted (flag streetCrimeWanted): public gunfire → 'mayhem' (capped at 2 stars) and a shot through
   *  an SFPD unit in line of sight → 'cop-hit', both rate-limited per shooter. Peds are client-only, so gunfire is
   *  the server-visible proxy for shooting at people; a shot that hit a player already raised assault/ped-kill. */
  private raiseStreetCrime(peerId: number, weapon: number, result: { origin: [number, number, number]; to: [number, number, number]; targetId: number },
    collision: Parameters<typeof lineOfSight>[2] | null | undefined, now: number): void {
    const spec = WEAPONS[WEAPON_ORDER[weapon] ?? 'fists'];
    const reach = Math.hypot(result.to[0] - result.origin[0], result.to[2] - result.origin[2]) + POLICE_HIT_RADIUS_M;
    const units = flags.wanted ? this.police.unitsNear(result.origin[0], result.origin[2], reach) : [];
    const visible = collision ? (body: readonly [number, number, number]) => lineOfSight(result.origin, [body[0], body[1], body[2]], collision) : undefined;
    // Review D-L5: while the shooter's collision is still loading, a cop can't be wall-checked — no 'cop-hit' (fail closed).
    const hitPolice = shotLosKnown(collision ?? undefined, this.combatCollision.status) && shotHitsPolice(result.origin, result.to, units, visible);
    const clock = this.streetCrimeClock(peerId);
    const heat = this.wantedStates.get(peerId)?.state.heat ?? 0;
    const crime = streetCrimeForShot({ melee: spec.melee, hitPlayer: result.targetId !== 0, hitPolice }, clock, heat, now);
    if (crime) this.raiseWanted(peerId, crime, now, applyStreetCrime);
  }
  private streetCrimeClock(peerId: number): StreetCrimeClock {
    let clock = this.streetCrimeClocks.get(peerId);
    if (!clock) { clock = freshStreetCrimeClock(); this.streetCrimeClocks.set(peerId, clock); }
    return clock;
  }
  /** Add a crime's heat to a player and push their star level if it changed. */
  private raiseWanted(peerId: number, crime: Crime, now: number, apply: (state: WantedState, crime: Crime, now: number) => WantedState = addHeat): void {
    const entry = this.wantedStates.get(peerId) ?? { state: freshWanted(), level: 0 };
    entry.state = apply(entry.state, crime, now);
    this.wantedStates.set(peerId, entry);
    this.broadcastWanted(peerId);
  }
  /** Cross-lane hook (lane C missions): raise a device's wanted level for a non-combat crime committed server-side
   *  (e.g. the pitch-deck heist grab → 'heist' = 3 stars). Resolves the connected peer by funding device; no-op if
   *  they're offline or `wanted` is off, so the SFPD/escape loop only engages when the wanted system is live. */
  raiseWantedForDevice(deviceId: string, crime: Crime, now: number): void {
    if (!wantedRaiseAllowed(flags)) return; // review fix 5: the wanted system only exists under combat
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === deviceId);
    if (peer) this.raiseWanted(peer.id, crime, now);
  }
  private inHideout(xM: number, zM: number): boolean {
    this.hideoutSpots ??= placePositions(HIDEOUTS, project);
    return withinAny(this.hideoutSpots, xM, zM, SFPD_TUNING.hideoutRadiusM);
  }
  /** wantedEscape (gtasf-66lvh): advance the player's escape clock (seen → evading → searching → cleared), apply a
   *  respray (unseen driver in a shop), and tell the client (S2C WANTED_ESCAPE, on change / ≤ 2 Hz while hidden).
   *  Clearing only zeroes heat — no money moves; broadcastWanted then sends WANTED 0 and the pursuit stands down. */
  private stepWantedEscape(peer: Peer, entry: { state: WantedState; level: number }, seen: boolean, dtMs: number, now: number, holding = false): void {
    const x = peer.pose.x / 100, z = peer.pose.z / 100, level = wantedLevel(entry.state.heat);
    const inHideout = this.inHideout(x, z);
    const nearestUnitM = this.police.nearestUnitTo(peer.id, x, z);
    const vehicle = this.vehicles.occupants.get(peer.id) ?? 0;
    const step = stepEscape(this.escapeStates.get(peer.id) ?? freshEscape(entry.state.lastCrimeMs, vehicle),
      { level, seen, dtMs, lastCrimeMs: entry.state.lastCrimeMs, inHideout, nearestUnitM, vehicle, unitsActive: nearestUnitM < Infinity && !holding,
        ...(flags.escapeOwnsClear ? { noUnitGraceMs: NO_UNIT_GRACE_MS } : {}) });
    this.escapeStates.set(peer.id, step.state);
    this.resprayShops ??= placePositions(RESPRAY_SHOPS, project);
    const driving = (peer.pose.flags & DRIVER_FLAG) !== 0 && vehicle !== 0;
    const inShop = driving && withinAny(this.resprayShops, x, z, SFPD_TUNING.resprayRadiusM);
    const respray = resprayClears({ level, driving, seen, inShop, now, lastResprayMs: this.resprayAt.get(peer.id) ?? -Infinity });
    const cover = (inHideout ? 1 : 0) | (nearestUnitM > SFPD_TUNING.outrunM ? 2 : 0) | (inShop ? 4 : 0);
    if (step.cleared || respray) {
      if (respray) this.resprayAt.set(peer.id, now);
      entry.state = { heat: 0, lastCrimeMs: entry.state.lastCrimeMs };
      this.escapeStates.delete(peer.id); this.escapeSent.delete(peer.id);
      peer.send(encodeS2C({ type: 'WANTED_ESCAPE', phase: 2, progress: 255, remainingDs: 0, cover: cover | (respray ? 4 : 0) }));
      return;
    }
    const phase = ESCAPE_PHASES.indexOf(step.phase), progress = Math.round(step.progress * 254);
    const last = this.escapeSent.get(peer.id);
    if (last && last.phase === phase && last.cover === cover && (phase === 0 || now - last.at < 500 || last.progress === progress)) return;
    this.escapeSent.set(peer.id, { phase, cover, progress, at: now });
    peer.send(encodeS2C({ type: 'WANTED_ESCAPE', phase, progress, remainingDs: Math.ceil(step.remainingMs / 100), cover }));
  }
  /** Send WANTED only when the star level changes (heat moves continuously; stars are the player-visible read). */
  private broadcastWanted(peerId: number): void {
    const entry = this.wantedStates.get(peerId);
    if (!entry) return;
    const level = wantedLevel(entry.state.heat);
    if (level === entry.level) return;
    entry.level = level;
    this.peers.get(peerId)?.send(encodeS2C({ type: 'WANTED', level }));
  }
  /** Snap a world point (metres) to the nearest road; returns metres + a 0–255 yaw byte, or null. For SFPD. */
  private roadSnap(xM: number, zM: number): { x: number; y: number; z: number; yaw: number } | null {
    const snap = this.recoveryRoads.snap({ x: Math.round(xM * 100), y: 0, z: Math.round(zM * 100) }, 80);
    if (!snap) return null;
    const points = snap.edge.points;
    let distance = 0, index = 1;
    for (; index < points.length - 1; index++) {
      const a = points[index - 1]!, b = points[index]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (distance + length >= snap.along) break;
      distance += length;
    }
    const a = points[index - 1]!, b = points[index]!;
    const pose = routePose({ from: a, to: b, length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), speed: 0 }, snap.along - distance);
    return { x: pose.x / 100, y: pose.y / 100, z: pose.z / 100, yaw: pose.yaw };
  }
  /** A PvP kill: debit the victim's valuation server-side (WASTED, server-minted incident id so a client can
   *  never pre-claim it), reset their health, and respawn them at SF General. */
  private async applyPvpDeath(victim: Peer, now: number, killer?: Peer): Promise<void> {
    // One settlement per death: a second call (the dead-peer watchdog racing a slow debit) must never mint a second
    // incident / second −2%. The flag clears in `finally`, so a thrown debit still lets the watchdog retry later.
    if (this.deathsInFlight.has(victim.id)) return;
    this.deathsInFlight.add(victim.id);
    this.deadSeenAt.delete(victim.id);
    try { await this.settlePvpDeath(victim, now, killer); } finally { this.deathsInFlight.delete(victim.id); }
  }
  private async settlePvpDeath(victim: Peer, now: number, killer?: Peer): Promise<void> {
    const downAt = victim.pose; // where they fell, before the debit await (a dead client's MOVEs can't pick the hospital)
    // Clear the wanted level + pursuit BEFORE the async debit, so no bust (or more police fire) can land on a player who
    // is already dead while the −2% settles — a second penalty for the same incident.
    this.wantedStates.delete(victim.id);
    this.bustStates.delete(victim.id);
    this.police.forget(victim.id);
    if (victim.fundingDeviceId) this.combatPersist.forget(victim.fundingDeviceId); // gtasf-h6xe8 (as settleBust)
    if (flags.wanted) victim.send(encodeS2C({ type: 'WANTED', level: 0 }));
    if (victim.fundingDeviceId) {
      try {
        const incident = `srv:${crypto.randomUUID()}`, device = victim.fundingDeviceId;
        const charge = await settleWithRetry(i => applyCombatPenalty(this.env.DB, device, incident, 'wasted', i ? Date.now() : now));
        await this.funding?.refreshAfterRide(victim.fundingDeviceId, now); // drop the 5 s profile cache so polls show the debit
        // Most Wanted bounty (review fix): VICTIM-FUNDED — the killer can collect at most this WASTED debit (capped), so
        // nothing is minted; logs the kill for the 7-day pair guard either way. Player-shot kills only (killer known).
        if (killer && flags.mostWantedBounty && flags.combat && flags.openPvp && this.funding)
          this.ctx.waitUntil(this.bounty.onKill(victim.id, device, killer, charge.ok ? BigInt(charge.costCents) : 0n, now).catch(() => undefined));
      } catch (error) { console.warn('pvp death penalty failed', error instanceof Error ? error.name : 'unknown'); }
    }
    if (this.peers.get(victim.id) !== victim) return; // disconnected during the debit
    this.combat.reset(victim.id, now); // full health + spawn protection on respawn
    this.respawnAt(victim, now, downAt);
  }
  /** Keep building collision loaded around every wanted player AND their pursuit units, so SFPD line of sight (return
   *  fire) and off-road steps (cruisers, officers) can be checked even if the player never fired. One warm() per unique
   *  256 m chunk per tick; warm() is a cheap no-op for already-cached chunks. */
  /** Keep collision loaded around every player who opted into combat (potential shooters/targets), so their shots are
   *  wall-checked from the first one. One warm() per unique 256 m chunk per tick; cached chunks are a no-op. */
  private warmShooterCollision(): void {
    const seen = new Set<string>();
    for (const peer of this.peers.values()) {
      if (!peer.combatActive) continue;
      const x = peer.pose.x / 100, z = peer.pose.z / 100, key = `${Math.floor(x / COLLISION_CHUNK_M)}:${Math.floor(z / COLLISION_CHUNK_M)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.ctx.waitUntil(this.combatCollision.warm(x, z).catch(() => undefined));
    }
  }
  private warmPoliceCollision(targets: readonly { x: number; z: number }[]): void {
    const seen = new Set<string>();
    const warm = (x: number, z: number) => {
      const key = `${Math.floor(x / COLLISION_CHUNK_M)}:${Math.floor(z / COLLISION_CHUNK_M)}`;
      if (seen.has(key)) return;
      seen.add(key);
      this.ctx.waitUntil(this.combatCollision.warm(x, z).catch(() => undefined));
    };
    for (const t of targets) { warm(t.x, t.z); for (const u of this.police.unitsNear(t.x, t.z, 300)) warm(u.x, u.z); }
  }
  /** SFPD bust (flag policeBust): advance every wanted player's 'caught' timer; arrest the ones who stayed caught.
   *  Only players who opted into combat can be busted (no −5% for someone who declined the 18+ gate). */
  private stepBusts(now: number): void {
    for (const peer of this.peers.values()) {
      const level = wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0);
      if (level < 1 || !peer.combatActive || this.bustsInFlight.has(peer.id)) { this.bustStates.delete(peer.id); continue; }
      const x = peer.pose.x / 100, z = peer.pose.z / 100;
      const onFoot = (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) === 0;
      // Only a ground unit that can actually SEE the player (line of sight through the loaded collision, fail closed)
      // counts for the bust — never an officer or cruiser on the other side of a wall.
      const collision = this.combatCollision.near(x, z), body: [number, number, number] = [x, peer.pose.y / 100 + CHEST_M, z];
      let nearestUnitM = Infinity;
      // QA #6.16: with officers on foot, only an officer within arm's reach cuffs you (cruisers hold 6–9 m off);
      // without them, the old ground-unit radius stands.
      const arresters = flags.sfpdOnFoot ? this.police.officersNear(x, z, BUST_OFFICER_RADIUS_M) : this.police.groundUnitsNear(x, z, BUST_RADIUS_M);
      for (const u of arresters) {
        const d = Math.hypot(u.x - x, u.z - z);
        if (Math.abs(u.y - peer.pose.y / 100) > BUST_MAX_DY_M) continue; // a deck above / street below is out of reach
        if (d < nearestUnitM && policeLineClear(collision, [u.x, u.y + CHEST_M, u.z], body, this.terrainHeightAt)) nearestUnitM = d;
      }
      const result = stepBust(this.bustStates.get(peer.id) ?? freshBust(x, z, now),
        { level, onFoot, alive: this.combat.healthOf(peer.id) > 0, resisting: resistingArrest(level, now - this.combat.lastFireOf(peer.id)), nearestUnitM, x, z, now });
      this.bustStates.set(peer.id, result.state);
      if (result.busted) this.ctx.waitUntil(this.applyBust(peer, now).catch(() => undefined));
    }
  }
  /** SFPD return fire (flag policeFire): from 2 stars, each ground unit chasing a player shoots at them when in range
   *  and line of sight, once per interval; hit chance falls with distance and the player's speed (halved in a car).
   *  Damage goes through the server health (dead / spawn-protected players are skipped); a kill is the normal WASTED
   *  (−2%, clears wanted, SF General). Every shot is broadcast as COMBAT_HIT with the unit as the shooter (tracers). */
  private stepPoliceFire(now: number): void {
    for (const [id, at] of this.policeFireAt) if (now - at > 10_000) this.policeFireAt.delete(id); // despawned units
    for (const peer of this.peers.values()) {
      const px = peer.pose.x / 100, py = peer.pose.y / 100, pz = peer.pose.z / 100;
      const prev = this.policeTrack.get(peer.id), dt = prev ? (now - prev.at) / 1000 : 0;
      const speed = prev && dt > 0 ? Math.hypot(px - prev.x, pz - prev.z) / dt : 0;
      this.policeTrack.set(peer.id, { x: px, z: pz, at: now, speed });
      const level = wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0);
      if (level < POLICE_FIRE_MIN_LEVEL || !peer.combatActive) continue;
      if (this.combat.healthOf(peer.id) <= 0 || this.combat.isProtected(peer.id, now)) continue;
      const inVehicle = (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0;
      const collision = this.combatCollision.near(px, pz);
      const chest: [number, number, number] = [px, py + CHEST_M, pz];
      for (const unit of this.police.groundUnitsChasing(peer.id)) {
        const dist = Math.hypot(unit.x - px, unit.z - pz);
        if (!unitMayFire(level, dist, this.policeFireAt.get(unit.id) ?? -Infinity, now)) continue;
        const origin: [number, number, number] = [unit.x, unit.y + CHEST_M, unit.z];
        if (!policeLineClear(collision, origin, chest, this.terrainHeightAt)) continue; // fail closed: no loaded collision ⇒ hold fire
        this.policeFireAt.set(unit.id, now);
        const result = Math.random() < policeHitChance(dist, speed, inVehicle) ? this.combat.damage(peer.id, POLICE_SHOT_DAMAGE, now) : null;
        try { // review WG-M1: a throw while broadcasting a killing shot must not skip the death settlement
          const to: [number, number, number] = result ? chest : [px + (Math.random() - 0.5) * 3, py + 0.8 + Math.random(), pz + (Math.random() - 0.5) * 3];
          const bytes = encodeS2C({ type: 'COMBAT_HIT', shooterId: unit.id, weapon: WEAPON_ORDER.indexOf('pistol'), origin, to,
            targetId: result ? peer.id : 0, damage: result ? POLICE_SHOT_DAMAGE : 0, killed: result?.killed ?? false });
          for (const other of this.peers.values()) if (nearMayhem(other.pose, origin, MAYHEM_RELAY_RADIUS_M)) other.send(bytes);
          if (result && !result.killed) this.sendVitals(peer.id);
        } finally {
          if (result?.killed) this.ctx.waitUntil(this.applyPvpDeath(peer, now).catch(() => undefined));
        }
        if (result?.killed) break;
      }
    }
  }
  /** gtasf-abijv: a ground unit sees a wanted player only along an unblocked line (eye to chest) through the building
   *  collision. Fails toward SEEN while the player's collision isn't loaded (never a free escape on a cold DO). */
  private policeCanSee(unit: { x: number; y: number; z: number }, t: { x: number; y?: number; z: number }): boolean {
    const collision = this.combatCollision.near(t.x, t.z);
    if (!collision) return true;
    const ty = t.y ?? unit.y;
    return lineOfSight([unit.x, unit.y + 1.5, unit.z], [t.x, ty + CHEST_M, t.z], collision);
  }
  /** Kerb-car theft (gtasf-0lnjq): the client's kerb props aren't networked, so validate the claimed pose — the player is
   *  on foot within KERB_REACH_M, the spot is beside a real road, no fleet car is already there, one try per 2 s — then
   *  spawn a real car there and seat them (car-theft wanted when combat is on). */
  // ── personalCar (LANE C, critique #20) ──
  private personalOn(): boolean { return flags.personalCar && flags.driving && !flags.zonedWorld; }
  /** The host callback when a player drove a road car and left it: save it for their device. */
  private savePersonal(playerId: number, kind: VehicleKind, pose: Pose): void {
    const device = this.peers.get(playerId)?.fundingDeviceId;
    if (!this.personalOn() || !device) return;
    this.ctx.waitUntil(savePersonalCar(this.env.DB, device, kind, pose, Date.now()).catch(error => console.warn('personal car save failed', error instanceof Error ? error.name : 'unknown')));
  }
  /** A (re)joining player: park their saved car where they left it, unless it is already here (a resumed session or
   *  another tab of the same device) or something occupies the spot (then "Deliver my car" brings it). */
  private async restorePersonal(peer: Peer): Promise<void> {
    const device = peer.fundingDeviceId;
    // Review LOW 1: two tabs joining together both awaited the load before either spawned → two copies. One in flight.
    if (!this.personalOn() || !device || this.personalRestoring.has(device)) return;
    this.personalRestoring.add(device);
    try {
      const saved = await loadPersonalCar(this.env.DB, device);
      if (!saved || this.peers.get(peer.id) !== peer) return;
      for (const other of this.peers.values()) if (other.fundingDeviceId === device && this.vehicles.personalCarOf(other.id)) return;
      if (this.personalSpotTaken(saved.pose)) return;
      this.vehicles.spawnPersonal(this.vehicles.allocateTaxiId(), saved.pose, saved.kind, peer.id, Date.now());
    } finally { this.personalRestoring.delete(device); }
  }
  /** A car can't appear here: another vehicle within 2.5 m, or (review LOW 2) a player standing within 2 m. */
  private personalSpotTaken(pose: Pose): boolean {
    if (this.vehicles.carNear(pose, 2.5) || this.anyVehicleNear(pose.x / 100, pose.z / 100, 2.5)) return true;
    for (const p of this.peers.values()) if (Math.hypot(p.pose.x - pose.x, p.pose.z - pose.z) < 200) return true;
    return false;
  }
  private async personalPeer(request: Request, sid?: number): Promise<{ device: string; peer?: Peer } | null> {
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return null;
    return { device, peer: [...this.peers.values()].find(p => p.fundingDeviceId === device && (sid === undefined || p.session.id === sid)) };
  }
  /** GET: { car: { kind, x, z, live } | null } in metres — the live car in this world, else the saved spot. */
  private async handlePersonalCar(request: Request): Promise<Response> {
    if (!this.personalOn()) return admissionJson({ error: 'off' }, 404);
    const sidParam = new URL(request.url).searchParams.get('sid');
    const who = await this.personalPeer(request, sidParam ? Number(sidParam) : undefined);
    if (!who) return admissionJson({ error: 'device' }, 401);
    const live = who.peer && this.vehicles.personalCarOf(who.peer.id);
    if (live) return admissionJson({ car: { kind: live.kind, x: live.x / 100, z: live.z / 100, live: true, driving: live.driverId === who.peer!.id } });
    const saved = await loadPersonalCar(this.env.DB, who.device);
    return admissionJson({ car: saved ? { kind: saved.kind, x: saved.pose.x / 100, z: saved.pose.z / 100, live: false, driving: false } : null });
  }
  /** POST "Deliver my car": the saved car is parked on the road nearest a point DELIVER_AHEAD_M ahead of the
   *  AUTHORITATIVE on-foot pose (never on the player, never on another vehicle). 60 s cooldown; no money. */
  private async handlePersonalCarDeliver(request: Request): Promise<Response> {
    if (!this.personalOn()) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: unknown } | undefined;
    const who = await this.personalPeer(request, typeof body?.sid === 'number' ? body.sid : undefined);
    if (!who) return admissionJson({ error: 'device' }, 401);
    const peer = who.peer;
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    // garageSlots reviewer (A): under the flag this endpoint IS the garage's slot 0, so it can't bypass the device-wide
    // cooldown, the one-live-car-per-device rule or the wanted block.
    if (flags.garageSlots) return this.garageDeliver(who.device, peer, 0);
    const now = Date.now();
    if (this.vehicles.occupants.has(peer.id) || (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0) return admissionJson({ status: 'in-vehicle' }, 409);
    // Reviewer (B): with wantedEscape a fresh delivered car is an on-demand vehicle swap (SEARCHING once a minute): none while wanted.
    if (wantedRaiseAllowed(flags) && wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0) > 0) return admissionJson({ status: 'wanted' }, 409);
    const wait = DELIVER_COOLDOWN_MS - (now - (this.personalDeliverAt.get(peer.id) ?? -Infinity));
    if (wait > 0) return admissionJson({ status: 'cooldown', retryInS: Math.ceil(wait / 1000) }, 429);
    const live = this.vehicles.personalCarOf(peer.id);
    const saved = live ? { kind: live.kind } : await loadPersonalCar(this.env.DB, who.device);
    if (!saved) return admissionJson({ status: 'no-car' }, 404);
    const { pose, blocked } = this.deliverPose(peer);
    if (!pose) return admissionJson({ status: blocked ? 'blocked' : 'no-road' }, 409);
    if (!this.vehicles.removePersonal(peer.id)) return admissionJson({ status: 'taken' }, 409); // someone is driving it
    if (!this.vehicles.spawnPersonal(this.vehicles.allocateTaxiId(), pose, saved.kind, peer.id, now)) return admissionJson({ status: 'blocked' }, 409);
    this.personalDeliverAt.set(peer.id, now);
    peer.send(encodeS2C(this.vehicleSnapshot(peer, now)));
    this.ctx.waitUntil(savePersonalCar(this.env.DB, who.device, saved.kind, pose, now).catch(() => undefined));
    return admissionJson({ status: 'delivered', car: { kind: saved.kind, x: pose.x / 100, z: pose.z / 100, live: true, driving: false } });
  }
  /** Candidates: the road nearest a point DELIVER_AHEAD_M ahead, then nearest the player, behind, left, right — the first
   *  snapped road pose within DELIVER_MAX_M that is clear of vehicles and not on top of the player. (A plaza can be 40 m
   *  from the nearest road; GTA delivers to the nearest road, not strictly ahead.) Shared by personal-car and garage deliveries. */
  private deliverPose(peer: Peer): { pose?: Pose; blocked: boolean } {
    const angle = peer.pose.yaw / 256 * Math.PI * 2, px = peer.pose.x / 100, pz = peer.pose.z / 100;
    // The avatar faces (sin yaw, cos yaw) in x/z (as web/src/founder/followers.ts and the contact bodies use).
    const fx = Math.sin(angle), fz = Math.cos(angle), a = DELIVER_AHEAD_M;
    let blocked = false;
    for (const [dx, dz] of [[fx * a, fz * a], [0, 0], [-fx * a, -fz * a], [fz * a, -fx * a], [-fz * a, fx * a]] as const) {
      const road = this.roadSnap(px + dx, pz + dz);
      if (!road) continue;
      const fromPlayer = Math.hypot(road.x - px, road.z - pz);
      if (fromPlayer > DELIVER_MAX_M || fromPlayer < 3) continue; // never on top of you
      if (this.personalSpotTaken({ x: road.x * 100, y: 0, z: road.z * 100, yaw: 0, flags: 0 })) { blocked = true; continue; }
      return { pose: { x: Math.round(road.x * 100), y: Math.round(road.y * 100), z: Math.round(road.z * 100), yaw: road.yaw, flags: 0 }, blocked };
    }
    return { blocked };
  }
  // ── garageSlots (LANE C, critique 20e, gtasf-n1bns; docs/PLAN-garage.md; reviewer pre-review conditions in brackets) ──
  private garageOn(): boolean { return flags.garageSlots && this.personalOn(); }
  private async garageRound(device: string, now: number) { return (await getFundingProfile(this.env.DB, device, now)).round; }
  /** GET: { slots, cars, gifted } — any reached tier's gift car is placed first (once per device and tier [5]). */
  private async handleGarage(request: Request): Promise<Response> {
    if (!this.garageOn()) return admissionJson({ error: 'off' }, 404);
    const sidParam = new URL(request.url).searchParams.get('sid');
    const who = await this.personalPeer(request, sidParam ? Number(sidParam) : undefined);
    if (!who) return admissionJson({ error: 'device' }, 401);
    const now = Date.now(), round = await this.garageRound(who.device, now);
    const gifted = await giftTierCars(this.env.DB, who.device, round, now);
    return admissionJson({ ...(await listGarage(this.env.DB, who.device, round)), gifted });
  }
  /** POST { slot, sid }: 'Keep this car' — the car you are DRIVING right now goes into slot 1+. Server-sourced civilian road
   *  cars only, never another player's own car [2]; the slot must exist for your round [4]; the stored row comes back [6]. */
  private async handleGarageKeep(request: Request): Promise<Response> {
    if (!this.garageOn()) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: unknown; slot?: unknown } | undefined;
    const who = await this.personalPeer(request, typeof body?.sid === 'number' ? body.sid : undefined);
    if (!who) return admissionJson({ error: 'device' }, 401);
    const peer = who.peer;
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const carId = this.vehicles.occupants.get(peer.id), car = carId === undefined ? undefined : this.vehicles.cars.get(carId);
    if (!car || car.entry.driverId !== peer.id) return admissionJson({ status: 'not-driving' }, 409);
    const owner = this.vehicles.ownerOf(car.entry.id);
    if (owner !== undefined && owner !== peer.id) return admissionJson({ status: 'rejected', reason: 'owned' }, 409);
    const now = Date.now(), slot = typeof body?.slot === 'number' ? body.slot : NaN;
    const result = await keepCar(this.env.DB, who.device, slot, car.entry.kind, await this.garageRound(who.device, now), now);
    return admissionJson(result, result.status === 'kept' ? 200 : 422);
  }
  /** POST { slot, sid }: deliver a slot's car to the nearest road. One live delivered car per DEVICE and one device-wide
   *  cooldown [1]; none while wanted [3]; a car above the round's slot count stays hidden [4]. Slot 0 is the personal car. */
  private async handleGarageDeliver(request: Request): Promise<Response> {
    if (!this.garageOn()) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: unknown; slot?: unknown } | undefined;
    const who = await this.personalPeer(request, typeof body?.sid === 'number' ? body.sid : undefined);
    if (!who) return admissionJson({ error: 'device' }, 401);
    const peer = who.peer;
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const slot = typeof body?.slot === 'number' && Number.isInteger(body.slot) ? body.slot : -1;
    if (slot < 0) return admissionJson({ status: 'rejected', reason: 'slot' }, 422);
    return this.garageDeliver(who.device, peer, slot);
  }
  private async garageDeliver(device: string, peer: Peer, slot: number): Promise<Response> {
    const who = { device }, now = Date.now();
    if (this.vehicles.occupants.has(peer.id) || (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0) return admissionJson({ status: 'in-vehicle' }, 409);
    if (wantedRaiseAllowed(flags) && wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0) > 0) return admissionJson({ status: 'wanted' }, 409);
    const wait = DELIVER_COOLDOWN_MS - (now - (this.garageDeliverAt.get(who.device) ?? -Infinity));
    if (wait > 0) return admissionJson({ status: 'cooldown', retryInS: Math.ceil(wait / 1000) }, 429);
    let kind: VehicleKind | undefined;
    if (slot === 0) kind = this.vehicles.personalCarOf(peer.id)?.kind ?? (await loadPersonalCar(this.env.DB, who.device))?.kind;
    else {
      const car = (await listGarage(this.env.DB, who.device, await this.garageRound(who.device, now))).cars.find(c => c.slot === slot);
      if (car?.hidden) return admissionJson({ status: 'hidden' }, 409);
      kind = car?.kind;
    }
    if (!kind) return admissionJson({ status: 'no-car' }, 404);
    const { pose, blocked } = this.deliverPose(peer);
    if (!pose) return admissionJson({ status: blocked ? 'blocked' : 'no-road' }, 409);
    // [1] one live delivered car per device: this device's parked own cars (any tab) go first, never one being driven —
    // checked across every tab BEFORE removing any, so a refusal leaves nothing half-removed (reviewer LOW).
    const tabs = [...this.peers.values()].filter(other => other === peer || other.fundingDeviceId === who.device);
    if (tabs.some(tab => this.vehicles.personalCarOf(tab.id)?.driverId)) return admissionJson({ status: 'taken' }, 409);
    for (const tab of tabs) this.vehicles.removePersonal(tab.id);
    if (!this.vehicles.spawnPersonal(this.vehicles.allocateTaxiId(), pose, kind, peer.id, now)) return admissionJson({ status: 'blocked' }, 409);
    this.garageDeliverAt.set(who.device, now); this.personalDeliverAt.set(peer.id, now);
    peer.send(encodeS2C(this.vehicleSnapshot(peer, now)));
    if (slot === 0) this.ctx.waitUntil(savePersonalCar(this.env.DB, who.device, kind, pose, now).catch(() => undefined));
    return admissionJson({ status: 'delivered', slot, car: { kind, x: pose.x / 100, z: pose.z / 100, live: true, driving: false } });
  }
  private stealKerbCar(peer: Peer, message: Extract<C2SMessage, { type: 'KERB_CAR_TAKE' }>, now: number): void {
    // gtasf-b4wtu: every refusal used to be a silent return; log which one (rate-limited per reason) so a prod tail can
    // tell a full world cap from a bad claim, a reach miss or a car in the way.
    const refuse = (reason: string) => {
      const key = `kerb:${reason}`;
      if (now - (this.stepErrorAt.get(key) ?? 0) > 10_000) {
        this.stepErrorAt.set(key, now);
        console.warn('kerb take refused', reason, `player=(${(peer.pose.x / 100).toFixed(1)},${(peer.pose.z / 100).toFixed(1)}) claim=(${(message.x / 100).toFixed(1)},${(message.z / 100).toFixed(1)})`);
      }
    };
    if ((peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0 || this.vehicles.occupants.has(peer.id)) return refuse('in-vehicle');
    if (now - (this.kerbTakeAt.get(peer.id) ?? -Infinity) < 2000) return refuse('rate-limit');
    this.kerbTakeAt.set(peer.id, now);
    const snapped = this.roadSnap(message.x / 100, message.z / 100);
    if (!kerbTheftValid({ x: peer.pose.x, z: peer.pose.z }, message, snapped))
      return refuse(!snapped ? 'no-road' : Math.hypot(peer.pose.x - message.x, peer.pose.z - message.z) > KERB_REACH_M * 100 ? 'reach' : 'off-road');
    const road = snapped!;
    const pose = { x: message.x, y: Math.round(road.y * 100), z: message.z, yaw: message.yaw, flags: 0 };
    // A real car is already here — the client should just get in it. Review LOW: traffic + police count too, so a
    // stolen kerb car never spawns overlapping a moving NPC car or a cruiser.
    if (this.vehicles.carNear(pose, 2.5)) return refuse('fleet-car-there');
    if (this.anyVehicleNear(message.x / 100, message.z / 100, 2.5)) return refuse('traffic-or-police-there');
    const id = this.vehicles.allocateTaxiId();
    if (!this.vehicles.addKerbCar(id, pose, message.kind === 1 ? 'subaru' : 'prius', now, peer.id)) return refuse(`cap(${this.vehicles.kerbCarCount})`);
    peer.send(encodeS2C(this.vehicleSnapshot(peer, now))); // the client must know the car before it's seated in it
    if (!this.vehicles.enter(peer.id, peer.pose, id, now)) { this.vehicles.discard(id); return refuse('enter-failed'); }
    this.taxis.cancel(peer.id, undefined, now);
    if (flags.carjacking && wantedRaiseAllowed(flags)) this.raiseWanted(peer.id, 'car-theft', now);
  }
  /** openingDrive (critique #13): seat a new player at FOUNDER_OPENING_DRIVE_START in their opening car — on the road
   *  beside the AUTHORITATIVE pose, once per session, only at the start (openingCarPose). One live opening car per
   *  funding device, under its own cap (OPENING_CARS_MAX), swept once abandoned out of range; no wanted and no money. */
  private giveOpeningCar(peer: Peer, facingYaw: number, now: number): void {
    if (this.openingCarAsked.has(peer.id)) return;
    if ((peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0 || this.vehicles.occupants.has(peer.id)) return;
    this.openingCarAsked.add(peer.id);
    const start = project(FOUNDER_OPENING_DRIVE_START.lat, FOUNDER_OPENING_DRIVE_START.lon);
    const pose = openingCarPose(peer.pose, start, this.roadSnap(peer.pose.x / 100, peer.pose.z / 100), facingYaw);
    if (typeof pose === 'string') { console.warn('opening car refused', pose); return; }
    // Review OD-M1: keyed per funding DEVICE, not peer — a reconnect is a new peer id, so a reload loop at the start used
    // to pile Teslas up until the world kerb cap refused kerb theft for everyone. A new ask replaces the device's
    // previous idle opening car (before the vehicle-there check: it may be the car in the way), and opening cars have
    // their own cap.
    const device = peer.fundingDeviceId;
    if (!device) { console.warn('opening car refused', 'no-device'); return; }
    const previous = this.openingCarOfDevice.get(device);
    if (previous !== undefined) { this.openingCarOfDevice.delete(device); this.vehicles.discardIdleOpening(previous); }
    if (this.vehicles.carNear(pose, 2.5) || this.anyVehicleNear(pose.x / 100, pose.z / 100, 2.5)) { console.warn('opening car refused', 'vehicle-there'); return; }
    const id = this.vehicles.allocateTaxiId();
    if (!this.vehicles.addOpeningCar(id, pose, 'tesla', now)) { console.warn('opening car refused', 'cap'); return; }
    this.openingCarOfDevice.set(device, id);
    if (this.openingCarOfDevice.size > 256) for (const [d, car] of this.openingCarOfDevice) if (!this.vehicles.cars.has(car)) this.openingCarOfDevice.delete(d);
    peer.send(encodeS2C(this.vehicleSnapshot(peer, now))); // the client must know the car before it's seated in it
    if (!this.vehicles.enter(peer.id, peer.pose, id, now)) { this.vehicles.discard(id); console.warn('opening car refused', 'enter-failed'); return; }
    this.taxis.cancel(peer.id, undefined, now);
    // Critic look check: the opening drive's road was empty — a few cars ahead on the way to the Ferry Building.
    const heading = pose.yaw / 256 * Math.PI * 2;
    // Review LOW: keep the seeded cars clear of parked fleet / kerb cars and police units ahead, not just other traffic.
    const obstacles = this.traffic ? [...this.vehicles.snapshot(this.tick, now).entries, ...this.police.entriesNear(pose.x, pose.z, 250 * 100)] : [];
    this.traffic?.seed({ x: pose.x / 100, z: pose.z / 100 }, { x: Math.sin(heading), z: Math.cos(heading) }, 3, obstacles); // >= 30 m ahead
  }
  /** Steal an SFPD cruiser (not a SWAT van / helicopter / officer): on foot within 4 m; it leaves the pursuit, becomes
   *  the player's car, and raises wanted (car theft + an assault on the police). */
  private stealPoliceCar(peer: Peer, unitId: number, now: number): void {
    const entry = this.police.entryById(unitId);
    if (!entry || entry.kind !== 'subaru' || (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0) return;
    if (!this.vehicles.takeTraffic(peer.id, peer.pose, { ...entry, speedCmps: 0 }, now)) return;
    this.police.destroyUnit(unitId);
    this.taxis.cancel(peer.id, undefined, now);
    if (wantedRaiseAllowed(flags)) { this.raiseWanted(peer.id, 'car-theft', now); this.raiseWanted(peer.id, 'cop-hit', now); }
  }
  /** policeRam: a cruiser hit a wanted driver's car — vehicle damage (smoke → fire → explosion) + shove the driver. */
  private applyPoliceRam(ram: PoliceRam, now: number): void {
    const peer = this.peers.get(ram.targetId);
    const vehicleId = peer ? this.vehicles.occupants.get(peer.id) : undefined;
    // Review C-L1: like police fire and busts, rams only hurt a player who accepted the 18+ combat gate.
    if (!peer || vehicleId === undefined || !peer.combatActive) return;
    // Review: re-check contact against the peer's REAL pose (incl. height, C-M1: freeway decks) before any damage.
    if (Math.hypot(ram.x - peer.pose.x / 100, ram.z - peer.pose.z / 100) > RAM_CONTACT_M + 0.5 || Math.abs(ram.y - peer.pose.y / 100) > RAM_MAX_DY_M) return;
    const dir = ramDirection(ram.x, ram.z, peer.pose.x / 100, peer.pose.z / 100);
    peer.send(encodeS2C({ type: 'POLICE_RAM', dirX: dir.x, dirZ: dir.z }));
    if (this.vehicleDamage.damage(vehicleId, RAM_DAMAGE)) this.explodeVehicle(vehicleId, now);
  }
  /** vitalsPickups: send a player their exact server-owned health + armour (armour makes the client's own maths wrong). */
  private sendVitals(peerId: number, always = false): void {
    if (!(flags.combat && (flags.vitalsPickups || always))) return;
    this.peers.get(peerId)?.send(encodeS2C({ type: 'COMBAT_VITALS', health: this.combat.healthOf(peerId), armour: this.combat.armourOf(peerId) }));
  }
  /** Health + armour pickups: respawn taken ones, then grant any available one an opted-in, alive player on foot is
   *  standing in (a player who is already full leaves it for someone else). Server-owned vitals; clients are told. */
  private stepPickups(now: number): void {
    this.pickupPositions ??= PICKUP_SPOTS.map(s => { const p = project(s.lat, s.lon); return { x: p.x, z: p.z }; });
    this.pickupTakenUntil.forEach((until, index) => {
      if (until > 0 && now >= until) {
        this.pickupTakenUntil[index] = 0;
        const bytes = encodeS2C({ type: 'PICKUP_STATE', index, available: true });
        for (const peer of this.peers.values()) peer.send(bytes);
      }
    });
    for (const peer of this.peers.values()) {
      if (!peer.combatActive || this.combat.healthOf(peer.id) <= 0 || (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) !== 0) continue;
      const x = peer.pose.x / 100, z = peer.pose.z / 100;
      this.pickupPositions.forEach((spot, index) => {
        if (this.pickupTakenUntil[index] || Math.hypot(spot.x - x, spot.z - z) > PICKUP_RADIUS_M) return;
        const next = applyPickup(PICKUP_SPOTS[index]!.kind, this.combat.healthOf(peer.id), this.combat.armourOf(peer.id));
        if (!next) return;
        this.combat.setVitals(peer.id, next.health, next.armour);
        this.sendVitals(peer.id);
        this.pickupTakenUntil[index] = now + PICKUP_RESPAWN_MS;
        const bytes = encodeS2C({ type: 'PICKUP_STATE', index, available: false });
        for (const other of this.peers.values()) other.send(bytes);
      });
    }
  }
  /** Any live vehicle (fleet, NPC traffic, police) as a snapshot entry, by id. */
  private vehicleEntryById(id: number): VehicleEntry | undefined {
    return this.vehicles.entry(id) ?? this.traffic?.vehicle(id) ?? (flags.wanted ? this.police.entryById(id) : undefined);
  }
  /** Live vehicles within `radiusM` of a point (metres) that can take damage (never cable cars or wrecks). */
  /** Any traffic or police vehicle within `radiusM` (metres, 2-D) — the fleet has its own carNear. */
  private anyVehicleNear(xM: number, zM: number, radiusM: number): boolean {
    const pose = { x: Math.round(xM * 100), y: 0, z: Math.round(zM * 100), yaw: 0, flags: 0 };
    const near = (e: { x: number; z: number }) => Math.hypot(e.x / 100 - xM, e.z / 100 - zM) <= radiusM;
    return (this.traffic?.snapshotFor(pose) ?? []).some(near) || this.police.entriesNear(pose.x, pose.z, radiusM * 100).some(near);
  }
  private damageableVehiclesNear(xM: number, zM: number, radiusM: number): VehicleEntry[] {
    const pose = { x: Math.round(xM * 100), y: 0, z: Math.round(zM * 100), yaw: 0, flags: 0 };
    const all = [...this.vehicles.snapshot(this.tick, Date.now()).entries, ...(this.traffic?.snapshotFor(pose) ?? []),
      ...(flags.wanted ? this.police.entriesNear(pose.x, pose.z, radiusM * 100) : [])];
    return all.filter(e => e.kind !== 'cable-car' && !this.vehicleDamage.isWreck(e.id) && Math.hypot(e.x / 100 - xM, e.z / 100 - zM) <= radiusM);
  }
  /** Vehicle damage: a validated shot that hit no player may hit a vehicle on its line (nearest along the ray, within a
   *  car's radius, line of sight through the loaded collision — same fail-closed rule as player shots). */
  private shootVehicle(peer: Peer, weapon: number, origin: [number, number, number], to: [number, number, number],
    collision: Parameters<typeof lineOfSight>[2] | null | undefined, now: number): void {
    const spec = WEAPONS[WEAPON_ORDER[weapon] ?? 'fists'];
    const amount = bulletDamage(spec.damage, spec.melee);
    if (!amount || !shotLosKnown(collision ?? undefined, this.combatCollision.status)) return;
    const range = Math.hypot(to[0] - origin[0], to[2] - origin[2]);
    const hit = vehicleOnShot(origin, to, this.damageableVehiclesNear(origin[0], origin[2], range + 3), {
      exclude: this.vehicles.occupants.get(peer.id), // a drive-by never hits the shooter's own car
      los: collision ? body => lineOfSight(origin, body, collision) : undefined });
    if (hit !== undefined && this.vehicleDamage.damage(hit, amount, peer.id, now)) this.explodeVehicle(hit, now);
  }
  /** Burn down burning vehicles and run queued chain explosions. */
  private stepVehicleDamage(now: number): void {
    const dt = this.vehicleDamageAt ? (now - this.vehicleDamageAt) / 1000 : 0;
    this.vehicleDamageAt = now;
    // Review: measure every driver's real speed from pose deltas (the cap for a reported crash) — sustained over two
    // ticks, reset by a teleport/respawn jump (B-M1), peak held 1.5 s.
    for (const peer of this.peers.values()) {
      if ((peer.pose.flags & DRIVER_FLAG) === 0) { this.driveTrack.delete(peer.id); continue; }
      this.driveTrack.set(peer.id, nextDriveTrack(this.driveTrack.get(peer.id), peer.pose.x / 100, peer.pose.z / 100, now));
    }
    const queued = this.pendingExplosions; this.pendingExplosions = [];
    for (const id of [...queued, ...this.vehicleDamage.tick(dt, id => this.vehicleEntryById(id) !== undefined)]) this.explodeVehicle(id, now);
  }
  /** Peak server-measured speed (m/s) of a driver's car over the last 1.5 s (0 when unknown). */
  private driveSpeedPeak(peerId: number, now: number): number {
    return drivePeak(this.driveTrack.get(peerId), now);
  }
  /** A vehicle explodes: remove it from its source (fleet ejects its occupant; NPC traffic + police are released), leave
   *  a wreck, broadcast the EXPLOSION, apply blast damage to opted-in players around it (the driver takes the full
   *  blast; a kill is the normal WASTED), and chain-damage vehicles nearby (their explosions run next tick). */
  private explodeVehicle(id: number, now: number): void {
    const entry = this.vehicleEntryById(id);
    if (!entry || this.vehicleDamage.isWreck(id)) return;
    const driverId = entry.driverId || [...this.vehicles.occupants].find(([, v]) => v === id)?.[0] || 0;
    // Review: whoever shot/crashed it owns the blast (wanted + the PvP kill path), never an anonymous bomb.
    const attacker = this.peers.get(this.vehicleDamage.attackerOf(id, now) ?? 0); // review B-L2: expires after 30 s
    if (this.vehicles.has(id)) this.vehicles.remove(id, now);
    else if (id >= POLICE_ID_BASE) this.police.destroyUnit(id);
    else this.traffic?.relinquish(id);
    this.vehicleDamage.wreck(entry, now);
    const at = { x: entry.x / 100, y: entry.y / 100, z: entry.z / 100 };
    const boom = encodeS2C({ type: 'EXPLOSION', x: entry.x, y: entry.y, z: entry.z });
    for (const other of this.peers.values()) if (Math.hypot(other.pose.x - entry.x, other.pose.z - entry.z) <= 40_000) other.send(boom);
    for (const victim of this.peers.values()) {
      if (!victim.combatActive) continue;
      const d = victim.id === driverId ? 0 : Math.hypot(victim.pose.x / 100 - at.x, victim.pose.y / 100 - at.y, victim.pose.z / 100 - at.z);
      const amount = blastDamage(d);
      if (!amount) continue;
      const hit = this.combat.damage(victim.id, amount, now);
      if (!hit) continue;
      try { // review WG-M1: settle the death even if the victim's COMBAT_HIT fails to encode/send
        // To the victim only (their HUD health / WASTED); weapon 0 = no tracer or gunshot on the client.
        victim.send(encodeS2C({ type: 'COMBAT_HIT', shooterId: id, weapon: 0, origin: [at.x, at.y + 1, at.z],
          to: [victim.pose.x / 100, victim.pose.y / 100 + CHEST_M, victim.pose.z / 100], targetId: victim.id, damage: amount, killed: hit.killed }));
        if (!hit.killed) this.sendVitals(victim.id);
        if (attacker && attacker !== victim && wantedRaiseAllowed(flags)) this.raiseWanted(attacker.id, hit.killed ? 'ped-kill' : 'assault', now);
      } finally {
        // The attributed attacker is the killer for the (victim-funded) Most Wanted bounty, applied after the WASTED debit.
        if (hit.killed) this.ctx.waitUntil(this.applyPvpDeath(victim, now, attacker && attacker !== victim ? attacker : undefined).catch(() => undefined));
      }
    }
    for (const e of this.damageableVehiclesNear(at.x, at.z, EXPLOSION_RADIUS_M)) {
      if (e.id !== id && this.vehicleDamage.damage(e.id, blastDamage(Math.hypot(e.x / 100 - at.x, e.z / 100 - at.z)) * CHAIN_BLAST_MULTIPLIER)) this.pendingExplosions.push(e.id);
    }
  }
  /** SFPD on foot (flag sfpdOnFoot): send each peer the officers within 400 m; a peer whose list just emptied gets
   *  one clearing message, then nothing until officers are near again. */
  private broadcastOfficers(): void {
    for (const peer of this.peers.values()) {
      const entries: { id: number; x: number; y: number; z: number; yaw: number; moving: boolean }[] = [];
      for (const o of this.police.officersNear(peer.pose.x / 100, peer.pose.z / 100, 400)) {
        if (entries.length >= OFFICERS_MAX) break;
        entries.push({ id: o.id, x: Math.round(o.x * 100), y: Math.round(o.y * 100), z: Math.round(o.z * 100), yaw: o.yaw, moving: o.speedMps > 0.2 });
      }
      if (!entries.length && !this.officerViewers.has(peer.id)) continue;
      if (entries.length) this.officerViewers.add(peer.id); else this.officerViewers.delete(peer.id);
      peer.send(encodeS2C({ type: 'OFFICERS', entries }));
    }
  }
  /** BUSTED: clear the wanted level and pursuit at once (so the next tick can't re-bust during the debit), apply −5%
   *  server-side (srv: incident), THEN tell the client (so its HUD refresh reads the debited valuation) and respawn. */
  private async applyBust(peer: Peer, now: number): Promise<void> {
    this.bustStates.delete(peer.id);
    if (this.combat.healthOf(peer.id) <= 0 || this.bustsInFlight.has(peer.id)) return; // never charge twice
    this.bustsInFlight.add(peer.id);
    try { await this.settleBust(peer, now); } finally { this.bustsInFlight.delete(peer.id); }
  }
  private async settleBust(peer: Peer, now: number): Promise<void> {
    const downAt = peer.pose; // where they were arrested, before the debit await
    this.wantedStates.delete(peer.id);
    if (peer.fundingDeviceId) this.combatPersist.forget(peer.fundingDeviceId); // gtasf-h6xe8: a reset mid-settle can't restore the heat
    this.police.forget(peer.id);
    peer.send(encodeS2C({ type: 'WANTED', level: 0 }));
    if (peer.fundingDeviceId) {
      try {
        const incident = `srv:${crypto.randomUUID()}`, device = peer.fundingDeviceId;
        await settleWithRetry(i => applyCombatPenalty(this.env.DB, device, incident, 'busted', i ? Date.now() : now));
        await this.funding?.refreshAfterRide(peer.fundingDeviceId, now); // drop the 5 s profile cache so polls show the debit
      } catch (error) { console.warn('bust penalty failed', error instanceof Error ? error.name : 'unknown'); }
    }
    if (this.peers.get(peer.id) !== peer) return; // disconnected during the debit
    peer.send(encodeS2C({ type: 'BUSTED' }));
    this.combat.reset(peer.id, now); // full health + spawn protection on release
    this.respawnAt(peer, now, downAt);
  }
  /** quickDropKerb: the 2.6 m cab-to-kerb step must not cross a building wall (narrow street, no sidewalk). Unknown
   *  collision (cold chunk, or a world without collision data) allows it, like the old fixed exit step. */
  private kerbStepClear(from: Pose, to: Pose): boolean {
    const collision = this.combatCollision.near(to.x / 100, to.z / 100);
    return !collision || lineOfSight([from.x / 100, from.y / 100 + 1, from.z / 100], [to.x / 100, to.y / 100 + 1, to.z / 100], collision);
  }
  /** Move a peer to SF General — or, with nearestHospitalRespawn (critic N20), the nearest hospital to where they went
   *  down — road-snapped, and CORRECTION them there: the authoritative death/bust respawn. */
  private respawnAt(peer: Peer, now: number, downAt: Pose = peer.pose): void {
    if (this.peers.get(peer.id) !== peer) return;
    // review fix 2b (anti-teleport): a death respawn teleports the player to SF General — drop any in-flight
    // mission/trial/quest so you can't die mid-heist and complete it from the respawn point.
    if (peer.fundingDeviceId) this.clearDeviceQuests(peer.fundingDeviceId);
    const hospital = flags.nearestHospitalRespawn
      ? nearestHospital({ x: downAt.x / 100, z: downAt.z / 100 }, project) : SF_GENERAL_RESPAWN;
    const spot = project(hospital.lat, hospital.lon);
    const base: Pose = { x: Math.round(spot.x * 100), y: peer.pose.y, z: Math.round(spot.z * 100), yaw: 0, flags: 0 };
    let pose: Pose = base;
    const snap = this.recoveryRoads.snap(base, 400);
    if (snap) {
      const points = snap.edge.points;
      let distance = 0, index = 1;
      for (; index < points.length - 1; index++) {
        const a = points[index - 1]!, b = points[index]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (distance + length >= snap.along) break;
        distance += length;
      }
      const a = points[index - 1]!, b = points[index]!;
      pose = routePose({ from: a, to: b, length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), speed: 0 }, snap.along - distance);
    }
    this.taxis.cancel(peer.id, undefined, now);
    this.vehicles.disconnect(peer.id, now);
    Object.assign(peer.session.movement, { pose, lastAt: now, carryCm: 0 }); peer.pose = pose;
    peer.send(encodeS2C({ type: 'CORRECTION', pose }));
    this.sessions.save(peer.session);
  }
  /** Zoned world: carry a near-border fire to the neighbour cells that could hold a viewer within the
   *  relay radius of the splat (mirrors fanoutChat). Computed from the firer's cell so the home cell is
   *  never re-sent; each sibling re-applies nearMayhem. No-op when the firer is clear of any border. */
  private fanoutMayhem(broadcast: Extract<S2CMessage, { type: 'MAYHEM_FIRE' }>, senderPose: Pose): void {
    const cells = borderObservers(SF_ZONE_GRID, senderPose.x / 100, senderPose.z / 100, MAYHEM_RELAY_RADIUS_M);
    if (!cells.length) return;
    const payload = JSON.stringify({ broadcast });
    for (const cell of cells) {
      const stub = this.env.WORLD.get(this.env.WORLD.idFromName(zoneId(cell.cx, cell.cy)));
      this.ctx.waitUntil(stub.fetch('https://world.internal/internal/mayhem/relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      }).then(() => undefined).catch(() => undefined));
    }
  }
  /** Each read-only observer sees this zone's nearest players to its filter pose, as a
   * ghost (id -1, never a peer) so the zone's players never see it. 60 entries fit one
   * frame; the client merges across its home + neighbour-observer sockets with no seam. */
  private broadcastObservers(now: number): void {
    for (const [socket, connection] of this.connections) {
      if (!connection.observer || !connection.observerPose) continue;
      const ghost: WorldPeer = { id: -1, pose: connection.observerPose, send: () => {} };
      const entries = snapshotEntries(ghost, this.peers.values(), this.tick, NEAREST_FULL);
      try {
        socket.send(encodeS2C({ type: 'SNAPSHOT', tick: this.tick, serverT: now, entries }));
        if (flags.driving || flags.robotaxi || flags.traffic || flags.cableCars)
          socket.send(encodeS2C(this.vehicleSnapshot(ghost, now)));
        // Cross-zone looks: send APPEARANCE for a visible player whenever this observer hasn't seen that
        // id's current value (first sight or a change), so a border player renders their status look
        // rather than the default (gtasf-apsync2). Observers get SNAPSHOT (pose) but not PLAYER_JOIN.
        if (flags.characterLooks || flags.personalRides) {
          const seen = connection.observerLooks ??= new Map<number, number>();
          for (const entry of entries) {
            const appearance = this.peers.get(entry.id)?.appearance ?? 0;
            if (seen.get(entry.id) !== appearance) { seen.set(entry.id, appearance); socket.send(encodeS2C({ type: 'APPEARANCE', id: entry.id, appearance })); }
          }
        }
      } catch (error) { this.closeCause = `observer send failed ${error instanceof Error ? error.message.slice(0, 80) : ''}`; this.remove(socket, 1011); }
    }
  }
  private setVehiclePose(playerId: number, pose: Pose, now: number): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    this.taxis.renewPassengerActivity(playerId, peer.pose, pose, now, peer.session);
    this.cableCars?.renewPassengerActivity(playerId, peer.pose, pose, now, peer.session);
    if (flags.rideAnyVehicle) this.movingRides.renewPassengerActivity(playerId, peer.pose, pose, now, peer.session);
    peer.pose = pose;
    this.notePoseProgress(peer);
    Object.assign(peer.session.movement, { pose, lastAt: now, carryCm: flags.quickRobotaxi && this.taxis.trips.get(playerId)?.quick ? 0 : MOVE_BURST_CM });
    this.chat?.presenceChanged(playerId);
    this.sessions.save(peer.session);
  }
  private configureZoneFleet(): void {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_vehicle_ids (id INTEGER PRIMARY KEY CHECK(id=1), next_id INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO world_vehicle_ids VALUES (1,1000)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_vehicle_departed (id INTEGER PRIMARY KEY)');
    this.vehicles.configureZone(this.zoneCellIndex!, () => {
      // Exclude the NPC range (1,000,000+) even after DO restarts and outbound transfers.
      const row = this.ctx.storage.sql.exec<{ next_id: number }>('UPDATE world_vehicle_ids SET next_id=next_id+1 WHERE id=1 AND next_id<1000000 RETURNING next_id').toArray()[0];
      if (!row) throw new Error('Zone taxi ID range exhausted');
      return row.next_id - 1;
    });
    for (const row of this.ctx.storage.sql.exec<{ id: number }>('SELECT id FROM world_vehicle_departed')) this.vehicles.cars.delete(row.id);
  }
  private vehicleSnapshot(peer: WorldPeer, now: number, fleet = this.vehicles.snapshot(this.tick, now)) {
    const occupiedId = this.vehicles.occupants.get(peer.id);
    const entries = fleet.entries.filter(car => car.kind !== 'cable-car' && (car.id === occupiedId || car.driverId === peer.id ||
      Math.hypot(car.x - peer.pose.x, car.z - peer.pose.z) <= 50_000));
    // Each packet is the recipient's complete visible set. Separate NPC packets would erase parked cars.
    const fleetIds = new Set(entries.map(entry => entry.id));
    const traffic = (this.traffic?.snapshotFor(peer.pose) ?? []).filter(entry => !fleetIds.has(entry.id));
    if (flags.zonedWorld && this.zoneCellIndex !== undefined)
      for (const car of traffic) car.id = zonedVehicleId(this.zoneCellIndex, car.id);
    // SFPD cars ride the same snapshot (police-flagged NPC cars); authoritative ids, so not zoned-remapped.
    const police = flags.combat && flags.wanted ? this.police.entriesNear(peer.pose.x, peer.pose.z) : [];
    if (!(flags.combat && flags.vehicleDamage)) return { ...fleet, entries: [...entries, ...traffic, ...police] };
    // Vehicle damage: smoke/fire bits on damaged cars (ids are raw here for fleet + police), plus nearby wrecks.
    const marked = [...entries, ...traffic, ...police].map(e => this.vehicleDamage.trackedCount ? { ...e, flags: this.vehicleDamage.flagsFor(e.id, e.flags) } : e);
    return { ...fleet, entries: [...marked, ...this.vehicleDamage.wreckEntries(peer.pose.x, peer.pose.z, now)] };
  }
  private expire(now: number): void {
    if (this.dropGrace.size) this.settleDropGrace(now);
    for (const id of this.handingOff) {
      const pending = this.transfers?.outgoing(id), peer = this.peers.get(id);
      if (peer && pending?.claimed === 0 && pending.expires <= now) this.cancelHandoff(peer);
    }
    for (const [socket, connection] of this.connections) {
      if (connection.observer && connection.expiresAt <= now) this.remove(socket, CloseCode.IDLE);
      else if (!connection.peer && connection.expiresAt <= now) this.remove(socket, CloseCode.BAD_HELLO);
      else if (connection.peer && connection.peer.session.lastSeen + IDLE_MS <= now) this.remove(socket, CloseCode.IDLE);
      else if (connection.peer && flags.worldCapacity && connection.peer.session.lastInput + INPUT_IDLE_MS <= now) this.remove(socket, CloseCode.INPUT_IDLE);
    }
  }
  private arm(): void {
    // gtasf-27jen: an EMPTY world (no peers, no pending sockets) doesn't need expiry alarms: sessions are pruned on the next
    // construction and resumes check lastSeen themselves; reserve() prunes expired admissions and count() ignores them. In
    // prod each such alarm woke an evicted DO only to reload the 23 MB road graph (~1 s CPU, 11 of 21 wakes in 40 min).
    // The referral flush still arms (it writes D1).
    const active = this.peers.size > 0 || this.connections.size > 0;
    let next = Math.min(active ? this.sessions.nextExpiry() ?? Infinity : Infinity, active ? this.reservations.nextExpiry() ?? Infinity : Infinity,
      this.referralPlay?.nextFlushAt ?? Infinity);
    for (const connection of this.connections.values()) next = Math.min(next,
      connection.peer ? Math.min(connection.peer.session.lastSeen + IDLE_MS, flags.worldCapacity ? connection.peer.session.lastInput + INPUT_IDLE_MS : Infinity) : connection.expiresAt);
    // The world just went empty (or woke empty) and nothing needs an alarm: drop the one a player's session already armed,
    // or it still fires and wakes the evicted DO (prod after #6.20: a join, leave, then an alarm wake). armedAt is in-memory
    // only, so a woken DO can't know about the stored alarm; delete once per empty spell.
    if (!active && next === Infinity) {
      if (!this.alarmCleared) { this.alarmCleared = true; this.armedAt = Infinity; void this.ctx.storage.deleteAlarm().catch(() => undefined); } // a DO storage op: the output gate commits it
      return;
    }
    if (next < this.armedAt) {
      this.armedAt = next; this.alarmCleared = false;
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next)));
    }
  }
  /** gtasf-j7wvv: the tick is a bare setInterval callback — an uncaught throw there can reset the whole Durable Object
   *  (every socket drops, in-memory combat/police state is lost). Run each combat step (and each per-peer snapshot)
   *  guarded: a failure is logged by name with its stack (visible in wrangler tail) and the world keeps ticking. */
  /** Review WG-M1 (gtasf-kill-settle-before-broadcast-yda5o): a contained throw between a killing hit and
   *  applyPvpDeath used to leave the victim at 0 health with no debit and no respawn, forever (every damage/regen/bust
   *  path skips dead players). Any connected peer dead for DEAD_SETTLE_GRACE_MS with no settlement in flight is settled
   *  here; applyPvpDeath is single-flight per victim, so this can never double-debit a death that is merely slow. */
  private stepDeadWatchdog(now: number): void {
    const dead: number[] = [];
    for (const peer of this.peers.values()) if (this.combat.healthOf(peer.id) <= 0) dead.push(peer.id);
    if (!dead.length && !this.deadSeenAt.size) return;
    for (const id of overdueDeaths(dead, this.deathsInFlight, this.deadSeenAt, now)) {
      const victim = this.peers.get(id);
      if (!victim) continue;
      console.warn('dead peer unsettled; settling', id);
      this.ctx.waitUntil(this.applyPvpDeath(victim, now).catch(() => undefined));
    }
  }
  private guarded(step: string, fn: () => void): void {
    try { fn(); } catch (error) {
      const now = Date.now();
      if (now - (this.stepErrorAt.get(step) ?? 0) > 10_000) { // at most one log per step per 10 s
        this.stepErrorAt.set(step, now);
        console.error('world step failed', step, error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error));
      }
    }
  }
  private step(): void {
    if (!this.roadsReady) return;
    const now = Date.now();
    const gap = now - this.lastStepAt; this.lastStepAt = now;
    if (gap > 1000 && gap < 30_000 && this.peers.size && now - this.stallLogAt > 10_000) {
      this.stallLogAt = now;
      console.warn('world tick stall', gap, 'ms | peers', this.peers.size, 'sockets', this.ctx.getWebSockets().length);
    }
    this.expire(now);
    this.saveCombatState(now);
    this.saveRuns(now);
    this.paidRides.sweep(id => this.taxis.trips.has(id)); // a cancelled/timed-out ride keeps today's no-refund rule
    this.tick = (this.tick + 1) >>> 0;
    if (flags.robotaxi) this.taxis.step(now);
    this.cableCars?.step(now);
    if (flags.zonedWorld && this.zoneCellIndex !== undefined)
      for (const peer of this.peers.values()) if (this.vehicles.occupants.has(peer.id)) this.maybeHandoff(peer);
    this.chat?.tick(now);
    if (this.voice && this.tick % 3 === 0) this.stepVoice();
    this.funding?.tick(now);
    if (flags.streetRaces && this.streetRaces.size) this.streetRaces.step(now);
    if (flags.mostWantedBounty && flags.combat && flags.openPvp && this.funding) this.bounty.step(now);
    this.drops?.tick(now);
    this.observeReferralPlay(now);
    if (flags.combat && this.combatStash.size) { // review fix 4: drop stashes nobody reconnected to in time
      for (const [device, stash] of this.combatStash) if (stash.expiresAt <= now) this.combatStash.delete(device);
    }
    if (flags.combat && flags.serverHits) this.warmShooterCollision(); // player shots wall-checked from the first one
    if (flags.combat) this.guarded('deadWatchdog', () => this.stepDeadWatchdog(now)); // review WG-M1: nobody stays dead
    if (flags.combat && flags.vehicleDamage) this.guarded('vehicleDamage', () => this.stepVehicleDamage(now));
    if (flags.combat && flags.vitalsPickups) this.guarded('pickups', () => this.stepPickups(now));
    if (flags.combat && flags.healthRegen) this.guarded('healthRegen', () => { // GTA V-style regen up to half; the HUD follows via COMBAT_VITALS
      const dtMs = this.regenAt ? now - this.regenAt : 0; this.regenAt = now;
      for (const id of this.combat.regenerate(now, Math.min(dtMs, 1000))) this.sendVitals(id, true);
    });
    if (flags.combat && flags.wanted) this.guarded('wanted+police', () => {
      const dt = this.wantedLastAt ? (now - this.wantedLastAt) / 1000 : 0;
      this.wantedLastAt = now;
      // Steer the SFPD toward every wanted player, then decay heat only for players who've broken police LoS.
      const targets: { id: number; x: number; y: number; z: number; level: number; onFoot: boolean; driving: boolean }[] = [];
      for (const peer of this.peers.values()) {
        const level = wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0);
        if (level > 0) targets.push({ id: peer.id, x: peer.pose.x / 100, y: peer.pose.y / 100, z: peer.pose.z / 100, level,
          onFoot: (peer.pose.flags & (DRIVER_FLAG | PASSENGER_FLAG)) === 0, driving: (peer.pose.flags & DRIVER_FLAG) !== 0 && this.vehicles.occupants.has(peer.id),
          ...(flags.sfpdCover ? { firing: now - this.combat.lastFireOf(peer.id) < SFPD_FIRING_WINDOW_MS } : {}) }); // gtasf-ex3nf
      }
      this.warmPoliceCollision(targets); // police fire + off-road steps fail closed without loaded collision
      const rams = this.police.update(dt, targets, { air: flags.policeAir, foot: flags.sfpdOnFoot, ram: flags.policeRam && flags.vehicleDamage, // Combat 5b heli/SWAT; officers on foot
        cover: flags.policePresence, // critique #16: officers fight from their cruiser door at 2★+
        takeCover: flags.sfpdCover, // gtasf-ex3nf: officers under fire break for a stopped cruiser's far side
        canSee: (unit, t) => this.policeCanSee(unit, t), // gtasf-abijv: sight needs a clear line, units chase the last-seen spot
        trackUntilSighted: flags.dispatchTracksUntilSighted, // critic N38: units find the player before last-seen searching applies
        ...(flags.wantedEscape ? { inCover: (t: { x: number; z: number }) => this.inHideout(t.x, t.z) } : {}) }); // gtasf-66lvh: garage cover
      for (const ram of rams) this.applyPoliceRam(ram, now); // policeRam: PIT / ramming
      for (const peer of this.peers.values()) {
        const entry = this.wantedStates.get(peer.id);
        if (!entry || entry.state.heat <= 0) { this.escapeStates.delete(peer.id); this.escapeSent.delete(peer.id); this.sightingHolds.delete(peer.id); continue; }
        const escaped = this.police.escapedFor(peer.id, peer.pose.x / 100, peer.pose.z / 100);
        // escapeWaitsForSighting (critic N38): no clock runs until the police have actually found the player (see escape.ts).
        let holding = false;
        if (flags.escapeWaitsForSighting) {
          const hold = stepSightingHold(this.sightingHolds.get(peer.id), { seen: !escaped, dtMs: dt * 1000, sightM: SFPD_TUNING.sightM,
            nearestUnitM: this.police.nearestUnitTo(peer.id, peer.pose.x / 100, peer.pose.z / 100) });
          this.sightingHolds.set(peer.id, hold.state); holding = hold.holding;
        }
        if (this.wantedSightSent.get(peer.id) !== !escaped) { // the escape flash follows the server's sight (on change)
          this.wantedSightSent.set(peer.id, !escaped);
          const last = this.police.lastSeenOf(peer.id) ?? { x: peer.pose.x / 100, z: peer.pose.z / 100 };
          peer.send(encodeS2C({ type: 'WANTED_SIGHT', seen: !escaped, x: Math.round(last.x * 100), z: Math.round(last.z * 100) }));
        }
        // escapeOwnsClear (phone chase 10-20): with wantedEscape the escape clock is the ONLY way stars drop (GTA: lose them all
        // after the search). The legacy decay ran beside it and cleared 3 stars ~3 s after reaching a garage, mid 'SEARCHING 7s'.
        const legacyDecay = !(flags.wantedEscape && flags.escapeOwnsClear);
        entry.state = tickWanted(entry.state, dt, escaped && !holding && legacyDecay, now);
        let escapeRan = false;
        if (flags.wantedEscape) this.guarded('wantedEscape', () => { this.stepWantedEscape(peer, entry, !escaped, dt * 1000, now, holding); escapeRan = true; });
        // Review 1.2 HIGH: if the escape step threw, the legacy decay runs this tick, so an exception can't pin the stars.
        if (flags.wantedEscape && !legacyDecay && !escapeRan) entry.state = tickWanted(entry.state, dt, escaped && !holding, now);
        this.broadcastWanted(peer.id);
      }
      if (flags.policeBust) this.guarded('busts', () => this.stepBusts(now));
      if (flags.policeFire && flags.serverHits) this.guarded('policeFire', () => this.stepPoliceFire(now));
    });
    this.vehicles.replenishParked(now, this.peers.values());
    let fleet = this.vehicles.snapshot(this.tick, now);
    if (flags.traffic && this.traffic) {
      this.traffic.step((now - this.trafficLastAt) / 1000, [...this.peers.values()].map(peer => peer.pose), now,
        fleet.entries.filter(entry => !(entry.flags & 0x20)), flags.rideAnyVehicle ? this.movingRides.retainedTraffic : undefined);
      this.trafficLastAt = now;
    }
    if (flags.rideAnyVehicle) { this.movingRides.step(now); fleet = this.vehicles.snapshot(this.tick, now); }
    // Zoned instances bound each player's snapshot to the nearest 60 (hotspot defence);
    // the single world ('sf') sends unbounded as today (docs/engineering/zoned-world.md §6).
    broadcastSnapshots(this.peers, this.tick, now, flags.zonedWorld || flags.boundedInterest ? NEAREST_FULL : undefined);
    if (flags.zonedWorld) this.broadcastObservers(now);
    if (flags.driving || flags.robotaxi || flags.traffic || flags.cableCars)
      for (const peer of this.peers.values()) this.guarded('vehicleSnapshot', () => peer.send(encodeS2C(this.vehicleSnapshot(peer, now, fleet))));
    if (flags.combat && flags.wanted && flags.sfpdOnFoot) this.guarded('officers', () => this.broadcastOfficers());
    this.ticker.maybeStopTicking();
  }
  private observeReferralPlay(now: number): void {
    this.referralPlay?.observe(now, [...this.peers.values()].filter(peer => peer.fundingDeviceId
      && peer.session.lastSeen + IDLE_MS > now && peer.session.lastInput + INPUT_IDLE_MS > now).map(peer => peer.fundingDeviceId!));
  }
  private handleVoice(peer: Peer, message: Extract<C2SMessage, { type: 'VOICE_PUBLISH' | 'VOICE_STOP' | 'VOICE_MUTE' }>): void {
    const voice = this.voice!;
    if (message.type === 'VOICE_MUTE') { voice.mute(peer.id, message.target, message.muted); return; }
    const generation = (this.voiceGeneration.get(peer.id) ?? 0) + 1;
    this.voiceGeneration.set(peer.id, generation);
    if (message.type === 'VOICE_STOP') { if (voice.stop(peer.id)) peer.send(encodeS2C({ type: 'VOICE_STATE', playerId: peer.id, state: 'stopped' })); return; }
    // A new publish replaces any previous hold immediately; only this authorisation may start the next one.
    voice.stop(peer.id);
    const { sessionId, trackName } = message;
    this.ctx.waitUntil(this.voiceAuthorize(peer.fundingDeviceId, sessionId, trackName, 'publish').catch(() => 'refused-off' as const).then(state => {
      if (this.peers.get(peer.id) !== peer || this.voiceGeneration.get(peer.id) !== generation) return;
      if (state === 'speaking') voice.publish(peer.id, { sessionId, trackName });
      peer.send(encodeS2C({ type: 'VOICE_STATE', playerId: peer.id, state }));
    }));
  }
  private readonly voiceHandoffs = new VoiceGrantHandoffs((device, tracks) => this.voiceGrants(device, tracks));
  /** Recompute hearing; subscription grants must be persisted before announcing their tracks. */
  private stepVoice(): void {
    const voice = this.voice!, now = Date.now();
    const players = [...this.peers.values()].map(peer => ({
      id: peer.id, x: peer.pose.x, y: peer.pose.y, z: peer.pose.z,
      vehicleId: this.vehicles.occupants.get(peer.id) ?? 0, eventId: this.chat?.roomOf(this.chatPeer(peer)) ?? 0,
    }));
    for (const [listener, peers] of voice.update(players)) {
      const peer = this.peers.get(listener);
      if (!peer) continue;
      if (peer.fundingDeviceId) this.voiceHandoffs.replace(peer.fundingDeviceId, listener, peers, () => {
        if (this.peers.get(listener) === peer) peer.send(encodeS2C({ type: 'VOICE_PEERS', peers }));
      });
    }
    for (const work of this.voiceHandoffs.flush(now)) this.ctx.waitUntil(work);
    // Bans (e.g. from reports) and revoked tracks take effect within ~10 s, not only at the next publish.
    if (now < this.voiceRecheckAt) return;
    this.voiceRecheckAt = now + 10_000;
    for (const [playerId, track] of voice.active()) {
      const peer = this.peers.get(playerId), generation = this.voiceGeneration.get(playerId);
      if (!peer) continue;
      this.ctx.waitUntil(this.voiceAuthorize(peer.fundingDeviceId, track.sessionId, track.trackName, 'recheck').catch(() => 'speaking' as const).then(state => {
        if (state === 'speaking' || this.peers.get(playerId) !== peer || this.voiceGeneration.get(playerId) !== generation) return;
        voice.stop(playerId);
        peer.send(encodeS2C({ type: 'VOICE_STATE', playerId, state }));
      }));
    }
  }
  /** Last ~2 min of each speaker's APPROVED captions, in memory only; attached to a report on request. */
  protected readonly captionRing = new CaptionRing();
  /** Test seam; production uses Workers AI Whisper from env.AI (ElevenLabs Scribe only as a dormant fallback). */
  protected captionStt: SttAdapter | null | undefined;
  private async handleCaption(request: Request): Promise<Response> {
    if (!flags.voiceCaptions || !this.chat) return admissionJson({ error: 'off' }, 404);
    const now = Date.now(), device = request.headers.get('X-GTASF-Device') ?? '', reserved = Number(request.headers.get('X-GTASF-Reserved'));
    // Same-browser tabs share a device id: prefer the speaking tab's own peer (X-GTASF-Player), but only if it
    // belongs to this device; otherwise the caption went to another tab and the speaker never saw their bubble.
    const player = Number(request.headers.get('X-GTASF-Player')), mine = [...this.peers.values()].filter(candidate => device && candidate.fundingDeviceId === device);
    const peer = mine.find(candidate => candidate.id === player) ?? mine[0];
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const stt = this.captionStt !== undefined ? this.captionStt : createSttAdapter(this.env);
    if (!stt) return admissionJson({ error: 'unconfigured' }, 503);
    const result = await stt(await request.arrayBuffer(), { mimeType: request.headers.get('Content-Type') || 'audio/webm' });
    // The reason is provider status/kind only (never audio or text), so it's safe to log for diagnosis.
    // A refused/failed call (e.g. ElevenLabs 401 payment_issue) bills nothing: release the reservation so an outage
    // can't exhaust the day's meter.
    if (!result.ok) {
      console.warn('caption STT failed', result.reason ?? 'unknown', { bytes: request.headers.get('Content-Length') });
      await releaseCaptionSeconds(this.env.DB, reserved, now); await countCaption(this.env.DB, 'unavailable', device, now);
      return admissionJson({ error: 'unavailable' }, 503);
    }
    // Charge what the provider actually measured (the cap must reflect real spend).
    await reconcileCaptionSeconds(this.env.DB, Number.isFinite(reserved) ? reserved : 0, result.durationSeconds, now);
    const text = fitCaption(result.transcript ?? '');
    if (!text) { console.log('caption outcome', 'empty', { seconds: Math.round(result.durationSeconds ?? 0) }); await countCaption(this.env.DB, 'empty', device, now); return admissionJson({ status: 'empty' }); }
    const current = this.peers.get(peer.id);
    if (!current) return admissionJson({ error: 'not-connected' }, 409);
    const info: { score?: number } = {};
    const outcome = await this.chat.spoken(this.chatPeer(current), text, info);
    // Outcome + a coarse jev score bucket only (never the transcript), so wrangler tail shows why a caption didn't show.
    const s = info.score;
    console.log('caption outcome', outcome, { score: s === undefined ? 'none' : s < .3 ? '<0.3' : s < .5 ? '0.3-0.5' : s < .95 ? '0.5-0.95' : '>=0.95', graphemes: [...text].length });
    // Voice metrics (no PII): count every caption that reached moderation by outcome (gtasf-voice-metrics).
    if (outcome !== 'gone') await countCaption(this.env.DB, outcome, device, now);
    if (outcome === 'rejected') { await recordCaptionStrike(this.env.DB, device, now); return admissionJson({ status: 'rejected' }); }
    if (outcome === 'unavailable') return admissionJson({ error: 'unavailable' }, 503); // moderation down: no strike
    if (outcome === 'dropped') return admissionJson({ status: 'rejected' }); // borderline score: not shown, no strike
    if (outcome === 'gone') return admissionJson({ error: 'not-connected' }, 409);
    this.captionRing.add(device, text, now);
    // Living map pitching (gtasf-y5vc): a moderated caption spoken next to an angel or VC office is a pitch.
    // Judge the full transcript (up to the judge's 600 chars), not the 160-grapheme bubble: a 15 s pitch runs longer.
    const pitch = flags.pitching ? await this.pitchFromCaption(current, device, (result.transcript ?? text).replace(/\s+/g, ' ').trim() || text, outcome, now) : undefined;
    return admissionJson(pitch ? { status: 'sent', pitch } : { status: 'sent' });
  }
  private async pitchFromCaption(peer: Peer, device: string, text: string, outcome: PitchModeration, now: number): Promise<PitchOutcome | { status: 'unnamed' } | undefined> {
    const target = this.funding ? pitchTargetNear(peer.pose.x / 100, peer.pose.z / 100, pitchSpotsAt(now)) : undefined;
    if (!target || !this.funding) return;
    const db = this.env.DB, key = this.env.OPENROUTER_API_KEY, funding = this.funding;
    try {
      // The ledger refuses unnamed players; check first so their pitch never spends judge budget.
      const profile = await getFundingProfile(db, device, now);
      if (!profile.startupName || !profile.nickname) return { status: 'unnamed' };
      return await runPitch(target, text, outcome, now, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        // No key configured: never reserve, so every pitch takes the deterministic fallback.
        reserve: () => key ? reserveJudgeSpend(db, now) : Promise.resolve(false),
        reconcile: actual => reconcileJudgeSpend(db, now, actual),
        judge: openRouterJudge(key ?? ''),
        award: input => funding.award(device, input, now),
      });
    } catch (error) {
      if (error instanceof RangeError && /startup/.test(error.message)) return { status: 'unnamed' };
      console.warn('pitch failed', error instanceof Error ? error.name : 'unknown');
      return;
    }
  }
  /** Founder-ladder tap pitch: a curated line (sent by INDEX, resolved server-side) to the plaza VC, judged by
   *  the same AI judge + $10/day cap + fallback as voice, paying a cheque that moves the player to Pre-seed. */
  private async handlePitchTap(request: Request): Promise<Response> {
    if (!flags.pitching || !this.funding) return admissionJson({ error: 'off' }, 404);
    let body: unknown; try { body = await request.json(); } catch { return admissionJson({ error: 'Invalid body' }, 400); }
    const line = founderPitchLine((body as { lineIndex?: unknown } | null)?.lineIndex);
    if (line === null) return admissionJson({ error: 'Invalid pitch line' }, 400);
    // memeNpcId → a phase-5 meme NPC pitch quest (flags.memeQuests; fictional persona). Else: no vcId → the
    // Ferry-plaza VC (Pre-seed), vcId === FOUNDER_SEED_VC_ID → the Seed VC office, vcId === FOUNDER_SERIES_A_ID
    // → the phase-6 Demo Day fictional hacker house (flags.seriesAQuest), all under flags.founderLadder.
    // Any other id is rejected (the resolvers return undefined), so this card route can't pitch arbitrary firms.
    const memeNpcId = typeof (body as { memeNpcId?: unknown } | null)?.memeNpcId === 'string' ? (body as { memeNpcId: string }).memeNpcId : undefined;
    const vcId = typeof (body as { vcId?: unknown } | null)?.vcId === 'string' ? (body as { vcId: string }).vcId : undefined;
    let target;
    if (memeNpcId) {
      if (!flags.memeQuests) return admissionJson({ error: 'off' }, 404);
      target = founderMemePitchTarget(memeNpcId);
    } else if (vcId === FOUNDER_SERIES_A_ID) {
      if (!flags.founderLadder || !flags.seriesAQuest) return admissionJson({ error: 'off' }, 404);
      target = founderSeriesATarget();
    } else {
      if (!flags.founderLadder) return admissionJson({ error: 'off' }, 404);
      target = founderPitchTarget(vcId);
    }
    if (!target) return admissionJson({ error: 'No such pitch target' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const now = Date.now(), db = this.env.DB, key = this.env.OPENROUTER_API_KEY, funding = this.funding;
    // No proximity gate here: this is the scripted, card-driven first pitch (the ladder flow opens the pitch
    // card at the Ferry plaza; the player never "walks up"), so a server-side distance check only mis-fires on
    // pose-sync timing (the camera-only intro sends no MOVE, so peer.pose can lag the spawn) and would strand
    // the one paid moment. The per-firm/day cooldown (funding_credits UNIQUE, pitch:vc:<firm>:<day>) still
    // bounds abuse. Free-roam VC-office pitches keep their own proximity (createPitchHint / pitchFromCaption).
    try {
      const profile = await getFundingProfile(db, device, now);
      if (!profile.startupName || !profile.nickname) return admissionJson({ status: 'unnamed' });
      // The Seed pitch at First Round must CLOSE the Seed round: floor the cheque so the resulting total
      // reaches the Seed threshold (the active economy's 'seed' round), so the quest's "just closed Seed",
      // the valuation pill and the stars agree. Pre-seed (no vcId) keeps its score-sized cheque.
      // The Seed floor applies ONLY to the ladder Seed pitch — gate on the RESOLVED target (and not a meme
      // pitch), never the request's vcId, so a meme pitch that also sends vcId:first-round can't steal it.
      // The phase-6 Demo Day pitch at the fictional house must likewise CLOSE Series A: floor to the active
      // economy's 'series-a' threshold. The two floors are mutually exclusive (each gates on its own resolved
      // target.id), so chaining with ?? picks whichever applies; both are undefined for the Pre-seed plaza pitch.
      // Each floor ALSO requires the player to have already reached the PRIOR round (priorRoundThresholdCents),
      // so an out-of-order pitch to the Seed firm / Demo Day house can't skip rungs (Series A requires Seed).
      const seedRound = FUNDING_ROUNDS.find(round => round.id === 'seed');
      const seriesARound = FUNDING_ROUNDS.find(round => round.id === 'series-a');
      // Floor to the round threshold PLUS a grace margin (roundFloorGraceCents), so economy-v3 idle burn doesn't
      // drop the player back below the threshold within ~1 s — without it the Seed floor lands on EXACTLY the
      // threshold and the next burn tick reverts the current-derived round/pill/HUD to Bootstrapping ("Seed
      // closed" doesn't stick). No-op outside economy-v3 (grace = 0). Then clamp to the single-credit cap:
      // in economy-v3 the Series A target ($698k+) exceeds MAX_CREDIT_CENTS ($200k), so an un-clamped floor for a
      // low-Seed player would throw at recordFundingCredit → 503; the clamp lands a bounded boost instead.
      const seedTarget = seedRound && BigInt(seedRound.thresholdCents) + roundFloorGraceCents('seed');
      const seriesATarget = seriesARound && BigInt(seriesARound.thresholdCents) + roundFloorGraceCents('series-a');
      const floor = clampPitchFloor(
        founderSeedFloor(target.id, memeNpcId, seedTarget, profile.totalCents, priorRoundThresholdCents(FUNDING_ROUNDS, 'seed'))
          ?? founderSeriesAFloor(target.id, memeNpcId, seriesATarget, profile.totalCents, priorRoundThresholdCents(FUNDING_ROUNDS, 'series-a')),
        MAX_CREDIT_CENTS);
      const pitch = await runPitch({ kind: target.kind, id: target.id, name: target.name, persona: target.persona }, line, 'sent', now, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        reserve: () => key ? reserveJudgeSpend(db, now) : Promise.resolve(false),
        reconcile: actual => reconcileJudgeSpend(db, now, actual),
        judge: openRouterJudge(key ?? ''),
        award: input => funding.award(device, input, now),
      }, floor, founderFirstPitchMin(target.id, vcId, memeNpcId, await devicePitchedBefore(db, device))); // critic Q1: first pitch >= $2,000
      // Return the updated profile so the client reveals the valuation (now non-zero) + Pre-seed without a refetch.
      return admissionJson({ status: 'sent', pitch, profile: await getFundingProfile(db, device, now) });
    } catch (error) {
      if (error instanceof RangeError && /startup|target/.test(error.message)) return admissionJson({ status: 'unnamed' });
      console.warn('pitch-text failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  /** Phase-5.1 drive quest START: record the escape timer if the player is standing by the protester. */
  private async handleDriveStart(request: Request): Promise<Response> {
    if (!flags.memeQuests || !flags.driveQuest || !this.funding) return admissionJson({ error: 'off' }, 404);
    let body: unknown; try { body = await request.json(); } catch { return admissionJson({ error: 'Invalid body' }, 400); }
    const npcId = typeof (body as { npcId?: unknown } | null)?.npcId === 'string' ? (body as { npcId: string }).npcId : undefined;
    const npc = npcId ? memeNpcById(npcId) : undefined;
    if (!npc || npc.questKind !== 'drive' || !npc.drive || !memeNpcEnabled(npc, flags)) return admissionJson({ error: 'No such drive quest' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // Bind to the EXACT connection (its WELCOME sid) so two tabs of a device run independent quests; keyed by
    // that session id (fall back to device-only without sid). [two-tab fix]
    const sid = typeof (body as { sid?: unknown } | null)?.sid === 'number' ? (body as { sid: number }).sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(npc.target.lat, npc.target.lon);
    if (Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) > DRIVE_START_RADIUS_M) return admissionJson({ error: 'too-far' }, 409);
    // Fail fast on the per-SF-day cooldown: if this NPC was already escaped today, don't send the player on a
    // pointless escape only to be blocked at drive-complete. The complete handler + the ledger UNIQUE remain the
    // authoritative guard against double-pay; this is purely the earlier, kinder signal.
    const { source, sourceRef } = driveQuestCredit(npc.id, Date.now());
    if ((await creditedRefs(this.env.DB, device, source)).has(sourceRef)) return admissionJson({ status: 'blocked', reason: 'cooldown' });
    this.driveQuests.set(peer.session.id, { npcId: npc.id, startMs: Date.now(), device });
    return admissionJson({ status: 'started', escapeM: npc.drive.escapeM, limitMs: npc.drive.limitMs });
  }
  /** Phase-5.1 drive quest COMPLETE: server-verify the escape (escapedCone from the authoritative pose +
   *  vehicle state) and pay the per-SF-day cheque. The client triggers this when its own timer says escaped;
   *  the server re-checks from its own pose, so a client can't claim an escape it did not make. */
  private async handleDriveComplete(request: Request): Promise<Response> {
    if (!flags.memeQuests || !flags.driveQuest || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: number } | undefined;
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // Bind to the EXACT connection (its WELCOME sid), so two tabs / a reconnect don't collide; the run is keyed by
    // that session id (fall back to device-only without sid). [two-tab fix]
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const active = this.driveQuests.get(peer.session.id);
    if (!active) return admissionJson({ error: 'no-active-quest' }, 409);
    const npc = memeNpcById(active.npcId);
    if (!npc || npc.questKind !== 'drive' || !npc.drive) { this.driveQuests.delete(peer.session.id); return admissionJson({ error: 'No such drive quest' }, 404); }
    const now = Date.now(), db = this.env.DB, funding = this.funding;
    const spot = project(npc.target.lat, npc.target.lon);
    const state = driveQuestState(peer.pose, this.vehicles.occupants.has(peer.id), spot, active.startMs, now);
    try {
      const outcome = await runDriveQuest(npc, state, npc.drive, now, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        award: input => funding.award(device, input, now),
      });
      // Consume the attempt once it pays or is a cooldown no-op; an 'incomplete' leaves the timer running.
      if (outcome.status !== 'incomplete') this.driveQuests.delete(peer.session.id);
      return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) });
    } catch (error) {
      console.warn('drive-complete failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  /** Phase-5.1 share quest CLAIM: a once-ever client-trust credit for reposting the thought-leader's take.
   *  No server proof of the post (the once-ever ref is the anti-farm bound); a proximity gate keeps it to a
   *  real walk-up. [gtasf-ldlm] */
  private async handleShareClaim(request: Request): Promise<Response> {
    if (!flags.memeQuests || !flags.shareQuest || !this.funding) return admissionJson({ error: 'off' }, 404);
    let body: unknown; try { body = await request.json(); } catch { return admissionJson({ error: 'Invalid body' }, 400); }
    const npcId = typeof (body as { npcId?: unknown } | null)?.npcId === 'string' ? (body as { npcId: string }).npcId : undefined;
    const npc = npcId ? memeNpcById(npcId) : undefined;
    if (!npc || npc.questKind !== 'share') return admissionJson({ error: 'No such share quest' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device);
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(npc.target.lat, npc.target.lon);
    if (Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) > SHARE_CLAIM_RADIUS_M) return admissionJson({ error: 'too-far' }, 409);
    const now = Date.now(), db = this.env.DB, funding = this.funding;
    try {
      const outcome = await runShareQuest(npc, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        award: input => funding.award(device, input, now),
      });
      return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) });
    } catch (error) {
      console.warn('share-claim failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  /** GTA-pivot mission START (flags.missions): begin a mission when the player is at its start/grab marker
   *  (authoritative-pose proximity, like handleDriveStart). Records the in-progress mission; no payout here. */
  private async handleMissionStart(request: Request): Promise<Response> {
    if (!flags.missions || !this.funding) return admissionJson({ error: 'off' }, 404);
    let body: unknown; try { body = await request.json(); } catch { return admissionJson({ error: 'Invalid body' }, 400); }
    const missionId = typeof (body as { missionId?: unknown } | null)?.missionId === 'string' ? (body as { missionId: string }).missionId : undefined;
    const mission = missionId ? missionById(missionId) : undefined;
    if (!mission || !missionEnabled(mission, flags)) return admissionJson({ error: 'No such mission' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // Bind to the EXACT connection that sent this (its WELCOME sid), so a second tab / reconnect for the same
    // device isn't handed this one's run (two-tab void; matches the robbery fix). Fall back to device-only for a
    // client that doesn't send sid.
    const sid = typeof (body as { sid?: unknown } | null)?.sid === 'number' ? (body as { sid: number }).sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(mission.start.lat, mission.start.lon);
    if (Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) > MISSION_ARRIVE_RADIUS_M) return admissionJson({ error: 'too-far' }, 409);
    // Review E-L2: two acqui-hire starts from one session in the same instant could both pass the replay check across the
    // awaits below and leave an orphan open escrow; a per-session in-flight marker makes the second one retry.
    if (mission.acquihire) {
      if (this.acquihireStarting.has(peer.session.id)) return admissionJson({ status: 'refused', reason: 'retry' }, 409);
      this.acquihireStarting.add(peer.session.id);
      try { return await this.startMissionRun(peer, device, mission); } finally { this.acquihireStarting.delete(peer.session.id); }
    }
    return this.startMissionRun(peer, device, mission);
  }
  private readonly acquihireStarting = new Set<number>();
  private async startMissionRun(peer: Peer, device: string, mission: NonNullable<ReturnType<typeof missionById>>): Promise<Response> {
    const spot = project(mission.start.lat, mission.start.lon);
    // Already paid in this cooldown window: say so now, not after a whole run (and before a heist raises any heat).
    if (missionDoneNow(mission, await creditedRefs(this.env.DB, device, 'celebrity'), Date.now())) return admissionJson({ status: 'blocked', reason: 'cooldown' });
    const existing = this.missions.get(peer.session.id);
    // A retried start of the same acqui-hire by the same session is a replay: never a second debit.
    if (mission.acquihire && existing?.missionId === mission.id && existing.acqId && questStartedBy(existing, peer)) return admissionJson({ status: 'started', mission: mission.id, replay: true });
    if (existing) this.dropMissionRun(peer.session.id); // a new start supersedes the old run (refunding an open acqui-hire)
    let acquisition: { acqId: string; costCents: string; deadlineAt: number } | undefined;
    if (mission.acquihire) {
      // The price is debited into a D1 escrow (atomic, idempotent, never negative); refunded unless delivered.
      const bought = await startAcquisition(this.env.DB, device, Date.now());
      if (!bought.ok) return bought.reason === 'cooldown' ? admissionJson({ status: 'blocked', reason: 'cooldown' }) : admissionJson({ status: 'refused', reason: bought.reason }, 409);
      acquisition = bought;
    }
    const reached = advanceCheckpoints(mission, 0, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0); // a heist's grab is at its start
    this.missions.set(peer.session.id, { missionId: mission.id, startMs: Date.now(), sid: peer.session.id, gen: peer.session.generation, device, reached, acqId: acquisition?.acqId });
    // Grabbing the deck is a crime: a heist start raises wanted heat (lane B's hook — instant 3 stars), so the
    // escape objective becomes a real "lose the SFPD" chase. No-op when flags.wanted is off (the client escape
    // stub stays the fallback) or the peer is offline, so it's safe behind flags.missions.
    // heistHeatOnLeave (critic N47): a cruiser could already be parked at the grab, so the heat no longer lands at the office;
    // it is raised on the first accepted pose 50 m from the grab (notePoseProgress). Off: the old instant raise.
    if (mission.kind === 'heist') {
      if (flags.heistHeatOnLeave) this.missions.get(peer.session.id)!.heatPendingAt = { x: spot.x, z: spot.z };
      else this.raiseWantedForDevice(device, 'heist', Date.now());
    }
    // Co-op heist (flags.coopHeist): players near the rival's office get a getaway-driver invite for a minute.
    if (flags.coopHeist && mission.kind === 'heist') for (const other of this.peers.values()) {
      if (other.fundingDeviceId === device || this.missions.has(other.session.id)) continue;
      if (Math.hypot(other.pose.x / 100 - spot.x, other.pose.z / 100 - spot.z) <= COOP_INVITE_RADIUS_M)
        this.sendQuest(other, { kind: 'heist-invite', hostSid: peer.session.id, host: peer.session.name, joinInMs: COOP_JOIN_WINDOW_MS });
    }
    return admissionJson({ status: 'started', mission: mission.id, ...(acquisition ? { costCents: acquisition.costCents, deadlineAt: acquisition.deadlineAt } : {}) });
  }
  /** Jobs-phone status (flags.missions): the enabled missions this device already did in their cooldown window. */
  private async handleMissionList(request: Request): Promise<Response> {
    if (!flags.missions || !this.funding) return admissionJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'device' }, 401);
    return admissionJson({ done: missionsDoneNow(await creditedRefs(this.env.DB, device, 'celebrity'), Date.now(), flags) });
  }
  /** GTA-pivot mission COMPLETE (flags.missions): server-validate the DELIVERY (authoritative-pose proximity to
   *  the mission's final waypoint) and pay the valuation credit via runMission. The grab/escape between are
   *  client-tracked (v1); the payout is gated on being at the delivery point + the per-day cooldown ref, so it
   *  can't be claimed from elsewhere or farmed. (A server-tracked grab can harden this once lane B's wanted lands.) */
  private async handleMissionComplete(request: Request): Promise<Response> {
    if (!flags.missions || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: number } | undefined;
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // Resolve the EXACT connection (its WELCOME sid), so two tabs / a reconnect of the same device don't collide;
    // the run is keyed by that session id (fall back to device-only without sid). [two-tab fix, matches robbery]
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const active = this.missions.get(peer.session.id);
    if (!active) return admissionJson({ error: 'no-active-mission' }, 409);
    const mission = missionById(active.missionId);
    if (!mission) { this.dropMissionRun(peer.session.id); return admissionJson({ error: 'No such mission' }, 404); }
    // review fix 2b (resume bypass): the mission must be completed by the SAME session that started it. A ?at=
    // reload resumes under the same session id with a bumped generation, so questStartedBy's gen check still
    // rejects a resumed peer that get()s this entry by session id (teleport-to-delivery payout). Reject + drop.
    if (!questStartedBy(active, peer)) { this.dropMissionRun(peer.session.id); return admissionJson({ status: 'stale-session' }, 409); }
    const now = Date.now(), db = this.env.DB, funding = this.funding;
    const deliver = [...mission.objectives].reverse().find(objective => objective.at);
    const spot = deliver?.at ? project(deliver.at.lat, deliver.at.lon) : null;
    const radius = deliver?.radiusM ?? MISSION_ARRIVE_RADIUS_M;
    // taxiFareJob: a `drive` delivery (the fare's drop-off) only counts from the driver's seat.
    const atDelivery = spot != null && Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) <= radius && (!deliver?.drive || (peer.pose.flags & DRIVER_FLAG) !== 0);
    // review fix 1 (anti-teleport): the payout now also needs a plausible grab→deliver TIME (server clock) and, for
    // a heist with the wanted system on, the heat lost (0 stars) — so a ?at=/robotaxi jump into the delivery radius
    // can't cash out. The server-recorded startMs + current heat make both authoritative; see missionCompleted.
    const elapsedMs = now - active.startMs;
    const wantedStars = wantedRaiseAllowed(flags) ? wantedLevel(this.wantedStates.get(peer.id)?.state.heat ?? 0) : null;
    if (active.crewOf !== undefined) return this.completeCrewRun(peer, active, mission, { atDelivery, elapsedMs, wantedStars }, now);
    if (mission.acquihire) {
      // Acqui-hire: the same server checks as any mission (delivery pose, in-order checkpoints, path travel floor,
      // same session); only then is the escrowed price paid back 1.5× (deliverAcquisition refunds past the deadline
      // or if the credit can't be booked). An incomplete attempt keeps the escrow open for a retry.
      active.reached = advanceCheckpoints(mission, active.reached, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0);
      if (!active.acqId) { this.dropMissionRun(peer.session.id); return admissionJson({ error: 'no-active-mission' }, 409); }
      if (!missionCompleted(mission, { atDelivery, elapsedMs, wantedStars, checkpointsReached: active.reached })) return admissionJson({ status: 'incomplete', outcome: { status: 'incomplete' } });
      // Remove the run BEFORE any await (review fix): a disconnect / ?at= / abandon landing mid-delivery then finds no
      // run to drop. The escrow itself is claimed atomically inside deliverAcquisition, so refunds can't race the flip.
      const acqId = active.acqId;
      this.missions.delete(peer.session.id);
      try {
        const outcome = await deliverAcquisition(db, device, acqId, { award: input => funding.award(device, input, now) }, now);
        return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) });
      } catch (error) {
        console.warn('acquihire deliver failed', error instanceof Error ? error.name : 'unknown');
        return admissionJson({ error: 'unavailable' }, 503); // an unclaimed escrow stays open (deadline sweep refunds it); a claimed one is settled by the crash sweep
      }
    }
    try {
      active.reached = advanceCheckpoints(mission, active.reached, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0); // count a pickup this very pose sits on
      const outcome = await runMission(mission, { atDelivery, elapsedMs, wantedStars, checkpointsReached: active.reached }, now, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        award: input => funding.award(device, input, now),
      });
      if (outcome.status !== 'incomplete') this.missions.delete(peer.session.id);
      // Co-op heist: the leader's delivery releases the crew's payout (now if they're at the drop, else within the grace).
      if (outcome.status === 'completed' && active.crewSid !== undefined) await this.releaseCrew(active.crewSid, peer.session.id, now);
      return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) });
    } catch (error) {
      // An unnamed player can't be paid (recordFundingCredit refuses without a startup name). Surface a clear
      // 'unnamed' (like handlePitchTap) instead of a confusing 503 the client would silently retry; consume the
      // mission so they found, then re-run it. Any other failure stays a 503.
      if (error instanceof RangeError && /startup|nickname/.test(error.message)) { this.dropMissionRun(peer.session.id); return admissionJson({ status: 'unnamed' }); }
      console.warn('mission-complete failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  private sendQuest(peer: Peer, event: QuestEvent): void { peer.send(encodeS2C({ type: 'QUEST', json: JSON.stringify(event) })); }
  /** Co-op heist JOIN (flags.coopHeist): become the getaway driver of a heist started < 1 min ago, standing at the rival's
   *  office. Opens a crew run (same server checks as a solo heist, timed from the join) and raises the crew's heat too. */
  private async handleHeistJoin(request: Request): Promise<Response> {
    if (!flags.coopHeist || !flags.missions || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { hostSid?: unknown; sid?: unknown } | undefined;
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const hostSid = typeof body?.hostSid === 'number' ? body.hostSid : -1;
    const leaderRun = this.missions.get(hostSid);
    const mission = leaderRun ? missionById(leaderRun.missionId) : undefined;
    const leaderPeer = this.peers.get(hostSid);
    const valid = leaderRun && mission && mission.kind === 'heist' && missionEnabled(mission, flags) && questStartedBy(leaderRun, leaderPeer);
    const spot = mission ? project(mission.start.lat, mission.start.lon) : { x: 0, z: 0 };
    const now = Date.now();
    const refusal = coopJoinRefusal(valid ? { ...leaderRun, heist: true } : undefined, {
      device, busy: this.missions.has(peer.session.id), distanceM: Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z),
      doneToday: !!mission && missionDoneNow(mission, await creditedRefs(this.env.DB, device, 'celebrity'), now),
    }, now);
    if (refusal || !leaderRun || !mission || !leaderPeer) return admissionJson({ status: 'refused', reason: refusal ?? 'no-heist' }, 409);
    if (this.missions.has(peer.session.id) || leaderRun.crewSid !== undefined) return admissionJson({ status: 'refused', reason: 'full' }, 409); // raced during the await
    leaderRun.crewSid = peer.session.id;
    this.missions.set(peer.session.id, { missionId: mission.id, startMs: now, sid: peer.session.id, gen: peer.session.generation, device,
      reached: advanceCheckpoints(mission, 0, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0), crewOf: hostSid });
    this.raiseWantedForDevice(device, 'heist', now); // the getaway driver is in on it: same heat to lose
    this.sendQuest(leaderPeer, { kind: 'heist-crew', partner: peer.session.name, role: 'leader' });
    this.sendQuest(peer, { kind: 'heist-crew', partner: leaderPeer.session.name, role: 'crew' });
    return admissionJson({ status: 'joined', mission: mission.id, host: leaderPeer.session.name });
  }
  /** A crew member's own mission-complete: the solo checks (grab passed, travel floor from the join, heat lost, at the
   *  drop) AND the leader's delivery (founder/coopHeist.ts crewPayable). Paid the normal heist credit under their own ref. */
  private async completeCrewRun(peer: Peer, active: NonNullable<ReturnType<WorldDO['missions']['get']>>, mission: NonNullable<ReturnType<typeof missionById>>,
    seen: { atDelivery: boolean; elapsedMs: number; wantedStars: number | null }, now: number): Promise<Response> {
    active.reached = advanceCheckpoints(mission, active.reached, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0);
    const completion = { ...seen, checkpointsReached: active.reached };
    if (!missionCompleted(mission, completion)) return admissionJson({ status: 'incomplete', outcome: { status: 'incomplete' } });
    const payable = crewPayable(active, now);
    if (payable === 'waiting-for-leader') return admissionJson({ status: 'waiting-for-leader', outcome: { status: 'incomplete' } });
    this.missions.delete(peer.session.id); // before any await: a racing drop finds nothing
    if (payable === 'too-late') return admissionJson({ status: 'too-late', outcome: { status: 'incomplete' } });
    return admissionJson(await this.payCrew(peer, mission, completion, now));
  }
  private async payCrew(peer: Peer, mission: NonNullable<ReturnType<typeof missionById>>, completion: Parameters<typeof runMission>[1], now: number) {
    const db = this.env.DB, funding = this.funding!, device = peer.fundingDeviceId!;
    try {
      const outcome = await runMission(mission, completion, now, {
        credited: async (source, ref) => (await creditedRefs(db, device, source)).has(ref),
        award: input => funding.award(device, input, now),
      });
      return { status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) };
    } catch (error) {
      if (error instanceof RangeError && /startup|nickname/.test(error.message)) return { status: 'unnamed' };
      console.warn('crew payout failed', error instanceof Error ? error.name : 'unknown');
      return { status: 'unavailable' };
    }
  }
  /** The leader delivered: stamp the crew run, and pay the crew at once if they're already at the drop and pass the checks. */
  private async releaseCrew(crewSid: number, leaderSid: number, now: number): Promise<void> {
    const crew = this.missions.get(crewSid), crewPeer = this.peers.get(crewSid), leaderPeer = this.peers.get(leaderSid);
    if (!crew || crew.crewOf !== leaderSid) return;
    crew.leaderDeliveredAt = now;
    const mission = missionById(crew.missionId);
    if (!mission || !crewPeer || !questStartedBy(crew, crewPeer)) return;
    const deliver = [...mission.objectives].reverse().find(objective => objective.at);
    const spot = deliver?.at ? project(deliver.at.lat, deliver.at.lon) : null;
    crew.reached = advanceCheckpoints(mission, crew.reached, crewPeer.pose.x / 100, crewPeer.pose.z / 100, (crewPeer.pose.flags & DRIVER_FLAG) !== 0);
    const completion = {
      atDelivery: spot != null && Math.hypot(crewPeer.pose.x / 100 - spot.x, crewPeer.pose.z / 100 - spot.z) <= (deliver?.radiusM ?? MISSION_ARRIVE_RADIUS_M),
      elapsedMs: now - crew.startMs, checkpointsReached: crew.reached,
      wantedStars: wantedRaiseAllowed(flags) ? wantedLevel(this.wantedStates.get(crewPeer.id)?.state.heat ?? 0) : null,
    };
    if (!missionCompleted(mission, completion)) return; // not there yet: their own mission-complete pays within the grace
    this.missions.delete(crewSid);
    const result = await this.payCrew(crewPeer, mission, completion, now);
    const outcome = 'outcome' in result ? result.outcome : undefined;
    if (outcome?.status === 'completed') this.sendQuest(crewPeer, { kind: 'heist-paid', amountCents: outcome.amountCents, partner: leaderPeer?.session.name ?? 'your crew' });
  }
  /** Street race host / join (flags.streetRaces): proximity to the route start from the authoritative pose. */
  private async handleRace(request: Request, action: 'host' | 'join'): Promise<Response> {
    if (!flags.streetRaces || !flags.timeTrials || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { routeId?: unknown; raceId?: unknown; sid?: unknown } | undefined;
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const now = Date.now();
    const result = action === 'host'
      ? this.streetRaces.host(peer, typeof body?.routeId === 'string' ? body.routeId : '', now)
      : this.streetRaces.join(peer, typeof body?.raceId === 'string' ? body.raceId : '', now);
    return admissionJson(result, result.status === 'hosting' || result.status === 'joined' ? 200 : 409);
  }
  /** A race finisher's SERVER-measured time joins the route's daily board when it beats their best (no ghost). */
  private async recordRaceTime(device: string, routeId: string, ms: number): Promise<void> {
    const db = this.env.DB, now = Date.now(), day = timeTrialDay(now);
    const best = await ttReadBest(db, routeId, day, device);
    if (best !== null && best <= ms) return;
    await ttWriteBest(db, routeId, day, device, await ttDisplayName(db, device), ms, now, null);
  }
  /** End a mission run that was NOT delivered. An acqui-hire's OPEN escrow is refunded (atomic + idempotent in D1; a
   *  claimed one is settled by the delivery itself), so a teleport / disconnect / abandon / supersede never keeps the money. */
  private dropMissionRun(sessionId: number): void {
    const run = this.missions.get(sessionId);
    this.missions.delete(sessionId);
    if (run) this.unlinkCoop(sessionId, run);
    if (run?.acqId) this.ctx.waitUntil(refundAcquisition(this.env.DB, run.device, run.acqId).catch(error => console.warn('acquihire refund failed', error instanceof Error ? error.name : 'unknown')));
  }
  /** Co-op heist: a leader's run ending undelivered ends the crew's too (nothing to deliver; the crew is told); a crew
   *  run ending frees the leader's seat. Called wherever a run is removed without delivery. */
  private unlinkCoop(sessionId: number, run: { crewSid?: number; crewOf?: number }): void {
    if (run.crewSid !== undefined) {
      const crew = this.missions.get(run.crewSid);
      if (crew?.crewOf === sessionId && crew.leaderDeliveredAt === undefined) {
        this.missions.delete(run.crewSid);
        const crewPeer = this.peers.get(run.crewSid); if (crewPeer) this.sendQuest(crewPeer, { kind: 'heist-cancelled', reason: 'leader-left' });
      }
    }
    if (run.crewOf !== undefined) { const leader = this.missions.get(run.crewOf); if (leader?.crewSid === sessionId) leader.crewSid = undefined; }
  }
  /** Abandon the caller's in-progress mission (the jobs phone's Abandon button / the client deadline). Refunds an
   *  acqui-hire's escrow and waits for it, so the response can report the refund. */
  private async handleMissionAbandon(request: Request): Promise<Response> {
    if (!flags.missions || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { sid?: number } | undefined;
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const run = this.missions.get(peer.session.id);
    if (!run) {
      // Review E-M1: after a DO eviction the run is gone but the escrow is still open — refund it now (claim-first keeps
      // it exactly-once), unless another tab of this device still has a live acqui-hire run.
      if (flags.economyV3 && ![...this.missions.values()].some(other => other.device === device && other.acqId)) {
        const open = await openAcquisition(this.env.DB, device);
        if (open && await refundAcquisition(this.env.DB, device, open.acq_id)) return admissionJson({ status: 'abandoned', mission: 'acquihire', refunded: true, profile: await getFundingProfile(this.env.DB, device, Date.now()) });
      }
      return admissionJson({ status: 'none' });
    }
    this.missions.delete(peer.session.id);
    this.unlinkCoop(peer.session.id, run);
    const refunded = run.acqId ? await refundAcquisition(this.env.DB, device, run.acqId) : false;
    return admissionJson({ status: 'abandoned', mission: run.missionId, refunded, profile: refunded ? await getFundingProfile(this.env.DB, device, Date.now()) : undefined });
  }
  /** review fix 1 (anti-teleport): forget any in-progress mission/drive/robbery for a device. Called on disconnect
   *  (a reload with ?at=<deliver> is a new connection) AND on a quick-robotaxi teleport (the arrived hook), so a
   *  server-authorized jump can never leave an active quest to cash out at the destination. Idempotent + cheap. */
  /** reconnectGrace: end held rides/runs whose grace ran out (or just `only`, e.g. a ?at= resume). The teardown remove()
   *  deferred: ride, seat, personal car, then that session's runs (device-wide only if no other tab of it is live). */
  private settleDropGrace(now: number, only?: number): void {
    for (const [id, held] of this.dropGrace) {
      if (only === undefined ? held.until > now : id !== only) continue;
      this.dropGrace.delete(id);
      if (this.peers.has(id)) continue; // resumed meanwhile
      this.movingRides.disconnect(id, now); this.taxis.disconnect(id, now); this.vehicles.disconnect(id, now); this.vehicles.releasePersonal(id);
      if (!held.device) continue;
      if (![...this.peers.values()].some(p => p.fundingDeviceId === held.device)) { this.clearDeviceQuests(held.device); continue; }
      this.dropMissionRun(id); this.driveQuests.delete(id); this.robberies.delete(id); this.timeTrialRuns.delete(id); this.pilgrimApproach.delete(id);
    }
  }
  /** gtasf-yufot: every SESSION_SAVE_MS, save the in-progress runs (co-op crew runs and robbery holds are not carried). */
  private saveRuns(now: number): void {
    if (!flags.reconnectGrace || now - this.runPersistAt < SESSION_SAVE_MS) return;
    this.runPersistAt = now;
    const runs: { kind: 'mission' | 'drive' | 'trial'; sid: number; value: object }[] = [];
    for (const [sid, run] of this.missions) if (run.crewOf === undefined && run.crewSid === undefined) runs.push({ kind: 'mission', sid, value: run });
    for (const [sid, run] of this.driveQuests) runs.push({ kind: 'drive', sid, value: run });
    for (const [sid, run] of this.timeTrialRuns) runs.push({ kind: 'trial', sid, value: run });
    this.runPersist.save(runs, now);
  }
  /** gtasf-yufot: a fresh instance puts the previous one's runs back and holds each session in dropGrace, so the
   *  existing grace rules decide: a plain resume keeps them (rebound, gtasf-q9i4l); a ?at= resume or no resume within
   *  RECONNECT_GRACE_MS drops them (dropMissionRun refunds an open acqui-hire exactly-once). */
  private restoreRuns(runs: StoredRun[], now: number): void {
    for (const { kind, sid, value } of runs) {
      const device = typeof value.device === 'string' ? value.device : undefined;
      if (!device) continue;
      if (kind === 'mission') this.missions.set(sid, value as never);
      else if (kind === 'drive') this.driveQuests.set(sid, value as never);
      else if (kind === 'trial') this.timeTrialRuns.set(sid, value as never);
      else continue;
      if (!this.dropGrace.has(sid)) this.dropGrace.set(sid, { device, until: now + RECONNECT_GRACE_MS });
    }
    if (runs.length) console.log('world runs restored after reset', runs.length);
  }
  /** reconnectGrace: a PLAIN resume (no ?at= spawn override: the pose continues, nothing teleported) bumps the session
   *  generation like any resume, so questStartedBy rejected the very runs the grace held ('stale-session' at the
   *  delivery). Rebind this session's held mission + time-trial runs to the new generation. A ?at= resume never gets
   *  here (settleDropGrace clears its runs), so the anti-teleport rule stands. */
  private rebindHeldRuns(session: WorldSession): void {
    for (const run of this.missions.values()) if (run.sid === session.id) run.gen = session.generation;
    for (const run of this.timeTrialRuns.values()) if (run.sid === session.id) run.gen = session.generation;
  }
  private clearDeviceQuests(deviceId: string): void {
    if (flags.streetRaces) this.streetRaces.dropDevice(deviceId); // a teleport / reload / disconnect is a DNF
    // All four run-maps are now keyed by SESSION id (two-tab fix), so drop EVERY entry belonging to this device
    // (its value carries `device`) — a server-authorized teleport/reload must clear all of a device's in-progress
    // runs across any tab so none can cash out at the destination.
    for (const [sid, m] of this.missions) if (m.device === deviceId) this.dropMissionRun(sid); // refunds an open acqui-hire
    for (const [sid, d] of this.driveQuests) if (d.device === deviceId) this.driveQuests.delete(sid);
    for (const [sid, rob] of this.robberies) if (rob.device === deviceId) this.robberies.delete(sid);
    for (const [sid, t] of this.timeTrialRuns) if (t.device === deviceId) this.timeTrialRuns.delete(sid); // a teleport/reload mid-run can't resume into a pose-checked finish
    for (const [sid, a] of this.pilgrimApproach) if (a.device === deviceId) this.pilgrimApproach.delete(sid); // landmarks must be re-approached after a teleport
  }
  /** Every server-accepted pose (on foot or seated): server-side quest progress that must not trust the client. */
  private notePoseProgress(peer: Peer): void {
    this.notePilgrimTravel(peer);
    if (flags.streetRaces) this.streetRaces.onPose(peer, Date.now());
    const run = this.missions.get(peer.session.id);
    if (run) { const mission = missionById(run.missionId); if (mission) run.reached = advanceCheckpoints(mission, run.reached, peer.pose.x / 100, peer.pose.z / 100, (peer.pose.flags & DRIVER_FLAG) !== 0); }
    if (run?.heatPendingAt && Math.hypot(peer.pose.x / 100 - run.heatPendingAt.x, peer.pose.z / 100 - run.heatPendingAt.z) > HEIST_HEAT_LEAVE_M) {
      run.heatPendingAt = undefined; this.raiseWantedForDevice(run.device, 'heist', Date.now()); // left the block with the deck
    }
  }
  /** Pilgrimage: on each server-accepted pose, mark the landmarks this session is now far enough from (see pilgrimApproach). */
  private notePilgrimTravel(peer: Peer): void {
    if (!flags.pilgrimage || !peer.fundingDeviceId) return;
    let entry = this.pilgrimApproach.get(peer.session.id);
    if (!entry) this.pilgrimApproach.set(peer.session.id, entry = { far: new Set(), device: peer.fundingDeviceId });
    markApproached(peer.pose.x / 100, peer.pose.z / 100, entry.far);
  }
  /** SF pilgrimage list (flags.pilgrimage): the device's collected site ids (from its once-ever credit refs). */
  private async handlePilgrimageList(request: Request): Promise<Response> {
    if (!flags.pilgrimage || !this.funding) return admissionJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'device' }, 401);
    return admissionJson({ collected: pilgrimageCollected(await creditedRefs(this.env.DB, device, 'celebrity')), total: PILGRIMAGE_SITES.length });
  }
  /** SF pilgrimage claim (flags.pilgrimage): pay a landmark once ever when the AUTHORITATIVE pose is at it and the
   *  session travelled there (was PILGRIMAGE_MIN_TRAVEL_M+ away since its last teleport). Money path: founder/pilgrimage.ts. */
  private async handlePilgrimageClaim(request: Request): Promise<Response> {
    if (!flags.pilgrimage || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { siteId?: unknown; sid?: unknown } | undefined;
    const site = typeof body?.siteId === 'string' ? pilgrimageSiteById(body.siteId) : undefined;
    if (!site) return admissionJson({ error: 'No such site' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(site.lat, site.lon), x = peer.pose.x / 100, z = peer.pose.z / 100;
    const observation = { siteM: Math.hypot(x - spot.x, z - spot.z), approached: this.pilgrimApproach.get(peer.session.id)?.far.has(site.id) ?? false };
    const now = Date.now(), db = this.env.DB, funding = this.funding;
    try {
      const outcome = await runPilgrimageClaim(site, observation, {
        creditedRefs: () => creditedRefs(db, device, 'celebrity'),
        award: input => funding.award(device, input, now),
      });
      if (outcome.status === 'too-far' || outcome.status === 'no-travel') return admissionJson({ status: outcome.status }, 409);
      return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, device, now) });
    } catch (error) {
      // Unnamed players can't be paid (recordFundingCredit refuses); nothing is consumed, so the claim retries later.
      if (error instanceof RangeError && /startup|nickname/.test(error.message)) return admissionJson({ status: 'unnamed' });
      console.warn('pilgrimage-claim failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  /** Time trial START (flags.timeTrials, review fix 2): arm the run only when the AUTHORITATIVE pose is at the
   *  route start, recording the server start time. The clock is now the server's — a client can't backdate it. */
  private async handleTimeTrialStart(request: Request): Promise<Response> {
    if (!flags.timeTrials || !this.funding) return admissionJson({ error: 'off' }, 404);
    const body = await smallJson(request).catch(() => undefined) as { routeId?: string; sid?: number } | undefined;
    const spec = body?.routeId ? timeTrialById(body.routeId) : undefined;
    if (!spec) return admissionJson({ error: 'No such route' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // Bind to the EXACT connection (its WELCOME sid) so two tabs of a device run independent trials; keyed by
    // that session id (fall back to device-only without sid). [two-tab fix]
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(spec.start.lat, spec.start.lon);
    if (Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) > TIME_TRIAL_START_RADIUS_M) return admissionJson({ error: 'too-far' }, 409);
    this.timeTrialRuns.set(peer.session.id, { routeId: spec.id, startMs: Date.now(), sid: peer.session.id, gen: peer.session.generation, device });
    return admissionJson({ status: 'started', route: spec.id });
  }
  /** Time trial SUBMIT (flags.timeTrials, review fix 2): the authoritative anti-spoof the worker edge couldn't do —
   *  a server-recorded start, the real pose AT the finish, and the SERVER-measured elapsed over the floor (and not
   *  faster than observed). The ghost is validated + size-bounded (review fix 3). A SKILL board — records a best
   *  TIME, no valuation credit. */
  private async handleTimeTrialSubmit(request: Request): Promise<Response> {
    if (!flags.timeTrials || !this.funding) return admissionJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    // review fix 3: bound+parse with the house size-guard (Content-Length then the actual stream, before JSON.parse)
    // so an oversized ghost is rejected without the parse cost. Parsed first so we can read the sender's sid, then
    // bind to the EXACT connection (two-tab fix) and look up ITS run by session id.
    const body = await smallJson(request, TIME_TRIAL_SUBMIT_BODY_MAX).catch(() => undefined);
    const sid = typeof (body as { sid?: unknown } | undefined)?.sid === 'number' ? (body as { sid: number }).sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const active = this.timeTrialRuns.get(peer.session.id);
    if (!active) return admissionJson({ status: 'rejected', reason: 'no-active-run' }, 409);
    const spec = timeTrialById(active.routeId);
    this.timeTrialRuns.delete(peer.session.id); // one submit per start (any terminal outcome consumes the run; a retry re-runs the route)
    if (!spec) return admissionJson({ status: 'rejected', reason: 'route' }, 404);
    if (!body || body.routeId !== spec.id) return admissionJson({ status: 'rejected', reason: 'bad-body' }, 400);
    // review fix 2b (resume bypass): the run must be submitted by the SAME session that started it — a ?at= reload
    // bumps the session generation, so questStartedBy's gen check rejects a resumed peer that get()s this entry by
    // session id (can't submit a fake board time for a run it didn't start).
    if (!questStartedBy(active, peer)) return admissionJson({ status: 'rejected', reason: 'stale-session' }, 409);
    const now = Date.now(), db = this.env.DB;
    const serverElapsedMs = now - active.startMs;
    const clientTotalMs = typeof body.totalMs === 'number' ? body.totalMs : Number.NaN;
    const splits = Array.isArray(body.splits) && body.splits.every(value => typeof value === 'number') ? body.splits as number[] : null;
    if (!splits) return admissionJson({ status: 'rejected', reason: 'splits' }, 422);
    const timing = serverRunTimingOk(spec, serverElapsedMs, clientTotalMs); // real elapsed over the floor, not faster than observed
    if (!timing.ok) return admissionJson({ status: 'rejected', reason: timing.reason }, 422);
    const finish = project(spec.finish.at.lat, spec.finish.at.lon);
    const atFinish = atTimeTrialFinish(spec, finish, peer.pose.x / 100, peer.pose.z / 100); // radius + pose-lag allowance (gtasf-024it)
    const clean = sanitizeTimeTrialGhost(body.ghost, spec.id); // validated + bounded, or null (the time still records)
    const ghost = clean ? JSON.stringify(clean) : null;
    const day = timeTrialDay(now), name = await ttDisplayName(db, device);
    try {
      const outcome = await runTimeTrialSubmit(spec, { totalMs: clientTotalMs, splits }, atFinish, {
        readBest: () => ttReadBest(db, spec.id, day, device),
        writeBest: ms => ttWriteBest(db, spec.id, day, device, name, ms, now, ghost),
        rankOf: ms => ttRankOf(db, spec.id, day, ms),
      });
      return admissionJson(outcome, outcome.status === 'rejected' ? 422 : 200);
    } catch (error) {
      console.warn('tt-submit failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  /** LANE B store robbery: validate the player is inside the store from the AUTHORITATIVE pose (anti-cheat), pay
   *  the daily-capped valuation credit (runStoreRobbery, dedup by funding_credits ref), and raise a 2-star wanted.
   *  Mirrors handleMissionComplete. Off ⇒ 404 (byte-inert). */
  /** Resolve (device, store, peer, inStore) for a robbery request, or an error Response. Shared by start+complete. */
  private async robberyContext(request: Request): Promise<{ device: string; store: StoreSpec; peer: Peer; inStore: boolean } | Response> {
    // review fix 1: never pay a robbery without the 2-star police response (wanted) — no payout-without-consequence.
    if (!robberyPayoutAllowed(flags) || !this.funding) return admissionJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const body = await smallJson(request).catch(() => undefined) as { storeId?: string; sid?: number } | undefined;
    const store = body?.storeId ? storeById(body.storeId) : undefined;
    if (!store) return admissionJson({ error: 'no-such-store' }, 404);
    // Bind to the EXACT connection that sent this (its WELCOME sid), so a second tab / reconnect for the same
    // device can't be handed this one's hold (reviewer: find()-by-device two-tab void). Fall back to device-only
    // for an older client that doesn't send sid. [combat two-tab fix]
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer) return admissionJson({ error: 'not-connected' }, 409);
    const spot = project(store.lat, store.lon);
    // gtasf-d4zmv: no robbing from a seat (a kerbside store + a boarded robotaxi was the escape).
    const inStore = !this.vehicles.occupants.has(peer.id) && Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) <= ROBBERY_RADIUS_M;
    return { device, store, peer, inStore };
  }
  /** review fix 2: robbery START — require the player to actually be in the store, then record the hold's start. */
  /** Body armour at the gun shop (vitalsPickups): server-priced + idempotent per request (buyArmour). Only for the exact
   *  connected, opted-in, alive player; refused BEFORE any charge when their armour is already full. Grants a full
   *  vest server-side and syncs vitals. */
  private async handleBuyArmour(request: Request): Promise<Response> {
    if (!(flags.combat && flags.vitalsPickups && flags.gunShop) || !this.funding) return admissionJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, this.env.DB);
    if (!device) return admissionJson({ error: 'not-connected' }, 409);
    const body = await smallJson(request).catch(() => undefined) as { requestId?: string; sid?: number; allowDownRound?: boolean } | undefined;
    const sid = typeof body?.sid === 'number' ? body.sid : undefined;
    const peer = [...this.peers.values()].find(candidate => candidate.fundingDeviceId === device && (sid === undefined || candidate.session.id === sid));
    if (!peer || !peer.combatActive) return admissionJson({ error: 'not-connected' }, 409);
    if (this.combat.healthOf(peer.id) <= 0) return admissionJson({ error: 'dead' }, 409);
    if (!atArmourCounter(peer.pose.x / 100, peer.pose.z / 100, project)) return admissionJson({ error: 'not-at-shop' }, 409); // review: sold at the stores only
    if (this.combat.armourOf(peer.id) >= MAX_ARMOUR) return admissionJson({ status: 'full' }); // nothing to buy: no charge
    const now = Date.now();
    const result = await buyArmour(this.env.DB, device, String(body?.requestId ?? ''), now, { allowDownRound: body?.allowDownRound === true });
    if (!result.ok && result.reason === 'down-round') return admissionJson({ error: 'down-round', round: result.round, priceCents: result.priceCents }, 409);
    if (!result.ok) return admissionJson({ error: result.reason }, result.reason === 'unaffordable' ? 402 : result.reason === 'bad-request' ? 400 : 409);
    if (!result.duplicate) {
      this.combat.setVitals(peer.id, this.combat.healthOf(peer.id), MAX_ARMOUR);
      this.sendVitals(peer.id);
      await this.funding.refreshAfterRide(device, now).catch(() => undefined); // drop the 5 s profile cache (debit visible)
    }
    return admissionJson({ status: 'bought', duplicate: result.duplicate, chargedCents: result.chargedCents, currentCents: result.currentCents });
  }
  private async handleRobStart(request: Request): Promise<Response> {
    const ctx = await this.robberyContext(request);
    if (ctx instanceof Response) return ctx;
    if (!ctx.inStore) return admissionJson({ status: 'too-far' }, 409);
    // Fail fast on the per-store/day cooldown so we don't start a pointless hold (the ledger UNIQUE is authoritative).
    const { source, sourceRef } = robberyCredit(ctx.store, Date.now());
    if ((await creditedRefs(this.env.DB, ctx.device, source)).has(sourceRef)) return admissionJson({ status: 'blocked', reason: 'cooldown' });
    this.robberies.set(ctx.peer.session.id, { storeId: ctx.store.id, startMs: Date.now(), device: ctx.device });
    return admissionJson({ status: 'started', holdMs: ROBBERY_HOLD_MS });
  }
  /** review fix 2: robbery COMPLETE — only pays after a server-enforced >=ROBBERY_HOLD_MS hold AND a fresh pose
   *  re-check (the client's hold timer is cosmetic; the server owns the timing + proximity, like drive-complete). */
  private async handleRobComplete(request: Request): Promise<Response> {
    const ctx = await this.robberyContext(request);
    if (ctx instanceof Response) return ctx;
    const active = this.robberies.get(ctx.peer.session.id); // this connection's own hold (sid-keyed)
    if (!active || active.storeId !== ctx.store.id) return admissionJson({ status: 'no-active-robbery' }, 409);
    const now = Date.now();
    const gate = robberyCompleteStatus(active.startMs, now, ctx.inStore);
    if (gate === 'too-soon') return admissionJson({ status: 'too-soon' }, 409); // client raced the hold; keep the attempt
    if (gate === 'too-far') { this.robberies.delete(ctx.peer.session.id); return admissionJson({ status: 'too-far' }, 409); } // wandered out
    this.robberies.delete(ctx.peer.session.id); // ready → consume the attempt and pay (if not on cooldown)
    const db = this.env.DB, funding = this.funding!;
    try {
      const outcome = await runStoreRobbery(ctx.store, true, now, {
        credited: async (source, ref) => (await creditedRefs(db, ctx.device, source)).has(ref),
        award: input => funding.award(ctx.device, input, now),
        currentCents: () => currentValuationCents(db, ctx.device, now), // riskReward: max($750, 1% of valuation)
      });
      if (outcome.status === 'robbed') this.raiseWanted(ctx.peer.id, 'store-robbery', now);
      return admissionJson({ status: outcome.status, outcome, profile: await getFundingProfile(db, ctx.device, now) });
    } catch (error) {
      console.warn('rob-complete failed', error instanceof Error ? error.name : 'unknown');
      return admissionJson({ error: 'unavailable' }, 503);
    }
  }
  private chatPeer(peer: Peer): ChatPeer {
    return { id: peer.id, generation: peer.session.generation, name: peer.session.name, pose: peer.pose,
      onFoot: !this.vehicles.occupants.has(peer.id), deviceId: peer.fundingDeviceId, spokenBubbles: peer.spokenBubbles === true, send: message => peer.send(encodeS2C(message)) };
  }
  private quickEvents: { at: number; promise: Promise<TechWeekEvent[]> } | undefined;
  private readonly quickAnchors = new Map<string, FundingRing>();
  private async resolveQuickDestination(playerId: number, destination: Point, target: QuickRobotaxiTarget): Promise<QuickTripDestination | null> {
    // Cross-cell quick travel needs an explicit handoff before zonedWorld can be enabled with this feature.
    const peer = this.peers.get(playerId);
    if (!flags.quickRobotaxi || flags.zonedWorld || !peer?.fundingDeviceId) return null;
    let point = destination, title = target.title.trim() || 'Map pin', friendPlayerId: number | undefined;
    if (target.friend) {
      if (!flags.friends) return null;
      const username = normalizeUsername(target.friend);
      const device = username && await deviceForUsernameKey(this.env.DB, username.key);
      if (!device || device === peer.fundingDeviceId || !await areFriends(this.env.DB, peer.fundingDeviceId, device)) return null;
      const friend = [...this.peers.values()].find(p => p.fundingDeviceId === device);
      if (!friend) return null;
      point = { ...friend.pose }; title = `Meet ${username!.display}`; friendPlayerId = friend.id;
    }
    const now = Date.now();
    if (!this.quickEvents || now - this.quickEvents.at > 300_000) {
      this.quickAnchors.clear();
      const pending = { at: now, promise: listEvents(this.env.DB) }; this.quickEvents = pending;
      pending.promise.catch(() => { if (this.quickEvents === pending) this.quickEvents = undefined; });
    }
    const events = await this.quickEvents.promise;
    if (this.peers.get(playerId) !== peer) return null;
    if (target.eventId && !target.friend) {
      const event = events.find(e => e.id === target.eventId), anchor = event && fundingAnchor(event, this.recoveryRoads);
      if (!event || !anchor) return null;
      point = { x: Math.round(anchor.x * 100), y: Math.round(anchor.y * 100), z: Math.round(anchor.z * 100) }; title = event.title;
    }
    const rings: FundingRing[] = [];
    for (const event of events) {
      if (event.lat === null || event.lon === null) continue;
      const raw = project(event.lat, event.lon);
      if (Math.hypot(raw.x - point.x / 100, raw.z - point.z / 100) > 350) continue;
      let ring = this.quickAnchors.get(event.id);
      if (!ring) {
        const anchor = fundingAnchor(event, this.recoveryRoads); if (!anchor) continue;
        ring = { ...anchor, radiusM: DRIVE_THROUGH_RADIUS_M }; this.quickAnchors.set(event.id, ring);
      }
      rings.push(ring);
    }
    const drop = safeQuickDrop(this.recoveryRoads, point, rings, friendPlayerId === undefined ? 150 : 50);
    return drop ? { ...drop, title: Array.from(title).slice(0, 60).join(''), ...(friendPlayerId === undefined ? {} : { friendPlayerId }) } : null;
  }
  private quickTaxiServices(): QuickTaxiServices {
    const device = (id: number) => {
      const value = this.peers.get(id)?.fundingDeviceId;
      if (!value) throw new Error('Robotaxi profile unavailable'); return value;
    };
    const billing = createQuickTaxiBilling({ device,
      charge: (deviceId, rideId, fareCents) => chargeRide(this.env.DB, deviceId, rideId, fareCents),
      refund: (deviceId, rideId) => refundRide(this.env.DB, deviceId, rideId),
    });
    return {
      now: () => Date.now(),
      resolve: (id, destination, target) => this.resolveQuickDestination(id, destination, target),
      quote: (id, distanceM) => quoteRide(this.env.DB, device(id), distanceM),
      charge: billing.charge, refund: billing.refund,
      refundDispatched: async (id, rideId) => {
        const paidBy = this.paidRides.deviceOf(id, rideId) ?? this.peers.get(id)?.fundingDeviceId;
        this.paidRides.detach(id, rideId); // keep the row until the refund lands (a failed refund is retried by the next instance)
        if (!paidBy) return false;
        const refunded = await refundRide(this.env.DB, paidBy, rideId);
        this.paidRides.drop(rideId);
        return refunded;
      },
      charged: (id, friendId, rideId) => {
        billing.dispatched(rideId);
        const paidBy = this.peers.get(id)?.fundingDeviceId; if (paidBy) this.paidRides.charged(id, rideId, paidBy, Date.now());
        const peer = this.peers.get(id); if (!peer) return;
        if (peer.fundingDeviceId && this.funding) this.ctx.waitUntil(this.funding.refreshAfterRide(peer.fundingDeviceId).catch(() => undefined));
        if (friendId !== undefined) this.peers.get(friendId)?.send(encodeS2C({ type: 'ROBOTAXI_FRIEND_NOTICE', name: peer.session.name }));
      },
      // review fix 1 (anti-teleport): a quick-robotaxi jump to the drop drops any in-progress mission/drive/robbery,
      // so you can't grab a deck in SoMa, hail a robotaxi to First Round, and cash out without the drive.
      arrived: id => { this.paidRides.settled(id); const deviceId = this.peers.get(id)?.fundingDeviceId; if (deviceId) this.clearDeviceQuests(deviceId); },
    };
  }
  private recoverRoad(peer: Peer, now: number): void {
    // gtasf-dtnk7: a ≤200 m road snap must not be a wanted player's way out of the cuff radius / line of sight. While
    // wanted: refused on foot (sprint instead), and in a vehicle unless it has stopped (genuinely stuck).
    if (this.taxiRefusesWanted(peer.id)) {
      const vehicleId = this.vehicles.occupants.get(peer.id), car = vehicleId === undefined ? undefined : this.vehicles.cars.get(vehicleId);
      if (!car || Math.abs(car.entry.speedCmps) > 50) { peer.send(encodeS2C({ type: 'CORRECTION', pose: peer.pose })); return; }
    }
    if (now - (this.recoveredAt.get(peer.id) ?? -Infinity) < 3000) return;
    this.recoveredAt.set(peer.id, now);
    // review fix 2b (anti-teleport): ROAD_RESPAWN snaps the player to a nearby road — a server-authorized pose
    // jump, so drop any in-flight mission/trial/quest (can't un-stick across a gap mid-heist and cash out).
    if (peer.fundingDeviceId) this.clearDeviceQuests(peer.fundingDeviceId);
    const snap = this.recoveryRoads.snap(peer.pose, 200);
    if (!snap) { peer.send(encodeS2C({ type: 'CORRECTION', pose: peer.pose })); return; }
    const points = snap.edge.points;
    let distance = 0, index = 1;
    for (; index < points.length - 1; index++) {
      const a = points[index - 1]!, b = points[index]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (distance + length >= snap.along) break;
      distance += length;
    }
    const a = points[index - 1]!, b = points[index]!;
    const pose = routePose({ from: a, to: b, length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), speed: 0 }, snap.along - distance);
    if (!this.vehicles.respawnDriver(peer.id, pose, now)) {
      this.taxis.cancel(peer.id, undefined, now);
      this.vehicles.disconnect(peer.id, now);
      Object.assign(peer.session.movement, { pose, lastAt: now, carryCm: 0 }); peer.pose = pose;
      peer.send(encodeS2C({ type: 'CORRECTION', pose }));
    }
    peer.send(encodeS2C(this.vehicleSnapshot(peer, now)));
  }
}
