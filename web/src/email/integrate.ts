import { flags } from '@gtasf/shared/flags';
import type { EmailReward, EmailStatus } from '@gtasf/shared/email/contract';
import type { OnboardingFlow } from '../onboarding/flow';
import { emailStatus } from './client';
import { isEmailDialogOpen, openEmailCapture } from './card';

type PromptSource = 'onboarding' | 'first_star';

/** The live service controls availability; automatic offers wait for a safe gap in play. */
export function createEmailCaptureIntegration(options: {
  parent: HTMLElement;
  onboarding(): Pick<OnboardingFlow, 'state' | 'emailPromptShown'> | null;
  closeOptions(): void;
  canOpen(): boolean;
  canAutoPrompt(): boolean;
  onStatus(message: string): void;
  onVerified?(reward: EmailReward): void;
}) {
  if (!flags.emailCapture) return null;
  const entry = document.createElement('button');
  entry.type = 'button'; entry.className = 'gt-recovery-entry'; entry.hidden = true;
  options.parent.append(entry);
  let disposed = false, busy = true, available = false, verified = false;
  let pending: PromptSource | null = null;
  let statusFailed = false, armed = false;

  function renderEntry() {
    entry.hidden = !available && !statusFailed;
    entry.disabled = busy || verified;
    entry.textContent = verified ? 'Email verified ✓' : statusFailed ? 'Retry email saving' : 'Save your startup with email';
  }
  function acceptStatus(status: EmailStatus) {
    statusFailed = false;
    available = status.available; verified = status.verified;
    if (!available || verified) pending = null;
    renderEntry();
  }
  function eligible(source: PromptSource): boolean {
    const flow = options.onboarding();
    // Offer once the paint AND walk steps are cleared; ~85% of players never finish the whole tutorial.
    // Right after paint it cut walk progression (players past paint who stopped at walk: 49% -> 71% after the
    // offer shipped, prod D1, Oct 6-7) for ~1 capture (gtasf-mi3b), so it waits until they've moved.
    if (!flow || (!flow.state.completed && (flow.state.step === 'intro' || flow.state.step === 'walk'))) return false;
    return flow.state.emailPrompts === (source === 'onboarding' ? 0 : 1);
  }
  async function offer(source: PromptSource | 'game_options'): Promise<void> {
    if (disposed || busy || isEmailDialogOpen()) return;
    const automatic = source !== 'game_options';
    if (automatic) armed = true; // the paint-step offer never re-arms after an automatic attempt
    busy = true; renderEntry();
    try {
      const status = await emailStatus();
      if (disposed) return;
      acceptStatus(status);
      if (!available || verified) return;
      // The player may have opened another dialog or started moving during the request.
      if (!options.canOpen() || isEmailDialogOpen() || (automatic && (!eligible(source) || !options.canAutoPrompt()))) return;
      openEmailCapture({ source, onVerified(reward) {
        if (disposed) return;
        verified = true; pending = null; renderEntry(); options.onVerified?.(reward);
      } });
      if (automatic) { pending = null; options.onboarding()?.emailPromptShown(); }
    } catch {
      if (!disposed) {
        statusFailed = true;
        pending = null; // A failed request must not become a per-frame retry loop.
        if (!automatic) options.onStatus('Email saving is temporarily unavailable. Try again later.');
      }
    } finally { busy = false; if (!disposed) renderEntry(); }
  }
  entry.addEventListener('click', () => { options.closeOptions(); void offer('game_options'); });
  const ready = emailStatus().then(status => { if (!disposed) acceptStatus(status); }).catch(() => {
      if (!disposed) { statusFailed = true; pending = null; }
    })
    .finally(() => { busy = false; if (!disposed) renderEntry(); });
  return {
    ready,
    get available() { return available; },
    /** Funding calls this once per paid cheque; only the first cheque and first-star crossing qualify. */
    onAward(firstStar: boolean) {
      if (disposed || verified) return;
      const count = options.onboarding()?.state.emailPrompts;
      if (count === 0) pending = 'onboarding';
      else if (firstStar && count === 1) pending = 'first_star';
    },
    tick() {
      // First offer right after the paint-step celebration (or for returning players never offered),
      // not only after a cheque: the cheque path alone left the offer unseen in production.
      if (!armed && !pending && available && !verified && options.onboarding()?.state.emailPrompts === 0) { armed = true; pending = 'onboarding'; }
      if (disposed || busy || !pending || !options.canOpen() || !options.canAutoPrompt() || isEmailDialogOpen()) return;
      if (!eligible(pending)) return;
      void offer(pending);
    },
    destroy() { disposed = true; pending = null; entry.remove(); },
  };
}
