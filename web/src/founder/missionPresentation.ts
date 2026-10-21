/**
 * GTA-style mission presentation (flag missionPresentation; docs/critique/2026-10-15-gta-v-gap.md #17).
 *
 * The mission runner already drives the jobs phone, the corner quest card and small toasts. What was missing is the
 * frame GTA V puts around the same content: a yellow title slab when a job starts, the current objective as one line
 * in the mission-text spot (bottom-centre, above the controls), a "MISSION PASSED" band with the reward counting up,
 * and a "MISSION FAILED" band when it ends any other way. Pure DOM + CSS, no game state of its own: main.ts forwards
 * the runner's `onStep` / `onObjective` here. Every surface is pointer-events:none, so it never eats input, and
 * `prefers-reduced-motion` skips the count-up and the slides (the CSS also drops the animations).
 */
import { missionById, missionPayoutCents, type MissionObjective, type MissionSpec } from '@gtasf/shared/founder/missions';
import { flags } from '@gtasf/shared/flags';
import { centerSlot } from '../hud/centerSlot';
import './missionPresentation.css';

export type MissionStep = 'start' | 'complete' | 'abandon' | (string & {});
export interface MissionObjectiveState { mission: MissionSpec; objective: MissionObjective; index: number }

export interface MissionPresentation {
  /** Forwarded from the runner's `onStep`: 'start' shows the title slab, 'complete' the PASSED band, 'abandon' FAILED. */
  step(missionId: string, step: MissionStep): void;
  /** Forwarded from the runner's `onObjective`: renders the objective line; `null` after an unexplained end = FAILED. */
  objective(state: MissionObjectiveState | null): void;
  /** Direct surfaces (harness / look-checks). */
  showStart(mission: MissionSpec): void;
  showPassed(mission: MissionSpec, payoutCents?: bigint): void;
  /** critic N35: the amount the ledger actually credited for a mission (from its funding award, after the stage
   *  multiplier). The PASSED band counts to it instead of the base figure; a band already up re-targets. */
  credit(missionTitle: string, cents: bigint): void;
  showFailed(mission: MissionSpec, reason?: string): void;
  dispose(): void;
}

const TITLE_MS = 3200, PASSED_MS = 3600, FAILED_MS = 2800, COUNT_MS = 1300;

