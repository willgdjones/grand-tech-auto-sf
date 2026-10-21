/**
 * Founder-ladder controller (docs/PLAN-founder-ladder.md phase 1). Orchestrates the one-obvious-path
 * spine: spawn → found your startup → your startup on an Embarcadero billboard → share card → the
 * valuation score. It takes over onboarding only for NEW devices in the `ladder` A/B bucket while the
 * `founderLadder` flag is on; otherwise it returns inactive and main.ts runs the current onboarding.
 *
 * Phase 1 has no pitch yet, so the valuation stays $0 and the HUD lock is released after the intro so
 * a ladder player drops into the full game rather than a stranded empty HUD (phase 2 adds the first
 * pitch → first non-zero valuation, and re-tightens the reveal schedule through Seed).
 *
 * Everything is gated here; with the flag off this module is never mounted and the build is inert.
 */
import { flags } from '@gtasf/shared/flags';
import { fundingDay } from '@gtasf/shared/funding';
import {
  freshFounderSession, parseFounderSession, serializeFounderSession, type FounderLadderSession,
} from '@gtasf/shared/founder/ladder';
import { loadOnboardingState } from '../onboarding/api';
import { assignBucket, type FounderBucket } from './bucket';
import { rollNickname } from './rollName';
import { applyFounderLock, releaseFounderLock, setFounderLockDrive, setFounderReveal } from './hudLock';
import { createQuestCard, type QuestCard } from './questCard';
import { createFoundCard, type FoundCard } from './foundCard';
import { createShareCard, type ShareCard } from './shareCard';
import { createPitchCard, type PitchAttempt, type PitchCard, type PitchResult } from './pitchCard';
import { createPitchConversation, type PitchConversation } from './pitchConversation';
import { FOUNDER_PLAZA_VC_NAME, FOUNDER_SEED_VC_NAME } from '@gtasf/shared/founder/pitch';
import { createValuationHud, type ValuationHud } from './valuationHud';
import './ladder.css';

const SESSION_KEY = 'gtasf.founder.v1';

export interface FounderLadderDeps {
  isTouch: boolean;
  /**
   * Persist the chosen startup name to the funding profile. `fallbackNickname` is a generated handle
   * to use only if the profile has none yet (profiles mint one at creation, so it rarely applies).
   */
  saveStartup(startupName: string, fallbackNickname: string): Promise<void> | void;
  /**
   * Swing the camera to the player's Embarcadero billboard and render their startup on it (billboard
   * slice). Resolves once the billboard is in view. Omitted until that slice lands — the quest card
   * then just reports the startup is up on the Embarcadero.
   */
  showBillboard?(startup: { name: string }): Promise<void> | void;
  /**
   * Copy a gtasf.com deep link that spawns a visitor in front of the billboard (reuses ?at=). Returns
   * the copied link so the share card can show it. Omitted → no share step.
   */
  copyShareLink?(): Promise<string>;
  /**
   * Resolve the same deep link WITHOUT copying, to pre-fill the share card's "Share on X" compose
   * intent (the player posts from their own account). Omitted → the share card hides the X button.
   */
  shareUrl?(): Promise<string>;
  /** The real in-world billboard render captured during the swing (dataURL), for the share image. */
  billboardShot?(): string | null;
  /**
   * Phase 2 — the first pitch: send a curated tap-line INDEX to the server; resolves with the judged
   * result (score, the VC's verdict, the cheque) or null on failure. The caller also updates the funding
   * HUD so the valuation pill reveals (now non-zero / Pre-seed). Omitted → no pitch step.
   */
  pitchStartup?(lineIndex: number): Promise<PitchAttempt>;
  /**
   * Phase 3 — the Seed quest: hail a robotaxi that swoops the player to the First Round VC office and
   * resolve once they've arrived (rejects/throws if the ride can't be hailed). Omitted → no Seed step
   * (the controller drops into the game after Pre-seed, as in phase 2).
   */
  hailToVcOffice?(onRiding?: () => void): Promise<void>;
  /** gtasf-5fq7n: whether the world socket is up right now (a hail on a down socket waits for the reconnect). */
  isConnected?(): boolean;
  /**
   * Phase 3 — the Seed pitch at the VC office: same as pitchStartup but targets the Seed firm (sends its
   * vcId to the server). Resolves with the judged result or null. Omitted → no Seed step.
   */
  pitchSeed?(lineIndex: number): Promise<PitchAttempt>;
  /** GTA-pivot hand-off after Seed: open the jobs phone (missions). Omitted → the card just hands over the city. */
  openJobs?(): void;
  /** actionOpening (critique #13): the profile's generated startup name, so the first run skips the naming modal (the
   *  player can rename any time in Game options). Null/omitted → the Found card as before. */
  defaultStartupName?(): string | null;
  /** openingDrive (critique #13): this new player spawned in the opening car on the Embarcadero, so the Pre-seed step
   *  starts as a DRIVE to the Pear VC partner (GPS) before the walk-up conversation. */
  openingDrive?: boolean;
  /** guidedOpener (gtasf-dzrrn): the partner waits a DRIVE away (down the Embarcadero), so an un-reached partner is
   *  always a GPS drive, never "walk over". `pearWhere` names the spot in the quest line. */
  pearFar?: boolean;
  pearWhere?: string;
  /** guidedOpener: the ~20 s skippable move → car → drive tutorial, run once per device before the first walk-up.
   *  `start` resolves 'arrived' at the partner or 'skipped' (then the normal GPS drive takes over). */
  guidedOpener?: { pending(): boolean; start(onDone: (how: 'arrived' | 'skipped') => void): void };
  /** actionOpening: where the pitches happen (world metres), for the GPS + the arrival check. */
  places?: { pear(): { x: number; z: number } | null; seed(): { x: number; z: number } | null };
  /** actionOpening: point the GPS (minimap route + world guidance) at a place, or clear it. */
  route?(dest: { x: number; z: number; title: string } | null): void;
  /** Turn the on-foot player + camera toward a point (the walk-up partner: after the billboard swing they faced away). */
  facePoint?(point: { x: number; z: number }): void;
  /** Fired once per new device when the A/B bucket is assigned (both buckets — the funnel denominator). */
  onBucket?(info: { bucket: FounderBucket }): void;
  /** Fired when the player founds their startup (ladder bucket). `opening` tags the actionOpening funnel (review M4). */
  onFounded?(info: { bucket: FounderBucket; opening: 'action' | 'classic' }): void;
  /** Fired once when the billboard first comes into view, with ms since this session joined (analytics). */
  onBillboardSeen?(info: { msSinceJoin: number; bucket: FounderBucket; opening: 'action' | 'classic' }): void;
  /** Opening funnel beat (analytics 'opening_step'), fired once per session per step. */
  onOpeningStep?(info: { step: string; msSinceJoin: number }): void;
  parent?: HTMLElement;
  fetcher?: typeof fetch;
  /** Injectable for tests. */
  rng?: () => number;
}

