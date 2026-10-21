/** v2 adds resumable nicknamed sessions and gameplay messages. Never interpret v1 as v2. */
export const PROTOCOL_VERSION = 2;
export const PROTOCOL_SUBPROTOCOL = 'gtasf.v2';
export const C2S_MAX_BYTES = 2048;
export const S2C_MAX_BYTES = 65536;
export const WORLD_MIN_CM = -2_000_000;
export const WORLD_MAX_CM = 2_000_000;
export const SNAPSHOT_ENTRY_BYTES = 18;
export const SNAPSHOT_MAX_ENTRIES = Math.floor((S2C_MAX_BYTES - 15) / SNAPSHOT_ENTRY_BYTES);
export const VEHICLE_ENTRY_BYTES = 25;
export const VEHICLE_MAX_ENTRIES = Math.floor((S2C_MAX_BYTES - 15) / VEHICLE_ENTRY_BYTES);
export const NICKNAME_MAX_BYTES = 48;
export const CHAT_MAX_BYTES = 320;
export const RESUME_TOKEN_BYTES = 64;
export const C2S = {
  HELLO: 1, MOVE: 2, CHAT: 3, PING: 7,
  VEHICLE_ENTER: 0x10, VEHICLE_EXIT: 0x11, VEHICLE_MOVE: 0x12,
  ROBOTAXI_HAIL: 0x13, ROBOTAXI_CANCEL: 0x14, EVENT_JOIN: 0x15, EVENT_LEAVE: 0x16,
  ACTIVITY: 0x17,
  // Separate opcodes preserve the original v2 HELLO byte layout.
  HELLO_ANALYTICS: 0x18, ANALYTICS: 0x19,
  ROAD_RESPAWN: 0x1a,
  // Cosmetic character-looks id (gtasf-u1g4/hrmk); opaque u32, never gameplay.
  SET_APPEARANCE: 0x1b,
  // Playful Mayhem fire (gtasf-mayhem-sync); cosmetic splat/confetti/splash, rate-limited, never gameplay.
  MAYHEM_FIRE: 0x1c,
  // Additive opcodes retain the real-time ride fallback byte layout.
  ROBOTAXI_QUICK_HAIL: 0x1d, ROBOTAXI_READY: 0x1e, ROBOTAXI_QUOTE: 0x1f,
  // Proximity voice signalling (flag proximityVoice); audio itself flows through Cloudflare Realtime.
  VOICE_PUBLISH: 0x20, VOICE_STOP: 0x21, VOICE_MUTE: 0x22,
  // GTA-pivot combat (flag serverHits): the client reports a shot (weapon + aim direction). The server uses
  // the shooter's AUTHORITATIVE pose for the origin and validates rate/range/line-of-sight before any damage.
  COMBAT_FIRE: 0x23,
  // GTA-pivot combat: the client confirms the player accepted the 18+ gate and combat is live, so the server may
  // treat them as a valid PvP target. Sent once on startCombat; unconfirmed players are never PvP targets.
  COMBAT_READY: 0x24,
  // GTA-pivot street-crime wanted (flag streetCrimeWanted): the client confesses a crime the server can't see (u8 kind:
  // 0 shot a ped, 1 ran one over, 2 rammed a police car). It can only ever raise the SENDER's own wanted level.
  COMBAT_CRIME: 0x25,
  // GTA-pivot vehicle damage (flag vehicleDamage): the driver reports a crash of the car it is driving (closing speed,
  // m/s). It can only damage the SENDER's own vehicle, so it is trusted (rate-limited server-side).
  VEHICLE_CRASH: 0x26,
  // GTA-pivot ped melee (flag pedMelee): a pedestrian who fought back landed a swing on the sender. Self-damage only.
  PED_PUNCH: 0x27,
  // Kerb-car theft (flag kerbCarTheft): steal the cosmetic parked car at this pose; the server validates + spawns it.
  KERB_CAR_TAKE: 0x28,
  // Opening drive (flag openingDrive): a new player at FOUNDER_OPENING_DRIVE_START asks for their opening car (u8 yaw: the
  // heading they face). The server spawns it on the nearest road beside the AUTHORITATIVE pose, once per session, and seats them.
  OPENING_CAR: 0x29,
} as const;
export const S2C = {
  WELCOME: 0x81, SNAPSHOT: 0x82, PLAYER_JOIN: 0x83, PLAYER_LEAVE: 0x84,
  CHAT_BROADCAST: 0x85, APPEARANCE: 0x86, MAYHEM_FIRE: 0x87, CORRECTION: 0x89, PONG: 0x8d,
  // Spoken bubble (flag voiceCaptions): same layout as CHAT_BROADCAST; decodes to CHAT_BROADCAST {spoken:true}.
  // A separate opcode so cached older clients simply ignore it instead of rejecting a longer CHAT_BROADCAST.
  CHAT_SPOKEN: 0x88,
  OUTBID_CHANGED: 0x98,
  VEHICLE_SNAPSHOT: 0xa0, VEHICLE_STATE: 0xa1, ROBOTAXI_STATE: 0xa2, EVENT_STATE: 0xa3,
  ROBOTAXI_QUICK_STATE: 0xa4, ROBOTAXI_FRIEND_NOTICE: 0xa5,
  ZONE_HANDOFF: 0xb0, ZONE_LAYOUT: 0xb1,
  VOICE_PEERS: 0xa6, VOICE_STATE: 0xa7,
  // GTA-pivot combat (flag serverHits): the server broadcasts a validated shot to nearby peers — the tracer
  // (origin → to) plus any damage/death it applied (targetId, damage, killed). Cosmetic for non-targets.
  COMBAT_HIT: 0xa8,
  // GTA-pivot police (flag wanted): the server tells a player their current wanted level (0–5 stars).
  WANTED: 0xa9,
  // GTA-pivot police bust (flag policeBust): the server arrested this player (it already applied the −5% and the
  // respawn); the client only plays the BUSTED screen.
  BUSTED: 0xaa,
  // GTA-pivot SFPD on foot (flag sfpdOnFoot): the officers near this player (server WorldPolice 'foot' units), sent
  // with the vehicle snapshot while any exist (an empty list clears them).
  OFFICERS: 0xab,
  // GTA-pivot vehicle damage (flag vehicleDamage): a vehicle exploded here (position in cm) — fireball, blast, audio.
  EXPLOSION: 0xad,
  // GTA-pivot vitals (flag vitalsPickups): this player's server-owned health + armour after a pickup / purchase / hit.
  COMBAT_VITALS: 0xae,
  // GTA-pivot pickups (flag vitalsPickups): pickup PICKUP_SPOTS[index] became available / was taken.
  PICKUP_STATE: 0xaf,
  // GTA-pivot police ramming (flag policeRam): a cruiser rammed the receiver's car; shove it along (dirX, dirZ).
  POLICE_RAM: 0xb2,
  // gtasf-abijv: whether any SFPD unit currently SEES the receiver (server line of sight); sent on change. Drives the
  // escape flash so it matches the server's escape (wanted decay) instead of a client distance guess.
  WANTED_SIGHT: 0xb3,
  // gtasf-66lvh (flag wantedEscape): the receiver's escape from the SFPD — phase (0 seen, 1 evading, 2 searching),
  // progress 0–255 toward losing them, unseen time still needed (tenths of a second), and a cover bitmask (1 hideout,
  // 2 outrunning, 4 respray in reach). Sent on change while wanted. Old clients ignore the opcode.
  WANTED_ESCAPE: 0xb4,
  // GTA-pivot multiplayer quests (lane C: street races, Most Wanted bounty, co-op heist): one generic server→client
  // notice carrying a small JSON quest event (see shared/founder/questEvents.ts). Old clients ignore the opcode.
  QUEST: 0xac,
} as const;
/** Largest QUEST JSON body (bytes). */
export const QUEST_JSON_MAX_BYTES = 2048;
/** Most officers one OFFICERS message carries. */
export const OFFICERS_MAX = 32;
export const VEHICLE_KINDS = ['prius', 'tesla', 'subaru', 'bus', 'robotaxi', 'cable-car', 'supercar'] as const;
export const PLAYER_MODES = ['on-foot', 'driver', 'passenger'] as const;
export const ROBOTAXI_STATES = ['requested', 'pickup', 'riding', 'arrived', 'cancelled', 'unavailable', 'quick', 'unaffordable', 'quoted'] as const;
export const CloseCode = { BAD_HELLO: 4001, BAD_RESUME: 4003, PROTOCOL: 4004, IDLE: 4005, SUPERSEDED: 4006,
  CAPACITY: 4007, INPUT_IDLE: 4008, LAUNCH_WAITLIST: 4009 } as const;

export const ROBOTAXI_TITLE_BYTES = 240;
/** Realtime session ids / track names are short opaque ASCII; bounded so VOICE_PEERS stays small. */
export const VOICE_ID_MAX_BYTES = 64;
/** Realtime ids are opaque URL-safe tokens; anything else is refused before it reaches the proxy. */
export const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const VOICE_PEERS_MAX = 32;
export const VOICE_STATES = ['speaking', 'stopped', 'refused-unverified', 'refused-banned', 'refused-rate', 'refused-off'] as const;
