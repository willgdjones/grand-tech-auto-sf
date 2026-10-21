import { flags } from '@gtasf/shared/flags';
import { isAutomatedVisit } from './bot';
import { isMobileDevice } from './heartbeat';

/** gtasf-j7wvv (flag netBeacon): consent-free aggregate counts of world sessions, live-socket drops (close code + how
 *  long the session had been up) and rejoins (gap), so the drop rate comes from every player, not a sampled tail. */
export function createNetBeacon() {
  if (!flags.netBeacon || typeof navigator === 'undefined' || isAutomatedVisit()) return null;
  const mobile = isMobileDevice();
  let sessionSent = false, droppedAt: number | null = null;
  const send = (kind: 'session' | 'drop' | 'rejoin', ms: number, code?: number) => {
    const body = JSON.stringify({ kind, ms: Math.round(ms), mobile, ...(code !== undefined ? { code } : {}) });
    try { if (!navigator.sendBeacon?.('/api/net/beacon', body)) void fetch('/api/net/beacon', { method: 'POST', body, keepalive: true }).catch(() => {}); } catch { /* best-effort */ }
  };
  return {
    /** Every WELCOME: the first is the session, one after a drop is a rejoin. */
    welcomed() {
      if (!sessionSent) { sessionSent = true; send('session', 0); return; }
      if (droppedAt !== null) { send('rejoin', performance.now() - droppedAt); droppedAt = null; }
    },
    /** A live session's socket closed unexpectedly (only the first close of a reconnect attempt chain counts). */
    dropped(code: number, upMs: number) {
      if (droppedAt !== null) return;
      droppedAt = performance.now(); send('drop', upMs, code);
    },
  };
}