export interface FounderLadder {
  /** Whether the founder ladder took over onboarding for this device. */
  readonly active: boolean;
  /** The A/B bucket assigned to this new device (null when not a bucketed new player). */
  readonly bucket: FounderBucket | null;
  /** True while the found-your-startup modal is open (main.ts folds this into hasModal). */
  readonly modalOpen: boolean;
  /** Feed the current valuation (cents) so the score pill reveals on the first non-zero value. */
  setValuation(cents: string | bigint): void;
  /** True when a free-roam Pre-seed pitch should be offered (ladder+pitching on, pitch wired, not yet closed) —
   *  main.ts uses it to gate the plaza-investor E-interaction + the minimap nudge marker. */
  readonly preSeedPitchEligible: boolean;
  /** Open the Pre-seed pitch card at the Pear VC plaza investor (main.ts calls this from the E-interaction);
   *  no-op when not eligible. */
  preSeedPitch(): void;
  /** actionOpening: per frame, the player's position (metres) — detects arriving at the Seed office. */
  update(player: { readonly x: number; readonly z: number }): void;
  /** actionOpening: E near the Seed office while the Seed meeting is pending opens the conversation. True = consumed. */
  interact(player: { readonly x: number; readonly z: number }): boolean;
  /** Phase 6 surfacing: the Series A Demo Day quest is open (held Seed + new SF day) — show it on the quest card with a
   *  route. False when another ladder step owns the card (nothing shown). */
  offerSeriesA(go: () => void): boolean;
  /** Critic N39: a job went live. The SEED CLOSED 'Find a job' handover has done its work, so it steps aside instead of
   *  sitting over the objective (it only hid via its own CTA; a job started from the phone, a call or a giver left it up).
   *  Any other card (e.g. Pre-seed's 'Pitch now' for a player who took a job first) also steps aside, and comes back on
   *  jobEnded(). */
  jobStarted(): void;
  jobEnded(): void;
  /** Critic N42: a centre-slot moment (a payout card, RANK UP, MISSION PASSED, STORE ROBBED) is on screen: the quest card steps
   *  aside for it (true) and comes back after (false). main.ts calls it each frame with centerSlot.busy. */
  centerHold(on: boolean): void;
  destroy(): void;
}

