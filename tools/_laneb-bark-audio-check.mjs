// Voiced SFPD barks in-game (sampledAudio + policePresence): take 3 stars on a local combat stack (confessed crimes), let
// cruisers arrive, and record every started audio buffer's duration + peak sample. The bark samples (0.6-1.05 s) must have
// a real peak (the #6.39 files were digital silence and still "played"). Captions are listed for context.
//   COMBAT_FLAGS="combat weapons serverHits wanted policePresence streetCrimeWanted sampledAudio" GTASF_URL=http://localhost:5319 \
//     tools/heavy.sh node tools/_laneb-bark-audio-check.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } };
    window.__starts = []; const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      const b = this.buffer; let peak = 0;
      if (b) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i += 4) peak = Math.max(peak, Math.abs(d[i])); }
      window.__starts.push({ ms: Math.round((b?.duration ?? -1) * 1000), peak: +peak.toFixed(3) });
      return start.apply(this, a);
    };
  });
  const page = await context.newPage();
  await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1500); }
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1200); }
  const captions = new Set();
  for (let t = 0; t < 30; t++) { await page.waitForTimeout(1000); const c = await page.evaluate(() => document.querySelector('.gt-police-bark:not([hidden])')?.textContent?.trim()); if (c) captions.add(c); }
  const starts = await page.evaluate(() => window.__starts);
  const barks = starts.filter(s => s.ms >= 600 && s.ms <= 1060);
  console.log(`captions ${JSON.stringify([...captions])}`);
  console.log(`bark-length samples ${JSON.stringify(barks)}; all starts ${starts.length}`);
  console.log(`RESULT ${barks.length === 0 ? 'INCONCLUSIVE no bark-length sample started' : barks.every(b => b.peak > 0.1) ? `PASS ${barks.length} voiced bark(s) audible (peak > 0.1)` : 'FAIL a silent bark sample played'}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
