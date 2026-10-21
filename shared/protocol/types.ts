import type { AnalyticsContext } from '../analytics';
import type { VOICE_STATES } from './constants';
export type DecodeErrorCode = 'TRUNCATED' | 'TRAILING_BYTES' | 'BAD_UTF8' | 'BAD_VERSION' | 'BAD_COUNT' | 'OUT_OF_RANGE' | 'UNKNOWN_TYPE';
export type DecodeResult<T> = { ok: true; msg: T } | { ok: false; err: DecodeErrorCode; at?: number };
export interface Pose { x: number; y: number; z: number; yaw: number; flags: number }
export interface Point { x: number; y: number; z: number }
export interface QuickRobotaxiTarget {
  title: string; eventId: string; friend: string;
  /** Last server quote shown to the player; an empty value asks for the current fare. */
  maxFareCents: string;
}
export interface MoveMessage extends Pose { type: 'MOVE'; seq: number }
export type VoiceState = typeof VOICE_STATES[number];
/** COMBAT_CRIME kinds: 0 shot a pedestrian, 1 ran one over, 2 rammed a police car, 3 knocked one out (pedMelee). All self-incriminating. */
export type PedCrimeKind = 0 | 1 | 2 | 3;
export type C2SMessage =
  | { type: 'HELLO'; name: string; resumeToken?: string; analytics?: AnalyticsContext }
  | { type: 'ANALYTICS'; analytics?: AnalyticsContext }
  | MoveMessage
  | { type: 'PING'; nonce: number; clientT: number }
  | { type: 'ACTIVITY' }
  | { type: 'ROAD_RESPAWN' }
  | { type: 'CHAT'; clientMsgId: number; eventId: number; text: string }
  | { type: 'VEHICLE_ENTER' | 'VEHICLE_EXIT'; vehicleId: number }
  | ({ type: 'VEHICLE_MOVE'; vehicleId: number; seq: number } & Pose)
  | { type: 'ROBOTAXI_HAIL'; requestId: number; destination: Point; quick?: QuickRobotaxiTarget }
  | { type: 'ROBOTAXI_QUOTE'; requestId: number; destination: Point; quick: QuickRobotaxiTarget }
  | { type: 'ROBOTAXI_READY'; requestId: number }
  | { type: 'ROBOTAXI_CANCEL'; requestId: number }
  | { type: 'EVENT_JOIN' | 'EVENT_LEAVE'; eventId: number }
  | { type: 'SET_APPEARANCE'; appearance: number }
  | { type: 'MAYHEM_FIRE'; item: number; at: [number, number, number]; colour: number; normal: [number, number, number] | null }
  | { type: 'COMBAT_FIRE'; weapon: number; dir: [number, number, number] }
  // Combat opt-in: the player accepted the 18+ gate (combat live), so the server may treat them as a PvP target.
  | { type: 'COMBAT_READY' }
  // Street-crime wanted: the sender wasted a (client-only) pedestrian — 0 shot, 1 run over. Self-incriminating only.
  | { type: 'COMBAT_CRIME'; kind: PedCrimeKind }
  // Vehicle damage: the sender crashed the car it is driving at `closing` m/s (0–255). Self-damage only.
  | { type: 'VEHICLE_CRASH'; closing: number }
  // Ped melee (flag pedMelee): a pedestrian who fought back hit the sender. The server owns the damage.
  | { type: 'PED_PUNCH' }
  // Kerb-car theft (flag kerbCarTheft): the kerb prop at (x, z) cm, heading yaw (byte), kind 0 prius / 1 subaru.
  | { type: 'KERB_CAR_TAKE'; x: number; z: number; yaw: number; kind: 0 | 1 }
  // Opening drive (flag openingDrive): the new player's opening car, facing `yaw` (byte). Server places + seats; once per session.
  | { type: 'OPENING_CAR'; yaw: number }
  // Proximity voice (docs/engineering/proximity-voice.md, flag proximityVoice). PUBLISH names the speaker's
  // Cloudflare Realtime session/track created through the Worker proxy; the server decides who may hear it.
  | { type: 'VOICE_PUBLISH'; sessionId: string; trackName: string }
  | { type: 'VOICE_STOP' }
  | { type: 'VOICE_MUTE'; target: number; muted: boolean };
