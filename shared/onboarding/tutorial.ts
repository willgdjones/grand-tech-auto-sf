/**
 * First-visit tutorial mission model (PLAN-onboarding.md decision 3, gtasf-n34i). Pure data + geometry
 * shared by the client (drives mission text, markers, drive-through detection) and the worker (validates
 * the one-time Founder Orientation award — slice 3). Identity/character-creation happens between the
 * drive_ring payout and gps as its own onboarding step (pane-3 screen), so it is not a mission step here.
 */
import type { OnboardingStep } from './state';
import { FUNDING_ROUNDS } from '../funding';
import { flags } from '@gtasf/shared/flags';

/**
 * The tutorial-only "Founder Orientation" drive-through ring, ~85 m from the Ferry spawn
 * (LOCAL_SPAWN ≈ x 119687, z -122431 cm). Tutorial-only and pays once (server-validated). Position in
 * world centimetres, placed on the Embarcadero lane (tools/onboarding-ring-check.mjs); pane 6 still
 * drive-confirms it in the fresh-profile smoke and nudges it if the authored plaza differs.
 */
export const ORIENTATION_RING = { x: 117_437, y: 333, z: -130_431, radiusCm: 1_000 } as const; // ~83 m from spawn on the Embarcadero lane (slightly W of straight-N); drivable per tools/onboarding-ring-check.mjs. 10 m radius

/** Vertical tolerance for the ring (cm): matches the drive-through checkpoint height. */
export const ORIENTATION_RING_HEIGHT_CM = 600;

/** Step-1 marker on the open plaza: 25 m north and 10 m east of spawn (world cm).
 * East offset clears the parked-car corridor and lamp at the former centre. */
export const WALK_MARKER = { x: 120_687, y: 333, z: -124_931, radiusCm: 600 } as const;

/**
 * Server ledger identity of the one-time Orientation cheque. It rides the existing `event` credit
 * source (no schema change: funding_credits.source has a CHECK list) under a ref no real event id can
 * collide with, so UNIQUE(device,season,source,source_ref) makes it pay exactly once, ever.
 */
export const ORIENTATION_SOURCE_REF = 'tutorial:orientation';
export const ORIENTATION_LABEL = 'Founder Orientation';

/** Economy v3 Orientation cheque: one good live event (~$5k, under a tenth of the $75k Seed). The v3 ladder has
 *  no Pre-seed, and the old $500k fallback would have vaulted a brand-new player 6.7× past Seed. */
export const ORIENTATION_V3_CENTS = 500_000n;
/** v2: the Orientation cheque exactly closes Pre-seed, so the first big toast reads "PRE-SEED CLOSED". */
export function orientationAwardCents(): bigint {
  if (flags.economyV3) return ORIENTATION_V3_CENTS;
  const preSeed = FUNDING_ROUNDS.find(round => round.id === 'pre-seed');
  return preSeed ? BigInt(preSeed.thresholdCents) : 50_000_000n;
}

export type TutorialStepId = 'walk' | 'drive_ring' | 'gps' | 'taxi';

export interface TutorialStep {
  id: TutorialStepId;
  /** The onboarding state-machine step (shared/onboarding/state.ts) this mission step corresponds to. */
  step: OnboardingStep;
  /** The big SA mission banner. */
  objective: string;
  /** The supporting instruction line. */
  hint: string;
}

/** The first-visit mission, in order. (intro, identity and done are onboarding steps, not mission steps.) */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'walk', step: 'walk', objective: 'GET MOVING', hint: 'Reach the gold marker to continue. Optional: Shift to sprint, G for your scooter.' },
  { id: 'drive_ring', step: 'drive_ring', objective: 'FOUNDER ORIENTATION', hint: 'Get in a car and DRIVE through the gold ring — walking through it won’t collect.' },
  { id: 'gps', step: 'gps', objective: 'SET YOUR GPS', hint: 'Press M and pick the nearest event to route to it.' },
  { id: 'taxi', step: 'taxi', objective: 'CATCH A RIDE', hint: 'Press H for a robotaxi, then walk through the event ring to collect — rides pay nothing, arriving does.' },
];

/** Whether a world position (centimetres) is inside the Orientation ring (drive-through detection). */
export function insideOrientationRing(x: number, z: number, y?: number): boolean {
  if (y !== undefined && Math.abs(y - ORIENTATION_RING.y) > ORIENTATION_RING_HEIGHT_CM) return false;
  return Math.hypot(x - ORIENTATION_RING.x, z - ORIENTATION_RING.z) <= ORIENTATION_RING.radiusCm;
}

/** Whether a world position (centimetres) has reached the step-1 walk marker. */
export function atWalkMarker(x: number, z: number): boolean {
  return Math.hypot(x - WALK_MARKER.x, z - WALK_MARKER.z) <= WALK_MARKER.radiusCm;
}

/** The mission step for an onboarding step, or undefined if that step has no mission beat. */
export function tutorialStepFor(step: OnboardingStep): TutorialStep | undefined {
  return TUTORIAL_STEPS.find(s => s.step === step);
}
