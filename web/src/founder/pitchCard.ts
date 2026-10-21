/**
 * Founder-ladder first pitch — the mic-less TAP fallback (PLAN step 4: "If there's no mic or permission
 * is denied, fall back to three tap-choice pitch lines"). A <dialog> showing a real VC firm partner's
 * ask and three curated pitch lines; tapping one sends its INDEX to the server (never free text), which
 * runs the AI judge and pays a cheque. The VC's one-line verdict (a roast of the PITCH, never the player)
 * and the cheque are shown, moving the startup to Pre-seed.
 */
import { formatFunding } from '@gtasf/shared/funding';
import { FOUNDER_PITCH_LINES } from '@gtasf/shared/founder/pitch';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

/** The judged pitch result the server returns (runPitch's 'judged' outcome). */
export interface PitchResult { score: number; verdict: string; amountCents: string; credited: boolean; judge: 'ai' | 'fallback' }
/** What a pitch attempt resolves to: the judged result, 'cooldown' (this pitch already paid today), or null (failure). */
export type PitchAttempt = PitchResult | 'cooldown' | null;

export interface PitchCardOptions {
  parent?: HTMLElement;
  /** The real VC firm the player is pitching (persona "a partner at <vcName>"). */
  vcName: string;
  /** Overrides the "A partner at <vcName>" byline + the "Pitching …" status — used by phase-5 meme NPCs,
   *  which are FICTIONAL archetypes (e.g. "A Patagonia-vest VC"), not real-firm partners. */
  who?: string;
  /** Eyebrow kicker + cheque round tag. Defaults suit the Pre-seed plaza pitch; the Seed pitch (First
   *  Round) overrides them so the card reads "THE SEED ROUND" / "… · SEED" instead of "YOUR FIRST PITCH". */
  kicker?: string;
  roundLabel?: string;
  /** Send the chosen line INDEX to the server; resolves with the judged result, or null on failure. */
  onPitch(lineIndex: number): Promise<PitchAttempt>;
  /** Side quests (not the funnel's first pitch): a "Not now" button + Esc close the card. */
  cancellable?: boolean;
  /** Called when the player dismisses the result (Continue). */
  onDone?(result: PitchResult | null): void;
}

export interface PitchCard {
  readonly element: HTMLDialogElement;
  readonly isOpen: boolean;
  show(): void;
  destroy(): void;
}

export function createPitchCard(options: PitchCardOptions): PitchCard {
  const parent = options.parent ?? document.body;
  const dialog = el('dialog', 'gt-founder-pitch');
  dialog.setAttribute('aria-labelledby', 'gt-founder-pitch-title');
  const title = el('h2', 'gt-founder-pitch-title', `“Got 15 seconds? Pitch me.”`); title.id = 'gt-founder-pitch-title';
  const who = el('p', 'gt-founder-pitch-who', options.who ?? `A partner at ${options.vcName}`);
  const lines = el('div', 'gt-founder-pitch-lines');
  const status = el('p', 'gt-founder-pitch-status'); status.setAttribute('role', 'status');
  const result = el('div', 'gt-founder-pitch-result'); result.hidden = true;
  const verdict = el('p', 'gt-founder-pitch-verdict');
  const cheque = el('div', 'gt-founder-pitch-cheque');
  const done = el('button', 'gt-founder-pitch-done', 'Continue →'); done.type = 'button';
  result.append(verdict, cheque, done);
  const notNow = el('button', 'gt-founder-pitch-done gt-founder-pitch-skip', 'Not now'); notNow.type = 'button';
  notNow.hidden = !options.cancellable;

  const buttons: HTMLButtonElement[] = FOUNDER_PITCH_LINES.map((line, index) => {
    const button = el('button', 'gt-founder-pitch-line'); button.type = 'button';
    button.append(el('span', 'gt-founder-pitch-quote', `“${line}”`));
    button.addEventListener('click', () => void pitch(index));
    lines.append(button);
    return button;
  });
  dialog.append(el('div', 'gt-founder-pitch-kicker', options.kicker ?? 'YOUR FIRST PITCH'), who, title, lines, status, notNow, result);
  parent.append(dialog);

  let disposed = false, pitching = false, outcome: PitchResult | null = null;
  async function pitch(index: number): Promise<void> {
    if (pitching || disposed) return;
    pitching = true; for (const b of buttons) b.disabled = true; status.textContent = `Pitching ${options.who ?? `a partner at ${options.vcName}`}…`;
    try {
      const attempt = await options.onPitch(index);
      if (disposed) return;
      if (attempt === 'cooldown') {
        // Already paid today: a retry can't succeed, so say so and offer the way out (never a stuck modal).
        outcome = null; status.textContent = ''; lines.hidden = true; notNow.hidden = true;
        verdict.textContent = 'You already pitched here today. Come back tomorrow (SF time).'; cheque.textContent = '';
        result.hidden = false; done.focus({ preventScroll: true });
        return;
      }
      outcome = attempt;
      if (!outcome) { status.textContent = 'The partner stepped away. Try again in a moment.'; for (const b of buttons) b.disabled = false; pitching = false; return; }
      status.textContent = '';
      lines.hidden = true; notNow.hidden = true;
      verdict.textContent = `“${outcome.verdict}”`;
      let amount = '+$0'; try { amount = `+${formatFunding(outcome.amountCents)}`; } catch { /* keep default */ }
      cheque.textContent = `${amount} · ${options.roundLabel ?? 'PRE-SEED'}`;
      result.hidden = false;
      done.focus({ preventScroll: true });
    } finally { pitching = false; }
  }
  function close(): void { if (dialog.open) dialog.close(); options.onDone?.(outcome); }
  done.addEventListener('click', close);
  notNow.addEventListener('click', () => { if (!pitching) close(); });
  // No cancel on the funnel's first pitch (it unlocks Pre-seed): Esc re-focuses a line. Side quests close.
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (options.cancellable && !pitching) close(); });

  return {
    element: dialog,
    get isOpen() { return dialog.open; },
    show() {
      if (disposed || dialog.open) return;
      // Cards are cached per NPC: every open starts a fresh pitch, never the previous verdict (which left the lines
      // hidden for the rest of the session — no pitching that NPC again, even the next SF day, without a reload).
      if (!pitching) {
        outcome = null; status.textContent = ''; lines.hidden = false; result.hidden = true; notNow.hidden = !options.cancellable;
        for (const b of buttons) b.disabled = false;
      }
      dialog.showModal(); buttons[0]?.focus({ preventScroll: true });
    },
    destroy() { if (disposed) return; disposed = true; if (dialog.open) dialog.close(); dialog.remove(); },
  };
}
