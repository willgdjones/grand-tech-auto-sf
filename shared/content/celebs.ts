import { flags, type Feature } from '@gtasf/shared/flags';

/**
 * Hidden parody angel-investor NPCs (PLAN-v2 decision 4, bead gtasf-v2-angel-npcs-v4i6).
 *
 * These are PARODY characters: low-poly, no real faces, affectionate-joke lines only
 * (never a factual claim, quote or endorsement). Gated by the `celebNpcs` kill switch,
 * which stays OFF in production until the founder approves `docs/content/celebs.md`.
 * This module is presentation + tuning data only; it grants no reward on its own. The
 * world NPC module validates proximity and once-per-NPC-per-player before any cheque,
 * and the cheque is recorded server-side as a funding source for the cap table.
 */
export const CELEB_FEATURE_FLAG: Feature = 'celebNpcs';

/** Appended to every NPC name wherever it is shown (floating tag, prompt, cap table). */
export const CELEB_PARODY_SUFFIX = '(parody)';

export type CelebTier = 'angel' | 'notable' | 'legend' | 'mega';

/**
 * Harder-to-find NPCs pay more. Game dollars are integer cents as `bigint`, matching the
 * cap-table / funding contract (`shared/funding.ts`, `shared/drops.ts`) so cheques sum into a
 * bigint total without `Number` coercion or precision loss past 2^53 (review M4). Pane 4 tunes.
 */
export const CELEB_TIER_CHEQUE_CENTS_V2 = {
  angel: 50_000_000n, // $500K
  notable: 200_000_000n, // $2M
  legend: 600_000_000n, // $6M
  mega: 4_000_000_000n, // $40M
} as const satisfies Record<CelebTier, bigint>;

/** Economy v3: base from pane 4's calibration; every tier stays at or below one third
 * of the $75k Seed threshold. Rarity increases the cheque without skipping the event loop. */
export const CELEB_TIER_CHEQUE_CENTS_V3 = {
  angel: 2_162_900n, // $21,629
  notable: 2_250_000n, // $22,500
  legend: 2_375_000n, // $23,750
  mega: 2_500_000n, // $25,000: one third of Seed
} as const satisfies Record<CelebTier, bigint>;

/** One shared selection for client pitch copy and authoritative Worker credits. */
export const CELEB_TIER_CHEQUE_CENTS = flags.economyV3
  ? CELEB_TIER_CHEQUE_CENTS_V3 : CELEB_TIER_CHEQUE_CENTS_V2;

/**
 * Loose-resemblance appearance for a parody angel (bead gtasf-angel-loose-resemblance-cc13).
 * Bounded, enum-driven **descriptors** of the person — never a real face. Pane 6 maps these to
 * its low-poly avatar mesh/model params (web/src/avatar/*), falling back to the closest part it
 * has; the enums are deliberately render-agnostic so the content stays stable if the mesh set
 * changes. Source content: docs/content/angel-appearances.md (CalmForge). Parody only, kind,
 * readable from a distance; gated by the celebNpcs kill switch like the rest of the roster.
 */
export interface CelebAppearance {
  readonly build: 'slim' | 'average' | 'stocky' | 'tall';
  readonly hair: 'none' | 'short' | 'buzz' | 'wavy' | 'curly' | 'long' | 'receding';
  readonly hairColor: 'black' | 'brown' | 'blond' | 'grey' | 'red';
  readonly facialHair: 'none' | 'stubble' | 'beard' | 'moustache';
  readonly glasses: boolean;
  readonly outfit: 'hoodie' | 'tee' | 'grey-tee' | 'button-down' | 'smart-casual' | 'blazer'
    | 'blazer-over-tee' | 'leather-jacket' | 'western-shirt' | 'running-gear' | 'sweater' | 'suit';
  /** One low-poly held/worn signature item (short descriptor; pane 6 picks the mesh). */
  readonly prop: string;
  /** Optional low-poly clothing tint (hex) for extra recognisability. */
  readonly accentColor?: string;
}

export interface CelebNpc {
  /** Stable slug; the server keys "already pitched" state on this, never on the name. */
  readonly id: string;
  /** Parody display name (shown with CELEB_PARODY_SUFFIX appended). */
  readonly name: string;
  /** Flavour neighbourhood used by rumour hints; never an exact pin. */
  readonly neighbourhood: string;
  readonly tier: CelebTier;
  /** Hidden world spot, real SF [latitude, longitude]. Not shown on map/radar. */
  readonly spot: readonly [lat: number, lon: number];
  /** Facing in degrees clockwise from north; the world module paces a short loop here. */
  readonly headingDeg: number;
  /** Palette index into avatarOutfits for low-poly variety (no real likeness). */
  readonly outfit: number;
  /** Affectionate parody reply shown on a successful pitch. Not a real quote. */
  readonly line: string;
}

