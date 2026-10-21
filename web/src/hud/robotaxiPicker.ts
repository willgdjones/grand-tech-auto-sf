import { flags } from '@gtasf/shared/flags';
import { holdFreeCursor } from '../input/cursor';
import type { TaxiDestination, TaxiQuote } from '../vehicles/robotaxi/client';
import './robotaxiPicker.css';
export interface TaxiChoice extends TaxiDestination { group: string }
export function createRobotaxiPicker(options: { choices(): TaxiChoice[]; quote(target: TaxiDestination): Promise<TaxiQuote>; hail(target: TaxiDestination): boolean | string; onOpen(): void }) {
  const dialog = document.createElement('dialog'); dialog.className = 'gt-taxi-picker';
  const title = document.createElement('h2'); title.textContent = 'Where to?';
  const close = document.createElement('button'); close.textContent = 'Close ×'; close.type = 'button';
  const intro = document.createElement('p'); intro.textContent = 'Your first 3 rides are free. Pick a destination.';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
  const list = document.createElement('div'); dialog.append(close, title, intro, status, list); document.body.append(dialog);
  let release: (() => void) | undefined, previous: HTMLElement | null = null, generation = 0;
  let disposed = false;
  const settleClosed = () => {
    // Native close events are queued and may belong to an earlier opening.
    if (dialog.open || !release) return;
    generation++; release(); release = undefined;
    const restore = previous; previous = null;
    if (restore?.isConnected) restore.focus({ preventScroll: true });
  };
  const hide = () => { if (dialog.open) dialog.close(); settleClosed(); };
  dialog.addEventListener('close', settleClosed);
  close.onclick = hide; dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  return {
    get isOpen() { return dialog.open; }, hide,
    show() {
      if (disposed || !flags.quickRobotaxi || dialog.open) return;
      settleClosed();
      options.onOpen(); previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      release = holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock();
      const current = ++generation; list.replaceChildren(); status.hidden = true; status.textContent = ''; let group = '';
      for (const choice of options.choices()) {
        if (group !== choice.group) { group = choice.group; const heading = document.createElement('h3'); heading.textContent = group; list.append(heading); }
        const row = document.createElement('button'); row.type = 'button'; row.disabled = true;
        const name = document.createElement('span'), fare = document.createElement('strong'); name.textContent = choice.title; fare.textContent = 'Checking fare…';
        let pending = false, failed = false;
        row.append(name, fare); row.onclick = () => {
          if (disposed || !dialog.open || current !== generation || pending) return;
          if (failed) { void loadFare(); return; }
          const result = options.hail(choice);
          if (result === true) { hide(); return; }
          status.textContent = typeof result === 'string' && result ? result : 'Unable to hail right now. Try again in a moment.';
          status.hidden = false; status.scrollIntoView({ block: 'nearest' });
        }; list.append(row);
        async function loadFare() {
          if (pending) return;
          pending = true; failed = false; row.disabled = true; row.title = '';
          fare.textContent = 'Checking fare…'; row.setAttribute('aria-busy', 'true');
          try {
            // Let showModal finish before handling even a synchronous quote failure.
            await Promise.resolve();
            if (disposed || !dialog.open || current !== generation) return;
            const quote = await options.quote(choice);
            if (disposed || !dialog.open || current !== generation) return;
            if (!quote.fareCents) throw new Error('Fare unavailable');
            fare.textContent = quote.label; row.disabled = !quote.affordable;
            if (!quote.affordable) row.title = 'Not enough funding. Walk or drive.';
          } catch {
            if (disposed || !dialog.open || current !== generation) return;
            failed = true; fare.textContent = 'Fare unavailable · Retry'; row.disabled = false;
            row.title = `Retry fare for ${choice.title}`;
          } finally {
            pending = false; row.removeAttribute('aria-busy');
          }
        }
        void loadFare();
      }
      dialog.showModal(); close.focus();
    },
    destroy() { if (disposed) return; disposed = true; hide(); dialog.remove(); },
  };
}
