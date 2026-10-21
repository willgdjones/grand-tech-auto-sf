import { ECON_V3_ROUNDS, FUNDING_ROUNDS, FUNDING_ROUNDS_V2, fundingRound, type FundingRound } from '../funding';
import { flags } from '@gtasf/shared/flags';

/**
 * Character looks + status progression (founder feature 2026-10-03). The authoritative, pure,
 * cosmetic-only contract every pane builds on:
 *  - base avatar sex (two rigs; every stage look exists for both — pane 6 renders),
 *  - 12 founder archetypes (starting style + signature prop + nameplate title),
 *  - stage LookTiers keyed to the funding ladder (looks get more well-to-do as the round rises),
 *  - a COMPACT appearance id packed into one 32-bit int for the player snapshot (no bandwidth blow-up),
 *  - resolveLook()/nameplateTitle() so the local player, remotes and nameplates render the same look.
 *
 * COSMETIC ONLY: nothing here mutates funding; it only READS the funding round to pick the tier.
 * Locked items advertise their required stage via LookTier.unlockRoundId.
 */

export type AvatarSex = 'male' | 'female';

export type FounderArchetype =
  | 'hacker' | 'ai-researcher' | 'crypto' | 'deep-tech' | 'design' | 'growth'
  | 'biotech' | 'climate' | 'consumer' | 'ex-faang' | 'dropout' | 'serial';

export interface ArchetypeDef {
  readonly id: FounderArchetype;
  /** Nameplate flavour title, e.g. "Hacker" in "Hacker · Series B". */
  readonly label: string;
  /** Signature prop id; pane 6 maps it to a held/worn mesh. */
  readonly prop: string;
  /** Starting outfit style theme the stage tier layers formality onto. */
  readonly style: string;
}

/** Order is STABLE — the appearance id encodes the archetype by its index here. Append, never reorder. */
export const FOUNDER_ARCHETYPES: readonly ArchetypeDef[] = Object.freeze([
  { id: 'hacker', label: 'Hacker', prop: 'laptop', style: 'hoodie' },
  { id: 'ai-researcher', label: 'AI Researcher', prop: 'lanyard-tote', style: 'lanyard' },
  { id: 'crypto', label: 'Crypto Founder', prop: 'hardware-wallet', style: 'fleece' },
  { id: 'deep-tech', label: 'Deep-Tech', prop: 'soldering-iron', style: 'work-jacket' },
  { id: 'design', label: 'Design Founder', prop: 'sketchbook', style: 'turtleneck' },
  { id: 'growth', label: 'Growth', prop: 'airpods', style: 'quarter-zip' },
  { id: 'biotech', label: 'Biotech', prop: 'lab-coat', style: 'lab-coat' },
  { id: 'climate', label: 'Climate', prop: 'bike', style: 'beanie' },
  { id: 'consumer', label: 'Consumer', prop: 'phone-gimbal', style: 'streetwear' },
  { id: 'ex-faang', label: 'Ex-FAANG PM', prop: 'company-swag', style: 'company-swag' },
  { id: 'dropout', label: 'Stanford Dropout', prop: 'varsity', style: 'varsity-tee' },
  { id: 'serial', label: 'Serial Founder', prop: 'coffee', style: 'blazer' },
] as const);

const ARCHETYPE_IDS: readonly FounderArchetype[] = FOUNDER_ARCHETYPES.map(a => a.id);
export function archetypeDef(id: FounderArchetype): ArchetypeDef {
  return FOUNDER_ARCHETYPES[Math.max(0, ARCHETYPE_IDS.indexOf(id))]!;
}

export interface LookTier {
  readonly index: number;            // 0..5
  readonly label: string;            // shown in the level-up toast
  readonly outfit: string;           // formality layer over the archetype style
  readonly car: string;              // default/unlocked vehicle
  readonly companion: string | null; // assistant / entourage NPC
  readonly flyover: string | null;   // ambient status flyover (jet/heli)
  /** The funding round id at which this tier unlocks; locked items show its label. */
  readonly unlockRoundId: string;
}

