// One-off: hudFocus (critic N2/N4) on the local stack — a visible DISPATCH hides the look hint + key legend; a MISSION
// PASSED band clears notices/hints. Forces the states via the real elements' own attributes (hidden / is-in).
import { chromium } from '@playwright/test';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Focus Labs', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); });
const page = await ctx.newPage();
await page.goto('http://localhost:5319/?bot=1');
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const vis = el => !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const mk = (cls, text) => { let e = document.querySelector('.' + cls); if (!e) { e = document.createElement('div'); e.className = cls; document.body.append(e); } e.hidden = false; e.textContent = text; return e; };
  const legend = mk('gt-pause-hint', 'Shift run · F shoot'), look = mk('gt-look-fallback', 'Use arrow keys to look');
  const out = { focusClass: document.body.classList.contains('gt-hud-focus'), before: { legend: vis(legend), look: vis(look) } };
  const dispatch = mk('gt-dispatch', 'DISPATCH All units…');
  out.withDispatch = { dispatch: vis(dispatch), legend: vis(legend), look: vis(look) };
  dispatch.hidden = true;
  const band = mk('gt-mission-band', 'MISSION PASSED'); band.classList.add('is-in');
  const notice = mk('gt-toast-notice', 'Lose the cops');
  out.withBand = { band: vis(band), notice: vis(notice), legend: vis(legend), look: vis(look) };
  band.classList.remove('is-in'); band.hidden = true;
  out.after = { notice: vis(notice), legend: vis(legend) };
  return out;
});
console.log('RESULT', JSON.stringify(r));
const ok = r.focusClass && r.before.legend && r.withDispatch.dispatch && !r.withDispatch.legend && !r.withDispatch.look && r.withBand.band && !r.withBand.notice && !r.withBand.legend && r.after.notice && r.after.legend;
console.log(ok ? 'HUDFOCUS PASS' : 'HUDFOCUS FAIL'); await b.close();
