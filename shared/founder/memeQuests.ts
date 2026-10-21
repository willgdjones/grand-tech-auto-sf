/**
 * Founder-ladder phase 5 — meme-NPC side quests (docs/PLAN-founder-ladder-phase5.md). Single source of
 * truth for the fictional quest-giver archetypes, shared by the web client (render: avatar + label + the
 * NPC's spot) and the worker (pitch: the judge persona + target range check). Behind the memeQuests flag.
 *
 * GUARDRAILS (founder, 2026-10-12): these are FICTIONAL archetypes, never real people, and never carry a
 * real person's invented quote. For a pitch quest the AI judge roasts the PLAYER'S pitch only (same system
 * prompt as the ladder pitch); the archetype is only the judge's deadpan persona ("<archetype>, a San
 * Francisco investor"). No checkout — quests pay valuation, not money out.
 */

/** The three launch verbs. `pitch` reuses the AI judge; `share`/`drive` get their own crediting (follow-up). */
import type { AvatarSex, FounderArchetype } from '@gtasf/shared/content/cosmetics';
import type { Feature } from '@gtasf/shared/flags';

export type MemeQuestKind = 'pitch' | 'share' | 'drive';

/** The avatar look for a meme NPC — a DISTINCT silhouette (founder-archetype style/prop + accessory +
 *  colour) so each reads as a character before you read the label, not a generic pedestrian. */
export interface MemeNpcLook {
  readonly sex: AvatarSex;
  /** Founder archetype — drives the garment style + held prop (e.g. climate/outdoorsy, serial/blazer). */
  readonly archetype: FounderArchetype;
  /** Outfit colour index (web/src/avatar/appearance.ts). */
  readonly outfit: number;
  /** Accessory index (0 None, 1 Glasses, 2 Sunglasses, 3 Headphones, 4 Cap, 5 Beanie, 6 Scarf, 7 Backpack). */
  readonly accessory: number;
}

export interface MemeNpcSpec {
  /** Stable id (used in the credit source ref so a quest can't double-pay). */
  readonly id: string;
  /** The fictional archetype shown on the label. */
  readonly archetype: string;
  /** The AI judge's deadpan persona for a pitch quest — a fictional role, never a real person or firm
   *  ("You are <persona> in a comedy video game…"). Only used when questKind === 'pitch'. */
  readonly persona: string;
  /** The quest hook line shown under the archetype on the NPC's label. */
  readonly hook: string;
  /** Which quest verb this NPC gives. */
  readonly questKind: MemeQuestKind;
  /** Where the NPC stands (geodetic; snapped to walkable ground near it at runtime). */
  readonly target: { readonly lat: number; readonly lon: number };
  /** A nearby geodetic point the NPC faces, and searches inward from for walkable ground — keep it ~8 m from
   *  `target` so the NPC stands at its OWN spot (spread along the plaza/Embarcadero) rather than clustering
   *  within 8 m of the spawn, which overlapped the labels. */
  readonly face: { readonly lat: number; readonly lon: number };
  /** The distinct avatar look/silhouette. */
  readonly look: MemeNpcLook;
  /** Drive-quest tuning (only when questKind === 'drive'): how far / how fast to escape the protester. */
  readonly drive?: DriveQuestParams;
  /** Drive-quest wording + prop (only when questKind === 'drive'); omitted = the robotaxi protester's cone. */
  readonly driveCopy?: DriveQuestCopy;
  /** Share-quest content (only when questKind === 'share'): the thought-leader's FICTIONAL hot-take the player
   *  is invited to repost (never a real person's words). Shown on the share card + pre-filled into the X compose
   *  intent (the player posts from their own account — we never post). */
  readonly take?: string;
  /** Per-NPC feature switch on top of memeQuests: when set and OFF, the NPC neither renders nor resolves as a
   *  pitch target. Lets a new NPC (a new daily valuation source) ship dark while memeQuests is live. */
  readonly flag?: Feature;
}

/**
 * Launch meme NPCs. MVP = fictional VC archetypes who each roast the player's startup pitch in their own
 * deadpan voice (reusing the reviewed judge/cheque/cooldown), so adding one is data-only. They are spread
 * >=15 m apart along the Ferry/Embarcadero (so labels never overlap) with distinct silhouettes (outdoorsy /
 * AI-researcher / blazered) so each reads as a character. The Thought-leader share + Robotaxi-protester
 * drive quests add verb variety later.
 */
