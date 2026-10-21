/**
 * Tutorial mission driver (PLAN-onboarding.md decision 3, gtasf-n34i). Turns raw per-frame game signals
 * into the flow's step clears so main.ts only feeds one frame object:
 *   1. walk       — reach the gold marker; sprint and scooter are optional hints;
 *   2. drive_ring — DRIVE through the Founder Orientation ring; cleared by the server-validated award
 *                   (local fallback when the funding loop is offline so the tutorial never dead-ends);
 *   3. gps        — choose a destination on the map (M);
 *   4. taxi       — collect a real event payout after the robotaxi ride ("rides don't pay, arriving does").
 * Pure apart from the injected flow, so it is unit-testable without DOM or three.js.
 */
import { atWalkMarker, insideOrientationRing, ORIENTATION_RING, ORIENTATION_SOURCE_REF, WALK_MARKER } from '@gtasf/shared/onboarding/tutorial';
import type { OnboardingStep } from '@gtasf/shared/onboarding/state';
import type { OnboardingFlow } from './flow';

/** One frame of game state, in metres (main.ts's foot/car pose). */
export interface TutorialFrame {
  mode: string;            // 'on-foot' | 'driver' | 'passenger'
  x: number; y: number; z: number;
  speed: number;           // m/s on foot
  running: boolean;        // sprint held
  riding: boolean;         // on a personal ride (scooter)
  scooterAvailable: boolean;
  /** The funding loop is live, so the server award will clear drive_ring. */
  fundingOnline: boolean;
  now: number;             // ms
}

export interface WalkProgress { marker: boolean; sprint: boolean; scooter: boolean }

/** Grace period after driving through the ring for the server award before the UI advances anyway. */
export const ORIENTATION_FALLBACK_MS = 8000;

const tick = (done: boolean) => (done ? '✓' : '○');

/** The step-1 goal plus optional movement tips shown under "GET MOVING". */
export function walkObjective(p: WalkProgress, scooterAvailable: boolean, isTouch: boolean): string {
  const tips = [isTouch ? 'push the stick fully to sprint' : 'Shift to sprint'];
  if (scooterAvailable) tips.push(isTouch ? 'tap Ride for your scooter' : 'G for your scooter');
  return `${tick(p.marker)} Reach the gold marker to continue · Optional: ${tips.join(' · ')}`;
}
export function walkDone(p: WalkProgress): boolean {
  return p.marker;
}

/** Shown the instant a player walks INTO the orientation ring on foot. The credit is drive-only, so a foot crossing
 *  is a silent no-op that reads as a dead end (the first-earn funnel drop). Name why + exactly what to do. */
export function onFootInRingObjective(isTouch: boolean): string {
  const enter = isTouch ? 'tap Enter next to a car' : 'press E next to a car';
  return `Walking won't collect — ${enter}, then DRIVE through the gold ring for your first funding.`;
}

/** World target (metres) for the beacon + edge arrow at each step, or null (GPS line takes over). */
export function tutorialTarget(step: OnboardingStep): { x: number; y: number; z: number; radius: number } | null {
  const point = step === 'walk' ? WALK_MARKER : step === 'drive_ring' ? ORIENTATION_RING : null;
  return point ? { x: point.x / 100, y: point.y / 100, z: point.z / 100, radius: point.radiusCm / 100 } : null;
}

export interface TutorialDriver {
  update(frame: TutorialFrame): void;
  /** Route a funding award; returns 'orientation' for the tutorial cheque (main.ts must not treat it as
   *  an event collect), 'event' for anything else. */
  onAward(eventId: string | undefined): 'orientation' | 'event';
  /** The player picked a map/V destination. */
  destinationSelected(): void;
  readonly walk: Readonly<WalkProgress>;
}

export function createTutorialDriver(deps: { flow: Pick<OnboardingFlow, 'state' | 'stepCleared' | 'updateObjective'>; isTouch: boolean }): TutorialDriver {
  const { flow } = deps;
  const walk: WalkProgress = { marker: false, sprint: false, scooter: false };
  let ringEnteredAt: number | null = null;
  let warnedOnFoot = false;
  let previousStep: OnboardingStep | null = null;

  function update(f: TutorialFrame): void {
    const step = flow.state.completed ? 'done' : flow.state.step;
    // Replay resets the flow but reuses this driver. A new walk step needs new actions,
    // while consecutive frames in that step keep the checklist progress already earned.
    if (step === 'walk' && previousStep !== 'walk') {
      walk.marker = false; walk.sprint = false; walk.scooter = false;
    }
    previousStep = step;
    if (step !== 'drive_ring') { ringEnteredAt = null; warnedOnFoot = false; }
    const cx = f.x * 100, cz = f.z * 100;
    if (step === 'walk') {
      if (f.mode === 'on-foot') {
        if (atWalkMarker(cx, cz)) walk.marker = true;
        if (f.running && f.speed > 0.5 && !f.riding) walk.sprint = true;
        if (f.riding) walk.scooter = true;
      }
      if (walkDone(walk)) flow.stepCleared('walk');
      else flow.updateObjective(walkObjective(walk, f.scooterAvailable, deps.isTouch));
      return;
    }
    if (step === 'drive_ring') {
      const inRing = insideOrientationRing(cx, cz, f.y * 100);
      // First-earn fix: the ring credit is DRIVE-only (server orientationQualifies), so a player who follows the
      // beacon and walks through it on foot gets a silent no-op — the top funnel drop (only ~1% of founders reach
      // the first earn). The moment a foot player is in the ring, say why + exactly what to do (once per step),
      // instead of leaving a dead end that reads as "nothing happened".
      if (inRing && f.mode !== 'driver') {
        if (!warnedOnFoot) { warnedOnFoot = true; flow.updateObjective(onFootInRingObjective(deps.isTouch)); }
        return;
      }
      const inside = f.mode === 'driver' && inRing;
      if (inside) ringEnteredAt ??= f.now;
      if (ringEnteredAt === null) return;
      // Offline/dev funding: nothing will pay, so clear locally. Online: the award clears it; if the
      // award is slow (D1 hiccup) the step still clears after the crossing, wherever the player drove.
      // This advances only tutorial UI; the server still owns the once-ever cheque.
      if (!f.fundingOnline || f.now - ringEnteredAt >= ORIENTATION_FALLBACK_MS) flow.stepCleared('drive_ring');
    }
  }

  return {
    update,
    onAward(eventId) {
      if (eventId === ORIENTATION_SOURCE_REF) { flow.stepCleared('drive_ring'); return 'orientation'; }
      if (eventId) flow.stepCleared('taxi'); // a real event collected after the ride
      return 'event';
    },
    destinationSelected() { flow.stepCleared('gps'); },
    get walk() { return walk; },
  };
}