/** Bootstrapping → Hectocorn (founder spec). Six tiers layered over the archetype style. */
const LOOK_TIERS_V2: readonly LookTier[] = Object.freeze([
  { index: 0, label: 'Bootstrapping', outfit: 'hoodie', car: 'scooter', companion: null, flyover: null, unlockRoundId: 'bootstrapping' },
  { index: 1, label: 'Seed', outfit: 'vest-allbirds', car: 'commuter', companion: null, flyover: null, unlockRoundId: 'pre-seed' },
  { index: 2, label: 'Series A', outfit: 'blazer-watch', car: 'tesla', companion: null, flyover: null, unlockRoundId: 'series-a' },
  { index: 3, label: 'Series D', outfit: 'tailored-suit', car: 'sports', companion: null, flyover: null, unlockRoundId: 'series-d' },
  { index: 4, label: 'Unicorn', outfit: 'designer', car: 'supercar', companion: 'assistant', flyover: null, unlockRoundId: 'unicorn' },
  { index: 5, label: 'Decacorn', outfit: 'couture', car: 'chauffeur', companion: 'entourage', flyover: 'jet', unlockRoundId: 'decacorn' },
] as const);

/** Keep outfit/vehicle identities stable; v3's six stars each grant the matching tier. */
export const LOOK_TIERS: readonly LookTier[] = flags.economyV3
  ? Object.freeze(LOOK_TIERS_V2.map(tier => {
    const round = ECON_V3_ROUNDS.find(round => round.stars === tier.index)!;
    return { ...tier, label: round.label, unlockRoundId: round.id };
  }))
  : LOOK_TIERS_V2;

const roundIndexOf = (id: string) => FUNDING_ROUNDS_V2.findIndex(r => r.id === id);
const SERIES_A = roundIndexOf('series-a'), SERIES_D = roundIndexOf('series-d');
const UNICORN = roundIndexOf('unicorn'), DECACORN = roundIndexOf('decacorn');

/** The active look tier for a funding round (looks upgrade as the round rises). */
export function tierForRound(round: Pick<FundingRound, 'id'>): LookTier {
  if (flags.economyV3) {
    const star = ECON_V3_ROUNDS.find(stage => stage.id === round.id)?.stars ?? 0;
    return LOOK_TIERS[star] ?? LOOK_TIERS[0]!;
  }
  const i = roundIndexOf(round.id);
  if (i < 0) return LOOK_TIERS[0]!;
  if (i >= DECACORN) return LOOK_TIERS[5]!;
  if (i >= UNICORN) return LOOK_TIERS[4]!;
  if (i >= SERIES_D) return LOOK_TIERS[3]!;
  if (i >= SERIES_A) return LOOK_TIERS[2]!;
  if (round.id === 'pre-seed' || round.id === 'seed') return LOOK_TIERS[1]!;
  return LOOK_TIERS[0]!;
}
export function tierForCents(cents: string | bigint): LookTier { return tierForRound(fundingRound(cents)); }

/** True once the player's round reaches the tier; otherwise the UI shows tier.unlockRoundId's label. */
export function tierUnlocked(tierIndex: number, round: Pick<FundingRound, 'id'>): boolean {
  return tierForRound(round).index >= tierIndex;
}
export function unlockRoundLabel(tierIndex: number): string {
  const tier = LOOK_TIERS[Math.max(0, Math.min(LOOK_TIERS.length - 1, tierIndex))]!;
  return FUNDING_ROUNDS.find(r => r.id === tier.unlockRoundId)?.label ?? 'later';
}

/**
 * A player's chosen cosmetics. Variant fields are 0..7 indices into pane-6 catalogs (colour/style
 * pickers within the unlocked tier). `stageRound` is the FUNDING_ROUNDS index of the player's round,
 * carried so remotes render the right stage look from the id alone.
 */