export const MEME_NPCS: readonly MemeNpcSpec[] = Object.freeze([
  {
    id: 'patagonia-vest-vc',
    archetype: 'A Patagonia-vest VC',
    persona: 'a Patagonia-vest VC, a San Francisco investor',
    hook: '“PITCH ME IN 15 SECONDS”',
    questKind: 'pitch',
    // Open SE plaza, ~28 m from spawn; >=19 m from the Pear VC plaza investor and the other two meme NPCs
    // (so no label ever overlaps — the founder's phone complaint). Faces back toward the spawn plaza.
    target: { lat: 37.795254, lon: -122.393892 },
    face: { lat: 37.795249, lon: -122.393959 },
    look: { sex: 'male', archetype: 'climate', outfit: 2, accessory: 7 }, // outdoorsy: beanie + backpack, green.
  },
  {
    id: 'ai-pilled-solo-gp',
    archetype: 'An AI-pilled solo GP',
    persona: 'an AI-obsessed solo-GP angel investor in San Francisco',
    hook: '“PITCH ME. MAKE IT BIG.”',
    questKind: 'pitch',
    // ~52 m from spawn (a walk away, not in the spawn view); >=23 m from the other meme NPCs, >=33 m from Pear VC.
    target: { lat: 37.795290, lon: -122.393630 },
    face: { lat: 37.795283, lon: -122.393698 },
    look: { sex: 'female', archetype: 'ai-researcher', outfit: 0, accessory: 3 }, // AI lanyard + headphones, ocean.
  },
  {
    id: 'wrapper-skeptic-angel',
    archetype: 'A wrapper-skeptic angel',
    persona: 'a jaded ex-founder angel in San Francisco who is sure every startup is just a thin wrapper',
    hook: '“IS IT JUST A WRAPPER?”',
    questKind: 'pitch',
    // ~45 m from spawn, deeper into the plaza; >=15.6 m from the other two meme NPCs and >=19 m from Pear VC
    // so the three quest labels plus the plaza investor's never collide (even at phone FOV).
    target: { lat: 37.795398, lon: -122.393744 },
    face: { lat: 37.795376, lon: -122.393806 },
    look: { sex: 'male', archetype: 'serial', outfit: 4, accessory: 2 }, // serial-founder blazer + sunglasses, ink.
  },
  {
    // Phase 5.1 DRIVE quest (flags.driveQuest, a sub-gate under memeQuests — stays OFF until the founder
    // reviews the payout + it has a look pass). Robotaxi protester who drops a cone; get in a car and
    // outrun it. No AI judge (persona unused); completion is server-verified (escapedCone).
    id: 'robotaxi-protester',
    archetype: 'A robotaxi protester',
    persona: '',
    hook: '“ESCAPE THE CONE”',
    questKind: 'drive',
    // PROVISIONAL placement — driveQuest is gated OFF, so this does not render in prod yet. It needs a
    // road-access + spread/look pass before enabling: the player must reach a car and drive off, so the
    // protester wants a curb/road-adjacent spot (not mid-plaza). Kept >=15 m from the pitch NPCs for now.
    // Placement (gtasf-ldlm): on the walkable Ferry plaza (lon ~-122.3937, the same walkable band as the pitch
    // NPCs) so createGroundNpc finds ground and the avatar renders — the earlier lon ~-122.3935 spot was
    // non-walkable, so the avatar stayed hidden. Spread ~17 m from the share NPC; a finer road-adjacent/spread
    // look pass can still move it.
    target: { lat: 37.795320, lon: -122.393750 },
    face: { lat: 37.795280, lon: -122.393810 },
    look: { sex: 'male', archetype: 'crypto', outfit: 3, accessory: 4 }, // activist-casual: fleece + cap.
    drive: { escapeM: 120, limitMs: 60_000 }, // outrun the cone 120 m within 60 s (TUNABLE with the payout).
  },
  {
    // Phase 5.1 SHARE quest (flags.shareQuest, sub-gate under memeQuests — OFF until the founder approves the
    // ⚠️ client-trust approach). A thought leader whose FICTIONAL hot-take the player reposts for a small bump.
    id: 'thought-leader',
    archetype: 'A thought leader',
    persona: '',
    hook: '“REPOST MY TAKE”',
    questKind: 'share',
    // PROVISIONAL placement (shareQuest gated OFF) — needs a spread/look pass before enabling.
    // Placement (gtasf-ldlm): on the walkable Ferry plaza (lon ~-122.3937) so the avatar renders — the earlier
    // lon ~-122.3936 spot was non-walkable, so createGroundNpc kept the avatar hidden. ~17 m from the drive NPC.
    target: { lat: 37.795470, lon: -122.393750 },
    face: { lat: 37.795430, lon: -122.393810 },
    look: { sex: 'female', archetype: 'growth', outfit: 5, accessory: 3 }, // influencer-casual: quarter-zip + headphones.
    take: 'Hot take: in 18 months every seed round closes on vibes and a working demo. Moats are a 2021 word. 🧵',
  },
  {
    // Founder-ladder meme roster: "Doomer at Dolores Park — convince me AI won't end us" (a pitch variant). Same
    // reviewed judge/cheque/per-SF-day cooldown as the plaza VCs, but a NEW daily pitch source, so it ships dark
    // behind flags.doomerQuest until the economy review. Fictional archetype; the judge roasts the player's pitch.
    id: 'dolores-doomer',
    archetype: 'A Dolores Park doomer',
    persona: 'a doom-pilled AI-safety worrier lounging in Dolores Park who must be convinced this startup will not end humanity',
    hook: '“CONVINCE ME AI WON’T END US”',
    questKind: 'pitch',
    // On the park lawn ~20 m in from Dolores St (the SF-pilgrimage Dolores Park stop), facing the street.
    target: { lat: 37.759654, lon: -122.426240 },
    face: { lat: 37.759654, lon: -122.426150 },
    look: { sex: 'male', archetype: 'dropout', outfit: 1, accessory: 5 }, // rumpled dropout hoodie + beanie.
    flag: 'doomerQuest',
  },
  {
    // Founder-ladder meme roster: the AI-pendant founder — "wear my device for one drive" (a joyride). The same
    // server-verified drive quest as the cone (drive-start next to the NPC, escapedCone from the authoritative pose +
    // vehicle state, demo*2 per SF day), with its own wording and no cone. A NEW daily valuation source, so it ships
    // dark behind flags.pendantQuest. Fictional archetype, no real product.
    id: 'ai-pendant-founder',
    archetype: 'An AI-pendant founder',
    persona: '',
    hook: '“WEAR MY PENDANT FOR ONE DRIVE”',
    questKind: 'drive',
    // On the Embarcadero promenade ~300 m north of the Ferry Building (the time-trial walkable band), by the road.
    target: { lat: 37.797950, lon: -122.395250 },
    face: { lat: 37.797878, lon: -122.395200 },
    look: { sex: 'female', archetype: 'consumer', outfit: 6, accessory: 1 }, // hardware-founder casual + glasses.
    drive: { escapeM: 300, limitMs: 90_000 },
    driveCopy: { prompt: 'Wear the pendant', hud: 'PENDANT JOYRIDE', success: 'The pendant loved that drive!',
      fail: 'The pendant’s battery died.', blocked: 'The pendant already has today’s drive.', cone: false },
    flag: 'pendantQuest',
  },
]);

