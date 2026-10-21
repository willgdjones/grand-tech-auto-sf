/**
 * GTASF in-game phone CALL (docs/PLAN-gta-pivot.md LANE C — "in-game phone: jobs, GPS, quest-giver calls"). A ringing
 * banner from a fictional contact pitching a job: Answer routes to the job (the caller's onAnswer), Decline or 20 s of
 * silence dismisses it. Self-contained DOM + CSS; main.ts decides when to ring (behind flags.missions).
 */
import './phoneCall.css';

export interface PhoneCall {
  ring(call: { from: string; line: string; onAnswer(): void; onDecline?(): void }): void;
  readonly ringing: boolean;
  dispose(): void;
}

const RING_MS = 20_000;

export function createPhoneCall(parent: HTMLElement = document.body): PhoneCall {
  const root = document.createElement('section'); root.className = 'gt-phone-call'; root.hidden = true;
  root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-label', 'Incoming call');
  const kicker = document.createElement('div'); kicker.className = 'gt-phone-call-kicker'; kicker.textContent = '📱 INCOMING CALL';
  const from = document.createElement('div'); from.className = 'gt-phone-call-from';
  const line = document.createElement('p'); line.className = 'gt-phone-call-line';
  const actions = document.createElement('div'); actions.className = 'gt-phone-call-actions';
  const answer = document.createElement('button'); answer.type = 'button'; answer.className = 'gt-phone-call-answer'; answer.textContent = 'Answer';
  const decline = document.createElement('button'); decline.type = 'button'; decline.className = 'gt-phone-call-decline'; decline.textContent = 'Decline';
  actions.append(answer, decline); root.append(kicker, from, line, actions); parent.append(root);
  let onAnswer: (() => void) | undefined, onDecline: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const end = () => { root.hidden = true; onAnswer = undefined; onDecline = undefined; if (timer) clearTimeout(timer); timer = undefined; };
  answer.addEventListener('click', () => { const go = onAnswer; end(); go?.(); });
  decline.addEventListener('click', () => { const no = onDecline; end(); no?.(); });
  return {
    ring(call) {
      from.textContent = call.from; line.textContent = `“${call.line}”`; onAnswer = call.onAnswer; onDecline = call.onDecline;
      root.hidden = false; if (timer) clearTimeout(timer); timer = setTimeout(end, RING_MS);
    },
    get ringing() { return !root.hidden; },
    dispose() { end(); root.remove(); },
  };
}
