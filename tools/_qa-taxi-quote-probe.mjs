// LANE E probe: does the robotaxi "Where to?" picker get fares on prod? Fresh is_bot device; AT=lat,lon,heading.
import { chromium } from '@playwright/test';
const AT = process.env.AT ?? '37.795570,-122.393900,270';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const frames = []; page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xa2) frames.push(f.payload.length); }));
await page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForTimeout(3000);
await page.keyboard.press('KeyH'); await page.waitForTimeout(8000);
const fares = await page.evaluate(() => [...document.querySelectorAll('.gt-taxi-picker[open] button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')).slice(0, 6));
console.log(JSON.stringify({ at: AT, fares, robotaxiStateFrames: frames.length }));
await browser.close();
