/** gtasf-y5vc pitching end-to-end verify (LOCAL ONLY; never production).
 * Needs the dev servers up with pitching+angelNpcs ON and REMOTE Workers AI for Whisper STT:
 *   GTASF_DEV_REMOTE_AI=1 GTASF_MAP_AREA=sf node tools/dev.mjs
 * (worker reads worker/.dev.vars: OPENROUTER_API_KEY judge, TYPESAFE_API_KEY moderation.)
 * Headless Chromium with a fake mic looping a spoken-pitch WAV. Walks to a celeb angel and a VC ring,
 * holds V, and checks: transcript -> OpenRouter judge -> verdict toast -> modest cheque -> cooldown,
 * with ground truth read from the local D1 SQLite (funding_credits + pitch_judge_spend).
 *   tools/heavy.sh node tools/voice/pitch-e2e.mjs [pitch.wav]
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.GTASF_BASE ?? 'http://127.0.0.1:5173';
const wav = resolve(process.argv[2] ?? '/tmp/pitch.wav');
const SHOT_DIR = process.env.SHOT_DIR ?? 'docs/sf-data/pitching';
mkdirSync(SHOT_DIR, { recursive: true });
const HOLD_MS = Number(process.env.HOLD_MS ?? 13000);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const D1_DIR = 'worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const d1File = () => { const f = readdirSync(D1_DIR).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite'); return f && `${D1_DIR}/${f}`; };
const d1 = sql => { try { const file = d1File(); if (!file) return []; const out = execFileSync('sqlite3', ['-json', '-cmd', '.timeout 5000', file, sql], { encoding: 'utf8' }).trim(); return out ? JSON.parse(out) : []; } catch (e) { return [{ d1error: String(e.stderr ?? e.message).slice(0, 160) }]; } };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const report = { steps: [] };
const log = (name, data) => { report.steps.push({ name, ...data }); console.error(name, JSON.stringify(data)); };

function instrument(context) {
  context.addInitScript(() => {
    const l = (...a) => (window.__log ??= []).push(`${Math.round(performance.now())} ${a.join(' ')}`);
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = c => gum(c).then(s => { l('gum ok', s.getAudioTracks().length); return s; }, e => { l('gum fail', e?.name); throw e; });
  });
}
async function openTab(context, query, device) {
  instrument(context);
  const page = await context.newPage();
  page.on('pageerror', e => log(`${device} pageerror`, { error: String(e).slice(0, 180) }));
  page.on('response', r => { if (r.url().includes('/api/voice/caption')) r.json().then(j => log(`${device} caption-response`, { status: r.status(), pitch: j.pitch ?? null, captionStatus: j.status ?? null })).catch(() => {}); });
  await page.goto(`${BASE}/?voice=1&${query}`);
  for (let i = 0; i < 300; i++) { if (await page.evaluate(() => document.querySelector('#loading')?.hidden).catch(() => false)) break; await page.waitForTimeout(500); }
  for (let i = 0; i < 160; i++) { if (await page.evaluate(() => document.querySelector('#connection')?.textContent === 'Connected').catch(() => false)) break; await page.waitForTimeout(500); }
  return page;
}
async function onboard(page, startup, nick) {
  // Intro slides / identity gate / funding onboarding.
  for (const label of ['Skip', 'Skip intro', 'Skip tutorial', "Let's go", 'Looks good', 'Close ×']) {
    const b = page.getByRole('button', { name: label, exact: true });
    if (await b.count().catch(() => 0) && await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {});
  }
  try { const g = page.locator('.gt-identity-go'); if (await g.isVisible({ timeout: 1500 }).catch(() => false)) { await g.click().catch(() => {}); } } catch {}
  try {
    const d = page.locator('dialog.gt-funding-onboarding');
    if (await d.isVisible({ timeout: 4000 }).catch(() => false)) {
      await page.getByLabel('Startup name', { exact: true }).fill(startup).catch(() => {});
      await page.getByLabel('Your nickname', { exact: true }).fill(nick).catch(() => {});
      await page.getByRole('button', { name: 'Save startup' }).click().catch(() => {});
      await d.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    }
  } catch {}
  for (const label of ['Skip', "Let's go", 'Looks good']) { const b = page.getByRole('button', { name: label, exact: true }); if (await b.count().catch(() => 0) && await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {}); }
}
async function hint(page) { return page.evaluate(() => { const c = document.querySelector('.gt-pitch-hint'); return c && !c.hidden ? c.textContent : null; }).catch(() => null); }
async function toasts(page) { return page.evaluate(() => [...document.querySelectorAll('.gt-toast-title, .gt-toast-detail, .gt-funding-toast-amount, .gt-funding-toast-source')].map(e => e.textContent).filter(Boolean)).catch(() => []); }
async function bubbles(page) { return page.evaluate(() => [...document.querySelectorAll('.gt-chat-bubble-spoken')].map(e => e.textContent)).catch(() => []); }
async function focusCanvas(page) {
  // Clear any cap-table / NPC modal, then give the game canvas focus WITHOUT clicking an NPC (center is the angel).
  await page.bringToFront();
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  const btn = page.getByRole('button', { name: 'CLOSE', exact: true });
  if (await btn.count().catch(() => 0) && await btn.first().isVisible().catch(() => false)) await btn.first().click().catch(() => {});
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.mouse.click(Math.round(vp.width / 2), 150).catch(() => {}); // top-centre sky: focus, no NPC/HUD
}
async function holdV(page, ms) {
  await focusCanvas(page);
  await page.keyboard.down('KeyV'); await page.waitForTimeout(ms); await page.keyboard.up('KeyV');
  return Date.now();
}
async function warmMic(page) {
  await focusCanvas(page);
  await page.keyboard.down('KeyV'); await page.waitForTimeout(500); await page.keyboard.up('KeyV');
  for (let i = 0; i < 60 && !(await page.evaluate(() => (window.__log ?? []).some(l => l.includes('gum'))).catch(() => false)); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(800);
}
const gumLog = page => page.evaluate(() => (window.__log ?? []).slice(-6)).catch(() => []);

try {
  // ---- 1. ANGEL pitch (Garry Tan, 8 m) + cooldown ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, userAgent: UA, permissions: ['microphone'] });
  const A = await openTab(ctxA, 'at=37.8006,-122.4108', 'angel');
  await onboard(A, 'Decentralized Burrito', 'Founder');
  await A.waitForTimeout(1500);
  log('angel ready', { connection: await A.evaluate(() => document.querySelector('#connection')?.textContent).catch(() => null), hint: await hint(A) });
  await warmMic(A);
  const deviceA = d1('SELECT device_id FROM funding_profiles ORDER BY created_at DESC LIMIT 1')[0]?.device_id ?? null;
  const t1 = await holdV(A, HOLD_MS);
  await A.waitForTimeout(6000);
  log('angel after pitch', { hint: await hint(A), toasts: await toasts(A), bubbles: await bubbles(A), gum: await gumLog(A) });
  await A.screenshot({ path: `${SHOT_DIR}/angel-desktop-verdict.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  log('angel D1 credit', { credits: d1(`SELECT source,source_ref,amount_cents,substr(meta_json,1,120) meta FROM funding_credits WHERE device_id='${deviceA}' ORDER BY awarded_at DESC LIMIT 3`), judgeSpend: d1('SELECT day,micro_usd,calls,refused FROM pitch_judge_spend ORDER BY day DESC LIMIT 2') });
  // cooldown: re-pitch the same angel
  await warmMic(A); const t2 = await holdV(A, HOLD_MS); await A.waitForTimeout(6000);
  log('angel cooldown re-pitch', { toasts: await toasts(A) });
  await A.screenshot({ path: `${SHOT_DIR}/angel-desktop-cooldown.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  // minimap radar for the angel 👼
  await A.keyboard.press('Tab').catch(() => {}); await A.waitForTimeout(1200);
  await A.screenshot({ path: `${SHOT_DIR}/angel-desktop-radar.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  await ctxA.close();

  // ---- 2. VC pitch (Andreessen Horowitz, 15 m), fresh device ----
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, userAgent: UA, permissions: ['microphone'] });
  const B = await openTab(ctxB, 'at=37.779361,-122.392552', 'vc');
  await onboard(B, 'Quantum Tacos', 'Maya');
  await B.waitForTimeout(1500);
  log('vc ready', { hint: await hint(B) });
  await warmMic(B);
  const deviceB = d1('SELECT device_id FROM funding_profiles ORDER BY created_at DESC LIMIT 1')[0]?.device_id ?? null;
  const t3 = await holdV(B, HOLD_MS); await B.waitForTimeout(6000);
  log('vc after pitch', { hint: await hint(B), toasts: await toasts(B), bubbles: await bubbles(B) });
  await B.screenshot({ path: `${SHOT_DIR}/vc-desktop-verdict.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  log('vc D1 credit', { credits: d1(`SELECT source,source_ref,amount_cents,substr(meta_json,1,120) meta FROM funding_credits WHERE device_id='${deviceB}' ORDER BY awarded_at DESC LIMIT 3`) });
  await ctxB.close();

  // ---- 3. Phone-viewport screenshot (hint + verdict) at the angel ----
  const ctxP = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, userAgent: UA, permissions: ['microphone'] });
  const P = await openTab(ctxP, 'at=37.781,-122.4045&touch=1&preset=low', 'phone');
  await onboard(P, 'Neural Noodles', 'Sam');
  await P.waitForTimeout(1500);
  await warmMic(P);
  const t4 = await holdV(P, HOLD_MS); await P.waitForTimeout(6000);
  log('phone after pitch', { hint: await hint(P), toasts: await toasts(P) });
  await P.screenshot({ path: `${SHOT_DIR}/angel-phone-verdict.jpg`, type: 'jpeg', quality: 86 }).catch(() => {});
  await ctxP.close();
} finally {
  writeFileSync(`${SHOT_DIR}/pitch-e2e-report.json`, JSON.stringify(report, null, 1) + '\n');
  console.log('REPORT', JSON.stringify(report.steps.map(s => s.name)));
  await browser.close();
}
