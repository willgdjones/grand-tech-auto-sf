// critique #8 (flag sampledAudio): headless proof that the CC0 samples load, decode and PLAY in-game (a human still has to
// listen before enabling). Hooks AudioBufferSourceNode.start and buckets each started buffer by duration: the synth
// gunshot/crunch use a 0.30-0.35 s noise buffer; the samples are pistol ~1.1 s, smg ~0.35 s, rifle ~1.4 s, punch ~0.65 s,
// crash ~0.49 s, engine ~0.86 s (loop), siren wail ~4.8 s / yelp ~2.3 s (loops), distant sirens ~18 s (loop).
// Also lists the /audio/combat/* fetches with their status.
//   GTASF_COMBAT_URL=http://localhost:5374 node tools/_sampled-audio-check.mjs
import { chromium } from '@playwright/test';
const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.__starts = []; window.__ctxs = 0;
  const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxs++; } };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    try { const d = this.buffer?.duration ?? 0; window.__starts.push({ d: Math.round(d * 100) / 100, loop: this.loop }); } catch {}
    return start.apply(this, args);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
const fetches = []; page.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/audio/combat/')) fetches.push(`${u.pathname.split('/').pop()} ${r.status()}`); });
const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
const SAMPLES = { pistol: [1.05, 1.15], smg: [0.33, 0.37], rifle: [1.35, 1.45], punch: [0.6, 0.7], crash: [0.45, 0.52], engine: [0.8, 0.9], 'siren-yelp': [2.2, 2.4], 'siren-wail': [4.7, 4.9], 'sirens-distant': [17.5, 18.5] };
const bucket = starts => { const out = {}; for (const s of starts) { const name = Object.entries(SAMPLES).find(([, [a, b]]) => s.d >= a && s.d <= b)?.[0] ?? (s.d <= 0.36 ? 'synth/smg' : `other ${s.d}s`); out[name] = (out[name] ?? 0) + 1; } return out; };
let pass = false;
try {
  await page.goto(`${base}/?at=37.795570,-122.393900,270&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('audio'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click({ force: true }); } catch (e) { console.log(`[audio] age gate click: ${String(e.message).split('\n')[0]}`); } // also the AudioContext's user gesture
  await page.waitForFunction(() => window.__gtasfCombat?.state?.().started, { timeout: 15000 }).catch(() => console.log('[audio] combat never started'));
  await page.waitForTimeout(4000); // preloadSamples on combat start: fetch + decode
  console.log(`[audio] after combat start: ${JSON.stringify(await page.evaluate(() => { const s = window.__gtasfCombat?.state?.(); return { started: s?.started, weapon: s?.weapon, ctxs: window.__ctxs, gate: !!document.querySelector('.gt-age-gate-enter') }; }))}`);
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  for (let i = 0; i < 3; i++) { await page.evaluate(() => { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 80); }); await page.waitForTimeout(700); }
  console.log(`[audio] after 3 shots: ${JSON.stringify(await page.evaluate(() => ({ ammo: window.__gtasfCombat?.state?.().ammo, starts: window.__starts.length, ctxs: window.__ctxs })))}`);
  await page.waitForTimeout(6000); // gunfire raises wanted (streetCrimeWanted) → distant-siren bed; nearby cruisers → wail/yelp
  const starts = await page.evaluate(() => window.__starts);
  console.log(`[audio] fetched: ${fetches.join(', ') || 'none'}`);
  console.log(`[audio] buffer starts by sample: ${JSON.stringify(bucket(starts))}`);
  const b = bucket(starts);
  pass = (b.pistol ?? 0) >= 1 && fetches.filter(f => f.endsWith(' 200')).length >= 6 && errors.length === 0;
} catch (e) { console.log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 4))}`);
await browser.close();