/** Full digits for the count-up ($9,000, not the HUD's $9k): every tick changes a digit, which is the GTA tally feel. */
function dollars(cents: bigint): string { return `$${(cents / 100n).toLocaleString('en-US')}`; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export function createMissionPresentation(opts: { parent?: HTMLElement; now?: () => number; reducedMotion?: () => boolean } = {}): MissionPresentation {
  const parent = opts.parent ?? document.body;
  const now = opts.now ?? (() => performance.now());
  const reduced = opts.reducedMotion ?? (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } });

  // Title slab (job start): bottom-right like GTA V's mission title.
  const slab = el('section', 'gt-mission-slab'); slab.hidden = true; slab.setAttribute('aria-live', 'polite');
  const slabKicker = el('div', 'gt-mission-slab-kicker', 'NEW JOB');
  const slabTitle = el('div', 'gt-mission-slab-title');
  const slabBlurb = el('div', 'gt-mission-slab-blurb');
  slab.append(slabKicker, slabTitle, slabBlurb);
  // Objective line: the mission-text spot (bottom-centre on desktop, above the minimap on phones).
  const line = el('section', 'gt-mission-line'); line.hidden = true; line.setAttribute('aria-live', 'polite');
  const lineMission = el('div', 'gt-mission-line-mission');
  const lineText = el('div', 'gt-mission-line-text');
  line.append(lineMission, lineText);
  // Result band: PASSED (reward count-up) / FAILED.
  const band = el('section', 'gt-mission-band'); band.hidden = true; band.setAttribute('role', 'status');
  const bandWord = el('div', 'gt-mission-band-word');
  const bandTitle = el('div', 'gt-mission-band-title');
  const bandReward = el('div', 'gt-mission-band-reward');
  band.append(bandWord, bandTitle, bandReward);
  parent.append(slab, line, band);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let raf = 0, disposed = false;
  let active: string | null = null;   // mission id with an objective line up
  let settled = false;                // 'complete' / 'abandon' already shown for the active mission

  function later(ms: number, fn: () => void): void {
    const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t);
  }
  function hideSlab(): void { slab.hidden = true; slab.classList.remove('is-in'); }
  function hideBand(): void { passedTitle = null; band.hidden = true; band.classList.remove('is-in', 'is-passed', 'is-failed'); cancelAnimationFrame(raf); raf = 0; }

  function showStart(mission: MissionSpec): void {
    hideSlab();
    slabTitle.textContent = mission.title;
    // #6.23 phone: "A hacker-house recruiter · A hacker-house recruiter swears…" — no prefix when the blurb already names the giver.
    const blurb = firstSentence(mission.phoneBlurb), named = mission.giver && blurb.toLowerCase().startsWith(mission.giver.name.toLowerCase());
    slabBlurb.textContent = mission.giver && !named ? `${mission.giver.name} · ${blurb}` : blurb;
    slab.hidden = false;
    // Next frame so the slide-in transition runs from the hidden state.
    requestAnimationFrame(() => { if (!slab.hidden) slab.classList.add('is-in'); });
    later(TITLE_MS, hideSlab);
  }

  function countUp(target: bigint): void {
    cancelAnimationFrame(raf);
    if (target <= 0n) { bandReward.textContent = ''; return; }
    if (reduced()) { bandReward.textContent = `+${dollars(target)}`; return; }
    const startAt = now();
    const tick = () => {
      const t = Math.min(1, (now() - startAt) / COUNT_MS);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t); // easeOutCubic: fast start, settles on the real number
      const cents = BigInt(Math.round(Number(target) * eased));
      bandReward.textContent = `+${dollars(t >= 1 ? target : cents)}`;
      if (t < 1) raf = requestAnimationFrame(tick); else raf = 0;
    };
    tick();
  }

  const credited = new Map<string, bigint>(); // mission title -> credited cents (critic N35)
  let passedTitle: string | null = null;
  function showPassed(mission: MissionSpec, explicitCents?: bigint): void {
    const show = () => {
      const payoutCents = explicitCents ?? credited.get(mission.title) ?? missionPayoutCents(mission); // read at show time
      passedTitle = mission.title;
      hideBand(); hideSlab();
      bandWord.textContent = 'MISSION PASSED';
      bandTitle.textContent = mission.title;
      band.classList.add('is-passed');
      band.hidden = false;
      requestAnimationFrame(() => { if (!band.hidden) band.classList.add('is-in'); });
      countUp(payoutCents);
    };
    // critic N34: the band, the payout card and RANK UP take turns in one centre slot (the band goes first).
    if (flags.centerSlotQueue) { centerSlot.enqueue({ front: true, naturalMs: PASSED_MS, show, hide: hideBand }); return; }
    show(); later(PASSED_MS, hideBand);
  }

  function showFailed(mission: MissionSpec, reason = ''): void {
    const show = () => {
      hideBand(); hideSlab();
      bandWord.textContent = 'MISSION FAILED';
      bandTitle.textContent = mission.title;
      bandReward.textContent = reason;
      band.classList.add('is-failed');
      band.hidden = false;
      requestAnimationFrame(() => { if (!band.hidden) band.classList.add('is-in'); });
    };
    if (flags.centerSlotQueue) { centerSlot.enqueue({ front: true, naturalMs: FAILED_MS, show, hide: hideBand }); return; }
    show(); later(FAILED_MS, hideBand);
  }

  return {
    step(missionId, step) {
      const mission = missionById(missionId);
      if (!mission) return;
      if (step === 'start') { active = missionId; settled = false; credited.delete(mission.title); showStart(mission); }
      else if (step === 'complete') { settled = true; showPassed(mission); }
      else if (step === 'abandon') { settled = true; showFailed(mission, 'Job abandoned'); }
      else if (step.startsWith('failed:')) { settled = true; showFailed(mission, step.slice('failed:'.length)); } // failBandReason
    },
    credit(missionTitle, cents) {
      credited.set(missionTitle, cents);
      if (passedTitle === missionTitle && !band.hidden) countUp(cents); // already counting the base: re-target to the credit
    },
    objective(state) {
      if (state) {
        active = state.mission.id; settled = false;
        lineMission.textContent = state.mission.title;
        lineText.textContent = state.objective.label;
        line.hidden = false;
        return;
      }
      line.hidden = true;
      // The runner clears its objective on every end; an end with no 'complete'/'abandon' step is a fail (the escape
      // timed out, the job was reset after a recovery, or the credit was refused). The runner's own toast says why.
      if (active && !settled) { const mission = missionById(active); if (mission) showFailed(mission); }
      active = null; settled = false;
    },
    showStart, showPassed, showFailed,
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t); timers.clear();
      cancelAnimationFrame(raf);
      slab.remove(); line.remove(); band.remove();
    },
  };
}

function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return (match ? match[1]! : text.trim()).slice(0, 90);
}
