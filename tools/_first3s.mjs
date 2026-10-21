// One-off (lane C funnel): what a phone visitor sees in the first 3 s on prod (most abandons happen then).
import { chromium, devices } from '@playwright/test';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
if (process.env.BLOCK_POSTER) await page.route('**/art/loading/ferry-title.webp', r => r.abort());
const t0 = Date.now();
const nav = page.goto(`${process.env.BASE ?? 'https://gtasf.com'}/?utm_source=x&bot=1`, { waitUntil: 'commit' });
for (const ms of [500, 1500, 3000]) { await new Promise(r => setTimeout(r, Math.max(0, ms - (Date.now() - t0)))); await page.screenshot({ path: `${process.env.OUT ?? 'docs/sf-data/first-3s'}/t${ms}ms-phone.jpg`, type: 'jpeg', quality: 70 }).catch(e => console.log('shot', ms, e.message)); }
await nav.catch(() => {});
console.log('fcp', await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null));
await b.close();
