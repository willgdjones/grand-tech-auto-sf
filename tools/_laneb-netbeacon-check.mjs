// gtasf-j7wvv netBeacon end-to-end on a local stack: a NON-bot-looking client (no ?bot=1, webdriver false, normal UA —
// the beacon deliberately skips bots) connects (-> 'session'), its world socket is closed abnormally (4000 -> 'drop'),
// it reconnects (-> 'rejoin'). Prints the beacon requests + statuses; then read the counts from the stack's local D1:
//   cd $SNAP/worker && node ../node_modules/wrangler/bin/wrangler.js d1 execute gtasf-local --local --command "SELECT * FROM net_beacon_counts"
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-netbeacon-check.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } };
  });
  const page = await context.newPage(), beacons = [];
  page.on('request', r => { if (r.url().includes('/api/net/beacon')) beacons.push({ body: r.postData() }); });
  page.on('response', r => { if (r.url().includes('/api/net/beacon')) { const b = beacons.find(x => x.status === undefined); if (b) b.status = r.status(); } });
  await page.goto(`${base}/?at=37.79560,-122.39370,270&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__worldSocket.close(4000, 'netBeacon test drop'));
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  console.log(`beacons ${JSON.stringify(beacons)}`);
  const kinds = beacons.filter(b => b.status === 204).map(b => JSON.parse(b.body).kind);
  console.log(`RESULT ${['session', 'drop', 'rejoin'].every(k => kinds.includes(k)) ? 'PASS session + drop + rejoin posted (204)' : 'FAIL ' + kinds.join(',')}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
