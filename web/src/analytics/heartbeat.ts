import { flags } from '@gtasf/shared/flags';
import { analyticsContext, track } from './index';

export const isMobileDevice = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600);

/** Consented play-time beacon: one 'session_heartbeat' per 60 s of visible, in-world play. track() drops it
 * without consent, under Do Not Track/GPC and for automated (?bot=1/webdriver) visits. */
export function startSessionHeartbeat(read: () => { inWorld: boolean; step?: string; stage?: string }): () => void {
  if (!flags.posthogAnalytics) return () => {};
  const is_mobile = isMobileDevice();
  let active = 0, sent = 0;
  const timer = setInterval(() => {
    const now = read();
    if (document.visibilityState !== 'visible' || !now.inWorld) return;
    active++;
    if (active - sent < 60 || !analyticsContext()) return;
    sent = active;
    track('session_heartbeat', { minutes_played: Math.round(active / 60), is_mobile,
      ...(now.step ? { step: now.step } : {}), ...(now.stage ? { stage: now.stage } : {}) });
  }, 1000);
  return () => clearInterval(timer);
}