export interface Appearance {
  readonly sex: AvatarSex;
  readonly archetype: FounderArchetype;
  readonly outfit: number;    // 0..7 colour/variant
  readonly hair: number;      // 0..7
  readonly hairColor: number; // 0..7
  readonly accessory: number; // 0..7
  readonly car: number;       // 0..7 vehicle colour/variant
  readonly stageRound: number; // FUNDING_ROUNDS index, 0..63
}

export function defaultAppearance(sex: AvatarSex = 'male', archetype: FounderArchetype = 'hacker'): Appearance {
  return { sex, archetype, outfit: 0, hair: 0, hairColor: 0, accessory: 0, car: 0, stageRound: 0 };
}

const v3 = (n: number) => (Math.trunc(Number.isFinite(n) ? n : 0) & 7);
const v6 = (n: number) => (Math.max(0, Math.min(63, Math.trunc(Number.isFinite(n) ? n : 0))));

/**
 * Pack an Appearance into one unsigned 26-bit int for the snapshot (fits a 32-bit field):
 * sex[0] archetype[1..4] outfit[5..7] hair[8..10] hairColor[11..13] accessory[14..16] car[17..19] stageRound[20..25].
 */
export function encodeAppearance(a: Appearance): number {
  const sex = a.sex === 'female' ? 1 : 0;
  const arch = Math.max(0, ARCHETYPE_IDS.indexOf(a.archetype)) & 0xF;
  return (sex
    | (arch << 1)
    | (v3(a.outfit) << 5)
    | (v3(a.hair) << 8)
    | (v3(a.hairColor) << 11)
    | (v3(a.accessory) << 14)
    | (v3(a.car) << 17)
    | (v6(a.stageRound) << 20)) >>> 0;
}

export function decodeAppearance(id: number): Appearance {
  const n = (id >>> 0);
  const arch = (n >>> 1) & 0xF;
  return {
    sex: (n & 1) ? 'female' : 'male',
    archetype: ARCHETYPE_IDS[arch] ?? 'hacker',
    outfit: (n >>> 5) & 7,
    hair: (n >>> 8) & 7,
    hairColor: (n >>> 11) & 7,
    accessory: (n >>> 14) & 7,
    car: (n >>> 17) & 7,
    stageRound: (n >>> 20) & 63,
  };
}

export interface ResolvedLook {
  readonly sex: AvatarSex;
  readonly archetype: ArchetypeDef;
  readonly tier: LookTier;
  readonly outfit: string;            // tier formality layer
  readonly outfitVariant: number;     // chosen colour/variant 0..7
  readonly hair: number;
  readonly hairColor: number;
  readonly accessory: number;
  readonly car: string;               // tier vehicle
  readonly carVariant: number;
  readonly companion: string | null;
  readonly flyover: string | null;
  readonly prop: string;              // archetype signature prop
  readonly title: string;             // archetype label, e.g. 'Hacker'
}

/** Combine a player's cosmetic choices with their funding round into the full renderable look. */
export function resolveLook(appearance: Appearance, round?: Pick<FundingRound, 'id'>): ResolvedLook {
  const archetype = archetypeDef(appearance.archetype);
  const effectiveRound = round ?? FUNDING_ROUNDS[Math.min(appearance.stageRound, FUNDING_ROUNDS.length - 1)] ?? FUNDING_ROUNDS[0]!;
  const tier = tierForRound(effectiveRound);
  return {
    sex: appearance.sex, archetype, tier,
    outfit: tier.outfit, outfitVariant: appearance.outfit,
    hair: appearance.hair, hairColor: appearance.hairColor, accessory: appearance.accessory,
    car: tier.car, carVariant: appearance.car,
    companion: tier.companion, flyover: tier.flyover,
    prop: archetype.prop, title: archetype.label,
  };
}

/** Nameplate flavour line, e.g. "Hacker · Series B" (archetype title + funding round label). */
export function nameplateTitle(appearance: Pick<Appearance, 'archetype'>, round: Pick<FundingRound, 'label'>): string {
  return `${archetypeDef(appearance.archetype).label} · ${round.label}`;
}
