import { consumesTextKeys } from '../input/actions';

/** Phones have no V key: touch devices get a compact round 🎙 button (near 🎨) instead of 'Hold V to talk'. */
const touchDevice = () => typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0);
export function talkLabel(transmitting: boolean): string {
  if (touchDevice()) return '🎙';
  return transmitting ? 'Talking · release to stop' : 'Hold V to talk';
}

/** Hold-to-talk never requests permission itself; the opted-in client owns microphone access. */
export function createPushToTalk(options: { canStart(): boolean; onPress(): void; onRelease(): void; parent?: HTMLElement; onBlocked?(): void }) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'gt-voice-ptt';
  button.textContent = talkLabel(false); button.setAttribute('aria-label', 'Hold to talk to nearby players');
  // Touch: round 🎙 with a 'Hold to talk' caption (CSS ::after from data-caption), stacked above the 🎨 button.
  // Same touch test as the 🎨 float button so they always stack together; touchscreen laptops (fine pointer, keyboard)
  // keep the V hint in the caption (1.0 review of 3356aab8).
  const idleCaption = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'Hold to talk' : 'Hold V to talk';
  if (touchDevice()) { button.classList.add('gt-voice-ptt--touch'); button.dataset.caption = idleCaption; }
  button.setAttribute('aria-pressed', 'false'); button.hidden = true;
  const status = document.createElement('p'); status.className = 'gt-voice-status'; status.setAttribute('role', 'status'); status.hidden = true;
  // Founder Oct 6: 'holding V doesn't seem to do anything'. A big centre-bottom pill while held, always.
  const pill = document.createElement('div'); pill.className = 'gt-voice-pill'; pill.setAttribute('role', 'status'); pill.setAttribute('aria-live', 'polite'); pill.hidden = true;
  (options.parent ?? document.body).append(button, status); document.body.append(pill);
  let enabled = false, held = false, disposed = false, pointer: number | null = null, source: 'key' | 'pointer' | null = null;
  let heldKey: string | null = null;
  function release() {
    const wasHeld = held; held = false; source = null; heldKey = null;
    const id = pointer; pointer = null;
    if (id !== null && button.hasPointerCapture(id)) button.releasePointerCapture(id);
    if (wasHeld) options.onRelease();
  }
  function press(kind: 'key' | 'pointer') {
    if (disposed || !enabled || held || !options.canStart()) return false;
    held = true; source = kind; options.onPress(); return true;
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || consumesTextKeys(event.target)) return;
    const buttonKey = event.target === button && (event.code === 'Space' || event.code === 'Enter');
    if (event.code !== 'KeyV' && !buttonKey) return;
    // Voice off: never swallow V silently; say how to turn it on (once per press, not on key repeat).
    if (!enabled) { if (!event.repeat) options.onBlocked?.(); return; }
    if (!options.canStart()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat && press('key')) heldKey = event.code;
  };
  const keyup = (event: KeyboardEvent) => {
    if (source !== 'key' || event.code !== heldKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); release();
  };
  const pointerdown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (!press('pointer')) return;
    pointer = event.pointerId; button.setPointerCapture(event.pointerId);
  };
  const pointerup = (event: PointerEvent) => { if (event.pointerId === pointer) release(); };
  const visibility = () => { if (document.hidden) release(); };
  window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', release); document.addEventListener('visibilitychange', visibility);
  button.addEventListener('pointerdown', pointerdown); button.addEventListener('pointerup', pointerup);
  button.addEventListener('pointercancel', pointerup); button.addEventListener('lostpointercapture', pointerup);
  // Keyboard activation must not synthesize a second start after key release.
  button.addEventListener('click', event => event.preventDefault());
  return {
    button,
    release,
    // Critic N32: enabling showed the status box before any status text arrived — an empty, padded, black ~20 px square above
    // the talk button (desktop and phone, from the opener's end). Shown only with text.
    setEnabled(value: boolean) { enabled = value; button.hidden = !value; status.hidden = !value || !status.textContent; if (!value) release(); },
    setTransmitting(value: boolean) {
      button.dataset.transmitting = String(value); button.setAttribute('aria-pressed', String(value));
      button.textContent = talkLabel(value);
      if (button.dataset.caption !== undefined) button.dataset.caption = value ? 'Talking' : idleCaption;
    },
    /** Centre-bottom feedback while the key/button is held ('🎙 Connecting…', '🎙 Talking…'); null hides it. */
    setPill(text: string | null, tone: 'pending' | 'live' = 'pending') { pill.hidden = text === null; pill.textContent = text ?? ''; pill.dataset.tone = tone; },
    setStatus(text: string) {
      button.title = text; status.textContent = text;
      status.hidden = !enabled || !text || text.startsWith('Listening') || text.startsWith('Talking');
    },
    destroy() {
      if (disposed) return; disposed = true; release();
      window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', visibility);
      button.remove(); status.remove(); pill.remove();
    },
  };
}
