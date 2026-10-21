/**
 * Founder-ladder IN-GAME look evidence (gtasf-founder-ladder-p1-ilnl). Boots the real city (preset=low),
 * forces the `ladder` A/B bucket on a fresh device, and captures the four spine moments at desktop +
 * phone: (1) spawn = minimap + one quest card, (2) the found-your-startup card over the city, (3) the
 * startup on the in-world Embarcadero billboard after the camera swing, (4) the share card showing the
 * real in-world billboard render.
 *
 * Prereq: a flag-ON web bundle built into GTASF_FOUNDER_APP (founderLadder:true) and the local worker
 * reachable on :8787 (the preview proxies /api to it). Run: node tools/founder-ladder-ingame.mjs
 */
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir = resolve(process.env.GTASF_FOUNDER_APP ?? '/tmp/claude-501/founder-app');
const code = (await readFile(process.env.GTASF_INVITE_FILE ?? 'worker/.wrangler/production/invite-code.txt', 'utf8')).trim();
const shotsDir = resolve('docs/sf-data/founder-ladder');
await mkdir(shotsDir, { recursive: true });

const server = await preview({
  configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir },
  preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

const devices = [
  { id: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  // Phone follows the repo phone-perf convention (tools/phone-perf.mjs), as the orchestrator asked.
  { id: 'phone', viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [], errors = [], failures = [];

async function run() {
  for (const d of devices) {
    const context = await browser.newContext({
      viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor,
      isMobile: d.isMobile ?? false, hasTouch: d.hasTouch ?? false,
    });
    // Fresh device → new player; force the ladder bucket so the founder flow runs deterministically.
    await context.addInitScript(() => { try { localStorage.setItem('gtasf.founder.bucket.v1', 'ladder'); } catch {} });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${d.id}: ${String(e.message).slice(0, 160)}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${d.id}: ${m.text().slice(0, 160)}`); });
    // Surface which request fails so a stray 4xx can be judged benign vs. a founder-flow break.
    page.on('response', r => { if (r.status() >= 400) errors.push(`${d.id}: HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    const shot = async (name) => { await page.screenshot({ path: resolve(shotsDir, `ingame-${name}-${d.id}.png`) }); results.push(`ingame-${name}-${d.id}`); };

    try {
      await page.goto(`${base}/?invite=${code}&preset=low&at=37.7955,-122.3937,270`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', undefined, { timeout: 150_000 });

      // (1) Spawn: minimap + the one quest card only.
      await page.waitForSelector('.gt-founder-quest', { state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(1500);
      await shot('spawn');

      // (2) Found-your-startup card over the city.
      await page.click('.gt-founder-quest-cta');
      await page.waitForSelector('.gt-founder-found[open]', { state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(600);
      await shot('found');

      // (3) The startup on the in-world Embarcadero billboard after the camera swing.
      await page.click('.gt-founder-found-go');
      await page.waitForSelector('.gt-founder-found', { state: 'hidden', timeout: 20_000 });
      await page.waitForTimeout(3300); // swing settles + the board is framed
      await shot('billboard');

      // (4) Share card, showing the real in-world billboard render.
      await page.waitForFunction(() => /live on the Embarcadero/i.test(document.querySelector('.gt-founder-quest-title')?.textContent ?? ''), undefined, { timeout: 15_000 });
      await page.click('.gt-founder-quest-cta');
      await page.waitForSelector('.gt-founder-share[open]', { state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(500);
      await shot('share');
    } catch (e) {
      const detail = await page.evaluate(() => ({
        quest: document.querySelector('.gt-founder-quest-title')?.textContent ?? null,
        foundStatus: document.querySelector('.gt-founder-found-status')?.textContent ?? null,
        locked: document.body.hasAttribute('data-founder-locked'),
      })).catch(() => ({}));
      failures.push(`${d.id}: ${String(e.message).split('\n')[0]} ${JSON.stringify(detail)}`);
    }
    await context.close();
  }
}

// A dedicated shot of the SHARED city billboards: a pre-founded device (skips the flow) spawns on the
// Embarcadero where the nearest billboard surfaces sit, so the leaderboard's startups show on them.
async function cityBillboards() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => { try {
    localStorage.setItem('gtasf.founder.bucket.v1', 'ladder');
    localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Vertical Burrito', foundedAt: Date.now(), billboardSeen: true }));
  } catch {} });
  const page = await context.newPage();
  page.on('response', async r => {
    if (r.status() >= 400) errors.push(`city: HTTP ${r.status()} ${new URL(r.url()).pathname}`);
    if (r.url().includes('/api/funding/leaderboard')) { try { const j = await r.json(); errors.push(`city: leaderboard week=${j.week?.length ?? '?'} today=${j.today?.length ?? '?'}`); } catch {} }
  });
  try {
    // Stand ~24 m in front of the nearest city billboard surface (sf-bb-embarcadero-10) looking at it.
    await page.goto(`${base}/?invite=${code}&preset=low&at=37.796562,-122.395508,239`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', undefined, { timeout: 150_000 });
    // Scenery (incl. the shared city billboards) loads after READY: it awaits the full road graph +
    // street props first, so give it time before the shot.
    await page.waitForTimeout(14_000);
    await page.screenshot({ path: resolve(shotsDir, 'ingame-citybillboards-desktop.png') });
    results.push('ingame-citybillboards-desktop');
  } catch (e) { failures.push(`city: ${String(e.message).split('\n')[0]}`); }
  await context.close();
}

try { await run(); await cityBillboards(); }
finally { await browser.close(); await server.httpServer.close(); }

const ok = failures.length === 0;
console.log((ok ? 'FOUNDER_INGAME_PASS ' : 'FOUNDER_INGAME_FAIL ') +
  JSON.stringify({ shots: results, failures, errors: errors.slice(0, 10) }));
process.exitCode = ok ? 0 : 1;
