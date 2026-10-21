// Lane B: look check for combat places on the radar (flag combatRadarBlips) on a flags-ON stack. Captures the radar
// near the Ferry (bat pickup + Embarcadero store in range) for an opted-in player on desktop and phone, and asserts a
// player who chose "Play without combat" gets no combat blips (reads the radar's draw state via a pixel probe).
//   GTASF_COMBAT_URL=http://localhost:5374 node tools/_radar-blips-check.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const AT = '37.796200,-122.396000,240';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function run(tag, viewport, choice) {
  const ctx = await browser.newContext(viewport);
  const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
  page.on('pageerror', e => errors.push(`${tag}: ${String(e.message).slice(0, 120)}`));
  await page.goto(`${base}/?at=${AT}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator(choice === 'accept' ? '.gt-age-gate-enter' : '.gt-age-gate-leave'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(3000); // > the 2 s radar sync
  // Count blip-coloured pixels (green $ ring #3ddc84, red crosshair #ff4d4d) on the radar canvas.
  const counts = await page.evaluate(() => {
    let green = 0, red = 0;
    for (const c of document.querySelectorAll('canvas')) {
      if (c.width > 900 || c.height > 900) continue; // skip the WebGL world canvas
      const g = c.getContext('2d'); if (!g) continue;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 0x3d) < 20 && Math.abs(d[i + 1] - 0xdc) < 20 && Math.abs(d[i + 2] - 0x84) < 20) green++;
        if (Math.abs(d[i] - 0xff) < 20 && Math.abs(d[i + 1] - 0x4d) < 25 && Math.abs(d[i + 2] - 0x4d) < 25) red++;
      }
    }
    return { green, red };
  });
  await page.screenshot({ path: `${out}/radar-blips-${tag}.jpg`, type: 'jpeg', quality: 85 });
  console.log(`${tag} (${choice}): blip pixels green=${counts.green} red=${counts.red}`);
  await ctx.close();
  return counts;
}
const desk = await run('desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, 'accept');
const phone = await run('phone', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'accept');
const declined = await run('declined', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, 'decline');
const pass = desk.green > 0 && desk.red > 0 && phone.green > 0 && phone.red > 0 && declined.green === 0 && declined.red === 0;
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'} errors=${JSON.stringify(errors.slice(0, 6))}`);
await browser.close();
