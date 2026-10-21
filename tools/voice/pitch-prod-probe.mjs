/** gtasf-y5vc PROD verify of the real AI judge (authorized; hits https://gtasf.com with ?bot=1).
 * Pitches ONE fictional roaming angel + ONE VC office, and checks a real-person celeb is NOT pitchable.
 * Evidence is the /api/voice/caption HTTP response (judge must be 'ai', not 'fallback'; amountCents + credited).
 * pitch_judge_spend is checked separately via `wrangler d1 execute --remote`.
 *   ANGEL_AT=<lat,lon> tools/heavy.sh node tools/voice/pitch-prod-probe.mjs [pitch.wav]
 */
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.GTASF_BASE ?? 'https://gtasf.com';
const wav = resolve(process.argv[2] ?? '/tmp/pitch.wav');
const ANGEL_AT = process.env.ANGEL_AT ?? '37.781673,-122.393512';   // a fictional roaming angel's current stop
const VC_AT = process.env.VC_AT ?? '37.779361,-122.392552';          // Andreessen Horowitz office
const CELEB_AT = process.env.CELEB_AT ?? '37.781,-122.4045';         // Garry Tan (real person) — must NOT be voice-pitchable
const HOLD_MS = Number(process.env.HOLD_MS ?? 13000);
const SHOT_DIR = process.env.SHOT_DIR ?? 'docs/sf-data/pitching/prod';
mkdirSync(SHOT_DIR, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const report = { base: BASE, steps: [] };
const log = (name, data) => { report.steps.push({ name, ...data }); console.error(name, JSON.stringify(data)); };

async function run(label, at, expectPitch) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, userAgent: UA, permissions: ['microphone'] });
  ctx.addInitScript(() => { const g = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices); if (g) navigator.mediaDevices.getUserMedia = c => g(c).then(s => { (window.__log ??= []).push('gum ok'); return s; }, e => { (window.__log ??= []).push('gum ' + e?.name); throw e; }); });
  const page = await ctx.newPage();
  let captionAnswer = null;
  page.on('pageerror', e => log(`${label} pageerror`, { error: String(e).slice(0, 160) }));
  page.on('response', r => { if (r.url().includes('/api/voice/caption')) r.json().then(j => { captionAnswer = { status: j.status ?? null, pitch: j.pitch ?? null }; }).catch(() => {}); });
  await page.goto(`${BASE}/?voice=1&at=${at}&bot=1&time=golden`);
  for (let i = 0; i < 360; i++) { if (await page.evaluate(() => document.querySelector('#loading')?.hidden).catch(() => false)) break; await page.waitForTimeout(500); }
  for (let i = 0; i < 180; i++) { if (await page.evaluate(() => document.querySelector('#connection')?.textContent === 'Connected').catch(() => false)) break; await page.waitForTimeout(500); }
  // dismiss intro / identity / funding onboarding
  for (const lab of ['Skip', 'Skip intro', 'Skip tutorial', "Let's go", 'Looks good', 'Close ×']) { const b = page.getByRole('button', { name: lab, exact: true }); if (await b.count().catch(() => 0) && await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {}); }
  try { const g = page.locator('.gt-identity-go'); if (await g.isVisible({ timeout: 1500 }).catch(() => false)) await g.click().catch(() => {}); } catch {}
  try { const d = page.locator('dialog.gt-funding-onboarding'); if (await d.isVisible({ timeout: 4000 }).catch(() => false)) { await page.getByLabel('Startup name', { exact: true }).fill('Decentralized Burrito').catch(() => {}); await page.getByLabel('Your nickname', { exact: true }).fill('Founder').catch(() => {}); await page.getByRole('button', { name: 'Save startup' }).click().catch(() => {}); await d.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}); } } catch {}
  await page.waitForTimeout(1500);
  const hint = await page.evaluate(() => { const c = document.querySelector('.gt-pitch-hint'); return c && !c.hidden ? c.textContent : null; }).catch(() => null);
  log(`${label} ready`, { connection: await page.evaluate(() => document.querySelector('#connection')?.textContent).catch(() => null), hint });
  // warm mic, then hold V with the WAV
  const focus = async () => { await page.bringToFront(); await page.keyboard.press('Escape').catch(() => {}); await page.mouse.click(640, 150).catch(() => {}); };
  await focus(); await page.keyboard.down('KeyV'); await page.waitForTimeout(500); await page.keyboard.up('KeyV');
  for (let i = 0; i < 60 && !(await page.evaluate(() => (window.__log ?? []).some(l => l.includes('gum'))).catch(() => false)); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(800);
  captionAnswer = null;
  await focus(); await page.keyboard.down('KeyV'); await page.waitForTimeout(HOLD_MS); await page.keyboard.up('KeyV');
  for (let i = 0; i < 40 && !captionAnswer; i++) await page.waitForTimeout(300);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.gt-toast-title, .gt-funding-toast-amount')].map(e => e.textContent).filter(Boolean)).catch(() => []);
  await page.screenshot({ path: `${SHOT_DIR}/${label}.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  log(`${label} pitch`, { expectPitch, hint, captionAnswer, toasts });
  await ctx.close();
  return captionAnswer;
}

try {
  const angel = await run('prod-angel', ANGEL_AT, true);
  const vc = await run('prod-vc', VC_AT, true);
  const celeb = await run('prod-celeb-blocked', CELEB_AT, false);
  report.summary = {
    angelJudge: angel?.pitch?.judge ?? null, angelScore: angel?.pitch?.score ?? null, angelCredited: angel?.pitch?.credited ?? null, angelAmount: angel?.pitch?.amountCents ?? null,
    vcJudge: vc?.pitch?.judge ?? null, vcScore: vc?.pitch?.score ?? null, vcCredited: vc?.pitch?.credited ?? null, vcAmount: vc?.pitch?.amountCents ?? null,
    celebPitch: celeb?.pitch ?? null, // expected null — celebs are not voice-pitchable
    realJudgeWorks: angel?.pitch?.judge === 'ai' || vc?.pitch?.judge === 'ai',
  };
  log('SUMMARY', report.summary);
} finally {
  writeFileSync(`${SHOT_DIR}/prod-probe-report.json`, JSON.stringify(report, null, 1) + '\n');
  console.log('DONE', JSON.stringify(report.summary ?? {}));
  await browser.close();
}