/** Is this meme NPC switched on (its own per-NPC flag, if any)? memeQuests itself is checked by the callers. */
export function memeNpcEnabled(npc: MemeNpcSpec, enabled: Readonly<Record<string, boolean>>): boolean {
  return !npc.flag || enabled[npc.flag] === true;
}

/** Look up a meme NPC spec by id, or undefined. */
export function memeNpcById(id: string): MemeNpcSpec | undefined {
  return MEME_NPCS.find(npc => npc.id === id);
}

/** Drive-quest ("escape the cone", Robotaxi-protester) parameters. */
/** Player-facing wording for a drive quest (prompt, HUD, results) and whether a traffic cone marks the NPC. */
export interface DriveQuestCopy {
  readonly prompt: string;     // E-prompt verb, e.g. "Escape the cone"
  readonly hud: string;        // HUD title while driving, e.g. "ESCAPE THE CONE"
  readonly success: string;    // toast on a credited completion
  readonly fail: string;       // toast when time runs out
  readonly blocked: string;    // toast when already done this SF day
  readonly cone: boolean;      // drop a traffic cone in front of the NPC
}
export const CONE_DRIVE_COPY: DriveQuestCopy = Object.freeze({
  prompt: 'Escape the cone', hud: 'ESCAPE THE CONE', success: 'You outran the cone!', fail: 'The cone caught you.',
  blocked: 'You already outran this cone today.', cone: true,
});
export function driveCopyOf(spec: MemeNpcSpec): DriveQuestCopy { return spec.driveCopy ?? CONE_DRIVE_COPY; }

export interface DriveQuestParams {
  /** Metres the player must drive from the protester to count as escaped. */
  readonly escapeM: number;
  /** Time limit (ms) to escape. */
  readonly limitMs: number;
}

/** The live drive-quest state the completion check reads — shared so the client HUD timer and the server
 *  verifier evaluate escapedCone on the exact same fields. */
export interface DriveQuestState {
  /** Metres from the protester (where the quest started) to the player now. */
  readonly distFromProtesterM: number;
  /** Milliseconds since the quest started. */
  readonly elapsedMs: number;
  /** Whether the player is currently in a vehicle (on-foot never counts as escaped). */
  readonly inVehicle: boolean;
}

/**
 * Drive-quest completion check — server-verifiable from the player's live position + vehicle state, so no
 * client-trust is needed (unlike the share quest). Success iff the player is IN A VEHICLE and has driven at
 * least `escapeM` from the protester within `limitMs` (with a non-negative, sane clock). Pure, so the client
 * HUD timer and the server verifier agree on the exact same rule.
 */
export function escapedCone(
  state: DriveQuestState,
  params: DriveQuestParams,
): boolean {
  return state.inVehicle
    && Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0 && state.elapsedMs <= params.limitMs
    && Number.isFinite(state.distFromProtesterM) && state.distFromProtesterM >= params.escapeM;
}
