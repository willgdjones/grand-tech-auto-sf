// One-off (gtasf-9lzk6): start Find Your Co-founders at its giver, tap Abandon in the jobs phone, and 5 s later the phone
// shows no live job, the objective line is gone, and the abandon notice appeared; the mission-abandon POST went out.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const base = process.env.BASE ?? 'http://localhost:5319', out = 'docs/sf-data/missions/abandon'; mkdirSync(out, { recursive: true });
const GIVER = { lat: 37.785418, lon: -122.397022 };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Quit Labs', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); });
const page = await ctx.newPage(); const errs = [], posts = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
page.on('request', q => { if (/mission-(start|abandon)/.test(q.url())) posts.push(new URL(q.url()).pathname); });
const r = {};
try {
  await page.goto(`${base}/?at=${(GIVER.lat + 0.0003).toFixed(6)},${GIVER.lon.toFixed(6)},180&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await page.waitForTimeout(3500);
  for (const sel of ['.gt-sa-intro__skip', '.gt-identity-go']) await page.evaluate(s => document.querySelector(s)?.click(), sel);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 60000 }).catch(() => {});
  const g = project(GIVER.lat, GIVER.lon);
  for (let i = 0; i < 600; i++) { const d = await page.evaluate(({ x, z }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > 3) { const k = Math.min(0.7, d - 3) / d; f.x += dx * k; f.z += dz * k; } return d; }, g); if (d <= 3.3) break; await page.waitForTimeout(110); }
  await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE');
  await page.waitForSelector('.gt-mission-line:not([hidden])', { timeout: 15000 });
  await page.keyboard.press('KeyN'); await page.waitForTimeout(900);
  await page.locator('.gt-mission-phone-abandon').click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  r.liveJobShown = await page.evaluate(() => { const l = document.querySelector('.gt-mission-phone-live'); return !!l && !l.hidden && l.getClientRects().length > 0; });
  r.objectiveShown = await page.evaluate(() => { const l = document.querySelector('.gt-mission-line'); return !!l && !l.hidden; });
  r.noticeSeen = await page.evaluate(() => /abandoned/i.test(document.body.innerText));
  await page.screenshot({ path: `${out}/abandon-5s-desktop.jpg`, type: 'jpeg', quality: 78 });
} catch (e) { r.failure = String(e?.message ?? e).slice(0, 200); }
r.posts = posts; r.errs = errs;
console.log('RESULT', JSON.stringify(r), !r.failure && !r.liveJobShown && !r.objectiveShown && posts.includes('/api/funding/mission-abandon') ? 'ABANDON PASS' : 'ABANDON FAIL');
await b.close();
