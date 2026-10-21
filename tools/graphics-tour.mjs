// Graphics ship-list tour: the same 14 spots (12-shot founder tour + Mission district + Embarcadero promenade)
// captured on desktop HD and phone Low from any base URL, so prod (before) and a flag preview (after) compare
// shot for shot. Headless Chromium on the real GPU (--use-angle=metal), a FRESH PAGE per shot (reused pages lose
// the WebGL context, gtasf-9xxk), intro/onboarding dismissed, READY + 'Connected' waited, console errors recorded.
//   [TOUR_TIME=14:00] node tools/graphics-tour.mjs <baseUrl> <outDir> [desk|phone|both] [spot,spot,...]
// TOUR_TIME pins the game clock (?time=, render/timeOverride.ts) so before/after compare in daylight.
// Writes <outDir>/<spot>-<view>.png and <outDir>/report.json { spots: [{ spot, view, readyMs, errors, bytes }] }.
import { chromium } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';

export const TOUR_SPOTS = [
  ['01-ferry', '?at=37.7955,-122.3937,270'],
  ['02-embarcadero', '?at=37.7990,-122.3975,315'],
  ['03-columbus', '?at=37.8003,-122.4090,180'],
  ['04-chinatown', '?at=37.7940,-122.4065,0'],
  ['05-union-square', '?at=37.7880,-122.4075,0'],
  ['06-lombard', 'go/lombard'],
  ['07-coit', '?at=37.8024,-122.4058,230'],
  ['08-fidi', '?at=37.7930,-122.4010,0'],
  ['09-soma', '?at=37.7810,-122.4040,90'],
  ['10-castro', '?at=37.7609,-122.4350,90'],
  ['11-marina', '?at=37.8030,-122.4370,0'],
  ['12-hayes', '?at=37.7765,-122.4240,0'],
  ['13-mission', '?at=37.7599,-122.4194,0'],
  ['14-embarcadero-promenade', '?at=37.7930,-122.3925,180'],
  // SF data (gtasf-umar/bhft): street trees and 3DEP terrain look-checks.
  ['15-haight', '?at=37.7699,-122.4469,0'],
  ['16-dolores', '?at=37.7612,-122.4265,90'],
  // Rooftop/paint look-check (gtasf-3o55, gtasf-5mvt): Nob Hill looking east over downtown roofs.
  ['17-nob-hill', '?at=37.7925,-122.4128,90'],
];
const VIEWS = {
  desk: { context: { viewport: { width: 1600, height: 900 } }, query: '&preset=hd' },
  phone: { context: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, query: '&preset=low' },
};

const [base = 'https://gtasf.com', out = 'artifacts/graphics-tour', which = 'both', only] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const spots = only ? TOUR_SPOTS.filter(([name]) => only.split(',').some(o => name.includes(o))) : TOUR_SPOTS;
const views = which === 'both' ? ['desk', 'phone'] : [which];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base, at: new Date().toISOString(), spots: [] };

async function dismiss(page) {
  for (const label of ['Skip', 'Looks good', 'Skip intro', 'Skip tutorial', 'Close ×', "Let's go", 'LET\'S GO']) {
    const b = page.getByRole('button', { name: label, exact: true });
    if (await b.count().catch(() => 0) === 1 && await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
for (const [spot, path] of spots) for (const view of views) {
  const v = VIEWS[view], context = await browser.newContext(v.context), page = await context.newPage(), errors = [];
  // TOUR_LOCAL_DIST=<built web dir>: serve the page + assets locally while /api and /map stay on <baseUrl> (flag bisects).
  if (process.env.TOUR_LOCAL_DIST) {
    const { readFile } = await import('node:fs/promises'), { join, extname } = await import('node:path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
    await context.route(u => u.origin === new URL(base).origin && !u.pathname.startsWith('/api') && !u.pathname.startsWith('/map'), async route => {
      const p = new URL(route.request().url()).pathname, f = join(process.env.TOUR_LOCAL_DIST, p === '/' || p.startsWith('/go/') ? 'index.html' : p);
      try { await route.fulfill({ body: await readFile(f), contentType: types[extname(f)] ?? 'application/octet-stream' }); } catch { await route.continue(); }
    });
  }
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  const query = v.query + (process.env.TOUR_TIME ? `&time=${process.env.TOUR_TIME}` : '');
  const url = `${base.replace(/\/$/, '')}/${path}${path.includes('?') ? query : `?${query.slice(1)}`}`, t0 = Date.now();
  let readyMs = null;
  try {
    await page.goto(url, { timeout: 90_000 });
    for (let i = 0; i < 240; i++) {
      await dismiss(page);
      if (await page.evaluate(() => document.querySelector('#loading')?.hidden && document.querySelector('#connection')?.textContent === 'Connected').catch(() => false)) { readyMs = Date.now() - t0; break; }
      await page.waitForTimeout(500);
    }
    // TOUR_SETTLE_MS: street props/trees mount after the full road graph loads (~50 s on a near-graph spawn).
    await dismiss(page); await page.waitForTimeout(Number(process.env.TOUR_SETTLE_MS ?? 10_000)); await dismiss(page); // chunks + props settle
    const file = `${out}/${spot}-${view}.png`;
    await page.screenshot({ path: file, timeout: 60_000 });
    report.spots.push({ spot, view, url, readyMs, errors, bytes: (await stat(file)).size });
    console.log(spot, view, readyMs === null ? 'NOT READY' : `${readyMs} ms`, `${errors.length} errors`);
  } catch (error) {
    report.spots.push({ spot, view, url, readyMs, errors: [...errors, `capture failed: ${String(error).slice(0, 160)}`] });
    console.log(spot, view, 'FAILED', String(error).slice(0, 120));
  }
  await context.close();
  await new Promise(r => setTimeout(r, 6000)); // back-to-back world sockets from one IP hit the admission 429
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
