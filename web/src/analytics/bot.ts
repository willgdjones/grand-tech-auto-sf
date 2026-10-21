/**
 * Automated test visits (look captures, Playwright smokes) must not count as players. A visit is automated when
 * the URL has ?bot=1 or the browser is driven by automation (navigator.webdriver, set by Playwright). Such visits
 * skip all client analytics (PostHog, X pixel) and carry a `gtasf_bot=1` session cookie so the Worker marks the
 * funding profile is_bot=1 and player counts (tools/players.mjs) can exclude it.
 */
export function isAutomatedVisit(): boolean {
  try { return new URLSearchParams(location.search).get('bot') === '1' || navigator.webdriver === true; } catch { return false; }
}
export function markAutomatedVisit(): void {
  try { if (isAutomatedVisit()) document.cookie = 'gtasf_bot=1; Path=/; SameSite=Lax'; } catch { /* no document */ }
}
