import { flags } from '@gtasf/shared/flags';
import type { AnalyticsPublicConfig } from '@gtasf/shared/analytics';
import { captureLandingAttribution, initAnalytics, optedOut, stopAnalytics } from './index';
import { readConsent, rememberConsent } from './storage';

export function consentDecision(config: AnalyticsPublicConfig, saved: boolean | undefined, privacyOptOut: boolean): boolean | undefined {
  if (privacyOptOut) return false;
  return saved ?? (config.consentRequired === false ? true : undefined);
}

/** A first-party region check is allowed before permission; providers are not. */
export async function bootAnalyticsConsent(): Promise<void> {
  if (!flags.posthogAnalytics && !flags.xAdsPixel) return;
  captureLandingAttribution();
  try {
    const response = await fetch('/api/analytics/config', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    const config = await response.json() as AnalyticsPublicConfig;
    if (!config.posthog && !config.xPixelId) return;
    if (document.readyState === 'loading') await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
    let enabled = false;
    const panel = document.createElement('section');
    panel.id = 'analytics-consent'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Analytics preferences');
    panel.style.cssText = 'position:fixed;z-index:10000;bottom:50px;right:12px;max-width:min(380px,calc(100vw - 24px));padding:18px;background:#16241e;color:#fff;border:1px solid #f7d98e;border-radius:8px;font:15px/1.5 system-ui;box-sizing:border-box;box-shadow:0 8px 32px #0008';
    const text = document.createElement('p');
    text.textContent = 'Allow PostHog analytics and X ad measurement? This uses browser storage and shares click and device identifiers to measure visits and purchases. You can play either way.';
    text.style.margin = '0 0 12px'; panel.append(text);
    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap'; panel.append(controls);
    const settings = document.createElement('button'); settings.textContent = 'Privacy'; settings.type = 'button'; settings.className = 'gt-privacy-launch'; // hudMenuFold: the pause menu opens it
    settings.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:9999;background:#16241e;color:white;border:1px solid #aaa;padding:6px 12px;border-radius:4px';
    // Phones: bottom-right is the touch action cluster (it sat on RIDE / HOP OFF); bottom-centre is clear.
    if (matchMedia('(pointer: coarse)').matches) Object.assign(settings.style, { right: 'auto', left: '50%', transform: 'translateX(-50%)', bottom: 'max(6px, env(safe-area-inset-bottom))', padding: '4px 10px', fontSize: '12px', opacity: '0.85' });
    settings.onclick = () => { panel.hidden = false; };
    const decide = async (allow: boolean) => {
      const permitted = allow && !optedOut();
      rememberConsent(permitted); panel.hidden = true;
      if (permitted) { enabled = true; await initAnalytics({ permitted: true, config }); }
      else { stopAnalytics(); if (enabled) location.reload(); }
    };
    for (const [label, allow] of [['Allow', true], ['Decline', false]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.style.cssText = 'background:#f7d98e;color:#16241e;border:0;border-radius:4px;padding:9px 18px;font:inherit;cursor:pointer';
      button.onclick = () => { void decide(allow); }; controls.append(button);
    }
    panel.addEventListener('keydown', event => event.stopPropagation());
    document.body.append(panel, settings);
    const decision = consentDecision(config, readConsent(), optedOut());
    panel.hidden = decision !== undefined;
    if (decision === true) { enabled = true; await initAnalytics({ permitted: true, config }); }
    else if (decision === false) stopAnalytics();
  } catch { /* Play remains available if config or storage is unavailable. */ }
}

if (typeof window !== 'undefined') void bootAnalyticsConsent();