/** Full roster. Coordinates are approximate, deliberately hidden, within the reachable corridor. */
export const CELEB_NPCS = [
  { id: 'ron-conway', name: 'Ron Conway', neighbourhood: 'Jackson Square', tier: 'notable', spot: [37.7965, -122.403], headingDeg: 200, outfit: 0,
    line: "Everyone in this town has my number. You just got my voicemail — that's a yes." },
  { id: 'naval-ravikant', name: 'Naval Ravikant', neighbourhood: 'the Embarcadero rooftops', tier: 'legend', spot: [37.7975, -122.396], headingDeg: 90, outfit: 1,
    line: 'Seek wealth, not a follow-up meeting. But also, wire me the follow-up meeting.' },
  { id: 'elad-gil', name: 'Elad Gil', neighbourhood: 'the Financial District', tier: 'notable', spot: [37.7945, -122.4005], headingDeg: 270, outfit: 2,
    line: "I've quietly backed everyone you've met today. Including that pigeon." },
  { id: 'lachy-groom', name: 'Lachy Groom', neighbourhood: 'the north waterfront', tier: 'angel', spot: [37.801, -122.3985], headingDeg: 0, outfit: 3,
    line: 'Small round, big conviction, zero paperwork. Go.' },
  { id: 'gokul-rajaram', name: 'Gokul Rajaram', neighbourhood: 'SoMa', tier: 'angel', spot: [37.78, -122.404], headingDeg: 180, outfit: 0,
    line: "I call this the Gokul test: did the line move? No? Here's a cheque anyway." },
  { id: 'nat-friedman', name: 'Nat Friedman', neighbourhood: 'North Beach', tier: 'notable', spot: [37.8, -122.4095], headingDeg: 135, outfit: 1,
    line: 'Ship first, raise second. You did it backwards, which I respect.' },
  { id: 'daniel-gross', name: 'Daniel Gross', neighbourhood: 'North Beach', tier: 'notable', spot: [37.8002, -122.4096], headingDeg: 135, outfit: 2,
    line: 'Nat already said yes, so now I have to. Classic us.' },
  { id: 'garry-tan', name: 'Garry Tan', neighbourhood: 'SoMa', tier: 'angel', spot: [37.781, -122.4045], headingDeg: 90, outfit: 3,
    line: "Batch is full. The sidewalk batch, however, is wide open. You're in." },
  { id: 'paul-graham', name: 'Paul Graham', neighbourhood: 'Washington Square', tier: 'legend', spot: [37.8006, -122.4108], headingDeg: 45, outfit: 0,
    line: "I wrote a 4,000-word essay about this exact conversation. Here's the TL;DR: cheque." },
  { id: 'jessica-livingston', name: 'Jessica Livingston', neighbourhood: 'Washington Square', tier: 'notable', spot: [37.8006, -122.411], headingDeg: 45, outfit: 1,
    line: 'He talks, I decide. Decided. Go build the thing.' },
  { id: 'alexis-ohanian', name: 'Alexis Ohanian', neighbourhood: 'Washington Square', tier: 'angel', spot: [37.8008, -122.41], headingDeg: 315, outfit: 2,
    line: 'Front page of the internet, back alley of the funding. Take it.' },
  { id: 'jason-calacanis', name: 'Jason Calacanis', neighbourhood: 'North Beach', tier: 'angel', spot: [37.7995, -122.408], headingDeg: 225, outfit: 3,
    line: "I'm ANGRY about how good this is. Angry-invest activated." },
  { id: 'scott-belsky', name: 'Scott Belsky', neighbourhood: 'SoMa', tier: 'angel', spot: [37.779, -122.403], headingDeg: 180, outfit: 0,
    line: "Messy middle, clean cheque. You're somewhere in the middle." },
  { id: 'balaji-srinivasan', name: 'Balaji Srinivasan', neighbourhood: 'Telegraph Hill', tier: 'legend', spot: [37.8024, -122.406], headingDeg: 90, outfit: 1,
    line: 'Exit to the network state — but first, exit to this park bench and take the money.' },
  { id: 'sriram-krishnan', name: 'Sriram Krishnan', neighbourhood: 'Telegraph Hill', tier: 'notable', spot: [37.8028, -122.405], headingDeg: 45, outfit: 2,
    line: 'Good tweet. Even better term sheet. Both from me.' },
  { id: 'aaron-levie', name: 'Aaron Levie', neighbourhood: 'SoMa', tier: 'angel', spot: [37.7805, -122.4025], headingDeg: 270, outfit: 3,
    line: 'I made one joke and one bet. Both landed. This is the bet.' },
  { id: 'guillermo-rauch', name: 'Guillermo Rauch', neighbourhood: 'SoMa', tier: 'angel', spot: [37.7788, -122.4048], headingDeg: 0, outfit: 0,
    line: 'Ship it. I already deployed the cheque to production.' },
  { id: 'amjad-masad', name: 'Amjad Masad', neighbourhood: 'the Mission', tier: 'angel', spot: [37.76, -122.419], headingDeg: 180, outfit: 1,
    line: 'You vibe-coded a company? Fork accepted. Funded.' },
  { id: 'immad-akhund', name: 'Immad Akhund', neighbourhood: 'the Financial District', tier: 'angel', spot: [37.7938, -122.4015], headingDeg: 270, outfit: 2,
    line: "Banking's boring, so I'll make this fast. Done." },
  { id: 'sahil-lavingia', name: 'Sahil Lavingia', neighbourhood: 'Hayes Valley', tier: 'angel', spot: [37.7768, -122.424], headingDeg: 90, outfit: 3,
    line: 'Minimalist round. One line, one cheque, no board seat.' },
  { id: 'ryan-hoover', name: 'Ryan Hoover', neighbourhood: 'the Mission', tier: 'angel', spot: [37.7605, -122.4185], headingDeg: 135, outfit: 0,
    line: 'Product of the day: you. Upvoted with cash.' },
  { id: 'lenny-rachitsky', name: 'Lenny Rachitsky', neighbourhood: 'Hayes Valley', tier: 'angel', spot: [37.7762, -122.4248], headingDeg: 225, outfit: 1,
    line: 'This is a growth loop. The loop is: I give you money, you tell your friends.' },
  { id: 'shaan-puri', name: 'Shaan Puri', neighbourhood: 'the Embarcadero', tier: 'angel', spot: [37.7985, -122.3975], headingDeg: 45, outfit: 2,
    line: "Great pod guest energy. That's worth a small, loud cheque." },
  { id: 'sahil-bloom', name: 'Sahil Bloom', neighbourhood: 'the waterfront', tier: 'angel', spot: [37.799, -122.395], headingDeg: 0, outfit: 3,
    line: 'Five habits of funded founders. Habit one: take this.' },
  { id: 'kevin-hartz', name: 'Kevin Hartz', neighbourhood: 'Russian Hill', tier: 'notable', spot: [37.8018, -122.418], headingDeg: 180, outfit: 0,
    line: "I've seen this show before. It usually sells out. Here." },
  { id: 'chris-sacca', name: 'Chris Sacca', neighbourhood: 'North Beach', tier: 'legend', spot: [37.7998, -122.4085], headingDeg: 315, outfit: 1,
    line: "I retired from this. Clearly I'm bad at retiring. Cheque." },
  { id: 'sarah-guo', name: 'Sarah Guo', neighbourhood: 'SoMa', tier: 'notable', spot: [37.7795, -122.405], headingDeg: 90, outfit: 2,
    line: 'New stack, new founder, same instinct: yes.' },
  { id: 'tobi-lutke', name: 'Tobi Lütke', neighbourhood: 'the Mission', tier: 'notable', spot: [37.7598, -122.4195], headingDeg: 270, outfit: 3,
    line: 'Commerce is everywhere, including this sidewalk. Checkout complete.' },
  { id: 'dylan-field', name: 'Dylan Field', neighbourhood: 'Hayes Valley', tier: 'notable', spot: [37.777, -122.4235], headingDeg: 45, outfit: 0,
    line: "Nice frame. I'll fund the component." },
  { id: 'patrick-collison', name: 'Patrick Collison', neighbourhood: 'the Financial District', tier: 'legend', spot: [37.793, -122.402], headingDeg: 135, outfit: 1,
    line: 'Payments are a line of code. So is this. Sending.' },
  // Rare big-tech cameos — deeply hidden mega cheques.
  { id: 'elon', name: 'Elon', neighbourhood: 'Market Street', tier: 'mega', spot: [37.7765, -122.4165], headingDeg: 0, outfit: 2,
    line: "I renamed your startup to a single letter. You're welcome. Here's the money." },
  { id: 'zuck', name: 'Zuck', neighbourhood: 'the Embarcadero sea wall', tier: 'mega', spot: [37.8, -122.393], headingDeg: 90, outfit: 3,
    line: 'I will fund you in the metaverse and also, confusingly, in real dollars.' },
  { id: 'jensen', name: 'Jensen', neighbourhood: 'the SoMa docks', tier: 'mega', spot: [37.7785, -122.4035], headingDeg: 180, outfit: 0,
    line: "The more GPUs you ask for, the more I give. That's the whole pitch. Take it." },
  { id: 'altman', name: 'Altman', neighbourhood: 'Mission Bay', tier: 'mega', spot: [37.772, -122.395], headingDeg: 270, outfit: 1,
    line: 'Compute credits? Sure. Actual money? Also sure. Scaling laws, baby.' },
] as const satisfies readonly CelebNpc[];

