import { flags } from '@gtasf/shared/flags';
import { isAutomatedVisit } from './bot';
import { isMobileDevice } from './heartbeat';

export type LoadingStage = 'boot' | 'download' | 'paving' | 'parking' | 'joining' | 'ready';
/** No-PII loading funnel (gtasf-loading-abandon): start, READY, or abandoned before READY (pagehide), with the
 *  last loading stage and elapsed ms since navigation. Consent-free aggregate counters (D1, migration 0037). */
export function createLoadingBeacon() {
  if (!flags.loadingBeacon || typeof navigator === 'undefined' || isAutomatedVisit()) return null;
  let stage: LoadingStage = 'boot', done = false;
  const mobile = isMobileDevice();
  // loadingBeaconClass: was the page ever on screen? A link-preview renderer loads it offscreen and closes it, so 'seen: false'
  // separates those from people who saw the loading card and left.
  let seen = typeof document === 'undefined' || document.visibilityState === 'visible';
  if (flags.loadingBeaconClass && !seen) document.addEventListener('visibilitychange', function onVisible() {
    if (document.visibilityState === 'visible') { seen = true; document.removeEventListener('visibilitychange', onVisible); }
  });
  const send = (kind: 'start' | 'ready' | 'abandon') => {
    const body = JSON.stringify(flags.loadingBeaconClass ? { kind, stage, elapsedMs: Math.round(performance.now()), mobile, seen }
      : { kind, stage, elapsedMs: Math.round(performance.now()), mobile });
    try { if (!navigator.sendBeacon?.('/api/loading/beacon', body)) void fetch('/api/loading/beacon', { method: 'POST', body, keepalive: true }).catch(() => {}); } catch { /* best-effort */ }
  };
  const onHide = () => { if (!done) { done = true; send('abandon'); } };
  addEventListener('pagehide', onHide);
  send('start');
  return {
    stage(next: LoadingStage) { if (!done) stage = next; },
    ready() { if (done) return; done = true; stage = 'ready'; send('ready'); removeEventListener('pagehide', onHide); },
  };
}
