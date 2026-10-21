/**
 * In-world pitch conversation (flag actionOpening, GTA V critique #13): the founder-ladder pitch as a bottom-of-screen
 * conversation with the VC partner instead of a modal <dialog>. The partner's line, three numbered pitch choices (tap or
 * keys 1-3), then their verdict and the cheque counting up GTA-style. Same money path as the pitch card: the choice's
 * INDEX goes to `onPitch` (never free text) and the server judges + pays. Not a modal: the world keeps running.
 */
import { FOUNDER_PITCH_LINES } from '@gtasf/shared/founder/pitch';
import type { PitchAttempt, PitchResult } from './pitchCard';
import './pitchConversation.css';

export interface PitchConversationOptions {
  parent?: HTMLElement;
  /** "A partner at Pear VC". */
  who: string;
  /** Cheque tag, e.g. 'PRE-SEED' / 'SEED'. */
  roundLabel: string;
  onPitch(lineIndex: number): Promise<PitchAttempt>;
  /** After the verdict + count-up (or a failure): the controller moves the quest on. */
  onDone?(result: PitchResult | null): void;
  reducedMotion?: () => boolean;
}
export interface PitchConversation {
  readonly isOpen: boolean;
  show(): void;
  /** Step away without answering (walked off, got in a car): hide + release keys 1-3. No-op mid-verdict; E reopens. */
  close(): void;
  destroy(): void;
}

const COUNT_MS = 1400, HOLD_MS = 3200;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = cls; if (text) node.textContent = text; return node;
};
const dollars = (cents: bigint) => `$${(cents / 100n).toLocaleString('en-US')}`;

export function createPitchConversation(options: PitchConversationOptions): PitchConversation {
  const parent = options.parent ?? document.body;
  const root = el('section', 'gt-convo'); root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false');
  const speaker = el('div', 'gt-convo-who', options.who);
  const line = el('p', 'gt-convo-line');
  const choices = el('div', 'gt-convo-choices');
  const cheque = el('div', 'gt-convo-cheque'); cheque.hidden = true;
  root.append(speaker, line, choices, cheque);
  parent.append(root);
  let busy = false, timer: ReturnType<typeof setTimeout> | undefined, raf = 0;

  function stepAway(): void {
    if (root.hidden || busy) return;
    root.hidden = true; removeEventListener('keydown', onKey, true); document.body.classList.remove('gt-convo-open');
  }
  function close(result: PitchResult | null): void {
    root.hidden = true; removeEventListener('keydown', onKey, true); document.body.classList.remove('gt-convo-open');
    options.onDone?.(result);
  }
  function countUp(cents: bigint, done: () => void): void {
    cheque.hidden = false;
    if (options.reducedMotion?.() || cents <= 0n) { cheque.textContent = `+${dollars(cents)} · ${options.roundLabel}`; done(); return; }
    const start = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / COUNT_MS);
      cheque.textContent = `+${dollars(cents * BigInt(Math.round(k * 1000)) / 1000n)} · ${options.roundLabel}`;
      if (k < 1) raf = requestAnimationFrame(tick); else done();
    };
    tick();
  }
  async function pick(index: number): Promise<void> {
    if (busy) return; busy = true;
    choices.hidden = true;
    line.textContent = `“${FOUNDER_PITCH_LINES[index] ?? ''}”`; speaker.textContent = 'You';
    const attempt = await options.onPitch(index).catch(() => null);
    speaker.textContent = options.who;
    if (attempt === 'cooldown') { line.textContent = 'You already pitched me today. Come back tomorrow.'; timer = setTimeout(() => close(null), HOLD_MS); return; }
    if (!attempt) { line.textContent = 'Signal dropped — let’s try that again.'; busy = false; choices.hidden = false; return; }
    line.textContent = `“${attempt.verdict}”`;
    const cents = BigInt(attempt.amountCents);
    if (!attempt.credited || cents <= 0n) { timer = setTimeout(() => close(attempt), HOLD_MS); return; }
    countUp(cents, () => { timer = setTimeout(() => close(attempt), HOLD_MS); });
  }
  function onKey(event: KeyboardEvent): void {
    if (root.hidden || root.getClientRects().length === 0) return; // stepped aside under the jobs phone / a dialog
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return; // typing in chat (review LOW)
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopImmediatePropagation(); stepAway(); return; } // not now: E reopens it
    if (busy) return;
    const n = Number(event.key);
    if (n >= 1 && n <= FOUNDER_PITCH_LINES.length) {
      // Keys 1-3 also select weapons: while the partner is waiting on your answer they pick a line instead.
      event.preventDefault(); event.stopImmediatePropagation(); void pick(n - 1);
    }
  }

  return {
    get isOpen() { return !root.hidden; },
    close: stepAway,
    show() {
      if (!root.hidden) return;
      busy = false; cheque.hidden = true; choices.hidden = false;
      speaker.textContent = options.who; line.textContent = '“Got 15 seconds? Pitch me.”';
      choices.replaceChildren(...FOUNDER_PITCH_LINES.map((text, i) => {
        const b = el('button', 'gt-convo-choice'); b.type = 'button';
        b.append(el('span', 'gt-convo-key', String(i + 1)), document.createTextNode(text));
        b.addEventListener('click', () => void pick(i));
        return b;
      }));
      root.hidden = false; addEventListener('keydown', onKey, true); document.body.classList.add('gt-convo-open');
    },
    destroy() { if (timer) clearTimeout(timer); cancelAnimationFrame(raf); removeEventListener('keydown', onKey, true); document.body.classList.remove('gt-convo-open'); root.remove(); },
  };
}