export interface SnapshotEntry extends Pose { id: number }
export type VehicleKind = 'prius' | 'tesla' | 'subaru' | 'bus' | 'robotaxi' | 'cable-car' | 'supercar';
export type PlayerMode = 'on-foot' | 'driver' | 'passenger';
export type RobotaxiState = 'requested' | 'pickup' | 'riding' | 'arrived' | 'cancelled' | 'unavailable' | 'quick' | 'unaffordable' | 'quoted';
export interface VehicleEntry extends SnapshotEntry { kind: VehicleKind; driverId: number; speedCmps: number }
export type S2CMessage =
  | { type: 'OUTBID_CHANGED'; revision: number }
  | { type: 'WELCOME'; id: number; serverT: number; name: string; pose: Pose; resumeToken: string; lastMoveSeq: number; resumed: boolean }
  | { type: 'PLAYER_JOIN'; id: number; name: string; pose: Pose }
  | { type: 'SNAPSHOT'; tick: number; serverT: number; entries: SnapshotEntry[] }
  | { type: 'PLAYER_LEAVE'; id: number }
  | { type: 'PONG'; nonce: number; clientT: number; serverT: number }
  | { type: 'CORRECTION'; pose: Pose }
  | { type: 'VEHICLE_SNAPSHOT'; tick: number; serverT: number; entries: VehicleEntry[] }
  | { type: 'VEHICLE_STATE'; vehicleId: number; playerId: number; mode: PlayerMode }
  | { type: 'ROBOTAXI_STATE'; requestId: number; vehicleId: number; state: RobotaxiState; pose: Pose; destination: Point; etaSeconds: number; quick?: { title: string; fareCents: string; freeRidesLeft: number; durationMs: number } }
  | { type: 'ROBOTAXI_FRIEND_NOTICE'; name: string }
  | { type: 'EVENT_STATE'; eventId: number; playerId: number; present: boolean }
  | { type: 'CHAT_BROADCAST'; messageId: number; senderId: number; eventId: number; serverT: number; name: string; text: string; spoken?: true }
  | { type: 'APPEARANCE'; id: number; appearance: number }
  | { type: 'MAYHEM_FIRE'; senderId: number; item: number; at: [number, number, number]; colour: number; normal: [number, number, number] | null }
  | { type: 'COMBAT_HIT'; shooterId: number; weapon: number; origin: [number, number, number]; to: [number, number, number]; targetId: number; damage: number; killed: boolean }
  | { type: 'WANTED'; level: number }
  // Police bust (flag policeBust): the server arrested this player — −5% and the respawn are already applied.
  | { type: 'BUSTED' }
  // Vehicle damage: a vehicle exploded at this position (cm).
  | { type: 'EXPLOSION'; x: number; y: number; z: number }
  // Vitals (flag vitalsPickups): this player's server-owned health + armour (0–100 each).
  | { type: 'COMBAT_VITALS'; health: number; armour: number }
  // Pickups (flag vitalsPickups): PICKUP_SPOTS[index] is available (true) or taken (false).
  | { type: 'PICKUP_STATE'; index: number; available: boolean }
  // Police ramming (flag policeRam): unit vector (x, z) from the cruiser toward the receiver's car (~0.01 precision).
  | { type: 'POLICE_RAM'; dirX: number; dirZ: number }
  // Police sight (gtasf-abijv): true while a unit has the receiver in (line of) sight.
  // x/z (cm): where the police last saw them — the centre of the radar search circle while unseen.
  | { type: 'WANTED_SIGHT'; seen: boolean; x: number; z: number }
  // Wanted escape (gtasf-66lvh, flag wantedEscape): phase 0 seen / 1 evading / 2 searching, progress 0–255, remainingDs
  // tenths of a second of unseen time still needed, cover bits (1 hideout, 2 outrunning, 4 respray in reach).
  | { type: 'WANTED_ESCAPE'; phase: number; progress: number; remainingDs: number; cover: number }
  | { type: 'QUEST'; json: string }
  // SFPD officers on foot near this player (flag sfpdOnFoot): positions in centimetres, byte yaw, moving = walking/running.
  | { type: 'OFFICERS'; entries: { id: number; x: number; y: number; z: number; yaw: number; moving: boolean }[] }
  // Zoned world (gtasf-djjz, behind flags.zonedWorld): origin tells the client to re-home to the
  // destination cell (cx,cy) carrying `token`, which installs the preserved session there (?handoff=).
  | { type: 'ZONE_HANDOFF'; token: string; cx: number; cy: number }
  | { type: 'ZONE_LAYOUT'; splitMask: number; cx: number; cy: number }
  /** The complete set of voice tracks this listener should hear now; gain is 0..255 (255 = full). */
  | { type: 'VOICE_PEERS'; peers: VoicePeer[] }
  | { type: 'VOICE_STATE'; playerId: number; state: VoiceState };
export interface VoicePeer { playerId: number; sessionId: string; trackName: string; gain: number }