function loadSession(): FounderLadderSession {
  try { return parseFounderSession(localStorage.getItem(SESSION_KEY)); } catch { return freshFounderSession(); }
}
/** Read the persisted founder-ladder session from OUTSIDE the controller. Needed because the controller only
 *  mounts on a device's first run (returning players get the normal game), yet the free-roam Series A quest —
 *  which fires for returning players who closed Seed — must read `lastRoundCloseDay` to pace itself. */
export function loadFounderSession(): FounderLadderSession {
  return loadSession();
}
function saveSession(session: FounderLadderSession): void {
  try { localStorage.setItem(SESSION_KEY, serializeFounderSession(session)); } catch { /* best effort */ }
}

const inactive: FounderLadder = {
  active: false, bucket: null, modalOpen: false, setValuation() {}, preSeedPitchEligible: false, preSeedPitch() {}, update() {}, interact: () => false, offerSeriesA: () => false, jobStarted() {}, jobEnded() {}, centerHold() {}, destroy() {},
};

/**
 * Decide the A/B and, when active, run the founder-ladder spine. Call once after the HUD exists,
 * exactly where main.ts would otherwise call setupOnboarding. When it returns `active: false`, the
 * caller runs the current onboarding as before.
 */
export async function mountFounderLadder(deps: FounderLadderDeps): Promise<FounderLadder> {
  if (!flags.founderLadder || !flags.hud) return inactive;

  // The A/B is over (founder 2026-10-13): EVERYONE gets the ladder, returning players included. A returning
  // player (completed onboarding, so they already named a startup through the normal flow) is treated as
  // already-founded below, so they skip the first-run found/billboard/share spine and drop straight into the
  // game with the ladder active (crown + the free-roam quests/missions).
  let returning = false;
  try { returning = (await loadOnboardingState(deps.fetcher ?? fetch))?.completed === true; } catch { /* treat as new */ }

  const bucket = assignBucket(deps.rng);
  deps.onBucket?.({ bucket }); // funnel denominator: a new device entered the experiment in either bucket
  if (bucket === 'control') return { active: false, bucket, modalOpen: false, setValuation() {}, preSeedPitchEligible: false, preSeedPitch() {}, update() {}, interact: () => false, offerSeriesA: () => false, jobStarted() {}, jobEnded() {}, centerHold() {}, destroy() {} };

  // Active: the founder ladder owns this device's first run.
  const parent = deps.parent ?? document.body;
  const joinAt = performance.now();
  const beats = new Set<string>();
  /** Funnel: each opening beat once per session (analytics 'opening_step'). */
  const beat = (step: string) => { if (beats.has(step)) return; beats.add(step); deps.onOpeningStep?.({ step, msSinceJoin: performance.now() - joinAt }); };
  let session = loadSession();
  let disposed = false;

  applyFounderLock(parent === document.body ? document.body : parent);
  const quest: QuestCard = createQuestCard(parent);
  let seedHandover = false; // the card is showing the SEED CLOSED 'Find a job' handover (critic N39)
  let yieldedToJob = false; // another card stepped aside for a live job; shown again when it ends
  let heldForCenter = false; // the card stepped aside for a centre-slot moment (N42)
  const valuation: ValuationHud = createValuationHud(parent);
  let foundCard: FoundCard | null = null;
  let shareCard: ShareCard | null = null;
  let pitchCard: PitchCard | null = null;
  let seedPitchCard: PitchCard | null = null;
  let preSeedCard: PitchCard | null = null;
  // actionOpening (critique #13): the pitches are in-world conversations, the Seed step is a drive.
  const action = flags.actionOpening;
  let preSeedTalk: PitchConversation | null = null, seedTalk: PitchConversation | null = null;
  const talkOrigin = new Map<PitchConversation, { x: number; z: number }>();
  const TALK_LEAVE_M = 8;
  let seedPending: { name: string; arrived: boolean } | null = null;
  const SEED_ARRIVE_M = 40; // review M3: generous, so a car on the nearest road still 'arrives'
  // openingDrive: the Pre-seed drive to the plaza partner is pending until the player is within PEAR_ARRIVE_M (the plaza
  // sits back from the Embarcadero roadway, so a car at the kerb arrives; the pitch itself still needs the walk-up).
  let pearDrive: { name: string } | null = null, pearReached = false;
  // walkUpPitch: armed once the walk-up is offered (spine or returning card); fires on entering 5 m, re-arms beyond 12 m.
  let walkUpReady = false, walkUpArmed = true;
  const WALKUP_OPEN_M = 5, WALKUP_REARM_M = 12;
  const PEAR_ARRIVE_M = 70;
  let openerRunning = false;
  /** guidedOpener: run the tutorial, then continue the Pre-seed step (arrived → walk-up; skipped → GPS drive). */
  function runOpener(name: string): void {
    openerRunning = true; beat('opener_start'); quest.hide();
    setFounderLockDrive(true, parent === document.body ? document.body : parent); // the 'E · Get in and drive' prompt shows
    deps.guidedOpener!.start(how => {
      openerRunning = false;
      if (disposed) return;
      beat(how === 'arrived' ? 'opener_done' : 'opener_skipped');
      if (how === 'arrived') { pearReached = true; beat('pear_arrived'); }
      pitchStep(name);
    });
  }

  /** A ladder player has "closed Pre-seed" once the first (Pear VC plaza investor) pitch cheques. */
  function preSeedEligible(): boolean {
    return flags.founderLadder && flags.pitching && Boolean(deps.pitchStartup) && !session.preSeedClosed;
  }
  function markPreSeedClosed(): void {
    if (session.preSeedClosed) return;
    session = { ...session, preSeedClosed: true }; saveSession(session);
  }
  /** Open the Pre-seed pitch card against the Pear VC plaza investor — the free-roam entry for returning players
   *  + main.ts's E-interaction at the investor. Reuses the ladder pitch (deps.pitchStartup = postFounderPitch,
   *  no vcId). No-op when ineligible (flag off / already closed). */
  function openPreSeedPitch(): void {
    if (!preSeedEligible()) return;
    const pitch = deps.pitchStartup!;
    if (action) {
      preSeedTalk ??= createPitchConversation({ parent, who: `A partner at ${FOUNDER_PLAZA_VC_NAME}`, roundLabel: 'PRE-SEED', onPitch: index => { beat('pitch_sent'); return pitch(index); },
        reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        // Same continuation as the card: a credited close (or the new-player spine either way) moves on to the Seed drive.
        onDone: result => { if (result?.credited) { beat('preseed_cheque'); markPreSeedClosed(); } if (result?.credited || !session.preSeedClosed) seedStep(session.startupName || 'your startup'); } });
      beat('convo_open'); preSeedTalk.show();
      return;
    }
    if (!preSeedCard) preSeedCard = createPitchCard({ parent, vcName: FOUNDER_PLAZA_VC_NAME, kicker: 'PRE-SEED', roundLabel: 'PRE-SEED', onPitch: pitch,
      // On a credited Pre-seed close, route returning players into the Seed quest (robotaxi → First Round → Seed
      // pitch), exactly like the new-player spine's pitchStep → seedStep, so they don't dead-end at Pre-seed.
      onDone: result => { if (result?.credited) { markPreSeedClosed(); seedStep(session.startupName || 'your startup'); } } });
    preSeedCard.show();
  }

  /** Phase 2 — the first pitch: a real VC firm partner wants your pitch. Tap a line → cheque → Pre-seed
   *  (the valuation pill reveals via the funding HUD update), then on to the Seed quest. */
  function pitchStep(name: string): void {
    if (!deps.pitchStartup) { intoGame(); return; }
    if (openerRunning) return;
    if (action && deps.guidedOpener?.pending() && pearDrive === null && !pearReached) { runOpener(name); return; }
    if (action && (deps.openingDrive || deps.pearFar) && pearDrive === null && !pearReached) {
      // openingDrive (critique #13): the player starts in a car ~0.5 km down the Embarcadero — drive to the partner first.
      // The car prompt shows through the lock (as on the Seed drive); arriving hands over to the walk-up below.
      pearDrive = { name }; beat('pear_drive');
      setFounderLockDrive(true, parent === document.body ? document.body : parent);
      const pear = deps.places?.pear();
      if (pear) deps.route?.({ ...pear, title: FOUNDER_PLAZA_VC_NAME });
      quest.set({ kicker: 'PRE-SEED', title: `Drive to ${FOUNDER_PLAZA_VC_NAME} ${deps.pearWhere ?? 'at the Ferry Building'}. A partner wants your pitch.` });
      quest.show();
      return;
    }
    if (action) {
      // In-world: walk up to the partner on the plaza and press E (main.ts routes E there to preSeedPitch()).
      // No GPS here: the partner stands a few metres from the spawn (a route beam would sit on them).
      const key = deps.isTouch ? 'tap Enter / exit' : 'press E';
      beat('pear_prompt'); walkUpReady = true;
      // #6.27 phone frame: after the billboard swing the camera faced downtown and the partner was out of view — face them.
      const pear = deps.places?.pear(); if (pear) deps.facePoint?.(pear);
      // walkUpPitch (critic 14:40 PT 10-15): the conversation opens on walking up, so the card must not ask for a key press.
      quest.set({ kicker: 'PRE-SEED', title: flags.walkUpPitch
        ? (pearReached ? `You made it. Get out and walk over to the ${FOUNDER_PLAZA_VC_NAME} partner.`
          : `A partner at ${FOUNDER_PLAZA_VC_NAME} wants your pitch. Walk over to them.`)
        : pearReached
          ? `You made it. Get out, walk over to the ${FOUNDER_PLAZA_VC_NAME} partner and ${key}.`
          : `A partner at ${FOUNDER_PLAZA_VC_NAME} wants your pitch. Walk over and ${key}.`,
        cta: 'Pitch now', onCta: openPreSeedPitch });
      quest.show();
      return;
    }
    const pitch = deps.pitchStartup;
    quest.set({ kicker: 'PRE-SEED', title: `A partner at ${FOUNDER_PLAZA_VC_NAME} wants your pitch.`, cta: 'Pitch now',
      onCta: () => pitchCard?.show() });
    quest.show();
    pitchCard = createPitchCard({ parent, vcName: FOUNDER_PLAZA_VC_NAME, onPitch: pitch,
      onDone: result => {
        if (result?.credited) { markPreSeedClosed(); quest.set({ kicker: 'PRE-SEED', title: `${name} just closed Pre-seed.` }); }
        seedStep(name);
      } });
  }

  /** Phase 3 — the Seed round: a partner at First Round wants a meeting → robotaxi swoop to their office →
   *  pitch → Seed. The HUD lock stays on through Pre-seed AND this quest (radio/map/stars/OUTBID hidden);
   *  it releases into free roam only once Seed closes. Not wired (hail/pitchSeed absent) → drop into the
   *  game after Pre-seed, exactly as phase 2 did. */
  /** The Seed close (credited or not) — shared by the card and the conversation so both behave identically. */
  function seedDone(result: PitchResult | null): void {
    deps.route?.(null);
    // The server floors the Seed pitch to the Seed valuation threshold, so a credited Seed pitch
    // genuinely closes Seed (round + pill + stars all read Seed). Seed unlocks the radio/map/free
    // roam (PLAN), so release the lock NOW; then end the first-visit spine on a reason to return
    // (PLAN "ends with a reason to return") — the Seed cheque already celebrated the close,
    // so this points at the next rung and hands the city over on an explicit tap.
    intoGame(); // Seed unlock: release the HUD lock into free roam.
    if (result?.credited) {
      // Record the SF day Seed closed so the Series A round quest opens on the NEXT SF day, not today
      // (seriesAQuestReady / founderRoundQuestReady read this; phase 6 reads it in the free-roam gate).
      session = { ...session, lastRoundCloseDay: fundingDay(Date.now()) };
      saveSession(session);
      // Point the "grow your valuation" day at real things to do: the jobs phone when missions are on.
      quest.set({ kicker: 'SEED CLOSED', title: 'Series A opens tomorrow. Grow your valuation.',
        cta: deps.openJobs ? 'Find a job' : 'Explore San Francisco',
        onCta: () => { seedHandover = false; quest.hide(); deps.openJobs?.(); } });
      quest.show(); seedHandover = true;
    } else quest.hide(); // no cheque (cooldown/failure): just hand over the city, no false "closed Seed".
  }
  /** actionOpening: at the Seed office — the meeting is a conversation, opened with E. */
  function seedArrived(name: string): void {
    if (!seedPending) return;
    beat('seed_arrived');
    seedPending.arrived = true;
    deps.route?.(null); // arrived: drop the destination beam before the meeting
    quest.set({ kicker: 'SEED ROUND', title: `You made it. Pitch the partner at ${FOUNDER_SEED_VC_NAME} — ${deps.isTouch ? 'tap Enter / exit' : 'press E'}.`,
      cta: 'Pitch now', onCta: () => openSeedTalk(name) });
    quest.show();
  }
  function openSeedTalk(name: string): void {
    if (!deps.pitchSeed) return;
    const seedPitch = deps.pitchSeed;
    seedTalk ??= createPitchConversation({ parent, who: `A partner at ${FOUNDER_SEED_VC_NAME}`, roundLabel: 'SEED', onPitch: seedPitch,
      reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      onDone: result => { if (result?.credited) beat('seed_cheque'); seedPending = null; setFounderLockDrive(false, parent === document.body ? document.body : parent); seedDone(result); } });
    void name; beat('seed_convo'); seedTalk.show();
  }
  function seedStep(name: string): void {
    if (!deps.hailToVcOffice || !deps.pitchSeed) { intoGame(); return; }
    const hail = deps.hailToVcOffice, pitch = deps.pitchSeed;
    if (action) {
      // Critique #13: the Seed step is a DRIVE (take any car — E — or ride with H); the meeting starts on arrival.
      const office = deps.places?.seed();
      seedPending = { name, arrived: false }; beat('seed_drive');
      setFounderLockDrive(true, parent === document.body ? document.body : parent); // review M1: the car prompt shows
      if (office) deps.route?.({ ...office, title: FOUNDER_SEED_VC_NAME });
      quest.set({ kicker: 'SEED ROUND', title: `A partner at ${FOUNDER_SEED_VC_NAME} wants a meeting. ${deps.isTouch ? 'Tap Enter / exit' : 'Press E'} at any car and drive there.`,
        cta: 'Or hail a robotaxi', onCta: () => {
          // gtasf-5fq7n: on a down world socket the hail waits for the reconnect (main.ts, <= 10 s) — say so, not 'no robotaxi'.
          const riding = () => { if (!disposed && seedPending) quest.set({ kicker: 'SEED ROUND', title: `Your robotaxi to ${FOUNDER_SEED_VC_NAME} is on the way…` }); };
          if (deps.isConnected && !deps.isConnected()) quest.set({ kicker: 'SEED ROUND', title: 'Reconnecting to the city…' });
          else riding();
          void Promise.resolve(hail(riding)).then(() => { if (!disposed && seedPending) seedArrived(name); }).catch((error: unknown) => {
            if (disposed || !seedPending) return; // review LOW: a late failure after Seed closed must not re-open it
            // Never a silent reset: say the ride failed (the connection, not the fleet, when that's why), keep the drive (GPS
            // stays on First Round) and offer the ride again.
            const offline = error instanceof Error && error.message === 'offline';
            quest.set({ kicker: 'SEED ROUND', title: offline ? `Can't reach the city right now — grab a car and drive to ${FOUNDER_SEED_VC_NAME}.` : `No robotaxi right now — grab a car and drive to ${FOUNDER_SEED_VC_NAME}.`,
              cta: 'Try the robotaxi again', onCta: () => seedStep(name) });
          });
        } });
      quest.show();
      return;
    }
    quest.set({ kicker: 'SEED ROUND', title: `A partner at ${FOUNDER_SEED_VC_NAME} wants a meeting.`, cta: 'Hail a robotaxi',
      onCta: () => {
        quest.set({ kicker: 'SEED ROUND', title: `Your robotaxi to ${FOUNDER_SEED_VC_NAME} is on the way…` });
        void Promise.resolve(hail()).then(() => {
          if (disposed) return;
          quest.set({ kicker: 'SEED ROUND', title: `Pitch the partner at ${FOUNDER_SEED_VC_NAME}.`, cta: 'Pitch now',
            onCta: () => seedPitchCard?.show() });
          seedPitchCard = createPitchCard({ parent, vcName: FOUNDER_SEED_VC_NAME, kicker: 'THE SEED ROUND', roundLabel: 'SEED', onPitch: pitch,
            onDone: seedDone });
        }).catch(() => {
          if (disposed) return;
          // Never a dead end: the card used to stop here with no button, so a failed hail lost the Seed quest
          // for the session. Hand over the city AND offer the hail again.
          quest.set({ kicker: 'SEED ROUND', title: `Couldn't reach ${FOUNDER_SEED_VC_NAME} — dropped into the city.`,
            cta: 'Try again', onCta: () => seedStep(name) });
          intoGame();
        });
      } });
    quest.show();
  }

  /** Once the startup is up: the first-earn PITCH is the GUARANTEED next step. The share is an optional viral
   *  moment and must NEVER gate it — the funnel drop (first-earn fix) was that founders who skipped the
   *  "Share your billboard" card never reached the pitch, so ~95% stayed at $0 Bootstrapping and pitch:vc:pear
   *  recorded 0 in prod. So we offer the share card once (dismissible, non-blocking) and go straight to the
   *  pitch quest regardless of whether they share. */
  function shareStep(name: string): void {
    if (deps.copyShareLink && !action) { // actionOpening: no share card in the first minute (sharing stays in the menu)
      shareCard = createShareCard({ parent, name, copyLink: deps.copyShareLink, shareUrl: deps.shareUrl,
        onClose: () => {}, imageUrl: deps.billboardShot?.() ?? null });
      shareCard.show(); // one-time viral moment; the pitch quest below is NOT gated on closing it
    }
    pitchStep(name);
  }

  function billboardStep(name: string): void {
    if (!deps.showBillboard) { shareStep(name); return; }
    quest.set({ kicker: 'YOUR STARTUP', title: `${name} is going up on the Embarcadero…` });
    quest.show();
    const body = parent === document.body ? document.body : parent;
    if (action) setFounderReveal(true, body);
    void Promise.resolve(deps.showBillboard({ name })).finally(() => setFounderReveal(false, body)).then(() => {
      if (disposed) return;
      if (!session.billboardSeen) {
        session = { ...session, billboardSeen: true };
        saveSession(session);
        deps.onBillboardSeen?.({ msSinceJoin: performance.now() - joinAt, bucket, opening: action ? 'action' : 'classic' });
      }
      shareStep(name);
    }).catch(() => shareStep(name));
  }

  /** Ladder end: release the HUD lock into the full game. Phase 1 released after the intro; phases 2–3
   *  keep the lock through the first pitch and the Seed quest, releasing only once Seed closes. */
  function intoGame(): void {
    if (disposed) return;
    releaseFounderLock(parent === document.body ? document.body : parent);
  }

  /** actionOpening (review H1): the profile ALREADY holds the generated name, so the save is best-effort — retry once,
   *  then carry on regardless. A failed save must never strand a brand-new player under the HUD lock. */
  async function autoFound(name: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await deps.saveStartup(name, rollNickname(deps.rng)); break; }
      catch { if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1500)); }
      if (disposed) return;
    }
    if (disposed) return;
    session = { ...session, founded: true, startupName: name, foundedAt: Date.now() };
    saveSession(session);
    deps.onFounded?.({ bucket, opening: 'action' });
    billboardStep(name);
  }
  async function found(name: string): Promise<void> {
    await deps.saveStartup(name, rollNickname(deps.rng));
    if (disposed) return;
    session = { ...session, founded: true, startupName: name, foundedAt: Date.now() };
    saveSession(session);
    deps.onFounded?.({ bucket, opening: action ? 'action' : 'classic' });
    billboardStep(name);
  }

  if (session.founded || returning) {
    // Returning player (a prior ladder founder on this device, OR someone who completed the normal onboarding
    // before the A/B ended — they already named a startup): skip the first-run found/billboard/share spine,
    // restore the game with the ladder active (crown + free-roam quests/missions), and keep the valuation pill.
    intoGame();
    // They skipped the first-run pitch spine. If they still haven't closed Pre-seed, surface the free-roam nudge
    // pointing at the Pear VC plaza investor (E at the investor, or this card's CTA, opens the same pitch card).
    // This is the returning-player funnel entry the A/B-end needs (prod has ~0 Pre-seed closes).
    if (preSeedEligible() && action && deps.pearFar) {
      // guidedOpener: the partner is a drive away — the opener once per device, else the GPS drive, then the walk-up.
      pitchStep(session.startupName || 'your startup');
    } else if (preSeedEligible()) {
      walkUpReady = true;
      quest.set({ kicker: 'PRE-SEED', title: `A partner at ${FOUNDER_PLAZA_VC_NAME} wants your pitch.`, cta: 'Pitch now', onCta: openPreSeedPitch });
      quest.show();
    } else if (action && session.preSeedClosed && !session.lastRoundCloseDay && deps.pitchSeed && deps.hailToVcOffice) {
      seedStep(session.startupName || 'your startup'); // review M2: a reload mid-drive resumes the Seed drive
    } else quest.hide();
  } else {
    // Spawn beat: the HUD is just the minimap + this one quest card. Tapping it opens the naming card
    // (PLAN step 1 → step 2), so the one obvious action is always visible first.
    const generated = action ? deps.defaultStartupName?.() : null;
    if (generated) {
      // actionOpening: no naming modal — found with the generated name (rename any time in Game options) and go.
      quest.set({ kicker: 'YOUR STARTUP', title: `You founded ${generated}. (Rename it in ☰ Game options after Seed.)` });
      quest.show();
      void autoFound(generated);
    } else {
      quest.set({ kicker: 'YOUR STARTUP', title: 'Found your startup →', cta: 'Found it', onCta: () => foundCard?.show() });
      quest.show();
      foundCard = createFoundCard({ parent, onFound: found, rng: deps.rng });
    }
  }

  return {
    active: true,
    bucket,
    get modalOpen() { return Boolean(foundCard?.isOpen) || Boolean(shareCard?.isOpen) || Boolean(pitchCard?.isOpen) || Boolean(seedPitchCard?.isOpen) || Boolean(preSeedCard?.isOpen); },
    get preSeedPitchEligible() { return preSeedEligible(); },
    preSeedPitch: openPreSeedPitch,
    update(player) {
      if (action && !disposed) for (const talk of [preSeedTalk, seedTalk]) {
        // critic N7: a conversation left open followed the player across the city (keys 1-3 still captured). It closes
        // once they move TALK_LEAVE_M from where it opened (the card's Pitch-now opens it from anywhere; Seed's can be
        // tapped from the car at the office) — walking off, driving off and a robotaxi all qualify.
        if (!talk?.isOpen) { if (talk) talkOrigin.delete(talk); continue; }
        const origin = talkOrigin.get(talk) ?? { x: player.x, z: player.z }; talkOrigin.set(talk, origin);
        if (Math.hypot(player.x - origin.x, player.z - origin.z) > TALK_LEAVE_M) { talk.close(); talkOrigin.delete(talk); }
      }
      if (flags.walkUpPitch && action && walkUpReady && !disposed && !pearDrive && !preSeedTalk?.isOpen && preSeedEligible()) {
        const pear = deps.places?.pear();
        if (pear) {
          const d = Math.hypot(player.x - pear.x, player.z - pear.z);
          if (d > WALKUP_REARM_M) walkUpArmed = true;
          else if (walkUpArmed && d <= WALKUP_OPEN_M) { walkUpArmed = false; openPreSeedPitch(); } // walked into the marker
        }
      }
      if (action && pearDrive && !disposed) {
        const pear = deps.places?.pear();
        if (pear && Math.hypot(player.x - pear.x, player.z - pear.z) <= PEAR_ARRIVE_M) {
          const { name } = pearDrive; pearDrive = null; pearReached = true; beat('pear_arrived');
          deps.route?.(null); // arrived: the partner is in sight; a beam would sit on them
          pitchStep(name);
        }
      }
      if (!action || !seedPending || seedPending.arrived || disposed) return;
      const office = deps.places?.seed();
      if (office && Math.hypot(player.x - office.x, player.z - office.z) <= SEED_ARRIVE_M) seedArrived(seedPending.name);
    },
    interact(player) {
      if (!action || !seedPending || disposed) return false;
      const office = deps.places?.seed();
      if (!office || Math.hypot(player.x - office.x, player.z - office.z) > SEED_ARRIVE_M) return false;
      if (!seedPending.arrived) seedArrived(seedPending.name);
      openSeedTalk(seedPending.name);
      return true;
    },
    jobStarted() {
      if (disposed) return;
      if (seedHandover) { seedHandover = false; quest.hide(); return; } // done its job: it doesn't come back
      if (!quest.element.hidden) { yieldedToJob = true; quest.hide(); }
    },
    jobEnded() { if (!disposed && yieldedToJob) { yieldedToJob = false; if (heldForCenter) return; quest.show(); } },
    centerHold(on) {
      if (disposed) return;
      if (on && !quest.element.hidden) { heldForCenter = true; quest.hide(); } // also a card the ladder shows mid-hold
      else if (!on && heldForCenter) { heldForCenter = false; if (!yieldedToJob) quest.show(); }
    },
    offerSeriesA(go) {
      // Never over a running ladder step (a drive, a pending meeting, an open conversation).
      if (disposed || openerRunning || pearDrive || seedPending || preSeedTalk?.isOpen || seedTalk?.isOpen) return false;
      seedHandover = false;
      quest.set({ kicker: 'SERIES A', title: 'Demo Day is open. Pitch the panel at the hacker house in SoMa.', cta: 'Route there', onCta: go });
      quest.show();
      return true;
    },
    setValuation(cents) { if (!disposed) valuation.set(cents); },
    destroy() {
      if (disposed) return; disposed = true;
      foundCard?.destroy(); shareCard?.destroy(); pitchCard?.destroy(); seedPitchCard?.destroy(); preSeedCard?.destroy(); preSeedTalk?.destroy(); seedTalk?.destroy(); quest.destroy(); valuation.destroy();
      releaseFounderLock(parent === document.body ? document.body : parent);
    },
  };
}