export type CelebId = (typeof CELEB_NPCS)[number]['id'];

const CELEB_BY_ID = new Map<string, CelebNpc>(CELEB_NPCS.map(npc => [npc.id, npc]));

export function celebById(id: string): CelebNpc | undefined {
  return CELEB_BY_ID.get(id);
}

/** Server-authoritative cheque (integer cents) for a validated first pitch. Unknown id yields 0n. */
export function celebChequeCents(id: string): bigint {
  const npc = CELEB_BY_ID.get(id);
  return npc ? CELEB_TIER_CHEQUE_CENTS[npc.tier] : 0n;
}

/** Display label used on the floating tag, the pitch prompt and the cap table. */
export function celebLabel(npc: CelebNpc): string {
  return `${npc.name} ${CELEB_PARODY_SUFFIX}`;
}

/**
 * Per-NPC loose-resemblance appearance (cc13), keyed by celeb id. `Record<CelebId, …>` forces an
 * entry for every roster member. Pane 6 (web/src/avatar/*) renders these as bounded low-poly parts
 * — no real faces. Content: docs/content/angel-appearances.md. Proposed by CalmForge; pane 6 may
 * add/rename enum values to match its mesh set (additive). accentColor tints low-poly clothing.
 */
export const CELEB_APPEARANCE = {
  'ron-conway': { build: 'average', hair: 'short', hairColor: 'grey', facialHair: 'none', glasses: false, outfit: 'blazer', prop: 'phone, always dialing' },
  'naval-ravikant': { build: 'slim', hair: 'buzz', hairColor: 'black', facialHair: 'beard', glasses: false, outfit: 'tee', prop: 'a small book, calm stance' },
  'elad-gil': { build: 'tall', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'button-down', prop: 'a laptop' },
  'lachy-groom': { build: 'slim', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'tee', prop: 'an oversized cheque' },
  'gokul-rajaram': { build: 'average', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: true, outfit: 'button-down', prop: 'a coffee cup' },
  'nat-friedman': { build: 'slim', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'hoodie', prop: 'a wrench' },
  'daniel-gross': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'stubble', glasses: false, outfit: 'tee', prop: 'a laptop on a stool' },
  'garry-tan': { build: 'average', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: true, outfit: 'hoodie', prop: 'a YC lanyard', accentColor: '#f26625' },
  'paul-graham': { build: 'average', hair: 'receding', hairColor: 'grey', facialHair: 'none', glasses: false, outfit: 'button-down', prop: 'a stack of essays' },
  'jessica-livingston': { build: 'average', hair: 'long', hairColor: 'blond', facialHair: 'none', glasses: false, outfit: 'smart-casual', prop: 'a clipboard' },
  'alexis-ohanian': { build: 'tall', hair: 'short', hairColor: 'brown', facialHair: 'beard', glasses: false, outfit: 'tee', prop: 'a little alien mascot' },
  'jason-calacanis': { build: 'stocky', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: true, outfit: 'blazer-over-tee', prop: 'a microphone' },
  'scott-belsky': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'stubble', glasses: true, outfit: 'button-down', prop: 'a design notebook' },
  'balaji-srinivasan': { build: 'slim', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: false, outfit: 'tee', prop: 'a phone with a network graph' },
  'sriram-krishnan': { build: 'average', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: true, outfit: 'button-down', prop: 'a phone (a hot take)' },
  'aaron-levie': { build: 'average', hair: 'curly', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'blazer-over-tee', prop: 'a microphone' },
  'guillermo-rauch': { build: 'slim', hair: 'short', hairColor: 'black', facialHair: 'beard', glasses: false, outfit: 'tee', prop: 'a scooter with deploy stickers' },
  'amjad-masad': { build: 'average', hair: 'short', hairColor: 'black', facialHair: 'beard', glasses: false, outfit: 'tee', prop: 'a laptop (a fork)' },
  'immad-akhund': { build: 'average', hair: 'short', hairColor: 'black', facialHair: 'beard', glasses: false, outfit: 'button-down', prop: 'a corporate card' },
  'sahil-lavingia': { build: 'slim', hair: 'short', hairColor: 'black', facialHair: 'none', glasses: false, outfit: 'tee', prop: 'a sketch easel' },
  'ryan-hoover': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'tee', prop: 'a product-launch badge' },
  'lenny-rachitsky': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'beard', glasses: false, outfit: 'button-down', prop: 'a newsletter' },
  'shaan-puri': { build: 'average', hair: 'buzz', hairColor: 'black', facialHair: 'beard', glasses: false, outfit: 'tee', prop: 'a podcast mic' },
  'sahil-bloom': { build: 'slim', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'running-gear', prop: 'running shoes' },
  'kevin-hartz': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'smart-casual', prop: 'a ticket stub' },
  'chris-sacca': { build: 'stocky', hair: 'short', hairColor: 'brown', facialHair: 'beard', glasses: false, outfit: 'western-shirt', prop: 'a cowboy hat' },
  'sarah-guo': { build: 'average', hair: 'long', hairColor: 'black', facialHair: 'none', glasses: false, outfit: 'smart-casual', prop: 'a laptop' },
  'tobi-lutke': { build: 'average', hair: 'short', hairColor: 'red', facialHair: 'beard', glasses: true, outfit: 'hoodie', prop: 'a shopping bag' },
  'dylan-field': { build: 'average', hair: 'wavy', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'tee', prop: 'a whiteboard frame' },
  'patrick-collison': { build: 'tall', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'button-down', prop: 'a terminal / line of code' },
  'elon': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'blazer-over-tee', prop: 'a single letter "X" / tiny rocket' },
  'zuck': { build: 'average', hair: 'curly', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'grey-tee', prop: 'a hydrofoil board' },
  'jensen': { build: 'average', hair: 'short', hairColor: 'grey', facialHair: 'none', glasses: true, outfit: 'leather-jacket', prop: 'a GPU' },
  'altman': { build: 'average', hair: 'short', hairColor: 'brown', facialHair: 'none', glasses: false, outfit: 'sweater', prop: 'a "compute credits" token' },
} as const satisfies Record<CelebId, CelebAppearance>;

