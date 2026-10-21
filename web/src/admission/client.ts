import { flags } from '@gtasf/shared/flags';
import { validAdmissionToken, type AdmissionConfig, type AdmissionResponse } from '@gtasf/shared/admission';
import { holdFreeCursor } from '../input/cursor';
import './style.css';

const KEY = 'gtasf.admission.ticket';
let ticket: string | undefined, grant: string | undefined, generation = 0;
let pending: Promise<string | undefined> | undefined, renewal: ReturnType<typeof setTimeout> | undefined;
let panel: HTMLDialogElement | undefined, heading: HTMLElement, detail: HTMLElement, form: HTMLFormElement, action: HTMLButtonElement;
let releaseCursor: (() => void) | undefined, checkedInvite = false;
export const admissionBlocked = () => !!panel;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function remember(value: string | undefined) {
  ticket = value;
  try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* In-memory queue still works. */ }
}
function controls() {
  return panel ? [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') : [];
}
function focusPanel() { (controls()[0] ?? panel)?.focus({ preventScroll: true }); }
function containKeyboard(event: KeyboardEvent) {
  if (!panel) return;
  // Native modality makes covered controls inert; global game shortcuts also stop here.
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); return; }
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
  const items = controls(), first = items[0], last = items.at(-1), active = document.activeElement;
  if (!first) { event.preventDefault(); panel.focus({ preventScroll: true }); }
  else if (!panel.contains(active) || active === panel || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
  }
}
function show(title: string, text: string, source: 'queue' | 'launch' = 'queue') {
  if (!panel) {
    panel = document.createElement('dialog'); panel.className = 'admission'; panel.tabIndex = -1; panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'admission-title');
    panel.innerHTML = `<div class="admission-card"><p class="admission-kicker">Grand Tech Auto · San Francisco</p><h1 id="admission-title"></h1><p class="admission-detail" aria-live="polite"></p><button class="admission-action" hidden></button><form class="admission-signup"><label for="admission-email">Get notified when the city opens</label><div><input id="admission-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required><button type="submit">Notify me</button></div><p class="admission-note">Save your email for launch updates. Confirmation email is coming soon.</p><p class="admission-result" role="status"></p></form><p class="admission-footer">One shared city. A place opens when someone leaves.<br>Inactive players leave after five minutes without input.</p>${flags.changelog ? '<p class="admission-footer"><a class="admission-changelog" href="/changelog" target="_blank" rel="noopener">What\'s new · Changelog</a></p>' : ''}</div>`;
    heading = panel.querySelector('h1')!; detail = panel.querySelector('.admission-detail')!;
    form = panel.querySelector('form')!; action = panel.querySelector('.admission-action')!;
    form.addEventListener('submit', event => {
      event.preventDefault(); const input = form.elements.namedItem('email') as HTMLInputElement;
      const button = form.querySelector('button')!, result = form.querySelector('.admission-result')!;
      button.disabled = true;
      void post('/api/waitlist', { email: input.value, source: form.dataset.source }).then(() => {
        result.textContent = 'You’re on the list. We’ll ask you to confirm your email before sending updates.';
        input.disabled = true;
        if (panel?.contains(document.activeElement) || document.activeElement === document.body) focusPanel();
      }).catch(error => { result.textContent = error instanceof Error ? error.message : 'Please try again.'; button.disabled = false; });
    });
    panel.addEventListener('cancel', event => event.preventDefault());
    window.addEventListener('keydown', containKeyboard, true);
    releaseCursor = holdFreeCursor(); document.exitPointerLock?.(); document.body.append(panel);
  }
  heading.textContent = title; detail.textContent = text; form.dataset.source = source;
  form.querySelector('label')!.textContent = source === 'queue' ? 'Get notified when a spot opens' : 'Get notified when the city opens';
  form.hidden = !flags.waitlist;
  if (!panel.open) { panel.showModal(); focusPanel(); }
}
function hide() { window.removeEventListener('keydown', containKeyboard, true); panel?.close(); panel?.remove(); panel = undefined; releaseCursor?.(); releaseCursor = undefined; }
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json() as T & { error?: string; status?: string };
  if (!response.ok && value.status !== 'full') throw new Error(value.error ?? 'Connection interrupted. Retrying shortly.');
  return value;
}
async function config(): Promise<AdmissionConfig> {
  if (!checkedInvite) {
    checkedInvite = true; const url = new URL(location.href), code = url.searchParams.get('invite');
    if (code !== null) {
      // Remove the capability from history before other links/resources can copy it.
      url.searchParams.delete('invite'); history.replaceState(history.state, '', url);
      try { await post('/api/invite', { code }); } catch { /* Invalid/expired invites show the normal launch page. */ }
    }
  }
  const response = await fetch('/api/admission', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('The city is reconnecting. Retrying shortly.');
  return response.json() as Promise<AdmissionConfig>;
}
function renew(currentGeneration: number) {
  clearTimeout(renewal);
  renewal = setTimeout(() => {
    if (currentGeneration !== generation || !ticket || !grant) return;
    void post<AdmissionResponse>('/api/admission/poll', { ticket }).then(value => {
      if (currentGeneration !== generation) return;
      if (value.status === 'admitted' && value.grant === grant) renew(currentGeneration);
      else { invalidateAdmission(); void waitForAdmission(); }
    }).catch(() => { if (currentGeneration === generation) renew(currentGeneration); });
  }, 10_000);
}
/** Called before loading the city and again before every reconnect. HTTP-only visitors consume no World socket. */
export function waitForAdmission(options: { requireInput?: boolean } = {}): Promise<string | undefined> {
  if (!flags.worldCapacity && !flags.waitlist) return Promise.resolve(undefined);
  if (grant && !options.requireInput) return Promise.resolve(grant);
  if (pending) return pending;
  const currentGeneration = generation;
  pending = (async () => {
    if (options.requireInput) {
      show('Your spot is ready for someone else', 'You left the city after five minutes without input. Rejoin whenever you’re ready.');
      action.hidden = false; action.textContent = 'Rejoin the queue';
      action.focus({ preventScroll: true });
      await new Promise<void>(resolve => action.onclick = () => { action.hidden = true; action.onclick = null; focusPanel(); resolve(); });
    }
    try { const stored = sessionStorage.getItem(KEY); if (!ticket && validAdmissionToken(stored)) ticket = stored; } catch { /* No storage. */ }
    for (;;) {
      try {
        const state = await config();
        if (!state.allowed) {
          show('San Francisco is opening soon', state.launchMode === 'invite' ? 'Sunday playtest · Oct 4, 8 PM Pacific. Have an invitation? Open your private playtest link.' : 'Sunday playtest · Oct 4, 8 PM Pacific. Public launch · Oct 5, 8 AM Pacific.', 'launch');
          await pause(15_000); continue;
        }
        if (!state.enabled) { hide(); return undefined; }
        const value = await post<AdmissionResponse>(ticket ? '/api/admission/poll' : '/api/admission/enter', { ticket });
        if (value.status === 'admitted' && value.grant) {
          remember(value.ticket); grant = value.grant; hide(); renew(currentGeneration); return grant;
        }
        if (value.status === 'expired') { remember(undefined); await pause(250); continue; }
        if (value.status === 'queued') {
          remember(value.ticket);
          const eta = value.etaSeconds === null ? 'Estimating the wait…' : `Estimated wait: ${Math.max(1, Math.ceil(value.etaSeconds / 60))} min.`;
          show(`You’re #${value.position} in line`, `${value.population}/${value.capacity} players in the city. ${eta} Keep this tab open; you’ll enter automatically.`);
        } else if (value.status === 'full') show('The city has a long line', 'The queue is full. We’ll retry automatically; you can also leave your email below.');
        else show('San Francisco is opening soon', 'Leave your email for launch updates.', 'launch');
        await pause(Math.max(1, Math.min(30, value.nextPollS)) * 1000);
      } catch (error) { show('Reconnecting to the city', error instanceof Error ? error.message : 'Retrying shortly.'); await pause(3000); }
    }
  })().finally(() => { pending = undefined; });
  return pending;
}
export function admissionConsumed(): void { ++generation; grant = undefined; remember(undefined); clearTimeout(renewal); hide(); }
export function invalidateAdmission(): void { ++generation; grant = undefined; remember(undefined); clearTimeout(renewal); }
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  if (!ticket) return;
  void fetch('/api/admission/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }), keepalive: true }).catch(() => undefined);
});