/** Loose-resemblance appearance for a roster id (cc13); undefined for an unknown id. */
export function celebAppearance(id: string): CelebAppearance | undefined {
  return (CELEB_APPEARANCE as Record<string, CelebAppearance>)[id];
}

/**
 * Vague rumour teasers surfaced on the radio and in ambient chat. They point at a
 * neighbourhood, never an exact pin, and never name the parody NPC. Fictional asides.
 */
export const CELEB_RUMOURS = [
  "Word is a certain angel's been pacing the alleys off {where} again.",
  'Someone swears they spotted a parody of a famous investor around {where}.',
  'Rooftop regulars say the quiet money shows up near {where} about now.',
  'Heard two investors were arguing over who said yes first somewhere near {where}.',
  'If you hear a leather jacket near {where}, that might be a cheque, not a motorcycle.',
  'Rumour on the street: wander {where} on foot and press E if a familiar face waves.',
] as const;

/** Format a rumour for a neighbourhood. `index` lets the caller rotate deterministically. */
export function celebRumourFor(neighbourhood: string, index = 0): string {
  const template = CELEB_RUMOURS[((index % CELEB_RUMOURS.length) + CELEB_RUMOURS.length) % CELEB_RUMOURS.length]!;
  return template.replace('{where}', neighbourhood);
}

/**
 * Ambient city-radio chatter that teases the hidden parody angels without an exact pin. Surfaced
 * by the radio only when `celebNpcs` is on (dev until the founder approves this roster). Each line
 * points at a real NPC neighbourhood above, so it is a genuine hint — but stays a fictional,
 * affectionate parody aside, never a real claim, quote or endorsement (same bar as the NPC lines).
 */
export const CELEB_RADIO_RUMOURS = [
  'DJ Cap Table here — word is a parody of a certain super-angel keeps pacing the Jackson Square alleys. Wander on foot, press E if a familiar face waves.',
  'Traffic and term sheets: someone swears a low-poly legend was handing out essays by Washington Square. Allegedly.',
  'Rooftop regulars say the quiet parody money shows up above the Embarcadero about now. Keep walking and look up.',
  'Rumour on the wire: two parody investors in a North Beach garage, still arguing over who said yes first.',
  'If you hear a leather jacket near the SoMa docks, that is not a motorcycle — that is a parody mega-cheque. Pitch accordingly.',
  'Telegraph Hill birds report a network-state enthusiast on a bench, ready to fund your parody exit.',
] as const;
